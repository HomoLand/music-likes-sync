import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attachProductAddReviewResult,
  buildProductAddReviewItems,
  summarizeProductAddReview,
} from '../src/product-add-review.js';

describe('product add AI review drafts', () => {
  it('selects only unresolved low-confidence add candidates', () => {
    const plan = fixturePlan();
    const items = buildProductAddReviewItems(plan, { targets: ['qq'], limit: 10 });

    assert.equal(items.length, 1);
    assert.equal(items[0].decisionKey, 'sync-qq-1');
    assert.equal(items[0].source.track.isrc, 'USAAA0000001');
    assert.equal(items[0].match.track.platform, 'qq');
  });

  it('persists sanitized suggestions as drafts without changing execution status', () => {
    const result = attachProductAddReviewResult(fixturePlan(), {
      batchId: 'batch-1',
      model: 'fixture-model',
      reviewedAt: '2026-07-11T00:00:00.000Z',
      usage: { prompt_tokens: 12, completion_tokens: 7 },
      decisions: [{
        itemId: 'sync-qq-1',
        decision: 'accept',
        relation: 'same_recording',
        recommendedAction: 'add',
        confidence: 0.96,
        evidence: { title: 'same title', artist: 'same artist' },
        reason: 'Supplied evidence supports the same recording.',
      }],
    });

    const operation = result.plan.operations[0];
    assert.equal(result.changed, 1);
    assert.equal(operation.status, 'needs_review');
    assert.equal(operation.aiReview.recommendedAction, 'add');
    assert.equal(operation.aiReview.confidence, 0.96);
    assert.equal(result.plan.addAiReview.latest.add, 1);
  });

  it('summarizes guarded and human-review outcomes', () => {
    const summary = summarizeProductAddReview([
      { recommendedAction: 'add' },
      { recommendedAction: 'skip' },
      { recommendedAction: 'needs_human', safety: { guarded: true } },
    ]);

    assert.deepEqual(summary, { total: 3, add: 1, skip: 1, needsHuman: 1, guarded: 1 });
  });
});

function fixturePlan() {
  return {
    version: 1,
    policy: 'canonical_mirror',
    operations: [
      {
        id: 'sync-qq-1',
        action: 'add',
        status: 'needs_review',
        sourcePlatform: 'apple',
        targetPlatform: 'qq',
        sourceTrack: { platform: 'apple', id: 'a1', title: 'Song', artist: 'Artist', artists: ['Artist'], isrc: 'USAAA0000001' },
        candidateTrack: { platform: 'qq', id: 'q1', title: 'Song', artist: 'Artist', artists: ['Artist'] },
        alternatives: [],
      },
      {
        id: 'sync-netease-1',
        action: 'add',
        status: 'needs_resolution',
        sourcePlatform: 'apple',
        targetPlatform: 'netease',
        sourceTrack: { platform: 'apple', id: 'a2', title: 'Other', artist: 'Artist', artists: ['Artist'] },
      },
      {
        id: 'sync-qq-keep',
        action: 'keep',
        status: 'ready',
        sourcePlatform: 'apple',
        targetPlatform: 'qq',
      },
    ],
  };
}
