import { ChevronRight, Headphones, HelpCircle, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  applyAdditionDecision,
  applyAdditionDecisionBatch,
  applyIdentityDecision,
  applyTombstoneDecision,
  applyTombstoneDecisionBatch,
  checkConvergence,
  confirmDeletions,
  executeAdditions,
  executeDeletions,
  fetchAppState,
  fetchSyncPreview,
  resolveAdditions,
  reviewAdditionCandidates,
  reviewIdentityCandidates,
  runSyncCheck,
  saveBaseline,
} from '../api/client';
import type {
  AdditionDecisionAction,
  AppStateSummary,
  ConvergenceSummary,
  PlatformKey,
  IdentityDecisionAction,
  PreviewBucketId,
  SyncModeId,
  SyncPreviewDetails,
  TombstoneAction,
} from '../api/types';
import {
  formatCount,
  AlbumArtwork,
  platformLabel,
  routeIcons,
  StatusPill,
  topStatusIcons,
} from '../components/MusicVisuals';
import { AdvancedSettingsScreen } from '../screens/AdvancedSettingsScreen';
import { AiAssistantScreen } from '../screens/AiAssistantScreen';
import { AutoSyncScreen } from '../screens/AutoSyncScreen';
import { ConnectPlatformsScreen } from '../screens/ConnectPlatformsScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { OverviewScreen } from '../screens/OverviewScreen';
import { SyncModeScreen } from '../screens/SyncModeScreen';
import { SyncPreviewScreen, type AuditionPlaybackState } from '../screens/SyncPreviewScreen';
import { routes, type RouteId } from './routes';

const SCREEN_META: Record<RouteId, { title: string; description: string }> = {
  overview: {
    title: '同步工作台',
    description: '以 Apple Music 喜欢歌曲为准，安全同步到 QQ 音乐和网易云音乐。',
  },
  connect: {
    title: '连接管理',
    description: '用尽可能低成本的登录方式连接音乐平台，凭据细节留在高级设置里。',
  },
  mode: {
    title: '同步规则',
    description: '选择喜欢歌曲如何流动，删除永远需要单独确认。',
  },
  preview: {
    title: '同步预览',
    description: '先检查匹配、差异和删除风险，再写入目标平台。',
  },
  automation: {
    title: '自动同步',
    description: '定时刷新三端曲库并同步新增；删除始终保留人工确认。',
  },
  ai: {
    title: '音乐库画像',
    description: '用本地曲库证据生成画像、推荐和 Copilot 解释。',
  },
  advanced: {
    title: '设置',
    description: '保留发布验证、本机诊断、AI Provider 和开发者命令。',
  },
  help: {
    title: '帮助与关于',
    description: '了解同步判断、安全边界、平台账号和版本更新。',
  },
};

const WRITE_TARGETS: PlatformKey[] = ['qq', 'netease'];
const FALLBACK_NEXT_ACTION = '连接平台后开始同步检查';
const MUSIC_ASSET_BASE = `${import.meta.env.BASE_URL}assets/music`;

export function App() {
  const [activeRoute, setActiveRoute] = useState<RouteId>(() => routeFromLocation());
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
  const [auditionPlayback, setAuditionPlayback] = useState<AuditionPlaybackState | null>(null);

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
        if (active) setLoadError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncRouteFromHistory = () => setActiveRoute(routeFromLocation());
    window.addEventListener('hashchange', syncRouteFromHistory);
    window.addEventListener('popstate', syncRouteFromHistory);
    return () => {
      window.removeEventListener('hashchange', syncRouteFromHistory);
      window.removeEventListener('popstate', syncRouteFromHistory);
    };
  }, []);

  useEffect(() => {
    if (activeRoute !== 'preview' || previewDetails || !appState?.preview.buckets.length) return;
    void handleLoadPreview(pickPreviewBucket(appState.preview.buckets));
  }, [activeRoute, appState, previewDetails]);

  const nextAction = useMemo(() => appState?.preview.nextAction || FALLBACK_NEXT_ACTION, [appState]);
  const meta = SCREEN_META[activeRoute];
  const platformCount = appState?.platforms.filter((platform) => platform.status !== 'not_connected').length || 0;
  const SidebarShieldIcon = topStatusIcons.shield;

  return (
    <div className="app-shell apple-shell" data-testid="react-app-shell">
      <aside className="side-nav" aria-label="主导航">
        <button className="brand-block" onClick={() => navigateTo('overview')} type="button">
          <img alt="" className="brand-mark" src={`${MUSIC_ASSET_BASE}/brand-ls.webp`} />
          <span>
            <strong>Likes Sync</strong>
            <small>多平台喜欢歌曲同步</small>
          </span>
        </button>

        <nav className="nav-list">
          {routes.map((route) => {
            const Icon = routeIcons[route.id];
            return (
              <button
                className={activeRoute === route.id ? 'active' : ''}
                data-testid={`react-nav-${route.id}`}
                key={route.id}
                onClick={() => navigateTo(route.id)}
                type="button"
              >
                <Icon size={18} strokeWidth={2.1} />
                <span>{route.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-library">
          <div className="sidebar-library-head">
            <span>连接状态</span>
            <StatusPill tone={platformCount >= 3 ? 'success' : 'warning'}>{platformCount}/3</StatusPill>
          </div>
          {(appState?.platforms || []).map((platform) => (
            <div className="sidebar-platform" key={platform.key}>
              <span>{platform.label}</span>
              <strong>{formatCount(platform.tracks)} 首</strong>
            </div>
          ))}
        </div>

        <button className="sidebar-protection" onClick={() => navigateTo('advanced')} title="查看写入保护和本机诊断" type="button">
          <SidebarShieldIcon size={18} strokeWidth={2.2} />
          <span>
            <strong>写入保护</strong>
            <small>已开启</small>
          </span>
          <ChevronRight size={16} strokeWidth={2.1} />
        </button>

        <div className={auditionPlayback ? 'sidebar-player active' : 'sidebar-player empty'} aria-label="试听状态" data-testid="react-sidebar-player">
          <div className="sidebar-player-track">
            {auditionPlayback ? (
              <AlbumArtwork src={auditionPlayback.artworkUrl} title={auditionPlayback.title} />
            ) : (
              <span className="sidebar-player-placeholder"><Headphones size={18} /></span>
            )}
            <span aria-live="polite">
              <strong data-testid="react-sidebar-player-title">{auditionPlayback?.title || '暂未试听'}</strong>
              <small>{auditionPlayback?.artist || '在同步预览中选择版本'}</small>
            </span>
          </div>
          {auditionPlayback ? (
            <>
              <div className="sidebar-player-status">
                <span>{auditionPlayback.playing ? '正在试听' : '试听已暂停'} · {platformLabel(auditionPlayback.platform)}</span>
                <time>{Math.round(auditionPlayback.elapsedSeconds)} / {Math.round(auditionPlayback.limitSeconds)} 秒</time>
              </div>
              <span className="sidebar-player-progress">
                <i style={{ width: `${Math.min(100, auditionPlayback.elapsedSeconds / Math.max(1, auditionPlayback.limitSeconds) * 100)}%` }} />
              </span>
            </>
          ) : null}
        </div>
      </aside>

      <main className="main-surface">
        <header className="top-status-bar" aria-label="运行状态">
          <div className="top-status-group">
            <StatusRailItem icon={topStatusIcons.local} label={loading ? '读取状态中' : loadError ? '本地服务异常' : '本地运行中'} tone={loadError ? 'danger' : 'success'} />
            <StatusRailItem icon={topStatusIcons.check} label={appState?.preview.generatedAt ? '上次检查已生成' : '尚未运行检查'} />
            <StatusRailItem icon={topStatusIcons.shield} label="写入保护已开启" />
          </div>
          <div className="top-actions">
            <button className="ghost-button" onClick={() => void refreshAppStateAndPreview()} title="重新读取本机连接和同步状态" type="button">
              <RefreshCcw size={16} />
              刷新状态
            </button>
            <button aria-label="帮助与关于" className="round-button" data-testid="react-open-help" onClick={() => navigateTo('help')} type="button">
              <HelpCircle size={18} />
            </button>
          </div>
        </header>

        {activeRoute !== 'ai' ? (
          <section className="page-title-block">
            <div>
              <h1>{meta.title}</h1>
              <p>{meta.description}</p>
            </div>
            {activeRoute !== 'advanced' && activeRoute !== 'help' ? (
              <StatusPill tone="accent">下一步：{nextAction}</StatusPill>
            ) : null}
          </section>
        ) : null}

        {loadError ? (
          <div className="inline-alert danger" role="status">
            无法读取当前本地服务状态：{loadError}
          </div>
        ) : null}

        {activeRoute === 'overview' ? (
          <OverviewScreen
            appState={appState}
            onNavigate={navigateTo}
            onRunCheck={handleRunSyncCheck}
            syncBusy={syncBusy}
            syncError={syncError}
            syncMessage={syncMessage}
          />
        ) : null}
        {activeRoute === 'connect' ? (
          <ConnectPlatformsScreen appState={appState} onRefresh={refreshAppStateAndPreview} />
        ) : null}
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
            onApplyIdentityDecision={handleApplyIdentityDecision}
            onApplyTombstoneDecision={handleApplyTombstoneDecision}
            onApplyTombstoneDecisionBatch={handleApplyTombstoneDecisionBatch}
            onAuditionPlaybackChange={setAuditionPlayback}
            onCheckConvergence={handleCheckConvergence}
            onChangeBucket={handleLoadPreview}
            onLoadMore={handleLoadMorePreview}
            onConfirmDeletions={handleConfirmDeletions}
            onExecuteAdditions={handleExecuteAdditions}
            onExecuteDeletions={handleExecuteDeletions}
            onResolveAdditions={handleResolveAdditions}
            onRefreshState={refreshAppStateAndPreview}
            onReviewItems={handleReviewItems}
            onRunCheck={handleRunSyncCheck}
            onSaveBaseline={handleSaveBaseline}
            previewDetails={previewDetails}
            syncBusy={syncBusy}
            syncError={syncError}
            syncMessage={syncMessage}
          />
        ) : null}
        {activeRoute === 'automation' ? (
          <AutoSyncScreen appState={appState} onRefresh={refreshAppStateAndPreview} />
        ) : null}
        {activeRoute === 'ai' ? <AiAssistantScreen appState={appState} onOpenReview={() => navigateTo('preview')} /> : null}
        {activeRoute === 'advanced' ? <AdvancedSettingsScreen appState={appState} /> : null}
        {activeRoute === 'help' ? <HelpScreen onNavigate={navigateTo} /> : null}
      </main>
    </div>
  );

  async function handleRunSyncCheck() {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在生成同步预览...');
    try {
      const result = await runSyncCheck({
        mode: selectedMode,
        targets: WRITE_TARGETS,
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
      setSyncMessage(`同步预览已生成，当前显示「${bucketLabel(bucket)}」。`);
      navigateTo('preview');
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
      setAppStateFromPreview(preview);
      setSyncMessage(`已读取「${bucketLabel(bucket)}」，共 ${preview.total} 首。`);
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleLoadMorePreview() {
    const cursor = previewDetails?.nextCursor;
    if (!cursor || syncBusy) return;
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage(`正在继续读取「${bucketLabel(activePreviewBucket)}」...`);
    try {
      const page = await fetchSyncPreview({
        bucket: activePreviewBucket,
        cursor,
        limit: 30,
      });
      setPreviewDetails((current) => mergePreviewPage(current, page));
      setAppStateFromPreview(page);
      const loaded = Math.min(page.total, (previewDetails?.items.length || 0) + page.items.length);
      setSyncMessage(`已加载 ${loaded} / ${page.total} 首。`);
    } catch (error) {
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  function navigateTo(route: RouteId) {
    if (route !== activeRoute) {
      window.history.pushState(null, '', `#/${route}`);
      setActiveRoute(route);
    }
  }

  async function handleResolveAdditions() {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在查找目标平台对应歌曲...');
    try {
      const result = await resolveAdditions({
        bucket: activePreviewBucket,
        targets: WRITE_TARGETS,
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

  async function handleReviewItems(operationIds?: string[]) {
    const requested = new Set(operationIds || []);
    const selectedItems = (previewDetails?.items || [])
      .filter((item) => !requested.size || requested.has(item.id))
      .filter((item) => !item.aiReview)
      .filter((item) => (
        (item.action === 'add' && Boolean(item.candidateTarget))
        || (item.action === 'review' && Boolean(item.sourceTrack) && Boolean(item.targetTrack || item.candidateTarget))
      ));
    const additionIds = selectedItems.filter((item) => item.action === 'add').map((item) => item.id);
    const identityIds = selectedItems.filter((item) => item.action === 'review').map((item) => item.id);
    if (!additionIds.length && !identityIds.length) {
      setSyncError('当前列表没有尚未复核的跨平台候选。');
      setSyncMessage('');
      return;
    }
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('正在把当前版本的最小化证据交给 AI 复核...');
    let latestPreview = previewDetails;
    try {
      const messages: string[] = [];
      if (additionIds.length) {
        const result = await reviewAdditionCandidates({
          operationIds: additionIds,
          targets: WRITE_TARGETS,
          limit: Math.min(30, additionIds.length),
          bucket: activePreviewBucket,
        });
        latestPreview = result.preview;
        messages.push(`新增：建议接受 ${result.summary.add}，建议跳过 ${result.summary.skip}，仍需人工 ${result.summary.needsHuman}`);
      }
      if (identityIds.length) {
        const result = await reviewIdentityCandidates({
          operationIds: identityIds,
          targets: WRITE_TARGETS,
          limit: Math.min(30, identityIds.length),
          bucket: activePreviewBucket,
        });
        latestPreview = result.preview;
        messages.push(`版本：建议视为同一 ${result.summary.keep}，建议分开 ${result.summary.separate}，仍需人工 ${result.summary.needsHuman}`);
      }
      if (latestPreview) {
        setPreviewDetails(latestPreview);
        setAppStateFromPreview(latestPreview);
      }
      setSyncMessage(`AI 草稿完成：${messages.join('；')}。未采纳决定，也未写入平台。`);
    } catch (error) {
      if (latestPreview && latestPreview !== previewDetails) {
        setPreviewDetails(latestPreview);
        setAppStateFromPreview(latestPreview);
      }
      setSyncError(errorMessage(error));
      setSyncMessage('');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleApplyIdentityDecision(operationId: string, action: IdentityDecisionAction) {
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage(action === 'clear' ? '正在撤销版本判断...' : '正在保存版本判断并重建预览...');
    try {
      const result = await applyIdentityDecision({
        operationId,
        action,
        bucket: activePreviewBucket,
      });
      setPreviewDetails(result.preview);
      setAppStateFromPreview(result.preview);
      const message = action === 'keep'
        ? '已保留目标平台现有版本：它会代表 Apple Music 源歌曲，不产生新增或删除。'
        : action === 'separate'
          ? '已生成版本替换草稿：将补入 Apple 对应版本；旧版本仍需单独确认后才会删除。'
          : '已撤销版本判断并恢复人工复核。';
      setSyncMessage(message);
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
      setSyncMessage(`已处理 ${result.changed || items.length} 个删除信号。`);
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
        ? `新增模拟完成：请求新增 ${requested} 首，未写入平台。`
        : `新增执行完成：请求新增 ${requested} 首，请检查一致性。`);
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
      setSyncMessage(result.backup
        ? `删除执行完成：已先创建恢复点，请求删除 ${result.remove?.requested || 0} 首。`
        : `删除执行完成：请求删除 ${result.remove?.requested || 0} 首，请检查一致性。`);
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

function StatusRailItem({
  icon: Icon,
  label,
  tone = 'neutral',
}: {
  icon: typeof topStatusIcons.local;
  label: string;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  return (
    <span className={`top-status-pill ${tone}`}>
      <Icon size={15} strokeWidth={2.2} />
      {label}
    </span>
  );
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
  return `已查找 ${resolution.total} 首，确认 ${resolution.resolved} 首，需要复核 ${resolution.review} 首，未找到 ${resolution.notFound} 首。`;
}

function mergePreviewPage(current: SyncPreviewDetails | null, page: SyncPreviewDetails): SyncPreviewDetails {
  if (!current || current.previewId !== page.previewId || current.bucket !== page.bucket) return page;
  const seen = new Set<string>();
  const items = [...current.items, ...page.items].filter((item) => {
    const key = item.id || `${item.action}:${item.title}:${item.artist}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    ...page,
    items,
  };
}

function addDecisionMessage(action: AdditionDecisionAction): string {
  if (action === 'accept_candidate') return '已接受这个候选；仍需受控执行新增才会写入平台。';
  if (action === 'select_alternative') return '已选择备选歌曲；仍需受控执行新增才会写入平台。';
  if (action === 'skip') return '已跳过这个新增候选；执行时不会把它当作成功新增。';
  return '已清除本地新增候选决策。';
}

function tombstoneMessage(action: TombstoneAction): string {
  if (action === 'confirm_global_delete') return '已确认这个删除信号为全局删除意图；真实删除仍需受控执行。';
  if (action === 'ignore') return '已忽略这个删除信号，不会传播成全局删除。';
  if (action === 'restore') return '已标记为需要恢复，后续会走受控新增路径。';
  if (action === 'current_platform_only') return '已标记为仅当前平台删除，不会传播到其他平台。';
  return '已清除本地删除意图处理。';
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

function routeFromLocation(): RouteId {
  const candidate = window.location.hash.replace(/^#\/?/, '').trim();
  return candidate === 'help' || routes.some((route) => route.id === candidate) ? candidate as RouteId : 'overview';
}
