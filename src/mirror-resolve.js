import { compareAppleToPlatform } from './match.js';
import { durationLabel, normalizeText } from './normalize.js';

const DEFAULT_MATCH_THRESHOLD = 0.82;
const DEFAULT_REVIEW_THRESHOLD = 0.68;

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
  const offset = Math.max(0, Number(options.offset || 0));
  const allAddOperations = (plan.operations || [])
    .filter((operation) => operation.action === 'add');
  const pendingAddOperations = allAddOperations.filter(needsAddResolution);
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

function needsAddResolution(operation = {}) {
  if (operation.action !== 'add') return false;
  if (operation.resolvedTargetTrack || operation.targetTrack) return false;
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
  for (const query of buildAddSearchQueries(source)) {
    const cacheKey = normalizeText(query);
    const results = context.searchCache.has(cacheKey)
      ? context.searchCache.get(cacheKey)
      : await context.searchTracks(query, { limit: context.searchLimit });
    context.searchCache.set(cacheKey, results || []);
    for (const track of results || []) {
      const key = `${track.platform || ''}:${track.id || track.mid || normalizeText(`${track.title} ${track.artist} ${track.album}`)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(track);
    }
    if (hasConfidentCandidate(source, candidates, context.thresholds.match)) break;
  }

  if (!candidates.length) {
    return {
      status: 'not_found',
      resolution: {
        reason: 'target_catalog_not_found',
        message: 'No target-platform catalog candidate was found.',
      },
      alternatives: [],
    };
  }

  const comparison = compareAppleToPlatform([source], candidates, context.thresholds);
  const match = comparison.matches[0];
  if (match) {
    return {
      status: 'ready',
      resolvedTargetTrack: compactResolvedTrack(match.target),
      resolvedScore: match.score,
      resolution: {
        reason: 'resolved_target_match',
        message: 'A high-confidence target-platform catalog track was found.',
      },
      alternatives: compactAlternatives(candidates, match.target),
    };
  }

  const review = comparison.reviewItems[0];
  const best = review || comparison.missingItems[0]?.best || null;
  return {
    status: 'needs_review',
    candidateTrack: compactResolvedTrack(best?.target),
    resolvedScore: best?.score || null,
    resolution: {
      reason: review ? 'low_confidence_target_match' : 'target_catalog_low_score',
      message: 'A target-platform candidate exists, but it is below the automatic add threshold.',
    },
    alternatives: compactAlternatives(candidates, best?.target),
  };
}

function buildAddSearchQueries(track) {
  return unique([
    [track.title, track.artist].filter(Boolean).join(' '),
    [track.title, track.artists?.[0]].filter(Boolean).join(' '),
    track.title,
  ]).filter(Boolean).slice(0, 4);
}

function hasConfidentCandidate(source, candidates, threshold) {
  return Boolean(compareAppleToPlatform([source], candidates, {
    threshold,
    reviewThreshold: threshold,
  }).matches[0]);
}

function compactAlternatives(candidates, selected) {
  const selectedKey = selected ? trackKey(selected) : '';
  return candidates
    .filter((track) => trackKey(track) !== selectedKey)
    .slice(0, 5)
    .map(compactResolvedTrack);
}

function compactResolvedTrack(track) {
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
  };
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

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}
