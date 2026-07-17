import type {
  AgentChatResult,
  AgentFeedbackLabel,
  AgentSessionsResult,
  AgentTraceFeedbackResult,
  AiProviderSummary,
  AiProviderTestResult,
  BaselineSaveResult,
  BrowserConnectionStatus,
  ConvergenceSummary,
  DeleteConfirmationResult,
  ExecutionActionSummary,
  LiveValidationSummary,
  LiveValidationRunResult,
  MusicCandidateSummary,
  MusicProfileResult,
  NamedCountSummary,
  RecommendationResult,
  SimilarTracksResult,
  AdditionDecisionAction,
  AdditionDecisionResult,
  IdentityDecisionAction,
  IdentityDecisionResult,
  AddDecisionSummary,
  AddResolutionSummary,
  AppStateSummary,
  AutoSyncRunSummary,
  AutoSyncStateResult,
  AutoSyncSummary,
  AppleConnectionResult,
  ConnectionActionResult,
  NeteaseQrSession,
  NeteaseQrStatus,
  PlatformKey,
  PlatformStatus,
  PlatformSummary,
  QQBrowserLoginResult,
  QQQrSession,
  QQPlaylistSummary,
  QQPlaylistsResult,
  PreviewBucketId,
  PreviewBucketSummary,
  PreviewTrackItem,
  ResolveAdditionsResult,
  ReviewAdditionsResult,
  ReviewIdentityResult,
  SyncConvergenceResult,
  SyncExecutionResult,
  SyncCheckResult,
  SyncBackupCreateResult,
  SyncBackupRestoreResult,
  SyncBackupStateResult,
  SyncBackupSummary,
  SyncModeId,
  SyncModeSummary,
  SyncPreviewDetails,
  TombstoneAction,
  TombstoneDecisionResult,
  TrackMediaResult,
  TrackMediaRole,
  TrackSummary,
} from './types';

interface RawAppStateResponse {
  ok?: boolean;
  data?: {
    platforms?: unknown;
    policy?: Record<string, unknown>;
    syncMode?: Record<string, unknown>;
    modes?: unknown[];
    preview?: Record<string, unknown>;
    latestPreview?: Record<string, unknown>;
    lastSyncRun?: Record<string, unknown> | null;
    baseline?: Record<string, unknown>;
    validation?: {
      live?: {
        targets?: Record<string, unknown>;
      };
    };
    nextAction?: string;
    autoSync?: Record<string, unknown>;
  };
}

interface RawApiResponse {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: string;
  message?: string;
}

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  apple: 'Apple Music',
  qq: 'QQ 音乐',
  netease: '网易云音乐',
};

const NEXT_ACTION_COPY: Record<string, string> = {
  choose_sync_mode: '先选择同步方式',
  run_sync_check: '生成同步预览',
  review_confirmation: '先处理需要确认的歌曲',
  confirm_deletions: '查看可能删除的歌曲',
  execute_additions: '可以先同步新增',
  up_to_date: '当前已对齐',
};

export async function fetchAppState(): Promise<AppStateSummary> {
  const response = await fetch('/api/app/state', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load app state: ${response.status}`);
  }
  const payload = (await response.json()) as RawAppStateResponse;
  return normalizeAppState(payload);
}

export async function fetchAutoSyncState(): Promise<AutoSyncStateResult> {
  const response = await fetch('/api/auto-sync', { cache: 'no-store' });
  const payload = await readConnectionResponse(response, '读取自动同步状态失败');
  return normalizeAutoSyncStateResult(isRecord(payload.data) ? payload.data : {});
}

export async function saveAutoSyncSettings(options: {
  enabled: boolean;
  intervalMinutes: number;
  targets: PlatformKey[];
  autoExecuteAdditions: boolean;
}): Promise<AutoSyncStateResult> {
  const payload = await connectionRequest('/api/auto-sync', {
    ...options,
    refreshApple: true,
    refreshTargets: true,
    requireBaseline: true,
  });
  return normalizeAutoSyncStateResult(isRecord(payload.data) ? payload.data : {});
}

export async function runAutoSync(options: {
  executeAdditions?: boolean;
} = {}): Promise<AutoSyncStateResult> {
  const executeAdditions = Boolean(options.executeAdditions);
  const payload = await connectionRequest('/api/auto-sync/run', {
    dryRun: !executeAdditions,
    executeAdditions,
  });
  return normalizeAutoSyncStateResult(isRecord(payload.data) ? payload.data : {});
}

export async function importAppleLibrary(input: {
  content: string;
  filename: string;
}): Promise<ConnectionActionResult> {
  const payload = await connectionRequest('/api/apple', input);
  return { message: stringValue(payload.message) || 'Apple Music 已导入。' };
}

export async function startAppleConnection(): Promise<AppleConnectionResult> {
  const payload = await connectionRequest('/api/apple/connect/start', {});
  return normalizeAppleConnectionResult(payload);
}

export async function checkAppleConnection(): Promise<AppleConnectionResult> {
  const payload = await connectionRequest('/api/apple/connect/check', {});
  return normalizeAppleConnectionResult(payload);
}

export async function openAppleBrowser(url = ''): Promise<ConnectionActionResult> {
  const payload = await connectionRequest('/api/apple/browser/open', { url });
  return { message: stringValue(payload.message) || 'Apple Music 登录窗口已打开。' };
}

export async function captureAppleBrowser(): Promise<ConnectionActionResult> {
  const payload = await connectionRequest('/api/apple/browser/capture', {});
  return { message: stringValue(payload.message) || 'Apple Music 页面已读取。' };
}

export async function openQQBrowserLogin(): Promise<QQBrowserLoginResult> {
  const payload = await connectionRequest('/api/qq/browser/open', {});
  return { message: stringValue(payload.message) || 'QQ 音乐登录窗口已打开。' };
}

export async function startQQQrLogin(options: { force?: boolean } = {}): Promise<QQQrSession> {
  const payload = await connectionRequest('/api/qq/qr/start', { force: Boolean(options.force) });
  const qr = isRecord(payload.qr) ? payload.qr : {};
  const images = isRecord(qr.images) ? qr.images : {};
  const status = normalizeBrowserConnectionStatus(payload.status, payload.message);
  return {
    key: stringValue(qr.key),
    images: {
      qq: imageDataValue(images.qq),
      wechat: imageDataValue(images.wechat),
    },
    expiresAt: stringValue(qr.expiresAt),
    message: stringValue(payload.message) || status.message,
    status,
  };
}

export async function checkQQQrLogin(key: string): Promise<QQBrowserLoginResult> {
  const payload = await connectionRequest('/api/qq/qr/check', { key });
  return {
    message: stringValue(payload.message) || '正在等待 QQ 音乐登录。',
    status: normalizeBrowserConnectionStatus(payload.status, payload.message),
  };
}

export async function checkQQBrowserLogin(): Promise<QQBrowserLoginResult> {
  const payload = await connectionRequest('/api/qq/browser/check', {});
  const status = isRecord(payload.status) ? payload.status : {};
  const credential = isRecord(payload.qqCookie) ? payload.qqCookie : null;
  return {
    message: stringValue(payload.message || status.message) || '正在等待 QQ 音乐登录。',
    status: {
      code: stringValue(status.code),
      message: stringValue(status.message),
      done: Boolean(status.done),
      waiting: Boolean(status.waiting),
    },
    credential: credential
      ? {
        fieldCount: numberValue(credential.count),
        hasAccount: Boolean(credential.hasUin),
        writeReady: Boolean(credential.hasKey),
      }
      : null,
  };
}

export async function fetchQQPlaylists(): Promise<QQPlaylistsResult> {
  const response = await fetch('/api/qq/playlists', { cache: 'no-store' });
  const payload = await readConnectionResponse(response, '读取 QQ 音乐歌单失败');
  return {
    message: stringValue(payload.message) || 'QQ 音乐歌单已读取。',
    playlists: arrayValue(payload.playlists).filter(isRecord).map(normalizeQQPlaylist),
  };
}

export async function startNeteaseQrLogin(): Promise<NeteaseQrSession> {
  const payload = await connectionRequest('/api/netease/qr/start', {});
  const qr = isRecord(payload.qr) ? payload.qr : {};
  const key = stringValue(qr.key);
  const image = stringValue(qr.qrimg);
  if (!key || !image) throw new Error('网易云二维码生成失败，请重试。');
  return {
    key,
    image,
    loginUrl: stringValue(qr.qrurl),
    message: stringValue(payload.message) || '网易云二维码已生成。',
  };
}

export async function checkNeteaseQrLogin(key: string): Promise<NeteaseQrStatus> {
  const payload = await connectionRequest('/api/netease/qr/check', { key });
  const status = isRecord(payload.status) ? payload.status : {};
  return {
    code: numberValue(status.code),
    done: Boolean(status.done),
    waiting: Boolean(status.waiting),
    message: stringValue(status.message || payload.message) || '正在等待网易云扫码。',
  };
}

export async function refreshPlatformSnapshot(platform: 'qq' | 'netease'): Promise<ConnectionActionResult> {
  const payload = await connectionRequest('/api/snapshot', {
    qq: platform === 'qq',
    netease: platform === 'netease',
  });
  return { message: stringValue(payload.message) || `${PLATFORM_LABELS[platform]} 快照已更新。` };
}

export async function runSyncCheck(options: {
  mode: SyncModeId;
  targets?: PlatformKey[];
  platforms?: PlatformKey[];
}): Promise<SyncCheckResult> {
  const response = await fetch('/api/sync/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: options.mode,
      platforms: options.platforms || ['apple', 'qq', 'netease'],
      targets: options.targets || ['qq', 'netease'],
      deletionPolicy: 'ask',
      threshold: 0.82,
      reviewThreshold: 0.68,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to run sync check: ${response.status}`));
  }
  const data = payload.data || {};
  const buckets = bucketsFromCounts(data.counts);
  return {
    previewId: stringValue(data.previewId),
    generatedAt: stringValue(data.generatedAt),
    mode: stringValue(data.mode || options.mode) as SyncModeId,
    buckets,
    nextAction: nextActionForBuckets(buckets),
  };
}

export async function fetchSyncPreview(options: {
  bucket?: SyncPreviewDetails['bucket'];
  limit?: number;
  cursor?: string | null;
} = {}): Promise<SyncPreviewDetails> {
  const params = new URLSearchParams({
    bucket: options.bucket || 'all',
    limit: String(options.limit || 30),
  });
  if (options.cursor) params.set('cursor', options.cursor);
  const response = await fetch(`/api/sync/preview?${params}`, { cache: 'no-store' });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to load sync preview: ${response.status}`));
  }
  return normalizePreviewDetails(payload.data || {}, options.bucket || 'all');
}

export async function resolveSyncTrackMedia(input: {
  previewId: string;
  operationId: string;
  role: TrackMediaRole;
  alternativeIndex?: number;
  alignWithSource?: boolean;
}): Promise<TrackMediaResult> {
  const payload = await connectionRequest('/api/sync/media', input);
  const data = isRecord(payload.data) ? payload.data : {};
  const media = isRecord(data.media) ? data.media : {};
  const alignment = isRecord(media.alignment) ? media.alignment : null;
  const track = normalizeTrackSummary(data.track);
  if (!track) throw new Error('平台没有返回可识别的歌曲版本。');
  return {
    previewId: stringValue(data.previewId),
    operationId: stringValue(data.operationId),
    role: stringValue(data.role || input.role) as TrackMediaRole,
    alternativeIndex: data.alternativeIndex === null || data.alternativeIndex === undefined
      ? null
      : numberValue(data.alternativeIndex),
    track,
    media: {
      artworkUrl: stringValue(media.artworkUrl),
      previewUrl: stringValue(media.previewUrl),
      playable: Boolean(media.playable),
      reason: stringValue(media.reason),
      expiresAt: stringValue(media.expiresAt),
      maxPreviewSeconds: Math.min(30, Math.max(1, numberValue(media.maxPreviewSeconds) || 30)),
      alignment: alignment ? {
        status: stringValue(alignment.status) as 'aligned' | 'not_aligned' | 'unavailable',
        method: stringValue(alignment.method),
        confidence: alignment.confidence === null || alignment.confidence === undefined
          ? null
          : numberValue(alignment.confidence),
        offsetFromSourceSeconds: numberValue(alignment.offsetFromSourceSeconds),
        sourceStartSeconds: Math.max(0, numberValue(alignment.sourceStartSeconds)),
        targetStartSeconds: Math.max(0, numberValue(alignment.targetStartSeconds)),
        overlapSeconds: Math.max(0, numberValue(alignment.overlapSeconds)),
        maxPreviewSeconds: Math.min(30, Math.max(1, numberValue(alignment.maxPreviewSeconds) || 30)),
        reason: stringValue(alignment.reason),
      } : null,
    },
  };
}

export async function resolveAdditions(options: {
  bucket?: SyncPreviewDetails['bucket'];
  operationIds?: string[];
  targets?: PlatformKey[];
  resolveLimit?: number;
  searchLimit?: number;
} = {}): Promise<ResolveAdditionsResult> {
  const response = await fetch('/api/sync/resolve-additions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targets: options.targets || ['qq', 'netease'],
      operationIds: options.operationIds,
      bucket: options.bucket || 'will_add',
      resolveLimit: options.resolveLimit || 50,
      searchLimit: options.searchLimit || 12,
      previewLimit: 30,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to resolve additions: ${response.status}`));
  }
  const data = payload.data || {};
  return {
    preview: normalizePreviewDetails(data, options.bucket || 'will_add'),
    addResolution: normalizeAddResolution(data.addResolution),
  };
}

export async function reviewAdditionCandidates(options: {
  operationIds?: string[];
  targets?: PlatformKey[];
  limit?: number;
  bucket?: PreviewBucketId | 'all';
  refresh?: boolean;
} = {}): Promise<ReviewAdditionsResult> {
  const response = await fetch('/api/ai/additions/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      operationIds: options.operationIds,
      targets: options.targets || ['qq', 'netease'],
      limit: options.limit || 12,
      bucket: options.bucket || 'needs_confirmation',
      previewLimit: 30,
      refresh: Boolean(options.refresh),
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to review addition candidates: ${response.status}`));
  }
  const data = payload.data || {};
  const summary = isRecord(data.summary) ? data.summary : {};
  return {
    batchId: stringValue(data.batchId),
    model: stringValue(data.model),
    changed: numberValue(data.changed),
    summary: {
      total: numberValue(summary.total),
      add: numberValue(summary.add),
      skip: numberValue(summary.skip),
      needsHuman: numberValue(summary.needsHuman),
      guarded: numberValue(summary.guarded),
    },
    preview: normalizePreviewDetails(data, stringValue(options.bucket || 'needs_confirmation') as PreviewBucketId | 'all'),
  };
}

export async function reviewIdentityCandidates(options: {
  operationIds?: string[];
  targets?: PlatformKey[];
  limit?: number;
  bucket?: PreviewBucketId | 'all';
  refresh?: boolean;
} = {}): Promise<ReviewIdentityResult> {
  const response = await fetch('/api/ai/identity/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      operationIds: options.operationIds,
      targets: options.targets || ['qq', 'netease'],
      limit: options.limit || 12,
      bucket: options.bucket || 'needs_confirmation',
      previewLimit: 30,
      refresh: Boolean(options.refresh),
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to review identity conflicts: ${response.status}`));
  }
  const data = payload.data || {};
  const summary = isRecord(data.summary) ? data.summary : {};
  return {
    batchId: stringValue(data.batchId),
    model: stringValue(data.model),
    changed: numberValue(data.changed),
    summary: {
      total: numberValue(summary.total),
      keep: numberValue(summary.keep),
      separate: numberValue(summary.separate),
      needsHuman: numberValue(summary.needsHuman),
      guarded: numberValue(summary.guarded),
    },
    preview: normalizePreviewDetails(data, stringValue(options.bucket || 'needs_confirmation') as PreviewBucketId | 'all'),
  };
}

export async function applyIdentityDecision(options: {
  operationId: string;
  action: IdentityDecisionAction;
  bucket?: PreviewBucketId | 'all';
  note?: string;
}): Promise<IdentityDecisionResult> {
  const response = await fetch('/api/sync/identity-decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...options,
      previewLimit: 30,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to update identity decision: ${response.status}`));
  }
  const data = payload.data || {};
  return {
    previewId: stringValue(data.previewId),
    action: stringValue(data.action),
    decisionKey: stringValue(data.decisionKey),
    preview: normalizePreviewDetails(data, options.bucket || 'needs_confirmation'),
  };
}

export async function applyAdditionDecision(options: {
  operationId: string;
  action: AdditionDecisionAction;
  alternativeIndex?: number;
}): Promise<AdditionDecisionResult> {
  const response = await fetch('/api/sync/addition-decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to update add candidate: ${response.status}`));
  }
  return normalizeAdditionDecisionResult(payload.data || {});
}

export async function applyAdditionDecisionBatch(options: {
  operationIds: string[];
  action: Exclude<AdditionDecisionAction, 'select_alternative'>;
}): Promise<AdditionDecisionResult> {
  const response = await fetch('/api/sync/addition-decisions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to update add candidates: ${response.status}`));
  }
  return normalizeAdditionDecisionResult(payload.data || {});
}

export async function applyTombstoneDecision(options: {
  tombstoneKey: string;
  operationId?: string;
  action: TombstoneAction;
  platform?: PlatformKey | string;
  confirmText?: string;
}): Promise<TombstoneDecisionResult> {
  const response = await fetch('/api/sync/tombstones', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tombstoneKey: options.tombstoneKey,
      operationId: options.operationId,
      action: options.action,
      platform: options.platform,
      confirmText: options.confirmText,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to update deletion decision: ${response.status}`));
  }
  return normalizeTombstoneDecisionResult(payload.data || {});
}

export async function applyTombstoneDecisionBatch(options: {
  action: Exclude<TombstoneAction, 'confirm_global_delete'>;
  items: Array<{
    tombstoneKey: string;
    operationId?: string;
    platform?: PlatformKey | string;
  }>;
}): Promise<TombstoneDecisionResult> {
  const response = await fetch('/api/sync/tombstones', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: options.action,
      items: options.items,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to update deletion decisions: ${response.status}`));
  }
  return normalizeTombstoneDecisionResult(payload.data || {});
}

export async function executeAdditions(options: {
  targets?: PlatformKey[];
  dryRun: boolean;
}): Promise<SyncExecutionResult> {
  const response = await fetch('/api/sync/execute-additions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targets: options.targets || ['qq', 'netease'],
      dryRun: options.dryRun,
      force: false,
      refreshAfterWrite: options.dryRun ? false : true,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to execute additions: ${response.status}`));
  }
  return normalizeSyncExecution(payload.data || {});
}

export async function confirmDeletions(options: {
  targets?: PlatformKey[];
  confirmText: string;
}): Promise<DeleteConfirmationResult> {
  const response = await fetch('/api/sync/confirm-deletions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targets: options.targets || ['qq', 'netease'],
      confirmText: options.confirmText,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to confirm deletions: ${response.status}`));
  }
  return normalizeDeleteConfirmation(payload.data || {});
}

export async function executeDeletions(options: {
  targets?: PlatformKey[];
} = {}): Promise<SyncExecutionResult> {
  const response = await fetch('/api/sync/execute-deletions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targets: options.targets || ['qq', 'netease'],
      dryRun: false,
      force: false,
      refreshAfterWrite: true,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to execute deletions: ${response.status}`));
  }
  return normalizeSyncExecution(payload.data || {});
}

export async function fetchSyncBackups(): Promise<SyncBackupStateResult> {
  const response = await fetch('/api/sync/backups', { cache: 'no-store' });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to load sync backups: ${response.status}`));
  }
  return normalizeSyncBackupState(payload.data || {});
}

export async function createSyncBackup(options: {
  targets?: PlatformKey[];
} = {}): Promise<SyncBackupCreateResult> {
  const response = await fetch('/api/sync/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targets: options.targets || ['qq', 'netease'],
      refresh: true,
      reason: 'manual',
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to create sync backup: ${response.status}`));
  }
  const data = isRecord(payload.data) ? payload.data : {};
  return {
    backup: normalizeSyncBackup(data.backup),
    updatedAt: stringValue(data.updatedAt),
    retained: numberValue(data.retained),
  };
}

export async function restoreSyncBackup(options: {
  backupId: string;
  targets?: PlatformKey[];
  dryRun: boolean;
  confirmText?: string;
}): Promise<SyncBackupRestoreResult> {
  const response = await fetch('/api/sync/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      backupId: options.backupId,
      targets: options.targets,
      dryRun: options.dryRun,
      confirmText: options.confirmText || '',
      refresh: true,
      force: false,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to restore sync backup: ${response.status}`));
  }
  return normalizeSyncBackupRestore(payload.data || {});
}

export async function checkConvergence(options: {
  targets?: PlatformKey[];
} = {}): Promise<SyncConvergenceResult> {
  const response = await fetch('/api/sync/convergence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targets: options.targets || ['qq', 'netease'],
      refreshTarget: true,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to check convergence: ${response.status}`));
  }
  return normalizeConvergenceResult(payload.data || {});
}

export async function saveBaseline(options: {
  mode: SyncModeId;
  previewId?: string;
  targets?: PlatformKey[];
}): Promise<BaselineSaveResult> {
  const targets = options.targets || ['qq', 'netease'];
  const response = await fetch('/api/sync/baseline/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platforms: ['apple', ...targets],
      targets,
      policy: options.mode,
      source: 'react-ui',
      requireConverged: true,
      previewId: options.previewId || '',
      activateManaged: options.mode === 'canonical_mirror' || options.mode === 'managed_bidirectional',
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to save baseline: ${response.status}`));
  }
  return normalizeBaselineSave(payload.data || {});
}

export async function fetchAiProviderState(): Promise<AiProviderSummary> {
  const response = await fetch('/api/ai/provider', { cache: 'no-store' });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to load AI provider state: ${response.status}`));
  }
  return normalizeAiProvider(payload.data || {});
}

export async function testAiProviderConnection(options: {
  consent: boolean;
}): Promise<AiProviderTestResult> {
  const response = await fetch('/api/ai/provider/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ consent: options.consent }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to test AI provider: ${response.status}`));
  }
  return normalizeAiProviderTest(payload.data || {});
}

export async function fetchLiveValidationState(): Promise<LiveValidationSummary> {
  const response = await fetch('/api/validation/live', { cache: 'no-store' });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to load live validation: ${response.status}`));
  }
  return normalizeLiveValidation(payload.data || {});
}

export async function runLiveValidation(options: {
  target: Exclude<PlatformKey, 'apple'>;
  query: string;
  confirm: string;
  playlistId?: string;
  playlistName?: string;
}): Promise<LiveValidationRunResult> {
  const response = await fetch('/api/validation/live/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: options.target,
      query: options.query,
      confirm: options.confirm,
      playlistId: options.playlistId,
      playlistName: options.playlistName,
      writeReport: true,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to run live validation: ${response.status}`));
  }
  return normalizeLiveValidationRun(payload.data || {});
}

export async function generateMusicProfile(options: {
  useModel?: boolean;
  consent?: boolean;
} = {}): Promise<MusicProfileResult> {
  const response = await fetch('/api/ai/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      refresh: true,
      useModel: Boolean(options.useModel),
      consent: Boolean(options.consent),
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to generate music profile: ${response.status}`));
  }
  return normalizeMusicProfile(payload.data || {});
}

export async function findSimilarTracks(options: {
  seed: {
    title?: string;
    artist?: string;
  };
  limit?: number;
}): Promise<SimilarTracksResult> {
  const response = await fetch('/api/ai/similar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      seed: options.seed,
      limit: options.limit || 8,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to find similar tracks: ${response.status}`));
  }
  return normalizeSimilarTracks(payload.data || {});
}

export async function generateRecommendations(options: {
  useModel?: boolean;
  consent?: boolean;
  limit?: number;
  saveShortlist?: boolean;
  shortlistName?: string;
} = {}): Promise<RecommendationResult> {
  const response = await fetch('/api/ai/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      limit: options.limit || 8,
      saveShortlist: Boolean(options.saveShortlist),
      shortlistName: options.shortlistName,
      useModel: Boolean(options.useModel),
      consent: Boolean(options.consent),
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to generate recommendations: ${response.status}`));
  }
  return normalizeRecommendations(payload.data || {});
}

export async function fetchAgentSessions(options: {
  limit?: number;
  traceLimit?: number;
} = {}): Promise<AgentSessionsResult> {
  const params = new URLSearchParams({
    limit: String(options.limit || 3),
    traceLimit: String(options.traceLimit || 5),
  });
  const response = await fetch(`/api/agent/sessions?${params}`, { cache: 'no-store' });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to load Agent audit: ${response.status}`));
  }
  return normalizeAgentSessions(payload.data || {});
}

export async function runAgentChat(options: {
  message: string;
}): Promise<AgentChatResult> {
  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: options.message,
      arguments: { limit: 5 },
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to run Agent chat: ${response.status}`));
  }
  return normalizeAgentChat(payload.data || {});
}

export async function saveAgentTraceFeedback(options: {
  sessionId: string;
  traceId: string;
  label: AgentFeedbackLabel;
}): Promise<AgentTraceFeedbackResult> {
  const response = await fetch('/api/agent/trace-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: options.sessionId,
      traceId: options.traceId,
      label: options.label,
      limit: 3,
      traceLimit: 5,
    }),
  });
  const payload = (await response.json()) as RawApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, `Failed to save Agent feedback: ${response.status}`));
  }
  return normalizeAgentFeedback(payload.data || {});
}

async function connectionRequest(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readConnectionResponse(response, `连接操作失败：${response.status}`);
}

async function readConnectionResponse(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const payload = (await response.json()) as RawApiResponse & Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    throw new Error(apiErrorMessage(payload, fallback));
  }
  return payload;
}

function normalizeQQPlaylist(raw: Record<string, unknown>): QQPlaylistSummary {
  return {
    index: numberValue(raw.index),
    name: stringValue(raw.name) || '未命名歌单',
    dirid: stringValue(raw.dirid),
    tid: stringValue(raw.tid),
    dissid: stringValue(raw.dissid),
    id: stringValue(raw.id),
    songCount: numberValue(raw.songCount),
    listenCount: numberValue(raw.listenCount),
    isLiked: Boolean(raw.isLiked),
  };
}

function normalizeAppState(payload: RawAppStateResponse): AppStateSummary {
  const data = payload.data || {};
  const latestPreview = data.latestPreview || data.preview || {};
  const platforms = normalizePlatforms(data.platforms, data.validation?.live?.targets);
  const modes = normalizeModes(data.modes);
  const currentMode = stringValue(
    data.syncMode?.id || data.policy?.mode || data.policy?.id || 'canonical_mirror',
  ) as AppStateSummary['currentMode'];
  const buckets = normalizeBuckets(latestPreview);
  const nextAction = NEXT_ACTION_COPY[stringValue(data.nextAction)] || nextActionForBuckets(buckets);
  return {
    platforms,
    currentMode,
    modes,
    preview: {
      generatedAt: stringValue(latestPreview.generatedAt),
      buckets,
      nextAction,
    },
    latestRun: normalizeRecentRun(data.lastSyncRun),
    baseline: {
      saved: Boolean(data.baseline?.saved || data.baseline?.exists || data.baseline?.savedAt),
      updatedAt: stringValue(data.baseline?.updatedAt || data.baseline?.savedAt),
      added: numberValue(data.baseline?.diffAdded ?? data.baseline?.added),
      deleted: numberValue(data.baseline?.diffDeleted ?? data.baseline?.deleted),
    },
    autoSync: normalizeAutoSyncSummary(data.autoSync || {}),
  };
}

function normalizeAutoSyncStateResult(raw: Record<string, unknown>): AutoSyncStateResult {
  const automation = isRecord(raw.automation) ? raw.automation : {};
  const readiness = isRecord(raw.readiness) ? raw.readiness : {};
  const policy = isRecord(readiness.policy) ? readiness.policy : {};
  const baseline = isRecord(readiness.baseline) ? readiness.baseline : {};
  const liveValidation = isRecord(readiness.liveValidation) ? readiness.liveValidation : {};
  const history = arrayValue(raw.history).filter(isRecord).map(normalizeAutoSyncRun);
  return {
    automation: normalizeAutoSyncSummary(automation),
    readiness: {
      ok: Boolean(readiness.ok),
      reasons: arrayValue(readiness.reasons).filter(isRecord).map((reason) => ({
        code: stringValue(reason.code),
        platform: stringValue(reason.platform),
        message: stringValue(reason.message),
      })),
      policy: {
        id: stringValue(policy.id || 'canonical_mirror'),
        label: stringValue(policy.label || '以 Apple Music 为准'),
      },
      baseline: {
        exists: Boolean(baseline.exists),
        savedAt: stringValue(baseline.savedAt),
      },
      snapshots: normalizeAutoSyncSnapshots(readiness.snapshots),
      liveValidation: {
        ok: Boolean(liveValidation.ok),
        targets: isRecord(liveValidation.targets) ? liveValidation.targets as AutoSyncStateResult['readiness']['liveValidation']['targets'] : {},
      },
    },
    history,
    run: isRecord(raw.run) ? normalizeAutoSyncRun(raw.run) : null,
  };
}

function normalizeAutoSyncSummary(raw: Record<string, unknown>): AutoSyncSummary {
  return {
    enabled: Boolean(raw.enabled),
    running: Boolean(raw.running),
    intervalMinutes: numberValue(raw.intervalMinutes) || 60,
    targets: arrayValue(raw.targets).filter(isPlatformKey),
    refreshApple: raw.refreshApple !== false,
    refreshTargets: raw.refreshTargets !== false,
    autoExecuteAdditions: raw.autoExecuteAdditions !== false,
    requireBaseline: raw.requireBaseline !== false,
    maxSourceAgeMinutes: numberValue(raw.maxSourceAgeMinutes) || 1440,
    nextRunAt: stringValue(raw.nextRunAt),
    lastRunAt: stringValue(raw.lastRunAt),
    lastStatus: stringValue(raw.lastStatus || 'never') as AutoSyncSummary['lastStatus'],
    lastMessage: stringValue(raw.lastMessage),
    lastRunId: stringValue(raw.lastRunId),
    historyCount: numberValue(raw.historyCount),
  };
}

function normalizeAutoSyncRun(raw: Record<string, unknown>): AutoSyncRunSummary {
  const preview = isRecord(raw.preview) ? raw.preview : {};
  const additions = isRecord(raw.additions) ? raw.additions : {};
  return {
    id: stringValue(raw.id),
    trigger: stringValue(raw.trigger),
    status: stringValue(raw.status || 'never') as AutoSyncRunSummary['status'],
    startedAt: stringValue(raw.startedAt),
    completedAt: stringValue(raw.completedAt),
    policy: stringValue(raw.policy || 'canonical_mirror'),
    targets: arrayValue(raw.targets).filter(isPlatformKey),
    dryRun: Boolean(raw.dryRun),
    message: stringValue(raw.message),
    snapshotRefresh: isRecord(raw.snapshotRefresh) ? raw.snapshotRefresh : {},
    preview: {
      previewId: stringValue(preview.previewId),
      generatedAt: stringValue(preview.generatedAt),
      willAdd: numberValue(preview.willAdd),
      needsConfirmation: numberValue(preview.needsConfirmation),
      mayDelete: numberValue(preview.mayDelete),
    },
    additions: {
      requested: numberValue(additions.requested),
      succeeded: numberValue(additions.succeeded),
      failed: numberValue(additions.failed),
      blocked: numberValue(additions.blocked),
    },
    deletionSignals: numberValue(raw.deletionSignals),
    convergence: isRecord(raw.convergence) ? raw.convergence : null,
    error: stringValue(raw.error),
  };
}

function normalizeAutoSyncSnapshots(raw: unknown): AutoSyncStateResult['readiness']['snapshots'] {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([key, value]) => isPlatformKey(key) && isRecord(value))
      .map(([key, rawValue]) => {
        const value = rawValue as Record<string, unknown>;
        return [key, {
          available: Boolean(value.available),
          fetchedAt: stringValue(value.fetchedAt),
          ageMinutes: value.ageMinutes === null ? null : numberValue(value.ageMinutes),
          tracks: numberValue(value.tracks),
        }];
      }),
  );
}

function normalizePlatforms(rawPlatforms: unknown, rawLiveTargets: unknown): PlatformSummary[] {
  const liveTargets = isRecord(rawLiveTargets) ? rawLiveTargets : {};
  const platformRecord = platformStateByKey(rawPlatforms);
  return (Object.keys(PLATFORM_LABELS) as PlatformKey[]).map((key) => {
    const raw = platformRecord[key] || {};
    const live = isRecord(liveTargets[key]) ? liveTargets[key] : {};
    const capabilities = isRecord(raw.capabilities) ? raw.capabilities : {};
    const tracks = numberValue(raw.tracks ?? raw.trackCount ?? raw.count);
    const writable = Boolean(raw.writable || capabilities.write || live.ok);
    return {
      key,
      label: stringValue(raw.label) || PLATFORM_LABELS[key],
      credentialPresent: typeof raw.credentialPresent === 'boolean'
        ? raw.credentialPresent
        : Boolean(capabilities.write || (key === 'apple' && capabilities.read)),
      status: normalizePlatformStatus({
        key,
        status: raw.status || raw.state,
        tracks,
        writable,
        readable: Boolean(capabilities.read),
      }),
      tracks,
      writable,
      liveValidation: key === 'apple'
        ? undefined
        : {
          ok: Boolean(live.ok),
          status: stringValue(live.status || (live.ok ? 'ready' : 'missing')) as NonNullable<PlatformSummary['liveValidation']>['status'],
          checkedAt: stringValue(live.validatedAt || live.checkedAt),
        },
    };
  });
}

function platformStateByKey(rawPlatforms: unknown): Partial<Record<PlatformKey, Record<string, unknown>>> {
  if (Array.isArray(rawPlatforms)) {
    return Object.fromEntries(
      rawPlatforms
        .filter(isRecord)
        .map((platform) => [stringValue(platform.id || platform.key || platform.platform), platform])
        .filter(([key]) => isPlatformKey(key)),
    ) as Partial<Record<PlatformKey, Record<string, unknown>>>;
  }
  if (isRecord(rawPlatforms)) {
    return Object.fromEntries(
      Object.entries(rawPlatforms)
        .map(([key, value]) => [key, isRecord(value) ? value : {}])
        .filter(([key]) => isPlatformKey(key)),
    ) as Partial<Record<PlatformKey, Record<string, unknown>>>;
  }
  return {};
}

function normalizePlatformStatus(input: {
  key: PlatformKey;
  status: unknown;
  tracks: number;
  writable: boolean;
  readable: boolean;
}): PlatformStatus {
  const status = stringValue(input.status);
  if (status === 'readable' || status === 'writable' || status === 'needs_attention' || status === 'not_connected') {
    return status;
  }
  if (input.key === 'apple') return input.tracks > 0 || input.readable ? 'readable' : 'needs_attention';
  if (input.writable) return 'writable';
  if (input.tracks > 0 || input.readable) return 'readable';
  return 'not_connected';
}

function normalizeRecentRun(rawRun: unknown): AppStateSummary['latestRun'] {
  if (!isRecord(rawRun)) return { status: 'none' };
  const add = isRecord(rawRun.add) ? rawRun.add : {};
  const remove = isRecord(rawRun.remove) ? rawRun.remove : {};
  return {
    status: stringValue(rawRun.status || 'completed') as NonNullable<AppStateSummary['latestRun']>['status'],
    dryRun: Boolean(rawRun.dryRun),
    targets: arrayValue(rawRun.targets)
      .concat(rawRun.target ? [rawRun.target] : [])
      .filter(isPlatformKey),
    addRequested: numberValue(rawRun.addRequested ?? add.requested ?? rawRun.added),
    removeRequested: numberValue(rawRun.removeRequested ?? remove.requested ?? rawRun.removed),
    updatedAt: stringValue(rawRun.updatedAt || rawRun.completedAt || rawRun.ranAt),
  };
}

function normalizeModes(rawModes: unknown): SyncModeSummary[] {
  const modes = Array.isArray(rawModes) ? rawModes : [];
  const normalized = modes
    .filter(isRecord)
    .map((mode) => ({
      id: stringValue(mode.id || mode.mode) as SyncModeSummary['id'],
      label: stringValue(mode.label || mode.name),
      description: stringValue(mode.description),
      risk: stringValue(mode.risk || 'medium') as SyncModeSummary['risk'],
      recommended: Boolean(mode.recommended),
    }))
    .filter((mode) => mode.id && mode.label);
  return normalized.length ? normalized : fallbackModes();
}

function normalizeBuckets(rawPreview: unknown): PreviewBucketSummary[] {
  const preview = isRecord(rawPreview) ? rawPreview : {};
  return bucketsFromCounts(preview.counts);
}

function normalizePreviewDetails(rawData: unknown, fallbackBucket: SyncPreviewDetails['bucket'] = 'all'): SyncPreviewDetails {
  const data = isRecord(rawData) ? rawData : {};
  const preview = isRecord(data.preview) ? data.preview : data;
  const bucket = stringValue(preview.bucket || data.bucket || fallbackBucket || 'all') as SyncPreviewDetails['bucket'];
  return {
    previewId: stringValue(data.previewId || preview.previewId),
    generatedAt: stringValue(data.generatedAt || preview.generatedAt),
    mode: stringValue(data.mode || preview.mode || 'canonical_mirror') as SyncModeId,
    bucket,
    buckets: bucketsFromCounts(data.counts || preview.counts),
    total: numberValue(preview.total ?? data.total),
    nextCursor: preview.nextCursor === null || data.nextCursor === null
      ? null
      : stringValue(preview.nextCursor ?? data.nextCursor),
    items: arrayValue(preview.items).filter(isRecord).map(normalizePreviewItem),
    addResolution: normalizeAddResolution(data.addResolution || preview.addResolution),
  };
}

function bucketsFromCounts(rawCounts: unknown): PreviewBucketSummary[] {
  const counts = isRecord(rawCounts) ? rawCounts : {};
  return [
    { id: 'will_add', label: '会新增', count: numberValue(counts.will_add ?? counts.add), risk: 'low' },
    { id: 'will_keep', label: '会保留', count: numberValue(counts.will_keep ?? counts.keep), risk: 'none' },
    { id: 'needs_confirmation', label: '需要确认', count: numberValue(counts.needs_confirmation ?? counts.review), risk: 'medium' },
    { id: 'may_delete', label: '可能删除', count: numberValue(counts.may_delete ?? counts.remove), risk: 'high' },
  ];
}

  function normalizePreviewItem(raw: Record<string, unknown>): PreviewTrackItem {
    const sourcePlatforms = arrayValue(raw.sourcePlatforms).filter(isPlatformKey);
    const targetPlatforms = arrayValue(raw.targetPlatforms).filter(isPlatformKey);
    const sourcePlatform = stringValue(raw.sourcePlatform);
    const targetPlatform = stringValue(raw.targetPlatform);
    const scoreValue = isRecord(raw.score) ? raw.score.total ?? raw.score.score : raw.score;
  return {
    id: stringValue(raw.id),
    bucket: stringValue(raw.bucket || 'will_keep') as PreviewTrackItem['bucket'],
    action: stringValue(raw.action),
    status: stringValue(raw.status),
    destructive: Boolean(raw.destructive),
    title: stringValue(raw.title) || '未命名歌曲',
    artist: stringValue(raw.artist),
    album: stringValue(raw.album),
    artworkUrl: stringValue(raw.artworkUrl),
    sourceTrack: normalizeTrackSummary(raw.sourceTrack),
    targetTrack: normalizeTrackSummary(raw.targetTrack),
    sourcePlatforms: sourcePlatforms.length
      ? sourcePlatforms
      : isPlatformKey(sourcePlatform)
        ? [sourcePlatform]
        : [],
    targetPlatforms: targetPlatforms.length
      ? targetPlatforms
      : isPlatformKey(targetPlatform)
        ? [targetPlatform]
        : [],
    reason: stringValue(raw.reason),
    message: stringValue(raw.message),
    blockedReason: stringValue(raw.blockedReason),
    evidence: arrayValue(raw.evidence).map((item) => stringValue(item)).filter(Boolean).slice(0, 8),
      score: scoreValue === null || scoreValue === undefined ? null : numberValue(scoreValue),
    resolvedTarget: normalizeTrackSummary(raw.resolvedTarget),
    candidateTarget: normalizeTrackSummary(raw.candidateTarget),
    alternatives: arrayValue(raw.alternatives).map(normalizeTrackSummary).filter((item): item is TrackSummary => Boolean(item)),
    relatedMatches: arrayValue(raw.relatedMatches).filter(isRecord).map((match) => ({
      operationId: stringValue(match.operationId),
      action: stringValue(match.action),
      targetPlatform: stringValue(match.targetPlatform) as PlatformKey,
      score: match.score === null || match.score === undefined ? null : numberValue(match.score),
      targetTrack: normalizeTrackSummary(match.targetTrack),
      resolvedTarget: normalizeTrackSummary(match.resolvedTarget),
      candidateTarget: normalizeTrackSummary(match.candidateTarget),
      alternatives: arrayValue(match.alternatives).map(normalizeTrackSummary).filter((item): item is TrackSummary => Boolean(item)),
      addDecision: normalizeAddDecision(match.addDecision),
    })).filter((match) => isPlatformKey(match.targetPlatform)),
    resolution: normalizeResolution(raw.resolution),
    addDecision: normalizeAddDecision(raw.addDecision),
    identityDecision: normalizeIdentityDecision(raw.identityDecision),
    aiReview: normalizeAddAiReview(raw.aiReview),
    tombstoneKey: stringValue(raw.tombstoneKey),
    tombstoneAction: stringValue(raw.tombstoneAction),
  };
}

function normalizeAddAiReview(raw: unknown): PreviewTrackItem['aiReview'] {
  if (!isRecord(raw)) return null;
  return {
    batchId: stringValue(raw.batchId),
    model: stringValue(raw.model),
    reviewedAt: stringValue(raw.reviewedAt),
    recommendedAction: stringValue(raw.recommendedAction || 'needs_human'),
    relation: stringValue(raw.relation || 'uncertain'),
    confidence: numberValue(raw.confidence),
    reason: stringValue(raw.reason),
    guarded: Boolean(raw.guarded),
  };
}

function normalizeTrackSummary(raw: unknown): TrackSummary | null {
  if (!isRecord(raw)) return null;
  const platform = stringValue(raw.platform);
  return {
    platform: isPlatformKey(platform) ? platform : platform,
    id: stringValue(raw.id),
    mid: stringValue(raw.mid),
    title: stringValue(raw.title) || '未命名歌曲',
    artist: stringValue(raw.artist),
    album: stringValue(raw.album),
    durationMs: raw.durationMs === null || raw.durationMs === undefined ? null : numberValue(raw.durationMs),
    isrc: raw.isrc === null || raw.isrc === undefined ? null : stringValue(raw.isrc),
    songType: raw.songType === null || raw.songType === undefined ? null : numberValue(raw.songType),
    artworkUrl: stringValue(raw.artworkUrl),
  };
}

function normalizeResolution(raw: unknown): PreviewTrackItem['resolution'] {
  if (!isRecord(raw)) return null;
  return {
    reason: stringValue(raw.reason),
    message: stringValue(raw.message),
  };
}

function normalizeAddDecision(raw: unknown): AddDecisionSummary | null {
  if (!isRecord(raw)) return null;
  return {
    action: stringValue(raw.action),
    alternativeIndex: raw.alternativeIndex === null || raw.alternativeIndex === undefined ? null : numberValue(raw.alternativeIndex),
    batchId: stringValue(raw.batchId),
    decidedAt: stringValue(raw.decidedAt),
  };
}

function normalizeIdentityDecision(raw: unknown): PreviewTrackItem['identityDecision'] {
  if (!isRecord(raw)) return null;
  return {
    action: stringValue(raw.action),
    decidedAt: stringValue(raw.decidedAt),
    originalReason: stringValue(raw.originalReason),
  };
}

function normalizeAddResolution(raw: unknown): AddResolutionSummary | null {
  if (!isRecord(raw)) return null;
  return {
    resolvedAt: stringValue(raw.resolvedAt),
    targets: arrayValue(raw.targets).filter(isRecord).map((target) => ({
      target: stringValue(target.target),
      processed: numberValue(target.processed),
      resolved: numberValue(target.resolved),
      review: numberValue(target.review),
      notFound: numberValue(target.notFound),
      skipped: Boolean(target.skipped),
      reason: stringValue(target.reason),
    })),
    total: numberValue(raw.total),
    resolved: numberValue(raw.resolved),
    review: numberValue(raw.review),
    notFound: numberValue(raw.notFound),
    skipped: numberValue(raw.skipped),
  };
}

function normalizeAdditionDecisionResult(data: Record<string, unknown>): AdditionDecisionResult {
  return {
    previewId: stringValue(data.previewId),
    generatedAt: stringValue(data.generatedAt),
    buckets: bucketsFromCounts(data.counts),
    addResolution: normalizeAddResolution(data.addResolution),
    operation: isRecord(data.operation) ? normalizePreviewItem(data.operation) : null,
    operations: arrayValue(data.operations).filter(isRecord).map(normalizePreviewItem),
    requested: numberValue(data.requested),
    changed: numberValue(data.changed),
    skipped: numberValue(data.skipped),
  };
}

function normalizeTombstoneDecisionResult(data: Record<string, unknown>): TombstoneDecisionResult {
  const decision = isRecord(data.decision) ? data.decision : null;
  const preview = isRecord(data.preview) ? data.preview : null;
  return {
    decision: decision
      ? {
        key: stringValue(decision.key),
        action: stringValue(decision.action),
        platform: stringValue(decision.platform),
        updatedAt: stringValue(decision.updatedAt),
      }
      : null,
    batch: Boolean(data.batch),
    requested: numberValue(data.requested),
    changed: numberValue(data.changed),
    tombstones: normalizeTombstoneSummary(data.tombstones),
    preview: preview
      ? {
        previewId: stringValue(preview.previewId),
        generatedAt: stringValue(preview.generatedAt),
        buckets: bucketsFromCounts(preview.counts),
      }
      : null,
  };
}

function normalizeTombstoneSummary(raw: unknown): TombstoneDecisionResult['tombstones'] {
  if (!isRecord(raw)) return null;
  const actions = isRecord(raw.actions)
    ? Object.fromEntries(Object.entries(raw.actions).map(([key, value]) => [key, numberValue(value)]))
    : {};
  return {
    total: numberValue(raw.total),
    updatedAt: stringValue(raw.updatedAt),
    actions,
  };
}

function normalizeSyncExecution(raw: unknown): SyncExecutionResult {
  const data = isRecord(raw) ? raw : {};
  return {
    target: stringValue(data.target),
    targets: normalizeTargetRecord(data.targets),
    targetOrder: arrayValue(data.targetOrder).map(stringValue).filter(Boolean),
    dryRun: Boolean(data.dryRun),
    action: stringValue(data.action),
    add: normalizeExecutionAction(data.add),
    remove: normalizeExecutionAction(data.remove),
    convergence: normalizeConvergence(data.convergence),
    backup: isRecord(data.backup) ? normalizeSyncBackup(data.backup) : null,
  };
}

function normalizeSyncBackupState(raw: unknown): SyncBackupStateResult {
  const data = isRecord(raw) ? raw : {};
  return {
    version: numberValue(data.version),
    updatedAt: stringValue(data.updatedAt),
    backups: arrayValue(data.backups).map(normalizeSyncBackup),
    restoreRuns: arrayValue(data.restoreRuns).map(normalizeSyncRestoreRun),
  };
}

function normalizeSyncBackup(raw: unknown): SyncBackupSummary {
  const data = isRecord(raw) ? raw : {};
  const integrity = isRecord(data.integrity) ? data.integrity : {};
  return {
    id: stringValue(data.id),
    createdAt: stringValue(data.createdAt),
    previewId: stringValue(data.previewId),
    policy: stringValue(data.policy),
    reason: stringValue(data.reason),
    targets: arrayValue(data.targets).map((entry) => {
      const target = isRecord(entry) ? entry : {};
      return {
        target: stringValue(target.target),
        fetchedAt: stringValue(target.fetchedAt),
        count: numberValue(target.count),
        restorable: numberValue(target.restorable),
        checksum: stringValue(target.checksum),
      };
    }),
    integrity: {
      ok: Boolean(integrity.ok),
      targets: arrayValue(integrity.targets).map(stringValue).filter(Boolean),
      errors: arrayValue(integrity.errors).map(stringValue).filter(Boolean),
    },
  };
}

function normalizeSyncRestoreRun(raw: unknown) {
  const data = isRecord(raw) ? raw : {};
  return {
    id: stringValue(data.id),
    backupId: stringValue(data.backupId),
    startedAt: stringValue(data.startedAt),
    completedAt: stringValue(data.completedAt),
    status: stringValue(data.status),
    dryRun: Boolean(data.dryRun),
    targets: arrayValue(data.targets).map(stringValue).filter(Boolean),
    summary: normalizeSyncRestorePlan(data.summary),
    error: stringValue(data.error),
  };
}

function normalizeSyncRestorePlan(raw: unknown) {
  const data = isRecord(raw) ? raw : {};
  const rawTargets = isRecord(data.targets) ? data.targets : {};
  const targets = Object.fromEntries(Object.entries(rawTargets).map(([key, value]) => {
    const item = isRecord(value) ? value : {};
    return [key, {
      backupCount: numberValue(item.backupCount),
      currentCount: numberValue(item.currentCount),
      missing: numberValue(item.missing),
      unrestorable: numberValue(item.unrestorable),
    }];
  }));
  return {
    targets,
    targetCount: numberValue(data.targetCount),
    backupTracks: numberValue(data.backupTracks),
    missing: numberValue(data.missing),
    unrestorable: numberValue(data.unrestorable),
    remainingMissing: data.remainingMissing === undefined ? undefined : numberValue(data.remainingMissing),
  };
}

function normalizeSyncBackupRestore(raw: unknown): SyncBackupRestoreResult {
  const data = isRecord(raw) ? raw : {};
  const rawWrites = isRecord(data.writes) ? data.writes : {};
  const writes = Object.fromEntries(Object.entries(rawWrites).map(([key, value]) => {
    const item = isRecord(value) ? value : {};
    return [key, {
      requested: numberValue(item.requested),
      submitted: numberValue(item.submitted),
      accepted: numberValue(item.accepted),
      added: numberValue(item.added),
      alreadyPresent: numberValue(item.alreadyPresent),
      verified: Boolean(item.verified),
      missing: numberValue(item.missing),
    }];
  }));
  return {
    dryRun: Boolean(data.dryRun),
    backup: normalizeSyncBackup(data.backup),
    confirmationText: stringValue(data.confirmationText),
    plan: normalizeSyncRestorePlan(data.plan),
    writes,
    restoreRun: normalizeSyncRestoreRun(data.restoreRun),
  };
}

function normalizeExecutionAction(raw: unknown): ExecutionActionSummary {
  const data = isRecord(raw) ? raw : {};
  return {
    requested: numberValue(data.requested),
    succeeded: numberValue(data.succeeded ?? data.success ?? data.completed),
    failed: numberValue(data.failed),
    skipped: numberValue(data.skipped),
  };
}

function normalizeDeleteConfirmation(raw: unknown): DeleteConfirmationResult {
  const data = isRecord(raw) ? raw : {};
  return {
    target: stringValue(data.target),
    confirmed: numberValue(data.confirmed),
    operationIds: arrayValue(data.operationIds).map(stringValue).filter(Boolean),
    tombstones: normalizeTombstoneSummary(data.tombstones),
  };
}

function normalizeConvergenceResult(raw: unknown): SyncConvergenceResult {
  const data = isRecord(raw) ? raw : {};
  const preview = isRecord(data.preview) ? data.preview : null;
  return {
    mode: stringValue(data.mode),
    convergence: normalizeConvergence(data.convergence),
    preview: preview
      ? {
        previewId: stringValue(preview.previewId),
        generatedAt: stringValue(preview.generatedAt),
        counts: normalizeNumberRecord(preview.counts),
        convergence: normalizeConvergence(preview.convergence),
      }
      : null,
  };
}

function normalizeBaselineSave(raw: unknown): BaselineSaveResult {
  const data = isRecord(raw) ? raw : {};
  const baseline = isRecord(data.baseline) ? data.baseline : null;
  const baselineSummary = isRecord(baseline?.summary) ? baseline.summary : {};
  const activatedPolicy = isRecord(data.activatedPolicy) ? data.activatedPolicy : null;
  const preview = isRecord(data.preview) ? data.preview : null;
  return {
    baseline: baseline
      ? {
        saved: Boolean(baseline.saved ?? true),
        updatedAt: stringValue(baseline.updatedAt || baseline.savedAt),
        summary: {
          tracks: numberValue(baselineSummary.tracks ?? baselineSummary.trackCount),
          platforms: arrayValue(baselineSummary.platforms).map(stringValue).filter(Boolean),
        },
      }
      : null,
    activatedPolicy: activatedPolicy
      ? {
        id: stringValue(activatedPolicy.id),
        label: stringValue(activatedPolicy.label),
      }
      : null,
    preview: preview
      ? {
        previewId: stringValue(preview.previewId),
        generatedAt: stringValue(preview.generatedAt),
        counts: normalizeNumberRecord(preview.counts),
        convergence: normalizeConvergence(preview.convergence),
      }
      : null,
  };
}

function normalizeConvergence(raw: unknown): ConvergenceSummary | null {
  if (!isRecord(raw)) return null;
  return {
    exists: Boolean(raw.exists),
    status: stringValue(raw.status),
    converged: Boolean(raw.converged),
    previewId: stringValue(raw.previewId),
    generatedAt: stringValue(raw.generatedAt),
    refreshedAt: stringValue(raw.refreshedAt),
    openAdds: numberValue(raw.openAdds ?? raw.add),
    openDeletes: numberValue(raw.openDeletes ?? raw.remove),
    openReviews: numberValue(raw.openReviews ?? raw.review),
    add: numberValue(raw.add ?? raw.openAdds),
    remove: numberValue(raw.remove ?? raw.openDeletes),
    review: numberValue(raw.review ?? raw.openReviews),
    message: stringValue(raw.message),
  };
}

function normalizeTargetRecord(raw: unknown): Partial<Record<PlatformKey, Record<string, unknown>>> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([key]) => isPlatformKey(key))
      .map(([key, value]) => [key, isRecord(value) ? value : {}]),
  ) as Partial<Record<PlatformKey, Record<string, unknown>>>;
}

function normalizeAiProvider(raw: unknown): AiProviderSummary {
  const provider = isRecord(raw) ? raw : {};
  return {
    provider: stringValue(provider.provider) || 'deepseek',
    model: stringValue(provider.model) || 'deepseek-v4-pro',
    baseUrl: stringValue(provider.baseUrl),
    hasApiKey: Boolean(provider.hasApiKey),
    configured: Boolean(provider.configured || provider.hasApiKey),
    stateExists: Boolean(provider.stateExists),
    updatedAt: stringValue(provider.updatedAt),
    batchSize: numberValue(provider.batchSize),
  };
}

function normalizeAiModel(raw: unknown): MusicProfileResult['model'] {
  if (!isRecord(raw)) return null;
  return {
    used: Boolean(raw.used),
    skippedReason: stringValue(raw.skippedReason),
    provider: isRecord(raw.provider) ? normalizeAiProvider(raw.provider) : null,
    model: stringValue(raw.model),
    usage: isRecord(raw.usage) ? raw.usage : undefined,
  };
}

function normalizeMusicProfile(raw: unknown): MusicProfileResult {
  const data = isRecord(raw) ? raw : {};
  const summary = isRecord(data.summary) ? data.summary : {};
  return {
    generatedAt: stringValue(data.generatedAt),
    updatedAt: stringValue(data.updatedAt),
    summary: {
      trackCount: numberValue(summary.trackCount),
      sourceTrackCount: numberValue(summary.sourceTrackCount),
      topArtists: normalizeNamedCounts(summary.topArtists),
      topAlbums: normalizeNamedCounts(summary.topAlbums),
      languages: normalizeNamedCounts(summary.languages),
      platformCoverage: normalizeNumberRecord(summary.platformCoverage),
      averageDurationMs: summary.averageDurationMs === null || summary.averageDurationMs === undefined
        ? null
        : numberValue(summary.averageDurationMs),
      isrcCoverage: numberValue(summary.isrcCoverage),
      reviewSignals: normalizeNumberRecord(summary.reviewSignals),
    },
    aiSummary: normalizeMusicAiSummary(data.aiSummary),
    model: normalizeAiModel(data.model),
  };
}

function normalizeMusicAiSummary(raw: unknown): MusicProfileResult['aiSummary'] {
  if (!isRecord(raw)) return null;
  return {
    source: stringValue(raw.source),
    summary: stringValue(raw.summary),
    tasteTags: arrayValue(raw.tasteTags).map(stringValue).filter(Boolean),
    listeningPatterns: arrayValue(raw.listeningPatterns).map(stringValue).filter(Boolean),
    recommendationAngles: arrayValue(raw.recommendationAngles).map(stringValue).filter(Boolean),
    caveats: arrayValue(raw.caveats).map(stringValue).filter(Boolean),
    confidence: raw.confidence === null || raw.confidence === undefined ? undefined : numberValue(raw.confidence),
    evidenceRefs: arrayValue(raw.evidenceRefs).map(stringValue).filter(Boolean),
  };
}

function normalizeRecommendationAiSummary(raw: unknown): RecommendationResult['aiSummary'] {
  if (!isRecord(raw)) return null;
  return {
    source: stringValue(raw.source),
    summary: stringValue(raw.summary),
    recommendationAngles: arrayValue(raw.recommendationAngles).map(stringValue).filter(Boolean),
    caveats: arrayValue(raw.caveats).map(stringValue).filter(Boolean),
    evidenceRefs: arrayValue(raw.evidenceRefs).map(stringValue).filter(Boolean),
  };
}

function normalizeSimilarTracks(raw: unknown): SimilarTracksResult {
  const data = isRecord(raw) ? raw : {};
  return {
    seed: normalizeMusicCandidate(data.seed),
    total: numberValue(data.total),
    candidates: arrayValue(data.candidates).map(normalizeMusicCandidate).filter((item): item is MusicCandidateSummary => Boolean(item)),
    reason: stringValue(data.reason),
  };
}

function normalizeRecommendations(raw: unknown): RecommendationResult {
  const data = isRecord(raw) ? raw : {};
  const shortlist = isRecord(data.savedShortlist) ? data.savedShortlist : null;
  return {
    generatedAt: stringValue(data.generatedAt),
    source: stringValue(data.source),
    excludes: isRecord(data.excludes)
      ? {
        appleLiked: Boolean(data.excludes.appleLiked),
        providerWrites: Boolean(data.excludes.providerWrites),
      }
      : {},
    total: numberValue(data.total),
    candidates: arrayValue(data.candidates).map(normalizeMusicCandidate).filter((item): item is MusicCandidateSummary => Boolean(item)),
    aiSummary: normalizeRecommendationAiSummary(data.aiSummary),
    model: normalizeAiModel(data.model),
    savedShortlist: shortlist
      ? {
        id: stringValue(shortlist.id),
        name: stringValue(shortlist.name),
        trackCount: numberValue(shortlist.trackCount),
      }
      : null,
  };
}

function normalizeMusicCandidate(raw: unknown): MusicCandidateSummary | null {
  if (!isRecord(raw)) return null;
  const track = normalizeTrackSummary(raw.track) || {
    title: stringValue(raw.title) || 'Untitled',
    artist: stringValue(raw.artist),
  };
  return {
    key: stringValue(raw.key),
    clusterId: stringValue(raw.clusterId),
    track,
    platforms: arrayValue(raw.platforms).map(stringValue).filter(Boolean),
    platformLabels: arrayValue(raw.platformLabels).map(stringValue).filter(Boolean),
    score: raw.score === null || raw.score === undefined ? undefined : numberValue(raw.score),
    reasons: arrayValue(raw.reasons).map(stringValue).filter(Boolean),
    needsReview: Boolean(raw.needsReview),
    aiReason: stringValue(raw.aiReason),
    aiConfidence: raw.aiConfidence === null || raw.aiConfidence === undefined ? null : numberValue(raw.aiConfidence),
    aiEvidenceRefs: arrayValue(raw.aiEvidenceRefs).map(stringValue).filter(Boolean),
    aiRank: raw.aiRank === null || raw.aiRank === undefined ? null : numberValue(raw.aiRank),
    deterministicRank: raw.deterministicRank === null || raw.deterministicRank === undefined ? null : numberValue(raw.deterministicRank),
  };
}

function normalizeAiProviderTest(raw: unknown): AiProviderTestResult {
  const data = isRecord(raw) ? raw : {};
  return {
    ok: Boolean(data.ok),
    checkedAt: stringValue(data.checkedAt),
    provider: isRecord(data.provider) ? normalizeAiProvider(data.provider) : null,
    model: stringValue(data.model),
    response: isRecord(data.response) ? data.response : undefined,
    usage: isRecord(data.usage) ? data.usage : undefined,
  };
}

function normalizeLiveValidation(raw: unknown): LiveValidationSummary {
  const data = isRecord(raw) ? raw : {};
  const targets = isRecord(data.targets) ? data.targets : {};
  return {
    ok: Boolean(data.ok),
    generatedAt: stringValue(data.generatedAt),
    maxAgeDays: numberValue(data.maxAgeDays),
    targets: Object.fromEntries(
      Object.entries(targets)
        .filter(([key]) => isPlatformKey(key))
        .map(([key, value]) => [key, normalizeLiveValidationTarget(key as PlatformKey, value)]),
    ),
  };
}

function normalizeLiveValidationTarget(target: PlatformKey, raw: unknown): NonNullable<LiveValidationSummary['targets'][PlatformKey]> {
  const data = isRecord(raw) ? raw : {};
  const track = isRecord(data.track) ? data.track : {};
  const snapshots = isRecord(data.snapshots) ? data.snapshots : {};
  const mutations = isRecord(data.mutations) ? data.mutations : {};
  return {
    target,
    ok: Boolean(data.ok),
    status: stringValue(data.status || (data.ok ? 'verified' : 'missing')),
    message: stringValue(data.message),
    reportFile: stringValue(data.reportFile),
    validatedAt: stringValue(data.validatedAt),
    ageDays: data.ageDays === null || data.ageDays === undefined ? null : numberValue(data.ageDays),
    createdPlaylist: Boolean(data.createdPlaylist),
    track: {
      title: stringValue(track.title),
      artist: stringValue(track.artist),
    },
    snapshots: {
      beforeTrackCount: snapshots.beforeTrackCount === null || snapshots.beforeTrackCount === undefined ? null : numberValue(snapshots.beforeTrackCount),
      afterAddTrackCount: snapshots.afterAddTrackCount === null || snapshots.afterAddTrackCount === undefined ? null : numberValue(snapshots.afterAddTrackCount),
      afterRemoveTrackCount: snapshots.afterRemoveTrackCount === null || snapshots.afterRemoveTrackCount === undefined ? null : numberValue(snapshots.afterRemoveTrackCount),
      beforeContainsTrack: snapshots.beforeContainsTrack === null || snapshots.beforeContainsTrack === undefined ? null : Boolean(snapshots.beforeContainsTrack),
      afterAddContainsTrack: snapshots.afterAddContainsTrack === null || snapshots.afterAddContainsTrack === undefined ? null : Boolean(snapshots.afterAddContainsTrack),
      afterRemoveContainsTrack: snapshots.afterRemoveContainsTrack === null || snapshots.afterRemoveContainsTrack === undefined ? null : Boolean(snapshots.afterRemoveContainsTrack),
    },
    mutations: {
      addVerified: Boolean(mutations.addVerified),
      removeVerified: Boolean(mutations.removeVerified),
      added: numberValue(mutations.added),
      removed: numberValue(mutations.removed),
    },
  };
}

function normalizeLiveValidationRun(raw: unknown): LiveValidationRunResult {
  const data = isRecord(raw) ? raw : {};
  const target = isPlatformKey(data.target) ? data.target : 'qq';
  return {
    target: stringValue(data.target),
    ok: Boolean(data.ok),
    status: stringValue(data.status),
    message: stringValue(data.message),
    reportWritten: data.reportWritten !== false,
    validation: normalizeLiveValidationTarget(target, data.validation),
  };
}

function normalizeAgentSessions(raw: unknown): AgentSessionsResult {
  const data = isRecord(raw) ? raw : {};
  return {
    version: numberValue(data.version),
    updatedAt: stringValue(data.updatedAt),
    total: numberValue(data.total),
    sessions: arrayValue(data.sessions).filter(isRecord).map((session) => ({
      id: stringValue(session.id),
      source: stringValue(session.source),
      startedAt: stringValue(session.startedAt),
      updatedAt: stringValue(session.updatedAt),
      toolTraces: arrayValue(session.toolTraces).filter(isRecord).map((trace) => ({
        id: stringValue(trace.id || trace.traceId),
        traceId: stringValue(trace.traceId),
        tool: stringValue(trace.tool),
        source: stringValue(trace.source),
        status: stringValue(trace.status),
        readOnly: Boolean(trace.readOnly),
        localDraft: Boolean(trace.localDraft),
        mutatesProvider: Boolean(trace.mutatesProvider),
        exposesCredentials: Boolean(trace.exposesCredentials),
        calledAt: stringValue(trace.calledAt),
        durationMs: numberValue(trace.durationMs),
        evidenceRefs: arrayValue(trace.evidenceRefs).map(stringValue).filter(Boolean),
        argumentsSummary: isRecord(trace.argumentsSummary) ? trace.argumentsSummary : {},
        resultSummary: isRecord(trace.resultSummary) ? trace.resultSummary : {},
        feedback: isRecord(trace.feedback)
          ? {
            label: stringValue(trace.feedback.label),
            source: stringValue(trace.feedback.source),
            updatedAt: stringValue(trace.feedback.updatedAt),
          }
          : null,
      })),
    })),
  };
}

function normalizeAgentChat(raw: unknown): AgentChatResult {
  const data = isRecord(raw) ? raw : {};
  const result = isRecord(data.result) ? data.result : {};
  const evidenceRefs = [
    ...arrayValue(result.evidenceRefs).map(stringValue).filter(Boolean),
    ...arrayValue(isRecord(result.explanation) ? result.explanation.evidenceRefs : []).map(stringValue).filter(Boolean),
  ];
  return {
    sessionId: stringValue(data.sessionId),
    traceId: stringValue(data.traceId),
    message: stringValue(data.message),
    tool: stringValue(data.tool),
    readOnly: data.readOnly !== false,
    localDraft: Boolean(data.localDraft),
    mutatesProvider: Boolean(data.mutatesProvider),
    exposesCredentials: Boolean(data.exposesCredentials),
    evidenceRefs: [...new Set(evidenceRefs)].slice(0, 8),
    resultSummary: summarizeAgentChatResult(stringValue(data.tool), result),
  };
}

function summarizeAgentChatResult(tool: string, result: Record<string, unknown>): Record<string, unknown> {
  if (tool === 'get_library_summary') {
    const platforms = arrayValue(result.platforms);
    return {
      platformCount: platforms.length,
      nextAction: stringValue(result.nextAction),
    };
  }
  if (tool === 'get_sync_policy') {
    return {
      currentMode: stringValue(isRecord(result.current) ? result.current.id || result.current.mode : ''),
      modeCount: arrayValue(result.modes).length,
    };
  }
  if (tool === 'get_sync_preview' || tool === 'draft_sync_operations') {
    return {
      exists: result.exists !== false,
      bucket: stringValue(result.bucket),
      total: numberValue(result.total),
      returned: arrayValue(result.items).length,
    };
  }
  if (tool === 'get_track_evidence') {
    return {
      exists: result.exists !== false,
      bucket: stringValue(result.bucket),
      recommendedAction: stringValue(isRecord(result.explanation) ? result.explanation.recommendedAction : ''),
      evidenceRefCount: arrayValue(result.evidenceRefs).length,
    };
  }
  if (tool === 'get_baseline_diff') {
    const diff = isRecord(result.diff) ? result.diff : {};
    const summary = isRecord(diff.summary) ? diff.summary : {};
    return {
      exists: result.exists !== false,
      status: stringValue(diff.status || result.status),
      added: numberValue(summary.added),
      deleted: numberValue(summary.deleted),
      exampleCount: arrayValue(diff.examples).length,
    };
  }
  if (tool === 'get_review_queue') {
    const counts = isRecord(result.counts) ? result.counts : {};
    return {
      exists: result.exists !== false,
      bucket: stringValue(result.bucket),
      total: numberValue(result.total),
      returned: arrayValue(result.items).length,
      needsConfirmation: numberValue(counts.needs_confirmation),
      mayDelete: numberValue(counts.may_delete),
    };
  }
  if (tool === 'get_taste_profile') {
    const summary = isRecord(result.summary) ? result.summary : {};
    return {
      trackCount: numberValue(summary.trackCount),
      topArtistCount: arrayValue(summary.topArtists).length,
      modelUsed: Boolean(isRecord(result.model) ? result.model.used : false),
    };
  }
  if (tool === 'find_similar_tracks') {
    return {
      hasSeed: Boolean(result.seed),
      total: numberValue(result.total),
      returned: arrayValue(result.candidates).length,
    };
  }
  if (tool === 'recommend_by_profile' || tool === 'save_local_shortlist') {
    const shortlist = isRecord(result.savedShortlist) ? result.savedShortlist : {};
    return {
      total: numberValue(result.total),
      returned: arrayValue(result.candidates).length,
      savedShortlist: Boolean(shortlist.trackCount),
      providerWrites: Boolean(isRecord(result.excludes) ? result.excludes.providerWrites : false),
    };
  }
  return {
    resultType: Array.isArray(result) ? 'array' : typeof result,
  };
}

function normalizeAgentFeedback(raw: unknown): AgentTraceFeedbackResult {
  const data = isRecord(raw) ? raw : {};
  return {
    sessionId: stringValue(data.sessionId),
    traceId: stringValue(data.traceId),
    feedback: isRecord(data.feedback)
      ? {
        label: stringValue(data.feedback.label),
        source: stringValue(data.feedback.source),
        updatedAt: stringValue(data.feedback.updatedAt),
      }
      : null,
    sessions: isRecord(data.sessions) ? normalizeAgentSessions(data.sessions) : null,
  };
}

function normalizeNamedCounts(raw: unknown): NamedCountSummary[] {
  return arrayValue(raw)
    .filter(isRecord)
    .map((item) => ({
      name: stringValue(item.name),
      count: numberValue(item.count),
    }))
    .filter((item) => item.name);
}

function normalizeNumberRecord(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, numberValue(value)]));
}

function fallbackModes(): SyncModeSummary[] {
  return [
    {
      id: 'canonical_mirror',
      label: '以 Apple Music 为准',
      description: 'Apple Music 是标准，QQ 音乐和网易云音乐跟随它。',
      risk: 'medium',
      recommended: true,
    },
    {
      id: 'union_convergence',
      label: '合并所有平台',
      description: '任一平台喜欢过的歌都会补到其他平台，默认不删除。',
      risk: 'low',
    },
    {
      id: 'managed_bidirectional',
      label: '双向同步',
      description: '新增和删除都会尝试同步，删除前必须确认。',
      risk: 'high',
    },
    {
      id: 'read_only_analysis',
      label: '只分析，不修改',
      description: '只查看差异、画像和推荐，不修改任何平台。',
      risk: 'none',
    },
  ];
}

function nextActionForBuckets(buckets: PreviewBucketSummary[]): string {
  if (buckets.some((bucket) => bucket.id === 'needs_confirmation' && bucket.count > 0)) return '先处理需要确认的歌曲';
  if (buckets.some((bucket) => bucket.id === 'may_delete' && bucket.count > 0)) return '查看可能删除的歌曲';
  if (buckets.some((bucket) => bucket.id === 'will_add' && bucket.count > 0)) return '可以先同步新增';
  return '连接平台后开始同步检查';
}

function normalizeAppleConnectionResult(payload: Record<string, unknown>): AppleConnectionResult {
  const status = normalizeBrowserConnectionStatus(payload.status, payload.message);
  return {
    message: stringValue(payload.message) || status.message || '正在连接 Apple Music。',
    status,
  };
}

function normalizeBrowserConnectionStatus(raw: unknown, fallbackMessage: unknown): BrowserConnectionStatus {
  const status = isRecord(raw) ? raw : {};
  return {
    code: stringValue(status.code) || 'unknown',
    message: stringValue(status.message || fallbackMessage),
    done: Boolean(status.done),
    waiting: Boolean(status.waiting),
    count: numberValue(status.count),
  };
}

function imageDataValue(value: unknown): string | undefined {
  const image = stringValue(value);
  return image.startsWith('data:image/png;base64,') ? image : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stringValue(value: unknown): string {
  return String(value || '').trim();
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isPlatformKey(value: unknown): value is PlatformKey {
  return value === 'apple' || value === 'qq' || value === 'netease';
}

function apiErrorMessage(payload: RawApiResponse, fallback: string): string {
  if (payload.error) return payload.error;
  if (payload.message) return payload.message;
  if (payload.data) {
    if (typeof payload.data === 'string') return payload.data;
    const nested = errorMessage(payload.data);
    if (nested) return nested;
  }
  return fallback;
}

function errorMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  return stringValue(value.error || value.message);
}
