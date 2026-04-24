import path from 'node:path';
import {
  DATA_DIR,
  ensureDirs,
  readJsonIfExists,
  writeJson,
} from '../utils.js';
import {
  cleanDisplay,
  normalizeAliasObject,
  normalizeIsrc,
  normalizeTrack,
} from '../normalize.js';

const CACHE_FILE = path.join(DATA_DIR, 'metadata-cache.json');
const API_ROOT = 'https://musicbrainz.org/ws/2';
const USER_AGENT = process.env.MUSICBRAINZ_USER_AGENT
  || 'music-likes-sync/0.1 (local personal metadata matching)';
const MIN_INTERVAL_MS = 1100;

let lastRequestAt = 0;

export async function enrichAppleSnapshotWithMusicBrainz(snapshot, options = {}) {
  await ensureDirs();
  const cache = await loadCache();
  const refresh = Boolean(options.refresh);
  const limit = normalizeLimit(options.limit);
  const stats = {
    total: snapshot?.tracks?.length || 0,
    withIsrc: 0,
    cacheHits: 0,
    fetched: 0,
    skippedByLimit: 0,
    notFound: 0,
    errors: 0,
    aliasTracks: 0,
  };

  const tracks = [];
  for (const original of snapshot?.tracks || []) {
    const isrc = normalizeIsrc(original.isrc || original.raw?.isrc || original.raw?.raw?.isrc || original.raw?.raw?.catalogIsrc);
    if (!isrc) {
      tracks.push(normalizeTrack(original, 'apple'));
      continue;
    }

    stats.withIsrc += 1;
    let entry = cache.musicbrainz.isrc[isrc];
    if (!entry || refresh) {
      if (stats.fetched >= limit) {
        stats.skippedByLimit += 1;
        tracks.push(normalizeTrack({ ...original, isrc }, 'apple'));
        continue;
      }
      try {
        entry = await lookupIsrc(isrc);
        cache.musicbrainz.isrc[isrc] = entry;
        stats.fetched += 1;
        await saveCache(cache);
      } catch (error) {
        entry = {
          fetchedAt: new Date().toISOString(),
          status: 'error',
          error: error?.message || String(error),
          recordings: [],
        };
        cache.musicbrainz.isrc[isrc] = entry;
        stats.fetched += 1;
        stats.errors += 1;
        await saveCache(cache);
      }
    } else {
      stats.cacheHits += 1;
    }

    if (entry.status === 'not-found') stats.notFound += 1;
    const aliases = mergeAliases(original.aliases, aliasesFromEntry(entry));
    if (hasAliases(aliases)) stats.aliasTracks += 1;
    tracks.push(normalizeTrack({
      ...original,
      isrc,
      aliases,
      metadata: {
        ...(original.metadata || {}),
        musicbrainz: compactMusicBrainzMetadata(isrc, entry),
      },
    }, 'apple'));
  }

  return {
    snapshot: {
      ...snapshot,
      fetchedAt: snapshot?.fetchedAt || new Date().toISOString(),
      metadataEnrichedAt: new Date().toISOString(),
      tracks,
    },
    stats,
    cacheFile: CACHE_FILE,
  };
}

async function lookupIsrc(isrc) {
  await throttle();
  const url = `${API_ROOT}/isrc/${encodeURIComponent(isrc)}?fmt=json&inc=artist-credits+aliases+releases+isrcs+work-rels`;
  let response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (response.status === 429 || response.status === 503) {
    await sleep(retryDelayMs(response.headers.get('retry-after')));
    response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  }
  if (response.status === 404) {
    return {
      fetchedAt: new Date().toISOString(),
      status: 'not-found',
      recordings: [],
    };
  }
  if (!response.ok) {
    throw new Error(`MusicBrainz HTTP ${response.status}`);
  }

  const payload = await response.json();
  return {
    fetchedAt: new Date().toISOString(),
    status: 'ok',
    recordings: (payload.recordings || []).map(compactRecording),
  };
}

function compactRecording(recording) {
  return {
    id: recording.id || '',
    title: recording.title || '',
    length: recording.length || null,
    isrcs: recording.isrcs || [],
    aliases: (recording.aliases || []).map(compactAlias),
    artists: (recording['artist-credit'] || []).map((credit) => ({
      name: cleanDisplay(credit.name || credit.artist?.name || ''),
      artistName: cleanDisplay(credit.artist?.name || ''),
      sortName: cleanDisplay(credit.artist?.['sort-name'] || ''),
      aliases: (credit.artist?.aliases || []).map(compactAlias),
    })),
    releases: (recording.releases || []).slice(0, 10).map((release) => ({
      title: release.title || '',
    })),
    works: (recording.relations || [])
      .filter((relation) => relation.work)
      .map((relation) => ({
        title: relation.work.title || '',
        aliases: (relation.work.aliases || []).map(compactAlias),
      })),
  };
}

function compactAlias(alias) {
  return {
    name: alias.name || '',
    locale: alias.locale || '',
    primary: Boolean(alias.primary),
    sortName: alias['sort-name'] || '',
  };
}

function aliasesFromEntry(entry) {
  const titles = [];
  const artists = [];
  const albums = [];

  for (const recording of entry?.recordings || []) {
    titles.push(recording.title);
    titles.push(...(recording.aliases || []).flatMap(aliasValues));
    albums.push(...(recording.releases || []).map((release) => release.title));
    for (const artist of recording.artists || []) {
      artists.push(artist.name, artist.artistName, artist.sortName);
      artists.push(...(artist.aliases || []).flatMap(aliasValues));
    }
    for (const work of recording.works || []) {
      titles.push(work.title);
      titles.push(...(work.aliases || []).flatMap(aliasValues));
    }
  }

  return normalizeAliasObject({ titles, artists, albums });
}

function aliasValues(alias) {
  return [alias?.name, alias?.sortName].filter(Boolean);
}

function mergeAliases(left, right) {
  const a = normalizeAliasObject(left);
  const b = normalizeAliasObject(right);
  return normalizeAliasObject({
    titles: [...a.titles, ...b.titles],
    artists: [...a.artists, ...b.artists],
    albums: [...a.albums, ...b.albums],
  });
}

function hasAliases(aliases) {
  return Boolean(aliases?.titles?.length || aliases?.artists?.length || aliases?.albums?.length);
}

function compactMusicBrainzMetadata(isrc, entry) {
  return {
    isrc,
    fetchedAt: entry?.fetchedAt || null,
    status: entry?.status || 'missing',
    recordingIds: (entry?.recordings || []).map((recording) => recording.id).filter(Boolean),
  };
}

async function loadCache() {
  const cache = await readJsonIfExists(CACHE_FILE);
  return {
    version: 1,
    updatedAt: cache?.updatedAt || null,
    musicbrainz: {
      isrc: cache?.musicbrainz?.isrc || {},
    },
  };
}

async function saveCache(cache) {
  await writeJson(CACHE_FILE, {
    ...cache,
    updatedAt: new Date().toISOString(),
  });
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return Number.POSITIVE_INFINITY;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : Number.POSITIVE_INFINITY;
}

async function throttle() {
  const now = Date.now();
  const waitMs = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - now);
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
}

function retryDelayMs(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30000);
  return 3000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
