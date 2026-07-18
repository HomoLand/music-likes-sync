import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMirrorReviewBatch, normalizeMirrorReviewResult } from '../src/mirror-ai.js';

describe('mirror AI review payloads', () => {
  it('sends MusicBrainz evidence and deterministic risk signals for mirror review operations', () => {
    const batch = buildMirrorReviewBatch([fixtureOperation()], { batchId: 'mirror-ai-test' });
    const item = batch.items[0];

    assert.equal(item.decision_key, 'review-key-1');
    assert.equal(item.source_track.external_evidence.musicbrainz.status, 'ok');
    assert.deepEqual(item.source_track.external_evidence.musicbrainz.recording_ids, ['mbid-1']);
    assert.equal(item.match_evidence.duration_delta_seconds, 37);
    assert(item.match_evidence.risk_signals.includes('duration_over_20_seconds'));
    assert(item.match_evidence.risk_signals.includes('version_cue_conflict'));
  });

  it('downgrades unsafe keep suggestions to needs_human', () => {
    const batch = buildMirrorReviewBatch([fixtureOperation()], { batchId: 'mirror-ai-test' });
    const result = normalizeMirrorReviewResult({
      batch_id: 'mirror-ai-test',
      decisions: [{
        item_id: 'review-key-1',
        decision_key: 'review-key-1',
        operation_id: 'mirror-00001',
        decision: 'same',
        relation: 'same_recording',
        confidence: 0.98,
        recommended_action: 'keep',
        evidence: {
          title: 'same title',
          artist: 'artist alias',
          duration: '37 seconds apart',
          version: 'target live wording differs',
        },
        reason: 'same title and likely artist alias despite version label',
      }],
    }, batch);

    assert.equal(result.decisions[0].recommendedAction, 'needs_human');
    assert.equal(result.decisions[0].safety.code, 'duration_delta');
  });

  it('keeps a supported localized-name suggestion without a safety downgrade', () => {
    const operation = {
      id: 'mirror-localized-1',
      action: 'review',
      status: 'needs_review',
      reason: 'source_uncertain_match',
      decisionKey: 'localized-key-1',
      sourceTrack: {
        platform: 'apple',
        id: 'a-localized',
        title: '愛人錯過',
        artist: 'Accusefive',
        artists: ['Accusefive'],
        album: '我肯定在幾百年前就說過愛你',
        durationMs: 292075,
        aliases: { artists: ['告五人'] },
      },
      targetTrack: {
        platform: 'qq',
        id: 'q-localized',
        title: '爱人错过',
        artist: '告五人',
        artists: ['告五人'],
        album: '我肯定在几百年前就说过爱你',
        durationMs: 292000,
      },
    };
    const batch = buildMirrorReviewBatch([operation], { batchId: 'localized-ai-test' });
    const result = normalizeMirrorReviewResult({
      batch_id: 'localized-ai-test',
      decisions: [{
        item_id: 'localized-key-1',
        decision: 'same',
        relation: 'same_recording',
        confidence: 0.99,
        recommended_action: 'keep',
        evidence: {
          title: 'deterministic Chinese script overlap',
          artist: 'supplied artist alias overlap',
          album: 'deterministic Chinese script overlap',
          duration: '0.075 seconds apart',
        },
        reason: 'Supplied title, artist, album, and duration evidence agree.',
      }],
    }, batch);

    assert.deepEqual(batch.items[0].match_evidence.support_signals.sort(), [
      'album_alias_overlap',
      'artist_alias_overlap',
      'duration_within_5_seconds',
      'title_alias_overlap',
    ]);
    assert.equal(result.decisions[0].recommendedAction, 'keep');
    assert.equal(result.decisions[0].safety, undefined);
  });
});

function fixtureOperation() {
  return {
    id: 'mirror-00001',
    action: 'review',
    status: 'needs_review',
    reason: 'source_uncertain_match',
    decisionKey: 'review-key-1',
    score: { total: 0.74, title: 1, artist: 1, duration: 0.15 },
    sourceTrack: {
      platform: 'apple',
      id: 'a-1',
      title: 'Love',
      artist: 'Keyshia Cole',
      artists: ['Keyshia Cole'],
      album: 'Fixture Album',
      durationMs: 258000,
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
    },
    targetTrack: {
      platform: 'netease',
      id: 'n-1',
      title: 'Love - Live',
      artist: 'Keyshia Myeshia Cole',
      artists: ['Keyshia Myeshia Cole'],
      album: 'Fixture Album',
      durationMs: 295000,
    },
  };
}
