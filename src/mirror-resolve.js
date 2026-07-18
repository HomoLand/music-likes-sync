import { classifyTrackCandidates } from './match.js';
import { buildMatchSearchPlan } from './match-query.js';
import { durationLabel, normalizeText } from './normalize.js';
import { trackArtworkUrl } from './track-media.js';

const DEFAULT_MATCH_THRESHOLD = 0.82;
const DEFAULT_REVIEW_THRESHOLD = 0.68;
const DEFAULT_MINIMUM_SCORE_MARGIN = 0.04;
const DEFAULT_QUERY_LIMIT = 8;
const DEFAULT_QUERY_CONCURRENCY = 2;
const DEFAULT_SEARCH_TIMEOUT_MS = 15000;

export async function resolveMirrorAddOperations(plan, options = {}) {
  if (!plan || plan.mode !== 'source_of_truth_mirror') {
    throw new Error('缺少 Apple 可信源镜像计划。');
  }
  if (typeof options.searchTracks !== 'function') {
    throw new Error('解析新增曲目需要目标平台搜索适配器。');
  }

  const thresholds = {
    match: normalizeThreshold(options.threshold ?? plan.thresholds?.match, DEFAULT_MATCH_THRESHOLD),
    review: normalizeThreshold(options.reviewThreshold ?? plan.thresholds?.review, DEFAULT_REVIEW_THRESHOLD),
  };
  const limit = Math.min(200, Math.max(1, Number(options.limit || 50)));
  const searchLimit = Math.min(30, Math.max(1, Number(options.searchLimit || 12)));
  const queryLimit = Math.min(16, Math.max(1, Number(options.queryLimit || DEFAULT_QUERY_LIMIT)));
  const queryConcurrency = Math.min(4, Math.max(1, Number(options.queryConcurrency || DEFAULT_QUERY_CONCURRENCY)));
  const searchTimeoutMs = Math.min(60000, Math.max(50, Number(options.searchTimeoutMs || DEFAULT_SEARCH_TIMEOUT_MS)));
  const minimumScoreMargin = normalizeThreshold(
    options.minimumScoreMargin,
    DEFAULT_MINIMUM_SCORE_MARGIN,
  );
  const offset = Math.max(0, Number(options.offset || 0));
  const allAddOperations = (plan.operations || [])
    .filter((operation) => operation.action === 'add');
  const pendingAddOperations = allAddOperations.filter((operation) => needsAddResolution(operation, options.refresh === true));
  const page = pendingAddOperations.slice(offset, offset + limit);
  const searchCache = new Map();
  const resolved = [];

  const operations = (plan.operations || []).map((operation) => ({ ...operation }));
  const operationById = new Map(operations.map((operation) => [operation.id, operation]));

  for (const operation of page) {
    const next = operationById.get(operation.id);
    const resolution = await resolveOneAdd(operation, {
      thresholds,
      searchLimit,
      queryLimit,
      queryConcurrency,
      searchTimeoutMs,
      minimumScoreMargin,
      targetPlatform: plan.target?.platform || operation.targetPlatform || '',
      searchCache,
      searchTracks: options.searchTracks,
      onProgress: options.onProgress,
    });
    Object.assign(next, resolution);
    resolved.push({
      id: next.id,
      status: next.status,
      title: next.sourceTrack?.title || '',
      targetTitle: next.resolvedTargetTrack?.title || '',
      reason: next.resolution?.reason || '',
    });
    if (typeof options.onProgress === 'function') {
      await options.onProgress({
        targetPlatform: plan.target?.platform || '',
        processed: resolved.length,
        total: page.length,
        status: next.status,
      });
    }
  }

  return {
    ...plan,
    generatedAt: plan.generatedAt,
    resolvedAt: new Date().toISOString(),
    addResolution: {
      totalAdd: allAddOperations.length,
      pendingAdd: pendingAddOperations.length,
      offset,
      limit,
      processed: page.length,
      remaining: Math.max(0, pendingAddOperations.length - offset - page.length),
      hasMore: offset + page.length < pendingAddOperations.length,
      resolved: resolved.filter((item) => item.status === 'ready').length,
      review: resolved.filter((item) => item.status === 'needs_review').length,
      notFound: resolved.filter((item) => item.status === 'not_found').length,
      items: resolved,
    },
    summary: summarizeResolvedOperations(operations),
    operations,
  };
}

function needsAddResolution(operation = {}, refresh = false) {
  if (operation.action !== 'add') return false;
  if (operation.targetTrack) return false;
  if (refresh) return operation.status !== 'ready';
  if (operation.resolvedTargetTrack) return false;
  return operation.status !== 'needs_review' && operation.status !== 'not_found';
}

async function resolveOneAdd(operation, context) {
  const source = operation.sourceTrack;
  if (!source?.title) {
    return {
      status: 'needs_review',
      resolution: {
        reason: 'missing_source_track',
        message: 'The add operation has no usable source track.',
      },
    };
  }

  const candidates = [];
  const seen = new Set();
  const candidateSearchEvidence = new Map();
  const searchErrors = [];
  const searchPlan = buildMatchSearchPlan(source, {
    targetPlatform: context.targetPlatform,
    limit: context.queryLimit,
  });
  const executedSearchSteps = [];
  for (let index = 0; index < searchPlan.length; index += context.queryConcurrency) {
    const wave = searchPlan.slice(index, index + context.queryConcurrency);
    const resultsByStep = await Promise.all(wave.map(async (step) => ({
      step,
      outcome: await executeSearchStep(step, context),
    })));
    for (const { step, outcome } of resultsByStep) {
      const results = outcome.results;
      executedSearchSteps.push(step);
      if (outcome.error) {
        searchErrors.push({ strategy: step.strategy, code: outcome.error.code });
      }
      for (const [providerRank, track] of results.entries()) {
        const key = trackKey(track);
        recordCandidateSearchEvidence(candidateSearchEvidence, key, step, providerRank);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(track);
      }
    }
    if (hasAuthoritativeCandidate(source, candidates, context.thresholds.match)) break;
  }

  const searchSummary = compactSearchSummary(executedSearchSteps, searchErrors);

  if (!candidates.length) {
    if (searchErrors.length) {
      return {
        status: 'needs_review',
        candidateTrack: null,
        resolvedTargetTrack: null,
        resolution: {
          reason: 'target_catalog_search_incomplete',
          message: 'One or more target catalog searches timed out, so this track was not classified as missing.',
          ...searchSummary,
        },
        alternatives: [],
      };
    }
    return {
      status: 'not_found',
      resolution: {
        reason: 'target_catalog_not_found',
        message: 'No target-platform catalog candidate was found.',
        ...searchSummary,
      },
      alternatives: [],
    };
  }

  const decision = classifyTrackCandidates(source, candidates, {
    ...context.thresholds,
    allowAmbiguousFingerprint: true,
    minimumScoreMargin: context.minimumScoreMargin,
  });
  const best = decision.best;
  const resolvedScore = compactResolutionScore(decision);
  const incompleteSearch = searchErrors.length > 0;
  const authoritativeMatch = isAuthoritativeScore(best?.score);
  if (decision.status === 'match' && (!incompleteSearch || authoritativeMatch)) {
    return {
      status: 'ready',
      resolvedTargetTrack: compactResolvedTrack(
        best.track,
        compactCandidateMatch(best, candidateSearchEvidence, 0),
      ),
      resolvedScore,
      resolution: {
        reason: 'resolved_target_match',
        message: 'A high-confidence target-platform catalog track was found.',
        ...searchSummary,
      },
      alternatives: compactAlternatives(
        decision.rankedCandidates,
        best.track,
        candidateSearchEvidence,
      ),
    };
  }

  if (decision.status === 'missing' && !incompleteSearch) {
    return {
      status: 'not_found',
      candidateTrack: null,
      resolvedTargetTrack: null,
      resolvedScore,
      resolution: {
        reason: 'target_catalog_low_score',
        message: 'Target-platform search results are clearly different recordings; no suitable catalog match was found.',
        ...searchSummary,
      },
      alternatives: compactAlternatives(
        decision.rankedCandidates,
        null,
        candidateSearchEvidence,
      ),
    };
  }
  return {
    status: 'needs_review',
    candidateTrack: compactResolvedTrack(
      best.track,
      compactCandidateMatch(best, candidateSearchEvidence, 0),
    ),
    resolvedScore,
    resolution: {
      reason: incompleteSearch
        ? 'target_catalog_search_incomplete'
        : decision.ambiguityReason || 'low_confidence_target_match',
      message: incompleteSearch
        ? 'One or more target catalog searches timed out; the available candidate cannot be selected automatically.'
        : resolutionReviewMessage(decision.ambiguityReason),
      ...searchSummary,
    },
    alternatives: compactAlternatives(
      decision.rankedCandidates,
      best.track,
      candidateSearchEvidence,
    ),
  };
}

async function executeSearchStep(step, context) {
  const cacheKey = normalizeText(step.query);
  if (context.searchCache.has(cacheKey)) {
    return { results: context.searchCache.get(cacheKey), error: null };
  }
  try {
    const results = await withTimeout(
      Promise.resolve(context.searchTracks(step.query, { limit: context.searchLimit })),
      context.searchTimeoutMs,
      `Target catalog search timed out after ${context.searchTimeoutMs} ms.`,
    );
    const normalized = Array.isArray(results) ? results : [];
    context.searchCache.set(cacheKey, normalized);
    return { results: normalized, error: null };
  } catch (error) {
    if (error?.code !== 'MATCH_SEARCH_TIMEOUT') throw error;
    return { results: [], error: { code: 'timeout' } };
  }
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(message);
          error.code = 'MATCH_SEARCH_TIMEOUT';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function resolutionReviewMessage(reason) {
  if (reason === 'insufficient_identity_evidence') {
    return 'The candidate score is high, but artist identity is not supported strongly enough for automatic selection.';
  }
  if (reason) return 'Several target-platform candidates are too close to choose safely.';
  return 'A target-platform candidate exists, but it is below the automatic add threshold.';
}

function hasAuthoritativeCandidate(source, candidates, threshold) {
  const decision = classifyTrackCandidates(source, candidates, {
    threshold,
    reviewThreshold: threshold,
    allowAmbiguousFingerprint: true,
  });
  const score = decision.best?.score;
  return decision.status === 'match' && isAuthoritativeScore(score);
}

function isAuthoritativeScore(score = {}) {
  return Boolean(
    score?.isrc === 1
    || score?.appleEquivalentFingerprint
    || score?.catalogTrackFingerprint
  );
}

function compactAlternatives(rankedCandidates, selected, searchEvidence) {
  const selectedKey = selected ? trackKey(selected) : '';
  return rankedCandidates
    .filter((candidate) => trackKey(candidate.track) !== selectedKey)
    .slice(0, 5)
    .map((candidate, index) => compactResolvedTrack(
      candidate.track,
      compactCandidateMatch(candidate, searchEvidence, index + 1),
    ));
}

function compactResolvedTrack(track, match = null) {
  if (!track) return null;
  return {
    platform: track.platform || '',
    id: track.id || null,
    mid: track.mid || null,
    title: track.title || '',
    artist: track.artist || '',
    artists: Array.isArray(track.artists) ? track.artists : [],
    album: track.album || '',
    duration: durationLabel(track.durationMs),
    durationMs: track.durationMs || null,
    isrc: track.isrc || null,
    songType: track.songType ?? null,
    artworkUrl: trackArtworkUrl(track),
    aliases: compactAliases(track.aliases),
    metadata: compactResolvedMetadata(track.metadata),
    ...(match ? { match } : {}),
  };
}

function compactResolutionScore(decision) {
  if (!decision.best?.score) return null;
  return {
    ...decision.best.score,
    scoreMargin: decision.scoreMargin,
    runnerUpTotal: decision.runnerUp?.score?.total ?? null,
    candidateCount: decision.candidateCount,
    ...(decision.ambiguityReason ? { ambiguityReason: decision.ambiguityReason } : {}),
  };
}

function compactCandidateMatch(candidate, searchEvidence, rank) {
  const evidence = searchEvidence.get(trackKey(candidate.track));
  return {
    rank: rank + 1,
    score: candidate.score,
    searchStrategies: [...(evidence?.strategies || [])],
    storefronts: [...(evidence?.storefronts || [])],
    bestProviderRank: Number.isFinite(evidence?.bestProviderRank)
      ? evidence.bestProviderRank + 1
      : null,
  };
}

function recordCandidateSearchEvidence(index, key, step, providerRank) {
  const current = index.get(key) || {
    strategies: new Set(),
    storefronts: new Set(),
    bestProviderRank: Number.POSITIVE_INFINITY,
  };
  current.strategies.add(step.strategy);
  if (step.storefront) current.storefronts.add(step.storefront);
  current.bestProviderRank = Math.min(current.bestProviderRank, providerRank);
  index.set(key, current);
}

function compactSearchSummary(steps, errors = []) {
  return {
    queryCount: steps.length,
    searchStrategies: [...new Set(steps.map((step) => step.strategy))],
    storefronts: [...new Set(steps.map((step) => step.storefront).filter(Boolean))],
    queryErrorCount: errors.length,
    searchErrorCodes: [...new Set(errors.map((error) => error.code).filter(Boolean))],
  };
}

function compactResolvedMetadata(metadata) {
  if (!metadata?.providerCatalog) return null;
  const value = metadata.providerCatalog;
  return {
    providerCatalog: {
      platform: value.platform || '',
      trackNumber: Number(value.trackNumber || 0),
      discNumber: Number(value.discNumber || 0),
      albumId: value.albumId || '',
      albumMid: value.albumMid || '',
      subtitle: value.subtitle || '',
      releaseDate: value.releaseDate || '',
    },
  };
}

function compactAliases(aliases = {}) {
  const result = {};
  for (const key of ['titles', 'artists', 'albums']) {
    const values = Array.isArray(aliases?.[key]) ? aliases[key].filter(Boolean).slice(0, 24) : [];
    if (values.length) result[key] = values;
  }
  return Object.keys(result).length ? result : null;
}

function trackKey(track = {}) {
  return `${track.platform || ''}:${track.id || track.mid || normalizeText(`${track.title} ${track.artist} ${track.album}`)}`;
}

function summarizeResolvedOperations(operations = []) {
  const summary = {
    total: operations.length,
    keep: 0,
    add: 0,
    remove: 0,
    review: 0,
    destructive: 0,
    ready: 0,
    blocked: 0,
    resolvedAdds: 0,
    unresolvedAdds: 0,
  };
  for (const operation of operations) {
    const action = operation.action || 'review';
    summary[action] = (summary[action] || 0) + 1;
    if (operation.destructive) summary.destructive += 1;
    if (operation.status === 'ready') summary.ready += 1;
    else summary.blocked += 1;
    if (action === 'add') {
      if (operation.resolvedTargetTrack) summary.resolvedAdds += 1;
      else summary.unresolvedAdds += 1;
    }
  }
  return summary;
}

function normalizeThreshold(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}
