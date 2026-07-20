import path from 'node:path';
import {
  DATA_DIR,
  ensureDirs,
  readJsonIfExists,
  writeJson,
} from '../utils.js';
import { normalizeTrack } from '../normalize.js';
import {
  compactAppleArtwork,
  compactApplePreviews,
  normalizeArtworkUrl,
  normalizeHttpUrl,
  trackArtworkUrl,
  trackPreviewUrl,
} from '../track-media.js';
import { runAppleMusicKitTask } from '../apple-edge.js';

const DEFAULT_LIMIT = 12;
const DEFAULT_BATCH_SIZE = 50;
const APPLE_EQUIVALENT_BATCH_SIZE = 300;
const CACHE_FILE = path.join(DATA_DIR, 'apple-catalog-cache.json');
const CACHE_VERSION = 1;
const APPLE_SEARCH_SOURCE = String(process.env.APPLE_SEARCH_SOURCE || 'apple-web').trim().toLowerCase();
const APPLE_STOREFRONT = String(process.env.APPLE_STOREFRONT || 'us').trim().toLowerCase();
const APPLE_SEARCH_INTERVAL_MS = Math.max(
  0,
  Number(process.env.APPLE_SEARCH_INTERVAL_MS || (APPLE_SEARCH_SOURCE === 'musickit' ? 2200 : 700)),
);
const APPLE_RATE_LIMIT_RETRY_MS = parseDelayList(process.env.APPLE_RATE_LIMIT_RETRY_MS || '10000,30000');
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const APPLE_MUSIC_WEB_URL = 'https://music.apple.com/us/new';
const APPLE_WEB_API_URL = 'https://amp-api.music.apple.com';

let catalogCachePromise = null;
let saveQueue = Promise.resolve();
let appleSearchQueue = Promise.resolve();
let lastAppleSearchAt = 0;
let appleWebToken = null;

export async function searchAppleTracks(query, options = {}) {
  const keyword = String(query || '').trim();
  if (!keyword) return [];
  const limit = Math.min(25, Math.max(1, Number(options.limit || DEFAULT_LIMIT)));
  const refresh = Boolean(options.refresh);
  const cache = await loadCatalogCache();
  const cacheKey = catalogCacheKey(keyword);
  const cached = cache.queries[cacheKey];
  if (!refresh && isReusableCatalogEntry(cached, limit)) {
    return cached.songs.slice(0, limit).map(normalizeAppleCatalogSong);
  }

  return enqueueAppleSearch(() => searchAppleTracksWithRetry({
    keyword,
    limit,
    cache,
    cacheKey,
    onRetry: options.onRetry,
  }));
}

async function searchAppleTracksWithRetry({ keyword, limit, cache, cacheKey, onRetry }) {
  let lastError = null;
  for (let attempt = 0; attempt <= APPLE_RATE_LIMIT_RETRY_MS.length; attempt += 1) {
    try {
      await throttleAppleSearch();
      const result = await searchAppleCatalog(keyword, limit);
      const entry = {
        query: keyword,
        key: cacheKey,
        limit,
        storefront: result.storefront || '',
        source: result.source || APPLE_SEARCH_SOURCE,
        fetchedAt: new Date().toISOString(),
        songs: Array.isArray(result.songs) ? result.songs : [],
      };
      cache.queries[cacheKey] = entry;
      await saveCatalogCache(cache);
      return entry.songs.map(normalizeAppleCatalogSong);
    } catch (error) {
      lastError = error;
      if (!isAppleRateLimitError(error) || attempt >= APPLE_RATE_LIMIT_RETRY_MS.length) break;
      const delay = APPLE_RATE_LIMIT_RETRY_MS[attempt];
      if (typeof onRetry === 'function') {
        await onRetry({
          attempt: attempt + 1,
          retries: APPLE_RATE_LIMIT_RETRY_MS.length,
          delay,
        });
      }
      await sleep(delay);
    }
  }
  throw lastError;
}

async function searchAppleCatalog(keyword, limit) {
  if (APPLE_SEARCH_SOURCE !== 'musickit' && APPLE_SEARCH_SOURCE !== 'itunes') {
    try {
      return await searchAppleWebTracks(keyword, limit);
    } catch (error) {
      if (APPLE_SEARCH_SOURCE === 'apple-web') {
        try {
          return await searchItunesTracks(keyword, limit);
        } catch {
          throw error;
        }
      }
      throw error;
    }
  }
  if (APPLE_SEARCH_SOURCE === 'itunes') {
    try {
      return await searchItunesTracks(keyword, limit);
    } catch (error) {
      throw error;
    }
  }
  const result = await runAppleMusicKitTask(searchAppleCatalogTask, { query: keyword, limit }, 60000);
  return {
    ...result,
    source: 'musickit',
  };
}

async function searchAppleWebTracks(keyword, limit) {
  let emptyResult = null;
  for (const term of itunesFallbackTerms(keyword)) {
    const result = await fetchAppleWebTracks(term, limit);
    if (result.songs.length || !emptyResult) emptyResult = result;
    if (result.songs.length) return result;
  }
  return emptyResult || {
    storefront: APPLE_STOREFRONT,
    source: 'apple-web',
    songs: [],
  };
}

async function fetchAppleWebTracks(keyword, limit, retry = true) {
  const token = await getAppleWebToken();
  const url = new URL(`${APPLE_WEB_API_URL}/v1/catalog/${APPLE_STOREFRONT}/search`);
  url.searchParams.set('term', keyword);
  url.searchParams.set('types', 'songs');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('platform', 'web');
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      origin: 'https://music.apple.com',
      referer: 'https://music.apple.com/',
      'user-agent': 'curl/8.0',
    },
  });
  if ((response.status === 401 || response.status === 403) && retry) {
    appleWebToken = null;
    return fetchAppleWebTracks(keyword, limit, false);
  }
  if (!response.ok) {
    throw new Error(`Apple catalog search failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return {
    storefront: APPLE_STOREFRONT,
    source: 'apple-web',
    songs: (payload.results?.songs?.data || []).map(compactAppleApiSong),
  };
}

function compactAppleApiSong(song = {}) {
  const attrs = song.attributes || {};
  return {
    id: String(song.id || ''),
    type: song.type || 'songs',
    attributes: {
      name: attrs.name || '',
      artistName: attrs.artistName || '',
      albumName: attrs.albumName || '',
      durationInMillis: attrs.durationInMillis || 0,
      isrc: attrs.isrc || '',
      artwork: compactAppleArtwork(attrs.artwork),
      previews: compactApplePreviews(attrs.previews),
    },
  };
}

export async function resolveAppleTrackMedia(track = {}, options = {}) {
  const existingArtwork = trackArtworkUrl({ ...track, platform: 'apple' }, { size: options.artworkSize });
  const existingPreview = trackPreviewUrl(track);
  if (existingArtwork && existingPreview && options.refresh !== true) {
    return playableAppleMedia(existingArtwork, existingPreview);
  }

  const id = String(track.id || track.catalogId || '').trim();
  if (!id) throw new Error('缺少 Apple Music 歌曲 ID，无法解析试听。');
  const song = (await fetchAppleCatalogSongsByIds([id], options))[0] || {};
  const attrs = song.attributes || {};
  const artworkUrl = normalizeArtworkUrl(attrs.artwork?.url, { size: options.artworkSize, platform: 'apple' })
    || existingArtwork;
  const previewUrl = normalizeHttpUrl(attrs.previews?.[0]?.url) || existingPreview;
  return playableAppleMedia(artworkUrl, previewUrl);
}

export async function resolveAppleTracksMedia(tracks = [], options = {}) {
  const list = Array.isArray(tracks) ? tracks : [];
  const results = new Map();
  const missingIds = [];
  for (const track of list) {
    const id = String(track?.id || track?.catalogId || '').trim();
    if (!id) continue;
    const artworkUrl = trackArtworkUrl({ ...track, platform: 'apple' }, { size: options.artworkSize });
    const previewUrl = trackPreviewUrl(track);
    if (artworkUrl && options.refresh !== true) {
      results.set(id, playableAppleMedia(artworkUrl, previewUrl));
    } else {
      missingIds.push(id);
    }
  }

  for (const ids of chunkArray(unique(missingIds), Math.min(100, Math.max(1, Number(options.batchSize || 100))))) {
    const songs = await fetchAppleCatalogSongsByIds(ids, options);
    for (const song of songs) {
      const id = String(song?.id || '').trim();
      if (!id) continue;
      const attrs = song.attributes || {};
      results.set(id, playableAppleMedia(
        normalizeArtworkUrl(attrs.artwork?.url, { size: options.artworkSize, platform: 'apple' }),
        normalizeHttpUrl(attrs.previews?.[0]?.url),
      ));
    }
  }

  return list.map((track) => ({
    id: String(track?.id || track?.catalogId || '').trim(),
    media: results.get(String(track?.id || track?.catalogId || '').trim())
      || playableAppleMedia(trackArtworkUrl(track), trackPreviewUrl(track)),
  }));
}

async function fetchAppleCatalogSongsByIds(ids, options = {}) {
  const values = unique(ids);
  if (!values.length) return [];
  const storefront = String(options.storefront || APPLE_STOREFRONT).trim().toLowerCase();
  const token = String(options.token || await getAppleWebToken()).trim();
  const request = options.fetchImpl || fetch;
  const url = new URL(`${APPLE_WEB_API_URL}/v1/catalog/${storefront}/songs`);
  url.searchParams.set('ids', values.join(','));
  url.searchParams.set('platform', 'web');
  url.searchParams.set('l', 'zh-Hans-CN');
  const response = await request(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      origin: 'https://music.apple.com',
      referer: 'https://music.apple.com/',
      'user-agent': 'curl/8.0',
    },
  });
  if ((response.status === 401 || response.status === 403) && !options.token && options.retry !== false) {
    appleWebToken = null;
    return fetchAppleCatalogSongsByIds(values, { ...options, retry: false });
  }
  if (!response.ok) throw new Error(`Apple Music 媒体信息读取失败：HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function fetchAppleEquivalentSongs(ids, options = {}) {
  const values = unique(ids).slice(0, APPLE_EQUIVALENT_BATCH_SIZE);
  if (!values.length) return new Map();
  const storefront = String(options.storefront || APPLE_STOREFRONT).trim().toLowerCase();
  const token = String(options.token || await getAppleWebToken()).trim();
  const request = options.fetchImpl || fetch;
  const url = new URL(`${APPLE_WEB_API_URL}/v1/catalog/${storefront}/songs`);
  url.searchParams.set('filter[equivalents]', values.join(','));
  url.searchParams.set('platform', 'web');
  const response = await request(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      origin: 'https://music.apple.com',
      referer: 'https://music.apple.com/',
      'user-agent': 'curl/8.0',
    },
  });
  if ((response.status === 401 || response.status === 403) && !options.token && options.retry !== false) {
    appleWebToken = null;
    return fetchAppleEquivalentSongs(values, { ...options, retry: false });
  }
  if (!response.ok) {
    throw new Error(`Apple equivalent catalog lookup failed for ${storefront}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const resources = new Map((payload?.data || []).map((song) => [String(song?.id || ''), song]));
  const equivalents = payload?.meta?.filters?.equivalents || {};
  return new Map(values.map((sourceId) => {
    const refs = Array.isArray(equivalents[sourceId]) ? equivalents[sourceId] : [];
    const songs = refs
      .map((ref) => resources.get(String(ref?.id || '')))
      .filter(Boolean)
      .map(compactAppleEquivalentSong);
    if (!songs.length && resources.has(sourceId)) {
      songs.push(compactAppleEquivalentSong(resources.get(sourceId)));
    }
    return [sourceId, songs];
  }));
}

function compactAppleEquivalentSong(song = {}) {
  const attrs = song.attributes || {};
  const trackNumber = Number(attrs.trackNumber || 0);
  const discNumber = Number(attrs.discNumber || 0);
  const releaseDate = String(attrs.releaseDate || '');
  return {
    id: String(song.id || ''),
    title: String(attrs.name || ''),
    artist: String(attrs.artistName || ''),
    album: String(attrs.albumName || ''),
    durationMs: Number(attrs.durationInMillis || 0),
    isrc: String(attrs.isrc || ''),
    ...(trackNumber ? { trackNumber } : {}),
    ...(discNumber ? { discNumber } : {}),
    ...(releaseDate ? { releaseDate } : {}),
  };
}

async function getAppleWebToken() {
  if (isReusableAppleWebToken(appleWebToken)) return appleWebToken.token;
  const home = await fetch(APPLE_MUSIC_WEB_URL, {
    headers: {
      accept: 'text/html,*/*',
      'user-agent': 'curl/8.0',
    },
  });
  if (!home.ok) throw new Error(`Apple Music web token page failed: HTTP ${home.status}`);
  const html = await home.text();
  const scriptPath = [...html.matchAll(/<script[^>]+src="([^"]*\/assets\/index~[^"]+\.js)"/g)]
    .map((match) => match[1])
    .find(Boolean);
  if (!scriptPath) throw new Error('Apple Music web token script not found');
  const scriptUrl = new URL(scriptPath, APPLE_MUSIC_WEB_URL);
  const script = await fetch(scriptUrl, {
    headers: {
      accept: 'application/javascript,*/*',
      'user-agent': 'curl/8.0',
    },
  });
  if (!script.ok) throw new Error(`Apple Music web token script failed: HTTP ${script.status}`);
  const source = await script.text();
  const token = (source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0];
  if (!token) throw new Error('Apple Music web token not found');
  appleWebToken = {
    token,
    expiresAt: decodeJwtExpiry(token),
  };
  return token;
}

function isReusableAppleWebToken(entry) {
  return Boolean(entry?.token && (!entry.expiresAt || entry.expiresAt - Date.now() > 5 * 60 * 1000));
}

function decodeJwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const exp = Number(payload.exp || 0);
    return exp ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function searchItunesTracks(keyword, limit) {
  let lastError = null;
  let emptyResult = null;
  for (const term of itunesFallbackTerms(keyword)) {
    try {
      const result = await fetchItunesTracks(term, limit);
      if (result.songs.length || !emptyResult) emptyResult = result;
      if (result.songs.length) return result;
    } catch (error) {
      lastError = error;
      if (!/HTTP 403/i.test(error?.message || String(error || ''))) throw error;
    }
  }
  if (emptyResult) return emptyResult;
  throw lastError || new Error('Apple iTunes search failed');
}

async function fetchItunesTracks(keyword, limit) {
  const url = new URL(ITUNES_SEARCH_URL);
  url.searchParams.set('term', keyword);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('country', 'US');
  url.searchParams.set('limit', String(limit));
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'curl/8.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Apple iTunes search failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return {
    storefront: 'us',
    source: 'itunes',
    songs: (payload.results || [])
      .filter((item) => item.wrapperType === 'track' && item.kind === 'song' && item.trackId)
      .map(compactItunesSong),
  };
}

function itunesFallbackTerms(keyword) {
  const value = String(keyword || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const terms = [value];
  const withoutBrackets = value
    .replace(/\s*[\(\[（【].*?[\)\]）】]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutBrackets) terms.push(withoutBrackets);
  const parts = withoutBrackets.split(/\s+/).filter(Boolean);
  if (parts.length > 1) terms.push(parts.slice(0, -1).join(' '));
  const originalParts = value.split(/\s+/).filter(Boolean);
  if (originalParts.length > 1) terms.push(originalParts.slice(0, -1).join(' '));
  return unique(terms).slice(0, 4);
}

function compactItunesSong(item) {
  return {
    id: String(item.trackId || ''),
    type: 'songs',
    attributes: {
      name: item.trackName || item.trackCensoredName || '',
      artistName: item.artistName || '',
      albumName: item.collectionName || item.collectionCensoredName || '',
      durationInMillis: item.trackTimeMillis || 0,
      isrc: '',
      artwork: compactAppleArtwork({
        url: String(item.artworkUrl100 || '').replace(/100x100bb/i, '{w}x{h}bb'),
      }),
      previews: compactApplePreviews(item.previewUrl ? [{ url: item.previewUrl }] : []),
    },
  };
}

async function enqueueAppleSearch(task) {
  const run = appleSearchQueue.then(task, task);
  appleSearchQueue = run.catch(() => {});
  return run;
}

async function throttleAppleSearch() {
  const now = Date.now();
  const waitMs = Math.max(0, lastAppleSearchAt + APPLE_SEARCH_INTERVAL_MS - now);
  if (waitMs > 0) await sleep(waitMs);
  lastAppleSearchAt = Date.now();
}

function isAppleRateLimitError(error) {
  return /HTTP (403|429)|rate.?limit|too many/i.test(error?.message || String(error || ''));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDelayList(value) {
  return String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0);
}

export async function getAppleCatalogCacheStats() {
  const cache = await loadCatalogCache();
  const songIds = new Set();
  let songs = 0;
  let withIsrc = 0;
  for (const entry of Object.values(cache.queries || {})) {
    for (const song of entry.songs || []) {
      songs += 1;
      const id = String(song?.id || '').trim();
      if (id) songIds.add(id);
      if (song?.attributes?.isrc) withIsrc += 1;
    }
  }
  return {
    version: cache.version,
    updatedAt: cache.updatedAt || '',
    queries: Object.keys(cache.queries || {}).length,
    songs,
    uniqueSongs: songIds.size,
    withIsrc,
    file: CACHE_FILE,
  };
}

export async function createApplePlaylist(options = {}) {
  const name = String(options.name || '').trim();
  if (!name) throw new Error('Apple playlist name is required');
  const result = await runAppleMusicKitTask(createApplePlaylistTask, {
    name,
    description: String(options.description || '').trim(),
    isPublic: Boolean(options.isPublic),
  }, 60000);
  const playlist = result.playlist || {};
  return {
    id: playlist.id || '',
    name: playlist.name || name,
  };
}

export async function addAppleTracksToPlaylist(playlistId, trackIds, options = {}) {
  const id = String(playlistId || '').trim();
  if (!id) throw new Error('Apple playlist id is required');
  const ids = unique(trackIds);
  const batches = [];
  let accepted = 0;
  const batchSize = Math.min(100, Math.max(1, Number(options.batchSize || DEFAULT_BATCH_SIZE)));
  for (const chunk of chunkArray(ids, batchSize)) {
    const result = await runAppleMusicKitTask(addApplePlaylistTracksTask, {
      playlistId: id,
      ids: chunk,
    }, 60000);
    batches.push(result);
    if (isAcceptedWriteStatus(result.status)) accepted += chunk.length;
  }
  return writeResult(ids, accepted, batches);
}

export async function addAppleTracksToFavorites(trackIds, options = {}) {
  const ids = unique(trackIds);
  const batches = [];
  let accepted = 0;
  const batchSize = Math.min(100, Math.max(1, Number(options.batchSize || DEFAULT_BATCH_SIZE)));
  for (const chunk of chunkArray(ids, batchSize)) {
    const result = await runAppleMusicKitTask(addAppleFavoritesTask, { ids: chunk }, 60000);
    batches.push(result);
    if (isAcceptedWriteStatus(result.status)) accepted += chunk.length;
  }
  return writeResult(ids, accepted, batches);
}

function normalizeAppleCatalogSong(song) {
  const attrs = song.attributes || {};
  return normalizeTrack({
    id: song.id,
    title: attrs.name,
    artists: attrs.artistName,
    album: attrs.albumName,
    durationMs: attrs.durationInMillis,
    isrc: attrs.isrc,
    artworkUrl: attrs.artwork?.url,
    previewUrl: attrs.previews?.[0]?.url,
    raw: song,
  }, 'apple');
}

function playableAppleMedia(artworkUrl, previewUrl) {
  return {
    platform: 'apple',
    artworkUrl: artworkUrl || '',
    previewUrl: previewUrl || '',
    playable: Boolean(previewUrl),
    reason: previewUrl ? '' : 'Apple Music 没有为这个版本提供公开试听片段。',
    expiresAt: '',
  };
}

function writeResult(ids, accepted, batches) {
  return {
    requested: ids.length,
    submitted: ids.length,
    accepted,
    added: accepted,
    alreadyPresent: 0,
    verified: false,
    missingIds: [],
    alreadyPresentIds: [],
    missingTracks: [],
    batches,
  };
}

function isAcceptedWriteStatus(status) {
  return status === 200 || status === 201 || status === 202 || status === 204;
}

function unique(items) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function loadCatalogCache() {
  if (!catalogCachePromise) {
    catalogCachePromise = readCatalogCache();
  }
  return catalogCachePromise;
}

async function readCatalogCache() {
  await ensureDirs();
  const cache = await readJsonIfExists(CACHE_FILE);
  return {
    version: CACHE_VERSION,
    updatedAt: cache?.updatedAt || '',
    queries: sanitizeCatalogQueries(cache?.queries),
  };
}

function sanitizeCatalogQueries(value) {
  if (!value || typeof value !== 'object') return {};
  const queries = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object') continue;
    queries[key] = {
      query: String(entry.query || ''),
      key: String(entry.key || key),
      limit: Math.max(0, Number(entry.limit || 0)),
      storefront: String(entry.storefront || ''),
      source: String(entry.source || ''),
      fetchedAt: String(entry.fetchedAt || ''),
      songs: Array.isArray(entry.songs) ? entry.songs.map(compactCachedSong).filter(Boolean) : [],
    };
  }
  return queries;
}

function compactCachedSong(song) {
  if (!song || typeof song !== 'object') return null;
  const attrs = song.attributes || {};
  return {
    id: String(song.id || ''),
    type: song.type || 'songs',
    attributes: {
      name: attrs.name || '',
      artistName: attrs.artistName || '',
      albumName: attrs.albumName || '',
      durationInMillis: attrs.durationInMillis || 0,
      isrc: attrs.isrc || '',
      artwork: compactAppleArtwork(attrs.artwork),
      previews: compactApplePreviews(attrs.previews),
    },
  };
}

async function saveCatalogCache(cache) {
  cache.updatedAt = new Date().toISOString();
  saveQueue = saveQueue.then(
    () => writeJson(CACHE_FILE, cache),
    () => writeJson(CACHE_FILE, cache),
  );
  return saveQueue;
}

function catalogCacheKey(query) {
  return String(query || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isReusableCatalogEntry(entry, limit) {
  return Boolean(
    entry
    && Array.isArray(entry.songs)
    && Number(entry.limit || 0) >= limit
  );
}

async function searchAppleCatalogTask({ query, limit }) {
  const compactSong = (song) => {
    const attrs = song.attributes || {};
    return {
      id: song.id,
      type: song.type,
      attributes: {
        name: attrs.name || '',
        artistName: attrs.artistName || '',
        albumName: attrs.albumName || '',
        durationInMillis: attrs.durationInMillis || 0,
        isrc: attrs.isrc || '',
        artwork: attrs.artwork?.url ? { url: attrs.artwork.url } : null,
        previews: Array.isArray(attrs.previews)
          ? attrs.previews.filter((item) => item?.url).slice(0, 1).map((item) => ({ url: item.url }))
          : [],
      },
    };
  };
  const resolveStorefront = async (music) => {
    try {
      const response = await music.api.music('/v1/me/storefront', { platform: 'web' });
      const storefront = response?.data?.data?.[0]?.id || response?.json?.data?.[0]?.id;
      if (storefront) return storefront;
    } catch {
      // Fall through to configured storefront.
    }
    return music.storefrontId || music.storefront?.id || 'us';
  };
  const music = window.MusicKit?.getInstance?.();
  if (!music?.api?.music) return { error: 'Apple MusicKit is not ready. Open and sign in to Apple Music first.' };
  if (!music.isAuthorized) return { error: 'Apple Music is not authorized. Sign in to Apple Music first.' };

  const storefront = await resolveStorefront(music);
  const response = await music.api.music(`/v1/catalog/${storefront}/search`, {
    term: query,
    types: 'songs',
    limit: String(limit),
    l: document.documentElement.lang || 'zh-Hans-CN',
    platform: 'web',
  });
  if (response.status >= 400) {
    return { error: `Apple catalog search failed: HTTP ${response.status}` };
  }
  const songs = response?.data?.results?.songs?.data
    || response?.json?.results?.songs?.data
    || [];
  return {
    storefront,
    songs: songs.map(compactSong),
  };
}

async function createApplePlaylistTask({ name, description, isPublic }) {
  const music = window.MusicKit?.getInstance?.();
  if (!music?.api?.music) return { error: 'Apple MusicKit is not ready. Open and sign in to Apple Music first.' };
  if (!music.isAuthorized) return { error: 'Apple Music is not authorized. Sign in to Apple Music first.' };
  const body = {
    attributes: {
      name,
      description,
      isPublic,
    },
  };
  const response = await music.api.music('/v1/me/library/playlists', {
    l: document.documentElement.lang || 'zh-Hans-CN',
    platform: 'web',
  }, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status >= 400) return { error: `Apple playlist create failed: HTTP ${response.status}` };
  const item = response?.data?.data?.[0] || response?.json?.data?.[0] || {};
  return {
    status: response.status,
    playlist: {
      id: item.id || '',
      name: item.attributes?.name || name,
    },
  };
}

async function addApplePlaylistTracksTask({ playlistId, ids }) {
  const music = window.MusicKit?.getInstance?.();
  if (!music?.api?.music) return { error: 'Apple MusicKit is not ready. Open and sign in to Apple Music first.' };
  if (!music.isAuthorized) return { error: 'Apple Music is not authorized. Sign in to Apple Music first.' };
  const response = await music.api.music(`/v1/me/library/playlists/${playlistId}/tracks`, {
    l: document.documentElement.lang || 'zh-Hans-CN',
    platform: 'web',
  }, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data: ids.map((id) => ({ id, type: 'songs' })),
    }),
  });
  if (response.status >= 400) return { error: `Apple playlist add failed: HTTP ${response.status}` };
  return { status: response.status, requested: ids.length };
}

async function addAppleFavoritesTask({ ids }) {
  const music = window.MusicKit?.getInstance?.();
  if (!music?.api?.music) return { error: 'Apple MusicKit is not ready. Open and sign in to Apple Music first.' };
  if (!music.isAuthorized) return { error: 'Apple Music is not authorized. Sign in to Apple Music first.' };
  const response = await music.api.music('/v1/me/favorites', {
    'ids[songs]': ids.join(','),
    l: document.documentElement.lang || 'zh-Hans-CN',
    platform: 'web',
  }, {
    method: 'POST',
  });
  if (response.status >= 400) return { error: `Apple favorites add failed: HTTP ${response.status}` };
  return { status: response.status, requested: ids.length };
}
