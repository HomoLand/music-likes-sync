import { buildMatchEvidence } from './evidence.js';
import { compareAppleToPlatform } from './match.js';

const DEFAULT_MATCH_THRESHOLD = 0.82;
const DEFAULT_REVIEW_THRESHOLD = 0.68;
const EXPLANATION_ACTIONS = new Set([
  'review_tombstone',
  'execute_confirmed_delete',
  'execute_addition',
  'resolve_before_add',
  'review_manually',
  'keep',
]);
const TOMBSTONE_GROUPS = new Set([
  'needs_review',
  'confirmed_global_delete',
  'restore_requested',
  'current_platform_only',
  'ignored',
]);
const TOMBSTONE_ACTIONS = new Set([
  'review_tombstone',
  'execute_confirmed_delete',
  'restore',
  'current_platform_only',
  'ignore',
]);
const TOMBSTONE_RISKS = new Set(['low', 'medium', 'high']);

export function evaluateAiFixtureCases(cases = [], options = {}) {
  const thresholds = {
    threshold: Number(options.threshold ?? DEFAULT_MATCH_THRESHOLD),
    reviewThreshold: Number(options.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD),
  };
  const minExact = Number(options.minExact ?? 0.75);
  const evaluated = cases.map((testCase) => evaluateAiFixtureCase(testCase, thresholds));
  const summary = summarizeAiEval(evaluated);
  return {
    ok: summary.exactRate >= minExact && summary.failures === 0,
    minExact,
    thresholds,
    summary,
    cases: evaluated,
  };
}

export function evaluateAiFixtureCase(testCase = {}, thresholds = {}) {
  const source = testCase.source || {};
  const target = testCase.target || {};
  const comparison = compareAppleToPlatform([source], [target], thresholds);
  const candidate = comparison.matches[0] || comparison.reviewItems[0] || comparison.missingItems[0]?.best || null;
  const score = candidate?.score || null;
  const evidence = buildMatchEvidence(source, target, score);
  const predictedRelation = classifyTrackPair({ source, target, score, evidence });
  const expectedRelation = testCase.expected?.relation || 'uncertain';
  return {
    id: testCase.id || '',
    category: testCase.category || '',
    expectedRelation,
    predictedRelation,
    passed: predictedRelation === expectedRelation,
    recommendedAction: actionForRelation(predictedRelation),
    score: score?.total ?? null,
    supportSignals: evidence.support_signals || [],
    riskSignals: evidence.risk_signals || [],
    evidenceRefs: aiEvalEvidenceRefs(evidence),
  };
}

export function classifyTrackPair({ source = {}, target = {}, score = null, evidence = {} } = {}) {
  const support = new Set(evidence.support_signals || []);
  const risk = new Set(evidence.risk_signals || []);
  const titleOverlap = Boolean(evidence.alias_overlap?.titles?.length);
  const artistOverlap = Boolean(evidence.alias_overlap?.artists?.length);
  const durationDelta = evidence.duration_delta_seconds;
  const total = Number(score?.total ?? evidence.algorithm_score?.total ?? evidence.algorithm_score ?? 0);
  const hasRecordingIdentity = support.has('same_isrc') || support.has('shared_musicbrainz_recording_id');
  const hasVersionConflict = risk.has('version_cue_conflict');
  const hasDifferentIsrc = risk.has('different_isrc');
  const hasLongDurationRisk = risk.has('duration_over_20_seconds');

  if (hasDifferentIsrc) {
    if (titleOverlap && artistOverlap) return 'same_song_different_version';
    return 'different_song';
  }
  if (hasRecordingIdentity && !hasVersionConflict && !hasLongDurationRisk) return 'same_recording';
  if (hasVersionConflict) return 'same_song_different_version';
  if (titleOverlap && artistOverlap && durationDelta !== null && durationDelta <= 10 && total >= 0.82) {
    return 'same_recording';
  }
  if (titleOverlap && artistOverlap && hasLongDurationRisk) return 'uncertain';
  if (titleOverlap && !artistOverlap) return 'different_song';
  if (!titleOverlap && !artistOverlap && total < 0.45) return 'different_song';
  if (!target.title || !source.title) return 'uncertain';
  return total >= 0.82 ? 'same_recording' : 'uncertain';
}

export function evaluateExplanationModelOutput(testCase = {}) {
  const output = normalizeExplanationModelOutput(testCase.output || {});
  const expected = testCase.expected || {};
  const allowedActions = new Set(expected.allowedActions || [...EXPLANATION_ACTIONS]);
  const requiredAction = expected.requiredAction || '';
  const requiredRisk = expected.requiredRisk || '';
  const forbidden = expected.forbiddenTerms || [];
  const text = JSON.stringify(output).toLowerCase();
  const forbiddenHits = forbidden.filter((term) => text.includes(String(term).toLowerCase()));
  const actionAllowed = allowedActions.has(output.recommendedAction);
  const actionMatches = !requiredAction || output.recommendedAction === requiredAction;
  const riskMatches = !requiredRisk || output.risk === requiredRisk;
  const passed = Boolean(output.summary)
    && Boolean(output.rationale)
    && actionAllowed
    && actionMatches
    && riskMatches
    && output.evidenceRefs.length >= Number(expected.minEvidenceRefs || 1)
    && !forbiddenHits.length;
  return {
    id: testCase.id || '',
    category: testCase.category || 'explanation_output',
    passed,
    risk: output.risk,
    recommendedAction: output.recommendedAction,
    actionAllowed,
    actionMatches,
    riskMatches,
    forbiddenHits,
    evidenceRefs: output.evidenceRefs,
  };
}

export function evaluateExplanationModelFixtures(cases = [], options = {}) {
  const evaluated = cases.map((testCase) => evaluateExplanationModelOutput(testCase));
  const total = evaluated.length;
  const passed = evaluated.filter((item) => item.passed).length;
  const minPassRate = Number(options.minPassRate ?? 1);
  return {
    ok: total ? passed / total >= minPassRate && passed === total : true,
    minPassRate,
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate: total ? Number((passed / total).toFixed(4)) : 1,
    },
    cases: evaluated,
  };
}

export function evaluateTombstoneRiskModelOutput(testCase = {}) {
  const output = normalizeTombstoneRiskModelOutput(testCase.output || {});
  const expected = testCase.expected || {};
  const expectedValid = expected.valid !== false;
  const minEvidenceRefs = Number(expected.minEvidenceRefs || 1);
  const minItems = Number(expected.minItems || 0);
  const minGroups = Number(expected.minGroups || 0);
  const text = JSON.stringify(output).toLowerCase();
  const forbiddenHits = (expected.forbiddenTerms || [])
    .filter((term) => text.includes(String(term).toLowerCase()));
  const requiredTermMisses = (expected.requiredTerms || [])
    .filter((term) => !text.includes(String(term).toLowerCase()));
  const groupIds = new Set(output.groups.map((group) => group.id).filter(Boolean));
  const missingGroups = (expected.requiredGroups || []).filter((group) => !groupIds.has(group));
  const unknownGroups = output.groups
    .filter((group) => group.id && !TOMBSTONE_GROUPS.has(group.id))
    .map((group) => group.id);
  const invalidGroupRisks = output.groups
    .filter((group) => group.risk && !TOMBSTONE_RISKS.has(group.risk))
    .map((group) => ({ id: group.id, risk: group.risk }));
  const unknownItemGroups = output.items
    .filter((item) => item.group && !TOMBSTONE_GROUPS.has(item.group))
    .map((item) => ({ tombstoneKey: item.tombstoneKey, group: item.group }));
  const unknownActions = output.items
    .filter((item) => item.recommendedAction && !TOMBSTONE_ACTIONS.has(item.recommendedAction))
    .map((item) => ({ tombstoneKey: item.tombstoneKey, action: item.recommendedAction }));
  const invalidItemRisks = output.items
    .filter((item) => item.risk && !TOMBSTONE_RISKS.has(item.risk))
    .map((item) => ({ tombstoneKey: item.tombstoneKey, risk: item.risk }));
  const lowEvidenceItems = output.items
    .filter((item) => item.evidenceRefs.length < minEvidenceRefs)
    .map((item) => item.tombstoneKey || item.operationId || '');
  const unsafeGlobalDeleteItems = output.items
    .filter((item) => item.recommendedAction === 'execute_confirmed_delete')
    .filter((item) => (
      item.group !== 'confirmed_global_delete'
      || item.risk !== 'high'
      || !item.evidenceRefs.some((ref) => /confirm_global_delete|confirmed_global_delete/u.test(ref))
    ))
    .map((item) => ({
      tombstoneKey: item.tombstoneKey,
      group: item.group,
      risk: item.risk,
      recommendedAction: item.recommendedAction,
      evidenceRefs: item.evidenceRefs,
    }));
  const inconsistentConfirmedItems = output.items
    .filter((item) => item.group === 'confirmed_global_delete' && item.recommendedAction !== 'execute_confirmed_delete')
    .map((item) => ({ tombstoneKey: item.tombstoneKey, recommendedAction: item.recommendedAction }));
  const requiredItemFailures = evaluateRequiredTombstoneItems(expected.requiredItems || [], output.items, minEvidenceRefs);
  const valid = Boolean(output.summary)
    && output.items.length >= minItems
    && output.groups.length >= minGroups
    && !forbiddenHits.length
    && !requiredTermMisses.length
    && !missingGroups.length
    && !unknownGroups.length
    && !invalidGroupRisks.length
    && !unknownItemGroups.length
    && !unknownActions.length
    && !invalidItemRisks.length
    && !lowEvidenceItems.length
    && !unsafeGlobalDeleteItems.length
    && !inconsistentConfirmedItems.length
    && !requiredItemFailures.length;
  return {
    id: testCase.id || '',
    category: testCase.category || 'tombstone_risk_output',
    passed: expectedValid ? valid : !valid,
    valid,
    expectedValid,
    summary: output.summary,
    groups: output.groups.map((group) => group.id),
    itemCount: output.items.length,
    missingGroups,
    unknownGroups,
    invalidGroupRisks,
    unknownItemGroups,
    unknownActions,
    invalidItemRisks,
    lowEvidenceItems,
    unsafeGlobalDeleteItems,
    inconsistentConfirmedItems,
    requiredItemFailures,
    forbiddenHits,
    requiredTermMisses,
  };
}

export function evaluateTombstoneRiskModelFixtures(cases = [], options = {}) {
  const evaluated = cases.map((testCase) => evaluateTombstoneRiskModelOutput(testCase));
  const total = evaluated.length;
  const passed = evaluated.filter((item) => item.passed).length;
  const minPassRate = Number(options.minPassRate ?? 1);
  return {
    ok: total ? passed / total >= minPassRate && passed === total : true,
    minPassRate,
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate: total ? Number((passed / total).toFixed(4)) : 1,
    },
    cases: evaluated,
  };
}

function summarizeAiEval(cases = []) {
  const total = cases.length;
  const passed = cases.filter((item) => item.passed).length;
  const byCategory = {};
  for (const item of cases) {
    byCategory[item.category] ||= { total: 0, passed: 0 };
    byCategory[item.category].total += 1;
    if (item.passed) byCategory[item.category].passed += 1;
  }
  return {
    total,
    passed,
    failed: total - passed,
    failures: total - passed,
    exactRate: total ? Number((passed / total).toFixed(4)) : 0,
    byCategory,
  };
}

function actionForRelation(relation) {
  if (relation === 'same_recording') return 'keep';
  if (relation === 'same_song_different_version' || relation === 'different_song') return 'separate';
  return 'needs_human';
}

function aiEvalEvidenceRefs(evidence = {}) {
  return [
    evidence.isrc?.relation === 'same' ? 'same_isrc' : '',
    evidence.isrc?.relation === 'different' ? 'different_isrc' : '',
    evidence.musicbrainz?.shared_recording_ids?.length ? 'shared_musicbrainz_recording_id' : '',
    evidence.duration_delta_seconds !== null ? `duration_delta:${evidence.duration_delta_seconds}s` : '',
    evidence.alias_overlap?.titles?.length ? 'title_alias_overlap' : '',
    evidence.alias_overlap?.artists?.length ? 'artist_alias_overlap' : '',
    ...(evidence.version_cue_conflicts || []).map((item) => `version_cue:${item.cue}`),
  ].filter(Boolean).slice(0, 10);
}

function normalizeExplanationModelOutput(raw = {}) {
  const action = String(raw.recommended_action || raw.recommendedAction || '').trim();
  const risk = String(raw.risk || '').trim().toLowerCase();
  return {
    summary: cleanEvalText(raw.summary, 320),
    risk: ['low', 'medium', 'high'].includes(risk) ? risk : 'medium',
    recommendedAction: action,
    rationale: cleanEvalText(raw.rationale || raw.reason, 800),
    evidenceRefs: cleanEvalStringList(raw.evidence_refs || raw.evidenceRefs, 8, 80),
  };
}

function normalizeTombstoneRiskModelOutput(raw = {}) {
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map((group) => ({
      id: cleanEvalText(group.id || group.group, 80),
      label: cleanEvalText(group.label || group.name, 120),
      risk: cleanEvalText(group.risk, 40).toLowerCase(),
      description: cleanEvalText(group.description || group.summary, 240),
      count: Number.isFinite(Number(group.count)) ? Math.max(0, Math.floor(Number(group.count))) : 0,
    }))
    : [];
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => ({
      operationId: cleanEvalText(item.operation_id || item.operationId, 120),
      tombstoneKey: cleanEvalText(item.tombstone_key || item.tombstoneKey, 180),
      risk: cleanEvalText(item.risk, 40).toLowerCase(),
      group: cleanEvalText(item.group, 80),
      recommendedAction: cleanEvalText(item.recommended_action || item.recommendedAction, 80),
      summary: cleanEvalText(item.summary, 240),
      evidenceRefs: cleanEvalStringList(item.evidence_refs || item.evidenceRefs, 8, 100),
    }))
    : [];
  return {
    summary: cleanEvalText(raw.summary || raw.overview, 360),
    groups,
    items,
  };
}

function evaluateRequiredTombstoneItems(requiredItems = [], items = [], minEvidenceRefs = 1) {
  const failures = [];
  for (const required of requiredItems) {
    const item = items.find((candidate) => (
      (required.tombstoneKey && candidate.tombstoneKey === required.tombstoneKey)
      || (required.operationId && candidate.operationId === required.operationId)
    ));
    if (!item) {
      failures.push({
        tombstoneKey: required.tombstoneKey || '',
        operationId: required.operationId || '',
        reason: 'missing',
      });
      continue;
    }
    if (required.requiredGroup && item.group !== required.requiredGroup) {
      failures.push({ tombstoneKey: item.tombstoneKey, reason: 'group', expected: required.requiredGroup, actual: item.group });
    }
    if (required.requiredAction && item.recommendedAction !== required.requiredAction) {
      failures.push({ tombstoneKey: item.tombstoneKey, reason: 'action', expected: required.requiredAction, actual: item.recommendedAction });
    }
    if (required.requiredRisk && item.risk !== required.requiredRisk) {
      failures.push({ tombstoneKey: item.tombstoneKey, reason: 'risk', expected: required.requiredRisk, actual: item.risk });
    }
    for (const ref of required.requiredEvidenceRefs || []) {
      if (!item.evidenceRefs.includes(ref)) {
        failures.push({ tombstoneKey: item.tombstoneKey, reason: 'evidence_ref', expected: ref, actual: item.evidenceRefs });
      }
    }
    for (const action of required.forbiddenActions || []) {
      if (item.recommendedAction === action) {
        failures.push({ tombstoneKey: item.tombstoneKey, reason: 'forbidden_action', actual: action });
      }
    }
    if (item.evidenceRefs.length < Number(required.minEvidenceRefs || minEvidenceRefs)) {
      failures.push({ tombstoneKey: item.tombstoneKey, reason: 'min_evidence_refs', expected: Number(required.minEvidenceRefs || minEvidenceRefs), actual: item.evidenceRefs.length });
    }
  }
  return failures;
}

function cleanEvalText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanEvalStringList(value, limit, maxLength) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => cleanEvalText(item, maxLength)).filter(Boolean))].slice(0, limit);
}
