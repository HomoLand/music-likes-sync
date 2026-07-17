import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeSyncReviewResult } from '../src/sync-ai.js';

describe('sync AI deterministic safety gates', () => {
  it('downgrades add advice without three strong deterministic dimensions', () => {
    const result = normalizeSyncReviewResult(response('add', 0.9), batch({
      title: 1,
      artist: 0,
      album: 0.5,
      duration: 0.75,
    }));

    assert.equal(result.decisions[0].recommendedAction, 'needs_human');
    assert.equal(result.decisions[0].safety.code, 'insufficient_deterministic_support');
  });

  it('keeps supported add advice as a non-executable suggestion', () => {
    const result = normalizeSyncReviewResult(response('add', 0.9), batch({
      title: 0.8,
      artist: 0.7,
      album: 0.2,
      duration: 1,
    }));

    assert.equal(result.decisions[0].recommendedAction, 'add');
    assert.equal(result.decisions[0].safety, undefined);
  });

  it('downgrades low-confidence skip advice to human review', () => {
    const result = normalizeSyncReviewResult(response('skip', 0.2), batch({
      title: 0.2,
      artist: 0,
      album: 0,
      duration: 0.15,
    }));

    assert.equal(result.decisions[0].recommendedAction, 'needs_human');
    assert.equal(result.decisions[0].safety.code, 'low_model_confidence');
  });
});

function batch(score) {
  return {
    batch_id: 'batch-1',
    items: [{
      item_id: 'item-1',
      decision_key: 'item-1',
      cluster_id: 'cluster-1',
      target_platform: 'qq',
      algorithm_score: score,
      source_track: { title: 'Song', artist: 'Artist', duration_ms: 180000 },
      target_candidate: { title: 'Song', artist: 'Artist', duration_ms: 181000 },
      duration_delta_seconds: 1,
      match_evidence: { isrc: { relation: 'source_only' } },
    }],
  };
}

function response(action, confidence) {
  return {
    batch_id: 'batch-1',
    decisions: [{
      item_id: 'item-1',
      decision: action === 'add' ? 'accept' : 'reject',
      relation: action === 'add' ? 'same_recording' : 'different_song',
      recommended_action: action,
      confidence,
      evidence: {},
      reason: 'Fixture evidence only.',
    }],
  };
}
