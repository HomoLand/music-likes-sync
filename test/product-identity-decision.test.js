import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { patchProductIdentityDecisionPlan } from '../src/product-identity-decision.js';
import { buildSyncPolicyPlan } from '../src/sync-policy.js';

describe('incremental product identity decisions', () => {
  it('turns one review into a keep without rebuilding unrelated operations', () => {
    const plan = fixturePlan();
    const unrelated = plan.operations[1];
    const result = patchProductIdentityDecisionPlan(plan, {
      operationId: 'sync-review-1',
      action: 'keep',
      decidedAt: '2026-07-19T00:00:00.000Z',
      decision: { source: 'manual' },
    });

    assert.equal(result.plan.operations.length, 2);
    assert.equal(result.plan.operations[0].id, 'sync-review-1');
    assert.equal(result.plan.operations[0].action, 'keep');
    assert.equal(result.plan.operations[0].status, 'ready');
    assert.equal(result.plan.operations[0].manualDecision.action, 'keep');
    assert.equal(result.plan.operations[0].aiReview, undefined);
    assert.equal(result.plan.operations[1], unrelated);
    assert.equal(result.plan.summary.keep, 2);
    assert.equal(result.plan.summary.review, 0);
    assert.equal(result.plan.childPlans[0].summary.keep, 2);
    assert.equal(result.plan.generatedAt, '2026-07-19T00:00:00.000Z');
  });

  it('creates a stable add and remove pair for a separate decision', () => {
    const result = patchProductIdentityDecisionPlan(fixturePlan(), {
      operationId: 'sync-review-1',
      action: 'separate',
      decidedAt: '2026-07-19T00:01:00.000Z',
      decision: { source: 'manual' },
    });
    const decided = result.plan.operations.filter((operation) => operation.decisionKey === 'review-key-1');

    assert.deepEqual(decided.map((operation) => operation.action), ['add', 'remove']);
    assert.deepEqual(decided.map((operation) => operation.id), ['sync-review-1-add', 'sync-review-1-remove']);
    assert.equal(decided[0].sourceTrack.id, 'a1');
    assert.equal(decided[0].targetTrack, null);
    assert.equal(decided[1].sourceTrack, null);
    assert.equal(decided[1].targetTrack.id, 'q1');
    assert.equal(decided.every((operation) => operation.manualDecision.action === 'separate'), true);
    assert.equal(result.plan.summary.add, 1);
    assert.equal(result.plan.summary.remove, 1);
    assert.equal(result.plan.summary.review, 0);
  });

  it('restores one review from a previously separated pair', () => {
    const separated = patchProductIdentityDecisionPlan(fixturePlan(), {
      operationId: 'sync-review-1',
      action: 'separate',
      decidedAt: '2026-07-19T00:01:00.000Z',
      decision: { source: 'manual' },
    }).plan;
    const restored = patchProductIdentityDecisionPlan(separated, {
      operationId: 'sync-review-1-add',
      action: 'clear',
      decidedAt: '2026-07-19T00:02:00.000Z',
    }).plan;
    const group = restored.operations.filter((operation) => operation.decisionKey === 'review-key-1');

    assert.equal(group.length, 1);
    assert.equal(group[0].id, 'sync-review-1-add');
    assert.equal(group[0].action, 'review');
    assert.equal(group[0].status, 'needs_review');
    assert.equal(group[0].sourceTrack.id, 'a1');
    assert.equal(group[0].targetTrack.id, 'q1');
    assert.equal(group[0].manualDecision, undefined);
    assert.equal(restored.summary.review, 1);
  });

  it('recovers a source track when an older remove-only decision did not retain it', () => {
    const plan = fixturePlan();
    const decisionKey = 'review|target_uncertain_orphan|apple:a1:song artist fixture album 180000|qq:q1:song live artist fixture album 181000';
    plan.operations[0] = {
      ...plan.operations[0],
      id: 'sync-remove-only',
      decisionKey,
      action: 'remove',
      status: 'ready',
      destructive: true,
      reason: 'manual_separate_remove',
      sourceTrack: null,
      manualDecision: {
        key: decisionKey,
        action: 'separate',
        originalAction: 'review',
        originalReason: 'target_uncertain_orphan',
      },
    };
    plan.operations[1] = {
      ...plan.operations[1],
      sourceTrack: track('apple', 'a1', 'Song', 'Artist', 180000),
    };
    const restored = patchProductIdentityDecisionPlan(plan, {
      operationId: 'sync-remove-only',
      action: 'clear',
      decidedAt: '2026-07-19T00:02:30.000Z',
    }).plan.operations.find((operation) => operation.decisionKey === decisionKey);

    assert.equal(restored.action, 'review');
    assert.equal(restored.sourceTrack.id, 'a1');
    assert.equal(restored.targetTrack.id, 'q1');
  });

  it('matches a full canonical rebuild for keep, separate, and clear action shapes', () => {
    const sourceSnapshot = snapshot('apple', [track('apple', 'a1', 'Night Drive', 'Alice', 180000)]);
    const targetSnapshot = snapshot('netease', [track('netease', 'n1', 'Night Drive Acoustic', 'Alice', 190000)]);
    const input = {
      generatedAt: '2026-07-19T00:00:00.000Z',
      policy: 'canonical_mirror',
      source: 'apple',
      targets: ['netease'],
      snapshots: { apple: sourceSnapshot, netease: targetSnapshot },
    };
    const undecided = buildSyncPolicyPlan(input);
    const review = undecided.operations.find((operation) => operation.action === 'review');
    assert(review);

    for (const action of ['keep', 'separate']) {
      const decision = {
        key: review.decisionKey,
        action,
        target: 'netease',
        decidedAt: '2026-07-19T00:03:00.000Z',
      };
      const patched = patchProductIdentityDecisionPlan(undecided, {
        operationId: review.id,
        action,
        decidedAt: decision.decidedAt,
        decision,
      }).plan;
      const rebuilt = buildSyncPolicyPlan({
        ...input,
        reviewDecisions: { items: { [review.decisionKey]: decision } },
      });
      assert.deepEqual(decisionShape(patched, review.decisionKey), decisionShape(rebuilt, review.decisionKey));

      const decidedOperation = patched.operations.find((operation) => operation.decisionKey === review.decisionKey);
      const cleared = patchProductIdentityDecisionPlan(patched, {
        operationId: decidedOperation.id,
        action: 'clear',
        decidedAt: '2026-07-19T00:04:00.000Z',
      }).plan;
      assert.deepEqual(decisionShape(cleared, review.decisionKey), decisionShape(undecided, review.decisionKey));
    }
  });
});

function fixturePlan() {
  const operations = [
    {
      id: 'sync-review-1',
      decisionKey: 'review-key-1',
      action: 'review',
      status: 'needs_review',
      destructive: false,
      reason: 'source_uncertain_match',
      reviewKind: '',
      message: 'Review this version.',
      policy: 'canonical_mirror',
      sourcePlatform: 'apple',
      targetPlatform: 'qq',
      sourceTrack: track('apple', 'a1', 'Song', 'Artist', 180000),
      targetTrack: track('qq', 'q1', 'Song (Live)', 'Artist', 181000),
      candidateTrack: null,
      resolvedTargetTrack: null,
      blockedReason: '',
      aiReview: { recommendedAction: 'keep', confidence: 0.9 },
    },
    {
      id: 'sync-keep-2',
      decisionKey: 'keep-key-2',
      action: 'keep',
      status: 'ready',
      destructive: false,
      reason: 'matched',
      policy: 'canonical_mirror',
      sourcePlatform: 'apple',
      targetPlatform: 'qq',
      sourceTrack: track('apple', 'a2', 'Other Song', 'Artist', 200000),
      targetTrack: track('qq', 'q2', 'Other Song', 'Artist', 200000),
    },
  ];
  return {
    version: 1,
    mode: 'policy_sync',
    policy: 'canonical_mirror',
    generatedAt: '2026-07-18T00:00:00.000Z',
    participants: ['apple', 'qq'],
    source: { platform: 'apple' },
    targets: ['qq'],
    thresholds: { match: 0.82, review: 0.68 },
    childPlans: [{ target: 'qq', generatedAt: '2026-07-18T00:00:00.000Z', summary: {} }],
    operations,
    summary: { total: 2, keep: 1, add: 0, remove: 0, review: 1 },
  };
}

function decisionShape(plan, decisionKey) {
  return plan.operations
    .filter((operation) => operation.decisionKey === decisionKey)
    .map((operation) => ({
      action: operation.action,
      status: operation.status,
      reason: operation.reason,
      sourceId: operation.sourceTrack?.id || null,
      targetId: operation.targetTrack?.id || null,
      manualAction: operation.manualDecision?.action || null,
    }))
    .sort((left, right) => left.action.localeCompare(right.action));
}

function snapshot(platform, tracks) {
  return {
    platform,
    source: 'fixture',
    fetchedAt: '2026-07-19T00:00:00.000Z',
    tracks,
  };
}

function track(platform, id, title, artist, durationMs) {
  return {
    platform,
    id,
    title,
    artist,
    album: 'Fixture Album',
    durationMs,
  };
}
