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
}

export interface AddDecisionSummary {
  action: AdditionDecisionAction | string;
  alternativeIndex?: number | null;
  batchId?: string;
  decidedAt?: string;
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
  resolution?: {
    reason?: string;
    message?: string;
  } | null;
  addDecision?: AddDecisionSummary | null;
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
