import {
  Archive,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Headphones,
  LoaderCircle,
  Pause,
  PauseCircle,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { createSyncBackup, fetchSyncBackups, resolveSyncTrackMedia, restoreSyncBackup } from '../api/client';

import type {
  AdditionDecisionAction,
  AddResolutionSummary,
  AppStateSummary,
  ConvergenceSummary,
  IdentityDecisionAction,
  PlatformKey,
  PreviewBucketId,
  PreviewTrackItem,
  SyncPreviewDetails,
  SyncBackupRestoreResult,
  SyncBackupStateResult,
  TombstoneAction,
  TrackMediaResult,
  TrackMediaRole,
  TrackSummary,
} from '../api/types';
import { PreviewBucketTabs } from '../components/PreviewBucketTabs';
import {
  AlbumArtwork,
  EvidenceChip,
  evidenceTone,
  formatCount,
  platformLabel,
  PlatformArtwork,
  scoreTone,
  StatusPill,
} from '../components/MusicVisuals';

interface ScreenProps {
  activeBucket: PreviewBucketId;
  appState: AppStateSummary | null;
  lastConvergence: ConvergenceSummary | null;
  previewDetails: SyncPreviewDetails | null;
  onApplyAdditionDecision: (operationId: string, action: AdditionDecisionAction, alternativeIndex?: number) => void;
  onApplyAdditionDecisionBatch: (action: Exclude<AdditionDecisionAction, 'select_alternative'>) => void;
  onApplyIdentityDecision: (operationId: string, action: IdentityDecisionAction) => void;
  onApplyTombstoneDecision: (input: {
    tombstoneKey: string;
    operationId?: string;
    action: TombstoneAction;
    platform?: string;
    confirmText?: string;
  }) => void;
  onApplyTombstoneDecisionBatch: (
    action: Exclude<TombstoneAction, 'confirm_global_delete'>,
    items: Array<{ tombstoneKey: string; operationId?: string; platform?: string }>,
  ) => void;
  onCheckConvergence: () => void;
  onChangeBucket: (bucket: PreviewBucketId) => void;
  onLoadMore: () => void;
  onConfirmDeletions: (confirmText: string) => Promise<boolean>;
  onExecuteAdditions: (dryRun: boolean) => void;
  onExecuteDeletions: () => void;
  onResolveAdditions: () => void;
  onReviewItems: (operationIds?: string[]) => void;
  onRunCheck: () => void;
  onSaveBaseline: () => void;
  onRefreshState: () => Promise<void>;
  onAuditionPlaybackChange: (state: AuditionPlaybackState | null) => void;
  syncBusy: boolean;
  syncError: string;
  syncMessage: string;
}

type TombstoneFilter = 'undecided' | 'qq' | 'netease' | 'decided' | 'all';

export interface AuditionPlaybackState {
  key: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  platform: PlatformKey;
  playing: boolean;
  elapsedSeconds: number;
  limitSeconds: number;
}

export function SyncPreviewScreen({
  activeBucket,
  appState,
  lastConvergence,
  previewDetails,
  onApplyAdditionDecision,
  onApplyAdditionDecisionBatch,
  onApplyIdentityDecision,
  onApplyTombstoneDecision,
  onApplyTombstoneDecisionBatch,
  onCheckConvergence,
  onChangeBucket,
  onLoadMore,
  onConfirmDeletions,
  onExecuteAdditions,
  onExecuteDeletions,
  onResolveAdditions,
  onReviewItems,
  onRunCheck,
  onSaveBaseline,
  onRefreshState,
  onAuditionPlaybackChange,
  syncBusy,
  syncError,
  syncMessage,
}: ScreenProps) {
  const [tombstoneFilter, setTombstoneFilter] = useState<TombstoneFilter>('undecided');
  const [selectedId, setSelectedId] = useState<string>('');
  const buckets = previewDetails?.buckets.length ? previewDetails.buckets : appState?.preview.buckets || [];
  const current = buckets.find((bucket) => bucket.id === activeBucket) || buckets[0];
  const items = previewDetails?.items || [];
  const visibleCandidates = items.filter((item) => item.action === 'add' && (item.candidateTarget || item.resolvedTarget));
  const reviewableItems = items.filter((item) => !item.aiReview && (
    (item.action === 'add' && Boolean(item.candidateTarget))
    || (item.action === 'review' && Boolean(item.sourceTrack) && Boolean(item.targetTrack || item.candidateTarget))
  ));
  const tombstoneItems = items.filter((item) => item.tombstoneKey);
  const displayItems = activeBucket === 'may_delete' && tombstoneItems.length
    ? filterTombstoneItems(tombstoneItems, tombstoneFilter)
    : items;
  const selectedItem = useMemo(
    () => displayItems.find((item) => item.id === selectedId) || displayItems[0] || null,
    [displayItems, selectedId],
  );
  const batchTombstones = displayItems
    .filter((item) => item.tombstoneKey)
    .map((item) => ({
      tombstoneKey: item.tombstoneKey || '',
      operationId: item.id,
      platform: tombstoneSourcePlatform(item),
    }))
    .filter((item) => item.tombstoneKey);
  const writeReadiness = buildWriteReadiness(appState);

  return (
    <section className="preview-screen">
      <div className="preview-flow-strip">
        <div className="flow-source">
          <PlatformArtwork platform="apple" size="md" />
          <div>
            <span>源平台（可信源）</span>
            <strong>Apple Music</strong>
            <small>{formatCount(platformTracks(appState, 'apple'))} 首喜欢歌曲</small>
          </div>
        </div>
        <ChevronRight size={22} />
        <div className="flow-targets">
          <PlatformMini platform="qq" count={platformTracks(appState, 'qq')} />
          <span className="target-plus"><Plus size={15} /></span>
          <PlatformMini platform="netease" count={platformTracks(appState, 'netease')} />
        </div>
        <StatusPill tone={writeReadiness.ok ? 'success' : 'warning'}>
          {writeReadiness.ok ? '本地状态已同步' : '写入验证待检查'}
        </StatusPill>
      </div>

      <div className="preview-layout">
        <div className="review-workspace">
          <div className="section-heading compact">
            <div>
              <h2>曲目复核队列</h2>
              <p>试听跨平台版本并确认匹配关系（当前分类 {formatCount(current?.count || 0)} 首）。</p>
            </div>
            <div className="section-heading-actions">
              <button
                className="secondary-button"
                data-testid="react-ai-review-additions"
                disabled={syncBusy || !reviewableItems.length}
                onClick={() => onReviewItems(reviewableItems.map((item) => item.id))}
                title="发送当前版本的最小化歌曲证据进行 AI 草稿复核"
                type="button"
              >
                <Bot size={16} />
                AI 复核当前页
              </button>
              <button className="ghost-button" disabled={syncBusy} onClick={onRunCheck} type="button">
                <RefreshCcw size={16} />
                重新生成
              </button>
            </div>
          </div>

          <PreviewBucketTabs buckets={buckets} activeBucket={current?.id || activeBucket} onChange={onChangeBucket} />
          <ResolutionSummary resolution={previewDetails?.addResolution || null} />
          <TombstoneToolbar
            activeBucket={activeBucket}
            filter={tombstoneFilter}
            items={tombstoneItems}
            onBatch={onApplyTombstoneDecisionBatch}
            onFilter={setTombstoneFilter}
            selectedItems={batchTombstones}
            syncBusy={syncBusy}
          />
          <SyncStatus error={syncError} message={syncMessage} />

          {displayItems.length ? (
            <>
              <div className="track-table" data-testid="react-preview-list">
                <div className="track-table-head">
                  <span />
                  <span>歌曲</span>
                  <span>源平台</span>
                  <span>QQ 音乐候选</span>
                  <span>网易云候选</span>
                  <span>置信度</span>
                  <span>证据</span>
                  <span>操作</span>
                </div>
                {displayItems.map((item, index) => (
                  <PreviewItem
                    index={index}
                    item={item}
                    key={item.id || `${item.title}-${item.artist}`}
                    onApplyAdditionDecision={onApplyAdditionDecision}
                    onApplyIdentityDecision={onApplyIdentityDecision}
                    onApplyTombstoneDecision={onApplyTombstoneDecision}
                    onReviewItems={onReviewItems}
                    onSelect={() => setSelectedId(item.id)}
                    selected={(selectedItem?.id || '') === item.id}
                    syncBusy={syncBusy}
                  />
                ))}
              </div>
              <div className="preview-load-more" data-testid="react-preview-pagination">
                <span>已加载 {formatCount(items.length)} / {formatCount(previewDetails?.total || items.length)} 首</span>
                {previewDetails?.nextCursor ? (
                  <button className="secondary-button" data-testid="react-preview-load-more" disabled={syncBusy} onClick={onLoadMore} type="button">
                    <ChevronDown size={16} />继续加载
                  </button>
                ) : <small>已显示全部</small>}
              </div>
            </>
          ) : (
            <div className="preview-empty">
              <strong>{current?.label || '暂无预览'}</strong>
              <p>当前有 {formatCount(current?.count || 0)} 个项目。运行同步检查后，这里会显示真实歌曲、目标平台和匹配证据。</p>
            </div>
          )}
        </div>

        <MatchInspector
          item={selectedItem}
          onAuditionPlaybackChange={onAuditionPlaybackChange}
          onApplyAdditionDecision={onApplyAdditionDecision}
          onApplyIdentityDecision={onApplyIdentityDecision}
          onReviewItems={onReviewItems}
          previewId={previewDetails?.previewId || ''}
          syncBusy={syncBusy}
        />
      </div>

      <DeletionSafetyPanel
        hasDeletionSignals={Boolean(buckets.find((bucket) => bucket.id === 'may_delete')?.count)}
        onRefreshState={onRefreshState}
        syncBusy={syncBusy}
        targets={(appState?.platforms || [])
          .filter((platform) => platform.key !== 'apple' && platform.status !== 'not_connected')
          .map((platform) => platform.key)}
      />

      <WriteActionBar
        lastConvergence={lastConvergence}
        onCheckConvergence={onCheckConvergence}
        onConfirmDeletions={onConfirmDeletions}
        onExecuteAdditions={onExecuteAdditions}
        onExecuteDeletions={onExecuteDeletions}
        onResolveAdditions={onResolveAdditions}
        onSaveBaseline={onSaveBaseline}
        previewDetails={previewDetails}
        syncBusy={syncBusy}
        visibleCandidates={visibleCandidates.length}
        writeReadiness={writeReadiness}
      />
    </section>
  );
}

function DeletionSafetyPanel({
  hasDeletionSignals,
  onRefreshState,
  syncBusy,
  targets,
}: {
  hasDeletionSignals: boolean;
  onRefreshState: () => Promise<void>;
  syncBusy: boolean;
  targets: PlatformKey[];
}) {
  const [state, setState] = useState<SyncBackupStateResult | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [restorePreview, setRestorePreview] = useState<SyncBackupRestoreResult | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!syncBusy) void refreshBackups(true);
  }, [syncBusy]);

  async function refreshBackups(silent = false) {
    if (!silent) setBusy(true);
    try {
      const result = await fetchSyncBackups();
      setState(result);
      setSelectedId((current) => result.backups.some((backup) => backup.id === current)
        ? current
        : result.backups[0]?.id || '');
      if (!silent) setError('');
    } catch (refreshError) {
      if (!silent) setError(errorMessage(refreshError));
    } finally {
      if (!silent) setBusy(false);
    }
  }

  async function createBackup() {
    setBusy(true);
    setMessage('正在刷新目标平台并创建恢复点...');
    setError('');
    try {
      const result = await createSyncBackup({ targets });
      await refreshBackups(true);
      setSelectedId(result.backup.id);
      setRestorePreview(null);
      setConfirmText('');
      setMessage('恢复点已创建并通过完整性校验。');
    } catch (backupError) {
      setError(errorMessage(backupError));
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  async function previewRestore() {
    if (!selectedId) return;
    setBusy(true);
    setMessage('正在检查恢复差异...');
    setError('');
    try {
      const result = await restoreSyncBackup({ backupId: selectedId, dryRun: true });
      setRestorePreview(result);
      setConfirmText('');
      setMessage(result.plan.missing ? `发现 ${formatCount(result.plan.missing)} 首可恢复歌曲。` : '当前内容已完整，无需恢复。');
    } catch (restoreError) {
      setError(errorMessage(restoreError));
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  async function executeRestore() {
    if (!restorePreview || !selectedId) return;
    setBusy(true);
    setMessage('正在补回缺失歌曲并验证结果...');
    setError('');
    try {
      const result = await restoreSyncBackup({
        backupId: selectedId,
        dryRun: false,
        confirmText,
      });
      await onRefreshState();
      await refreshBackups(true);
      setRestorePreview(null);
      setConfirmText('');
      setMessage(`恢复完成，已补回 ${formatCount(result.plan.missing)} 首歌曲。`);
    } catch (restoreError) {
      setError(errorMessage(restoreError));
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  const selected = state?.backups.find((backup) => backup.id === selectedId) || null;
  if (!hasDeletionSignals && !state?.backups.length) return null;
  const disabled = busy || syncBusy;

  return (
    <section className="deletion-safety" data-testid="react-deletion-safety">
      <header className="deletion-safety-head">
        <span className="deletion-safety-icon"><ShieldCheck size={19} /></span>
        <div>
          <h2>删除保护</h2>
          <p>真实删除前会自动保存目标平台恢复点。</p>
        </div>
        <StatusPill tone={selected?.integrity.ok ? 'success' : 'neutral'}>
          {selected?.integrity.ok ? '恢复点已校验' : '删除前自动备份'}
        </StatusPill>
      </header>

      <div className="deletion-safety-controls">
        <label>
          <span>恢复点</span>
          <select
            aria-label="选择同步恢复点"
            disabled={disabled || !state?.backups.length}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setRestorePreview(null);
              setConfirmText('');
            }}
            value={selectedId}
          >
            {!state?.backups.length ? <option value="">尚无恢复点</option> : null}
            {(state?.backups || []).map((backup) => (
              <option key={backup.id} value={backup.id}>{formatBackupDate(backup.createdAt)}</option>
            ))}
          </select>
        </label>
        <button className="secondary-button" disabled={disabled || !targets.length} onClick={() => void createBackup()} type="button">
          <Archive size={16} />立即备份
        </button>
        <button className="secondary-button" disabled={disabled || !selected} onClick={() => void previewRestore()} type="button">
          <RotateCcw size={16} />检查恢复
        </button>
      </div>

      {selected ? (
        <div className="backup-summary">
          {selected.targets.map((target) => (
            <span key={target.target}>
              <PlatformArtwork platform={target.target as PlatformKey} size="sm" />
              <strong>{platformLabel(target.target)}</strong>
              <small>{formatCount(target.count)} 首</small>
              <code>{target.checksum.slice(0, 8)}</code>
            </span>
          ))}
        </div>
      ) : null}

      {restorePreview ? (
        <div className="restore-confirm-row">
          <span>
            <strong>{restorePreview.plan.missing ? `可补回 ${formatCount(restorePreview.plan.missing)} 首` : '无需恢复'}</strong>
            <small>仅补回缺失歌曲，现有歌曲保持不变。</small>
          </span>
          {restorePreview.plan.missing ? (
            <>
              <input
                aria-label="恢复确认文本"
                disabled={disabled}
                onChange={(event) => setConfirmText(event.target.value)}
                placeholder={restorePreview.confirmationText}
                value={confirmText}
              />
              <button
                className="danger-outline"
                disabled={disabled || confirmText.trim() !== restorePreview.confirmationText}
                onClick={() => void executeRestore()}
                type="button"
              >
                <RotateCcw size={16} />执行恢复
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {message ? <p className="inline-success">{message}</p> : null}
      {error ? <p className="inline-error">{error}</p> : null}
    </section>
  );
}

function PreviewItem({
  index,
  item,
  onApplyAdditionDecision,
  onApplyIdentityDecision,
  onApplyTombstoneDecision,
  onReviewItems,
  onSelect,
  selected,
  syncBusy,
}: {
  index: number;
  item: PreviewTrackItem;
  onApplyAdditionDecision: (operationId: string, action: AdditionDecisionAction, alternativeIndex?: number) => void;
  onApplyIdentityDecision: (operationId: string, action: IdentityDecisionAction) => void;
  onApplyTombstoneDecision: (input: {
    tombstoneKey: string;
    operationId?: string;
    action: TombstoneAction;
    platform?: string;
    confirmText?: string;
  }) => void;
  onReviewItems: (operationIds?: string[]) => void;
  onSelect: () => void;
  selected: boolean;
  syncBusy: boolean;
}) {
  const qqMatch = candidateForPlatform(item, 'qq');
  const neteaseMatch = candidateForPlatform(item, 'netease');
  return (
    <article
      className={selected ? 'track-row selected' : item.destructive ? 'track-row destructive' : 'track-row'}
      data-testid="react-preview-item"
      onClick={onSelect}
    >
      <button aria-label="选择歌曲" className="row-check" type="button">
        {selected ? <Check size={15} /> : <Circle size={15} />}
      </button>
      <div className="track-cell">
        <AlbumArtwork title={item.title} index={index} src={item.artworkUrl || item.sourceTrack?.artworkUrl} />
        <div>
          <strong>{item.title || 'Untitled'}</strong>
          <span>{item.artist || '未知歌手'}{item.album ? ` · ${item.album}` : ''}</span>
        </div>
      </div>
      <PlatformStack platforms={item.sourcePlatforms} />
      <CandidateCell track={qqMatch} fallback={item.targetPlatforms.includes('qq') ? '待匹配' : '无需写入'} />
      <CandidateCell track={neteaseMatch} fallback={item.targetPlatforms.includes('netease') ? '待匹配' : '无需写入'} />
      <span className={`score-pill ${scoreTone(item.score)}`}>
        {typeof item.score === 'number' ? `${Math.round(item.score * 100)}%` : '-'}
      </span>
      <div className="row-evidence">
        {(item.evidence.length ? item.evidence : item.blockedReason ? [item.blockedReason] : ['本地证据']).slice(0, 3).map((entry) => (
          <EvidenceChip key={entry} tone={evidenceTone(entry)}>{evidenceLabel(entry)}</EvidenceChip>
        ))}
      </div>
      <RowActions
        item={item}
        onApplyAdditionDecision={onApplyAdditionDecision}
        onApplyIdentityDecision={onApplyIdentityDecision}
        onApplyTombstoneDecision={onApplyTombstoneDecision}
        onReviewItems={onReviewItems}
        syncBusy={syncBusy}
      />
    </article>
  );
}

function RowActions({
  item,
  onApplyAdditionDecision,
  onApplyIdentityDecision,
  onApplyTombstoneDecision,
  onReviewItems,
  syncBusy,
}: {
  item: PreviewTrackItem;
  onApplyAdditionDecision: (operationId: string, action: AdditionDecisionAction, alternativeIndex?: number) => void;
  onApplyIdentityDecision: (operationId: string, action: IdentityDecisionAction) => void;
  onApplyTombstoneDecision: (input: {
    tombstoneKey: string;
    operationId?: string;
    action: TombstoneAction;
    platform?: string;
    confirmText?: string;
  }) => void;
  onReviewItems: (operationIds?: string[]) => void;
  syncBusy: boolean;
}) {
  if (item.tombstoneKey) {
    const platform = tombstoneSourcePlatform(item);
    return (
      <div className="row-actions">
        <button disabled={syncBusy} onClick={() => onApplyTombstoneDecision({ tombstoneKey: item.tombstoneKey || '', operationId: item.id, platform, action: 'ignore' })} type="button">忽略</button>
        <button disabled={syncBusy} onClick={() => onApplyTombstoneDecision({ tombstoneKey: item.tombstoneKey || '', operationId: item.id, platform, action: 'restore' })} type="button">恢复</button>
      </div>
    );
  }
  if (item.action === 'review') {
    return (
      <div className="row-actions identity-actions">
        <span className="row-action-note">请在右侧逐项判断</span>
        <button disabled={syncBusy || Boolean(item.aiReview)} onClick={() => onReviewItems([item.id])} type="button">
          {item.aiReview ? 'AI 已分析' : '问 AI'}
        </button>
      </div>
    );
  }
  if (item.action === 'remove') {
    return (
      <div className="row-actions compact-actions">
        <span className="row-action-note">待删除确认</span>
        {item.identityDecision ? (
          <button disabled={syncBusy} onClick={() => onApplyIdentityDecision(item.id, 'clear')} type="button">撤销判断</button>
        ) : null}
      </div>
    );
  }
  if (item.action === 'keep') {
    return (
      <div className="row-actions compact-actions">
        <span className="row-action-note">无需操作</span>
        {item.identityDecision ? (
          <button disabled={syncBusy} onClick={() => onApplyIdentityDecision(item.id, 'clear')} type="button">撤销判断</button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="row-actions">
      <button
        className="accept"
        disabled={syncBusy || !item.candidateTarget}
        onClick={() => onApplyAdditionDecision(item.id, 'accept_candidate')}
        type="button"
      >
        接受
      </button>
      <button disabled={syncBusy || !item.alternatives.length} onClick={() => onApplyAdditionDecision(item.id, 'select_alternative', 0)} type="button">
        换一个
      </button>
      <button disabled={syncBusy} onClick={() => onApplyAdditionDecision(item.id, 'skip')} type="button">跳过</button>
      {item.identityDecision ? (
        <button disabled={syncBusy} onClick={() => onApplyIdentityDecision(item.id, 'clear')} type="button">撤销判断</button>
      ) : (
        <button disabled={syncBusy || !item.candidateTarget || Boolean(item.aiReview)} onClick={() => onReviewItems([item.id])} type="button">
          {item.aiReview ? 'AI 已分析' : '问 AI'}
        </button>
      )}
    </div>
  );
}

function MatchInspector({
  item,
  onAuditionPlaybackChange,
  onApplyAdditionDecision,
  onApplyIdentityDecision,
  onReviewItems,
  previewId,
  syncBusy,
}: {
  item: PreviewTrackItem | null;
  onAuditionPlaybackChange: (state: AuditionPlaybackState | null) => void;
  onApplyAdditionDecision: (operationId: string, action: AdditionDecisionAction, alternativeIndex?: number) => void;
  onApplyIdentityDecision: (operationId: string, action: IdentityDecisionAction) => void;
  onReviewItems: (operationIds?: string[]) => void;
  previewId: string;
  syncBusy: boolean;
}) {
  const versions = useMemo(() => item ? buildAuditionVersions(item) : [], [item]);
  if (!item) {
    return (
      <aside className="match-inspector empty">
        <h2>匹配详情</h2>
        <p>选择一首歌后，这里会显示候选、证据和 AI 说明。</p>
      </aside>
    );
  }
  return (
    <aside className="match-inspector">
      <div className="inspector-head">
        <h2>匹配详情</h2>
      </div>
      <div className="inspector-track">
        <AlbumArtwork title={item.title} index={2} src={item.artworkUrl || item.sourceTrack?.artworkUrl} />
        <div>
          <strong>{item.title}</strong>
          <span>{item.artist || '未知歌手'}</span>
          <small>{item.album || '未知专辑'}</small>
        </div>
      </div>
      {item.action === 'review' ? (
        <div className="identity-task-intro">
          <strong>请逐个平台判断</strong>
          <span>目标平台里的候选，能否代表上面这首 Apple Music 喜欢歌曲？每个决定只影响它所在的平台。</span>
        </div>
      ) : null}
      <div className="audition-section" data-testid="react-version-audition">
        <div className="audition-heading">
          <span><Headphones size={15} />版本试听对比</span>
          <small>不会自动播放 · 每次最多 30 秒</small>
        </div>
        {versions.length ? (
          <VersionAudition
            disabled={syncBusy}
            onAuditionPlaybackChange={onAuditionPlaybackChange}
            onChoose={(version) => {
              if (version.role === 'alternative') {
                onApplyAdditionDecision(version.operationId, 'select_alternative', version.alternativeIndex);
              } else {
                onApplyAdditionDecision(version.operationId, 'accept_candidate');
              }
            }}
            onIdentityDecision={onApplyIdentityDecision}
            onReviewItems={onReviewItems}
            operationId={item.id}
            preload={item.bucket === 'needs_confirmation'}
            previewId={previewId}
            versions={versions}
          />
        ) : <p className="muted-line">还没有可试听的平台版本。</p>}
      </div>
      <div className="evidence-list">
        <h3>证据</h3>
        {(item.evidence.length ? item.evidence : ['本地标题相似', '等待候选查找']).slice(0, 5).map((entry) => (
          <div key={entry}>
            <Check size={15} />
            <span>{evidenceLabel(entry)}</span>
          </div>
        ))}
      </div>
      <div className="ai-note">
        <Bot size={18} />
        <p>{reviewMessage(item)}</p>
      </div>
    </aside>
  );
}

interface AuditionVersion {
  key: string;
  operationId: string;
  role: TrackMediaRole;
  alternativeIndex?: number;
  label: string;
  track: TrackSummary;
  platform: PlatformKey;
  score?: number | null;
  selected: boolean;
  canChoose: boolean;
  aiReviewed: boolean;
  canDecideIdentity: boolean;
  possibleDuplicate: boolean;
}

function VersionAudition({
  disabled,
  onAuditionPlaybackChange,
  onChoose,
  onIdentityDecision,
  onReviewItems,
  operationId,
  preload,
  previewId,
  versions,
}: {
  disabled: boolean;
  onAuditionPlaybackChange: (state: AuditionPlaybackState | null) => void;
  onChoose: (version: AuditionVersion) => void;
  onIdentityDecision: (operationId: string, action: IdentityDecisionAction) => void;
  onReviewItems: (operationIds?: string[]) => void;
  operationId: string;
  preload: boolean;
  previewId: string;
  versions: AuditionVersion[];
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeAlignedRef = useRef(false);
  const activeLimitRef = useRef(30);
  const activeOffsetRef = useRef(0);
  const activeRoleRef = useRef<TrackMediaRole>('source');
  const activeVersionRef = useRef<AuditionVersion | null>(null);
  const activeMediaRef = useRef<TrackMediaResult | null>(null);
  const lastPublishedSecondRef = useRef(-1);
  const segmentStartSourceRef = useRef(0);
  const [mediaByKey, setMediaByKey] = useState<Record<string, TrackMediaResult>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [playingKey, setPlayingKey] = useState('');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.removeAttribute('src');
    setMediaByKey({});
    setLoadingKeys(new Set());
    setErrors({});
    setPlayingKey('');
    setProgress(0);
    activeAlignedRef.current = false;
    activeLimitRef.current = 30;
    activeOffsetRef.current = 0;
    activeRoleRef.current = 'source';
    activeVersionRef.current = null;
    activeMediaRef.current = null;
    lastPublishedSecondRef.current = -1;
    segmentStartSourceRef.current = 0;
    onAuditionPlaybackChange(null);
  }, [onAuditionPlaybackChange, operationId, previewId]);

  useEffect(() => {
    if (!preload || !previewId || !versions.length) return undefined;
    let active = true;
    setLoadingKeys(new Set(versions.map((version) => version.key)));
    for (const version of versions) {
      void resolveVersionMedia(previewId, version, false).then((result) => {
        if (!active) return;
        setMediaByKey((current) => ({ ...current, [version.key]: result }));
      }).catch((error) => {
        if (!active) return;
        setErrors((current) => ({ ...current, [version.key]: errorMessage(error) }));
      }).finally(() => {
        if (!active) return;
        setLoadingKeys((current) => withoutSetValue(current, version.key));
      });
    }
    return () => { active = false; };
  }, [operationId, preload, previewId, versions]);

  useEffect(() => () => {
    audioRef.current?.pause();
    onAuditionPlaybackChange(null);
  }, [onAuditionPlaybackChange]);

  function publishPlayback(
    version: AuditionVersion,
    result: TrackMediaResult,
    playing: boolean,
    elapsedSeconds: number,
  ) {
    onAuditionPlaybackChange({
      key: version.key,
      title: version.track.title || '未命名歌曲',
      artist: version.track.artist || '未知歌手',
      artworkUrl: result.media.artworkUrl || result.track.artworkUrl || version.track.artworkUrl,
      platform: version.platform,
      playing,
      elapsedSeconds,
      limitSeconds: result.media.maxPreviewSeconds || activeLimitRef.current || 30,
    });
  }

  async function ensureMedia(version: AuditionVersion, alignWithSource = false): Promise<TrackMediaResult | null> {
    const existing = mediaByKey[version.key];
    if (existing && (!alignWithSource || version.role === 'source' || existing.media.alignment)) return existing;
    setLoadingKeys((current) => new Set(current).add(version.key));
    setErrors((current) => ({ ...current, [version.key]: '' }));
    try {
      const result = await resolveVersionMedia(previewId, version, alignWithSource);
      setMediaByKey((current) => ({ ...current, [version.key]: result }));
      return result;
    } catch (error) {
      setErrors((current) => ({ ...current, [version.key]: errorMessage(error) }));
      return null;
    } finally {
      setLoadingKeys((current) => withoutSetValue(current, version.key));
    }
  }

  async function togglePlayback(version: AuditionVersion) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingKey === version.key && !audio.paused) {
      audio.pause();
      setPlayingKey('');
      const currentMedia = activeMediaRef.current || mediaByKey[version.key];
      if (currentMedia) publishPlayback(version, currentMedia, false, progress);
      return;
    }
    const result = await ensureMedia(version, version.role !== 'source');
    if (!result?.media.playable || !result.media.previewUrl) return;
    const alignment = result.media.alignment;
    const aligned = alignment?.status === 'aligned';
    const offset = aligned ? alignment.offsetFromSourceSeconds : 0;
    const preservePosition = Boolean(playingKey && !audio.paused && (
      (activeRoleRef.current === 'source' && aligned)
      || (activeAlignedRef.current && (version.role === 'source' || aligned))
    ));
    const sourcePosition = preservePosition
      ? Math.max(0, audio.currentTime - activeOffsetRef.current)
      : aligned ? alignment.sourceStartSeconds : 0;
    const startTime = Math.max(0, sourcePosition + offset);
    if (!audio.paused && activeVersionRef.current && activeMediaRef.current) {
      publishPlayback(activeVersionRef.current, activeMediaRef.current, false, progress);
    }
    audio.pause();
    audio.src = result.media.previewUrl;
    seekAudio(audio, startTime);
    if (!preservePosition) segmentStartSourceRef.current = sourcePosition;
    activeAlignedRef.current = aligned;
    activeLimitRef.current = preservePosition
      ? Math.min(activeLimitRef.current, result.media.maxPreviewSeconds || 30)
      : result.media.maxPreviewSeconds || 30;
    activeOffsetRef.current = offset;
    activeRoleRef.current = version.role;
    activeVersionRef.current = version;
    activeMediaRef.current = result;
    const initialProgress = Math.max(0, sourcePosition - segmentStartSourceRef.current);
    setProgress(initialProgress);
    try {
      await audio.play();
      setPlayingKey(version.key);
      lastPublishedSecondRef.current = Math.floor(initialProgress);
      publishPlayback(version, result, true, initialProgress);
    } catch {
      setPlayingKey('');
      setErrors((current) => ({ ...current, [version.key]: '播放被浏览器拦截，请再点一次。' }));
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || audio.paused || !activeVersionRef.current) return;
    const limit = activeLimitRef.current;
    const sourcePosition = Math.max(0, (audio.currentTime || 0) - activeOffsetRef.current);
    const elapsed = Math.min(limit, Math.max(0, sourcePosition - segmentStartSourceRef.current));
    setProgress(elapsed);
    const activeVersion = activeVersionRef.current;
    const activeMedia = activeMediaRef.current;
    const elapsedSecond = Math.floor(elapsed);
    if (activeVersion && activeMedia && lastPublishedSecondRef.current !== elapsedSecond) {
      lastPublishedSecondRef.current = elapsedSecond;
      publishPlayback(activeVersion, activeMedia, true, elapsed);
    }
    if (elapsed >= limit) {
      audio.pause();
      seekAudio(audio, segmentStartSourceRef.current + activeOffsetRef.current);
      setPlayingKey('');
      setProgress(0);
      if (activeVersion && activeMedia) publishPlayback(activeVersion, activeMedia, false, 0);
    }
  }

  return (
    <div className="audition-list">
      {versions.map((version) => {
        const resolved = mediaByKey[version.key];
        const loading = loadingKeys.has(version.key);
        const unavailable = Boolean(resolved && !resolved.media.playable);
        const issue = errors[version.key] || resolved?.media.reason || '';
        const alignment = resolved?.media.alignment;
        const alignmentLabel = alignment?.status === 'aligned'
          ? `片段已对齐 ${Math.round((alignment.confidence || 0) * 100)}%`
          : alignment ? '片段未对齐' : '';
        const active = playingKey === version.key;
        const duration = formatTrackDuration(version.track.durationMs);
        return (
          <div className={active ? 'audition-row playing' : version.selected ? 'audition-row selected' : 'audition-row'} key={version.key}>
            <AlbumArtwork
              src={resolved?.media.artworkUrl || resolved?.track.artworkUrl || version.track.artworkUrl}
              title={version.track.title}
            />
            <div className="audition-track-copy">
              <span className="audition-platform">
                <PlatformArtwork platform={version.platform} size="sm" />
                {version.label}
                {version.selected ? <small>已选择</small> : null}
              </span>
              <strong>{version.track.title || '未命名歌曲'}</strong>
              <span>{[version.track.artist, version.track.album].filter(Boolean).join(' · ') || '未知歌手'}</span>
              <small>{duration || '时长未知'}{alignmentLabel ? ` · ${alignmentLabel}` : ''}{issue ? ` · ${issue}` : ''}</small>
              {active ? (
                <span className="audition-progress" aria-label={`已播放 ${Math.round(progress)} 秒`}>
                  <i style={{ width: `${Math.min(100, progress / (resolved?.media.maxPreviewSeconds || 30) * 100)}%` }} />
                </span>
              ) : null}
            </div>
            <div className="audition-actions">
              {typeof version.score === 'number' ? <small>{Math.round(version.score * 100)}%</small> : null}
              <button
                aria-label={active ? `暂停 ${version.track.title}` : `试听 ${version.track.title}`}
                className="audition-play"
                disabled={disabled || loading || unavailable}
                onClick={() => void togglePlayback(version)}
                title={issue || alignment?.reason || (active ? '暂停' : alignment?.status === 'aligned' ? '试听已对齐片段' : '试听 30 秒')}
                type="button"
              >
                {loading ? <LoaderCircle className="spin" size={16} /> : active ? <Pause size={16} /> : <Play size={16} />}
              </button>
              {version.canChoose ? (
                <button disabled={disabled || version.selected} onClick={() => onChoose(version)} type="button">
                  {version.selected ? '已选择' : '选此版本'}
                </button>
              ) : null}
            </div>
            {version.canDecideIdentity ? (
              <div className="audition-decision">
                <div>
                  <strong>{version.possibleDuplicate
                    ? `${platformLabel(version.platform)} 里的这个额外版本要保留吗？`
                    : `${platformLabel(version.platform)} 里的这个版本可以代表 Apple Music 源歌曲吗？`}</strong>
                  <span>{version.possibleDuplicate
                    ? '系统已保留另一个匹配版本；移除会把当前额外条目加入待删除，执行前仍需单独确认。'
                    : '“保留”不会改动该平台；“替换”会补入 Apple 对应版本，旧版本仍需单独确认后才会删除。'}</span>
                </div>
                <div className="audition-decision-actions">
                  <button
                    className="keep"
                    disabled={disabled}
                    onClick={() => onIdentityDecision(version.operationId, 'keep')}
                    title={version.possibleDuplicate
                      ? '保留目标平台里的这个额外版本'
                      : '将它视为同一首录音：保留目标平台现有版本，不新增、不删除'}
                    type="button"
                  >
                    <Check size={14} />{version.possibleDuplicate ? '保留额外版本' : '可以，保留'}
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() => onIdentityDecision(version.operationId, 'separate')}
                    title={version.possibleDuplicate
                      ? '将这个额外版本加入待删除；执行删除前仍需确认'
                      : '将它视为不同录音：新增 Apple 对应版本，现有版本进入待删除队列'}
                    type="button"
                  >
                    <X size={14} />{version.possibleDuplicate ? '移除重复项' : '不可以，替换'}
                  </button>
                  <button
                    disabled={disabled || version.aiReviewed}
                    onClick={() => onReviewItems([version.operationId])}
                    type="button"
                  >
                    <Bot size={14} />{version.aiReviewed ? 'AI 已分析' : '问 AI'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      <audio
        aria-hidden="true"
        className="audition-audio"
        onEnded={() => {
          setPlayingKey('');
          setProgress(0);
          if (activeVersionRef.current && activeMediaRef.current) {
            publishPlayback(activeVersionRef.current, activeMediaRef.current, false, 0);
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        preload="none"
        ref={audioRef}
      />
    </div>
  );
}

function WriteActionBar({
  lastConvergence,
  onCheckConvergence,
  onConfirmDeletions,
  onExecuteAdditions,
  onExecuteDeletions,
  onResolveAdditions,
  onSaveBaseline,
  previewDetails,
  syncBusy,
  visibleCandidates,
  writeReadiness,
}: {
  lastConvergence: ConvergenceSummary | null;
  onCheckConvergence: () => void;
  onConfirmDeletions: (confirmText: string) => Promise<boolean>;
  onExecuteAdditions: (dryRun: boolean) => void;
  onExecuteDeletions: () => void;
  onResolveAdditions: () => void;
  onSaveBaseline: () => void;
  previewDetails: SyncPreviewDetails | null;
  syncBusy: boolean;
  visibleCandidates: number;
  writeReadiness: WriteReadiness;
}) {
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const expectedDelete = 'DELETE FROM SELECTED TARGETS';
  const hasPreview = Boolean(previewDetails);
  const canSaveBaseline = Boolean(lastConvergence?.converged || lastConvergence?.status === 'converged');

  async function handleConfirmDeletion() {
    const ok = await onConfirmDeletions(deleteConfirmText);
    setDeleteConfirmed(ok);
  }

  return (
    <footer className="write-action-bar" data-testid="react-write-panel">
      <button data-testid="react-execute-additions-dry-run" disabled={syncBusy || !hasPreview} onClick={() => onExecuteAdditions(true)} type="button">
        <PauseCircle size={20} />
        <span>模拟写入<small>预演本次新增效果</small></span>
      </button>
      <button className="primary-button" data-testid="react-execute-additions-write" disabled={syncBusy || !hasPreview || !writeReadiness.ok} onClick={() => onExecuteAdditions(false)} type="button">
        <Check size={20} />
        <span>执行新增<small>写入目标平台</small></span>
      </button>
      <button data-testid="react-check-convergence" disabled={syncBusy || !hasPreview} onClick={onCheckConvergence} type="button">
        <RefreshCcw size={20} />
        <span>检查一致性<small>执行后验证结果</small></span>
      </button>
      <button data-testid="react-save-baseline" disabled={syncBusy || !hasPreview || !canSaveBaseline} onClick={onSaveBaseline} type="button">
        <ShieldAlert size={20} />
        <span>保存同步基线<small>用于后续变化对比</small></span>
      </button>
      <button disabled={syncBusy || !previewDetails} onClick={onResolveAdditions} type="button">
        <Search size={20} />
        <span>查找对应歌曲<small>{visibleCandidates ? `${visibleCandidates} 个可见候选` : '从目标平台查找'}</small></span>
      </button>
      <div className="delete-confirm-inline">
        <input
          aria-label="删除确认文本"
          data-testid="react-delete-confirm-text"
          disabled={syncBusy || !hasPreview}
          onChange={(event) => {
            setDeleteConfirmText(event.target.value);
            setDeleteConfirmed(false);
          }}
          placeholder={expectedDelete}
          value={deleteConfirmText}
        />
        <button
          className="danger-outline"
          data-testid="react-confirm-deletions"
          disabled={syncBusy || !hasPreview || deleteConfirmText.trim().toUpperCase() !== expectedDelete}
          onClick={handleConfirmDeletion}
          type="button"
        >
          <Trash2 size={20} />
          <span>确认删除项<small>需单独确认</small></span>
        </button>
        <button
          className="danger-outline"
          data-testid="react-execute-deletions"
          disabled={syncBusy || !hasPreview || !writeReadiness.ok || !deleteConfirmed}
          onClick={onExecuteDeletions}
          type="button"
        >
          <Trash2 size={20} />
          <span>执行删除<small>删除前自动备份</small></span>
        </button>
      </div>
    </footer>
  );
}

function TombstoneToolbar({
  activeBucket,
  filter,
  items,
  onBatch,
  onFilter,
  selectedItems,
  syncBusy,
}: {
  activeBucket: PreviewBucketId;
  filter: TombstoneFilter;
  items: PreviewTrackItem[];
  onBatch: (
    action: Exclude<TombstoneAction, 'confirm_global_delete'>,
    items: Array<{ tombstoneKey: string; operationId?: string; platform?: string }>,
  ) => void;
  onFilter: (filter: TombstoneFilter) => void;
  selectedItems: Array<{ tombstoneKey: string; operationId?: string; platform?: string }>;
  syncBusy: boolean;
}) {
  if (activeBucket !== 'may_delete' || !items.length) return null;
  const counts = tombstoneCounts(items);
  return (
    <div className="tombstone-toolbar" data-testid="react-tombstone-toolbar">
      <div>
        <strong>删除信号复核</strong>
        <span>批量操作不会确认全局删除；全局删除必须逐条确认。</span>
      </div>
      <div className="tombstone-filters">
        {tombstoneFilterButton('undecided', '未处理', counts.undecided, filter, onFilter)}
        {tombstoneFilterButton('qq', 'QQ 删除', counts.qq, filter, onFilter)}
        {tombstoneFilterButton('netease', '网易云删除', counts.netease, filter, onFilter)}
        {tombstoneFilterButton('decided', '已处理', counts.decided, filter, onFilter)}
        {tombstoneFilterButton('all', '全部', counts.all, filter, onFilter)}
      </div>
      <div className="candidate-actions">
        <button disabled={syncBusy || !selectedItems.length} onClick={() => onBatch('ignore', selectedItems)} type="button">批量忽略</button>
        <button disabled={syncBusy || !selectedItems.length} onClick={() => onBatch('current_platform_only', selectedItems)} type="button">仅当前平台</button>
        <button disabled={syncBusy || !selectedItems.length} onClick={() => onBatch('restore', selectedItems)} type="button">批量恢复</button>
      </div>
    </div>
  );
}

function ResolutionSummary({ resolution }: { resolution: AddResolutionSummary | null }) {
  if (!resolution) return null;
  return (
    <div className="resolution-summary" data-testid="react-add-resolution-summary">
      <strong>候选查找</strong>
      <span>已查找 {resolution.total} 首</span>
      <span>确认 {resolution.resolved}</span>
      <span>需复核 {resolution.review}</span>
      <span>未找到 {resolution.notFound}</span>
      {resolution.skipped ? <span>跳过目标 {resolution.skipped}</span> : null}
    </div>
  );
}

function PlatformMini({ platform, count }: { platform: PlatformKey; count: number }) {
  return (
    <div className="platform-mini">
      <PlatformArtwork platform={platform} size="sm" />
      <div>
        <strong>{platformLabel(platform)}</strong>
        <span>{formatCount(count)} 首喜欢</span>
      </div>
    </div>
  );
}

function PlatformStack({ platforms }: { platforms: PlatformKey[] }) {
  return (
    <div className="platform-stack">
      {platforms.map((platform) => <PlatformArtwork key={platform} platform={platform} size="sm" />)}
    </div>
  );
}

function CandidateCell({ track, fallback }: { track: TrackSummary | null; fallback: string }) {
  if (!track) return <span className="candidate-cell muted">{fallback}</span>;
  return (
    <span className="candidate-cell">
      <strong>{track.title}</strong>
      <small>{track.artist || '未知歌手'}</small>
    </span>
  );
}

function buildAuditionVersions(item: PreviewTrackItem): AuditionVersion[] {
  const versions: AuditionVersion[] = [];
  const sourcePlatform = trackPlatform(item.sourceTrack, item.sourcePlatforms[0] || 'apple');
  if (item.sourceTrack) {
    versions.push({
      key: `${item.id}:source`,
      operationId: item.id,
      role: 'source',
      label: `${platformLabel(sourcePlatform)} 判断基准`,
      track: item.sourceTrack,
      platform: sourcePlatform,
      selected: false,
      canChoose: false,
      aiReviewed: false,
      canDecideIdentity: false,
      possibleDuplicate: false,
    });
  }

  const relatedMatches = item.action === 'review'
    ? item.relatedMatches.filter((match) => match.action === 'review' && !match.identityDecision)
    : item.relatedMatches;
  const matches = [{
    operationId: item.id,
    action: item.action,
    targetPlatform: item.targetPlatforms[0] || 'qq',
    score: item.score,
    targetTrack: item.targetTrack,
    resolvedTarget: item.resolvedTarget,
    candidateTarget: item.candidateTarget,
    alternatives: item.alternatives,
    addDecision: item.addDecision,
    identityDecision: item.identityDecision,
    aiReview: item.aiReview,
  }, ...relatedMatches];

  for (const match of matches) {
    const targetPlatform = trackPlatform(
      match.resolvedTarget || match.candidateTarget || match.targetTrack,
      match.targetPlatform,
    );
    const primary = match.resolvedTarget || match.candidateTarget || match.targetTrack || null;
    const role: TrackMediaRole = match.resolvedTarget ? 'resolved' : match.candidateTarget ? 'candidate' : 'target';
    if (primary) {
      const accepted = match.addDecision?.action === 'accept_candidate';
      versions.push({
        key: `${match.operationId}:${role}`,
        operationId: match.operationId,
        role,
        label: `${platformLabel(targetPlatform)} ${role === 'target' ? '现有版本' : '当前候选'}`,
        track: primary,
        platform: targetPlatform,
        score: match.score,
        selected: role === 'resolved' || accepted,
        canChoose: match.action === 'add' && role === 'candidate',
        aiReviewed: Boolean(match.aiReview),
        canDecideIdentity: match.action === 'review' && !match.identityDecision,
        possibleDuplicate: match.operationId === item.id && item.evidence.includes('possible_duplicate_target'),
      });
    }
    for (const [alternativeIndex, track] of (match.alternatives || []).slice(0, 2).entries()) {
      const selected = match.addDecision?.action === 'select_alternative'
        && match.addDecision.alternativeIndex === alternativeIndex;
      versions.push({
        key: `${match.operationId}:alternative:${alternativeIndex}`,
        operationId: match.operationId,
        role: 'alternative',
        alternativeIndex,
        label: `${platformLabel(trackPlatform(track, targetPlatform))} 备选 ${alternativeIndex + 1}`,
        track,
        platform: trackPlatform(track, targetPlatform),
        score: match.score,
        selected,
        canChoose: match.action === 'add',
        aiReviewed: Boolean(match.aiReview),
        canDecideIdentity: false,
        possibleDuplicate: false,
      });
    }
  }

  const seen = new Set<string>();
  return versions.filter((version) => {
    const identity = `${version.platform}:${version.track.id || version.track.mid || `${version.track.title}:${version.track.artist}`}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function trackPlatform(track: TrackSummary | null | undefined, fallback: PlatformKey): PlatformKey {
  const platform = track?.platform;
  return platform === 'apple' || platform === 'qq' || platform === 'netease' ? platform : fallback;
}

function resolveVersionMedia(
  previewId: string,
  version: AuditionVersion,
  alignWithSource: boolean,
): Promise<TrackMediaResult> {
  return resolveSyncTrackMedia({
    previewId,
    operationId: version.operationId,
    role: version.role,
    alternativeIndex: version.alternativeIndex,
    alignWithSource,
  });
}

function seekAudio(audio: HTMLAudioElement, seconds: number) {
  const target = Math.max(0, seconds);
  try {
    audio.currentTime = target;
  } catch {
    audio.addEventListener('loadedmetadata', () => {
      audio.currentTime = target;
    }, { once: true });
  }
}

function withoutSetValue(values: Set<string>, value: string): Set<string> {
  const next = new Set(values);
  next.delete(value);
  return next;
}

function formatTrackDuration(durationMs?: number | null): string {
  if (!durationMs || durationMs < 0) return '';
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function SyncStatus({ error, message }: { error: string; message: string }) {
  if (!error && !message) return null;
  return (
    <p className={error ? 'sync-status error' : 'sync-status'} data-testid="react-preview-status" role="status">
      {error || message}
    </p>
  );
}

interface WriteReadiness {
  ok: boolean;
  targets: Array<{
    target: PlatformKey;
    ok: boolean;
    status: string;
    checkedAt?: string;
  }>;
}

function buildWriteReadiness(appState: AppStateSummary | null): WriteReadiness {
  const targets: PlatformKey[] = ['qq', 'netease'];
  const rows = targets.map((target) => {
    const platform = appState?.platforms.find((item) => item.key === target);
    const live = platform?.liveValidation;
    return {
      target,
      ok: Boolean(live?.ok),
      status: live?.status || 'missing',
      checkedAt: live?.checkedAt,
    };
  });
  return {
    ok: rows.every((row) => row.ok),
    targets: rows,
  };
}

function candidateForPlatform(item: PreviewTrackItem, platform: PlatformKey): TrackSummary | null {
  const related = item.relatedMatches.find((match) => match.targetPlatform === platform);
  const candidates = [
    item.resolvedTarget,
    item.candidateTarget,
    item.targetTrack,
    ...item.alternatives,
    related?.resolvedTarget,
    related?.candidateTarget,
    related?.targetTrack,
    ...(related?.alternatives || []),
  ].filter(Boolean) as TrackSummary[];
  return candidates.find((track) => track.platform === platform) || null;
}

function filterTombstoneItems(items: PreviewTrackItem[], filter: TombstoneFilter): PreviewTrackItem[] {
  if (filter === 'all') return items;
  if (filter === 'decided') return items.filter((item) => Boolean(item.tombstoneAction));
  if (filter === 'undecided') return items.filter((item) => !item.tombstoneAction);
  return items.filter((item) => tombstoneSourcePlatform(item) === filter);
}

function tombstoneSourcePlatform(item: PreviewTrackItem): string {
  return item.sourcePlatforms[0] || '';
}

function tombstoneCounts(items: PreviewTrackItem[]) {
  return {
    all: items.length,
    undecided: items.filter((item) => !item.tombstoneAction).length,
    decided: items.filter((item) => Boolean(item.tombstoneAction)).length,
    qq: items.filter((item) => tombstoneSourcePlatform(item) === 'qq').length,
    netease: items.filter((item) => tombstoneSourcePlatform(item) === 'netease').length,
  };
}

function tombstoneFilterButton(
  id: TombstoneFilter,
  label: string,
  count: number,
  active: TombstoneFilter,
  onFilter: (filter: TombstoneFilter) => void,
) {
  return (
    <button
      aria-pressed={active === id}
      className={active === id ? 'active' : ''}
      data-testid={`react-tombstone-filter-${id}`}
      key={id}
      onClick={() => onFilter(id)}
      type="button"
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function platformTracks(appState: AppStateSummary | null, platform: PlatformKey): number {
  return appState?.platforms.find((item) => item.key === platform)?.tracks || 0;
}

function formatBackupDate(value?: string): string {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '操作失败');
}

function evidenceLabel(entry: string): string {
  const labels: Record<string, string> = {
    source_uncertain_match: '来源匹配待确认',
    target_uncertain_orphan: '目标曲目归属待确认',
    duplicate_target_match: '目标平台存在多个候选',
    possible_duplicate_target: '目标平台可能有重复版本',
    reverse_only_match: '仅目标平台反向命中',
    isrc: 'ISRC 证据',
    musicbrainz: 'MusicBrainz 证据',
    exact_recording_fingerprint: '标题、专辑与时长一致',
    local_summary: '本地摘要',
  };
  if (entry.startsWith('score:')) return '综合匹配分';
  return labels[entry] || entry.replaceAll('_', ' ');
}

function reviewMessage(item: PreviewTrackItem): string {
  const duplicateContext = item.evidence.includes('possible_duplicate_target')
    ? '目标平台已有一个版本被保留；当前是额外的相似条目。'
    : '';
  if (item.aiReview) {
    const action = item.aiReview.recommendedAction === 'add'
      ? '建议新增'
      : item.aiReview.recommendedAction === 'skip'
        ? '建议跳过'
        : item.aiReview.recommendedAction === 'keep'
          ? '建议视为同一版本'
          : item.aiReview.recommendedAction === 'separate'
            ? '建议视为不同版本'
        : '仍需人工确认';
    const confidence = `${Math.round(item.aiReview.confidence * 100)}%`;
    const guard = item.aiReview.guarded ? '（安全门禁已降级）' : '';
    return `${duplicateContext} AI 草稿：${action}，置信度 ${confidence}${guard}。${item.aiReview.reason || ''}`.trim();
  }
  if (duplicateContext) {
    return '目标平台已有一个版本被保留；当前这个额外条目可能重复，只有决定是否移除它需要你确认。';
  }
  const messages: Record<string, string> = {
    source_uncertain_match: '目标平台可能已有这首歌，但匹配分低于自动接受阈值，建议核对版本后再决定。',
    duplicate_target_match: '目标平台存在多个相似候选，请优先核对 ISRC、时长和专辑版本。',
    target_uncertain_orphan: '这首歌只在目标平台出现，暂时无法确认是否应保留。',
    reverse_only_match: '目前只有目标平台侧的反向匹配证据，建议人工确认。',
  };
  const reason = item.reason || item.blockedReason || '';
  if (reason && messages[reason]) return messages[reason];
  if (item.message && /[\u3400-\u9fff]/u.test(item.message)) return item.message;
  return '这首歌的候选会依据 ISRC、时长、专辑和歌手信息综合判断。建议先接受高置信度匹配，低置信度留给复核队列。';
}
