import { auditTargetIdentityCollisions } from './match-audit.js';
import { buildMatchSearchPlan } from './match-query.js';

const TARGETS = new Set(['qq', 'netease']);

export function buildMatchShadowPlan(preview = {}, targetPlatform, options = {}) {
  const target = normalizeTarget(targetPlatform);
  const limit = Math.min(200, Math.max(1, Number(options.limit || 200)));
  const selected = selectMatchShadowOperations(preview.operations, target).slice(0, limit);
  const operations = selected.map((operation) => ({
    ...operation,
    status: 'needs_resolution',
    candidateTrack: null,
    resolvedTargetTrack: null,
    resolvedScore: null,
    alternatives: [],
    resolution: null,
  }));

  return {
    version: 1,
    mode: 'source_of_truth_mirror',
    generatedAt: preview.generatedAt || new Date().toISOString(),
    source: {
      platform: 'apple',
      count: operations.length,
    },
    target: {
      platform: target,
      count: 0,
    },
    thresholds: {
      match: Number(preview.thresholds?.match ?? 0.82),
      review: Number(preview.thresholds?.review ?? 0.68),
    },
    summary: {
      total: operations.length,
      add: operations.length,
      ready: 0,
      blocked: operations.length,
    },
    operations,
  };
}

export function selectMatchShadowOperations(operations = [], targetPlatform = '') {
  const target = normalizeTarget(targetPlatform);
  return (Array.isArray(operations) ? operations : []).filter((operation) => (
    operation?.action === 'add'
    && operation?.status !== 'ready'
    && !operation?.targetTrack
    && operation?.sourceTrack?.title
    && normalizeTarget(operation?.targetPlatform) === target
  ));
}

export function summarizeMatchShadowBaseline(preview = {}) {
  const targetReports = {};
  for (const target of TARGETS) {
    const operations = selectMatchShadowOperations(preview.operations, target);
    const strategies = {};
    let storefrontQueryOperations = 0;
    let localizedAliasPairOperations = 0;
    let totalQueries = 0;
    for (const operation of operations) {
      const plan = buildMatchSearchPlan(operation.sourceTrack, {
        targetPlatform: target,
      });
      const operationStrategies = new Set(plan.map((item) => item.strategy));
      totalQueries += plan.length;
      for (const strategy of operationStrategies) increment(strategies, strategy);
      if (operationStrategies.has('apple_storefront_title_artist')) storefrontQueryOperations += 1;
      if (operationStrategies.has('title_alias_artist_alias')) localizedAliasPairOperations += 1;
    }
    targetReports[target] = {
      operations: operations.length,
      statuses: countBy(operations, (operation) => operation.status || 'unknown'),
      reasons: countBy(operations, operationReason),
      queryCoverage: {
        storefrontQueryOperations,
        localizedAliasPairOperations,
        averageQueries: ratio(totalQueries, operations.length),
        strategies,
      },
    };
  }

  return {
    operationCount: Array.isArray(preview.operations) ? preview.operations.length : 0,
    targets: targetReports,
    identityAudit: auditTargetIdentityCollisions(preview.operations).summary,
  };
}

export function summarizeMatchShadowResolution(preview = {}, resolvedPlan = {}) {
  const originalById = new Map((preview.operations || []).map((operation) => [operation.id, operation]));
  const resolved = Array.isArray(resolvedPlan.operations) ? resolvedPlan.operations : [];
  const transitions = {};
  const beforeStatuses = {};
  const afterStatuses = {};
  const afterReasons = {};
  const strategies = {};
  const storefronts = {};
  let totalQueries = 0;

  for (const operation of resolved) {
    const original = originalById.get(operation.id) || {};
    const before = original.status || 'unknown';
    const after = operation.status || 'unknown';
    increment(beforeStatuses, before);
    increment(afterStatuses, after);
    increment(transitions, `${before}->${after}`);
    increment(afterReasons, operationReason(operation));
    totalQueries += Number(operation.resolution?.queryCount || 0);
    for (const strategy of operation.resolution?.searchStrategies || []) increment(strategies, strategy);
    for (const storefront of operation.resolution?.storefronts || []) increment(storefronts, storefront);
  }

  return {
    targetPlatform: normalizeTarget(resolvedPlan.target?.platform),
    operations: resolved.length,
    beforeStatuses,
    afterStatuses,
    transitions,
    afterReasons,
    recoveredReady: Number(afterStatuses.ready || 0),
    remainingReview: Number(afterStatuses.needs_review || 0),
    remainingNotFound: Number(afterStatuses.not_found || 0),
    search: {
      totalQueries,
      averageQueries: ratio(totalQueries, resolved.length),
      strategies,
      storefronts,
    },
  };
}

export function projectMatchShadowOperations(preview = {}, resolvedPlans = []) {
  const replacements = new Map();
  for (const plan of resolvedPlans) {
    for (const operation of plan?.operations || []) replacements.set(operation.id, operation);
  }
  return (preview.operations || []).map((operation) => replacements.get(operation.id) || operation);
}

function normalizeTarget(value) {
  const target = String(value || '').trim().toLowerCase();
  if (!TARGETS.has(target)) throw new Error(`Unsupported match-shadow target: ${target || 'missing'}`);
  return target;
}

function operationReason(operation = {}) {
  return String(operation.resolution?.reason || operation.reason || 'unknown');
}

function countBy(values, keyFor) {
  const counts = {};
  for (const value of values) increment(counts, keyFor(value));
  return counts;
}

function increment(counts, key) {
  const name = String(key || 'unknown');
  counts[name] = Number(counts[name] || 0) + 1;
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
}
