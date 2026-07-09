import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMirrorSyncPlan } from '../src/mirror-sync.js';
import { normalizeTrack } from '../src/normalize.js';
import {
  WRITABLE_SYNC_PLATFORMS,
  buildSyncBaseline,
  buildSyncPolicyPlan,
  diffSnapshotsAgainstBaseline,
  listSyncPolicies,
  upsertTombstoneDecision,
} from '../src/sync-policy.js';

describe('policy-driven sync core', () => {
  it('lists the four policy modes without overstating Apple write support', () => {
    assert.deepEqual(listSyncPolicies().map((policy) => policy.id), [
      'canonical_mirror',
      'union_convergence',
      'managed_bidirectional',
      'read_only_analysis',
    ]);
    assert.deepEqual(WRITABLE_SYNC_PLATFORMS, ['qq', 'netease']);
  });

  it('wraps Apple canonical mirror without changing mirror summary counts', () => {
    const sourceSnapshot = snapshot('apple', [
      track('apple', 'a-1', 'Already There', 'Alice', 180000),
      track('apple', 'a-2', 'New Day', 'Bob', 210000),
    ]);
    const targetSnapshot = snapshot('qq', [
      track('qq', 'q-1', 'Already There', 'Alice', 181000),
      track('qq', 'q-2', 'Old Target Only', 'Carol', 200000),
    ]);
    const mirror = buildMirrorSyncPlan({
      generatedAt: '2026-07-08T00:00:00.000Z',
      target: 'qq',
      sourceSnapshot,
      targetSnapshot,
    });
    const policy = buildSyncPolicyPlan({
      generatedAt: '2026-07-08T00:00:00.000Z',
      policy: 'canonical_mirror',
      source: 'apple',
      targets: ['qq'],
      snapshots: {
        apple: sourceSnapshot,
        qq: targetSnapshot,
      },
    });

    assert.equal(policy.policy, 'canonical_mirror');
    assert.equal(policy.generatedAt, '2026-07-08T00:00:00.000Z');
    assert.equal(policy.childPlans[0].generatedAt, '2026-07-08T00:00:00.000Z');
    assert.deepEqual(
      pickSummary(policy.summary),
      pickSummary(mirror.summary),
    );
  });

  it('blocks Apple canonical remove operations without destructive target ids', () => {
    const plan = buildSyncPolicyPlan({
      generatedAt: '2026-07-08T00:00:00.000Z',
      policy: 'canonical_mirror',
      source: 'apple',
      targets: ['qq'],
      snapshots: {
        apple: snapshot('apple', []),
        qq: snapshot('qq', [
          midOnlyTrack('qq-mid-only', 'Target Only', 'Alice', 180000),
        ]),
      },
    });

    const remove = plan.operations.find((operation) => operation.action === 'remove');
    assert(remove);
    assert.equal(remove.status, 'blocked');
    assert.equal(remove.blockedReason, 'missing_destructive_target_id');
    assert.equal(plan.summary.remove, 1);
    assert.equal(plan.summary.blocked, 1);
  });

  it('blocks union propagation for clusters that need review', () => {
    const plan = buildSyncPolicyPlan({
      policy: 'union_convergence',
      platforms: ['apple', 'qq', 'netease'],
      snapshots: {
        apple: snapshot('apple', [
          track('apple', 'a-1', 'Shared Song', 'Alice', 180000),
          track('apple', 'a-2', 'Shared Song', 'Alice', 180500),
        ]),
        qq: snapshot('qq', [
          track('qq', 'q-1', 'Shared Song', 'Alice', 180000),
        ]),
        netease: snapshot('netease', []),
      },
    });

    assert.equal(plan.summary.review, 1);
    assert.equal(plan.summary.add, 0);
    assert.equal(plan.operations[0].reason, 'cluster_needs_review');
  });

  it('does not create ready managed-bidirectional writes without a baseline', () => {
    const plan = buildSyncPolicyPlan({
      policy: 'managed_bidirectional',
      platforms: ['apple', 'qq'],
      snapshots: {
        apple: snapshot('apple', [
          track('apple', 'a-1', 'New Baseline Needed', 'Alice', 180000),
        ]),
        qq: snapshot('qq', []),
      },
    });

    assert.equal(plan.status, 'blocked_missing_baseline');
    assert.deepEqual(plan.warnings, ['missing_baseline']);
    assert.equal(plan.operations.every((operation) => operation.status !== 'ready'), true);
    assert.equal(plan.operations.every((operation) => operation.blockedReason === 'missing_baseline'), true);
  });

  it('keeps operation ids unique when managed additions and deletion signals are combined', () => {
    const baselineSnapshots = {
      apple: snapshot('apple', [
        track('apple', 'a-1', 'Shared Baseline', 'Alice', 180000),
        track('apple', 'a-2', 'Deleted From QQ', 'Bob', 210000),
      ]),
      qq: snapshot('qq', [
        track('qq', 'q-1', 'Shared Baseline', 'Alice', 180000),
        track('qq', 'q-2', 'Deleted From QQ', 'Bob', 210000),
      ]),
    };
    const baseline = buildSyncBaseline({
      policy: 'managed_bidirectional',
      platforms: ['apple', 'qq'],
      snapshots: baselineSnapshots,
      savedAt: '2026-07-07T00:00:00.000Z',
    });
    const plan = buildSyncPolicyPlan({
      policy: 'managed_bidirectional',
      platforms: ['apple', 'qq'],
      snapshots: {
        apple: snapshot('apple', [
          track('apple', 'a-1', 'Shared Baseline', 'Alice', 180000),
          track('apple', 'a-3', 'New Apple Song', 'Carol', 190000),
        ]),
        qq: snapshot('qq', [
          track('qq', 'q-1', 'Shared Baseline', 'Alice', 180000),
        ]),
      },
      baseline,
    });
    const ids = plan.operations.map((operation) => operation.id);

    assert.equal(ids.length, new Set(ids).size);
    assert(plan.operations.some((operation) => operation.action === 'add'));
    assert(plan.operations.some((operation) => operation.reason === 'tombstone_candidate'));
  });

  it('marks read-only additions as blocked with the contract status', () => {
    const plan = buildSyncPolicyPlan({
      policy: 'read_only_analysis',
      platforms: ['apple', 'qq'],
      snapshots: {
        apple: snapshot('apple', [
          track('apple', 'a-1', 'Read Only Song', 'Alice', 180000),
        ]),
        qq: snapshot('qq', []),
      },
    });

    const add = plan.operations.find((operation) => operation.action === 'add');
    assert(add);
    assert.equal(add.status, 'blocked');
    assert.equal(add.blockedReason, 'read_only_policy');
    assert.equal(plan.summary.ready, 0);
  });

  it('scopes confirmed global deletes to participating platforms', () => {
    const baselineSnapshots = {
      apple: snapshot('apple', [
        track('apple', 'a-1', 'Deleted Everywhere', 'Alice', 180000, { isrc: 'USFIXTURE001' }),
      ]),
      qq: snapshot('qq', [
        track('qq', 'q-1', 'Deleted Everywhere', 'Alice', 180000, { isrc: 'USFIXTURE001' }),
      ]),
      netease: snapshot('netease', [
        track('netease', 'n-1', 'Deleted Everywhere', 'Alice', 180000, { isrc: 'USFIXTURE001' }),
      ]),
    };
    const baseline = buildSyncBaseline({
      policy: 'managed_bidirectional',
      platforms: ['apple', 'qq', 'netease'],
      snapshots: baselineSnapshots,
      savedAt: '2026-07-07T00:00:00.000Z',
    });
    const currentSnapshots = {
      apple: snapshot('apple', []),
      qq: baselineSnapshots.qq,
      netease: baselineSnapshots.netease,
    };
    const diff = diffSnapshotsAgainstBaseline(currentSnapshots, baseline, {
      platforms: ['apple', 'qq'],
    });
    const deleted = diff.platforms.apple.deleted[0];
    const tombstones = upsertTombstoneDecision({}, {
      key: deleted.tombstoneKey,
      action: 'confirm_global_delete',
      platform: 'apple',
      track: deleted.track,
      updatedAt: '2026-07-08T00:00:00.000Z',
    });

    const plan = buildSyncPolicyPlan({
      policy: 'managed_bidirectional',
      platforms: ['apple', 'qq'],
      snapshots: currentSnapshots,
      baseline,
      tombstones,
    });

    const removes = plan.operations.filter((operation) => operation.action === 'remove');
    assert.deepEqual(removes.map((operation) => operation.targetPlatform), ['qq']);
    assert.equal(plan.summary.baselineDeleted, 1);
  });

  it('keeps tombstone ignore and current-platform-only decisions from creating global deletions', () => {
    const baselineSnapshots = {
      apple: snapshot('apple', [
        track('apple', 'a-1', 'Local Delete', 'Alice', 180000, { isrc: 'USFIXTURE002' }),
      ]),
      qq: snapshot('qq', [
        track('qq', 'q-1', 'Local Delete', 'Alice', 180000, { isrc: 'USFIXTURE002' }),
      ]),
    };
    const baseline = buildSyncBaseline({
      policy: 'managed_bidirectional',
      snapshots: baselineSnapshots,
      savedAt: '2026-07-07T00:00:00.000Z',
    });
    const currentSnapshots = {
      apple: snapshot('apple', []),
      qq: baselineSnapshots.qq,
    };
    const deleted = diffSnapshotsAgainstBaseline(currentSnapshots, baseline, {
      platforms: ['apple', 'qq'],
    }).platforms.apple.deleted[0];

    for (const action of ['ignore', 'current_platform_only']) {
      const tombstones = upsertTombstoneDecision({}, {
        key: deleted.tombstoneKey,
        action,
        platform: 'apple',
        track: deleted.track,
      });
      const plan = buildSyncPolicyPlan({
        policy: 'managed_bidirectional',
        platforms: ['apple', 'qq'],
        snapshots: currentSnapshots,
        baseline,
        tombstones,
      });
      assert.equal(plan.operations.some((operation) => operation.action === 'remove'), false);
    }
  });

  it('does not create ready deletes for read-only Apple tombstone targets', () => {
    const baselineSnapshots = {
      apple: snapshot('apple', [
        track('apple', 'a-1', 'Read Only Target', 'Alice', 180000, { isrc: 'USFIXTURE003' }),
      ]),
      qq: snapshot('qq', [
        track('qq', 'q-1', 'Read Only Target', 'Alice', 180000, { isrc: 'USFIXTURE003' }),
      ]),
      netease: snapshot('netease', [
        track('netease', 'n-1', 'Read Only Target', 'Alice', 180000, { isrc: 'USFIXTURE003' }),
      ]),
    };
    const baseline = buildSyncBaseline({
      policy: 'managed_bidirectional',
      snapshots: baselineSnapshots,
      savedAt: '2026-07-07T00:00:00.000Z',
    });
    const currentSnapshots = {
      apple: baselineSnapshots.apple,
      qq: snapshot('qq', []),
      netease: baselineSnapshots.netease,
    };
    const deleted = diffSnapshotsAgainstBaseline(currentSnapshots, baseline, {
      platforms: ['apple', 'qq', 'netease'],
    }).platforms.qq.deleted[0];
    const tombstones = upsertTombstoneDecision({}, {
      key: deleted.tombstoneKey,
      action: 'confirm_global_delete',
      platform: 'qq',
      track: deleted.track,
    });

    const plan = buildSyncPolicyPlan({
      policy: 'managed_bidirectional',
      platforms: ['apple', 'qq', 'netease'],
      snapshots: currentSnapshots,
      baseline,
      tombstones,
    });

    const removes = plan.operations.filter((operation) => operation.action === 'remove');
    const blockedApple = plan.operations.find((operation) => operation.reason === 'readonly_delete_target');
    assert.deepEqual(removes.map((operation) => operation.targetPlatform), ['netease']);
    assert.equal(removes[0].status, 'ready');
    assert(blockedApple);
    assert.equal(blockedApple.targetPlatform, 'apple');
    assert.equal(blockedApple.status, 'blocked');
  });
});

function pickSummary(summary) {
  return {
    total: summary.total,
    keep: summary.keep,
    add: summary.add,
    remove: summary.remove,
    review: summary.review,
    destructive: summary.destructive,
    ready: summary.ready,
    blocked: summary.blocked,
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

function track(platform, id, title, artist, durationMs, extra = {}) {
  return normalizeTrack({
    id,
    title,
    artists: [artist],
    album: 'Fixture Album',
    durationMs,
    ...extra,
  }, platform);
}

function midOnlyTrack(mid, title, artist, durationMs) {
  return normalizeTrack({
    mid,
    title,
    artists: [artist],
    album: 'Fixture Album',
    durationMs,
  }, 'qq');
}
