import { useEffect, useState } from 'react';

import { fetchAiProviderState, fetchLiveValidationState, runLiveValidation } from '../api/client';
import type {
  AiProviderSummary,
  AppStateSummary,
  LiveValidationSummary,
  LiveValidationTargetSummary,
  PlatformKey,
} from '../api/types';

interface AdvancedSettingsScreenProps {
  appState: AppStateSummary | null;
}

const VALIDATION_TARGETS: Array<Exclude<PlatformKey, 'apple'>> = ['qq', 'netease'];
const LIVE_VALIDATION_CONFIRM = 'DISPOSABLE_PLAYLIST';

export function AdvancedSettingsScreen({ appState }: AdvancedSettingsScreenProps) {
  const [provider, setProvider] = useState<AiProviderSummary | null>(null);
  const [liveValidation, setLiveValidation] = useState<LiveValidationSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [validationTarget, setValidationTarget] = useState<Exclude<PlatformKey, 'apple'>>('qq');
  const [validationQuery, setValidationQuery] = useState('');
  const [validationPlaylistId, setValidationPlaylistId] = useState('');
  const [validationConfirm, setValidationConfirm] = useState('');

  useEffect(() => {
    void refreshDiagnostics({ silent: true });
  }, []);

  async function refreshDiagnostics(options: { silent?: boolean } = {}) {
    setBusy(true);
    setError('');
    if (!options.silent) setMessage('正在刷新本机诊断摘要...');
    try {
      const [providerState, liveState] = await Promise.all([
        fetchAiProviderState(),
        fetchLiveValidationState(),
      ]);
      setProvider(providerState);
      setLiveValidation(liveState);
      if (!options.silent) setMessage('已刷新高级设置摘要。');
    } catch (refreshError) {
      setError(errorMessage(refreshError));
      if (!options.silent) setMessage('');
    } finally {
      setBusy(false);
    }
  }

  async function runSelectedLiveValidation() {
    setBusy(true);
    setError('');
    setMessage(`正在验证 ${platformLabel(validationTarget)} 的真实新增和删除...`);
    try {
      const result = await runLiveValidation({
        target: validationTarget,
        query: validationQuery,
        playlistId: validationPlaylistId,
        confirm: validationConfirm,
      });
      setLiveValidation((current) => ({
        ok: Boolean(current?.ok && result.ok),
        generatedAt: new Date().toISOString(),
        maxAgeDays: current?.maxAgeDays,
        targets: {
          ...current?.targets,
          [validationTarget]: result.validation,
        },
      }));
      await refreshDiagnostics({ silent: true });
      setMessage(`${platformLabel(validationTarget)} 验证完成：${result.validation.track?.title || '测试歌曲'} 已完成新增和删除回滚。`);
      setValidationConfirm('');
    } catch (validationError) {
      setError(errorMessage(validationError));
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  function openCompatibilityWorkbench() {
    window.location.assign('/workbench/#advanced');
  }

  const validationReady = validationQuery.trim().length > 0
    && validationConfirm.trim() === LIVE_VALIDATION_CONFIRM;

  return (
    <section className="surface-band advanced-screen" data-testid="react-advanced-screen">
      <div className="section-heading">
        <h2>高级设置</h2>
        <p>这里放兼容工作台、发布验证和本机诊断。普通同步路径不需要打开这里。</p>
      </div>

      <div className="advanced-control-row">
        <button data-testid="react-refresh-diagnostics" disabled={busy} onClick={() => void refreshDiagnostics()} type="button">刷新诊断摘要</button>
        <button className="secondary" data-testid="react-open-compat-workbench" onClick={openCompatibilityWorkbench} type="button">打开兼容工作台</button>
      </div>

      {message ? <div className="inline-alert advanced-status readable" role="status">{message}</div> : null}
      {error ? <div className="inline-alert advanced-status danger" role="alert">{error}</div> : null}

      <div className="advanced-card-grid">
        <article className="advanced-card caution">
          <div className="advanced-card-head">
            <div>
              <h3>兼容工作台</h3>
              <p>镜像计划、手动 Cookie、底层写入诊断、原始报告和旧工具仍保留在兼容页面。</p>
            </div>
            <span className="product-state-pill needs_attention">谨慎操作</span>
          </div>
          <ul className="advanced-check-list">
            <li>普通用户同步不依赖这里。</li>
            <li>打开后会显示更多开发者控件。</li>
            <li>真实写入仍受 dry-run、确认文本和 live validation 保护。</li>
          </ul>
        </article>

        <article className="advanced-card">
          <div className="advanced-card-head">
            <div>
              <h3>发布验证</h3>
              <p>真实 QQ / 网易云新增删除验证只显示脱敏摘要；报告写入本机 ignored reports 目录。</p>
            </div>
            <span className={liveValidation?.ok ? 'product-state-pill readable' : 'product-state-pill needs_attention'}>
              {liveValidation?.ok ? '已通过' : '需验证'}
            </span>
          </div>
          <div className="advanced-target-list">
            {VALIDATION_TARGETS.map((target) => (
              <LiveValidationRow
                key={target}
                target={target}
                validation={liveValidation?.targets[target]}
              />
            ))}
          </div>
          <div className="live-validation-form" data-testid="react-live-validation-form">
            <label>
              <span>目标平台</span>
              <select
                data-testid="react-live-validation-target"
                disabled={busy}
                onChange={(event) => setValidationTarget(event.target.value as Exclude<PlatformKey, 'apple'>)}
                value={validationTarget}
              >
                {VALIDATION_TARGETS.map((target) => (
                  <option key={target} value={target}>{platformLabel(target)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>测试歌曲查询</span>
              <input
                data-testid="react-live-validation-query"
                disabled={busy}
                onChange={(event) => setValidationQuery(event.target.value)}
                placeholder="歌手 歌名"
                value={validationQuery}
              />
            </label>
            <label>
              <span>临时歌单 ID（可选）</span>
              <input
                data-testid="react-live-validation-playlist"
                disabled={busy}
                onChange={(event) => setValidationPlaylistId(event.target.value)}
                placeholder="留空则尝试创建私有验证歌单"
                value={validationPlaylistId}
              />
            </label>
            <label>
              <span>确认文本</span>
              <input
                data-testid="react-live-validation-confirm"
                disabled={busy}
                onChange={(event) => setValidationConfirm(event.target.value)}
                placeholder={LIVE_VALIDATION_CONFIRM}
                value={validationConfirm}
              />
            </label>
            <button
              className="danger"
              data-testid="react-run-live-validation"
              disabled={busy || !validationReady}
              onClick={() => void runSelectedLiveValidation()}
              type="button"
            >
              运行真实写入验证
            </button>
            <p className="muted-line">这会对目标平台的临时歌单执行一次新增和删除回滚；不会同步你的正式喜欢列表。</p>
          </div>
        </article>

        <article className="advanced-card">
          <div className="advanced-card-head">
            <div>
              <h3>AI Provider</h3>
              <p>只展示 provider 和模型摘要；API key 不会出现在页面或报告里。</p>
            </div>
            <span className={provider?.configured || provider?.hasApiKey ? 'product-state-pill readable' : 'product-state-pill not_connected'}>
              {provider?.configured || provider?.hasApiKey ? '已配置' : '未配置'}
            </span>
          </div>
          <dl className="advanced-kv">
            <div>
              <dt>Provider</dt>
              <dd>{providerDisplayName(provider?.provider)}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{provider?.model || '默认模型'}</dd>
            </div>
            <div>
              <dt>批量大小</dt>
              <dd>{provider?.batchSize || '默认'}</dd>
            </div>
            <div>
              <dt>配置来源</dt>
              <dd>{provider?.stateExists ? '本机偏好' : '默认设置 / 环境变量'}</dd>
            </div>
          </dl>
        </article>

        <article className="advanced-card">
          <div className="advanced-card-head">
            <div>
              <h3>本地状态边界</h3>
              <p>React 普通用户页只读取脱敏摘要，不展示本地路径、Cookie 或原始平台返回。</p>
            </div>
            <span className="product-state-pill readable">只读摘要</span>
          </div>
          <dl className="advanced-kv">
            <div>
              <dt>当前模式</dt>
              <dd>{modeLabel(appState?.currentMode)}</dd>
            </div>
            <div>
              <dt>同步基线</dt>
              <dd>{appState?.baseline?.saved ? `已保存 ${formatDate(appState.baseline.updatedAt)}` : '未保存'}</dd>
            </div>
            <div>
              <dt>最近执行</dt>
              <dd>{latestRunText(appState)}</dd>
            </div>
            <div>
              <dt>下一步</dt>
              <dd>{appState?.preview.nextAction || '连接平台后开始同步检查'}</dd>
            </div>
          </dl>
        </article>

        <article className="advanced-card">
          <div className="advanced-card-head">
            <div>
              <h3>开源验证命令</h3>
              <p>这些命令不会联系音乐平台，适合作为提交前本地门禁。</p>
            </div>
            <span className="product-state-pill readable">本地门禁</span>
          </div>
          <div className="advanced-command-list" aria-label="本地验证命令">
            <code>npm run verify</code>
            <code>npm run smoke:web-app</code>
            <code>npm run check:privacy</code>
          </div>
        </article>
      </div>
    </section>
  );
}

function LiveValidationRow({
  target,
  validation,
}: {
  target: PlatformKey;
  validation?: LiveValidationTargetSummary;
}) {
  const status = validation?.status || 'missing';
  return (
    <div className="advanced-target-row">
      <div>
        <strong>{platformLabel(target)}</strong>
        <span>{liveStatusText(status)}{validation?.validatedAt ? ` / ${formatDate(validation.validatedAt)}` : ''}</span>
      </div>
      <div>
        <span>新增 {validation?.mutations?.addVerified ? '已验证' : '未验证'}</span>
        <span>删除 {validation?.mutations?.removeVerified ? '已验证' : '未验证'}</span>
      </div>
      <span className={validation?.ok ? 'product-state-pill readable' : status === 'stale' ? 'product-state-pill needs_attention' : 'product-state-pill not_connected'}>
        {liveStatusText(status)}
      </span>
    </div>
  );
}

function platformLabel(platform: PlatformKey | string): string {
  if (platform === 'qq') return 'QQ 音乐';
  if (platform === 'netease') return '网易云音乐';
  return 'Apple Music';
}

function providerDisplayName(provider?: string): string {
  if (!provider) return '默认 Provider';
  if (provider === 'deepseek') return 'DeepSeek';
  return provider;
}

function liveStatusText(status: string): string {
  if (status === 'verified') return '已通过';
  if (status === 'stale') return '需更新';
  if (status === 'missing') return '未验证';
  return '异常';
}

function modeLabel(mode?: string): string {
  if (mode === 'canonical_mirror') return '以 Apple Music 为准';
  if (mode === 'union_convergence') return '合并所有平台';
  if (mode === 'managed_bidirectional') return '自动新增，删除需确认';
  if (mode === 'read_only_analysis') return '只分析，不修改';
  return '未选择';
}

function latestRunText(appState: AppStateSummary | null): string {
  const run = appState?.latestRun;
  if (!run || run.status === 'none') return '暂无';
  const action = run.dryRun ? 'dry-run' : '执行';
  const targets = run.targets?.length ? run.targets.map(platformLabel).join('、') : '目标平台';
  return `${action} ${targets} / 新增 ${run.addRequested || 0} / 删除 ${run.removeRequested || 0}`;
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '操作失败');
}
