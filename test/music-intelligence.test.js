import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendRecommendationShortlist,
  applyRecommendationAiSummary,
  buildRecommendationAiEvidence,
  buildMusicProfileAiEvidence,
  buildMusicProfile,
  buildRecommendations,
  deterministicMusicProfileSummary,
  evaluateMusicProfileModelFixtures,
  evaluateRecommendationModelFixtures,
  findSimilarTracks,
  normalizeMusicProfileAiSummary,
  normalizeRecommendationAiSummary,
} from '../src/music-intelligence.js';
import { validateRecommendationShortlistsState } from '../src/state-schema.js';

describe('deterministic music intelligence', () => {
  it('builds a sanitized local taste profile without raw provider payloads', () => {
    const profile = buildMusicProfile({
      snapshots: fixtureSnapshots(),
      generatedAt: '2026-07-08T00:00:00.000Z',
    });

    assert.equal(profile.version, 1);
    assert.equal(profile.summary.trackCount, 4);
    assert.equal(profile.summary.sourceTrackCount, 5);
    assert.equal(profile.summary.topArtists[0].name, 'Alice');
    assert.equal(profile.summary.platformCoverage.apple, 2);
    assert.equal(JSON.stringify(profile).includes('"raw"'), false);
    assert.equal(JSON.stringify(profile).includes('cookie'), false);
  });

  it('builds sanitized AI profile evidence and normalizes model summaries', () => {
    const profile = buildMusicProfile({
      snapshots: fixtureSnapshots(),
      generatedAt: '2026-07-08T00:00:00.000Z',
    });
    const evidence = buildMusicProfileAiEvidence(profile);
    const deterministic = deterministicMusicProfileSummary(profile);
    const normalized = normalizeMusicProfileAiSummary({
      summary: 'Night-drive pop and Alice-led rock are recurring signals.',
      taste_tags: ['artist:Alice', 'language:latin'],
      listening_patterns: ['Medium songs dominate.'],
      recommendation_angles: ['Find adjacent Alice-like tracks.'],
      caveats: ['Based on liked songs only.'],
      confidence: 0.8,
      evidence_refs: ['top_artists', 'languages'],
    });

    assert.equal(JSON.stringify(evidence).includes('cookie'), false);
    assert.equal(JSON.stringify(evidence).includes('"raw"'), false);
    assert.equal(deterministic.source, 'deterministic');
    assert.equal(normalized.tasteTags.includes('artist:Alice'), true);
    assert.equal(normalized.confidence, 0.8);
  });

  it('evaluates profile model outputs without calling a provider', () => {
    const result = evaluateMusicProfileModelFixtures([
      {
        id: 'profile-ok',
        output: {
          summary: 'Alice and Chinese pop are the strongest signals.',
          taste_tags: ['artist:Alice', 'language:zh'],
          confidence: 0.7,
          evidence_refs: ['top_artists', 'languages'],
        },
        expected: {
          requiredTags: ['artist:Alice'],
          minEvidenceRefs: 2,
          minConfidence: 0.6,
          forbiddenTerms: ['cookie'],
        },
      },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.summary.passed, 1);
  });

  it('finds similar tracks from local evidence only', () => {
    const result = findSimilarTracks({
      snapshots: fixtureSnapshots(),
      seed: { title: 'Night Drive', artist: 'Alice', durationMs: 181000 },
      limit: 3,
    });

    assert.equal(result.seed.track.title, 'Night Drive');
    assert.equal(result.candidates.length > 0, true);
    assert.equal(result.candidates[0].track.artist.includes('Alice'), true);
    assert.equal(result.candidates[0].reasons.includes('same_artist'), true);
  });

  it('recommends local non-Apple candidates and can save a valid shortlist', () => {
    const snapshots = fixtureSnapshots();
    const profile = buildMusicProfile({
      snapshots,
      generatedAt: '2026-07-08T00:00:00.000Z',
    });
    const recommendations = buildRecommendations({
      snapshots,
      profile,
      excludeApple: true,
      limit: 5,
      generatedAt: '2026-07-08T00:05:00.000Z',
    });

    assert.equal(recommendations.excludes.providerWrites, true);
    assert.equal(recommendations.candidates.every((item) => !item.platforms.includes('apple')), true);
    assert.equal(recommendations.candidates.length > 0, true);

    const shortlist = appendRecommendationShortlist({}, {
      candidates: recommendations.candidates,
      updatedAt: '2026-07-08T00:06:00.000Z',
      name: 'Smoke picks',
    });
    const report = validateRecommendationShortlistsState(shortlist);
    assert.equal(report.ok, true);
    assert.equal(report.shortlistCount, 1);
  });

  it('builds sanitized recommendation evidence and applies model reranking to known candidates only', () => {
    const snapshots = fixtureSnapshots();
    const profile = buildMusicProfile({
      snapshots,
      generatedAt: '2026-07-08T00:00:00.000Z',
    });
    const recommendations = buildRecommendations({
      snapshots,
      profile,
      excludeApple: true,
      limit: 5,
      generatedAt: '2026-07-08T00:05:00.000Z',
    });
    const evidence = buildRecommendationAiEvidence(recommendations, profile);
    const aiSummary = normalizeRecommendationAiSummary({
      summary: 'Prefer Moon Harbor based on repeated non-Apple likes.',
      ranked_candidates: [
        {
          key: recommendations.candidates[1]?.key,
          reason: 'Better cross-platform signal.',
          confidence: 0.8,
          evidence_refs: ['candidate_reasons'],
        },
        {
          key: 'invented-song',
          reason: 'Should be ignored.',
          confidence: 0.9,
          evidence_refs: ['outside_catalog'],
        },
      ],
      evidence_refs: ['profile_top_artists', 'candidate_reasons'],
    }, {
      candidates: recommendations.candidates,
    });
    const reranked = applyRecommendationAiSummary(recommendations, aiSummary);

    assert.equal(JSON.stringify(evidence).includes('cookie'), false);
    assert.equal(JSON.stringify(evidence).includes('"raw"'), false);
    assert.equal(aiSummary.rankedCandidates.some((item) => item.key === 'invented-song'), false);
    assert.equal(reranked.candidates[0].key, recommendations.candidates[1].key);
    assert.equal(reranked.candidates[0].aiReason, 'Better cross-platform signal.');
  });

  it('evaluates recommendation model outputs without calling a provider', () => {
    const result = evaluateRecommendationModelFixtures([
      {
        id: 'recommend-ok',
        candidates: [
          { key: 'rec-1', track: { title: 'Moon Harbor', artist: 'Alice' }, reasons: ['top_artist_match'] },
        ],
        output: {
          summary: 'Moon Harbor is supported by top artist evidence.',
          ranked_candidates: [{ key: 'rec-1', reason: 'Matches artist evidence.', confidence: 0.75, evidence_refs: ['candidate_reasons'] }],
          evidence_refs: ['profile_top_artists', 'candidate_reasons'],
        },
        expected: {
          requiredCandidateKeys: ['rec-1'],
          minEvidenceRefs: 2,
          forbiddenTerms: ['cookie'],
        },
      },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.summary.passed, 1);
  });
});

function fixtureSnapshots() {
  return {
    apple: snapshot('apple', [
      track('a-1', 'Night Drive', 'Alice', 180000),
      track('a-2', 'Blue Morning', 'Bob', 220000),
    ]),
    qq: snapshot('qq', [
      track('q-1', 'Night Drive Live', 'Alice', 181000),
      track('q-2', 'Moon Harbor', 'Alice', 210000),
    ]),
    netease: snapshot('netease', [
      track('n-1', 'Moon Harbor', 'Alice', 211000),
    ]),
  };
}

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:fixture`,
    fetchedAt: '2026-07-08T00:00:00.000Z',
    skipped: false,
    tracks,
  };
}

function track(id, title, artist, durationMs) {
  return {
    id,
    title,
    artists: [artist],
    album: 'Fixture Album',
    durationMs,
    raw: {
      cookie: 'must-not-persist',
    },
  };
}
