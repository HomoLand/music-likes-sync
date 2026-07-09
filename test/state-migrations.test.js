import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildMirrorSyncPlan } from '../src/mirror-sync.js';
import { buildSyncBaseline, buildSyncPolicyPlan } from '../src/sync-policy.js';
import { migrateMirrorState, migrateMirrorStateBundle, migrateState, migrateStateBundle } from '../src/state-migrations.js';
import { normalizeTrack } from '../src/normalize.js';

describe('mirror state migrations', () => {
  it('treats current version 1 state as a validated no-op', () => {
    const result = migrateMirrorState('mirror-plan', fixturePlan());

    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(result.originalVersion, 1);
    assert.equal(result.version, 1);
    assert.deepEqual(result.errors, []);
  });

  it('migrates legacy unversioned mirror plans to version 1', () => {
    const legacy = fixturePlan();
    delete legacy.version;

    const result = migrateMirrorState('mirror-plan', legacy);

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.originalVersion, null);
    assert.equal(result.version, 1);
    assert.equal(result.state.version, 1);
  });

  it('repairs current mirror plans with unresolved ready add operations', () => {
    const plan = fixturePlan();
    const add = plan.operations.find((operation) => operation.action === 'add');
    assert.equal(add.status, 'needs_resolution');
    add.status = 'ready';
    plan.summary.ready += 1;
    plan.summary.blocked -= 1;

    const result = migrateMirrorState('mirror-plan', plan);

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.originalVersion, 1);
    const repairedAdd = result.state.operations.find((operation) => operation.action === 'add');
    assert.equal(repairedAdd.status, 'needs_resolution');
    assert.equal(result.state.summary.ready, fixturePlan().summary.ready);
    assert.equal(result.state.summary.blocked, fixturePlan().summary.blocked);
    assert.deepEqual(result.warnings, []);
  });

  it('migrates legacy unversioned run logs and preserves the latest run timestamp', () => {
    const result = migrateMirrorState('mirror-runs', {
      runs: [
        fixtureRun('2026-07-07T00:00:00.000Z'),
        fixtureRun('2026-07-07T00:01:00.000Z'),
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.state.version, 1);
    assert.equal(result.state.updatedAt, '2026-07-07T00:01:00.000Z');
  });

  it('migrates legacy unversioned decision state and preserves the latest decision timestamp', () => {
    const result = migrateMirrorState('mirror-decisions', {
      items: {
        'review|fixture': fixtureDecision('review|fixture', '2026-07-07T00:02:00.000Z'),
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.state.version, 1);
    assert.equal(result.state.updatedAt, '2026-07-07T00:02:00.000Z');
  });

  it('rejects state from a newer schema version', () => {
    const newer = fixturePlan();
    newer.version = 99;

    const result = migrateMirrorState('mirror-plan', newer);

    assert.equal(result.ok, false);
    assert.match(result.errors.map((error) => error.message).join('\n'), /newer than this tool supports/);
  });

  it('summarizes migration results across a state bundle', () => {
    const legacyPlan = fixturePlan();
    delete legacyPlan.version;

    const result = migrateMirrorStateBundle({
      mirrorPlan: legacyPlan,
      mirrorRuns: { version: 1, updatedAt: '2026-07-07T00:00:00.000Z', runs: [] },
    });

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.reports.length, 2);
  });

  it('writes migrated files only with --write and keeps a backup', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-migrate-'));
    const legacyPlan = fixturePlan();
    delete legacyPlan.version;
    fs.writeFileSync(path.join(tempDir, 'mirror-plan.json'), `${JSON.stringify(legacyPlan, null, 2)}\n`, 'utf8');

    const result = spawnSync(process.execPath, [
      './scripts/migrate-state.mjs',
      '--data-dir',
      tempDir,
      '--write',
      '--json',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    const planReport = payload.reports.find((report) => report.kind === 'mirror-plan');
    assert.equal(planReport.ok, true);
    assert.equal(planReport.changed, true);
    assert.equal(planReport.written, true);
    assert.equal(fs.existsSync(planReport.backupFile), true);

    const migrated = JSON.parse(fs.readFileSync(path.join(tempDir, 'mirror-plan.json'), 'utf8'));
    assert.equal(migrated.version, 1);
    const backup = JSON.parse(fs.readFileSync(planReport.backupFile, 'utf8'));
    assert.equal(backup.version, undefined);
  });
});

describe('policy-driven sync state migrations', () => {
  it('treats current sync preview state as a validated no-op', () => {
    const preview = fixtureSyncPreview();

    const result = migrateState('sync-preview', preview);

    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(result.originalVersion, 1);
    assert.equal(result.version, 1);
  });

  it('treats current policy sync run logs as a validated no-op', () => {
    const result = migrateState('sync-runs', fixtureSyncRunLog());

    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(result.originalVersion, 1);
    assert.equal(result.version, 1);
  });

  it('migrates legacy unversioned sync policy and baseline state', () => {
    const policy = fixtureSyncPolicy();
    const baseline = fixtureSyncBaseline();
    delete policy.version;
    delete policy.updatedAt;
    delete baseline.version;

    const policyResult = migrateState('sync-policy', policy, { now: '2026-07-08T00:00:00.000Z' });
    const baselineResult = migrateState('sync-baseline', baseline, { now: '2026-07-08T00:00:00.000Z' });

    assert.equal(policyResult.ok, true);
    assert.equal(policyResult.changed, true);
    assert.equal(policyResult.state.version, 1);
    assert.equal(policyResult.state.updatedAt, '2026-07-08T00:00:00.000Z');
    assert.equal(baselineResult.ok, true);
    assert.equal(baselineResult.changed, true);
    assert.equal(baselineResult.state.version, 1);
  });

  it('migrates legacy unversioned policy sync run logs', () => {
    const legacy = fixtureSyncRunLog();
    delete legacy.version;
    delete legacy.updatedAt;

    const result = migrateState('sync-runs', legacy);

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.state.version, 1);
    assert.equal(result.state.updatedAt, '2026-07-08T00:20:00.000Z');
  });

  it('summarizes migration results across policy state bundles', () => {
    const policy = fixtureSyncPolicy();
    delete policy.version;

    const result = migrateStateBundle({
      syncPolicy: policy,
      syncPreview: fixtureSyncPreview(),
      syncRuns: fixtureSyncRunLog(),
      aiProviderState: {
        version: 1,
        updatedAt: '2026-07-08T00:00:00.000Z',
        provider: 'deepseek',
      },
    }, { now: '2026-07-08T00:00:00.000Z' });

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.reports.length, 4);
  });

  it('writes migrated policy files only with --write and keeps a backup', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-policy-migrate-'));
    const policy = fixtureSyncPolicy();
    delete policy.version;
    fs.writeFileSync(path.join(tempDir, 'sync-policy.json'), `${JSON.stringify(policy, null, 2)}\n`, 'utf8');

    const result = spawnSync(process.execPath, [
      './scripts/migrate-state.mjs',
      '--data-dir',
      tempDir,
      '--require-sync-policy',
      '--write',
      '--json',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    const report = payload.reports.find((item) => item.kind === 'sync-policy');
    assert.equal(report.ok, true);
    assert.equal(report.changed, true);
    assert.equal(report.written, true);
    assert.equal(fs.existsSync(report.backupFile), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(tempDir, 'sync-policy.json'), 'utf8')).version, 1);
  });
});

function fixturePlan() {
  return buildMirrorSyncPlan({
    target: 'qq',
    sourceSnapshot: snapshot('apple', [
      track('a-1', 'Already There', 'Alice', 180000),
      track('a-2', 'New Day', 'Bob', 210000),
    ]),
    targetSnapshot: snapshot('qq', [
      track('q-1', 'Already There', 'Alice', 181000),
      track('q-2', 'Old Target Only', 'Carol', 200000),
    ]),
  });
}

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:fixture`,
    fetchedAt: '2026-07-07T00:00:00.000Z',
    skipped: false,
    tracks: tracks.map((track) => normalizeTrack(track, platform)),
  };
}

function fixtureSyncPolicy() {
  return {
    version: 1,
    updatedAt: '2026-07-08T00:00:00.000Z',
    policy: 'canonical_mirror',
    participants: ['apple', 'qq', 'netease'],
    source: { platform: 'apple' },
    targets: ['qq', 'netease'],
    deletionPolicy: 'ask',
  };
}

function fixtureSyncBaseline() {
  return buildSyncBaseline({
    snapshots: fixtureSyncSnapshots(),
    platforms: ['apple', 'qq', 'netease'],
    savedAt: '2026-07-08T00:00:00.000Z',
  });
}

function fixtureSyncPreview() {
  return buildSyncPolicyPlan({
    policy: 'union_convergence',
    snapshots: fixtureSyncSnapshots(),
    platforms: ['apple', 'qq', 'netease'],
    generatedAt: '2026-07-08T00:10:00.000Z',
  });
}

function fixtureSyncRunLog() {
  return {
    version: 1,
    updatedAt: '2026-07-08T00:20:00.000Z',
    runs: [
      {
        runId: 'mirror-run-aaaaaaaaaaaaaaaa',
        idempotencyKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'completed',
        ranAt: '2026-07-08T00:20:00.000Z',
        target: 'qq',
        policy: 'managed_bidirectional',
        action: 'add',
        previewId: 'preview-20260708001000',
        dryRun: true,
        operationKeys: { add: [], remove: [], review: [] },
        add: { requested: 1, executable: 1, blocked: 0 },
        remove: { requested: 0, executable: 0, blocked: 0, destructive: 0 },
        review: { blocked: 0 },
        addResult: { requested: 1, submitted: 0, accepted: 0 },
        removeResult: { requested: 0, submitted: 0, accepted: 0 },
        blocked: { unresolvedAdds: 0, invalidRemoves: 0, reviewItems: 0 },
      },
    ],
  };
}

function fixtureSyncSnapshots() {
  return {
    apple: snapshot('apple', [
      track('a-1', 'Already There', 'Alice', 180000),
      track('a-2', 'New Day', 'Bob', 210000),
    ]),
    qq: snapshot('qq', [
      track('q-1', 'Already There', 'Alice', 180000),
    ]),
    netease: snapshot('netease', [
      track('n-1', 'Already There', 'Alice', 180000),
      track('n-2', 'New Day', 'Bob', 210000),
    ]),
  };
}

function track(id, title, artist, durationMs) {
  return {
    id,
    title,
    artists: [artist],
    album: 'Fixture Album',
    durationMs,
  };
}

function fixtureRun(ranAt) {
  return {
    runId: 'mirror-run-aaaaaaaaaaaaaaaa',
    idempotencyKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'completed',
    ranAt,
    target: 'qq',
    dryRun: true,
    operationKeys: { add: [], remove: [], review: [] },
    add: { requested: 0, executable: 0, blocked: 0 },
    remove: { requested: 0, executable: 0, blocked: 0, destructive: 0 },
    review: { blocked: 0 },
    addResult: { requested: 0, submitted: 0, accepted: 0 },
    removeResult: { requested: 0, submitted: 0, accepted: 0 },
    blocked: { unresolvedAdds: 0, invalidRemoves: 0, reviewItems: 0 },
  };
}

function fixtureDecision(key, timestamp) {
  return {
    key,
    action: 'keep',
    target: 'qq',
    operationId: 'mirror-00001',
    reason: 'source_uncertain_match',
    note: '',
    decidedAt: timestamp,
    updatedAt: timestamp,
  };
}
