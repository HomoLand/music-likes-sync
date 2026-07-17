import { buildMirrorSyncPlan, summarizeMirrorOperations } from './mirror-sync.js';
import { normalizeText } from './normalize.js';
import { buildUnifiedLibrary } from './unified.js';

export const SYNC_POLICY_SCHEMA_VERSION = 1;
export const SYNC_BASELINE_SCHEMA_VERSION = 1;
export const SYNC_TOMBSTONE_SCHEMA_VERSION = 1;

export const SYNC_POLICIES = new Set([
  'canonical_mirror',
  'union_convergence',
  'managed_bidirectional',
  'read_only_analysis',
]);

export const SYNC_PLATFORMS = ['apple', 'qq', 'netease'];
export const WRITABLE_SYNC_PLATFORMS = ['qq', 'netease'];
export const TOMBSTONE_ACTIONS = new Set([
  'confirm_global_delete',
  'ignore',
  'restore',
  'current_platform_only',
]);

const DEFAULT_THRESHOLDS = {
  match: 0.82,
  review: 0.68,
};

export function listSyncPolicies() {
  return [
    {
      id: 'canonical_mirror',
      label: 'Canonical mirror',
      destructive: true,
      writes: true,
      description: 'One trusted source updates one or more targets. Apple canonical mirror is the current implementation path.',
    },
    {
      id: 'union_convergence',
      label: 'Union convergence',
      destructive: false,
      writes: true,
      description: 'Liked tracks from every participating platform form a unified set; missing tracks are added to peers.',
    },
    {
      id: 'managed_bidirectional',
      label: 'Managed bidirectional',
      destructive: true,
      writes: true,
      description: 'Additions and deletions are detected against a saved baseline; deletions require tombstone confirmation.',
    },
    {
      id: 'read_only_analysis',
      label: 'Read-only analysis',
      destructive: false,
      writes: false,
      description: 'Build evidence, gaps, profiles, and recommendations without creating write operations.',
    },
  ];
}

export function buildSyncPolicyPlan(input = {}) {
  const policy = normalizePolicy(input.policy || 'canonical_mirror');
  const snapshots = normalizeSnapshotMap(input.snapshots || {});
  const participants = normalizePlatforms(input.platforms || input.participants || activeSnapshotPlatforms(snapshots));
  const thresholds = normalizeThresholds(input);
  const generatedAt = input.generatedAt || new Date().toISOString();
  const baseline = input.baseline || null;
  const tombstones = normalizeTombstoneState(input.tombstones);

  if (policy === 'canonical_mirror') {
    return buildCanonicalMirrorPlan({
      generatedAt,
      snapshots,
      source: input.source || 'apple',
      targets: input.targets || participants.filter((platform) => platform !== (input.source || 'apple')),
      thresholds,
      reviewDecisions: input.reviewDecisions,
    });
  }

  const unified = buildUnifiedForParticipants(snapshots, participants, thresholds);
  const baselineDiff = baseline ? diffSnapshotsAgainstBaseline(snapshots, baseline, { platforms: participants }) : emptyBaselineDiff('missing_baseline');
  const common = {
    version: SYNC_POLICY_SCHEMA_VERSION,
    mode: 'policy_sync',
    policy,
    generatedAt,
    participants,
    thresholds,
    baseline: summarizeBaselineRef(baseline),
    baselineDiff,
    tombstones: summarizeTombstones(tombstones),
    unified: summarizeUnified(unified),
  };

  if (policy === 'read_only_analysis') {
    const operations = buildReadOnlyOperations(unified, participants, baselineDiff);
    return finishPolicyPlan({ ...common, operations });
  }

  if (policy === 'union_convergence') {
    const operations = buildUnionOperations(unified, participants);
    return finishPolicyPlan({ ...common, operations });
  }

  if (policy === 'managed_bidirectional') {
    if (baselineDiff.status !== 'ready') {
      const operations = blockOperations(buildUnionOperations(unified, participants), 'missing_baseline');
      return finishPolicyPlan({
        ...common,
        status: 'blocked_missing_baseline',
        warnings: ['missing_baseline'],
        operations,
      });
    }
    const unionOperations = suppressConfirmedGlobalDeleteAdds(
      buildUnionOperations(unified, participants),
      baselineDiff,
      tombstones,
    );
    const operations = [
      ...unionOperations,
      ...buildDeletionOperations({
        baselineDiff,
        snapshots,
        tombstones,
        participants,
      }),
    ];
    return finishPolicyPlan({ ...common, operations });
  }

  throw new Error(`Unsupported sync policy: ${policy}`);
}

export function buildSyncBaseline(input = {}) {
  const snapshots = normalizeSnapshotMap(input.snapshots || {});
  const platforms = normalizePlatforms(input.platforms || activeSnapshotPlatforms(snapshots));
  const savedAt = input.savedAt || new Date().toISOString();
  const result = {
    version: SYNC_BASELINE_SCHEMA_VERSION,
    savedAt,
    source: input.source || 'manual',
    policy: normalizePolicy(input.policy || 'union_convergence'),
    platforms: {},
    summary: {
      platforms: platforms.length,
      tracks: 0,
    },
  };

  for (const platform of platforms) {
    const snapshot = snapshots[platform];
    const tracks = snapshotTracks(snapshot).map((track) => baselineTrack(platform, track));
    result.platforms[platform] = {
      platform,
      source: snapshot?.source || '',
      fetchedAt: snapshot?.fetchedAt || '',
      playlistId: snapshot?.playlistId || null,
      userId: snapshot?.userId || null,
      count: tracks.length,
      tracks,
    };
    result.summary.tracks += tracks.length;
  }

  return result;
}

export function diffSnapshotsAgainstBaseline(snapshotsInput = {}, baseline = {}, options = {}) {
  const snapshots = normalizeSnapshotMap(snapshotsInput);
  const platforms = normalizePlatforms(options.platforms || Object.keys(baseline?.platforms || {}));
  const result = {
    status: baseline?.version === SYNC_BASELINE_SCHEMA_VERSION ? 'ready' : 'missing_baseline',
    baselineSavedAt: baseline?.savedAt || '',
    platforms: {},
    summary: {
      added: 0,
      deleted: 0,
      unchanged: 0,
    },
  };

  if (result.status !== 'ready') return result;

  for (const platform of platforms) {
    const baselineTracks = Array.isArray(baseline.platforms?.[platform]?.tracks)
      ? baseline.platforms[platform].tracks
      : [];
    const currentTracks = snapshotTracks(snapshots[platform]).map((track) => baselineTrack(platform, track));
    const baselineTokenIndex = indexByTokens(baselineTracks);
    const currentTokenIndex = indexByTokens(currentTracks);

    const added = currentTracks.filter((track) => !hasAnyToken(baselineTokenIndex, track.tokens));
    const deleted = baselineTracks.filter((track) => !hasAnyToken(currentTokenIndex, track.tokens));
    const unchanged = currentTracks.length - added.length;

    result.platforms[platform] = {
      platform,
      added,
      deleted: deleted.map((track) => ({
        ...track,
        tombstoneKey: tombstoneKey(platform, track),
      })),
      unchanged: Math.max(0, unchanged),
    };
    result.summary.added += added.length;
    result.summary.deleted += deleted.length;
    result.summary.unchanged += Math.max(0, unchanged);
  }

  return result;
}

export function normalizeTombstoneState(state = {}) {
  return {
    version: SYNC_TOMBSTONE_SCHEMA_VERSION,
    updatedAt: state?.updatedAt || '',
    items: state?.items && typeof state.items === 'object' && !Array.isArray(state.items)
      ? state.items
      : {},
  };
}

export function upsertTombstoneDecision(state = {}, input = {}) {
  const key = String(input.key || '').trim();
  if (!key) throw new Error('Tombstone key is required.');
  const action = normalizeTombstoneAction(input.action);
  const now = input.updatedAt || new Date().toISOString();
  const current = normalizeTombstoneState(state);
  if (action === 'clear') {
    delete current.items[key];
  } else {
    current.items[key] = {
      key,
      action,
      platform: normalizePlatform(input.platform || current.items[key]?.platform || ''),
      track: compactPolicyTrack(input.track || current.items[key]?.track || {}),
      note: String(input.note || current.items[key]?.note || ''),
      decidedAt: input.decidedAt || current.items[key]?.decidedAt || now,
      updatedAt: now,
    };
  }
  current.updatedAt = now;
  return current;
}

function buildCanonicalMirrorPlan(input) {
  const source = normalizePlatform(input.source || 'apple');
  const targets = normalizePlatforms(input.targets || []);
  if (source !== 'apple') {
    throw new Error('canonical_mirror currently supports apple as the source through the existing mirror engine.');
  }
  const sourceSnapshot = input.snapshots[source];
  if (!sourceSnapshot) throw new Error('Missing canonical source snapshot.');

  const childPlans = [];
  const operations = [];
  for (const target of targets) {
    if (target === source) continue;
    if (!['qq', 'netease'].includes(target)) {
      throw new Error('canonical_mirror currently supports qq and netease targets.');
    }
    const targetSnapshot = input.snapshots[target];
    if (!targetSnapshot) throw new Error(`Missing ${target} target snapshot.`);
    const mirror = buildMirrorSyncPlan({
      generatedAt: input.generatedAt,
      sourceSnapshot,
      targetSnapshot,
      target,
      threshold: input.thresholds.match,
      reviewThreshold: input.thresholds.review,
      reviewDecisions: input.reviewDecisions,
    });
    childPlans.push({
      target,
      generatedAt: mirror.generatedAt,
      summary: mirror.summary,
    });
    for (const operation of mirror.operations) {
      operations.push(policyOperation(productCanonicalMirrorOperation({
        ...operation,
        policy: 'canonical_mirror',
        target,
        source,
        id: `sync-${target}-${operation.id}`,
        sourcePlatform: source,
        targetPlatform: target,
        sourceTrack: operation.sourceTrack,
        targetTrack: operation.targetTrack,
        candidateTrack: operation.candidateTrack,
      })));
    }
  }

  return finishPolicyPlan({
    version: SYNC_POLICY_SCHEMA_VERSION,
    mode: 'policy_sync',
    policy: 'canonical_mirror',
    generatedAt: input.generatedAt,
    participants: [source, ...targets.filter((target) => target !== source)],
    source: { platform: source },
    targets,
    thresholds: input.thresholds,
    childPlans,
    operations,
  });
}

function productCanonicalMirrorOperation(operation) {
  if (operation.action === 'remove' && !operation.targetTrack?.id) {
    return {
      ...operation,
      status: 'blocked',
      blockedReason: 'missing_destructive_target_id',
      message: operation.message || 'This target-only track cannot be removed until the provider exposes a destructive track id.',
    };
  }
  return operation;
}

function buildUnifiedForParticipants(snapshots, participants, thresholds) {
  const fullSnapshots = Object.fromEntries(
    SYNC_PLATFORMS.map((platform) => [platform, participants.includes(platform) ? snapshots[platform] : skippedSnapshot(platform)]),
  );
  return buildUnifiedLibrary(fullSnapshots, thresholds);
}

function buildUnionOperations(unified, participants) {
  const operations = [];
  for (const cluster of unified.clusters || []) {
    if (cluster.needsReview) {
      operations.push(policyOperation({
        action: 'review',
        status: 'needs_review',
        reason: 'cluster_needs_review',
        message: 'Cluster has version, duplicate, or conflict evidence that needs review before propagation.',
        sourceTrack: representativeClusterTrack(cluster),
        clusterId: cluster.id,
        platforms: cluster.platforms,
      }));
      continue;
    }

    for (const target of participants) {
      if (cluster.platforms.includes(target)) continue;
      operations.push(policyOperation({
        action: 'add',
        status: 'needs_resolution',
        reason: 'missing_from_union_target',
        message: 'This unified liked track is missing from a participating platform.',
        sourceTrack: representativeClusterTrack(cluster),
        targetPlatform: target,
        clusterId: cluster.id,
        platforms: cluster.platforms,
      }));
    }

    if (!cluster.needsReview && participants.every((platform) => cluster.platforms.includes(platform))) {
      operations.push(policyOperation({
        action: 'keep',
        status: 'ready',
        reason: 'present_on_all_participants',
        message: 'The unified liked track is present on every participating platform.',
        sourceTrack: representativeClusterTrack(cluster),
        clusterId: cluster.id,
        platforms: cluster.platforms,
      }));
    }
  }

  for (const candidate of unified.reviewCandidates || []) {
    operations.push(policyOperation({
      action: 'review',
      status: 'needs_review',
      reason: 'low_confidence_cross_platform_match',
      message: 'A low-confidence cross-platform candidate needs AI or manual review.',
      sourceTrack: candidate.source?.track || null,
      targetTrack: candidate.target?.track || null,
      sourcePlatform: candidate.source?.platform || '',
      targetPlatform: candidate.target?.platform || '',
      score: candidate.score || null,
      clusterId: candidate.sourceCluster || '',
      relatedClusterId: candidate.targetCluster || '',
    }));
  }
  return assignOperationIds(operations);
}

function suppressConfirmedGlobalDeleteAdds(operations, baselineDiff, tombstones) {
  const confirmedTokenSets = [];
  for (const diff of Object.values(baselineDiff.platforms || {})) {
    for (const deleted of diff.deleted || []) {
      if (tombstones.items?.[deleted.tombstoneKey]?.action === 'confirm_global_delete') {
        confirmedTokenSets.push(new Set(deleted.tokens || []));
      }
    }
  }
  if (!confirmedTokenSets.length) return operations;

  return operations.filter((operation) => {
    if (operation.action !== 'add' || !operation.sourceTrack) return true;
    const platform = normalizePlatform(operation.sourceTrack.platform || operation.sourcePlatform || '');
    const tokens = trackTokens(platform, operation.sourceTrack);
    return !confirmedTokenSets.some((confirmedTokens) => (
      tokens.some((token) => confirmedTokens.has(token))
    ));
  });
}

function buildReadOnlyOperations(unified, participants, baselineDiff) {
  const operations = buildUnionOperations(unified, participants)
    .map((operation) => ({
      ...operation,
      status: operation.action === 'add' || operation.action === 'remove' ? 'blocked' : operation.status,
      blockedReason: operation.action === 'add' || operation.action === 'remove' ? 'read_only_policy' : operation.blockedReason || '',
    }));
  for (const platform of Object.keys(baselineDiff.platforms || {})) {
    for (const deleted of baselineDiff.platforms[platform].deleted || []) {
      operations.push(policyOperation({
        action: 'review',
        status: 'needs_review',
        reason: 'read_only_baseline_delete_signal',
        message: 'A baseline deletion signal was detected but read-only analysis does not create write operations.',
        sourceTrack: deleted.track,
        sourcePlatform: platform,
        tombstoneKey: deleted.tombstoneKey,
      }));
    }
  }
  return assignOperationIds(operations);
}

function buildDeletionOperations({
  baselineDiff,
  snapshots,
  tombstones,
  participants = SYNC_PLATFORMS,
}) {
  const operations = [];
  for (const [platform, diff] of Object.entries(baselineDiff.platforms || {})) {
    for (const deleted of diff.deleted || []) {
      const decision = tombstones.items?.[deleted.tombstoneKey];
      if (decision?.action === 'ignore' || decision?.action === 'current_platform_only') continue;

      if (decision?.action === 'confirm_global_delete') {
        const currentMatches = findCurrentTracksByTokens(snapshots, deleted.tokens, participants);
        if (!currentMatches.length) {
          operations.push(policyOperation({
            action: 'keep',
            status: 'ready',
            reason: 'confirmed_delete_already_absent',
            message: 'The confirmed global delete is already absent from all participating snapshots.',
            sourceTrack: deleted.track,
            tombstoneKey: deleted.tombstoneKey,
          }));
          continue;
        }
        for (const match of currentMatches) {
          if (!WRITABLE_SYNC_PLATFORMS.includes(match.platform)) {
            operations.push(policyOperation({
              action: 'review',
              status: 'blocked',
              destructive: true,
              reason: 'readonly_delete_target',
              message: 'The confirmed delete still exists on a read-only participant and cannot be removed by this product.',
              sourceTrack: deleted.track,
              targetTrack: compactPolicyTrack(match.track),
              sourcePlatform: platform,
              targetPlatform: match.platform,
              tombstoneKey: deleted.tombstoneKey,
            }));
            continue;
          }
          operations.push(policyOperation({
            action: 'remove',
            status: match.track?.id ? 'ready' : 'blocked',
            blockedReason: match.track?.id ? '' : 'missing_destructive_target_id',
            destructive: true,
            reason: 'confirmed_global_tombstone',
            message: 'User confirmed this baseline deletion should propagate globally.',
            sourceTrack: deleted.track,
            targetTrack: compactPolicyTrack(match.track),
            sourcePlatform: platform,
            targetPlatform: match.platform,
            tombstoneKey: deleted.tombstoneKey,
          }));
        }
        continue;
      }

      if (decision?.action === 'restore') {
        operations.push(policyOperation({
          action: 'add',
          status: 'needs_resolution',
          reason: 'restore_deleted_baseline_track',
          message: 'User chose to restore this deleted baseline track to the platform where it disappeared.',
          sourceTrack: deleted.track,
          targetPlatform: platform,
          tombstoneKey: deleted.tombstoneKey,
        }));
        continue;
      }

      operations.push(policyOperation({
        action: 'review',
        status: 'needs_review',
        destructive: true,
        reason: 'tombstone_candidate',
        message: 'A platform deletion was detected against baseline; decide whether it should propagate.',
        sourceTrack: deleted.track,
        sourcePlatform: platform,
        tombstoneKey: deleted.tombstoneKey,
      }));
    }
  }
  return assignOperationIds(operations);
}

function finishPolicyPlan(plan) {
  const operations = assignOperationIds(plan.operations || []);
  const summary = summarizePolicyOperations(operations);
  if (plan.baselineDiff?.summary) {
    summary.baselineAdded = plan.baselineDiff.summary.added || 0;
    summary.baselineDeleted = plan.baselineDiff.summary.deleted || 0;
  }
  return {
    ...plan,
    operations,
    summary,
  };
}

export function summarizePolicyOperations(operations = []) {
  const summary = {
    total: operations.length,
    keep: 0,
    add: 0,
    remove: 0,
    review: 0,
    destructive: 0,
    ready: 0,
    blocked: 0,
    baselineAdded: 0,
    baselineDeleted: 0,
    tombstoneCandidates: 0,
  };
  for (const operation of operations) {
    const action = operation.action || 'review';
    if (Object.prototype.hasOwnProperty.call(summary, action)) summary[action] += 1;
    if (operation.destructive) summary.destructive += 1;
    if (operation.status === 'ready') summary.ready += 1;
    else summary.blocked += 1;
    if (operation.reason === 'tombstone_candidate') summary.tombstoneCandidates += 1;
  }
  return summary;
}

function policyOperation(input) {
  return {
    id: input.id || '',
    decisionKey: input.decisionKey || '',
    action: input.action,
    status: input.status,
    destructive: Boolean(input.destructive || input.action === 'remove'),
    reason: input.reason || '',
    message: input.message || '',
    policy: input.policy || '',
    sourcePlatform: input.sourcePlatform || input.source || input.sourceTrack?.platform || '',
    targetPlatform: input.targetPlatform || input.target || input.targetTrack?.platform || '',
    clusterId: input.clusterId || '',
    relatedClusterId: input.relatedClusterId || '',
    tombstoneKey: input.tombstoneKey || '',
    score: input.score || null,
    platforms: Array.isArray(input.platforms) ? input.platforms : [],
    sourceTrack: compactPolicyTrack(input.sourceTrack),
    targetTrack: compactPolicyTrack(input.targetTrack),
    candidateTrack: compactPolicyTrack(input.candidateTrack),
    resolvedTargetTrack: compactPolicyTrack(input.resolvedTargetTrack),
    blockedReason: input.blockedReason || '',
    manualDecision: input.manualDecision ? {
      key: input.manualDecision.key || input.decisionKey || '',
      action: input.manualDecision.action || '',
      decidedAt: input.manualDecision.decidedAt || '',
      note: input.manualDecision.note || '',
      originalAction: input.manualDecision.originalAction || '',
      originalReason: input.manualDecision.originalReason || '',
      ignored: Boolean(input.manualDecision.ignored),
      source: input.manualDecision.source || 'manual',
      aiBatchId: input.manualDecision.aiBatchId || '',
      aiModel: input.manualDecision.aiModel || '',
      aiConfidence: input.manualDecision.aiConfidence ?? null,
      userApprovedAt: input.manualDecision.userApprovedAt || '',
      approvalBatchId: input.manualDecision.approvalBatchId || '',
    } : null,
  };
}

function assignOperationIds(operations) {
  const bases = operations.map((operation, index) => operation.id || `sync-${String(index + 1).padStart(5, '0')}`);
  const counts = bases.reduce((map, id) => {
    map.set(id, (map.get(id) || 0) + 1);
    return map;
  }, new Map());
  const used = new Set();
  return operations.map((operation, index) => {
    const base = bases[index];
    let id = base;
    if (counts.get(base) > 1 || used.has(id)) {
      const suffix = [
        operation.action,
        operation.targetPlatform || operation.sourcePlatform,
      ].filter(Boolean).join('-') || String(index + 1);
      id = `${base}-${suffix}`;
      let counter = 2;
      while (used.has(id)) {
        id = `${base}-${suffix}-${counter}`;
        counter += 1;
      }
    }
    used.add(id);
    return {
      ...operation,
      id,
    };
  });
}

function blockOperations(operations, blockedReason) {
  return operations.map((operation) => ({
    ...operation,
    status: 'blocked',
    blockedReason,
  }));
}

function representativeClusterTrack(cluster) {
  const preferredPlatform = SYNC_PLATFORMS.find((platform) => cluster.sources?.[platform]?.length);
  return preferredPlatform ? { ...cluster.sources[preferredPlatform][0], platform: preferredPlatform } : null;
}

function summarizeUnified(unified) {
  return {
    generatedAt: unified.generatedAt || '',
    sourceCounts: unified.sourceCounts || {},
    summary: unified.summary || {},
  };
}

function summarizeBaselineRef(baseline) {
  return baseline?.version === SYNC_BASELINE_SCHEMA_VERSION
    ? {
      savedAt: baseline.savedAt || '',
      policy: baseline.policy || '',
      summary: baseline.summary || {},
    }
    : null;
}

function summarizeTombstones(tombstones) {
  const items = Object.values(tombstones?.items || {});
  return {
    updatedAt: tombstones?.updatedAt || '',
    total: items.length,
    actions: countBy(items, (item) => item.action || 'unknown'),
  };
}

function emptyBaselineDiff(status) {
  return {
    status,
    baselineSavedAt: '',
    platforms: {},
    summary: {
      added: 0,
      deleted: 0,
      unchanged: 0,
    },
  };
}

function baselineTrack(platform, track) {
  const compact = compactPolicyTrack({ ...track, platform });
  return {
    key: primaryTrackKey(platform, track),
    platform,
    tokens: trackTokens(platform, track),
    track: compact,
  };
}

function primaryTrackKey(platform, track) {
  const tokens = trackTokens(platform, track);
  if (tokens[0]) return tokens[0];
  return `${platform}:unknown:${normalizeText([
    track?.title || '',
    track?.artist || '',
    track?.album || '',
  ].join(' ')) || 'empty'}`;
}

function trackTokens(platform, track = {}) {
  const tokens = [];
  if (track.id) tokens.push(`${platform}:id:${String(track.id).trim()}`);
  if (track.mid) tokens.push(`${platform}:mid:${String(track.mid).trim()}`);
  if (track.isrc) tokens.push(`isrc:${String(track.isrc).trim().toUpperCase()}`);
  const mbids = Array.isArray(track.metadata?.musicbrainz?.recordingIds)
    ? track.metadata.musicbrainz.recordingIds
    : [];
  for (const id of mbids) {
    if (id) tokens.push(`mbid:${String(id).trim().toLowerCase()}`);
  }
  const textKey = normalizeText([
    track.title || '',
    track.artist || (Array.isArray(track.artists) ? track.artists.join(' ') : ''),
    track.album || '',
  ].join(' '));
  if (textKey) tokens.push(`text:${textKey}:duration:${durationBucket(track.durationMs)}`);
  return [...new Set(tokens.filter(Boolean))];
}

function durationBucket(durationMs) {
  const value = Number(durationMs || 0);
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  return String(Math.round(value / 5000) * 5);
}

function indexByTokens(tracks) {
  const index = new Map();
  for (const track of tracks || []) {
    for (const token of track.tokens || []) index.set(token, track);
  }
  return index;
}

function hasAnyToken(index, tokens = []) {
  return tokens.some((token) => index.has(token));
}

function findCurrentTracksByTokens(snapshots, tokens = [], platforms = SYNC_PLATFORMS) {
  const results = [];
  for (const platform of platforms) {
    for (const track of snapshotTracks(snapshots[platform])) {
      if (trackTokens(platform, track).some((token) => tokens.includes(token))) {
        results.push({ platform, track });
      }
    }
  }
  return results;
}

function tombstoneKey(platform, baselineEntry) {
  return [
    'tombstone',
    platform,
    baselineEntry.key || primaryTrackKey(platform, baselineEntry.track),
  ].join('|');
}

function compactPolicyTrack(track) {
  if (!track) return null;
  return {
    platform: track.platform || '',
    id: track.id || null,
    mid: track.mid || null,
    title: track.title || '',
    artist: track.artist || '',
    artists: Array.isArray(track.artists) ? track.artists : [],
    album: track.album || '',
    durationMs: track.durationMs || null,
    duration: track.duration || '',
    isrc: track.isrc || null,
    aliases: track.aliases || null,
    metadata: track.metadata?.musicbrainz
      ? {
        musicbrainz: {
          status: track.metadata.musicbrainz.status || '',
          isrc: track.metadata.musicbrainz.isrc || null,
          recordingIds: Array.isArray(track.metadata.musicbrainz.recordingIds)
            ? track.metadata.musicbrainz.recordingIds.slice(0, 8)
            : [],
        },
      }
      : null,
  };
}

function normalizePolicy(policy) {
  const value = String(policy || '').trim().toLowerCase();
  if (SYNC_POLICIES.has(value)) return value;
  throw new Error(`Unsupported sync policy: ${policy}`);
}

function normalizePlatform(platform) {
  const value = String(platform || '').trim().toLowerCase();
  if (SYNC_PLATFORMS.includes(value)) return value;
  throw new Error(`Unsupported sync platform: ${platform}`);
}

function normalizePlatforms(platforms) {
  const values = (Array.isArray(platforms) ? platforms : String(platforms || '').split(','))
    .map((platform) => String(platform || '').trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (!unique.length) throw new Error('At least one sync platform is required.');
  unique.forEach(normalizePlatform);
  return SYNC_PLATFORMS.filter((platform) => unique.includes(platform));
}

function normalizeSnapshotMap(snapshots) {
  return Object.fromEntries(
    SYNC_PLATFORMS.map((platform) => [platform, snapshots?.[platform] || null]),
  );
}

function activeSnapshotPlatforms(snapshots) {
  return SYNC_PLATFORMS.filter((platform) => snapshotTracks(snapshots[platform]).length > 0);
}

function normalizeThresholds(input) {
  const match = clampThreshold(input.threshold ?? input.matchThreshold, DEFAULT_THRESHOLDS.match);
  const review = clampThreshold(input.reviewThreshold, DEFAULT_THRESHOLDS.review);
  if (review > match) throw new Error('Review threshold must be less than or equal to match threshold.');
  return { match, review };
}

function clampThreshold(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeTombstoneAction(action) {
  const value = String(action || '').trim().toLowerCase();
  if (value === 'clear') return value;
  if (TOMBSTONE_ACTIONS.has(value)) return value;
  throw new Error(`Unsupported tombstone action: ${action}`);
}

function snapshotTracks(snapshot) {
  if (!snapshot || snapshot.skipped) return [];
  return Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
}

function skippedSnapshot(platform) {
  return {
    platform,
    skipped: true,
    tracks: [],
  };
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
