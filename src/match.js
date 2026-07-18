import { durationLabel, normalizeText } from './normalize.js';
import { matchingTextVariants } from './transliterate.js';
import { compareVersionCues } from './evidence.js';

const trackValueCache = new WeakMap();

export function compareAppleToPlatform(appleTracks, platformTracks, options = {}) {
  const threshold = Number(options.threshold ?? 0.82);
  const reviewThreshold = Number(options.reviewThreshold ?? 0.68);

  const matches = [];
  const review = [];
  const missing = [];
  const preparedPlatformTracks = platformTracks.map(prepareCandidateTrack);

  for (const apple of appleTracks) {
    const preparedApple = prepareCandidateTrack(apple);
    const pool = selectCandidatePool(preparedApple, preparedPlatformTracks);
    const candidates = pool
      .map((candidate) => ({
        track: candidate.track,
        score: scoreTrack(apple, candidate.track),
      }))
      .sort((a, b) => b.score.total - a.score.total);

    const best = candidates[0] || null;
    if (best && best.score.total >= threshold && !best.score.versionCueConflict) {
      matches.push({ apple, target: best.track, score: best.score });
    } else if (best && best.score.total >= reviewThreshold) {
      review.push({ apple, target: best.track, score: best.score });
    } else {
      missing.push({ apple, best: best ? { target: best.track, score: best.score } : null });
    }
  }

  return {
    totalApple: appleTracks.length,
    totalPlatform: platformTracks.length,
    matched: matches.length,
    review: review.length,
    missing: missing.length,
    matches,
    reviewItems: review,
    missingItems: missing,
  };
}

function prepareCandidateTrack(track) {
  const titleValues = fieldValues(track, 'title');
  const artistValuesList = artistValues(track);
  return {
    track,
    titleValues,
    artistValues: artistValuesList,
    titleSet: new Set(titleValues),
    artistSet: new Set(artistValuesList),
    normalizedTitle: track.normalized?.title || '',
    normalizedArtist: track.normalized?.artist || '',
  };
}

function selectCandidatePool(apple, candidates) {
  const selected = [];
  for (const candidate of candidates) {
    const duration = durationScore(apple.track.durationMs, candidate.track.durationMs);
    const exactTitle = intersects(apple.titleSet, candidate.titleSet);
    const exactArtist = intersects(apple.artistSet, candidate.artistSet);
    const title = similarity(apple.normalizedTitle, candidate.normalizedTitle);
    const artist = similarity(apple.normalizedArtist, candidate.normalizedArtist);

    const quick = (
      (exactTitle ? 0.5 : title * 0.36)
      + (exactArtist ? 0.34 : artist * 0.24)
      + duration * 0.16
    );

    if (
      (exactTitle && (duration >= 0.15 || exactArtist || artist >= 0.25))
      || (exactArtist && duration >= 0.15 && title >= 0.18)
      || (duration >= 0.45 && (title >= 0.22 || artist >= 0.24))
      || quick >= 0.48
    ) {
      selected.push({ ...candidate, quick });
    }
  }

  if (!selected.length) return candidates;
  selected.sort((a, b) => b.quick - a.quick);
  return selected.slice(0, 1000);
}

function scoreTrack(a, b) {
  const title = bestFieldSimilarity(a, b, 'title');
  const artist = artistScore(a, b);
  const album = hasFieldValue(a, 'album') && hasFieldValue(b, 'album') ? bestFieldSimilarity(a, b, 'album') : 0.5;
  const duration = durationScore(a.durationMs, b.durationMs);
  const isrc = isrcScore(a, b);
  const titleVersionCueConflict = compareVersionCues(a, b).some((item) => item.field === 'title');
  const strongMetadataAgreement = title >= 0.95 && artist >= 0.9 && album >= 0.8 && duration >= 0.92;
  const versionCueConflict = titleVersionCueConflict && !strongMetadataAgreement;
  let total = clamp(title * 0.52 + artist * 0.28 + duration * 0.15 + album * 0.05, 0, 1);
  if (isrc !== 1 && title < 0.7 && album < 0.5) total = Math.min(total, 0.67);
  if (isrc === 1) total = Math.max(total, 0.98);
  return {
    total: round(total),
    title: round(title),
    artist: round(artist),
    album: round(album),
    duration: round(duration),
    isrc,
    versionCueConflict,
  };
}

function artistScore(a, b) {
  const aArtists = artistValues(a);
  const bArtists = artistValues(b);
  if (aArtists.length === 0 || bArtists.length === 0) return 0.4;
  let best = 0;
  for (const aa of aArtists) {
    for (const bb of bArtists) {
      best = Math.max(best, similarity(aa, bb));
    }
  }
  return best;
}

function isrcScore(a, b) {
  if (!a.isrc || !b.isrc) return 0;
  return a.isrc === b.isrc ? 1 : 0;
}

function bestFieldSimilarity(a, b, field) {
  const left = fieldValues(a, field);
  const right = fieldValues(b, field);
  if (left.length === 0 || right.length === 0) return 0;
  let best = 0;
  for (const aa of left) {
    for (const bb of right) {
      best = Math.max(best, similarity(aa, bb));
    }
  }
  return best;
}

function hasFieldValue(track, field) {
  return fieldValues(track, field).length > 0;
}

function fieldValues(track, field) {
  const cache = cachedTrackValues(track);
  if (cache[field]) return cache[field];

  const aliasKey = field === 'title' ? 'titles' : field === 'artist' ? 'artists' : 'albums';
  const displayValues = field === 'title'
    ? [track.title, ...(track.aliases?.titles || [])]
    : field === 'artist'
      ? [track.artist, ...(track.artists || []), ...(track.aliases?.artists || [])]
      : [track.album, ...(track.aliases?.albums || [])];
  cache[field] = uniqueNormalized([
    track.normalized?.[field],
    ...(track.normalized?.aliases?.[aliasKey] || []),
    ...displayValues.flatMap(matchingTextVariants),
  ]).slice(0, field === 'artist' ? 48 : 36);
  return cache[field];
}

function artistValues(track) {
  const cache = cachedTrackValues(track);
  if (cache.artistValues) return cache.artistValues;

  const displayValues = [
    track.artist,
    ...(track.artists || []),
    ...(track.aliases?.artists || []),
  ];
  cache.artistValues = uniqueNormalized([
    track.normalized?.artist,
    ...(track.artists || []).map((item) => normalizeText(item)),
    ...(track.normalized?.aliases?.artists || []),
    ...displayValues.flatMap(matchingTextVariants),
  ]).slice(0, 48);
  return cache.artistValues;
}

function durationScore(a, b) {
  if (!a || !b) return 0.55;
  const diff = Math.abs(a - b);
  if (diff <= 2000) return 1;
  if (diff <= 5000) return 0.92;
  if (diff <= 10000) return 0.75;
  if (diff <= 20000) return 0.45;
  return 0.15;
}

function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return clamp(0.75 + (shorter / longer) * 0.2, 0, 0.95);
  }
  return diceCoefficient(a, b);
}

function diceCoefficient(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return a === b ? 1 : 0;
  const counts = new Map();
  for (const gram of left) counts.set(gram, (counts.get(gram) || 0) + 1);
  let hits = 0;
  for (const gram of right) {
    const count = counts.get(gram) || 0;
    if (count > 0) {
      hits += 1;
      counts.set(gram, count - 1);
    }
  }
  return (2 * hits) / (left.length + right.length);
}

function bigrams(text) {
  const value = String(text).replace(/\s+/g, '');
  if (value.length <= 1) return value ? [value] : [];
  const result = [];
  for (let i = 0; i < value.length - 1; i += 1) result.push(value.slice(i, i + 2));
  return result;
}

function uniqueNormalized(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function cachedTrackValues(track) {
  let cache = trackValueCache.get(track);
  if (!cache) {
    cache = {};
    trackValueCache.set(track, cache);
  }
  return cache;
}

function intersects(left, right) {
  if (!left?.size || !right?.size) return false;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) {
    if (large.has(value)) return true;
  }
  return false;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export function compactTrack(track) {
  return {
    id: track.id,
    mid: track.mid,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: durationLabel(track.durationMs),
    isrc: track.isrc || null,
    aliases: compactAliases(track.aliases),
  };
}

function compactAliases(aliases) {
  const result = {};
  for (const key of ['titles', 'artists', 'albums']) {
    const values = aliases?.[key] || [];
    if (values.length) result[key] = values.slice(0, 8);
  }
  return Object.keys(result).length ? result : null;
}
