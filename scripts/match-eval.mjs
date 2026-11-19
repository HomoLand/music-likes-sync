#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateMatchCases } from '../src/match-eval.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'match-engine', 'track-cases.json');

const options = parseArgs(process.argv.slice(2));
const fixturePath = path.resolve(ROOT, options.fixture || DEFAULT_FIXTURE);
const payload = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const result = evaluateMatchCases(Array.isArray(payload.cases) ? payload.cases : [], options);
const report = {
  ok: result.passed,
  fixture: path.relative(ROOT, fixturePath).replace(/\\/g, '/'),
  version: payload.version || null,
  summary: result.summary,
  failures: result.cases.filter((item) => !item.passed),
};

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Match eval: ${report.summary.passed}/${report.summary.total} passed`);
  console.log(`Auto-accept precision: ${Math.round(report.summary.autoAcceptPrecision * 100)}%`);
  console.log(`Expected-match recall: ${Math.round(report.summary.expectedMatchRecall * 100)}%`);
  for (const failure of report.failures) {
    console.log(`- ${failure.id}: expected ${failure.expectedStatus}, got ${failure.actualStatus}`);
  }
}

if (!report.ok) process.exit(1);

function parseArgs(args) {
  const parsed = {
    fixture: '',
    json: false,
    threshold: undefined,
    reviewThreshold: undefined,
    minimumScoreMargin: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--fixture') parsed.fixture = args[++index] || '';
    else if (arg === '--threshold') parsed.threshold = Number(args[++index]);
    else if (arg === '--review-threshold') parsed.reviewThreshold = Number(args[++index]);
    else if (arg === '--minimum-score-margin') parsed.minimumScoreMargin = Number(args[++index]);
    else if (arg === '--help') {
      console.log('Usage: node scripts/match-eval.mjs [--json] [--fixture path] [--threshold 0.82] [--review-threshold 0.68] [--minimum-score-margin 0.04]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
