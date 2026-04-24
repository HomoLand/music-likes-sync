import { createRequire } from 'node:module';
import { normalizeTrack } from '../normalize.js';

const require = createRequire(import.meta.url);
const netease = require('@neteasecloudmusicapienhanced/api');

export async function fetchNeteaseLiked(cookie, options = {}) {
  if (!cookie) {
    return skipped('netease', '未提供网易云音乐 cookie');
  }

  const uid = options.uid || await getUserId(cookie);
  if (!uid) {
    return skipped('netease', '无法通过 cookie 获取网易云用户 ID');
  }

  const tracks = options.playlistId
    ? await fetchPlaylistTracks(cookie, options.playlistId)
    : await fetchLikedTracks(cookie, uid);

  return {
    platform: 'netease',
    source: options.playlistId ? `netease-playlist:${options.playlistId}` : `netease-liked:${uid}`,
    fetchedAt: new Date().toISOString(),
    userId: String(uid),
    playlistId: options.playlistId ? String(options.playlistId) : null,
    skipped: false,
    tracks: tracks.map(normalizeNeteaseTrack),
  };
}

async function getUserId(cookie) {
  const result = await netease.login_status({ cookie });
  return result.body?.data?.profile?.userId || result.body?.profile?.userId || null;
}

async function fetchLikedTracks(cookie, uid) {
  const liked = await netease.likelist({ uid, cookie });
  const ids = liked.body?.ids || [];
  if (!ids.length) return [];

  const tracks = [];
  for (const chunk of chunkArray(ids, 500)) {
    const result = await netease.song_detail({ ids: chunk.join(','), cookie });
    tracks.push(...(result.body?.songs || []));
  }
  return tracks;
}

async function fetchPlaylistTracks(cookie, playlistId) {
  const pageSize = 1000;
  const tracks = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await netease.playlist_track_all({
      id: playlistId,
      limit: pageSize,
      offset,
      cookie,
    });
    const songs = result.body?.songs || [];
    tracks.push(...songs);
    if (songs.length < pageSize) break;
  }
  return tracks;
}

function normalizeNeteaseTrack(item) {
  return normalizeTrack({
    id: item.id,
    title: item.name,
    artists: item.ar || item.artists,
    album: item.al?.name || item.album?.name,
    durationMs: item.dt || item.duration,
    aliases: {
      titles: [...asArray(item.alia), ...asArray(item.tns)],
      artists: asArray(item.ar || item.artists).flatMap((artist) => [
        ...asArray(artist?.alias),
        ...asArray(artist?.tns),
      ]),
      albums: [...asArray(item.al?.tns), ...asArray(item.album?.tns)],
    },
    raw: item,
  }, 'netease');
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function skipped(platform, reason) {
  return {
    platform,
    source: null,
    fetchedAt: new Date().toISOString(),
    skipped: true,
    reason,
    tracks: [],
  };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
