import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

import { emptySyncBackupState, expectedSyncRestoreConfirmation } from '../src/sync-backup.js';
import {
  createProductSyncBackup,
  getProductSyncBackups,
  restoreProductSyncBackup,
} from '../src/workflow.js';

describe('product sync backup workflow', () => {
  it('creates a sanitized backup, previews restore, and only restores missing tracks after exact confirmation', async () => {
    let state = emptySyncBackupState();
    const original = fixtureSnapshots();
    const current = fixtureSnapshots();
    current.qq.tracks = [current.qq.tracks[0], track('qq', 'q-extra', 'm-extra')];
    current.netease.tracks = [current.netease.tracks[1], track('netease', 'n-extra')];
    const calls = { add: 0, live: 0 };
    const dependencies = {
      ensureDirs: async () => {},
      readBackupState: async () => state,
      writeBackupState: async (next) => { state = next; },
      readPolicyState: async () => ({ policy: 'canonical_mirror' }),
      readPreview: async () => null,
      fetchSnapshots: async () => current,
      readCookie: async () => 'fixture=1',
      assertLiveValidation: async () => { calls.live += 1; },
      addTracks: async (target, input) => {
        calls.add += 1;
        current[target].tracks.push(...input.tracks.map((item) => ({ ...item })));
        return {
          requested: input.tracks.length,
          submitted: input.tracks.length,
          accepted: input.tracks.length,
          added: input.tracks.length,
          verified: true,
          missingIds: [],
        };
      },
    };

    const created = await createProductSyncBackup({
      id: 'backup-workflow',
      createdAt: '2026-07-11T00:00:00.000Z',
      previewId: 'preview-1',
      targets: ['qq', 'netease'],
      snapshots: original,
    }, dependencies);
    assert.equal(created.backup.targets[0].count, 2);
    assert.equal(JSON.stringify(created).includes('playlist-qq'), false);

    const preview = await restoreProductSyncBackup({
      backupId: created.backup.id,
      targets: ['qq', 'netease'],
      dryRun: true,
    }, dependencies);
    assert.equal(preview.plan.missing, 2);
    assert.equal(calls.add, 0);
    assert.equal(calls.live, 0);

    await assert.rejects(
      restoreProductSyncBackup({
        backupId: created.backup.id,
        targets: ['qq', 'netease'],
        dryRun: false,
        confirmText: 'RESTORE',
      }, dependencies),
      /confirmation does not match/i,
    );
    assert.equal(calls.add, 0);

    const restored = await restoreProductSyncBackup({
      backupId: created.backup.id,
      targets: ['qq', 'netease'],
      dryRun: false,
      confirmText: expectedSyncRestoreConfirmation(created.backup.id),
    }, dependencies);
    assert.equal(restored.plan.remainingMissing, 0);
    assert.equal(calls.add, 2);
    assert.equal(calls.live, 1);
    assert.equal(current.qq.tracks.some((item) => item.id === 'q-extra'), true);
    assert.equal(current.netease.tracks.some((item) => item.id === 'n-extra'), true);

    const listed = await getProductSyncBackups({}, dependencies);
    assert.equal(listed.backups[0].integrity.ok, true);
    assert.equal(listed.restoreRuns[0].status, 'completed');
    assert.equal(JSON.stringify(listed).includes('playlist-netease'), false);
  });

  it('keeps mandatory backup creation before provider deletion calls in every deletion path', () => {
    const source = fs.readFileSync(new URL('../src/workflow.js', import.meta.url), 'utf8');
    const canonical = functionBody(source, 'export async function executeProductSyncDeletions');
    const policy = functionBody(source, 'async function executeProductPolicySyncDeletions');
    const legacyMirror = functionBody(source, 'export async function runMirrorSyncPlan');

    assert.match(canonical, /return executeProductPolicySyncDeletions\(options, policyState\)/);
    assert.ok(policy.indexOf('await createProductSyncBackup') < policy.indexOf('await executeProductPolicyRemoveMirrorPlan'));
    assert.ok(legacyMirror.indexOf('await createProductSyncBackup') < legacyMirror.indexOf('await executeMirrorSyncPlan'));
  });
});

function functionBody(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1);
  const next = source.indexOf('\nexport ', start + marker.length);
  return source.slice(start, next === -1 ? undefined : next);
}

function fixtureSnapshots() {
  return {
    qq: snapshot('qq', 'playlist-qq', [track('qq', 'q-1', 'm-1'), track('qq', 'q-2', 'm-2')]),
    netease: snapshot('netease', 'playlist-netease', [track('netease', 'n-1'), track('netease', 'n-2')]),
  };
}

function snapshot(platform, playlistId, tracks) {
  return {
    platform,
    source: `${platform}:fixture`,
    fetchedAt: '2026-07-11T00:00:00.000Z',
    playlistId,
    skipped: false,
    tracks,
  };
}

function track(platform, id, mid = '') {
  return {
    platform,
    id,
    mid,
    title: `Track ${id}`,
    artist: 'Fixture Artist',
    artists: ['Fixture Artist'],
    album: 'Fixture Album',
    durationMs: 180000,
  };
}
