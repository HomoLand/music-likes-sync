import { durationLabel, normalizeText } from './normalize.js';
import { matchingTextVariants } from './transliterate.js';

const ALIAS_LIMIT = 8;
const RECORDING_ID_LIMIT = 8;

export function compactTrackForAi(platform, track = {}) {
  const effectivePlatform = platform || track.platform || '';
  return {
    platform: effectivePlatform,
    id: track.id || null,
    mid: track.mid || null,
    title: track.title || '',
    artist: track.artist || '',
    artists: Array.isArray(track.artists) ? track.artists.slice(0, 8) : [],
    album: track.album || '',
    duration: track.duration || durationLabel(track.durationMs),
    duration_ms: track.durationMs || null,
    isrc: track.isrc || null,
    aliases: compactAliases(track.aliases),
    external_evidence: compactExternalEvidence(track),
  };
}

export function buildMatchEvidence(sourceTrack = {}, targetTrack = {}, score = null) {
  const sourceMusicBrainz = compactMusicBrainzEvidence(sourceTrack);
  const targetMusicBrainz = compactMusicBrainzEvidence(targetTrack);
  const durationDeltaMilliseconds = durationDeltaMs(sourceTrack.durationMs, targetTrack.durationMs);
  const durationDeltaSeconds = durationDeltaMilliseconds === null
    ? null
    : Math.round(durationDeltaMilliseconds / 1000);
  const isrc = compareIsrc(sourceTrack.isrc, targetTrack.isrc);
  const sharedRecordingIds = intersect(
    sourceMusicBrainz?.recording_ids || [],
    targetMusicBrainz?.recording_ids || [],
  );
  const aliasOverlap = {
    titles: overlapField(sourceTrack, targetTrack, 'titles'),
    artists: overlapField(sourceTrack, targetTrack, 'artists'),
    albums: overlapField(sourceTrack, targetTrack, 'albums'),
  };
  const authoritativeVersionEvidence = score?.appleEquivalentFingerprint === true
    || score?.catalogTrackFingerprint === true;
  const versionCueConflicts = authoritativeVersionEvidence ? [] : compareVersionCues(sourceTrack, targetTrack);
  const recordingFingerprint = score?.recordingFingerprint === true || (
    aliasOverlap.titles.length > 0
    && aliasOverlap.albums.length > 0
    && durationDeltaMilliseconds !== null
    && durationDeltaMilliseconds <= 2000
    && isrc.relation !== 'different'
    && versionCueConflicts.length === 0
  );
  const appleEquivalentFingerprint = score?.appleEquivalentFingerprint === true;
  const catalogTrackFingerprint = score?.catalogTrackFingerprint === true;

  return {
    algorithm_score: score || null,
    duration_delta_ms: durationDeltaMilliseconds,
    duration_delta_seconds: durationDeltaSeconds,
    recording_fingerprint: recordingFingerprint,
    isrc,
    musicbrainz: {
      source: sourceMusicBrainz,
      target: targetMusicBrainz,
      shared_recording_ids: sharedRecordingIds,
    },
    alias_overlap: aliasOverlap,
    version_cue_conflicts: versionCueConflicts,
    support_signals: supportSignals({
      durationDeltaSeconds,
      isrc,
      sharedRecordingIds,
      aliasOverlap,
      recordingFingerprint,
      appleEquivalentFingerprint,
      catalogTrackFingerprint,
    }),
    risk_signals: riskSignals({
      durationDeltaSeconds,
      isrc,
      versionCueConflicts,
    }),
  };
}

export function compactExternalEvidence(track = {}) {
  const musicbrainz = compactMusicBrainzEvidence(track);
  const appleStorefronts = compactAppleStorefrontEvidence(track);
  const providerCatalog = compactProviderCatalogEvidence(track);
  if (!musicbrainz && !appleStorefronts && !providerCatalog) return null;
  return {
    ...(musicbrainz ? { musicbrainz } : {}),
    ...(appleStorefronts ? { apple_storefronts: appleStorefronts } : {}),
    ...(providerCatalog ? { provider_catalog: providerCatalog } : {}),
  };
}

function compactAppleStorefrontEvidence(track = {}) {
  const metadata = track.metadata?.appleStorefronts;
  if (!metadata) return null;
  return {
    source_storefront: metadata.sourceStorefront || '',
    storefronts: Array.isArray(metadata.storefronts) ? metadata.storefronts.slice(0, 12) : [],
    equivalent_count: Number(metadata.equivalentCount || 0),
    equivalents: Array.isArray(metadata.equivalents)
      ? metadata.equivalents.filter((item) => item.isrcMatch === true).slice(0, ALIAS_LIMIT).map((item) => ({
        storefront: item.storefront || '',
        title: item.title || '',
        artist: item.artist || '',
        album: item.album || '',
        duration_ms: Number(item.durationMs || 0),
        isrc: item.isrc || '',
        track_number: Number(item.trackNumber || 0),
        disc_number: Number(item.discNumber || 0),
      }))
      : [],
  };
}

function compactProviderCatalogEvidence(track = {}) {
  const metadata = track.metadata?.providerCatalog;
  if (!metadata) return null;
  return {
    platform: metadata.platform || track.platform || '',
    track_number: Number(metadata.trackNumber || 0),
    disc_number: Number(metadata.discNumber || 0),
    album_id: metadata.albumId || '',
    subtitle: metadata.subtitle || '',
    release_date: metadata.releaseDate || '',
  };
}

function compactMusicBrainzEvidence(track = {}) {
  const musicbrainz = track.metadata?.musicbrainz || null;
  const isrc = musicbrainz?.isrc || track.isrc || null;
  const recordingIds = Array.isArray(musicbrainz?.recordingIds)
    ? musicbrainz.recordingIds.filter(Boolean).slice(0, RECORDING_ID_LIMIT)
    : [];
  if (!musicbrainz && !isrc) return null;
  return {
    source: 'musicbrainz-isrc',
    isrc,
    status: musicbrainz?.status || (isrc ? 'not_enriched' : 'missing'),
    recording_ids: recordingIds,
    fetched_at: musicbrainz?.fetchedAt || null,
  };
}

function compactAliases(aliases = {}) {
  const result = {};
  for (const key of ['titles', 'artists', 'albums']) {
    const values = Array.isArray(aliases?.[key]) ? aliases[key].filter(Boolean) : [];
    if (values.length) result[key] = values.slice(0, ALIAS_LIMIT);
  }
  return Object.keys(result).length ? result : null;
}

function compareIsrc(left, right) {
  if (left && right && left === right) return { relation: 'same', source: left, target: right };
  if (left && right && left !== right) return { relation: 'different', source: left, target: right };
  if (left) return { relation: 'source_only', source: left, target: null };
  if (right) return { relation: 'target_only', source: null, target: right };
  return { relation: 'missing', source: null, target: null };
}

function durationDeltaMs(left, right) {
  const a = Number(left || 0);
  const b = Number(right || 0);
  if (!a || !b) return null;
  return Math.abs(a - b);
}

function overlapField(sourceTrack, targetTrack, key) {
  const source = normalizedFieldValues(sourceTrack, key);
  const target = normalizedFieldValues(targetTrack, key);
  return uniqueTextEvidence(intersect(source, target)).slice(0, ALIAS_LIMIT);
}

function normalizedFieldValues(track = {}, key) {
  const base = key === 'titles'
    ? [track.title]
    : key === 'artists'
      ? [track.artist, ...(track.artists || [])]
      : [track.album];
  const aliases = Array.isArray(track.aliases?.[key]) ? track.aliases[key] : [];
  return unique([...base, ...aliases]
    .flatMap((value) => [normalizeText(value), ...matchingTextVariants(value)])
    .filter(Boolean));
}

export function compareVersionCues(sourceTrack = {}, targetTrack = {}) {
  const sourceTitle = versionCueSet(sourceTrack.title);
  const sourceAlbum = versionCueSet(sourceTrack.album);
  const targetTitle = versionCueSet(targetTrack.title);
  const targetAlbum = versionCueSet(targetTrack.album);
  const source = new Set([...sourceTitle, ...sourceAlbum]);
  const target = new Set([...targetTitle, ...targetAlbum]);
  const conflicts = [];
  for (const cue of sourceTitle) {
    if (!target.has(cue)) conflicts.push({ field: 'title', cue, source: true, target: false });
  }
  for (const cue of targetTitle) {
    if (!source.has(cue)) conflicts.push({ field: 'title', cue, source: false, target: true });
  }
  return conflicts;
}

export function versionCueSet(text) {
  const value = String(text || '').toLowerCase().normalize('NFKC');
  const cues = new Set();
  const checks = [
    ['live', /\blive(?:\s+(?:at|from|in)\b|$)|[\[(]\s*live[\])]|\bconcert\b|the first take|现场|現場|实况|實況|ライブ/u],
    ['cover', /\bcover\b|翻唱|カバー/u],
    ['acoustic', /\bacoustic\b|不插电|不插電|アコースティック|弾き語り/u],
    ['piano', /\bpiano\b|钢琴(?:版|演奏|伴奏)|鋼琴(?:版|演奏|伴奏)|ピアノ(?:版|バージョン|アレンジ)/u],
    ['instrumental', /\b(instrumental|inst\.?|off vocal|karaoke)\b|伴奏|器乐|器樂|纯音乐|純音樂|インスト(?:ゥルメンタル)?|オフボーカル|カラオケ/u],
    ['tv-size', /\b(tv[- ]?size|tv ver|short ver|short edit|edit version)\b|tvサイズ|テレビサイズ/u],
    ['remix', /\bremix(?:ed)?\b|\b(?:club|dance|radio|extended|china|dj)\s+mix\b|混音|リミックス/u],
    ['remaster', /\bremaster(?:ed)?\b|重制|重製|修复|修復|リマスター/u],
    ['single-version', /\bsingle version\b|单曲版|單曲版|シングル(?:・| )?バージョン/u],
    ['album-version', /\balbum version\b|专辑版|專輯版|アルバム(?:・| )?バージョン/u],
    ['movie-version', /\b(movie|film|cinema)[ -]?ver(?:sion)?\b|电影版|電影版|劇場版/u],
    ['orchestral', /\borchestral(?:\s+(?:version|ver|mix))?\b|管弦乐版|管弦樂版|オーケストラ(?:版|バージョン)/u],
    ['anniversary', /\banniversary\b|周年纪念|週年紀念|周年記念/u],
    ['original', /\boriginal\s+ver(?:sion)?\b|原版|原曲版|オリジナル(?:版|バージョン)/u],
    ['choir', /\bchoir\s+(?:version|ver|verse)\b|合唱版|合唱版本/u],
    ['explicit', /\bexplicit\b|未删减版|未刪減版/u],
    ['clean', /\bclean\b|健康版|洁净版|潔淨版/u],
    ['version', /(?:\b|[\[(])(?:version|ver\.?)(?:\b|[\])])|バージョン|版本/u],
  ];
  for (const [name, pattern] of checks) {
    if (pattern.test(value)) cues.add(name);
  }
  for (const match of value.matchAll(/(?:19|20)\d{2}/g)) {
    cues.add(`year:${match[0]}`);
  }
  if (cues.size > 1) cues.delete('version');
  return cues;
}

function supportSignals({
  durationDeltaSeconds,
  isrc,
  sharedRecordingIds,
  aliasOverlap,
  recordingFingerprint,
  appleEquivalentFingerprint,
  catalogTrackFingerprint,
}) {
  const signals = [];
  if (isrc.relation === 'same') signals.push('same_isrc');
  if (sharedRecordingIds.length) signals.push('shared_musicbrainz_recording_id');
  if (appleEquivalentFingerprint) signals.push('apple_storefront_equivalent_fingerprint');
  if (catalogTrackFingerprint) signals.push('same_album_track_number');
  if (recordingFingerprint) signals.push('exact_recording_fingerprint');
  if (durationDeltaSeconds !== null && durationDeltaSeconds <= 5) signals.push('duration_within_5_seconds');
  if (aliasOverlap.titles.length) signals.push('title_alias_overlap');
  if (aliasOverlap.artists.length) signals.push('artist_alias_overlap');
  if (aliasOverlap.albums.length) signals.push('album_alias_overlap');
  return signals;
}

function riskSignals({ durationDeltaSeconds, isrc, versionCueConflicts }) {
  const signals = [];
  if (isrc.relation === 'different') signals.push('different_isrc');
  if (durationDeltaSeconds !== null && durationDeltaSeconds > 20) signals.push('duration_over_20_seconds');
  if (versionCueConflicts.length) signals.push('version_cue_conflict');
  return signals;
}

function intersect(left, right) {
  const wanted = new Set(right);
  return left.filter((item) => wanted.has(item));
}

function unique(values) {
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

function uniqueTextEvidence(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = String(value || '').replace(/\s+/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
