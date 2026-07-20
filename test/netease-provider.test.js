import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectNeteaseLikedPlaylist } from '../src/providers/netease.js';

describe('NetEase liked playlist discovery', () => {
  it('prefers the owned special liked playlist over list order', () => {
    const result = selectNeteaseLikedPlaylist([
      { id: 'other', creator: { userId: '42' }, specialType: 0, subscribed: false },
      { id: 'liked', creator: { userId: 42 }, specialType: 5, subscribed: false },
    ], '42');

    assert.equal(result.id, 'liked');
  });

  it('never selects another user or a subscribed playlist as the write target', () => {
    const result = selectNeteaseLikedPlaylist([
      { id: 'foreign', creator: { userId: '7' }, specialType: 5, subscribed: false },
      { id: 'subscribed', creator: { userId: '42' }, specialType: 5, subscribed: true },
      { id: 'owned', creator: { userId: '42' }, name: '我喜欢的音乐', subscribed: false },
    ], '42');

    assert.equal(result.id, 'owned');
  });
});
