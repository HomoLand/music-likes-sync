import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendSyncBackup,
  buildSyncBackup,
  buildSyncRestorePlan,
  emptySyncBackupState,
  expectedSyncRestoreConfirmation,
  summarizeSyncBackup,
  verifySyncBackup,
} from '../src/sync-backup.js';
import { migrateState } from '../src/state-migrations.js';
import { validateSyncBackupState } from '../src/state-schema.js';

describe('sync deletion backup and restore planning', () => {
  it('builds a compact checksummed backup without raw provider data', () => {
    const backup = buildSyncBackup({
      id: 'backup-1',
      createdAt: '2026-07-11T00:00:00.000Z',
      previewId: 'preview-1',
      snapshots: fixtureSnapshots(),
      targets: ['qq', 'netease'],
      reason: 'pre_delete',
    });

    assert.equal(backup.snapshots.qq.count, 2);
    assert.equal(backup.snapshots.netease.restorable, 2);
    assert.match(backup.snapshots.qq.checksum, /^[a-f0-9]{64}$/);
    assert.equal('raw' in backup.snapshots.qq.tracks[0], false);
    assert.equal(JSON.stringify(summarizeSyncBackup(backup)).includes('playlist-qq'), false);
  });

  it('plans additions for tracks missing from the current target without deleting extras', () => {
    const backup = buildSyncBackup({ id: 'backup-1', snapshots: fixtureSnapshots(), targets: ['qq', 'netease'] });
    const current = fixtureSnapshots();
    current.qq.tracks = [current.qq.tracks[0], track('qq', 'q-extra', 'm-extra')];
    current.netease.tracks = [current.netease.tracks[1], track('netease', 'n-extra')];
    const plan = buildSyncRestorePlan(backup, current);

    assert.equal(plan.additions.qq.missing, 1);
    assert.equal(plan.additions.netease.missing, 1);
    assert.equal(plan.summary.missing, 2);
    assert.equal(plan.additions.qq.tracks[0].mid, 'm-2');
  });

  it('keeps bounded backups and uses an exact restore phrase', () => {
    let state = emptySyncBackupState();
    for (let index = 0; index < 7; index += 1) {
      state = appendSyncBackup(state, buildSyncBackup({
        id: `backup-${index}`,
        createdAt: `2026-07-11T00:0${index}:00.000Z`,
        snapshots: fixtureSnapshots(),
        targets: ['qq'],
      }));
    }

    assert.equal(state.backups.length, 5);
    assert.equal(state.backups[0].id, 'backup-6');
    assert.equal(expectedSyncRestoreConfirmation('backup-6'), 'RESTORE BACKUP backup-6');
  });

  it('blocks a restore plan when compact backup contents were changed', () => {
    const backup = buildSyncBackup({ id: 'backup-1', snapshots: fixtureSnapshots(), targets: ['qq'] });
    backup.snapshots.qq.tracks[0].title = 'Tampered';

    assert.equal(verifySyncBackup(backup).ok, false);
    assert.equal(validateSyncBackupState({
      ...emptySyncBackupState(),
      backups: [backup],
    }).ok, false);
    assert.throws(
      () => buildSyncRestorePlan(backup, fixtureSnapshots()),
      /integrity check failed/i,
    );
  });

  it('validates current state and migrates unversioned backup state', () => {
    const backup = buildSyncBackup({
      id: 'backup-1',
      createdAt: '2026-07-11T00:00:00.000Z',
      snapshots: fixtureSnapshots(),
      targets: ['qq'],
    });
    const current = appendSyncBackup(emptySyncBackupState(), backup);
    const legacy = { backups: current.backups };
    const migration = migrateState('sync-backups', legacy, { now: '2026-07-11T00:01:00.000Z' });

    assert.equal(validateSyncBackupState(current).ok, true);
    assert.equal(migration.ok, true);
    assert.equal(migration.changed, true);
    assert.equal(migration.state.restoreRuns.length, 0);
    assert.equal(validateSyncBackupState(migration.state).ok, true);
  });
});

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
    raw: { forbidden: true },
  };
}
