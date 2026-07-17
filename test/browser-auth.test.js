import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectAppleFavoritePlaylist } from '../src/apple-edge.js';
import { AuthSessionStore } from '../src/auth-session.js';

describe('browser authentication sessions', () => {
  it('keeps transient QR sessions platform-scoped and expires them in memory', () => {
    let now = Date.parse('2026-07-12T00:00:00.000Z');
    const store = new AuthSessionStore({
      now: () => now,
      createId: () => 'session-id',
    });
    const session = store.create('qq', { methods: ['qq', 'wechat'] }, { ttlMs: 1000 });

    assert.equal(store.get(session.id, 'qq')?.data.methods.length, 2);
    assert.equal(store.get(session.id, 'apple'), null);
    assert.deepEqual(store.toPublic(session), {
      key: 'session-id',
      platform: 'qq',
      createdAt: '2026-07-12T00:00:00.000Z',
      expiresAt: '2026-07-12T00:00:01.000Z',
    });

    now += 1001;
    assert.equal(store.get(session.id, 'qq'), null);
  });

  it('selects only the canonical Apple Favorite Songs playlist', () => {
    const selected = selectAppleFavoritePlaylist([
      {
        id: 'mix-id',
        type: 'library-playlists',
        attributes: { name: 'Favorites Mix' },
      },
      {
        id: 'library-favorites',
        type: 'library-playlists',
        attributes: { name: 'Favorite Songs' },
        relationships: { catalog: { data: [{ id: 'catalog-favorites', type: 'playlists' }] } },
      },
    ]);

    assert.deepEqual(selected, {
      name: 'Favorite Songs',
      playlistId: 'library-favorites',
      playlistType: 'library-playlists',
      catalogId: 'catalog-favorites',
    });
    assert.equal(selectAppleFavoritePlaylist([{ id: 'mix-id', attributes: { name: 'Favorites Mix' } }]), null);
  });

  it('recognizes localized Apple favorites names', () => {
    const selected = selectAppleFavoritePlaylist([
      { id: 'localized', attributes: { name: '喜爱歌曲' } },
    ]);
    assert.equal(selected?.playlistId, 'localized');
  });
});
