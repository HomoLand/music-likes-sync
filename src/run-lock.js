import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_RUN_LOCK_STALE_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_RUN_LOCK_HEARTBEAT_MS = 30 * 1000;

export class RunLockError extends Error {
  constructor(message, owner = null) {
    super(message);
    this.name = 'RunLockError';
    this.code = 'RUN_LOCKED';
    this.owner = owner;
  }
}

export async function acquireRunLock(filePath, options = {}) {
  if (!filePath) throw new Error('Run lock path is required.');
  const clock = options.clock || (() => Date.now());
  const staleAfterMs = positiveInteger(options.staleAfterMs, DEFAULT_RUN_LOCK_STALE_MS);
  const heartbeatMs = options.heartbeatMs === 0
    ? 0
    : positiveInteger(options.heartbeatMs, DEFAULT_RUN_LOCK_HEARTBEAT_MS);
  const token = String(options.token || randomUUID());
  const startedAt = new Date(clock()).toISOString();

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await fs.open(filePath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({
          version: 1,
          token,
          pid: process.pid,
          startedAt,
        }, null, 2)}\n`, 'utf8');
      } finally {
        await handle.close();
      }
      return createRunLockHandle(filePath, token, startedAt, heartbeatMs);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (await reclaimStaleRunLock(filePath, staleAfterMs, clock())) continue;
      const owner = await readRunLockOwner(filePath);
      throw new RunLockError('Another auto-sync run owns the execution lock.', owner);
    }
  }
  throw new RunLockError('Could not acquire the auto-sync execution lock.', await readRunLockOwner(filePath));
}

async function createRunLockHandle(filePath, token, startedAt, heartbeatMs) {
  let released = false;
  const heartbeat = heartbeatMs > 0
    ? setInterval(() => touchOwnedRunLock(filePath, token), heartbeatMs)
    : null;
  heartbeat?.unref?.();

  return {
    filePath,
    token,
    startedAt,
    async release() {
      if (released) return;
      released = true;
      if (heartbeat) clearInterval(heartbeat);
      const owner = await readRunLockOwner(filePath);
      if (owner?.token !== token) return;
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    },
  };
}

async function reclaimStaleRunLock(filePath, staleAfterMs, nowMs) {
  let firstStat;
  let firstOwner;
  try {
    [firstStat, firstOwner] = await Promise.all([
      fs.stat(filePath),
      readRunLockOwner(filePath),
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
  if (nowMs - firstStat.mtimeMs <= staleAfterMs) return false;

  const [secondStat, secondOwner] = await Promise.all([
    fs.stat(filePath),
    readRunLockOwner(filePath),
  ]);
  if (secondStat.mtimeMs !== firstStat.mtimeMs || secondOwner?.token !== firstOwner?.token) return false;
  if (nowMs - secondStat.mtimeMs <= staleAfterMs) return false;
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}

async function touchOwnedRunLock(filePath, token) {
  try {
    const owner = await readRunLockOwner(filePath);
    if (owner?.token !== token) return;
    const now = new Date();
    await fs.utimes(filePath, now, now);
  } catch {
    // A failed heartbeat is handled by the stale-lock recovery path on the next run.
  }
}

async function readRunLockOwner(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return {
      token: String(value.token || ''),
      pid: Number.isInteger(value.pid) ? value.pid : null,
      startedAt: String(value.startedAt || ''),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return { token: '', pid: null, startedAt: '' };
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}
