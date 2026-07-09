import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { normalizeTrack } from '../normalize.js';
import { formatErrorMessage } from '../utils.js';

const require = createRequire(import.meta.url);
const DIRECT_SEARCH_URL = 'https://music.163.com/api/search/get';
const BASE_SEARCH_INTERVAL_MS = Math.max(0, Number(process.env.NETEASE_SEARCH_INTERVAL_MS || 900));
const MAX_SEARCH_INTERVAL_MS = Math.max(BASE_SEARCH_INTERVAL_MS, Number(process.env.NETEASE_SEARCH_MAX_INTERVAL_MS || 15000));
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.NETEASE_REQUEST_TIMEOUT_MS || 45000));
const RATE_LIMIT_RETRY_MS = parseDelayList(process.env.NETEASE_RATE_LIMIT_RETRY_MS || '15000,45000,90000');
const SEARCH_CLIENT = String(process.env.NETEASE_SEARCH_CLIENT || (process.platform === 'win32' ? 'powershell' : 'node')).toLowerCase();
let searchQueue = Promise.resolve();
let lastSearchAt = 0;
let currentSearchIntervalMs = BASE_SEARCH_INTERVAL_MS;
let neteaseApi = null;

function getNeteaseApi() {
  if (!neteaseApi) {
    neteaseApi = require('@neteasecloudmusicapienhanced/api');
  }
  return neteaseApi;
}

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

export async function fetchNeteasePlaylistSnapshot(cookie, playlistId) {
  if (!playlistId) throw new Error('缺少网易云目标歌单 ID');
  const tracks = await fetchPlaylistTracks(cookie, playlistId);
  return {
    platform: 'netease',
    source: `netease-playlist:${playlistId}`,
    fetchedAt: new Date().toISOString(),
    playlistId: String(playlistId),
    skipped: false,
    tracks: tracks.map(normalizeNeteaseTrack),
  };
}

export async function searchNeteaseTracks(cookie, query, options = {}) {
  const keywords = String(query || '').trim();
  if (!keywords) return [];

  const limit = Math.min(30, Math.max(1, Number(options.limit || 12)));
  const retries = Math.max(0, Number(options.retries ?? 3));
  return enqueueSearch(() => searchNeteaseTracksWithRetry({
    cookie,
    keywords,
    limit,
    retries,
    endpoint: options.endpoint || process.env.NETEASE_SEARCH_ENDPOINT || 'direct',
    onRetry: options.onRetry,
  }));
}

export async function matchNeteaseTrack(cookie, track, options = {}) {
  const title = String(track?.title || '').trim();
  const netease = getNeteaseApi();
  if (!title || typeof netease.search_match !== 'function') return [];

  const retries = Math.max(0, Number(options.retries ?? 1));
  return enqueueSearch(() => requestNeteaseWithRetry({
    retries,
    onRetry: options.onRetry,
    task: () => netease.search_match({
      title,
      artist: firstArtist(track),
      album: String(track?.album || '').trim(),
      duration: track?.durationMs ? Math.round(track.durationMs / 1000) : 0,
      md5: stablePseudoMd5(track),
      cookie,
    }),
  }).then((result) => extractSongs(result).map(normalizeNeteaseTrack)));
}

export function isNeteaseRateLimitError(error) {
  const code = Number(error?.code || error?.status || error?.statusCode || error?.body?.code || error?.body?.status || 0);
  const message = formatErrorMessage(error);
  return Boolean(
    error?.rateLimited
    || code === 405
    || /操作频繁|稍候|稍后|rate.?limit|too many/i.test(message),
  );
}

export async function createNeteasePlaylist(cookie, options = {}) {
  const name = String(options.name || '').trim();
  if (!name) throw new Error('缺少网易云歌单名称');

  const result = await getNeteaseApi().playlist_create({
    name,
    privacy: options.privacy === false ? '0' : '10',
    type: 'NORMAL',
    cookie,
  });
  const body = result.body || {};
  const playlist = body.playlist || body.data || {};
  const id = playlist.id || body.id || body.playlistId;
  if (!id) {
    throw new Error(`网易云歌单创建失败：${body.message || body.msg || '没有返回歌单 ID'}`);
  }
  return {
    id: String(id),
    name: playlist.name || name,
    privacy: options.privacy === false ? 'public' : 'private',
  };
}

export async function addNeteaseTracksToPlaylist(cookie, playlistId, trackIds, options = {}) {
  const ids = unique(trackIds).filter(Boolean);
  if (!playlistId) throw new Error('缺少网易云目标歌单 ID');
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

  const batchSize = Math.min(100, Math.max(1, Number(options.batchSize || 50)));
  const verify = options.verify !== false;
  let beforeIds = new Set();
  if (verify) {
    const beforeTracks = await fetchPlaylistTracks(cookie, playlistId);
    beforeIds = new Set(beforeTracks.map((track) => String(track.id || '').trim()).filter(Boolean));
  }

  const alreadyPresentIds = verify ? ids.filter((id) => beforeIds.has(id)) : [];
  const idsToAdd = verify ? ids.filter((id) => !beforeIds.has(id)) : ids;
  const batches = [];
  for (const chunk of chunkArray(idsToAdd, batchSize)) {
    const result = await getNeteaseApi().playlist_tracks({
      op: 'add',
      pid: String(playlistId),
      tracks: chunk.join(','),
      cookie,
    });
    const body = result.body || {};
    const code = Number(body.code || result.status || 0);
    if (code && code !== 200) {
      throw new Error(`网易云添加歌曲失败：${body.message || body.msg || `code ${code}`}`);
    }
    batches.push({
      requested: chunk.length,
      code: code || 200,
    });
  }

  let missingIds = [];
  let playlistTrackCount = null;
  if (verify) {
    const actualTracks = await fetchPlaylistTracks(cookie, playlistId);
    const actualIds = new Set(actualTracks.map((track) => String(track.id || '').trim()).filter(Boolean));
    missingIds = ids.filter((id) => !actualIds.has(id));
    playlistTrackCount = actualIds.size;
  }

  return {
    requested: ids.length,
    submitted: idsToAdd.length,
    accepted: idsToAdd.length,
    added: verify ? idsToAdd.filter((id) => !missingIds.includes(id)).length : idsToAdd.length,
    alreadyPresent: alreadyPresentIds.length,
    verified: verify,
    playlistTrackCount,
    missingIds,
    alreadyPresentIds,
    batches,
  };
}

export async function removeNeteaseTracksFromPlaylist(cookie, playlistId, trackIds, options = {}) {
  const ids = unique(trackIds).filter(Boolean);
  if (!playlistId) throw new Error('缺少网易云目标歌单 ID');
  if (!ids.length) {
    return emptyMutationResult();
  }

  const batchSize = Math.min(100, Math.max(1, Number(options.batchSize || 50)));
  const verify = options.verify !== false;
  let beforeIds = new Set();
  if (verify) {
    const beforeTracks = await fetchPlaylistTracks(cookie, playlistId);
    beforeIds = new Set(beforeTracks.map((track) => String(track.id || '').trim()).filter(Boolean));
  }

  const alreadyAbsentIds = verify ? ids.filter((id) => !beforeIds.has(id)) : [];
  const idsToRemove = verify ? ids.filter((id) => beforeIds.has(id)) : ids;
  const batches = [];
  for (const chunk of chunkArray(idsToRemove, batchSize)) {
    const result = await getNeteaseApi().playlist_tracks({
      op: 'del',
      pid: String(playlistId),
      tracks: chunk.join(','),
      cookie,
    });
    const body = result.body || {};
    const code = Number(body.code || result.status || 0);
    if (code && code !== 200) {
      throw new Error(`网易云删除歌曲失败：${body.message || body.msg || `code ${code}`}`);
    }
    batches.push({
      requested: chunk.length,
      code: code || 200,
    });
  }

  let stillPresentIds = [];
  let playlistTrackCount = null;
  if (verify) {
    const actualTracks = await fetchPlaylistTracks(cookie, playlistId);
    const actualIds = new Set(actualTracks.map((track) => String(track.id || '').trim()).filter(Boolean));
    stillPresentIds = ids.filter((id) => actualIds.has(id));
    playlistTrackCount = actualIds.size;
  }

  return {
    requested: ids.length,
    submitted: idsToRemove.length,
    accepted: idsToRemove.length,
    removed: verify ? idsToRemove.filter((id) => !stillPresentIds.includes(id)).length : idsToRemove.length,
    alreadyAbsent: alreadyAbsentIds.length,
    verified: verify,
    playlistTrackCount,
    stillPresentIds,
    alreadyAbsentIds,
    batches,
  };
}

async function getUserId(cookie) {
  const result = await getNeteaseApi().login_status({ cookie });
  return result.body?.data?.profile?.userId || result.body?.profile?.userId || null;
}

async function fetchLikedTracks(cookie, uid) {
  const liked = await getNeteaseApi().likelist({ uid, cookie });
  const ids = liked.body?.ids || [];
  if (!ids.length) return [];

  const tracks = [];
  for (const chunk of chunkArray(ids, 500)) {
    const result = await getNeteaseApi().song_detail({ ids: chunk.join(','), cookie });
    tracks.push(...(result.body?.songs || []));
  }
  return tracks;
}

async function fetchPlaylistTracks(cookie, playlistId) {
  const pageSize = 1000;
  const tracks = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await getNeteaseApi().playlist_track_all({
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

export function normalizeNeteaseTrack(item) {
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

function unique(items) {
  return [...new Set(items.map((item) => String(item || '').trim()))];
}

function emptyMutationResult() {
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
    batches: [],
  };
}

function enqueueSearch(task) {
  const run = searchQueue.then(task, task);
  searchQueue = run.catch(() => {});
  return run;
}

async function searchNeteaseTracksWithRetry({ cookie, keywords, limit, retries, endpoint, onRetry }) {
  return requestNeteaseWithRetry({
    retries,
    onRetry,
    task: (signal) => {
      if (endpoint === 'direct' || endpoint === 'api-search-get') {
        return directSearchNetease(cookie, keywords, limit, signal);
      }
      const api = getNeteaseApi();
      const requester = endpoint === 'cloudsearch' ? api.cloudsearch : api.search;
      return requester({
        keywords,
        type: 1,
        limit,
        offset: 0,
        cookie,
      });
    },
  }).then((result) => extractSongs(result).map(normalizeNeteaseTrack));
}

async function directSearchNetease(cookie, keywords, limit, signal) {
  if (SEARCH_CLIENT === 'powershell') {
    return powershellSearchNetease(cookie, keywords, limit, signal);
  }

  const body = new URLSearchParams({
    s: keywords,
    type: '1',
    limit: String(limit),
    offset: '0',
  });
  const response = await fetch(DIRECT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      referer: 'https://music.163.com/',
      origin: 'https://music.163.com',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      ...(cookie ? { cookie } : {}),
    },
    body,
    signal,
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw decorateNeteaseError({
      status: response.status,
      message: `网易云搜索响应不是 JSON：${text.slice(0, 120)}`,
    });
  }
  return {
    status: response.status,
    body: json,
  };
}

function powershellSearchNetease(cookie, keywords, limit, signal) {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$payloadText = [Console]::In.ReadToEnd()
$payload = $payloadText | ConvertFrom-Json
$headers = @{
  Referer = 'https://music.163.com/'
  'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
}
if ($payload.cookie) {
  $headers.Cookie = [string]$payload.cookie
}
$body = @{
  s = [string]$payload.keywords
  type = '1'
  limit = [string]$payload.limit
  offset = '0'
}
$result = Invoke-RestMethod -Uri '${DIRECT_SEARCH_URL}' -Method Post -Body $body -Headers $headers -TimeoutSec 30
$result | ConvertTo-Json -Depth 32 -Compress
`;
  return runPowerShellJson(script, { cookie, keywords, limit }, signal).then((body) => ({
    status: 200,
    body,
  }));
}

function runPowerShellJson(script, input, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener?.('abort', onAbort);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      child.kill();
      finish(Object.assign(new Error('网易云搜索已超时'), {
        code: 'TIMEOUT',
        timedOut: true,
      }));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(decorateNeteaseError({
          status: code,
          message: stderr.trim() || `PowerShell 搜索进程退出：${code}`,
        }));
        return;
      }
      try {
        finish(null, JSON.parse(stdout.trim() || '{}'));
      } catch {
        finish(decorateNeteaseError({
          message: `PowerShell 搜索响应不是 JSON：${stdout.slice(0, 120)}`,
        }));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function requestNeteaseWithRetry({ task, retries, onRetry, timeoutMs = REQUEST_TIMEOUT_MS }) {
  for (let attempt = 0; ; attempt += 1) {
    await waitForSearchSlot();
    try {
      const result = await withTimeout((signal) => task(signal), timeoutMs);
      assertNeteaseOk(result);
      noteSearchSuccess();
      return result;
    } catch (error) {
      const decorated = decorateNeteaseError(error);
      if (!decorated.rateLimited || attempt >= retries) throw decorated;
      noteRateLimit();
      const delay = RATE_LIMIT_RETRY_MS[Math.min(attempt, RATE_LIMIT_RETRY_MS.length - 1)] || 15000;
      await notifyRetry(onRetry, {
        attempt: attempt + 1,
        retries,
        delay,
        interval: currentSearchIntervalMs,
        rateLimited: true,
      });
      await sleep(delay);
    }
  }
}

function withTimeout(task, timeoutMs) {
  let timer = null;
  const controller = new AbortController();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`网易云请求超过 ${Math.round(timeoutMs / 1000)} 秒未响应`);
      error.code = 'TIMEOUT';
      error.timedOut = true;
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => task(controller.signal)), timeout]).finally(() => {
    clearTimeout(timer);
  });
}

async function notifyRetry(callback, payload) {
  if (typeof callback !== 'function') return;
  await callback(payload);
}

async function waitForSearchSlot() {
  if (!currentSearchIntervalMs) return;
  const elapsed = Date.now() - lastSearchAt;
  const delay = currentSearchIntervalMs - elapsed;
  if (delay > 0) await sleep(delay);
  lastSearchAt = Date.now();
}

function assertNeteaseOk(result) {
  const body = result?.body || {};
  const code = Number(body.code || result?.status || 0);
  if (code && code !== 200) {
    throw decorateNeteaseError({
      ...body,
      status: result?.status,
    });
  }
}

function decorateNeteaseError(error) {
  const message = formatErrorMessage(error);
  const decorated = error instanceof Error ? error : new Error(message);
  decorated.code = decorated.code || error?.code || error?.status || error?.statusCode || error?.body?.code || error?.body?.status;
  decorated.rateLimited = isNeteaseRateLimitError(error) || isNeteaseRateLimitError(decorated);
  decorated.retryable = decorated.rateLimited;
  if (!decorated.message || decorated.message === '[object Object]') {
    decorated.message = message;
  }
  return decorated;
}

function extractSongs(result) {
  const body = result?.body || {};
  const candidates = [
    body.result?.songs,
    body.songs,
    body.data?.songs,
    body.data?.song,
    body.data,
    body.result?.song,
    body.result,
  ];
  for (const candidate of candidates) {
    const songs = normalizeSongList(candidate);
    if (songs.length) return songs;
  }
  return [];
}

function normalizeSongList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeSongList(item));
  }
  if (value.song) return normalizeSongList(value.song);
  if (value.simpleSong) return normalizeSongList(value.simpleSong);
  if (value.id && (value.name || value.title)) return [value];
  return [];
}

function firstArtist(track = {}) {
  return String(track.artist || track.artists?.[0] || '').trim();
}

function stablePseudoMd5(track = {}) {
  return [
    track.id,
    track.mid,
    track.title,
    track.artist,
    track.album,
    track.durationMs,
  ].filter(Boolean).join('|') || 'likes-sync';
}

function noteSearchSuccess() {
  if (currentSearchIntervalMs <= BASE_SEARCH_INTERVAL_MS) return;
  currentSearchIntervalMs = Math.max(BASE_SEARCH_INTERVAL_MS, Math.floor(currentSearchIntervalMs * 0.92));
}

function noteRateLimit() {
  currentSearchIntervalMs = Math.min(
    MAX_SEARCH_INTERVAL_MS,
    Math.max(currentSearchIntervalMs * 2, 2500),
  );
}

function parseDelayList(value) {
  const delays = String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0);
  return delays.length ? delays : [15000, 45000, 90000];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
