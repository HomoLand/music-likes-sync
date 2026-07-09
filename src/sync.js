import { compareAppleToPlatform } from './match.js';
import {
  addNeteaseTracksToPlaylist,
  createNeteasePlaylist,
  isNeteaseRateLimitError,
  matchNeteaseTrack,
  searchNeteaseTracks,
} from './providers/netease.js';
import {
  addQQTracksToPlaylist,
  createQQPlaylist,
  searchQQTracks,
} from './providers/qq.js';
import {
  addAppleTracksToFavorites,
  addAppleTracksToPlaylist,
  createApplePlaylist,
  searchAppleTracks,
} from './providers/apple.js';
import { durationLabel, normalizeText } from './normalize.js';
import { formatErrorMessage } from './utils.js';

const PLATFORMS = ['apple', 'qq', 'netease'];
const TARGET_LABELS = {
  apple: 'Apple',
  qq: 'QQ',
  netease: '网易云',
};
const NETEASE_MATCH_FIRST = /^(1|true|yes)$/i.test(process.env.NETEASE_MATCH_FIRST || '');
const APPLE_SEARCH_QUERY_LIMIT = normalizePositiveInteger(process.env.APPLE_SEARCH_QUERY_LIMIT, 1);

const SOURCE_PRIORITY = {
  netease: ['qq', 'apple'],
  qq: ['netease', 'apple'],
  apple: ['qq', 'netease'],
};

export async function buildWritePlan(input = {}) {
  const target = normalizeTarget(input.target || 'netease');
  const unified = input.unified;
  if (!unified?.clusters?.length) throw new Error('缺少统一曲库，请先生成统一曲库');

  const decisions = input.decisions || {};
  const minScore = clampNumber(input.minScore, 0, 1, 0.82);
  const reviewScore = clampNumber(input.reviewScore, 0, 1, 0.68);
  const resolve = Boolean(input.resolve);
  const searchLimit = clampNumber(input.searchLimit, 1, 30, 12);
  const queueResult = buildSyncQueue(unified.clusters, decisions, target);
  const syncDecisions = input.syncDecisions || {};
  const aiSuggestions = input.aiSuggestions || {};
  const offset = normalizeOffset(input.offset);
  const limit = normalizePlanLimit(input.limit, queueResult.items.length, offset);
  const page = queueResult.items.slice(offset, offset + limit);
  const includeBlocked = offset + page.length >= queueResult.items.length;
  const searchCache = new Map();
  const targetLibrary = buildTargetLibrary(input.targetSnapshot, target);
  const reusableItems = buildReusablePlanMap(input.previousPlan, {
    target,
    minScore,
    reviewScore,
    searchLimit,
  });

  const items = [];
  const total = page.length;
  for (let index = 0; index < page.length; index += 1) {
    const item = page[index];
    const planned = {
      ...item,
      target,
      status: resolve ? 'searching' : 'pending_search',
      statusText: resolve ? '搜索中' : '待搜索',
      match: null,
      alternatives: [],
      error: '',
    };
    if (resolve) {
      await notifyProgress(input.onProgress, {
        done: items.length,
        total,
        current: progressTrack(item),
        summary: summarizePlanItems([...items, planned]),
      });
      const reused = reusableItems.get(planItemKey(item));
      Object.assign(planned, reused
        ? reuseResolvedPlanItem(reused, targetLibrary)
        : await resolvePlanItem({
          item,
          target,
          cookie: input.cookie || '',
          minScore,
          reviewScore,
          searchLimit,
          searchCache,
          onProgress: input.onProgress,
          progressDone: items.length,
          progressTotal: total,
          progressItems: items,
          targetLibrary,
        }));
      applySyncDecision(planned, syncDecisions, aiSuggestions);
    }
    items.push(planned);
    await notifyProgress(input.onProgress, {
      done: items.length,
      total,
      current: {
        clusterId: item.clusterId,
        title: item.title,
        artist: item.artist,
      },
      summary: summarizePlanItems(items),
    });
    if (planned.status === 'rate_limited') {
      for (let deferredIndex = index + 1; deferredIndex < page.length; deferredIndex += 1) {
        const deferredSource = page[deferredIndex];
        const reusable = reusableItems.get(planItemKey(deferredSource));
        if (reusable) {
          const reusedPlan = {
            ...deferredSource,
            target,
            ...reuseResolvedPlanItem(reusable, targetLibrary),
          };
          applySyncDecision(reusedPlan, syncDecisions, aiSuggestions);
          items.push(reusedPlan);
        } else {
          items.push(makeDeferredPlanItem(deferredSource, target));
        }
      }
      await notifyProgress(input.onProgress, {
        done: items.length,
        total,
        current: null,
        summary: summarizePlanItems(items),
      });
      break;
    }
  }

  const outputItems = flagDuplicateTargetMatches(
    includeBlocked ? [...items, ...queueResult.blockedItems] : items,
    target,
  );
  const summary = summarizePlanItems(outputItems);
  return {
    version: 2,
    target,
    targetLabel: TARGET_LABELS[target],
    generatedAt: new Date().toISOString(),
    resolve,
    minScore,
    reviewScore,
    searchLimit,
    targetSnapshot: targetLibrary
      ? {
        source: targetLibrary.source,
        fetchedAt: targetLibrary.fetchedAt,
        count: targetLibrary.count,
      }
      : null,
    totalQueue: queueResult.items.length + queueResult.blockedItems.length,
    searchQueue: queueResult.items.length,
    blockedClusters: queueResult.blocked,
    blockedItems: queueResult.blockedItems,
    offset,
    limit,
    hasMore: offset + limit < queueResult.items.length,
    summary,
    items: outputItems,
  };
}

async function notifyProgress(callback, payload) {
  if (typeof callback !== 'function') return;
  await callback(payload);
}

function progressTrack(item, detail = '') {
  return {
    clusterId: item.clusterId,
    title: item.title,
    artist: item.artist,
    detail,
  };
}

export function decorateWritePlan(plan, syncDecisions = {}, aiSuggestions = {}) {
  if (!plan?.items?.length) return plan;
  const items = flagDuplicateTargetMatches(plan.items.map((item) => {
    const next = { ...item };
    applySyncDecision(next, syncDecisions, aiSuggestions);
    return next;
  }), plan.target);
  return {
    ...plan,
    summary: summarizePlanItems(items),
    items,
  };
}

export async function executeNeteaseWrite(input = {}) {
  const dryRun = input.dryRun !== false;
  const cookie = String(input.cookie || '').trim();
  if (!cookie) throw new Error('缺少网易云 cookie，请先扫码登录或保存 Cookie');

    const plan = await buildWritePlan({
      ...input,
      target: 'netease',
      resolve: true,
      cookie,
      previousPlan: input.previousPlan,
    });
  const readyItems = plan.items.filter((item) => item.status === 'ready' && item.match?.track?.id);
  const acceptedItems = plan.items.filter((item) => item.status === 'accepted' && item.match?.track?.id);
  const writableItems = [...readyItems, ...acceptedItems];
  const trackIds = unique(writableItems.map((item) => item.match.track.id));
  const playlistName = String(input.playlistName || '').trim() || defaultPlaylistName();

  if (dryRun) {
    return {
      dryRun: true,
      playlist: {
        id: String(input.playlistId || '').trim(),
        name: playlistName,
        created: false,
      },
      add: {
        requested: trackIds.length,
        submitted: 0,
        accepted: 0,
        added: 0,
        alreadyPresent: 0,
        verified: false,
        missingIds: [],
        alreadyPresentIds: [],
        missingTracks: [],
        batches: [],
      },
      plan,
    };
  }

  let playlist = {
    id: String(input.playlistId || '').trim(),
    name: playlistName,
    created: false,
  };
  if (!playlist.id) {
    playlist = {
      ...(await createNeteasePlaylist(cookie, {
        name: playlistName,
        privacy: input.privacy !== false,
      })),
      created: true,
    };
  }

  const add = await addNeteaseTracksToPlaylist(cookie, playlist.id, trackIds, {
    batchSize: input.batchSize,
  });
  const itemByTrackId = new Map();
  for (const item of writableItems) {
    const id = String(item.match?.track?.id || '').trim();
    if (id && !itemByTrackId.has(id)) itemByTrackId.set(id, item);
  }
  add.missingTracks = (add.missingIds || []).map((id) => compactMissingWriteTrack(id, itemByTrackId.get(id)));

  return {
    dryRun: false,
    playlist,
    add,
    plan,
  };
}

export async function executeQQWrite(input = {}) {
  const dryRun = input.dryRun !== false;
  const cookie = String(input.cookie || '').trim();
  if (!cookie) throw new Error('缺少 QQ 音乐 cookie，请先登录并抓取 QQ Cookie');

  const plan = await buildWritePlan({
    ...input,
    target: 'qq',
    resolve: true,
    cookie,
    previousPlan: input.previousPlan,
  });
  const readyItems = plan.items.filter((item) => item.status === 'ready' && item.match?.track?.mid);
  const acceptedItems = plan.items.filter((item) => item.status === 'accepted' && item.match?.track?.mid);
  const writableItems = [...readyItems, ...acceptedItems];
  const writeTracks = uniqueQQWriteTracks(writableItems.map((item) => item.match.track));
  const playlistName = String(input.playlistName || '').trim() || defaultPlaylistName();

  if (dryRun) {
    return {
      target: 'qq',
      dryRun: true,
      playlist: {
        id: String(input.playlistId || '').trim(),
        name: playlistName,
        created: false,
      },
      add: {
        requested: writeTracks.length,
        submitted: 0,
        accepted: 0,
        added: 0,
        alreadyPresent: 0,
        verified: false,
        missingIds: [],
        alreadyPresentIds: [],
        missingTracks: [],
        batches: [],
      },
      plan,
    };
  }

  let playlist = {
    id: String(input.playlistId || '').trim(),
    name: playlistName,
    created: false,
  };
  if (!playlist.id) {
    playlist = {
      ...(await createQQPlaylist(cookie, { name: playlistName })),
      created: true,
    };
  }

  const add = await addQQTracksToPlaylist(cookie, playlist.id, writeTracks, {
    batchSize: input.batchSize,
  });
  const itemByTrackId = new Map();
  for (const item of writableItems) {
    for (const id of [item.match?.track?.mid, item.match?.track?.id]) {
      const text = String(id || '').trim();
      if (text && !itemByTrackId.has(text)) itemByTrackId.set(text, item);
    }
  }
  add.missingTracks = (add.missingIds || []).map((id) => compactMissingWriteTrack(id, itemByTrackId.get(id)));

  return {
    target: 'qq',
    dryRun: false,
    playlist,
    add,
    plan,
  };
}

export async function executeAppleWrite(input = {}) {
  const dryRun = input.dryRun !== false;
  const plan = reusableResolvedExecutionPlan(input.previousPlan, 'apple', input)
    || await buildWritePlan({
      ...input,
      target: 'apple',
      resolve: true,
      previousPlan: input.previousPlan,
    });
  const readyItems = plan.items.filter((item) => item.status === 'ready' && item.match?.track?.id);
  const acceptedItems = plan.items.filter((item) => item.status === 'accepted' && item.match?.track?.id);
  const writableItems = [...readyItems, ...acceptedItems];
  const trackIds = unique(writableItems.map((item) => item.match.track.id));
  const playlistName = String(input.playlistName || '').trim() || defaultPlaylistName();
  const playlistId = String(input.playlistId || '').trim();
  const useFavorites = !playlistId || isAppleFavoritesTarget(playlistId);
  const playlist = {
    id: useFavorites ? 'favorites' : playlistId,
    name: useFavorites ? 'Favorite Songs' : playlistName,
    created: false,
  };

  if (dryRun) {
    return {
      target: 'apple',
      dryRun: true,
      playlist,
      add: {
        requested: trackIds.length,
        submitted: 0,
        accepted: 0,
        added: 0,
        alreadyPresent: 0,
        verified: false,
        missingIds: [],
        alreadyPresentIds: [],
        missingTracks: [],
        batches: [],
      },
      plan,
    };
  }

  let writePlaylist = playlist;
  let add;
  if (useFavorites) {
    add = await addAppleTracksToFavorites(trackIds, {
      batchSize: input.batchSize,
    });
  } else {
    if (!writePlaylist.id) {
      writePlaylist = {
        ...(await createApplePlaylist({ name: playlistName, isPublic: false })),
        created: true,
      };
    }
    add = await addAppleTracksToPlaylist(writePlaylist.id, trackIds, {
      batchSize: input.batchSize,
    });
  }

  const itemByTrackId = new Map();
  for (const item of writableItems) {
    const id = String(item.match?.track?.id || '').trim();
    if (id && !itemByTrackId.has(id)) itemByTrackId.set(id, item);
  }
  add.missingTracks = (add.missingIds || []).map((id) => compactMissingWriteTrack(id, itemByTrackId.get(id)));

  return {
    target: 'apple',
    dryRun: false,
    playlist: writePlaylist,
    add,
    plan,
  };
}

function isAppleFavoritesTarget(value) {
  return ['favorite', 'favorites', 'favorite-songs', 'liked', 'likes', '201', '我喜欢']
    .includes(String(value || '').trim().toLowerCase());
}

function compactMissingWriteTrack(id, item = {}) {
  return {
    id: String(id || ''),
    clusterId: item.clusterId || '',
    status: item.status || '',
    sourcePlatform: item.source?.platform || '',
    source: compactWriteTrack(item.source?.track),
    target: compactWriteTrack(item.match?.track),
  };
}

function compactWriteTrack(track = {}) {
  return {
    id: track.id || null,
    mid: track.mid || null,
    title: track.title || '',
    artist: track.artist || '',
    album: track.album || '',
    duration: track.duration || durationLabel(track.durationMs),
    durationMs: track.durationMs || null,
  };
}

function buildSyncQueue(clusters, decisions, target) {
  const result = [];
  const blockedItems = [];
  let queueIndex = 0;
  for (const cluster of clusters) {
    if (cluster.platforms?.includes(target)) continue;
    const decision = decisions.clusters?.[cluster.id] || {};
    const reviewAction = effectiveClusterReviewAction(cluster, decision);
    const unresolved = cluster.needsReview && !reviewAction;
    const excluded = reviewAction === 'split' || reviewAction === 'drop';
    if (unresolved) {
      blockedItems.push({
        ...makeBlockedPlanItem(cluster, target, decision, 'needs_review'),
        queueIndex,
      });
      queueIndex += 1;
      continue;
    }
    if (excluded) {
      blockedItems.push({
        ...makeBlockedPlanItem(cluster, target, { ...decision, reviewAction }, 'excluded_by_decision'),
        queueIndex,
      });
      queueIndex += 1;
      continue;
    }

    const source = chooseSourceTrack(cluster, target, { ...decision, reviewAction });
    if (!source?.track) {
      blockedItems.push({
        ...makeBlockedPlanItem(cluster, target, decision, 'missing_source'),
        queueIndex,
      });
      queueIndex += 1;
      continue;
    }

    result.push({
      searchIndex: result.length,
      queueIndex,
      clusterId: cluster.id,
      title: cluster.title,
      artist: cluster.artist,
      album: cluster.album,
      duration: cluster.duration,
      durationMs: cluster.durationMs,
      presentPlatforms: cluster.platforms || [],
      missingPlatforms: PLATFORMS.filter((platform) => !cluster.platforms?.includes(platform)),
      source,
      queries: buildSearchQueries(cluster, source.track),
      reviewAction: reviewAction || '',
    });
    queueIndex += 1;
  }
  return { items: result, blocked: blockedItems.length, blockedItems };
}

function makeBlockedPlanItem(cluster, target, decision, reason) {
  const reviewAction = effectiveClusterReviewAction(cluster, decision);
  const source = chooseSourceTrack(cluster, target, { ...decision, reviewAction });
  const status = reason === 'excluded_by_decision' ? 'excluded_by_decision' : 'needs_review';
  return {
    clusterId: cluster.id,
    title: cluster.title,
    artist: cluster.artist,
    album: cluster.album,
    duration: cluster.duration,
    durationMs: cluster.durationMs,
    presentPlatforms: cluster.platforms || [],
    missingPlatforms: PLATFORMS.filter((platform) => !cluster.platforms?.includes(platform)),
    source,
    queries: source?.track ? buildSearchQueries(cluster, source.track) : [],
    reviewAction: reviewAction || '',
    target,
    status,
    statusText: planStatusText(status),
    match: null,
    alternatives: [],
    error: blockedPlanReason(reason, reviewAction),
    blocked: true,
  };
}

function blockedPlanReason(reason, reviewAction) {
  if (reason === 'excluded_by_decision') {
    return reviewAction === 'drop'
      ? '统一曲库已判断为不要，暂不写入。'
      : '统一曲库已判断为不同版本或不同歌曲，暂不自动写入。';
  }
  if (reason === 'missing_source') {
    return '这个缺口没有可用来源曲目，需要先回到统一曲库检查。';
  }
  return '统一曲库仍有版本疑点，需要先判断后再写入。';
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

function chooseSourceTrack(cluster, target, decision) {
  if (decision.reviewAction === 'pick' && decision.selectedTrack) {
    const picked = findTrackByDecisionKey(cluster.sources || {}, decision.selectedTrack);
    if (picked) return picked;
  }

  const priorities = SOURCE_PRIORITY[target] || PLATFORMS.filter((platform) => platform !== target);
  const candidates = Object.entries(cluster.sources || {})
    .filter(([platform]) => platform !== target)
    .flatMap(([platform, tracks]) => (tracks || []).map((track) => ({ platform, track })));
  candidates.sort((left, right) => {
    const priority = priorities.indexOf(left.platform) - priorities.indexOf(right.platform);
    if (priority) return priority;
    return displayTrackScore(right.track) - displayTrackScore(left.track);
  });
  return candidates[0] || null;
}

function findTrackByDecisionKey(sources, selectedTrack) {
  for (const [platform, tracks] of Object.entries(sources || {})) {
    for (const track of tracks || []) {
      if (trackDecisionKey(platform, track) === selectedTrack) {
        return { platform, track };
      }
    }
  }
  return null;
}

async function resolvePlanItem(options) {
  try {
    const candidates = await searchTargetCandidates(options);
    if (!candidates.length) {
      return {
        status: 'not_found',
        statusText: '未命中',
        alternatives: [],
      };
    }

    const comparison = compareAppleToPlatform([options.item.source.track], candidates, {
      threshold: options.minScore,
      reviewThreshold: options.reviewScore,
    });
    const ready = comparison.matches[0];
    if (ready) {
      return applyTargetPresence({
        status: 'ready',
        statusText: '可写入',
        match: compactMatch(ready.target, ready.score),
        decisionKey: syncDecisionKey(options.target, options.item.clusterId, ready.target),
        alternatives: compactAlternatives(candidates, ready.target),
      }, options.targetLibrary, { autoStatus: true });
    }

    const review = comparison.reviewItems[0];
    if (review) {
      return applyTargetPresence({
        status: 'low_score',
        statusText: '低置信',
        match: compactMatch(review.target, review.score),
        decisionKey: syncDecisionKey(options.target, options.item.clusterId, review.target),
        alternatives: compactAlternatives(candidates, review.target),
      }, options.targetLibrary);
    }

    const best = comparison.missingItems[0]?.best;
    return applyTargetPresence({
      status: best ? 'low_score' : 'not_found',
      statusText: best ? '低置信' : '未命中',
      match: best ? compactMatch(best.target, best.score) : null,
      decisionKey: best ? syncDecisionKey(options.target, options.item.clusterId, best.target) : '',
      alternatives: compactAlternatives(candidates, best?.target),
    }, options.targetLibrary);
  } catch (error) {
    if (isRateLimitedError(error)) {
      return {
        status: 'rate_limited',
        statusText: '被限流',
        match: null,
        alternatives: [],
        error: `${TARGET_LABELS[options.target] || '目标平台'}搜索触发频控，已暂停。稍后重新生成写入计划会从这里继续。`,
      };
    }
    return {
      status: 'error',
      statusText: '搜索失败',
      match: null,
      alternatives: [],
      error: formatErrorMessage(error),
    };
  }
}

async function searchTargetCandidates(options) {
  const candidates = [];
  const seen = new Set();
  const addCandidates = (tracks) => {
    for (const track of tracks || []) {
      const key = `${track.platform}:${track.id || track.mid || normalizeText(`${track.title} ${track.artist} ${track.album}`)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(track);
    }
  };

  if (options.target === 'netease' && NETEASE_MATCH_FIRST) {
    addCandidates(await matchNeteaseTrack(options.cookie, options.item.source.track, {
      retries: 1,
      onRetry: (retry) => notifySearchRetry(options, 'search_match', retry),
    }));
    if (hasConfidentCandidate(options.item.source.track, candidates, options.minScore)) {
      return candidates;
    }
  }

  for (const query of targetSearchQueries(options.item.queries, options.target)) {
    const cacheKey = `${options.target}:${query}`;
    const results = options.searchCache.has(cacheKey)
      ? options.searchCache.get(cacheKey)
      : await searchTarget(options.target, options.cookie, query, options.searchLimit, {
        onRetry: (retry) => notifySearchRetry(options, query, retry),
      });
    options.searchCache.set(cacheKey, results);

    addCandidates(results);
    if (hasConfidentCandidate(options.item.source.track, candidates, options.minScore)) break;
    if (results.length >= Math.min(8, options.searchLimit) || candidates.length >= Math.max(8, options.searchLimit)) break;
  }
  if (options.target === 'netease' && candidates.length === 0) {
    const bestQuery = options.item.queries[0];
    const cacheKey = `${options.target}:direct-title:${bestQuery}`;
    const results = options.searchCache.has(cacheKey)
      ? options.searchCache.get(cacheKey)
      : await searchNeteaseTracks(options.cookie, bestQuery, {
        limit: options.searchLimit,
        endpoint: 'direct',
        onRetry: (retry) => notifySearchRetry(options, bestQuery, retry),
      });
    options.searchCache.set(cacheKey, results);
    addCandidates(results);
  }
  return candidates;
}

async function searchTarget(target, cookie, query, limit, extra = {}) {
  if (target === 'netease') return searchNeteaseTracks(cookie, query, { limit, ...extra });
  if (target === 'qq') return searchQQTracks(cookie, query, { limit, ...extra });
  if (target === 'apple') return searchAppleTracks(query, { limit, ...extra });
  throw new Error(`暂不支持写入 ${TARGET_LABELS[target] || target}`);
}

async function notifySearchRetry(options, query, retry = {}) {
  if (typeof options.onProgress !== 'function') return;
  const waitSeconds = Math.ceil((retry.delay || 0) / 1000);
  const summary = summarizePlanItems(options.progressItems || []);
  summary.total += 1;
  summary.searching += 1;
  await options.onProgress({
    phase: `${TARGET_LABELS[options.target] || '目标平台'}限流等待 ${waitSeconds}s 后重试`,
    done: options.progressDone || 0,
    total: options.progressTotal || 0,
    current: progressTrack(
      options.item,
      `查询「${query}」触发频控，第 ${retry.attempt || 1}/${retry.retries || 1} 次重试`,
    ),
    summary,
  });
}

function hasConfidentCandidate(sourceTrack, candidates, threshold) {
  if (!candidates.length) return false;
  return Boolean(compareAppleToPlatform([sourceTrack], candidates, {
    threshold,
    reviewThreshold: threshold,
  }).matches[0]);
}

function buildSearchQueries(cluster, sourceTrack) {
  const titles = unique([
    sourceTrack.title,
    cluster.title,
    ...(sourceTrack.aliases?.titles || []),
    ...(cluster.aliases?.titles || []),
  ]).slice(0, 8);
  const artists = unique([
    sourceTrack.artist,
    cluster.artist,
    ...(sourceTrack.aliases?.artists || []),
    ...(cluster.aliases?.artists || []),
  ]).slice(0, 5);

  const queries = [];
  for (const title of titles) {
    for (const artist of artists.slice(0, 3)) {
      queries.push(`${title} ${artist}`);
    }
    queries.push(title);
  }
  return unique(queries).slice(0, 10);
}

function targetSearchQueries(queries = [], target = '') {
  const uniqueQueries = unique(queries);
  if (target !== 'apple') return uniqueQueries;
  return uniqueQueries.slice(0, APPLE_SEARCH_QUERY_LIMIT);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

export function summarizePlanItems(items) {
  const counts = {
    pending_search: 0,
    searching: 0,
    ready: 0,
    accepted: 0,
    already_present: 0,
    rejected: 0,
    low_score: 0,
    not_found: 0,
    needs_review: 0,
    excluded_by_decision: 0,
    rate_limited: 0,
    deferred: 0,
    error: 0,
  };
  for (const item of items) {
    counts[item.status] = (counts[item.status] || 0) + 1;
  }
  return {
    total: items.length,
    ...counts,
  };
}

function compactMatch(track, score) {
  return {
    track: {
      platform: track.platform,
      id: track.id,
      mid: track.mid,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationMs: track.durationMs || null,
      duration: track.duration || durationLabel(track.durationMs),
      isrc: track.isrc || null,
    },
    score,
  };
}

function compactAlternatives(candidates, selectedTrack) {
  const selectedKey = selectedTrack ? trackIdentity(selectedTrack) : '';
  return candidates
    .filter((track) => trackIdentity(track) !== selectedKey)
    .slice(0, 3)
    .map((track) => ({
      platform: track.platform,
      id: track.id,
      mid: track.mid,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration || durationLabel(track.durationMs),
      durationMs: track.durationMs || null,
      isrc: track.isrc || null,
    }));
}

function applySyncDecision(item, syncDecisions, aiSuggestions) {
  if (!item.decisionKey) return;
  const decision = syncDecisions?.items?.[item.decisionKey] || null;
  const aiSuggestion = aiSuggestions?.items?.[item.decisionKey] || null;
  item.decision = decision;
  item.aiSuggestion = aiSuggestion;
  if (decision?.action === 'accept' && item.match?.track?.id) {
    if (item.targetPresence?.inLibrary) {
      item.status = 'already_present';
      item.statusText = '已存在';
      return;
    }
    item.status = 'accepted';
    item.statusText = '已确认';
    return;
  }
  if (decision?.action === 'reject') {
    item.status = 'rejected';
    item.statusText = '已跳过';
  }
}

function flagDuplicateTargetMatches(items, target) {
  const groups = new Map();
  for (const item of items) {
    if (!['ready', 'accepted', 'low_score'].includes(item.status)) continue;
    const targetId = targetWriteTrackId(target, item.match?.track);
    if (!targetId) continue;
    if (!groups.has(targetId)) groups.set(targetId, []);
    groups.get(targetId).push(item);
  }

  for (const [targetId, group] of groups.entries()) {
    if (group.length < 2) continue;
    const siblings = group.map((item) => ({
      clusterId: item.clusterId,
      title: item.title,
      status: item.status,
      score: item.match?.score?.total ?? null,
    }));
    for (const item of group) {
      if (item.status === 'accepted') continue;
      if (item.status === 'ready') item.status = 'low_score';
      item.statusText = '低置信';
      item.error = `多个统一曲库条目命中同一个${TARGET_LABELS[target] || '目标平台'}歌曲，需人工确认后再写入。`;
      item.duplicateTarget = {
        target,
        id: targetId,
        siblings,
      };
    }
  }
  return items;
}

function targetWriteTrackId(target, track = {}) {
  const id = target === 'qq'
    ? track?.mid || track?.id
    : track?.id || track?.mid;
  return String(id || '').trim();
}

function syncDecisionKey(target, clusterId, track = {}) {
  return [
    target,
    clusterId,
    track.id || track.mid || normalizeText(`${track.title} ${track.artist} ${track.album}`),
  ].join(':');
}

function trackDecisionKey(platform, track = {}) {
  const identity = track.id || track.mid || [
    track.title,
    track.artist,
    track.album,
    track.duration,
  ].filter(Boolean).join('|');
  return `${platform}:${identity}`;
}

function trackIdentity(track = {}) {
  return `${track.platform || ''}:${track.id || track.mid || normalizeText(`${track.title} ${track.artist} ${track.album}`)}`;
}

function displayTrackScore(track) {
  let score = 0;
  if (track.title) score += 4;
  if (track.artist) score += 3;
  if (track.album) score += 1;
  if (track.isrc) score += 2;
  if (/[\u3400-\u9fff]/u.test(`${track.title} ${track.artist}`)) score += 2;
  return score;
}

function normalizeOffset(value) {
  if (value === undefined || value === null || value === '') return 0;
  return clampNumber(value, 0, Number.MAX_SAFE_INTEGER, 0);
}

function normalizePlanLimit(value, total, offset) {
  if (value === undefined || value === null || value === '' || value === 'all') {
    return Math.max(0, total - offset);
  }
  return clampNumber(value, 1, Math.max(1, total), Math.max(0, total - offset));
}

function normalizeTarget(target) {
  const value = String(target || '').trim();
  if (PLATFORMS.includes(value)) return value;
  throw new Error('缺少有效目标平台');
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function defaultPlaylistName() {
  const date = new Date().toISOString().slice(0, 10);
  return `Likes Sync ${date}`;
}

function makeDeferredPlanItem(item, target) {
  return {
    ...item,
    target,
    status: 'deferred',
    statusText: '待重试',
    match: null,
    alternatives: [],
    error: `${TARGET_LABELS[target] || '目标平台'}搜索触发频控，已暂停；稍后重新生成写入计划会继续解析。`,
    deferredBy: 'rate_limited',
  };
}

function buildReusablePlanMap(previousPlan, options) {
  const map = new Map();
  if (!isReusablePlan(previousPlan, options)) return map;
  for (const item of previousPlan.items || []) {
    if (!isReusablePlanItem(item)) continue;
    map.set(planItemKey(item), item);
  }
  return map;
}

function isReusablePlan(plan, options) {
  if (!plan?.resolve || plan.target !== options.target || !Array.isArray(plan.items)) return false;
  if (!sameNumber(plan.minScore, options.minScore) || !sameNumber(plan.reviewScore, options.reviewScore)) return false;
  return plan.searchLimit === undefined || plan.searchLimit === null || sameNumber(plan.searchLimit, options.searchLimit);
}

function isReusablePlanItem(item) {
  return ['ready', 'accepted', 'already_present', 'rejected', 'low_score', 'not_found'].includes(item?.status);
}

function reusableResolvedExecutionPlan(plan, target, options = {}) {
  if (!plan?.resolve || plan.target !== target || !Array.isArray(plan.items)) return null;
  if (plan.hasMore) return null;
  if ((plan.totalQueue || plan.items.length) > plan.items.length) return null;
  if (!isReusablePlan(plan, {
    target,
    minScore: clampNumber(options.minScore, 0, 1, 0.82),
    reviewScore: clampNumber(options.reviewScore, 0, 1, 0.68),
    searchLimit: clampNumber(options.searchLimit, 1, 30, 12),
  })) return null;
  const unresolved = plan.items.some((item) => (
    ['pending_search', 'searching', 'rate_limited', 'deferred', 'error'].includes(item.status)
  ));
  return unresolved ? null : plan;
}

function reuseResolvedPlanItem(item, targetLibrary = null) {
  let status = item.status;
  if (status === 'accepted' || status === 'rejected') {
    status = item.match?.track?.id ? 'ready' : 'low_score';
  }
  const reused = {
    status,
    statusText: planStatusText(status),
    match: item.match || null,
    decisionKey: item.decisionKey || '',
    alternatives: Array.isArray(item.alternatives) ? item.alternatives : [],
    error: '',
  };
  if (item.targetPresence?.inLibrary) reused.targetPresence = item.targetPresence;
  return applyTargetPresence(reused, targetLibrary, { autoStatus: status === 'ready' || status === 'already_present' });
}

function planStatusText(status) {
  const labels = {
    pending_search: '待搜索',
    searching: '搜索中',
    ready: '可写入',
    accepted: '已确认',
    already_present: '已存在',
    rejected: '已跳过',
    low_score: '低置信',
    not_found: '未命中',
    needs_review: '待决定',
    excluded_by_decision: '已分开/排除',
    rate_limited: '被限流',
    deferred: '待重试',
    error: '搜索失败',
  };
  return labels[status] || status || '';
}

function buildTargetLibrary(snapshot, target) {
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  if (!tracks.length) return null;
  const ids = new Map();
  const identities = new Map();
  for (const track of tracks) {
    for (const idValue of [track?.id, track?.mid]) {
      const id = String(idValue || '').trim();
      if (id && !ids.has(id)) ids.set(id, track);
    }
    const identity = normalizeText([track?.title, track?.artist, track?.album, track?.duration].filter(Boolean).join(' '));
    if (identity && !identities.has(identity)) identities.set(identity, track);
  }
  return {
    target,
    source: snapshot.source || '',
    fetchedAt: snapshot.fetchedAt || '',
    count: tracks.length,
    ids,
    identities,
  };
}

function applyTargetPresence(result, targetLibrary, options = {}) {
  if (!result?.match?.track || !targetLibrary) return result;
  const existing = findTargetLibraryTrack(targetLibrary, result.match.track);
  if (!existing) {
    if (result.status === 'already_present') {
      result.status = 'ready';
      result.statusText = planStatusText(result.status);
    }
    return result;
  }

  result.targetPresence = {
    inLibrary: true,
    source: targetLibrary.source,
    fetchedAt: targetLibrary.fetchedAt,
    reason: 'candidate_id_in_target_snapshot',
    track: compactTargetPresenceTrack(existing),
  };
  if (options.autoStatus) {
    result.status = 'already_present';
    result.statusText = planStatusText(result.status);
  }
  return result;
}

function findTargetLibraryTrack(targetLibrary, track = {}) {
  const id = String(track.id || track.mid || '').trim();
  if (id && targetLibrary.ids.has(id)) return targetLibrary.ids.get(id);
  const identity = normalizeText([track.title, track.artist, track.album, track.duration].filter(Boolean).join(' '));
  return identity ? targetLibrary.identities.get(identity) || null : null;
}

function compactTargetPresenceTrack(track = {}) {
  return {
    platform: track.platform || 'netease',
    id: track.id || track.mid || null,
    mid: track.mid || null,
    title: track.title || '',
    artist: track.artist || '',
    album: track.album || '',
    duration: track.duration || durationLabel(track.durationMs),
    durationMs: track.durationMs || null,
  };
}

function planItemKey(item = {}) {
  const source = item.source?.track || {};
  const identity = source.id || source.mid || normalizeText([
    source.title || item.title,
    source.artist || item.artist,
    source.album || item.album,
    source.duration || item.duration,
  ].filter(Boolean).join(' '));
  return [
    item.clusterId || '',
    item.source?.platform || '',
    identity,
  ].join(':');
}

function sameNumber(left, right) {
  return Number(left) === Number(right);
}

function isRateLimitedError(error) {
  return isNeteaseRateLimitError(error)
    || /操作频繁|稍候|稍后|\b405\b|HTTP (403|429)|rate.?limit|too many/i.test(formatErrorMessage(error));
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const key = normalizeText(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function uniqueQQWriteTracks(tracks) {
  const seen = new Set();
  const result = [];
  for (const track of tracks || []) {
    const key = String(track?.mid || track?.id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...track,
      id: track?.id ? String(track.id).trim() : '',
      mid: track?.mid ? String(track.mid).trim() : '',
    });
  }
  return result;
}
