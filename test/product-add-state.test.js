import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attachProductAddState,
  emptyProductAddState,
  guardProductAddTargetConflicts,
  mergeProductAddResolution,
  productAddReferencesTarget,
  productAddStateKey,
  upsertProductAddState,
} from '../src/product-add-state.js';

describe('product add state', () => {
  it('clears stale AI approval when catalog resolution selects a different candidate', () => {
    const operation = {
      id: 'sync-qq-1',
      action: 'add',
      status: 'needs_review',
      candidateTrack: { platform: 'qq', id: 'old-id', title: 'Song' },
      aiReview: { recommendedAction: 'add', confidence: 0.98 },
      addDecision: { action: 'accept_candidate', source: 'ai_user_approved' },
      blockedReason: 'candidate_target_conflict',
      alternatives: [{ platform: 'qq', id: 'old-alt' }],
    };

    const merged = mergeProductAddResolution(operation, {
      status: 'needs_review',
      candidateTrack: { platform: 'qq', id: 'new-id', title: 'Song' },
      alternatives: [{ platform: 'qq', id: 'new-alt' }],
    });

    assert.equal(merged.candidateTrack.id, 'new-id');
    assert.equal(merged.aiReview, null);
    assert.equal(merged.addDecision, null);
    assert.equal(merged.blockedReason, '');
    assert.equal(merged.alternatives[0].id, 'new-alt');
  });

  it('keeps review evidence when the provider candidate identity is unchanged', () => {
    const aiReview = { recommendedAction: 'needs_human', confidence: 0.7 };
    const operation = {
      action: 'add',
      status: 'needs_review',
      candidateTrack: { platform: 'netease', id: 'same-id', title: 'Old title' },
      aiReview,
    };

    const merged = mergeProductAddResolution(operation, {
      status: 'needs_review',
      candidateTrack: { platform: 'netease', id: 'same-id', title: 'Updated title' },
    });

    assert.equal(merged.aiReview, aiReview);
  });

  it('removes stale candidate evidence when a fresh search finds nothing', () => {
    const merged = mergeProductAddResolution({
      action: 'add',
      status: 'needs_review',
      candidateTrack: { platform: 'qq', id: 'stale-id' },
      aiReview: { recommendedAction: 'add', confidence: 0.99 },
    }, {
      status: 'not_found',
      alternatives: [],
    });

    assert.equal(merged.candidateTrack, null);
    assert.equal(merged.resolvedTargetTrack, null);
    assert.equal(merged.aiReview, null);
  });

  it('initializes cleanly when the state file does not exist yet', () => {
    const persisted = upsertProductAddState(null, [{
      ...addOperation(),
      status: 'not_found',
      resolution: { reason: 'not_found' },
    }], { updatedAt: '2026-07-12T00:00:00.000Z' });

    assert.equal(persisted.changed, 1);
    assert.equal(Object.keys(persisted.state.items).length, 1);
  });

  it('uses a stable source-and-target key across regenerated operation ids', () => {
    const first = addOperation({ id: 'sync-qq-old' });
    const regenerated = addOperation({ id: 'sync-qq-new', decisionKey: 'changed-review-pair' });

    assert.equal(productAddStateKey(first), productAddStateKey(regenerated));
    assert.notEqual(
      productAddStateKey(first),
      productAddStateKey(addOperation({ targetPlatform: 'netease' })),
    );
  });

  it('restores accepted candidates and AI provenance after preview regeneration', () => {
    const accepted = {
      ...addOperation(),
      status: 'ready',
      candidateTrack: candidate(),
      resolvedTargetTrack: candidate(),
      aiReview: { recommendedAction: 'add', confidence: 0.97 },
      addDecision: { action: 'accept_candidate', source: 'ai_user_approved' },
    };
    const persisted = upsertProductAddState(emptyProductAddState(), [accepted], {
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    const plan = {
      operations: [addOperation({ id: 'sync-qq-regenerated' })],
    };

    const restored = attachProductAddState(plan, persisted.state);

    assert.equal(restored.changed, 1);
    assert.equal(restored.plan.operations[0].status, 'ready');
    assert.equal(restored.plan.operations[0].resolvedTargetTrack.id, 'qq-1');
    assert.equal(restored.plan.operations[0].addDecision.source, 'ai_user_approved');
  });

  it('does not attach saved add state to non-add operations', () => {
    const persisted = upsertProductAddState(emptyProductAddState(), [{
      ...addOperation(),
      status: 'not_found',
      resolution: { reason: 'not_found' },
    }]);
    const review = { ...addOperation(), action: 'review', status: 'needs_review' };

    const restored = attachProductAddState({ operations: [review] }, persisted.state);

    assert.equal(restored.changed, 0);
    assert.equal(restored.plan.operations[0].action, 'review');
  });

  it('blocks an add/delete loop when the selected candidate is already a target operation', () => {
    const ready = {
      ...addOperation(),
      status: 'ready',
      candidateTrack: candidate(),
      resolvedTargetTrack: candidate(),
      addDecision: { action: 'accept_candidate' },
    };
    const removal = {
      id: 'sync-qq-remove-1',
      action: 'remove',
      status: 'ready',
      targetPlatform: 'qq',
      targetTrack: candidate(),
    };

    const guarded = guardProductAddTargetConflicts({ operations: [ready, removal] });

    assert.equal(guarded.changed, 2);
    assert.equal(guarded.plan.operations[0].status, 'needs_review');
    assert.equal(guarded.plan.operations[0].blockedReason, 'candidate_target_conflict');
    assert.equal(guarded.plan.operations[1].status, 'needs_review');
    assert.equal(guarded.plan.operations[1].blockedReason, 'candidate_target_conflict');
    assert.equal(productAddReferencesTarget(guarded.plan, removal), true);
  });

  it('blocks two additions from claiming the same provider track', () => {
    const first = {
      ...addOperation({ id: 'sync-qq-add-1' }),
      status: 'ready',
      resolvedTargetTrack: candidate(),
    };
    const second = {
      ...addOperation({
        id: 'sync-qq-add-2',
        sourceTrack: { ...addOperation().sourceTrack, id: 'apple-2' },
      }),
      status: 'ready',
      resolvedTargetTrack: candidate(),
    };

    const guarded = guardProductAddTargetConflicts({ operations: [first, second] });

    assert.equal(guarded.changed, 2);
    assert.deepEqual(guarded.plan.operations.map((operation) => operation.status), ['needs_review', 'needs_review']);
  });

  it('keeps a manually separated deletion in review until its replacement is ready', () => {
    const pendingAdd = {
      ...addOperation(),
      status: 'not_found',
      candidateTrack: null,
      resolvedTargetTrack: null,
    };
    const removal = {
      id: 'sync-qq-remove-pending',
      decisionKey: pendingAdd.decisionKey,
      action: 'remove',
      status: 'ready',
      targetPlatform: 'qq',
      targetTrack: candidate(),
      manualDecision: { action: 'separate' },
    };

    const guarded = guardProductAddTargetConflicts({ operations: [pendingAdd, removal] });

    assert.equal(guarded.changed, 1);
    assert.equal(guarded.plan.operations[1].status, 'needs_review');
  });
});

function addOperation(overrides = {}) {
  return {
    id: 'sync-qq-1',
    decisionKey: 'review-pair-1',
    action: 'add',
    status: 'needs_resolution',
    sourcePlatform: 'apple',
    targetPlatform: 'qq',
    sourceTrack: {
      platform: 'apple',
      id: 'apple-1',
      isrc: 'TEST00000001',
      title: 'Fixture Song',
      artist: 'Fixture Artist',
      album: 'Fixture Album',
      durationMs: 180000,
    },
    ...overrides,
  };
}

function candidate() {
  return {
    platform: 'qq',
    id: 'qq-1',
    mid: 'mid-1',
    songType: 13,
    title: 'Fixture Song',
    artist: 'Fixture Artist',
    album: 'Fixture Album',
    durationMs: 180000,
  };
}
