import { useEffect, useMemo, useState } from 'react';

import {
  applyAdditionDecision,
  applyAdditionDecisionBatch,
  applyTombstoneDecision,
  applyTombstoneDecisionBatch,
  checkConvergence,
  confirmDeletions,
  executeAdditions,
  executeDeletions,
  fetchAppState,
  fetchSyncPreview,
  resolveAdditions,
  runSyncCheck,
  saveBaseline,
} from '../api/client';
import type {
  AdditionDecisionAction,
  AppStateSummary,
  ConvergenceSummary,
  PlatformKey,
  PreviewBucketId,
  SyncModeId,
  SyncPreviewDetails,
  TombstoneAction,
} from '../api/types';
import { AdvancedSettingsScreen } from '../screens/AdvancedSettingsScreen';
import { AiAssistantScreen } from '../screens/AiAssistantScreen';
import { ConnectPlatformsScreen } from '../screens/ConnectPlatformsScreen';
import { OverviewScreen } from '../screens/OverviewScreen';
import { SyncModeScreen } from '../screens/SyncModeScreen';
import { SyncPreviewScreen } from '../screens/SyncPreviewScreen';
import { routes, type RouteId } from './routes';

const SCREEN_TITLE: Record<RouteId, string> = {
  overview: '你的音乐库',
  connect: '连接平台',
  mode: '同步方式',
  preview: '同步预览',
  ai: 'AI 助手',
  advanced: '高级设置',
};

const FALLBACK_NEXT_ACTION = '连接平台后开始同步检查';

const WRITE_TARGETS: PlatformKey[] = ['qq', 'netease'];

export function App() {
  const [activeRoute, setActiveRoute] = useState<RouteId>('overview');
  const [appState, setAppState] = useState<AppStateSummary | null>(null);
  const [selectedMode, setSelectedMode] = useState<SyncModeId>('canonical_mirror');
  const [previewDetails, setPreviewDetails] = useState<SyncPreviewDetails | null>(null);
  const [activePreviewBucket, setActivePreviewBucket] = useState<PreviewBucketId>('will_add');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [lastConvergence, setLastConvergence] = useState<ConvergenceSummary | null>(null);

  useEffect(() => {
    let active = true;
    fetchAppState()
      .then((state) => {
        if (!active) return;
        setAppState(state);
        setSelectedMode(state.currentMode);
        setLoadError('');
      })
      .catch((error: Error) => {
        if (!active) return;
        setLoadError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const nextAction = useMemo(() => appState?.preview.nextAction || FALLBACK_NEXT_ACTION, [appState]);

  async function handleRunSyncCheck() {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在生成同步预览...');
    try {
      const result = await runSyncCheck({
        mode: selectedMode,
        targets: ['qq', 'netease'],
        platforms: ['apple', 'qq', 'netease'],
      });
      setLastConvergence(null);
      const bucket = pickPreviewBucket(result.buckets);
      const preview = await fetchSyncPreview({ bucket, limit: 30 });
      setSelectedMode(result.mode);
      setActivePreviewBucket(bucket);
      setPreviewDetails(preview);
      setAppState((current) => current
        ? {
          ...current,
          currentMode: result.mode,
          preview: {
            generatedAt: result.generatedAt,
            buckets: result.buckets,
            nextAction: result.nextAction,
          },
        }
        : current);
      setSyncMessage(`已生成同步预览，当前显示「${bucketLabel(bucket)}」。`);
      setActiveRoute('preview');
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleLoadPreview(bucket: PreviewBucketId) {
    setActivePreviewBucket(bucket);
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage(`正在读取「${bucketLabel(bucket)}」...`);
    try {
      const preview = await fetchSyncPreview({ bucket, limit: 30 });
      setPreviewDetails(preview);
      setAppState((current) => current
        ? {
          ...current,
          preview: {
            generatedAt: preview.generatedAt,
            buckets: preview.buckets,
            nextAction: current.preview.nextAction,
          },
        }
        : current);
      setSyncMessage(`已读取「${bucketLabel(bucket)}」，共 ${preview.total} 首。`);
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleResolveAdditions() {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在查找目标平台对应歌曲...');
    try {
      const result = await resolveAdditions({
        bucket: activePreviewBucket,
        targets: ['qq', 'netease'],
        resolveLimit: 50,
        searchLimit: 12,
      });
      setPreviewDetails(result.preview);
      setAppStateFromPreview(result.preview, result.preview.nextCursor ? undefined : result.preview.buckets);
      setSyncMessage(addResolutionMessage(result.preview));
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleApplyAdditionDecision(
    operationId: string,
    action: AdditionDecisionAction,
    alternativeIndex?: number,
  ) {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在保存本地候选决策...');
    try {
      const result = await applyAdditionDecision({ operationId, action, alternativeIndex });
      const preview = await fetchSyncPreview({ bucket: activePreviewBucket, limit: 30 });
      setPreviewDetails(preview);
      setAppStateFromPreview(preview, result.buckets.length ? result.buckets : preview.buckets);
      setSyncMessage(addDecisionMessage(action));
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleApplyAdditionDecisionBatch(action: Exclude<AdditionDecisionAction, 'select_alternative'>) {
    const operationIds = (previewDetails?.items || [])
      .filter((item) => item.action === 'add' && (item.candidateTarget || item.addDecision))
      .map((item) => item.id)
      .filter(Boolean);
    if (!operationIds.length) {
      setSyncError('当前列表没有可批量处理的新增候选。');
      setSyncMessage('');
      return;
    }

    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在批量保存本地候选决策...');
    try {
      const result = await applyAdditionDecisionBatch({ operationIds, action });
      const preview = await fetchSyncPreview({ bucket: activePreviewBucket, limit: 30 });
      setPreviewDetails(preview);
      setAppStateFromPreview(preview, result.buckets.length ? result.buckets : preview.buckets);
      setSyncMessage(`已处理 ${result.changed || operationIds.length} 个本地候选决策；仍未写入任何平台。`);
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleApplyTombstoneDecision(input: {
    tombstoneKey: string;
    operationId?: string;
    action: TombstoneAction;
    platform?: string;
    confirmText?: string;
  }) {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在保存本地删除意图处理...');
    try {
      const result = await applyTombstoneDecision(input);
      const preview = await fetchSyncPreview({ bucket: activePreviewBucket, limit: 30 });
      setPreviewDetails(preview);
      setAppStateFromPreview(preview, result.preview?.buckets?.length ? result.preview.buckets : preview.buckets);
      setSyncMessage(tombstoneMessage(input.action));
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleApplyTombstoneDecisionBatch(
    action: Exclude<TombstoneAction, 'confirm_global_delete'>,
    items: Array<{ tombstoneKey: string; operationId?: string; platform?: string }>,
  ) {
    if (!items.length) {
      setSyncError('当前筛选没有可批量处理的删除信号。');
      setSyncMessage('');
      return;
    }
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在批量保存本地删除意图处理...');
    try {
      const result = await applyTombstoneDecisionBatch({ action, items });
      const preview = await fetchSyncPreview({ bucket: activePreviewBucket, limit: 30 });
      setPreviewDetails(preview);
      setAppStateFromPreview(preview, result.preview?.buckets?.length ? result.preview.buckets : preview.buckets);
      setSyncMessage(`已处理 ${result.changed || items.length} 个删除信号：${tombstoneActionLabel(action)}。`);
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleExecuteAdditions(dryRun: boolean) {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage(dryRun ? '正在模拟新增写入...' : '正在执行受控新增写入...');
    try {
      const result = await executeAdditions({ targets: WRITE_TARGETS, dryRun });
      if (result.convergence) setLastConvergence(result.convergence);
      await refreshAppStateAndPreview();
      const requested = result.add?.requested || 0;
      setSyncMessage(dryRun
        ? `新增 dry-run 完成：请求新增 ${requested} 首，未写入平台。`
        : `新增执行完成：请求新增 ${requested} 首，请检查收敛状态。`);
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleConfirmDeletions(confirmText: string) {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在保存删除确认...');
    try {
      const result = await confirmDeletions({ targets: WRITE_TARGETS, confirmText });
      await refreshAppStateAndPreview();
      setSyncMessage(`已确认 ${result.confirmed || 0} 个删除候选；真实删除仍需单独执行。`);
      return true;
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
      return false;
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleExecuteDeletions() {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在执行受控删除...');
    try {
      const result = await executeDeletions({ targets: WRITE_TARGETS });
      if (result.convergence) setLastConvergence(result.convergence);
      await refreshAppStateAndPreview();
      setSyncMessage(`删除执行完成：请求删除 ${result.remove?.requested || 0} 首，请检查收敛状态。`);
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleCheckConvergence() {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在刷新目标快照并检查一致性...');
    try {
      const result = await checkConvergence({ targets: WRITE_TARGETS });
      setLastConvergence(result.convergence || result.preview?.convergence || null);
      await refreshAppStateAndPreview();
      setSyncMessage(convergenceMessage(result.convergence || result.preview?.convergence || null));
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleSaveBaseline() {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在保存同步基线...');
    try {
      const result = await saveBaseline({
        mode: selectedMode,
        previewId: previewDetails?.previewId,
        targets: WRITE_TARGETS,
      });
      if (result.activatedPolicy?.id) {
        setSelectedMode(result.activatedPolicy.id as SyncModeId);
      }
      if (result.preview?.convergence) setLastConvergence(result.preview.convergence);
      await refreshAppStateAndPreview();
      setSyncMessage(`已保存同步基线：${result.baseline?.summary?.tracks || 0} 首。`);
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <div className="app-shell" data-testid="react-app-shell">
      <aside className="side-nav" aria-label="主导航">
        <div className="brand-block">
          <div className="brand-mark">LS</div>
          <div>
            <strong>Likes Sync</strong>
            <span>多平台喜欢歌曲同步</span>
          </div>
        </div>
        <nav>
          {routes.map((route) => (
            <button
              className={activeRoute === route.id ? 'active' : ''}
              data-testid={`react-nav-${route.id}`}
              key={route.id}
              onClick={() => setActiveRoute(route.id)}
              type="button"
            >
              {route.label}
            </button>
          ))}
        </nav>
        <div className="nav-status">
          <span>下一步</span>
          <strong>{nextAction}</strong>
        </div>
      </aside>

      <main className="main-surface">
        <header className="page-header">
          <div>
            <p className="eyebrow">普通用户版</p>
            <h1>{SCREEN_TITLE[activeRoute]}</h1>
            <p>
              连接平台、选择同步方式、复核风险项，再由受控执行器写入。删除永远需要单独确认。
            </p>
          </div>
          <div className="header-status">
            {loading ? '读取状态中' : loadError ? '本地服务未连接' : '本地状态已同步'}
          </div>
        </header>

        {loadError ? (
          <div className="inline-alert" role="status">
            无法读取当前本地服务状态。React 壳仍可预览交互结构，接入现有 Node 服务后会自动显示真实数据。
          </div>
        ) : null}

        {activeRoute === 'overview' ? (
          <OverviewScreen
            appState={appState}
            onRunCheck={handleRunSyncCheck}
            syncBusy={syncBusy}
            syncError={syncError}
            syncMessage={syncMessage}
          />
        ) : null}
        {activeRoute === 'connect' ? <ConnectPlatformsScreen appState={appState} /> : null}
        {activeRoute === 'mode' ? (
          <SyncModeScreen appState={appState} onSelectMode={setSelectedMode} selectedMode={selectedMode} />
        ) : null}
        {activeRoute === 'preview' ? (
          <SyncPreviewScreen
            activeBucket={activePreviewBucket}
            appState={appState}
            lastConvergence={lastConvergence}
            onApplyAdditionDecision={handleApplyAdditionDecision}
            onApplyAdditionDecisionBatch={handleApplyAdditionDecisionBatch}
            onApplyTombstoneDecision={handleApplyTombstoneDecision}
            onApplyTombstoneDecisionBatch={handleApplyTombstoneDecisionBatch}
            onCheckConvergence={handleCheckConvergence}
            onChangeBucket={handleLoadPreview}
            onConfirmDeletions={handleConfirmDeletions}
            onExecuteAdditions={handleExecuteAdditions}
            onExecuteDeletions={handleExecuteDeletions}
            onResolveAdditions={handleResolveAdditions}
            onRunCheck={handleRunSyncCheck}
            onSaveBaseline={handleSaveBaseline}
            previewDetails={previewDetails}
            syncBusy={syncBusy}
            syncError={syncError}
            syncMessage={syncMessage}
          />
        ) : null}
        {activeRoute === 'ai' ? <AiAssistantScreen /> : null}
        {activeRoute === 'advanced' ? <AdvancedSettingsScreen appState={appState} /> : null}
      </main>
    </div>
  );

  async function refreshAppStateAndPreview(bucket: PreviewBucketId = activePreviewBucket) {
    const state = await fetchAppState();
    setAppState(state);
    setSelectedMode(state.currentMode);
    try {
      const preview = await fetchSyncPreview({ bucket, limit: 30 });
      setPreviewDetails(preview);
      setAppStateFromPreview(preview);
    } catch {
      setPreviewDetails(null);
    }
  }

  function setAppStateFromPreview(preview: SyncPreviewDetails, buckets = preview.buckets) {
    setAppState((current) => current
      ? {
        ...current,
        preview: {
          generatedAt: preview.generatedAt,
          buckets,
          nextAction: nextActionForBuckets(buckets, current.preview.nextAction),
        },
      }
      : current);
  }
}

function pickPreviewBucket(buckets: AppStateSummary['preview']['buckets']): PreviewBucketId {
  return (
    buckets.find((bucket) => bucket.id === 'needs_confirmation' && bucket.count > 0)?.id
    || buckets.find((bucket) => bucket.id === 'may_delete' && bucket.count > 0)?.id
    || buckets.find((bucket) => bucket.id === 'will_add' && bucket.count > 0)?.id
    || buckets.find((bucket) => bucket.id === 'will_keep' && bucket.count > 0)?.id
    || 'will_add'
  );
}

function bucketLabel(bucket: PreviewBucketId): string {
  const labels: Record<PreviewBucketId, string> = {
    will_add: '会新增',
    will_keep: '会保留',
    needs_confirmation: '需要确认',
    may_delete: '可能删除',
  };
  return labels[bucket];
}

function nextActionForBuckets(buckets: AppStateSummary['preview']['buckets'], fallback: string): string {
  if (buckets.some((bucket) => bucket.id === 'needs_confirmation' && bucket.count > 0)) return '先处理需要确认的歌曲';
  if (buckets.some((bucket) => bucket.id === 'may_delete' && bucket.count > 0)) return '查看可能删除的歌曲';
  if (buckets.some((bucket) => bucket.id === 'will_add' && bucket.count > 0)) return '可以先同步新增';
  return fallback;
}

function addResolutionMessage(preview: SyncPreviewDetails): string {
  const resolution = preview.addResolution;
  if (!resolution) return '已刷新新增候选；仍未写入任何平台。';
  if (resolution.skipped > 0 && resolution.total === 0) return '目标平台凭据不足，候选查找已安全跳过。';
  return `已查找 ${resolution.total} 首，确认 ${resolution.resolved} 首，需复核 ${resolution.review} 首，未找到 ${resolution.notFound} 首。`;
}

function addDecisionMessage(action: AdditionDecisionAction): string {
  if (action === 'accept_candidate') return '已接受这个候选；仍需后续受控新增执行才会写入平台。';
  if (action === 'select_alternative') return '已选择备选歌曲；仍需后续受控新增执行才会写入平台。';
  if (action === 'skip') return '已跳过这个新增候选；执行时不会把它当作成功新增。';
  return '已清除本地新增候选决策。';
}

function tombstoneMessage(action: TombstoneAction): string {
  if (action === 'confirm_global_delete') return '已确认这个删除信号为全局删除意图；真实删除仍需后续受控执行。';
  if (action === 'ignore') return '已忽略这个删除信号，不会传播成全局删除。';
  if (action === 'restore') return '已标记为需要恢复，后续会走受控新增路径。';
  if (action === 'current_platform_only') return '已标记为仅当前平台删除，不会传播到其他平台。';
  return '已清除本地删除意图处理。';
}

function tombstoneActionLabel(action: TombstoneAction): string {
  if (action === 'confirm_global_delete') return '全局删除';
  if (action === 'ignore') return '忽略';
  if (action === 'restore') return '恢复';
  if (action === 'current_platform_only') return '仅当前平台';
  return '清除';
}

function convergenceMessage(convergence: ConvergenceSummary | null): string {
  if (!convergence) return '一致性检查完成。';
  if (convergence.converged || convergence.status === 'converged') return '三端已收敛，可以保存同步基线。';
  const add = convergence.openAdds ?? convergence.add ?? 0;
  const remove = convergence.openDeletes ?? convergence.remove ?? 0;
  const review = convergence.openReviews ?? convergence.review ?? 0;
  return `仍有差异：新增 ${add} / 删除 ${remove} / 复核 ${review}。`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '操作失败');
}
