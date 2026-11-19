import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attachProductIdentityReviewSuggestions,
  buildProductIdentityReviewOperations,
  productIdentityDecisionKey,
  productIdentityDecisionState,
  summarizeProductIdentityReview,
  upsertProductIdentityReviewResult,
} from '../src/product-identity-review.js';

describe('product identity AI review drafts', () => {
  it('selects only unresolved cross-platform identity conflicts', () => {
    const plan = fixturePlan();
    const operations = buildProductIdentityReviewOperations(plan, {
      operationIds: ['sync-qq-review', 'sync-qq-add'],
      targets: ['qq'],
      limit: 10,
    });

    assert.equal(operations.length, 1);
    assert.equal(operations[0].id, 'sync-qq-review');
    assert.match(operations[0].decisionKey, /^review\|source_uncertain_match\|/);
  });

  it('persists and reattaches AI suggestions without changing execution actions', () => {
    const plan = fixturePlan();
    const decisionKey = productIdentityDecisionKey(plan.operations[0]);
    const persisted = upsertProductIdentityReviewResult({}, {
      batchId: 'identity-batch-1',
      model: 'fixture-model',
      reviewedAt: '2026-07-11T00:00:00.000Z',
      decisions: [{
        itemId: decisionKey,
        decisionKey,
        operationId: 'sync-qq-review',
        target: 'qq',
        decision: 'same',
        relation: 'same_recording',
        recommendedAction: 'keep',
        confidence: 0.97,
        evidence: { external: 'same ISRC' },
        reason: 'The supplied identifiers and duration agree.',
      }],
    });
    const attached = attachProductIdentityReviewSuggestions(plan, persisted.state);
    const operation = attached.operations[0];

    assert.equal(persisted.changed, 1);
    assert.equal(operation.action, 'review');
    assert.equal(operation.status, 'needs_review');
    assert.equal(operation.aiReview.recommendedAction, 'keep');
    assert.equal(operation.aiReview.confidence, 0.97);
    assert.equal(attached.identityAiReview.latest.keep, 1);
  });

  it('summarizes keep, separate, human and guarded outcomes', () => {
    assert.deepEqual(summarizeProductIdentityReview([
      { recommendedAction: 'keep' },
      { recommendedAction: 'separate' },
      { recommendedAction: 'needs_human', safety: { guarded: true } },
    ]), {
      total: 3,
      keep: 1,
      separate: 1,
      needsHuman: 1,
      guarded: 1,
    });
  });

  it('keeps legacy AI-applied decisions advisory in the ordinary-user workflow', () => {
    const state = productIdentityDecisionState({
      updatedAt: '2026-07-11T00:00:00.000Z',
      items: {
        manual: { key: 'manual', action: 'keep' },
        legacyAi: { key: 'legacyAi', action: 'separate', aiAppliedAt: '2026-07-10T00:00:00.000Z' },
      },
    });

    assert.deepEqual(Object.keys(state.items), ['manual']);
  });
});

function fixturePlan() {
  return {
    version: 1,
    policy: 'canonical_mirror',
    operations: [
      {
        id: 'sync-qq-review',
        action: 'review',
        status: 'needs_review',
        reason: 'source_uncertain_match',
        sourcePlatform: 'apple',
        targetPlatform: 'qq',
        sourceTrack: track('apple', 'a1'),
        targetTrack: track('qq', 'q1'),
      },
      {
        id: 'sync-qq-add',
        action: 'add',
        status: 'needs_review',
        sourcePlatform: 'apple',
        targetPlatform: 'qq',
        sourceTrack: track('apple', 'a2'),
        candidateTrack: track('qq', 'q2'),
      },
      {
        id: 'sync-netease-reviewed',
        action: 'review',
        status: 'needs_review',
        sourcePlatform: 'apple',
        targetPlatform: 'netease',
        sourceTrack: track('apple', 'a3'),
        targetTrack: track('netease', 'n3'),
        aiReview: { recommendedAction: 'needs_human' },
      },
    ],
  };
}

function track(platform, id) {
  return {
    platform,
    id,
    title: 'Fixture Song',
    artist: 'Fixture Artist',
    album: 'Fixture Album',
    durationMs: 180000,
  };
}
