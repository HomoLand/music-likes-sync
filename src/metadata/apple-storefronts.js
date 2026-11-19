import path from 'node:path';

import { compareVersionCues } from '../evidence.js';
import { normalizeAliasObject, normalizeText, normalizeTrack } from '../normalize.js';
import { fetchAppleEquivalentSongs } from '../providers/apple.js';
import {
  DATA_DIR,
  ensureDirs,
  readJsonIfExists,
  writeJson,
} from '../utils.js';

const CACHE_FILE = path.join(DATA_DIR, 'apple-storefront-cache.json');
const DEFAULT_STOREFRONTS = ['cn', 'hk', 'tw', 'jp', 'kr'];
const BATCH_SIZE = 300;

export async function enrichAppleSnapshotWithStorefrontAliases(snapshot, options = {}) {
  await ensureDirs();
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  const storefronts = normalizeStorefronts(options.storefronts);
  const cache = await loadCache(options.cacheFile || CACHE_FILE);
  const refresh = options.refresh === true;
  const lookup = options.fetchEquivalentSongs || fetchAppleEquivalentSongs;
  const ids = unique(tracks.map((track) => String(track?.id || track?.catalogId || '').trim()));
  const stats = {
    total: tracks.length,
    storefronts,
    cacheHits: 0,
    fetched: 0,
    requests: 0,
    errors: 0,
    aliasTracks: 0,
    rejectedAliases: 0,
  };

  for (const storefront of storefronts) {
    const pending = ids.filter((id) => refresh || !cache.items[id]?.storefronts?.[storefront]);
    stats.cacheHits += ids.length - pending.length;
    for (const batch of chunks(pending, BATCH_SIZE)) {
      try {
        const result = await lookup(batch, {
          storefront,
          token: options.token,
          fetchImpl: options.fetchImpl,
        });
        stats.requests += 1;
        const fetchedAt = new Date().toISOString();
        for (const id of batch) {
          const entry = cache.items[id] || { storefronts: {} };
          entry.storefronts = entry.storefronts || {};
          entry.storefronts[storefront] = {
            fetchedAt,
            songs: compactSongs(result.get(id) || []),
          };
          cache.items[id] = entry;
          stats.fetched += 1;
        }
      } catch (error) {
        stats.errors += 1;
        if (typeof options.onError === 'function') {
          await options.onError({ storefront, ids: batch, error });
        }
      }
    }
  }

  if (stats.fetched) {
    cache.updatedAt = new Date().toISOString();
    await saveCache(options.cacheFile || CACHE_FILE, cache);
  }

  const enrichedTracks = tracks.map((track) => {
    const id = String(track?.id || track?.catalogId || '').trim();
    const entries = Object.entries(cache.items[id]?.storefronts || {})
      .filter(([storefront]) => storefronts.includes(storefront));
    const equivalents = entries.flatMap(([storefront, entry]) => (
      (entry.songs || []).map((song) => compactEquivalent(track, song, storefront))
    ));
    const aliasSongs = equivalents.filter((song) => song.aliasTrusted);
    stats.rejectedAliases += equivalents.length - aliasSongs.length;
    const aliases = mergeAliases(removeStorefrontAliases(track.aliases, equivalents), {
      titles: aliasSongs.map((song) => song.title),
      artists: equivalents.map((song) => song.artist),
      albums: aliasSongs.map((song) => song.album),
    });
    if (aliases.titles.length || aliases.artists.length || aliases.albums.length) {
      stats.aliasTracks += 1;
    }
    return normalizeTrack({
      ...track,
      aliases,
      metadata: {
        ...(track.metadata || {}),
        appleStorefronts: {
          sourceStorefront: sourceStorefront(snapshot),
          storefronts: entries.filter(([, entry]) => entry.songs?.length).map(([storefront]) => storefront),
          fetchedAt: latest(entries.map(([, entry]) => entry.fetchedAt)),
          equivalentCount: equivalents.length,
          isrcs: unique(equivalents.map((song) => song.isrc)),
          equivalents: uniqueEquivalents(equivalents).slice(0, 24),
        },
      },
    }, 'apple');
  });

  return {
    snapshot: {
      ...snapshot,
      storefrontEnrichedAt: new Date().toISOString(),
      tracks: enrichedTracks,
    },
    stats,
    cacheFile: options.cacheFile || CACHE_FILE,
  };
}

function removeStorefrontAliases(aliases, equivalents) {
  const current = normalizeAliasObject(aliases);
  const remove = {
    titles: new Set(equivalents.map((song) => normalizeText(song.title)).filter(Boolean)),
    artists: new Set(equivalents.map((song) => normalizeText(song.artist)).filter(Boolean)),
    albums: new Set(equivalents.map((song) => normalizeText(song.album)).filter(Boolean)),
  };
  return normalizeAliasObject({
    titles: current.titles.filter((value) => !remove.titles.has(normalizeText(value))),
    artists: current.artists.filter((value) => !remove.artists.has(normalizeText(value))),
    albums: current.albums.filter((value) => !remove.albums.has(normalizeText(value))),
  });
}

function compactEquivalent(sourceTrack, song, storefront) {
  const sourceIsrc = String(sourceTrack?.isrc || '').trim().toUpperCase();
  const equivalentIsrc = String(song?.isrc || '').trim().toUpperCase();
  const isrcMatch = Boolean(sourceIsrc && equivalentIsrc && sourceIsrc === equivalentIsrc);
  const durationDeltaMs = durationDelta(sourceTrack?.durationMs, song?.durationMs);
  const versionCompatible = compareVersionCues(sourceTrack, song).length === 0;
  return {
    storefront,
    id: String(song?.id || ''),
    title: String(song?.title || ''),
    artist: String(song?.artist || ''),
    album: String(song?.album || ''),
    durationMs: finiteNumber(song?.durationMs),
    isrc: equivalentIsrc,
    trackNumber: finiteNumber(song?.trackNumber),
    discNumber: finiteNumber(song?.discNumber),
    releaseDate: String(song?.releaseDate || ''),
    isrcMatch,
    aliasTrusted: isrcMatch || (
      durationDeltaMs !== null
      && durationDeltaMs <= 2000
      && versionCompatible
    ),
  };
}

function uniqueEquivalents(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = [value.storefront, value.id, value.isrc, value.title, value.artist, value.album].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function durationDelta(left, right) {
  const a = Number(left || 0);
  const b = Number(right || 0);
  return a > 0 && b > 0 ? Math.abs(a - b) : null;
}

function sourceStorefront(snapshot = {}) {
  const explicit = String(snapshot.storefront || snapshot.sourceStorefront || '').trim().toLowerCase();
  if (explicit) return explicit;
  const match = String(snapshot.source || '').match(/music\.apple\.com\/([a-z]{2})(?:\/|$)/i);
  const configured = String(process.env.APPLE_STOREFRONT || '').trim().toLowerCase();
  return match?.[1]?.toLowerCase() || (/^[a-z]{2}$/.test(configured) ? configured : 'us');
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

function compactSongs(songs = []) {
  return songs.slice(0, 8).map((song) => ({
    id: String(song?.id || ''),
    title: String(song?.title || ''),
    artist: String(song?.artist || ''),
    album: String(song?.album || ''),
    durationMs: finiteNumber(song?.durationMs),
    isrc: String(song?.isrc || ''),
    trackNumber: finiteNumber(song?.trackNumber),
    discNumber: finiteNumber(song?.discNumber),
    releaseDate: String(song?.releaseDate || ''),
  }));
}

async function loadCache(file) {
  const cache = await readJsonIfExists(file);
  return {
    version: 1,
    updatedAt: cache?.updatedAt || '',
    items: cache?.items && typeof cache.items === 'object' ? cache.items : {},
  };
}

async function saveCache(file, cache) {
  await writeJson(file, cache);
}

function normalizeStorefronts(value) {
  const configured = value === undefined
    ? String(process.env.APPLE_EQUIVALENT_STOREFRONTS || DEFAULT_STOREFRONTS.join(',')).split(',')
    : Array.isArray(value) ? value : String(value || '').split(',');
  return unique(configured.map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => /^[a-z]{2}$/.test(item)));
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function finiteNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function latest(values) {
  return values.filter(Boolean).sort().at(-1) || '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
