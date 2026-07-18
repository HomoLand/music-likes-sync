import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auditTargetIdentityCollisions, guardTargetIdentityCollisions } from '../src/match-audit.js';

describe('target identity collision audit', () => {
  it('allows multiple releases of the same ISRC to collapse onto one target recording', () => {
    const result = auditTargetIdentityCollisions([
      operation('one', source('a-1', 'USAAA0000001'), target('q-1')),
      operation('two', source('a-2', 'USAAA0000001'), target('q-1')),
    ]);

    assert.equal(result.summary.collisionGroups, 1);
    assert.equal(result.summary.sameRecordingCollapses, 1);
    assert.equal(result.summary.crossRecordingCollisions, 0);
    assert.equal(result.collisions[0].relation, 'same_isrc_collapse');
  });

  it('flags different source recordings that claim the same target identity', () => {
    const result = auditTargetIdentityCollisions([
      operation('one', source('a-1', 'USAAA0000001'), target('q-1')),
      operation('two', source('a-2', 'USAAA0000002'), target('q-1')),
    ]);

    assert.equal(result.summary.crossRecordingCollisions, 1);
    assert.equal(result.collisions[0].relation, 'cross_recording_collision');
    assert.equal(result.collisions[0].needsReview, true);
  });

  it('accepts a shared MusicBrainz recording id when source ISRC values differ', () => {
    const first = source('a-1', 'USAAA0000001');
    const second = source('a-2', 'USAAA0000002');
    first.metadata = { musicbrainz: { recordingIds: ['shared-recording'] } };
    second.metadata = { musicbrainz: { recordingIds: ['shared-recording'] } };
    const result = auditTargetIdentityCollisions([
      operation('one', first, target('n-1', 'netease')),
      operation('two', second, target('n-1', 'netease')),
    ]);

    assert.equal(result.summary.sameRecordingCollapses, 1);
    assert.equal(result.collisions[0].relation, 'shared_musicbrainz_recording_collapse');
  });

  it('accepts a different-ISRC collapse only after every source mapping is explicitly kept', () => {
    const first = operation('one', source('a-1', 'USAAA0000001'), target('q-1'));
    const second = operation('two', source('a-2', 'USAAA0000002'), target('q-1'));
    first.manualDecision = { action: 'keep', source: 'ai_user_approved' };
    second.manualDecision = { action: 'keep', source: 'ai_user_approved' };

    const result = auditTargetIdentityCollisions([first, second]);

    assert.equal(result.summary.crossRecordingCollisions, 0);
    assert.equal(result.collisions[0].relation, 'explicit_keep_collapse');
  });

  it('blocks distinct source recordings that resolve to one target id', () => {
    const plan = {
      operations: [
        operation('one', source('apple-1', 'USAAA2600001'), target('qq-1')),
        operation('two', source('apple-2', 'USAAA2600002'), target('qq-1')),
      ],
    };

    const result = guardTargetIdentityCollisions(plan);

    assert.equal(result.changed, 2);
    assert.equal(result.plan.identityAudit.crossRecordingCollisions, 1);
    assert.deepEqual(result.plan.operations.map((item) => item.action), ['review', 'review']);
    assert.deepEqual(result.plan.operations.map((item) => item.status), ['needs_review', 'needs_review']);
    assert(result.plan.operations.every((item) => item.blockedReason === 'target_identity_collision'));
  });

  it('restores a stale collision guard after the target mapping changes', () => {
    const guarded = {
      ...operation('one', source('apple-1', 'USAAA2600001'), target('qq-1')),
      status: 'needs_review',
      blockedReason: 'target_identity_collision',
    };

    const result = guardTargetIdentityCollisions({ operations: [guarded] });

    assert.equal(result.changed, 1);
    assert.equal(result.plan.operations[0].action, 'keep');
    assert.equal(result.plan.operations[0].status, 'ready');
    assert.equal(result.plan.operations[0].blockedReason, '');
  });
});

function operation(id, sourceTrack, targetTrack) {
  return {
    id,
    action: 'keep',
    status: 'ready',
    sourceTrack,
    targetTrack,
    targetPlatform: targetTrack.platform,
  };
}

function source(id, isrc) {
  return {
    platform: 'apple',
    id,
    title: 'Fixture Song',
    artist: 'Fixture Artist',
    album: 'Fixture Album',
    durationMs: 180000,
    isrc,
  };
}

function target(id, platform = 'qq') {
  return {
    platform,
    id,
    title: 'Fixture Song',
    artist: 'Fixture Artist',
    album: 'Target Album',
    durationMs: 180000,
  };
}
