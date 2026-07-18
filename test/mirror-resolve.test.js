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

  it('does not propose a provider track already judged to be a different recording', async () => {
    const plan = fixturePlan('New Song', 'Alice');
    const resolved = await resolveMirrorAddOperations(plan, {
      searchTracks: async () => [
        normalizeTrack({
          id: 'q-rejected',
          title: 'New Song',
          artists: ['Alice'],
          album: 'Target Album',
          durationMs: 180500,
        }, 'qq'),
        normalizeTrack({
          id: 'q-replacement',
          title: 'New Song',
          artists: ['Alice'],
          album: 'Target Album',
          durationMs: 180500,
        }, 'qq'),
      ],
      excludedCandidateKeysByOperationId: {
        'mirror-00001': ['qq:q-rejected'],
      },
    });

    assert.equal(resolved.operations[0].status, 'ready');
    assert.equal(resolved.operations[0].resolvedTargetTrack.id, 'q-replacement');
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
          durationMs: 195000,
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

  it('classifies clearly unrelated search results as not found', async () => {
    const plan = fixturePlan('New Song', 'Alice');
    const resolved = await resolveMirrorAddOperations(plan, {
      searchTracks: async () => [
        normalizeTrack({
          id: 'n-wrong',
          title: 'Completely Different',
          artists: ['Someone Else'],
          album: 'Unrelated Album',
          durationMs: 42000,
        }, 'netease'),
      ],
    });

    const operation = resolved.operations[0];
    assert.equal(operation.status, 'not_found');
    assert.equal(operation.candidateTrack, null);
    assert.equal(operation.resolution.reason, 'target_catalog_low_score');
    assert.equal(resolved.addResolution.review, 0);
    assert.equal(resolved.addResolution.notFound, 1);
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

    assert(queries.length >= 1);
    assert(queries.every((query) => /Resolvable Song/.test(query)));
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
          durationMs: 195000,
        }, 'qq'),
      ],
    });

    assert.equal(resolved.addResolution.processed, 1);
    assert.equal(resolved.operations[0].status, 'needs_review');
    assert.equal(resolved.operations[0].candidateTrack.id, 'fresh-candidate');
  });

  it('refreshes a stale resolved target when the operation is not ready', async () => {
    const plan = fixturePlan('New Song', 'Alice');
    plan.operations[0].status = 'needs_review';
    plan.operations[0].resolvedTargetTrack = normalizeTrack({
      id: 'stale-resolved',
      title: 'Old Candidate',
      artists: ['Someone Else'],
      durationMs: 40000,
    }, 'qq');

    const resolved = await resolveMirrorAddOperations(plan, {
      refresh: true,
      searchTracks: async () => [
        normalizeTrack({
          id: 'fresh-resolved',
          title: 'New Song',
          artists: ['Alice'],
          album: 'Source Album',
          durationMs: 180000,
        }, 'qq'),
      ],
    });

    assert.equal(resolved.addResolution.processed, 1);
    assert.equal(resolved.operations[0].status, 'ready');
    assert.equal(resolved.operations[0].resolvedTargetTrack.id, 'fresh-resolved');
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

    assert(queries.length >= 1);
    assert(queries.every((query) => /Second Pending/.test(query)));
    assert.equal(resolved.operations[1].status, 'needs_resolution');
    assert.equal(resolved.operations[2].status, 'ready');
    assert.equal(resolved.addResolution.totalAdd, 3);
    assert.equal(resolved.addResolution.pendingAdd, 2);
    assert.equal(resolved.addResolution.remaining, 0);
  });

  it('finds a target through a trusted localized Apple storefront query', async () => {
    const plan = fixturePlan('Ai Ren Cuo Guo', 'Accusefive');
    plan.operations[0].sourceTrack = normalizeTrack({
      ...plan.operations[0].sourceTrack,
      durationMs: 292075,
      isrc: 'TWEXAMPLE001',
      aliases: {
        titles: ['爱人错过'],
        artists: ['告五人'],
        albums: ['我肯定在几百年前就说过爱你'],
      },
      metadata: {
        appleStorefronts: {
          equivalents: [{
            storefront: 'cn',
            id: 'cn-1',
            title: '爱人错过',
            artist: '告五人',
            album: '我肯定在几百年前就说过爱你',
            durationMs: 292075,
            isrc: 'TWEXAMPLE001',
            trackNumber: 1,
            discNumber: 1,
            releaseDate: '2019-06-14',
            isrcMatch: true,
            aliasTrusted: true,
          }],
        },
      },
    }, 'apple');
    const queries = [];

    const resolved = await resolveMirrorAddOperations(plan, {
      searchTracks: async (query) => {
        queries.push(query);
        if (!query.includes('爱人错过')) return [];
        return [normalizeTrack({
          id: 'q-localized',
          title: '爱人错过',
          artists: ['告五人'],
          album: '我肯定在几百年前就说过爱你',
          durationMs: 292000,
          metadata: {
            providerCatalog: {
              trackNumber: 1,
              discNumber: 1,
              releaseDate: '2019-06-14',
            },
          },
        }, 'qq')];
      },
    });

    const operation = resolved.operations[0];
    assert.equal(queries[0], '爱人错过 告五人');
    assert.equal(operation.status, 'ready');
    assert.equal(operation.resolvedTargetTrack.id, 'q-localized');
    assert.equal(operation.resolvedScore.appleEquivalentFingerprint, true);
    assert(operation.resolution.searchStrategies.includes('apple_storefront_title_artist'));
  });

  it('ranks alternatives by match evidence instead of provider result order', async () => {
    const plan = fixturePlan('New Song', 'Alice');
    const resolved = await resolveMirrorAddOperations(plan, {
      searchTracks: async () => [
        normalizeTrack({
          id: 'wrong',
          title: 'Different Song',
          artists: ['Someone Else'],
          album: 'Wrong Album',
          durationMs: 45000,
        }, 'qq'),
        normalizeTrack({
          id: 'near',
          title: 'New Song Acoustic',
          artists: ['Alice'],
          album: 'Source Album',
          durationMs: 195000,
        }, 'qq'),
        normalizeTrack({
          id: 'exact',
          title: 'New Song',
          artists: ['Alice'],
          album: 'Source Album',
          durationMs: 180000,
        }, 'qq'),
      ],
    });

    const operation = resolved.operations[0];
    assert.equal(operation.resolvedTargetTrack.id, 'exact');
    assert.equal(operation.alternatives[0].id, 'near');
    assert(!operation.alternatives.some((item) => item.id === 'wrong'));
    assert(operation.alternatives[0].match.score.total < operation.resolvedTargetTrack.match.score.total);
    assert.equal(operation.resolvedTargetTrack.match.rank, 1);
  });

  it('keeps close non-authoritative candidates in review', async () => {
    const plan = fixturePlan('New Song', 'Alice');
    const resolved = await resolveMirrorAddOperations(plan, {
      searchTracks: async () => [
        normalizeTrack({
          id: 'best',
          title: 'New Song',
          artists: ['Alice'],
          album: 'Target Album',
          durationMs: 180000,
        }, 'qq'),
        normalizeTrack({
          id: 'close',
          title: 'New Song',
          artists: ['Alice B'],
          album: 'Target Album',
          durationMs: 180000,
        }, 'qq'),
      ],
    });

    const operation = resolved.operations[0];
    assert.equal(operation.status, 'needs_review');
    assert.equal(operation.resolution.reason, 'close_competing_candidates');
    assert(operation.resolvedScore.scoreMargin < 0.04);
    assert.equal(operation.resolvedScore.candidateCount, 2);
  });

  it('keeps a timed-out catalog search in review instead of classifying it as missing', async () => {
    const plan = fixturePlan('Slow Search', 'Fixture Artist');
    const resolved = await resolveMirrorAddOperations(plan, {
      queryLimit: 1,
      queryConcurrency: 1,
      searchTimeoutMs: 50,
      searchTracks: () => new Promise(() => {}),
    });

    const operation = resolved.operations[0];
    assert.equal(operation.status, 'needs_review');
    assert.equal(operation.resolution.reason, 'target_catalog_search_incomplete');
    assert.equal(operation.resolution.queryErrorCount, 1);
    assert.deepEqual(operation.resolution.searchErrorCodes, ['timeout']);
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
