import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMatchShadowPlan,
  projectMatchShadowOperations,
  summarizeMatchShadowBaseline,
  summarizeMatchShadowResolution,
} from '../src/match-shadow.js';

describe('read-only match shadow runs', () => {
  it('selects only unresolved target additions and clears stale resolution state', () => {
    const preview = fixturePreview();
    const plan = buildMatchShadowPlan(preview, 'qq');

    assert.equal(plan.mode, 'source_of_truth_mirror');
    assert.equal(plan.target.platform, 'qq');
    assert.equal(plan.operations.length, 1);
    assert.equal(plan.operations[0].id, 'qq-unresolved');
    assert.equal(plan.operations[0].status, 'needs_resolution');
    assert.equal(plan.operations[0].candidateTrack, null);
    assert.equal(plan.operations[0].resolution, null);
  });

  it('reports aggregate query coverage and resolution transitions without track payloads', () => {
    const preview = fixturePreview();
    const baseline = summarizeMatchShadowBaseline(preview);
    const resolved = {
      ...buildMatchShadowPlan(preview, 'qq'),
      operations: [{
        ...buildMatchShadowPlan(preview, 'qq').operations[0],
        status: 'ready',
        resolution: {
          reason: 'resolved_target_match',
          queryCount: 2,
          searchStrategies: ['apple_storefront_title_artist', 'source_title_artist'],
          storefronts: ['cn'],
        },
        resolvedTargetTrack: { platform: 'qq', id: 'qq-catalog-1' },
      }],
    };
    const summary = summarizeMatchShadowResolution(preview, resolved);

    assert.equal(baseline.targets.qq.operations, 1);
    assert.equal(baseline.targets.qq.queryCoverage.storefrontQueryOperations, 1);
    assert.equal(summary.recoveredReady, 1);
    assert.equal(summary.transitions['not_found->ready'], 1);
    assert.equal(summary.search.totalQueries, 2);
    assert(!JSON.stringify(summary).includes('Localized Song'));
  });

  it('projects shadow results without mutating the source preview', () => {
    const preview = fixturePreview();
    const resolved = buildMatchShadowPlan(preview, 'qq');
    resolved.operations[0] = { ...resolved.operations[0], status: 'ready' };
    const projected = projectMatchShadowOperations(preview, [resolved]);

    assert.equal(projected.find((item) => item.id === 'qq-unresolved').status, 'ready');
    assert.equal(preview.operations.find((item) => item.id === 'qq-unresolved').status, 'not_found');
  });
});

function fixturePreview() {
  const sourceTrack = {
    platform: 'apple',
    id: 'apple-1',
    title: 'Localized Song',
    artist: 'Source Artist',
    album: 'Source Album',
    durationMs: 180000,
    aliases: {
      titles: ['本地歌曲'],
      artists: ['本地歌手'],
    },
    metadata: {
      appleStorefronts: {
        equivalents: [{
          storefront: 'cn',
          title: '本地歌曲',
          artist: '本地歌手',
          aliasTrusted: true,
          isrcMatch: true,
        }],
      },
    },
  };
  return {
    generatedAt: '2026-07-18T00:00:00.000Z',
    thresholds: { match: 0.82, review: 0.68 },
    operations: [{
      id: 'qq-unresolved',
      action: 'add',
      status: 'not_found',
      targetPlatform: 'qq',
      sourceTrack,
      candidateTrack: { id: 'stale' },
      resolution: { reason: 'target_catalog_low_score' },
    }, {
      id: 'qq-ready',
      action: 'add',
      status: 'ready',
      targetPlatform: 'qq',
      sourceTrack,
      resolvedTargetTrack: { platform: 'qq', id: 'qq-existing' },
    }, {
      id: 'netease-unresolved',
      action: 'add',
      status: 'needs_review',
      targetPlatform: 'netease',
      sourceTrack,
    }],
  };
}
