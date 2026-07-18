import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateMatchCases } from '../src/match-eval.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = path.join(ROOT, 'test', 'fixtures', 'match-engine', 'track-cases.json');

describe('deterministic match-engine evaluation', () => {
  it('passes the labeled cross-platform identity baseline without unsafe auto-accepts', () => {
    const payload = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const result = evaluateMatchCases(payload.cases);

    assert.equal(result.passed, true);
    assert.equal(result.summary.total, 12);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.unsafeAutoAccepted, 0);
    assert.equal(result.summary.autoAcceptPrecision, 1);
    assert.equal(result.summary.expectedMatchRecall, 1);
  });
});
