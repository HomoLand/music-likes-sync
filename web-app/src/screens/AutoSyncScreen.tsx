import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Play,
  RefreshCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchAutoSyncState, runAutoSync, saveAutoSyncSettings } from '../api/client';
import type { AppStateSummary, AutoSyncRunSummary, AutoSyncStateResult, PlatformKey } from '../api/types';
import { StatusPill } from '../components/MusicVisuals';

interface AutoSyncScreenProps {
  appState: AppStateSummary | null;
  onRefresh: () => Promise<void>;
}

const INTERVAL_OPTIONS = [
  { value: 15, label: '每 15 分钟' },
  { value: 30, label: '每 30 分钟' },
  { value: 60, label: '每小时' },
  { value: 180, label: '每 3 小时' },
  { value: 360, label: '每 6 小时' },
  { value: 720, label: '每 12 小时' },
  { value: 1440, label: '每天' },
];

export function AutoSyncScreen({ appState, onRefresh }: AutoSyncScreenProps) {
  const [state, setState] = useState<AutoSyncStateResult | null>(null);
  const [enabled, setEnabled] = useState(Boolean(appState?.autoSync?.enabled));
  const [intervalMinutes, setIntervalMinutes] = useState(appState?.autoSync?.intervalMinutes || 60);
  const [targets, setTargets] = useState<PlatformKey[]>(appState?.autoSync?.targets || ['qq', 'netease']);
  const [autoExecuteAdditions, setAutoExecuteAdditions] = useState(appState?.autoSync?.autoExecuteAdditions !== false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void refreshState(true);
  }, []);

  async function refreshState(silent = false) {
    if (!silent) setBusy(true);
    setError('');
    try {
      const result = await fetchAutoSyncState();
      applyState(result);
      if (!silent) setMessage('自动同步状态已刷新。');
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    } finally {
      if (!silent) setBusy(false);
    }
  }

  function applyState(result: AutoSyncStateResult) {
    setState(result);
    setEnabled(result.automation.enabled);
    setIntervalMinutes(result.automation.intervalMinutes);
    setTargets(result.automation.targets.length ? result.automation.targets : ['qq', 'netease']);
    setAutoExecuteAdditions(result.automation.autoExecuteAdditions);
  }

  async function saveSettings() {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await saveAutoSyncSettings({
        enabled,
        intervalMinutes,
        targets,
        autoExecuteAdditions,
      });
      applyState(result);
      await onRefresh();
      setMessage(enabled ? '自动同步已启用。' : '自动同步设置已保存。');
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function runNow(executeAdditions: boolean) {
    setBusy(true);
    setMessage(executeAdditions ? '正在刷新曲库并同步新增...' : '正在刷新曲库并检查差异...');
    setError('');
    try {
      const result = await runAutoSync({ executeAdditions });
      applyState(result);
      await onRefresh();
      setMessage(result.run?.message || '自动同步任务已完成。');
    } catch (runError) {
      setError(errorMessage(runError));
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  function toggleTarget(target: Exclude<PlatformKey, 'apple'>) {
    setTargets((current) => current.includes(target)
      ? current.length > 1 ? current.filter((item) => item !== target) : current
      : [...current, target]);
  }

  const automation = state?.automation || appState?.autoSync;
  const readiness = state?.readiness;
  const canExecute = Boolean(automation?.enabled && readiness?.ok && autoExecuteAdditions && !busy);

  return (
    <section className="automation-screen" data-testid="react-auto-sync-screen">
      <div className="automation-grid">
        <section className="surface-panel automation-settings-panel">
          <div className="section-heading compact">
            <div>
              <h2>同步计划</h2>
              <p>服务运行期间按计划刷新，新增可以自动写入。</p>
            </div>
            <StatusPill tone={automation?.running ? 'accent' : automation?.enabled ? 'success' : 'neutral'}>
              {automation?.running ? '运行中' : automation?.enabled ? '已启用' : '未启用'}
            </StatusPill>
          </div>

          <label className="automation-toggle-row">
            <span>
              <strong>自动同步</strong>
              <small>{automation?.nextRunAt ? `下次 ${formatDateTime(automation.nextRunAt)}` : '完成准备后可启用'}</small>
            </span>
            <input checked={enabled} data-testid="react-auto-sync-enabled" onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
          </label>

          <div className="automation-form-row">
            <label htmlFor="auto-sync-interval">检查频率</label>
            <select
              data-testid="react-auto-sync-interval"
              id="auto-sync-interval"
              onChange={(event) => setIntervalMinutes(Number(event.target.value))}
              value={intervalMinutes}
            >
              {INTERVAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <fieldset className="automation-targets">
            <legend>同步目标</legend>
            <label><input checked={targets.includes('qq')} onChange={() => toggleTarget('qq')} type="checkbox" />QQ 音乐</label>
            <label><input checked={targets.includes('netease')} onChange={() => toggleTarget('netease')} type="checkbox" />网易云音乐</label>
          </fieldset>

          <label className="automation-toggle-row subtle">
            <span>
              <strong>自动写入新增</strong>
              <small>匹配不确定的歌曲仍会暂停等待复核</small>
            </span>
            <input checked={autoExecuteAdditions} onChange={(event) => setAutoExecuteAdditions(event.target.checked)} type="checkbox" />
          </label>

          <div className="automation-delete-guard">
            <ShieldCheck size={18} />
            <span><strong>删除保持人工确认</strong><small>定时任务只记录删除信号，不会自动删除歌曲。</small></span>
          </div>

          <div className="automation-actions">
            <button className="primary-button" data-testid="react-auto-sync-save" disabled={busy} onClick={() => void saveSettings()} type="button"><Save size={16} />保存设置</button>
            <button className="secondary-button" data-testid="react-auto-sync-check" disabled={busy} onClick={() => void runNow(false)} type="button"><RefreshCcw size={16} />立即检查</button>
            <button className="secondary-button" data-testid="react-auto-sync-run" disabled={!canExecute} onClick={() => void runNow(true)} type="button"><Play size={16} />立即同步</button>
          </div>
        </section>

        <section className="surface-panel automation-readiness-panel">
          <div className="section-heading compact">
            <div>
              <h2>启用准备</h2>
              <p>{readiness?.ok ? '所有安全门禁均已通过。' : '处理完成后才能启用真实定时写入。'}</p>
            </div>
            {readiness?.ok ? <CheckCircle2 className="status-success" size={22} /> : <AlertTriangle className="status-warning" size={22} />}
          </div>

          <div className="automation-readiness-list" data-testid="react-auto-sync-readiness">
            <ReadinessItem ok={Boolean(readiness?.baseline.exists)} label="同步基线" detail={readiness?.baseline.exists ? '已保存' : '需要先完成收敛同步'} />
            <ReadinessItem ok={snapshotReady(readiness, 'apple')} label="Apple Music" detail={snapshotDetail(readiness, 'apple')} />
            <ReadinessItem ok={snapshotReady(readiness, 'qq')} label="QQ 音乐" detail={snapshotDetail(readiness, 'qq')} />
            <ReadinessItem ok={snapshotReady(readiness, 'netease')} label="网易云音乐" detail={snapshotDetail(readiness, 'netease')} />
            <ReadinessItem ok={Boolean(readiness?.liveValidation.ok)} label="真实写入验证" detail={readiness?.liveValidation.ok ? 'QQ 与网易云均有效' : '需要重新验证'} />
          </div>

          {readiness?.reasons.length ? (
            <div className="automation-blockers">
              {readiness.reasons.map((reason) => <p key={`${reason.code}:${reason.platform || ''}`}>{reason.message}</p>)}
            </div>
          ) : null}
        </section>
      </div>

      {message ? <p className="sync-status" role="status">{message}</p> : null}
      {error ? <p className="sync-status error" role="alert">{error}</p> : null}

      <section className="surface-panel automation-history-panel">
        <div className="section-heading compact">
          <div>
            <h2>运行历史</h2>
            <p>{state?.history.length ? `保留最近 ${state.history.length} 次本地记录` : '还没有运行记录'}</p>
          </div>
          <button aria-label="刷新运行历史" className="icon-button" disabled={busy} onClick={() => void refreshState()} type="button"><RefreshCcw size={16} /></button>
        </div>
        <div className="automation-history-list" data-testid="react-auto-sync-history">
          {state?.history.length ? state.history.map((run) => <RunRow key={run.id} run={run} />) : (
            <div className="automation-empty-history"><CalendarClock size={24} /><span>启用计划或执行一次检查后，记录会显示在这里。</span></div>
          )}
        </div>
      </section>
    </section>
  );
}

function ReadinessItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={ok ? 'ready' : 'blocked'}>
      {ok ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
      <span><strong>{label}</strong><small>{detail}</small></span>
    </div>
  );
}

function RunRow({ run }: { run: AutoSyncRunSummary }) {
  const tone = run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning';
  return (
    <article className="automation-history-row">
      <span className={`automation-run-icon ${tone}`}><RefreshCcw size={16} /></span>
      <div>
        <strong>{run.trigger === 'scheduled' ? '定时同步' : '手动检查'}</strong>
        <small>{run.message || '任务已结束'}</small>
      </div>
      <div className="automation-run-counts">
        <span>新增 {run.additions.succeeded || 0}</span>
        <span>待复核 {run.preview.needsConfirmation || 0}</span>
        <span>删除信号 {run.deletionSignals || 0}</span>
      </div>
      <time>{formatDateTime(run.completedAt || run.startedAt)}</time>
      <StatusPill tone={tone}>{statusLabel(run.status, run.dryRun)}</StatusPill>
    </article>
  );
}

function snapshotReady(readiness: AutoSyncStateResult['readiness'] | undefined, platform: PlatformKey): boolean {
  const snapshot = readiness?.snapshots[platform];
  return Boolean(snapshot?.available && readiness?.reasons.every((reason) => reason.code !== `${platform}_snapshot_stale`));
}

function snapshotDetail(readiness: AutoSyncStateResult['readiness'] | undefined, platform: PlatformKey): string {
  const snapshot = readiness?.snapshots[platform];
  if (!snapshot?.available) return '尚未读取';
  if (readiness?.reasons.some((reason) => reason.code === `${platform}_snapshot_stale`)) return '需要刷新';
  return `${snapshot.tracks.toLocaleString('zh-CN')} 首 · 已更新`;
}

function statusLabel(status: AutoSyncRunSummary['status'], dryRun: boolean): string {
  if (dryRun && status !== 'failed') return '仅检查';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'attention') return '需处理';
  return '已跳过';
}

function formatDateTime(value?: string): string {
  if (!value) return '尚未安排';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '自动同步操作失败');
}
