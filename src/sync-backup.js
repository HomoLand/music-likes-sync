import { createHash, randomUUID } from 'node:crypto';

export const SYNC_BACKUP_STATE_VERSION = 1;
export const SYNC_BACKUP_LIMIT = 5;
export const SYNC_BACKUP_RESTORE_RUN_LIMIT = 50;

export function emptySyncBackupState() {
  return {
    version: SYNC_BACKUP_STATE_VERSION,
    updatedAt: '',
    backups: [],
    restoreRuns: [],
  };
}

export function buildSyncBackup(input = {}) {
  const createdAt = input.createdAt || new Date().toISOString();
  const targets = normalizeTargets(input.targets || Object.keys(input.snapshots || {}));
  if (!targets.length) throw new Error('A sync backup requires at least one writable target.');
  const snapshots = {};
  for (const target of targets) {
    const snapshot = input.snapshots?.[target];
    if (!snapshot || snapshot.skipped || !Array.isArray(snapshot.tracks)) {
      throw new Error(`Cannot back up unavailable ${target} snapshot.`);
    }
    if (!String(snapshot.playlistId || '').trim()) {
      throw new Error(`Cannot back up ${target} without a target playlist identity.`);
    }
    const tracks = snapshot.tracks.map((track) => compactBackupTrack(track, target));
    snapshots[target] = {
      platform: target,
      source: String(snapshot.source || ''),
      fetchedAt: String(snapshot.fetchedAt || ''),
      playlistId: snapshot.playlistId === undefined || snapshot.playlistId === null
        ? null
        : String(snapshot.playlistId),
      count: tracks.length,
      restorable: tracks.filter((track) => Boolean(providerTrackKey(target, track))).length,
      checksum: tracksChecksum(target, tracks),
      tracks,
    };
  }
  return {
    id: String(input.id || `sync-backup-${randomUUID()}`),
    createdAt,
    previewId: String(input.previewId || ''),
    policy: String(input.policy || 'canonical_mirror'),
    reason: String(input.reason || 'manual').slice(0, 120),
    targets,
    snapshots,
  };
}

export function appendSyncBackup(state, backup, options = {}) {
  const limit = clampInteger(options.limit, SYNC_BACKUP_LIMIT, 1, 20);
  return {
    version: SYNC_BACKUP_STATE_VERSION,
    updatedAt: backup.createdAt,
    backups: [backup, ...(state?.backups || []).filter((item) => item.id !== backup.id)].slice(0, limit),
    restoreRuns: Array.isArray(state?.restoreRuns) ? state.restoreRuns.slice(0, SYNC_BACKUP_RESTORE_RUN_LIMIT) : [],
  };
}

export function buildSyncRestorePlan(backup, currentSnapshots = {}, options = {}) {
  if (!backup) throw new Error('Sync backup is required.');
  const targets = normalizeTargets(options.targets || backup.targets || Object.keys(backup.snapshots || {}));
  const verification = verifySyncBackup(backup, { targets });
  if (!verification.ok) {
    throw new Error(`Sync backup integrity check failed: ${verification.errors.join('; ')}`);
  }
  const additions = {};
  const summary = { targets: 0, backupTracks: 0, missing: 0, unrestorable: 0 };
  for (const target of targets) {
    const saved = backup.snapshots?.[target];
    const current = currentSnapshots?.[target];
    if (!saved || !Array.isArray(saved.tracks)) throw new Error(`Backup does not contain ${target}.`);
    if (!current || current.skipped || !Array.isArray(current.tracks)) {
      throw new Error(`Current ${target} snapshot is unavailable.`);
    }
    const currentKeys = new Set(current.tracks.map((track) => providerTrackKey(target, track)).filter(Boolean));
    const tracks = [];
    let unrestorable = 0;
    for (const track of saved.tracks) {
      const key = providerTrackKey(target, track);
      if (!key) {
        unrestorable += 1;
        continue;
      }
      if (!currentKeys.has(key)) tracks.push(track);
    }
    additions[target] = {
      target,
      playlistId: saved.playlistId,
      backupCount: saved.count,
      currentCount: current.tracks.length,
      missing: tracks.length,
      unrestorable,
      tracks,
    };
    summary.targets += 1;
    summary.backupTracks += saved.count;
    summary.missing += tracks.length;
    summary.unrestorable += unrestorable;
  }
  return {
    backupId: backup.id,
    createdAt: new Date().toISOString(),
    targets,
    additions,
    summary,
  };
}

export function verifySyncBackup(backup, options = {}) {
  const targets = normalizeTargets(options.targets || backup?.targets || Object.keys(backup?.snapshots || {}));
  const errors = [];
  for (const target of targets) {
    const snapshot = backup?.snapshots?.[target];
    if (!snapshot || !Array.isArray(snapshot.tracks)) {
      errors.push(`${target} snapshot is missing`);
      continue;
    }
    if (Number(snapshot.count) !== snapshot.tracks.length) {
      errors.push(`${target} track count does not match`);
    }
    const actual = tracksChecksum(target, snapshot.tracks.map((track) => compactBackupTrack(track, target)));
    if (actual !== snapshot.checksum) errors.push(`${target} checksum does not match`);
  }
  return {
    ok: errors.length === 0,
    targets,
    errors,
  };
}

export function appendSyncRestoreRun(state, run, options = {}) {
  const limit = clampInteger(options.limit, SYNC_BACKUP_RESTORE_RUN_LIMIT, 1, 200);
  return {
    ...state,
    version: SYNC_BACKUP_STATE_VERSION,
    updatedAt: run.completedAt || run.startedAt || new Date().toISOString(),
    restoreRuns: [run, ...(state?.restoreRuns || []).filter((item) => item.id !== run.id)].slice(0, limit),
  };
}

export function expectedSyncRestoreConfirmation(backupId) {
  return `RESTORE BACKUP ${String(backupId || '').trim()}`;
}

export function summarizeSyncBackup(backup) {
  if (!backup) return null;
  return {
    id: backup.id || '',
    createdAt: backup.createdAt || '',
    previewId: backup.previewId || '',
    policy: backup.policy || '',
    reason: backup.reason || '',
    targets: (backup.targets || []).map((target) => ({
      target,
      fetchedAt: backup.snapshots?.[target]?.fetchedAt || '',
      count: Number(backup.snapshots?.[target]?.count || 0),
      restorable: Number(backup.snapshots?.[target]?.restorable || 0),
      checksum: backup.snapshots?.[target]?.checksum || '',
    })),
  };
}

export function summarizeSyncRestoreRun(run) {
  if (!run) return null;
  return {
    id: run.id || '',
    backupId: run.backupId || '',
    startedAt: run.startedAt || '',
    completedAt: run.completedAt || '',
    status: run.status || '',
    dryRun: Boolean(run.dryRun),
    targets: run.targets || [],
    summary: run.summary || {},
    error: String(run.error || '').slice(0, 500),
  };
}

function compactBackupTrack(track = {}, platform) {
  track = track && typeof track === 'object' ? track : {};
  return {
    platform,
    id: track.id === undefined || track.id === null ? '' : String(track.id),
    mid: track.mid === undefined || track.mid === null ? '' : String(track.mid),
    title: String(track.title || ''),
    artist: String(track.artist || artistsText(track.artists)),
    artists: normalizeArtists(track.artists || track.artist),
    album: String(track.album || ''),
    durationMs: Number(track.durationMs || 0) || null,
    isrc: track.isrc ? String(track.isrc) : null,
  };
}

function providerTrackKey(platform, track = {}) {
  if (platform === 'qq') {
    if (track.mid) return `mid:${String(track.mid)}`;
    if (track.id) return `id:${String(track.id)}`;
    return '';
  }
  return track.id ? `id:${String(track.id)}` : '';
}

function tracksChecksum(platform, tracks) {
  const payload = tracks.map((track) => ({
    platform,
    id: String(track.id || ''),
    mid: String(track.mid || ''),
    title: String(track.title || ''),
    artist: String(track.artist || ''),
    artists: normalizeArtists(track.artists || []),
    album: String(track.album || ''),
    durationMs: Number(track.durationMs || 0) || null,
    isrc: track.isrc ? String(track.isrc) : null,
  }));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeTargets(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return ['qq', 'netease'].filter((target) => list.map((item) => String(item || '').trim().toLowerCase()).includes(target));
}

function normalizeArtists(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(/[,&/、，]+/u).map((item) => item.trim()).filter(Boolean);
}

function artistsText(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || '');
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
