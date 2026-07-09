import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyTrackPair,
  evaluateAiFixtureCases,
  evaluateExplanationModelFixtures,
  evaluateTombstoneRiskModelFixtures,
} from '../src/ai-eval.js';
import { buildMatchEvidence } from '../src/evidence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = path.join(ROOT, 'test', 'fixtures', 'ai-eval', 'track-match-cases.json');
const TOMBSTONE_FIXTURE_PATH = path.join(ROOT, 'test', 'fixtures', 'ai-eval', 'tombstone-model-cases.json');

describe('AI evaluation fixtures', () => {
  it('evaluates human-labeled track identity cases without a model call', () => {
    const payload = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const result = evaluateAiFixtureCases(payload.cases);
    const categories = new Set(result.cases.map((item) => item.category));

    assert.equal(result.ok, true);
    assert.equal(result.summary.total, 8);
    assert.equal(result.summary.failed, 0);
    assert(categories.has('same_recording'));
    assert(categories.has('same_song_different_version'));
    assert(categories.has('different_song_same_title'));
    assert(categories.has('japanese_romanization'));
    assert(categories.has('missing_isrc_duration_conflict'));
  });

  it('keeps different ISRC evidence out of automatic same-recording decisions', () => {
    const source = {
      title: 'Yellow',
      artist: 'Coldplay',
      artists: ['Coldplay'],
      album: 'Parachutes',
      durationMs: 267000,
      isrc: 'GBAYE0000567',
    };
    const target = {
      title: 'Yellow',
      artist: 'Coldplay',
      artists: ['Coldplay'],
      album: 'Yellow - Single',
      durationMs: 270000,
      isrc: 'GBAYE9909999',
    };
    const evidence = buildMatchEvidence(source, target, { total: 0.95 });
    const relation = classifyTrackPair({ source, target, score: { total: 0.95 }, evidence });

    assert.notEqual(relation, 'same_recording');
    assert.equal(relation, 'same_song_different_version');
  });

  it('evaluates explanation model outputs without calling a provider', () => {
    const result = evaluateExplanationModelFixtures([
      {
        id: 'explain-ok',
        output: {
          summary: 'This deletion signal needs review before any global delete.',
          risk: 'high',
          recommended_action: 'review_tombstone',
          rationale: 'The evidence is one-sided and should not be treated as automatic global deletion.',
          evidence_refs: ['reason:tombstone_candidate', 'tombstone_decision'],
        },
        expected: {
          requiredAction: 'review_tombstone',
          requiredRisk: 'high',
          minEvidenceRefs: 2,
          forbiddenTerms: ['cookie'],
        },
      },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.summary.passed, 1);
  });

  it('evaluates tombstone risk model outputs and rejects unsafe global delete advice', () => {
    const payload = JSON.parse(fs.readFileSync(TOMBSTONE_FIXTURE_PATH, 'utf8'));
    const result = evaluateTombstoneRiskModelFixtures(payload.cases);
    const negativeControl = result.cases.find((item) => item.id === 'tombstone-unsafe-unconfirmed-global-delete');

    assert.equal(result.ok, true);
    assert.equal(result.summary.total, 4);
    assert.equal(result.summary.failed, 0);
    assert.equal(negativeControl?.expectedValid, false);
    assert.equal(negativeControl?.valid, false);
    assert.equal(negativeControl?.passed, true);
    assert.equal(negativeControl?.unsafeGlobalDeleteItems.length, 1);
  });
});
