import path from 'node:path';
import { createRequire } from 'node:module';
import {
  buildAiProviderState,
  requestAiJson,
  resolveAiProviderConfig,
  sanitizeAiProviderConfig,
  testAiProviderJson,
} from './ai-provider.js';
import { buildReviewBatch, requestDeepSeekReview } from './ai-review.js';
import { buildAppleSnapshotFromTracks, loadApplePlaylistUrl, parseAppleText } from './apple.js';
import { buildMatchEvidence, compactTrackForAi } from './evidence.js';
import { enrichAppleSnapshotWithMusicBrainz } from './metadata/musicbrainz.js';
import { compareAppleToPlatform } from './match.js';
import { buildMirrorRunIdentity, executeMirrorSyncPlan } from './mirror-apply.js';
import { requestDeepSeekMirrorReview } from './mirror-ai.js';
import { resolveMirrorAddOperations } from './mirror-resolve.js';
import {
  buildMirrorSyncPlan,
  normalizeMirrorReviewDecisionAction,
  summarizeMirrorConvergence,
  summarizeMirrorOperations,
} from './mirror-sync.js';
import {
  appendRecommendationShortlist,
  applyRecommendationAiSummary,
  buildRecommendationAiEvidence,
  buildMusicProfile,
  buildMusicProfileAiEvidence,
  buildRecommendations,
  deterministicMusicProfileSummary,
  normalizeRecommendationAiSummary,
  findSimilarTracks,
  normalizeMusicProfileAiSummary,
} from './music-intelligence.js';
import { normalizeText, normalizeTrack } from './normalize.js';
import { buildMarkdownReport, compactComparison } from './report.js';
import { buildWritePlan, decorateWritePlan, executeAppleWrite, executeNeteaseWrite, executeQQWrite, summarizePlanItems } from './sync.js';
import { requestDeepSeekSyncReview } from './sync-ai.js';
import {
  getLiveValidationEvidence,
  LIVE_VALIDATION_CONFIRM,
  runLiveProviderValidation,
  summarizeLiveValidationEvidence,
} from './live-validation.js';
import {
  buildSyncBaseline,
  buildSyncPolicyPlan,
  diffSnapshotsAgainstBaseline,
  listSyncPolicies,
  normalizeTombstoneState,
  summarizePolicyOperations,
  upsertTombstoneDecision,
} from './sync-policy.js';
import {
  validateAgentSessionsState,
  validateAiProviderState,
  validateMusicProfileState,
  validateRecommendationShortlistsState,
  validateSyncBaselineState,
  validateSyncPolicyState,
  validateSyncPreviewState,
  validateSyncRunLogState,
  validateSyncTombstoneState,
} from './state-schema.js';
import {
  assertAgentToolAllowed,
  listAgentTools,
  sanitizeAgentToolResult,
  selectAgentToolForMessage,
  summarizeAgentToolArguments,
  summarizeAgentToolResult,
} from './agent-tools.js';
import { buildUnifiedLibrary, buildUnifiedMarkdown } from './unified.js';
import { addNeteaseTracksToPlaylist, removeNeteaseTracksFromPlaylist, searchNeteaseTracks } from './providers/netease.js';
import { addQQTracksToPlaylist, removeQQTracksFromPlaylist, searchQQTracks } from './providers/qq.js';
import { getAppleCatalogCacheStats } from './providers/apple.js';
import {
  DATA_DIR,
  REPORT_DIR,
  ensureDirs,
  formatErrorMessage,
  normalizeCookie,
  readJsonIfExists,
  readTextIfExists,
  writeJson,
  writeText,
} from './utils.js';

const require = createRequire(import.meta.url);
const PLATFORMS = ['apple', 'qq', 'netease'];
const WRITABLE_PLATFORMS = ['apple', 'qq', 'netease'];

export const FILES = {
  appleJson: path.join(DATA_DIR, 'apple.json'),
  qqJson: path.join(DATA_DIR, 'qq.json'),
  neteaseJson: path.join(DATA_DIR, 'netease.json'),
  appleCookie: path.join(DATA_DIR, 'apple.cookie'),
  qqCookie: path.join(DATA_DIR, 'qq.cookie'),
  neteaseCookie: path.join(DATA_DIR, 'netease.cookie'),
  metadataCache: path.join(DATA_DIR, 'metadata-cache.json'),
  reportJson: path.join(REPORT_DIR, 'matches.json'),
  reportMd: path.join(REPORT_DIR, 'missing.md'),
  unifiedJson: path.join(REPORT_DIR, 'unified-library.json'),
  unifiedMd: path.join(REPORT_DIR, 'unified-library.md'),
  unifiedDecisions: path.join(DATA_DIR, 'unified-decisions.json'),
  aiSuggestions: path.join(DATA_DIR, 'ai-suggestions.json'),
  writePlan: path.join(DATA_DIR, 'write-plan-netease.json'),
  // Legacy filename kept so existing local state keeps working.
  writePlanNetease: path.join(DATA_DIR, 'write-plan-netease.json'),
  writeRunLog: path.join(DATA_DIR, 'write-runs.json'),
  mirrorPlan: path.join(DATA_DIR, 'mirror-plan.json'),
  mirrorRunLog: path.join(DATA_DIR, 'mirror-runs.json'),
  mirrorDecisions: path.join(DATA_DIR, 'mirror-decisions.json'),
  mirrorAiSuggestions: path.join(DATA_DIR, 'mirror-ai-suggestions.json'),
  syncPolicy: path.join(DATA_DIR, 'sync-policy.json'),
  syncBaseline: path.join(DATA_DIR, 'sync-baseline.json'),
  syncPreview: path.join(DATA_DIR, 'sync-preview.json'),
  syncTombstones: path.join(DATA_DIR, 'sync-tombstones.json'),
  syncRuns: path.join(DATA_DIR, 'sync-runs.json'),
  aiProviderState: path.join(DATA_DIR, 'ai-provider-state.json'),
  musicProfile: path.join(DATA_DIR, 'music-profile.json'),
  recommendationShortlists: path.join(DATA_DIR, 'recommendation-shortlists.json'),
  agentSessions: path.join(DATA_DIR, 'agent-sessions.json'),
  syncDecisions: path.join(DATA_DIR, 'sync-decisions.json'),
  syncAiSuggestions: path.join(DATA_DIR, 'sync-ai-suggestions.json'),
  syncErrors: path.join(DATA_DIR, 'sync-errors.json'),
  writePlanBackupsDir: path.join(DATA_DIR, 'write-plan-backups'),
};

export async function importAppleContent(content, source = 'web-upload') {
  await ensureDirs();
  const apple = parseAppleText(content, source);
  await writeJson(FILES.appleJson, apple);
  return apple;
}

export async function importAppleUrl(url, options = {}) {
  await ensureDirs();
  const appleCookie = normalizeCookie(options.appleCookie) || await readTextIfExists(FILES.appleCookie);
  const apple = await loadApplePlaylistUrl(url, { cookie: appleCookie });
  await writeJson(FILES.appleJson, apple);
  return apple;
}

export async function importAppleRows(rows, source = 'apple-browser') {
  await ensureDirs();
  const apple = buildAppleSnapshotFromTracks(rows, source);
  if (!apple.tracks.length) {
    throw new Error('Apple 页面抓取结果为空。');
  }
  await writeJson(FILES.appleJson, apple);
  return apple;
}

export async function saveCookies({ appleCookie, qqCookie, neteaseCookie }) {
  await ensureDirs();
  if (appleCookie !== undefined) {
    await writeText(FILES.appleCookie, normalizeCookie(appleCookie));
  }
  if (qqCookie !== undefined) {
    await writeText(FILES.qqCookie, normalizeCookie(qqCookie));
  }
  if (neteaseCookie !== undefined) {
    await writeText(FILES.neteaseCookie, normalizeCookie(neteaseCookie));
  }
  return getState();
}

export async function createNeteaseQrLogin() {
  const netease = require('@neteasecloudmusicapienhanced/api');
  const keyResult = await netease.login_qr_key({});
  const key = keyResult.body?.data?.unikey;
  if (!key) throw new Error('网易云二维码 key 获取失败');

  const qrResult = await netease.login_qr_create({ key, qrimg: true });
  return {
    key,
    qrurl: qrResult.body?.data?.qrurl || '',
    qrimg: qrResult.body?.data?.qrimg || '',
  };
}

export async function checkNeteaseQrLogin(key) {
  if (!key) throw new Error('缺少网易云二维码 key');
  const netease = require('@neteasecloudmusicapienhanced/api');
  const result = await netease.login_qr_check({ key });
  const code = Number(result.body?.code || 0);
  const message = result.body?.message || qrStatusText(code);
  const cookie = result.body?.cookie || '';

  if (code === 803 && cookie) {
    await saveCookies({ neteaseCookie: cookie });
  }

  return {
    code,
    message,
    done: code === 803,
    waiting: code === 801 || code === 802,
    state: code === 803 ? await getState() : null,
  };
}

function qrStatusText(code) {
  if (code === 801) return '等待扫码';
  if (code === 802) return '已扫码，等待确认';
  if (code === 803) return '登录成功';
  if (code === 800) return '二维码已过期';
  return '未知状态';
}

export async function fetchPlatformSnapshots(options = {}) {
  await ensureDirs();
  const qqCookie = await readTextIfExists(FILES.qqCookie);
  const neteaseCookie = await readTextIfExists(FILES.neteaseCookie);

  const result = {};
  if (options.qq !== false) {
    result.qq = qqCookie
      ? await fetchQQ(qqCookie, {
        uin: options.qqUin,
        playlistId: options.qqPlaylistId,
      })
      : skippedSnapshot('qq', '未提供 QQ 音乐 cookie');
    await writeJson(FILES.qqJson, result.qq);
  }

  if (options.netease !== false) {
    result.netease = neteaseCookie
      ? await fetchNetease(neteaseCookie, {
        uid: options.neteaseUid,
        playlistId: options.neteasePlaylistId,
      })
      : skippedSnapshot('netease', '未提供网易云音乐 cookie');
    await writeJson(FILES.neteaseJson, result.netease);
  }

  return result;
}

export async function enrichAppleMetadata(options = {}) {
  await ensureDirs();
  const apple = await readJsonIfExists(FILES.appleJson);
  if (!apple) throw new Error('缺少 Apple 快照，请先抓取 Apple Music。');
  const enriched = await enrichAppleSnapshotWithMusicBrainz(prepareSnapshot(apple), {
    limit: options.limit,
    refresh: options.refresh,
  });
  await writeJson(FILES.appleJson, enriched.snapshot);
  return enriched;
}

export async function generateMatchReport(options = {}) {
  await ensureDirs();
  const apple = prepareSnapshot(await readJsonIfExists(FILES.appleJson));
  if (!apple) throw new Error('缺少 Apple 快照，请先导入 Apple Music 文件。');

  const qq = prepareSnapshot(await readJsonIfExists(FILES.qqJson));
  const netease = prepareSnapshot(await readJsonIfExists(FILES.neteaseJson));
  const result = {
    generatedAt: new Date().toISOString(),
    thresholds: {
      match: Number(options.threshold ?? 0.82),
      review: Number(options.reviewThreshold ?? 0.68),
    },
    platforms: {},
  };

  if (qq && !qq.skipped) {
    result.platforms.qq = compactComparison(compareAppleToPlatform(apple.tracks, qq.tracks, result.thresholds));
  }
  if (netease && !netease.skipped) {
    result.platforms.netease = compactComparison(compareAppleToPlatform(apple.tracks, netease.tracks, result.thresholds));
  }
  if (!Object.keys(result.platforms).length) {
    throw new Error('缺少可比较的平台快照，请先拉取 QQ/网易云。');
  }

  await writeJson(FILES.reportJson, result);
  await writeText(FILES.reportMd, buildMarkdownReport(result));
  return result;
}

export async function generateUnifiedLibrary(options = {}) {
  await ensureDirs();
  const apple = prepareSnapshot(await readJsonIfExists(FILES.appleJson));
  const qq = prepareSnapshot(await readJsonIfExists(FILES.qqJson));
  const netease = prepareSnapshot(await readJsonIfExists(FILES.neteaseJson));
  const result = buildUnifiedLibrary({ apple, qq, netease }, {
    threshold: options.threshold,
    reviewThreshold: options.reviewThreshold,
  });
  await writeJson(FILES.unifiedJson, result);
  await writeText(FILES.unifiedMd, buildUnifiedMarkdown(result));
  await migrateDecisionStateForUnified(result);
  return result;
}

export async function getUnifiedItems(options = {}) {
  await ensureDirs();
  const unified = await readJsonIfExists(FILES.unifiedJson);
  if (!unified) throw new Error('缺少统一曲库，请先生成统一曲库。');

  const decisions = await readDecisionState();
  const suggestions = await readAiSuggestionState();
  const filter = options.filter || 'all-gaps';
  const query = normalizeText(options.query || '');
  const offset = Math.max(0, Number(options.offset || 0));
  const limit = Math.min(100, Math.max(1, Number(options.limit || 40)));
  const clusterItems = buildClusterItems(unified.clusters || [], decisions, suggestions);
  const candidateItems = buildCandidateItems(unified.reviewCandidates || [], decisions, suggestions);
  const source = reviewFilterUsesCandidates(filter)
    ? filter === 'review-candidates'
      ? candidateItems
      : [...clusterItems, ...candidateItems]
    : clusterItems;
  const filtered = source.filter((item) => matchesUnifiedFilter(item, filter) && matchesUnifiedQuery(item, query));
  const items = filtered.slice(offset, offset + limit);

  return {
    generatedAt: unified.generatedAt,
    summary: unified.summary,
    sourceCounts: unified.sourceCounts,
    decisions: summarizeDecisions(decisions),
    aiSuggestions: summarizeAiSuggestions(suggestions),
    filter,
    query: options.query || '',
    total: filtered.length,
    offset,
    limit,
    hasMore: offset + limit < filtered.length,
    items,
  };
}

export async function getAiReviewItems(options = {}) {
  await ensureDirs();
  const unified = await readJsonIfExists(FILES.unifiedJson);
  if (!unified) throw new Error('缺少统一曲库，请先生成统一曲库。');

  const decisions = await readDecisionState();
  const suggestions = await readAiSuggestionState();
  const filter = options.filter || 'all-review';
  const query = normalizeText(options.query || '');
  const offset = Math.max(0, Number(options.offset || 0));
  const limit = Math.min(50, Math.max(1, Number(options.limit || 12)));
  const includeSuggested = Boolean(options.refresh || options.includeSuggested);
  const clusters = buildClusterItems(unified.clusters || [], decisions, suggestions)
    .filter((item) => item.needsReview);
  const candidates = buildCandidateItems(unified.reviewCandidates || [], decisions, suggestions);
  const source = filter === 'conflicts'
    ? clusters
    : filter === 'review-candidates'
      ? candidates
      : [...clusters, ...candidates];
  const filtered = source
    .filter((item) => isPendingReviewItem(item))
    .filter((item) => matchesUnifiedQuery(item, query))
    .filter((item) => includeSuggested || !item.aiSuggestion);
  const items = filtered.slice(offset, offset + limit);

  return {
    filter,
    query: options.query || '',
    total: filtered.length,
    offset,
    limit,
    remaining: Math.max(0, filtered.length - offset - items.length),
    suggestions: summarizeAiSuggestions(suggestions),
    items,
  };
}

export async function generateAiSuggestions(options = {}) {
  await ensureDirs();
  const filter = options.filter || 'all-review';
  if (!['all-review', 'review-candidates', 'conflicts'].includes(filter)) {
    throw new Error('AI 建议目前只处理“全部待判断”“低置信”和“版本/冲突”。');
  }

  const limit = Math.min(50, Math.max(1, Number(options.limit || 12)));
  const itemsPayload = await getAiReviewItems({
    filter,
    query: options.query || '',
    offset: options.offset || 0,
    limit,
    refresh: options.refresh,
  });
  if (!itemsPayload.items.length) throw new Error('当前筛选没有可分析条目。');

  const batch = buildReviewBatch(itemsPayload.items);
  if (options.dryRun) {
    return {
      dryRun: true,
      model: options.model || 'deepseek-v4-pro',
      batch,
      decisions: [],
      total: itemsPayload.total,
      remaining: itemsPayload.remaining,
      suggestions: await readAiSuggestionState(),
    };
  }

  const aiProvider = await resolveWorkflowAiProvider(options);
  const result = await requestDeepSeekReview({
    apiKey: aiProvider.apiKey,
    model: aiProvider.model,
    items: itemsPayload.items,
    thinking: options.thinking !== false,
    baseUrl: aiProvider.baseUrl,
  });
  const suggestions = await readAiSuggestionState();
  const now = new Date().toISOString();
  for (const decision of result.decisions) {
    const bucket = decision.itemType === 'low_confidence_candidate'
      ? suggestions.candidates
      : suggestions.clusters;
    bucket[decision.itemId] = {
      ...decision,
      batchId: result.batchId,
      model: result.model,
      updatedAt: now,
    };
  }
  suggestions.updatedAt = now;
  suggestions.batches.unshift({
    batchId: result.batchId,
    model: result.model,
    reviewedAt: result.reviewedAt,
    itemCount: itemsPayload.items.length,
    decisionCount: result.decisions.length,
    usage: result.usage,
  });
  suggestions.batches = suggestions.batches.slice(0, 50);
  await writeJson(FILES.aiSuggestions, suggestions);

  return {
    dryRun: false,
    batchId: result.batchId,
    model: result.model,
    reviewedAt: result.reviewedAt,
    itemCount: itemsPayload.items.length,
    total: itemsPayload.total,
    remaining: Math.max(0, itemsPayload.total - itemsPayload.items.length),
    decisions: result.decisions,
    suggestions,
  };
}

export async function saveUnifiedDecision(input = {}) {
  await ensureDirs();
  const decisions = await readDecisionState();
  const now = new Date().toISOString();
  const type = String(input.type || 'cluster');

  if (type === 'candidate') {
    const key = String(input.key || '').trim();
    if (!key) throw new Error('缺少候选项 ID。');
    const action = normalizeCandidateAction(input.action);
    decisions.candidates[key] = {
      key,
      action,
      manualReviewedAt: now,
      updatedAt: now,
    };
  } else if (type === 'cluster-review') {
    const id = String(input.id || '').trim();
    if (!id) throw new Error('缺少条目 ID。');
    const action = normalizeClusterReviewAction(input.action);
    const current = {
      ...(decisions.clusters[id] || {}),
      id,
      reviewAction: action,
      manualReviewedAt: now,
      updatedAt: now,
    };
    delete current.aiAppliedAt;
    if (action === 'pick') {
      current.selectedTrack = String(input.selectedTrack || '').trim();
      if (!current.selectedTrack) throw new Error('缺少要保留的版本。');
    } else {
      delete current.selectedTrack;
    }
    decisions.clusters[id] = current;
  } else {
    const id = String(input.id || '').trim();
    const target = String(input.target || '').trim();
    if (!id) throw new Error('缺少条目 ID。');
    if (!['apple', 'qq', 'netease'].includes(target)) throw new Error('缺少有效目标平台。');
    const current = decisions.clusters[id] || { id, targets: {} };
    current.targets = current.targets || {};
    current.targets[target] = normalizeTargetAction(input.action);
    current.updatedAt = now;
    decisions.clusters[id] = current;
  }

  decisions.updatedAt = now;
  await writeJson(FILES.unifiedDecisions, decisions);
  return {
    decisions: summarizeDecisions(decisions),
    item: input,
  };
}

export async function applyAiSuggestions(options = {}) {
  await ensureDirs();
  const suggestions = await readAiSuggestionState();
  const decisions = await readDecisionState();
  const threshold = normalizeApplyThreshold(options.threshold);
  const overwrite = Boolean(options.overwrite);
  const dryRun = Boolean(options.dryRun);
  const now = new Date().toISOString();
  const stats = {
    threshold,
    overwrite,
    dryRun,
    totalSuggestions: 0,
    eligible: 0,
    applied: 0,
    skippedLowConfidence: 0,
    skippedNeedsHuman: 0,
    skippedExisting: 0,
    skippedUnsupported: 0,
    clusters: { same: 0, split: 0 },
    candidates: { merge: 0, separate: 0 },
  };

  for (const [id, suggestion] of Object.entries(suggestions.clusters || {})) {
    applyOneAiSuggestion({
      type: 'cluster',
      key: id,
      suggestion,
      decisions,
      threshold,
      overwrite,
      dryRun,
      now,
      stats,
    });
  }

  for (const [key, suggestion] of Object.entries(suggestions.candidates || {})) {
    applyOneAiSuggestion({
      type: 'candidate',
      key,
      suggestion,
      decisions,
      threshold,
      overwrite,
      dryRun,
      now,
      stats,
    });
  }

  if (!dryRun && stats.applied > 0) {
    decisions.updatedAt = now;
    await writeJson(FILES.unifiedDecisions, decisions);
  }

  return {
    ...stats,
    decisions: summarizeDecisions(decisions),
  };
}

export async function generateWritePlan(options = {}) {
  await ensureDirs();
  const target = String(options.target || 'netease').trim();
  if (!['netease', 'qq', 'apple'].includes(target)) {
    throw new Error('当前只支持生成网易云、QQ 音乐或 Apple Music 写入计划');
  }
  const unified = await readJsonIfExists(FILES.unifiedJson);
  const decisions = await readDecisionState();
  const syncDecisions = await readSyncDecisionState();
  const aiSuggestions = await readSyncAiSuggestionState();
  const cookie = target === 'apple'
    ? ''
    : target === 'qq'
    ? await readTextIfExists(FILES.qqCookie)
    : await readTextIfExists(FILES.neteaseCookie);
  const previousPlan = await readJsonIfExists(FILES.writePlan);
  const targetSnapshot = prepareSnapshot(await readJsonIfExists(targetSnapshotFile(target)));
  const rawPlan = await buildWritePlan({
    unified,
    decisions,
    syncDecisions,
    aiSuggestions,
    target,
    resolve: options.resolve,
    limit: options.limit,
    offset: options.offset,
    minScore: options.minScore,
    reviewScore: options.reviewScore,
    searchLimit: options.searchLimit,
    cookie,
    previousPlan,
    targetSnapshot,
    onProgress: options.onProgress,
  });
  const mergedPlan = mergeWritePlanWithPrevious(rawPlan, previousPlan);
  const plan = choosePlanForStorage(mergedPlan, previousPlan);
  await backupWritePlan(previousPlan, 'generate-before-write');
  await writeJson(FILES.writePlan, plan);
  await persistWritePlanErrors(plan, 'generate');
  return plan;
}

export async function generateMirrorSyncPlan(options = {}) {
  await ensureDirs();
  const plan = await buildCurrentMirrorPlan(options);
  await writeJson(FILES.mirrorPlan, plan);
  return plan;
}

export async function checkMirrorConvergence(options = {}) {
  await ensureDirs();
  const currentPlan = await readJsonIfExists(FILES.mirrorPlan);
  if (!currentPlan) throw productHttpError(409, '缺少 Apple 可信源镜像计划，请先生成 mirror plan。');
  const target = normalizeMirrorTarget(currentPlan.target?.platform || options.target || 'qq');
  const refreshTarget = Boolean(options.refreshTarget);
  let snapshots = null;
  if (refreshTarget) {
    const cookie = target === 'qq'
      ? await readTextIfExists(FILES.qqCookie)
      : await readTextIfExists(FILES.neteaseCookie);
    if (!cookie?.trim()) throw productHttpError(409, `缺少 ${targetLabel(target)} cookie，不能刷新目标快照证明收敛。`);
    snapshots = await fetchPlatformSnapshots({
      qq: target === 'qq',
      netease: target === 'netease',
      qqPlaylistId: target === 'qq' ? options.playlistId || currentPlan.target?.playlistId : undefined,
      neteasePlaylistId: target === 'netease' ? options.playlistId || currentPlan.target?.playlistId : undefined,
    });
  }

  const plan = await buildCurrentMirrorPlan({
    target,
    threshold: currentPlan.thresholds?.match,
    reviewThreshold: currentPlan.thresholds?.review,
  });
  const convergence = summarizeMirrorConvergence(plan, {
    previousPlan: currentPlan,
    refreshedTarget: refreshTarget,
  });
  const checkedPlan = {
    ...plan,
    convergence,
  };
  if (options.persist !== false) {
    await writeJson(FILES.mirrorPlan, checkedPlan);
  }
  return {
    convergence,
    plan: checkedPlan,
    snapshots: snapshots ? summarizeSnapshotsForResult(snapshots) : null,
    persisted: options.persist !== false,
  };
}

export async function getProductAppState() {
  await ensureDirs();
  const [state, syncPolicy, syncPreview, syncTombstones, syncBaseline, aiProvider, liveValidation] = await Promise.all([
    getState(),
    readSyncPolicyState(),
    readJsonIfExists(FILES.syncPreview),
    readSyncTombstoneState(),
    readJsonIfExists(FILES.syncBaseline),
    getProductAiProviderState(),
    getProductLiveValidationState(),
  ]);

  return {
    platforms: ['apple', 'qq', 'netease'].map((platform) => productPlatformState(platform, state)),
    syncMode: productSyncModeState(syncPolicy),
    latestPreview: summarizeProductPreview(syncPreview),
    baseline: summarizeProductBaseline(syncBaseline),
    deletionConfirmations: summarizeProductTombstones(syncTombstones),
    syncRuns: summarizeProductSyncRuns(state.sync?.policyRuns),
    lastSyncRun: summarizeProductSyncRun(state.sync?.lastPolicyRun),
    nextAction: productNextAction(syncPreview, syncPolicy),
    ai: {
      configured: Boolean(aiProvider.configured || state.ai?.hasEnvKey),
      model: aiProvider.model || state.ai?.model || '',
      provider: aiProvider,
    },
    validation: {
      live: liveValidation,
    },
  };
}

export async function getProductLiveValidationState(options = {}) {
  await ensureDirs();
  return getLiveValidationEvidence(options);
}

export async function runProductLiveValidation(options = {}, dependencies = {}) {
  await (dependencies.ensureDirs || ensureDirs)();
  const target = normalizeLiveValidationProductTarget(options.target);
  const confirm = String(options.confirm || '').trim();
  if (confirm !== LIVE_VALIDATION_CONFIRM) {
    throw productHttpError(400, `Live validation mutates a real ${targetLabel(target)} account. Type ${LIVE_VALIDATION_CONFIRM} to confirm a disposable playlist check.`);
  }

  const query = String(options.query || '').trim();
  if (!query) {
    throw productHttpError(400, 'Live validation requires a search query for a track that can be temporarily added and removed.');
  }

  const env = {
    MUSIC_LIKES_SYNC_LIVE_VALIDATE: '1',
    MUSIC_LIKES_SYNC_LIVE_CONFIRM: LIVE_VALIDATION_CONFIRM,
    MUSIC_LIKES_SYNC_LIVE_TARGET: target,
    MUSIC_LIKES_SYNC_LIVE_QUERY: query,
  };
  const playlistId = String(options.playlistId || '').trim();
  const playlistName = String(options.playlistName || '').trim();
  if (playlistId) env.MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID = playlistId;
  if (playlistName) env.MUSIC_LIKES_SYNC_LIVE_PLAYLIST_NAME = playlistName;

  let report;
  try {
    report = await (dependencies.runLiveProviderValidation || runLiveProviderValidation)({ env });
  } catch (error) {
    throw productHttpError(error.httpStatus || 409, formatErrorMessage(error));
  }
  if (report?.skipped) {
    throw productHttpError(409, report.reason || 'Live validation did not run.');
  }

  const reportFile = `reports/live-validation-${target}.json`;
  const reportPath = path.join(dependencies.reportDir || REPORT_DIR, `live-validation-${target}.json`);
  const writeReport = options.writeReport !== false;
  if (writeReport) {
    await (dependencies.writeJson || writeJson)(reportPath, { ...report });
  }

  const validation = summarizeLiveValidationEvidence(target, report, {
    packageInfo: report.tool || {},
    now: dependencies.now || new Date(),
    reportFile,
  });
  return {
    target,
    ok: validation.ok,
    status: validation.status,
    message: validation.message,
    reportWritten: writeReport,
    validation,
  };
}

export async function getProductAiProviderState() {
  await ensureDirs();
  const state = await readAiProviderState();
  const resolved = resolveAiProviderConfig(state);
  return {
    ...sanitizeAiProviderConfig(resolved),
    configured: Boolean(resolved.hasApiKey),
    stateExists: Boolean(state.updatedAt),
    updatedAt: state.updatedAt || '',
  };
}

export async function saveProductAiProviderState(options = {}) {
  await ensureDirs();
  const state = buildAiProviderState(options);
  assertValidState(validateAiProviderState(state), 'ai-provider-state');
  await writeJson(FILES.aiProviderState, state);
  return getProductAiProviderState();
}

export async function testProductAiProvider(options = {}) {
  await ensureDirs();
  if (!options.consent) {
    throw productHttpError(400, 'Testing the AI provider requires consent because it sends a small health-check prompt to the configured provider.');
  }
  const aiProvider = await resolveWorkflowAiProvider(options);
  if (!aiProvider.hasApiKey) {
    throw productHttpError(400, 'Missing AI provider API key. Set DEEPSEEK_API_KEY or pass an explicit local key for this test.');
  }
  const result = await testAiProviderJson({
    providerConfig: aiProvider,
    fetchImpl: options.fetchImpl,
  });
  return {
    ok: Boolean(result.ok),
    checkedAt: result.checkedAt,
    provider: sanitizeAiProviderConfig(aiProvider),
    model: result.model,
    response: result.response,
    usage: result.usage,
  };
}

export function getProductSyncModes() {
  return {
    modes: listSyncPolicies().map((policy) => ({
      id: policy.id,
      label: productPolicyLabel(policy.id),
      description: policy.description,
      recommended: policy.id === 'canonical_mirror',
      risk: productPolicyRisk(policy.id),
      writes: Boolean(policy.writes),
      destructive: Boolean(policy.destructive),
      deletionRequiresConfirmation: policy.id !== 'read_only_analysis',
    })),
  };
}

export async function generateProductSyncPreview(options = {}) {
  await ensureDirs();
  const policy = String(options.mode || options.policy || 'canonical_mirror').trim();
  const source = String(options.source || 'apple').trim();
  const targetList = normalizeProductTargets(options.targets || options.target || ['qq']);
  const participants = normalizeProductParticipants(options.platforms || [source, ...targetList]);
  const snapshots = await readProductSnapshots();
  const baseline = await readJsonIfExists(FILES.syncBaseline);
  const tombstones = await readSyncTombstoneState();
  const generatedAt = new Date().toISOString();
  const policyState = {
    version: 1,
    updatedAt: generatedAt,
    policy,
    participants,
    source: { platform: source },
    targets: targetList,
    deletionPolicy: options.deletionPolicy || 'ask',
  };
  assertValidState(validateSyncPolicyState(policyState), 'sync-policy');

  const plan = buildSyncPolicyPlan({
    policy,
    source,
    targets: targetList,
    platforms: participants,
    snapshots,
    baseline,
    tombstones,
    threshold: options.threshold || options.minScore,
    reviewThreshold: options.reviewThreshold,
    generatedAt,
  });
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');

  await writeJson(FILES.syncPolicy, policyState);
  await writeJson(FILES.syncPreview, plan);

  let compatibilityMirrorPlan = null;
  if (policy === 'canonical_mirror' && source === 'apple' && targetList.length >= 1) {
    compatibilityMirrorPlan = await generateMirrorSyncPlan({
      target: targetList[0],
      threshold: options.threshold || options.minScore,
      reviewThreshold: options.reviewThreshold,
    });
  }

  return {
    previewId: plan.previewId || productPreviewId(plan),
    generatedAt: plan.generatedAt,
    mode: plan.policy,
    counts: productPreviewCounts(plan),
    blocked: productPreviewBlocked(plan),
    plan,
    compatibility: compatibilityMirrorPlan ? {
      mirrorTarget: compatibilityMirrorPlan.target?.platform || '',
      mirrorSummary: compatibilityMirrorPlan.summary || {},
    } : null,
  };
}

export async function getProductSyncBaseline(options = {}) {
  await ensureDirs();
  const [baseline, policyState, tombstones] = await Promise.all([
    readJsonIfExists(FILES.syncBaseline),
    readSyncPolicyState(),
    readSyncTombstoneState(),
  ]);
  if (baseline) assertValidState(validateSyncBaselineState(baseline), 'sync-baseline');
  const snapshots = await readProductSnapshots();
  const participants = normalizeProductParticipants(options.platforms || policyState.participants || ['apple', 'qq', 'netease']);
  const diff = baseline
    ? diffSnapshotsAgainstBaseline(snapshots, baseline, { platforms: participants })
    : null;
  return {
    baseline: summarizeProductBaseline(baseline),
    diff: summarizeProductBaselineDiff(diff),
    participants,
    tombstones: summarizeProductTombstones(tombstones),
  };
}

export async function saveProductSyncBaseline(options = {}) {
  await ensureDirs();
  const policyState = await readSyncPolicyState();
  const participants = normalizeProductParticipants(options.platforms || policyState.participants || ['apple', 'qq', 'netease']);
  const convergence = await assertProductBaselineConvergenceReady(options);
  const snapshots = await readProductSnapshots();
  assertProductSnapshotsAvailable(snapshots, participants);
  const savedAt = new Date().toISOString();
  const baseline = buildSyncBaseline({
    snapshots,
    platforms: participants,
    policy: options.policy || policyState.policy || 'union_convergence',
    source: options.source || 'product-baseline-confirmation',
    savedAt,
  });
  assertValidState(validateSyncBaselineState(baseline), 'sync-baseline');
  await writeJson(FILES.syncBaseline, baseline);
  const activation = options.activateManaged === true
    ? await activateManagedProductSync({
      participants,
      targets: options.targets,
      updatedAt: savedAt,
      source: options.source || 'product-baseline-confirmation',
    })
    : null;
  const result = await getProductSyncBaseline({ platforms: participants });
  return {
    ...result,
    savedFromPreviewId: convergence?.previewId || '',
    convergence: convergence || { exists: false },
    activatedPolicy: activation?.policy || null,
    preview: activation?.preview || null,
  };
}

async function assertProductBaselineConvergenceReady(options = {}) {
  if (options.requireConverged !== true) return null;
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) {
    throw productHttpError(409, '保存同步基线前需要先运行同步检查并确认已一致。');
  }
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const currentPreviewId = productPreviewId(plan);
  const requestedPreviewId = String(options.previewId || '').trim();
  if (requestedPreviewId && requestedPreviewId !== currentPreviewId) {
    throw productHttpError(409, '同步预览已经变化，请重新检查一致性后再保存基线。');
  }
  const convergence = summarizeProductPreviewConvergence(plan.convergence);
  if (!convergence.exists || convergence.skipped) {
    throw productHttpError(409, '保存同步基线前需要先完成一次真实一致性检查。');
  }
  if (!convergence.converged || convergence.status !== 'converged') {
    const open = Number(convergence.openOperations || 0);
    throw productHttpError(409, open
      ? `当前仍有 ${open} 个待处理项，不能保存为同步基线。`
      : '当前同步预览尚未收敛，不能保存为同步基线。');
  }
  return convergence;
}

async function activateManagedProductSync(options = {}) {
  const requestedParticipants = normalizeProductParticipants(options.participants || ['apple', 'qq', 'netease']);
  const participantTargets = requestedParticipants.filter((platform) => platform === 'qq' || platform === 'netease');
  const targets = normalizeProductTargets(options.targets || participantTargets);
  const participants = normalizeProductParticipants(['apple', ...requestedParticipants, ...targets]);
  const missingTargets = targets.filter((target) => !participants.includes(target));
  if (missingTargets.length) {
    throw productHttpError(400, `启用后续自动同步前需要把目标平台加入参与平台：${missingTargets.map(targetLabel).join('、')}。`);
  }
  const updatedAt = options.updatedAt || new Date().toISOString();
  const policyState = {
    version: 1,
    updatedAt,
    policy: 'managed_bidirectional',
    participants,
    source: { platform: 'apple' },
    targets,
    deletionPolicy: 'ask',
    activatedFrom: String(options.source || 'product-baseline-confirmation').slice(0, 80),
  };
  assertValidState(validateSyncPolicyState(policyState), 'sync-policy');
  await writeJson(FILES.syncPolicy, policyState);
  const refreshed = await refreshProductPreviewFromPolicy({ policyState });
  const convergence = summarizeProductPolicyConvergence(refreshed, {
    refreshedAt: updatedAt,
    refreshedTargets: [],
    snapshots: {},
  });
  await persistProductPreviewConvergence(convergence);
  return {
    policy: productSyncModeState(policyState),
    preview: refreshed ? {
      previewId: refreshed.previewId || productPreviewId(refreshed.plan || refreshed),
      generatedAt: refreshed.generatedAt || refreshed.plan?.generatedAt || '',
      mode: refreshed.mode || refreshed.plan?.policy || policyState.policy,
      counts: refreshed.counts || productPreviewCounts(refreshed.plan || refreshed),
      convergence,
    } : null,
  };
}

export async function saveProductTombstoneDecision(options = {}) {
  await ensureDirs();
  const batchItems = Array.isArray(options.items)
    ? options.items
    : Array.isArray(options.decisions)
      ? options.decisions
      : [];
  if (batchItems.length) {
    return saveProductTombstoneDecisionBatch(options, batchItems);
  }
  const action = String(options.action || options.tombstoneAction || '').trim().toLowerCase();
  const plan = await readJsonIfExists(FILES.syncPreview);
  const tombstonesBefore = await readSyncTombstoneState();
  const resolved = resolveProductTombstoneInput(options, plan, tombstonesBefore);
  if (action === 'confirm_global_delete') {
    const expected = expectedProductTombstoneConfirmation(resolved.platform);
    if (String(options.confirmText || '').trim().toUpperCase() !== expected) {
      throw productHttpError(400, `删除意图确认不匹配。请输入 ${expected} 后再确认。`);
    }
  }
  const now = new Date().toISOString();
  const tombstones = upsertTombstoneDecision(tombstonesBefore, {
    key: resolved.key,
    action,
    platform: resolved.platform,
    track: resolved.track,
    note: options.note,
    decidedAt: now,
    updatedAt: now,
  });
  assertValidState(validateSyncTombstoneState(tombstones), 'sync-tombstones');
  await writeJson(FILES.syncTombstones, tombstones);

  let preview = null;
  if (options.refreshPreview !== false) {
    preview = await refreshProductPreviewFromPolicy();
  }

  return {
    decision: tombstones.items?.[resolved.key] || null,
    cleared: action === 'clear',
    tombstones: summarizeProductTombstones(tombstones),
    preview: preview ? summarizeProductPreview(preview.plan || preview) : null,
  };
}

async function saveProductTombstoneDecisionBatch(options = {}, items = []) {
  const batchAction = String(options.action || options.tombstoneAction || '').trim().toLowerCase();
  const plan = await readJsonIfExists(FILES.syncPreview);
  let tombstones = await readSyncTombstoneState();
  const now = new Date().toISOString();
  const results = [];

  for (const item of items) {
    const action = String(item.action || item.tombstoneAction || batchAction).trim().toLowerCase();
    if (!action) throw productHttpError(400, 'Missing tombstone action for batch item.');
    if (action === 'confirm_global_delete') {
      throw productHttpError(400, 'Bulk global delete is not supported. Confirm global delete one item at a time.');
    }
    const resolved = resolveProductTombstoneInput({
      ...item,
      action,
      tombstoneAction: action,
    }, plan, tombstones);
    tombstones = upsertTombstoneDecision(tombstones, {
      key: resolved.key,
      action,
      platform: resolved.platform,
      track: resolved.track,
      note: item.note || options.note,
      decidedAt: now,
      updatedAt: now,
    });
    results.push({
      key: resolved.key,
      action,
      platform: resolved.platform,
      cleared: action === 'clear',
    });
  }

  assertValidState(validateSyncTombstoneState(tombstones), 'sync-tombstones');
  await writeJson(FILES.syncTombstones, tombstones);

  let preview = null;
  if (options.refreshPreview !== false) {
    preview = await refreshProductPreviewFromPolicy();
  }

  return {
    batch: true,
    requested: items.length,
    changed: results.length,
    results,
    tombstones: summarizeProductTombstones(tombstones),
    preview: preview ? summarizeProductPreview(preview.plan || preview) : null,
  };
}

export async function getProductSyncPreview(options = {}) {
  await ensureDirs();
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) throw productHttpError(409, '缺少同步预览，请先运行同步检查。');
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const tombstones = await readSyncTombstoneState();
  const bucket = String(options.bucket || 'all').trim();
  const offset = Math.max(0, Number(options.offset || options.cursor || 0));
  const limit = Math.min(100, Math.max(1, Number(options.limit || 50)));
  const items = (plan.operations || [])
    .map((operation) => productPreviewItem(operation, { tombstones }))
    .filter((item) => bucket === 'all' || item.bucket === bucket);
  const page = items.slice(offset, offset + limit);
  return {
    previewId: productPreviewId(plan),
    generatedAt: plan.generatedAt,
    mode: plan.policy,
    bucket,
    counts: productPreviewCounts(plan),
    convergence: summarizeProductPreviewConvergence(plan.convergence),
    addResolution: summarizeProductAddResolution(plan.addResolution, plan.targets || []),
    total: items.length,
    items: page,
    nextCursor: offset + page.length < items.length ? String(offset + page.length) : null,
  };
}

export async function resolveProductSyncAdditions(options = {}) {
  await ensureDirs();
  const [plan, policyState] = await Promise.all([
    readJsonIfExists(FILES.syncPreview),
    readSyncPolicyState(),
  ]);
  if (!plan) throw productHttpError(409, '缺少同步预览，请先运行同步检查。');
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const policy = plan.policy || policyState.policy || '';
  if (policy === 'read_only_analysis') {
    throw productHttpError(409, '只分析模式不会查找或写入目标平台歌曲。');
  }

  const targets = resolveProductPolicyExecutionTargets(options, policyState, plan);
  const snapshots = await readProductSnapshots();
  const resolvedPlan = await resolveProductPolicyAdditions(plan, {
    ...options,
    targets,
    snapshots,
  });
  const tombstones = await readSyncTombstoneState();
  const bucket = String(options.bucket || 'will_add').trim();
  const limit = Math.min(100, Math.max(1, Number(options.previewLimit || options.limit || 30)));
  const items = (resolvedPlan.operations || [])
    .map((operation) => productPreviewItem(operation, { tombstones }))
    .filter((item) => bucket === 'all' || item.bucket === bucket)
    .slice(0, limit);

  return {
    previewId: productPreviewId(resolvedPlan),
    generatedAt: resolvedPlan.generatedAt,
    mode: resolvedPlan.policy,
    targets,
    counts: productPreviewCounts(resolvedPlan),
    blocked: productPreviewBlocked(resolvedPlan),
    addResolution: summarizeProductAddResolution(resolvedPlan.addResolution, targets),
    preview: {
      bucket,
      total: (resolvedPlan.operations || [])
        .map((operation) => productPreviewItem(operation, { tombstones }))
        .filter((item) => bucket === 'all' || item.bucket === bucket).length,
      items,
    },
  };
}

export async function applyProductAddCandidateDecision(options = {}) {
  await ensureDirs();
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) throw productHttpError(409, '缺少同步预览，请先运行同步检查。');
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const action = String(options.action || '').trim().toLowerCase();
  if (!['accept_candidate', 'select_alternative', 'skip', 'clear'].includes(action)) {
    throw productHttpError(400, '新增候选决策只支持 accept_candidate、select_alternative、skip 或 clear。');
  }
  const operationId = String(options.operationId || options.id || '').trim();
  if (!operationId) throw productHttpError(400, '缺少新增操作 ID。');
  const now = new Date().toISOString();
  let changed = false;
  let matchedNonAdd = false;
  let selected = null;
  const operations = (plan.operations || []).map((operation) => {
    if (operation.id !== operationId) return operation;
    if (operation.action !== 'add') {
      matchedNonAdd = true;
      return operation;
    }
    changed = true;
    selected = applyProductAddDecisionToOperation(operation, {
      action,
      alternativeIndex: options.alternativeIndex,
      decidedAt: now,
    });
    return selected;
  });
  if (!changed) {
    throw productHttpError(matchedNonAdd ? 409 : 404, matchedNonAdd ? '没有找到同 ID 的新增操作；请刷新同步预览后重试。' : '没有找到对应的新增操作。');
  }
  const nextPlan = {
    ...plan,
    resolvedAt: now,
    addResolution: {
      ...(plan.addResolution || {}),
      reviewedAt: now,
    },
    operations,
    summary: {
      ...summarizePolicyOperations(operations),
      baselineAdded: plan.summary?.baselineAdded || 0,
      baselineDeleted: plan.summary?.baselineDeleted || 0,
    },
  };
  assertValidState(validateSyncPreviewState(nextPlan), 'sync-preview');
  await writeJson(FILES.syncPreview, nextPlan);
  const tombstones = await readSyncTombstoneState();
  return {
    previewId: productPreviewId(nextPlan),
    generatedAt: nextPlan.generatedAt,
    operation: productPreviewItem(selected, { tombstones }),
    counts: productPreviewCounts(nextPlan),
    blocked: productPreviewBlocked(nextPlan),
    addResolution: summarizeProductAddResolution(nextPlan.addResolution, nextPlan.targets || []),
  };
}

export async function applyProductAddCandidateDecisionBatch(options = {}) {
  await ensureDirs();
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) throw productHttpError(409, '缺少同步预览，请先运行同步检查。');
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');

  const action = String(options.action || '').trim().toLowerCase();
  if (!['accept_candidate', 'skip', 'clear'].includes(action)) {
    throw productHttpError(400, '批量新增候选决策只支持 accept_candidate、skip 或 clear。');
  }
  const operationIds = normalizeOperationIds(options.operationIds || options.ids);
  if (!operationIds.length) throw productHttpError(400, '缺少要批量处理的新增操作 ID。');
  if (operationIds.length > 200) throw productHttpError(400, '单次最多批量处理 200 个新增候选。');

  const requested = new Set(operationIds);
  const seen = new Set();
  const now = new Date().toISOString();
  const batchId = `add-decision-batch-${now.replace(/[:.]/g, '-')}`;
  const skippedItems = [];
  const changedOperations = [];
  let changed = 0;

  const operations = (plan.operations || []).map((operation) => {
    if (!requested.has(operation.id)) return operation;
    seen.add(operation.id);
    if (operation.action !== 'add') {
      skippedItems.push({ operationId: operation.id, reason: 'not_add_operation' });
      return operation;
    }
    if (action === 'accept_candidate' && !productAddDecisionSelectedTrack(operation, { action })) {
      skippedItems.push({ operationId: operation.id, reason: 'missing_candidate' });
      return operation;
    }
    const selected = applyProductAddDecisionToOperation(operation, {
      action,
      decidedAt: now,
      batchId,
    });
    changed += 1;
    changedOperations.push(selected);
    return selected;
  });

  for (const operationId of operationIds) {
    if (!seen.has(operationId)) skippedItems.push({ operationId, reason: 'not_found' });
  }
  if (!changed) {
    throw productHttpError(409, '没有可批量处理的新增候选；请刷新同步预览后重试。');
  }

  const nextPlan = {
    ...plan,
    resolvedAt: now,
    addResolution: {
      ...(plan.addResolution || {}),
      reviewedAt: now,
    },
    operations,
    summary: {
      ...summarizePolicyOperations(operations),
      baselineAdded: plan.summary?.baselineAdded || 0,
      baselineDeleted: plan.summary?.baselineDeleted || 0,
    },
  };
  assertValidState(validateSyncPreviewState(nextPlan), 'sync-preview');
  await writeJson(FILES.syncPreview, nextPlan);
  const tombstones = await readSyncTombstoneState();
  return {
    previewId: productPreviewId(nextPlan),
    generatedAt: nextPlan.generatedAt,
    action,
    batchId,
    requested: operationIds.length,
    changed,
    skipped: skippedItems.length,
    skippedItems,
    operationIds: changedOperations.map((operation) => operation.id),
    operations: changedOperations.slice(0, 20).map((operation) => productPreviewItem(operation, { tombstones })),
    counts: productPreviewCounts(nextPlan),
    blocked: productPreviewBlocked(nextPlan),
    addResolution: summarizeProductAddResolution(nextPlan.addResolution, nextPlan.targets || []),
  };
}

export async function checkProductSyncConvergence(options = {}) {
  await ensureDirs();
  const policyState = await readSyncPolicyState();
  const policy = policyState?.policy || 'canonical_mirror';
  if (policy === 'canonical_mirror') {
    const result = await checkMirrorConvergence({
      target: options.target,
      playlistId: options.playlistId,
      refreshTarget: options.refreshTarget !== false,
      persist: options.persist,
    });
    return {
      mode: 'canonical_mirror',
      convergence: summarizeCanonicalProductConvergence(result.convergence),
      mirror: {
        persisted: Boolean(result.persisted),
        target: result.convergence?.target || '',
      },
      snapshots: result.snapshots || null,
    };
  }

  const targets = normalizeProductTargets(options.targets || policyState.targets || ['qq', 'netease']);
  let snapshots = null;
  if (options.refreshTarget !== false) {
    snapshots = await refreshProductPolicyTargetSnapshots(targets, {}, {
      playlistId: options.playlistId,
    });
  }
  const preview = await refreshProductPreviewFromPolicy({ policyState });
  const convergence = summarizeProductPolicyConvergence(preview, {
    refreshedAt: new Date().toISOString(),
    refreshedTargets: options.refreshTarget === false ? [] : targets,
    snapshots: snapshots || {},
  });
  await persistProductPreviewConvergence(convergence);
  return {
    mode: policy,
    convergence,
    preview: preview ? summarizeProductPreview(preview.plan || preview) : null,
  };
}

export async function confirmProductSyncDeletions(options = {}) {
  await ensureDirs();
  await assertProductExecutionPolicy();
  const targets = await resolveProductExecutionTargets(options);
  const expected = expectedProductDeleteConfirmation(targets);
  if (String(options.confirmText || '').trim().toUpperCase() !== expected) {
    throw productHttpError(400, `删除确认不匹配。请输入 ${expected} 后再确认删除。`);
  }

  let tombstones = await readSyncTombstoneState();
  const now = new Date().toISOString();
  const targetResults = {};
  const confirmedOperationIds = [];
  let confirmed = 0;

  for (const target of targets) {
    const plan = await generateProductMirrorPlanForTarget(target, options);
    const operationIds = productOperationIdsForTarget(options.operationIds, target);
    if (hasProductOperationFilter(options.operationIds) && !operationIds.length) {
      targetResults[target] = { confirmed: 0, operationIds: [], skipped: true };
      continue;
    }
    const operations = selectMirrorRemoveOperations(plan, operationIds);
    targetResults[target] = {
      confirmed: operations.length,
      operationIds: operations.map((operation) => operation.id),
    };
    confirmed += operations.length;
    confirmedOperationIds.push(...operations.map((operation) => operation.id));
    for (const operation of operations) {
      tombstones = upsertTombstoneDecision(tombstones, {
        key: productDeletionKey(target, operation.id),
        action: 'confirm_global_delete',
        platform: target,
        track: operation.targetTrack,
        note: `Confirmed from product deletion flow for ${operation.id}`,
        decidedAt: now,
        updatedAt: now,
      });
      tombstones.items[productDeletionKey(target, operation.id)].operationId = operation.id;
    }
  }

  if (!confirmed) throw productHttpError(409, '没有可确认的删除操作。');
  assertValidState(validateSyncTombstoneState(tombstones), 'sync-tombstones');
  await writeJson(FILES.syncTombstones, tombstones);
  return {
    target: targets.length === 1 ? targets[0] : 'multi',
    targets: targetResults,
    confirmed,
    operationIds: confirmedOperationIds,
    tombstones: summarizeProductTombstones(tombstones),
  };
}

export async function executeProductSyncAdditions(options = {}) {
  await ensureDirs();
  const policyState = await readSyncPolicyState();
  if (policyState?.policy && policyState.policy !== 'canonical_mirror') {
    return executeProductPolicySyncAdditions(options, policyState);
  }
  await assertProductExecutionPolicy();
  const targets = await resolveProductExecutionTargets(options);
  await assertProductLiveValidationReady(targets, options);
  const results = [];

  for (const target of targets) {
    const operationIds = productOperationIdsForTarget(options.operationIds, target);
    if (hasProductOperationFilter(options.operationIds) && !operationIds.length) {
      results.push(emptyProductExecutionResult(target, options, 'operation_filter_empty'));
      continue;
    }
    await generateProductMirrorPlanForTarget(target, options);
    results.push(await runMirrorSyncPlan(productRunOptionsForTarget(options, target, 'add', operationIds)));
  }

  return aggregateProductExecutionResults(results, {
    targets,
    dryRun: options.dryRun !== false,
    action: 'add',
  });
}

export async function executeProductSyncDeletions(options = {}) {
  await ensureDirs();
  const policyState = await readSyncPolicyState();
  if (policyState?.policy && policyState.policy !== 'canonical_mirror') {
    return executeProductPolicySyncDeletions(options, policyState);
  }
  await assertProductExecutionPolicy();
  const targets = await resolveProductExecutionTargets(options);
  await assertProductLiveValidationReady(targets, options);
  const tombstones = await readSyncTombstoneState();
  const results = [];
  let selected = 0;
  let missingConfirmations = 0;

  for (const target of targets) {
    const plan = await generateProductMirrorPlanForTarget(target, options);
    const operationIds = productOperationIdsForTarget(options.operationIds, target);
    if (hasProductOperationFilter(options.operationIds) && !operationIds.length) {
      results.push(emptyProductExecutionResult(target, options, 'operation_filter_empty'));
      continue;
    }
    const operations = selectMirrorRemoveOperations(plan, operationIds);
    if (!operations.length) {
      results.push(emptyProductExecutionResult(target, options, 'no_delete_operations'));
      continue;
    }
    selected += operations.length;
    const missing = operations.filter((operation) => !isProductDeletionConfirmed(tombstones, target, operation.id));
    missingConfirmations += missing.length;
    if (missing.length) continue;
    results.push(await runMirrorSyncPlan({
      ...productRunOptionsForTarget(options, target, 'remove', operations.map((operation) => operation.id)),
      confirmText: expectedMirrorDeleteConfirmation(target),
    }));
  }

  if (!selected) throw productHttpError(409, '没有可执行的删除操作。');
  if (missingConfirmations) {
    throw productHttpError(409, `删除执行被阻止：${missingConfirmations} 个操作缺少确认记录。`);
  }

  return aggregateProductExecutionResults(results, {
    targets,
    dryRun: options.dryRun !== false,
    action: 'remove',
  });
}

async function executeProductPolicySyncAdditions(options = {}, policyState = {}) {
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) throw productHttpError(409, 'Missing sync preview. Run a sync check before executing additions.');
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const policy = plan.policy || policyState.policy || '';
  if (policy === 'read_only_analysis') {
    throw productHttpError(409, 'Read-only analysis mode cannot write additions.');
  }
  if (policy !== 'union_convergence' && policy !== 'managed_bidirectional') {
    throw productHttpError(409, `Policy add execution is not supported for ${policy || 'unknown'} mode.`);
  }

  const targets = resolveProductPolicyExecutionTargets(options, policyState, plan);
  await assertProductLiveValidationReady(targets, options);
  const snapshots = await readProductSnapshots();
  const resolvedPlan = options.resolve === false
    ? plan
    : await resolveProductPolicyAdditions(plan, {
      ...options,
      targets,
      snapshots,
    });
  const results = [];

  for (const target of targets) {
    const operationIds = productPolicyOperationIdsForTarget(options.operationIds, target);
    if (hasProductOperationFilter(options.operationIds) && !operationIds.length) {
      results.push(emptyProductExecutionResult(target, options, 'operation_filter_empty'));
      continue;
    }

    const addPlan = buildProductPolicyAddMirrorPlan(resolvedPlan, target, {
      operationIds,
      playlistId: productTargetOptionValue(options.playlistId, target) || snapshots[target]?.playlistId || '',
      snapshot: snapshots[target],
    });
    if (!addPlan.operations.length) {
      results.push(emptyProductExecutionResult(target, options, 'no_add_operations'));
      continue;
    }

    results.push(await executeProductPolicyAddMirrorPlan(addPlan, options, target));
  }

  const aggregate = aggregateProductExecutionResults(results, {
    targets,
    dryRun: options.dryRun !== false,
    action: 'add',
  });
  return attachProductPolicyConvergence(aggregate, {
    policy,
    policyState,
    targets,
    action: 'add',
    options,
  });
}

async function executeProductPolicySyncDeletions(options = {}, policyState = {}) {
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) throw productHttpError(409, 'Missing sync preview. Run a sync check before executing deletions.');
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const policy = plan.policy || policyState.policy || '';
  if (policy === 'read_only_analysis') {
    throw productHttpError(409, 'Read-only analysis mode cannot write deletions.');
  }
  if (policy !== 'managed_bidirectional') {
    throw productHttpError(409, `Policy delete execution is not supported for ${policy || 'unknown'} mode.`);
  }

  const targets = resolveProductPolicyExecutionTargets(options, policyState, plan);
  await assertProductLiveValidationReady(targets, options);
  const snapshots = await readProductSnapshots();
  const tombstones = await readSyncTombstoneState();
  const results = [];
  let selected = 0;
  let missingConfirmations = 0;

  for (const target of targets) {
    const operationIds = productPolicyOperationIdsForTarget(options.operationIds, target);
    if (hasProductOperationFilter(options.operationIds) && !operationIds.length) {
      results.push(emptyProductExecutionResult(target, options, 'operation_filter_empty'));
      continue;
    }

    const operations = selectProductPolicyRemoveOperations(plan.operations || [], target, operationIds);
    if (!operations.length) {
      results.push(emptyProductExecutionResult(target, options, 'no_delete_operations'));
      continue;
    }
    selected += operations.length;

    const unconfirmed = operations.filter((operation) => !isProductPolicyDeletionConfirmed(tombstones, operation));
    missingConfirmations += unconfirmed.length;
    if (unconfirmed.length) continue;

    const removePlan = buildProductPolicyRemoveMirrorPlan(plan, target, {
      operationIds: operations.map((operation) => operation.id),
      playlistId: productTargetOptionValue(options.playlistId, target) || snapshots[target]?.playlistId || '',
      snapshot: snapshots[target],
    });
    results.push(await executeProductPolicyRemoveMirrorPlan(removePlan, options, target));
  }

  if (!selected) throw productHttpError(409, 'No executable policy deletion operations are available.');
  if (missingConfirmations) {
    throw productHttpError(409, `Policy deletion execution blocked: ${missingConfirmations} operation(s) are missing confirmed tombstones.`);
  }

  const aggregate = aggregateProductExecutionResults(results, {
    targets,
    dryRun: options.dryRun !== false,
    action: 'remove',
  });
  return attachProductPolicyConvergence(aggregate, {
    policy,
    policyState,
    targets,
    action: 'remove',
    options,
  });
}

export async function generateProductMusicProfile(options = {}) {
  await ensureDirs();
  const context = await readMusicIntelligenceContext();
  const existing = await readJsonIfExists(FILES.musicProfile);
  const useModel = Boolean(options.useModel);
  if (!options.refresh && existing && !useModel) {
    assertValidState(validateMusicProfileState(existing), 'music-profile');
    return existing;
  }
  let profile = buildMusicProfile({
    ...context,
    generatedAt: new Date().toISOString(),
  });
  const deterministicSummary = deterministicMusicProfileSummary(profile);
  if (!useModel) {
    profile = {
      ...profile,
      aiSummary: deterministicSummary,
      model: {
        used: false,
        skippedReason: 'deterministic_only',
        provider: await getProductAiProviderState(),
      },
    };
  } else {
    if (!options.consent) {
      throw productHttpError(400, 'AI profile generation requires consent before sending sanitized aggregate music-profile evidence to the configured provider.');
    }
    const aiProvider = await resolveWorkflowAiProvider(options);
    const response = await requestAiJson({
      providerConfig: aiProvider,
      messages: [
        { role: 'system', content: PRODUCT_PROFILE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            evidence: buildMusicProfileAiEvidence(profile),
            deterministic: deterministicSummary,
          }, null, 2),
        },
      ],
      maxTokens: 1800,
      thinking: options.thinking !== false,
      fetchImpl: options.fetchImpl,
    });
    profile = {
      ...profile,
      aiSummary: normalizeMusicProfileAiSummary(response.json, { source: 'model' }),
      model: {
        used: true,
        provider: sanitizeAiProviderConfig(aiProvider),
        model: response.model,
        usage: response.usage,
      },
    };
  }
  assertValidState(validateMusicProfileState(profile), 'music-profile');
  if (options.save !== false) await writeJson(FILES.musicProfile, profile);
  return profile;
}

export async function findProductSimilarTracks(options = {}) {
  await ensureDirs();
  const context = await readMusicIntelligenceContext();
  return findSimilarTracks({
    ...context,
    seed: options.seed || {},
    limit: options.limit,
  });
}

export async function generateProductRecommendations(options = {}) {
  await ensureDirs();
  const context = await readMusicIntelligenceContext();
  let profile = await readJsonIfExists(FILES.musicProfile);
  if (!profile || options.refreshProfile) {
    profile = buildMusicProfile({
      ...context,
      generatedAt: new Date().toISOString(),
    });
    assertValidState(validateMusicProfileState(profile), 'music-profile');
    await writeJson(FILES.musicProfile, profile);
  } else {
    assertValidState(validateMusicProfileState(profile), 'music-profile');
  }
  let recommendations = buildRecommendations({
    ...context,
    profile,
    limit: options.limit,
    excludeApple: options.excludeApple,
    generatedAt: new Date().toISOString(),
  });
  const useModel = Boolean(options.useModel);
  if (!useModel) {
    recommendations = {
      ...recommendations,
      model: {
        used: false,
        skippedReason: 'deterministic_only',
        provider: await getProductAiProviderState(),
      },
    };
  } else {
    if (!options.consent) {
      throw productHttpError(400, 'AI recommendations require consent before sending sanitized local recommendation candidates to the configured provider.');
    }
    const aiProvider = await resolveWorkflowAiProvider(options);
    const response = await requestAiJson({
      providerConfig: aiProvider,
      messages: [
        { role: 'system', content: PRODUCT_RECOMMENDATION_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(buildRecommendationAiEvidence(recommendations, profile), null, 2) },
      ],
      maxTokens: 1800,
      thinking: options.thinking !== false,
      fetchImpl: options.fetchImpl,
    });
    recommendations = {
      ...applyRecommendationAiSummary(
        recommendations,
        normalizeRecommendationAiSummary(response.json, {
          source: 'model',
          candidates: recommendations.candidates,
        }),
      ),
      model: {
        used: true,
        provider: sanitizeAiProviderConfig(aiProvider),
        model: response.model,
        usage: response.usage,
      },
    };
  }
  let shortlist = null;
  if (options.saveShortlist) {
    const existing = await readJsonIfExists(FILES.recommendationShortlists);
    shortlist = appendRecommendationShortlist(existing, {
      name: options.shortlistName || 'Local recommendations',
      candidates: recommendations.candidates,
      source: 'profile',
      updatedAt: recommendations.generatedAt,
    });
    assertValidState(validateRecommendationShortlistsState(shortlist), 'recommendation-shortlists');
    await writeJson(FILES.recommendationShortlists, shortlist);
  }
  return {
    ...recommendations,
    savedShortlist: shortlist
      ? {
        id: shortlist.shortlists[0]?.id || '',
        name: shortlist.shortlists[0]?.name || '',
        trackCount: shortlist.shortlists[0]?.tracks?.length || 0,
      }
      : null,
  };
}

export async function explainProductSyncItem(options = {}) {
  await ensureDirs();
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) throw productHttpError(409, 'Missing sync preview. Run a sync check before asking for an explanation.');
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const tombstones = await readSyncTombstoneState();
  const operation = findProductExplanationOperation(plan, options);
  if (!operation) throw productHttpError(404, 'No sync preview item matched the requested explanation target.');

  const item = productPreviewItem(operation, { tombstones });
  const evidence = buildProductExplanationEvidence(operation, item, tombstones);
  const deterministic = deterministicProductExplanation(operation, item, evidence);
  const provider = await getProductAiProviderState();
  const useModel = Boolean(options.useModel);
  if (!useModel) {
    return {
      item,
      evidence,
      explanation: deterministic,
      model: {
        used: false,
        skippedReason: 'deterministic_only',
        provider,
      },
    };
  }
  if (!options.consent) {
    throw productHttpError(400, 'AI explanation requires consent before sending sanitized track evidence to the configured provider.');
  }

  const aiProvider = await resolveWorkflowAiProvider(options);
  const response = await requestAiJson({
    providerConfig: aiProvider,
    messages: [
      { role: 'system', content: PRODUCT_EXPLANATION_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ item, evidence, deterministic }, null, 2) },
    ],
    maxTokens: 1800,
    thinking: options.thinking !== false,
  });
  return {
    item,
    evidence,
    explanation: normalizeProductAiExplanation(response.json, deterministic),
    model: {
      used: true,
      provider: sanitizeAiProviderConfig(aiProvider),
      model: response.model,
      usage: response.usage,
    },
  };
}

async function getProductTrackEvidence(options = {}) {
  await ensureDirs();
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) {
    return {
      exists: false,
      error: 'Missing sync preview. Run a sync check before asking for track evidence.',
      evidenceRefs: [],
    };
  }
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const tombstones = await readSyncTombstoneState();
  const operation = findProductExplanationOperation(plan, options);
  const previewId = productPreviewId(plan);
  if (!operation) {
    return {
      exists: false,
      previewId,
      generatedAt: plan.generatedAt || '',
      requested: {
        operationIdProvided: Boolean(options.operationId || options.id),
        tombstoneKeyProvided: Boolean(options.tombstoneKey || options.key),
        bucket: String(options.bucket || '').trim(),
      },
      error: 'No sync preview item matched the requested evidence target.',
      evidenceRefs: [],
    };
  }

  const item = productPreviewItem(operation, { tombstones });
  const rawEvidence = buildProductExplanationEvidence(operation, item, tombstones);
  const evidence = sanitizeProductEvidenceForAgent(rawEvidence);
  const explanation = deterministicProductExplanation(operation, item, evidence);
  const evidenceRefs = explanation.evidenceRefs || productExplanationEvidenceRefs(evidence);
  return {
    exists: true,
    previewId,
    generatedAt: plan.generatedAt || '',
    operationId: operation.id || item.id || '',
    bucket: item.bucket || productBucketForOperation(operation),
    item: {
      id: item.id || operation.id || '',
      bucket: item.bucket || productBucketForOperation(operation),
      action: item.action || operation.action || '',
      status: item.status || operation.status || '',
      title: item.title || '',
      artist: item.artist || '',
      album: item.album || '',
      sourcePlatforms: item.sourcePlatforms || [],
      targetPlatforms: item.targetPlatforms || [],
      reason: item.reason || '',
      message: item.message || '',
      blockedReason: item.blockedReason || '',
      evidence: item.evidence || [],
      score: item.score ?? null,
    },
    evidence,
    explanation,
    evidenceRefs,
  };
}

async function getProductBaselineDiffForAgent(options = {}) {
  try {
    const state = await getProductSyncBaseline({ platforms: options.platforms });
    const exists = state.baseline?.exists === true;
    return {
      exists,
      baseline: sanitizeAgentBaselineSummary(state.baseline),
      diff: state.diff || { exists: false, status: 'missing_baseline', examples: [] },
      participants: state.participants || [],
      tombstones: state.tombstones || {},
      evidenceRefs: exists ? ['sync-baseline', 'baseline-diff'] : [],
    };
  } catch (error) {
    return {
      exists: false,
      error: formatErrorMessage(error),
      evidenceRefs: [],
    };
  }
}

async function getProductReviewQueueForAgent(options = {}) {
  await ensureDirs();
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) {
    return {
      exists: false,
      error: 'Missing sync preview. Run a sync check before asking for the review queue.',
      items: [],
      evidenceRefs: [],
    };
  }
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const tombstones = await readSyncTombstoneState();
  const bucket = normalizeAgentReviewBucket(options.bucket);
  const limit = clampPositiveInteger(options.limit, 20, 100);
  const wanted = bucket === 'all'
    ? new Set(['needs_confirmation', 'may_delete'])
    : new Set([bucket]);
  const items = (plan.operations || [])
    .map((operation) => productPreviewItem(operation, { tombstones }))
    .filter((item) => wanted.has(item.bucket));
  return {
    exists: true,
    previewId: productPreviewId(plan),
    generatedAt: plan.generatedAt || '',
    bucket,
    counts: productPreviewCounts(plan),
    total: items.length,
    items: items.slice(0, limit).map(sanitizeAgentReviewQueueItem),
    evidenceRefs: [`sync-preview:${productPreviewId(plan)}`],
  };
}

export async function analyzeProductTombstoneRisks(options = {}) {
  await ensureDirs();
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) throw productHttpError(409, 'Missing sync preview. Run a sync check before asking for tombstone risk analysis.');
  assertValidState(validateSyncPreviewState(plan), 'sync-preview');
  const tombstones = await readSyncTombstoneState();
  const limit = clampPositiveInteger(options.limit, 50, 100);
  const operations = (plan.operations || [])
    .filter((operation) => productBucketForOperation(operation) === 'may_delete' && operation.tombstoneKey)
    .slice(0, limit);
  const items = operations.map((operation) => {
    const item = productPreviewItem(operation, { tombstones });
    const evidence = buildProductExplanationEvidence(operation, item, tombstones);
    const explanation = deterministicProductExplanation(operation, item, evidence);
    return productTombstoneRiskItem(operation, item, evidence, explanation);
  });
  const deterministic = productTombstoneRiskSummary(items, plan);
  const provider = await getProductAiProviderState();
  const useModel = Boolean(options.useModel);
  if (!useModel) {
    return {
      ...deterministic,
      model: {
        used: false,
        skippedReason: 'deterministic_only',
        provider,
      },
    };
  }
  if (!options.consent) {
    throw productHttpError(400, 'AI tombstone risk analysis requires consent before sending sanitized track evidence to the configured provider.');
  }

  const aiProvider = await resolveWorkflowAiProvider(options);
  const response = await requestAiJson({
    providerConfig: aiProvider,
    messages: [
      { role: 'system', content: PRODUCT_TOMBSTONE_RISK_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(deterministic, null, 2) },
    ],
    maxTokens: 2200,
    thinking: options.thinking !== false,
  });
  const ai = normalizeProductTombstoneRiskModelResponse(response.json, deterministic);
  return {
    ...deterministic,
    ai,
    model: {
      used: true,
      provider: sanitizeAiProviderConfig(aiProvider),
      model: response.model,
      usage: response.usage,
    },
  };
}

export function getAgentToolRegistry() {
  return {
    tools: listAgentTools(),
  };
}

export async function runAgentToolRequest(options = {}) {
  await ensureDirs();
  const selectedTool = options.tool || selectAgentToolForMessage(options.message || '');
  const tool = assertAgentToolAllowed(selectedTool);
  const args = options.arguments || options.args || {};
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  const sessionId = options.sessionId || createAgentSessionId(startedIso);
  let result;
  try {
    result = await executeAgentTool(tool.name, args, options);
  } catch (error) {
    await appendAgentToolTrace({
      sessionId,
      tool: tool.name,
      source: options.source || 'http',
      status: 'failed',
      readOnly: tool.readOnly === true,
      localDraft: tool.localDraft === true,
      calledAt: startedIso,
      durationMs: Date.now() - startedAt,
      argumentsSummary: summarizeAgentToolArguments(tool.name, args),
      resultSummary: {
        error: formatErrorMessage(error),
      },
      evidenceRefs: [],
    });
    throw error;
  }
  const response = sanitizeAgentToolResult(tool, result);
  const trace = await appendAgentToolTrace({
    sessionId,
    tool: tool.name,
    source: options.source || 'http',
    status: 'completed',
    readOnly: tool.readOnly === true,
    localDraft: tool.localDraft === true,
    calledAt: startedIso,
    durationMs: Date.now() - startedAt,
    argumentsSummary: summarizeAgentToolArguments(tool.name, args),
    resultSummary: summarizeAgentToolResult(tool.name, result),
    evidenceRefs: agentEvidenceRefs(result),
  });
  return {
    sessionId,
    traceId: trace.traceId,
    message: agentToolMessage(tool.name, result),
    ...response,
  };
}

export async function getAgentSessions(options = {}) {
  await ensureDirs();
  const state = await readAgentSessionState();
  const limit = clampPositiveInteger(options.limit, 10, 100);
  return {
    version: 1,
    updatedAt: state.updatedAt,
    total: state.sessions.length,
    sessions: state.sessions.slice(0, limit).map((session) => sanitizeAgentSession(session, options)),
  };
}

export async function saveAgentTraceFeedback(input = {}) {
  await ensureDirs();
  const sessionId = String(input.sessionId || '').trim();
  const traceId = String(input.traceId || input.id || '').trim();
  const label = String(input.label || '').trim();
  const source = String(input.source || 'product-ui').trim() || 'product-ui';
  const allowed = new Set(['useful', 'not_enough_evidence', 'incorrect']);
  if (!sessionId) throw productHttpError(400, '缺少 Agent session ID。');
  if (!traceId) throw productHttpError(400, '缺少 Agent trace ID。');
  if (!allowed.has(label)) throw productHttpError(400, 'Agent trace feedback 只支持 useful、not_enough_evidence 或 incorrect。');

  const state = await readAgentSessionState();
  const now = new Date().toISOString();
  let found = false;
  const sessions = state.sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      updatedAt: now,
      toolTraces: (session.toolTraces || []).map((trace) => {
        if (trace.id !== traceId) return trace;
        found = true;
        return {
          ...trace,
          feedback: {
            label,
            source,
            updatedAt: now,
          },
        };
      }),
    };
  });
  if (!found) throw productHttpError(404, '没有找到对应的 Agent trace。');

  const next = {
    version: 1,
    updatedAt: now,
    sessions,
  };
  assertValidState(validateAgentSessionsState(next), 'agent-sessions');
  await writeJson(FILES.agentSessions, next);
  return {
    sessionId,
    traceId,
    feedback: { label, source, updatedAt: now },
    sessions: await getAgentSessions({ limit: input.limit || 3, traceLimit: input.traceLimit || 5 }),
  };
}

async function executeAgentTool(toolName, args = {}, options = {}) {
  if (toolName === 'get_library_summary') {
    const state = await getProductAppState();
    return {
      platforms: state.platforms,
      latestPreview: state.latestPreview,
      nextAction: state.nextAction,
    };
  }
  if (toolName === 'get_sync_policy') {
    const [appState, modes] = await Promise.all([getProductAppState(), Promise.resolve(getProductSyncModes())]);
    return {
      current: appState.syncMode,
      modes: modes.modes,
    };
  }
  if (toolName === 'get_sync_preview' || toolName === 'draft_sync_operations') {
    try {
      return await getProductSyncPreview({
        bucket: args.bucket || 'all',
        limit: args.limit || 50,
      });
    } catch (error) {
      return {
        exists: false,
        error: formatErrorMessage(error),
      };
    }
  }
  if (toolName === 'get_track_evidence') {
    return getProductTrackEvidence({
      operationId: args.operationId || args.id,
      tombstoneKey: args.tombstoneKey || args.key,
      bucket: args.bucket,
    });
  }
  if (toolName === 'get_baseline_diff') {
    return getProductBaselineDiffForAgent({
      platforms: args.platforms,
    });
  }
  if (toolName === 'get_review_queue') {
    return getProductReviewQueueForAgent({
      bucket: args.bucket,
      limit: args.limit,
    });
  }
  if (toolName === 'get_taste_profile') {
    return generateProductMusicProfile({
      refresh: Boolean(args.refresh || options.refresh),
    });
  }
  if (toolName === 'find_similar_tracks') {
    return findProductSimilarTracks({
      seed: args.seed || {},
      limit: args.limit,
    });
  }
  if (toolName === 'recommend_by_profile') {
    return generateProductRecommendations({
      limit: args.limit,
      excludeApple: args.excludeApple,
      saveShortlist: false,
    });
  }
  if (toolName === 'save_local_shortlist') {
    return generateProductRecommendations({
      limit: args.limit,
      excludeApple: args.excludeApple,
      saveShortlist: true,
      shortlistName: args.name || args.shortlistName || 'Agent recommendations',
    });
  }
  throw new Error(`Unsupported Agent tool: ${toolName}`);
}

async function readMusicIntelligenceContext() {
  const [apple, qq, netease, unified] = await Promise.all([
    readJsonIfExists(FILES.appleJson),
    readJsonIfExists(FILES.qqJson),
    readJsonIfExists(FILES.neteaseJson),
    readJsonIfExists(FILES.unifiedJson),
  ]);
  return {
    snapshots: {
      apple: prepareSnapshot(apple),
      qq: prepareSnapshot(qq),
      netease: prepareSnapshot(netease),
    },
    unified: unified || null,
  };
}

async function appendAgentToolTrace(input = {}) {
  const now = input.calledAt || new Date().toISOString();
  const sessionId = input.sessionId || createAgentSessionId(now);
  const state = await readAgentSessionState();
  const current = state.sessions.find((session) => session.id === sessionId) || {
    id: sessionId,
    startedAt: now,
    updatedAt: now,
    toolTraces: [],
  };
  const traceId = input.traceId || createAgentTraceId(now, input.tool, current.toolTraces?.length || 0);
  const nextSession = {
    ...current,
    updatedAt: new Date().toISOString(),
    toolTraces: [
      ...(current.toolTraces || []),
      {
        id: traceId,
        tool: input.tool,
        calledAt: now,
        source: input.source || 'http',
        status: input.status || 'completed',
        readOnly: input.readOnly !== false,
        localDraft: input.localDraft === true,
        mutatesProvider: false,
        exposesCredentials: false,
        durationMs: Math.max(0, Math.floor(Number(input.durationMs || 0))),
        argumentsSummary: sanitizeAgentTraceObject(input.argumentsSummary || {}),
        resultSummary: sanitizeAgentTraceObject(input.resultSummary || {}),
        evidenceRefs: input.evidenceRefs || [],
      },
    ].slice(-50),
  };
  const sessions = [
    nextSession,
    ...state.sessions.filter((session) => session.id !== sessionId),
  ].slice(0, 30);
  const next = {
    version: 1,
    updatedAt: now,
    sessions,
  };
  assertValidState(validateAgentSessionsState(next), 'agent-sessions');
  await writeJson(FILES.agentSessions, next);
  return {
    ...nextSession,
    traceId,
  };
}

async function readAgentSessionState() {
  const data = await readJsonIfExists(FILES.agentSessions);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    sessions: Array.isArray(data?.sessions) ? data.sessions : [],
  };
}

function agentEvidenceRefs(result = {}) {
  const refs = [];
  for (const ref of (result.evidenceRefs || []).slice(0, 12)) {
    if (ref) refs.push(String(ref));
  }
  if (result.previewId) refs.push(`sync-preview:${result.previewId}`);
  if (result.generatedAt) refs.push(`generated:${result.generatedAt}`);
  if (result.baseline?.savedAt) refs.push(`baseline:${result.baseline.savedAt}`);
  if (result.diff?.baselineSavedAt) refs.push(`baseline-diff:${result.diff.baselineSavedAt}`);
  if (result.operationId) refs.push(`operation:${result.operationId}`);
  if (result.seed?.clusterId) refs.push(`cluster:${result.seed.clusterId}`);
  if (result.savedShortlist?.id) refs.push(`shortlist:${result.savedShortlist.id}`);
  for (const item of (result.candidates || []).slice(0, 8)) {
    if (item.clusterId) refs.push(`cluster:${item.clusterId}`);
    else if (item.key) refs.push(`track:${item.key}`);
  }
  return [...new Set(refs)].slice(0, 20);
}

function agentToolMessage(toolName, result = {}) {
  if (toolName === 'get_baseline_diff') {
    return result.exists === false
      ? 'No saved sync baseline exists yet.'
      : `Loaded baseline diff with ${result.diff?.summary?.added || 0} additions and ${result.diff?.summary?.deleted || 0} deletion signals.`;
  }
  if (toolName === 'get_review_queue') {
    return result.exists === false
      ? 'No sync preview exists yet.'
      : `Loaded ${result.total || 0} review queue items.`;
  }
  if (toolName === 'get_track_evidence') {
    return result.exists === false
      ? 'No sync preview item evidence is available yet.'
      : `Loaded evidence for one ${result.bucket || 'sync'} preview item.`;
  }
  if (toolName === 'find_similar_tracks') {
    return result.seed ? `Found ${result.total || 0} similar local tracks.` : 'Need a seed track before finding similar songs.';
  }
  if (toolName === 'recommend_by_profile') return `Generated ${result.total || 0} local recommendation candidates.`;
  if (toolName === 'save_local_shortlist') return `Saved ${result.savedShortlist?.trackCount || 0} local recommendation candidates as a shortlist draft.`;
  if (toolName === 'get_taste_profile') return `Built a local taste profile from ${result.summary?.trackCount || 0} tracks.`;
  if (toolName === 'get_sync_preview' || toolName === 'draft_sync_operations') return result.exists === false ? 'No sync preview exists yet.' : `Loaded ${result.total || 0} preview items.`;
  if (toolName === 'get_sync_policy') return 'Loaded sync policy modes.';
  return 'Loaded local library summary.';
}

function sanitizeAgentSession(session = {}, options = {}) {
  const traces = Array.isArray(session.toolTraces) ? session.toolTraces : [];
  const traceLimit = clampPositiveInteger(options.traceLimit, 20, 50);
  return {
    id: session.id || '',
    startedAt: session.startedAt || '',
    updatedAt: session.updatedAt || '',
    traceCount: traces.length,
    toolTraces: traces.slice(-traceLimit).map((trace) => ({
      id: trace.id || '',
      tool: trace.tool || '',
      calledAt: trace.calledAt || '',
      source: trace.source || '',
      status: trace.status || '',
      readOnly: trace.readOnly !== false,
      localDraft: trace.localDraft === true,
      mutatesProvider: false,
      exposesCredentials: false,
      durationMs: Math.max(0, Math.floor(Number(trace.durationMs || 0))),
      argumentsSummary: sanitizeAgentTraceObject(trace.argumentsSummary || {}),
      resultSummary: sanitizeAgentTraceObject(trace.resultSummary || {}),
      evidenceRefs: Array.isArray(trace.evidenceRefs) ? trace.evidenceRefs.slice(0, 20) : [],
      feedback: sanitizeAgentTraceFeedback(trace.feedback),
    })),
  };
}

function sanitizeAgentTraceFeedback(feedback) {
  if (!feedback || typeof feedback !== 'object' || Array.isArray(feedback)) return null;
  const label = String(feedback.label || '').trim();
  if (!['useful', 'not_enough_evidence', 'incorrect'].includes(label)) return null;
  return {
    label,
    source: String(feedback.source || 'product-ui').trim() || 'product-ui',
    updatedAt: feedback.updatedAt || '',
  };
}

function sanitizeAgentTraceObject(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return JSON.parse(JSON.stringify(input));
}

function createAgentSessionId(isoTimestamp) {
  return `agent-session-${String(isoTimestamp || new Date().toISOString()).replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

function createAgentTraceId(isoTimestamp, tool, index) {
  const stamp = String(isoTimestamp || new Date().toISOString()).replace(/[-:.TZ]/g, '').slice(0, 17);
  const safeTool = String(tool || 'tool').replace(/[^a-z0-9_:-]/gi, '').slice(0, 32) || 'tool';
  return `trace-${stamp}-${safeTool}-${Number(index || 0) + 1}`;
}

async function buildCurrentMirrorPlan(options = {}) {
  const target = normalizeMirrorTarget(options.target || 'qq');
  const apple = prepareSnapshot(await readJsonIfExists(FILES.appleJson));
  const targetSnapshot = prepareSnapshot(await readJsonIfExists(targetSnapshotFile(target)));
  const reviewDecisions = await readMirrorDecisionState();
  if (!apple) throw new Error('缺少 Apple 快照，请先刷新 Apple Music 可信源。');
  if (!targetSnapshot) throw new Error(`缺少 ${targetLabel(target)} 快照，请先刷新目标平台。`);

  return buildMirrorSyncPlan({
    sourceSnapshot: apple,
    targetSnapshot,
    target,
    threshold: options.threshold ?? options.minScore,
    reviewThreshold: options.reviewThreshold,
    reviewDecisions,
  });
}

function summarizeSnapshotsForResult(snapshots) {
  return Object.fromEntries(
    Object.entries(snapshots || {}).map(([platform, snapshot]) => [platform, {
      skipped: Boolean(snapshot.skipped),
      reason: snapshot.reason || '',
      count: snapshot.tracks?.length || 0,
      fetchedAt: snapshot.fetchedAt || '',
      source: snapshot.source || '',
    }]),
  );
}

export async function resolveMirrorAdds(options = {}) {
  await ensureDirs();
  const plan = await readJsonIfExists(FILES.mirrorPlan);
  if (!plan) throw new Error('缺少 Apple 可信源镜像计划，请先生成 mirror plan。');
  const target = normalizeMirrorTarget(plan.target?.platform || options.target || 'qq');
  const cookie = target === 'qq'
    ? await readTextIfExists(FILES.qqCookie)
    : await readTextIfExists(FILES.neteaseCookie);
  if (!cookie?.trim()) throw new Error(`缺少 ${targetLabel(target)} cookie，请先登录。`);

  const resolved = await resolveMirrorAddOperations(plan, {
    threshold: options.threshold ?? options.minScore,
    reviewThreshold: options.reviewThreshold,
    limit: options.limit,
    offset: options.offset,
    searchLimit: options.searchLimit,
    searchTracks: (query, searchOptions) => (
      target === 'qq'
        ? searchQQTracks(cookie, query, searchOptions)
        : searchNeteaseTracks(cookie, query, searchOptions)
    ),
  });
  await writeJson(FILES.mirrorPlan, resolved);
  return resolved;
}

export async function runMirrorSyncPlan(options = {}) {
  await ensureDirs();
  const plan = await readJsonIfExists(FILES.mirrorPlan);
  if (!plan) throw new Error('缺少 Apple 可信源镜像计划，请先生成 mirror plan。');
  const target = normalizeMirrorTarget(plan.target?.platform || options.target || 'qq');
  const dryRun = options.dryRun !== false;
  const cookie = target === 'qq'
    ? await readTextIfExists(FILES.qqCookie)
    : await readTextIfExists(FILES.neteaseCookie);
  const playlistId = String(options.playlistId || plan.target?.playlistId || '').trim();
  const actions = Array.isArray(options.actions) ? options.actions : [];
  const identity = buildMirrorRunIdentity(plan, {
    actions,
    playlistId,
  });

  if (!dryRun && !options.force) {
    const completed = findMirrorRunByIdempotency(await readMirrorRunLog(), identity.idempotencyKey, ['completed']);
    if (completed) {
      return duplicateMirrorRunResult(completed, identity);
    }
  }

  let checkpoint = null;
  if (!dryRun) {
    const interrupted = findMirrorRunByIdempotency(await readMirrorRunLog(), identity.idempotencyKey, ['running', 'failed']);
    const preview = await executeMirrorSyncPlan(plan, {
      dryRun: true,
      actions,
      playlistId,
      runId: interrupted?.runId || identity.runId,
      idempotencyKey: identity.idempotencyKey,
    });
    checkpoint = await startMirrorRun(preview, {
      resumeOf: interrupted?.runId || '',
      previousStatus: interrupted?.status || '',
    });
  }

  try {
    const result = await executeMirrorSyncPlan(plan, {
      dryRun,
      actions,
      confirmText: options.confirmText,
      playlistId,
      batchSize: options.batchSize,
      runId: checkpoint?.runId || identity.runId,
      idempotencyKey: identity.idempotencyKey,
      addTracks: async ({ tracks, batchSize }) => {
        if (!cookie?.trim()) throw new Error(`缺少 ${targetLabel(target)} cookie，请先登录。`);
        if (!playlistId) throw new Error(`缺少 ${targetLabel(target)} 目标歌单 ID，不能执行新增。`);
        if (target === 'qq') {
          return addQQTracksToPlaylist(cookie, playlistId, tracks, { batchSize });
        }
        return addNeteaseTracksToPlaylist(cookie, playlistId, tracks.map((track) => track.id), { batchSize });
      },
      removeTracks: async ({ tracks, batchSize }) => {
        if (!cookie?.trim()) throw new Error(`缺少 ${targetLabel(target)} cookie，请先登录。`);
        if (!playlistId) throw new Error(`缺少 ${targetLabel(target)} 目标歌单 ID，不能执行删除。`);
        if (target === 'qq') {
          return removeQQTracksFromPlaylist(cookie, playlistId, tracks, { batchSize });
        }
        return removeNeteaseTracksFromPlaylist(cookie, playlistId, tracks.map((track) => track.id), { batchSize });
      },
    });
    await appendMirrorRun({
      ...result,
      status: 'completed',
      resumed: Boolean(checkpoint?.resumeOf),
      resumeOf: checkpoint?.resumeOf || '',
      startedAt: checkpoint?.startedAt || result.generatedAt,
      completedAt: new Date().toISOString(),
    });
    return {
      ...result,
      status: 'completed',
      resumed: Boolean(checkpoint?.resumeOf),
      resumeOf: checkpoint?.resumeOf || '',
    };
  } catch (error) {
    if (checkpoint) {
      await failMirrorRun(checkpoint, error);
    }
    throw error;
  }
}

export async function saveMirrorDecision(input = {}) {
  await ensureDirs();
  const key = String(input.key || '').trim();
  if (!key) throw new Error('缺少镜像复核条目 ID');
  const action = normalizeMirrorDecisionInputAction(input.action);
  const decisions = await readMirrorDecisionState();
  const currentPlan = await readJsonIfExists(FILES.mirrorPlan);
  const target = normalizeMirrorTarget(currentPlan?.target?.platform || input.target || input.planTarget || 'qq');
  const now = new Date().toISOString();
  applyMirrorDecision(decisions, { ...input, key, target }, action, now);
  decisions.updatedAt = now;
  await writeJson(FILES.mirrorDecisions, decisions);

  const plan = await rebuildMirrorPlanAfterDecision(target, currentPlan);

  return {
    decisions: summarizeMirrorDecisions(decisions),
    item: decisions.items[key] || null,
    plan,
  };
}

export async function saveMirrorDecisionBatch(input = {}) {
  await ensureDirs();
  const action = normalizeMirrorDecisionInputAction(input.action);
  const items = normalizeMirrorDecisionBatchItems(input.items);
  const decisions = await readMirrorDecisionState();
  const currentPlan = await readJsonIfExists(FILES.mirrorPlan);
  const target = normalizeMirrorTarget(currentPlan?.target?.platform || input.target || 'qq');
  const now = new Date().toISOString();
  const batchId = `mirror-decision-batch-${now.replace(/[:.]/g, '-')}`;
  let changed = 0;

  for (const item of items) {
    const before = decisions.items[item.key];
    applyMirrorDecision(decisions, {
      ...item,
      action,
      target: item.target || target,
      batchId,
    }, action, now);
    const after = decisions.items[item.key];
    if (JSON.stringify(before || null) !== JSON.stringify(after || null)) {
      changed += 1;
    }
  }

  decisions.updatedAt = now;
  await writeJson(FILES.mirrorDecisions, decisions);
  const plan = await rebuildMirrorPlanAfterDecision(target, currentPlan);

  return {
    batchId,
    requested: items.length,
    changed,
    action,
    decisions: summarizeMirrorDecisions(decisions),
    plan,
  };
}

export async function generateMirrorAiSuggestions(options = {}) {
  await ensureDirs();
  if (!options.consent) {
    throw new Error('Need consent before sending mirror review candidates to DeepSeek.');
  }
  const plan = await readJsonIfExists(FILES.mirrorPlan);
  if (!plan) throw new Error('Missing Apple source-of-truth mirror plan. Generate a mirror plan first.');
  const decisions = await readMirrorDecisionState();
  const suggestions = await readMirrorAiSuggestionState();
  const limit = Math.min(50, Math.max(1, Number(options.aiLimit || options.batchSize || 12)));
  const includeSuggested = Boolean(options.refresh || options.includeSuggested);
  const eligibleOperations = (plan.operations || [])
    .filter((operation) => operation.action === 'review' && operation.decisionKey)
    .filter((operation) => !decisions.items[operation.decisionKey]);
  const pendingOperations = eligibleOperations
    .filter((operation) => includeSuggested || !suggestions.items[operation.decisionKey]);
  const operations = pendingOperations.slice(0, limit);
  if (!operations.length) throw new Error('No mirror review candidates are pending for AI review.');

  const aiProvider = await resolveWorkflowAiProvider(options);
  const result = await requestDeepSeekMirrorReview({
    apiKey: aiProvider.apiKey,
    model: aiProvider.model,
    operations,
    thinking: options.thinking !== false,
    baseUrl: aiProvider.baseUrl,
  });
  const now = new Date().toISOString();
  for (const decision of result.decisions) {
    const key = decision.decisionKey || decision.itemId;
    if (!key) continue;
    suggestions.items[key] = {
      ...decision,
      batchId: result.batchId,
      model: result.model,
      updatedAt: now,
    };
  }
  suggestions.updatedAt = now;
  suggestions.batches.unshift({
    batchId: result.batchId,
    model: result.model,
    reviewedAt: result.reviewedAt,
    itemCount: operations.length,
    decisionCount: result.decisions.length,
    usage: result.usage,
  });
  suggestions.batches = suggestions.batches.slice(0, 50);
  await writeJson(FILES.mirrorAiSuggestions, suggestions);

  return {
    batchId: result.batchId,
    model: result.model,
    total: pendingOperations.length,
    eligibleTotal: eligibleOperations.length,
    itemCount: operations.length,
    decisionCount: result.decisions.length,
    remaining: Math.max(0, pendingOperations.length - operations.length),
    suggestions: summarizeMirrorAiSuggestions(suggestions),
    plan,
  };
}

export async function applyMirrorAiSuggestions(options = {}) {
  await ensureDirs();
  const currentPlan = await readJsonIfExists(FILES.mirrorPlan);
  if (!currentPlan) throw new Error('Missing Apple source-of-truth mirror plan. Generate a mirror plan first.');
  const suggestions = await readMirrorAiSuggestionState();
  const decisions = await readMirrorDecisionState();
  const target = normalizeMirrorTarget(currentPlan.target?.platform || options.target || 'qq');
  const threshold = normalizeApplyThreshold(options.threshold ?? 0.9);
  const overwrite = Boolean(options.overwrite);
  const now = new Date().toISOString();
  const stats = {
    threshold,
    overwrite,
    totalSuggestions: 0,
    eligible: 0,
    applied: 0,
    kept: 0,
    separated: 0,
    skippedLowConfidence: 0,
    skippedNeedsHuman: 0,
    skippedExisting: 0,
  };

  for (const [key, suggestion] of Object.entries(suggestions.items || {})) {
    if ((suggestion.target || target) !== target) continue;
    stats.totalSuggestions += 1;
    const confidence = Number(suggestion.confidence || 0);
    if (!Number.isFinite(confidence) || confidence < threshold) {
      stats.skippedLowConfidence += 1;
      continue;
    }
    const action = mirrorAiActionToDecision(suggestion.recommendedAction);
    if (!action) {
      stats.skippedNeedsHuman += 1;
      continue;
    }
    stats.eligible += 1;
    if (decisions.items[key] && !overwrite) {
      stats.skippedExisting += 1;
      continue;
    }
    decisions.items[key] = {
      key,
      action,
      target,
      operationId: suggestion.operationId || '',
      reason: suggestion.reasonCode || 'mirror_ai',
      note: suggestion.reason || '',
      aiAppliedAt: now,
      batchId: suggestion.batchId || '',
      decidedAt: decisions.items[key]?.decidedAt || now,
      updatedAt: now,
    };
    stats.applied += 1;
    if (action === 'keep') stats.kept += 1;
    if (action === 'separate') stats.separated += 1;
  }

  if (stats.applied) {
    decisions.updatedAt = now;
    await writeJson(FILES.mirrorDecisions, decisions);
  }

  return {
    ...stats,
    decisions: summarizeMirrorDecisions(decisions),
    suggestions: summarizeMirrorAiSuggestions(suggestions),
    plan: stats.applied
      ? await rebuildMirrorPlanAfterDecision(target, currentPlan)
      : currentPlan,
  };
}

function applyMirrorDecision(decisions, input, action, now) {
  const key = String(input.key || '').trim();
  if (!key) throw new Error('缺少镜像复核条目 ID');
  if (action === 'clear') {
    delete decisions.items[key];
    return;
  }
  const entry = {
    key,
    action,
    target: normalizeMirrorTarget(input.target || input.planTarget || 'qq'),
    operationId: String(input.operationId || ''),
    reason: String(input.reason || ''),
    note: String(input.note || '').slice(0, 500),
    decidedAt: decisions.items[key]?.decidedAt || now,
    updatedAt: now,
  };
  if (input.batchId) entry.batchId = String(input.batchId);
  decisions.items[key] = entry;
}

function normalizeMirrorDecisionBatchItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('缺少镜像复核批量条目。');
  if (items.length > 200) throw new Error('单次最多批量处理 200 个镜像复核条目。');
  return items.map((item, index) => {
    const key = String(item?.key || '').trim();
    if (!key) throw new Error(`第 ${index + 1} 个镜像复核条目缺少 ID。`);
    return {
      key,
      target: item.target,
      operationId: item.operationId,
      reason: item.reason,
      note: item.note,
    };
  });
}

async function rebuildMirrorPlanAfterDecision(targetHint, currentPlan = null) {
  currentPlan ||= await readJsonIfExists(FILES.mirrorPlan);
  const target = normalizeMirrorTarget(currentPlan?.target?.platform || targetHint || 'qq');
  return generateMirrorSyncPlan({
    target,
    threshold: currentPlan?.thresholds?.match,
    reviewThreshold: currentPlan?.thresholds?.review,
  });
}

export async function runNeteaseWrite(options = {}) {
  return runPlatformWrite({ ...options, target: 'netease' });
}

export async function runPlatformWrite(options = {}) {
  await ensureDirs();
  const target = String(options.target || 'netease').trim();
  if (!['netease', 'qq', 'apple'].includes(target)) {
    throw new Error('当前只支持写入网易云、QQ 音乐或 Apple Music');
  }
  const unified = await readJsonIfExists(FILES.unifiedJson);
  const decisions = await readDecisionState();
  const syncDecisions = await readSyncDecisionState();
  const aiSuggestions = await readSyncAiSuggestionState();
  const cookie = target === 'apple'
    ? ''
    : target === 'qq'
    ? await readTextIfExists(FILES.qqCookie)
    : await readTextIfExists(FILES.neteaseCookie);
  const previousPlan = await readJsonIfExists(FILES.writePlan);
  const targetSnapshot = prepareSnapshot(await readJsonIfExists(targetSnapshotFile(target)));
  const executeWrite = target === 'apple'
    ? executeAppleWrite
    : target === 'qq'
    ? executeQQWrite
    : executeNeteaseWrite;
  const result = await executeWrite({
    unified,
    decisions,
    syncDecisions,
    aiSuggestions,
    cookie,
    playlistId: options.playlistId,
    playlistName: options.playlistName,
    privacy: options.privacy,
    dryRun: options.dryRun,
    limit: options.limit,
    offset: options.offset,
    minScore: options.minScore,
    reviewScore: options.reviewScore,
    searchLimit: options.searchLimit,
    batchSize: options.batchSize,
    previousPlan,
    targetSnapshot,
    onProgress: options.onProgress,
  });
  const protectedPlan = choosePlanForStorage(result.plan, previousPlan);
  await backupWritePlan(previousPlan, options.dryRun ? 'dry-run-before-write' : 'write-before-write');
  await writeJson(FILES.writePlan, protectedPlan);
  result.plan = protectedPlan;
  await persistWritePlanErrors(result.plan, options.dryRun ? 'dry-run' : 'write');
  if (shouldRefreshAfterWrite(target, result, options)) {
    result.postWriteRefresh = await refreshAfterWrite({
      target,
      minScore: options.minScore,
      reviewScore: options.reviewScore,
      searchLimit: options.searchLimit,
      onProgress: options.onProgress,
    });
    if (result.postWriteRefresh?.plan) result.plan = result.postWriteRefresh.plan;
  }
  await appendWriteRun(result);
  return result;
}

function shouldRefreshAfterWrite(target, result, options = {}) {
  if (result?.dryRun) return false;
  if (result?.add?.missingIds?.length) return false;
  const playlistId = String(options.playlistId || result?.playlist?.id || '').trim();
  return target === 'qq' && playlistId === '201';
}

function targetSnapshotFile(target) {
  if (target === 'apple') return FILES.appleJson;
  if (target === 'qq') return FILES.qqJson;
  return FILES.neteaseJson;
}

function normalizeMirrorTarget(target) {
  const value = String(target || '').trim().toLowerCase();
  if (value === 'qq' || value === 'netease') return value;
  throw new Error('Apple 可信源镜像同步目前只支持 QQ 音乐或网易云目标。');
}

function normalizeLiveValidationProductTarget(target) {
  const value = String(target || '').trim().toLowerCase();
  if (value === 'qq' || value === 'netease') return value;
  throw productHttpError(400, 'Live validation target must be qq or netease.');
}

function targetLabel(target) {
  if (target === 'qq') return 'QQ 音乐';
  if (target === 'netease') return '网易云';
  if (target === 'apple') return 'Apple Music';
  return target || '目标平台';
}

async function refreshAfterWrite(options = {}) {
  const target = options.target;
  await notifyWriteRefreshProgress(options.onProgress, '刷新平台快照');
  const snapshots = await fetchPlatformSnapshots({
    qq: target === 'qq',
    netease: target === 'netease',
  });
  await notifyWriteRefreshProgress(options.onProgress, '重建统一曲库');
  const unified = await generateUnifiedLibrary({
    threshold: options.minScore,
    reviewThreshold: options.reviewScore,
  });
  await notifyWriteRefreshProgress(options.onProgress, '刷新写入计划');
  const plan = await generateWritePlan({
    target,
    resolve: true,
    minScore: options.minScore,
    reviewScore: options.reviewScore,
    searchLimit: options.searchLimit,
    onProgress: options.onProgress,
  });
  return {
    refreshedAt: new Date().toISOString(),
    snapshots: Object.fromEntries(Object.entries(snapshots).map(([platform, snapshot]) => [platform, {
      count: snapshot?.tracks?.length || 0,
      source: snapshot?.source || '',
      fetchedAt: snapshot?.fetchedAt || '',
    }])),
    unified: unified.summary || null,
    plan,
  };
}

async function notifyWriteRefreshProgress(callback, phase) {
  if (typeof callback !== 'function') return;
  await callback({
    phase,
    current: { title: phase },
  });
}

export async function saveSyncDecision(input = {}) {
  await ensureDirs();
  const key = String(input.key || '').trim();
  if (!key) throw new Error('缺少写入候选 ID');
  const action = normalizeSyncAction(input.action);
  const decisions = await readSyncDecisionState();
  const now = new Date().toISOString();
  decisions.items[key] = {
    key,
    action,
    target: String(input.target || 'netease'),
    clusterId: String(input.clusterId || ''),
    trackId: String(input.trackId || ''),
    manualReviewedAt: now,
    updatedAt: now,
  };
  decisions.updatedAt = now;
  await writeJson(FILES.syncDecisions, decisions);
  const aiSuggestions = await readSyncAiSuggestionState();
  const plan = await updateStoredWritePlanAnnotations(decisions, aiSuggestions);
  return {
    decisions: summarizeSyncDecisions(decisions),
    item: decisions.items[key],
    plan,
  };
}

export async function generateSyncAiSuggestions(options = {}) {
  await ensureDirs();
  if (!options.consent) {
    throw new Error('需要先确认会把低置信候选曲目信息发送到 DeepSeek。');
  }
  const syncDecisions = await readSyncDecisionState();
  const suggestions = await readSyncAiSuggestionState();
  const plan = await getCurrentResolvedWritePlan({
    target: options.target || 'netease',
    syncDecisions,
    aiSuggestions: suggestions,
    minScore: options.minScore,
    reviewScore: options.reviewScore,
    searchLimit: options.searchLimit,
  });
  const limit = Math.min(50, Math.max(1, Number(options.aiLimit || options.batchSize || 12)));
  const includeSuggested = Boolean(options.refresh || options.includeSuggested);
  const eligibleItems = (plan.items || [])
    .filter((item) => item.status === 'low_score' && item.decisionKey && item.match?.track?.id)
    .filter((item) => !syncDecisions.items[item.decisionKey]);
  const pendingItems = eligibleItems
    .filter((item) => includeSuggested || !suggestions.items[item.decisionKey]);
  const items = pendingItems.slice(0, limit);
  if (!items.length) throw new Error('当前写入计划里没有可交给 AI 判断的低置信候选。');

  const aiProvider = await resolveWorkflowAiProvider(options);
  const result = await requestDeepSeekSyncReview({
    apiKey: aiProvider.apiKey,
    model: aiProvider.model,
    items,
    thinking: options.thinking !== false,
    baseUrl: aiProvider.baseUrl,
  });
  const now = new Date().toISOString();
  for (const decision of result.decisions) {
    const key = decision.decisionKey || decision.itemId;
    suggestions.items[key] = {
      ...decision,
      batchId: result.batchId,
      model: result.model,
      updatedAt: now,
    };
  }
  suggestions.updatedAt = now;
  suggestions.batches.unshift({
    batchId: result.batchId,
    model: result.model,
    reviewedAt: result.reviewedAt,
    itemCount: items.length,
    decisionCount: result.decisions.length,
    usage: result.usage,
  });
  suggestions.batches = suggestions.batches.slice(0, 50);
  await writeJson(FILES.syncAiSuggestions, suggestions);

  return {
    batchId: result.batchId,
    model: result.model,
    total: pendingItems.length,
    eligibleTotal: eligibleItems.length,
    itemCount: items.length,
    decisionCount: result.decisions.length,
    remaining: Math.max(0, pendingItems.length - items.length),
    suggestions: summarizeSyncAiSuggestions(suggestions),
    plan: await updateStoredWritePlanAnnotations(syncDecisions, suggestions, plan),
  };
}

export async function applySyncAiSuggestions(options = {}) {
  await ensureDirs();
  const suggestions = await readSyncAiSuggestionState();
  const decisions = await readSyncDecisionState();
  const threshold = normalizeApplyThreshold(options.threshold);
  const overwrite = Boolean(options.overwrite);
  const now = new Date().toISOString();
  const stats = {
    threshold,
    overwrite,
    totalSuggestions: 0,
    eligible: 0,
    applied: 0,
    accepted: 0,
    rejected: 0,
    skippedLowConfidence: 0,
    skippedNeedsHuman: 0,
    skippedExisting: 0,
  };

  for (const [key, suggestion] of Object.entries(suggestions.items || {})) {
    stats.totalSuggestions += 1;
    const confidence = Number(suggestion.confidence || 0);
    if (!Number.isFinite(confidence) || confidence < threshold) {
      stats.skippedLowConfidence += 1;
      continue;
    }
    const action = syncAiActionToDecision(suggestion.recommendedAction);
    if (!action) {
      stats.skippedNeedsHuman += 1;
      continue;
    }
    stats.eligible += 1;
    if (decisions.items[key] && !overwrite) {
      stats.skippedExisting += 1;
      continue;
    }
    decisions.items[key] = {
      key,
      action,
      target: suggestion.target || 'netease',
      clusterId: suggestion.clusterId || '',
      aiAppliedAt: now,
      updatedAt: now,
    };
    stats.applied += 1;
    if (action === 'accept') stats.accepted += 1;
    if (action === 'reject') stats.rejected += 1;
  }

  if (stats.applied) {
    decisions.updatedAt = now;
    await writeJson(FILES.syncDecisions, decisions);
  }
  return {
    ...stats,
    decisions: summarizeSyncDecisions(decisions),
    plan: await updateStoredWritePlanAnnotations(decisions, suggestions),
  };
}

export async function getState() {
  await ensureDirs();
  const [apple, qq, netease, report, unified, decisions, suggestions, writePlan, mirrorPlan, mirrorRuns, mirrorDecisions, mirrorAiSuggestions, writeRuns, syncRuns, syncDecisions, syncAiSuggestions, syncErrors, appleCatalogCache, appleCookie, qqCookie, neteaseCookie] = await Promise.all([
    readJsonIfExists(FILES.appleJson),
    readJsonIfExists(FILES.qqJson),
    readJsonIfExists(FILES.neteaseJson),
    readJsonIfExists(FILES.reportJson),
    readJsonIfExists(FILES.unifiedJson),
    readDecisionState(),
    readAiSuggestionState(),
    readJsonIfExists(FILES.writePlan),
    readJsonIfExists(FILES.mirrorPlan),
    readJsonIfExists(FILES.mirrorRunLog),
    readMirrorDecisionState(),
    readMirrorAiSuggestionState(),
    readJsonIfExists(FILES.writeRunLog),
    readSyncRunLog(),
    readSyncDecisionState(),
    readSyncAiSuggestionState(),
    readSyncErrorState(),
    getAppleCatalogCacheStats(),
    readTextIfExists(FILES.appleCookie),
    readTextIfExists(FILES.qqCookie),
    readTextIfExists(FILES.neteaseCookie),
  ]);

  return {
    apple: summarizeSnapshot(prepareSnapshot(apple)),
    qq: summarizeSnapshot(prepareSnapshot(qq)),
    netease: summarizeSnapshot(prepareSnapshot(netease)),
    report: summarizeReport(report),
    unified: summarizeUnified(unified, decisions),
    decisions: summarizeDecisions(decisions),
    ai: {
      hasEnvKey: Boolean(process.env.DEEPSEEK_API_KEY),
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
      suggestions: summarizeAiSuggestions(suggestions),
    },
    sync: {
      ...summarizeSync(writePlan, writeRuns, syncRuns, syncDecisions, syncAiSuggestions, syncErrors),
      appleCatalogCache,
    },
    mirror: summarizeMirrorPlan(mirrorPlan, mirrorRuns, mirrorDecisions, mirrorAiSuggestions),
    hasAppleCookie: Boolean(appleCookie?.trim()),
    hasQqCookie: Boolean(qqCookie?.trim()),
    hasNeteaseCookie: Boolean(neteaseCookie?.trim()),
    paths: {
      dataDir: DATA_DIR,
      reportMd: FILES.reportMd,
      reportJson: FILES.reportJson,
      unifiedMd: FILES.unifiedMd,
      unifiedJson: FILES.unifiedJson,
      unifiedDecisions: FILES.unifiedDecisions,
      aiSuggestions: FILES.aiSuggestions,
      writePlan: FILES.writePlan,
      mirrorPlan: FILES.mirrorPlan,
      mirrorRunLog: FILES.mirrorRunLog,
      mirrorDecisions: FILES.mirrorDecisions,
      mirrorAiSuggestions: FILES.mirrorAiSuggestions,
      syncPolicy: FILES.syncPolicy,
      syncBaseline: FILES.syncBaseline,
      syncPreview: FILES.syncPreview,
      syncTombstones: FILES.syncTombstones,
      syncRuns: FILES.syncRuns,
      aiProviderState: FILES.aiProviderState,
      musicProfile: FILES.musicProfile,
      recommendationShortlists: FILES.recommendationShortlists,
      agentSessions: FILES.agentSessions,
      writePlanNetease: FILES.writePlanNetease,
      writeRunLog: FILES.writeRunLog,
      syncDecisions: FILES.syncDecisions,
      syncAiSuggestions: FILES.syncAiSuggestions,
      syncErrors: FILES.syncErrors,
    },
  };
}

async function appendWriteRun(result) {
  const data = await readJsonIfExists(FILES.writeRunLog);
  const runs = Array.isArray(data?.runs) ? data.runs : [];
  runs.unshift({
    ranAt: new Date().toISOString(),
    target: result.target || result.plan?.target || 'netease',
    dryRun: Boolean(result.dryRun),
    playlist: result.playlist,
    add: result.add,
    planSummary: result.plan?.summary || {},
  });
  await writeJson(FILES.writeRunLog, {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: runs.slice(0, 30),
  });
}

async function appendMirrorRun(result) {
  const log = await readMirrorRunLog();
  await writeMirrorRunLog(upsertMirrorRun(log.runs, mirrorRunEntry(result)));
}

async function appendProductSyncRun(result, options = {}) {
  const log = await readSyncRunLog();
  await writeSyncRunLog(upsertMirrorRun(log.runs, productSyncRunEntry(result, options)));
}

async function startMirrorRun(preview, options = {}) {
  const log = await readMirrorRunLog();
  const now = new Date().toISOString();
  const previous = log.runs.find((run) => run.runId && run.runId === preview.runId);
  const entry = mirrorRunEntry({
    ...preview,
    dryRun: false,
    status: 'running',
    ranAt: previous?.ranAt || now,
    startedAt: previous?.startedAt || now,
    completedAt: '',
    failedAt: '',
    resumed: Boolean(options.resumeOf),
    resumeOf: options.resumeOf || '',
    previousStatus: options.previousStatus || '',
    attempt: Number(previous?.attempt || 0) + 1,
  });
  await writeMirrorRunLog(upsertMirrorRun(log.runs, entry));
  return entry;
}

async function failMirrorRun(checkpoint, error) {
  const log = await readMirrorRunLog();
  const now = new Date().toISOString();
  const entry = mirrorRunEntry({
    ...checkpoint,
    status: 'failed',
    failedAt: now,
    completedAt: '',
    error: formatErrorMessage(error),
  });
  await writeMirrorRunLog(upsertMirrorRun(log.runs, entry));
}

async function readMirrorRunLog() {
  const data = await readJsonIfExists(FILES.mirrorRunLog);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    runs: Array.isArray(data?.runs) ? data.runs : [],
  };
}

async function writeMirrorRunLog(runs) {
  await writeJson(FILES.mirrorRunLog, {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: runs.slice(0, 30),
  });
}

async function readSyncRunLog() {
  const data = await readJsonIfExists(FILES.syncRuns);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    runs: Array.isArray(data?.runs) ? data.runs : [],
  };
}

async function readAiProviderState() {
  const data = await readJsonIfExists(FILES.aiProviderState);
  if (data) {
    assertValidState(validateAiProviderState(data), 'ai-provider-state');
    return data;
  }
  const fallback = sanitizeAiProviderConfig(resolveAiProviderConfig({}));
  return {
    version: 1,
    updatedAt: '',
    ...fallback,
  };
}

async function resolveWorkflowAiProvider(options = {}) {
  const state = await readAiProviderState();
  return resolveAiProviderConfig({
    ...state,
    ...options,
  });
}

async function writeSyncRunLog(runs) {
  const state = {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: runs.slice(0, 50),
  };
  assertValidState(validateSyncRunLogState(state), 'sync-runs');
  await writeJson(FILES.syncRuns, state);
}

function upsertMirrorRun(runs, entry) {
  const existingIndex = runs.findIndex((run) => entry.runId && run.runId === entry.runId);
  if (existingIndex === -1) return [entry, ...runs];
  return [
    entry,
    ...runs.slice(0, existingIndex),
    ...runs.slice(existingIndex + 1),
  ];
}

function findMirrorRunByIdempotency(log, idempotencyKey, statuses = []) {
  const wanted = new Set(statuses);
  return (log.runs || []).find((run) => (
    run.idempotencyKey
    && run.idempotencyKey === idempotencyKey
    && !run.dryRun
    && (!wanted.size || wanted.has(run.status || 'completed'))
  )) || null;
}

function duplicateMirrorRunResult(run, identity) {
  return {
    ...run,
    generatedAt: new Date().toISOString(),
    runId: run.runId || identity.runId,
    idempotencyKey: identity.idempotencyKey,
    operationKeys: run.operationKeys || identity.operationKeys,
    status: 'duplicate',
    skipped: true,
    duplicateOf: run.runId || identity.runId,
  };
}

function mirrorRunEntry(result) {
  const now = new Date().toISOString();
  const status = result.status || 'completed';
  return {
    runId: result.runId || '',
    idempotencyKey: result.idempotencyKey || '',
    status,
    ranAt: result.ranAt || result.startedAt || result.generatedAt || now,
    startedAt: result.startedAt || result.ranAt || result.generatedAt || now,
    completedAt: result.completedAt || (status === 'completed' ? now : ''),
    failedAt: result.failedAt || '',
    target: result.target || '',
    playlistId: result.playlistId || '',
    dryRun: Boolean(result.dryRun),
    resumed: Boolean(result.resumed),
    resumeOf: result.resumeOf || '',
    previousStatus: result.previousStatus || '',
    attempt: Number(result.attempt || 1),
    planGeneratedAt: result.planGeneratedAt || '',
    planSummary: result.planSummary || {},
    operationKeys: result.operationKeys || {},
    add: result.add || {},
    remove: result.remove || {},
    review: result.review || {},
    addResult: result.addResult || emptyMirrorMutationResult(),
    removeResult: result.removeResult || emptyMirrorMutationResult(),
    blocked: result.blocked || {},
    error: result.error || '',
  };
}

function productSyncRunEntry(result, options = {}) {
  const entry = mirrorRunEntry(result);
  return {
    ...entry,
    policy: options.policy || productPolicyFromPlanSource(result.planSource || result.source || ''),
    action: options.action || productSyncRunAction(result),
    previewId: options.previewId || result.previewId || '',
  };
}

function productSyncRunAction(result = {}) {
  const addRequested = Number(result.add?.requested || 0);
  const removeRequested = Number(result.remove?.requested || 0);
  if (removeRequested > 0 && addRequested === 0) return 'remove';
  return 'add';
}

function productPolicyFromPlanSource(source) {
  const value = typeof source === 'string' ? source : source?.source || '';
  const match = /^sync-policy:(.+)$/u.exec(value);
  return match?.[1] || '';
}

function emptyMirrorMutationResult() {
  return {
    requested: 0,
    submitted: 0,
    accepted: 0,
    added: 0,
    removed: 0,
    verified: false,
    batches: [],
  };
}

async function getCurrentResolvedWritePlan(options = {}) {
  const target = String(options.target || 'netease').trim();
  const syncDecisions = options.syncDecisions || await readSyncDecisionState();
  const aiSuggestions = options.aiSuggestions || await readSyncAiSuggestionState();
  const current = await readJsonIfExists(FILES.writePlan);
  if (isUsableResolvedWritePlan(current, target)) {
    return decorateWritePlan(current, syncDecisions, aiSuggestions);
  }
  return generateWritePlan({
    target,
    resolve: true,
    minScore: options.minScore,
    reviewScore: options.reviewScore,
    searchLimit: options.searchLimit,
  });
}

async function updateStoredWritePlanAnnotations(syncDecisions, aiSuggestions, plan = null) {
  const current = plan || await readJsonIfExists(FILES.writePlan);
  if (!current?.items?.length) return current;
  const decorated = decorateWritePlan(current, syncDecisions, aiSuggestions);
  await writeJson(FILES.writePlan, decorated);
  await persistWritePlanErrors(decorated, 'decorate');
  return decorated;
}

function isUsableResolvedWritePlan(plan, target = '') {
  return Boolean(
    plan
    && (!target || plan.target === target)
    && plan.resolve
    && Array.isArray(plan.items)
    && !plan.hasMore
    && (plan.items.length === (plan.totalQueue || plan.items.length))
    && !plan.items.some((item) => ['pending_search', 'searching', 'rate_limited', 'deferred', 'error'].includes(item.status))
  );
}

function mergeWritePlanWithPrevious(plan, previousPlan) {
  if (!plan?.items?.length || !previousPlan?.items?.length) return plan;
  if (plan.target !== previousPlan.target) return plan;
  if (shouldAccumulateWritePlanPage(plan, previousPlan)) {
    return accumulateWritePlanPage(plan, previousPlan);
  }
  const previousItems = new Map(
    previousPlan.items
      .filter(isResolvedWritePlanItem)
      .map((item) => [writePlanStableKey(item), item]),
  );
  if (!previousItems.size) return plan;

  const items = plan.items.map((item) => {
    if (!['deferred', 'rate_limited'].includes(item.status)) return item;
    const previous = previousItems.get(writePlanStableKey(item));
    return previous ? { ...previous } : item;
  });
  return {
    ...plan,
    summary: summarizePlanItems(items),
    items,
  };
}

function shouldAccumulateWritePlanPage(plan, previousPlan) {
  if (!sameWritePlanOptions(plan, previousPlan)) return false;
  const offset = Number(plan.offset || 0);
  return offset > 0 || (previousPlan.hasMore && previousPlan.items.length < (previousPlan.totalQueue || 0));
}

function sameWritePlanOptions(plan, previousPlan) {
  return samePlanNumber(plan.minScore, previousPlan.minScore)
    && samePlanNumber(plan.reviewScore, previousPlan.reviewScore)
    && samePlanNumber(plan.searchLimit, previousPlan.searchLimit);
}

function samePlanNumber(left, right) {
  const leftEmpty = left === undefined || left === null || left === '';
  const rightEmpty = right === undefined || right === null || right === '';
  if (leftEmpty && rightEmpty) return true;
  return Number(left) === Number(right);
}

function accumulateWritePlanPage(plan, previousPlan) {
  const entries = new Map();
  let ordinal = 0;
  for (const item of previousPlan.items || []) {
    entries.set(writePlanStableKey(item), {
      item,
      ordinal,
    });
    ordinal += 1;
  }
  for (const item of plan.items || []) {
    const key = writePlanStableKey(item);
    const previous = entries.get(key);
    entries.set(key, {
      item,
      ordinal: previous?.ordinal ?? ordinal,
    });
    if (!previous) ordinal += 1;
  }

  const items = [...entries.values()]
    .sort((left, right) => {
      const indexDiff = writePlanSortIndex(left.item, left.ordinal) - writePlanSortIndex(right.item, right.ordinal);
      return indexDiff || left.ordinal - right.ordinal;
    })
    .map((entry) => entry.item);
  const totalQueue = plan.totalQueue || previousPlan.totalQueue || items.length;
  return {
    ...plan,
    offset: 0,
    limit: items.length,
    hasMore: Boolean(plan.hasMore),
    accumulated: true,
    accumulatedAt: new Date().toISOString(),
    summary: summarizePlanItems(items),
    items,
  };
}

function writePlanSortIndex(item, fallback) {
  const index = Number(item?.queueIndex);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER + fallback;
}

function choosePlanForStorage(plan, previousPlan) {
  if (!previousPlan?.items?.length || !plan?.items?.length) return plan;
  if (plan.target !== previousPlan.target) return plan;
  const currentResolved = resolvedWritePlanCount(plan);
  const previousResolved = resolvedWritePlanCount(previousPlan);
  const currentPaused = (plan.summary?.rate_limited || 0) + (plan.summary?.deferred || 0);
  const currentErrors = plan.summary?.error || 0;
  const previousErrors = previousPlan.summary?.error || 0;
  if (currentPaused && currentErrors < previousErrors) {
    return plan;
  }
  if (currentPaused && currentResolved < previousResolved) {
    return {
      ...previousPlan,
      preservedAt: new Date().toISOString(),
      preservedReason: `新计划解析数 ${currentResolved} 少于旧计划 ${previousResolved}，已保留旧计划。`,
    };
  }
  return plan;
}

function resolvedWritePlanCount(plan) {
  const summary = plan?.summary || {};
  return (summary.ready || 0)
    + (summary.accepted || 0)
    + (summary.already_present || 0)
    + (summary.rejected || 0)
    + (summary.low_score || 0)
    + (summary.not_found || 0)
    + (summary.needs_review || 0)
    + (summary.excluded_by_decision || 0);
}

async function backupWritePlan(plan, reason) {
  if (!plan?.items?.length) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeJson(path.join(FILES.writePlanBackupsDir, `${timestamp}-${reason}.json`), plan);
}

function isResolvedWritePlanItem(item) {
  return ['ready', 'accepted', 'already_present', 'rejected', 'low_score', 'not_found', 'needs_review', 'excluded_by_decision'].includes(item?.status);
}

function writePlanStableKey(item) {
  const source = item.source?.track || {};
  const sourceIdentity = source.id || source.mid || `${item.title || ''}:${item.artist || ''}`;
  return [
    item.clusterId || '',
    item.source?.platform || '',
    sourceIdentity,
  ].join(':');
}

async function persistWritePlanErrors(plan, context) {
  if (!plan?.items?.length) return;
  const state = await readSyncErrorState();
  const now = new Date().toISOString();
  for (const item of plan.items) {
    const key = syncErrorKey(plan.target, item);
    if (item.status === 'error' || item.status === 'rate_limited') {
      const previous = state.items[key] || {};
      state.items[key] = {
        ...previous,
        key,
        target: plan.target,
        clusterId: item.clusterId || '',
        title: item.title || '',
        artist: item.artist || '',
        album: item.album || '',
        sourcePlatform: item.source?.platform || '',
        sourceId: item.source?.track?.id || item.source?.track?.mid || '',
        error: displaySyncError(item.error || item.statusText || '未知错误'),
        context,
        count: Number(previous.count || 0) + 1,
        firstSeenAt: previous.firstSeenAt || now,
        updatedAt: now,
        resolvedAt: '',
      };
    } else if (state.items[key] && !state.items[key].resolvedAt) {
      state.items[key] = {
        ...state.items[key],
        resolvedAt: now,
        updatedAt: now,
        lastResolvedStatus: item.status || '',
      };
    }
  }
  state.updatedAt = now;
  await writeJson(FILES.syncErrors, state);
}

function syncErrorKey(target, item) {
  const source = item.source?.track || {};
  const sourceIdentity = source.id || source.mid || `${item.title || ''}:${item.artist || ''}`;
  return [
    target || 'netease',
    item.clusterId || '',
    sourceIdentity,
  ].join(':');
}

function summarizeSync(plan, runs, policyRuns, decisions, aiSuggestions, errors) {
  return {
    plan: plan ? {
      exists: true,
      target: plan.target,
      generatedAt: plan.generatedAt,
      resolve: Boolean(plan.resolve),
      totalQueue: plan.totalQueue || 0,
      blockedClusters: plan.blockedClusters || 0,
      offset: plan.offset || 0,
      limit: plan.limit || 0,
      hasMore: Boolean(plan.hasMore),
      summary: plan.summary || {},
    } : { exists: false },
    lastRun: Array.isArray(runs?.runs) ? runs.runs[0] || null : null,
    lastPolicyRun: Array.isArray(policyRuns?.runs) ? policyRuns.runs[0] || null : null,
    policyRuns: summarizeSyncRunLog(policyRuns),
    decisions: summarizeSyncDecisions(decisions),
    aiSuggestions: summarizeSyncAiSuggestions(aiSuggestions),
    errors: summarizeSyncErrors(errors, plan),
  };
}

function summarizeSyncRunLog(runs) {
  const items = Array.isArray(runs?.runs) ? runs.runs : [];
  const last = items[0] || null;
  return {
    exists: items.length > 0,
    count: items.length,
    updatedAt: runs?.updatedAt || '',
    last,
    byAction: countActions(items.map((run) => ({ action: run.action || 'unknown' }))),
    byPolicy: countActions(items.map((run) => ({ action: run.policy || 'unknown' }))),
  };
}

function summarizeMirrorPlan(plan, runs, decisions, aiSuggestions) {
  if (!plan) return { exists: false };
  return {
    exists: true,
    mode: plan.mode || '',
    generatedAt: plan.generatedAt || '',
    source: plan.source || null,
    target: plan.target || null,
    thresholds: plan.thresholds || {},
    summary: plan.summary || {},
    convergence: plan.convergence || null,
    lastRun: Array.isArray(runs?.runs) ? runs.runs[0] || null : null,
    decisions: summarizeMirrorDecisions(decisions),
    aiSuggestions: summarizeMirrorAiSuggestions(aiSuggestions),
  };
}

function summarizeSnapshot(snapshot) {
  if (!snapshot) return { exists: false, count: 0 };
  const tracks = snapshot.tracks || [];
  return {
    exists: true,
    skipped: Boolean(snapshot.skipped),
    reason: snapshot.reason || '',
    source: snapshot.source || '',
    fetchedAt: snapshot.fetchedAt || '',
    metadataEnrichedAt: snapshot.metadataEnrichedAt || '',
    count: tracks.length,
    isrcCount: tracks.filter((track) => track.isrc).length,
    aliasCount: tracks.filter((track) => hasAliases(track.aliases)).length,
    musicbrainzCount: tracks.filter((track) => track.metadata?.musicbrainz?.status === 'ok').length,
  };
}

function summarizeReport(report) {
  if (!report) return { exists: false };
  return {
    exists: true,
    generatedAt: report.generatedAt,
    platforms: Object.fromEntries(
      Object.entries(report.platforms || {}).map(([platform, summary]) => [platform, {
        matched: summary.matched,
        review: summary.review,
        missing: summary.missing,
        totalPlatform: summary.totalPlatform,
      }]),
    ),
  };
}

function summarizeUnified(unified, decisions) {
  if (!unified) return { exists: false };
  return {
    exists: true,
    generatedAt: unified.generatedAt,
    totalUnified: unified.summary?.totalUnified || 0,
      allThree: unified.summary?.allThree || 0,
      only: unified.summary?.only || {},
      pairs: unified.summary?.pairs || {},
      missingByPlatform: unified.summary?.missingByPlatform || {},
      conflictClusters: unified.summary?.conflictClusters || 0,
      versionConflicts: unified.summary?.versionConflicts || 0,
      reviewCandidates: unified.summary?.reviewCandidates || 0,
      sourceCounts: unified.sourceCounts || {},
      workflow: summarizeUnifiedWorkflow(unified, decisions),
    };
}

function productPlatformState(platform, state) {
  const snapshot = state?.[platform] || {};
  const hasCredential = platform === 'apple'
    ? state?.hasAppleCookie || snapshot.exists
    : platform === 'qq'
    ? state?.hasQqCookie
    : state?.hasNeteaseCookie;
  return {
    id: platform,
    label: targetLabel(platform),
    state: platformConnectionState(platform, snapshot, hasCredential),
    trackCount: snapshot.count || 0,
    lastReadAt: snapshot.fetchedAt || '',
    capabilities: {
      read: platform === 'apple' ? Boolean(snapshot.exists) : Boolean(hasCredential),
      write: platform === 'qq' || platform === 'netease' ? Boolean(hasCredential) : false,
      playlistList: platform === 'qq',
    },
  };
}

function platformConnectionState(platform, snapshot, hasCredential) {
  if (snapshot?.skipped) return 'needs_attention';
  if (snapshot?.exists) return platform === 'apple' || hasCredential ? 'readable' : 'needs_attention';
  if (hasCredential) return platform === 'apple' ? 'readable' : 'writable';
  return 'not_connected';
}

function productSyncModeState(syncPolicy) {
  const id = syncPolicy?.policy || 'canonical_mirror';
  return {
    id,
    label: productPolicyLabel(id),
  };
}

function summarizeProductPreview(plan) {
  if (!plan) return { exists: false };
  return {
    exists: true,
    previewId: productPreviewId(plan),
    generatedAt: plan.generatedAt || '',
    mode: plan.policy || '',
    counts: productPreviewCounts(plan),
    blocked: productPreviewBlocked(plan),
    convergence: summarizeProductPreviewConvergence(plan.convergence),
  };
}

function summarizeProductPreviewConvergence(convergence) {
  if (!convergence) return { exists: false };
  return {
    exists: true,
    checked: Boolean(convergence.checked),
    skipped: Boolean(convergence.skipped),
    skippedReason: convergence.skippedReason || '',
    status: convergence.status || '',
    converged: Boolean(convergence.converged),
    refreshedAt: convergence.refreshedAt || convergence.checkedAt || '',
    refreshedTargets: Array.isArray(convergence.refreshedTargets)
      ? convergence.refreshedTargets
      : convergence.refreshedTarget && convergence.target
        ? [convergence.target]
        : [],
    target: convergence.target || '',
    previewId: convergence.previewId || '',
    counts: convergence.counts || {
      will_add: convergence.add || 0,
      needs_confirmation: convergence.review || 0,
      may_delete: convergence.remove || 0,
    },
    openOperations: Number(convergence.openOperations ?? (
      Number(convergence.add || 0) + Number(convergence.review || 0) + Number(convergence.remove || 0)
    )),
    error: convergence.error || '',
  };
}

function summarizeProductBaseline(baseline) {
  if (!baseline) return { exists: false };
  const platforms = Object.fromEntries(
    Object.entries(baseline.platforms || {}).map(([platform, entry]) => [platform, {
      platform,
      count: entry?.count || 0,
      source: entry?.source || '',
      fetchedAt: entry?.fetchedAt || '',
      playlistId: entry?.playlistId || null,
    }]),
  );
  return {
    exists: true,
    savedAt: baseline.savedAt || '',
    source: baseline.source || '',
    policy: baseline.policy || '',
    summary: baseline.summary || {},
    platforms,
  };
}

const PRODUCT_BASELINE_DIFF_EXAMPLE_LIMIT = 8;
const PRODUCT_BASELINE_DIFF_PLATFORM_EXAMPLE_LIMIT = 4;

function summarizeProductBaselineDiff(diff) {
  if (!diff) return { exists: false, status: 'missing_baseline', examples: [] };
  const platforms = Object.fromEntries(
    Object.entries(diff.platforms || {}).map(([platform, value]) => {
      const examples = summarizeBaselineDiffPlatformExamples(platform, value);
      return [platform, {
        platform,
        added: value.added?.length || 0,
        deleted: value.deleted?.length || 0,
        unchanged: value.unchanged || 0,
        examples,
      }];
    }),
  );
  return {
    exists: true,
    status: diff.status || '',
    baselineSavedAt: diff.baselineSavedAt || '',
    summary: diff.summary || {},
    platforms,
    examples: Object.values(platforms)
      .flatMap((platform) => platform.examples || [])
      .slice(0, PRODUCT_BASELINE_DIFF_EXAMPLE_LIMIT),
  };
}

function summarizeBaselineDiffPlatformExamples(platform, value = {}) {
  return [
    ...(Array.isArray(value.added) ? value.added : [])
      .slice(0, 2)
      .map((entry) => summarizeBaselineDiffExample(platform, 'added', entry)),
    ...(Array.isArray(value.deleted) ? value.deleted : [])
      .slice(0, 2)
      .map((entry) => summarizeBaselineDiffExample(platform, 'deleted', entry)),
  ].filter(Boolean).slice(0, PRODUCT_BASELINE_DIFF_PLATFORM_EXAMPLE_LIMIT);
}

function summarizeBaselineDiffExample(platform, action, entry = {}) {
  const track = entry?.track || {};
  const durationMs = Number(track.durationMs || 0);
  const recordingIds = Array.isArray(track.metadata?.musicbrainz?.recordingIds)
    ? track.metadata.musicbrainz.recordingIds
    : [];
  const evidence = [
    track.isrc || track.metadata?.musicbrainz?.isrc ? 'isrc' : '',
    recordingIds.length ? 'musicbrainz' : '',
    Number.isFinite(durationMs) && durationMs > 0 ? 'duration' : '',
  ].filter(Boolean);
  const artist = track.artist || (Array.isArray(track.artists) ? track.artists.filter(Boolean).join(' / ') : '');
  if (!track.title && !artist && !track.album) return null;
  return {
    platform,
    action,
    title: track.title || '',
    artist,
    album: track.album || '',
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null,
    evidence,
  };
}

function summarizeProductTombstones(tombstones) {
  const items = Object.values(tombstones?.items || {});
  return {
    updatedAt: tombstones?.updatedAt || '',
    total: items.length,
    confirmedGlobalDeletes: items.filter((item) => item.action === 'confirm_global_delete').length,
    actions: countActions(items),
  };
}

function summarizeProductSyncRuns(runs) {
  return {
    exists: Boolean(runs?.exists),
    count: runs?.count || 0,
    updatedAt: runs?.updatedAt || '',
    byAction: runs?.byAction || {},
    byPolicy: runs?.byPolicy || {},
  };
}

function summarizeProductSyncRun(run) {
  if (!run) return null;
  return {
    runId: run.runId || '',
    status: run.status || '',
    policy: run.policy || '',
    action: run.action || '',
    target: run.target || '',
    dryRun: Boolean(run.dryRun),
    ranAt: run.ranAt || '',
    completedAt: run.completedAt || '',
    add: {
      requested: run.add?.requested || 0,
      executable: run.add?.executable || 0,
      blocked: run.add?.blocked || 0,
      accepted: run.addResult?.accepted || 0,
      added: run.addResult?.added || 0,
    },
    remove: {
      requested: run.remove?.requested || 0,
      executable: run.remove?.executable || 0,
      blocked: run.remove?.blocked || 0,
      accepted: run.removeResult?.accepted || 0,
      removed: run.removeResult?.removed || 0,
    },
  };
}

function productNextAction(plan, syncPolicy) {
  if (!plan) return syncPolicy?.policy ? 'run_sync_check' : 'choose_sync_mode';
  const counts = productPreviewCounts(plan);
  if (counts.needs_confirmation > 0) return 'review_confirmation';
  if (counts.may_delete > 0) return 'confirm_deletions';
  if (counts.will_add > 0) return 'execute_additions';
  return 'up_to_date';
}

function productPreviewId(plan) {
  const stamp = String(plan?.generatedAt || '').replace(/[-:.TZ]/g, '').slice(0, 14) || 'latest';
  return `preview-${stamp}`;
}

function productPreviewCounts(plan) {
  const operations = plan?.operations || [];
  return {
    will_add: operations.filter((operation) => productBucketForOperation(operation) === 'will_add').length,
    will_keep: operations.filter((operation) => productBucketForOperation(operation) === 'will_keep').length,
    needs_confirmation: operations.filter((operation) => productBucketForOperation(operation) === 'needs_confirmation').length,
    may_delete: operations.filter((operation) => productBucketForOperation(operation) === 'may_delete').length,
  };
}

function productPreviewBlocked(plan) {
  return (plan?.operations || [])
    .filter((operation) => operation.status !== 'ready')
    .slice(0, 20)
    .map((operation) => ({
      id: operation.id,
      action: operation.action,
      status: operation.status,
      reason: operation.blockedReason || operation.reason || '',
      bucket: productBucketForOperation(operation),
    }));
}

function summarizeProductAddResolution(addResolution = {}, targets = []) {
  const targetEntries = Object.entries(addResolution?.targets || {});
  const summaries = targetEntries.map(([target, item]) => ({
    target,
    processed: Number(item.processed || 0),
    resolved: Number(item.resolved || 0),
    review: Number(item.review || 0),
    notFound: Number(item.notFound || 0),
    skipped: Boolean(item.skipped),
    reason: item.reason || '',
  }));
  const knownTargets = new Set(summaries.map((item) => item.target));
  for (const target of targets || []) {
    if (knownTargets.has(target)) continue;
    summaries.push({
      target,
      processed: 0,
      resolved: 0,
      review: 0,
      notFound: 0,
      skipped: true,
      reason: 'not_requested',
    });
  }
  return {
    resolvedAt: addResolution?.resolvedAt || '',
    targets: summaries,
    total: summaries.reduce((sum, item) => sum + item.processed, 0),
    resolved: summaries.reduce((sum, item) => sum + item.resolved, 0),
    review: summaries.reduce((sum, item) => sum + item.review, 0),
    notFound: summaries.reduce((sum, item) => sum + item.notFound, 0),
    skipped: summaries.filter((item) => item.skipped).length,
  };
}

function productPreviewItem(operation, options = {}) {
  const track = operation.sourceTrack || operation.targetTrack || operation.candidateTrack || {};
  const tombstoneDecision = productTombstoneDecisionForOperation(operation, options.tombstones);
  const resolvedTrack = operation.resolvedTargetTrack || operation.targetTrack || null;
  const candidateTrack = operation.candidateTrack || null;
  return {
    id: operation.id,
    bucket: productBucketForOperation(operation),
    action: operation.action,
    status: operation.status,
    destructive: Boolean(operation.destructive),
    title: track.title || '',
    artist: track.artist || (Array.isArray(track.artists) ? track.artists.join(', ') : ''),
    album: track.album || '',
    sourcePlatforms: [...new Set([operation.sourcePlatform, ...(operation.platforms || [])].filter(Boolean))],
    sourcePlatform: operation.sourcePlatform || '',
    targetPlatforms: [...new Set([operation.targetPlatform].filter(Boolean))],
    reason: operation.reason || '',
    message: operation.message || '',
    blockedReason: operation.blockedReason || '',
    evidence: productEvidenceForOperation(operation),
    score: operation.resolvedScore ?? operation.score ?? null,
    resolvedTarget: resolvedTrack ? productTrackSummary(resolvedTrack) : null,
    candidateTarget: candidateTrack ? productTrackSummary(candidateTrack) : null,
    resolution: operation.resolution ? {
      reason: operation.resolution.reason || '',
      message: operation.resolution.message || '',
    } : null,
    alternatives: Array.isArray(operation.alternatives) ? operation.alternatives.slice(0, 3).map(productTrackSummary) : [],
    addDecision: operation.addDecision ? {
      action: operation.addDecision.action || '',
      alternativeIndex: operation.addDecision.alternativeIndex ?? null,
      batchId: operation.addDecision.batchId || '',
      decidedAt: operation.addDecision.decidedAt || '',
    } : null,
    tombstoneKey: operation.tombstoneKey || '',
    tombstoneAction: tombstoneDecision?.action || '',
    tombstoneUpdatedAt: tombstoneDecision?.updatedAt || '',
  };
}

function productTrackSummary(track = {}) {
  return {
    platform: track.platform || '',
    id: track.id || '',
    mid: track.mid || '',
    title: track.title || '',
    artist: track.artist || (Array.isArray(track.artists) ? track.artists.join(', ') : ''),
    album: track.album || '',
    durationMs: track.durationMs || null,
    isrc: track.isrc || null,
  };
}

function findProductExplanationOperation(plan, options = {}) {
  const operationId = String(options.operationId || options.id || '').trim();
  const tombstoneKey = String(options.tombstoneKey || options.key || '').trim();
  const bucket = String(options.bucket || '').trim();
  return (plan.operations || []).find((operation) => (
    (operationId && operation.id === operationId)
    || (tombstoneKey && operation.tombstoneKey === tombstoneKey)
    || (bucket && productBucketForOperation(operation) === bucket)
  )) || null;
}

function buildProductExplanationEvidence(operation = {}, item = {}, tombstones = {}) {
  const sourceTrack = operation.sourceTrack || {};
  const targetTrack = operation.targetTrack || operation.candidateTrack || {};
  const tombstoneDecision = productTombstoneDecisionForOperation(operation, tombstones);
  const hasTargetTrack = Boolean(targetTrack.title || targetTrack.id || targetTrack.mid);
  return {
    operation: {
      id: operation.id || '',
      action: operation.action || '',
      status: operation.status || '',
      bucket: item.bucket || productBucketForOperation(operation),
      reason: operation.reason || '',
      message: operation.message || '',
      destructive: Boolean(operation.destructive),
      blockedReason: operation.blockedReason || '',
      score: operation.score ?? null,
    },
    platforms: {
      source: operation.sourcePlatform || sourceTrack.platform || '',
      target: operation.targetPlatform || targetTrack.platform || '',
      participants: operation.platforms || [],
    },
    sourceTrack: compactTrackForAi(operation.sourcePlatform || sourceTrack.platform || '', sourceTrack),
    targetTrack: hasTargetTrack
      ? compactTrackForAi(operation.targetPlatform || targetTrack.platform || '', targetTrack)
      : null,
    matchEvidence: hasTargetTrack ? buildMatchEvidence(sourceTrack, targetTrack, operation.score ?? null) : null,
    tombstone: operation.tombstoneKey ? {
      key: operation.tombstoneKey,
      action: tombstoneDecision?.action || '',
      platform: tombstoneDecision?.platform || operation.sourcePlatform || '',
      updatedAt: tombstoneDecision?.updatedAt || '',
    } : null,
  };
}

function deterministicProductExplanation(operation = {}, item = {}, evidence = {}) {
  const reason = operation.reason || '';
  if (reason === 'tombstone_candidate') {
    return {
      summary: '这是一个删除信号，不是自动全局删除。',
      risk: 'high',
      recommendedAction: 'review_tombstone',
      rationale: '系统只知道这首歌相对上次基线从某个平台消失了；这可能是用户只清理了单个平台，也可能是平台下架或匹配失败。',
      evidenceRefs: productExplanationEvidenceRefs(evidence),
    };
  }
  if (reason === 'confirmed_global_tombstone') {
    return {
      summary: '这条删除已经有全局删除确认，可以进入受控删除执行。',
      risk: 'high',
      recommendedAction: 'execute_confirmed_delete',
      rationale: '只有用户输入过全局删除确认后，managed 双向同步才会把删除传播到其他可写平台。',
      evidenceRefs: productExplanationEvidenceRefs(evidence),
    };
  }
  if (item.bucket === 'will_add') {
    return {
      summary: '这首歌会被补到缺失平台。',
      risk: operation.status === 'ready' ? 'low' : 'medium',
      recommendedAction: operation.status === 'ready' ? 'execute_addition' : 'resolve_before_add',
      rationale: operation.status === 'ready'
        ? '当前候选已经具备可写目标信息；新增仍会走单独执行路径。'
        : '新增前还需要解析目标平台曲目，避免把错误版本加入歌单。',
      evidenceRefs: productExplanationEvidenceRefs(evidence),
    };
  }
  if (item.bucket === 'needs_confirmation') {
    return {
      summary: '这条需要人工复核。',
      risk: 'medium',
      recommendedAction: 'review_manually',
      rationale: '确定性证据不足或存在版本/重复/冲突风险，系统不会自动合并或写入。',
      evidenceRefs: productExplanationEvidenceRefs(evidence),
    };
  }
  return {
    summary: '这条目前不需要操作。',
    risk: 'low',
    recommendedAction: 'keep',
    rationale: '当前预览认为它已经在参与平台中保持一致，或没有可执行变化。',
    evidenceRefs: productExplanationEvidenceRefs(evidence),
  };
}

function normalizeProductAiExplanation(raw = {}, fallback = {}) {
  const allowedActions = new Set([
    'review_tombstone',
    'execute_confirmed_delete',
    'execute_addition',
    'resolve_before_add',
    'review_manually',
    'keep',
  ]);
  const action = String(raw.recommended_action || raw.recommendedAction || '').trim();
  const risk = String(raw.risk || '').trim().toLowerCase();
  return {
    summary: String(raw.summary || fallback.summary || '').trim().slice(0, 240),
    risk: ['low', 'medium', 'high'].includes(risk) ? risk : fallback.risk || 'medium',
    recommendedAction: allowedActions.has(action) ? action : fallback.recommendedAction || 'review_manually',
    rationale: String(raw.rationale || raw.reason || fallback.rationale || '').trim().slice(0, 800),
    evidenceRefs: Array.isArray(raw.evidence_refs)
      ? raw.evidence_refs.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : fallback.evidenceRefs || [],
  };
}

function productExplanationEvidenceRefs(evidence = {}) {
  return [
    evidence.operation?.reason ? `reason:${evidence.operation.reason}` : '',
    evidence.operation?.score !== null && evidence.operation?.score !== undefined ? 'algorithm_score' : '',
    evidence.sourceTrack?.isrc ? 'source_isrc' : '',
    evidence.sourceTrack?.external_evidence?.musicbrainz ? 'source_musicbrainz' : '',
    evidence.matchEvidence?.support_signals?.length ? 'match_support_signals' : '',
    evidence.matchEvidence?.risk_signals?.length ? 'match_risk_signals' : '',
    evidence.tombstone?.key ? 'tombstone_decision' : '',
  ].filter(Boolean);
}

function sanitizeProductEvidenceForAgent(evidence = {}) {
  return {
    operation: evidence.operation || {},
    platforms: evidence.platforms || {},
    sourceTrack: sanitizeAgentEvidenceTrack(evidence.sourceTrack),
    targetTrack: sanitizeAgentEvidenceTrack(evidence.targetTrack),
    matchEvidence: evidence.matchEvidence || null,
    tombstone: evidence.tombstone
      ? {
        key: evidence.tombstone.key || '',
        action: evidence.tombstone.action || '',
        platform: evidence.tombstone.platform || '',
        updatedAt: evidence.tombstone.updatedAt || '',
      }
      : null,
  };
}

function sanitizeAgentEvidenceTrack(track = null) {
  if (!track) return null;
  const { id, mid, ...safeTrack } = track;
  return safeTrack;
}

function sanitizeAgentBaselineSummary(baseline = {}) {
  if (!baseline?.exists) return { exists: false };
  return {
    exists: true,
    savedAt: baseline.savedAt || '',
    source: baseline.source || '',
    policy: baseline.policy || '',
    summary: baseline.summary || {},
    platforms: Object.fromEntries(
      Object.entries(baseline.platforms || {}).map(([platform, entry]) => [platform, {
        platform,
        count: entry?.count || 0,
        source: entry?.source || '',
        fetchedAt: entry?.fetchedAt || '',
      }]),
    ),
  };
}

function normalizeAgentReviewBucket(value) {
  const bucket = String(value || '').trim().toLowerCase();
  if (bucket === 'may_delete' || bucket === 'delete' || bucket === 'deletion' || bucket === 'tombstone') return 'may_delete';
  if (bucket === 'needs_confirmation' || bucket === 'review' || bucket === 'confirmation') return 'needs_confirmation';
  return 'all';
}

function sanitizeAgentReviewQueueItem(item = {}) {
  return {
    operationId: item.id || '',
    bucket: item.bucket || '',
    action: item.action || '',
    status: item.status || '',
    destructive: Boolean(item.destructive),
    title: item.title || '',
    artist: item.artist || '',
    album: item.album || '',
    sourcePlatforms: item.sourcePlatforms || [],
    targetPlatforms: item.targetPlatforms || [],
    reason: item.reason || '',
    message: item.message || '',
    blockedReason: item.blockedReason || '',
    evidence: item.evidence || [],
    score: item.score ?? null,
    tombstoneAction: item.tombstoneAction || '',
    addDecision: item.addDecision ? { action: item.addDecision.action || '' } : null,
  };
}

const PRODUCT_EXPLANATION_SYSTEM_PROMPT = `
You explain a music sync preview item to an ordinary user. Use only the supplied JSON evidence. Do not browse, use outside music knowledge, or invent metadata.

Return strict JSON only:
{
  "summary": "short plain-language explanation",
  "risk": "low | medium | high",
  "recommended_action": "review_tombstone | execute_confirmed_delete | execute_addition | resolve_before_add | review_manually | keep",
  "rationale": "one concise paragraph grounded in supplied evidence",
  "evidence_refs": ["reason:tombstone_candidate"]
}

Rules:
1. Never recommend direct provider mutation. The product always requires preview, dry-run, and confirmation gates.
2. A tombstone candidate means a platform deletion signal against baseline; it is not proof of global deletion.
3. Confirmed global tombstones are still executed only by the controlled delete executor.
4. Missing ISRC or MusicBrainz is neutral. Different versions, duration risk, one-sided version wording, and weak evidence should be explained as reasons for manual review.
5. Keep explanations non-technical: avoid raw JSON, cookies, ids, API names, or internal file paths.
`;

const PRODUCT_PROFILE_SYSTEM_PROMPT = `
You generate a music taste profile summary for an ordinary user. Use only the supplied aggregate JSON evidence. Do not browse, use outside music knowledge, or invent genres, artists, or listening history.

Return strict JSON only:
{
  "summary": "one concise plain-language profile summary",
  "taste_tags": ["tag grounded in evidence"],
  "listening_patterns": ["observable pattern grounded in aggregates"],
  "recommendation_angles": ["direction for future recommendations"],
  "caveats": ["limits of the evidence"],
  "confidence": 0.72,
  "evidence_refs": ["top_artists"]
}

Rules:
1. The input is sanitized aggregate evidence, not a complete listening history.
2. Do not mention cookies, local file paths, raw snapshots, provider APIs, or private identifiers.
3. Do not recommend provider writes or playlist mutations.
4. If evidence is sparse, lower confidence and add a caveat.
5. Keep tags short and useful for recommendations.
`;

const PRODUCT_RECOMMENDATION_SYSTEM_PROMPT = `
You review local music recommendation candidates for an ordinary user. Use only the supplied JSON evidence. Do not browse, use outside music knowledge, or invent new songs.

Return strict JSON only:
{
  "summary": "one concise recommendation summary",
  "ranked_candidates": [
    {
      "key": "candidate key from input",
      "reason": "why this candidate fits the profile",
      "confidence": 0.74,
      "evidence_refs": ["candidate_reasons"]
    }
  ],
  "recommendation_angles": ["direction grounded in the profile"],
  "caveats": ["limits of the evidence"],
  "evidence_refs": ["profile_top_artists"]
}

Rules:
1. Rank only candidates present in the input. Do not create or rename songs.
2. Do not recommend provider writes, playlist mutations, or external searches.
3. Do not mention cookies, local file paths, raw snapshots, provider APIs, or private identifiers.
4. Prefer candidates with deterministic reasons that match the supplied profile evidence.
5. If evidence is sparse, lower confidence and add a caveat.
`;

const PRODUCT_TOMBSTONE_RISK_SYSTEM_PROMPT = `
You review a batch of music sync deletion signals for an ordinary user. Use only the supplied JSON evidence. Do not browse, use outside music knowledge, or invent metadata.

Return strict JSON only:
{
  "summary": "short plain-language batch summary",
  "groups": [
    {
      "id": "needs_review",
      "label": "short label",
      "risk": "low | medium | high",
      "description": "one sentence",
      "count": 1
    }
  ],
  "items": [
    {
      "operation_id": "operation id from input",
      "tombstone_key": "tombstone key from input",
      "risk": "low | medium | high",
      "group": "needs_review | confirmed_global_delete | restore_requested | current_platform_only | ignored",
      "recommended_action": "review_tombstone | execute_confirmed_delete | restore | current_platform_only | ignore",
      "summary": "one short sentence",
      "evidence_refs": ["reason:tombstone_candidate"]
    }
  ]
}

Rules:
1. Never recommend direct provider mutation. Deletion execution remains separate and confirmation-gated.
2. A tombstone candidate is a signal, not proof that the user intended global deletion.
3. Prefer review_tombstone for unresolved deletion signals.
4. Keep explanations non-technical: avoid raw JSON, cookies, ids, API names, or internal file paths.
`;

function clampPositiveInteger(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function productPolicyPlatformLabel(platform) {
  if (platform === 'apple') return 'Apple Music';
  if (platform === 'qq') return 'QQ 音乐';
  if (platform === 'netease') return '网易云音乐';
  return platform || '该平台';
}

function productTombstoneRiskItem(operation = {}, item = {}, evidence = {}, explanation = {}) {
  const action = item.tombstoneAction || evidence.tombstone?.action || '';
  const sourcePlatform = item.sourcePlatform || item.sourcePlatforms?.[0] || evidence.platforms?.source || '';
  const sourceLabel = productPolicyPlatformLabel(sourcePlatform);
  const base = {
    operationId: item.id || operation.id || '',
    tombstoneKey: item.tombstoneKey || operation.tombstoneKey || '',
    title: item.title || evidence.sourceTrack?.title || '',
    artist: item.artist || evidence.sourceTrack?.artist || '',
    sourcePlatform,
    sourceLabel,
    action,
    evidenceRefs: explanation.evidenceRefs || productExplanationEvidenceRefs(evidence),
    signals: productTombstoneRiskSignals(operation, item, evidence),
  };
  if (action === 'confirm_global_delete') {
    return {
      ...base,
      group: 'confirmed_global_delete',
      groupLabel: '已确认全局删除',
      risk: 'high',
      recommendedAction: 'execute_confirmed_delete',
      summary: '用户已确认全局删除，执行前仍会走受控删除入口。',
    };
  }
  if (action === 'restore') {
    return {
      ...base,
      group: 'restore_requested',
      groupLabel: '等待恢复',
      risk: 'medium',
      recommendedAction: 'restore',
      summary: `这首歌会优先尝试恢复到 ${sourceLabel}，暂不传播删除。`,
    };
  }
  if (action === 'current_platform_only') {
    return {
      ...base,
      group: 'current_platform_only',
      groupLabel: '仅当前平台',
      risk: 'low',
      recommendedAction: 'current_platform_only',
      summary: `删除被限制在 ${sourceLabel}，不会传播到其他平台。`,
    };
  }
  if (action === 'ignore') {
    return {
      ...base,
      group: 'ignored',
      groupLabel: '已忽略',
      risk: 'low',
      recommendedAction: 'ignore',
      summary: '这条删除信号已忽略，不会产生删除执行。',
    };
  }
  return {
    ...base,
    group: 'needs_review',
    groupLabel: '未处理高风险',
    risk: 'high',
    recommendedAction: 'review_tombstone',
    summary: `只知道它从 ${sourceLabel} 消失了，不能证明应该从所有平台删除。`,
  };
}

function productTombstoneRiskSignals(operation = {}, item = {}, evidence = {}) {
  return [
    operation.reason ? `reason:${operation.reason}` : '',
    item.tombstoneAction ? `decision:${item.tombstoneAction}` : 'decision:unhandled',
    item.sourcePlatform ? `source:${item.sourcePlatform}` : '',
    operation.destructive ? 'destructive_candidate' : '',
    evidence.sourceTrack?.isrc ? 'source_isrc' : '',
    evidence.sourceTrack?.external_evidence?.musicbrainz ? 'source_musicbrainz' : '',
  ].filter(Boolean);
}

function productTombstoneRiskSummary(items = [], plan = {}) {
  const groupOrder = ['needs_review', 'confirmed_global_delete', 'restore_requested', 'current_platform_only', 'ignored'];
  const groups = groupOrder
    .map((group) => {
      const groupItems = items.filter((item) => item.group === group);
      if (!groupItems.length) return null;
      const first = groupItems[0];
      return {
        id: group,
        label: first.groupLabel,
        risk: highestRisk(groupItems.map((item) => item.risk)),
        count: groupItems.length,
        description: tombstoneGroupDescription(group, groupItems.length),
      };
    })
    .filter(Boolean);
  return {
    previewId: productPreviewId(plan),
    generatedAt: new Date().toISOString(),
    total: items.length,
    summary: {
      unhandled: items.filter((item) => item.group === 'needs_review').length,
      confirmedGlobalDeletes: items.filter((item) => item.group === 'confirmed_global_delete').length,
      safeDecisions: items.filter((item) => ['current_platform_only', 'ignored'].includes(item.group)).length,
      restoreRequested: items.filter((item) => item.group === 'restore_requested').length,
      highestRisk: highestRisk(items.map((item) => item.risk)),
    },
    groups,
    items,
  };
}

function highestRisk(risks = []) {
  if (risks.includes('high')) return 'high';
  if (risks.includes('medium')) return 'medium';
  if (risks.includes('low')) return 'low';
  return 'none';
}

function tombstoneGroupDescription(group, count) {
  if (group === 'needs_review') return `${count} 条删除信号仍需人工判断，默认不传播到其他平台。`;
  if (group === 'confirmed_global_delete') return `${count} 条已经确认全局删除，但仍需通过受控删除执行。`;
  if (group === 'restore_requested') return `${count} 条会尝试恢复到发生删除信号的平台。`;
  if (group === 'current_platform_only') return `${count} 条已限定为只处理当前平台，不影响其他平台。`;
  if (group === 'ignored') return `${count} 条已忽略，不会进入写入计划。`;
  return `${count} 条删除信号。`;
}

function normalizeProductTombstoneRiskModelResponse(raw = {}, fallback = {}) {
  const allowedGroups = new Set(['needs_review', 'confirmed_global_delete', 'restore_requested', 'current_platform_only', 'ignored']);
  const allowedActions = new Set(['review_tombstone', 'execute_confirmed_delete', 'restore', 'current_platform_only', 'ignore']);
  const fallbackByKey = new Map((fallback.items || []).map((item) => [item.tombstoneKey, item]));
  const items = Array.isArray(raw.items)
    ? raw.items.map((rawItem) => {
      const key = String(rawItem?.tombstone_key || rawItem?.tombstoneKey || '').trim();
      const fallbackItem = fallbackByKey.get(key);
      if (!fallbackItem) return null;
      const group = String(rawItem.group || '').trim();
      const action = String(rawItem.recommended_action || rawItem.recommendedAction || '').trim();
      const risk = String(rawItem.risk || '').trim().toLowerCase();
      return {
        ...fallbackItem,
        risk: ['low', 'medium', 'high'].includes(risk) ? risk : fallbackItem.risk,
        group: allowedGroups.has(group) ? group : fallbackItem.group,
        recommendedAction: allowedActions.has(action) ? action : fallbackItem.recommendedAction,
        summary: String(rawItem.summary || fallbackItem.summary || '').trim().slice(0, 240),
        evidenceRefs: Array.isArray(rawItem.evidence_refs)
          ? rawItem.evidence_refs.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
          : fallbackItem.evidenceRefs,
      };
    }).filter(Boolean)
    : fallback.items || [];
  const normalized = productTombstoneRiskSummary(items, { previewId: fallback.previewId });
  return {
    summary: String(raw.summary || '').trim().slice(0, 360) || productTombstoneBatchSummary(normalized),
    groups: normalized.groups,
    items: normalized.items,
  };
}

function productTombstoneBatchSummary(result = {}) {
  const unhandled = Number(result.summary?.unhandled || 0);
  const confirmed = Number(result.summary?.confirmedGlobalDeletes || 0);
  if (unhandled && confirmed) return `${unhandled} 条未处理，${confirmed} 条已确认全局删除。`;
  if (unhandled) return `${unhandled} 条删除信号仍需人工判断。`;
  if (confirmed) return `${confirmed} 条删除信号已确认全局删除。`;
  if (result.total) return `${result.total} 条删除信号均已处理。`;
  return '当前没有删除信号。';
}

function productTombstoneDecisionForOperation(operation, tombstones) {
  if (!operation?.tombstoneKey) return null;
  return tombstones?.items?.[operation.tombstoneKey] || null;
}

function productBucketForOperation(operation) {
  if (operation.action === 'remove' || operation.reason === 'tombstone_candidate') return 'may_delete';
  if (operation.action === 'review' || operation.status === 'needs_review') return 'needs_confirmation';
  if (operation.action === 'add') return 'will_add';
  return 'will_keep';
}

function productEvidenceForOperation(operation) {
  return [
    operation.reason,
    operation.score !== null && operation.score !== undefined ? `score:${operation.score}` : '',
    operation.sourceTrack?.isrc ? 'isrc' : '',
    operation.sourceTrack?.metadata?.musicbrainz?.recordingIds?.length ? 'musicbrainz' : '',
  ].filter(Boolean);
}

function productPolicyLabel(policy) {
  if (policy === 'canonical_mirror') return '以 Apple Music 为准';
  if (policy === 'union_convergence') return '合并所有平台';
  if (policy === 'managed_bidirectional') return '自动同步新增，删除需确认';
  if (policy === 'read_only_analysis') return '只分析，不写入';
  return policy || '同步模式';
}

function productPolicyRisk(policy) {
  if (policy === 'read_only_analysis') return 'none';
  if (policy === 'union_convergence') return 'low';
  if (policy === 'canonical_mirror') return 'medium';
  return 'high';
}

function normalizeProductTargets(value) {
  const values = (Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(values.length ? values : ['qq'])];
  for (const target of unique) {
    if (target !== 'qq' && target !== 'netease') {
      throw new Error('普通用户同步写入目标目前只支持 QQ 音乐或网易云。');
    }
  }
  return unique;
}

function normalizeProductParticipants(value) {
  const values = (Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (!unique.length) throw new Error('至少需要选择一个平台。');
  for (const platform of unique) {
    if (!['apple', 'qq', 'netease'].includes(platform)) {
      throw new Error(`不支持的平台：${platform}`);
    }
  }
  return ['apple', 'qq', 'netease'].filter((platform) => unique.includes(platform));
}

async function readProductSnapshots() {
  return {
    apple: prepareSnapshot(await readJsonIfExists(FILES.appleJson)),
    qq: prepareSnapshot(await readJsonIfExists(FILES.qqJson)),
    netease: prepareSnapshot(await readJsonIfExists(FILES.neteaseJson)),
  };
}

function assertProductSnapshotsAvailable(snapshots, platforms) {
  const missing = platforms.filter((platform) => !snapshots?.[platform] || snapshots[platform].skipped);
  if (missing.length) {
    throw productHttpError(409, `保存同步基线前需要先读取平台快照：${missing.map(targetLabel).join('、')}。`);
  }
}

async function refreshProductPreviewFromPolicy(options = {}) {
  const policy = options.policyState || await readSyncPolicyState();
  if (!policy?.policy) return null;
  return generateProductSyncPreview({
    mode: policy.policy,
    source: policy.source?.platform || 'apple',
    targets: policy.targets || ['qq', 'netease'],
    platforms: policy.participants || ['apple', 'qq', 'netease'],
    deletionPolicy: policy.deletionPolicy || 'ask',
  });
}

function resolveProductTombstoneInput(options = {}, plan = null, tombstones = {}) {
  const action = String(options.action || options.tombstoneAction || '').trim().toLowerCase();
  if (!action) throw productHttpError(400, '缺少删除意图处理动作。');
  const operation = findProductTombstoneOperation(plan, options);
  const key = String(options.key || options.tombstoneKey || operation?.tombstoneKey || '').trim();
  if (!key) throw productHttpError(400, '缺少删除意图 ID。');
  const existing = tombstones?.items?.[key] || {};
  if (action === 'clear') {
    return {
      key,
      platform: existing.platform || operation?.sourcePlatform || 'apple',
      track: existing.track || operation?.sourceTrack || {},
    };
  }
  const platform = String(options.platform || operation?.sourcePlatform || existing.platform || '').trim();
  if (!platform) throw productHttpError(400, '缺少删除来源平台。');
  const rawTrack = options.track || operation?.sourceTrack || existing.track;
  const track = rawTrack && typeof rawTrack === 'object'
    ? { ...rawTrack, platform }
    : rawTrack;
  if (!track) throw productHttpError(400, '缺少删除意图对应歌曲。');
  return { key, platform, track };
}

function findProductTombstoneOperation(plan, options = {}) {
  const operationId = String(options.operationId || '').trim();
  const key = String(options.key || options.tombstoneKey || '').trim();
  return (plan?.operations || []).find((operation) => (
    (operationId && operation.id === operationId)
    || (key && operation.tombstoneKey === key)
  ));
}

async function assertProductExecutionPolicy() {
  const policy = await readJsonIfExists(FILES.syncPolicy);
  if (policy?.policy && policy.policy !== 'canonical_mirror') {
    throw productHttpError(409, `普通用户写入执行暂不支持 ${policy.policy}，请先切回 Apple Music 可信源模式。`);
  }
}

async function assertProductLiveValidationReady(targets, options = {}) {
  if (options.dryRun !== false || options.force === true) return null;
  const writableTargets = normalizeProductTargets(targets).filter((target) => target !== 'apple');
  if (!writableTargets.length) return null;
  const evidence = await getLiveValidationEvidence({ targets: writableTargets });
  const blocked = writableTargets
    .map((target) => evidence.targets?.[target])
    .filter((entry) => !entry?.ok);
  if (!blocked.length) return evidence;

  const detail = blocked.map((entry) => {
    const label = targetLabel(entry?.target || '');
    const status = entry?.status || 'missing';
    const reportFile = entry?.reportFile ? `，报告：${entry.reportFile}` : '';
    return `${label} ${status}${reportFile}`;
  }).join('；');
  throw productHttpError(
    409,
    `真实写入前需要先完成目标平台 live validation：${detail}。请运行 npm run validate:live 刷新一次性验证证据，或在确认风险后使用 force=true。`,
  );
}

async function resolveProductExecutionTargets(options = {}) {
  if (hasProductTargetInput(options.targets)) return normalizeProductTargets(options.targets);
  if (hasProductTargetInput(options.target)) return normalizeProductTargets(options.target);

  const policy = await readJsonIfExists(FILES.syncPolicy);
  if (hasProductTargetInput(policy?.targets)) return normalizeProductTargets(policy.targets);

  const plan = await readJsonIfExists(FILES.mirrorPlan);
  if (hasProductTargetInput(plan?.target?.platform)) return normalizeProductTargets(plan.target.platform);

  return ['qq'];
}

function hasProductTargetInput(value) {
  if (Array.isArray(value)) return value.some((item) => String(item || '').trim());
  return Boolean(String(value || '').trim());
}

async function generateProductMirrorPlanForTarget(target, options = {}) {
  const currentPlan = await readJsonIfExists(FILES.mirrorPlan);
  const syncPreview = await readJsonIfExists(FILES.syncPreview);
  return generateMirrorSyncPlan({
    target,
    threshold: options.threshold ?? options.minScore ?? syncPreview?.thresholds?.match ?? currentPlan?.thresholds?.match,
    reviewThreshold: options.reviewThreshold ?? syncPreview?.thresholds?.review ?? currentPlan?.thresholds?.review,
  });
}

function resolveProductPolicyExecutionTargets(options = {}, policyState = {}, plan = {}) {
  if (hasProductTargetInput(options.targets)) return normalizeProductTargets(options.targets);
  if (hasProductTargetInput(options.target)) return normalizeProductTargets(options.target);
  if (hasProductTargetInput(policyState.targets)) return normalizeProductTargets(policyState.targets);

  const planTargets = [...new Set((plan.operations || [])
    .map((operation) => operation.targetPlatform)
    .filter((platform) => platform === 'qq' || platform === 'netease'))];
  if (planTargets.length) return normalizeProductTargets(planTargets);

  const participants = Array.isArray(plan.participants) ? plan.participants : [];
  const writableParticipants = participants.filter((platform) => platform === 'qq' || platform === 'netease');
  if (writableParticipants.length) return normalizeProductTargets(writableParticipants);

  return ['qq'];
}

async function resolveProductPolicyAdditions(plan, options = {}) {
  const targets = normalizeProductTargets(options.targets || resolveProductPolicyExecutionTargets(options, {}, plan));
  let operations = (plan.operations || []).map((operation) => ({ ...operation }));
  const resolution = {
    resolvedAt: new Date().toISOString(),
    targets: {},
  };
  let changed = false;

  for (const target of targets) {
    const operationIds = productPolicyOperationIdsForTarget(options.operationIds, target);
    const selectedOperations = selectProductPolicyAddOperations(operations, target, operationIds)
      .filter(needsProductPolicyAddResolution);
    if (!selectedOperations.length) {
      resolution.targets[target] = {
        processed: 0,
        resolved: 0,
        review: 0,
        notFound: 0,
        skipped: false,
      };
      continue;
    }

    const cookie = target === 'qq'
      ? await readTextIfExists(FILES.qqCookie)
      : await readTextIfExists(FILES.neteaseCookie);
    if (!cookie?.trim()) {
      resolution.targets[target] = {
        processed: 0,
        resolved: 0,
        review: 0,
        notFound: 0,
        skipped: true,
        reason: 'missing_cookie',
      };
      continue;
    }

    const resolvePlan = buildProductPolicyAddMirrorPlan({
      ...plan,
      operations,
    }, target, {
      operationIds: selectedOperations.map((operation) => operation.id),
      playlistId: productTargetOptionValue(options.playlistId, target) || options.snapshots?.[target]?.playlistId || '',
      snapshot: options.snapshots?.[target],
    });
    const resolved = await resolveMirrorAddOperations(resolvePlan, {
      threshold: options.threshold ?? options.minScore ?? plan.thresholds?.match,
      reviewThreshold: options.reviewThreshold ?? plan.thresholds?.review,
      limit: options.resolveLimit || options.limit,
      searchLimit: options.searchLimit,
      searchTracks: (query, searchOptions) => (
        target === 'qq'
          ? searchQQTracks(cookie, query, searchOptions)
          : searchNeteaseTracks(cookie, query, searchOptions)
      ),
    });
    const resolvedById = new Map((resolved.operations || []).map((operation) => [operation.id, operation]));
    operations = operations.map((operation) => {
      const next = resolvedById.get(operation.id);
      if (!next) return operation;
      changed = true;
      return {
        ...operation,
        status: next.status,
        targetTrack: next.targetTrack || operation.targetTrack,
        candidateTrack: next.candidateTrack || operation.candidateTrack,
        resolvedTargetTrack: next.resolvedTargetTrack || operation.resolvedTargetTrack,
        resolvedScore: next.resolvedScore ?? operation.resolvedScore ?? null,
        resolution: next.resolution || operation.resolution,
        alternatives: next.alternatives || operation.alternatives || [],
      };
    });
    resolution.targets[target] = {
      processed: resolved.addResolution?.processed || 0,
      resolved: resolved.addResolution?.resolved || 0,
      review: resolved.addResolution?.review || 0,
      notFound: resolved.addResolution?.notFound || 0,
      skipped: false,
    };
  }

  if (!changed) {
    return {
      ...plan,
      addResolution: resolution,
    };
  }

  const nextPlan = {
    ...plan,
    resolvedAt: resolution.resolvedAt,
    addResolution: resolution,
    operations,
    summary: {
      ...summarizePolicyOperations(operations),
      baselineAdded: plan.summary?.baselineAdded || 0,
      baselineDeleted: plan.summary?.baselineDeleted || 0,
    },
  };
  assertValidState(validateSyncPreviewState(nextPlan), 'sync-preview');
  await writeJson(FILES.syncPreview, nextPlan);
  return nextPlan;
}

function needsProductPolicyAddResolution(operation = {}) {
  if (operation.action !== 'add') return false;
  if (operation.targetTrack || operation.resolvedTargetTrack) return false;
  return operation.status !== 'needs_review' && operation.status !== 'not_found' && operation.status !== 'blocked';
}

function applyProductAddDecisionToOperation(operation = {}, options = {}) {
  const decidedAt = options.decidedAt || new Date().toISOString();
  if (options.action === 'clear') {
    return {
      ...operation,
      status: operation.candidateTrack ? 'needs_review' : 'needs_resolution',
      resolvedTargetTrack: null,
      blockedReason: '',
      addDecision: {
        action: 'clear',
        batchId: options.batchId || '',
        decidedAt,
      },
      resolution: {
        ...(operation.resolution || {}),
        reason: operation.candidateTrack ? (operation.resolution?.reason || 'low_confidence_target_match') : 'decision_cleared',
        message: 'The manual add decision was cleared.',
      },
    };
  }
  if (options.action === 'skip') {
    return {
      ...operation,
      status: 'blocked',
      blockedReason: 'user_skipped_add_candidate',
      resolvedTargetTrack: null,
      addDecision: {
        action: 'skip',
        batchId: options.batchId || '',
        decidedAt,
      },
      resolution: {
        ...(operation.resolution || {}),
        reason: 'user_skipped_add_candidate',
        message: 'The user skipped this add candidate. It will not be written until re-resolved or accepted.',
      },
    };
  }

  const selectedTrack = productAddDecisionSelectedTrack(operation, options);
  if (!selectedTrack) {
    throw productHttpError(409, '这条新增候选还没有可接受的目标歌曲。');
  }
  return {
    ...operation,
    status: 'ready',
    resolvedTargetTrack: selectedTrack,
    targetTrack: operation.targetTrack || null,
    blockedReason: '',
    addDecision: {
      action: options.action,
      alternativeIndex: options.action === 'select_alternative' ? clampProductAlternativeIndex(options.alternativeIndex) : null,
      batchId: options.batchId || '',
      decidedAt,
    },
    resolution: {
      ...(operation.resolution || {}),
      reason: options.action === 'select_alternative' ? 'user_selected_alternative' : 'user_accepted_candidate',
      message: options.action === 'select_alternative'
        ? 'The user selected an alternative target-platform track for this add operation.'
        : 'The user accepted the target-platform candidate for this add operation.',
    },
  };
}

function productAddDecisionSelectedTrack(operation = {}, options = {}) {
  if (options.action === 'accept_candidate') {
    return operation.candidateTrack || operation.resolvedTargetTrack || operation.targetTrack || null;
  }
  const index = clampProductAlternativeIndex(options.alternativeIndex);
  return Array.isArray(operation.alternatives) ? operation.alternatives[index] || null : null;
}

function clampProductAlternativeIndex(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function buildProductPolicyAddMirrorPlan(plan = {}, target, options = {}) {
  const operationIds = new Set(normalizeOperationIds(options.operationIds));
  const operations = selectProductPolicyAddOperations(plan.operations || [], target, [...operationIds])
    .map(productPolicyAddOperationToMirrorOperation);
  const snapshot = options.snapshot || {};
  const targetPlan = {
    version: 1,
    mode: 'source_of_truth_mirror',
    generatedAt: plan.generatedAt || new Date().toISOString(),
    source: {
      platform: 'policy',
      source: `sync-policy:${plan.policy || ''}`,
      fetchedAt: plan.generatedAt || '',
      playlistId: null,
      userId: null,
      count: operations.length,
    },
    target: {
      platform: target,
      source: snapshot.source || '',
      fetchedAt: snapshot.fetchedAt || '',
      playlistId: options.playlistId || snapshot.playlistId || null,
      userId: snapshot.userId || null,
      count: snapshot.tracks?.length || 0,
    },
    thresholds: plan.thresholds || {},
    summary: {},
    operations,
  };
  return {
    ...targetPlan,
    summary: summarizeMirrorOperations(targetPlan.operations),
  };
}

function selectProductPolicyAddOperations(operations = [], target, operationIds = []) {
  const wanted = new Set(normalizeOperationIds(operationIds));
  return (operations || [])
    .filter((operation) => operation.action === 'add')
    .filter((operation) => operation.targetPlatform === target)
    .filter((operation) => !wanted.size || wanted.has(operation.id));
}

function selectProductPolicyRemoveOperations(operations = [], target, operationIds = []) {
  const wanted = new Set(normalizeOperationIds(operationIds));
  return (operations || [])
    .filter((operation) => operation.action === 'remove')
    .filter((operation) => operation.targetPlatform === target)
    .filter((operation) => operation.reason === 'confirmed_global_tombstone')
    .filter((operation) => operation.status === 'ready' || operation.blockedReason === 'missing_destructive_target_id')
    .filter((operation) => !wanted.size || wanted.has(operation.id));
}

function productPolicyAddOperationToMirrorOperation(operation = {}) {
  return {
    id: operation.id || '',
    action: 'add',
    status: operation.status || 'needs_resolution',
    destructive: false,
    reason: operation.reason || '',
    message: operation.message || '',
    confidence: operation.confidence || '',
    score: operation.resolvedScore ?? operation.score ?? null,
    sourceTrack: operation.sourceTrack || null,
    targetTrack: operation.targetTrack || null,
    candidateTrack: operation.candidateTrack || null,
    resolvedTargetTrack: operation.resolvedTargetTrack || null,
  };
}

function buildProductPolicyRemoveMirrorPlan(plan = {}, target, options = {}) {
  const operationIds = new Set(normalizeOperationIds(options.operationIds));
  const operations = selectProductPolicyRemoveOperations(plan.operations || [], target, [...operationIds])
    .map(productPolicyRemoveOperationToMirrorOperation);
  const snapshot = options.snapshot || {};
  const targetPlan = {
    version: 1,
    mode: 'source_of_truth_mirror',
    generatedAt: plan.generatedAt || new Date().toISOString(),
    source: {
      platform: 'policy',
      source: `sync-policy:${plan.policy || ''}`,
      fetchedAt: plan.generatedAt || '',
      playlistId: null,
      userId: null,
      count: operations.length,
    },
    target: {
      platform: target,
      source: snapshot.source || '',
      fetchedAt: snapshot.fetchedAt || '',
      playlistId: options.playlistId || snapshot.playlistId || null,
      userId: snapshot.userId || null,
      count: snapshot.tracks?.length || 0,
    },
    thresholds: plan.thresholds || {},
    summary: {},
    operations,
  };
  return {
    ...targetPlan,
    summary: summarizeMirrorOperations(targetPlan.operations),
  };
}

function productPolicyRemoveOperationToMirrorOperation(operation = {}) {
  return {
    id: operation.id || '',
    action: 'remove',
    status: operation.status || 'blocked',
    destructive: true,
    reason: operation.reason || '',
    message: operation.message || '',
    confidence: operation.confidence || '',
    score: operation.score ?? null,
    sourceTrack: operation.sourceTrack || null,
    targetTrack: operation.targetTrack || null,
    candidateTrack: operation.candidateTrack || null,
    resolvedTargetTrack: null,
  };
}

async function executeProductPolicyAddMirrorPlan(plan, options = {}, target) {
  const dryRun = options.dryRun !== false;
  const cookie = target === 'qq'
    ? await readTextIfExists(FILES.qqCookie)
    : await readTextIfExists(FILES.neteaseCookie);
  const playlistId = String(productTargetOptionValue(options.playlistId, target) || plan.target?.playlistId || '').trim();
  const result = await executeMirrorSyncPlan(plan, {
    dryRun,
    actions: ['add'],
    playlistId,
    batchSize: productTargetOptionValue(options.batchSize, target),
    addTracks: async ({ tracks, batchSize }) => {
      if (!cookie?.trim()) throw new Error(`Missing ${targetLabel(target)} cookie. Connect the platform before writing additions.`);
      if (!playlistId) throw new Error(`Missing ${targetLabel(target)} target playlist id. Cannot write additions.`);
      if (target === 'qq') {
        return addQQTracksToPlaylist(cookie, playlistId, tracks, { batchSize });
      }
      return addNeteaseTracksToPlaylist(cookie, playlistId, tracks.map((track) => track.id), { batchSize });
    },
  });
  const completed = {
    ...result,
    status: 'completed',
    completedAt: new Date().toISOString(),
  };
  await appendProductSyncRun(completed, {
    policy: productPolicyFromPlanSource(plan.source),
    action: 'add',
    previewId: productPreviewId(plan),
  });
  return completed;
}

async function executeProductPolicyRemoveMirrorPlan(plan, options = {}, target) {
  const dryRun = options.dryRun !== false;
  const cookie = target === 'qq'
    ? await readTextIfExists(FILES.qqCookie)
    : await readTextIfExists(FILES.neteaseCookie);
  const playlistId = String(productTargetOptionValue(options.playlistId, target) || plan.target?.playlistId || '').trim();
  const result = await executeMirrorSyncPlan(plan, {
    dryRun,
    actions: ['remove'],
    confirmText: expectedMirrorDeleteConfirmation(target),
    playlistId,
    batchSize: productTargetOptionValue(options.batchSize, target),
    removeTracks: async ({ tracks, batchSize }) => {
      if (!cookie?.trim()) throw new Error(`Missing ${targetLabel(target)} cookie. Connect the platform before writing deletions.`);
      if (!playlistId) throw new Error(`Missing ${targetLabel(target)} target playlist id. Cannot write deletions.`);
      if (target === 'qq') {
        return removeQQTracksFromPlaylist(cookie, playlistId, tracks, { batchSize });
      }
      return removeNeteaseTracksFromPlaylist(cookie, playlistId, tracks.map((track) => track.id), { batchSize });
    },
  });
  const completed = {
    ...result,
    status: 'completed',
    completedAt: new Date().toISOString(),
  };
  await appendProductSyncRun(completed, {
    policy: productPolicyFromPlanSource(plan.source),
    action: 'remove',
    previewId: productPreviewId(plan),
  });
  return completed;
}

async function attachProductPolicyConvergence(result, context = {}) {
  return {
    ...result,
    convergence: await refreshProductPolicyConvergence(result, context),
  };
}

async function refreshProductPolicyConvergence(result, context = {}) {
  const now = new Date().toISOString();
  if (result?.dryRun) {
    return persistProductPreviewConvergence(productPolicyConvergenceSkipped('dry_run', now));
  }
  if (context.options?.refreshAfterWrite === false) {
    return persistProductPreviewConvergence(productPolicyConvergenceSkipped('disabled', now));
  }
  if (!hasProductProviderMutationRequest(result, context.action)) {
    return persistProductPreviewConvergence(productPolicyConvergenceSkipped('no_executable_operations', now));
  }

  const targets = normalizeProductTargets(context.targets || result?.targetOrder || result?.target);
  try {
    const snapshots = await refreshProductPolicyTargetSnapshots(targets, result, context.options || {});
    const preview = await refreshProductPreviewFromPolicy({
      policyState: context.policyState,
    });
    const convergence = summarizeProductPolicyConvergence(preview, {
      refreshedAt: new Date().toISOString(),
      refreshedTargets: targets,
      snapshots,
    });
    await persistProductPreviewConvergence(convergence);
    return convergence;
  } catch (error) {
    return persistProductPreviewConvergence({
      checked: false,
      skipped: false,
      status: 'refresh_failed',
      refreshedAt: now,
      refreshedTargets: targets,
      error: formatErrorMessage(error),
    });
  }
}

async function persistProductPreviewConvergence(convergence) {
  const plan = await readJsonIfExists(FILES.syncPreview);
  if (!plan) return convergence;
  const next = {
    ...plan,
    convergence,
  };
  assertValidState(validateSyncPreviewState(next), 'sync-preview');
  await writeJson(FILES.syncPreview, next);
  return convergence;
}

function summarizeCanonicalProductConvergence(convergence = {}) {
  const add = Number(convergence.add || 0);
  const remove = Number(convergence.remove || 0);
  const review = Number(convergence.review || 0);
  return {
    checked: true,
    skipped: false,
    status: convergence.status || (add + remove + review === 0 ? 'converged' : 'open_delta'),
    converged: Boolean(convergence.converged),
    refreshedAt: convergence.checkedAt || new Date().toISOString(),
    refreshedTargets: convergence.refreshedTarget && convergence.target ? [convergence.target] : [],
    target: convergence.target || '',
    counts: {
      will_add: add,
      needs_confirmation: review,
      may_delete: remove,
    },
    openOperations: add + remove + review,
  };
}

function productPolicyConvergenceSkipped(reason, timestamp) {
  return {
    checked: false,
    skipped: true,
    skippedReason: reason,
    status: 'skipped',
    refreshedAt: timestamp,
    refreshedTargets: [],
  };
}

function hasProductProviderMutationRequest(result, action) {
  if (action === 'remove') {
    return Number(result?.remove?.executable || 0) > 0
      || Number(result?.removeResult?.requested || 0) > 0;
  }
  return Number(result?.add?.executable || 0) > 0
    || Number(result?.addResult?.requested || 0) > 0;
}

async function refreshProductPolicyTargetSnapshots(targets, result, options = {}) {
  const targetSet = new Set(normalizeProductTargets(targets).filter((target) => target !== 'apple'));
  if (!targetSet.size) return {};
  return fetchPlatformSnapshots({
    qq: targetSet.has('qq'),
    netease: targetSet.has('netease'),
    qqPlaylistId: productTargetOptionValue(options.playlistId, 'qq') || result?.targets?.qq?.playlistId || '',
    neteasePlaylistId: productTargetOptionValue(options.playlistId, 'netease') || result?.targets?.netease?.playlistId || '',
  });
}

function summarizeProductPolicyConvergence(preview, options = {}) {
  const plan = preview?.plan || preview;
  const counts = productPreviewCounts(plan);
  const openOperations = Number(counts.will_add || 0)
    + Number(counts.needs_confirmation || 0)
    + Number(counts.may_delete || 0);
  return {
    checked: true,
    skipped: false,
    status: openOperations === 0 ? 'converged' : 'open_delta',
    converged: openOperations === 0,
    refreshedAt: options.refreshedAt || new Date().toISOString(),
    refreshedTargets: options.refreshedTargets || [],
    previewId: preview?.previewId || productPreviewId(plan),
    generatedAt: preview?.generatedAt || plan?.generatedAt || '',
    mode: preview?.mode || plan?.policy || '',
    counts,
    openOperations,
    snapshots: summarizeSnapshotsForResult(options.snapshots || {}),
  };
}

function productRunOptionsForTarget(options = {}, target, action, operationIds = []) {
  return {
    ...options,
    target,
    targets: undefined,
    actions: [action],
    operationIds,
    playlistId: productTargetOptionValue(options.playlistId, target),
    batchSize: productTargetOptionValue(options.batchSize, target),
  };
}

function productTargetOptionValue(value, target) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value[target];
  return value;
}

function hasProductOperationFilter(operationIds) {
  if (Array.isArray(operationIds)) return normalizeOperationIds(operationIds).length > 0;
  if (operationIds && typeof operationIds === 'object') {
    return Object.values(operationIds).some((value) => normalizeOperationIds(value).length > 0);
  }
  return normalizeOperationIds(operationIds).length > 0;
}

function productOperationIdsForTarget(operationIds, target) {
  if (!hasProductOperationFilter(operationIds)) return [];
  const input = operationIds && typeof operationIds === 'object' && !Array.isArray(operationIds)
    ? operationIds[target]
    : operationIds;
  const prefix = `sync-${target}-`;
  const ids = [];
  for (const id of normalizeOperationIds(input)) {
    if (id.startsWith(prefix)) {
      ids.push(id.slice(prefix.length));
    } else if (!id.startsWith('sync-')) {
      ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function productPolicyOperationIdsForTarget(operationIds, target) {
  if (!hasProductOperationFilter(operationIds)) return [];
  const input = operationIds && typeof operationIds === 'object' && !Array.isArray(operationIds)
    ? operationIds[target]
    : operationIds;
  return [...new Set(normalizeOperationIds(input))];
}

function normalizeOperationIds(value) {
  if (Array.isArray(value)) {
    return value.map((id) => String(id || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function selectMirrorRemoveOperations(plan, operationIds = []) {
  const ids = Array.isArray(operationIds)
    ? operationIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const wanted = new Set(ids);
  return (plan.operations || [])
    .filter((operation) => operation.action === 'remove')
    .filter((operation) => !wanted.size || wanted.has(operation.id));
}

function productDeletionKey(target, operationId) {
  return `mirror-delete|${target}|${operationId}`;
}

function isProductDeletionConfirmed(tombstones, target, operationId) {
  const item = tombstones?.items?.[productDeletionKey(target, operationId)];
  return item?.action === 'confirm_global_delete';
}

function isProductPolicyDeletionConfirmed(tombstones, operation = {}) {
  if (operation.action !== 'remove') return false;
  if (operation.reason !== 'confirmed_global_tombstone') return false;
  if (!operation.tombstoneKey) return false;
  const item = tombstones?.items?.[operation.tombstoneKey];
  return item?.action === 'confirm_global_delete';
}

function expectedProductDeleteConfirmation(targets) {
  const targetList = normalizeProductTargets(targets);
  if (targetList.length > 1) return 'DELETE FROM SELECTED TARGETS';
  return `DELETE FROM ${targetList[0].toUpperCase()}`;
}

function expectedProductTombstoneConfirmation(platform) {
  return `CONFIRM GLOBAL DELETE FROM ${String(platform || '').trim().toUpperCase()}`;
}

function expectedMirrorDeleteConfirmation(target) {
  return `REMOVE ${String(target || '').trim().toUpperCase()}`;
}

function aggregateProductExecutionResults(results, options = {}) {
  const targetResults = Object.fromEntries(results.map((result) => [result.target || 'target', result]));
  const targetOrder = options.targets || results.map((result) => result.target).filter(Boolean);
  return {
    target: targetOrder.length === 1 ? targetOrder[0] : 'multi',
    targets: targetResults,
    targetOrder,
    action: options.action || '',
    dryRun: Boolean(options.dryRun),
    status: productAggregateStatus(results),
    generatedAt: new Date().toISOString(),
    runIds: results.map((result) => result.runId).filter(Boolean),
    idempotencyKeys: results.map((result) => result.idempotencyKey).filter(Boolean),
    add: sumProductNumericObject(results, 'add'),
    remove: sumProductNumericObject(results, 'remove'),
    review: sumProductNumericObject(results, 'review'),
    blocked: sumProductNumericObject(results, 'blocked'),
    addResult: sumProductNumericObject(results, 'addResult'),
    removeResult: sumProductNumericObject(results, 'removeResult'),
    results,
  };
}

function productAggregateStatus(results) {
  if (!results.length) return 'skipped';
  if (results.every((result) => result.status === 'skipped')) return 'skipped';
  if (results.some((result) => result.status === 'completed')) return 'completed';
  if (results.every((result) => result.status === 'preview' || result.dryRun)) return 'preview';
  return results[0]?.status || 'completed';
}

function sumProductNumericObject(results, key) {
  const summary = {};
  for (const result of results) {
    const value = result?.[key] || {};
    for (const [field, amount] of Object.entries(value)) {
      if (Number.isFinite(Number(amount))) {
        summary[field] = (summary[field] || 0) + Number(amount);
      }
    }
  }
  return summary;
}

function emptyProductExecutionResult(target, options = {}, skipReason = 'skipped') {
  const generatedAt = new Date().toISOString();
  return {
    runId: '',
    idempotencyKey: '',
    operationKeys: { add: [], remove: [], blockedAdd: [], blockedRemove: [], review: [] },
    playlistId: '',
    status: 'skipped',
    dryRun: options.dryRun !== false,
    target,
    generatedAt,
    planGeneratedAt: '',
    planSummary: {},
    add: { requested: 0, executable: 0, blocked: 0, reason: '' },
    remove: { requested: 0, executable: 0, blocked: 0, destructive: 0 },
    review: { blocked: 0 },
    addResult: emptyProductMutationResult(),
    removeResult: emptyProductMutationResult(),
    blocked: { unresolvedAdds: 0, invalidRemoves: 0, reviewItems: 0 },
    skipReason,
  };
}

function emptyProductMutationResult() {
  return {
    requested: 0,
    submitted: 0,
    accepted: 0,
    added: 0,
    removed: 0,
    verified: false,
    batches: [],
  };
}

function assertValidState(report, label) {
  if (report.ok) return;
  const detail = report.errors
    .slice(0, 5)
    .map((error) => `${error.path}: ${error.message}`)
    .join('; ');
  throw new Error(`${label} state validation failed: ${detail}`);
}

function productHttpError(status, message) {
  const error = new Error(message);
  error.httpStatus = status;
  return error;
}

async function readDecisionState() {
  const data = await readJsonIfExists(FILES.unifiedDecisions);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    clusters: data?.clusters || {},
    candidates: data?.candidates || {},
  };
}

async function readAiSuggestionState() {
  const data = await readJsonIfExists(FILES.aiSuggestions);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    clusters: data?.clusters || {},
    candidates: data?.candidates || {},
    batches: Array.isArray(data?.batches) ? data.batches : [],
  };
}

async function readSyncDecisionState() {
  const data = await readJsonIfExists(FILES.syncDecisions);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    items: data?.items || {},
  };
}

async function readSyncPolicyState() {
  const data = await readJsonIfExists(FILES.syncPolicy);
  return data || {
    version: 1,
    updatedAt: '',
    policy: 'canonical_mirror',
    participants: ['apple', 'qq', 'netease'],
    source: { platform: 'apple' },
    targets: ['qq', 'netease'],
    deletionPolicy: 'ask',
  };
}

async function readSyncTombstoneState() {
  return normalizeTombstoneState(await readJsonIfExists(FILES.syncTombstones));
}

async function readMirrorDecisionState() {
  const data = await readJsonIfExists(FILES.mirrorDecisions);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    items: data?.items || {},
  };
}

async function readMirrorAiSuggestionState() {
  const data = await readJsonIfExists(FILES.mirrorAiSuggestions);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    items: data?.items || {},
    batches: Array.isArray(data?.batches) ? data.batches : [],
  };
}

async function readSyncAiSuggestionState() {
  const data = await readJsonIfExists(FILES.syncAiSuggestions);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    items: data?.items || {},
    batches: Array.isArray(data?.batches) ? data.batches : [],
  };
}

async function readSyncErrorState() {
  const data = await readJsonIfExists(FILES.syncErrors);
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    items: data?.items || {},
  };
}

function summarizeUnifiedWorkflow(unified, decisions) {
  const safeDecisions = {
    version: 1,
    clusters: decisions?.clusters || {},
    candidates: decisions?.candidates || {},
  };
  const emptySuggestions = { clusters: {}, candidates: {} };
  const clusterItems = buildClusterItems(unified.clusters || [], safeDecisions, emptySuggestions);
  const candidateItems = buildCandidateItems(unified.reviewCandidates || [], safeDecisions, emptySuggestions);
  const reviewItems = [
    ...clusterItems.filter((item) => item.needsReview),
    ...candidateItems,
  ];
  const pendingReview = reviewItems.filter(isPendingReviewItem).length;
  const resolvedItems = reviewItems.filter(isResolvedReviewItem);
  const reviewActions = countActions(resolvedItems
    .filter((item) => item.type === 'cluster')
    .map((item) => ({ action: item.decision?.reviewAction })));
  const candidateActions = countActions(resolvedItems
    .filter((item) => item.type === 'candidate')
    .map((item) => item.decision));
  const handledReview = resolvedItems.length;
  const totalReview = pendingReview + handledReview;
  const workflow = {
    totalReview,
    handledReview,
    pendingReview,
    keptTogether: (reviewActions.same || 0) + (candidateActions.merge || 0),
    keptSeparate: (reviewActions.split || 0) + (candidateActions.separate || 0),
    selectedOne: (reviewActions.pick || 0)
      + (candidateActions['keep-source'] || 0)
      + (candidateActions['keep-target'] || 0),
    dropped: (reviewActions.drop || 0) + (candidateActions.drop || 0),
    acceptedSame: (reviewActions.same || 0) + (candidateActions.merge || 0),
    excluded: (reviewActions.split || 0)
      + (candidateActions.separate || 0)
      + (reviewActions.drop || 0)
      + (candidateActions.drop || 0),
    syncableClusters: 0,
    syncableActions: 0,
    syncableByPlatform: Object.fromEntries(WRITABLE_PLATFORMS.map((platform) => [platform, 0])),
    blockedClusters: 0,
    blockedByPlatform: Object.fromEntries(WRITABLE_PLATFORMS.map((platform) => [platform, 0])),
  };

  for (const cluster of unified.clusters || []) {
    const missingPlatforms = WRITABLE_PLATFORMS.filter((platform) => !cluster.platforms?.includes(platform));
    if (!missingPlatforms.length) continue;
    const reviewAction = effectiveClusterReviewAction(cluster, safeDecisions.clusters[cluster.id]);
    const unresolved = cluster.needsReview && !reviewAction;
    const excluded = reviewAction === 'split' || reviewAction === 'drop';
    if (unresolved || excluded) {
      workflow.blockedClusters += 1;
      for (const platform of missingPlatforms) workflow.blockedByPlatform[platform] += 1;
      continue;
    }
    workflow.syncableClusters += 1;
    workflow.syncableActions += missingPlatforms.length;
    for (const platform of missingPlatforms) workflow.syncableByPlatform[platform] += 1;
  }

  return workflow;
}

function applyOneAiSuggestion({
  type,
  key,
  suggestion,
  decisions,
  threshold,
  overwrite,
  dryRun,
  now,
  stats,
}) {
  stats.totalSuggestions += 1;

  const confidence = Number(suggestion?.confidence || 0);
  if (!Number.isFinite(confidence) || confidence < threshold) {
    stats.skippedLowConfidence += 1;
    return;
  }

  const action = mapAiActionToDecision(type, suggestion?.recommendedAction);
  if (!action) {
    if (suggestion?.recommendedAction === 'needs_human') stats.skippedNeedsHuman += 1;
    else stats.skippedUnsupported += 1;
    return;
  }

  stats.eligible += 1;

  if (type === 'cluster') {
    const current = decisions.clusters[key] || {};
    if (current.reviewAction && !overwrite) {
      stats.skippedExisting += 1;
      return;
    }
    stats.applied += 1;
    stats.clusters[action] += 1;
    if (!dryRun) {
      decisions.clusters[key] = {
        ...current,
        id: key,
        reviewAction: action,
        aiAppliedAt: now,
        updatedAt: now,
      };
      delete decisions.clusters[key].manualReviewedAt;
    }
    return;
  }

  const current = decisions.candidates[key] || {};
  if (current.action && !overwrite) {
    stats.skippedExisting += 1;
    return;
  }
  stats.applied += 1;
  stats.candidates[action] += 1;
  if (!dryRun) {
    decisions.candidates[key] = {
      key,
      action,
      aiAppliedAt: now,
      updatedAt: now,
    };
  }
}

function mapAiActionToDecision(type, action) {
  if (type === 'cluster') {
    if (action === 'merge') return 'same';
    if (action === 'split_versions' || action === 'keep_separate') return 'split';
    return '';
  }
  if (action === 'merge') return 'merge';
  if (action === 'split_versions' || action === 'keep_separate') return 'separate';
  return '';
}

function normalizeApplyThreshold(value) {
  const raw = String(value ?? '').trim();
  const threshold = raw ? Number(raw) : 0.85;
  if (!Number.isFinite(threshold)) return 0.85;
  return Math.max(0, Math.min(1, threshold));
}

function buildClusterItems(clusters, decisions, suggestions) {
  return clusters.map((cluster) => {
    const missingPlatforms = ['apple', 'qq', 'netease'].filter((platform) => !cluster.platforms.includes(platform));
    const decision = effectiveClusterDecision(cluster, decisions.clusters[cluster.id]);
    return {
      type: 'cluster',
      id: cluster.id,
      title: cluster.title,
      artist: cluster.artist,
      album: cluster.album,
      duration: cluster.duration,
      platforms: cluster.platforms,
      status: cluster.status,
      missingPlatforms,
      sources: cluster.sources,
      needsReview: Boolean(cluster.needsReview),
      conflicts: cluster.conflicts || [],
      versionReview: cluster.versionReview || null,
      decision,
      aiSuggestion: suggestions.clusters[cluster.id] || null,
      searchText: normalizeText([
        cluster.id,
        cluster.title,
        cluster.artist,
        cluster.album,
        cluster.platforms.join(' '),
        Object.values(cluster.sources || {}).flat().map((track) => `${track.title} ${track.artist} ${track.album}`).join(' '),
      ].join(' ')),
    };
  });
}

function effectiveClusterDecision(cluster, decision) {
  if (!decision) return null;
  const reviewAction = effectiveClusterReviewAction(cluster, decision);
  if (reviewAction === decision.reviewAction) return decision;
  return {
    ...decision,
    staleReviewAction: decision.reviewAction || '',
    reviewAction,
  };
}

function effectiveClusterReviewAction(cluster, decision = {}) {
  const action = decision?.reviewAction || '';
  if (!action) return '';
  if (cluster.needsReview) return action;
  if ((action === 'split' || action === 'drop') && !hasCurrentMultiSourceCluster(cluster)) {
    return '';
  }
  return action;
}

function hasCurrentMultiSourceCluster(cluster) {
  const platforms = Array.isArray(cluster.platforms) ? cluster.platforms : [];
  const tracks = Object.values(cluster.sources || {}).flat();
  return platforms.length > 1 || tracks.length > 1;
}

function buildCandidateItems(candidates, decisions, suggestions) {
  return candidates.map((candidate, index) => {
    const key = candidateKey(candidate, index);
    const decision = findCandidateDecision(candidate, index, decisions.candidates || {});
    return {
      type: 'candidate',
      key,
      sourceCluster: candidate.sourceCluster,
      targetCluster: candidate.targetCluster,
      source: candidate.source,
      target: candidate.target,
      score: candidate.score,
      decision,
      aiSuggestion: suggestions.candidates[key] || null,
      searchText: normalizeText([
        candidate.sourceCluster,
        candidate.targetCluster,
        endpointSearchText(candidate.source),
        endpointSearchText(candidate.target),
      ].join(' ')),
    };
  });
}

function reviewFilterUsesCandidates(filter) {
  return ['review-queue', 'resolved', 'review-candidates'].includes(filter);
}

function matchesUnifiedFilter(item, filter) {
  if (filter === 'all') return item.type === 'cluster';
  if (filter === 'all-three') return item.type === 'cluster' && item.status === 'all_three';
  if (filter === 'sync-queue' || filter === 'all-gaps') {
    return item.type === 'cluster'
      && item.missingPlatforms.some((platform) => WRITABLE_PLATFORMS.includes(platform))
      && isSyncableCluster(item);
  }
  if (filter === 'review-queue') return isPendingReviewItem(item);
  if (filter === 'resolved') return isResolvedReviewItem(item);
  if (filter === 'missing-apple') return item.type === 'cluster' && item.missingPlatforms.includes('apple');
  if (filter === 'missing-qq') return item.type === 'cluster' && item.missingPlatforms.includes('qq');
  if (filter === 'missing-netease') return item.type === 'cluster' && item.missingPlatforms.includes('netease');
  if (filter === 'conflicts') return item.type === 'cluster' && item.needsReview && !item.decision?.reviewAction;
  if (filter === 'apple-only') return item.type === 'cluster' && item.status === 'apple_only';
  if (filter === 'qq-only') return item.type === 'cluster' && item.status === 'qq_only';
  if (filter === 'netease-only') return item.type === 'cluster' && item.status === 'netease_only';
  if (filter === 'review-candidates') return item.type === 'candidate' && !item.decision?.action;
  return true;
}

function isSyncableCluster(item) {
  if (item.type !== 'cluster') return false;
  if (item.decision?.reviewAction === 'split' || item.decision?.reviewAction === 'drop') return false;
  if (!item.needsReview) return true;
  return item.decision?.reviewAction === 'same' || item.decision?.reviewAction === 'pick';
}

function isPendingReviewItem(item) {
  if (item.type === 'cluster') return item.needsReview && !item.decision?.reviewAction;
  if (item.type === 'candidate') return !item.decision?.action;
  return false;
}

function isResolvedReviewItem(item) {
  if (item.type === 'cluster') return item.needsReview && Boolean(item.decision?.reviewAction);
  if (item.type === 'candidate') return Boolean(item.decision?.action);
  return false;
}

function matchesUnifiedQuery(item, query) {
  if (!query) return true;
  return item.searchText.includes(query);
}

function summarizeDecisions(decisions) {
  const clusterValues = Object.values(decisions?.clusters || {});
  const candidateValues = Object.values(decisions?.candidates || {});
  const reviewValues = clusterValues.filter((item) => item.reviewAction);
  const allReviewValues = [...reviewValues, ...candidateValues];
  const targetActions = { include: 0, exclude: 0, undecided: 0 };
  for (const cluster of clusterValues) {
    for (const action of Object.values(cluster.targets || {})) {
      if (action === 'include') targetActions.include += 1;
      else if (action === 'exclude') targetActions.exclude += 1;
      else targetActions.undecided += 1;
    }
  }
  return {
    updatedAt: decisions?.updatedAt || '',
    clusters: clusterValues.length,
    candidates: candidateValues.length,
    targetActions,
    candidateActions: countActions(candidateValues),
    reviewActions: countActions(reviewValues.map((item) => ({ action: item.reviewAction }))),
    decisionSources: summarizeDecisionSources(allReviewValues),
  };
}

function summarizeDecisionSources(items) {
  const sources = {
    aiApplied: 0,
    manual: 0,
  };
  for (const item of items) {
    if (item.aiAppliedAt && item.updatedAt === item.aiAppliedAt) sources.aiApplied += 1;
    else sources.manual += 1;
  }
  return sources;
}

function summarizeAiSuggestions(suggestions) {
  const clusters = Object.values(suggestions?.clusters || {});
  const candidates = Object.values(suggestions?.candidates || {});
  return {
    updatedAt: suggestions?.updatedAt || '',
    clusters: clusters.length,
    candidates: candidates.length,
    total: clusters.length + candidates.length,
    actions: countActions([...clusters, ...candidates].map((item) => ({
      action: item.recommendedAction,
    }))),
    batches: suggestions?.batches?.length || 0,
    lastBatch: suggestions?.batches?.[0] || null,
  };
}

function summarizeSyncDecisions(decisions) {
  const items = Object.values(decisions?.items || {});
  return {
    updatedAt: decisions?.updatedAt || '',
    total: items.length,
    actions: countActions(items),
    sources: {
      aiApplied: items.filter((item) => item.aiAppliedAt && item.updatedAt === item.aiAppliedAt).length,
      manual: items.filter((item) => !item.aiAppliedAt || item.updatedAt !== item.aiAppliedAt).length,
    },
  };
}

function summarizeMirrorDecisions(decisions) {
  const items = Object.values(decisions?.items || {});
  return {
    updatedAt: decisions?.updatedAt || '',
    total: items.length,
    actions: countActions(items),
    sources: {
      aiApplied: items.filter((item) => item.aiAppliedAt && item.updatedAt === item.aiAppliedAt).length,
      manual: items.filter((item) => !item.aiAppliedAt || item.updatedAt !== item.aiAppliedAt).length,
    },
  };
}

function summarizeMirrorAiSuggestions(suggestions) {
  const items = Object.values(suggestions?.items || {});
  return {
    updatedAt: suggestions?.updatedAt || '',
    total: items.length,
    actions: countActions(items.map((item) => ({ action: item.recommendedAction }))),
    guarded: items.filter((item) => item.safety?.guarded).length,
    batches: suggestions?.batches?.length || 0,
    lastBatch: suggestions?.batches?.[0] || null,
  };
}

function summarizeSyncAiSuggestions(suggestions) {
  const items = Object.values(suggestions?.items || {});
  return {
    updatedAt: suggestions?.updatedAt || '',
    total: items.length,
    actions: countActions(items.map((item) => ({ action: item.recommendedAction }))),
    batches: suggestions?.batches?.length || 0,
    lastBatch: suggestions?.batches?.[0] || null,
  };
}

function summarizeSyncErrors(errors, plan = null) {
  const items = Object.values(errors?.items || {});
  const active = items.filter((item) => !item.resolvedAt);
  const activeKeys = new Set(active.map((item) => item.key));
  for (const item of plan?.items || []) {
    if (item.status !== 'error' && item.status !== 'rate_limited') continue;
    const key = syncErrorKey(plan.target, item);
    if (activeKeys.has(key)) continue;
    active.push({
      key,
      target: plan.target,
      clusterId: item.clusterId || '',
      title: item.title || '',
      artist: item.artist || '',
      album: item.album || '',
      sourcePlatform: item.source?.platform || '',
      sourceId: item.source?.track?.id || item.source?.track?.mid || '',
      error: displaySyncError(item.error || item.statusText || '未知错误'),
      updatedAt: plan.generatedAt || '',
      resolvedAt: '',
    });
  }
  active.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
  return {
    updatedAt: errors?.updatedAt || '',
    total: Math.max(items.length, active.length),
    active: active.length,
    resolved: Math.max(0, items.length - items.filter((item) => !item.resolvedAt).length),
    last: active[0] || null,
  };
}

function displaySyncError(value) {
  const text = String(value || '').trim();
  if (!text || text === '[object Object]') {
    return '网易云接口返回了未结构化错误；重跑后会记录详细响应';
  }
  return text;
}

function countActions(items) {
  const counts = {};
  for (const item of items) {
    const action = item.action || item.reviewAction;
    if (!action) continue;
    counts[action] = (counts[action] || 0) + 1;
  }
  return counts;
}

function normalizeTargetAction(action) {
  const value = String(action || '').trim();
  if (['include', 'exclude', 'undecided'].includes(value)) return value;
  throw new Error('未知目标平台选择。');
}

function normalizeSyncAction(action) {
  const value = String(action || '').trim();
  if (['accept', 'reject', 'undecided'].includes(value)) return value;
  throw new Error('未知写入候选选择。');
}

function normalizeMirrorDecisionInputAction(action) {
  const value = String(action || '').trim().toLowerCase();
  if (value === 'clear') return value;
  const normalized = normalizeMirrorReviewDecisionAction(value);
  if (normalized) return normalized;
  throw new Error('未知镜像复核选择。');
}

function syncAiActionToDecision(action) {
  if (action === 'add') return 'accept';
  if (action === 'skip') return 'reject';
  return '';
}

function mirrorAiActionToDecision(action) {
  if (action === 'keep') return 'keep';
  if (action === 'separate') return 'separate';
  return '';
}

function normalizeCandidateAction(action) {
  const value = String(action || '').trim();
  if (['merge', 'separate', 'keep-source', 'keep-target', 'drop', 'undecided'].includes(value)) return value;
  throw new Error('未知低置信候选选择。');
}

function normalizeClusterReviewAction(action) {
  const value = String(action || '').trim();
  if (['same', 'split', 'pick', 'drop', 'undecided'].includes(value)) return value;
  throw new Error('未知冲突处理选择。');
}

function candidateKey(candidate, index) {
  return stableCandidateKey(candidate) || legacyCandidateKey(candidate, index);
}

function stableCandidateKey(candidate) {
  const source = endpointId(candidate.source);
  const target = endpointId(candidate.target);
  if (!source || !target) return '';
  return `candidate::${source}::${target}`;
}

function legacyCandidateKey(candidate, index) {
  return [
    candidate.sourceCluster || 'source',
    candidate.targetCluster || 'target',
    endpointId(candidate.source),
    endpointId(candidate.target),
    index,
  ].join('::');
}

function endpointId(endpoint) {
  return `${endpoint?.platform || ''}:${endpoint?.track?.id || endpoint?.track?.mid || endpoint?.track?.title || ''}`;
}

function findCandidateDecision(candidate, index, decisions = {}) {
  const key = stableCandidateKey(candidate);
  if (key && decisions[key]) return decisions[key];
  const legacy = legacyCandidateKey(candidate, index);
  if (decisions[legacy]) return { ...decisions[legacy], key, legacyKey: legacy };
  const source = endpointId(candidate.source);
  const target = endpointId(candidate.target);
  if (!source || !target) return null;
  const marker = `::${source}::${target}::`;
  const entry = Object.entries(decisions).find(([candidateDecisionKey]) => candidateDecisionKey.includes(marker));
  return entry ? { ...entry[1], key, legacyKey: entry[0] } : null;
}

async function migrateDecisionStateForUnified(unified) {
  const decisions = await readDecisionState();
  const currentCandidates = decisions.candidates || {};
  const nextCandidates = { ...currentCandidates };
  let changed = false;

  for (const [index, candidate] of (unified.reviewCandidates || []).entries()) {
    const key = stableCandidateKey(candidate);
    if (!key) continue;
    const decision = findCandidateDecision(candidate, index, currentCandidates);
    if (!decision?.action) continue;
    if (!nextCandidates[key]) {
      nextCandidates[key] = {
        ...decision,
        key,
        migratedFrom: decision.legacyKey || decision.key || '',
      };
      changed = true;
    }
    if (decision.legacyKey && decision.legacyKey !== key && nextCandidates[decision.legacyKey]) {
      delete nextCandidates[decision.legacyKey];
      changed = true;
    }
  }

  if (!changed) return decisions;
  decisions.candidates = nextCandidates;
  decisions.updatedAt = new Date().toISOString();
  await writeJson(FILES.unifiedDecisions, decisions);
  return decisions;
}

function endpointSearchText(endpoint) {
  const track = endpoint?.track || {};
  return `${endpoint?.platform || ''} ${track.title || ''} ${track.artist || ''} ${track.album || ''}`;
}

async function fetchQQ(cookie, options) {
  const { fetchQQLiked } = await import('./providers/qq.js');
  return fetchQQLiked(cookie, options);
}

async function fetchNetease(cookie, options) {
  const { fetchNeteaseLiked } = await import('./providers/netease.js');
  return fetchNeteaseLiked(cookie, options);
}

function skippedSnapshot(platform, reason) {
  return {
    platform,
    source: null,
    fetchedAt: new Date().toISOString(),
    skipped: true,
    reason,
    tracks: [],
  };
}

function prepareSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    tracks: (snapshot.tracks || []).map((track) => normalizeTrack(track, track.platform || snapshot.platform || 'unknown')),
  };
}

function hasAliases(aliases) {
  return Boolean(aliases?.titles?.length || aliases?.artists?.length || aliases?.albums?.length);
}
