#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { DATA_DIR, readTextIfExists, writeJson } from '../src/utils.js';
import { migrateState } from '../src/state-migrations.js';

const args = parseArgs(process.argv.slice(2));
const dataDir = path.resolve(args.dataDir || DATA_DIR);
const backupDir = path.resolve(args.backupDir || path.join(dataDir, 'state-migration-backups'));
const files = [
  stateFile('mirror-plan', args.plan, 'mirror-plan.json', args.requireMirrorPlan),
  stateFile('mirror-runs', args.runs, 'mirror-runs.json', args.requireMirrorRuns),
  stateFile('mirror-decisions', args.decisions, 'mirror-decisions.json', args.requireMirrorDecisions),
  stateFile('sync-policy', args.syncPolicy, 'sync-policy.json', args.requireSyncPolicy),
  stateFile('sync-baseline', args.syncBaseline, 'sync-baseline.json', args.requireSyncBaseline),
  stateFile('sync-preview', args.syncPreview, 'sync-preview.json', args.requireSyncPreview),
  stateFile('sync-tombstones', args.syncTombstones, 'sync-tombstones.json', args.requireSyncTombstones),
  stateFile('sync-runs', args.syncRuns, 'sync-runs.json', args.requireSyncRuns),
  stateFile('ai-provider-state', args.aiProviderState, 'ai-provider-state.json', args.requireAiProviderState),
  stateFile('music-profile', args.musicProfile, 'music-profile.json', args.requireMusicProfile),
  stateFile('recommendation-shortlists', args.recommendationShortlists, 'recommendation-shortlists.json', args.requireRecommendationShortlists),
  stateFile('agent-sessions', args.agentSessions, 'agent-sessions.json', args.requireAgentSessions),
  stateFile('auto-sync', args.autoSync, 'auto-sync.json', args.requireAutoSync),
  stateFile('auto-sync-runs', args.autoSyncRuns, 'auto-sync-runs.json', args.requireAutoSyncRuns),
  stateFile('sync-backups', args.syncBackups, 'sync-backups.json', args.requireSyncBackups),
];

const reports = [];
for (const file of files) {
  reports.push(await migrateFile(file));
}

const payload = {
  ok: reports.every((report) => report.ok),
  write: args.write,
  backupDir,
  reports,
};

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  printTextReport(payload);
}

process.exitCode = payload.ok ? 0 : 1;

function stateFile(kind, overridePath, defaultName, required) {
  return {
    kind,
    filePath: path.resolve(overridePath || path.join(dataDir, defaultName)),
    required,
  };
}

async function migrateFile(file) {
  const text = await readTextIfExists(file.filePath);
  if (text === null) {
    return {
      kind: file.kind,
      ok: !file.required,
      file: file.filePath,
      skipped: !file.required,
      changed: false,
      written: false,
      errors: file.required
        ? [{ path: '$', message: `${file.kind} is required but ${file.filePath} does not exist.` }]
        : [],
      warnings: [],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      kind: file.kind,
      ok: false,
      file: file.filePath,
      skipped: false,
      changed: false,
      written: false,
      errors: [{ path: '$', message: `Invalid JSON: ${error.message}` }],
      warnings: [],
    };
  }

  const migration = migrateState(file.kind, parsed);
  const report = publicMigrationReport(file, migration);
  if (!migration.ok || !args.write || !migration.changed) return report;

  const backupFile = await backupStateFile(file.filePath);
  await writeJson(file.filePath, migration.state);
  return {
    ...report,
    written: true,
    backupFile,
  };
}

function publicMigrationReport(file, migration) {
  return {
    kind: file.kind,
    ok: migration.ok,
    file: file.filePath,
    skipped: false,
    changed: migration.changed,
    written: false,
    originalVersion: migration.originalVersion,
    version: migration.version,
    errors: migration.errors,
    warnings: migration.warnings,
  };
}

async function backupStateFile(filePath) {
  await fs.mkdir(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `${timestamp}-${path.basename(filePath)}`);
  await fs.copyFile(filePath, backupFile);
  return backupFile;
}

function parseArgs(argv) {
  const result = {
    json: false,
    write: false,
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
    backupDir: '',
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
    else if (arg === '--write') result.write = true;
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
    else if (arg === '--backup-dir') result.backupDir = requireValue(argv, index += 1, arg);
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
  console.log(payload.ok ? 'State migration check passed.' : 'State migration check failed.');
  console.log(payload.write ? `Write mode enabled. Backups: ${payload.backupDir}` : 'Dry-run only. Pass --write to update migrated files.');
  for (const report of payload.reports) {
    const status = report.ok ? (report.skipped ? 'skipped' : report.changed ? 'migration-ready' : 'current') : 'failed';
    const details = [
      report.originalVersion !== undefined ? `from=${report.originalVersion ?? 'legacy'}` : '',
      report.version !== undefined ? `to=${report.version ?? 'unknown'}` : '',
      report.written ? 'written=true' : '',
      report.backupFile ? `backup=${report.backupFile}` : '',
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
  console.log(`Usage: node ./scripts/migrate-state.mjs [options]

Options:
  --data-dir <path>             Data directory. Defaults to ./data.
  --backup-dir <path>           Backup directory. Defaults to ./data/state-migration-backups.
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
  --write                       Write migrated files after creating backups.
  --json                        Print machine-readable JSON.
`);
}
