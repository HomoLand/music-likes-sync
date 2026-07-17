import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessAppleAutoSyncCapture,
  appendAutoSyncRun,
  defaultAutoSyncState,
  emptyAutoSyncRunLog,
  isAutoSyncDue,
  nextAutoSyncRunAt,
  normalizeAutoSyncState,
  summarizeAutoSync,
} from '../src/auto-sync.js';
import { migrateState } from '../src/state-migrations.js';
import { validateAutoSyncRunLogState, validateAutoSyncState } from '../src/state-schema.js';

const NOW = '2026-07-11T00:00:00.000Z';

describe('auto-sync state', () => {
  it('starts disabled with protected defaults', () => {
    const state = defaultAutoSyncState(NOW);

    assert.equal(state.enabled, false);
    assert.equal(state.autoExecuteAdditions, true);
    assert.equal(state.requireBaseline, true);
    assert.deepEqual(state.targets, ['qq', 'netease']);
    assert.equal(validateAutoSyncState(state).ok, true);
  });

  it('normalizes intervals, targets, and the next run timestamp', () => {
    const state = normalizeAutoSyncState({
      enabled: true,
      intervalMinutes: 1,
      targets: ['netease', 'netease'],
      maxSourceAgeMinutes: 30,
    }, {}, { now: NOW });

    assert.equal(state.intervalMinutes, 15);
    assert.equal(state.maxSourceAgeMinutes, 60);
    assert.deepEqual(state.targets, ['netease']);
    assert.equal(state.nextRunAt, '2026-07-11T00:15:00.000Z');
    assert.equal(isAutoSyncDue(state, '2026-07-11T00:14:59.999Z'), false);
    assert.equal(isAutoSyncDue(state, state.nextRunAt), true);
    assert.equal(nextAutoSyncRunAt(state, NOW), state.nextRunAt);
    assert.equal(validateAutoSyncState(state).ok, true);
  });

  it('reschedules the next run when an enabled interval changes', () => {
    const current = normalizeAutoSyncState({
      enabled: true,
      intervalMinutes: 60,
      nextRunAt: '2026-07-11T05:00:00.000Z',
    }, {}, { now: NOW });
    const changed = normalizeAutoSyncState({ intervalMinutes: 30 }, current, { now: NOW });

    assert.equal(changed.nextRunAt, '2026-07-11T00:30:00.000Z');
  });

  it('rejects Apple as a write target and secret-shaped state', () => {
    assert.throws(
      () => normalizeAutoSyncState({ enabled: true, targets: ['apple'] }, {}, { now: NOW }),
      /Unsupported auto-sync target/,
    );

    const invalid = {
      ...defaultAutoSyncState(NOW),
      secret: 'fixture-value',
    };
    const report = validateAutoSyncState(invalid);
    assert.equal(report.ok, false);
    assert.equal(report.errors.some((error) => /secret|credential/i.test(error.message)), true);
  });

  it('keeps bounded scheduler history and exposes a sanitized summary', () => {
    const first = run('auto-1', 'completed', '2026-07-11T00:05:00.000Z');
    const second = run('auto-2', 'attention', '2026-07-11T00:10:00.000Z');
    let log = appendAutoSyncRun(emptyAutoSyncRunLog(), first);
    log = appendAutoSyncRun(log, second);
    log = appendAutoSyncRun(log, { ...first, message: 'updated' });

    assert.deepEqual(log.runs.map((entry) => entry.id), ['auto-1', 'auto-2']);
    assert.equal(validateAutoSyncRunLogState(log).ok, true);
    const summary = summarizeAutoSync(defaultAutoSyncState(NOW), log, { running: true });
    assert.equal(summary.running, true);
    assert.equal(summary.lastStatus, 'running');
    assert.equal(summary.historyCount, 2);
    assert.equal(summary.latest.id, 'auto-1');
  });

  it('migrates legacy unversioned scheduler state and run logs', () => {
    const state = defaultAutoSyncState(NOW);
    delete state.version;
    const stateResult = migrateState('auto-sync', state, { now: NOW });
    const runsResult = migrateState('auto-sync-runs', { runs: [run('auto-1', 'completed', NOW)] }, { now: NOW });

    assert.equal(stateResult.ok, true);
    assert.equal(stateResult.changed, true);
    assert.equal(stateResult.state.version, 1);
    assert.equal(runsResult.ok, true);
    assert.equal(runsResult.changed, true);
    assert.equal(runsResult.state.version, 1);
  });

  it('accepts only complete, source-consistent Apple MusicKit captures', () => {
    const reference = {
      count: 844,
      source: 'https://music.apple.com/us/playlist/favorite-songs/pl.u-fixture?l=zh-Hans-CN',
    };
    const complete = assessAppleAutoSyncCapture({
      method: 'musickit-api',
      source: 'https://music.apple.com/cn/playlist/favorite-songs/pl.u-fixture',
      tracks: Array.from({ length: 844 }, (_, index) => ({ id: index })),
    }, reference);
    const domFallback = assessAppleAutoSyncCapture({
      method: 'dom-scroll',
      source: reference.source,
      tracks: Array.from({ length: 288 }, (_, index) => ({ id: index })),
    }, reference);
    const largeDrop = assessAppleAutoSyncCapture({
      method: 'musickit-api',
      source: reference.source,
      tracks: Array.from({ length: 600 }, (_, index) => ({ id: index })),
    }, reference);
    const wrongSource = assessAppleAutoSyncCapture({
      method: 'musickit-api',
      source: 'https://music.apple.com/us/playlist/other/pl.u-other',
      tracks: Array.from({ length: 844 }, (_, index) => ({ id: index })),
    }, reference);

    assert.equal(complete.ok, true);
    assert.equal(domFallback.code, 'apple_capture_not_authoritative');
    assert.equal(largeDrop.code, 'apple_capture_large_drop');
    assert.equal(wrongSource.code, 'apple_capture_source_changed');
  });
});

function run(id, status, completedAt) {
  return {
    id,
    trigger: 'scheduled',
    status,
    startedAt: completedAt,
    completedAt,
    policy: 'managed_bidirectional',
    targets: ['qq', 'netease'],
    dryRun: false,
    message: 'fixture',
    snapshotRefresh: { apple: 'refreshed', qq: 'refreshed', netease: 'refreshed' },
    preview: { willAdd: 0, needsConfirmation: 0, mayDelete: 0 },
    additions: { requested: 0, succeeded: 0, failed: 0, blocked: 0 },
    deletionSignals: 0,
    convergence: { converged: true },
    error: '',
  };
}
