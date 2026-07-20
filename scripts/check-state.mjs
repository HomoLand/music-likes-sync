#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { DATA_DIR } from '../src/utils.js';
import {
  validateAgentSessionsState,
  validateAutoSyncRunLogState,
  validateAutoSyncState,
  validateAiProviderState,
  validateMirrorDecisionState,
  validateMirrorPlan,
  validateMirrorRunLog,
  validateMusicProfileState,
  validateRecommendationShortlistsState,
  validateSyncBaselineState,
  validateSyncBackupState,
  validateSyncPolicyState,
  validateSyncPreviewState,
  validateSyncRunLogState,
  validateSyncTombstoneState,
} from '../src/state-schema.js';

const args = parseArgs(process.argv.slice(2));
const dataDir = path.resolve(args.dataDir || DATA_DIR);
const reports = [];
const files = [
  stateFile('mirror-plan', args.plan, 'mirror-plan.json', args.requireMirrorPlan, validateMirrorPlan),
  stateFile('mirror-runs', args.runs, 'mirror-runs.json', args.requireMirrorRuns, validateMirrorRunLog),
  stateFile('mirror-decisions', args.decisions, 'mirror-decisions.json', args.requireMirrorDecisions, validateMirrorDecisionState),
  stateFile('sync-policy', args.syncPolicy, 'sync-policy.json', args.requireSyncPolicy, validateSyncPolicyState),
  stateFile('sync-baseline', args.syncBaseline, 'sync-baseline.json', args.requireSyncBaseline, validateSyncBaselineState),
  stateFile('sync-preview', args.syncPreview, 'sync-preview.json', args.requireSyncPreview, validateSyncPreviewState),
  stateFile('sync-tombstones', args.syncTombstones, 'sync-tombstones.json', args.requireSyncTombstones, validateSyncTombstoneState),
  stateFile('sync-runs', args.syncRuns, 'sync-runs.json', args.requireSyncRuns, validateSyncRunLogState),
  stateFile('ai-provider-state', args.aiProviderState, 'ai-provider-state.json', args.requireAiProviderState, validateAiProviderState),
  stateFile('music-profile', args.musicProfile, 'music-profile.json', args.requireMusicProfile, validateMusicProfileState),
  stateFile('recommendation-shortlists', args.recommendationShortlists, 'recommendation-shortlists.json', args.requireRecommendationShortlists, validateRecommendationShortlistsState),
  stateFile('agent-sessions', args.agentSessions, 'agent-sessions.json', args.requireAgentSessions, validateAgentSessionsState),
  stateFile('auto-sync', args.autoSync, 'auto-sync.json', args.requireAutoSync, validateAutoSyncState),
  stateFile('auto-sync-runs', args.autoSyncRuns, 'auto-sync-runs.json', args.requireAutoSyncRuns, validateAutoSyncRunLogState),
  stateFile('sync-backups', args.syncBackups, 'sync-backups.json', args.requireSyncBackups, validateSyncBackupState),
];

for (const file of files) {
  await validateFile(file);
}

const ok = reports.every((report) => report.ok);
const payload = { ok, reports };

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  printTextReport(payload);
}

process.exitCode = ok ? 0 : 1;

function stateFile(label, overridePath, defaultName, required, validate) {
  return {
    label,
    filePath: path.resolve(overridePath || path.join(dataDir, defaultName)),
    required,
    validate,
  };
}

async function validateFile(options) {
  const text = await readTextIfExists(options.filePath);
  if (text === null) {
    reports.push({
      kind: options.label,
      ok: !options.required,
      file: options.filePath,
      skipped: !options.required,
      errors: options.required
        ? [{ path: '$', message: `${options.label} is required but ${options.filePath} does not exist.` }]
        : [],
      warnings: [],
    });
    return;
  }

  try {
    const data = JSON.parse(text);
    reports.push({
      ...options.validate(data),
      file: options.filePath,
      skipped: false,
    });
  } catch (error) {
    reports.push({
      kind: options.label,
      ok: false,
      file: options.filePath,
      skipped: false,
      errors: [{ path: '$', message: `Invalid JSON: ${error.message}` }],
      warnings: [],
    });
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function parseArgs(argv) {
  const result = {
    json: false,
    requireMirrorPlan: false,
    requireMirrorRuns: false,
    requireMirrorDecisions: false,
    requireSyncPolicy: false,
    requireSyncBaseline: false,
    requireSyncPreview: false,
    requireSyncTombstones: false,
    requireSyncRuns: false,
    requireAiProviderState: false,
    requireMusicProfile: false,
    requireRecommendationShortlists: false,
    requireAgentSessions: false,
    requireAutoSync: false,
    requireAutoSyncRuns: false,
    requireSyncBackups: false,
    dataDir: '',
    plan: '',
    runs: '',
    decisions: '',
    syncPolicy: '',
    syncBaseline: '',
    syncPreview: '',
    syncTombstones: '',
    syncRuns: '',
    aiProviderState: '',
    musicProfile: '',
    recommendationShortlists: '',
    agentSessions: '',
    autoSync: '',
    autoSyncRuns: '',
    syncBackups: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') result.json = true;
    else if (arg === '--require-mirror-plan') result.requireMirrorPlan = true;
    else if (arg === '--require-mirror-runs') result.requireMirrorRuns = true;
    else if (arg === '--require-mirror-decisions') result.requireMirrorDecisions = true;
    else if (arg === '--require-sync-policy') result.requireSyncPolicy = true;
    else if (arg === '--require-sync-baseline') result.requireSyncBaseline = true;
    else if (arg === '--require-sync-preview') result.requireSyncPreview = true;
    else if (arg === '--require-sync-tombstones') result.requireSyncTombstones = true;
    else if (arg === '--require-sync-runs') result.requireSyncRuns = true;
    else if (arg === '--require-ai-provider-state') result.requireAiProviderState = true;
    else if (arg === '--require-music-profile') result.requireMusicProfile = true;
    else if (arg === '--require-recommendation-shortlists') result.requireRecommendationShortlists = true;
    else if (arg === '--require-agent-sessions') result.requireAgentSessions = true;
    else if (arg === '--require-auto-sync') result.requireAutoSync = true;
    else if (arg === '--require-auto-sync-runs') result.requireAutoSyncRuns = true;
    else if (arg === '--require-sync-backups') result.requireSyncBackups = true;
    else if (arg === '--data-dir') result.dataDir = requireValue(argv, index += 1, arg);
    else if (arg === '--plan') result.plan = requireValue(argv, index += 1, arg);
    else if (arg === '--runs') result.runs = requireValue(argv, index += 1, arg);
    else if (arg === '--decisions') result.decisions = requireValue(argv, index += 1, arg);
    else if (arg === '--sync-policy') result.syncPolicy = requireValue(argv, index += 1, arg);
    else if (arg === '--sync-baseline') result.syncBaseline = requireValue(argv, index += 1, arg);
    else if (arg === '--sync-preview') result.syncPreview = requireValue(argv, index += 1, arg);
    else if (arg === '--sync-tombstones') result.syncTombstones = requireValue(argv, index += 1, arg);
    else if (arg === '--sync-runs') result.syncRuns = requireValue(argv, index += 1, arg);
    else if (arg === '--ai-provider-state') result.aiProviderState = requireValue(argv, index += 1, arg);
    else if (arg === '--music-profile') result.musicProfile = requireValue(argv, index += 1, arg);
    else if (arg === '--recommendation-shortlists') result.recommendationShortlists = requireValue(argv, index += 1, arg);
    else if (arg === '--agent-sessions') result.agentSessions = requireValue(argv, index += 1, arg);
    else if (arg === '--auto-sync') result.autoSync = requireValue(argv, index += 1, arg);
    else if (arg === '--auto-sync-runs') result.autoSyncRuns = requireValue(argv, index += 1, arg);
    else if (arg === '--sync-backups') result.syncBackups = requireValue(argv, index += 1, arg);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function printTextReport(payload) {
  console.log(payload.ok ? 'State validation passed.' : 'State validation failed.');
  for (const report of payload.reports) {
    const status = report.ok ? (report.skipped ? 'skipped' : 'ok') : 'failed';
    const details = [
      report.operationCount !== undefined ? `operations=${report.operationCount}` : '',
      report.runCount !== undefined ? `runs=${report.runCount}` : '',
      report.decisionCount !== undefined ? `decisions=${report.decisionCount}` : '',
      report.platformCount !== undefined ? `platforms=${report.platformCount}` : '',
      report.trackCount !== undefined ? `tracks=${report.trackCount}` : '',
      report.shortlistCount !== undefined ? `shortlists=${report.shortlistCount}` : '',
      report.sessionCount !== undefined ? `sessions=${report.sessionCount}` : '',
      report.policy ? `policy=${report.policy}` : '',
      report.target ? `target=${report.target}` : '',
      `errors=${report.errors.length}`,
      `warnings=${report.warnings.length}`,
    ].filter(Boolean).join(', ');
    console.log(`- ${report.kind}: ${status}${details ? ` (${details})` : ''}`);
    printFindings('error', report.errors);
    printFindings('warning', report.warnings);
  }
}

function printFindings(label, items) {
  const limit = 10;
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(item.message) || { count: 0, paths: [] };
    current.count += 1;
    if (current.paths.length < 3) current.paths.push(item.path);
    groups.set(item.message, current);
  }

  const entries = [...groups.entries()];
  for (const [message, group] of entries.slice(0, limit)) {
    const suffix = group.count > group.paths.length ? `, ${group.count - group.paths.length} more` : '';
    console.log(`  ${label}: ${message} (${group.count}; ${group.paths.join(', ')}${suffix})`);
  }
  if (entries.length > limit) {
    console.log(`  ${label}: ${entries.length - limit} more finding groups omitted; rerun with --json for full details.`);
  }
}

function printHelp() {
  console.log(`Usage: node ./scripts/check-state.mjs [options]

Options:
  --data-dir <path>             Data directory. Defaults to ./data.
  --plan <path>                 Mirror plan JSON path.
  --runs <path>                 Mirror run-log JSON path.
  --decisions <path>            Mirror review decisions JSON path.
  --sync-policy <path>          Policy sync settings JSON path.
  --sync-baseline <path>        Policy sync baseline JSON path.
  --sync-preview <path>         Policy sync preview JSON path.
  --sync-tombstones <path>      Policy sync tombstone decisions JSON path.
  --sync-runs <path>            Policy sync execution run-log JSON path.
  --ai-provider-state <path>    AI provider preferences JSON path.
  --music-profile <path>        Music taste profile JSON path.
  --recommendation-shortlists <path>
                                  Recommendation shortlists JSON path.
  --agent-sessions <path>       Agent sessions JSON path.
  --auto-sync <path>            Auto-sync settings JSON path.
  --auto-sync-runs <path>       Auto-sync scheduler run-log JSON path.
  --sync-backups <path>         Pre-delete sync backup JSON path.
  --require-mirror-plan         Fail when the mirror plan file is missing.
  --require-mirror-runs         Fail when the mirror run-log file is missing.
  --require-mirror-decisions    Fail when the mirror decisions file is missing.
  --require-sync-policy         Fail when sync-policy.json is missing.
  --require-sync-baseline       Fail when sync-baseline.json is missing.
  --require-sync-preview        Fail when sync-preview.json is missing.
  --require-sync-tombstones     Fail when sync-tombstones.json is missing.
  --require-sync-runs           Fail when sync-runs.json is missing.
  --require-ai-provider-state   Fail when ai-provider-state.json is missing.
  --require-music-profile       Fail when music-profile.json is missing.
  --require-recommendation-shortlists
                                  Fail when recommendation-shortlists.json is missing.
  --require-agent-sessions      Fail when agent-sessions.json is missing.
  --require-auto-sync           Fail when auto-sync.json is missing.
  --require-auto-sync-runs      Fail when auto-sync-runs.json is missing.
  --require-sync-backups        Fail when sync-backups.json is missing.
  --json                        Print machine-readable JSON.
`);
}
