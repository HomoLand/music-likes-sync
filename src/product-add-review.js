export function buildProductAddReviewItems(plan, options = {}) {
  const targets = new Set(normalizeTargets(options.targets));
  const requested = new Set(normalizeIds(options.operationIds));
  const limit = Math.min(50, Math.max(1, Number(options.limit || 12)));
  return (plan?.operations || [])
    .filter((operation) => operation?.action === 'add')
    .filter((operation) => operation.status === 'needs_review' && operation.candidateTrack)
    .filter((operation) => !targets.size || targets.has(operation.targetPlatform))
    .filter((operation) => !requested.size || requested.has(operation.id))
    .filter((operation) => options.refresh || !operation.aiReview)
    .slice(0, limit)
    .map(productAddOperationToReviewItem);
}

export function attachProductAddReviewResult(plan, result = {}) {
  const reviewedAt = result.reviewedAt || new Date().toISOString();
  const decisions = new Map((result.decisions || []).map((decision) => [decision.itemId, decision]));
  let changed = 0;
  const operations = (plan?.operations || []).map((operation) => {
    const decision = decisions.get(operation.id);
    if (!decision || operation.action !== 'add') return operation;
    changed += 1;
    return {
      ...operation,
      aiReview: compactProductAddReview(decision, {
        batchId: result.batchId,
        model: result.model,
        reviewedAt,
      }),
    };
  });
  const summary = summarizeProductAddReview(result.decisions || []);
  const previousBatches = Array.isArray(plan?.addAiReview?.batches) ? plan.addAiReview.batches : [];
  return {
    plan: {
      ...plan,
      operations,
      addAiReview: {
        reviewedAt,
        latestBatchId: result.batchId || '',
        latestModel: result.model || '',
        latest: summary,
        batches: [{
          batchId: result.batchId || '',
          model: result.model || '',
          reviewedAt,
          usage: sanitizeUsage(result.usage),
          ...summary,
        }, ...previousBatches].slice(0, 50),
      },
    },
    changed,
    summary,
  };
}

export function summarizeProductAddReview(decisions = []) {
  const summary = {
    total: decisions.length,
    add: 0,
    skip: 0,
    needsHuman: 0,
    guarded: 0,
  };
  for (const decision of decisions) {
    if (decision.recommendedAction === 'add') summary.add += 1;
    else if (decision.recommendedAction === 'skip') summary.skip += 1;
    else summary.needsHuman += 1;
    if (decision.safety?.guarded) summary.guarded += 1;
  }
  return summary;
}

function productAddOperationToReviewItem(operation) {
  const source = operation.sourceTrack || {};
  return {
    decisionKey: operation.id,
    clusterId: operation.clusterId || '',
    target: operation.targetPlatform || operation.candidateTrack?.platform || '',
    status: operation.status,
    title: source.title || '',
    artist: source.artist || artistsText(source.artists),
    album: source.album || '',
    durationMs: source.durationMs || null,
    presentPlatforms: [operation.sourcePlatform || 'apple'],
    source: {
      platform: operation.sourcePlatform || source.platform || 'apple',
      track: source,
    },
    match: {
      track: operation.candidateTrack,
      score: operation.resolvedScore || operation.score || null,
    },
    targetPresence: { inLibrary: false },
    alternatives: Array.isArray(operation.alternatives) ? operation.alternatives.slice(0, 3) : [],
    queries: Array.isArray(operation.resolution?.queries) ? operation.resolution.queries.slice(0, 6) : [],
  };
}

function compactProductAddReview(decision, meta = {}) {
  return {
    batchId: String(meta.batchId || ''),
    model: String(meta.model || ''),
    reviewedAt: String(meta.reviewedAt || ''),
    decision: String(decision.decision || 'uncertain'),
    relation: String(decision.relation || 'uncertain'),
    recommendedAction: String(decision.recommendedAction || 'needs_human'),
    confidence: clamp(Number(decision.confidence || 0), 0, 1),
    evidence: {
      title: clean(decision.evidence?.title, 120),
      artist: clean(decision.evidence?.artist, 120),
      album: clean(decision.evidence?.album, 120),
      duration: clean(decision.evidence?.duration, 120),
      version: clean(decision.evidence?.version, 120),
    },
    reason: clean(decision.reason, 600),
    safety: decision.safety?.guarded ? {
      guarded: true,
      code: clean(decision.safety.code, 80),
      reason: clean(decision.safety.reason, 240),
    } : null,
  };
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return Object.fromEntries(Object.entries(usage)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([key, value]) => [key, Number(value)]));
}

function normalizeTargets(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((item) => String(item || '').trim().toLowerCase()).filter((item) => item === 'qq' || item === 'netease'))];
}

function normalizeIds(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
}

function artistsText(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || '');
}

function clean(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
