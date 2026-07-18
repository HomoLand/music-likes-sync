export type PlatformKey = 'apple' | 'qq' | 'netease';

export type PlatformStatus = 'readable' | 'writable' | 'needs_attention' | 'not_connected';

export type SyncModeId = 'canonical_mirror' | 'union_convergence' | 'managed_bidirectional' | 'read_only_analysis';

export type PreviewBucketId = 'will_add' | 'will_keep' | 'needs_confirmation' | 'may_delete';

export type AdditionDecisionAction = 'accept_candidate' | 'select_alternative' | 'skip' | 'clear';

export type TombstoneAction = 'confirm_global_delete' | 'ignore' | 'restore' | 'current_platform_only' | 'clear';

export interface PlatformSummary {
  key: PlatformKey;
  label: string;
  status: PlatformStatus;
  credentialPresent: boolean;
  tracks: number;
  writable?: boolean;
  liveValidation?: {
    ok: boolean;
    status: 'ready' | 'stale' | 'missing' | 'failed';
    checkedAt?: string;
  };
}

export interface SyncModeSummary {
  id: SyncModeId;
  label: string;
  description: string;
  risk: 'low' | 'medium' | 'high' | 'none';
  recommended?: boolean;
}

export interface PreviewBucketSummary {
  id: PreviewBucketId;
  label: string;
  count: number;
  risk: 'low' | 'medium' | 'high' | 'none';
}

export interface RecentRunSummary {
  status: 'completed' | 'failed' | 'running' | 'dry_run' | 'none';
  dryRun?: boolean;
  targets?: PlatformKey[];
  addRequested?: number;
  removeRequested?: number;
  updatedAt?: string;
}

export interface AppStateSummary {
  platforms: PlatformSummary[];
  currentMode: SyncModeId;
  modes: SyncModeSummary[];
  preview: {
    generatedAt?: string;
    buckets: PreviewBucketSummary[];
    nextAction: string;
  };
  latestRun?: RecentRunSummary;
  baseline?: {
    saved: boolean;
    updatedAt?: string;
    added?: number;
    deleted?: number;
  };
  autoSync?: AutoSyncSummary;
}

export type AutoSyncStatus = 'never' | 'disabled' | 'running' | 'completed' | 'attention' | 'failed' | 'skipped';

export interface AutoSyncSummary {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  targets: PlatformKey[];
  refreshApple: boolean;
  refreshTargets: boolean;
  autoExecuteAdditions: boolean;
  requireBaseline: boolean;
  maxSourceAgeMinutes: number;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus: AutoSyncStatus;
  lastMessage?: string;
  lastRunId?: string;
  historyCount: number;
}

export interface AutoSyncReadinessReason {
  code: string;
  platform?: PlatformKey | string;
  message: string;
}

export interface AutoSyncReadiness {
  ok: boolean;
  reasons: AutoSyncReadinessReason[];
  policy: { id: SyncModeId | string; label: string };
  baseline: { exists: boolean; savedAt?: string; required: boolean };
  snapshots: Partial<Record<PlatformKey, {
    available: boolean;
    fetchedAt?: string;
    ageMinutes?: number | null;
    tracks: number;
  }>>;
  liveValidation: {
    ok: boolean;
    targets: Partial<Record<PlatformKey, { ok: boolean; status: string; validatedAt?: string }>>;
  };
}

export interface AutoSyncRunSummary {
  id: string;
  trigger: 'manual' | 'scheduled' | 'startup' | string;
  status: AutoSyncStatus;
  startedAt?: string;
  completedAt?: string;
  policy: SyncModeId | string;
  targets: PlatformKey[];
  dryRun: boolean;
  message?: string;
  snapshotRefresh: Record<string, unknown>;
  preview: {
    previewId?: string;
    generatedAt?: string;
    willAdd?: number;
    needsConfirmation?: number;
    mayDelete?: number;
  };
  additions: {
    requested?: number;
    succeeded?: number;
    failed?: number;
    blocked?: number;
  };
  deletionSignals: number;
  convergence?: ConvergenceSummary | null;
  error?: string;
}

export interface AutoSyncStateResult {
  automation: AutoSyncSummary;
  readiness: AutoSyncReadiness;
  history: AutoSyncRunSummary[];
  run?: AutoSyncRunSummary | null;
}

export interface ConnectionActionResult {
  message: string;
}

export interface BrowserConnectionStatus extends ConnectionActionResult {
  code: string;
  done: boolean;
  waiting: boolean;
  count?: number;
}

export interface AppleConnectionResult extends ConnectionActionResult {
  status: BrowserConnectionStatus;
}

export interface QQBrowserLoginResult extends ConnectionActionResult {
  status?: BrowserConnectionStatus;
  credential?: {
    fieldCount: number;
    hasAccount: boolean;
    writeReady: boolean;
  } | null;
}

export interface QQQrSession extends ConnectionActionResult {
  key: string;
  images: {
    qq?: string;
    wechat?: string;
  };
  expiresAt: string;
  status: BrowserConnectionStatus;
}

export interface NeteaseQrSession extends ConnectionActionResult {
  key: string;
  image: string;
  loginUrl?: string;
}

export interface NeteaseQrStatus extends ConnectionActionResult {
  code: number;
  done: boolean;
  waiting: boolean;
}

export interface QQPlaylistSummary {
  index: number;
  name: string;
  dirid: string;
  tid: string;
  dissid: string;
  id: string;
  songCount: number;
  listenCount: number;
  isLiked: boolean;
}

export interface QQPlaylistsResult extends ConnectionActionResult {
  playlists: QQPlaylistSummary[];
}

export interface SyncCheckResult {
  previewId: string;
  generatedAt?: string;
  mode: SyncModeId;
  buckets: PreviewBucketSummary[];
  nextAction: string;
}

export interface TrackSummary {
  platform?: PlatformKey | string;
  id?: string;
  mid?: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number | null;
  isrc?: string | null;
  songType?: number | null;
  artworkUrl?: string;
}

export type TrackMediaRole = 'source' | 'target' | 'candidate' | 'resolved' | 'alternative';

export interface TrackMediaAlignment {
  status: 'aligned' | 'not_aligned' | 'unavailable';
  method: 'chromaprint' | string;
  confidence: number | null;
  offsetFromSourceSeconds: number;
  sourceStartSeconds: number;
  targetStartSeconds: number;
  overlapSeconds: number;
  maxPreviewSeconds: number;
  reason?: string;
}

export interface TrackMediaResult {
  previewId: string;
  operationId: string;
  role: TrackMediaRole;
  alternativeIndex?: number | null;
  track: TrackSummary;
  media: {
    artworkUrl: string;
    previewUrl: string;
    playable: boolean;
    reason?: string;
    expiresAt?: string;
    maxPreviewSeconds: number;
    alignment?: TrackMediaAlignment | null;
  };
}

export interface AddDecisionSummary {
  action: AdditionDecisionAction | string;
  alternativeIndex?: number | null;
  batchId?: string;
  decidedAt?: string;
}

export type IdentityDecisionAction = 'keep' | 'separate' | 'clear';

export interface IdentityDecisionSummary {
  action: IdentityDecisionAction | string;
  decidedAt?: string;
  originalReason?: string;
}

export interface AddAiReviewSummary {
  batchId?: string;
  model?: string;
  reviewedAt?: string;
  recommendedAction: 'add' | 'skip' | 'needs_human' | string;
  relation: 'same_recording' | 'same_song_different_version' | 'different_song' | 'uncertain' | string;
  confidence: number;
  reason?: string;
  guarded: boolean;
}

export interface PreviewTrackItem {
  id: string;
  bucket: PreviewBucketId;
  action: string;
  status: string;
  destructive: boolean;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  sourceTrack?: TrackSummary | null;
  targetTrack?: TrackSummary | null;
  sourcePlatforms: PlatformKey[];
  targetPlatforms: PlatformKey[];
  reason?: string;
  message?: string;
  blockedReason?: string;
  evidence: string[];
  score?: number | null;
  resolvedTarget?: TrackSummary | null;
  candidateTarget?: TrackSummary | null;
  alternatives: TrackSummary[];
  relatedMatches: Array<{
    operationId: string;
    action: string;
    targetPlatform: PlatformKey;
    score?: number | null;
    targetTrack?: TrackSummary | null;
    resolvedTarget?: TrackSummary | null;
    candidateTarget?: TrackSummary | null;
    alternatives: TrackSummary[];
    addDecision?: Pick<AddDecisionSummary, 'action' | 'alternativeIndex'> | null;
  }>;
  resolution?: {
    reason?: string;
    message?: string;
  } | null;
  addDecision?: AddDecisionSummary | null;
  identityDecision?: IdentityDecisionSummary | null;
  aiReview?: AddAiReviewSummary | null;
  tombstoneKey?: string;
  tombstoneAction?: string;
}

export interface AddResolutionTargetSummary {
  target: PlatformKey | string;
  processed: number;
  resolved: number;
  review: number;
  notFound: number;
  skipped: boolean;
  reason?: string;
}

export interface AddResolutionSummary {
  resolvedAt?: string;
  targets: AddResolutionTargetSummary[];
  total: number;
  resolved: number;
  review: number;
  notFound: number;
  skipped: number;
}

export interface SyncPreviewDetails {
  previewId: string;
  generatedAt?: string;
  mode: SyncModeId;
  bucket: PreviewBucketId | 'all';
  buckets: PreviewBucketSummary[];
  total: number;
  nextCursor?: string | null;
  items: PreviewTrackItem[];
  addResolution?: AddResolutionSummary | null;
}

export interface ResolveAdditionsResult {
  preview: SyncPreviewDetails;
  addResolution?: AddResolutionSummary | null;
}

export interface ReviewAdditionsResult {
  batchId?: string;
  model?: string;
  changed: number;
  summary: {
    total: number;
    add: number;
    skip: number;
    needsHuman: number;
    guarded: number;
  };
  preview: SyncPreviewDetails;
}

export interface ReviewIdentityResult {
  batchId?: string;
  model?: string;
  changed: number;
  summary: {
    total: number;
    keep: number;
    separate: number;
    needsHuman: number;
    guarded: number;
  };
  preview: SyncPreviewDetails;
}

export interface IdentityDecisionResult {
  previewId: string;
  action: IdentityDecisionAction | string;
  decisionKey?: string;
  preview: SyncPreviewDetails;
}

export interface AdditionDecisionResult {
  previewId: string;
  generatedAt?: string;
  buckets: PreviewBucketSummary[];
  addResolution?: AddResolutionSummary | null;
  operation?: PreviewTrackItem | null;
  operations?: PreviewTrackItem[];
  requested?: number;
  changed?: number;
  skipped?: number;
}

export interface TombstoneSummary {
  total: number;
  updatedAt?: string;
  actions: Record<string, number>;
}

export interface TombstoneDecisionResult {
  decision?: {
    key: string;
    action: TombstoneAction | string;
    platform?: PlatformKey | string;
    updatedAt?: string;
  } | null;
  batch?: boolean;
  requested?: number;
  changed?: number;
  tombstones?: TombstoneSummary | null;
  preview?: {
    previewId?: string;
    generatedAt?: string;
    buckets: PreviewBucketSummary[];
  } | null;
}

export interface AiProviderSummary {
  provider: string;
  model: string;
  baseUrl?: string;
  hasApiKey?: boolean;
  configured?: boolean;
  stateExists?: boolean;
  updatedAt?: string;
  batchSize?: number;
}

export interface AiModelSummary {
  used: boolean;
  skippedReason?: string;
  provider?: AiProviderSummary | null;
  model?: string;
  usage?: Record<string, unknown>;
}

export interface NamedCountSummary {
  name: string;
  count: number;
}

export interface MusicProfileResult {
  generatedAt?: string;
  updatedAt?: string;
  summary: {
    trackCount: number;
    sourceTrackCount?: number;
    topArtists: NamedCountSummary[];
    topAlbums: NamedCountSummary[];
    languages: NamedCountSummary[];
    platformCoverage: Record<string, number>;
    averageDurationMs?: number | null;
    isrcCoverage?: number;
    reviewSignals: Record<string, number>;
  };
  aiSummary?: {
    source?: string;
    summary?: string;
    tasteTags: string[];
    listeningPatterns: string[];
    recommendationAngles: string[];
    caveats: string[];
    confidence?: number;
    evidenceRefs: string[];
  } | null;
  model?: AiModelSummary | null;
}

export interface MusicCandidateSummary {
  key?: string;
  clusterId?: string;
  track: TrackSummary;
  platforms: string[];
  platformLabels: string[];
  score?: number;
  reasons: string[];
  needsReview?: boolean;
  aiReason?: string;
  aiConfidence?: number | null;
  aiEvidenceRefs: string[];
  aiRank?: number | null;
  deterministicRank?: number | null;
}

export interface SimilarTracksResult {
  seed: MusicCandidateSummary | null;
  total: number;
  candidates: MusicCandidateSummary[];
  reason?: string;
}

export interface RecommendationResult {
  generatedAt?: string;
  source?: string;
  excludes: {
    appleLiked?: boolean;
    providerWrites?: boolean;
  };
  total: number;
  candidates: MusicCandidateSummary[];
  aiSummary?: {
    source?: string;
    summary?: string;
    recommendationAngles: string[];
    caveats: string[];
    evidenceRefs: string[];
  } | null;
  model?: AiModelSummary | null;
  savedShortlist?: {
    id?: string;
    name?: string;
    trackCount: number;
  } | null;
}

export interface AiProviderTestResult {
  ok: boolean;
  checkedAt?: string;
  provider?: AiProviderSummary | null;
  model?: string;
  response?: Record<string, unknown>;
  usage?: Record<string, unknown>;
}

export type AgentFeedbackLabel = 'useful' | 'not_enough_evidence' | 'incorrect';

export interface AgentTraceSummary {
  id: string;
  traceId?: string;
  tool: string;
  source?: string;
  status: string;
  readOnly?: boolean;
  localDraft?: boolean;
  mutatesProvider?: boolean;
  exposesCredentials?: boolean;
  calledAt?: string;
  durationMs?: number;
  evidenceRefs: string[];
  argumentsSummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  feedback?: {
    label?: AgentFeedbackLabel | string;
    source?: string;
    updatedAt?: string;
  } | null;
}

export interface AgentSessionSummary {
  id: string;
  source?: string;
  startedAt?: string;
  updatedAt?: string;
  toolTraces: AgentTraceSummary[];
}

export interface AgentSessionsResult {
  version?: number;
  updatedAt?: string;
  total: number;
  sessions: AgentSessionSummary[];
}

export interface AgentTraceFeedbackResult {
  sessionId?: string;
  traceId?: string;
  feedback?: {
    label?: AgentFeedbackLabel | string;
    source?: string;
    updatedAt?: string;
  } | null;
  sessions?: AgentSessionsResult | null;
}

export interface AgentChatResult {
  sessionId: string;
  traceId: string;
  message: string;
  tool: string;
  readOnly: boolean;
  localDraft: boolean;
  mutatesProvider: boolean;
  exposesCredentials: boolean;
  evidenceRefs: string[];
  resultSummary: Record<string, unknown>;
}

export interface LiveValidationTargetSummary {
  target: PlatformKey | string;
  ok: boolean;
  status: 'verified' | 'stale' | 'missing' | 'failed' | string;
  message?: string;
  reportFile?: string;
  validatedAt?: string;
  ageDays?: number | null;
  createdPlaylist?: boolean;
  track?: {
    title?: string;
    artist?: string;
  };
  snapshots?: {
    beforeTrackCount?: number | null;
    afterAddTrackCount?: number | null;
    afterRemoveTrackCount?: number | null;
    beforeContainsTrack?: boolean | null;
    afterAddContainsTrack?: boolean | null;
    afterRemoveContainsTrack?: boolean | null;
  };
  mutations?: {
    addVerified?: boolean;
    removeVerified?: boolean;
    added?: number;
    removed?: number;
  };
}

export interface LiveValidationSummary {
  ok: boolean;
  generatedAt?: string;
  maxAgeDays?: number;
  targets: Partial<Record<PlatformKey, LiveValidationTargetSummary>>;
}

export interface LiveValidationRunResult {
  target: PlatformKey | string;
  ok: boolean;
  status: string;
  message?: string;
  reportWritten: boolean;
  validation: LiveValidationTargetSummary;
}

export interface ExecutionActionSummary {
  requested: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
}

export interface SyncExecutionResult {
  target?: PlatformKey | 'multi' | string;
  targets: Partial<Record<PlatformKey, Record<string, unknown>>>;
  targetOrder: string[];
  dryRun: boolean;
  action?: 'add' | 'remove' | string;
  add?: ExecutionActionSummary;
  remove?: ExecutionActionSummary;
  convergence?: ConvergenceSummary | null;
  backup?: SyncBackupSummary | null;
}

export interface SyncBackupTargetSummary {
  target: PlatformKey | string;
  fetchedAt?: string;
  count: number;
  restorable: number;
  checksum: string;
}

export interface SyncBackupSummary {
  id: string;
  createdAt?: string;
  previewId?: string;
  policy?: string;
  reason?: string;
  targets: SyncBackupTargetSummary[];
  integrity: {
    ok: boolean;
    targets: string[];
    errors: string[];
  };
}

export interface SyncRestoreRunSummary {
  id: string;
  backupId: string;
  startedAt?: string;
  completedAt?: string;
  status: 'preview' | 'completed' | 'failed' | string;
  dryRun: boolean;
  targets: string[];
  summary: SyncRestorePlanSummary;
  error?: string;
}

export interface SyncRestorePlanSummary {
  targets: Partial<Record<PlatformKey, {
    backupCount: number;
    currentCount: number;
    missing: number;
    unrestorable: number;
  }>>;
  targetCount: number;
  backupTracks: number;
  missing: number;
  unrestorable: number;
  remainingMissing?: number;
}

export interface SyncBackupStateResult {
  version: number;
  updatedAt?: string;
  backups: SyncBackupSummary[];
  restoreRuns: SyncRestoreRunSummary[];
}

export interface SyncBackupCreateResult {
  backup: SyncBackupSummary;
  updatedAt?: string;
  retained: number;
}

export interface SyncBackupRestoreResult {
  dryRun: boolean;
  backup: SyncBackupSummary;
  confirmationText: string;
  plan: SyncRestorePlanSummary;
  writes: Partial<Record<PlatformKey, {
    requested: number;
    submitted: number;
    accepted: number;
    added: number;
    alreadyPresent: number;
    verified: boolean;
    missing: number;
  }>>;
  restoreRun: SyncRestoreRunSummary;
}

export interface DeleteConfirmationResult {
  target?: PlatformKey | 'multi' | string;
  confirmed: number;
  operationIds: string[];
  tombstones?: TombstoneSummary | null;
}

export interface ConvergenceSummary {
  exists?: boolean;
  status?: string;
  converged?: boolean;
  previewId?: string;
  generatedAt?: string;
  refreshedAt?: string;
  openAdds?: number;
  openDeletes?: number;
  openReviews?: number;
  add?: number;
  remove?: number;
  review?: number;
  message?: string;
}

export interface SyncConvergenceResult {
  mode?: SyncModeId | string;
  convergence?: ConvergenceSummary | null;
  preview?: {
    previewId?: string;
    generatedAt?: string;
    counts?: Record<string, number>;
    convergence?: ConvergenceSummary | null;
  } | null;
}

export interface BaselineSaveResult {
  baseline?: {
    saved?: boolean;
    updatedAt?: string;
    summary?: {
      tracks?: number;
      platforms?: string[];
    };
  } | null;
  activatedPolicy?: {
    id?: SyncModeId | string;
    label?: string;
  } | null;
  preview?: {
    previewId?: string;
    generatedAt?: string;
    counts?: Record<string, number>;
    convergence?: ConvergenceSummary | null;
  } | null;
}
