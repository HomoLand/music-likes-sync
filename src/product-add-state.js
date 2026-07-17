import { normalizeText } from './normalize.js';

const STATE_VERSION = 1;

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
  const sourceOperations = Array.isArray(plan.operations) ? plan.operations : [];
  const occupiedTargets = new Set(sourceOperations
    .filter((operation) => operation.action !== 'add')
    .map((operation) => productOperationTargetKey(operation, operation.targetTrack))
    .filter(Boolean));
  const selectedCounts = new Map();
  const referencedTargets = new Set();
  const pendingDecisionKeys = new Set();
  for (const operation of sourceOperations) {
    if (operation.action !== 'add' || operation.addDecision?.action === 'skip') continue;
    const key = productOperationTargetKey(operation, selectedProductAddTrack(operation));
    if (key) {
      referencedTargets.add(key);
      selectedCounts.set(key, (selectedCounts.get(key) || 0) + 1);
    }
    if (operation.decisionKey && (operation.status !== 'ready' || !selectedProductAddTrack(operation))) {
      pendingDecisionKeys.add(operation.decisionKey);
    }
  }

  let changed = 0;
  const conflictOperationIds = [];
  const operations = sourceOperations.map((operation) => {
    if (operation.action === 'remove' && operation.status === 'ready') {
      const targetKey = productOperationTargetKey(operation, operation.targetTrack);
      const pendingPair = operation.manualDecision?.action === 'separate'
        && operation.decisionKey
        && pendingDecisionKeys.has(operation.decisionKey);
      if ((targetKey && referencedTargets.has(targetKey)) || pendingPair) {
        changed += 1;
        conflictOperationIds.push(operation.id);
        return {
          ...operation,
          status: 'needs_review',
          blockedReason: 'candidate_target_conflict',
          message: 'This deletion is linked to an unresolved add candidate and must remain in manual review.',
        };
      }
    }
    if (operation.action !== 'add' || operation.status !== 'ready') return operation;
    const key = productOperationTargetKey(operation, selectedProductAddTrack(operation));
    if (!key || (!occupiedTargets.has(key) && (selectedCounts.get(key) || 0) < 2)) return operation;
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
  });

  return {
    plan: changed ? { ...plan, operations } : plan,
    changed,
    conflictOperationIds,
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

function hasPersistableProductAddState(operation = {}) {
  if (operation.action !== 'add') return false;
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

function compactProductAddStateEntry(operation = {}, options = {}) {
  return {
    key: options.key,
    target: clean(operation.targetPlatform, 40).toLowerCase(),
    source: compactSourceIdentity(operation.sourceTrack, operation.sourcePlatform),
    status: normalizeStatus(operation.status),
    candidateTrack: compactTrack(operation.candidateTrack),
    resolvedTargetTrack: compactTrack(operation.resolvedTargetTrack),
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
  const candidateTrack = compactTrack(saved.candidateTrack);
  const resolvedTargetTrack = compactTrack(saved.resolvedTargetTrack);
  let status = normalizeStatus(saved.status || operation.status);
  if (status === 'ready' && !resolvedTargetTrack) {
    status = candidateTrack ? 'needs_review' : 'needs_resolution';
  }
  return {
    ...operation,
    status,
    candidateTrack: candidateTrack || operation.candidateTrack || null,
    resolvedTargetTrack: resolvedTargetTrack || operation.resolvedTargetTrack || null,
    alternatives: Array.isArray(saved.alternatives) && saved.alternatives.length
      ? saved.alternatives.map(compactTrack).filter(Boolean)
      : operation.alternatives || [],
    resolution: saved.resolution || operation.resolution,
    aiReview: saved.aiReview || operation.aiReview,
    addDecision: saved.addDecision || operation.addDecision,
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
  };
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
