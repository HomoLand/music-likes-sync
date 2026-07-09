import { normalizeTrack } from '../normalize.js';
import { formatErrorMessage } from '../utils.js';

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_SEARCH_URL = QQ_MUSICU_URL;
const QQ_SEARCH_INTERVAL_MS = Math.max(0, Number(process.env.QQ_SEARCH_INTERVAL_MS || 350));
const QQ_REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.QQ_REQUEST_TIMEOUT_MS || 30000));
let qqSearchQueue = Promise.resolve();
let lastQQSearchAt = 0;
let qqCookie = {};

export async function fetchQQLiked(cookie, options = {}) {
  if (!cookie) {
    return skipped('qq', '未提供 QQ 音乐 cookie');
  }

  setQQCookieOrThrow(cookie);
  const uin = options.uin || qqCookie.uin;
  if (!uin) {
    return skipped('qq', 'QQ cookie 中没有 uin/wxuin');
  }

  const playlist = options.playlistId
    ? await resolveQQPlaylistInfo(cookie, options.playlistId)
    : await findLikedPlaylist(cookie, uin);
  if (!playlist) {
    return skipped('qq', '没有找到 QQ 音乐“我喜欢”歌单 ID');
  }

  const tracks = await fetchQQPlaylistTracks(cookie, playlist);

  return {
    platform: 'qq',
    source: `qq:${playlist.tid || playlist.dirid || playlist.id}`,
    fetchedAt: new Date().toISOString(),
    playlistId: String(playlist.dirid || playlist.id || options.playlistId || playlist.tid),
    skipped: false,
    tracks,
  };
}

export async function listQQPlaylists(cookie, options = {}) {
  setQQCookieOrThrow(cookie);
  const created = await getQQUserSonglists(cookie, options.uin || qqCookie.uin);
  return (created?.list || []).map((item, index) => normalizeQQPlaylist(item, index));
}

export async function fetchQQPlaylistSnapshot(cookie, playlistId, options = {}) {
  if (!playlistId) throw new Error('缺少 QQ 音乐目标歌单 ID');
  setQQCookieOrThrow(cookie);
  const playlist = await resolveQQPlaylistInfo(cookie, playlistId, options);
  const tracks = await fetchQQPlaylistTracks(cookie, playlist);
  return {
    platform: 'qq',
    source: `qq-playlist:${playlist.tid || playlist.dirid || playlist.id}`,
    fetchedAt: new Date().toISOString(),
    playlistId: String(playlist.dirid || playlist.id || playlistId),
    skipped: false,
    tracks,
  };
}

export async function searchQQTracks(cookie, query, options = {}) {
  const keywords = String(query || '').trim();
  if (!keywords) return [];

  const limit = Math.min(30, Math.max(1, Number(options.limit || 12)));
  const retries = Math.max(0, Number(options.retries ?? 2));
  return enqueueQQSearch(() => searchQQTracksWithRetry({
    cookie,
    keywords,
    limit,
    retries,
    onRetry: options.onRetry,
  }));
}

export async function createQQPlaylist(cookie, options = {}) {
  const name = String(options.name || '').trim();
  if (!name) throw new Error('缺少 QQ 音乐歌单名');
  setQQCookieOrThrow(cookie);
  const result = await createQQSonglist(cookie, name);
  const dirid = result?.dirid || result?.id;
  if (!dirid) throw new Error('QQ 音乐歌单创建失败：没有返回 dirid');
  const playlist = await resolveQQPlaylistInfo(cookie, dirid, { name }).catch(() => null);
  return {
    id: String(dirid),
    dirid: String(dirid),
    tid: playlist?.tid ? String(playlist.tid) : '',
    name,
    privacy: 'default',
  };
}

export async function addQQTracksToPlaylist(cookie, playlistId, tracks, options = {}) {
  const ids = normalizeQQWriteTracks(tracks);
  if (!playlistId) throw new Error('缺少 QQ 音乐目标歌单 dirid；写入“我喜欢”可填 201');
  setQQCookieOrThrow(cookie);
  if (!ids.length) {
    return {
      requested: 0,
      submitted: 0,
      accepted: 0,
      added: 0,
      alreadyPresent: 0,
      verified: false,
      missingIds: [],
      alreadyPresentIds: [],
      batches: [],
    };
  }

  const playlist = await resolveQQPlaylistInfo(cookie, playlistId);
  const batchSize = Math.min(100, Math.max(1, Number(options.batchSize || 80)));
  const verify = options.verify !== false;
  let beforeIds = emptyQQTrackSet();
  if (verify) {
    beforeIds = await fetchQQPlaylistTrackSet(cookie, playlist);
  }

  const alreadyPresentTracks = verify ? ids.filter((track) => hasQQTrack(beforeIds, track)) : [];
  const idsToAdd = verify ? ids.filter((track) => !hasQQTrack(beforeIds, track)) : ids;
  const idTracks = idsToAdd.filter((track) => track.id && Number.isFinite(Number(track.id)));
  const midOnlyTracks = idsToAdd.filter((track) => !track.id && track.mid);
  const batches = [];
  for (const chunk of chunkArray(idTracks, batchSize)) {
    try {
      const data = await addQQSongsViaMusicu(cookie, playlist, chunk);
      batches.push({
        requested: chunk.length,
        code: 0,
        retCode: data?.retCode ?? 0,
      });
    } catch (error) {
      batches.push({
        requested: chunk.length,
        code: 200,
        error: formatErrorMessage(error),
      });
    }
  }

  for (const chunk of chunkArray(midOnlyTracks, batchSize)) {
    try {
      await addQQSongsByMid(cookie, playlist.dirid, chunk.map((track) => track.mid));
      batches.push({
        requested: chunk.length,
        code: 100,
      });
    } catch (error) {
      // QQ can return "invalid request" even when the add operation is applied.
      // Keep going and let the post-write playlist verification decide success.
      batches.push({
        requested: chunk.length,
        code: 200,
        error: formatErrorMessage(error),
      });
    }
  }

  let missingIds = [];
  let playlistTrackCount = null;
  if (verify) {
    const actualIds = await fetchQQPlaylistTrackSet(cookie, playlist, {
      expected: ids,
      retries: 4,
      delayMs: 1200,
    });
    missingIds = ids.filter((track) => !hasQQTrack(actualIds, track)).map(qqWriteTrackPublicId);
    playlistTrackCount = actualIds.count;
  }

  return {
    requested: ids.length,
    submitted: idsToAdd.length,
    accepted: idsToAdd.length,
    added: verify ? idsToAdd.filter((track) => !missingIds.includes(qqWriteTrackPublicId(track))).length : idsToAdd.length,
    alreadyPresent: alreadyPresentTracks.length,
    verified: verify,
    playlistTrackCount,
    missingIds,
    alreadyPresentIds: alreadyPresentTracks.map(qqWriteTrackPublicId),
    batches,
  };
}

export async function removeQQTracksFromPlaylist(cookie, playlistId, tracks, options = {}) {
  const ids = normalizeQQWriteTracks(tracks);
  if (!playlistId) throw new Error('缺少 QQ 音乐目标歌单 dirid；写入“我喜欢”可填 201');
  if (!ids.length) {
    return emptyQQMutationResult();
  }
  setQQCookieOrThrow(cookie);

  const playlist = await resolveQQPlaylistInfo(cookie, playlistId);
  const batchSize = Math.min(100, Math.max(1, Number(options.batchSize || 80)));
  const verify = options.verify !== false;
  let beforeIds = emptyQQTrackSet();
  if (verify) {
    beforeIds = await fetchQQPlaylistTrackSet(cookie, playlist);
  }

  const alreadyAbsentTracks = verify ? ids.filter((track) => !hasQQTrack(beforeIds, track)) : [];
  const idsToRemove = verify ? ids.filter((track) => hasQQTrack(beforeIds, track)) : ids;
  const idTracks = idsToRemove.filter((track) => track.id && Number.isFinite(Number(track.id)));
  const unsupportedTracks = idsToRemove.filter((track) => !track.id && track.mid);
  const batches = [];

  for (const chunk of chunkArray(idTracks, batchSize)) {
    try {
      await removeQQSongsViaMusicu(cookie, playlist, chunk);
      batches.push({
        requested: chunk.length,
        code: 100,
        provider: 'musicu',
      });
    } catch (error) {
      try {
        await removeQQSongsById(cookie, playlist.dirid, chunk.map((track) => track.id));
        batches.push({
          requested: chunk.length,
          code: 100,
          provider: 'legacy',
          fallbackReason: formatErrorMessage(error),
        });
      } catch (fallbackError) {
        batches.push({
          requested: chunk.length,
          code: 200,
          provider: 'musicu',
          error: `${formatErrorMessage(error)}; fallback: ${formatErrorMessage(fallbackError)}`,
        });
      }
    }
  }

  let stillPresentIds = [];
  let playlistTrackCount = null;
  if (verify) {
    const actualIds = await fetchQQPlaylistTrackSet(cookie, playlist, {
      retries: 4,
      delayMs: 1200,
    });
    stillPresentIds = ids
      .filter((track) => hasQQTrack(actualIds, track))
      .map(qqWriteTrackPublicId);
    playlistTrackCount = actualIds.count;
  }

  const unsupportedIds = unsupportedTracks.map(qqWriteTrackPublicId);
  return {
    requested: ids.length,
    submitted: idTracks.length,
    accepted: idTracks.length,
    removed: verify ? idTracks.filter((track) => !stillPresentIds.includes(qqWriteTrackPublicId(track))).length : idTracks.length,
    alreadyAbsent: alreadyAbsentTracks.length,
    verified: verify,
    playlistTrackCount,
    stillPresentIds,
    alreadyAbsentIds: alreadyAbsentTracks.map(qqWriteTrackPublicId),
    unsupportedIds,
    batches,
  };
}

async function findLikedPlaylist(cookie, uin) {
  const created = await getQQUserSonglists(cookie, uin);
  const lists = created?.list || [];
  const liked = lists.find((item) => Number(item.dirid) === 201)
    || lists.find((item) => /我喜欢|喜欢/i.test(item.diss_name || item.title || item.name || ''));
  return liked ? normalizeQQPlaylist(liked) : null;
}

async function getQQUserSonglists(cookie, uin) {
  const parsed = parseCookie(cookie);
  const hostuin = String(uin || parsed.uin || qqCookie.uin || '').replace(/\D/g, '');
  const result = await qqFetchJson({
    url: 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss',
    data: {
      hostUin: 0,
      hostuin,
      sin: 0,
      size: 200,
      g_tk: 5381,
      loginUin: hostuin || 0,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
    },
    headers: {
      referer: 'https://y.qq.com/portal/profile.html',
    },
    cookie,
  });
  if (Number(result.code) === 4000) return { list: [] };
  if (!result.data?.disslist) {
    throw new Error(`QQ 音乐获取用户歌单失败：${result.message || result.msg || result.code || 'empty response'}`);
  }
  const list = [...result.data.disslist];
  const liked = list.find((item) => Number(item.dirid) === 201);
  if (!liked) {
    list.unshift({
      diss_name: '我喜欢',
      diss_cover: 'http://y.gtimg.cn/mediastyle/global/img/cover_like.png',
      song_cnt: 0,
      listen_num: 0,
      dirid: 201,
      tid: '',
      dir_show: 1,
    });
  }
  return {
    list,
    creator: {
      hostuin,
      encrypt_uin: result.data.encrypt_uin,
      hostname: result.data.hostname,
    },
  };
}

function normalizeQQPlaylist(item = {}, index = 0) {
  const name = String(item.diss_name || item.name || item.title || '').trim();
  const dirid = String(item.dirid || '').trim();
  const tid = String(item.tid || '').trim();
  const dissid = String(item.dissid || '').trim();
  const id = String(item.id || '').trim();
  return {
    index: index + 1,
    name,
    dirid,
    tid,
    dissid,
    id,
    songCount: Number(item.song_cnt ?? item.song_count ?? item.total_song_num ?? 0) || 0,
    listenCount: Number(item.listen_num ?? item.listenCount ?? 0) || 0,
    isLiked: Number(dirid) === 201 || /我喜欢|喜欢/i.test(name),
  };
}

async function getQQSonglist(cookie, id) {
  if (!id) throw new Error('缺少 QQ 音乐歌单 ID');
  const result = await qqFetchJson({
    url: 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg',
    data: {
      type: 1,
      utf8: 1,
      disstid: id,
      loginUin: 0,
    },
    cookie,
    headers: {
      referer: 'https://y.qq.com/n/yqq/playlist',
    },
  });
  const detail = result.cdlist?.[0];
  if (!detail) {
    throw new Error(`QQ 音乐读取歌单失败：${result.message || result.msg || result.code || 'empty cdlist'}`);
  }
  return detail;
}

async function getQQSonglistMap(cookie, dirid) {
  const result = await qqFetchJson({
    url: 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg',
    data: {
      dirid,
      dirinfo: 1,
      g_tk: 5381,
      format: 'json',
    },
    cookie,
    headers: {
      referer: 'https://y.qq.com/n/yqq/playlist',
    },
  });
  if (Number(result.code) === 1000) throw new Error('QQ 音乐未登录');
  return {
    id: result.map,
    mid: result.mapmid,
  };
}

async function createQQSonglist(cookie, name) {
  const parsed = parseCookie(cookie);
  const result = await qqFetchJson({
    url: 'https://c.y.qq.com/splcloud/fcgi-bin/create_playlist.fcg?g_tk=5381',
    method: 'POST',
    data: {
      loginUin: parsed.uin,
      hostUin: 0,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf8',
      notice: 0,
      platform: 'yqq',
      needNewCode: 0,
      g_tk: 5381,
      uin: parsed.uin,
      name,
      show: 1,
      formsender: 1,
      utf8: 1,
      qzreferrer: 'https://y.qq.com/portal/profile.html#sub=other&tab=create&',
    },
    cookie,
    headers: {
      referer: 'https://y.qq.com/n/yqq/playlist',
    },
  });
  if (Number(result.code) === 21) throw new Error('QQ 音乐歌单创建失败：歌单重名');
  if (Number(result.code) === 1) throw new Error('QQ 音乐未登录');
  if (Number(result.code || 0) !== 0) {
    throw new Error(`QQ 音乐歌单创建失败：${result.msg || result.message || `code ${result.code}`}`);
  }
  return {
    dirid: result.dirid,
    id: result.dirid,
  };
}

async function addQQSongsByMid(cookie, dirid, mids) {
  const list = mids.filter(Boolean);
  if (!list.length) return;
  const result = await qqFetchJson({
    url: 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg?g_tk=5381',
    data: {
      midlist: list.join(','),
      typelist: new Array(list.length).fill(13).join(','),
      dirid,
      addtype: '',
      formsender: 4,
      r2: 0,
      r3: 1,
      utf8: 1,
      g_tk: 5381,
    },
    cookie,
  });
  if (Number(result.code || 0) === 1000) throw new Error('QQ 音乐未登录');
  if (Number(result.code || 0) !== 0) {
    throw new Error(`QQ 音乐添加歌曲失败：${result.msg || result.message || `code ${result.code}`}`);
  }
}

async function removeQQSongsById(cookie, dirid, ids) {
  const parsed = parseCookie(cookie);
  const list = ids.filter(Boolean);
  if (!list.length) return;
  const result = await qqFetchJson({
    url: 'https://c.y.qq.com/qzone/fcg-bin/fcg_music_delbatchsong.fcg?g_tk=5381',
    data: {
      loginUin: parsed.uin,
      hostUin: 0,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.post',
      needNewCode: 0,
      uin: parsed.uin,
      dirid,
      ids: list.join(','),
      source: 103,
      types: new Array(list.length).fill(3).join(','),
      formsender: 4,
      flag: 2,
      utf8: 1,
      from: 3,
    },
    cookie,
  });
  if (Number(result.code || 0) === 1000) throw new Error('QQ 音乐未登录');
  if (Number(result.code || 0) !== 0) {
    throw new Error(`QQ 音乐删除歌曲失败：${result.msg || result.message || `code ${result.code}`}`);
  }
}

async function qqFetchJson(options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const url = new URL(options.url);
  const data = options.data || {};
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    ...options.headers,
  };
  if (options.cookie) headers.cookie = normalizeCookieHeader(options.cookie);

  const fetchOptions = {
    method,
    headers,
  };

  if (method === 'GET') {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  } else {
    headers['content-type'] = headers['content-type'] || 'application/x-www-form-urlencoded; charset=UTF-8';
    fetchOptions.body = new URLSearchParams(
      Object.entries(data)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)]),
    ).toString();
  }

  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`QQ 音乐请求失败：HTTP ${response.status} ${text.slice(0, 160)}`);
  }
  return parseQQJsonText(text);
}

function parseQQJsonText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return {};
  const unwrapped = trimmed
    .replace(/^callback\(/, '')
    .replace(/^MusicJsonCallback\(/, '')
    .replace(/^jsonCallback\(/, '')
    .replace(/\);?$/, '');
  return JSON.parse(unwrapped);
}

function normalizeQQTrack(item) {
  const data = item.data || item;
  const singers = data.singer || data.singers || [];
  const track = normalizeTrack({
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
  return {
    ...track,
    songType: data.songType ?? data.songtype ?? data.type ?? 13,
  };
}

async function searchQQTracksWithRetry({ cookie, keywords, limit, retries, onRetry }) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await directSearchQQ(cookie, keywords, limit);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const delay = Math.min(5000, 800 * (attempt + 1));
      await notifyRetry(onRetry, { attempt: attempt + 1, retries, delay });
      await sleep(delay);
    }
  }
  throw lastError;
}

async function directSearchQQ(cookie, keywords, limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QQ_REQUEST_TIMEOUT_MS);
  try {
    const payload = {
      comm: {
        g_tk: 5381,
        uin: parseCookie(cookie).uin || '0',
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'h5',
        needNewCode: 1,
        ct: 23,
        cv: 0,
      },
      req: {
        method: 'DoSearchForQQMusicDesktop',
        module: 'music.search.SearchCgiService',
        param: {
          grp: 1,
          searchid: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
          search_type: 0,
          query: keywords,
          page_num: 1,
          num_per_page: limit,
        },
      },
    };
    const response = await fetch(QQ_SEARCH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json;charset=utf-8',
        referer: 'https://y.qq.com/',
        cookie: normalizeCookieHeader(cookie),
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`QQ 音乐搜索失败：HTTP ${response.status} ${text.slice(0, 120)}`);
    }
    const result = JSON.parse(text);
    const code = Number(result?.req?.code ?? result?.code ?? 0);
    if (code !== 0) {
      throw new Error(`QQ 音乐搜索失败：code ${code}`);
    }
    const list = result?.req?.data?.body?.song?.list || [];
    return list.map((item) => normalizeQQTrack(item));
  } finally {
    clearTimeout(timer);
  }
}

async function resolveQQPlaylistInfo(cookie, playlistId, options = {}) {
  setQQCookieOrThrow(cookie);
  const id = String(playlistId || '').trim();
  if (!id) throw new Error('缺少 QQ 音乐目标歌单 dirid');

  const lists = await listQQPlaylists(cookie);
  const name = String(options.name || '').trim();
  const matched = lists.find((item) => String(item.dirid || '') === id)
    || lists.find((item) => String(item.tid || item.dissid || item.id || '') === id)
    || (name ? lists.find((item) => String(item.name || '') === name) : null);
  if (matched) {
    return {
      id,
      dirid: String(matched.dirid || id),
      tid: matched.tid ? String(matched.tid) : '',
      name: matched.name || matched.diss_name || matched.title || name || '',
    };
  }

  return {
    id,
    dirid: id,
    tid: Number(id) > 1000000 ? id : '',
    name: name || '',
  };
}

async function fetchQQPlaylistTrackSet(cookie, playlist, options = {}) {
  const expected = options.expected || [];
  const retries = Math.max(0, Number(options.retries || 0));
  const delayMs = Math.max(0, Number(options.delayMs || 0));
  let last = emptyQQTrackSet();
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    last = await fetchQQPlaylistTrackSetOnce(cookie, playlist);
    if (!expected.length || expected.every((track) => hasQQTrack(last, track))) return last;
    if (attempt < retries && delayMs) await sleep(delayMs);
  }
  return last;
}

async function fetchQQPlaylistTrackSetOnce(cookie, playlist) {
  setQQCookieOrThrow(cookie);
  const ids = emptyQQTrackSet();
  const detailId = playlist.tid || playlist.id || playlist.dirid;
  try {
    const detail = await getQQSonglist(cookie, detailId);
    const rawTracks = detail.songlist || detail.songList || detail.list || [];
    for (const item of rawTracks) addQQTrackToSet(ids, normalizeQQTrack(item));
    ids.count = rawTracks.length;
    return ids;
  } catch (error) {
    try {
      const result = await getQQSonglistMap(cookie, playlist.dirid || playlist.id);
      for (const mid of parseQQMapIds(result?.mid || result?.mapmid || result?.mids || result?.songmid)) {
        addQQTrackToSet(ids, { mid });
      }
      return ids;
    } catch {
      throw new Error(`QQ 音乐读取目标歌单失败：${formatErrorMessage(error)}。如果是已有歌单，请填写 QQ 的 dirid；写入“我喜欢”可填 201。`);
    }
  }
}

async function fetchQQPlaylistTracks(cookie, playlist) {
  setQQCookieOrThrow(cookie);
  const detailId = playlist.tid || playlist.id || playlist.dirid;
  try {
    const detail = await getQQSonglist(cookie, detailId);
    const rawTracks = detail.songlist || detail.songList || detail.list || [];
    return rawTracks.map((item) => normalizeQQTrack(item));
  } catch (error) {
    try {
      const result = await getQQSonglistMap(cookie, playlist.dirid || playlist.id);
      const ids = parseQQMapIds(result?.id || result?.map || result?.ids || result?.songid);
      const mids = parseQQMapIds(result?.mid || result?.mapmid || result?.mids || result?.songmid);
      const length = Math.max(ids.length, mids.length);
      return Array.from({ length }, (_, index) => ({
        platform: 'qq',
        id: ids[index] || '',
        mid: mids[index] || '',
      })).filter((track) => track.id || track.mid);
    } catch {
      throw new Error(`QQ 音乐读取目标歌单失败：${formatErrorMessage(error)}。如果是已有歌单，请填写 QQ 的 dirid；写入“我喜欢”可填 201。`);
    }
  }
}

async function addQQSongsViaMusicu(cookie, playlist, tracks) {
  const result = await postQQMusicu(cookie, {
    req_0: {
      module: 'music.musicasset.PlaylistDetailWrite',
      method: 'AddSonglist',
      param: {
        dirId: Number(playlist.dirid || playlist.id),
        tid: Number(playlist.tid || 0),
        bFmtUtf8: true,
        v_songInfo: tracks.map((track) => ({
          songId: Number(track.id),
          songType: Number.isFinite(Number(track.songType)) ? Number(track.songType) : 0,
        })),
      },
    },
  });
  const response = result?.req_0 || {};
  const code = Number(response.code ?? result?.code ?? 0);
  const data = response.data || {};
  const retCode = Number(data.retCode ?? data.code ?? 0);
  if (code !== 0 || retCode !== 0) {
    throw new Error(`QQ 音乐添加歌曲失败：code ${code} / retCode ${retCode} ${data.retMsg || data.msg || ''}`.trim());
  }
  return data;
}

async function removeQQSongsViaMusicu(cookie, playlist, tracks) {
  const result = await postQQMusicu(cookie, {
    req_0: {
      module: 'music.musicasset.PlaylistDetailWrite',
      method: 'DelSonglist',
      param: {
        dirId: Number(playlist.dirid || playlist.id),
        tid: Number(playlist.tid || 0),
        bFmtUtf8: true,
        v_songInfo: tracks.map((track) => ({
          songId: Number(track.id),
          songType: Number.isFinite(Number(track.songType)) ? Number(track.songType) : 13,
        })),
      },
    },
  });
  const response = result?.req_0 || {};
  const code = Number(response.code ?? result?.code ?? 0);
  const data = response.data || {};
  const retCode = Number(data.retCode ?? data.code ?? 0);
  if (code !== 0 || retCode !== 0) {
    throw new Error(`QQ 音乐删除歌曲失败：code ${code} / retCode ${retCode} ${data.retMsg || data.msg || ''}`.trim());
  }
  return data;
}

async function postQQMusicu(cookie, payload) {
  const response = await fetch(QQ_MUSICU_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json;charset=utf-8',
      'user-agent': 'QQMusic 14090008(android 14)',
    },
    body: JSON.stringify({
      comm: buildQQMusicuComm(cookie),
      ...payload,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`QQ 音乐请求失败：HTTP ${response.status} ${text.slice(0, 120)}`);
  }
  return JSON.parse(text);
}

function buildQQMusicuComm(cookie) {
  const parsed = parseCookie(cookie);
  const guid = '2796982635';
  const authst = parsed.qm_keyst || parsed.qqmusic_key || parsed.p_skey || '';
  return {
    ct: 11,
    cv: 14090008,
    v: 14090008,
    chid: '10003505',
    qq: String(parsed.uin || qqCookie.uin || ''),
    authst,
    tmeAppID: 'qqmusic',
    tmeLoginType: Number(parsed.login_type || 2),
    QIMEI: '',
    QIMEI36: '',
    OpenUDID: guid,
    udid: guid,
    OpenUDID2: guid,
    aid: 'f4f65db268f95d9a',
    os_ver: '14',
    phonetype: 'M2012K11AC',
    devicelevel: '34',
    newdevicelevel: '34',
    rom: 'google/sdk_gphone64_x86_64/emu64xa:14/UPB5.230623.003/12077816:user/release-keys',
  };
}

function parseQQMapIds(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeQQWriteTracks(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const track = typeof value === 'object' && value
      ? {
        id: String(value.id || value.songid || value.songId || '').trim(),
        mid: String(value.mid || value.songmid || value.songMid || '').trim(),
        songType: value.songType ?? value.songtype ?? value.type
          ?? value.raw?.songType ?? value.raw?.songtype ?? value.raw?.type ?? 13,
      }
      : {
        id: '',
        mid: String(value || '').trim(),
        songType: 13,
      };
    const key = track.mid || track.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }
  return result;
}

function emptyQQTrackSet() {
  return {
    ids: new Set(),
    mids: new Set(),
    count: 0,
  };
}

function emptyQQMutationResult() {
  return {
    requested: 0,
    submitted: 0,
    accepted: 0,
    added: 0,
    removed: 0,
    alreadyPresent: 0,
    alreadyAbsent: 0,
    verified: false,
    missingIds: [],
    stillPresentIds: [],
    alreadyPresentIds: [],
    alreadyAbsentIds: [],
    unsupportedIds: [],
    batches: [],
  };
}

function addQQTrackToSet(set, track = {}) {
  const id = String(track.id || track.songid || track.songId || '').trim();
  const mid = String(track.mid || track.songmid || track.songMid || '').trim();
  if (id) set.ids.add(id);
  if (mid) set.mids.add(mid);
  set.count = Math.max(set.count || 0, set.ids.size, set.mids.size);
}

function hasQQTrack(set, track = {}) {
  const id = String(track.id || '').trim();
  const mid = String(track.mid || '').trim();
  return Boolean((mid && set.mids.has(mid)) || (id && set.ids.has(id)));
}

function qqWriteTrackPublicId(track = {}) {
  return String(track.mid || track.id || '').trim();
}

function setQQCookieOrThrow(cookie) {
  if (!String(cookie || '').trim()) throw new Error('缺少 QQ 音乐 cookie，请先登录并抓取 QQ Cookie');
  setQQCookie(cookie);
  if (!qqCookie.uin) throw new Error('QQ Cookie 中没有 uin/wxuin，请重新抓取 QQ Cookie');
}

function setQQCookie(cookie) {
  qqCookie = parseCookie(cookie);
}

function parseCookie(cookie) {
  const result = {};
  for (const part of String(cookie || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  if (Number(result.login_type) === 2 && result.wxuin) result.uin = result.wxuin;
  if (result.uin) result.uin = String(result.uin).replace(/\D/g, '');
  return result;
}

function normalizeCookieHeader(cookie) {
  return Object.entries(parseCookie(cookie))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('; ');
}

function enqueueQQSearch(task) {
  const run = qqSearchQueue.catch(() => null).then(async () => {
    await waitForQQSearchSlot();
    return task();
  });
  qqSearchQueue = run.catch(() => null);
  return run;
}

async function waitForQQSearchSlot() {
  const elapsed = Date.now() - lastQQSearchAt;
  if (elapsed < QQ_SEARCH_INTERVAL_MS) {
    await sleep(QQ_SEARCH_INTERVAL_MS - elapsed);
  }
  lastQQSearchAt = Date.now();
}

async function notifyRetry(callback, payload) {
  if (typeof callback === 'function') await callback(payload);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
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
