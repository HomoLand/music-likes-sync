import { createRequire } from 'node:module';
import { normalizeTrack } from '../normalize.js';

const require = createRequire(import.meta.url);
const qqMusic = require('qq-music-api');

export async function fetchQQLiked(cookie, options = {}) {
  if (!cookie) {
    return skipped('qq', '未提供 QQ 音乐 cookie');
  }

  qqMusic.setCookie(cookie);
  const uin = options.uin || qqMusic.uin;
  if (!uin) {
    return skipped('qq', 'QQ cookie 中没有 uin/wxuin');
  }

  const playlistId = options.playlistId || await findLikedPlaylistId(uin);
  if (!playlistId) {
    return skipped('qq', '没有找到 QQ 音乐“我喜欢”歌单 ID');
  }

  const detail = await qqMusic.api('songlist', { id: playlistId });
  const rawTracks = detail.songlist || detail.songList || detail.list || [];
  const tracks = rawTracks.map((item) => normalizeQQTrack(item));

  return {
    platform: 'qq',
    source: `qq:${playlistId}`,
    fetchedAt: new Date().toISOString(),
    playlistId: String(playlistId),
    skipped: false,
    tracks,
  };
}

async function findLikedPlaylistId(uin) {
  const created = await qqMusic.api('user/songlist', { id: uin });
  const lists = created?.list || [];
  const liked = lists.find((item) => Number(item.dirid) === 201)
    || lists.find((item) => /我喜欢|喜欢|like/i.test(item.diss_name || item.title || item.name || ''));
  return liked?.tid || liked?.dissid || liked?.id || liked?.dirid || null;
}

function normalizeQQTrack(item) {
  const data = item.data || item;
  const singers = data.singer || data.singers || [];
  return normalizeTrack({
    id: data.songid || data.id,
    mid: data.songmid || data.mid,
    title: data.songname || data.name || data.title,
    artists: singers.map((singer) => singer.name || singer.title || singer),
    album: data.albumname || data.album?.name || data.albumName,
    duration: data.interval || data.duration,
    aliases: {
      titles: [data.transname, data.subtitle].filter(Boolean),
      artists: singers.flatMap((singer) => [singer?.transName, singer?.transname, singer?.subtitle].filter(Boolean)),
      albums: [data.album?.transName, data.album?.transname].filter(Boolean),
    },
    raw: item,
  }, 'qq');
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
