import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { acquireRunLock, RunLockError } from '../src/run-lock.js';

describe('cross-process run lock', () => {
  it('rejects a second owner and allows reacquisition after release', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-sync-lock-'));
    const filePath = path.join(root, 'auto-sync.lock');
    const first = await acquireRunLock(filePath, { heartbeatMs: 0, token: 'first' });

    await assert.rejects(
      acquireRunLock(filePath, { heartbeatMs: 0, token: 'second' }),
      (error) => error instanceof RunLockError && error.code === 'RUN_LOCKED' && error.owner?.pid === process.pid,
    );

    await first.release();
    const second = await acquireRunLock(filePath, { heartbeatMs: 0, token: 'second' });
    await second.release();
    await assert.rejects(fs.access(filePath), /ENOENT/);
  });

  it('reclaims an abandoned stale lock', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-sync-stale-lock-'));
    const filePath = path.join(root, 'auto-sync.lock');
    await fs.writeFile(filePath, JSON.stringify({ token: 'abandoned', pid: 123, startedAt: '2026-07-10T00:00:00.000Z' }));
    const old = new Date('2026-07-10T00:00:00.000Z');
    await fs.utimes(filePath, old, old);

    const lock = await acquireRunLock(filePath, {
      heartbeatMs: 0,
      staleAfterMs: 60_000,
      token: 'replacement',
      clock: () => Date.parse('2026-07-10T00:02:00.000Z'),
    });

    assert.equal(lock.token, 'replacement');
    const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(stored.token, 'replacement');
    await lock.release();
  });

  it('reclaims a fresh lock when its owning process has exited', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-sync-orphan-lock-'));
    const filePath = path.join(root, 'auto-sync.lock');
    await fs.writeFile(filePath, JSON.stringify({ token: 'orphaned', pid: 424242, startedAt: new Date().toISOString() }));

    const lock = await acquireRunLock(filePath, {
      heartbeatMs: 0,
      token: 'replacement',
      isProcessAlive: async (pid) => pid !== 424242,
    });

    const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(stored.token, 'replacement');
    await lock.release();
  });

  it('does not remove a lock that no longer belongs to the releasing owner', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-sync-owner-lock-'));
    const filePath = path.join(root, 'auto-sync.lock');
    const lock = await acquireRunLock(filePath, { heartbeatMs: 0, token: 'original' });
    await fs.writeFile(filePath, JSON.stringify({ token: 'replacement', pid: 456, startedAt: '2026-07-11T00:00:00.000Z' }));

    await lock.release();
    const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(stored.token, 'replacement');
    await fs.unlink(filePath);
  });
});
