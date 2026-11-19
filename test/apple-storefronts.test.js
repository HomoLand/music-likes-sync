import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { enrichAppleSnapshotWithStorefrontAliases } from '../src/metadata/apple-storefronts.js';
import { fetchAppleEquivalentSongs } from '../src/providers/apple.js';

describe('Apple storefront equivalents', () => {
  it('maps equivalent resources back to the source catalog id', async () => {
    let requestUrl = '';
    const result = await fetchAppleEquivalentSongs(['us-song-1'], {
      storefront: 'cn',
      token: 'test-token',
      fetchImpl: async (url) => {
        requestUrl = String(url);
        return jsonResponse({
          data: [{
            id: 'cn-song-9',
            attributes: {
              name: '大鱼',
              artistName: '周深',
              albumName: '深的深',
              durationInMillis: 317000,
              isrc: 'CNZ021600012',
            },
          }],
          meta: {
            filters: {
              equivalents: {
                'us-song-1': [{ id: 'cn-song-9', type: 'songs' }],
              },
            },
          },
        });
      },
    });

    assert.match(requestUrl, /catalog\/cn\/songs/);
    assert.match(decodeURIComponent(requestUrl), /filter\[equivalents\]=us-song-1/);
    assert.deepEqual(result.get('us-song-1'), [{
      id: 'cn-song-9',
      title: '大鱼',
      artist: '周深',
      album: '深的深',
      durationMs: 317000,
      isrc: 'CNZ021600012',
    }]);
  });

  it('adds localized aliases once and reuses the local cache', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-apple-storefront-'));
    const cacheFile = path.join(directory, 'cache.json');
    const calls = [];
    const lookup = async (ids, options) => {
      calls.push(options.storefront);
      const localized = options.storefront === 'cn'
        ? { title: '大鱼', artist: '周深', album: '深的深' }
        : { title: '大魚', artist: '周深', album: '深的深' };
      return new Map(ids.map((id) => [id, [{
        id,
        ...localized,
        durationMs: 317597,
        isrc: 'CNZ021600012',
      }]]));
    };
    const snapshot = {
      platform: 'apple',
      source: 'https://music.apple.com/us/playlist/favorite-songs/test',
      tracks: [{
        platform: 'apple',
        id: '1320755350',
        title: '大魚',
        artists: ['Zhou Shen'],
        album: '深的深',
        durationMs: 317597,
        isrc: 'CNZ021600012',
      }],
    };

    const first = await enrichAppleSnapshotWithStorefrontAliases(snapshot, {
      storefronts: ['cn', 'hk'],
      cacheFile,
      fetchEquivalentSongs: lookup,
    });
    const second = await enrichAppleSnapshotWithStorefrontAliases(snapshot, {
      storefronts: ['cn', 'hk'],
      cacheFile,
      fetchEquivalentSongs: async () => {
        throw new Error('cache should avoid a second lookup');
      },
    });

    assert.deepEqual(calls, ['cn', 'hk']);
    assert(first.snapshot.tracks[0].aliases.titles.includes('大鱼'));
    assert(first.snapshot.tracks[0].aliases.artists.includes('周深'));
    assert.equal(first.snapshot.tracks[0].metadata.appleStorefronts.sourceStorefront, 'us');
    assert.deepEqual(first.snapshot.tracks[0].metadata.appleStorefronts.storefronts, ['cn', 'hk']);
    assert.equal(first.snapshot.tracks[0].metadata.appleStorefronts.equivalents.length, 2);
    assert.equal(first.snapshot.tracks[0].metadata.appleStorefronts.equivalents[0].isrcMatch, true);
    assert.equal(second.stats.requests, 0);
    assert.equal(second.stats.cacheHits, 2);
  });

  it('does not merge a different-version storefront substitute as an alias', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-apple-substitute-'));
    const result = await enrichAppleSnapshotWithStorefrontAliases({
      platform: 'apple',
      source: 'https://music.apple.com/us/playlist/favorite-songs/test',
      tracks: [{
        platform: 'apple',
        id: 'source-2020',
        title: 'Fly Me to the Moon (2020 Version)',
        artists: ['Example Artist'],
        album: 'Example Album',
        durationMs: 272294,
        isrc: 'JPAAA2000001',
      }],
    }, {
      storefronts: ['cn'],
      cacheFile: path.join(directory, 'cache.json'),
      fetchEquivalentSongs: async () => new Map([['source-2020', [{
        id: 'substitute-2009',
        title: 'Fly Me to the Moon (2009 Version)',
        artist: 'Example Artist',
        album: 'Example Album',
        durationMs: 274000,
        isrc: 'JPAAA0900001',
      }]]]),
    });

    const track = result.snapshot.tracks[0];
    assert.equal(track.aliases.titles.includes('Fly Me to the Moon (2009 Version)'), false);
    assert.equal(result.stats.rejectedAliases, 1);
    assert.equal(track.metadata.appleStorefronts.equivalents[0].isrcMatch, false);
    assert.equal(track.metadata.appleStorefronts.equivalents[0].aliasTrusted, false);
  });
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}
