#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateAiFixtureCases,
  evaluateExplanationModelFixtures,
  evaluateTombstoneRiskModelFixtures,
} from '../src/ai-eval.js';
import { evaluateMusicProfileModelFixtures, evaluateRecommendationModelFixtures } from '../src/music-intelligence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'ai-eval', 'track-match-cases.json');
const DEFAULT_PROFILE_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'ai-eval', 'profile-model-cases.json');
const DEFAULT_RECOMMENDATION_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'ai-eval', 'recommendation-model-cases.json');
const DEFAULT_EXPLANATION_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'ai-eval', 'explanation-model-cases.json');
const DEFAULT_TOMBSTONE_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'ai-eval', 'tombstone-model-cases.json');

const options = parseArgs(process.argv.slice(2));
const fixturePath = path.resolve(ROOT, options.fixture || DEFAULT_FIXTURE);
const payload = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const cases = Array.isArray(payload.cases) ? payload.cases : [];
const result = evaluateAiFixtureCases(cases, {
  minExact: options.minExact,
  threshold: options.threshold,
  reviewThreshold: options.reviewThreshold,
});
const profileFixturePath = path.resolve(ROOT, options.profileFixture || DEFAULT_PROFILE_FIXTURE);
const profilePayload = JSON.parse(await fs.readFile(profileFixturePath, 'utf8'));
const profileCases = Array.isArray(profilePayload.cases) ? profilePayload.cases : [];
const profileResult = evaluateMusicProfileModelFixtures(profileCases, {
  minPassRate: options.profileMinPassRate,
});
const recommendationFixturePath = path.resolve(ROOT, options.recommendationFixture || DEFAULT_RECOMMENDATION_FIXTURE);
const recommendationPayload = JSON.parse(await fs.readFile(recommendationFixturePath, 'utf8'));
const recommendationCases = Array.isArray(recommendationPayload.cases) ? recommendationPayload.cases : [];
const recommendationResult = evaluateRecommendationModelFixtures(recommendationCases, {
  minPassRate: options.recommendationMinPassRate,
});
const explanationFixturePath = path.resolve(ROOT, options.explanationFixture || DEFAULT_EXPLANATION_FIXTURE);
const explanationPayload = JSON.parse(await fs.readFile(explanationFixturePath, 'utf8'));
const explanationCases = Array.isArray(explanationPayload.cases) ? explanationPayload.cases : [];
const explanationResult = evaluateExplanationModelFixtures(explanationCases, {
  minPassRate: options.explanationMinPassRate,
});
const tombstoneFixturePath = path.resolve(ROOT, options.tombstoneFixture || DEFAULT_TOMBSTONE_FIXTURE);
const tombstonePayload = JSON.parse(await fs.readFile(tombstoneFixturePath, 'utf8'));
const tombstoneCases = Array.isArray(tombstonePayload.cases) ? tombstonePayload.cases : [];
const tombstoneResult = evaluateTombstoneRiskModelFixtures(tombstoneCases, {
  minPassRate: options.tombstoneMinPassRate,
});

const report = {
  ok: result.ok && profileResult.ok && recommendationResult.ok && explanationResult.ok && tombstoneResult.ok,
  fixture: path.relative(ROOT, fixturePath).replace(/\\/g, '/'),
  profileFixture: path.relative(ROOT, profileFixturePath).replace(/\\/g, '/'),
  recommendationFixture: path.relative(ROOT, recommendationFixturePath).replace(/\\/g, '/'),
  explanationFixture: path.relative(ROOT, explanationFixturePath).replace(/\\/g, '/'),
  tombstoneFixture: path.relative(ROOT, tombstoneFixturePath).replace(/\\/g, '/'),
  version: payload.version || null,
  description: payload.description || '',
  minExact: result.minExact,
  thresholds: result.thresholds,
  summary: result.summary,
  profileSummary: profileResult.summary,
  recommendationSummary: recommendationResult.summary,
  explanationSummary: explanationResult.summary,
  tombstoneSummary: tombstoneResult.summary,
  failures: result.cases
    .filter((item) => !item.passed)
    .map((item) => ({
      id: item.id,
      category: item.category,
      expectedRelation: item.expectedRelation,
      predictedRelation: item.predictedRelation,
      score: item.score,
      supportSignals: item.supportSignals,
      riskSignals: item.riskSignals,
      evidenceRefs: item.evidenceRefs,
    })),
  profileFailures: profileResult.cases
    .filter((item) => !item.passed)
    .map((item) => ({
      id: item.id,
      category: item.category,
      missingTags: item.missingTags,
      forbiddenHits: item.forbiddenHits,
      confidence: item.confidence,
      evidenceRefs: item.evidenceRefs,
    })),
  recommendationFailures: recommendationResult.cases
    .filter((item) => !item.passed)
    .map((item) => ({
      id: item.id,
      category: item.category,
      missingCandidateKeys: item.missingCandidateKeys,
      unknownCandidateKeys: item.unknownCandidateKeys,
      forbiddenHits: item.forbiddenHits,
      evidenceRefs: item.evidenceRefs,
      rankedCandidateCount: item.rankedCandidateCount,
    })),
  explanationFailures: explanationResult.cases
    .filter((item) => !item.passed)
    .map((item) => ({
      id: item.id,
      category: item.category,
      risk: item.risk,
      recommendedAction: item.recommendedAction,
      actionAllowed: item.actionAllowed,
      actionMatches: item.actionMatches,
      riskMatches: item.riskMatches,
      forbiddenHits: item.forbiddenHits,
      evidenceRefs: item.evidenceRefs,
    })),
  tombstoneFailures: tombstoneResult.cases
    .filter((item) => !item.passed)
    .map((item) => ({
      id: item.id,
      category: item.category,
      valid: item.valid,
      expectedValid: item.expectedValid,
      groups: item.groups,
      itemCount: item.itemCount,
      missingGroups: item.missingGroups,
      unknownGroups: item.unknownGroups,
      unknownActions: item.unknownActions,
      invalidItemRisks: item.invalidItemRisks,
      lowEvidenceItems: item.lowEvidenceItems,
      unsafeGlobalDeleteItems: item.unsafeGlobalDeleteItems,
      inconsistentConfirmedItems: item.inconsistentConfirmedItems,
      requiredItemFailures: item.requiredItemFailures,
      forbiddenHits: item.forbiddenHits,
      requiredTermMisses: item.requiredTermMisses,
    })),
};

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`AI eval: ${report.summary.passed}/${report.summary.total} exact (${Math.round(report.summary.exactRate * 100)}%)`);
  for (const [category, item] of Object.entries(report.summary.byCategory)) {
    console.log(`- ${category}: ${item.passed}/${item.total}`);
  }
  if (report.failures.length) {
    console.log('Failures:');
    for (const failure of report.failures) {
      console.log(`- ${failure.id}: expected ${failure.expectedRelation}, got ${failure.predictedRelation}`);
    }
  }
  console.log(`Profile model eval: ${report.profileSummary.passed}/${report.profileSummary.total} passed`);
  if (report.profileFailures.length) {
    console.log('Profile failures:');
    for (const failure of report.profileFailures) {
      console.log(`- ${failure.id}: missing tags ${failure.missingTags.join(', ') || 'none'}, forbidden ${failure.forbiddenHits.join(', ') || 'none'}`);
    }
  }
  console.log(`Recommendation model eval: ${report.recommendationSummary.passed}/${report.recommendationSummary.total} passed`);
  if (report.recommendationFailures.length) {
    console.log('Recommendation failures:');
    for (const failure of report.recommendationFailures) {
      console.log(`- ${failure.id}: missing ${failure.missingCandidateKeys.join(', ') || 'none'}, unknown ${failure.unknownCandidateKeys.join(', ') || 'none'}`);
    }
  }
  console.log(`Explanation model eval: ${report.explanationSummary.passed}/${report.explanationSummary.total} passed`);
  if (report.explanationFailures.length) {
    console.log('Explanation failures:');
    for (const failure of report.explanationFailures) {
      console.log(`- ${failure.id}: action ${failure.recommendedAction}, risk ${failure.risk}, forbidden ${failure.forbiddenHits.join(', ') || 'none'}`);
    }
  }
  console.log(`Tombstone risk model eval: ${report.tombstoneSummary.passed}/${report.tombstoneSummary.total} passed`);
  if (report.tombstoneFailures.length) {
    console.log('Tombstone failures:');
    for (const failure of report.tombstoneFailures) {
      console.log(`- ${failure.id}: valid ${failure.valid}, expected ${failure.expectedValid}, unsafe deletes ${failure.unsafeGlobalDeleteItems.length}`);
    }
  }
}

if (!report.ok) process.exit(1);

function parseArgs(args) {
  const parsed = {
    fixture: '',
    json: false,
    minExact: 0.75,
    threshold: undefined,
    reviewThreshold: undefined,
    profileFixture: '',
    profileMinPassRate: 1,
    recommendationFixture: '',
    recommendationMinPassRate: 1,
    explanationFixture: '',
    explanationMinPassRate: 1,
    tombstoneFixture: '',
    tombstoneMinPassRate: 1,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--fixture') parsed.fixture = args[++index] || '';
    else if (arg === '--min-exact') parsed.minExact = Number(args[++index] || parsed.minExact);
    else if (arg === '--threshold') parsed.threshold = Number(args[++index]);
    else if (arg === '--review-threshold') parsed.reviewThreshold = Number(args[++index]);
    else if (arg === '--profile-fixture') parsed.profileFixture = args[++index] || '';
    else if (arg === '--profile-min-pass-rate') parsed.profileMinPassRate = Number(args[++index] || parsed.profileMinPassRate);
    else if (arg === '--recommendation-fixture') parsed.recommendationFixture = args[++index] || '';
    else if (arg === '--recommendation-min-pass-rate') parsed.recommendationMinPassRate = Number(args[++index] || parsed.recommendationMinPassRate);
    else if (arg === '--explanation-fixture') parsed.explanationFixture = args[++index] || '';
    else if (arg === '--explanation-min-pass-rate') parsed.explanationMinPassRate = Number(args[++index] || parsed.explanationMinPassRate);
    else if (arg === '--tombstone-fixture') parsed.tombstoneFixture = args[++index] || '';
    else if (arg === '--tombstone-min-pass-rate') parsed.tombstoneMinPassRate = Number(args[++index] || parsed.tombstoneMinPassRate);
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ai-eval.mjs [--json] [--fixture path] [--profile-fixture path] [--recommendation-fixture path] [--explanation-fixture path] [--tombstone-fixture path] [--min-exact 0.75]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
