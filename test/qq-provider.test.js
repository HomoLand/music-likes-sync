import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { decodeAG1Request } from '@jixun/qmweb-sign';

import {
  addQQTracksToPlaylist,
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
        req_0: {
          code: 0,
          data: {
            v_playlist: [
              { dirName: '我喜欢', dirId: 201, tid: 2190920190, songNum: 1992, play_cnt: 12 },
              { dirName: 'Disposable', dirId: 4, tid: 9742477820, songNum: 1 },
            ],
          },
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
      listenCount: 12,
      isLiked: true,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://u.y.qq.com/cgi-bin/musicu.fcg');
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.req_0.module, 'music.musicasset.PlaylistBaseRead');
    assert.equal(payload.req_0.method, 'GetPlaylistByUin');
    assert.equal(payload.req_0.param.uin, '123');
    assert.equal(payload.comm.authst, 'fixture');
  });

  it('falls back to the legacy user playlist endpoint when musicu is unavailable', async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('musicu.fcg')) {
        return jsonResponse({ code: 0, req_0: { code: 1000 } });
      }
      return jsonResponse({
        code: 0,
        data: {
          disslist: [
            { diss_name: '我喜欢', dirid: 201, tid: 2190920190, song_cnt: 1992 },
          ],
        },
      });
    };

    const playlists = await listQQPlaylists(qqCookie());

    assert.equal(playlists.length, 1);
    assert.equal(playlists[0].dirid, '201');
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /fcg_user_created_diss/);
    assert.equal(calls[1].options.headers.cookie.includes(`${qqAuthKey}=fixture`), true);
    assert.equal(new URL(calls[1].url).searchParams.get('loginUin'), '123');
  });

  it('does not disguise QQ privacy errors as an empty playlist list', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('musicu.fcg')) {
        return jsonResponse({ code: 0, req_0: { code: 1000 } });
      }
      return jsonResponse({ code: 4000, message: 'check privacy error!' });
    };

    await assert.rejects(
      () => listQQPlaylists(qqCookie()),
      /check privacy error/,
    );
  });

  it('resolves a QQ dirid to its tid before reading playlist details', async () => {
    const requestedDetailIds = [];
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.includes('musicu.fcg')) {
        return jsonResponse({
          code: 0,
          req_0: {
            code: 0,
            data: {
              v_playlist: [
                { dirName: '我喜欢', dirId: 201, tid: 2190920190, songNum: 1 },
              ],
            },
          },
        });
      }
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

  it('reads liked tracks through the paginated musicu playlist detail API', async () => {
    const detailStarts = [];
    globalThis.fetch = async (url, options = {}) => {
      assert.equal(String(url), 'https://u.y.qq.com/cgi-bin/musicu.fcg');
      const payload = JSON.parse(options.body);
      if (payload.req_0.method === 'GetPlaylistByUin') {
        return jsonResponse({
          code: 0,
          req_0: {
            code: 0,
            data: {
              v_playlist: [
                { dirName: '我喜欢', dirId: 201, tid: 2190920190, songNum: 3 },
              ],
            },
          },
        });
      }
      assert.equal(payload.req_0.module, 'music.srfDissInfo.aiDissInfo');
      assert.equal(payload.req_0.method, 'uniform_get_Dissinfo');
      const start = payload.req_0.param.song_begin;
      detailStarts.push(start);
      const songs = start === 0
        ? [qqSong(1, 'mid-1'), qqSong(2, 'mid-2')]
        : [qqSong(3, 'mid-3')];
      return jsonResponse({
        code: 0,
        req_0: {
          code: 0,
          data: {
            code: 0,
            songlist: songs,
            total_song_num: 3,
            hasmore: start === 0 ? 1 : 0,
          },
        },
      });
    };

    const liked = await fetchQQLiked(qqCookie());

    assert.equal(liked.skipped, false);
    assert.equal(liked.playlistId, '201');
    assert.deepEqual(liked.tracks.map((track) => track.mid), ['mid-1', 'mid-2', 'mid-3']);
    assert.deepEqual(detailStarts, [0, 2]);
  });

  it('verifies liked-list writes through musicu when the legacy detail API is private', async () => {
    let added = false;
    let legacyCalls = 0;
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.includes('musics.fcg')) {
        const payload = await decodeSignedPayload(options.body);
        assert.equal(parsed.searchParams.get('encoding'), 'ag-1');
        assert.match(parsed.searchParams.get('sign'), /^zzc/);
        assert.equal(payload.comm.ct, 24);
        assert.equal(payload.req_1.method, 'AddSonglist');
        assert.deepEqual(Object.keys(payload.req_1.param).sort(), ['dirId', 'v_songInfo']);
        assert.equal(options.headers.cookie, qqCookie());
        added = true;
        return signedJsonResponse({
          code: 0,
          req_1: { code: 0, data: { retCode: 0 } },
        });
      }
      if (!parsed.pathname.includes('musicu.fcg')) {
        legacyCalls += 1;
        return jsonResponse({ code: 4000, message: 'check privacy error!' });
      }

      const payload = JSON.parse(options.body);
      if (payload.req_0.method === 'GetPlaylistByUin') {
        return jsonResponse({
          code: 0,
          req_0: {
            code: 0,
            data: {
              v_playlist: [
                { dirName: '我喜欢', dirId: 201, tid: 2190920190, songNum: added ? 1 : 0 },
              ],
            },
          },
        });
      }
      if (payload.req_0.method === 'uniform_get_Dissinfo') {
        return jsonResponse({
          code: 0,
          req_0: {
            code: 0,
            data: {
              code: 0,
              songlist: added ? [qqSong(449205, '003aAYrm3GE0Ac')] : [],
              total_song_num: added ? 1 : 0,
              hasmore: 0,
            },
          },
        });
      }
      throw new Error(`Unexpected QQ musicu method: ${payload.req_0.method}`);
    };

    const result = await addQQTracksToPlaylist(
      qqCookie(),
      '201',
      [{ id: '449205', mid: '003aAYrm3GE0Ac', songType: 0 }],
      { batchSize: 1 },
    );

    assert.equal(result.added, 1);
    assert.equal(result.verified, true);
    assert.deepEqual(result.missingIds, []);
    assert.equal(legacyCalls, 0);
  });

  it('falls back to the legacy mid writer when musicu rejects a liked-list add', async () => {
    let added = false;
    let legacyWriteCalls = 0;
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.includes('fcg_music_add2songdir')) {
        legacyWriteCalls += 1;
        added = true;
        return jsonResponse({ code: 0 });
      }
      if (parsed.pathname.includes('musics.fcg')) {
        const payload = await decodeSignedPayload(options.body);
        assert.equal(payload.req_1.method, 'AddSonglist');
        return signedJsonResponse({
          code: 0,
          req_1: { code: 1000, data: { retCode: 0 } },
        });
      }
      assert.equal(parsed.pathname.includes('musicu.fcg'), true);
      const payload = JSON.parse(options.body);
      if (payload.req_0.method === 'GetPlaylistByUin') {
        return jsonResponse({
          code: 0,
          req_0: {
            code: 0,
            data: {
              v_playlist: [
                { dirName: '我喜欢', dirId: 201, tid: 2190920190, songNum: added ? 1 : 0 },
              ],
            },
          },
        });
      }
      if (payload.req_0.method === 'uniform_get_Dissinfo') {
        return jsonResponse({
          code: 0,
          req_0: {
            code: 0,
            data: {
              code: 0,
              songlist: added ? [qqSong(449205, '003aAYrm3GE0Ac')] : [],
              total_song_num: added ? 1 : 0,
              hasmore: 0,
            },
          },
        });
      }
      throw new Error(`Unexpected QQ musicu method: ${payload.req_0.method}`);
    };

    const result = await addQQTracksToPlaylist(
      qqCookie(),
      '201',
      [{ id: '449205', mid: '003aAYrm3GE0Ac', songType: 0 }],
      { batchSize: 1 },
    );

    assert.equal(result.added, 1);
    assert.equal(result.verified, true);
    assert.deepEqual(result.missingIds, []);
    assert.equal(result.batches[0].provider, 'legacy');
    assert.equal(legacyWriteCalls, 1);
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
      if (parsed.pathname.includes('musics.fcg')) {
        const payload = await decodeSignedPayload(options.body);
        if (payload.req_1.method === 'DelSonglist') musicuBody = payload;
        return signedJsonResponse({
          code: 0,
          req_1: {
            code: 0,
            data: { retCode: 0 },
          },
        });
      }
      if (parsed.pathname.includes('musicu.fcg')) {
        const payload = JSON.parse(options.body);
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
    assert.equal(musicuBody.req_1.module, 'music.musicasset.PlaylistDetailWrite');
    assert.equal(musicuBody.req_1.method, 'DelSonglist');
    assert.equal(musicuBody.req_1.param.dirId, 4);
    assert.equal(Object.hasOwn(musicuBody.req_1.param, 'tid'), false);
    assert.equal(Object.hasOwn(musicuBody.req_1.param, 'bFmtUtf8'), false);
    assert.deepEqual(musicuBody.req_1.param.v_songInfo, [{ songId: 102065756, songType: 13 }]);
  });
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
}

async function decodeSignedPayload(body) {
  return JSON.parse(await decodeAG1Request(String(body || '')));
}

function signedJsonResponse(payload) {
  const key = [122, 63, 140, 29, 94, 155, 47, 10, 108, 77, 126, 139, 31, 58, 92, 157, 14, 43, 111, 74, 129];
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] ^= key[index % key.length];
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function qqCookie() {
  return `uin=123; ${qqAuthKey}=fixture`;
}

function qqSong(id, mid) {
  return {
    id,
    mid,
    name: `Song ${id}`,
    interval: 180,
    singer: [{ name: 'Fixture Artist' }],
    album: { name: 'Fixture Album' },
  };
}
