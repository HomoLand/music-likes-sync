import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attachProductAddState,
  emptyProductAddState,
  guardProductAddTargetConflicts,
  mergeProductAddResolution,
  productAddAiSuggestionAlreadyApplied,
  productAddReferencesTarget,
  productRejectedAddCandidateKeys,
  productAddStateKey,
  rejectProductAddCandidateFromAi,
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

  it('clears stale AI evidence when the candidate score changes', () => {
    const merged = mergeProductAddResolution({
      action: 'add',
      status: 'needs_review',
      candidateTrack: candidate(),
      resolvedScore: score({ total: 0.7, artist: 0 }),
      aiReview: { recommendedAction: 'needs_human', confidence: 0.9 },
    }, {
      status: 'ready',
      resolvedTargetTrack: candidate(),
      resolvedScore: score({ total: 1, artist: 1, recordingFingerprint: true }),
    });

    assert.equal(merged.aiReview, null);
    assert.equal(merged.resolvedScore.total, 1);
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
      resolvedScore: score({ total: 1, artist: 1, recordingFingerprint: true }),
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
    assert.equal(restored.plan.operations[0].resolvedScore.total, 1);
  });

  it('locally revalidates a legacy localized candidate with current source aliases', () => {
    const operation = addOperation({
      sourceTrack: {
        ...addOperation().sourceTrack,
        title: '大魚',
        artist: 'Zhou Shen',
        album: '深的深',
        durationMs: 317597,
        aliases: {
          titles: ['大鱼'],
          artists: ['周深'],
          albums: ['深的深'],
        },
      },
    });
    const key = productAddStateKey(operation);
    const state = {
      version: 1,
      items: {
        [key]: {
          matcherVersion: 1,
          status: 'needs_review',
          candidateTrack: {
            platform: 'qq',
            id: 'qq-fish',
            title: '大鱼',
            artist: '周深',
            album: '深的深',
            durationMs: 317000,
          },
          aiReview: { recommendedAction: 'needs_human', confidence: 0.95 },
        },
      },
    };

    const restored = attachProductAddState({ operations: [operation] }, state).plan.operations[0];

    assert.equal(restored.status, 'ready');
    assert.equal(restored.resolvedTargetTrack.id, 'qq-fish');
    assert.equal(restored.resolvedScore.recordingFingerprint, true);
    assert.equal(restored.aiReview, null);
  });

  it('demotes a legacy auto-resolution when current rules detect an instrumental conflict', () => {
    const operation = addOperation({
      sourceTrack: {
        ...addOperation().sourceTrack,
        title: 'Horizon Dreamer',
        artist: 'Daichi Miura',
        album: 'Horizon Dreamer / Polytope',
        durationMs: 219000,
        aliases: { titles: ['Horizon Dreamer Instrumental'], artists: ['三浦大知'] },
      },
    });
    const legacyCandidate = {
      platform: 'qq',
      id: 'qq-instrumental',
      title: 'Horizon Dreamer Instrumental',
      artist: '三浦大知',
      album: 'Horizon Dreamer / Polytope',
      durationMs: 219000,
    };
    const key = productAddStateKey(operation);
    const state = {
      version: 1,
      items: {
        [key]: {
          matcherVersion: 1,
          status: 'ready',
          candidateTrack: legacyCandidate,
          resolvedTargetTrack: legacyCandidate,
          resolvedScore: score({ total: 1, artist: 1 }),
        },
      },
    };

    const restored = attachProductAddState({ operations: [operation] }, state).plan.operations[0];

    assert.equal(restored.status, 'needs_review');
    assert.equal(restored.resolvedTargetTrack, null);
    assert.equal(restored.resolution.reason, 'low_confidence_target_match');
    assert.equal(restored.resolvedScore.versionCueConflict, true);
  });

  it('moves a stale low-score cached candidate to not found under current rules', () => {
    const operation = addOperation({
      sourceTrack: {
        ...addOperation().sourceTrack,
        title: 'Rainbow',
        artist: 'Shanghai Rainbow Chamber Singers',
        durationMs: 308780,
      },
    });
    const state = {
      version: 1,
      items: {
        [productAddStateKey(operation)]: {
          key: productAddStateKey(operation),
          target: 'qq',
          source: { platform: 'apple', id: operation.sourceTrack.id },
          status: 'needs_review',
          matcherVersion: 3,
          candidateTrack: {
            platform: 'qq',
            id: 'wrong-rainbow',
            title: 'Rainbow',
            artist: 'Sia',
            album: 'Rainbow',
            durationMs: 197026,
          },
        },
      },
    };

    const restored = attachProductAddState({ operations: [operation] }, state).plan.operations[0];

    assert.equal(restored.status, 'not_found');
    assert.equal(restored.candidateTrack, null);
    assert.equal(restored.resolvedTargetTrack, null);
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

  it('keeps an accepted candidate already present in the target instead of adding then deleting it', () => {
    const ready = {
      ...addOperation(),
      status: 'ready',
      candidateTrack: candidate(),
      resolvedTargetTrack: candidate(),
      addDecision: { action: 'accept_candidate' },
    };
    const removal = {
      id: 'sync-qq-remove-existing',
      action: 'remove',
      status: 'needs_review',
      blockedReason: 'candidate_target_conflict',
      targetPlatform: 'qq',
      targetTrack: candidate(),
    };

    const guarded = guardProductAddTargetConflicts({ operations: [ready, removal] });

    assert.equal(guarded.changed, 2);
    assert.equal(guarded.plan.operations.length, 1);
    assert.equal(guarded.plan.operations[0].action, 'keep');
    assert.equal(guarded.plan.operations[0].reason, 'accepted_existing_target');
    assert.equal(guarded.plan.operations[0].targetTrack.id, 'qq-1');

    const persisted = upsertProductAddState(emptyProductAddState(), guarded.plan.operations);
    assert.equal(persisted.changed, 1);
    const restored = attachProductAddState({ operations: [addOperation()] }, persisted.state);
    assert.equal(restored.plan.operations[0].status, 'ready');
    assert.equal(restored.plan.operations[0].addDecision.action, 'accept_candidate');
    assert.equal(restored.plan.operations[0].resolvedTargetTrack.id, 'qq-1');
  });

  it('drops a removal when another source mapping explicitly keeps the same target track', () => {
    const keep = {
      id: 'sync-qq-keep-existing',
      action: 'keep',
      status: 'ready',
      sourcePlatform: 'apple',
      targetPlatform: 'qq',
      sourceTrack: { ...addOperation().sourceTrack, id: 'apple-kept' },
      targetTrack: candidate(),
    };
    const removal = {
      id: 'sync-qq-remove-separated',
      action: 'remove',
      status: 'ready',
      targetPlatform: 'qq',
      targetTrack: candidate(),
      manualDecision: { action: 'separate' },
    };

    const guarded = guardProductAddTargetConflicts({ operations: [keep, removal] });

    assert.equal(guarded.changed, 1);
    assert.deepEqual(guarded.plan.operations.map((operation) => operation.id), [keep.id]);
  });

  it('clears a candidate already judged to be a different recording for the same source', () => {
    const sourceTrack = addOperation().sourceTrack;
    const ready = {
      ...addOperation(),
      status: 'ready',
      candidateTrack: candidate(),
      resolvedTargetTrack: candidate(),
      addDecision: { action: 'accept_candidate' },
    };
    const removal = {
      id: 'sync-qq-remove-separated',
      action: 'remove',
      status: 'ready',
      targetPlatform: 'qq',
      targetTrack: candidate(),
      identityDecisionOrigin: { sourceTrack },
      manualDecision: { action: 'separate' },
    };

    const plan = { operations: [ready, removal] };
    const guarded = guardProductAddTargetConflicts(plan);

    assert.deepEqual(productRejectedAddCandidateKeys(plan, ready), ['qq:qq-1', 'qq:mid-1']);
    assert.equal(guarded.changed, 1);
    assert.equal(guarded.plan.operations[0].status, 'needs_resolution');
    assert.equal(guarded.plan.operations[0].candidateTrack, null);
    assert.equal(guarded.plan.operations[0].resolvedTargetTrack, null);
    assert.equal(guarded.plan.operations[0].resolution.reason, 'candidate_rejected_by_identity_decision');
    assert.equal(guarded.plan.operations[1].status, 'ready');
    assert.equal(productAddReferencesTarget(guarded.plan, removal), false);
  });

  it('excludes a durable separate decision after the rejected target leaves the playlist', () => {
    const operation = addOperation();
    const decisionKey = 'review|source_uncertain_match|apple:apple-1:song|qq:qq-1:song';

    const keys = productRejectedAddCandidateKeys({
      operations: [operation],
      reviewDecisions: {
        items: {
          [decisionKey]: { action: 'separate' },
        },
      },
    }, operation);

    assert.deepEqual(keys, ['qq:qq-1']);
  });

  it('does not exclude a durable target when identity decisions conflict', () => {
    const operation = addOperation();

    const keys = productRejectedAddCandidateKeys({
      operations: [operation],
      reviewDecisions: {
        items: {
          'review|source_uncertain_match|apple:apple-1:song|qq:qq-1:song': { action: 'separate' },
          'review|target_uncertain_orphan|apple:apple-1:song|qq:qq-1:song': { action: 'keep' },
        },
      },
    }, operation);

    assert.deepEqual(keys, []);
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

  it('does not block a ready addition because a lower-confidence candidate references the same track', () => {
    const ready = {
      ...addOperation({ id: 'sync-qq-add-ready' }),
      status: 'ready',
      resolvedTargetTrack: candidate(),
    };
    const pending = {
      ...addOperation({
        id: 'sync-qq-add-pending',
        sourceTrack: { ...addOperation().sourceTrack, id: 'apple-anniversary' },
      }),
      status: 'needs_review',
      candidateTrack: candidate(),
    };

    const guarded = guardProductAddTargetConflicts({ operations: [ready, pending] });

    assert.equal(guarded.changed, 0);
    assert.equal(guarded.plan.operations[0].status, 'ready');
    assert.equal(guarded.plan.operations[1].status, 'needs_review');
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

  it('unblocks a manually separated deletion after the user skips its unavailable replacement', () => {
    const skippedAdd = {
      ...addOperation(),
      status: 'blocked',
      candidateTrack: null,
      resolvedTargetTrack: null,
      addDecision: { action: 'skip' },
    };
    const removal = {
      id: 'sync-qq-remove-skipped',
      decisionKey: skippedAdd.decisionKey,
      action: 'remove',
      status: 'needs_review',
      blockedReason: 'candidate_target_conflict',
      targetPlatform: 'qq',
      targetTrack: candidate(),
      manualDecision: { action: 'separate' },
    };

    const guarded = guardProductAddTargetConflicts({ operations: [skippedAdd, removal] });

    assert.equal(guarded.changed, 1);
    assert.equal(guarded.plan.operations[1].status, 'ready');
    assert.equal(guarded.plan.operations[1].blockedReason, '');
  });

  it('clears a stale delete conflict after the candidate is no longer referenced', () => {
    const removal = {
      id: 'sync-qq-remove-stale',
      action: 'remove',
      status: 'needs_review',
      blockedReason: 'candidate_target_conflict',
      targetPlatform: 'qq',
      targetTrack: candidate(),
    };

    const guarded = guardProductAddTargetConflicts({ operations: [removal] });

    assert.equal(guarded.changed, 1);
    assert.equal(guarded.plan.operations[0].status, 'ready');
    assert.equal(guarded.plan.operations[0].blockedReason, '');
  });

  it('moves a user-approved high-confidence AI rejection out of manual review', () => {
    const operation = {
      ...addOperation(),
      status: 'needs_review',
      candidateTrack: candidate(),
      alternatives: [{ ...candidate(), id: 'qq-2' }],
    };

    const rejected = rejectProductAddCandidateFromAi(operation, {
      batchId: 'approval-1',
      decidedAt: '2026-07-18T00:00:00.000Z',
      aiBatchId: 'review-1',
      aiModel: 'fixture-model',
      aiConfidence: 0.97,
      userApprovedAt: '2026-07-18T00:00:00.000Z',
    });

    assert.equal(rejected.status, 'not_found');
    assert.equal(rejected.candidateTrack, null);
    assert.equal(rejected.alternatives[0].id, 'qq-1');
    assert.equal(rejected.addDecision.action, 'skip');
    assert.equal(rejected.addDecision.source, 'ai_user_approved');
    assert.equal(rejected.addDecision.aiConfidence, 0.97);
    assert.equal(rejected.resolution.reason, 'ai_rejected_candidate');
  });

  it('preserves a user-approved AI rejection across matcher upgrades', () => {
    const operation = addOperation();
    const key = productAddStateKey(operation);
    const state = {
      version: 1,
      items: {
        [key]: {
          matcherVersion: 1,
          status: 'not_found',
          alternatives: [candidate()],
          aiReview: {
            batchId: 'review-1',
            recommendedAction: 'skip',
            confidence: 0.97,
          },
          addDecision: {
            action: 'skip',
            source: 'ai_user_approved',
            aiBatchId: 'review-1',
          },
          resolution: { reason: 'ai_rejected_candidate' },
        },
      },
    };

    const restored = attachProductAddState({ operations: [operation] }, state).plan.operations[0];

    assert.equal(restored.status, 'not_found');
    assert.equal(restored.addDecision.source, 'ai_user_approved');
    assert.equal(restored.aiReview.batchId, 'review-1');
  });

  it('recognizes an AI suggestion already approved from the same review batch', () => {
    const operation = {
      ...addOperation(),
      aiReview: {
        batchId: 'review-1',
        recommendedAction: 'skip',
        confidence: 0.97,
      },
      addDecision: {
        action: 'skip',
        source: 'ai_user_approved',
        aiBatchId: 'review-1',
      },
    };

    assert.equal(productAddAiSuggestionAlreadyApplied(operation), true);
    assert.equal(productAddAiSuggestionAlreadyApplied({
      ...operation,
      aiReview: { ...operation.aiReview, batchId: 'review-2' },
    }), false);
  });

  it('leaves an active candidate conflict unchanged on repeated guards', () => {
    const ready = {
      ...addOperation(),
      status: 'ready',
      resolvedTargetTrack: candidate(),
    };
    const removal = {
      id: 'sync-qq-remove-active',
      action: 'remove',
      status: 'needs_review',
      blockedReason: 'candidate_target_conflict',
      targetPlatform: 'qq',
      targetTrack: candidate(),
    };

    const guarded = guardProductAddTargetConflicts({ operations: [ready, removal] });

    assert.equal(guarded.changed, 1);
    assert.equal(guarded.plan.operations[0].status, 'needs_review');
    assert.equal(guarded.plan.operations[1], removal);
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

function score(overrides = {}) {
  return {
    total: 1,
    title: 1,
    artist: 1,
    album: 1,
    duration: 1,
    isrc: 0,
    isrcConflict: false,
    recordingFingerprint: false,
    versionCueConflict: false,
    ...overrides,
  };
}
