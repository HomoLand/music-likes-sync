import { durationLabel, normalizeText } from './normalize.js';
import { foldCjk, matchingTextVariants } from './transliterate.js';
import { compareVersionCues, versionCueSet } from './evidence.js';

const trackValueCache = new WeakMap();

export function rankTrackCandidates(sourceTrack, candidateTracks = []) {
  const preparedSource = prepareCandidateTrack(sourceTrack);
  const preparedCandidates = candidateTracks.map(prepareCandidateTrack);
  return rankPreparedTrackCandidates(preparedSource, preparedCandidates);
}

export function classifyTrackCandidates(sourceTrack, candidateTracks = [], options = {}) {
  return classifyPreparedTrackCandidates(
    prepareCandidateTrack(sourceTrack),
    candidateTracks.map(prepareCandidateTrack),
    options,
  );
}

export function compareAppleToPlatform(appleTracks, platformTracks, options = {}) {
  const matches = [];
  const review = [];
  const missing = [];
  const preparedPlatformTracks = platformTracks.map(prepareCandidateTrack);

  for (const apple of appleTracks) {
    const preparedApple = prepareCandidateTrack(apple);
    const decision = classifyPreparedTrackCandidates(preparedApple, preparedPlatformTracks, options);
    const best = decision.best;
    const result = best ? {
      apple,
      target: best.track,
      score: best.score,
      scoreMargin: decision.scoreMargin,
      candidateCount: decision.candidateCount,
      ambiguityReason: decision.ambiguityReason,
      runnerUp: decision.runnerUp ? {
        target: decision.runnerUp.track,
        score: decision.runnerUp.score,
      } : null,
    } : null;
    if (decision.status === 'match') {
      matches.push(result);
    } else if (decision.status === 'review') {
      review.push(result);
    } else {
      missing.push({
        apple,
        best: result ? {
          target: result.target,
          score: result.score,
          scoreMargin: result.scoreMargin,
          candidateCount: result.candidateCount,
          runnerUp: result.runnerUp,
        } : null,
      });
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

function classifyPreparedTrackCandidates(source, preparedCandidates, options = {}) {
  const threshold = Number(options.threshold ?? 0.82);
  const reviewThreshold = Number(options.reviewThreshold ?? 0.68);
  const rankedCandidates = rankPreparedTrackCandidates(source, preparedCandidates);
  const best = rankedCandidates[0] || null;
  const runnerUp = rankedCandidates[1] || null;
  const scoreMargin = best && runnerUp ? round(best.score.total - runnerUp.score.total) : null;
  const fingerprintCandidates = rankedCandidates.filter((candidate) => candidate.score.recordingFingerprint);
  const ambiguousFingerprint = Boolean(
    options.allowAmbiguousFingerprint !== true
    && best?.score.recordingFingerprint
    && fingerprintCandidates.length > 1
  );
  const closeCompetitor = hasCloseCompetingCandidate(
    source.track,
    best,
    runnerUp,
    reviewThreshold,
    options,
  );
  const ambiguityReason = ambiguousFingerprint
    ? 'multiple_metadata_identity_candidates'
    : closeCompetitor ? 'close_competing_candidates' : '';
  const hasIdentityEvidence = Boolean(
    best
    && (
      best.score.isrc === 1
      || best.score.recordingFingerprint
      || best.score.appleEquivalentFingerprint
      || best.score.catalogTrackFingerprint
      || (
        best.score.title >= 0.8
        && best.score.artist >= 0.8
        && best.score.duration >= 0.75
      )
    )
  );
  const decisionReason = ambiguityReason || (
    best?.score.total >= threshold && !hasIdentityEvidence
      ? 'insufficient_identity_evidence'
      : ''
  );
  const safeMatch = Boolean(
    best
    && best.score.total >= threshold
    && !best.score.versionCueConflict
    && !best.score.isrcConflict
    && !decisionReason
  );

  return {
    status: safeMatch ? 'match' : best && best.score.total >= reviewThreshold ? 'review' : 'missing',
    best,
    runnerUp,
    scoreMargin,
    candidateCount: rankedCandidates.length,
    ambiguityReason: decisionReason,
    rankedCandidates,
  };
}

function rankPreparedTrackCandidates(source, preparedCandidates) {
  const pool = selectCandidatePool(source, preparedCandidates);
  return pool
    .map((candidate) => ({
      track: candidate.track,
      score: scoreTrack(source.track, candidate.track),
      providerRank: candidate.providerRank,
    }))
    .sort((left, right) => compareCandidateScores(left, right));
}

function compareCandidateScores(left, right) {
  return (
    right.score.isrc - left.score.isrc
    || Number(right.score.catalogTrackFingerprint) - Number(left.score.catalogTrackFingerprint)
    || Number(right.score.appleEquivalentFingerprint) - Number(left.score.appleEquivalentFingerprint)
    || Number(right.score.recordingFingerprint) - Number(left.score.recordingFingerprint)
    || right.score.total - left.score.total
    || left.providerRank - right.providerRank
  );
}

function hasCloseCompetingCandidate(source, best, runnerUp, reviewThreshold, options) {
  const minimumMargin = Number(options.minimumScoreMargin || 0);
  if (!best || !runnerUp || !Number.isFinite(minimumMargin) || minimumMargin <= 0) return false;
  if (best.score.isrc === 1 || best.score.appleEquivalentFingerprint || best.score.catalogTrackFingerprint) return false;
  if (runnerUp.score.total < reviewThreshold) return false;
  if (runnerUp.score.versionCueConflict || runnerUp.score.isrcConflict) return false;
  if (best.score.total - runnerUp.score.total >= minimumMargin) return false;
  return !interchangeableRecordingCandidates(source, best, runnerUp);
}

function interchangeableRecordingCandidates(source, left, right) {
  if (!left.score.recordingFingerprint || !right.score.recordingFingerprint) return false;
  if (left.score.versionCueConflict || right.score.versionCueConflict) return false;
  if (left.score.isrcConflict || right.score.isrcConflict) return false;
  return scoreTrack(left.track, right.track).recordingFingerprint
    || (
      bestFieldSimilarity(source, left.track, 'title') >= 0.95
      && bestFieldSimilarity(source, right.track, 'title') >= 0.95
      && artistScore(source, left.track) >= 0.95
      && artistScore(source, right.track) >= 0.95
      && durationScore(left.track.durationMs, right.track.durationMs) >= 0.92
    );
}

function prepareCandidateTrack(track, providerRank = 0) {
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
    providerRank,
  };
}

function selectCandidatePool(apple, candidates) {
  const selected = [];
  for (const candidate of candidates) {
    const duration = durationScore(apple.track.durationMs, candidate.track.durationMs);
    const exactTitle = intersects(apple.titleSet, candidate.titleSet);
    const exactArtist = intersects(apple.artistSet, candidate.artistSet);
    const baseTitle = similarity(apple.normalizedTitle, candidate.normalizedTitle);
    const baseArtist = similarity(apple.normalizedArtist, candidate.normalizedArtist);
    const title = exactTitle ? 1 : (
      duration >= 0.75 || exactArtist || baseTitle >= 0.3
        ? quickFieldSimilarity(apple.titleValues, candidate.titleValues, baseTitle)
        : baseTitle
    );
    const artist = exactArtist ? 1 : (
      duration >= 0.75 || exactTitle || baseArtist >= 0.3
        ? quickFieldSimilarity(apple.artistValues, candidate.artistValues, baseArtist)
        : baseArtist
    );

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

function quickFieldSimilarity(leftValues, rightValues, fallback) {
  let best = fallback;
  for (const left of leftValues.slice(0, 8)) {
    for (const right of rightValues.slice(0, 8)) {
      if (left === right) return 1;
      if (!left.includes(right) && !right.includes(left)) continue;
      const shorter = Math.min(left.length, right.length);
      const longer = Math.max(left.length, right.length);
      best = Math.max(best, clamp(0.75 + (shorter / longer) * 0.2, 0, 0.95));
      if (best >= 0.95) return best;
    }
  }
  return best;
}

function scoreTrack(a, b) {
  const title = bestFieldSimilarity(a, b, 'title');
  const artist = artistScore(a, b);
  const album = hasFieldValue(a, 'album') && hasFieldValue(b, 'album') ? bestFieldSimilarity(a, b, 'album') : 0.5;
  const duration = durationScore(a.durationMs, b.durationMs);
  const isrc = isrcScore(a, b);
  const rawVersionCueConflicts = compareVersionCues(a, b);
  const appleEquivalentFingerprint = officialAppleEquivalentFingerprint(a, b, {
    album,
    artist,
    duration,
    title,
  }, rawVersionCueConflicts);
  const catalogTrackFingerprint = officialCatalogTrackFingerprint(a, b, {
    album,
    artist,
    duration,
    title,
  }) || officialCatalogTrackFingerprint(b, a, {
    album,
    artist,
    duration,
    title,
  });
  const authoritativeFingerprint = appleEquivalentFingerprint || catalogTrackFingerprint;
  const versionCueConflicts = authoritativeFingerprint ? [] : rawVersionCueConflicts;
  const versionCueConflict = versionCueConflicts.length > 0;
  const differentIsrc = Boolean(a.isrc && b.isrc && a.isrc !== b.isrc);
  const durationDeltaMs = durationDifferenceMs(a.durationMs, b.durationMs);
  const recordingFingerprint = authoritativeFingerprint || (
    title === 1
    && artist >= 0.8
    && album === 1
    && duration === 1
    && versionCueConflicts.length === 0
    && !differentIsrc
  );
  let total = clamp(title * 0.52 + artist * 0.28 + duration * 0.15 + album * 0.05, 0, 1);
  if (isrc !== 1 && title < 0.7 && album < 0.5) total = Math.min(total, 0.67);
  if (isrc !== 1 && duration === 0.15 && !authoritativeFingerprint) total = Math.min(total, 0.67);
  if (
    isrc !== 1
    && durationDeltaMs !== null
    && durationDeltaMs > 5000
    && !authoritativeFingerprint
  ) total = Math.min(total, 0.81);
  if (isrc === 1) total = Math.max(total, 0.98);
  if (recordingFingerprint) total = Math.max(total, 0.9);
  return {
    total: round(total),
    title: round(title),
    artist: round(artist),
    album: round(album),
    duration: round(duration),
    isrc,
    isrcConflict: differentIsrc,
    recordingFingerprint,
    ...(appleEquivalentFingerprint ? { appleEquivalentFingerprint: true } : {}),
    ...(catalogTrackFingerprint ? { catalogTrackFingerprint: true } : {}),
    versionCueConflict,
  };
}

function officialAppleEquivalentFingerprint(left, right, scores, versionCueConflicts) {
  return equivalentFingerprintFor(left, right, scores, versionCueConflicts)
    || equivalentFingerprintFor(right, left, scores, invertVersionConflicts(versionCueConflicts));
}

function equivalentFingerprintFor(appleTrack, targetTrack, scores, versionCueConflicts) {
  const equivalents = appleTrack?.metadata?.appleStorefronts?.equivalents;
  if (!Array.isArray(equivalents) || !equivalents.length) return false;
  if (scores.artist < 0.8 || scores.duration !== 1) return false;
  if (appleTrack.isrc && targetTrack.isrc && appleTrack.isrc !== targetTrack.isrc) return false;

  const targetTitles = [targetTrack.title, ...(targetTrack.aliases?.titles || [])];
  const sourceTitles = [appleTrack.title, ...(appleTrack.aliases?.titles || [])];
  for (const equivalent of equivalents) {
    const sameIsrc = equivalent.isrcMatch === true
      || Boolean(appleTrack.isrc && equivalent.isrc && appleTrack.isrc === equivalent.isrc);
    if (!sameIsrc) continue;
    if (durationScore(equivalent.durationMs, targetTrack.durationMs) !== 1) continue;
    const equivalentTitles = [equivalent.title, ...sourceTitles];
    if (scores.album >= 0.85 && identityOverlap([equivalent.title], targetTitles)) return true;
    if (
      identityOverlap(sourceTitles, targetTitles)
      && (!versionCueConflicts.length
        || safeOfficialVersionOmission(appleTrack, targetTrack, scores, versionCueConflicts))
    ) return true;
    if (
      scores.album >= 0.85
      && safeOfficialVersionOmission(appleTrack, targetTrack, scores, versionCueConflicts)
      && canonicalTitleOverlap(equivalentTitles, targetTitles)
    ) return true;
  }
  return false;
}

function officialCatalogTrackFingerprint(appleTrack, targetTrack, scores) {
  const equivalents = appleTrack?.metadata?.appleStorefronts?.equivalents;
  const targetCatalog = targetTrack?.metadata?.providerCatalog;
  const targetTrackNumber = positiveInteger(targetCatalog?.trackNumber);
  if (!Array.isArray(equivalents) || !targetTrackNumber) return false;
  if (scores.duration < 0.92) return false;
  if (appleTrack.isrc && targetTrack.isrc && appleTrack.isrc !== targetTrack.isrc) return false;

  const targetDiscNumber = positiveInteger(targetCatalog?.discNumber);
  const targetTitles = [targetTrack.title, ...(targetTrack.aliases?.titles || [])];
  return equivalents.some((equivalent) => {
    const sameIsrc = equivalent.isrcMatch === true
      || Boolean(appleTrack.isrc && equivalent.isrc && appleTrack.isrc === equivalent.isrc);
    const equivalentTrackNumber = positiveInteger(equivalent.trackNumber);
    const equivalentDiscNumber = positiveInteger(equivalent.discNumber);
    if (!sameIsrc || !equivalentTrackNumber || equivalentTrackNumber !== targetTrackNumber) return false;
    if (targetDiscNumber && equivalentDiscNumber && targetDiscNumber !== equivalentDiscNumber) return false;
    const sameRelease = releaseDateCompatible(equivalent.releaseDate, targetCatalog.releaseDate);
    const titleRelated = canonicalTitleOverlap([equivalent.title, appleTrack.title], targetTitles);
    if (scores.artist < 0.7 && !sameRelease) return false;
    if (titleRelated && scores.album >= 0.85) return true;
    if (!sameRelease || scores.artist < 0.9) return false;
    return scores.album >= 0.85 || scores.title >= 0.45;
  });
}

function releaseDateCompatible(left, right) {
  const a = Date.parse(String(left || ''));
  const b = Date.parse(String(right || ''));
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 2 * 24 * 60 * 60 * 1000;
}

function safeOfficialVersionOmission(sourceTrack, targetTrack, scores, conflicts = []) {
  if (!conflicts.length) return true;
  if (scores.artist < 0.9 || scores.album < 0.95 || scores.duration !== 1 || scores.title < 0.8) return false;
  if (conflicts.some((conflict) => conflict.source !== true || conflict.target !== false)) return false;
  const cues = new Set(conflicts.map((conflict) => conflict.cue));
  if ([...cues].every((cue) => ['version', 'single-version', 'album-version'].includes(cue))) return true;
  return cues.size === 1
    && cues.has('live')
    && versionCueSetFromAlbum(sourceTrack.album).has('live')
    && canonicalAlbumOverlap(sourceTrack, targetTrack);
}

function versionCueSetFromAlbum(value) {
  return versionCueSet(value);
}

function canonicalAlbumOverlap(left, right) {
  return canonicalTitleOverlap(
    [left.album, ...(left.aliases?.albums || [])],
    [right.album, ...(right.aliases?.albums || [])],
  );
}

function canonicalTitleOverlap(left, right) {
  const leftValues = uniqueNormalized(left.flatMap(canonicalIdentityVariants));
  const rightValues = uniqueNormalized(right.flatMap(canonicalIdentityVariants));
  return leftValues.some((a) => rightValues.some((b) => canonicalIdentityRelated(a, b)));
}

function canonicalIdentityRelated(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 2
    && shorter.length / longer.length >= 0.45
    && longer.startsWith(shorter);
}

function canonicalIdentityVariants(value) {
  const raw = String(value || '').normalize('NFKC').toLowerCase();
  const simplified = raw
    .replace(/\boriginally\s+performed\s+by\b.*$/i, ' ')
    .replace(/[\[(（【][^\])）】]{1,80}[\])）】]/g, ' ')
    .replace(/\b(?:version|ver\.?|live|remaster(?:ed)?|remix(?:ed)?|instrumental|off vocal|acoustic|self cover)\b.*$/i, ' ');
  return uniqueNormalized([raw, simplified, foldCjk(raw), foldCjk(simplified)].map((item) => (
    item.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '')
  )));
}

function invertVersionConflicts(conflicts = []) {
  return conflicts.map((conflict) => ({
    ...conflict,
    source: conflict.target,
    target: conflict.source,
  }));
}

function positiveInteger(value) {
  const number = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function identityOverlap(left, right) {
  const leftValues = new Set(left.flatMap(identityVariants));
  return right.flatMap(identityVariants).some((value) => leftValues.has(value));
}

function identityVariants(value) {
  const raw = String(value || '').normalize('NFKC').toLowerCase();
  return uniqueNormalized([raw, foldCjk(raw)].map((item) => (
    item.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '')
  )));
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

function durationDifferenceMs(a, b) {
  const left = Number(a || 0);
  const right = Number(b || 0);
  return left > 0 && right > 0 ? Math.abs(left - right) : null;
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
