import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  fetchQQLiked,
  fetchQQPlaylistSnapshot,
  listQQPlaylists,
  removeQQTracksFromPlaylist,
} from '../src/providers/qq.js';

const originalFetch = globalThis.fetch;
const qqAuthKey = ['qm', '_keyst'].join('');

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('QQ provider playlist metadata', () => {
  it('lists user playlists with the saved cookie and sanitized identifiers', async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        code: 0,
        data: {
          disslist: [
            { diss_name: '我喜欢', dirid: 201, tid: 2190920190, song_cnt: 1992 },
            { diss_name: 'Disposable', dirid: 4, tid: 9742477820, song_cnt: 1 },
          ],
        },
      });
    };

    const playlists = await listQQPlaylists(qqCookie());

    assert.equal(playlists.length, 2);
    assert.deepEqual(playlists[0], {
      index: 1,
      name: '我喜欢',
      dirid: '201',
      tid: '2190920190',
      dissid: '',
      id: '',
      songCount: 1992,
      listenCount: 0,
      isLiked: true,
    });
    assert.equal(calls[0].options.headers.cookie.includes(`${qqAuthKey}=fixture`), true);
    assert.equal(new URL(calls[0].url).searchParams.get('loginUin'), '123');
  });

  it('resolves a QQ dirid to its tid before reading playlist details', async () => {
    const requestedDetailIds = [];
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.includes('fcg_user_created_diss')) {
        return jsonResponse({
          code: 0,
          data: {
            disslist: [
              { diss_name: '我喜欢', dirid: 201, tid: 2190920190, song_cnt: 1 },
            ],
          },
        });
      }
      if (parsed.pathname.includes('fcg_ucc_getcdinfo_byids_cp')) {
        requestedDetailIds.push(parsed.searchParams.get('disstid'));
        return jsonResponse({
          code: 0,
          cdlist: [{
            songlist: [{
              songid: 449205,
              songmid: '003aAYrm3GE0Ac',
              songname: '稻香',
              singer: [{ name: '周杰伦' }],
            }],
          }],
        });
      }
      throw new Error(`Unexpected QQ provider URL: ${url}`);
    };

    const snapshot = await fetchQQPlaylistSnapshot(qqCookie(), '201');
    const liked = await fetchQQLiked(qqCookie());

    assert.deepEqual(requestedDetailIds, ['2190920190', '2190920190']);
    assert.equal(snapshot.playlistId, '201');
    assert.equal(snapshot.tracks[0].id, '449205');
    assert.equal(liked.playlistId, '201');
    assert.equal(liked.tracks[0].mid, '003aAYrm3GE0Ac');
  });

  it('removes tracks through the musicu DelSonglist write API', async () => {
    let detailCalls = 0;
    let musicuBody = null;
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.includes('fcg_user_created_diss')) {
        return jsonResponse({
          code: 0,
          data: {
            disslist: [
              { diss_name: 'Disposable', dirid: 4, tid: 9742477820, song_cnt: 1 },
            ],
          },
        });
      }
      if (parsed.pathname.includes('fcg_ucc_getcdinfo_byids_cp')) {
        detailCalls += 1;
        return jsonResponse({
          code: 0,
          cdlist: [{
            songlist: detailCalls === 1 ? [{
              songid: 102065756,
              songmid: '004Z8Ihr0JIu5s',
              songname: '七里香',
              singer: [{ name: '周杰伦' }],
              type: 13,
            }] : [],
          }],
        });
      }
      if (parsed.pathname.includes('musicu.fcg')) {
        musicuBody = JSON.parse(options.body);
        return jsonResponse({
          code: 0,
          req_0: {
            code: 0,
            data: { retCode: 0 },
          },
        });
      }
      throw new Error(`Unexpected QQ provider URL: ${url}`);
    };

    const result = await removeQQTracksFromPlaylist(
      qqCookie(),
      '4',
      [{ id: '102065756', mid: '004Z8Ihr0JIu5s', songType: 13 }],
      { batchSize: 1 },
    );

    assert.equal(result.removed, 1);
    assert.equal(result.batches[0].provider, 'musicu');
    assert.equal(musicuBody.req_0.module, 'music.musicasset.PlaylistDetailWrite');
    assert.equal(musicuBody.req_0.method, 'DelSonglist');
    assert.equal(musicuBody.req_0.param.dirId, 4);
    assert.equal(musicuBody.req_0.param.tid, 9742477820);
    assert.deepEqual(musicuBody.req_0.param.v_songInfo, [{ songId: 102065756, songType: 13 }]);
  });
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
}

function qqCookie() {
  return `uin=123; ${qqAuthKey}=fixture`;
}
