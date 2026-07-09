import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertAgentToolAllowed,
  listAgentTools,
  sanitizeAgentToolResult,
  selectAgentToolForMessage,
  summarizeAgentToolArguments,
  summarizeAgentToolResult,
} from '../src/agent-tools.js';

describe('Agent tool permissions', () => {
  it('exposes only read-only or local-draft tools without credential or provider mutation access', () => {
    const tools = listAgentTools();

    assert.equal(tools.length >= 6, true);
    assert.equal(tools.every((tool) => tool.readOnly === true || tool.localDraft === true), true);
    assert.equal(tools.every((tool) => tool.mutatesProvider === false), true);
    assert.equal(tools.every((tool) => tool.exposesCredentials === false), true);
    assert.equal(tools.some((tool) => /cookie|delete|remove|add/i.test(tool.name)), false);
    assert.equal(tools.some((tool) => tool.name === 'get_track_evidence' && tool.readOnly === true), true);
    assert.equal(tools.some((tool) => tool.name === 'get_baseline_diff' && tool.readOnly === true), true);
    assert.equal(tools.some((tool) => tool.name === 'get_review_queue' && tool.readOnly === true), true);
    assert.equal(tools.some((tool) => tool.name === 'save_local_shortlist' && tool.localDraft === true), true);
  });

  it('rejects unsupported, credential, and direct mutation-shaped tool names', () => {
    assert.equal(assertAgentToolAllowed('get_taste_profile').name, 'get_taste_profile');
    assert.equal(assertAgentToolAllowed('get_track_evidence').readOnly, true);
    assert.equal(assertAgentToolAllowed('get_baseline_diff').readOnly, true);
    assert.equal(assertAgentToolAllowed('get_review_queue').readOnly, true);
    assert.equal(assertAgentToolAllowed('save_local_shortlist').localDraft, true);
    assert.throws(() => assertAgentToolAllowed('delete_provider_track'), /cannot directly mutate/i);
    assert.throws(() => assertAgentToolAllowed('read_cookie'), /cannot directly mutate|credentials/i);
    assert.throws(() => assertAgentToolAllowed('unknown_tool'), /Unsupported Agent tool/);
  });

  it('routes natural-language prompts to safe local tools', () => {
    assert.equal(selectAgentToolForMessage('帮我找相似歌曲'), 'find_similar_tracks');
    assert.equal(selectAgentToolForMessage('推荐一些可能喜欢的歌'), 'recommend_by_profile');
    assert.equal(selectAgentToolForMessage('保存推荐候选列表'), 'save_local_shortlist');
    assert.equal(selectAgentToolForMessage('我的音乐画像是什么'), 'get_taste_profile');
    assert.equal(selectAgentToolForMessage('为什么这首歌需要确认，给我证据'), 'get_track_evidence');
    assert.equal(selectAgentToolForMessage('基线和现在有什么差异'), 'get_baseline_diff');
    assert.equal(selectAgentToolForMessage('有哪些需要确认的歌曲'), 'get_review_queue');
    assert.equal(selectAgentToolForMessage('同步预览里会删除什么'), 'get_sync_preview');
  });

  it('sanitizes tool results with explicit read-only metadata', () => {
    const tool = assertAgentToolAllowed('get_library_summary');
    const result = sanitizeAgentToolResult(tool, { platforms: [] });

    assert.equal(result.tool, 'get_library_summary');
    assert.equal(result.readOnly, true);
    assert.equal(result.mutatesProvider, false);
    assert.equal(result.exposesCredentials, false);
    assert.deepEqual(result.result, { platforms: [] });
  });

  it('summarizes Agent arguments and results without raw user text or provider payloads', () => {
    const args = summarizeAgentToolArguments('find_similar_tracks', {
      seed: {
        title: 'Private Song Title',
        artist: 'Private Artist',
        id: 'provider-track-id',
        platform: 'qq',
        durationMs: 180000,
      },
      limit: 6,
    });
    const result = summarizeAgentToolResult('recommend_by_profile', {
      total: 3,
      candidates: [{ key: 'track-1' }],
      model: { used: false },
      excludes: { providerWrites: true },
      raw: { cookie: 'must-not-persist' },
    });
    const evidenceArgs = summarizeAgentToolArguments('get_track_evidence', {
      operationId: 'operation-private-id',
      tombstoneKey: 'tombstone-private-key',
      bucket: 'needs_confirmation',
    });
    const evidenceResult = summarizeAgentToolResult('get_track_evidence', {
      exists: true,
      previewId: 'preview-1',
      bucket: 'needs_confirmation',
      evidence: { sourceTrack: { title: 'Private Song' }, targetTrack: null },
      explanation: { recommendedAction: 'review_manually' },
      evidenceRefs: ['reason:low_confidence_target_match'],
      raw: { cookie: 'must-not-persist' },
    });
    const baselineResult = summarizeAgentToolResult('get_baseline_diff', {
      exists: true,
      diff: {
        status: 'ready',
        summary: { added: 2, deleted: 1 },
        examples: [{ title: 'Private Baseline Song', id: 'provider-id' }],
      },
      raw: { cookie: 'must-not-persist' },
    });
    const reviewResult = summarizeAgentToolResult('get_review_queue', {
      exists: true,
      previewId: 'preview-1',
      bucket: 'all',
      total: 4,
      counts: { needs_confirmation: 2, may_delete: 2 },
      items: [
        { operationId: 'operation-private-id', title: 'Private Review Song', tombstoneKey: 'must-not-persist' },
      ],
      raw: { cookie: 'must-not-persist' },
    });

    assert.equal(args.seed.hasTitle, true);
    assert.equal(args.seed.hasArtist, true);
    assert.equal(args.seed.hasProviderId, true);
    assert.equal(JSON.stringify(args).includes('Private Song Title'), false);
    assert.equal(JSON.stringify(args).includes('Private Artist'), false);
    assert.deepEqual(result, {
      total: 3,
      returned: 1,
      modelUsed: false,
      providerWrites: true,
      savedShortlist: { present: false, trackCount: 0 },
    });
    assert.deepEqual(evidenceArgs, {
      operationIdProvided: true,
      tombstoneKeyProvided: true,
      bucket: 'needs_confirmation',
    });
    assert.deepEqual(evidenceResult, {
      exists: true,
      previewId: 'preview-1',
      bucket: 'needs_confirmation',
      hasSourceTrack: true,
      hasTargetTrack: false,
      evidenceRefCount: 1,
      recommendedAction: 'review_manually',
      error: '',
    });
    assert.deepEqual(baselineResult, {
      exists: true,
      status: 'ready',
      added: 2,
      deleted: 1,
      exampleCount: 1,
      error: '',
    });
    assert.deepEqual(reviewResult, {
      exists: true,
      previewId: 'preview-1',
      bucket: 'all',
      total: 4,
      returned: 1,
      needsConfirmation: 2,
      mayDelete: 2,
      error: '',
    });
    assert.equal(JSON.stringify(result).includes('cookie'), false);
    assert.equal(JSON.stringify(evidenceArgs).includes('operation-private-id'), false);
    assert.equal(JSON.stringify(evidenceResult).includes('cookie'), false);
    assert.equal(JSON.stringify(baselineResult).includes('provider-id'), false);
    assert.equal(JSON.stringify(reviewResult).includes('tombstoneKey'), false);
  });
});
