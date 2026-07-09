export const MIRROR_PLAN_SCHEMA_VERSION = 1;
export const MIRROR_RUN_LOG_SCHEMA_VERSION = 1;
export const MIRROR_DECISION_SCHEMA_VERSION = 1;
export const SYNC_POLICY_STATE_SCHEMA_VERSION = 1;
export const SYNC_BASELINE_STATE_SCHEMA_VERSION = 1;
export const SYNC_PREVIEW_STATE_SCHEMA_VERSION = 1;
export const SYNC_TOMBSTONE_STATE_SCHEMA_VERSION = 1;
export const SYNC_RUN_LOG_STATE_SCHEMA_VERSION = 1;
export const AI_PROVIDER_STATE_SCHEMA_VERSION = 1;
export const MUSIC_PROFILE_STATE_SCHEMA_VERSION = 1;
export const RECOMMENDATION_SHORTLISTS_STATE_SCHEMA_VERSION = 1;
export const AGENT_SESSIONS_STATE_SCHEMA_VERSION = 1;

const MIRROR_MODE = 'source_of_truth_mirror';
const SOURCE_PLATFORM = 'apple';
const TARGET_PLATFORMS = new Set(['qq', 'netease']);
const PLAN_ACTIONS = new Set(['keep', 'add', 'remove', 'review']);
const PLAN_STATUSES = new Set(['ready', 'needs_resolution', 'needs_review', 'not_found']);
const RUN_STATUSES = new Set(['preview', 'running', 'completed', 'failed']);
const SYNC_MODE = 'policy_sync';
const SYNC_POLICIES = new Set(['canonical_mirror', 'union_convergence', 'managed_bidirectional', 'read_only_analysis']);
const SYNC_PLATFORMS = new Set(['apple', 'qq', 'netease']);
const SYNC_OPERATION_ACTIONS = new Set(['keep', 'add', 'remove', 'review']);
const SYNC_OPERATION_STATUSES = new Set(['ready', 'needs_resolution', 'needs_review', 'not_found', 'blocked']);
const TOMBSTONE_ACTIONS = new Set(['confirm_global_delete', 'ignore', 'restore', 'current_platform_only']);
const SYNC_POLICY_DELETE_MODES = new Set(['ask', 'manual', 'never', 'confirm_each']);
const AGENT_TRACE_FEEDBACK_LABELS = new Set(['useful', 'not_enough_evidence', 'incorrect']);
const PLAN_SUMMARY_KEYS = [
  'total',
  'keep',
  'add',
  'remove',
  'review',
  'destructive',
  'ready',
  'blocked',
];
const SYNC_SUMMARY_KEYS = [
  'total',
  'keep',
  'add',
  'remove',
  'review',
  'destructive',
  'ready',
  'blocked',
];
const MIRROR_DECISION_ACTIONS = new Set(['keep', 'separate']);
const SECRET_FIELD_NAMES = new Set([
  'cookie',
  'cookies',
  'apikey',
  'api_key',
  'secret',
  'clientsecret',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
  'bearer',
  'password',
  'music_u',
  'qm_keyst',
]);
const RAW_AI_OR_PROVIDER_FIELDS = new Set([
  'rawprompt',
  'rawresponse',
  'rawpayload',
  'rawproviderresponse',
  'providerrawresponse',
]);

export function validateMirrorPlan(plan) {
  const report = createReport('mirror-plan');
  if (!isObject(plan)) {
    addError(report, '$', 'Mirror plan must be a JSON object.');
    return finish(report);
  }

  report.version = plan.version;
  report.generatedAt = plan.generatedAt || '';
  report.target = plan.target?.platform || '';

  validateVersion(report, '$.version', plan.version, MIRROR_PLAN_SCHEMA_VERSION);
  if (plan.mode !== MIRROR_MODE) {
    addError(report, '$.mode', `Expected ${MIRROR_MODE}.`);
  }
  validateTimestamp(report, '$.generatedAt', plan.generatedAt, { required: true });

  if (plan.source?.platform !== SOURCE_PLATFORM) {
    addError(report, '$.source.platform', 'Mirror source must be apple.');
  }
  if (!TARGET_PLATFORMS.has(plan.target?.platform)) {
    addError(report, '$.target.platform', 'Mirror target must be qq or netease.');
  }

  if (!isObject(plan.summary)) {
    addError(report, '$.summary', 'Mirror plan summary must be an object.');
  }
  if (!Array.isArray(plan.operations)) {
    addError(report, '$.operations', 'Mirror plan operations must be an array.');
    return finish(report);
  }

  report.operationCount = plan.operations.length;
  for (let index = 0; index < plan.operations.length; index += 1) {
    validateMirrorOperation(report, plan.operations[index], index, plan.target?.platform || '');
  }

  if (isObject(plan.summary)) {
    validatePlanSummary(report, plan.summary, summarizeMirrorOperations(plan.operations));
  }

  if (plan.resolvedAt !== undefined) {
    validateTimestamp(report, '$.resolvedAt', plan.resolvedAt, { required: false });
  }
  if (plan.addResolution !== undefined && !isObject(plan.addResolution)) {
    addError(report, '$.addResolution', 'Add resolution metadata must be an object when present.');
  }

  return finish(report);
}

export function validateMirrorRunLog(log) {
  const report = createReport('mirror-runs');
  if (!isObject(log)) {
    addError(report, '$', 'Mirror run log must be a JSON object.');
    return finish(report);
  }

  report.version = log.version;
  report.updatedAt = log.updatedAt || '';

  validateVersion(report, '$.version', log.version, MIRROR_RUN_LOG_SCHEMA_VERSION);
  validateTimestamp(report, '$.updatedAt', log.updatedAt, { required: true });

  if (!Array.isArray(log.runs)) {
    addError(report, '$.runs', 'Mirror run log runs must be an array.');
    return finish(report);
  }

  report.runCount = log.runs.length;
  for (let index = 0; index < log.runs.length; index += 1) {
    validateMirrorRun(report, log.runs[index], index);
  }

  return finish(report);
}

export function validateMirrorDecisionState(state) {
  const report = createReport('mirror-decisions');
  if (!isObject(state)) {
    addError(report, '$', 'Mirror decision state must be a JSON object.');
    return finish(report);
  }

  report.version = state.version;
  report.updatedAt = state.updatedAt || '';

  validateVersion(report, '$.version', state.version, MIRROR_DECISION_SCHEMA_VERSION);
  validateTimestamp(report, '$.updatedAt', state.updatedAt, { required: true });

  if (!isObject(state.items)) {
    addError(report, '$.items', 'Mirror decision state items must be an object.');
    return finish(report);
  }

  const entries = Object.entries(state.items);
  report.decisionCount = entries.length;
  for (const [key, decision] of entries) {
    validateMirrorDecision(report, key, decision);
  }

  return finish(report);
}

export function validateMirrorStateFiles(state = {}) {
  const reports = [];
  if (state.mirrorPlan !== undefined) reports.push(validateMirrorPlan(state.mirrorPlan));
  if (state.mirrorRuns !== undefined) reports.push(validateMirrorRunLog(state.mirrorRuns));
  if (state.mirrorDecisions !== undefined) reports.push(validateMirrorDecisionState(state.mirrorDecisions));
  return {
    ok: reports.every((report) => report.ok),
    reports,
  };
}

export function validateSyncPolicyState(state) {
  const report = createReport('sync-policy');
  if (!isObject(state)) {
    addError(report, '$', 'Sync policy state must be a JSON object.');
    return finish(report);
  }

  report.version = state.version;
  report.policy = state.policy || '';

  validateVersion(report, '$.version', state.version, SYNC_POLICY_STATE_SCHEMA_VERSION);
  validateTimestamp(report, '$.updatedAt', state.updatedAt, { required: true });
  validatePolicyId(report, '$.policy', state.policy);
  validatePlatformArray(report, '$.participants', state.participants, { required: true, allowApple: true });

  if (state.source !== undefined) {
    if (!isObject(state.source)) {
      addError(report, '$.source', 'Sync policy source must be an object when present.');
    } else {
      validateSyncPlatform(report, '$.source.platform', state.source.platform, { allowApple: true });
    }
  }

  if (state.targets !== undefined) {
    validatePlatformArray(report, '$.targets', state.targets, { required: false, allowApple: false });
  }

  if (state.deletionPolicy !== undefined && !SYNC_POLICY_DELETE_MODES.has(state.deletionPolicy)) {
    addError(report, '$.deletionPolicy', 'Deletion policy must be ask, manual, never, or confirm_each.');
  }

  if (state.policy === 'canonical_mirror') {
    if (state.source?.platform !== 'apple') {
      addError(report, '$.source.platform', 'Canonical mirror source must be apple.');
    }
    if (!Array.isArray(state.targets) || state.targets.length === 0) {
      addError(report, '$.targets', 'Canonical mirror requires at least one target.');
    }
  }

  if (state.policy === 'read_only_analysis' && Array.isArray(state.targets) && state.targets.length > 0) {
    addWarning(report, '$.targets', 'Read-only analysis ignores write targets.');
  }

  validateNoSecrets(report, '$', state);
  return finish(report);
}

export function validateSyncBaselineState(state) {
  const report = createReport('sync-baseline');
  if (!isObject(state)) {
    addError(report, '$', 'Sync baseline state must be a JSON object.');
    return finish(report);
  }

  report.version = state.version;
  validateVersion(report, '$.version', state.version, SYNC_BASELINE_STATE_SCHEMA_VERSION);
  validateTimestamp(report, '$.savedAt', state.savedAt, { required: true });
  validatePolicyId(report, '$.policy', state.policy);

  if (!isObject(state.platforms)) {
    addError(report, '$.platforms', 'Sync baseline platforms must be an object.');
    validateNoSecrets(report, '$', state);
    return finish(report);
  }

  let trackCount = 0;
  const platformEntries = Object.entries(state.platforms);
  report.platformCount = platformEntries.length;
  for (const [platform, entry] of platformEntries) {
    validateBaselinePlatform(report, platform, entry);
    trackCount += Array.isArray(entry?.tracks) ? entry.tracks.length : 0;
  }
  report.trackCount = trackCount;

  if (isObject(state.summary)) {
    if (state.summary.platforms !== undefined && state.summary.platforms !== platformEntries.length) {
      addError(report, '$.summary.platforms', `Summary mismatch: expected ${platformEntries.length}, got ${state.summary.platforms}.`);
    }
    if (state.summary.tracks !== undefined && state.summary.tracks !== trackCount) {
      addError(report, '$.summary.tracks', `Summary mismatch: expected ${trackCount}, got ${state.summary.tracks}.`);
    }
  } else {
    addError(report, '$.summary', 'Sync baseline summary must be an object.');
  }

  validateNoSecrets(report, '$', state);
  return finish(report);
}

export function validateSyncPreviewState(state) {
  const report = createReport('sync-preview');
  if (!isObject(state)) {
    addError(report, '$', 'Sync preview state must be a JSON object.');
    return finish(report);
  }

  report.version = state.version;
  report.policy = state.policy || '';

  validateVersion(report, '$.version', state.version, SYNC_PREVIEW_STATE_SCHEMA_VERSION);
  if (state.mode !== SYNC_MODE) {
    addError(report, '$.mode', `Expected ${SYNC_MODE}.`);
  }
  validateTimestamp(report, '$.generatedAt', state.generatedAt, { required: true });
  validatePolicyId(report, '$.policy', state.policy);
  validatePlatformArray(report, '$.participants', state.participants, { required: true, allowApple: true });

  if (!Array.isArray(state.operations)) {
    addError(report, '$.operations', 'Sync preview operations must be an array.');
    validateNoSecrets(report, '$', state);
    return finish(report);
  }

  report.operationCount = state.operations.length;
  for (let index = 0; index < state.operations.length; index += 1) {
    validateSyncOperation(report, state.operations[index], index, state.policy);
  }

  if (isObject(state.summary)) {
    validateSyncSummary(report, state.summary, summarizeSyncOperations(state.operations));
  } else {
    addError(report, '$.summary', 'Sync preview summary must be an object.');
  }

  if (state.status !== undefined && !['ready', 'blocked_missing_baseline'].includes(state.status)) {
    addError(report, '$.status', 'Sync preview status must be ready or blocked_missing_baseline when present.');
  }

  validateNoSecrets(report, '$', state);
  return finish(report);
}

export function validateSyncTombstoneState(state) {
  const report = createReport('sync-tombstones');
  if (!isObject(state)) {
    addError(report, '$', 'Sync tombstone state must be a JSON object.');
    return finish(report);
  }

  report.version = state.version;
  validateVersion(report, '$.version', state.version, SYNC_TOMBSTONE_STATE_SCHEMA_VERSION);
  validateTimestamp(report, '$.updatedAt', state.updatedAt, { required: true });

  if (!isObject(state.items)) {
    addError(report, '$.items', 'Sync tombstone items must be an object.');
    validateNoSecrets(report, '$', state);
    return finish(report);
  }

  const entries = Object.entries(state.items);
  report.decisionCount = entries.length;
  for (const [key, decision] of entries) {
    validateTombstoneDecision(report, key, decision);
  }

  validateNoSecrets(report, '$', state);
  return finish(report);
}

export function validateSyncRunLogState(state) {
  const report = createReport('sync-runs');
  if (!isObject(state)) {
    addError(report, '$', 'Sync run log must be a JSON object.');
    return finish(report);
  }

  report.version = state.version;
  report.updatedAt = state.updatedAt || '';

  validateVersion(report, '$.version', state.version, SYNC_RUN_LOG_STATE_SCHEMA_VERSION);
  validateTimestamp(report, '$.updatedAt', state.updatedAt, { required: true });

  if (!Array.isArray(state.runs)) {
    addError(report, '$.runs', 'Sync run log runs must be an array.');
    validateNoSecrets(report, '$', state);
    return finish(report);
  }

  report.runCount = state.runs.length;
  for (let index = 0; index < state.runs.length; index += 1) {
    validateSyncRun(report, state.runs[index], index);
  }

  validateNoSecrets(report, '$', state);
  return finish(report);
}

export function validateAiProviderState(state) {
  const report = createReport('ai-provider-state');
  if (!isObject(state)) {
    addError(report, '$', 'AI provider state must be a JSON object.');
    return finish(report);
  }

  validateVersion(report, '$.version', state.version, AI_PROVIDER_STATE_SCHEMA_VERSION);
  validateTimestamp(report, '$.updatedAt', state.updatedAt, { required: true });
  if (state.provider !== undefined && typeof state.provider !== 'string') {
    addError(report, '$.provider', 'AI provider must be a string when present.');
  }
  if (state.model !== undefined && typeof state.model !== 'string') {
    addError(report, '$.model', 'AI model must be a string when present.');
  }
  if (state.batchSize !== undefined && !isPositiveInteger(state.batchSize)) {
    addError(report, '$.batchSize', 'AI batch size must be a positive integer when present.');
  }
  validateNoSecrets(report, '$', state);
  return finish(report);
}

export function validateMusicProfileState(state) {
  const report = createReport('music-profile');
  if (!isObject(state)) {
    addError(report, '$', 'Music profile state must be a JSON object.');
    return finish(report);
  }

  validateVersion(report, '$.version', state.version, MUSIC_PROFILE_STATE_SCHEMA_VERSION);
  validateTimestamp(report, '$.updatedAt', state.updatedAt, { required: true });
  validateTimestamp(report, '$.generatedAt', state.generatedAt, { required: false });
  if (state.summary !== undefined && !isObject(state.summary)) {
    addError(report, '$.summary', 'Music profile summary must be an object when present.');
  }
  if (state.aggregates !== undefined && !isObject(state.aggregates)) {
    addError(report, '$.aggregates', 'Music profile aggregates must be an object when present.');
  }
  validateNoSecrets(report, '$', state);
  return finish(report);
}

export function validateRecommendationShortlistsState(state) {
  const report = createReport('recommendation-shortlists');
  if (!isObject(state)) {
    addError(report, '$', 'Recommendation shortlists state must be a JSON object.');
    return finish(report);
  }

  validateVersion(report, '$.version', state.version, RECOMMENDATION_SHORTLISTS_STATE_SCHEMA_VERSION);
  validateTimestamp(report, '$.updatedAt', state.updatedAt, { required: true });
  if (!Array.isArray(state.shortlists)) {
    addError(report, '$.shortlists', 'Recommendation shortlists must be an array.');
    validateNoSecrets(report, '$', state);
    return finish(report);
  }
  report.shortlistCount = state.shortlists.length;
  for (let index = 0; index < state.shortlists.length; index += 1) {
    validateShortlist(report, state.shortlists[index], index);
  }
  validateNoSecrets(report, '$', state);
  return finish(report);
}

export function validateAgentSessionsState(state) {
  const report = createReport('agent-sessions');
  if (!isObject(state)) {
    addError(report, '$', 'Agent sessions state must be a JSON object.');
    return finish(report);
  }

  validateVersion(report, '$.version', state.version, AGENT_SESSIONS_STATE_SCHEMA_VERSION);
  validateTimestamp(report, '$.updatedAt', state.updatedAt, { required: true });
  if (!Array.isArray(state.sessions)) {
    addError(report, '$.sessions', 'Agent sessions must be an array.');
    validateNoSecrets(report, '$', state);
    return finish(report);
  }
  report.sessionCount = state.sessions.length;
  for (let index = 0; index < state.sessions.length; index += 1) {
    validateAgentSession(report, state.sessions[index], index);
  }
  validateNoSecrets(report, '$', state);
  return finish(report);
}

export function validatePolicyStateFiles(state = {}) {
  const reports = [];
  if (state.syncPolicy !== undefined) reports.push(validateSyncPolicyState(state.syncPolicy));
  if (state.syncBaseline !== undefined) reports.push(validateSyncBaselineState(state.syncBaseline));
  if (state.syncPreview !== undefined) reports.push(validateSyncPreviewState(state.syncPreview));
  if (state.syncTombstones !== undefined) reports.push(validateSyncTombstoneState(state.syncTombstones));
  if (state.syncRuns !== undefined) reports.push(validateSyncRunLogState(state.syncRuns));
  if (state.aiProviderState !== undefined) reports.push(validateAiProviderState(state.aiProviderState));
  if (state.musicProfile !== undefined) reports.push(validateMusicProfileState(state.musicProfile));
  if (state.recommendationShortlists !== undefined) reports.push(validateRecommendationShortlistsState(state.recommendationShortlists));
  if (state.agentSessions !== undefined) reports.push(validateAgentSessionsState(state.agentSessions));
  return {
    ok: reports.every((report) => report.ok),
    reports,
  };
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
    resolvedAdds: 0,
    unresolvedAdds: 0,
  };

  for (const operation of operations) {
    const action = operation?.action || 'review';
    if (Object.prototype.hasOwnProperty.call(summary, action)) summary[action] += 1;
    if (operation?.destructive) summary.destructive += 1;
    if (operation?.status === 'ready') summary.ready += 1;
    else summary.blocked += 1;
    if (action === 'add') {
      if (operation?.resolvedTargetTrack) summary.resolvedAdds += 1;
      else summary.unresolvedAdds += 1;
    }
  }

  return summary;
}

export function summarizeSyncOperations(operations = []) {
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
    const action = operation?.action || 'review';
    if (Object.prototype.hasOwnProperty.call(summary, action)) summary[action] += 1;
    if (operation?.destructive) summary.destructive += 1;
    if (operation?.status === 'ready') summary.ready += 1;
    else summary.blocked += 1;
    if (operation?.reason === 'tombstone_candidate') summary.tombstoneCandidates += 1;
  }

  return summary;
}

function validateMirrorOperation(report, operation, index, targetPlatform) {
  const base = `$.operations[${index}]`;
  if (!isObject(operation)) {
    addError(report, base, 'Mirror operation must be an object.');
    return;
  }

  if (!nonEmptyString(operation.id)) {
    addError(report, `${base}.id`, 'Mirror operation id is required.');
  }
  if (!PLAN_ACTIONS.has(operation.action)) {
    addError(report, `${base}.action`, 'Mirror operation action must be keep, add, remove, or review.');
  }
  if (!PLAN_STATUSES.has(operation.status)) {
    addError(report, `${base}.status`, 'Mirror operation status is not supported by the mirror executor.');
  }
  if (operation.destructive !== undefined && typeof operation.destructive !== 'boolean') {
    addError(report, `${base}.destructive`, 'Mirror operation destructive flag must be boolean when present.');
  }

  if (operation.action === 'keep') {
    validateTrack(report, `${base}.sourceTrack`, operation.sourceTrack, { required: true, platform: SOURCE_PLATFORM });
    validateTrack(report, `${base}.targetTrack`, operation.targetTrack, { required: true, platform: targetPlatform });
  } else if (operation.action === 'add') {
    validateTrack(report, `${base}.sourceTrack`, operation.sourceTrack, { required: true, platform: SOURCE_PLATFORM });
    validateTrack(report, `${base}.targetTrack`, operation.targetTrack, { required: false, platform: targetPlatform });
    validateTrack(report, `${base}.candidateTrack`, operation.candidateTrack, { required: false, platform: targetPlatform });
    validateTrack(report, `${base}.resolvedTargetTrack`, operation.resolvedTargetTrack, { required: false, platform: targetPlatform });
    if (operation.status === 'ready' && !operation.resolvedTargetTrack && !operation.targetTrack) {
      addWarning(report, `${base}.resolvedTargetTrack`, 'Ready add operations without a resolved target track are not executable and will be blocked by mirror apply.');
    }
  } else if (operation.action === 'remove') {
    validateTrack(report, `${base}.sourceTrack`, operation.sourceTrack, { required: false, platform: SOURCE_PLATFORM });
    validateTrack(report, `${base}.targetTrack`, operation.targetTrack, {
      required: true,
      platform: targetPlatform,
      idRequired: true,
    });
    if (operation.destructive !== true) {
      addError(report, `${base}.destructive`, 'Remove operations must be marked destructive.');
    }
    if (operation.status !== 'ready') {
      addError(report, `${base}.status`, 'Remove operations must be ready or manually reviewed before persistence.');
    }
  } else if (operation.action === 'review') {
    validateTrack(report, `${base}.sourceTrack`, operation.sourceTrack, { required: false, platform: SOURCE_PLATFORM });
    validateTrack(report, `${base}.targetTrack`, operation.targetTrack, { required: false, platform: targetPlatform });
    if (!operation.sourceTrack && !operation.targetTrack) {
      addError(report, base, 'Review operations must reference at least one source or target track.');
    }
    if (operation.status === 'ready') {
      addWarning(report, `${base}.status`, 'Review operations are expected to stay blocked until a manual decision exists.');
    }
  }
}

function validateSyncOperation(report, operation, index, policy) {
  const base = `$.operations[${index}]`;
  if (!isObject(operation)) {
    addError(report, base, 'Sync operation must be an object.');
    return;
  }

  if (!nonEmptyString(operation.id)) {
    addError(report, `${base}.id`, 'Sync operation id is required.');
  }
  if (!SYNC_OPERATION_ACTIONS.has(operation.action)) {
    addError(report, `${base}.action`, 'Sync operation action must be keep, add, remove, or review.');
  }
  if (!SYNC_OPERATION_STATUSES.has(operation.status)) {
    addError(report, `${base}.status`, 'Sync operation status is not supported.');
  }
  if (operation.destructive !== undefined && typeof operation.destructive !== 'boolean') {
    addError(report, `${base}.destructive`, 'Sync operation destructive flag must be boolean when present.');
  }
  if (operation.sourcePlatform) {
    validateSyncPlatform(report, `${base}.sourcePlatform`, operation.sourcePlatform, { allowApple: true });
  }
  if (operation.targetPlatform) {
    validateSyncPlatform(report, `${base}.targetPlatform`, operation.targetPlatform, { allowApple: true });
  }

  validateTrack(report, `${base}.sourceTrack`, operation.sourceTrack, { required: false });
  validateTrack(report, `${base}.targetTrack`, operation.targetTrack, { required: false });
  validateTrack(report, `${base}.candidateTrack`, operation.candidateTrack, { required: false });
  validateTrack(report, `${base}.resolvedTargetTrack`, operation.resolvedTargetTrack, { required: false });

  if (operation.action === 'add') {
    if (policy === 'read_only_analysis' && operation.status === 'ready') {
      addError(report, `${base}.status`, 'Read-only analysis cannot contain ready add operations.');
    }
    if (operation.status === 'ready' && !operation.resolvedTargetTrack && !operation.targetTrack) {
      addWarning(report, `${base}.resolvedTargetTrack`, 'Ready add operations should include a resolved target track before execution.');
    }
  }

  if (operation.action === 'remove') {
    if (operation.destructive !== true) {
      addError(report, `${base}.destructive`, 'Remove operations must be marked destructive.');
    }
    if (policy === 'read_only_analysis') {
      addError(report, `${base}.action`, 'Read-only analysis cannot contain remove operations.');
    }
    if (operation.status === 'ready' && !TARGET_PLATFORMS.has(operation.targetPlatform)) {
      addError(report, `${base}.targetPlatform`, 'Ready remove operations currently support only qq or netease targets.');
    }
    if (operation.status === 'ready' && !operation.targetTrack?.id) {
      addError(report, `${base}.targetTrack`, 'Ready remove operations must include a destructive target id.');
    }
  }

  if (operation.action === 'review' && operation.status === 'ready') {
    addWarning(report, `${base}.status`, 'Review operations are expected to stay blocked until a manual or AI-assisted decision exists.');
  }
}

function validateBaselinePlatform(report, platform, entry) {
  const base = `$.platforms.${platform}`;
  validateSyncPlatform(report, base, platform, { allowApple: true });
  if (!isObject(entry)) {
    addError(report, base, 'Sync baseline platform entry must be an object.');
    return;
  }

  if (entry.platform !== platform) {
    addError(report, `${base}.platform`, 'Baseline platform field must match its map key.');
  }
  validateTimestamp(report, `${base}.fetchedAt`, entry.fetchedAt, { required: false });
  if (!Array.isArray(entry.tracks)) {
    addError(report, `${base}.tracks`, 'Baseline platform tracks must be an array.');
    return;
  }
  if (entry.count !== undefined && entry.count !== entry.tracks.length) {
    addError(report, `${base}.count`, `Baseline platform count mismatch: expected ${entry.tracks.length}, got ${entry.count}.`);
  }

  for (let index = 0; index < entry.tracks.length; index += 1) {
    validateBaselineTrack(report, `${base}.tracks[${index}]`, entry.tracks[index], platform);
  }
}

function validateBaselineTrack(report, path, entry, platform) {
  if (!isObject(entry)) {
    addError(report, path, 'Baseline track entry must be an object.');
    return;
  }
  if (!nonEmptyString(entry.key)) {
    addError(report, `${path}.key`, 'Baseline track key is required.');
  }
  if (entry.platform !== platform) {
    addError(report, `${path}.platform`, 'Baseline track platform must match its parent platform.');
  }
  if (!Array.isArray(entry.tokens) || entry.tokens.length === 0) {
    addError(report, `${path}.tokens`, 'Baseline track tokens must be a non-empty array.');
  } else {
    for (let index = 0; index < entry.tokens.length; index += 1) {
      if (!nonEmptyString(entry.tokens[index])) {
        addError(report, `${path}.tokens[${index}]`, 'Baseline track token must be a non-empty string.');
      }
    }
  }
  validateTrack(report, `${path}.track`, entry.track, { required: true, platform });
}

function validateTombstoneDecision(report, key, decision) {
  const base = `$.items[${JSON.stringify(key)}]`;
  if (!isObject(decision)) {
    addError(report, base, 'Tombstone decision entry must be an object.');
    return;
  }
  if (decision.key !== key) {
    addError(report, `${base}.key`, 'Tombstone decision key must match its items map key.');
  }
  if (!TOMBSTONE_ACTIONS.has(decision.action)) {
    addError(report, `${base}.action`, 'Tombstone action must be confirm_global_delete, ignore, restore, or current_platform_only.');
  }
  validateSyncPlatform(report, `${base}.platform`, decision.platform, { allowApple: true });
  validateTimestamp(report, `${base}.decidedAt`, decision.decidedAt, { required: true });
  validateTimestamp(report, `${base}.updatedAt`, decision.updatedAt, { required: true });
  validateTrack(report, `${base}.track`, decision.track, { required: false, platform: decision.platform });
  if (decision.note !== undefined && typeof decision.note !== 'string') {
    addError(report, `${base}.note`, 'Tombstone note must be a string when present.');
  }
}

function validateShortlist(report, shortlist, index) {
  const base = `$.shortlists[${index}]`;
  if (!isObject(shortlist)) {
    addError(report, base, 'Recommendation shortlist entry must be an object.');
    return;
  }
  if (!nonEmptyString(shortlist.id)) {
    addError(report, `${base}.id`, 'Recommendation shortlist id is required.');
  }
  if (!nonEmptyString(shortlist.name)) {
    addError(report, `${base}.name`, 'Recommendation shortlist name is required.');
  }
  validateTimestamp(report, `${base}.createdAt`, shortlist.createdAt, { required: false });
  validateTimestamp(report, `${base}.updatedAt`, shortlist.updatedAt, { required: false });
  if (!Array.isArray(shortlist.tracks)) {
    addError(report, `${base}.tracks`, 'Recommendation shortlist tracks must be an array.');
    return;
  }
  for (let trackIndex = 0; trackIndex < shortlist.tracks.length; trackIndex += 1) {
    validateTrack(report, `${base}.tracks[${trackIndex}]`, shortlist.tracks[trackIndex], { required: true });
  }
}

function validateAgentSession(report, session, index) {
  const base = `$.sessions[${index}]`;
  if (!isObject(session)) {
    addError(report, base, 'Agent session entry must be an object.');
    return;
  }
  if (!nonEmptyString(session.id)) {
    addError(report, `${base}.id`, 'Agent session id is required.');
  }
  validateTimestamp(report, `${base}.startedAt`, session.startedAt, { required: false });
  validateTimestamp(report, `${base}.updatedAt`, session.updatedAt, { required: false });
  if (session.messages !== undefined && !Array.isArray(session.messages)) {
    addError(report, `${base}.messages`, 'Agent session messages must be an array when present.');
  }
  if (session.toolTraces !== undefined && !Array.isArray(session.toolTraces)) {
    addError(report, `${base}.toolTraces`, 'Agent session tool traces must be an array when present.');
  }
  for (let traceIndex = 0; traceIndex < (session.toolTraces || []).length; traceIndex += 1) {
    const trace = session.toolTraces[traceIndex];
    if (!isObject(trace)) {
      addError(report, `${base}.toolTraces[${traceIndex}]`, 'Agent tool trace must be an object.');
      continue;
    }
    if (!nonEmptyString(trace.tool)) {
      addError(report, `${base}.toolTraces[${traceIndex}].tool`, 'Agent tool trace must include a tool name.');
    }
    validateTimestamp(report, `${base}.toolTraces[${traceIndex}].calledAt`, trace.calledAt, { required: false });
    if (trace.readOnly === false && trace.localDraft !== true) {
      addError(report, `${base}.toolTraces[${traceIndex}].readOnly`, 'Agent tool traces must stay read-only unless they are local draft writes.');
    }
    if (trace.localDraft !== undefined && typeof trace.localDraft !== 'boolean') {
      addError(report, `${base}.toolTraces[${traceIndex}].localDraft`, 'Agent tool trace localDraft must be boolean when present.');
    }
    if (trace.mutatesProvider === true) {
      addError(report, `${base}.toolTraces[${traceIndex}].mutatesProvider`, 'Agent tool traces cannot represent direct provider mutations.');
    }
    if (trace.exposesCredentials === true) {
      addError(report, `${base}.toolTraces[${traceIndex}].exposesCredentials`, 'Agent tool traces cannot expose credentials.');
    }
    if (trace.durationMs !== undefined && !isNonNegativeInteger(trace.durationMs)) {
      addError(report, `${base}.toolTraces[${traceIndex}].durationMs`, 'Agent tool trace duration must be a non-negative integer.');
    }
    if (trace.argumentsSummary !== undefined && !isObject(trace.argumentsSummary)) {
      addError(report, `${base}.toolTraces[${traceIndex}].argumentsSummary`, 'Agent tool trace argument summary must be an object when present.');
    }
    if (trace.resultSummary !== undefined && !isObject(trace.resultSummary)) {
      addError(report, `${base}.toolTraces[${traceIndex}].resultSummary`, 'Agent tool trace result summary must be an object when present.');
    }
    if (trace.evidenceRefs !== undefined && !Array.isArray(trace.evidenceRefs)) {
      addError(report, `${base}.toolTraces[${traceIndex}].evidenceRefs`, 'Agent tool trace evidence refs must be an array when present.');
    }
    if (trace.feedback !== undefined) {
      if (!isObject(trace.feedback)) {
        addError(report, `${base}.toolTraces[${traceIndex}].feedback`, 'Agent tool trace feedback must be an object when present.');
      } else {
        if (!AGENT_TRACE_FEEDBACK_LABELS.has(trace.feedback.label)) {
          addError(report, `${base}.toolTraces[${traceIndex}].feedback.label`, 'Agent tool trace feedback label is not supported.');
        }
        validateTimestamp(report, `${base}.toolTraces[${traceIndex}].feedback.updatedAt`, trace.feedback.updatedAt, { required: true });
        if (trace.feedback.source !== undefined && !nonEmptyString(trace.feedback.source)) {
          addError(report, `${base}.toolTraces[${traceIndex}].feedback.source`, 'Agent tool trace feedback source must be a non-empty string when present.');
        }
      }
    }
  }
}

function validateSyncSummary(report, summary, expected) {
  for (const key of SYNC_SUMMARY_KEYS) {
    if (summary[key] === undefined) {
      addError(report, `$.summary.${key}`, 'Sync preview summary field is required.');
      continue;
    }
    if (!isNonNegativeInteger(summary[key])) {
      addError(report, `$.summary.${key}`, 'Sync preview summary field must be a non-negative integer.');
      continue;
    }
    if (summary[key] !== expected[key]) {
      addError(report, `$.summary.${key}`, `Summary mismatch: expected ${expected[key]}, got ${summary[key]}.`);
    }
  }

  for (const key of ['baselineAdded', 'baselineDeleted', 'tombstoneCandidates']) {
    if (summary[key] === undefined) continue;
    if (!isNonNegativeInteger(summary[key])) {
      addError(report, `$.summary.${key}`, 'Sync preview summary field must be a non-negative integer.');
    }
  }
}

function validatePlanSummary(report, summary, expected) {
  for (const key of PLAN_SUMMARY_KEYS) {
    if (summary[key] === undefined) {
      addWarning(report, `$.summary.${key}`, 'Summary field is missing; it will be required in the next schema version.');
      continue;
    }
    if (!isNonNegativeInteger(summary[key])) {
      addError(report, `$.summary.${key}`, 'Summary field must be a non-negative integer.');
      continue;
    }
    if (summary[key] !== expected[key]) {
      addError(report, `$.summary.${key}`, `Summary mismatch: expected ${expected[key]}, got ${summary[key]}.`);
    }
  }

  for (const key of ['resolvedAdds', 'unresolvedAdds']) {
    if (summary[key] === undefined) continue;
    if (!isNonNegativeInteger(summary[key])) {
      addError(report, `$.summary.${key}`, 'Summary field must be a non-negative integer.');
    } else if (summary[key] !== expected[key]) {
      addError(report, `$.summary.${key}`, `Summary mismatch: expected ${expected[key]}, got ${summary[key]}.`);
    }
  }
}

function validateMirrorRun(report, run, index) {
  const base = `$.runs[${index}]`;
  if (!isObject(run)) {
    addError(report, base, 'Mirror run entry must be an object.');
    return;
  }

  validateTimestamp(report, `${base}.ranAt`, run.ranAt, { required: true });
  validateTimestamp(report, `${base}.startedAt`, run.startedAt, { required: false });
  validateTimestamp(report, `${base}.completedAt`, run.completedAt, { required: false });
  validateTimestamp(report, `${base}.failedAt`, run.failedAt, { required: false });
  if (!TARGET_PLATFORMS.has(run.target)) {
    addError(report, `${base}.target`, 'Mirror run target must be qq or netease.');
  }
  if (typeof run.dryRun !== 'boolean') {
    addError(report, `${base}.dryRun`, 'Mirror run dryRun must be boolean.');
  }
  if (run.status !== undefined && !RUN_STATUSES.has(run.status)) {
    addError(report, `${base}.status`, 'Mirror run status must be preview, running, completed, or failed.');
  }
  if (run.runId !== undefined && !nonEmptyString(run.runId)) {
    addError(report, `${base}.runId`, 'Mirror run id must be non-empty when present.');
  }
  if (run.idempotencyKey !== undefined && !/^[a-f0-9]{64}$/i.test(String(run.idempotencyKey))) {
    addError(report, `${base}.idempotencyKey`, 'Mirror run idempotency key must be a SHA-256 hex string when present.');
  }
  if (run.operationKeys !== undefined) {
    validateOperationKeySet(report, `${base}.operationKeys`, run.operationKeys);
  }

  validateCounterObject(report, `${base}.add`, run.add, ['requested', 'executable', 'blocked']);
  validateCounterObject(report, `${base}.remove`, run.remove, ['requested', 'executable', 'blocked', 'destructive']);
  validateCounterObject(report, `${base}.review`, run.review, ['blocked']);
  validateCounterObject(report, `${base}.addResult`, run.addResult, ['requested', 'submitted', 'accepted']);
  validateCounterObject(report, `${base}.removeResult`, run.removeResult, ['requested', 'submitted', 'accepted']);
  validateCounterObject(report, `${base}.blocked`, run.blocked, ['unresolvedAdds', 'invalidRemoves', 'reviewItems']);
}

function validateSyncRun(report, run, index) {
  const base = `$.runs[${index}]`;
  if (!isObject(run)) {
    addError(report, base, 'Sync run entry must be an object.');
    return;
  }

  validateTimestamp(report, `${base}.ranAt`, run.ranAt, { required: true });
  validateTimestamp(report, `${base}.startedAt`, run.startedAt, { required: false });
  validateTimestamp(report, `${base}.completedAt`, run.completedAt, { required: false });
  validateTimestamp(report, `${base}.failedAt`, run.failedAt, { required: false });
  validateTimestamp(report, `${base}.planGeneratedAt`, run.planGeneratedAt, { required: false });
  validatePolicyId(report, `${base}.policy`, run.policy);
  if (!['add', 'remove'].includes(run.action)) {
    addError(report, `${base}.action`, 'Sync run action must be add or remove.');
  }
  if (!TARGET_PLATFORMS.has(run.target)) {
    addError(report, `${base}.target`, 'Sync run target must be qq or netease.');
  }
  if (typeof run.dryRun !== 'boolean') {
    addError(report, `${base}.dryRun`, 'Sync run dryRun must be boolean.');
  }
  if (run.status !== undefined && !RUN_STATUSES.has(run.status)) {
    addError(report, `${base}.status`, 'Sync run status must be preview, running, completed, or failed.');
  }
  if (run.runId !== undefined && !nonEmptyString(run.runId)) {
    addError(report, `${base}.runId`, 'Sync run id must be non-empty when present.');
  }
  if (run.idempotencyKey !== undefined && !/^[a-f0-9]{64}$/i.test(String(run.idempotencyKey))) {
    addError(report, `${base}.idempotencyKey`, 'Sync run idempotency key must be a SHA-256 hex string when present.');
  }
  if (run.operationKeys !== undefined) {
    validateOperationKeySet(report, `${base}.operationKeys`, run.operationKeys);
  }

  validateCounterObject(report, `${base}.add`, run.add, ['requested', 'executable', 'blocked']);
  validateCounterObject(report, `${base}.remove`, run.remove, ['requested', 'executable', 'blocked', 'destructive']);
  validateCounterObject(report, `${base}.review`, run.review, ['blocked']);
  validateCounterObject(report, `${base}.addResult`, run.addResult, ['requested', 'submitted', 'accepted']);
  validateCounterObject(report, `${base}.removeResult`, run.removeResult, ['requested', 'submitted', 'accepted']);
  validateCounterObject(report, `${base}.blocked`, run.blocked, ['unresolvedAdds', 'invalidRemoves', 'reviewItems']);
}

function validateOperationKeySet(report, path, value) {
  if (!isObject(value)) {
    addError(report, path, 'Mirror run operation keys must be an object when present.');
    return;
  }
  for (const key of ['add', 'remove', 'blockedAdd', 'blockedRemove', 'review']) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key])) {
      addError(report, `${path}.${key}`, 'Mirror run operation key bucket must be an array.');
      continue;
    }
    for (let index = 0; index < value[key].length; index += 1) {
      if (!/^[a-f0-9]{64}$/i.test(String(value[key][index] || ''))) {
        addError(report, `${path}.${key}[${index}]`, 'Mirror operation key must be a SHA-256 hex string.');
      }
    }
  }
}

function validateMirrorDecision(report, key, decision) {
  const base = `$.items[${JSON.stringify(key)}]`;
  if (!isObject(decision)) {
    addError(report, base, 'Mirror decision entry must be an object.');
    return;
  }
  if (!nonEmptyString(key)) {
    addError(report, base, 'Mirror decision key must be non-empty.');
  }
  if (decision.key !== key) {
    addError(report, `${base}.key`, 'Mirror decision key must match its items map key.');
  }
  if (!MIRROR_DECISION_ACTIONS.has(decision.action)) {
    addError(report, `${base}.action`, 'Mirror decision action must be keep or separate.');
  }
  if (!TARGET_PLATFORMS.has(decision.target)) {
    addError(report, `${base}.target`, 'Mirror decision target must be qq or netease.');
  }
  validateTimestamp(report, `${base}.updatedAt`, decision.updatedAt, { required: true });
  validateTimestamp(report, `${base}.decidedAt`, decision.decidedAt, { required: true });
  if (decision.note !== undefined && typeof decision.note !== 'string') {
    addError(report, `${base}.note`, 'Mirror decision note must be a string when present.');
  }
  if (decision.batchId !== undefined && typeof decision.batchId !== 'string') {
    addError(report, `${base}.batchId`, 'Mirror decision batch id must be a string when present.');
  }
}

function validateCounterObject(report, path, value, requiredKeys) {
  if (!isObject(value)) {
    addError(report, path, 'Expected an object with numeric counters.');
    return;
  }
  for (const key of requiredKeys) {
    if (!isNonNegativeInteger(value[key])) {
      addError(report, `${path}.${key}`, 'Expected a non-negative integer counter.');
    }
  }
}

function validatePolicyId(report, path, policy) {
  if (!SYNC_POLICIES.has(policy)) {
    addError(report, path, 'Sync policy must be canonical_mirror, union_convergence, managed_bidirectional, or read_only_analysis.');
  }
}

function validatePlatformArray(report, path, platforms, options = {}) {
  if (platforms === undefined || platforms === null) {
    if (options.required) addError(report, path, 'Platform list is required.');
    return;
  }
  if (!Array.isArray(platforms)) {
    addError(report, path, 'Platform list must be an array.');
    return;
  }
  if (options.required && platforms.length === 0) {
    addError(report, path, 'Platform list must not be empty.');
  }
  const seen = new Set();
  for (let index = 0; index < platforms.length; index += 1) {
    const platform = platforms[index];
    validateSyncPlatform(report, `${path}[${index}]`, platform, options);
    if (seen.has(platform)) addError(report, `${path}[${index}]`, 'Platform list must not contain duplicates.');
    seen.add(platform);
  }
}

function validateSyncPlatform(report, path, platform, options = {}) {
  if (!SYNC_PLATFORMS.has(platform)) {
    addError(report, path, 'Sync platform must be apple, qq, or netease.');
    return;
  }
  if (platform === 'apple' && options.allowApple === false) {
    addError(report, path, 'Apple is not a writable sync target yet.');
  }
}

function validateTrack(report, path, track, options = {}) {
  if (track === undefined || track === null) {
    if (options.required) addError(report, path, 'Track object is required.');
    return;
  }
  if (!isObject(track)) {
    addError(report, path, 'Track must be an object when present.');
    return;
  }
  if (options.platform && track.platform && track.platform !== options.platform) {
    addError(report, `${path}.platform`, `Expected platform ${options.platform}.`);
  }
  if (options.idRequired && !nonEmptyString(track.id)) {
    addError(report, path, 'Track must include id for destructive target mutation.');
  }
  if (!nonEmptyString(track.title)) {
    addWarning(report, `${path}.title`, 'Track title is missing.');
  }
}

function validateNoSecrets(report, path, value, seen = new Set()) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (/\b(?:MUSIC_U|qm_keyst|DEEPSEEK_API_KEY)\s*=/iu.test(value) || /\bBearer\s+[A-Za-z0-9._-]{8,}/u.test(value) || /\bsk-[A-Za-z0-9]{8,}/u.test(value)) {
      addError(report, path, 'State must not contain credential-shaped values.');
    }
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateNoSecrets(report, `${path}[${index}]`, value[index], seen);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeStateKey(key);
    const childPath = path === '$' ? `$.${key}` : `${path}.${key}`;
    if (SECRET_FIELD_NAMES.has(normalized)) {
      addError(report, childPath, 'State must not contain secret or credential fields.');
      continue;
    }
    if (RAW_AI_OR_PROVIDER_FIELDS.has(normalized)) {
      addError(report, childPath, 'State must not persist raw AI or provider payload fields by default.');
      continue;
    }
    validateNoSecrets(report, childPath, child, seen);
  }
}

function validateVersion(report, path, actual, expected) {
  if (actual !== expected) {
    addError(report, path, `Expected schema version ${expected}.`);
  }
}

function validateTimestamp(report, path, value, options = {}) {
  if (value === undefined || value === null || value === '') {
    if (options.required) addError(report, path, 'Timestamp is required.');
    return;
  }
  if (Number.isNaN(Date.parse(value))) {
    addError(report, path, 'Timestamp must be parseable as an ISO date.');
  }
}

function createReport(kind) {
  return {
    kind,
    ok: false,
    errors: [],
    warnings: [],
  };
}

function finish(report) {
  report.ok = report.errors.length === 0;
  return report;
}

function addError(report, path, message) {
  report.errors.push({ path, message });
}

function addWarning(report, path, message) {
  report.warnings.push({ path, message });
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeStateKey(key) {
  return String(key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}
