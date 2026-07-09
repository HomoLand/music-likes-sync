import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMirrorRunIdentity, executeMirrorSyncPlan, expectedMirrorRemoveConfirmation } from '../src/mirror-apply.js';

describe('mirror apply contract', () => {
  it('dry-runs add/remove/review without calling adapters', async () => {
    let called = false;
    const result = await executeMirrorSyncPlan(fixturePlan(), {
      dryRun: true,
      removeTracks: async () => {
        called = true;
      },
    });

    assert.equal(called, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.add.requested, 1);
    assert.equal(result.add.executable, 0);
    assert.equal(result.add.blocked, 1);
    assert.equal(result.remove.requested, 1);
    assert.equal(result.remove.executable, 1);
    assert.equal(result.review.blocked, 1);
    assert.equal(result.blocked.unresolvedAdds, 1);
    assert.match(result.idempotencyKey, /^[a-f0-9]{64}$/);
    assert.equal(result.operationKeys.remove.length, 1);
  });

  it('builds stable idempotency keys for the same selected mirror operations', () => {
    const left = buildMirrorRunIdentity(mixedResolvedPlan(), {
      actions: ['add'],
      playlistId: '201',
    });
    const right = buildMirrorRunIdentity(mixedResolvedPlan(), {
      actions: ['add'],
      playlistId: '201',
    });
    const differentAction = buildMirrorRunIdentity(mixedResolvedPlan(), {
      actions: ['remove'],
      playlistId: '201',
    });
    const differentPlaylist = buildMirrorRunIdentity(mixedResolvedPlan(), {
      actions: ['add'],
      playlistId: 'other-playlist',
    });

    assert.equal(left.idempotencyKey, right.idempotencyKey);
    assert.notEqual(left.idempotencyKey, differentAction.idempotencyKey);
    assert.notEqual(left.idempotencyKey, differentPlaylist.idempotencyKey);
    assert.match(left.runId, /^mirror-run-[a-f0-9]{16}$/);
  });

  it('requires explicit destructive confirmation before removing', async () => {
    await assert.rejects(
      () => executeMirrorSyncPlan(fixturePlan(), {
        dryRun: false,
        removeTracks: async () => ({ removed: 1 }),
      }),
      /REMOVE QQ/,
    );
  });

  it('blocks mid-only remove operations instead of calling delete adapters', async () => {
    const plan = fixturePlan();
    const remove = plan.operations.find((operation) => operation.action === 'remove');
    delete remove.targetTrack.id;

    let called = false;
    const result = await executeMirrorSyncPlan(plan, {
      dryRun: false,
      confirmText: expectedMirrorRemoveConfirmation('qq'),
      removeTracks: async () => {
        called = true;
      },
    });

    assert.equal(called, false);
    assert.equal(result.remove.requested, 1);
    assert.equal(result.remove.executable, 0);
    assert.equal(result.remove.blocked, 1);
    assert.equal(result.remove.destructive, 0);
    assert.equal(result.blocked.invalidRemoves, 1);
    assert.equal(result.removeResult.requested, 0);
    assert.equal(result.operationKeys.remove.length, 0);
    assert.equal(result.operationKeys.blockedRemove.length, 1);
  });

  it('executes confirmed removals through the injected adapter', async () => {
    const calls = [];
    const result = await executeMirrorSyncPlan(fixturePlan(), {
      dryRun: false,
      confirmText: expectedMirrorRemoveConfirmation('qq'),
      playlistId: '201',
      removeTracks: async (input) => {
        calls.push(input);
        return {
          requested: input.tracks.length,
          submitted: input.tracks.length,
          accepted: input.tracks.length,
          removed: input.tracks.length,
          verified: true,
          batches: [{ requested: input.tracks.length, code: 100 }],
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, 'qq');
    assert.equal(calls[0].playlistId, '201');
    assert.deepEqual(calls[0].tracks.map((track) => track.id), ['q-remove']);
    assert.match(calls[0].idempotencyKey, /^[a-f0-9]{64}$/);
    assert.equal(calls[0].operationKeys.length, 1);
    assert.equal(result.removeResult.removed, 1);
    assert.equal(result.addResult.requested, 0);
  });

  it('executes resolved additions through the injected adapter', async () => {
    const calls = [];
    const result = await executeMirrorSyncPlan(resolvedAddPlan(), {
      dryRun: false,
      playlistId: '201',
      addTracks: async (input) => {
        calls.push(input);
        return {
          requested: input.tracks.length,
          submitted: input.tracks.length,
          accepted: input.tracks.length,
          added: input.tracks.length,
          verified: true,
          batches: [{ requested: input.tracks.length, code: 100 }],
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, 'qq');
    assert.equal(calls[0].playlistId, '201');
    assert.deepEqual(calls[0].tracks.map((track) => track.id), ['q-add']);
    assert.match(calls[0].idempotencyKey, /^[a-f0-9]{64}$/);
    assert.equal(calls[0].operationKeys.length, 1);
    assert.equal(result.addResult.added, 1);
    assert.equal(result.removeResult.requested, 0);
  });

  it('can execute only resolved additions without delete confirmation', async () => {
    const addCalls = [];
    const removeCalls = [];
    const result = await executeMirrorSyncPlan(mixedResolvedPlan(), {
      dryRun: false,
      actions: ['add'],
      playlistId: '201',
      addTracks: async (input) => {
        addCalls.push(input);
        return {
          requested: input.tracks.length,
          submitted: input.tracks.length,
          accepted: input.tracks.length,
          added: input.tracks.length,
          verified: true,
          batches: [{ requested: input.tracks.length, code: 100 }],
        };
      },
      removeTracks: async (input) => {
        removeCalls.push(input);
        return { requested: input.tracks.length, removed: input.tracks.length };
      },
    });

    assert.equal(addCalls.length, 1);
    assert.deepEqual(addCalls[0].tracks.map((track) => track.id), ['q-add']);
    assert.equal(removeCalls.length, 0);
    assert.equal(result.add.requested, 1);
    assert.equal(result.remove.requested, 0);
    assert.equal(result.addResult.added, 1);
    assert.equal(result.removeResult.removed, 0);
  });
});

function fixturePlan() {
  return {
    version: 1,
    mode: 'source_of_truth_mirror',
    generatedAt: '2026-07-06T00:00:00.000Z',
    source: { platform: 'apple', count: 2 },
    target: { platform: 'qq', playlistId: '201', count: 2 },
    summary: { total: 3, add: 1, remove: 1, review: 1, keep: 0 },
    operations: [
      {
        id: 'mirror-00001',
        action: 'add',
        status: 'ready',
        sourceTrack: { platform: 'apple', id: 'a-add', title: 'Add Me' },
        targetTrack: null,
      },
      {
        id: 'mirror-00002',
        action: 'remove',
        status: 'ready',
        sourceTrack: null,
        targetTrack: { platform: 'qq', id: 'q-remove', mid: 'mid-remove', title: 'Remove Me' },
      },
      {
        id: 'mirror-00003',
        action: 'review',
        status: 'needs_review',
        sourceTrack: { platform: 'apple', id: 'a-review', title: 'Review Me' },
        targetTrack: { platform: 'qq', id: 'q-review', title: 'Review Me Live' },
      },
    ],
  };
}

function resolvedAddPlan() {
  return {
    version: 1,
    mode: 'source_of_truth_mirror',
    generatedAt: '2026-07-06T00:00:00.000Z',
    source: { platform: 'apple', count: 1 },
    target: { platform: 'qq', playlistId: '201', count: 0 },
    summary: { total: 1, add: 1, remove: 0, review: 0, keep: 0 },
    operations: [
      {
        id: 'mirror-00001',
        action: 'add',
        status: 'ready',
        sourceTrack: { platform: 'apple', id: 'a-add', title: 'Add Me' },
        targetTrack: null,
        resolvedTargetTrack: { platform: 'qq', id: 'q-add', mid: 'mid-add', title: 'Add Me' },
      },
    ],
  };
}

function mixedResolvedPlan() {
  const plan = resolvedAddPlan();
  return {
    ...plan,
    target: { ...plan.target, count: 1 },
    summary: { total: 2, add: 1, remove: 1, review: 0, keep: 0 },
    operations: [
      ...plan.operations,
      {
        id: 'mirror-00002',
        action: 'remove',
        status: 'ready',
        destructive: true,
        sourceTrack: null,
        targetTrack: { platform: 'qq', id: 'q-remove', mid: 'mid-remove', title: 'Remove Me' },
      },
    ],
  };
}
