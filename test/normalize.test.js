import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTrack } from '../src/normalize.js';

describe('normalizeTrack provider identities', () => {
  it('keeps QQ mid separate from provider id', () => {
    const track = normalizeTrack({
      mid: 'qq-mid-only',
      title: 'Mid Only',
      artists: ['Alice'],
      durationMs: 180000,
    }, 'qq');

    assert.equal(track.id, null);
    assert.equal(track.mid, 'qq-mid-only');
  });

  it('uses QQ songid as the destructive provider id', () => {
    const track = normalizeTrack({
      songid: 12345,
      songmid: 'qq-song-mid',
      title: 'Has Song Id',
      artists: ['Bob'],
      durationMs: 200000,
    }, 'qq');

    assert.equal(track.id, '12345');
    assert.equal(track.mid, 'qq-song-mid');
  });

  it('extracts catalog evidence from legacy NetEase search results', () => {
    const track = normalizeTrack({
      id: 2140425047,
      name: 'ALL!!!',
      artists: [{ name: '塞壬唱片-MSR' }],
      album: {
        id: 190493457,
        name: '好得不能再好了！泰拉投资大师课',
        size: 1,
        publishTime: 1711987200000,
      },
      duration: 111308,
    }, 'netease');

    assert.deepEqual(track.metadata.providerCatalog, {
      platform: 'netease',
      trackNumber: 1,
      albumId: '190493457',
      releaseDate: '2024-04-02',
    });
  });
});
