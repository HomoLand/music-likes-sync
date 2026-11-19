import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  runLiveProviderValidation,
  summarizeLiveValidationEvidence,
  validateLiveValidationReport,
} from '../src/live-validation.js';
import { runProductLiveValidation } from '../src/workflow.js';
import { parseArgs, runLiveValidationCli } from '../scripts/live-provider-validation.mjs';

describe('live provider validation orchestration', () => {
  it('skips unless explicitly enabled', async () => {
    const result = await runLiveProviderValidation({ env: {} });

    assert.equal(result.skipped, true);
  });

  it('parses live-validation report CLI options', () => {
    const args = parseArgs([
      '--write-report',
      '--report',
      'reports/custom-live.json',
      '--report-dir',
      'reports/custom',
    ]);

    assert.deepEqual(args, {
      writeReport: true,
      report: 'reports/custom-live.json',
      reportDir: 'reports/custom',
    });
  });

  it('does not write a live-validation report when validation is skipped', async () => {
    let writes = 0;
    const result = await runLiveValidationCli(['--write-report'], {
      runLiveProviderValidation: async () => ({ skipped: true, reason: 'disabled' }),
      ensureDirs: async () => {},
      writeJson: async () => {
        writes += 1;
      },
    });

    assert.equal(result.output, 'Skipped live validation. disabled');
    assert.equal(writes, 0);
  });

  it('writes a sanitized live-validation report for strict release evidence', async () => {
    const reportDir = path.join(os.tmpdir(), 'music-likes-sync-live-report-test');
    const writes = [];
    const result = await runLiveValidationCli(['--write-report', '--report-dir', reportDir], {
      runLiveProviderValidation: async () => fixtureLiveResult('qq'),
      ensureDirs: async () => {},
      writeJson: async (filePath, payload) => {
        writes.push({ filePath, payload });
      },
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0].filePath, path.join(reportDir, 'live-validation-qq.json'));
    assert.equal(writes[0].payload.report, undefined);
    assert.equal(writes[0].payload.ok, true);
    assert.equal(result.result.report, path.join(reportDir, 'live-validation-qq.json'));
    assert.match(result.output, /live-validation-qq\.json/);
  });

  it('summarizes live-validation evidence without exposing playlist ids', () => {
    const report = fixtureLiveResult('qq');
    const summary = summarizeLiveValidationEvidence('qq', report, {
      packageInfo: currentPackageInfo(),
      now: new Date('2026-07-08T00:00:00.000Z'),
      reportFile: 'reports/live-validation-qq.json',
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.status, 'verified');
    assert.equal(summary.track.title, 'New Track');
    assert.equal(summary.mutations.addVerified, true);
    assert.equal(JSON.stringify(summary).includes('qq-playlist'), false);
    assert.equal(Object.hasOwn(summary, 'playlistId'), false);
  });

  it('runs product live validation with explicit confirmation and returns a redacted summary', async () => {
    const writes = [];
    let calls = 0;
    const reportDir = path.join(os.tmpdir(), 'music-likes-sync-product-live-report-test');
    const result = await runProductLiveValidation({
      target: 'qq',
      query: 'fixture song',
      confirm: 'DISPOSABLE_PLAYLIST',
      playlistId: 'qq-playlist',
      playlistName: 'disposable fixture',
    }, {
      ensureDirs: async () => {},
      reportDir,
      now: new Date('2026-07-08T00:00:00.000Z'),
      runLiveProviderValidation: async ({ env }) => {
        calls += 1;
        assert.equal(env.MUSIC_LIKES_SYNC_LIVE_VALIDATE, '1');
        assert.equal(env.MUSIC_LIKES_SYNC_LIVE_CONFIRM, 'DISPOSABLE_PLAYLIST');
        assert.equal(env.MUSIC_LIKES_SYNC_LIVE_TARGET, 'qq');
        assert.equal(env.MUSIC_LIKES_SYNC_LIVE_QUERY, 'fixture song');
        assert.equal(env.MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID, 'qq-playlist');
        return fixtureLiveResult('qq');
      },
      writeJson: async (filePath, payload) => {
        writes.push({ filePath, payload });
      },
    });

    const serialized = JSON.stringify(result);
    assert.equal(calls, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].filePath, path.join(reportDir, 'live-validation-qq.json'));
    assert.equal(writes[0].payload.playlistId, 'qq-playlist');
    assert.equal(result.ok, true);
    assert.equal(result.status, 'verified');
    assert.equal(result.reportWritten, true);
    assert.equal(result.validation.track.title, 'New Track');
    assert.equal(serialized.includes('qq-playlist'), false);
    assert.equal(serialized.includes('new-id'), false);
    assert.equal(serialized.includes('qm_keyst'), false);
  });

  it('refuses product live validation without the disposable-playlist confirmation text', async () => {
    let calls = 0;
    await assert.rejects(
      () => runProductLiveValidation({
        target: 'netease',
        query: 'fixture song',
        confirm: 'wrong',
      }, {
        ensureDirs: async () => {},
        runLiveProviderValidation: async () => {
          calls += 1;
          return fixtureLiveResult('netease');
        },
      }),
      /DISPOSABLE_PLAYLIST/,
    );
    assert.equal(calls, 0);
  });

  it('reports stale live-validation evidence as not ready', () => {
    const report = fixtureLiveResult('netease');
    const errors = validateLiveValidationReport('netease', report, currentPackageInfo(), {
      now: new Date('2026-08-01T00:00:00.000Z'),
    });

    assert.equal(errors.some((error) => error.includes('within 14 days')), true);
  });

  it('invalidates live-validation evidence older than the current credential', () => {
    const report = fixtureLiveResult('qq');
    const summary = summarizeLiveValidationEvidence('qq', report, {
      packageInfo: currentPackageInfo(),
      now: new Date('2026-07-08T00:00:00.000Z'),
      credentialUpdatedAt: '2026-07-07T00:03:00.000Z',
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.status, 'stale');
    assert.match(summary.message, /current credential/);
  });

  it('chooses a search candidate that is not already in the disposable playlist', async () => {
    const state = {
      tracks: [track('existing-id', 'existing-mid', 'Existing Track')],
      addCalls: [],
      removeCalls: [],
    };
    const result = await runLiveProviderValidation({
      env: qqEnv(),
      readCookieFile: async () => 'uin=123; qm_keyst=token',
      provider: fakeQQProvider(state),
    });
    const pkg = currentPackageInfo();

    assert.equal(result.target, 'qq');
    assert.equal(result.schemaVersion, 1);
    assert.deepEqual(result.tool, {
      name: pkg.name,
      version: pkg.version,
    });
    assert.equal(result.selectedCandidateIndex, 1);
    assert.equal(result.preExistingCandidateCount, 1);
    assert.equal(result.track.id, 'new-id');
    assert.equal(result.snapshots.before.containsValidatedTrack, false);
    assert.equal(result.snapshots.afterAdd.containsValidatedTrack, true);
    assert.equal(result.snapshots.afterRemove.containsValidatedTrack, false);
    assert.deepEqual(state.addCalls.map((call) => call.tracks[0].id), ['new-id']);
    assert.deepEqual(state.removeCalls.map((call) => call.tracks[0].id), ['new-id']);
    assert.deepEqual(state.tracks.map((item) => item.id), ['existing-id']);
  });

  it('uses provider playlist snapshot helpers when available', async () => {
    const state = {
      tracks: [],
      addCalls: [],
      removeCalls: [],
      snapshotCalls: 0,
    };
    const provider = {
      ...fakeQQProvider(state),
      fetchQQLiked: async () => {
        throw new Error('generic liked snapshot should not be used');
      },
      fetchQQPlaylistSnapshot: async () => {
        state.snapshotCalls += 1;
        return snapshot('qq', state.tracks);
      },
    };

    const result = await runLiveProviderValidation({
      env: qqEnv(),
      readCookieFile: async () => 'uin=123; qm_keyst=token',
      provider,
    });

    assert.equal(result.track.id, 'existing-id');
    assert.equal(state.snapshotCalls, 3);
  });

  it('creates a disposable QQ playlist when no playlist id is provided', async () => {
    const state = {
      tracks: [],
      addCalls: [],
      removeCalls: [],
      createCalls: [],
    };
    const result = await runLiveProviderValidation({
      env: {
        ...qqEnv(),
        MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID: '',
        MUSIC_LIKES_SYNC_LIVE_PLAYLIST_NAME: 'qq disposable fixture',
      },
      readCookieFile: async () => 'uin=123; qm_keyst=token',
      provider: {
        ...fakeQQProvider(state),
        createQQPlaylist: async (cookie, options) => {
          state.createCalls.push({ cookie, options });
          return { dirid: 'created-qq-dirid', name: options.name };
        },
      },
    });

    assert.equal(result.createdPlaylist, true);
    assert.equal(result.playlistId, 'created-qq-dirid');
    assert.equal(result.playlistName, 'qq disposable fixture');
    assert.deepEqual(state.createCalls.map((call) => call.options.name), ['qq disposable fixture']);
    assert.deepEqual(state.addCalls.map((call) => call.playlistId), ['created-qq-dirid']);
    assert.deepEqual(state.removeCalls.map((call) => call.playlistId), ['created-qq-dirid']);
  });

  it('creates a private NetEase disposable playlist when no playlist id is provided', async () => {
    const state = {
      tracks: [],
      addCalls: [],
      removeCalls: [],
      createCalls: [],
    };
    const result = await runLiveProviderValidation({
      env: {
        MUSIC_LIKES_SYNC_LIVE_VALIDATE: '1',
        MUSIC_LIKES_SYNC_LIVE_CONFIRM: 'DISPOSABLE_PLAYLIST',
        MUSIC_LIKES_SYNC_LIVE_TARGET: 'netease',
        MUSIC_LIKES_SYNC_LIVE_QUERY: 'fixture song',
        MUSIC_LIKES_SYNC_LIVE_PLAYLIST_NAME: 'netease disposable fixture',
      },
      readCookieFile: async () => 'MUSIC_U=token',
      provider: {
        ...fakeNeteaseProvider(state),
        createNeteasePlaylist: async (cookie, options) => {
          state.createCalls.push({ cookie, options });
          return { id: 'created-netease-playlist', name: options.name };
        },
      },
    });

    assert.equal(result.createdPlaylist, true);
    assert.equal(result.playlistId, 'created-netease-playlist');
    assert.deepEqual(state.createCalls.map((call) => call.options), [{
      name: 'netease disposable fixture',
      privacy: true,
    }]);
    assert.deepEqual(state.addCalls, [['n-new']]);
    assert.deepEqual(state.removeCalls, [['n-new']]);
  });

  it('requires a create adapter when live validation must create a playlist', async () => {
    await assert.rejects(
      () => runLiveProviderValidation({
        env: {
          ...qqEnv(),
          MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID: '',
        },
        readCookieFile: async () => 'uin=123; qm_keyst=token',
        provider: fakeQQProvider({ tracks: [], addCalls: [], removeCalls: [] }),
      }),
      /createQQPlaylist adapter/,
    );
  });

  it('refuses to mutate when every searched candidate is already present', async () => {
    const state = {
      tracks: [
        track('existing-id', 'existing-mid', 'Existing Track'),
        track('new-id', 'new-mid', 'New Track'),
      ],
      addCalls: [],
      removeCalls: [],
    };

    await assert.rejects(
      () => runLiveProviderValidation({
        env: qqEnv(),
        readCookieFile: async () => 'uin=123; qm_keyst=token',
        provider: fakeQQProvider(state),
      }),
      /already exist/,
    );
    assert.equal(state.addCalls.length, 0);
    assert.equal(state.removeCalls.length, 0);
  });

  it('rejects a verified add result when no real playlist addition is proven', async () => {
    const state = {
      tracks: [track('existing-id', 'existing-mid', 'Existing Track')],
      addCalls: [],
      removeCalls: [],
    };
    const provider = {
      ...fakeQQProvider(state),
      addQQTracksToPlaylist: async (cookie, playlistId, tracks) => {
        state.addCalls.push({ cookie, playlistId, tracks });
        return {
          requested: tracks.length,
          submitted: tracks.length,
          accepted: tracks.length,
          added: 0,
          verified: true,
          missingIds: tracks.map((item) => item.mid || item.id),
        };
      },
    };

    await assert.rejects(
      () => runLiveProviderValidation({
        env: qqEnv(),
        readCookieFile: async () => 'uin=123; qm_keyst=token',
        provider,
      }),
      /add mutation did not verify a real playlist change/,
    );
    assert.equal(state.addCalls.length, 1);
    assert.equal(state.removeCalls.length, 0);
  });

  it('fails if the post-remove snapshot still contains the validated track', async () => {
    const state = {
      tracks: [track('existing-id', 'existing-mid', 'Existing Track')],
      addCalls: [],
      removeCalls: [],
      keepAfterRemove: true,
    };

    await assert.rejects(
      () => runLiveProviderValidation({
        env: qqEnv(),
        readCookieFile: async () => 'uin=123; qm_keyst=token',
        provider: fakeQQProvider(state),
      }),
      /remove verification failed/,
    );
    assert.equal(state.addCalls.length, 1);
    assert.equal(state.removeCalls.length, 1);
  });

  it('validates NetEase mutations using target song ids', async () => {
    const state = {
      tracks: [],
      addCalls: [],
      removeCalls: [],
    };
    const result = await runLiveProviderValidation({
      env: {
        MUSIC_LIKES_SYNC_LIVE_VALIDATE: '1',
        MUSIC_LIKES_SYNC_LIVE_CONFIRM: 'DISPOSABLE_PLAYLIST',
        MUSIC_LIKES_SYNC_LIVE_TARGET: 'netease',
        MUSIC_LIKES_SYNC_LIVE_QUERY: 'fixture song',
        MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID: 'n-playlist',
      },
      readCookieFile: async () => 'MUSIC_U=token',
      provider: fakeNeteaseProvider(state),
    });

    assert.equal(result.target, 'netease');
    assert.deepEqual(state.addCalls, [['n-new']]);
    assert.deepEqual(state.removeCalls, [['n-new']]);
    assert.deepEqual(state.tracks, []);
  });
});

function qqEnv() {
  return {
    MUSIC_LIKES_SYNC_LIVE_VALIDATE: '1',
    MUSIC_LIKES_SYNC_LIVE_CONFIRM: 'DISPOSABLE_PLAYLIST',
    MUSIC_LIKES_SYNC_LIVE_TARGET: 'qq',
    MUSIC_LIKES_SYNC_LIVE_QUERY: 'fixture song',
    MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID: 'q-playlist',
  };
}

function fakeQQProvider(state) {
  return {
    fetchQQLiked: async () => snapshot('qq', state.tracks),
    searchQQTracks: async () => [
      track('existing-id', 'existing-mid', 'Existing Track'),
      track('new-id', 'new-mid', 'New Track'),
    ],
    addQQTracksToPlaylist: async (cookie, playlistId, tracks) => {
      state.addCalls.push({ cookie, playlistId, tracks });
      state.tracks.push(...tracks);
      return {
        requested: tracks.length,
        submitted: tracks.length,
        accepted: tracks.length,
        added: tracks.length,
        verified: true,
        missingIds: [],
      };
    },
    removeQQTracksFromPlaylist: async (cookie, playlistId, tracks) => {
      state.removeCalls.push({ cookie, playlistId, tracks });
      if (!state.keepAfterRemove) {
        const ids = new Set(tracks.map((item) => item.id));
        state.tracks = state.tracks.filter((item) => !ids.has(item.id));
      }
      return {
        requested: tracks.length,
        submitted: tracks.length,
        accepted: tracks.length,
        removed: tracks.length,
        verified: true,
        stillPresentIds: [],
      };
    },
  };
}

function fakeNeteaseProvider(state) {
  return {
    fetchNeteaseLiked: async () => snapshot('netease', state.tracks),
    searchNeteaseTracks: async () => [
      { platform: 'netease', id: 'n-new', title: 'New Track', artist: 'Fixture Artist' },
    ],
    addNeteaseTracksToPlaylist: async (cookie, playlistId, ids) => {
      state.addCalls.push(ids);
      state.tracks.push(...ids.map((id) => ({ platform: 'netease', id, title: 'New Track' })));
      return {
        requested: ids.length,
        submitted: ids.length,
        accepted: ids.length,
        added: ids.length,
        verified: true,
        missingIds: [],
      };
    },
    removeNeteaseTracksFromPlaylist: async (cookie, playlistId, ids) => {
      state.removeCalls.push(ids);
      const lookup = new Set(ids);
      state.tracks = state.tracks.filter((item) => !lookup.has(item.id));
      return {
        requested: ids.length,
        submitted: ids.length,
        accepted: ids.length,
        removed: ids.length,
        verified: true,
        stillPresentIds: [],
      };
    },
  };
}

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:fixture`,
    fetchedAt: '2026-07-07T00:00:00.000Z',
    playlistId: `${platform}-playlist`,
    skipped: false,
    tracks,
  };
}

function track(id, mid, title) {
  return {
    platform: 'qq',
    id,
    mid,
    title,
    artist: 'Fixture Artist',
  };
}

function fixtureLiveResult(target) {
  return {
    schemaVersion: 1,
    tool: currentPackageInfo(),
    ok: true,
    verified: true,
    validatedAt: '2026-07-07T00:00:00.000Z',
    target,
    playlistId: `${target}-playlist`,
    playlistName: 'disposable fixture',
    createdPlaylist: true,
    query: 'fixture song',
    selectedCandidateIndex: 0,
    preExistingCandidateCount: 0,
    track: { id: `${target}-track`, title: 'New Track', artist: 'Fixture Artist' },
    snapshots: {
      before: { fetchedAt: '2026-07-07T00:00:00.000Z', playlistId: `${target}-playlist`, trackCount: 0, containsValidatedTrack: false },
      afterAdd: { fetchedAt: '2026-07-07T00:01:00.000Z', playlistId: `${target}-playlist`, trackCount: 1, containsValidatedTrack: true },
      afterRemove: { fetchedAt: '2026-07-07T00:02:00.000Z', playlistId: `${target}-playlist`, trackCount: 0, containsValidatedTrack: false },
    },
    add: { requested: 1, submitted: 1, accepted: 1, added: 1, verified: true },
    remove: { requested: 1, submitted: 1, accepted: 1, removed: 1, verified: true },
  };
}

function currentPackageInfo() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return {
    name: pkg.name,
    version: pkg.version,
  };
}
