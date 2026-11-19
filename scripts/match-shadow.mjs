#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditTargetIdentityCollisions } from '../src/match-audit.js';
import {
  buildMatchShadowPlan,
  projectMatchShadowOperations,
  summarizeMatchShadowBaseline,
  summarizeMatchShadowResolution,
} from '../src/match-shadow.js';
import { resolveMirrorAddOperations } from '../src/mirror-resolve.js';
import { searchNeteaseTracks } from '../src/providers/netease.js';
import { searchQQTracks } from '../src/providers/qq.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const options = parseArgs(process.argv.slice(2));
const previewPath = path.resolve(ROOT, options.preview || path.join(DATA_DIR, 'sync-preview.json'));
const preview = JSON.parse(await fs.readFile(previewPath, 'utf8'));
const baseline = summarizeMatchShadowBaseline(preview);
const report = {
  ok: true,
  mode: options.live ? 'live_read_only' : 'offline_baseline',
  preview: path.relative(ROOT, previewPath).replace(/\\/g, '/'),
  baseline,
  targets: {},
};

if (options.live) {
  const targets = options.target ? [options.target] : ['qq', 'netease'];
  const resolvedPlans = [];
  for (const target of targets) {
    const credentialPath = path.join(DATA_DIR, target === 'qq' ? 'qq.cookie' : 'netease.cookie');
    const cookie = await fs.readFile(credentialPath, 'utf8').catch(() => '');
    if (!cookie.trim()) throw new Error(`Missing ${target} credential: ${credentialPath}`);
    const shadowPlan = buildMatchShadowPlan(preview, target, { limit: options.limit });
    const searchTracks = target === 'qq'
      ? (query, searchOptions) => searchQQTracks(cookie, query, searchOptions)
      : (query, searchOptions) => searchNeteaseTracks(cookie, query, searchOptions);
    let lastProgress = 0;
    const resolved = await resolveMirrorAddOperations(shadowPlan, {
      refresh: true,
      limit: options.limit,
      searchLimit: options.searchLimit,
      queryLimit: options.queryLimit,
      queryConcurrency: options.queryConcurrency,
      searchTimeoutMs: options.searchTimeoutMs,
      minimumScoreMargin: options.minimumScoreMargin,
      searchTracks,
      onProgress(progress) {
        if (progress.processed === progress.total || progress.processed - lastProgress >= 10) {
          lastProgress = progress.processed;
          process.stderr.write(`[match-shadow] ${target}: ${progress.processed}/${progress.total}\n`);
        }
      },
    });
    resolvedPlans.push(resolved);
    report.targets[target] = summarizeMatchShadowResolution(preview, resolved);
  }
  const projected = projectMatchShadowOperations(preview, resolvedPlans);
  report.projectedIdentityAudit = auditTargetIdentityCollisions(projected).summary;
}

console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));

function formatReport(value) {
  const lines = [
    `Match shadow: ${value.mode}`,
    `Current operations: ${value.baseline.operationCount}`,
    `Current cross-recording collisions: ${value.baseline.identityAudit.crossRecordingCollisions}`,
  ];
  for (const [target, baselineTarget] of Object.entries(value.baseline.targets)) {
    lines.push(`- ${target}: ${baselineTarget.operations} unresolved add operations`);
  }
  for (const [target, result] of Object.entries(value.targets)) {
    lines.push(`- ${target} shadow: ${result.recoveredReady} ready, ${result.remainingReview} review, ${result.remainingNotFound} not found`);
  }
  if (value.projectedIdentityAudit) {
    lines.push(`Projected cross-recording collisions: ${value.projectedIdentityAudit.crossRecordingCollisions}`);
  }
  return lines.join('\n');
}

function parseArgs(args) {
  const parsed = {
    live: false,
    json: false,
    preview: '',
    target: '',
    limit: 200,
    searchLimit: 12,
    queryLimit: 8,
    queryConcurrency: 2,
    searchTimeoutMs: 15000,
    minimumScoreMargin: 0.04,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--live') parsed.live = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--preview') parsed.preview = args[++index] || '';
    else if (arg === '--target') parsed.target = normalizeTarget(args[++index]);
    else if (arg === '--limit') parsed.limit = clampInteger(args[++index], 1, 200, 'limit');
    else if (arg === '--search-limit') parsed.searchLimit = clampInteger(args[++index], 1, 30, 'search-limit');
    else if (arg === '--query-limit') parsed.queryLimit = clampInteger(args[++index], 1, 16, 'query-limit');
    else if (arg === '--query-concurrency') parsed.queryConcurrency = clampInteger(args[++index], 1, 4, 'query-concurrency');
    else if (arg === '--search-timeout-ms') parsed.searchTimeoutMs = clampInteger(args[++index], 1000, 60000, 'search-timeout-ms');
    else if (arg === '--minimum-score-margin') parsed.minimumScoreMargin = clampNumber(args[++index], 0, 1, 'minimum-score-margin');
    else if (arg === '--help') {
      console.log('Usage: node scripts/match-shadow.mjs [--live] [--json] [--target qq|netease] [--limit 200] [--search-limit 12] [--query-limit 8] [--query-concurrency 2] [--search-timeout-ms 15000]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function normalizeTarget(value) {
  const target = String(value || '').trim().toLowerCase();
  if (!['qq', 'netease'].includes(target)) throw new Error(`Unsupported target: ${target || 'missing'}`);
  return target;
}

function clampInteger(value, min, max, name) {
  const number = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(number)) throw new Error(`Invalid --${name}`);
  return Math.max(min, Math.min(max, number));
}

function clampNumber(value, min, max, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid --${name}`);
  return Math.max(min, Math.min(max, number));
}
