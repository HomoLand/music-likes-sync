export const AUTO_SYNC_STATE_VERSION = 1;
export const AUTO_SYNC_RUN_LOG_VERSION = 1;
export const AUTO_SYNC_MIN_INTERVAL_MINUTES = 15;
export const AUTO_SYNC_MAX_INTERVAL_MINUTES = 24 * 60;
export const AUTO_SYNC_DEFAULT_INTERVAL_MINUTES = 60;
export const AUTO_SYNC_DEFAULT_MAX_SOURCE_AGE_MINUTES = 24 * 60;
export const AUTO_SYNC_MAX_SOURCE_AGE_MINUTES = 7 * 24 * 60;
export const AUTO_SYNC_MAX_APPLE_DROP_RATIO = 0.25;
export const AUTO_SYNC_MIN_APPLE_DROP_COUNT = 25;

const TARGETS = new Set(['qq', 'netease']);

export function defaultAutoSyncState(now = new Date().toISOString()) {
  return {
    version: AUTO_SYNC_STATE_VERSION,
    updatedAt: now,
    enabled: false,
    intervalMinutes: AUTO_SYNC_DEFAULT_INTERVAL_MINUTES,
    targets: ['qq', 'netease'],
    refreshApple: true,
    refreshTargets: true,
    autoExecuteAdditions: true,
    requireBaseline: true,
    maxSourceAgeMinutes: AUTO_SYNC_DEFAULT_MAX_SOURCE_AGE_MINUTES,
    nextRunAt: '',
    lastRunAt: '',
    lastStatus: 'never',
    lastMessage: '',
    lastRunId: '',
  };
}

export function normalizeAutoSyncState(input = {}, current = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const base = {
    ...defaultAutoSyncState(now),
    ...current,
    ...input,
  };
  const enabled = Boolean(base.enabled);
  const intervalMinutes = clampInteger(
    base.intervalMinutes,
    AUTO_SYNC_DEFAULT_INTERVAL_MINUTES,
    AUTO_SYNC_MIN_INTERVAL_MINUTES,
    AUTO_SYNC_MAX_INTERVAL_MINUTES,
  );
  const targets = normalizeTargets(base.targets);
  const scheduleChanged = Boolean(options.reschedule)
    || (hasOwn(input, 'enabled') && enabled !== Boolean(current.enabled))
    || (hasOwn(input, 'intervalMinutes') && intervalMinutes !== normalizedInterval(current.intervalMinutes))
    || (hasOwn(input, 'targets') && targets.join(',') !== normalizeTargets(current.targets).join(','));
  const nextRunAt = enabled
    ? scheduleChanged
      ? new Date(Date.parse(now) + intervalMinutes * 60 * 1000).toISOString()
      : normalizeFutureTimestamp(base.nextRunAt, now, intervalMinutes)
    : '';
  return {
    version: AUTO_SYNC_STATE_VERSION,
    updatedAt: now,
    enabled,
    intervalMinutes,
    targets,
    refreshApple: base.refreshApple !== false,
    refreshTargets: base.refreshTargets !== false,
    autoExecuteAdditions: base.autoExecuteAdditions !== false,
    requireBaseline: base.requireBaseline !== false,
    maxSourceAgeMinutes: clampInteger(
      base.maxSourceAgeMinutes,
      AUTO_SYNC_DEFAULT_MAX_SOURCE_AGE_MINUTES,
      60,
      AUTO_SYNC_MAX_SOURCE_AGE_MINUTES,
    ),
    nextRunAt,
    lastRunAt: validTimestamp(base.lastRunAt) ? base.lastRunAt : '',
    lastStatus: String(base.lastStatus || 'never'),
    lastMessage: String(base.lastMessage || '').slice(0, 500),
    lastRunId: String(base.lastRunId || '').slice(0, 120),
  };
}

export function nextAutoSyncRunAt(state, from = new Date().toISOString()) {
  if (!state?.enabled) return '';
  const intervalMinutes = clampInteger(
    state.intervalMinutes,
    AUTO_SYNC_DEFAULT_INTERVAL_MINUTES,
    AUTO_SYNC_MIN_INTERVAL_MINUTES,
    AUTO_SYNC_MAX_INTERVAL_MINUTES,
  );
  return new Date(Date.parse(from) + intervalMinutes * 60 * 1000).toISOString();
}

export function isAutoSyncDue(state, now = new Date().toISOString()) {
  if (!state?.enabled) return false;
  const next = Date.parse(state.nextRunAt || '');
  return Number.isNaN(next) || next <= Date.parse(now);
}

export function emptyAutoSyncRunLog() {
  return {
    version: AUTO_SYNC_RUN_LOG_VERSION,
    updatedAt: '',
    runs: [],
  };
}

export function appendAutoSyncRun(log, run, options = {}) {
  const limit = clampInteger(options.limit, 50, 1, 200);
  return {
    version: AUTO_SYNC_RUN_LOG_VERSION,
    updatedAt: run.completedAt || run.startedAt || new Date().toISOString(),
    runs: [run, ...(log?.runs || []).filter((entry) => entry.id !== run.id)].slice(0, limit),
  };
}

export function summarizeAutoSync(state, log, options = {}) {
  const latest = log?.runs?.[0] || null;
  return {
    enabled: Boolean(state?.enabled),
    running: Boolean(options.running),
    intervalMinutes: Number(state?.intervalMinutes || AUTO_SYNC_DEFAULT_INTERVAL_MINUTES),
    targets: Array.isArray(state?.targets) ? state.targets : [],
    refreshApple: state?.refreshApple !== false,
    refreshTargets: state?.refreshTargets !== false,
    autoExecuteAdditions: state?.autoExecuteAdditions !== false,
    requireBaseline: state?.requireBaseline !== false,
    maxSourceAgeMinutes: Number(state?.maxSourceAgeMinutes || AUTO_SYNC_DEFAULT_MAX_SOURCE_AGE_MINUTES),
    nextRunAt: state?.nextRunAt || '',
    lastRunAt: state?.lastRunAt || latest?.completedAt || latest?.startedAt || '',
    lastStatus: options.running ? 'running' : state?.lastStatus || latest?.status || 'never',
    lastMessage: state?.lastMessage || latest?.message || '',
    lastRunId: state?.lastRunId || latest?.id || '',
    historyCount: Array.isArray(log?.runs) ? log.runs.length : 0,
    latest: latest ? summarizeAutoSyncRun(latest) : null,
  };
}

export function summarizeAutoSyncRun(run) {
  if (!run) return null;
  return {
    id: run.id || '',
    trigger: run.trigger || '',
    status: run.status || '',
    startedAt: run.startedAt || '',
    completedAt: run.completedAt || '',
    policy: run.policy || '',
    targets: run.targets || [],
    dryRun: Boolean(run.dryRun),
    message: run.message || '',
    snapshotRefresh: run.snapshotRefresh || {},
    preview: run.preview || {},
    additions: run.additions || {},
    deletionSignals: Number(run.deletionSignals || 0),
    convergence: run.convergence || null,
    error: run.error || '',
  };
}

export function assessAppleAutoSyncCapture(capture, reference = {}) {
  const count = Array.isArray(capture?.tracks) ? capture.tracks.length : 0;
  const method = String(capture?.method || '');
  const source = String(capture?.source || capture?.url || '');
  const referenceCount = Math.max(0, Number(reference.count || 0));
  const referenceSource = String(reference.source || '');

  if (method !== 'musickit-api') {
    return appleCaptureFailure(
      'apple_capture_not_authoritative',
      'Apple 自动刷新只接受 MusicKit API 的完整结果；页面列表抓取仅可用于手动导入。',
      { count, method, source, referenceCount },
    );
  }
  if (!count) {
    return appleCaptureFailure(
      'apple_capture_empty',
      'Apple MusicKit API 没有返回歌曲，已停止自动刷新。',
      { count, method, source, referenceCount },
    );
  }
  if (referenceSource && source && appleSourceIdentity(referenceSource) !== appleSourceIdentity(source)) {
    return appleCaptureFailure(
      'apple_capture_source_changed',
      'Apple 自动刷新打开的歌单与最近可信来源不一致，已停止刷新。',
      { count, method, source, referenceCount },
    );
  }

  const dropCount = Math.max(0, referenceCount - count);
  const dropRatio = referenceCount > 0 ? dropCount / referenceCount : 0;
  if (dropCount >= AUTO_SYNC_MIN_APPLE_DROP_COUNT && dropRatio > AUTO_SYNC_MAX_APPLE_DROP_RATIO) {
    return appleCaptureFailure(
      'apple_capture_large_drop',
      `Apple Music 歌曲数从最近可信的 ${referenceCount} 首降到 ${count} 首，已暂停自动刷新并等待人工确认。`,
      { count, method, source, referenceCount, dropCount, dropRatio },
    );
  }

  return {
    ok: true,
    code: 'ok',
    message: '',
    count,
    method,
    source,
    referenceCount,
    dropCount,
    dropRatio,
  };
}

function normalizeTargets(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const targets = [...new Set(list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];
  if (!targets.length) return ['qq', 'netease'];
  for (const target of targets) {
    if (!TARGETS.has(target)) throw new Error(`Unsupported auto-sync target: ${target}`);
  }
  return ['qq', 'netease'].filter((target) => targets.includes(target));
}

function normalizeFutureTimestamp(value, now, intervalMinutes) {
  if (validTimestamp(value) && Date.parse(value) > Date.parse(now)) return value;
  return new Date(Date.parse(now) + intervalMinutes * 60 * 1000).toISOString();
}

function validTimestamp(value) {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

function appleCaptureFailure(code, message, details) {
  return { ok: false, code, message, ...details };
}

function appleSourceIdentity(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    const playlistId = segments.findLast((segment) => /^pl[.-]/i.test(segment));
    return playlistId ? `playlist:${playlistId}` : `${url.hostname}${url.pathname}`.toLowerCase();
  } catch {
    return String(value || '').trim().toLowerCase();
  }
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizedInterval(value) {
  return clampInteger(
    value,
    AUTO_SYNC_DEFAULT_INTERVAL_MINUTES,
    AUTO_SYNC_MIN_INTERVAL_MINUTES,
    AUTO_SYNC_MAX_INTERVAL_MINUTES,
  );
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
