import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PACKAGE_ROOT,
  REPORT_DIR,
  readJsonIfExists,
  readTextIfExists,
  ROOT,
} from './utils.js';

export const LIVE_VALIDATION_CONFIRM = 'DISPOSABLE_PLAYLIST';
export const LIVE_VALIDATION_REPORT_SCHEMA_VERSION = 1;
export const LIVE_VALIDATION_TARGETS = ['qq', 'netease'];
export const LIVE_VALIDATION_REPORT_MAX_AGE_DAYS = 14;
const LIVE_VALIDATION_REPORT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const SECRET_KEY_PATTERN = /(^|[._-])(authorization|cookie|csrf|music_u|password|qm_keyst|secret|session|token)([._-]|$)/iu;
const SECRET_VALUE_PATTERNS = [
  /\bMUSIC_U\s*=\s*[^;\s]+/iu,
  /\bqm_keyst\s*=\s*[^;\s]+/iu,
  /\bcookie\s*:\s*[^;\n]+/iu,
  /\bauthorization\s*:\s*(?:bearer|basic)\s+[^;\s]+/iu,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{16,}/u,
];

export async function getLiveValidationEvidence(options = {}) {
  const reportsDir = options.reportsDir || REPORT_DIR;
  const targets = options.targets || LIVE_VALIDATION_TARGETS;
  const packageInfo = options.packageInfo || await readPackageInfo(options.readPackageFile || fs.readFile);
  const now = options.now || new Date();
  const entries = await Promise.all(targets.map(async (target) => {
    const filePath = path.join(reportsDir, `live-validation-${target}.json`);
    const report = await (options.readJson || readJsonIfExists)(filePath);
    return [target, summarizeLiveValidationEvidence(target, report, {
      packageInfo,
      now,
      reportFile: `reports/live-validation-${target}.json`,
      credentialUpdatedAt: options.credentialUpdatedAtByTarget?.[target],
    })];
  }));
  const targetMap = Object.fromEntries(entries);
  return {
    ok: Object.values(targetMap).every((entry) => entry.ok),
    generatedAt: new Date().toISOString(),
    maxAgeDays: LIVE_VALIDATION_REPORT_MAX_AGE_DAYS,
    targets: targetMap,
  };
}

export function summarizeLiveValidationEvidence(target, report, options = {}) {
  if (!report) {
    return {
      target,
      ok: false,
      status: 'missing',
      message: 'Missing live validation evidence report.',
      reportFile: options.reportFile || '',
    };
  }
  const errors = validateLiveValidationReport(target, report, options.packageInfo || {}, {
    now: options.now,
    credentialUpdatedAt: options.credentialUpdatedAt,
  });
  const validatedAtMs = Date.parse(report.validatedAt || '');
  const nowMs = (options.now || new Date()).getTime();
  const ageDays = Number.isNaN(validatedAtMs)
    ? null
    : Math.max(0, Math.round(((nowMs - validatedAtMs) / (24 * 60 * 60 * 1000)) * 10) / 10);
  return {
    target,
    ok: errors.length === 0,
    status: errors.length === 0 ? 'verified' : validationStatus(errors),
    message: errors.length ? errors.join('; ') : 'Live add/remove validation evidence is complete.',
    reportFile: options.reportFile || '',
    validatedAt: report.validatedAt || '',
    ageDays,
    createdPlaylist: Boolean(report.createdPlaylist),
    track: {
      title: report.track?.title || '',
      artist: report.track?.artist || '',
    },
    snapshots: {
      beforeTrackCount: report.snapshots?.before?.trackCount ?? null,
      afterAddTrackCount: report.snapshots?.afterAdd?.trackCount ?? null,
      afterRemoveTrackCount: report.snapshots?.afterRemove?.trackCount ?? null,
      beforeContainsTrack: report.snapshots?.before?.containsValidatedTrack ?? null,
      afterAddContainsTrack: report.snapshots?.afterAdd?.containsValidatedTrack ?? null,
      afterRemoveContainsTrack: report.snapshots?.afterRemove?.containsValidatedTrack ?? null,
    },
    mutations: {
      addVerified: Boolean(report.add?.verified),
      removeVerified: Boolean(report.remove?.verified),
      added: Number(report.add?.added || 0),
      removed: Number(report.remove?.removed || 0),
    },
  };
}

export function validateLiveValidationReport(target, report = {}, expectedPackage = {}, options = {}) {
  const errors = [];
  if (report.schemaVersion !== LIVE_VALIDATION_REPORT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${LIVE_VALIDATION_REPORT_SCHEMA_VERSION}`);
  }
  if (expectedPackage.name && report.tool?.name !== expectedPackage.name) {
    errors.push(`tool.name must be ${expectedPackage.name}`);
  }
  if (expectedPackage.version && report.tool?.version !== expectedPackage.version) {
    errors.push(`tool.version must be ${expectedPackage.version}`);
  }
  if (report.ok !== true) errors.push('ok must be true');
  if (report.verified !== true) errors.push('verified must be true');
  if (report.target !== target) errors.push(`target must be ${target}`);
  if (!report.validatedAt || Number.isNaN(Date.parse(report.validatedAt))) {
    errors.push('validatedAt must be an ISO timestamp');
  }
  errors.push(...validationFreshnessErrors(
    report,
    options.now || new Date(),
    options.credentialUpdatedAt,
  ));
  if (!String(report.playlistId || '').trim()) errors.push('playlistId is required');
  if (typeof report.createdPlaylist !== 'boolean') errors.push('createdPlaylist must be boolean');
  if (!report.track?.id && !report.track?.mid) errors.push('validated track id or mid is required');
  errors.push(...credentialLeakErrors(report));

  for (const key of ['before', 'afterAdd', 'afterRemove']) {
    const snapshot = report.snapshots?.[key];
    if (!snapshot || !Number.isInteger(snapshot.trackCount)) {
      errors.push(`snapshots.${key}.trackCount must be an integer`);
    }
    if (!snapshot?.fetchedAt || Number.isNaN(Date.parse(snapshot.fetchedAt))) {
      errors.push(`snapshots.${key}.fetchedAt must be an ISO timestamp`);
    }
    if (typeof snapshot?.containsValidatedTrack !== 'boolean') {
      errors.push(`snapshots.${key}.containsValidatedTrack must be boolean`);
    }
    if (String(snapshot?.playlistId || '').trim() !== String(report.playlistId || '').trim()) {
      errors.push(`snapshots.${key}.playlistId must match playlistId`);
    }
  }

  if (!acceptedMutation(report.add)) errors.push('add mutation must be accepted');
  if (!acceptedMutation(report.remove)) errors.push('remove mutation must be accepted');
  if (report.add?.verified !== true) errors.push('add mutation must be verified');
  if (report.remove?.verified !== true) errors.push('remove mutation must be verified');
  if (Number(report.add?.added || 0) < 1) errors.push('add mutation must report one added track');
  if (Number(report.remove?.removed || 0) < 1) errors.push('remove mutation must report one removed track');
  errors.push(...snapshotProgressionErrors(report));
  errors.push(...snapshotPresenceErrors(report));
  errors.push(...snapshotTimeOrderErrors(report));
  return errors;
}

function validationStatus(errors = []) {
  if (errors.some((error) => /missing/i.test(error))) return 'invalid';
  if (errors.some((error) => /within|future|credential/i.test(error))) return 'stale';
  return 'invalid';
}

function validationFreshnessErrors(report = {}, now = new Date(), credentialUpdatedAtValue = '') {
  const validatedAt = Date.parse(report.validatedAt || '');
  if (Number.isNaN(validatedAt)) return [];

  const nowMs = now.getTime();
  const maxAgeMs = LIVE_VALIDATION_REPORT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const errors = [];
  if (validatedAt > nowMs + LIVE_VALIDATION_REPORT_FUTURE_SKEW_MS) {
    errors.push('validatedAt must not be in the future');
  }
  if (validatedAt < nowMs - maxAgeMs) {
    errors.push(`validatedAt must be within ${LIVE_VALIDATION_REPORT_MAX_AGE_DAYS} days`);
  }
  const credentialUpdatedAt = Date.parse(String(credentialUpdatedAtValue || ''));
  if (!Number.isNaN(credentialUpdatedAt) && validatedAt < credentialUpdatedAt) {
    errors.push('validatedAt must be newer than the current credential');
  }
  return errors;
}

function acceptedMutation(result = {}) {
  const submitted = Number(result.submitted || 0);
  const accepted = Number(result.accepted || 0);
  const changed = Number(result.added || 0) + Number(result.removed || 0);
  return submitted > 0 && (accepted > 0 || changed > 0);
}

function snapshotProgressionErrors(report = {}) {
  const before = report.snapshots?.before?.trackCount;
  const afterAdd = report.snapshots?.afterAdd?.trackCount;
  const afterRemove = report.snapshots?.afterRemove?.trackCount;
  if (![before, afterAdd, afterRemove].every(Number.isInteger)) return [];

  const errors = [];
  if (afterAdd !== before + 1) {
    errors.push('snapshots.afterAdd.trackCount must equal snapshots.before.trackCount + 1');
  }
  if (afterRemove !== before) {
    errors.push('snapshots.afterRemove.trackCount must equal snapshots.before.trackCount');
  }
  return errors;
}

function snapshotPresenceErrors(report = {}) {
  const before = report.snapshots?.before?.containsValidatedTrack;
  const afterAdd = report.snapshots?.afterAdd?.containsValidatedTrack;
  const afterRemove = report.snapshots?.afterRemove?.containsValidatedTrack;
  const errors = [];
  if (before !== false) errors.push('snapshots.before.containsValidatedTrack must be false');
  if (afterAdd !== true) errors.push('snapshots.afterAdd.containsValidatedTrack must be true');
  if (afterRemove !== false) errors.push('snapshots.afterRemove.containsValidatedTrack must be false');
  return errors;
}

function snapshotTimeOrderErrors(report = {}) {
  const before = Date.parse(report.snapshots?.before?.fetchedAt || '');
  const afterAdd = Date.parse(report.snapshots?.afterAdd?.fetchedAt || '');
  const afterRemove = Date.parse(report.snapshots?.afterRemove?.fetchedAt || '');
  if ([before, afterAdd, afterRemove].some(Number.isNaN)) return [];
  const errors = [];
  if (afterAdd < before) errors.push('snapshots.afterAdd.fetchedAt must not be before snapshots.before.fetchedAt');
  if (afterRemove < afterAdd) errors.push('snapshots.afterRemove.fetchedAt must not be before snapshots.afterAdd.fetchedAt');
  return errors;
}

function credentialLeakErrors(report = {}) {
  const errors = [];
  visitReport(report, (key, value) => {
    if (SECRET_KEY_PATTERN.test(String(key || ''))) {
      errors.push(`credential-shaped key is not allowed: ${key}`);
    }
    if (typeof value === 'string' && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      errors.push('credential-shaped value is not allowed');
    }
  });
  return errors;
}

function visitReport(value, visitor, key = '') {
  visitor(key, value);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitReport(item, visitor, String(index)));
    return;
  }
  Object.entries(value).forEach(([childKey, child]) => {
    visitReport(child, visitor, childKey);
  });
}

export async function runLiveProviderValidation(options = {}) {
  const env = options.env || process.env;
  if (env.MUSIC_LIKES_SYNC_LIVE_VALIDATE !== '1') {
    return {
      skipped: true,
      reason: 'Set MUSIC_LIKES_SYNC_LIVE_VALIDATE=1 to run.',
    };
  }

  if (env.MUSIC_LIKES_SYNC_LIVE_CONFIRM !== LIVE_VALIDATION_CONFIRM) {
    throw new Error(`Refusing to mutate a real account. Set MUSIC_LIKES_SYNC_LIVE_CONFIRM=${LIVE_VALIDATION_CONFIRM}.`);
  }

  const target = normalizeTarget(env.MUSIC_LIKES_SYNC_LIVE_TARGET || '');
  const query = String(env.MUSIC_LIKES_SYNC_LIVE_QUERY || '').trim();
  if (!query) {
    throw new Error('Set MUSIC_LIKES_SYNC_LIVE_QUERY to a track query that exists on the target platform.');
  }

  const cookie = await readCookieForTarget(target, env, options.readCookieFile || readTextIfExists);
  const playlistId = String(env.MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID || '').trim();
  const playlistName = env.MUSIC_LIKES_SYNC_LIVE_PLAYLIST_NAME
    || `music-likes-sync live validation ${new Date().toISOString().slice(0, 19)}`;

  const provider = options.provider || await loadProvider(target);
  const packageInfo = options.packageInfo || await readPackageInfo(options.readPackageFile || fs.readFile);
  const createdPlaylist = playlistId
    ? { id: playlistId, name: env.MUSIC_LIKES_SYNC_LIVE_PLAYLIST_NAME || 'provided disposable playlist' }
    : await createPlaylist(provider, target, cookie, playlistName);
  const resolvedPlaylistId = createdPlaylist.id || createdPlaylist.dirid || playlistId;
  if (!resolvedPlaylistId) throw new Error('Live validation could not determine a target playlist id.');

  const beforeSnapshot = await fetchTargetSnapshot(provider, target, cookie, resolvedPlaylistId);
  const beforeTracks = beforeSnapshot.tracks || [];
  const candidates = await searchTracks(provider, target, cookie, query);
  if (!candidates.length) {
    throw new Error(`No ${target} search candidates found for query: ${query}`);
  }

  const { track, index, preExistingCandidates } = selectAbsentCandidate(candidates, beforeTracks, target);
  if (!track) {
    throw new Error(
      `All ${preExistingCandidates} searched ${target} candidates already exist in playlist ${resolvedPlaylistId}. `
      + 'Use an empty disposable playlist or a query for a track that is not already present.',
    );
  }
  const beforeSummary = summarizeSnapshot(beforeSnapshot, { target, track });

  const addResult = await addTrack(provider, target, cookie, resolvedPlaylistId, track);
  assertMutationAccepted(addResult, 'add');
  const afterAddSnapshot = await fetchTargetSnapshot(provider, target, cookie, resolvedPlaylistId);
  assertTrackPresence(afterAddSnapshot.tracks || [], track, target, true, 'add verification');
  const afterAddSummary = summarizeSnapshot(afterAddSnapshot, { target, track });

  const removeResult = await removeTrack(provider, target, cookie, resolvedPlaylistId, track);
  assertMutationAccepted(removeResult, 'remove');
  const afterRemoveSnapshot = await fetchTargetSnapshot(provider, target, cookie, resolvedPlaylistId);
  assertTrackPresence(afterRemoveSnapshot.tracks || [], track, target, false, 'remove verification');
  const afterRemoveSummary = summarizeSnapshot(afterRemoveSnapshot, { target, track });

  return {
    schemaVersion: LIVE_VALIDATION_REPORT_SCHEMA_VERSION,
    tool: packageInfo,
    ok: true,
    verified: true,
    validatedAt: new Date().toISOString(),
    target,
    playlistId: String(resolvedPlaylistId),
    playlistName: createdPlaylist.name || playlistName,
    createdPlaylist: !playlistId,
    query,
    selectedCandidateIndex: index,
    preExistingCandidateCount: preExistingCandidates,
    track: publicTrack(track),
    snapshots: {
      before: beforeSummary,
      afterAdd: afterAddSummary,
      afterRemove: afterRemoveSummary,
    },
    add: summarizeMutation(addResult),
    remove: summarizeMutation(removeResult),
  };
}

async function loadProvider(target) {
  return target === 'qq'
    ? import('./providers/qq.js')
    : import('./providers/netease.js');
}

async function readPackageInfo(readFile) {
  const pkg = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return {
    name: String(pkg.name || ''),
    version: String(pkg.version || ''),
  };
}

async function readCookieForTarget(platform, env, readCookieFile) {
  const envName = platform === 'qq' ? 'QQ_COOKIE_FILE' : 'NETEASE_COOKIE_FILE';
  const defaultPath = platform === 'qq' ? 'data/qq.cookie' : 'data/netease.cookie';
  const cookieFile = env[envName] || path.join(ROOT, defaultPath);
  const cookie = await readCookieFile(cookieFile);
  if (!cookie?.trim()) {
    throw new Error(`Missing ${platform} cookie. Set ${envName} or create ${defaultPath}.`);
  }
  return cookie;
}

async function createPlaylist(provider, platform, cookie, name) {
  if (platform === 'qq') {
    if (typeof provider.createQQPlaylist !== 'function') {
      throw new Error('QQ live validation requires a createQQPlaylist adapter when MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID is omitted.');
    }
    return provider.createQQPlaylist(cookie, { name });
  }
  if (typeof provider.createNeteasePlaylist !== 'function') {
    throw new Error('NetEase live validation requires a createNeteasePlaylist adapter when MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID is omitted.');
  }
  return provider.createNeteasePlaylist(cookie, { name, privacy: true });
}

async function fetchTargetSnapshot(provider, platform, cookie, playlistId) {
  if (platform === 'qq' && typeof provider.fetchQQPlaylistSnapshot === 'function') {
    return provider.fetchQQPlaylistSnapshot(cookie, playlistId);
  }
  if (platform === 'netease' && typeof provider.fetchNeteasePlaylistSnapshot === 'function') {
    return provider.fetchNeteasePlaylistSnapshot(cookie, playlistId);
  }
  const snapshot = platform === 'qq'
    ? await provider.fetchQQLiked(cookie, { playlistId })
    : await provider.fetchNeteaseLiked(cookie, { playlistId });
  if (snapshot?.skipped) {
    throw new Error(`Live validation could not read ${platform} playlist ${playlistId}: ${snapshot.reason || 'snapshot skipped'}`);
  }
  return snapshot || { tracks: [] };
}

async function searchTracks(provider, platform, cookie, searchQuery) {
  const tracks = platform === 'qq'
    ? await provider.searchQQTracks(cookie, searchQuery, { limit: 5 })
    : await provider.searchNeteaseTracks(cookie, searchQuery, { limit: 5 });
  return tracks.filter((track) => track?.id || track?.mid);
}

async function addTrack(provider, platform, cookie, id, track) {
  if (platform === 'qq') {
    return provider.addQQTracksToPlaylist(cookie, id, [track], { batchSize: 1 });
  }
  return provider.addNeteaseTracksToPlaylist(cookie, id, [track.id], { batchSize: 1 });
}

async function removeTrack(provider, platform, cookie, id, track) {
  if (platform === 'qq') {
    return provider.removeQQTracksFromPlaylist(cookie, id, [track], { batchSize: 1 });
  }
  return provider.removeNeteaseTracksFromPlaylist(cookie, id, [track.id], { batchSize: 1 });
}

function selectAbsentCandidate(candidates, playlistTracks, target) {
  let preExistingCandidates = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (hasTrack(playlistTracks, candidate, target)) {
      preExistingCandidates += 1;
      continue;
    }
    return { track: candidate, index, preExistingCandidates };
  }
  return { track: null, index: -1, preExistingCandidates };
}

function normalizeTarget(value) {
  const target = String(value || '').trim().toLowerCase();
  if (target === 'qq' || target === 'netease') return target;
  throw new Error('Set MUSIC_LIKES_SYNC_LIVE_TARGET to qq or netease.');
}

function assertMutationAccepted(result, phase) {
  const submitted = Number(result?.submitted || 0);
  const accepted = Number(result?.accepted || 0);
  const added = Number(result?.added || 0);
  const removed = Number(result?.removed || 0);
  const already = Number(result?.alreadyPresent || result?.alreadyAbsent || 0);
  if (result?.verified) {
    if (phase === 'add' && added > 0) return;
    if (phase === 'remove' && removed > 0) return;
    throw new Error(`${phase} mutation did not verify a real playlist change: ${JSON.stringify(summarizeMutation(result))}`);
  }
  if (phase === 'add' && submitted + already > 0 && accepted + added + already > 0) return;
  if (phase === 'remove' && submitted + already > 0 && accepted + removed + already > 0) return;
  throw new Error(`${phase} mutation was not accepted: ${JSON.stringify(result)}`);
}

function assertTrackPresence(tracks, track, target, expected, phase) {
  const present = hasTrack(tracks, track, target);
  if (present === expected) return;
  const publicId = trackIdentityKeys(track, target).join(' or ');
  throw new Error(`${phase} failed: expected ${publicId} to be ${expected ? 'present' : 'absent'} in the target playlist snapshot.`);
}

function hasTrack(tracks, candidate, target) {
  const keys = new Set(trackIdentityKeys(candidate, target));
  if (!keys.size) return false;
  return tracks.some((track) => trackIdentityKeys(track, target).some((key) => keys.has(key)));
}

function trackIdentityKeys(track = {}, target) {
  const keys = [];
  const id = String(track.id || '').trim();
  const mid = String(track.mid || '').trim();
  if (target === 'qq') {
    if (mid) keys.push(`mid:${mid}`);
    if (id) keys.push(`id:${id}`);
  } else if (id) {
    keys.push(`id:${id}`);
  }
  return keys;
}

function summarizeSnapshot(snapshot = {}, options = {}) {
  const tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
  return {
    source: snapshot.source || null,
    fetchedAt: snapshot.fetchedAt || null,
    playlistId: snapshot.playlistId ? String(snapshot.playlistId) : null,
    trackCount: tracks.length,
    containsValidatedTrack: Boolean(options.track && hasTrack(tracks, options.track, options.target)),
  };
}

function publicTrack(track = {}) {
  return {
    id: track.id || null,
    mid: track.mid || null,
    title: track.title || '',
    artist: track.artist || '',
  };
}

function summarizeMutation(result = {}) {
  return {
    requested: result.requested || 0,
    submitted: result.submitted || 0,
    accepted: result.accepted || 0,
    added: result.added || 0,
    removed: result.removed || 0,
    verified: Boolean(result.verified),
    missingIds: result.missingIds || [],
    stillPresentIds: result.stillPresentIds || [],
    unsupportedIds: result.unsupportedIds || [],
  };
}
