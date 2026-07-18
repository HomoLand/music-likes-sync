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
  const versionCueConflicts = compareVersionCues(sourceTrack, targetTrack);
  const recordingFingerprint = (
    aliasOverlap.titles.length > 0
    && aliasOverlap.albums.length > 0
    && durationDeltaMilliseconds !== null
    && durationDeltaMilliseconds <= 2000
    && isrc.relation !== 'different'
    && versionCueConflicts.length === 0
  );

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
  if (!musicbrainz) return null;
  return { musicbrainz };
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
  const fields = [
    ['title', sourceTrack.title, targetTrack.title],
    ['album', sourceTrack.album, targetTrack.album],
  ];
  const conflicts = [];
  for (const [field, sourceValue, targetValue] of fields) {
    const source = versionCueSet(sourceValue);
    const target = versionCueSet(targetValue);
    for (const cue of source) {
      if (!target.has(cue)) conflicts.push({ field, cue, source: true, target: false });
    }
    for (const cue of target) {
      if (!source.has(cue)) conflicts.push({ field, cue, source: false, target: true });
    }
  }
  return conflicts;
}

function versionCueSet(text) {
  const value = String(text || '').toLowerCase().normalize('NFKC');
  const cues = new Set();
  const checks = [
    ['live', /\blive(?:\s+(?:at|from|in)\b|$)|[\[(]\s*live[\])]|\bconcert\b|the first take|现场|現場|ライブ/u],
    ['cover', /\bcover\b|翻唱|カバー/u],
    ['acoustic', /\bacoustic\b|不插电|不插電|アコースティック/u],
    ['piano', /\bpiano\s+(?:version|ver|cover|solo)\b|[\[(]\s*piano\s*[\])]|钢琴(?:版|演奏|伴奏)|鋼琴(?:版|演奏|伴奏)|ピアノ(?:版|バージョン|アレンジ)/u],
    ['instrumental', /\b(instrumental|inst\.?|off vocal|karaoke)\b|伴奏|器乐|器樂|纯音乐|純音樂|インスト(?:ゥルメンタル)?|オフボーカル|カラオケ/u],
    ['tv-size', /\b(tv size|tv ver|short ver|short edit|edit version)\b|tvサイズ|テレビサイズ/u],
    ['remix', /\bremix(?:ed)?\b|\b(?:club|dance|radio|extended|china|dj)\s+mix\b|混音|リミックス/u],
    ['remaster', /\bremaster(?:ed)?\b|重制|リマスター/u],
    ['single-version', /\bsingle version\b|单曲版|シングルバージョン/u],
    ['album-version', /\balbum version\b|专辑版|アルバムバージョン/u],
    ['movie-version', /\b(movie|film|cinema) ver\b|电影版/u],
  ];
  for (const [name, pattern] of checks) {
    if (pattern.test(value)) cues.add(name);
  }
  return cues;
}

function supportSignals({ durationDeltaSeconds, isrc, sharedRecordingIds, aliasOverlap, recordingFingerprint }) {
  const signals = [];
  if (isrc.relation === 'same') signals.push('same_isrc');
  if (sharedRecordingIds.length) signals.push('shared_musicbrainz_recording_id');
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
