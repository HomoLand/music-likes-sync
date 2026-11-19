import { ArrowRight, CheckCircle2, Eye, MoreHorizontal, RefreshCcw, ShieldAlert, ShieldCheck } from 'lucide-react';

import type { AppStateSummary, PlatformKey, PlatformSummary } from '../api/types';
import type { RouteId } from '../app/routes';
import {
  formatCount,
  platformMeta,
  PlatformArtwork,
  StatusPill,
} from '../components/MusicVisuals';

interface ScreenProps {
  appState: AppStateSummary | null;
  onNavigate: (route: RouteId) => void;
  onRunCheck: () => void;
  syncBusy: boolean;
  syncError: string;
  syncMessage: string;
}

const TARGETS: PlatformKey[] = ['qq', 'netease'];

export function OverviewScreen({ appState, onNavigate, onRunCheck, syncBusy, syncError, syncMessage }: ScreenProps) {
  const buckets = appState?.preview.buckets || [];
  const addCount = buckets.find((bucket) => bucket.id === 'will_add')?.count || 0;
  const reviewCount = buckets.find((bucket) => bucket.id === 'needs_confirmation')?.count || 0;
  const deleteCount = buckets.find((bucket) => bucket.id === 'may_delete')?.count || 0;
  const apple = platformByKey(appState, 'apple');

  return (
    <section className="overview-screen">
      <div className="overview-layout">
        <div className="overview-main">
          <section className="sync-map-panel">
            <div className="source-card platform-card hero">
              <PlatformArtwork platform="apple" size="lg" />
              <span className="card-kicker">源平台</span>
              <strong>{apple?.label || platformMeta.apple.label}</strong>
              <small>喜欢歌曲</small>
              <b>{formatCount(apple?.tracks || 0)} 首</b>
            </div>

            <div className="sync-center">
              <MoreHorizontal className="sync-dots-icon" aria-hidden="true" size={28} />
              <span className="sync-orb">
                <RefreshCcw size={32} />
              </span>
              <strong>单向同步</strong>
              <small>Apple Music → 目标平台</small>
            </div>

            <div className="target-stack">
              {TARGETS.map((key) => (
                <TargetCard key={key} platform={platformByKey(appState, key)} platformKey={key} />
              ))}
            </div>
          </section>

          <section className="health-panel">
            <div className="section-heading compact">
              <div>
                <h2>同步健康摘要</h2>
                <p>先预览变更，再确认写入；删除默认暂停。</p>
              </div>
              <StatusPill tone="success">写入保护开启</StatusPill>
            </div>
            <div className="health-metrics">
              <Metric tone="blue" value={addCount} label="新增到目标平台" hint="确认后写入" />
              <Metric tone="orange" value={reviewCount} label="需要检查（差异）" hint="确认保留或忽略" />
              <Metric tone="red" value={deleteCount} label="可能删除（已暂停）" hint="删除需要单独确认" />
            </div>
            <div className="overview-primary-action">
              <button
                className="primary-button large"
                data-testid="react-run-sync-check"
                disabled={!appState || syncBusy}
                onClick={onRunCheck}
                type="button"
              >
                <Eye size={20} />
                {syncBusy ? '正在生成预览' : '生成同步预览'}
              </button>
              <span>查看详细变更，确认后再执行写入</span>
            </div>
            <SyncStatus error={syncError} message={syncMessage} />
          </section>

          <section className="activity-panel">
            <h2>最近活动</h2>
            <ActivityRow icon="check" title="连接检查完成" body="Apple Music、QQ 音乐、网易云音乐" time="2 分钟前" />
            <ActivityRow icon="sync" title="同步预览已生成" body={`${formatCount(addCount)} 新增，${formatCount(reviewCount)} 需检查，${formatCount(deleteCount)} 可能删除`} time="8 分钟前" />
            <ActivityRow icon="warning" title="写入保护已开启" body="删除操作已暂停，等待你的确认" time="15 分钟前" />
          </section>
        </div>

        <aside className="overview-side">
          <section className="next-panel">
            <h2>下一步</h2>
            <ol className="stepper-list">
              <li className="active">
                <span>1</span>
                <div>
                  <strong>生成同步预览</strong>
                  <p>查看即将发生的新增、差异和可能删除内容。</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>检查并确认</strong>
                  <p>先处理匹配差异，尤其是可能删除的歌曲。</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>执行写入</strong>
                  <p>新增可以批量写入；删除仍需单独确认。</p>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>自动同步（可选）</strong>
                  <p>设置定时任务，保持多平台一致。</p>
                </div>
              </li>
            </ol>
            <div className="soft-note">
              <ShieldAlert size={18} />
              <p>删除不会自动执行，所有删除项都需要你明确确认后才会从目标平台移除。</p>
            </div>
          </section>

          <section className="quick-panel">
            <h2>快捷操作</h2>
            <button onClick={() => onNavigate('connect')} type="button">连接管理 <ArrowRight size={16} /></button>
            <button onClick={() => onNavigate('mode')} type="button">同步规则 <ArrowRight size={16} /></button>
            <button onClick={() => onNavigate('preview')} type="button">同步预览 <ArrowRight size={16} /></button>
            <button onClick={() => onNavigate('automation')} type="button">自动同步 <ArrowRight size={16} /></button>
            <button onClick={() => onNavigate('ai')} type="button">音乐库画像 <ArrowRight size={16} /></button>
          </section>
        </aside>
      </div>

      <div className="workflow-strip" aria-label="同步流程">
        <WorkflowStep label="连接" body="已连接 3/3" active />
        <WorkflowStep label="选择规则" body="以 Apple Music 为准" active />
        <WorkflowStep label="预览" body="上次：2 分钟前" active />
        <WorkflowStep label="写入" body="写入保护已开启" />
        <WorkflowStep
          label="自动同步"
          body={appState?.autoSync?.running ? '运行中' : appState?.autoSync?.enabled ? '已启用' : '未启用'}
          active={Boolean(appState?.autoSync?.enabled)}
        />
      </div>
    </section>
  );
}

function TargetCard({ platform, platformKey }: { platform?: PlatformSummary; platformKey: PlatformKey }) {
  const key = platformKey === 'netease' ? 'netease' : 'qq';
  return (
    <div className="target-card platform-card">
      <PlatformArtwork platform={key} size="md" />
      <div>
        <strong>{platform?.label || platformMeta[key].label}</strong>
        <small>{platform?.liveValidation?.ok ? '已连接 · 写入保护' : '等待连接'}</small>
        <b>{formatCount(platform?.tracks || 0)} 首</b>
      </div>
      <StatusPill tone={platform?.liveValidation?.ok ? 'success' : 'warning'}>目标平台</StatusPill>
    </div>
  );
}

function Metric({ value, label, hint, tone }: { value: number; label: string; hint: string; tone: string }) {
  return (
    <div className={`health-metric ${tone}`}>
      <strong>{formatCount(value)}</strong>
      <span>{label}</span>
      <small>{hint}</small>
    </div>
  );
}

function ActivityRow({
  icon,
  title,
  body,
  time,
}: {
  icon: 'check' | 'sync' | 'warning';
  title: string;
  body: string;
  time: string;
}) {
  const Icon = icon === 'check' ? CheckCircle2 : icon === 'sync' ? RefreshCcw : ShieldCheck;
  return (
    <div className={`activity-row ${icon}`}>
      <Icon size={22} />
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      <time>{time}</time>
    </div>
  );
}

function WorkflowStep({ label, body, active }: { label: string; body: string; active?: boolean }) {
  return (
    <div className={active ? 'workflow-step active' : 'workflow-step'}>
      <span>{label}</span>
      <strong>{body}</strong>
    </div>
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

function platformByKey(appState: AppStateSummary | null, key: PlatformKey): PlatformSummary | undefined {
  return appState?.platforms.find((platform) => platform.key === key);
}
