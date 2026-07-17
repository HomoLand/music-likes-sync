import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveMirrorAddOperations } from '../src/mirror-resolve.js';
import { normalizeTrack } from '../src/normalize.js';

describe('mirror add resolver', () => {
  it('resolves add operations to target catalog tracks', async () => {
    const plan = fixturePlan('New Song', 'Alice');
    const resolved = await resolveMirrorAddOperations(plan, {
      searchTracks: async () => [
        normalizeTrack({
          id: 'q-1',
          title: 'New Song',
          artists: ['Alice'],
          album: 'Target Album',
          durationMs: 180500,
        }, 'qq'),
      ],
    });

    const operation = resolved.operations[0];
    assert.equal(operation.status, 'ready');
    assert.equal(operation.resolvedTargetTrack.id, 'q-1');
    assert.equal(operation.resolution.reason, 'resolved_target_match');
    assert.equal(resolved.summary.resolvedAdds, 1);
    assert.equal(resolved.summary.unresolvedAdds, 0);
  });

  it('keeps low-confidence candidates blocked for review', async () => {
    const plan = fixturePlan('New Song', 'Alice');
    const resolved = await resolveMirrorAddOperations(plan, {
      searchTracks: async () => [
        normalizeTrack({
          id: 'n-1',
          title: 'New Song Acoustic',
          artists: ['Alice'],
          album: 'Target Album',
          durationMs: 241000,
        }, 'netease'),
      ],
    });

    const operation = resolved.operations[0];
    assert.equal(operation.status, 'needs_review');
    assert.equal(operation.resolvedTargetTrack, undefined);
    assert.equal(operation.candidateTrack.id, 'n-1');
    assert.equal(resolved.summary.resolvedAdds, 0);
    assert.equal(resolved.summary.unresolvedAdds, 1);
  });

  it('does not page over already reviewed or not-found add operations', async () => {
    const plan = fixturePlan('Needs Review', 'Alice');
    const reviewed = plan.operations[0];
    reviewed.status = 'needs_review';
    reviewed.candidateTrack = normalizeTrack({
      id: 'n-review',
      title: 'Needs Review Acoustic',
      artists: ['Alice'],
      album: 'Target Album',
      durationMs: 241000,
    }, 'netease');
    plan.operations.push({
      ...fixtureAdd('n-missing', 'Not Found Song', 'Bob'),
      status: 'not_found',
      resolution: { reason: 'target_catalog_not_found' },
    });
    plan.operations.push(fixtureAdd('n-ready', 'Resolvable Song', 'Carol'));

    const queries = [];
    const resolved = await resolveMirrorAddOperations(plan, {
      limit: 10,
      searchTracks: async (query) => {
        queries.push(query);
        return [
          normalizeTrack({
            id: 'n-1',
            title: 'Resolvable Song',
            artists: ['Carol'],
            album: 'Target Album',
            durationMs: 180200,
          }, 'netease'),
        ];
      },
    });

    assert.equal(queries.length, 1);
    assert.match(queries[0], /Resolvable Song/);
    assert.equal(resolved.addResolution.totalAdd, 3);
    assert.equal(resolved.addResolution.pendingAdd, 1);
    assert.equal(resolved.addResolution.remaining, 0);
    assert.equal(resolved.addResolution.hasMore, false);
    assert.equal(resolved.operations[0].status, 'needs_review');
    assert.equal(resolved.operations[1].status, 'not_found');
    assert.equal(resolved.operations[2].status, 'ready');
  });

  it('refreshes reviewed candidates when explicitly requested', async () => {
    const plan = fixturePlan('New Song', 'Alice');
    plan.operations[0].status = 'needs_review';
    plan.operations[0].candidateTrack = normalizeTrack({
      id: 'stale-candidate',
      title: 'New Song Cover',
      artists: ['Alice'],
      durationMs: 220000,
    }, 'qq');

    const resolved = await resolveMirrorAddOperations(plan, {
      refresh: true,
      searchTracks: async () => [
        normalizeTrack({
          id: 'fresh-candidate',
          title: 'New Song Acoustic',
          artists: ['Alice'],
          durationMs: 241000,
        }, 'qq'),
      ],
    });

    assert.equal(resolved.addResolution.processed, 1);
    assert.equal(resolved.operations[0].status, 'needs_review');
    assert.equal(resolved.operations[0].candidateTrack.id, 'fresh-candidate');
  });

  it('applies offset to the pending resolution queue only', async () => {
    const plan = fixturePlan('Reviewed Song', 'Alice');
    plan.operations[0].status = 'needs_review';
    plan.operations.push(fixtureAdd('n-first', 'First Pending', 'Bob'));
    plan.operations.push(fixtureAdd('n-second', 'Second Pending', 'Carol'));

    const queries = [];
    const resolved = await resolveMirrorAddOperations(plan, {
      limit: 1,
      offset: 1,
      searchTracks: async (query) => {
        queries.push(query);
        return [
          normalizeTrack({
            id: 'n-2',
            title: 'Second Pending',
            artists: ['Carol'],
            album: 'Target Album',
            durationMs: 180000,
          }, 'netease'),
        ];
      },
    });

    assert.equal(queries.length, 1);
    assert.match(queries[0], /Second Pending/);
    assert.equal(resolved.operations[1].status, 'needs_resolution');
    assert.equal(resolved.operations[2].status, 'ready');
    assert.equal(resolved.addResolution.totalAdd, 3);
    assert.equal(resolved.addResolution.pendingAdd, 2);
    assert.equal(resolved.addResolution.remaining, 0);
  });
});

function fixturePlan(title, artist) {
  return {
    version: 1,
    mode: 'source_of_truth_mirror',
    generatedAt: '2026-07-06T00:00:00.000Z',
    source: { platform: 'apple', count: 1 },
    target: { platform: 'qq', playlistId: '201', count: 0 },
    thresholds: { match: 0.82, review: 0.68 },
    summary: { total: 1, add: 1, remove: 0, review: 0, keep: 0 },
    operations: [
      {
        id: 'mirror-00001',
        action: 'add',
        status: 'needs_resolution',
        sourceTrack: normalizeTrack({
          id: 'a-1',
          title,
          artists: [artist],
          album: 'Source Album',
          durationMs: 180000,
        }, 'apple'),
        targetTrack: null,
      },
    ],
  };
}

function fixtureAdd(id, title, artist) {
  return {
    id,
    action: 'add',
    status: 'needs_resolution',
    sourceTrack: normalizeTrack({
      id: `a-${id}`,
      title,
      artists: [artist],
      album: 'Source Album',
      durationMs: 180000,
    }, 'apple'),
    targetTrack: null,
  };
}
