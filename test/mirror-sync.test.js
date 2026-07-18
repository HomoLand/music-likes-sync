import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMirrorSyncPlan, summarizeMirrorConvergence } from '../src/mirror-sync.js';
import { normalizeTrack } from '../src/normalize.js';

describe('mirror sync plan', () => {
  it('builds an Apple source-of-truth add/remove/keep plan for a target library', () => {
    const plan = buildMirrorSyncPlan({
      target: 'qq',
      sourceSnapshot: snapshot('apple', [
        track('apple', 'a-1', 'Already There', 'Alice', 180000),
        track('apple', 'a-2', 'New Day', 'Bob', 210000),
      ]),
      targetSnapshot: snapshot('qq', [
        track('qq', 'q-1', 'Already There', 'Alice', 181000),
        track('qq', 'q-2', 'Old Target Only', 'Carol', 200000),
      ]),
    });

    assert.equal(plan.mode, 'source_of_truth_mirror');
    assert.equal(plan.source.platform, 'apple');
    assert.equal(plan.target.platform, 'qq');
    assert.equal(plan.summary.keep, 1);
    assert.equal(plan.summary.add, 1);
    assert.equal(plan.summary.remove, 1);
    assert.equal(plan.summary.review, 0);
    assert.equal(plan.summary.destructive, 1);

    const add = plan.operations.find((operation) => operation.action === 'add');
    assert.equal(add.sourceTrack.title, 'New Day');
    assert.equal(add.targetTrack, null);
    assert.equal(add.destructive, false);

    const remove = plan.operations.find((operation) => operation.action === 'remove');
    assert.equal(remove.targetTrack.title, 'Old Target Only');
    assert.equal(remove.sourceTrack, null);
    assert.equal(remove.destructive, true);
  });

  it('blocks uncertain matches instead of adding or deleting around them', () => {
    const plan = buildMirrorSyncPlan({
      target: 'netease',
      sourceSnapshot: snapshot('apple', [
        track('apple', 'a-1', 'Night Drive', 'Alice', 180000),
      ]),
      targetSnapshot: snapshot('netease', [
        track('netease', 'n-1', 'Night Drive Acoustic', 'Alice', 240000),
      ]),
    });

    assert.equal(plan.summary.review, 1);
    assert.equal(plan.summary.add, 0);
    assert.equal(plan.summary.remove, 0);
    assert.equal(plan.summary.blocked, 1);
    assert.equal(plan.operations[0].reason, 'source_uncertain_match');
  });

  it('turns a manually kept review item into a safe keep operation', () => {
    const input = {
      target: 'netease',
      sourceSnapshot: snapshot('apple', [
        track('apple', 'a-1', 'Night Drive', 'Alice', 180000),
      ]),
      targetSnapshot: snapshot('netease', [
        track('netease', 'n-1', 'Night Drive Acoustic', 'Alice', 240000),
      ]),
    };
    const reviewPlan = buildMirrorSyncPlan(input);
    const key = reviewPlan.operations[0].decisionKey;

    const plan = buildMirrorSyncPlan({
      ...input,
      reviewDecisions: {
        version: 1,
        items: {
          [key]: {
            key,
            action: 'keep',
            target: 'netease',
            decidedAt: '2026-07-07T00:00:00.000Z',
            updatedAt: '2026-07-07T00:00:00.000Z',
          },
        },
      },
    });

    assert.equal(plan.summary.review, 0);
    assert.equal(plan.summary.keep, 1);
    assert.equal(plan.summary.destructive, 0);
    assert.equal(plan.operations[0].action, 'keep');
    assert.equal(plan.operations[0].manualDecision.action, 'keep');
    assert.equal(plan.operations[0].manualDecision.originalReason, 'source_uncertain_match');
  });

  it('turns a manually separated source review into add and confirmed-delete plan items', () => {
    const input = {
      target: 'netease',
      sourceSnapshot: snapshot('apple', [
        track('apple', 'a-1', 'Night Drive', 'Alice', 180000),
      ]),
      targetSnapshot: snapshot('netease', [
        track('netease', 'n-1', 'Night Drive Acoustic', 'Alice', 240000),
      ]),
    };
    const reviewPlan = buildMirrorSyncPlan(input);
    const key = reviewPlan.operations[0].decisionKey;

    const plan = buildMirrorSyncPlan({
      ...input,
      reviewDecisions: {
        version: 1,
        items: {
          [key]: {
            key,
            action: 'separate',
            target: 'netease',
            decidedAt: '2026-07-07T00:00:00.000Z',
            updatedAt: '2026-07-07T00:00:00.000Z',
          },
        },
      },
    });

    assert.equal(plan.summary.review, 0);
    assert.equal(plan.summary.add, 1);
    assert.equal(plan.summary.remove, 1);
    assert.equal(plan.summary.destructive, 1);
    assert.equal(plan.operations.find((operation) => operation.action === 'add').status, 'needs_resolution');
    assert.equal(plan.operations.find((operation) => operation.action === 'remove').status, 'ready');
    assert.equal(plan.operations.every((operation) => operation.manualDecision?.action === 'separate'), true);
  });

  it('marks duplicate target matches for review', () => {
    const plan = buildMirrorSyncPlan({
      target: 'qq',
      sourceSnapshot: snapshot('apple', [
        track('apple', 'a-1', 'Shared Song', 'Alice', 180000),
        track('apple', 'a-2', 'Shared Song', 'Alice', 180500),
      ]),
      targetSnapshot: snapshot('qq', [
        track('qq', 'q-1', 'Shared Song', 'Alice', 180000),
      ]),
    });

    assert.equal(plan.summary.review, 2);
    assert.equal(plan.summary.keep, 0);
    assert.equal(plan.summary.add, 0);
    assert.equal(plan.summary.remove, 0);
    assert.deepEqual(
      plan.operations.map((operation) => operation.reason),
      ['duplicate_target_match', 'duplicate_target_match'],
    );
  });

  it('labels an extra target entry as a possible duplicate after keeping the best match', () => {
    const source = normalizeTrack({
      id: 'a-1',
      title: 'Restore',
      artists: ['Artist'],
      album: 'Restore - EP',
      durationMs: 281887,
    }, 'apple');
    const best = normalizeTrack({
      id: 'q-best',
      title: 'Restore',
      artists: ['Artist'],
      album: 'Restore',
      durationMs: 281000,
    }, 'qq');
    const extra = normalizeTrack({
      id: 'q-extra',
      title: 'Restore',
      artists: ['Artist'],
      album: '',
      durationMs: 281000,
    }, 'qq');

    const plan = buildMirrorSyncPlan({
      target: 'qq',
      sourceSnapshot: snapshot('apple', [source]),
      targetSnapshot: snapshot('qq', [best, extra]),
    });

    assert.equal(plan.summary.keep, 1);
    assert.equal(plan.summary.review, 1);
    const review = plan.operations.find((operation) => operation.action === 'review');
    assert.equal(review.reason, 'reverse_only_match');
    assert.equal(review.reviewKind, 'possible_duplicate_target');
    assert.equal(review.targetTrack.id, 'q-extra');
  });

  it('preserves source aliases and MusicBrainz evidence for mirror review operations', () => {
    const sourceTrack = normalizeTrack({
      id: 'a-1',
      title: 'Love',
      artists: ['Keyshia Cole'],
      album: 'Fixture Album',
      durationMs: 180000,
      isrc: 'USAM10500210',
      aliases: {
        artists: ['Keyshia Myeshia Cole'],
      },
      metadata: {
        musicbrainz: {
          isrc: 'USAM10500210',
          fetchedAt: '2026-07-07T00:00:00.000Z',
          status: 'ok',
          recordingIds: ['mbid-1'],
        },
      },
    }, 'apple');
    const plan = buildMirrorSyncPlan({
      target: 'netease',
      sourceSnapshot: snapshot('apple', [sourceTrack]),
      targetSnapshot: snapshot('netease', [
        track('netease', 'n-1', 'Love', 'Keyshia Myeshia Cole', 192000),
      ]),
      threshold: 0.99,
      reviewThreshold: 0.5,
    });

    const review = plan.operations.find((operation) => operation.action === 'review');
    assert(review);
    assert.equal(review.sourceTrack.aliases.artists[0], 'Keyshia Myeshia Cole');
    assert.equal(review.sourceTrack.metadata.musicbrainz.status, 'ok');
    assert.deepEqual(review.sourceTrack.metadata.musicbrainz.recordingIds, ['mbid-1']);
  });

  it('reuses explicit artist aliases across tracks by the same source artist', () => {
    const aliasedTrack = normalizeTrack({
      id: 'a-1',
      title: 'Known Song',
      artists: ['Accusefive'],
      album: 'Known Album',
      durationMs: 180000,
      aliases: { artists: ['告五人'] },
    }, 'apple');
    const sourceTrack = normalizeTrack({
      id: 'a-2',
      title: 'Night Life',
      artists: ['Accusefive'],
      album: 'Apple Single',
      durationMs: 268000,
    }, 'apple');
    const targetTrack = normalizeTrack({
      id: 'n-1',
      title: 'Night Life',
      artists: ['告五人'],
      album: 'Localized Release',
      durationMs: 268000,
    }, 'netease');

    const plan = buildMirrorSyncPlan({
      target: 'netease',
      sourceSnapshot: snapshot('apple', [aliasedTrack, sourceTrack]),
      targetSnapshot: snapshot('netease', [targetTrack]),
    });

    const keep = plan.operations.find((operation) => operation.action === 'keep');
    assert(keep);
    assert.equal(keep.sourceTrack.title, 'Night Life');
    assert(keep.sourceTrack.aliases.artists.includes('告五人'));
    assert.equal(keep.score.artist, 1);
  });

  it('rejects non-target mirror destinations', () => {
    assert.throws(
      () => buildMirrorSyncPlan({
        target: 'apple',
        sourceSnapshot: snapshot('apple', []),
        targetSnapshot: snapshot('apple', []),
      }),
      /QQ Music or NetEase/,
    );
  });

  it('summarizes open mirror convergence deltas', () => {
    const plan = buildMirrorSyncPlan({
      target: 'qq',
      sourceSnapshot: snapshot('apple', [
        track('apple', 'a-1', 'New Day', 'Bob', 210000),
      ]),
      targetSnapshot: snapshot('qq', [
        track('qq', 'q-1', 'Old Target Only', 'Carol', 200000),
      ]),
    });

    const convergence = summarizeMirrorConvergence(plan, {
      refreshedTarget: true,
      checkedAt: '2026-07-07T00:00:00.000Z',
      previousPlanGeneratedAt: '2026-07-06T00:00:00.000Z',
    });

    assert.equal(convergence.status, 'open_delta');
    assert.equal(convergence.converged, false);
    assert.equal(convergence.add, 1);
    assert.equal(convergence.remove, 1);
    assert.equal(convergence.refreshedTarget, true);
    assert.equal(convergence.previousPlanGeneratedAt, '2026-07-06T00:00:00.000Z');
  });

  it('summarizes a converged regenerated mirror plan', () => {
    const plan = buildMirrorSyncPlan({
      target: 'netease',
      sourceSnapshot: snapshot('apple', [
        track('apple', 'a-1', 'Already There', 'Alice', 180000),
      ]),
      targetSnapshot: snapshot('netease', [
        track('netease', 'n-1', 'Already There', 'Alice', 181000),
      ]),
    });

    const convergence = summarizeMirrorConvergence(plan, {
      checkedAt: '2026-07-07T00:00:00.000Z',
    });

    assert.equal(convergence.status, 'converged');
    assert.equal(convergence.converged, true);
    assert.equal(convergence.add, 0);
    assert.equal(convergence.remove, 0);
    assert.equal(convergence.review, 0);
  });
});

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:fixture`,
    fetchedAt: '2026-07-06T00:00:00.000Z',
    skipped: false,
    tracks,
  };
}

function track(platform, id, title, artist, durationMs) {
  return normalizeTrack({
    id,
    title,
    artists: [artist],
    album: 'Fixture Album',
    durationMs,
  }, platform);
}
