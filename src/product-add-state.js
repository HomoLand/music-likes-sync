import { normalizeText } from './normalize.js';
import { compareAppleToPlatform } from './match.js';

const STATE_VERSION = 1;
export const PRODUCT_ADD_MATCHER_VERSION = 4;

export function emptyProductAddState() {
  return {
    version: STATE_VERSION,
    updatedAt: '',
    items: {},
  };
}

export function normalizeProductAddState(state = {}) {
  const input = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  return {
    version: STATE_VERSION,
    updatedAt: clean(input.updatedAt, 80),
    items: input.items && typeof input.items === 'object' && !Array.isArray(input.items)
      ? input.items
      : {},
  };
}

export function productAddStateKey(operation = {}) {
  const target = clean(operation.targetPlatform || operation.candidateTrack?.platform, 40).toLowerCase();
  const source = operation.sourceTrack || {};
  const platform = clean(operation.sourcePlatform || source.platform || 'apple', 40).toLowerCase();
  const identity = source.id
    ? `id:${clean(source.id, 240)}`
    : source.mid
      ? `mid:${clean(source.mid, 240)}`
      : source.isrc
        ? `isrc:${clean(source.isrc, 40).toUpperCase()}`
        : `text:${normalizeText([
          source.title || '',
          source.artist || artistsText(source.artists),
          source.album || '',
          durationBucket(source.durationMs),
        ].join(' ')) || 'unknown'}`;
  return `product-add|${target || 'unknown'}|${platform || 'unknown'}|${identity}`;
}

export function upsertProductAddState(state, operations = [], options = {}) {
  const next = normalizeProductAddState(state);
  const updatedAt = clean(options.updatedAt || new Date().toISOString(), 80);
  let changed = 0;
  for (const operation of operations || []) {
    if (!hasPersistableProductAddState(operation)) continue;
    const key = productAddStateKey(operation);
    next.items[key] = compactProductAddStateEntry(operation, { key, updatedAt });
    changed += 1;
  }
  if (changed) next.updatedAt = updatedAt;
  return { state: next, changed };
}

export function attachProductAddState(plan = {}, state = {}) {
  const normalized = normalizeProductAddState(state);
  let changed = 0;
  const operations = (plan.operations || []).map((operation) => {
    if (operation.action !== 'add') return operation;
    const saved = normalized.items[productAddStateKey(operation)];
    if (!saved) return operation;
    const restored = restoreProductAddOperation(operation, saved);
    if (restored !== operation) changed += 1;
    return restored;
  });
  if (!changed) return { plan, changed: 0 };
  return {
    plan: {
      ...plan,
      operations,
    },
    changed,
  };
}

export function guardProductAddTargetConflicts(plan = {}) {
  const protectedTargets = dropRemovalsForKeptTargets(
    Array.isArray(plan.operations) ? plan.operations : [],
  );
  const collapsed = collapseAcceptedExistingTargets(protectedTargets.operations);
  const sourceOperations = collapsed.operations;
  const structuralChanges = protectedTargets.changed + collapsed.changed;
  const decisionPlan = structuralChanges ? { ...plan, operations: sourceOperations } : plan;
  let changed = structuralChanges;
  const operationsWithRejectedCandidatesCleared = sourceOperations.map((operation) => {
    if (operation.action !== 'add') return operation;
    const selected = selectedProductAddTrack(operation);
    const rejectedKeys = new Set(productRejectedAddCandidateKeys(decisionPlan, operation));
    if (!selected || !trackMatchesCandidateKeys(selected, rejectedKeys)) return operation;

    changed += 1;
    return {
      ...operation,
      status: 'needs_resolution',
      candidateTrack: null,
      resolvedTargetTrack: null,
      blockedReason: '',
      alternatives: (operation.alternatives || [])
        .filter((track) => !trackMatchesCandidateKeys(track, rejectedKeys)),
      aiReview: null,
      addDecision: null,
      resolution: {
        reason: 'candidate_rejected_by_identity_decision',
        message: 'This target version was already marked as a different recording and will not be proposed again.',
      },
    };
  });
  const workingPlan = changed ? { ...plan, operations: operationsWithRejectedCandidatesCleared } : plan;
  const workingOperations = workingPlan.operations || [];
  const occupiedTargets = new Set(workingOperations
    .filter((operation) => operation.action !== 'add')
    .map((operation) => productOperationTargetKey(operation, operation.targetTrack))
    .filter(Boolean));
  const readySelectedCounts = new Map();
  const referencedTargets = new Set();
  const pendingDecisionKeys = new Set();
  for (const operation of workingOperations) {
    if (operation.action !== 'add' || operation.addDecision?.action === 'skip') continue;
    const key = productOperationTargetKey(operation, selectedProductAddTrack(operation));
    if (key) {
      referencedTargets.add(key);
      if (
        operation.status === 'ready'
        || (operation.blockedReason === 'candidate_target_conflict' && operation.resolvedTargetTrack)
      ) {
        readySelectedCounts.set(key, (readySelectedCounts.get(key) || 0) + 1);
      }
    }
    if (operation.decisionKey && (operation.status !== 'ready' || !selectedProductAddTrack(operation))) {
      pendingDecisionKeys.add(operation.decisionKey);
    }
  }

  const conflictOperationIds = [];
  const operations = workingOperations.map((operation) => {
    const staleConflict = operation.blockedReason === 'candidate_target_conflict';
    if (operation.action === 'remove' && (operation.status === 'ready' || staleConflict)) {
      const targetKey = productOperationTargetKey(operation, operation.targetTrack);
      const pendingPair = operation.manualDecision?.action === 'separate'
        && operation.decisionKey
        && pendingDecisionKeys.has(operation.decisionKey);
      if ((targetKey && referencedTargets.has(targetKey)) || pendingPair) {
        if (staleConflict && operation.status === 'needs_review') return operation;
        changed += 1;
        conflictOperationIds.push(operation.id);
        return {
          ...operation,
          status: 'needs_review',
          blockedReason: 'candidate_target_conflict',
          message: 'This deletion is linked to an unresolved add candidate and must remain in manual review.',
        };
      }
      if (staleConflict) {
        changed += 1;
        return {
          ...operation,
          status: 'ready',
          blockedReason: '',
          message: '',
        };
      }
    }
    const readyAdd = operation.action === 'add' && (
      operation.status === 'ready'
      || (staleConflict && operation.resolvedTargetTrack)
    );
    if (!readyAdd) return operation;
    const key = productOperationTargetKey(operation, selectedProductAddTrack(operation));
    const conflicting = key && (occupiedTargets.has(key) || (readySelectedCounts.get(key) || 0) >= 2);
    if (conflicting) {
      if (staleConflict && operation.status === 'needs_review') return operation;
      changed += 1;
      conflictOperationIds.push(operation.id);
      return {
        ...operation,
        status: 'needs_review',
        blockedReason: 'candidate_target_conflict',
        resolution: {
          ...(operation.resolution || {}),
          reason: 'candidate_target_conflict',
          message: 'The selected candidate already exists in another target operation and must be reviewed before any add or delete.',
        },
      };
    }
    if (!staleConflict) return operation;
    changed += 1;
    return {
      ...operation,
      status: 'ready',
      blockedReason: '',
      resolution: {
        ...(operation.resolution || {}),
        reason: 'resolved_target_match',
        message: 'A high-confidence target-platform catalog track was found.',
      },
    };
  });

  return {
    plan: changed ? { ...workingPlan, operations } : plan,
    changed,
    conflictOperationIds,
  };
}

export function productRejectedAddCandidateKeys(plan = {}, operation = {}) {
  const sourceKey = productOperationSourceKey(operation);
  if (!sourceKey) return [];

  const keys = new Set();
  for (const candidate of plan.operations || []) {
    if (candidate.manualDecision?.action !== 'separate') continue;
    if (productOperationSourceKey(candidate) !== sourceKey) continue;
    for (const key of productTrackCandidateKeys(candidate.targetTrack || candidate.identityDecisionOrigin?.targetTrack)) {
      keys.add(key);
    }
  }
  const decisionGroups = new Map();
  const decisionItems = plan.reviewDecisions?.items || plan.identityDecisions?.items || {};
  for (const [decisionKey, decision] of Object.entries(decisionItems)) {
    const action = String(decision?.action || '').trim().toLowerCase();
    if (action !== 'keep' && action !== 'separate') continue;
    const parts = String(decisionKey || '').split('|');
    if (parts.length !== 4 || decisionTrackKey(parts[2]) !== sourceKey) continue;
    const targetKey = decisionTrackKey(parts[3]);
    if (!targetKey) continue;
    const actions = decisionGroups.get(targetKey) || new Set();
    actions.add(action);
    decisionGroups.set(targetKey, actions);
  }
  for (const [targetKey, actions] of decisionGroups) {
    if (actions.size === 1 && actions.has('separate')) keys.add(targetKey);
  }
  return [...keys];
}

function dropRemovalsForKeptTargets(operations) {
  const keptTargets = new Set(operations
    .filter((operation) => operation.action === 'keep' && operation.status === 'ready')
    .map((operation) => productOperationTargetKey(operation, operation.targetTrack))
    .filter(Boolean));
  if (!keptTargets.size) return { operations, changed: 0 };
  const filtered = operations.filter((operation) => (
    operation.action !== 'remove'
    || !keptTargets.has(productOperationTargetKey(operation, operation.targetTrack))
  ));
  return {
    operations: filtered,
    changed: operations.length - filtered.length,
  };
}

function collapseAcceptedExistingTargets(operations) {
  const removalsByTarget = new Map();
  const acceptedAddsByTarget = new Map();
  for (const operation of operations) {
    if (operation.action === 'remove' && operation.manualDecision?.action !== 'separate') {
      appendOperationByTarget(removalsByTarget, operation, operation.targetTrack);
      continue;
    }
    if (
      operation.action === 'add'
      && operation.status === 'ready'
      && operation.addDecision?.action === 'accept_candidate'
    ) {
      appendOperationByTarget(acceptedAddsByTarget, operation, selectedProductAddTrack(operation));
    }
  }

  const replacements = new Map();
  const removedIds = new Set();
  for (const [key, additions] of acceptedAddsByTarget) {
    const removals = removalsByTarget.get(key) || [];
    if (additions.length !== 1 || removals.length !== 1) continue;
    const addition = additions[0];
    const removal = removals[0];
    const targetTrack = removal.targetTrack || selectedProductAddTrack(addition);
    replacements.set(addition.id, {
      ...addition,
      action: 'keep',
      status: 'ready',
      destructive: false,
      reason: 'accepted_existing_target',
      message: 'The accepted candidate already exists in the target playlist and is kept in place.',
      targetTrack,
      candidateTrack: targetTrack,
      resolvedTargetTrack: targetTrack,
      blockedReason: '',
      resolution: {
        ...(addition.resolution || {}),
        reason: 'accepted_existing_target',
        message: 'The accepted target version is already present, so no add or delete is needed.',
      },
    });
    removedIds.add(removal.id);
  }

  if (!replacements.size) return { operations, changed: 0 };
  return {
    operations: operations
      .filter((operation) => !removedIds.has(operation.id))
      .map((operation) => replacements.get(operation.id) || operation),
    changed: replacements.size + removedIds.size,
  };
}

function appendOperationByTarget(index, operation, track) {
  const key = productOperationTargetKey(operation, track);
  if (!key) return;
  const items = index.get(key) || [];
  items.push(operation);
  index.set(key, items);
}

export function mergeProductAddResolution(operation = {}, resolution = {}) {
  const hasCandidate = Object.prototype.hasOwnProperty.call(resolution, 'candidateTrack');
  const hasResolved = Object.prototype.hasOwnProperty.call(resolution, 'resolvedTargetTrack');
  const hasAlternatives = Object.prototype.hasOwnProperty.call(resolution, 'alternatives');
  const status = normalizeStatus(resolution.status || operation.status);
  const candidateTrack = status === 'not_found'
    ? null
    : hasCandidate ? resolution.candidateTrack : operation.candidateTrack;
  const resolvedTargetTrack = status === 'not_found'
    ? null
    : hasResolved ? resolution.resolvedTargetTrack : operation.resolvedTargetTrack;
  const previousEvidence = operation.resolvedTargetTrack || operation.candidateTrack || null;
  const nextEvidence = resolvedTargetTrack || candidateTrack || null;
  const evidenceChanged = productAddCandidateEvidenceKey(previousEvidence)
    !== productAddCandidateEvidenceKey(nextEvidence)
    || productAddScoreEvidenceKey(operation.resolvedScore ?? operation.score)
      !== productAddScoreEvidenceKey(resolution.resolvedScore ?? operation.resolvedScore ?? operation.score);

  return {
    ...operation,
    status,
    targetTrack: resolution.targetTrack || operation.targetTrack,
    candidateTrack,
    resolvedTargetTrack,
    resolvedScore: resolution.resolvedScore ?? operation.resolvedScore ?? null,
    matcherVersion: PRODUCT_ADD_MATCHER_VERSION,
    resolution: resolution.resolution || operation.resolution,
    alternatives: hasAlternatives ? resolution.alternatives : operation.alternatives || [],
    aiReview: evidenceChanged ? null : operation.aiReview,
    addDecision: evidenceChanged ? null : operation.addDecision,
    blockedReason: evidenceChanged ? '' : operation.blockedReason || '',
  };
}

export function productAddReferencesTarget(plan = {}, targetOperation = {}) {
  const targetKey = productOperationTargetKey(targetOperation, targetOperation.targetTrack);
  if (!targetKey) return false;
  return (plan.operations || []).some((operation) => (
    operation.action === 'add'
    && operation.addDecision?.action !== 'skip'
    && productOperationTargetKey(operation, selectedProductAddTrack(operation)) === targetKey
  ));
}

export function rejectProductAddCandidateFromAi(operation = {}, options = {}) {
  const candidate = operation.candidateTrack || null;
  return {
    ...operation,
    status: 'not_found',
    candidateTrack: null,
    resolvedTargetTrack: null,
    blockedReason: '',
    alternatives: [candidate, ...(operation.alternatives || [])].filter(Boolean).slice(0, 5),
    addDecision: {
      action: 'skip',
      batchId: clean(options.batchId, 160),
      decidedAt: clean(options.decidedAt, 80),
      source: 'ai_user_approved',
      aiBatchId: clean(options.aiBatchId, 160),
      aiModel: clean(options.aiModel, 160),
      aiConfidence: finiteNumber(options.aiConfidence),
      userApprovedAt: clean(options.userApprovedAt, 80),
    },
    resolution: {
      ...(operation.resolution || {}),
      reason: 'ai_rejected_candidate',
      message: 'The user approved a high-confidence AI rejection of this target candidate.',
    },
  };
}

export function productAddAiSuggestionAlreadyApplied(operation = {}) {
  const review = operation.aiReview || {};
  const decision = operation.addDecision || {};
  if (decision.source !== 'ai_user_approved') return false;

  const reviewBatchId = clean(review.batchId, 160);
  const decisionBatchId = clean(decision.aiBatchId, 160);
  if (reviewBatchId && reviewBatchId !== decisionBatchId) return false;

  if (review.recommendedAction === 'skip') return decision.action === 'skip';
  if (review.recommendedAction === 'add') return decision.action === 'accept_candidate';
  return false;
}

function hasPersistableProductAddState(operation = {}) {
  const acceptedExistingTarget = operation.action === 'keep'
    && operation.reason === 'accepted_existing_target'
    && operation.addDecision?.action === 'accept_candidate';
  if (operation.action !== 'add' && !acceptedExistingTarget) return false;
  return Boolean(
    operation.candidateTrack
    || operation.resolvedTargetTrack
    || operation.aiReview
    || operation.addDecision
    || operation.resolution
    || (operation.status && operation.status !== 'needs_resolution'),
  );
}

function selectedProductAddTrack(operation = {}) {
  return operation.resolvedTargetTrack
    || (operation.addDecision?.action === 'accept_candidate' ? operation.candidateTrack : null)
    || operation.targetTrack
    || operation.candidateTrack
    || null;
}

function productOperationTargetKey(operation = {}, track = null) {
  if (!track || typeof track !== 'object') return '';
  const target = clean(operation.targetPlatform || track.platform, 40).toLowerCase();
  const providerId = clean(track.id || track.mid, 240);
  return target && providerId ? `${target}:${providerId}` : '';
}

function productOperationSourceKey(operation = {}) {
  const track = operation.sourceTrack || operation.identityDecisionOrigin?.sourceTrack;
  const platform = clean(operation.sourcePlatform || track?.platform || 'apple', 40).toLowerCase();
  const providerId = clean(track?.id || track?.mid || track?.isrc, 240);
  if (platform && providerId) return `${platform}:${providerId}`;

  const decisionKey = clean(operation.decisionKey || operation.manualDecision?.key, 4000);
  const identity = decisionKey.split('|')[2] || '';
  const firstSeparator = identity.indexOf(':');
  const secondSeparator = identity.indexOf(':', firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator) return '';
  const decisionPlatform = identity.slice(0, firstSeparator).toLowerCase();
  const decisionProviderId = identity.slice(firstSeparator + 1, secondSeparator);
  return decisionPlatform && decisionProviderId && decisionProviderId !== 'none'
    ? `${decisionPlatform}:${decisionProviderId}`
    : '';
}

function decisionTrackKey(identity) {
  const text = String(identity || '');
  const firstSeparator = text.indexOf(':');
  const secondSeparator = text.indexOf(':', firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator) return '';
  const platform = text.slice(0, firstSeparator).toLowerCase();
  const providerId = text.slice(firstSeparator + 1, secondSeparator);
  return platform && providerId && providerId !== 'none' ? `${platform}:${providerId}` : '';
}

function productTrackCandidateKeys(track = {}) {
  if (!track || typeof track !== 'object') return [];
  const platform = clean(track.platform, 40).toLowerCase();
  if (!platform) return [];
  return [...new Set([track.id, track.mid]
    .map((value) => clean(value, 240))
    .filter(Boolean)
    .map((value) => `${platform}:${value}`))];
}

function trackMatchesCandidateKeys(track, keys) {
  return productTrackCandidateKeys(track).some((key) => keys.has(key));
}

function productAddCandidateEvidenceKey(track) {
  if (!track || typeof track !== 'object') return '';
  const platform = clean(track.platform, 40).toLowerCase();
  const providerId = clean(track.id || track.mid, 240);
  if (providerId) return `${platform || 'unknown'}:provider:${providerId}`;
  const text = normalizeText([
    track.title || track.name || '',
    track.artist || artistsText(track.artists),
    track.album || '',
    durationBucket(track.durationMs),
  ].join(' '));
  return text ? `${platform || 'unknown'}:text:${text}` : '';
}

function compactProductAddStateEntry(operation = {}, options = {}) {
  return {
    key: options.key,
    target: clean(operation.targetPlatform, 40).toLowerCase(),
    source: compactSourceIdentity(operation.sourceTrack, operation.sourcePlatform),
    status: normalizeStatus(operation.status),
    matcherVersion: PRODUCT_ADD_MATCHER_VERSION,
    candidateTrack: compactTrack(operation.candidateTrack),
    resolvedTargetTrack: compactTrack(operation.resolvedTargetTrack),
    resolvedScore: compactScore(operation.resolvedScore),
    alternatives: Array.isArray(operation.alternatives)
      ? operation.alternatives.slice(0, 12).map(compactTrack).filter(Boolean)
      : [],
    resolution: compactObject(operation.resolution),
    aiReview: compactObject(operation.aiReview),
    addDecision: compactObject(operation.addDecision),
    blockedReason: clean(operation.blockedReason, 160),
    updatedAt: options.updatedAt,
  };
}

function restoreProductAddOperation(operation, saved = {}) {
  let candidateTrack = compactTrack(saved.candidateTrack);
  let resolvedTargetTrack = compactTrack(saved.resolvedTargetTrack);
  let status = normalizeStatus(saved.status || operation.status);
  const selectedTrack = resolvedTargetTrack || candidateTrack;
  const revalidation = scoreProductAddCandidate(operation.sourceTrack, selectedTrack);
  const previousScore = compactScore(saved.resolvedScore || operation.resolvedScore || operation.score);
  const resolvedScore = revalidation.score || previousScore;
  const rulesChanged = Number(saved.matcherVersion || 0) !== PRODUCT_ADD_MATCHER_VERSION;
  const scoreChanged = productAddScoreEvidenceKey(previousScore) !== productAddScoreEvidenceKey(resolvedScore);
  const staleDerivedDecision = rulesChanged || scoreChanged;
  const preserveUserDecision = isExplicitUserDecision(saved.addDecision);
  let resolution = saved.resolution || operation.resolution;
  let aiReview = preserveUserDecision
    ? saved.aiReview || operation.aiReview
    : staleDerivedDecision ? null : saved.aiReview || operation.aiReview;
  let addDecision = preserveUserDecision
    ? saved.addDecision
    : staleDerivedDecision ? null : saved.addDecision || operation.addDecision;

  if (preserveUserDecision && saved.addDecision?.action === 'skip') {
    status = saved.addDecision?.source === 'ai_user_approved' ? 'not_found' : 'blocked';
    resolvedTargetTrack = null;
  } else if (revalidation.matched && selectedTrack && !preserveUserDecision) {
    status = 'ready';
    resolvedTargetTrack = selectedTrack;
    resolution = {
      reason: 'resolved_target_match',
      message: 'A high-confidence target-platform catalog track was found.',
    };
  } else if (revalidation.status === 'not_found' && selectedTrack && !preserveUserDecision) {
    status = 'not_found';
    candidateTrack = null;
    resolvedTargetTrack = null;
    aiReview = null;
    addDecision = null;
    resolution = {
      reason: 'target_catalog_low_score',
      message: 'The saved target candidate no longer satisfies the current matching rules.',
    };
  } else if (revalidation.status === 'needs_review' && selectedTrack && !preserveUserDecision) {
    status = 'needs_review';
    resolvedTargetTrack = null;
    resolution = {
      reason: 'low_confidence_target_match',
      message: 'The saved target candidate requires review under the current matching rules.',
    };
  } else if (status === 'ready' && !preserveUserDecision) {
    status = candidateTrack ? 'needs_review' : 'needs_resolution';
    resolvedTargetTrack = null;
  } else if (status === 'ready' && !resolvedTargetTrack) {
    status = candidateTrack ? 'needs_review' : 'needs_resolution';
  }
  return {
    ...operation,
    status,
    matcherVersion: PRODUCT_ADD_MATCHER_VERSION,
    candidateTrack: candidateTrack || operation.candidateTrack || null,
    resolvedTargetTrack: resolvedTargetTrack || operation.resolvedTargetTrack || null,
    resolvedScore,
    alternatives: Array.isArray(saved.alternatives) && saved.alternatives.length
      ? saved.alternatives.map(compactTrack).filter(Boolean)
      : operation.alternatives || [],
    resolution,
    aiReview,
    addDecision,
    blockedReason: saved.blockedReason || operation.blockedReason || '',
  };
}

function compactSourceIdentity(track = {}, fallbackPlatform = '') {
  return {
    platform: clean(fallbackPlatform || track.platform, 40),
    id: clean(track.id, 240),
    mid: clean(track.mid, 240),
    isrc: clean(track.isrc, 40),
    title: clean(track.title, 500),
    artist: clean(track.artist || artistsText(track.artists), 500),
    album: clean(track.album, 500),
    durationMs: finiteNumber(track.durationMs),
  };
}

function compactTrack(track) {
  if (!track || typeof track !== 'object') return null;
  return {
    platform: clean(track.platform, 40),
    id: clean(track.id, 240),
    mid: clean(track.mid, 240),
    songType: finiteNumber(track.songType ?? track.type),
    type: finiteNumber(track.type ?? track.songType),
    title: clean(track.title || track.name, 500),
    artist: clean(track.artist || artistsText(track.artists), 500),
    artists: Array.isArray(track.artists) ? track.artists.map((item) => clean(item, 200)).filter(Boolean).slice(0, 20) : [],
    album: clean(track.album, 500),
    durationMs: finiteNumber(track.durationMs),
    isrc: clean(track.isrc, 40),
    artworkUrl: clean(track.artworkUrl || track.coverUrl, 2000),
    aliases: compactAliases(track.aliases),
    metadata: compactTrackMetadata(track.metadata),
  };
}

function compactTrackMetadata(metadata) {
  if (!metadata?.providerCatalog) return null;
  const value = metadata.providerCatalog;
  return {
    providerCatalog: {
      platform: clean(value.platform, 40),
      trackNumber: finiteNumber(value.trackNumber),
      discNumber: finiteNumber(value.discNumber),
      albumId: clean(value.albumId, 240),
      albumMid: clean(value.albumMid, 240),
      subtitle: clean(value.subtitle, 500),
      releaseDate: clean(value.releaseDate, 40),
    },
  };
}

function scoreProductAddCandidate(sourceTrack, targetTrack) {
  if (!sourceTrack || !targetTrack) return { matched: false, status: 'not_found', score: null };
  const comparison = compareAppleToPlatform([sourceTrack], [targetTrack]);
  const matched = comparison.matches[0];
  if (matched) return { matched: true, status: 'ready', score: compactScore(matched.score) };
  const review = comparison.reviewItems[0];
  if (review) return { matched: false, status: 'needs_review', score: compactScore(review.score) };
  return {
    matched: false,
    status: 'not_found',
    score: compactScore(comparison.missingItems[0]?.best?.score),
  };
}

function isExplicitUserDecision(decision) {
  if (!decision?.action) return false;
  const source = clean(decision.source, 80).toLowerCase();
  return source !== 'ai';
}

function compactAliases(value = {}) {
  const result = {};
  for (const key of ['titles', 'artists', 'albums']) {
    const values = Array.isArray(value?.[key])
      ? value[key].map((item) => clean(item, 500)).filter(Boolean).slice(0, 24)
      : [];
    if (values.length) result[key] = values;
  }
  return Object.keys(result).length ? result : null;
}

function compactScore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of ['total', 'title', 'artist', 'album', 'duration', 'isrc']) {
    const number = Number(value[key]);
    if (Number.isFinite(number)) result[key] = number;
  }
  for (const key of ['isrcConflict', 'recordingFingerprint', 'appleEquivalentFingerprint', 'catalogTrackFingerprint', 'versionCueConflict']) {
    if (value[key] !== undefined) result[key] = Boolean(value[key]);
  }
  return Object.keys(result).length ? result : null;
}

function productAddScoreEvidenceKey(value) {
  const score = compactScore(value);
  return score ? JSON.stringify(score) : '';
}

function compactObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeStatus(value) {
  const status = clean(value, 80);
  return ['needs_resolution', 'needs_review', 'not_found', 'ready', 'blocked'].includes(status)
    ? status
    : 'needs_resolution';
}

function durationBucket(value) {
  const duration = Number(value || 0);
  if (!Number.isFinite(duration) || duration <= 0) return 'unknown';
  return String(Math.round(duration / 5000) * 5);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function artistsText(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || '');
}

function clean(value, limit) {
  return String(value || '').trim().slice(0, limit);
}
