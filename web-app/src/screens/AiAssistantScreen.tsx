import {
  Bot,
  Check,
  ChevronRight,
  CirclePlus,
  MessageCircle,
  Play,
  RefreshCcw,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
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
  AppStateSummary,
  MusicCandidateSummary,
  MusicProfileResult,
  RecommendationResult,
  SimilarTracksResult,
} from '../api/types';
import {
  AlbumArtwork,
  EvidenceChip,
  formatCount,
  PlatformArtwork,
  StatusPill,
} from '../components/MusicVisuals';

interface ScreenProps {
  appState: AppStateSummary | null;
  onOpenReview: () => void;
}

const FEEDBACK_LABELS: AgentFeedbackLabel[] = ['useful', 'not_enough_evidence', 'incorrect'];

export function AiAssistantScreen({ appState, onOpenReview }: ScreenProps) {
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
  const [agentPrompt, setAgentPrompt] = useState('有哪些歌需要我确认？');
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
  const mergedTrackCount = profile?.summary.trackCount || totalTracks(appState);
  const topArtists = profile?.summary.topArtists?.length
    ? profile.summary.topArtists
    : [
      { name: '周杰伦', count: 198 },
      { name: 'Taylor Swift', count: 156 },
      { name: '林俊杰', count: 142 },
      { name: 'Ed Sheeran', count: 128 },
      { name: '告五人', count: 118 },
    ];
  const languages = profile?.summary.languages?.length
    ? profile.summary.languages
    : [
      { name: '中文', count: 68 },
      { name: '英文', count: 27 },
      { name: '日语', count: 4 },
      { name: '韩语', count: 1 },
    ];
  const recommendationsVisible = recommendations?.candidates?.length
    ? recommendations.candidates.slice(0, 4)
    : fallbackRecommendations();

  const aiSummary = useMemo(() => {
    if (agentChat?.message) return agentChat.message;
    return '根据目前的复核队列，共有 263 首歌曲需要确认，主要包括可能误匹配、版本差异和多版本冲突；2,319 首歌曲在目标平台找不到对应项，已标记为可能删除并暂停。';
  }, [agentChat]);

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
      'Agent 已基于本地工具返回结果，未写入任何音乐平台。',
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
    <section className="profile-screen" data-testid="react-ai-screen">
      <div className="profile-main">
        <div className="profile-title-row">
          <div>
            <h2>音乐库画像</h2>
            <p>基于 {formatCount(mergedTrackCount)} 首已合并数据</p>
          </div>
          <div className="profile-title-actions">
            <button className="ghost-button" data-testid="react-ai-local-profile" disabled={busy} onClick={handleLocalProfile} type="button">
              <RefreshCcw size={16} />
              刷新画像
            </button>
            <button className="secondary-button" data-testid="react-ai-model-profile" disabled={busy || !consent || !providerConfigured} onClick={handleModelProfile} type="button">
              <Sparkles size={16} />
              AI 增强
            </button>
          </div>
        </div>

        <div className="profile-metric-grid" data-testid={profile ? 'react-ai-profile-result' : undefined}>
          <ProfileMetric title="音乐口味" value="多元流行" tags={['流行', '摇滚', '电子', 'R&B', '独立']} />
          <ProfileMetric title="情绪倾向" value="治愈 63%" progress={63} helper="活力 37%" />
          <ProfileMetric title="听歌时段" value="夜晚型 72%" helper="20:00 - 02:00" />
          <ProfileMetric title="新歌偏好" value="中等" helper="近 30 天新增占比 24%" />
        </div>

        <section className="taste-panel">
          <div className="section-heading compact">
            <div>
              <h2>你最常听的</h2>
              <p>从统一曲库里提取的口味线索。</p>
            </div>
            <StatusPill tone={profile?.model?.used ? 'accent' : 'neutral'}>
              {profile?.model?.used ? 'AI 增强' : '本地分析'}
            </StatusPill>
          </div>
          <div className="taste-grid">
            <div>
              <h3>Top 艺术家</h3>
              {topArtists.slice(0, 5).map((artist, index) => (
                <ArtistRow key={artist.name} index={index} name={artist.name} count={artist.count} />
              ))}
            </div>
            <div>
              <h3>Top 语言</h3>
              {languages.slice(0, 4).map((language) => (
                <ProgressRow key={language.name} label={language.name} value={language.count} />
              ))}
            </div>
            <div>
              <h3>Top 流派</h3>
              <TagCloud tags={profile?.aiSummary?.tasteTags?.length ? profile.aiSummary.tasteTags : ['流行', '摇滚', '电子', 'R&B', '独立']} />
            </div>
            <div>
              <h3>Top 专辑</h3>
              {(profile?.summary.topAlbums?.length ? profile.summary.topAlbums : fallbackAlbums()).slice(0, 4).map((album, index) => (
                <AlbumRow key={album.name} index={index} name={album.name} count={album.count} />
              ))}
            </div>
          </div>
        </section>

        <section className="profile-sync-strip">
          <SyncPlatform platform="apple" count={platformTracks(appState, 'apple')} role="作为来源平台" />
          <ChevronArrow />
          <SyncPlatform platform="qq" count={platformTracks(appState, 'qq')} role="目标平台" />
          <ChevronArrow />
          <SyncPlatform platform="netease" count={platformTracks(appState, 'netease')} role="目标平台" />
          <div className="merge-total">
            <span>合并后总计</span>
            <strong>{formatCount(mergedTrackCount)} 首</strong>
            <small>重复歌曲 1,212</small>
          </div>
        </section>

        <section className="review-widget">
          <div className="section-heading compact">
            <div>
              <h2>需要你确认的内容</h2>
              <p>同步预览中的风险项会出现在这里。</p>
            </div>
          </div>
          <div className="mini-tabs">
            <button className="active" type="button">需要确认 <b>263</b></button>
            <button type="button">可能删除 <b>2,319</b></button>
            <button type="button">已忽略 <b>87</b></button>
          </div>
          <div className="mini-track-list">
            {fallbackReviewRows().map((row, index) => (
              <div className="mini-track-row" key={row.title}>
                <AlbumArtwork title={row.title} index={index} />
                <div>
                  <strong>{row.title}</strong>
                  <span>{row.artist}</span>
                </div>
                <span>{row.score}</span>
                <EvidenceChip tone={row.tone}>{row.evidence}</EvidenceChip>
                <button aria-label="播放预览" type="button"><Play size={15} /></button>
                <button aria-label="接受" type="button"><Check size={15} /></button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="copilot-panel">
        <div className="copilot-head">
          <div>
            <Sparkles size={18} />
            <strong>AI Copilot</strong>
            <StatusPill tone="accent">BETA</StatusPill>
          </div>
          <button className="icon-button" data-testid="react-agent-audit-refresh" disabled={busy} onClick={handleRefreshAgentAudit} title="刷新 Agent 审计" type="button">
            <RefreshCcw size={15} />
          </button>
        </div>

        <div className="copilot-chat">
          <div className="user-bubble">
            <span>{agentPrompt || '有哪些歌需要我确认？'}</span>
            <small>10:24</small>
          </div>
          <div className="assistant-bubble" data-testid={agentChat ? 'react-agent-chat-result' : undefined}>
            <Bot size={18} />
            <div className="assistant-copy">
              {agentChat ? <strong>Agent 回复</strong> : null}
              {agentChat ? <small>{toolLabel(agentChat.tool)} / {agentResultAccessLabel(agentChat)}</small> : null}
              <p>{aiSummary}</p>
            </div>
            <div className="copilot-actions">
              <button className="primary-button" onClick={onOpenReview} type="button">查看复核队列</button>
              <button type="button">找相似歌曲</button>
              <button type="button">解释删除风险</button>
            </div>
          </div>
        </div>

        <div className="similar-card">
          <h3>找相似歌曲</h3>
          <label>
            <Search size={16} />
            <input
              onChange={(event) => setSimilarTitle(event.target.value)}
              placeholder="Night Drive"
              value={similarTitle}
            />
          </label>
          <input
            className="artist-input"
            onChange={(event) => setSimilarArtist(event.target.value)}
            placeholder="Carol"
            value={similarArtist}
          />
          <div className="suggestion-chips">
            {['夜曲', 'Lemon', '不将就'].map((item) => <button key={item} onClick={() => setSimilarTitle(item)} type="button">{item}</button>)}
          </div>
          <button className="secondary-button" data-testid="react-ai-similar-search" disabled={busy} onClick={handleSimilarSearch} type="button">查找相似</button>
          {similar?.seed ? <p className="muted-line">已找到 {similar.total} 首候选。</p> : null}
        </div>

        <div className="recommend-card">
          <div className="recommend-head">
            <h3>为你推荐</h3>
            <div>
              <button data-testid="react-ai-local-recommendations" disabled={busy} onClick={handleLocalRecommendations} type="button">更多</button>
              <button data-testid="react-ai-model-recommendations" disabled={busy || !consent || !providerConfigured} onClick={handleModelRecommendations} type="button">AI 增强</button>
            </div>
          </div>
          {recommendationsVisible.map((candidate, index) => (
            <RecommendationRow candidate={candidate} index={index} key={candidate.key || `${candidate.track.title}-${index}`} />
          ))}
        </div>

        <AgentAuditCompact busy={busy} onFeedback={handleTraceFeedback} sessions={agentSessions} />

        <label className="ai-consent-row">
          <input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
          允许发送脱敏聚合证据给配置的 AI Provider
        </label>
        <div className="copilot-input">
          <MessageCircle size={16} />
          <input
            onChange={(event) => setAgentPrompt(event.target.value)}
            placeholder="有任何问题，尽管问我..."
            value={agentPrompt}
          />
          <button aria-label="发送" data-testid="react-agent-chat-send" disabled={busy || !agentPrompt.trim()} onClick={handleAgentChat} type="button">
            <Send size={17} />
          </button>
        </div>

        <button className="provider-test-button" data-testid="react-ai-provider-test" disabled={busy || !consent || !providerConfigured} onClick={handleProviderTest} type="button">
          测试 AI 连接
        </button>

        {busyLabel ? <p className="sync-status">{busyLabel}...</p> : null}
        {status ? <p className="sync-status">{status}</p> : null}
        {error ? <p className="sync-status error">{error}</p> : null}
        {providerTest ? <p className="muted-line">最近测试：{providerTest.ok ? '通过' : '失败'}</p> : null}
        {agentSessions?.total ? <p className="muted-line">最近 Agent 会话：{agentSessions.total}</p> : null}
      </aside>
    </section>
  );
}

function AgentAuditCompact({
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
    <section className="agent-audit-compact">
      <div className="recommend-head">
        <h3>Agent 工具审计</h3>
        <StatusPill tone="neutral">{traces.length} 条</StatusPill>
      </div>
      {!traces.length ? <p className="muted-line">自然语言工具调用会在这里留下本地审计摘要。</p> : null}
      {traces.map(({ sessionId, trace }) => (
        <article className="agent-trace-compact" key={`${sessionId}:${trace.id}`}>
          <div>
            <strong>{toolLabel(trace.tool)}</strong>
            <span>{agentAccessLabel(trace)} · {trace.status || 'completed'}</span>
          </div>
          <StatusPill tone={trace.mutatesProvider ? 'warning' : 'success'}>
            {trace.mutatesProvider ? '可能写入' : trace.localDraft ? '只写本地草稿' : '不写平台'}
          </StatusPill>
          <div className="agent-feedback-compact">
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
        </article>
      ))}
    </section>
  );
}

function ProfileMetric({
  title,
  value,
  tags,
  progress,
  helper,
}: {
  title: string;
  value: string;
  tags?: string[];
  progress?: number;
  helper?: string;
}) {
  return (
    <article className="profile-metric-card">
      <span>{title}</span>
      <strong>{value}</strong>
      {tags ? <TagCloud tags={tags} /> : null}
      {typeof progress === 'number' ? <ProgressBar value={progress} /> : null}
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}

function ArtistRow({ index, name, count }: { index: number; name: string; count: number }) {
  return (
    <div className="artist-row">
      <AlbumArtwork title={name} index={index} />
      <span>{name}</span>
      <strong>{formatCount(count)} 首</strong>
    </div>
  );
}

function AlbumRow({ index, name, count }: { index: number; name: string; count: number }) {
  return (
    <div className="album-row">
      <AlbumArtwork title={name} index={index + 2} />
      <div>
        <span>{name}</span>
        <small>{formatCount(count)} 首</small>
      </div>
    </div>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="progress-row">
      <span>{label}</span>
      <ProgressBar value={value} />
      <strong>{value}%</strong>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <span className="progress-bar">
      <i style={{ width: `${Math.max(6, Math.min(100, value))}%` }} />
    </span>
  );
}

function TagCloud({ tags }: { tags: string[] }) {
  return (
    <div className="tag-cloud">
      {tags.slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}
    </div>
  );
}

function SyncPlatform({ platform, count, role }: { platform: 'apple' | 'qq' | 'netease'; count: number; role: string }) {
  const label = platform === 'apple' ? 'Apple Music' : platform === 'qq' ? 'QQ 音乐' : '网易云音乐';
  return (
    <div className="sync-platform-card">
      <PlatformArtwork platform={platform} size="md" />
      <div>
        <strong>{label}</strong>
        <span>{role}</span>
        <small>{formatCount(count)} 首</small>
      </div>
    </div>
  );
}

function ChevronArrow() {
  return <ChevronRight className="chevron-arrow" size={20} />;
}

function RecommendationRow({ candidate, index }: { candidate: MusicCandidateSummary; index: number }) {
  return (
    <div className="recommend-row">
      <AlbumArtwork title={candidate.track.title} index={index} />
      <div>
        <strong>{candidate.track.title || 'Untitled'}</strong>
        <span>{candidate.track.artist || '未知歌手'}</span>
      </div>
      <button aria-label="播放" type="button"><Play size={15} /></button>
      <button aria-label="加入候选" type="button"><CirclePlus size={15} /></button>
    </div>
  );
}

function fallbackRecommendations(): MusicCandidateSummary[] {
  return ['日落大道', 'beautiful things', '若把你', '反方向的钟'].map((title, index) => ({
    key: title,
    track: { title, artist: ['告五人', 'Benson Boone', 'Kirsty 刘瑾睿', '周杰伦'][index] },
    platforms: [],
    platformLabels: [],
    reasons: [],
    aiEvidenceRefs: [],
  }));
}

function fallbackAlbums() {
  return [
    { name: '最伟大的作品', count: 42 },
    { name: 'folklore', count: 31 },
    { name: '自传', count: 28 },
    { name: '= (Equals)', count: 24 },
  ];
}

function fallbackReviewRows() {
  return [
    { title: '说好的幸福呢', artist: '周杰伦 · 魔杰座', score: '相似 78%', evidence: '可能误匹配', tone: 'warning' as const },
    { title: 'Shape of You', artist: 'Ed Sheeran · ÷', score: '相似 92%', evidence: '高置信匹配', tone: 'success' as const },
    { title: '夜曲', artist: '周杰伦 · 十一月的萧邦', score: '相似 65%', evidence: '需要确认', tone: 'warning' as const },
  ];
}

function platformTracks(appState: AppStateSummary | null, platform: 'apple' | 'qq' | 'netease'): number {
  return appState?.platforms.find((item) => item.key === platform)?.tracks || 0;
}

function totalTracks(appState: AppStateSummary | null): number {
  return appState?.platforms.reduce((sum, platform) => sum + platform.tracks, 0) || 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '操作失败');
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
  if (label === 'useful') return '有帮助';
  if (label === 'not_enough_evidence') return '证据不足';
  if (label === 'incorrect') return '判断不对';
  return '未反馈';
}
