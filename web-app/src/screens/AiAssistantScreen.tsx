import { useEffect, useMemo, useState } from 'react';

import {
  fetchAgentSessions,
  fetchAiProviderState,
  findSimilarTracks,
  generateMusicProfile,
  generateRecommendations,
  runAgentChat,
  saveAgentTraceFeedback,
  testAiProviderConnection,
} from '../api/client';
import type {
  AgentChatResult,
  AgentFeedbackLabel,
  AgentSessionsResult,
  AgentTraceSummary,
  AiProviderSummary,
  AiProviderTestResult,
  MusicCandidateSummary,
  MusicProfileResult,
  RecommendationResult,
  SimilarTracksResult,
} from '../api/types';

const FEATURES = [
  ['AI 复核', '合并时长、ISRC、版本线索和外部证据，给同步预览提供可审计判断。'],
  ['音乐画像', '只基于本地清洗后的喜欢歌曲，生成风格、语言、艺人和版本偏好。'],
  ['相似歌曲', '从本地统一曲库里查找相似候选，不会直接写入任何平台。'],
  ['推荐候选', '只重排已有候选和本地证据，避免凭空造歌。'],
];

const FEEDBACK_LABELS: AgentFeedbackLabel[] = ['useful', 'not_enough_evidence', 'incorrect'];

export function AiAssistantScreen() {
  const [provider, setProvider] = useState<AiProviderSummary | null>(null);
  const [providerTest, setProviderTest] = useState<AiProviderTestResult | null>(null);
  const [profile, setProfile] = useState<MusicProfileResult | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationResult | null>(null);
  const [similar, setSimilar] = useState<SimilarTracksResult | null>(null);
  const [agentChat, setAgentChat] = useState<AgentChatResult | null>(null);
  const [agentSessions, setAgentSessions] = useState<AgentSessionsResult | null>(null);
  const [consent, setConsent] = useState(false);
  const [similarTitle, setSimilarTitle] = useState('');
  const [similarArtist, setSimilarArtist] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('有哪些需要确认的歌曲？');
  const [busyLabel, setBusyLabel] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetchAiProviderState()
      .then((result) => {
        if (active) setProvider(result);
      })
      .catch((loadError: Error) => {
        if (active) setError(loadError.message);
      });
    fetchAgentSessions({ limit: 3, traceLimit: 5 })
      .then((result) => {
        if (active) setAgentSessions(result);
      })
      .catch(() => {
        if (active) setAgentSessions({ total: 0, sessions: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  const busy = Boolean(busyLabel);
  const providerConfigured = Boolean(provider?.configured || provider?.hasApiKey);
  const providerSummary = useMemo(() => {
    if (!provider) return '正在读取本地 AI Provider 配置';
    const state = providerConfigured ? '已配置' : '未配置';
    return `${providerDisplayName(provider.provider)} / ${provider.model || '默认模型'}，${state}`;
  }, [provider, providerConfigured]);

  async function runAction<T>(label: string, action: () => Promise<T>, onSuccess: (result: T) => void, message: string) {
    setBusyLabel(label);
    setStatus('');
    setError('');
    try {
      const result = await action();
      onSuccess(result);
      setStatus(message);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusyLabel('');
    }
  }

  function requireModelConsent(): boolean {
    if (!consent) {
      setError('需要先勾选同意，才会把脱敏后的聚合证据发送给配置的 AI Provider。');
      setStatus('');
      return false;
    }
    if (!providerConfigured) {
      setError('本机还没有可用的 AI Provider API key；本地画像、推荐和相似歌曲仍然可用。');
      setStatus('');
      return false;
    }
    return true;
  }

  function handleLocalProfile() {
    void runAction(
      '正在生成本地画像',
      () => generateMusicProfile(),
      setProfile,
      '已生成本地音乐画像，没有调用外部模型。',
    );
  }

  function handleModelProfile() {
    if (!requireModelConsent()) return;
    void runAction(
      '正在生成 AI 增强画像',
      () => generateMusicProfile({ useModel: true, consent: true }),
      setProfile,
      '已生成 AI 增强画像，结果仍只保存在本地。',
    );
  }

  function handleLocalRecommendations() {
    void runAction(
      '正在生成本地推荐',
      () => generateRecommendations({ limit: 8, saveShortlist: false }),
      setRecommendations,
      '已生成本地推荐候选，没有写入任何音乐平台。',
    );
  }

  function handleModelRecommendations() {
    if (!requireModelConsent()) return;
    void runAction(
      '正在生成 AI 增强推荐',
      () => generateRecommendations({ limit: 8, useModel: true, consent: true, saveShortlist: false }),
      setRecommendations,
      '已生成 AI 增强推荐候选，没有写入任何音乐平台。',
    );
  }

  function handleSimilarSearch() {
    void runAction(
      '正在查找相似歌曲',
      () => findSimilarTracks({ seed: { title: similarTitle, artist: similarArtist }, limit: 8 }),
      setSimilar,
      '已从本地统一曲库查找相似候选。',
    );
  }

  function handleProviderTest() {
    if (!requireModelConsent()) return;
    void runAction(
      '正在测试 AI Provider',
      () => testAiProviderConnection({ consent: true }),
      (result) => {
        setProviderTest(result);
        if (result.provider) setProvider({ ...result.provider, configured: true });
      },
      'AI Provider 连通性测试通过。',
    );
  }

  function handleRefreshAgentAudit() {
    void runAction(
      '正在读取 Agent 审计',
      () => fetchAgentSessions({ limit: 3, traceLimit: 5 }),
      setAgentSessions,
      '已刷新最近的 Agent 工具审计。',
    );
  }

  function handleAgentChat() {
    const prompt = agentPrompt.trim();
    if (!prompt) {
      setError('请输入要询问的内容。');
      setStatus('');
      return;
    }
    void runAction(
      '正在询问本地 Agent 工具',
      async () => {
        const chat = await runAgentChat({ message: prompt });
        const sessions = await fetchAgentSessions({ limit: 3, traceLimit: 5 }).catch(() => null);
        return { chat, sessions };
      },
      (result) => {
        setAgentChat(result.chat);
        if (result.sessions) setAgentSessions(result.sessions);
      },
      'Agent 已基于本地安全工具返回结果，未写入任何音乐平台。',
    );
  }

  function handleTraceFeedback(sessionId: string, trace: AgentTraceSummary, label: AgentFeedbackLabel) {
    const traceId = trace.id || trace.traceId || '';
    if (!sessionId || !traceId) {
      setError('这条 Agent 审计记录缺少反馈标识，请刷新后重试。');
      return;
    }
    void runAction(
      '正在保存 Agent 反馈',
      () => saveAgentTraceFeedback({ sessionId, traceId, label }),
      (result) => {
        if (result.sessions) setAgentSessions(result.sessions);
      },
      `已记录 Agent 反馈：${feedbackText(label)}。`,
    );
  }

  return (
    <section className="surface-band ai-screen" data-testid="react-ai-screen">
      <div className="section-heading">
        <h2>内置 AI 与 Agent 工具</h2>
        <p>普通用户默认使用本地分析；只有勾选同意并点击模型按钮时，才会把脱敏聚合证据发送给配置的 AI Provider。</p>
      </div>

      <div className="feature-grid">
        {FEATURES.map(([title, body]) => (
          <article className="feature-item" key={title}>
            <strong>{title}</strong>
            <p>{body}</p>
          </article>
        ))}
      </div>

      <div className="ai-layout">
        <section className="ai-panel">
          <div className="ai-panel-head">
            <div>
              <h3>画像与推荐</h3>
              <p>本地算法先建立口味画像，再从已有曲库候选里排序。</p>
            </div>
            <span className={profile?.model?.used || recommendations?.model?.used ? 'product-state-pill writable' : 'product-state-pill readable'}>
              {profile?.model?.used || recommendations?.model?.used ? 'AI 增强' : '本地模式'}
            </span>
          </div>
          <div className="action-row ai-actions">
            <button data-testid="react-ai-local-profile" disabled={busy} onClick={handleLocalProfile} type="button">生成本地画像</button>
            <button data-testid="react-ai-model-profile" disabled={busy || !consent || !providerConfigured} onClick={handleModelProfile} type="button">AI 增强画像</button>
            <button data-testid="react-ai-local-recommendations" disabled={busy} onClick={handleLocalRecommendations} type="button">生成本地推荐</button>
            <button data-testid="react-ai-model-recommendations" disabled={busy || !consent || !providerConfigured} onClick={handleModelRecommendations} type="button">AI 增强推荐</button>
          </div>
        </section>

        <section className="ai-panel">
          <div className="ai-panel-head">
            <div>
              <h3>相似歌曲</h3>
              <p>输入一首歌，从本地统一曲库找相近风格或版本线索。</p>
            </div>
            <span className="product-state-pill readable">只读</span>
          </div>
          <div className="ai-form-grid">
            <label>
              歌名
              <input
                onChange={(event) => setSimilarTitle(event.target.value)}
                placeholder="Night Drive"
                type="text"
                value={similarTitle}
              />
            </label>
            <label>
              歌手
              <input
                onChange={(event) => setSimilarArtist(event.target.value)}
                placeholder="Carol"
                type="text"
                value={similarArtist}
              />
            </label>
            <button data-testid="react-ai-similar-search" disabled={busy} onClick={handleSimilarSearch} type="button">查找相似歌曲</button>
          </div>
        </section>

        <section className="ai-panel">
          <div className="ai-panel-head">
            <div>
              <h3>Provider 与 Agent</h3>
              <p>{providerSummary}</p>
            </div>
            <span className={providerConfigured ? 'product-state-pill writable' : 'product-state-pill not_connected'}>
              {providerConfigured ? '已配置' : '未配置'}
            </span>
          </div>
          <label className="ai-consent-row">
            <input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
            我同意仅发送脱敏聚合证据给配置的 AI Provider
          </label>
          <div className="action-row ai-actions">
            <button data-testid="react-ai-provider-test" disabled={busy || !consent || !providerConfigured} onClick={handleProviderTest} type="button">测试 AI 连接</button>
            <button data-testid="react-agent-audit-refresh" disabled={busy} onClick={handleRefreshAgentAudit} type="button">刷新 Agent 审计</button>
          </div>
          {providerTest ? (
            <p className="muted-line">
              最近测试：{providerTest.ok ? '通过' : '失败'}，
              {providerDisplayName(providerTest.provider?.provider)} / {providerTest.model || providerTest.provider?.model || '默认模型'}
            </p>
          ) : null}
        </section>

        <section className="ai-panel agent-chat-panel">
          <div className="ai-panel-head">
            <div>
              <h3>Agent 对话</h3>
              <p>围绕曲库、同步证据、音乐画像和推荐候选提问。</p>
            </div>
            <span className="product-state-pill readable">本地工具</span>
          </div>
          <div className="agent-chat-form">
            <label>
              问题
              <textarea
                data-testid="react-agent-chat-input"
                onChange={(event) => setAgentPrompt(event.target.value)}
                placeholder="有哪些需要确认的歌曲？"
                rows={3}
                value={agentPrompt}
              />
            </label>
            <button data-testid="react-agent-chat-send" disabled={busy || !agentPrompt.trim()} onClick={handleAgentChat} type="button">询问 Agent</button>
          </div>
        </section>
      </div>

      {busyLabel ? <div className="inline-alert ai-status" role="status">{busyLabel}...</div> : null}
      {status ? <div className="inline-alert ai-status readable" role="status">{status}</div> : null}
      {error ? <div className="inline-alert ai-status danger" role="alert">{error}</div> : null}

      <div className="ai-result-grid">
        <ProfileResult profile={profile} />
        <RecommendationResultPanel recommendations={recommendations} />
        <SimilarResultPanel similar={similar} />
        <AgentChatResultPanel result={agentChat} />
        <AgentAuditPanel
          busy={busy}
          sessions={agentSessions}
          onFeedback={handleTraceFeedback}
        />
      </div>
    </section>
  );
}

function ProfileResult({ profile }: { profile: MusicProfileResult | null }) {
  if (!profile) {
    return <EmptyResult title="音乐画像" body="生成画像后会显示曲库规模、常听艺人、语言线索和模型增强摘要。" />;
  }
  const summary = profile.summary;
  return (
    <section className="ai-result-panel" data-testid="react-ai-profile-result">
      <div className="ai-panel-head">
        <h3>音乐画像</h3>
        <span className="product-state-pill readable">{summary.trackCount} 首</span>
      </div>
      <div className="ai-metric-row">
        <Metric label="常听艺人" value={namedList(summary.topArtists, 4)} />
        <Metric label="主要语言" value={namedList(summary.languages, 3)} />
        <Metric label="平均时长" value={formatDuration(summary.averageDurationMs)} />
        <Metric label="ISRC 覆盖" value={formatPercent(summary.isrcCoverage)} />
      </div>
      {profile.aiSummary?.summary ? <p className="ai-summary-text">{profile.aiSummary.summary}</p> : null}
      <ChipRow items={profile.aiSummary?.tasteTags || []} />
      <EvidenceLine model={profile.model} evidenceRefs={profile.aiSummary?.evidenceRefs || []} />
    </section>
  );
}

function RecommendationResultPanel({ recommendations }: { recommendations: RecommendationResult | null }) {
  if (!recommendations) {
    return <EmptyResult title="推荐候选" body="生成推荐后会显示本地候选、分数、原因和 AI 重排说明。" />;
  }
  return (
    <section className="ai-result-panel">
      <div className="ai-panel-head">
        <h3>推荐候选</h3>
        <span className="product-state-pill readable">{recommendations.total} 首</span>
      </div>
      {recommendations.aiSummary?.summary ? <p className="ai-summary-text">{recommendations.aiSummary.summary}</p> : null}
      <CandidateList candidates={recommendations.candidates} />
      <EvidenceLine model={recommendations.model} evidenceRefs={recommendations.aiSummary?.evidenceRefs || []} />
    </section>
  );
}

function SimilarResultPanel({ similar }: { similar: SimilarTracksResult | null }) {
  if (!similar) {
    return <EmptyResult title="相似歌曲" body="输入歌名或歌手后，会从本地证据中找出相似候选。" />;
  }
  if (!similar.seed) {
    return <EmptyResult title="相似歌曲" body="没有找到可作为种子的本地歌曲，请换一个歌名或歌手。" />;
  }
  return (
    <section className="ai-result-panel">
      <div className="ai-panel-head">
        <div>
          <h3>相似歌曲</h3>
          <p>{similar.seed.track.title} - {similar.seed.track.artist || '未知歌手'}</p>
        </div>
        <span className="product-state-pill readable">{similar.total} 首</span>
      </div>
      <CandidateList candidates={similar.candidates} />
    </section>
  );
}

function AgentChatResultPanel({ result }: { result: AgentChatResult | null }) {
  if (!result) {
    return <EmptyResult title="Agent 回复" body="提交自然语言问题后，会显示本地工具调用结果和证据摘要。" />;
  }
  return (
    <section className="ai-result-panel" data-testid="react-agent-chat-result">
      <div className="ai-panel-head">
        <div>
          <h3>Agent 回复</h3>
          <p>{toolLabel(result.tool)} / {agentResultAccessLabel(result)}</p>
        </div>
        <span className={result.mutatesProvider ? 'product-state-pill needs_attention' : 'product-state-pill readable'}>
          {result.mutatesProvider ? '可能写入' : result.localDraft ? '只写本地草稿' : '不写平台'}
        </span>
      </div>
      <p className="ai-summary-text">{result.message || '已完成本地工具调用。'}</p>
      <ChipRow items={result.evidenceRefs.length ? result.evidenceRefs : ['local_tool']} />
      <SummaryBlock title="结果摘要" value={result.resultSummary} />
    </section>
  );
}

function AgentAuditPanel({
  busy,
  sessions,
  onFeedback,
}: {
  busy: boolean;
  sessions: AgentSessionsResult | null;
  onFeedback: (sessionId: string, trace: AgentTraceSummary, label: AgentFeedbackLabel) => void;
}) {
  const traces = (sessions?.sessions || [])
    .flatMap((session) => session.toolTraces.map((trace) => ({ sessionId: session.id, trace })))
    .slice(0, 5);
  return (
    <section className="ai-result-panel">
      <div className="ai-panel-head">
        <h3>Agent 工具审计</h3>
        <span className="product-state-pill readable">{traces.length} 条</span>
      </div>
      {!traces.length ? (
        <p className="muted-line">还没有 Agent 工具调用记录；后续自然语言工具调用会在这里显示摘要。</p>
      ) : (
        <div className="agent-trace-list">
          {traces.map(({ sessionId, trace }) => (
            <article className="agent-trace-row" key={`${sessionId}:${trace.id}`}>
              <div className="ai-panel-head">
                <div>
                  <strong>{toolLabel(trace.tool)}</strong>
                  <p>{trace.status || 'completed'} / {agentAccessLabel(trace)} / {trace.durationMs || 0} ms</p>
                </div>
                <span className={trace.mutatesProvider ? 'product-state-pill needs_attention' : 'product-state-pill readable'}>
                  {trace.mutatesProvider ? '可能写入' : trace.localDraft ? '只写本地草稿' : '不写平台'}
                </span>
              </div>
              <ChipRow items={trace.evidenceRefs.length ? trace.evidenceRefs : ['local_summary']} />
              <div className="agent-summary-grid">
                <SummaryBlock title="参数摘要" value={trace.argumentsSummary} />
                <SummaryBlock title="结果摘要" value={trace.resultSummary} />
              </div>
              <div className="agent-feedback-row">
                <span>反馈：{feedbackText(trace.feedback?.label)}</span>
                <div>
                  {FEEDBACK_LABELS.map((label) => (
                    <button
                      className={trace.feedback?.label === label ? 'active' : ''}
                      disabled={busy}
                      key={label}
                      onClick={() => onFeedback(sessionId, trace, label)}
                      type="button"
                    >
                      {feedbackText(label)}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CandidateList({ candidates }: { candidates: MusicCandidateSummary[] }) {
  if (!candidates.length) return <p className="muted-line">暂无候选。</p>;
  return (
    <div className="ai-candidate-list">
      {candidates.slice(0, 8).map((candidate) => (
        <article className="ai-candidate-row" key={candidate.key || `${candidate.track.title}:${candidate.track.artist}`}>
          <div>
            <strong>{candidate.track.title || 'Untitled'}</strong>
            <span>{candidate.track.artist || '未知歌手'}{candidate.track.album ? ` / ${candidate.track.album}` : ''}</span>
          </div>
          <div className="candidate-score">
            <strong>{formatScore(candidate.score)}</strong>
            <span>{candidate.aiReason || reasonList(candidate.reasons)}</span>
          </div>
          <ChipRow items={candidate.platformLabels.length ? candidate.platformLabels : candidate.platforms} />
        </article>
      ))}
    </div>
  );
}

function EmptyResult({ title, body }: { title: string; body: string }) {
  return (
    <section className="ai-result-panel empty">
      <h3>{title}</h3>
      <p>{body}</p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || '暂无'}</strong>
    </div>
  );
}

function ChipRow({ items }: { items: string[] }) {
  const visible = items.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8);
  if (!visible.length) return null;
  return (
    <div className="evidence-row">
      {visible.map((item) => <span className="evidence-chip" key={item}>{item}</span>)}
    </div>
  );
}

function EvidenceLine({ model, evidenceRefs }: { model?: MusicProfileResult['model']; evidenceRefs: string[] }) {
  return (
    <p className="muted-line">
      模式：{model?.used ? `AI 增强 / ${providerDisplayName(model.provider?.provider)} / ${model.model || model.provider?.model || '默认模型'}` : '本地确定性分析'}
      {evidenceRefs.length ? `，证据：${evidenceRefs.slice(0, 4).join('、')}` : ''}
    </p>
  );
}

function SummaryBlock({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div>
      <span>{title}</span>
      <p>{formatSummaryRecord(value)}</p>
    </div>
  );
}

function namedList(items: Array<{ name: string; count: number }>, limit: number): string {
  return items.slice(0, limit).map((item) => `${item.name} (${item.count})`).join('、') || '暂无';
}

function formatDuration(value?: number | null): string {
  const milliseconds = Number(value || 0);
  if (!milliseconds) return '暂无';
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatPercent(value?: number): string {
  const number = Number(value || 0);
  return number ? `${Math.round(number * 100)}%` : '暂无';
}

function formatScore(value?: number): string {
  const number = Number(value || 0);
  return number ? String(Math.round(number)) : '-';
}

function reasonList(reasons: string[]): string {
  return reasons.map(reasonLabel).join('、') || '本地相似度';
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    same_artist: '同艺人',
    title_tokens: '标题相近',
    same_album: '同专辑',
    close_duration: '时长接近',
    same_version_signal: '版本线索一致',
    same_language: '语言相近',
    top_artist_match: '常听艺人',
    language_match: '语言偏好',
    liked_on_multiple_non_apple_platforms: '多平台喜欢',
    fits_duration_profile: '时长偏好',
    has_isrc: '有 ISRC',
  };
  return labels[reason] || reason;
}

function providerDisplayName(provider?: string): string {
  if (!provider) return 'AI Provider';
  if (provider === 'deepseek') return 'DeepSeek';
  return provider;
}

function toolLabel(tool: string): string {
  const labels: Record<string, string> = {
    get_library_summary: '读取曲库摘要',
    get_sync_policy: '读取同步策略',
    get_sync_preview: '读取同步预览',
    get_track_evidence: '查看单曲证据',
    get_baseline_diff: '查看基线差异',
    get_review_queue: '查看复核队列',
    explain_sync_gap: '解释同步差异',
    find_similar_tracks: '查找相似歌曲',
    recommend_by_profile: '按画像推荐',
    save_local_shortlist: '保存推荐草稿',
    draft_sync_operations: '生成同步草稿',
  };
  return labels[tool] || tool || 'Agent 工具';
}

function agentAccessLabel(trace: AgentTraceSummary): string {
  if (trace.localDraft) return '本地草稿';
  if (trace.readOnly === false) return '需要复核';
  return '只读';
}

function agentResultAccessLabel(result: AgentChatResult): string {
  if (result.localDraft) return '本地草稿';
  if (result.readOnly === false) return '需要复核';
  return '只读';
}

function feedbackText(label?: string): string {
  if (label === 'useful') return '有用';
  if (label === 'not_enough_evidence') return '证据不足';
  if (label === 'incorrect') return '不准确';
  return '未反馈';
}

function formatSummaryRecord(value: Record<string, unknown>): string {
  const entries = Object.entries(value || {}).slice(0, 5);
  if (!entries.length) return '暂无';
  return entries.map(([key, item]) => `${key}: ${formatSummaryValue(item)}`).join('；');
}

function formatSummaryValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).slice(0, 4).join(', ') || '[]';
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 4)
      .map(([key, item]) => `${key}=${String(item)}`)
      .join(', ');
  }
  return String(value ?? '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '操作失败');
}
