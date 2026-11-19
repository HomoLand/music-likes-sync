import { mirrorReviewDecisionKey } from './mirror-sync.js';

const TARGETS = new Set(['qq', 'netease']);
const ACTIONS = new Set(['keep', 'separate', 'needs_human']);
const RELATIONS = new Set(['same_recording', 'same_song_different_version', 'different_song', 'uncertain']);

export function buildProductIdentityReviewOperations(plan, options = {}) {
  const targets = new Set(normalizeTargets(options.targets));
  const requested = new Set(normalizeIds(options.operationIds));
  const limit = Math.min(50, Math.max(1, Number(options.limit || 12)));
  return (plan?.operations || [])
    .filter((operation) => operation?.action === 'review' && operation.status === 'needs_review')
    .filter((operation) => operation.sourceTrack && (operation.targetTrack || operation.candidateTrack))
    .filter((operation) => !targets.size || targets.has(operation.targetPlatform))
    .filter((operation) => !requested.size || requested.has(operation.id))
    .filter((operation) => options.refresh || !operation.aiReview)
    .slice(0, limit)
    .map((operation) => ({
      ...operation,
      decisionKey: productIdentityDecisionKey(operation),
    }));
}

export function upsertProductIdentityReviewResult(state = {}, result = {}) {
  const reviewedAt = result.reviewedAt || new Date().toISOString();
  const items = { ...(state.items || {}) };
  let changed = 0;
  for (const decision of result.decisions || []) {
    const key = clean(decision.decisionKey || decision.itemId, 1000);
    if (!key) continue;
    items[key] = {
      ...compactIdentitySuggestion(decision, {
        batchId: result.batchId,
        model: result.model,
        reviewedAt,
      }),
      itemId: key,
      decisionKey: key,
      operationId: clean(decision.operationId, 160),
      target: normalizeTarget(decision.target),
      reasonCode: clean(decision.reasonCode, 120),
      updatedAt: reviewedAt,
    };
    changed += 1;
  }

  const summary = summarizeProductIdentityReview(result.decisions || []);
  const batches = [{
    batchId: clean(result.batchId, 160),
    model: clean(result.model, 160),
    reviewedAt,
    itemCount: Number(result.itemCount || summary.total),
    decisionCount: summary.total,
    usage: sanitizeUsage(result.usage),
    ...summary,
  }, ...(Array.isArray(state.batches) ? state.batches : [])].slice(0, 50);

  return {
    state: {
      version: 1,
      updatedAt: reviewedAt,
      items,
      batches,
    },
    changed,
    summary,
  };
}

export function attachProductIdentityReviewSuggestions(plan, state = {}) {
  const suggestions = state.items || {};
  const operations = (plan?.operations || []).map((operation) => {
    if (operation.action !== 'review') return operation;
    const decisionKey = productIdentityDecisionKey(operation);
    const suggestion = suggestions[decisionKey];
    if (!suggestion) return { ...operation, decisionKey };
    return {
      ...operation,
      decisionKey,
      aiReview: compactIdentitySuggestion(suggestion, suggestion),
    };
  });
  const batches = Array.isArray(state.batches) ? state.batches.slice(0, 50) : [];
  return {
    ...plan,
    operations,
    identityAiReview: batches.length ? {
      reviewedAt: state.updatedAt || batches[0]?.reviewedAt || '',
      latestBatchId: batches[0]?.batchId || '',
      latestModel: batches[0]?.model || '',
      latest: summarizeBatch(batches[0]),
      batches,
    } : plan?.identityAiReview,
  };
}

export function summarizeProductIdentityReview(decisions = []) {
  const summary = {
    total: decisions.length,
    keep: 0,
    separate: 0,
    needsHuman: 0,
    guarded: 0,
  };
  for (const decision of decisions) {
    const action = normalizeAction(decision.recommendedAction);
    if (action === 'keep') summary.keep += 1;
    else if (action === 'separate') summary.separate += 1;
    else summary.needsHuman += 1;
    if (decision.safety?.guarded) summary.guarded += 1;
  }
  return summary;
}

export function productIdentityDecisionKey(operation = {}) {
  return clean(operation.decisionKey, 1000) || mirrorReviewDecisionKey(operation);
}

export function productIdentityDecisionState(state = {}) {
  return {
    version: 1,
    updatedAt: state.updatedAt || '',
    items: Object.fromEntries(Object.entries(state.items || {})
      .filter(([, decision]) => decision && !decision.aiAppliedAt)),
  };
}

function compactIdentitySuggestion(decision = {}, meta = {}) {
  return {
    batchId: clean(meta.batchId || decision.batchId, 160),
    model: clean(meta.model || decision.model, 160),
    reviewedAt: clean(meta.reviewedAt || decision.reviewedAt || decision.updatedAt, 80),
    decision: normalizeDecision(decision.decision),
    relation: normalizeRelation(decision.relation),
    recommendedAction: normalizeAction(decision.recommendedAction),
    confidence: clamp(Number(decision.confidence || 0), 0, 1),
    evidence: {
      title: clean(decision.evidence?.title, 120),
      artist: clean(decision.evidence?.artist, 120),
      album: clean(decision.evidence?.album, 120),
      duration: clean(decision.evidence?.duration, 120),
      external: clean(decision.evidence?.external, 160),
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

function summarizeBatch(batch = {}) {
  return {
    total: Number(batch.total || batch.decisionCount || 0),
    keep: Number(batch.keep || 0),
    separate: Number(batch.separate || 0),
    needsHuman: Number(batch.needsHuman || 0),
    guarded: Number(batch.guarded || 0),
  };
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  return Object.fromEntries(Object.entries(usage)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([key, value]) => [key, Number(value)]));
}

function normalizeTargets(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map(normalizeTarget).filter(Boolean))];
}

function normalizeIds(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((item) => clean(item, 160)).filter(Boolean))];
}

function normalizeTarget(value) {
  const target = clean(value, 20).toLowerCase();
  return TARGETS.has(target) ? target : '';
}

function normalizeAction(value) {
  const action = clean(value, 40).toLowerCase();
  return ACTIONS.has(action) ? action : 'needs_human';
}

function normalizeRelation(value) {
  const relation = clean(value, 80).toLowerCase();
  return RELATIONS.has(relation) ? relation : 'uncertain';
}

function normalizeDecision(value) {
  const decision = clean(value, 40).toLowerCase();
  return ['same', 'different', 'uncertain'].includes(decision) ? decision : 'uncertain';
}

function clean(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
