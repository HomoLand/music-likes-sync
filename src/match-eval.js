import { classifyTrackCandidates } from './match.js';
import { normalizeTrack } from './normalize.js';

export function evaluateMatchCases(cases = [], options = {}) {
  const evaluated = cases.map((testCase) => evaluateMatchCase(testCase, options));
  const expectedMatches = evaluated.filter((item) => item.expectedStatus === 'match');
  const accepted = evaluated.filter((item) => item.actualStatus === 'match');
  const correctAccepted = accepted.filter((item) => item.passed);
  const unsafeAccepted = accepted.filter((item) => item.expectedStatus !== 'match');
  const passed = evaluated.filter((item) => item.passed).length;

  return {
    passed: passed === evaluated.length && unsafeAccepted.length === 0,
    summary: {
      total: evaluated.length,
      passed,
      failed: evaluated.length - passed,
      autoAccepted: accepted.length,
      unsafeAutoAccepted: unsafeAccepted.length,
      autoAcceptPrecision: ratio(correctAccepted.length, accepted.length),
      expectedMatchRecall: ratio(
        expectedMatches.filter((item) => item.actualStatus === 'match').length,
        expectedMatches.length,
      ),
    },
    cases: evaluated,
  };
}

export function evaluateMatchCase(testCase = {}, options = {}) {
  const source = normalizeTrack(testCase.source || {}, testCase.source?.platform || 'apple');
  const candidates = (testCase.candidates || []).map((track) => (
    normalizeTrack(track, track.platform || testCase.targetPlatform || 'qq')
  ));
  const expectedStatus = String(testCase.expected?.status || 'missing');
  const expectedTargetId = String(testCase.expected?.targetId || '');
  const decision = classifyTrackCandidates(source, candidates, {
    threshold: options.threshold ?? 0.82,
    reviewThreshold: options.reviewThreshold ?? 0.68,
    minimumScoreMargin: options.minimumScoreMargin ?? 0.04,
  });
  const actualTargetId = String(decision.best?.track?.id || decision.best?.track?.mid || '');
  const statusMatches = decision.status === expectedStatus;
  const targetMatches = !expectedTargetId || actualTargetId === expectedTargetId;

  return {
    id: String(testCase.id || ''),
    passed: statusMatches && targetMatches,
    expectedStatus,
    actualStatus: decision.status,
    expectedTargetId,
    actualTargetId,
    score: decision.best?.score?.total ?? null,
    scoreMargin: decision.scoreMargin,
    ambiguityReason: decision.ambiguityReason,
  };
}

function ratio(numerator, denominator) {
  if (!denominator) return 1;
  return Math.round((numerator / denominator) * 10000) / 10000;
}
