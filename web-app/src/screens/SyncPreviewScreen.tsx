import { useState } from 'react';

import type {
  AdditionDecisionAction,
  AddResolutionSummary,
  AppStateSummary,
  ConvergenceSummary,
  PlatformKey,
  PreviewBucketId,
  PreviewTrackItem,
  SyncPreviewDetails,
  TombstoneAction,
  TrackSummary,
} from '../api/types';
import { PreviewBucketTabs } from '../components/PreviewBucketTabs';

interface ScreenProps {
  activeBucket: PreviewBucketId;
  appState: AppStateSummary | null;
  lastConvergence: ConvergenceSummary | null;
  previewDetails: SyncPreviewDetails | null;
  onApplyAdditionDecision: (operationId: string, action: AdditionDecisionAction, alternativeIndex?: number) => void;
  onApplyAdditionDecisionBatch: (action: Exclude<AdditionDecisionAction, 'select_alternative'>) => void;
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
  onConfirmDeletions: (confirmText: string) => Promise<boolean>;
  onExecuteAdditions: (dryRun: boolean) => void;
  onExecuteDeletions: () => void;
  onResolveAdditions: () => void;
  onRunCheck: () => void;
  onSaveBaseline: () => void;
  syncBusy: boolean;
  syncError: string;
  syncMessage: string;
}

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  apple: 'Apple Music',
  qq: 'QQ 音乐',
  netease: '网易云音乐',
};

export function SyncPreviewScreen({
  activeBucket,
  appState,
  lastConvergence,
  previewDetails,
  onApplyAdditionDecision,
  onApplyAdditionDecisionBatch,
  onApplyTombstoneDecision,
  onApplyTombstoneDecisionBatch,
  onCheckConvergence,
  onChangeBucket,
  onConfirmDeletions,
  onExecuteAdditions,
  onExecuteDeletions,
  onResolveAdditions,
  onRunCheck,
  onSaveBaseline,
  syncBusy,
  syncError,
  syncMessage,
}: ScreenProps) {
  const [tombstoneFilter, setTombstoneFilter] = useState<TombstoneFilter>('undecided');
  const buckets = previewDetails?.buckets.length ? previewDetails.buckets : appState?.preview.buckets || [];
  const current = buckets.find((bucket) => bucket.id === activeBucket) || buckets[0];
  const items = previewDetails?.items || [];
  const visibleCandidates = items.filter((item) => item.action === 'add' && item.candidateTarget);
  const tombstoneItems = items.filter((item) => item.tombstoneKey);
  const displayItems = activeBucket === 'may_delete' && tombstoneItems.length
    ? filterTombstoneItems(tombstoneItems, tombstoneFilter)
    : items;
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
    <section className="surface-band">
      <div className="section-heading">
        <h2>先预览，再写入</h2>
        <p>新增和删除分开执行。可能删除只进入确认区，不会自动全局删除。</p>
      </div>
      <PreviewBucketTabs buckets={buckets} activeBucket={current?.id || activeBucket} onChange={onChangeBucket} />
      <ResolutionSummary resolution={previewDetails?.addResolution || null} />
      <WriteExecutionPanel
        lastConvergence={lastConvergence}
        onCheckConvergence={onCheckConvergence}
        onConfirmDeletions={onConfirmDeletions}
        onExecuteAdditions={onExecuteAdditions}
        onExecuteDeletions={onExecuteDeletions}
        onSaveBaseline={onSaveBaseline}
        previewDetails={previewDetails}
        syncBusy={syncBusy}
        writeReadiness={writeReadiness}
      />
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
        <div className="preview-list" data-testid="react-preview-list">
          {displayItems.map((item) => (
            <PreviewItem
              item={item}
              key={item.id || `${item.title}-${item.artist}`}
              onApplyAdditionDecision={onApplyAdditionDecision}
              onApplyTombstoneDecision={onApplyTombstoneDecision}
              syncBusy={syncBusy}
            />
          ))}
        </div>
      ) : (
        <div className="preview-empty">
          <strong>{current?.label || '暂无预览'}</strong>
          <p>
            当前有 {current?.count || 0} 个项目。运行同步检查后，这里会显示真实歌曲、目标平台和匹配证据。
          </p>
        </div>
      )}
      <div className="action-row">
        <button
          data-testid="react-run-sync-check-preview"
          disabled={syncBusy}
          onClick={onRunCheck}
          type="button"
        >
          {syncBusy ? '正在检查' : '重新生成预览'}
        </button>
        <button
          className="secondary"
          data-testid="react-resolve-additions"
          disabled={syncBusy || !previewDetails}
          onClick={onResolveAdditions}
          type="button"
        >
          查找对应歌曲
        </button>
        <button
          className="secondary"
          data-testid="react-batch-accept-additions"
          disabled={syncBusy || !visibleCandidates.length}
          onClick={() => onApplyAdditionDecisionBatch('accept_candidate')}
          type="button"
        >
          批量接受可见候选
        </button>
        <button
          className="secondary"
          data-testid="react-batch-skip-additions"
          disabled={syncBusy || !visibleCandidates.length}
          onClick={() => onApplyAdditionDecisionBatch('skip')}
          type="button"
        >
          批量跳过可见候选
        </button>
      </div>
    </section>
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

interface WriteReadiness {
  ok: boolean;
  targets: Array<{
    target: PlatformKey;
    ok: boolean;
    status: string;
    checkedAt?: string;
  }>;
}

function WriteExecutionPanel({
  lastConvergence,
  onCheckConvergence,
  onConfirmDeletions,
  onExecuteAdditions,
  onExecuteDeletions,
  onSaveBaseline,
  previewDetails,
  syncBusy,
  writeReadiness,
}: {
  lastConvergence: ConvergenceSummary | null;
  onCheckConvergence: () => void;
  onConfirmDeletions: (confirmText: string) => Promise<boolean>;
  onExecuteAdditions: (dryRun: boolean) => void;
  onExecuteDeletions: () => void;
  onSaveBaseline: () => void;
  previewDetails: SyncPreviewDetails | null;
  syncBusy: boolean;
  writeReadiness: WriteReadiness;
}) {
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const expectedDelete = 'DELETE FROM SELECTED TARGETS';
  const deleteTextMatches = deleteConfirmText.trim().toUpperCase() === expectedDelete;
  const hasPreview = Boolean(previewDetails);
  const canSaveBaseline = Boolean(lastConvergence?.converged || lastConvergence?.status === 'converged');

  async function handleConfirmClick() {
    const ok = await onConfirmDeletions(deleteConfirmText);
    setDeleteConfirmed(ok);
  }

  return (
    <div className="write-panel" data-testid="react-write-panel">
      <div className="write-panel-head">
        <div>
          <strong>受控写入</strong>
          <span>新增、删除、收敛检查和保存基线分开执行；真实写入需要 live validation。</span>
        </div>
        <span className={writeReadiness.ok ? 'product-state-pill readable' : 'product-state-pill needs_attention'}>
          {writeReadiness.ok ? '真实写入就绪' : '真实写入受限'}
        </span>
      </div>

      <div className="write-readiness-grid">
        {writeReadiness.targets.map((target) => (
          <div key={target.target}>
            <strong>{PLATFORM_LABELS[target.target]}</strong>
            <span>{target.ok ? 'live validation 已通过' : liveStatusLabel(target.status)}</span>
          </div>
        ))}
      </div>

      <div className="write-action-grid">
        <button data-testid="react-execute-additions-dry-run" disabled={syncBusy || !hasPreview} onClick={() => onExecuteAdditions(true)} type="button">
          模拟新增
        </button>
        <button data-testid="react-execute-additions-write" disabled={syncBusy || !hasPreview || !writeReadiness.ok} onClick={() => onExecuteAdditions(false)} type="button">
          执行新增
        </button>
        <button data-testid="react-check-convergence" disabled={syncBusy || !hasPreview} onClick={onCheckConvergence} type="button">
          检查一致性
        </button>
        <button data-testid="react-save-baseline" disabled={syncBusy || !hasPreview || !canSaveBaseline} onClick={onSaveBaseline} type="button">
          保存同步基线
        </button>
      </div>

      <div className="delete-execution-row">
        <label>
          <span>删除确认文本</span>
          <input
            data-testid="react-delete-confirm-text"
            disabled={syncBusy || !hasPreview}
            onChange={(event) => {
              setDeleteConfirmText(event.target.value);
              setDeleteConfirmed(false);
            }}
            placeholder={expectedDelete}
            value={deleteConfirmText}
          />
        </label>
        <button data-testid="react-confirm-deletions" disabled={syncBusy || !hasPreview || !deleteTextMatches} onClick={handleConfirmClick} type="button">
          保存删除确认
        </button>
        <button
          className="danger"
          data-testid="react-execute-deletions"
          disabled={syncBusy || !hasPreview || !writeReadiness.ok || !deleteConfirmed}
          onClick={onExecuteDeletions}
          type="button"
        >
          执行删除
        </button>
      </div>

      <p className="muted-line">
        {lastConvergence
          ? convergenceCopy(lastConvergence)
          : '执行写入后请检查一致性；只有收敛后才能保存新的同步基线。'}
      </p>
    </div>
  );
}

type TombstoneFilter = 'undecided' | 'qq' | 'netease' | 'decided' | 'all';

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
      <div className="tombstone-toolbar-copy">
        <strong>删除信号复核</strong>
        <span>批量操作不会确认全局删除；全局删除必须逐条输入确认文本。</span>
      </div>
      <div className="tombstone-filters">
        {tombstoneFilterButton('undecided', '未处理', counts.undecided, filter, onFilter)}
        {tombstoneFilterButton('qq', 'QQ 删除', counts.qq, filter, onFilter)}
        {tombstoneFilterButton('netease', '网易云删除', counts.netease, filter, onFilter)}
        {tombstoneFilterButton('decided', '已处理', counts.decided, filter, onFilter)}
        {tombstoneFilterButton('all', '全部', counts.all, filter, onFilter)}
      </div>
      <div className="candidate-actions">
        <button disabled={syncBusy || !selectedItems.length} onClick={() => onBatch('ignore', selectedItems)} type="button">
          批量忽略
        </button>
        <button disabled={syncBusy || !selectedItems.length} onClick={() => onBatch('current_platform_only', selectedItems)} type="button">
          批量仅当前平台
        </button>
        <button disabled={syncBusy || !selectedItems.length} onClick={() => onBatch('restore', selectedItems)} type="button">
          批量恢复
        </button>
      </div>
    </div>
  );
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

function PreviewItem({
  item,
  onApplyAdditionDecision,
  onApplyTombstoneDecision,
  syncBusy,
}: {
  item: PreviewTrackItem;
  onApplyAdditionDecision: (operationId: string, action: AdditionDecisionAction, alternativeIndex?: number) => void;
  onApplyTombstoneDecision: (input: {
    tombstoneKey: string;
    operationId?: string;
    action: TombstoneAction;
    platform?: string;
    confirmText?: string;
  }) => void;
  syncBusy: boolean;
}) {
  return (
    <article className={item.destructive ? 'preview-item destructive' : 'preview-item'} data-testid="react-preview-item">
      <div className="preview-item-head">
        <div>
          <strong>{item.title}</strong>
          <span>{[item.artist, item.album].filter(Boolean).join(' / ') || '未知艺人'}</span>
        </div>
        <span className={`preview-action ${item.bucket}`}>{actionLabel(item)}</span>
      </div>
      <div className="platform-chip-row">
        {item.sourcePlatforms.map((platform) => (
          <span className="platform-chip" key={`source-${platform}`}>
            来源：{PLATFORM_LABELS[platform]}
          </span>
        ))}
        {item.targetPlatforms.map((platform) => (
          <span className="platform-chip" key={`target-${platform}`}>
            目标：{PLATFORM_LABELS[platform]}
          </span>
        ))}
      </div>
      {item.evidence.length || item.score !== null ? (
        <div className="evidence-row">
          {typeof item.score === 'number' ? <span className="evidence-chip">匹配 {Math.round(item.score * 100)}%</span> : null}
          {item.evidence.map((entry) => (
            <span className="evidence-chip" key={entry}>{entry}</span>
          ))}
        </div>
      ) : null}
      <CandidatePanel item={item} onApplyAdditionDecision={onApplyAdditionDecision} syncBusy={syncBusy} />
      <TombstonePanel item={item} onApplyTombstoneDecision={onApplyTombstoneDecision} syncBusy={syncBusy} />
      {item.blockedReason || item.message || item.reason ? (
        <p className="muted-line">{item.blockedReason || item.message || item.reason}</p>
      ) : null}
    </article>
  );
}

function CandidatePanel({
  item,
  onApplyAdditionDecision,
  syncBusy,
}: {
  item: PreviewTrackItem;
  onApplyAdditionDecision: (operationId: string, action: AdditionDecisionAction, alternativeIndex?: number) => void;
  syncBusy: boolean;
}) {
  if (item.action !== 'add') return null;
  const hasCandidate = Boolean(item.candidateTarget);
  const hasResolved = Boolean(item.resolvedTarget);
  const hasDecision = Boolean(item.addDecision?.action);
  if (!hasCandidate && !hasResolved && !hasDecision && !item.alternatives.length && !item.resolution?.message) return null;
  return (
    <div className="candidate-panel" data-testid="react-add-candidate">
      {hasResolved ? (
        <CandidateTrack label="已确认目标" track={item.resolvedTarget} />
      ) : null}
      {hasCandidate ? (
        <CandidateTrack label="待复核候选" track={item.candidateTarget} />
      ) : null}
      {item.resolution?.message ? <p className="muted-line">{item.resolution.message}</p> : null}
      {hasDecision ? <p className="muted-line">本地决策：{decisionLabel(item.addDecision?.action || '')}</p> : null}
      {hasCandidate ? (
        <div className="candidate-actions">
          <button
            data-testid="react-accept-addition"
            disabled={syncBusy}
            onClick={() => onApplyAdditionDecision(item.id, 'accept_candidate')}
            type="button"
          >
            接受候选
          </button>
          <button
            data-testid="react-skip-addition"
            disabled={syncBusy}
            onClick={() => onApplyAdditionDecision(item.id, 'skip')}
            type="button"
          >
            跳过
          </button>
        </div>
      ) : null}
      {item.alternatives.length ? (
        <div className="alternative-list">
          {item.alternatives.map((track, index) => (
            <div className="alternative-row" key={`${track.id || track.mid || track.title}-${index}`}>
              <CandidateTrack label={`备选 ${index + 1}`} track={track} />
              <button
                disabled={syncBusy}
                onClick={() => onApplyAdditionDecision(item.id, 'select_alternative', index)}
                type="button"
              >
                选择
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {hasDecision ? (
        <div className="candidate-actions">
          <button
            disabled={syncBusy}
            onClick={() => onApplyAdditionDecision(item.id, 'clear')}
            type="button"
          >
            清除决策
          </button>
        </div>
      ) : null}
      <p className="muted-line">候选决策只更新本地预览，仍需后续受控新增执行才会写入平台。</p>
    </div>
  );
}

function CandidateTrack({ label, track }: { label: string; track: TrackSummary | null | undefined }) {
  if (!track) return null;
  return (
    <div className="candidate-track">
      <span>{label}</span>
      <strong>{track.title}</strong>
      <small>{[track.artist, track.album].filter(Boolean).join(' / ') || '未知艺人'}</small>
    </div>
  );
}

function TombstonePanel({
  item,
  onApplyTombstoneDecision,
  syncBusy,
}: {
  item: PreviewTrackItem;
  onApplyTombstoneDecision: (input: {
    tombstoneKey: string;
    operationId?: string;
    action: TombstoneAction;
    platform?: string;
    confirmText?: string;
  }) => void;
  syncBusy: boolean;
}) {
  const [confirmText, setConfirmText] = useState('');
  if (!item.tombstoneKey) return null;
  const platform = tombstoneSourcePlatform(item);
  const expected = `CONFIRM GLOBAL DELETE FROM ${String(platform || '').toUpperCase()}`;
  const canConfirm = Boolean(platform) && confirmText.trim().toUpperCase() === expected;
  const baseInput = {
    tombstoneKey: item.tombstoneKey,
    operationId: item.id,
    platform,
  };
  return (
    <div className="tombstone-panel" data-testid="react-tombstone-panel">
      <div className="tombstone-copy">
        <strong>{tombstoneActionLabel(item.tombstoneAction || '')}</strong>
        <span>{platform ? `${platformLabel(platform)} 删除信号` : '删除信号'}</span>
      </div>
      <div className="candidate-actions">
        <button disabled={syncBusy} onClick={() => onApplyTombstoneDecision({ ...baseInput, action: 'ignore' })} type="button">
          忽略
        </button>
        <button disabled={syncBusy} onClick={() => onApplyTombstoneDecision({ ...baseInput, action: 'current_platform_only' })} type="button">
          仅当前平台
        </button>
        <button disabled={syncBusy} onClick={() => onApplyTombstoneDecision({ ...baseInput, action: 'restore' })} type="button">
          恢复
        </button>
        {item.tombstoneAction ? (
          <button disabled={syncBusy} onClick={() => onApplyTombstoneDecision({ ...baseInput, action: 'clear' })} type="button">
            清除
          </button>
        ) : null}
      </div>
      <div className="global-delete-confirm">
        <label>
          <span>确认全局删除</span>
          <input
            data-testid="react-tombstone-confirm-input"
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={expected}
            value={confirmText}
          />
        </label>
        <button
          className="danger"
          data-testid="react-confirm-global-delete"
          disabled={syncBusy || !canConfirm}
          onClick={() => onApplyTombstoneDecision({
            ...baseInput,
            action: 'confirm_global_delete',
            confirmText,
          })}
          type="button"
        >
          确认全局删除
        </button>
      </div>
      <p className="muted-line">这只确认删除意图；真实删除仍需后续受控删除执行。</p>
    </div>
  );
}

function SyncStatus({ error, message }: { error: string; message: string }) {
  if (!error && !message) return null;
  return (
    <p className={error ? 'sync-status error' : 'sync-status'} data-testid="react-preview-status" role="status">
      {error || message}
    </p>
  );
}

function filterTombstoneItems(items: PreviewTrackItem[], filter: TombstoneFilter): PreviewTrackItem[] {
  if (filter === 'all') return items;
  if (filter === 'decided') return items.filter((item) => Boolean(item.tombstoneAction));
  if (filter === 'undecided') return items.filter((item) => !item.tombstoneAction);
  return items.filter((item) => tombstoneSourcePlatform(item) === filter);
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

function liveStatusLabel(status: string): string {
  if (status === 'ready') return 'live validation 已通过';
  if (status === 'stale') return '验证已过期';
  if (status === 'failed') return '验证异常';
  return '缺少验证报告';
}

function convergenceCopy(convergence: ConvergenceSummary): string {
  if (convergence.converged || convergence.status === 'converged') return '当前预览已收敛，可以保存同步基线。';
  const add = convergence.openAdds ?? convergence.add ?? 0;
  const remove = convergence.openDeletes ?? convergence.remove ?? 0;
  const review = convergence.openReviews ?? convergence.review ?? 0;
  return `仍有差异：新增 ${add} / 删除 ${remove} / 复核 ${review}。`;
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

function tombstoneSourcePlatform(item: PreviewTrackItem): string {
  return item.sourcePlatforms[0] || '';
}

function platformLabel(platform: string): string {
  if (platform === 'apple' || platform === 'qq' || platform === 'netease') return PLATFORM_LABELS[platform];
  return platform;
}

function tombstoneActionLabel(action: string): string {
  if (action === 'confirm_global_delete') return '已确认全局删除';
  if (action === 'ignore') return '已忽略';
  if (action === 'restore') return '已选择恢复';
  if (action === 'current_platform_only') return '仅当前平台删除';
  if (action === 'clear') return '已清除';
  return '未处理';
}

function actionLabel(item: PreviewTrackItem): string {
  if (item.bucket === 'will_add') return item.addDecision?.action === 'skip' ? '已跳过' : '新增';
  if (item.bucket === 'will_keep') return '保留';
  if (item.bucket === 'needs_confirmation') return '确认';
  if (item.bucket === 'may_delete') return item.destructive ? '待确认删除' : '删除复核';
  return item.action || item.status || '预览';
}

function decisionLabel(action: string): string {
  if (action === 'accept_candidate') return '接受候选';
  if (action === 'select_alternative') return '选择备选';
  if (action === 'skip') return '跳过';
  if (action === 'clear') return '已清除';
  return action || '未处理';
}
