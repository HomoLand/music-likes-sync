import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMirrorSyncPlan } from '../src/mirror-sync.js';
import { buildSyncBaseline, buildSyncPolicyPlan, upsertTombstoneDecision } from '../src/sync-policy.js';
import {
  validateAgentSessionsState,
  validateAiProviderState,
  validateMirrorDecisionState,
  validateMirrorPlan,
  validateMirrorRunLog,
  validateMirrorStateFiles,
  validateMusicProfileState,
  validatePolicyStateFiles,
  validateRecommendationShortlistsState,
  validateSyncBaselineState,
  validateSyncPolicyState,
  validateSyncPreviewState,
  validateSyncRunLogState,
  validateSyncTombstoneState,
} from '../src/state-schema.js';
import { normalizeTrack } from '../src/normalize.js';

describe('mirror state schema validation', () => {
  it('accepts a generated mirror plan', () => {
    const report = validateMirrorPlan(fixturePlan());

    assert.equal(report.ok, true);
    assert.equal(report.operationCount, 3);
    assert.deepEqual(report.errors, []);
  });

  it('rejects plan summary drift against the operation list', () => {
    const plan = fixturePlan();
    plan.summary.remove = 0;

    const report = validateMirrorPlan(plan);

    assert.equal(report.ok, false);
    assert.match(report.errors.map((error) => error.message).join('\n'), /Summary mismatch/);
    assert.equal(report.errors.some((error) => error.path === '$.summary.remove'), true);
  });

  it('rejects destructive remove operations without a target id', () => {
    const plan = fixturePlan();
    const remove = plan.operations.find((operation) => operation.action === 'remove');
    remove.targetTrack.id = null;
    remove.targetTrack.mid = 'mid-only-is-not-enough';

    const report = validateMirrorPlan(plan);

    assert.equal(report.ok, false);
    assert.match(report.errors.map((error) => error.message).join('\n'), /include id/);
  });

  it('accepts a mirror run log produced by apply previews', () => {
    const report = validateMirrorRunLog({
      version: 1,
      updatedAt: '2026-07-07T00:00:00.000Z',
      runs: [
        {
          runId: 'mirror-run-aaaaaaaaaaaaaaaa',
          idempotencyKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          status: 'completed',
          ranAt: '2026-07-07T00:00:00.000Z',
          startedAt: '2026-07-07T00:00:00.000Z',
          completedAt: '2026-07-07T00:00:01.000Z',
          target: 'qq',
          dryRun: true,
          operationKeys: {
            add: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
            remove: ['cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
            review: ['dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'],
          },
          add: { requested: 1, executable: 0, blocked: 1, reason: 'target_catalog_not_resolved' },
          remove: { requested: 1, executable: 1, blocked: 0, destructive: 1 },
          review: { blocked: 1 },
          addResult: { requested: 0, submitted: 0, accepted: 0, added: 0, verified: false, batches: [] },
          removeResult: { requested: 1, submitted: 0, accepted: 0, removed: 0, verified: false, batches: [] },
          blocked: { unresolvedAdds: 1, invalidRemoves: 0, reviewItems: 1 },
        },
      ],
    });

    assert.equal(report.ok, true);
    assert.equal(report.runCount, 1);
  });

  it('rejects malformed mirror run logs', () => {
    const report = validateMirrorRunLog({
      version: 1,
      updatedAt: 'not-a-date',
      runs: [
        {
          ranAt: '2026-07-07T00:00:00.000Z',
          target: 'apple',
          status: 'mystery',
          idempotencyKey: 'not-a-sha',
          operationKeys: { add: ['bad-key'] },
          dryRun: 'yes',
          add: { requested: 1 },
          remove: {},
          review: {},
          addResult: {},
          removeResult: {},
          blocked: {},
        },
      ],
    });

    assert.equal(report.ok, false);
    assert.equal(report.errors.some((error) => error.path === '$.updatedAt'), true);
    assert.equal(report.errors.some((error) => error.path === '$.runs[0].target'), true);
    assert.equal(report.errors.some((error) => error.path === '$.runs[0].dryRun'), true);
    assert.equal(report.errors.some((error) => error.path === '$.runs[0].status'), true);
    assert.equal(report.errors.some((error) => error.path === '$.runs[0].idempotencyKey'), true);
  });

  it('validates plan and runs as one state bundle', () => {
    const result = validateMirrorStateFiles({
      mirrorPlan: fixturePlan(),
      mirrorRuns: {
        version: 1,
        updatedAt: '2026-07-07T00:00:00.000Z',
        runs: [],
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.reports.length, 2);
  });

  it('accepts mirror review decision state', () => {
    const report = validateMirrorDecisionState({
      version: 1,
      updatedAt: '2026-07-07T00:00:00.000Z',
      items: {
        'review|source_uncertain_match|apple:a-1:night drive alice fixture album 180000|qq:q-1:night drive acoustic alice fixture album 240000': {
          key: 'review|source_uncertain_match|apple:a-1:night drive alice fixture album 180000|qq:q-1:night drive acoustic alice fixture album 240000',
          action: 'separate',
          target: 'qq',
          operationId: 'mirror-00001',
          reason: 'source_uncertain_match',
          note: '',
          batchId: 'mirror-decision-batch-2026-07-07T00-00-00-000Z',
          decidedAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:00:00.000Z',
        },
      },
    });

    assert.equal(report.ok, true);
    assert.equal(report.decisionCount, 1);
  });

  it('rejects malformed mirror review decisions', () => {
    const report = validateMirrorDecisionState({
      version: 1,
      updatedAt: '2026-07-07T00:00:00.000Z',
      items: {
        'bad-key': {
          key: 'other-key',
          action: 'delete-now',
          target: 'apple',
          batchId: 123,
          decidedAt: '',
          updatedAt: 'not-a-date',
        },
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.errors.some((error) => error.path.endsWith('.key')), true);
    assert.equal(report.errors.some((error) => error.path.endsWith('.action')), true);
    assert.equal(report.errors.some((error) => error.path.endsWith('.target')), true);
    assert.equal(report.errors.some((error) => error.path.endsWith('.batchId')), true);
  });
});

describe('policy-driven sync state schema validation', () => {
  it('accepts policy settings, baseline, preview, and tombstone state', () => {
    const snapshots = fixtureSyncSnapshots();
    const baseline = buildSyncBaseline({
      snapshots,
      platforms: ['apple', 'qq', 'netease'],
      policy: 'managed_bidirectional',
      savedAt: '2026-07-08T00:00:00.000Z',
    });
    const preview = buildSyncPolicyPlan({
      policy: 'managed_bidirectional',
      snapshots: {
        ...snapshots,
        qq: snapshot('qq', []),
      },
      platforms: ['apple', 'qq', 'netease'],
      baseline,
      generatedAt: '2026-07-08T00:10:00.000Z',
    });
    const tombstoneKey = preview.operations.find((operation) => operation.reason === 'tombstone_candidate')?.tombstoneKey;
    const tombstones = upsertTombstoneDecision({}, {
      key: tombstoneKey,
      action: 'ignore',
      platform: 'qq',
      track: baseline.platforms.qq.tracks[0].track,
      decidedAt: '2026-07-08T00:11:00.000Z',
      updatedAt: '2026-07-08T00:11:00.000Z',
    });
    const policy = {
      version: 1,
      updatedAt: '2026-07-08T00:00:00.000Z',
      policy: 'managed_bidirectional',
      participants: ['apple', 'qq', 'netease'],
      source: { platform: 'apple' },
      targets: ['qq', 'netease'],
      deletionPolicy: 'ask',
    };

    assert.equal(validateSyncPolicyState(policy).ok, true);
    assert.equal(validateSyncBaselineState(baseline).ok, true);
    assert.equal(validateSyncPreviewState(preview).ok, true);
    preview.convergence = {
      checked: true,
      skipped: false,
      status: 'open_delta',
      converged: false,
      refreshedAt: '2026-07-08T00:12:00.000Z',
      refreshedTargets: ['qq'],
      counts: {
        will_add: 1,
        needs_confirmation: 0,
        may_delete: 0,
      },
      openOperations: 1,
    };
    assert.equal(validateSyncPreviewState(preview).ok, true);
    assert.equal(validateSyncTombstoneState(tombstones).ok, true);

    const bundle = validatePolicyStateFiles({
      syncPolicy: policy,
      syncBaseline: baseline,
      syncPreview: preview,
      syncTombstones: tombstones,
      syncRuns: fixtureSyncRunLog(),
    });
    assert.equal(bundle.ok, true);
    assert.equal(bundle.reports.length, 5);
  });

  it('accepts policy sync run logs and rejects malformed entries', () => {
    const report = validateSyncRunLogState(fixtureSyncRunLog());

    assert.equal(report.ok, true);
    assert.equal(report.runCount, 1);

    const malformed = fixtureSyncRunLog();
    malformed.runs[0].policy = 'unknown';
    malformed.runs[0].target = 'apple';
    malformed.runs[0].dryRun = 'yes';

    const badReport = validateSyncRunLogState(malformed);
    assert.equal(badReport.ok, false);
    assert.equal(badReport.errors.some((error) => error.path === '$.runs[0].policy'), true);
    assert.equal(badReport.errors.some((error) => error.path === '$.runs[0].target'), true);
    assert.equal(badReport.errors.some((error) => error.path === '$.runs[0].dryRun'), true);
  });

  it('blocks read-only executable mutations and summary drift', () => {
    const preview = buildSyncPolicyPlan({
      policy: 'read_only_analysis',
      snapshots: fixtureSyncSnapshots(),
      platforms: ['apple', 'qq'],
      generatedAt: '2026-07-08T00:00:00.000Z',
    });
    const add = preview.operations.find((operation) => operation.action === 'add');
    add.status = 'ready';
    preview.summary.ready += 1;

    const report = validateSyncPreviewState(preview);

    assert.equal(report.ok, false);
    assert.equal(report.errors.some((error) => /Read-only analysis/.test(error.message)), true);
    assert.equal(report.errors.some((error) => /Summary mismatch/.test(error.message)), true);
  });

  it('rejects credential-shaped fields and raw AI provider payloads', () => {
    const aiReport = validateAiProviderState({
      version: 1,
      updatedAt: '2026-07-08T00:00:00.000Z',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-1234567890abcdef',
    });
    const agentReport = validateAgentSessionsState({
      version: 1,
      updatedAt: '2026-07-08T00:00:00.000Z',
      sessions: [
        {
          id: 'agent-session-1',
          toolTraces: [
            {
              tool: 'music.search',
              rawResponse: { status: 'ok' },
              readOnly: false,
              exposesCredentials: true,
              durationMs: -1,
              feedback: { label: 'unknown', updatedAt: '2026-07-08T00:00:00.000Z' },
            },
          ],
        },
      ],
    });

    assert.equal(aiReport.ok, false);
    assert.equal(aiReport.errors.some((error) => /secret|credential/i.test(error.message)), true);
    assert.equal(agentReport.ok, false);
    assert.equal(agentReport.errors.some((error) => /raw AI or provider payload/i.test(error.message)), true);
    assert.equal(agentReport.errors.some((error) => /read-only/i.test(error.message)), true);
    assert.equal(agentReport.errors.some((error) => /credentials/i.test(error.message)), true);
    assert.equal(agentReport.errors.some((error) => /duration/i.test(error.message)), true);
    assert.equal(agentReport.errors.some((error) => /feedback label/i.test(error.message)), true);
  });

  it('accepts AI profile, recommendation shortlist, and sanitized agent session state', () => {
    const updatedAt = '2026-07-08T00:00:00.000Z';

    assert.equal(validateAiProviderState({
      version: 1,
      updatedAt,
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      batchSize: 12,
    }).ok, true);
    assert.equal(validateMusicProfileState({
      version: 1,
      updatedAt,
      generatedAt: updatedAt,
      summary: { languages: ['zh', 'en'] },
      aggregates: { genres: { pop: 5 } },
    }).ok, true);
    assert.equal(validateRecommendationShortlistsState({
      version: 1,
      updatedAt,
      shortlists: [
        {
          id: 'shortlist-1',
          name: 'Similar picks',
          tracks: [track('rec-1', 'New Day', 'Bob', 210000)],
        },
      ],
    }).ok, true);
    assert.equal(validateAgentSessionsState({
      version: 1,
      updatedAt,
      sessions: [
        {
          id: 'agent-session-1',
          toolTraces: [
            {
              id: 'trace-1',
              tool: 'music.search',
              calledAt: updatedAt,
              source: 'mcp',
              status: 'completed',
              readOnly: true,
              localDraft: false,
              mutatesProvider: false,
              exposesCredentials: false,
              durationMs: 12,
              argumentsRef: 'evidence:item-1',
              argumentsSummary: { seed: { hasTitle: true } },
              resultSummary: { total: 2, returned: 1 },
              evidenceRefs: ['cluster-1'],
              feedback: {
                label: 'useful',
                source: 'product-ui',
                updatedAt,
              },
            },
            {
              id: 'trace-2',
              tool: 'save_local_shortlist',
              calledAt: updatedAt,
              source: 'mcp',
              status: 'completed',
              readOnly: false,
              localDraft: true,
              mutatesProvider: false,
              exposesCredentials: false,
              durationMs: 18,
              argumentsSummary: { limit: 5, shortlistNameProvided: true },
              resultSummary: { savedShortlist: { present: true, trackCount: 3 } },
              evidenceRefs: ['shortlist:shortlist-1'],
            },
          ],
        },
      ],
    }).ok, true);
  });
});

function fixturePlan() {
  return buildMirrorSyncPlan({
    target: 'qq',
    sourceSnapshot: snapshot('apple', [
      track('a-1', 'Already There', 'Alice', 180000),
      track('a-2', 'New Day', 'Bob', 210000),
    ]),
    targetSnapshot: snapshot('qq', [
      track('q-1', 'Already There', 'Alice', 181000),
      track('q-2', 'Old Target Only', 'Carol', 200000),
    ]),
  });
}

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:fixture`,
    fetchedAt: '2026-07-07T00:00:00.000Z',
    skipped: false,
    tracks: tracks.map((track) => normalizeTrack(track, platform)),
  };
}

function fixtureSyncSnapshots() {
  return {
    apple: snapshot('apple', [
      track('a-1', 'Already There', 'Alice', 180000),
      track('a-2', 'New Day', 'Bob', 210000),
    ]),
    qq: snapshot('qq', [
      track('q-1', 'Already There', 'Alice', 180000),
    ]),
    netease: snapshot('netease', [
      track('n-1', 'Already There', 'Alice', 180000),
      track('n-2', 'New Day', 'Bob', 210000),
    ]),
  };
}

function fixtureSyncRunLog() {
  return {
    version: 1,
    updatedAt: '2026-07-08T00:20:00.000Z',
    runs: [
      {
        runId: 'mirror-run-aaaaaaaaaaaaaaaa',
        idempotencyKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'completed',
        ranAt: '2026-07-08T00:20:00.000Z',
        startedAt: '2026-07-08T00:20:00.000Z',
        completedAt: '2026-07-08T00:20:01.000Z',
        target: 'qq',
        policy: 'managed_bidirectional',
        action: 'add',
        previewId: 'preview-20260708001000',
        dryRun: true,
        operationKeys: {
          add: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
          remove: [],
          review: [],
        },
        add: { requested: 1, executable: 1, blocked: 0 },
        remove: { requested: 0, executable: 0, blocked: 0, destructive: 0 },
        review: { blocked: 0 },
        addResult: { requested: 1, submitted: 0, accepted: 0, added: 0, verified: false, batches: [] },
        removeResult: { requested: 0, submitted: 0, accepted: 0, removed: 0, verified: false, batches: [] },
        blocked: { unresolvedAdds: 0, invalidRemoves: 0, reviewItems: 0 },
      },
    ],
  };
}

function track(id, title, artist, durationMs) {
  return {
    id,
    title,
    artists: [artist],
    album: 'Fixture Album',
    durationMs,
  };
}
