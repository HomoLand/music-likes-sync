import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTrack } from '../src/normalize.js';
import { resolveAppleTrackMedia } from '../src/providers/apple.js';
import { resolveNeteaseTrackMedia } from '../src/providers/netease.js';
import { resolveQQTrackMedia } from '../src/providers/qq.js';
import { buildSyncPolicyPlan } from '../src/sync-policy.js';
import { trackArtworkUrl } from '../src/track-media.js';
import { resolveProductSyncMedia } from '../src/workflow.js';

describe('track media extraction', () => {
  it('derives real provider artwork without accepting unsafe URL schemes', () => {
    assert.equal(trackArtworkUrl({
      platform: 'qq',
      raw: { album: { mid: '000EWe060IBefP' } },
    }), 'https://y.gtimg.cn/music/photo_new/T002R300x300M000000EWe060IBefP.jpg?max_age=2592000');
    assert.match(trackArtworkUrl({
      platform: 'netease',
      raw: { al: { picUrl: 'https://p4.music.126.net/cover.jpg' } },
    }), /param=300y300/);
    assert.equal(trackArtworkUrl({ platform: 'apple', artworkUrl: 'javascript:alert(1)' }), '');
  });

  it('resolves Apple artwork and public preview from the catalog response', async () => {
    const media = await resolveAppleTrackMedia({ platform: 'apple', id: '123' }, {
      token: 'fixture-token',
      fetchImpl: async () => jsonResponse({
        data: [{
          id: '123',
          attributes: {
            artwork: { url: 'https://is1-ssl.mzstatic.com/image/{w}x{h}bb.{f}' },
            previews: [{ url: 'https://audio-ssl.itunes.apple.com/preview.m4a' }],
          },
        }],
      }),
    });

    assert.equal(media.playable, true);
    assert.match(media.artworkUrl, /300x300bb\.jpg/);
    assert.equal(new URL(media.previewUrl).hostname, 'audio-ssl.itunes.apple.com');
  });

  it('uses authenticated QQ vkey media and album details without persisting the URL', async () => {
    let requestBody = null;
    const media = await resolveQQTrackMedia('uin=123; qm_keyst=fixture', {
      platform: 'qq',
      id: '456',
      mid: '001dbteI2XIVJw',
      songType: 13,
    }, {
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return textResponse({
          code: 0,
          req_0: {
            code: 0,
            data: {
              sip: ['https://aqqmusic.tc.qq.com/'],
              midurlinfo: [{ purl: 'M500001dbteI2XIVJw.mp3?vkey=short-lived' }],
            },
          },
          req_1: {
            code: 0,
            data: { track_info: { album: { mid: '000EWe060IBefP' } } },
          },
        });
      },
    });

    assert.deepEqual(requestBody.req_0.param.songtype, [0]);
    assert.equal(requestBody.comm.authst, 'fixture');
    assert.equal(media.playable, true);
    assert.equal(new URL(media.previewUrl).hostname, 'aqqmusic.tc.qq.com');
    assert.match(media.artworkUrl, /000EWe060IBefP/);
  });

  it('re-requests QQ vkey with the audio file media_mid returned by song details', async () => {
    const requests = [];
    const media = await resolveQQTrackMedia('uin=123; qm_keyst=fixture', {
      platform: 'qq',
      id: '456',
      mid: 'song-mid',
    }, {
      fetchImpl: async (_url, options) => {
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) {
          return textResponse({
            code: 0,
            req_0: {
              code: 0,
              data: {
                sip: ['https://aqqmusic.tc.qq.com/'],
                midurlinfo: [{ purl: 'M500song-mid.mp3?vkey=wrong-file' }],
              },
            },
            req_1: {
              code: 0,
              data: {
                track_info: {
                  album: { mid: 'album-mid' },
                  file: { media_mid: 'audio-file-mid' },
                },
              },
            },
          });
        }
        return textResponse({
          code: 0,
          req_0: {
            code: 0,
            data: {
              sip: ['https://aqqmusic.tc.qq.com/'],
              midurlinfo: [{ purl: 'M500audio-file-mid.mp3?vkey=valid-file' }],
            },
          },
        });
      },
    });

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].req_0.param.filename, ['M500song-mid.mp3']);
    assert.deepEqual(requests[1].req_0.param.filename, ['M500audio-file-mid.mp3']);
    assert.equal(requests[1].req_1, undefined);
    assert.match(media.previewUrl, /M500audio-file-mid\.mp3/);
  });

  it('falls back to the compatible NetEase song URL API when v1 is unavailable', async () => {
    let legacyCalls = 0;
    const media = await resolveNeteaseTrackMedia('MUSIC_U=fixture', {
      platform: 'netease',
      id: '789',
    }, {
      api: {
        song_url_v1: async () => { throw new Error('xeapi public key is missing'); },
        song_url: async () => {
          legacyCalls += 1;
          return { body: { data: [{ url: 'https://m702.music.126.net/song.mp3' }] } };
        },
        song_detail: async () => ({
          body: { songs: [{ al: { picUrl: 'https://p3.music.126.net/cover.jpg' } }] },
        }),
      },
    });

    assert.equal(legacyCalls, 1);
    assert.equal(media.playable, true);
    assert.match(media.artworkUrl, /param=300y300/);
  });
});

describe('operation-scoped product media', () => {
  it('only resolves tracks that belong to the current preview operation', async () => {
    const plan = buildSyncPolicyPlan({
      policy: 'canonical_mirror',
      source: 'apple',
      targets: ['qq'],
      generatedAt: '2026-07-11T00:00:00.000Z',
      snapshots: {
        apple: snapshot('apple', [track('apple', 'a-1')]),
        qq: snapshot('qq', []),
      },
    });
    const operation = plan.operations.find((item) => item.action === 'add');
    operation.candidateTrack = track('qq', 'q-1', { mid: 'mid-q-1' });
    operation.alternatives = [track('qq', 'q-2', { mid: 'mid-q-2' })];
    const calls = [];
    const dependencies = {
      ensureDirs: async () => {},
      readPreview: async () => plan,
      resolveMedia: async (platform, selectedTrack, selection) => {
        calls.push({ platform, id: selectedTrack.id, role: selection.role });
        return {
          artworkUrl: 'https://y.gtimg.cn/cover.jpg',
          previewUrl: 'https://aqqmusic.tc.qq.com/preview.mp3?vkey=ephemeral',
          playable: true,
          reason: '',
          expiresAt: '2099-01-01T00:00:00.000Z',
        };
      },
    };

    const result = await resolveProductSyncMedia({
      operationId: operation.id,
      role: 'alternative',
      alternativeIndex: 0,
    }, dependencies);
    assert.deepEqual(calls, [{ platform: 'qq', id: 'q-2', role: 'alternative' }]);
    assert.equal(result.media.maxPreviewSeconds, 30);
    assert.equal(result.track.artworkUrl, 'https://y.gtimg.cn/cover.jpg');

    await assert.rejects(
      resolveProductSyncMedia({
        operationId: operation.id,
        role: 'alternative',
        alternativeIndex: 4,
      }, dependencies),
      /序号无效/,
    );
    await assert.rejects(
      resolveProductSyncMedia({ operationId: 'unknown', role: 'source' }, dependencies),
      /没有这个条目/,
    );
  });

  it('returns a source-relative offset only after reliable audio alignment', async () => {
    const plan = buildSyncPolicyPlan({
      policy: 'canonical_mirror',
      source: 'apple',
      targets: ['qq'],
      generatedAt: '2026-07-11T00:00:00.000Z',
      snapshots: {
        apple: snapshot('apple', [track('apple', 'alignment-source')]),
        qq: snapshot('qq', []),
      },
    });
    const operation = plan.operations.find((item) => item.action === 'add');
    operation.candidateTrack = track('qq', 'alignment-target', { mid: 'alignment-mid' });
    const aligned = {
      status: 'aligned',
      method: 'chromaprint',
      confidence: 0.96,
      offsetFromSourceSeconds: 29.47,
      sourceStartSeconds: 0,
      targetStartSeconds: 29.47,
      overlapSeconds: 90,
      maxPreviewSeconds: 30,
      reason: '',
    };
    const result = await resolveProductSyncMedia({
      operationId: operation.id,
      role: 'candidate',
      alignWithSource: true,
    }, {
      ensureDirs: async () => {},
      readPreview: async () => plan,
      resolveMedia: async (platform) => ({
        artworkUrl: `https://example.test/${platform}.jpg`,
        previewUrl: `https://example.test/${platform}.mp3`,
        playable: true,
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
      alignMedia: async (source, target) => {
        assert.equal(source.platform, 'apple');
        assert.equal(target.platform, 'qq');
        return aligned;
      },
    });

    assert.deepEqual(result.media.alignment, aligned);
    assert.equal(result.media.maxPreviewSeconds, 30);
  });
});

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:fixture`,
    fetchedAt: '2026-07-11T00:00:00.000Z',
    skipped: false,
    tracks,
  };
}

function track(platform, id, extra = {}) {
  return normalizeTrack({
    id,
    title: `Track ${id}`,
    artists: ['Fixture Artist'],
    album: 'Fixture Album',
    durationMs: 180000,
    ...extra,
  }, platform);
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function textResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
}
