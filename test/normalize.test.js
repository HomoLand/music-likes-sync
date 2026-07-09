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
});
