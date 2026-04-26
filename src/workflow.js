import path from 'node:path';
import { createRequire } from 'node:module';
import { buildReviewBatch, requestDeepSeekReview } from './ai-review.js';
import { buildAppleSnapshotFromTracks, loadApplePlaylistUrl, parseAppleText } from './apple.js';
import { enrichAppleSnapshotWithMusicBrainz } from './metadata/musicbrainz.js';
import { compareAppleToPlatform } from './match.js';
import { normalizeText, normalizeTrack } from './normalize.js';
import { buildMarkdownReport, compactComparison } from './report.js';
import { buildUnifiedLibrary, buildUnifiedMarkdown } from './unified.js';
import {
  DATA_DIR,
  REPORT_DIR,
  ensureDirs,
  normalizeCookie,
  readJsonIfExists,
  readTextIfExists,
  writeJson,
  writeText,
} from './utils.js';

const require = createRequire(import.meta.url);
const PLATFORMS = ['apple', 'qq', 'netease'];

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

  const apiKey = String(options.apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
  const result = await requestDeepSeekReview({
    apiKey,
    model: options.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
    items: itemsPayload.items,
    thinking: options.thinking !== false,
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
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

export async function getState() {
  await ensureDirs();
  const [apple, qq, netease, report, unified, decisions, suggestions, appleCookie, qqCookie, neteaseCookie] = await Promise.all([
    readJsonIfExists(FILES.appleJson),
    readJsonIfExists(FILES.qqJson),
    readJsonIfExists(FILES.neteaseJson),
    readJsonIfExists(FILES.reportJson),
    readJsonIfExists(FILES.unifiedJson),
    readDecisionState(),
    readAiSuggestionState(),
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
    },
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

function summarizeUnifiedWorkflow(unified, decisions) {
  const clusterDecisions = decisions?.clusters || {};
  const candidateDecisions = decisions?.candidates || {};
  const reviewActions = countActions(Object.values(clusterDecisions)
    .map((item) => ({ action: item.reviewAction }))
    .filter((item) => item.action));
  const candidateActions = countActions(Object.values(candidateDecisions));
  const handledReview = Object.values(reviewActions).reduce((sum, value) => sum + value, 0)
    + Object.values(candidateActions).reduce((sum, value) => sum + value, 0);
  const totalReview = (unified.summary?.conflictClusters || 0) + (unified.summary?.reviewCandidates || 0);
  const workflow = {
    totalReview,
    handledReview,
    pendingReview: Math.max(0, totalReview - handledReview),
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
    blockedClusters: 0,
  };

  for (const cluster of unified.clusters || []) {
    const missingPlatforms = PLATFORMS.filter((platform) => !cluster.platforms?.includes(platform));
    if (!missingPlatforms.length) continue;
    const reviewAction = clusterDecisions[cluster.id]?.reviewAction || '';
    const unresolved = cluster.needsReview && !reviewAction;
    const excluded = reviewAction === 'split' || reviewAction === 'drop';
    if (unresolved || excluded) {
      workflow.blockedClusters += 1;
      continue;
    }
    workflow.syncableClusters += 1;
    workflow.syncableActions += missingPlatforms.length;
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
      decision: decisions.clusters[cluster.id] || null,
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

function buildCandidateItems(candidates, decisions, suggestions) {
  return candidates.map((candidate, index) => {
    const key = candidateKey(candidate, index);
    return {
      type: 'candidate',
      key,
      sourceCluster: candidate.sourceCluster,
      targetCluster: candidate.targetCluster,
      source: candidate.source,
      target: candidate.target,
      score: candidate.score,
      decision: decisions.candidates[key] || null,
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
  if (filter === 'sync-queue' || filter === 'all-gaps') {
    return item.type === 'cluster' && item.missingPlatforms.length > 0 && isSyncableCluster(item);
  }
  if (filter === 'review-queue') return isPendingReviewItem(item);
  if (filter === 'resolved') return isResolvedReviewItem(item);
  if (filter === 'missing-apple') return item.type === 'cluster' && item.missingPlatforms.includes('apple') && isSyncableCluster(item);
  if (filter === 'missing-qq') return item.type === 'cluster' && item.missingPlatforms.includes('qq') && isSyncableCluster(item);
  if (filter === 'missing-netease') return item.type === 'cluster' && item.missingPlatforms.includes('netease') && isSyncableCluster(item);
  if (filter === 'conflicts') return item.type === 'cluster' && item.needsReview && !item.decision?.reviewAction;
  if (filter === 'apple-only') return item.type === 'cluster' && item.status === 'apple_only';
  if (filter === 'qq-only') return item.type === 'cluster' && item.status === 'qq_only';
  if (filter === 'netease-only') return item.type === 'cluster' && item.status === 'netease_only';
  if (filter === 'review-candidates') return item.type === 'candidate' && !item.decision?.action;
  return true;
}

function isSyncableCluster(item) {
  if (item.type !== 'cluster') return false;
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
