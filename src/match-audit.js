import { normalizeIsrc, normalizeText } from './normalize.js';

export function auditTargetIdentityCollisions(operations = []) {
  const groups = new Map();
  for (const operation of operations) {
    const target = selectedTargetTrack(operation);
    const source = operation?.sourceTrack;
    const targetPlatform = clean(operation?.targetPlatform || target?.platform).toLowerCase();
    const targetId = clean(target?.id || target?.mid);
    if (!source || !targetPlatform || !targetId) continue;
    const key = `${targetPlatform}:${targetId}`;
    const group = groups.get(key) || {
      targetKey: key,
      targetPlatform,
      targetId,
      operations: [],
      sources: new Map(),
      explicitKeepSources: new Set(),
    };
    group.operations.push(clean(operation.id));
    const sourceKey = sourceIdentity(source);
    group.sources.set(sourceKey, source);
    if (operation.manualDecision?.action === 'keep') group.explicitKeepSources.add(sourceKey);
    groups.set(key, group);
  }

  const collisions = [...groups.values()]
    .filter((group) => group.sources.size > 1)
    .map(classifyCollision)
    .sort((left, right) => (
      Number(right.needsReview) - Number(left.needsReview)
      || right.sourceCount - left.sourceCount
      || left.targetKey.localeCompare(right.targetKey)
    ));
  const needsReview = collisions.filter((item) => item.needsReview);

  return {
    summary: {
      mappedTargets: groups.size,
      collisionGroups: collisions.length,
      sameRecordingCollapses: collisions.length - needsReview.length,
      crossRecordingCollisions: needsReview.length,
      mappingsInCollisions: collisions.reduce((total, item) => total + item.sourceCount, 0),
    },
    collisions,
  };
}

export function guardTargetIdentityCollisions(plan = {}) {
  const sourceOperations = Array.isArray(plan.operations) ? plan.operations : [];
  const auditableOperations = sourceOperations.map((operation) => (
    operation.blockedReason === 'target_identity_collision'
      ? {
        ...operation,
        action: operation.identityCollisionOriginalAction || 'keep',
        status: operation.identityCollisionOriginalStatus || 'ready',
      }
      : operation
  ));
  const audit = auditTargetIdentityCollisions(auditableOperations);
  const conflictIds = new Set(audit.collisions
    .filter((collision) => collision.needsReview)
    .flatMap((collision) => collision.operationIds));
  let changed = 0;
  const operations = sourceOperations.map((operation) => {
    const staleGuard = operation.blockedReason === 'target_identity_collision';
    if (conflictIds.has(operation.id)) {
      if (staleGuard && operation.status === 'needs_review') return operation;
      changed += 1;
      return {
        ...operation,
        action: 'review',
        status: 'needs_review',
        reviewKind: 'target_identity_collision',
        blockedReason: 'target_identity_collision',
        identityCollisionOriginalAction: operation.action,
        identityCollisionOriginalStatus: operation.status,
        message: 'Two distinct Apple recordings resolve to the same target track and require identity review.',
      };
    }
    if (!staleGuard) return operation;
    changed += 1;
    const {
      identityCollisionOriginalAction,
      identityCollisionOriginalStatus,
      ...restored
    } = operation;
    return {
      ...restored,
      action: identityCollisionOriginalAction || 'keep',
      status: identityCollisionOriginalStatus || 'ready',
      reviewKind: '',
      blockedReason: '',
      message: '',
    };
  });

  return {
    plan: {
      ...plan,
      operations: changed ? operations : sourceOperations,
      identityAudit: audit.summary,
    },
    changed,
    conflictOperationIds: [...conflictIds],
    audit,
  };
}

function classifyCollision(group) {
  const sources = [...group.sources.values()];
  const isrcs = unique(sources.map((track) => normalizeIsrc(track.isrc)).filter(Boolean));
  const sharedRecordingIds = intersectMany(sources.map(musicBrainzRecordingIds));
  const sameIsrc = isrcs.length === 1 && sources.every((track) => normalizeIsrc(track.isrc));
  const sharedMusicBrainzRecording = sharedRecordingIds.length > 0;
  const explicitlyApprovedCollapse = group.explicitKeepSources.size === group.sources.size;
  const needsReview = !sameIsrc && !sharedMusicBrainzRecording && !explicitlyApprovedCollapse;

  return {
    targetKey: group.targetKey,
    targetPlatform: group.targetPlatform,
    targetId: group.targetId,
    sourceCount: sources.length,
    operationIds: unique(group.operations.filter(Boolean)),
    distinctIsrcCount: isrcs.length,
    sharedMusicBrainzRecordingIds: sharedRecordingIds,
    relation: sameIsrc
      ? 'same_isrc_collapse'
      : sharedMusicBrainzRecording
        ? 'shared_musicbrainz_recording_collapse'
        : explicitlyApprovedCollapse ? 'explicit_keep_collapse' : 'cross_recording_collision',
    needsReview,
  };
}

function selectedTargetTrack(operation = {}) {
  if (operation.action === 'keep') return operation.targetTrack || operation.resolvedTargetTrack || null;
  if (operation.action !== 'add' || operation.status !== 'ready') return null;
  return operation.resolvedTargetTrack || operation.targetTrack || null;
}

function sourceIdentity(track = {}) {
  const providerId = clean(track.id || track.mid);
  if (providerId) return `${clean(track.platform).toLowerCase()}:${providerId}`;
  const isrc = normalizeIsrc(track.isrc);
  if (isrc) return `isrc:${isrc}`;
  return normalizeText(`${track.title || ''} ${track.artist || ''} ${track.album || ''} ${track.durationMs || ''}`);
}

function musicBrainzRecordingIds(track = {}) {
  const values = track?.metadata?.musicbrainz?.recordingIds;
  return unique((Array.isArray(values) ? values : []).map((item) => clean(item).toLowerCase()).filter(Boolean));
}

function intersectMany(groups) {
  if (!groups.length || groups.some((group) => !group.length)) return [];
  let result = new Set(groups[0]);
  for (const group of groups.slice(1)) {
    const current = new Set(group);
    result = new Set([...result].filter((item) => current.has(item)));
  }
  return [...result].sort();
}

function unique(values) {
  return [...new Set(values)];
}

function clean(value) {
  return String(value || '').trim();
}
