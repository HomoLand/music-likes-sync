import {
  AGENT_SESSIONS_STATE_SCHEMA_VERSION,
  AI_PROVIDER_STATE_SCHEMA_VERSION,
  MIRROR_DECISION_SCHEMA_VERSION,
  MIRROR_PLAN_SCHEMA_VERSION,
  MIRROR_RUN_LOG_SCHEMA_VERSION,
  MUSIC_PROFILE_STATE_SCHEMA_VERSION,
  RECOMMENDATION_SHORTLISTS_STATE_SCHEMA_VERSION,
  SYNC_BASELINE_STATE_SCHEMA_VERSION,
  SYNC_POLICY_STATE_SCHEMA_VERSION,
  SYNC_PREVIEW_STATE_SCHEMA_VERSION,
  SYNC_RUN_LOG_STATE_SCHEMA_VERSION,
  SYNC_TOMBSTONE_STATE_SCHEMA_VERSION,
  summarizeMirrorOperations,
  validateAgentSessionsState,
  validateAiProviderState,
  validateMusicProfileState,
  validateMirrorDecisionState,
  validateMirrorPlan,
  validateMirrorRunLog,
  validateRecommendationShortlistsState,
  validateSyncBaselineState,
  validateSyncPolicyState,
  validateSyncPreviewState,
  validateSyncRunLogState,
  validateSyncTombstoneState,
} from './state-schema.js';

export const MIRROR_STATE_KINDS = ['mirror-plan', 'mirror-runs', 'mirror-decisions'];
export const SYNC_STATE_KINDS = [
  'sync-policy',
  'sync-baseline',
  'sync-preview',
  'sync-tombstones',
  'sync-runs',
  'ai-provider-state',
  'music-profile',
  'recommendation-shortlists',
  'agent-sessions',
];
export const STATE_KINDS = [...MIRROR_STATE_KINDS, ...SYNC_STATE_KINDS];

const STATE_CONFIG = {
  'mirror-plan': {
    currentVersion: MIRROR_PLAN_SCHEMA_VERSION,
    validate: validateMirrorPlan,
    migrateLegacy: migrateLegacyMirrorPlan,
    repairCurrent: repairMirrorPlan,
  },
  'mirror-runs': {
    currentVersion: MIRROR_RUN_LOG_SCHEMA_VERSION,
    validate: validateMirrorRunLog,
    migrateLegacy: migrateLegacyMirrorRunLog,
  },
  'mirror-decisions': {
    currentVersion: MIRROR_DECISION_SCHEMA_VERSION,
    validate: validateMirrorDecisionState,
    migrateLegacy: migrateLegacyMirrorDecisionState,
  },
  'sync-policy': {
    currentVersion: SYNC_POLICY_STATE_SCHEMA_VERSION,
    validate: validateSyncPolicyState,
    migrateLegacy: migrateLegacySyncPolicyState,
  },
  'sync-baseline': {
    currentVersion: SYNC_BASELINE_STATE_SCHEMA_VERSION,
    validate: validateSyncBaselineState,
    migrateLegacy: migrateLegacySyncBaselineState,
  },
  'sync-preview': {
    currentVersion: SYNC_PREVIEW_STATE_SCHEMA_VERSION,
    validate: validateSyncPreviewState,
    migrateLegacy: migrateLegacySyncPreviewState,
  },
  'sync-tombstones': {
    currentVersion: SYNC_TOMBSTONE_STATE_SCHEMA_VERSION,
    validate: validateSyncTombstoneState,
    migrateLegacy: migrateLegacySyncTombstoneState,
  },
  'sync-runs': {
    currentVersion: SYNC_RUN_LOG_STATE_SCHEMA_VERSION,
    validate: validateSyncRunLogState,
    migrateLegacy: migrateLegacySyncRunLogState,
  },
  'ai-provider-state': {
    currentVersion: AI_PROVIDER_STATE_SCHEMA_VERSION,
    validate: validateAiProviderState,
    migrateLegacy: migrateLegacyUpdatedAtState,
  },
  'music-profile': {
    currentVersion: MUSIC_PROFILE_STATE_SCHEMA_VERSION,
    validate: validateMusicProfileState,
    migrateLegacy: migrateLegacyUpdatedAtState,
  },
  'recommendation-shortlists': {
    currentVersion: RECOMMENDATION_SHORTLISTS_STATE_SCHEMA_VERSION,
    validate: validateRecommendationShortlistsState,
    migrateLegacy: migrateLegacyUpdatedAtState,
  },
  'agent-sessions': {
    currentVersion: AGENT_SESSIONS_STATE_SCHEMA_VERSION,
    validate: validateAgentSessionsState,
    migrateLegacy: migrateLegacyUpdatedAtState,
  },
};

export function migrateMirrorState(kind, state, options = {}) {
  const config = STATE_CONFIG[kind];
  if (!config) {
    return migrationFailure(kind, state?.version, [`Unsupported mirror state kind: ${kind}.`]);
  }
  if (!isObject(state)) {
    return migrationFailure(kind, undefined, [`${kind} state must be a JSON object.`]);
  }

  const originalVersion = state.version ?? null;
  let migrated = state;
  let changed = false;

  if (state.version === undefined || state.version === null) {
    const legacy = config.migrateLegacy(state, options);
    if (!legacy.ok) return migrationFailure(kind, originalVersion, legacy.errors);
    migrated = legacy.state;
    changed = true;
  } else if (!Number.isInteger(state.version)) {
    return migrationFailure(kind, originalVersion, [`${kind} schema version must be an integer.`]);
  } else if (state.version > config.currentVersion) {
    return migrationFailure(kind, originalVersion, [
      `${kind} schema version ${state.version} is newer than this tool supports (${config.currentVersion}).`,
    ]);
  } else if (state.version < config.currentVersion) {
    return migrationFailure(kind, originalVersion, [
      `No migration path from ${kind} schema version ${state.version} to ${config.currentVersion}.`,
    ]);
  }

  if (config.repairCurrent) {
    const repair = config.repairCurrent(migrated, options);
    migrated = repair.state;
    changed = changed || repair.changed;
  }

  const validation = config.validate(migrated);
  return {
    kind,
    ok: validation.ok,
    changed,
    originalVersion,
    version: migrated.version,
    state: migrated,
    errors: validation.errors,
    warnings: validation.warnings,
    validation,
  };
}

export function migrateMirrorStateBundle(state = {}, options = {}) {
  const reports = [];
  if (state.mirrorPlan !== undefined) reports.push(migrateMirrorState('mirror-plan', state.mirrorPlan, options));
  if (state.mirrorRuns !== undefined) reports.push(migrateMirrorState('mirror-runs', state.mirrorRuns, options));
  if (state.mirrorDecisions !== undefined) reports.push(migrateMirrorState('mirror-decisions', state.mirrorDecisions, options));
  return {
    ok: reports.every((report) => report.ok),
    changed: reports.some((report) => report.changed),
    reports,
  };
}

export function migrateState(kind, state, options = {}) {
  return migrateMirrorState(kind, state, options);
}

export function migrateStateBundle(state = {}, options = {}) {
  const reports = [];
  reports.push(...migrateMirrorStateBundle(state, options).reports);
  if (state.syncPolicy !== undefined) reports.push(migrateMirrorState('sync-policy', state.syncPolicy, options));
  if (state.syncBaseline !== undefined) reports.push(migrateMirrorState('sync-baseline', state.syncBaseline, options));
  if (state.syncPreview !== undefined) reports.push(migrateMirrorState('sync-preview', state.syncPreview, options));
  if (state.syncTombstones !== undefined) reports.push(migrateMirrorState('sync-tombstones', state.syncTombstones, options));
  if (state.syncRuns !== undefined) reports.push(migrateMirrorState('sync-runs', state.syncRuns, options));
  if (state.aiProviderState !== undefined) reports.push(migrateMirrorState('ai-provider-state', state.aiProviderState, options));
  if (state.musicProfile !== undefined) reports.push(migrateMirrorState('music-profile', state.musicProfile, options));
  if (state.recommendationShortlists !== undefined) reports.push(migrateMirrorState('recommendation-shortlists', state.recommendationShortlists, options));
  if (state.agentSessions !== undefined) reports.push(migrateMirrorState('agent-sessions', state.agentSessions, options));
  return {
    ok: reports.every((report) => report.ok),
    changed: reports.some((report) => report.changed),
    reports,
  };
}

function migrateLegacyMirrorPlan(state) {
  if (state.mode !== 'source_of_truth_mirror' || !Array.isArray(state.operations)) {
    return legacyFailure('Legacy mirror plan must include source_of_truth_mirror mode and operations.');
  }
  return {
    ok: true,
    state: {
      ...state,
      version: MIRROR_PLAN_SCHEMA_VERSION,
    },
  };
}

function repairMirrorPlan(state) {
  if (!Array.isArray(state.operations)) {
    return { state, changed: false };
  }

  let changed = false;
  const operations = state.operations.map((operation) => {
    if (!isObject(operation)) return operation;
    if (
      operation.action === 'add'
      && operation.status === 'ready'
      && !operation.resolvedTargetTrack
      && !operation.targetTrack
    ) {
      changed = true;
      return {
        ...operation,
        status: 'needs_resolution',
      };
    }
    return operation;
  });

  if (!changed) return { state, changed: false };
  return {
    state: {
      ...state,
      operations,
      summary: summarizeMirrorOperations(operations),
    },
    changed: true,
  };
}

function migrateLegacyMirrorRunLog(state, options = {}) {
  if (!Array.isArray(state.runs)) {
    return legacyFailure('Legacy mirror run log must include a runs array.');
  }
  return {
    ok: true,
    state: {
      ...state,
      version: MIRROR_RUN_LOG_SCHEMA_VERSION,
      updatedAt: state.updatedAt || inferRunLogUpdatedAt(state.runs) || options.now || new Date().toISOString(),
    },
  };
}

function migrateLegacyMirrorDecisionState(state, options = {}) {
  if (!isObject(state.items)) {
    return legacyFailure('Legacy mirror decision state must include an items object.');
  }
  return {
    ok: true,
    state: {
      ...state,
      version: MIRROR_DECISION_SCHEMA_VERSION,
      updatedAt: state.updatedAt || inferDecisionStateUpdatedAt(state.items) || options.now || new Date().toISOString(),
    },
  };
}

function migrateLegacySyncPolicyState(state, options = {}) {
  if (!state.policy || !Array.isArray(state.participants)) {
    return legacyFailure('Legacy sync policy state must include policy and participants.');
  }
  return {
    ok: true,
    state: {
      ...state,
      version: SYNC_POLICY_STATE_SCHEMA_VERSION,
      updatedAt: state.updatedAt || options.now || new Date().toISOString(),
    },
  };
}

function migrateLegacySyncBaselineState(state, options = {}) {
  if (!isObject(state.platforms)) {
    return legacyFailure('Legacy sync baseline state must include platforms.');
  }
  return {
    ok: true,
    state: {
      ...state,
      version: SYNC_BASELINE_STATE_SCHEMA_VERSION,
      savedAt: state.savedAt || options.now || new Date().toISOString(),
    },
  };
}

function migrateLegacySyncPreviewState(state, options = {}) {
  if (state.mode !== 'policy_sync' || !Array.isArray(state.operations)) {
    return legacyFailure('Legacy sync preview state must include policy_sync mode and operations.');
  }
  return {
    ok: true,
    state: {
      ...state,
      version: SYNC_PREVIEW_STATE_SCHEMA_VERSION,
      generatedAt: state.generatedAt || options.now || new Date().toISOString(),
    },
  };
}

function migrateLegacySyncTombstoneState(state, options = {}) {
  if (!isObject(state.items)) {
    return legacyFailure('Legacy sync tombstone state must include items.');
  }
  return {
    ok: true,
    state: {
      ...state,
      version: SYNC_TOMBSTONE_STATE_SCHEMA_VERSION,
      updatedAt: state.updatedAt || inferDecisionStateUpdatedAt(state.items) || options.now || new Date().toISOString(),
    },
  };
}

function migrateLegacySyncRunLogState(state, options = {}) {
  if (!Array.isArray(state.runs)) {
    return legacyFailure('Legacy sync run log must include a runs array.');
  }
  return {
    ok: true,
    state: {
      ...state,
      version: SYNC_RUN_LOG_STATE_SCHEMA_VERSION,
      updatedAt: state.updatedAt || inferRunLogUpdatedAt(state.runs) || options.now || new Date().toISOString(),
    },
  };
}

function migrateLegacyUpdatedAtState(state, options = {}) {
  return {
    ok: true,
    state: {
      ...state,
      version: 1,
      updatedAt: state.updatedAt || options.now || new Date().toISOString(),
    },
  };
}

function inferRunLogUpdatedAt(runs) {
  return latestIsoDate(
    runs.flatMap((run) => [
      run?.failedAt,
      run?.completedAt,
      run?.startedAt,
      run?.ranAt,
    ]),
  );
}

function inferDecisionStateUpdatedAt(items) {
  return latestIsoDate(
    Object.values(items).flatMap((decision) => [
      decision?.updatedAt,
      decision?.decidedAt,
    ]),
  );
}

function latestIsoDate(values) {
  const dates = values
    .map((value) => Date.parse(value))
    .filter((value) => !Number.isNaN(value));
  if (dates.length === 0) return '';
  return new Date(Math.max(...dates)).toISOString();
}

function legacyFailure(message) {
  return {
    ok: false,
    errors: [message],
  };
}

function migrationFailure(kind, originalVersion, messages) {
  return {
    kind,
    ok: false,
    changed: false,
    originalVersion: originalVersion ?? null,
    version: originalVersion ?? null,
    state: null,
    errors: messages.map((message) => ({ path: '$.version', message })),
    warnings: [],
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
