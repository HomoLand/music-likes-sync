import { createHash } from 'node:crypto';

const CONFIRM_PREFIX = 'REMOVE ';

export async function executeMirrorSyncPlan(plan, options = {}) {
  validatePlan(plan);
  const dryRun = options.dryRun !== false;
  const selectedOperations = selectOperations(plan.operations || [], {
    operationIds: options.operationIds,
    actions: options.actions,
  });
  const addOperations = selectedOperations.filter((operation) => operation.action === 'add');
  const removeOperations = selectedOperations.filter((operation) => operation.action === 'remove');
  const reviewOperations = (plan.operations || []).filter((operation) => operation.action === 'review');
  const executableAdds = addOperations.filter((operation) => operation.status === 'ready' && (operation.resolvedTargetTrack || operation.targetTrack));
  const blockedAdds = addOperations.filter((operation) => !(operation.status === 'ready' && (operation.resolvedTargetTrack || operation.targetTrack)));
  const removable = removeOperations.filter((operation) => operation.targetTrack?.id);
  const blockedRemoves = removeOperations.filter((operation) => !operation.targetTrack?.id);
  const identity = buildMirrorRunIdentity(plan, {
    ...options,
    selectedOperations,
    executableAdds,
    removable,
    blockedAdds,
    blockedRemoves,
    reviewOperations,
  });

  const preview = {
    runId: options.runId || identity.runId,
    idempotencyKey: options.idempotencyKey || identity.idempotencyKey,
    operationKeys: identity.operationKeys,
    playlistId: identity.playlistId,
    status: dryRun ? 'preview' : 'pending',
    dryRun,
    target: plan.target?.platform || '',
    generatedAt: new Date().toISOString(),
    planGeneratedAt: plan.generatedAt || '',
    planSummary: plan.summary || {},
    add: {
      requested: addOperations.length,
      executable: executableAdds.length,
      blocked: blockedAdds.length,
      reason: blockedAdds.length ? 'target_catalog_not_resolved' : '',
    },
    remove: {
      requested: removeOperations.length,
      executable: removable.length,
      blocked: blockedRemoves.length,
      destructive: removable.length,
    },
    review: {
      blocked: reviewOperations.length,
    },
  };

  if (dryRun) {
    return {
      ...preview,
      addResult: dryRunMutationResult(executableAdds.length),
      removeResult: dryRunMutationResult(removable.length),
      blocked: buildBlockedSummary(blockedAdds, blockedRemoves, reviewOperations),
    };
  }

  if (executableAdds.length && typeof options.addTracks !== 'function') {
    throw new Error('Mirror add execution requires an addTracks adapter.');
  }
  if (removable.length) {
    assertDestructiveConfirmed(plan.target?.platform, options);
    if (typeof options.removeTracks !== 'function') {
      throw new Error('Mirror remove execution requires a removeTracks adapter.');
    }
  }

  const addResult = executableAdds.length
    ? await options.addTracks({
      target: plan.target?.platform || '',
      playlistId: options.playlistId || plan.target?.playlistId || '',
      tracks: executableAdds.map((operation) => operation.resolvedTargetTrack || operation.targetTrack),
      operations: executableAdds,
      idempotencyKey: preview.idempotencyKey,
      operationKeys: identity.operationKeys.add,
      batchSize: options.batchSize,
    })
    : emptyMutationResult();

  const removeResult = removable.length
    ? await options.removeTracks({
      target: plan.target?.platform || '',
      playlistId: options.playlistId || plan.target?.playlistId || '',
      tracks: removable.map((operation) => operation.targetTrack),
      operations: removable,
      idempotencyKey: preview.idempotencyKey,
      operationKeys: identity.operationKeys.remove,
      batchSize: options.batchSize,
    })
    : emptyMutationResult();

  return {
    ...preview,
    dryRun: false,
    addResult,
    removeResult,
    blocked: buildBlockedSummary(blockedAdds, blockedRemoves, reviewOperations),
  };
}

export function expectedMirrorRemoveConfirmation(target) {
  return `${CONFIRM_PREFIX}${String(target || '').trim().toUpperCase()}`;
}

export function buildMirrorRunIdentity(plan, options = {}) {
  validatePlan(plan);
  const selectedOperations = Array.isArray(options.selectedOperations)
    ? options.selectedOperations
    : selectOperations(plan.operations || [], {
      operationIds: options.operationIds,
      actions: options.actions,
    });
  const addOperations = selectedOperations.filter((operation) => operation.action === 'add');
  const removeOperations = selectedOperations.filter((operation) => operation.action === 'remove');
  const reviewOperations = Array.isArray(options.reviewOperations)
    ? options.reviewOperations
    : (plan.operations || []).filter((operation) => operation.action === 'review');
  const executableAdds = Array.isArray(options.executableAdds)
    ? options.executableAdds
    : addOperations.filter((operation) => operation.status === 'ready' && (operation.resolvedTargetTrack || operation.targetTrack));
  const removable = Array.isArray(options.removable)
    ? options.removable
    : removeOperations.filter((operation) => operation.targetTrack?.id);
  const blockedAdds = Array.isArray(options.blockedAdds)
    ? options.blockedAdds
    : addOperations.filter((operation) => !(operation.status === 'ready' && (operation.resolvedTargetTrack || operation.targetTrack)));
  const blockedRemoves = Array.isArray(options.blockedRemoves)
    ? options.blockedRemoves
    : removeOperations.filter((operation) => !operation.targetTrack?.id);
  const playlistId = String(options.playlistId || plan.target?.playlistId || '').trim();
  const actionSet = requestedActionSet(options.actions, selectedOperations);
  const operationKeys = {
    add: executableAdds.map((operation) => mirrorOperationExecutionKey(operation, 'add')),
    remove: removable.map((operation) => mirrorOperationExecutionKey(operation, 'remove')),
    blockedAdd: blockedAdds.map((operation) => mirrorOperationExecutionKey(operation, 'blocked-add')),
    blockedRemove: blockedRemoves.map((operation) => mirrorOperationExecutionKey(operation, 'blocked-remove')),
    review: reviewOperations.map((operation) => mirrorOperationExecutionKey(operation, 'review')),
  };
  const fingerprint = stableStringify({
    version: 1,
    mode: plan.mode || '',
    target: plan.target?.platform || '',
    playlistId,
    planGeneratedAt: plan.generatedAt || '',
    sourceFetchedAt: plan.source?.fetchedAt || '',
    targetFetchedAt: plan.target?.fetchedAt || '',
    actions: actionSet,
    operationKeys,
  });
  const idempotencyKey = sha256(fingerprint);
  return {
    runId: `mirror-run-${idempotencyKey.slice(0, 16)}`,
    idempotencyKey,
    playlistId,
    actions: actionSet,
    operationKeys,
  };
}

function validatePlan(plan) {
  if (!plan || plan.mode !== 'source_of_truth_mirror') {
    throw new Error('缺少 Apple 可信源镜像计划。');
  }
  const target = plan.target?.platform || '';
  if (target !== 'qq' && target !== 'netease') {
    throw new Error('镜像执行目前只支持 QQ 音乐或网易云。');
  }
}

function selectOperations(operations, options = {}) {
  let selected = operations;
  if (options.actions?.length) {
    const actions = new Set(options.actions.map((action) => String(action || '').trim()).filter(Boolean));
    selected = selected.filter((operation) => actions.has(operation.action));
  }
  if (options.operationIds?.length) {
    const wanted = new Set(options.operationIds.map((id) => String(id || '').trim()).filter(Boolean));
    selected = selected.filter((operation) => wanted.has(operation.id));
  }
  return selected;
}

function selectedActionSet(operations) {
  const actions = [...new Set((operations || [])
    .map((operation) => operation.action)
    .filter((action) => action === 'add' || action === 'remove'))];
  return actions.sort();
}

function requestedActionSet(actions, selectedOperations) {
  const requested = [...new Set((actions || [])
    .map((action) => String(action || '').trim())
    .filter((action) => action === 'add' || action === 'remove'))].sort();
  return requested.length ? requested : selectedActionSet(selectedOperations);
}

function mirrorOperationExecutionKey(operation, kind) {
  return sha256(stableStringify({
    kind,
    id: operation.id || '',
    action: operation.action || '',
    status: operation.status || '',
    reason: operation.reason || '',
    source: trackIdentity(operation.sourceTrack),
    target: trackIdentity(operation.resolvedTargetTrack || operation.targetTrack || operation.candidateTrack),
    manualDecision: operation.manualDecision?.key || '',
  }));
}

function trackIdentity(track) {
  if (!track) return null;
  return {
    platform: track.platform || '',
    id: track.id || '',
    mid: track.mid || '',
    isrc: track.isrc || '',
    title: track.title || '',
    artist: track.artist || '',
    album: track.album || '',
    durationMs: track.durationMs || null,
  };
}

function assertDestructiveConfirmed(target, options) {
  const expected = expectedMirrorRemoveConfirmation(target);
  const actual = String(options.confirmText || '').trim().toUpperCase();
  if (actual !== expected) {
    throw new Error(`删除是破坏性操作。请确认输入 ${expected} 后再执行。`);
  }
}

function buildBlockedSummary(blockedAdds, blockedRemoves, reviewOperations) {
  return {
    unresolvedAdds: blockedAdds.length,
    invalidRemoves: blockedRemoves.length,
    reviewItems: reviewOperations.length,
  };
}

function dryRunMutationResult(count) {
  return {
    requested: count,
    submitted: 0,
    accepted: 0,
    added: 0,
    removed: 0,
    verified: false,
    batches: [],
  };
}

function emptyMutationResult() {
  return {
    requested: 0,
    submitted: 0,
    accepted: 0,
    added: 0,
    removed: 0,
    verified: false,
    batches: [],
  };
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
