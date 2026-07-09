import type { AppStateSummary } from '../api/types';
import { PlatformStatusRow } from '../components/PlatformStatusRow';

interface ScreenProps {
  appState: AppStateSummary | null;
  onRunCheck: () => void;
  syncBusy: boolean;
  syncError: string;
  syncMessage: string;
}

export function OverviewScreen({ appState, onRunCheck, syncBusy, syncError, syncMessage }: ScreenProps) {
  const buckets = appState?.preview.buckets || [];
  const addCount = buckets.find((bucket) => bucket.id === 'will_add')?.count || 0;
  const reviewCount = buckets.find((bucket) => bucket.id === 'needs_confirmation')?.count || 0;
  const deleteCount = buckets.find((bucket) => bucket.id === 'may_delete')?.count || 0;
  return (
    <section className="screen-grid">
      <div className="surface-band wide">
        <div className="section-heading">
          <h2>当前状态</h2>
          <p>这里展示普通用户需要知道的连接状态、同步方式和下一步动作。</p>
        </div>
        <div className="platform-list">
          {(appState?.platforms || []).map((platform) => (
            <PlatformStatusRow key={platform.key} platform={platform} />
          ))}
        </div>
        <div className="action-row">
          <button
            data-testid="react-run-sync-check"
            disabled={!appState || syncBusy}
            onClick={onRunCheck}
            type="button"
          >
            {syncBusy ? '正在检查' : '开始同步检查'}
          </button>
        </div>
        <SyncStatus error={syncError} message={syncMessage} />
      </div>
      <div className="metric-band">
        <span>准备新增</span>
        <strong>{addCount}</strong>
      </div>
      <div className="metric-band">
        <span>需要确认</span>
        <strong>{reviewCount}</strong>
      </div>
      <div className="metric-band danger">
        <span>可能删除</span>
        <strong>{deleteCount}</strong>
      </div>
      <div className="surface-band wide">
        <div className="section-heading">
          <h2>最近执行</h2>
          <p>{runCopy(appState)}</p>
        </div>
      </div>
    </section>
  );
}

function SyncStatus({ error, message }: { error: string; message: string }) {
  if (!error && !message) return null;
  return (
    <p className={error ? 'sync-status error' : 'sync-status'} data-testid="react-sync-status" role="status">
      {error || message}
    </p>
  );
}

function runCopy(appState: AppStateSummary | null): string {
  const run = appState?.latestRun;
  if (!run || run.status === 'none') return '还没有同步执行记录。';
  const mode = run.dryRun ? '模拟执行' : '真实执行';
  return `${mode} ${run.status}，新增 ${run.addRequested || 0}，删除 ${run.removeRequested || 0}。`;
}
