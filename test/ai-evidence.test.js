import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildReviewBatch } from '../src/ai-review.js';
import { buildSyncReviewBatch } from '../src/sync-ai.js';

describe('AI evidence payloads', () => {
  it('includes MusicBrainz and deterministic match evidence for sync review items', () => {
    const batch = buildSyncReviewBatch([{
      decisionKey: 'sync-key-1',
      clusterId: 'cluster-1',
      target: 'netease',
      status: 'low_score',
      source: {
        platform: 'apple',
        track: appleTrack(),
      },
      match: {
        score: { total: 0.74, title: 1, artist: 0.7, duration: 0.92 },
        track: targetTrack(),
      },
    }], { batchId: 'sync-evidence-test' });

    const item = batch.items[0];
    assert.equal(item.source_track.external_evidence.musicbrainz.status, 'ok');
    assert.deepEqual(item.source_track.external_evidence.musicbrainz.recording_ids, ['mbid-1']);
    assert.equal(item.match_evidence.duration_delta_seconds, 3);
    assert.equal(item.match_evidence.isrc.relation, 'source_only');
    assert.deepEqual(item.match_evidence.alias_overlap.artists, ['keyshia myeshia cole']);
    assert.deepEqual(item.match_evidence.support_signals.sort(), [
      'album_alias_overlap',
      'artist_alias_overlap',
      'duration_within_5_seconds',
      'title_alias_overlap',
    ]);
    assert.deepEqual(item.match_evidence.risk_signals, []);
  });

  it('includes evidence summaries for unified low-confidence candidate reviews', () => {
    const batch = buildReviewBatch([{
      type: 'candidate',
      key: 'candidate-key-1',
      score: { total: 0.69 },
      source: {
        platform: 'apple',
        track: appleTrack(),
      },
      target: {
        platform: 'qq',
        track: {
          ...targetTrack(),
          platform: 'qq',
          id: 'q-1',
          durationMs: 295000,
          title: 'Love - Live',
        },
      },
    }], { batchId: 'review-evidence-test' });

    const item = batch.items[0];
    assert.equal(item.match_evidence.musicbrainz.source.recording_ids[0], 'mbid-1');
    assert.equal(item.match_evidence.duration_delta_seconds, 37);
    assert(item.match_evidence.risk_signals.includes('duration_over_20_seconds'));
    assert(item.match_evidence.risk_signals.includes('version_cue_conflict'));
    assert.equal(item.tracks[0].duration_ms, 258000);
    assert.equal(item.tracks[0].external_evidence.musicbrainz.source, 'musicbrainz-isrc');
  });
});

function appleTrack() {
  return {
    platform: 'apple',
    id: 'a-1',
    title: 'Love',
    artist: 'Keyshia Cole',
    artists: ['Keyshia Cole'],
    album: 'The Way It Is',
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
  };
}

function targetTrack() {
  return {
    platform: 'netease',
    id: 'n-1',
    title: 'Love',
    artist: 'Keyshia Myeshia Cole',
    artists: ['Keyshia Myeshia Cole'],
    album: 'The Way It Is',
    durationMs: 261000,
  };
}
