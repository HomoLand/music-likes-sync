import { durationLabel, normalizeText } from './normalize.js';
import { compareAppleToPlatform } from './match.js';
import { trackArtworkUrl, trackPreviewUrl } from './track-media.js';

const DEFAULT_SOURCE = 'apple';
const DEFAULT_MATCH_THRESHOLD = 0.82;
const DEFAULT_REVIEW_THRESHOLD = 0.68;
const TARGETS = new Set(['qq', 'netease']);
const SEPARATE_ADDS_SOURCE_REASONS = new Set(['source_uncertain_match', 'duplicate_target_match']);
const SEPARATE_REMOVES_TARGET_REASONS = new Set([
  'source_uncertain_match',
  'reverse_only_match',
  'target_uncertain_orphan',
]);
export const MIRROR_REVIEW_DECISION_ACTIONS = new Set(['keep', 'separate']);

export function buildMirrorSyncPlan(input = {}) {
  const sourcePlatform = String(input.source || DEFAULT_SOURCE).trim().toLowerCase();
  const targetPlatform = String(input.target || input.targetSnapshot?.platform || '').trim().toLowerCase();
  if (sourcePlatform !== DEFAULT_SOURCE) {
    throw new Error('Mirror sync currently supports Apple Music as the source of truth.');
  }
  if (!TARGETS.has(targetPlatform)) {
    throw new Error('Mirror sync currently supports QQ Music or NetEase Cloud Music targets.');
  }

  const thresholds = {
    match: normalizeThreshold(input.threshold ?? input.matchThreshold, DEFAULT_MATCH_THRESHOLD),
    review: normalizeThreshold(input.reviewThreshold, DEFAULT_REVIEW_THRESHOLD),
  };
  if (thresholds.review > thresholds.match) {
    throw new Error('Review threshold must be less than or equal to match threshold.');
  }

  const sourceTracks = shareArtistAliases(snapshotTracks(input.sourceSnapshot));
  const targetTracks = shareArtistAliases(snapshotTracks(input.targetSnapshot));
  const comparisonThresholds = {
    threshold: thresholds.match,
    reviewThreshold: thresholds.review,
    allowAmbiguousFingerprint: true,
  };
  const sourceComparison = compareAppleToPlatform(sourceTracks, targetTracks, comparisonThresholds);
  const sourceIndex = indexByRef(sourceTracks);
  const targetIndex = indexByRef(targetTracks);
  const sourceLookup = buildSourceLookup(sourceTracks);
  const sourceReviews = new Map();
  const targetReviews = new Map();
  const matchedByTarget = new Map();

  for (const item of sourceComparison.matches) {
    const source = sourceIndex.get(item.apple);
    const target = targetIndex.get(item.target);
    if (source === undefined || target === undefined) continue;
    const entries = matchedByTarget.get(target) || [];
    entries.push({ source, target, score: item.score });
    matchedByTarget.set(target, entries);
  }

  for (const item of sourceComparison.reviewItems) {
    const source = sourceIndex.get(item.apple);
    const target = targetIndex.get(item.target);
    if (source === undefined) continue;
    sourceReviews.set(source, {
      source,
      target,
      score: item.score,
      reason: 'source_uncertain_match',
    });
    if (target !== undefined) targetReviews.set(target, sourceReviews.get(source));
  }

  const operations = [];
  const keptSources = new Set();
  const coveredTargets = new Set();

  for (const [target, entries] of matchedByTarget.entries()) {
    if (entries.length === 1 || entriesRepresentSameSourceSong(entries, sourceTracks)) {
      coveredTargets.add(target);
      for (const entry of entries) {
        keptSources.add(entry.source);
        operations.push(makeOperation('keep', {
          source: sourceTracks[entry.source],
          target: targetTracks[target],
          score: entry.score,
          reason: 'matched',
        }));
      }
      continue;
    }

    coveredTargets.add(target);
    for (const entry of entries) {
      keptSources.add(entry.source);
      operations.push(makeOperation('review', {
        source: sourceTracks[entry.source],
        target: targetTracks[target],
        score: entry.score,
        reason: 'duplicate_target_match',
        message: 'Multiple Apple source tracks map to the same target track.',
      }));
    }
  }

  for (let index = 0; index < sourceTracks.length; index += 1) {
    if (keptSources.has(index)) continue;
    const review = sourceReviews.get(index);
    if (review) {
      coveredTargets.add(review.target);
      operations.push(makeOperation('review', {
        source: sourceTracks[index],
        target: targetTracks[review.target],
        score: review.score,
        reason: review.reason,
        message: 'The target may already contain this Apple track, but the match is below the automatic threshold.',
      }));
      continue;
    }

    const missing = sourceComparison.missingItems.find((item) => item.apple === sourceTracks[index]);
    operations.push(makeOperation('add', {
      source: sourceTracks[index],
      target: null,
      candidate: missing?.best?.target || null,
      score: missing?.best?.score || null,
      reason: 'missing_in_target',
    }));
  }

  for (let index = 0; index < targetTracks.length; index += 1) {
    if (coveredTargets.has(index)) continue;
    if (targetReviews.has(index)) continue;

    if (maybeRelatedToSource(targetTracks[index], sourceLookup)) {
      const reverse = compareAppleToPlatform([targetTracks[index]], sourceTracks, comparisonThresholds);
      const reverseMatch = reverse.matches[0];
      if (reverseMatch) {
        const reverseSource = sourceIndex.get(reverseMatch.target);
        const possibleDuplicate = reverseSource !== undefined && keptSources.has(reverseSource);
        if (possibleDuplicate) {
          operations.push(makeOperation('remove', {
            source: reverseMatch.target,
            target: targetTracks[index],
            score: reverseMatch.score,
            reason: 'duplicate_target_extra',
            message: 'A stronger target match already represents this Apple source track; remove this extra target entry.',
          }));
          continue;
        }
        operations.push(makeOperation('review', {
          source: reverseMatch.target,
          target: targetTracks[index],
          score: reverseMatch.score,
          reason: 'reverse_only_match',
          reviewKind: possibleDuplicate ? 'possible_duplicate_target' : '',
          message: possibleDuplicate
            ? 'Another target track already represents this Apple source track; this extra target entry may be a duplicate.'
            : 'The target track resembles Apple source data but was not selected by the forward match pass.',
        }));
        continue;
      }

      const reverseReview = reverse.reviewItems[0];
      if (reverseReview) {
        const reverseSource = sourceIndex.get(reverseReview.target);
        const possibleDuplicate = reverseSource !== undefined && keptSources.has(reverseSource);
        operations.push(makeOperation('review', {
          source: reverseReview.target,
          target: targetTracks[index],
          score: reverseReview.score,
          reason: 'target_uncertain_orphan',
          reviewKind: possibleDuplicate ? 'possible_duplicate_target' : '',
          message: possibleDuplicate
            ? 'Another target track already represents this Apple source track; this extra target entry may be a duplicate.'
            : 'The target-only track is similar to Apple source data, so deletion needs review.',
        }));
        continue;
      }
    }

    operations.push(makeOperation('remove', {
      source: null,
      target: targetTracks[index],
      score: null,
      reason: 'not_in_source',
    }));
  }

  const decidedOperations = applyMirrorReviewDecisions(operations, input.reviewDecisions || input.mirrorDecisions);

  decidedOperations.sort(compareOperations);
  decidedOperations.forEach((operation, index) => {
    operation.id = `mirror-${String(index + 1).padStart(5, '0')}`;
  });

  return {
    version: 1,
    mode: 'source_of_truth_mirror',
    generatedAt: input.generatedAt || new Date().toISOString(),
    source: {
      platform: sourcePlatform,
      source: input.sourceSnapshot?.source || '',
      fetchedAt: input.sourceSnapshot?.fetchedAt || '',
      playlistId: input.sourceSnapshot?.playlistId || null,
      userId: input.sourceSnapshot?.userId || null,
      count: sourceTracks.length,
    },
    target: {
      platform: targetPlatform,
      source: input.targetSnapshot?.source || '',
      fetchedAt: input.targetSnapshot?.fetchedAt || '',
      playlistId: input.targetSnapshot?.playlistId || null,
      userId: input.targetSnapshot?.userId || null,
      count: targetTracks.length,
    },
    thresholds,
    summary: summarizeMirrorOperations(decidedOperations),
    operations: decidedOperations,
  };
}

function entriesRepresentSameSourceSong(entries, sourceTracks) {
  if (entries.length < 2) return false;
  const isrcs = entries.map((entry) => sourceTracks[entry.source]?.isrc).filter(Boolean);
  if (isrcs.length !== entries.length) return false;
  if (new Set(isrcs).size === 1) return true;

  const anchor = sourceTracks[entries[0].source];
  return entries.slice(1).every((entry) => {
    const candidate = sourceTracks[entry.source];
    const comparison = compareAppleToPlatform(
      [{ ...anchor, isrc: null }],
      [{ ...candidate, isrc: null }],
      { threshold: 0.82, reviewThreshold: 0.68, allowAmbiguousFingerprint: true },
    );
    const score = comparison.matches[0]?.score
      || comparison.reviewItems[0]?.score
      || comparison.missingItems[0]?.best?.score;
    return Boolean(
      score
      && score.title === 1
      && score.artist >= 0.8
      && score.duration === 1
      && !score.versionCueConflict
    );
  });
}

export function summarizeMirrorOperations(operations = []) {
  const summary = {
    total: operations.length,
    keep: 0,
    add: 0,
    remove: 0,
    review: 0,
    destructive: 0,
    ready: 0,
    blocked: 0,
  };
  for (const operation of operations) {
    const action = operation.action || 'review';
    summary[action] = (summary[action] || 0) + 1;
    if (operation.destructive) summary.destructive += 1;
    if (operation.status === 'ready') summary.ready += 1;
    if (operation.status !== 'ready') summary.blocked += 1;
  }
  return summary;
}

function shareArtistAliases(tracks) {
  const aliasesByArtist = new Map();
  for (const track of tracks) {
    const key = normalizeText(track.artist);
    if (!key) continue;
    const explicitAliases = [
      ...(track.aliases?.artists || []),
      ...(track.artists || []).filter((artist) => normalizeText(artist) !== key),
    ].filter(Boolean);
    if (!explicitAliases.length) continue;
    const aliases = aliasesByArtist.get(key) || [];
    aliasesByArtist.set(key, uniqueText([...aliases, ...explicitAliases]));
  }

  if (!aliasesByArtist.size) return tracks;
  return tracks.map((track) => {
    const key = normalizeText(track.artist);
    const sharedAliases = aliasesByArtist.get(key) || [];
    if (!sharedAliases.length) return track;
    const artists = uniqueText([...(track.aliases?.artists || []), ...sharedAliases]);
    const normalizedArtists = uniqueText([
      ...(track.normalized?.aliases?.artists || []),
      ...artists.map((artist) => normalizeText(artist)),
    ]);
    return {
      ...track,
      aliases: {
        ...(track.aliases || {}),
        artists,
      },
      normalized: {
        ...(track.normalized || {}),
        aliases: {
          ...(track.normalized?.aliases || {}),
          artists: normalizedArtists,
        },
      },
    };
  });
}

function uniqueText(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || '').trim();
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function summarizeMirrorConvergence(plan, options = {}) {
  const summary = plan?.summary || summarizeMirrorOperations(plan?.operations || []);
  const add = summary.add || 0;
  const remove = summary.remove || 0;
  const review = summary.review || 0;
  const unresolvedAdds = summary.unresolvedAdds || 0;
  const converged = add === 0 && remove === 0 && review === 0;
  return {
    checkedAt: options.checkedAt || new Date().toISOString(),
    status: converged ? 'converged' : 'open_delta',
    converged,
    refreshedTarget: Boolean(options.refreshedTarget),
    previousPlanGeneratedAt: options.previousPlan?.generatedAt || options.previousPlanGeneratedAt || '',
    planGeneratedAt: plan?.generatedAt || '',
    target: plan?.target?.platform || '',
    sourceFetchedAt: plan?.source?.fetchedAt || '',
    targetFetchedAt: plan?.target?.fetchedAt || '',
    add,
    remove,
    review,
    unresolvedAdds,
    blocked: summary.blocked || 0,
    destructive: summary.destructive || 0,
    message: converged
      ? 'No add, remove, or review operations remain in the regenerated mirror plan.'
      : `Mirror plan still has add=${add}, remove=${remove}, review=${review}.`,
  };
}

function makeOperation(action, input) {
  const destructive = action === 'remove';
  const operation = {
    id: '',
    action,
    status: operationStatus(action, input),
    destructive,
    reason: input.reason,
    reviewKind: input.reviewKind || '',
    message: input.message || defaultMessage(action, input.reason),
    confidence: confidenceLabel(action, input.score),
    score: input.score || null,
    sourceTrack: compactMirrorTrack(input.source),
    targetTrack: compactMirrorTrack(input.target),
    candidateTrack: compactMirrorTrack(input.candidate),
  };
  operation.decisionKey = mirrorReviewDecisionKey(operation);
  return operation;
}

export function applyMirrorReviewDecisions(operations = [], decisionState = {}) {
  const decisions = decisionState?.items || decisionState || {};
  const result = [];
  for (const operation of operations) {
    if (operation.action !== 'review') {
      const key = operation.decisionKey || mirrorReviewDecisionKey(operation);
      const decision = decisions[key];
      const action = normalizeMirrorReviewDecisionAction(decision?.action);
      if (operation.action === 'keep' && action === 'keep') {
        result.push({
          ...operation,
          decisionKey: key,
          manualDecision: compactManualDecision(operation, {
            ...decision,
            key,
            action,
          }),
        });
      } else {
        result.push(operation);
      }
      continue;
    }

    const key = operation.decisionKey || mirrorReviewDecisionKey(operation);
    const decision = decisions[key];
    const action = normalizeMirrorReviewDecisionAction(decision?.action);
    if (!action) {
      result.push({
        ...operation,
        decisionKey: key,
      });
      continue;
    }

    result.push(...reviewDecisionOperations({
      ...operation,
      decisionKey: key,
    }, {
      ...decision,
      key,
      action,
    }));
  }
  return result;
}

export function mirrorReviewDecisionKey(operation = {}) {
  return [
    'review',
    operation.reason || '',
    compactDecisionTrackIdentity(operation.sourceTrack),
    compactDecisionTrackIdentity(operation.targetTrack || operation.candidateTrack),
  ].join('|');
}

export function normalizeMirrorReviewDecisionAction(action) {
  const value = String(action || '').trim().toLowerCase();
  return MIRROR_REVIEW_DECISION_ACTIONS.has(value) ? value : '';
}

function reviewDecisionOperations(operation, decision) {
  if (decision.action === 'keep') return [manualKeepOperation(operation, decision)];
  if (decision.action === 'separate') return manualSeparateOperations(operation, decision);
  return [operation];
}

function manualKeepOperation(operation, decision) {
  return {
    ...operation,
    action: 'keep',
    status: 'ready',
    destructive: false,
    reason: 'manual_keep',
    message: 'Manual review marked this target track as the Apple source match.',
    manualDecision: compactManualDecision(operation, decision),
  };
}

function manualSeparateOperations(operation, decision) {
  const operations = [];
  const addSource = Boolean(operation.sourceTrack) && SEPARATE_ADDS_SOURCE_REASONS.has(operation.reason);
  const removeTarget = Boolean(operation.targetTrack) && SEPARATE_REMOVES_TARGET_REASONS.has(operation.reason);
  const manualDecision = compactManualDecision(operation, decision);

  if (addSource) {
    operations.push({
      ...operation,
      action: 'add',
      status: 'needs_resolution',
      destructive: false,
      reason: 'manual_separate_add',
      message: 'Manual review marked the candidate as different; resolve this Apple track before adding it to the target.',
      targetTrack: null,
      candidateTrack: null,
      resolvedTargetTrack: null,
      resolvedScore: null,
      resolution: null,
      alternatives: [],
      manualDecision,
    });
  }

  if (removeTarget) {
    operations.push({
      ...operation,
      action: 'remove',
      status: 'ready',
      destructive: true,
      reason: 'manual_separate_remove',
      message: 'Manual review marked the target track as separate from Apple source; deletion still requires dry-run and explicit confirmation.',
      sourceTrack: null,
      candidateTrack: null,
      resolvedTargetTrack: null,
      resolvedScore: null,
      resolution: null,
      alternatives: [],
      manualDecision,
    });
  }

  return operations.length ? operations : [{
    ...operation,
    manualDecision: {
      ...manualDecision,
      ignored: true,
    },
  }];
}

function compactManualDecision(operation, decision) {
  return {
    key: decision.key || operation.decisionKey || mirrorReviewDecisionKey(operation),
    action: decision.action || '',
    decidedAt: decision.decidedAt || decision.updatedAt || '',
    note: decision.note || '',
    originalAction: operation.action || 'review',
    originalReason: operation.reason || '',
    source: decision.source || 'manual',
    aiBatchId: decision.aiBatchId || '',
    aiModel: decision.aiModel || '',
    aiConfidence: Number.isFinite(Number(decision.aiConfidence)) ? Number(decision.aiConfidence) : null,
    userApprovedAt: decision.userApprovedAt || '',
    approvalBatchId: decision.approvalBatchId || '',
  };
}

function operationStatus(action, input) {
  if (action === 'review') return 'needs_review';
  if (action === 'add' && !input.target) return 'needs_resolution';
  return 'ready';
}

function defaultMessage(action, reason) {
  if (action === 'keep') return 'The target already has a confident match for this Apple source track.';
  if (action === 'add') return 'Apple source contains this track and the target does not.';
  if (action === 'remove') return 'The target contains this track but Apple source does not.';
  return reason || 'This track needs manual review before syncing.';
}

function confidenceLabel(action, score) {
  if (action === 'add' || action === 'remove') return 'source-of-truth';
  const value = Number(score?.total || 0);
  if (value >= DEFAULT_MATCH_THRESHOLD) return 'high';
  if (value > 0) return 'review';
  return 'none';
}

function compareOperations(left, right) {
  const actionOrder = { review: 0, remove: 1, add: 2, keep: 3 };
  const actionDiff = (actionOrder[left.action] ?? 9) - (actionOrder[right.action] ?? 9);
  if (actionDiff) return actionDiff;
  return operationLabel(left).localeCompare(operationLabel(right), 'zh-Hans-CN');
}

function operationLabel(operation) {
  const track = operation.sourceTrack || operation.targetTrack || {};
  return normalizeText(`${track.title || ''} ${track.artist || ''} ${track.album || ''}`);
}

function compactMirrorTrack(track) {
  if (!track) return null;
  return {
    platform: track.platform || '',
    id: track.id || null,
    mid: track.mid || null,
    title: track.title || '',
    artist: track.artist || '',
    artists: Array.isArray(track.artists) ? track.artists : [],
    album: track.album || '',
    duration: durationLabel(track.durationMs),
    durationMs: track.durationMs || null,
    isrc: track.isrc || null,
    songType: track.songType ?? null,
    artworkUrl: trackArtworkUrl(track),
    previewUrl: track.platform === 'apple' ? trackPreviewUrl(track) : '',
    aliases: compactAliases(track.aliases),
    metadata: compactMirrorMetadata(track.metadata),
  };
}

function compactAliases(aliases = {}) {
  const result = {};
  for (const key of ['titles', 'artists', 'albums']) {
    const values = Array.isArray(aliases?.[key]) ? aliases[key].filter(Boolean) : [];
    if (values.length) result[key] = values.slice(0, 8);
  }
  return Object.keys(result).length ? result : null;
}

function compactMirrorMetadata(metadata = {}) {
  const musicbrainz = metadata?.musicbrainz;
  const appleStorefronts = metadata?.appleStorefronts;
  const crossPlatformAliases = metadata?.crossPlatformAliases;
  const providerCatalog = metadata?.providerCatalog;
  if (!musicbrainz && !appleStorefronts && !crossPlatformAliases && !providerCatalog) return null;
  const result = {};
  if (musicbrainz) {
    result.musicbrainz = {
      isrc: musicbrainz.isrc || null,
      fetchedAt: musicbrainz.fetchedAt || null,
      status: musicbrainz.status || 'missing',
      recordingIds: Array.isArray(musicbrainz.recordingIds)
        ? musicbrainz.recordingIds.filter(Boolean).slice(0, 8)
        : [],
    };
  }
  if (appleStorefronts) {
    result.appleStorefronts = {
      sourceStorefront: appleStorefronts.sourceStorefront || '',
      storefronts: Array.isArray(appleStorefronts.storefronts)
        ? appleStorefronts.storefronts.filter(Boolean).slice(0, 12)
        : [],
      fetchedAt: appleStorefronts.fetchedAt || null,
      equivalentCount: Number(appleStorefronts.equivalentCount || 0),
      isrcs: Array.isArray(appleStorefronts.isrcs)
        ? appleStorefronts.isrcs.filter(Boolean).slice(0, 12)
        : [],
      equivalents: Array.isArray(appleStorefronts.equivalents)
        ? appleStorefronts.equivalents.slice(0, 24).map(compactAppleEquivalent)
        : [],
    };
  }
  if (crossPlatformAliases) {
    result.crossPlatformAliases = {
      platforms: Array.isArray(crossPlatformAliases.platforms)
        ? crossPlatformAliases.platforms.filter(Boolean).slice(0, 4)
        : [],
      count: Number(crossPlatformAliases.count || 0),
    };
  }
  if (providerCatalog) {
    result.providerCatalog = compactProviderCatalog(providerCatalog);
  }
  return result;
}

function compactAppleEquivalent(value = {}) {
  return {
    storefront: value.storefront || '',
    id: value.id || '',
    title: value.title || '',
    artist: value.artist || '',
    album: value.album || '',
    durationMs: Number(value.durationMs || 0),
    isrc: value.isrc || '',
    trackNumber: Number(value.trackNumber || 0),
    discNumber: Number(value.discNumber || 0),
    releaseDate: value.releaseDate || '',
    isrcMatch: value.isrcMatch === true,
    aliasTrusted: value.aliasTrusted === true,
  };
}

function compactProviderCatalog(value = {}) {
  return {
    platform: value.platform || '',
    trackNumber: Number(value.trackNumber || 0),
    discNumber: Number(value.discNumber || 0),
    albumId: value.albumId || '',
    albumMid: value.albumMid || '',
    subtitle: value.subtitle || '',
    releaseDate: value.releaseDate || '',
  };
}

function compactDecisionTrackIdentity(track) {
  if (!track) return 'none';
  const platform = track.platform || '';
  const providerId = track.id || track.mid || track.isrc || '';
  const fallback = normalizeText([
    track.title || '',
    track.artist || '',
    track.album || '',
    track.durationMs || track.duration || '',
  ].join(' '));
  return [
    platform,
    providerId,
    fallback,
  ].join(':');
}

function snapshotTracks(snapshot) {
  if (!snapshot || snapshot.skipped) return [];
  return Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
}

function indexByRef(items) {
  const map = new Map();
  items.forEach((item, index) => map.set(item, index));
  return map;
}

function buildSourceLookup(sourceTracks) {
  const titles = new Set();
  const titleArtistKeys = new Set();
  const titleValues = [];
  for (const track of sourceTracks) {
    const title = normalizeText(track.normalized?.title || track.title || '');
    const artist = normalizeText(track.normalized?.artist || track.artist || '');
    if (title) {
      titles.add(title);
      titleValues.push(title);
      if (artist) titleArtistKeys.add(`${title}::${artist}`);
    }
    for (const alias of track.normalized?.aliases?.titles || []) {
      const value = normalizeText(alias);
      if (!value) continue;
      titles.add(value);
      titleValues.push(value);
      if (artist) titleArtistKeys.add(`${value}::${artist}`);
    }
  }
  return { titles, titleArtistKeys, titleValues: [...new Set(titleValues)] };
}

function maybeRelatedToSource(target, lookup) {
  const title = normalizeText(target.normalized?.title || target.title || '');
  if (!title) return false;
  const artist = normalizeText(target.normalized?.artist || target.artist || '');
  if (lookup.titleArtistKeys.has(`${title}::${artist}`)) return true;
  if (lookup.titles.has(title)) return true;
  if (title.length < 5) return false;
  return lookup.titleValues.some((sourceTitle) => (
    sourceTitle.length >= 5 && (sourceTitle.includes(title) || title.includes(sourceTitle))
  ));
}

function normalizeThreshold(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}
