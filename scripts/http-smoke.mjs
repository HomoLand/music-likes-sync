import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { productAddReferencesTarget } from '../src/product-add-state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredPort = Number(readArg('--port') || process.env.PORT || 0);
const port = configuredPort || await pickFreePort();
const requireMirrorPlan = hasFlag('--require-mirror-plan');
const baseUrl = `http://127.0.0.1:${port}`;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-sync-http-smoke-'));
const fixtureTimestamp = new Date().toISOString();

await seedMirrorFixtures(tempRoot);

const child = spawn(process.execPath, ['src/server.js', String(port)], {
  cwd: ROOT,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    MUSIC_LIKES_SYNC_OTEL_ENABLED: '0',
    MUSIC_LIKES_SYNC_HOME: tempRoot,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

try {
  await waitForServer();
  const state = await getJson('/api/state');
  assert(state.ok, '/api/state should return ok');
  const appState = await getJson('/api/app/state');
  assert(appState.ok, '/api/app/state should return ok');
  assert(Array.isArray(appState.data?.platforms), '/api/app/state should return product platforms');
  assert(!JSON.stringify(appState.data).includes('dataDir'), '/api/app/state must not expose local state paths');
  assert(appState.data?.validation?.live?.targets?.qq?.ok === true, '/api/app/state should summarize QQ live validation evidence');
  assert(appState.data?.validation?.live?.targets?.netease?.ok === true, '/api/app/state should summarize NetEase live validation evidence');
  assert(!JSON.stringify(appState.data?.validation).includes('fixture-playlist'), '/api/app/state live validation summary must not expose playlist ids');
  assert(appState.data?.autoSync?.enabled === false, '/api/app/state should expose disabled auto-sync defaults');
  const initialAutoSync = await getJson('/api/auto-sync');
  assert(initialAutoSync.ok, '/api/auto-sync should return ok');
  assert(initialAutoSync.data?.automation?.enabled === false, 'auto-sync should default to disabled');
  assert(initialAutoSync.data?.readiness?.baseline?.required === false, 'canonical mirror should not require a historical baseline');
  assert(initialAutoSync.data?.readiness?.ok === true, 'canonical mirror should be ready with fresh snapshots and live validation');
  const canonicalAutoSyncEnable = await postJson('/api/auto-sync', {
    enabled: true,
    intervalMinutes: 60,
    targets: ['qq', 'netease'],
    refreshApple: false,
    refreshTargets: false,
    autoExecuteAdditions: false,
    requireBaseline: true,
  });
  assert(canonicalAutoSyncEnable.data?.automation?.enabled === true, 'canonical mirror should enable without a historical baseline');
  const savedDisabledAutoSync = await postJson('/api/auto-sync', {
    enabled: false,
    intervalMinutes: 30,
    targets: ['qq', 'netease'],
    refreshApple: false,
    refreshTargets: false,
    autoExecuteAdditions: false,
    requireBaseline: true,
  });
  assert(savedDisabledAutoSync.data?.automation?.intervalMinutes === 30, 'disabled auto-sync settings should persist safely');
  const canonicalAutoSyncRun = await postJson('/api/auto-sync/run', { dryRun: true, executeAdditions: false });
  assert(canonicalAutoSyncRun.data?.run?.status === 'attention', 'manual canonical check should preserve unresolved review items without provider writes');
  assert(canonicalAutoSyncRun.data?.run?.dryRun === true, 'manual auto-sync check should default to dry-run');
  assert(canonicalAutoSyncRun.data?.run?.preview?.previewId, 'canonical auto-sync should generate a preview without a historical baseline');
  assert(canonicalAutoSyncRun.data?.history?.length === 1, 'manual auto-sync check should append scheduler history');
  assert(!JSON.stringify(canonicalAutoSyncRun.data).includes('fixture-playlist'), 'auto-sync API must not expose playlist ids');
  const liveValidation = await getJson('/api/validation/live');
  assert(liveValidation.ok, '/api/validation/live should return ok');
  assert(liveValidation.data?.targets?.qq?.status === 'verified', '/api/validation/live should report verified QQ evidence');
  assert(liveValidation.data?.targets?.netease?.status === 'verified', '/api/validation/live should report verified NetEase evidence');
  assert(!JSON.stringify(liveValidation.data).includes('fixture-playlist'), '/api/validation/live must not expose playlist ids');
  const modes = await getJson('/api/sync/modes');
  assert(modes.ok, '/api/sync/modes should return ok');
  assert(modes.data?.modes?.some((mode) => mode.id === 'canonical_mirror'), 'sync modes should include canonical_mirror');
  const emptyBackups = await getJson('/api/sync/backups');
  assert(emptyBackups.ok, '/api/sync/backups should return ok');
  assert(emptyBackups.data?.backups?.length === 0, 'sync backups should start empty in an isolated runtime');
  const createdBackup = await postJson('/api/sync/backups', {
    targets: ['qq', 'netease'],
    refresh: false,
    reason: 'http_smoke',
  });
  assert(createdBackup.ok, 'sync backup creation should return ok');
  assert(createdBackup.data?.backup?.targets?.length === 2, 'sync backup should include both writable targets');
  assert(createdBackup.data?.backup?.integrity?.ok === true, 'sync backup should expose a successful integrity result');
  assert(!JSON.stringify(createdBackup.data).includes('fixture-playlist'), 'sync backup API must not expose playlist ids');
  assert(!JSON.stringify(createdBackup.data).includes('raw'), 'sync backup API must not expose raw provider payloads');
  const restorePreview = await postJson('/api/sync/backups/restore', {
    backupId: createdBackup.data.backup.id,
    dryRun: true,
    refresh: false,
  });
  assert(restorePreview.ok, 'sync backup restore preview should return ok');
  assert(restorePreview.data?.dryRun === true, 'sync backup restore should default to a non-writing preview');
  assert(restorePreview.data?.plan?.missing === 0, 'unchanged fixture snapshots should need no restore additions');
  assert(!JSON.stringify(restorePreview.data).includes('fixture-playlist'), 'sync restore preview must not expose playlist ids');
  const badRestoreConfirmation = await postJsonStatus('/api/sync/backups/restore', {
    backupId: createdBackup.data.backup.id,
    dryRun: false,
    refresh: false,
    confirmText: 'RESTORE',
  }, 400);
  assert(badRestoreConfirmation.ok === false, 'real sync restore should require the exact backup confirmation');
  const profile = await postJson('/api/ai/profile', { refresh: true });
  assert(profile.ok, '/api/ai/profile should return ok');
  assert(Number(profile.data?.summary?.trackCount || 0) > 0, 'AI profile should summarize local tracks');
  assert(profile.data?.model?.used === false, 'AI profile should default to deterministic local mode');
  assert(profile.data?.aiSummary?.source === 'deterministic', 'AI profile should include a deterministic summary');
  assert(!JSON.stringify(profile.data).includes('raw'), 'AI profile must not expose raw provider payloads');
  const profileNoConsent = await postJsonStatus('/api/ai/profile', {
    refresh: true,
    useModel: true,
    apiKey: 'sk-this-must-not-be-sent',
  }, 400);
  assert(profileNoConsent.ok === false, 'model-backed AI profile should require consent');
  const aiProvider = await getJson('/api/ai/provider');
  assert(aiProvider.ok, '/api/ai/provider should return ok');
  assert(aiProvider.data?.provider === 'deepseek', 'AI provider should default to deepseek');
  assert(!JSON.stringify(aiProvider.data).includes('sk-'), 'AI provider state must not expose API keys');
  const savedAiProvider = await postJson('/api/ai/provider', {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    baseUrl: 'https://api.deepseek.com',
    batchSize: 7,
    apiKey: 'sk-this-must-not-be-saved',
  });
  assert(savedAiProvider.ok, 'AI provider save should return ok');
  assert(savedAiProvider.data?.batchSize === 7, 'AI provider save should persist non-secret preferences');
  assert(!JSON.stringify(savedAiProvider.data).includes('sk-this-must-not-be-saved'), 'AI provider save must not echo API keys');
  const providerTestNoConsent = await postJsonStatus('/api/ai/provider/test', {
    apiKey: 'sk-this-must-not-be-sent',
  }, 400);
  assert(providerTestNoConsent.ok === false, 'AI provider test should require consent before any external request');
  const similar = await postJson('/api/ai/similar', {
    seed: { title: 'Night Drive', artist: 'Carol', durationMs: 180000 },
    limit: 5,
  });
  assert(similar.ok, '/api/ai/similar should return ok');
  assert(similar.data?.seed?.track?.title === 'Night Drive', 'similar should echo a sanitized seed track');
  const recommendations = await postJson('/api/ai/recommend', {
    limit: 5,
    saveShortlist: true,
    shortlistName: 'HTTP smoke picks',
  });
  assert(recommendations.ok, '/api/ai/recommend should return ok');
  assert(recommendations.data?.excludes?.providerWrites === true, 'recommendations must not imply provider writes');
  assert(recommendations.data?.model?.used === false, 'recommendations should default to deterministic local mode');
  assert(recommendations.data?.savedShortlist?.trackCount >= 0, 'recommendations should report saved shortlist summary');
  assert(!JSON.stringify(recommendations.data).includes('raw'), 'recommendations must not expose raw provider payloads');
  assert(!JSON.stringify(recommendations.data).includes('sk-'), 'recommendations must not expose API keys');
  const recommendationNoConsent = await postJsonStatus('/api/ai/recommend', {
    limit: 5,
    useModel: true,
    apiKey: 'sk-this-must-not-be-sent',
  }, 400);
  assert(recommendationNoConsent.ok === false, 'model-backed recommendations should require consent');
  const agentTools = await getJson('/api/agent/tools');
  assert(agentTools.ok, '/api/agent/tools should return ok');
  assert(agentTools.data?.tools?.length > 0, 'agent tools should list tools');
  assert(agentTools.data.tools.every((tool) => (tool.readOnly || tool.localDraft) && !tool.mutatesProvider && !tool.exposesCredentials), 'agent tools must be read-only or local-draft and credential-free');
  assert(agentTools.data.tools.some((tool) => tool.name === 'get_track_evidence' && tool.readOnly === true), 'agent tools should expose read-only track evidence lookup');
  assert(agentTools.data.tools.some((tool) => tool.name === 'get_baseline_diff' && tool.readOnly === true), 'agent tools should expose read-only baseline diff lookup');
  assert(agentTools.data.tools.some((tool) => tool.name === 'get_review_queue' && tool.readOnly === true), 'agent tools should expose read-only review queue lookup');
  assert(agentTools.data.tools.some((tool) => tool.name === 'save_local_shortlist' && tool.localDraft === true), 'agent tools should expose local shortlist draft saving');
  const agentChat = await postJson('/api/agent/chat', {
    message: '推荐一些可能喜欢的歌',
    arguments: { limit: 3, seed: { title: 'Private Smoke Title', artist: 'Private Smoke Artist' } },
  });
  assert(agentChat.ok, '/api/agent/chat should return ok');
  assert(agentChat.data?.tool === 'recommend_by_profile', 'agent chat should route recommendation prompt to recommendation tool');
  assert(agentChat.data?.mutatesProvider === false, 'agent chat result must not mutate providers');
  assert(agentChat.data?.traceId, 'agent chat should return a trace id');
  const agentSessions = await getJson('/api/agent/sessions?limit=1&traceLimit=5');
  assert(agentSessions.ok, '/api/agent/sessions should return ok');
  assert(agentSessions.data?.sessions?.[0]?.toolTraces?.some((trace) => trace.tool === 'recommend_by_profile'), 'agent sessions should include the recommendation trace');
  const recommendationTrace = agentSessions.data.sessions[0].toolTraces.find((trace) => trace.tool === 'recommend_by_profile');
  assert(recommendationTrace.readOnly === true, 'agent trace should be marked read-only');
  assert(recommendationTrace.mutatesProvider === false, 'agent trace should be marked non-mutating');
  assert(recommendationTrace.exposesCredentials === false, 'agent trace should be marked credential-free');
  const agentShortlist = await postJson('/api/agent/chat', {
    tool: 'save_local_shortlist',
    arguments: { limit: 3, name: 'HTTP smoke Agent picks' },
  });
  assert(agentShortlist.ok, '/api/agent/chat should save local shortlist drafts');
  assert(agentShortlist.data?.tool === 'save_local_shortlist', 'agent shortlist save should use the local draft tool');
  assert(agentShortlist.data?.readOnly === false, 'agent shortlist save should not claim to be read-only');
  assert(agentShortlist.data?.localDraft === true, 'agent shortlist save should be marked local draft');
  assert(agentShortlist.data?.mutatesProvider === false, 'agent shortlist save must not mutate providers');
  assert(agentShortlist.data?.result?.savedShortlist?.trackCount >= 0, 'agent shortlist save should report saved draft summary');
  const agentFeedback = await postJson('/api/agent/trace-feedback', {
    sessionId: agentSessions.data.sessions[0].id,
    traceId: recommendationTrace.id,
    label: 'useful',
  });
  assert(agentFeedback.ok, '/api/agent/trace-feedback should return ok');
  assert(agentFeedback.data?.feedback?.label === 'useful', 'agent trace feedback should persist the selected label');
  assert(agentFeedback.data?.sessions?.sessions?.[0]?.toolTraces?.some((trace) => trace.feedback?.label === 'useful'), 'agent trace feedback should be visible in sanitized sessions');
  const badAgentFeedback = await postJsonStatus('/api/agent/trace-feedback', {
    sessionId: agentSessions.data.sessions[0].id,
    traceId: recommendationTrace.id,
    label: 'raw_text',
  }, 400);
  assert(badAgentFeedback.ok === false, 'agent trace feedback should reject unsupported labels');
  const agentSessionText = JSON.stringify(agentSessions.data);
  assert(agentSessionText.includes('argumentsSummary'), 'agent trace should include an argument summary');
  assert(agentSessionText.includes('resultSummary'), 'agent trace should include a result summary');
  assert(!agentSessionText.includes('Private Smoke Title'), 'agent traces must not persist raw seed titles');
  assert(!agentSessionText.includes('Private Smoke Artist'), 'agent traces must not persist raw seed artists');
  assert(!agentSessionText.includes('sk-'), 'agent traces must not expose API keys');
  assert(!agentSessionText.includes('"raw"'), 'agent traces must not expose raw payloads');
  const forbiddenAgentTool = await postJsonStatus('/api/agent/chat', {
    tool: 'delete_provider_track',
  }, 403);
  assert(forbiddenAgentTool.ok === false, 'agent chat should reject direct provider mutation tools');

  const metrics = await fetchText('/metrics');
  assert(metrics.includes('music_likes_sync_http_requests_total'), '/metrics should expose HTTP counters');
  const encodedTraversal = await fetchText('/..%2fpackage.json', { expectedStatus: 403 });
  assert(encodedTraversal.includes('Forbidden'), 'encoded path traversal should be forbidden');
  const badEncoding = await fetchText('/%E0%A4%A', { expectedStatus: 400 });
  assert(badEncoding.includes('Bad request'), 'bad percent encoding should return 400');
  const badJson = await postRaw('/api/mirror/apply', '{', { expectedStatus: 400 });
  assert(badJson.includes('有效 JSON'), 'bad JSON body should return 400');
  const oversizedBody = await postRaw('/api/mirror/apply', 'x'.repeat((25 * 1024 * 1024) + 1), { expectedStatus: 413 });
  assert(oversizedBody.includes('请求体过大'), 'oversized JSON body should return 413');

  const generatedPlan = await postJson('/api/mirror/plan', {
    target: 'netease',
    threshold: 0.82,
    reviewThreshold: 0.68,
  });
  assert(generatedPlan.ok, 'mirror plan generation should return ok');

  const plan = await getJson('/api/mirror/plan');
  const hasMirrorPlan = Boolean(plan.ok && plan.plan?.mode === 'source_of_truth_mirror');
  if (!hasMirrorPlan && requireMirrorPlan) {
    throw new Error('No mirror plan exists. Generate one before running --require-mirror-plan smoke.');
  }

  const result = {
    stateOk: Boolean(state.ok),
    mirrorExists: Boolean(hasMirrorPlan),
    metrics: true,
    staticGuards: true,
    apiGuards: true,
    mirrorPlan: hasMirrorPlan ? plan.plan.target?.platform || 'target' : 'skipped',
    addOnly: 'skipped',
    removeOnly: 'skipped',
    mirrorDecision: 'skipped',
    midOnlyRemove: 'skipped',
    productApi: 'skipped',
    syncBackup: {
      targets: createdBackup.data.backup.targets.length,
      restoreMissing: restorePreview.data.plan.missing,
    },
    musicIntelligence: {
      profileTracks: profile.data.summary.trackCount,
      similar: similar.data.total,
      recommendations: recommendations.data.total,
      agentToolCount: agentTools.data.tools.length,
      agentTool: agentChat.data.tool,
      aiProvider: savedAiProvider.data.provider,
    },
  };

  if (hasMirrorPlan) {
    const productCheck = await postJson('/api/sync/check', {
      mode: 'canonical_mirror',
      platforms: ['apple', 'qq', 'netease'],
      target: 'qq',
      targets: ['qq', 'netease'],
    });
    assert(productCheck.ok, 'product sync check should return ok');
    assert(productCheck.data?.mode === 'canonical_mirror', 'product sync check should use canonical mirror mode');
    assert(productCheck.data?.counts?.will_add >= 0, 'product sync check should return grouped counts');
    const addAiReviewGuard = await postJsonStatus('/api/ai/additions/review', {
      consent: false,
      targets: ['qq', 'netease'],
      limit: 2,
    }, 400);
    assert(addAiReviewGuard.ok === false, 'product add AI review should require explicit consent');
    assert(!JSON.stringify(addAiReviewGuard).match(/cookie|apiKey|authorization/i), 'product add AI review guard must stay redacted');
    const identityAiReviewGuard = await postJsonStatus('/api/ai/identity/review', {
      consent: false,
      targets: ['qq', 'netease'],
      limit: 2,
    }, 400);
    assert(identityAiReviewGuard.ok === false, 'product identity AI review should require explicit consent');
    assert(!JSON.stringify(identityAiReviewGuard).match(/cookie|apiKey|authorization/i), 'product identity AI review guard must stay redacted');

    const identityReviewPreview = await getJson('/api/sync/preview?bucket=needs_confirmation&limit=20');
    const identityReview = identityReviewPreview.data?.items?.find((item) => item.action === 'review');
    assert(identityReview?.id, 'canonical preview should expose a durable identity review item');
    const keptIdentity = await postJson('/api/sync/identity-decision', {
      operationId: identityReview.id,
      action: 'keep',
      bucket: 'will_keep',
      previewLimit: 20,
    });
    assert(keptIdentity.ok, 'product identity decision should persist a keep decision');
    assert(keptIdentity.data?.action === 'keep', 'identity decision should echo keep');
    assert(keptIdentity.data?.updateMode === 'incremental', 'identity decision should patch the current preview incrementally');
    const decidedKeep = keptIdentity.data?.preview?.items?.find((item) => item.identityDecision?.action === 'keep');
    assert(decidedKeep?.id, 'updated preview should expose the durable keep decision');
    assert(decidedKeep.action === 'keep', 'same-version decision should become a safe keep operation');
    const clearedIdentity = await postJson('/api/sync/identity-decision', {
      operationId: decidedKeep.id,
      action: 'clear',
      bucket: 'needs_confirmation',
      previewLimit: 20,
    });
    assert(clearedIdentity.ok, 'product identity decision should support undo');
    const restoredIdentity = clearedIdentity.data?.preview?.items?.find((item) => item.action === 'review');
    assert(restoredIdentity?.id, 'undo should restore the identity review queue');
    const separatedIdentity = await postJson('/api/sync/identity-decision', {
      operationId: restoredIdentity.id,
      action: 'separate',
      bucket: 'needs_confirmation',
      previewLimit: 20,
    });
    assert(separatedIdentity.data?.resolutionOperationIds?.length === 1, 'different-version decisions should expose the add operation that needs candidate search');
    const pendingIdentityAddId = separatedIdentity.data.resolutionOperationIds[0];
    assert(separatedIdentity.data?.preview?.items?.some((item) => item.id === pendingIdentityAddId && item.status === 'needs_resolution'), 'candidate-search operation should remain visible in the review queue');
    const clearedSeparateIdentity = await postJson('/api/sync/identity-decision', {
      operationId: pendingIdentityAddId,
      action: 'clear',
      bucket: 'needs_confirmation',
      previewLimit: 20,
    });
    const restoredSeparateIdentity = clearedSeparateIdentity.data?.preview?.items?.find((item) => item.id === pendingIdentityAddId && item.action === 'review');
    assert(restoredSeparateIdentity?.id, 'undo should restore a review after a different-version decision');
    const identityPlan = JSON.parse(await fs.readFile(path.join(tempRoot, 'data', 'sync-preview.json'), 'utf8'));
    const identityOperation = identityPlan.operations.find((item) => item.id === restoredSeparateIdentity.id);
    assert(identityOperation?.decisionKey, 'identity review operation should retain a stable decision key');
    await fs.writeFile(path.join(tempRoot, 'data', 'mirror-ai-suggestions.json'), JSON.stringify({
      version: 1,
      updatedAt: '2026-07-11T00:00:00.000Z',
      items: {
        [identityOperation.decisionKey]: {
          itemId: identityOperation.decisionKey,
          decisionKey: identityOperation.decisionKey,
          operationId: identityOperation.id,
          target: identityOperation.targetPlatform,
          decision: 'same',
          relation: 'same_recording',
          recommendedAction: 'keep',
          confidence: 0.99,
          reason: 'HTTP smoke fixture identity evidence agrees.',
          batchId: 'identity-http-smoke',
          model: 'fixture-model',
          reviewedAt: '2026-07-11T00:00:00.000Z',
        },
      },
      batches: [],
    }), 'utf8');
    const aiIdentityConfirmGuard = await postJsonStatus('/api/ai/identity/apply', {
      confirmText: 'wrong',
      threshold: 0.9,
    }, 400);
    assert(aiIdentityConfirmGuard.ok === false, 'AI identity apply should require exact confirmation');
    const approvedIdentityAi = await postJson('/api/ai/identity/apply', {
      confirmText: 'APPLY HIGH CONFIDENCE AI IDENTITY DRAFTS',
      threshold: 0.9,
      operationIds: [identityOperation.id],
      authorizationNote: 'HTTP smoke explicit user approval.',
      bucket: 'will_keep',
    });
    assert(approvedIdentityAi.data?.applied === 1, 'explicit AI identity approval should apply one high-confidence draft');
    const approvedIdentityItem = approvedIdentityAi.data?.preview?.items?.find((item) => item.identityDecision?.action === 'keep');
    assert(approvedIdentityItem?.identityDecision?.source === 'ai_user_approved', 'AI-approved identity decision should retain approval provenance');
    await postJson('/api/sync/identity-decision', {
      operationId: approvedIdentityItem.id,
      action: 'clear',
      bucket: 'needs_confirmation',
    });
    const aiAddConfirmGuard = await postJsonStatus('/api/ai/additions/apply', {
      confirmText: 'wrong',
      threshold: 0.9,
    }, 400);
    assert(aiAddConfirmGuard.ok === false, 'AI addition apply should require exact confirmation');
    const agentReviewQueue = await postJson('/api/agent/chat', {
      tool: 'get_review_queue',
      arguments: { bucket: 'all', limit: 5 },
    });
    assert(agentReviewQueue.ok, '/api/agent/chat should return review queue after a sync preview exists');
    assert(agentReviewQueue.data?.tool === 'get_review_queue', 'agent review queue should use the review queue tool');
    assert(agentReviewQueue.data?.readOnly === true, 'agent review queue should be read-only');
    assert(agentReviewQueue.data?.mutatesProvider === false, 'agent review queue must not mutate providers');
    assert(agentReviewQueue.data?.result?.exists === true, 'agent review queue should find the current preview');
    assert(Array.isArray(agentReviewQueue.data?.result?.items), 'agent review queue should return items');
    assert(!JSON.stringify(agentReviewQueue.data).includes('tombstoneKey'), 'agent review queue must not expose tombstone keys');
    assert(!JSON.stringify(agentReviewQueue.data).match(/cookie|sk-this-must-not-be-sent/i), 'agent review queue must not expose credential-shaped data');
    const agentEvidence = await postJson('/api/agent/chat', {
      tool: 'get_track_evidence',
      arguments: { bucket: 'needs_confirmation' },
    });
    assert(agentEvidence.ok, '/api/agent/chat should return track evidence after a sync preview exists');
    assert(agentEvidence.data?.tool === 'get_track_evidence', 'agent evidence lookup should use the track evidence tool');
    assert(agentEvidence.data?.readOnly === true, 'agent evidence lookup should be read-only');
    assert(agentEvidence.data?.mutatesProvider === false, 'agent evidence lookup must not mutate providers');
    assert(agentEvidence.data?.result?.exists === true, 'agent evidence lookup should find a preview item by bucket');
    assert(agentEvidence.data?.result?.evidence?.sourceTrack, 'agent evidence lookup should return source track evidence');
    assert(Array.isArray(agentEvidence.data?.result?.evidenceRefs), 'agent evidence lookup should return evidence refs');
    assert(!Object.prototype.hasOwnProperty.call(agentEvidence.data.result.evidence.sourceTrack, 'id'), 'agent evidence source track must not expose provider ids');
    assert(!Object.prototype.hasOwnProperty.call(agentEvidence.data.result.evidence.sourceTrack, 'mid'), 'agent evidence source track must not expose provider mids');
    assert(!JSON.stringify(agentEvidence.data).match(/cookie|sk-this-must-not-be-sent/i), 'agent evidence lookup must not expose credential-shaped data');
    const productPreview = await getJson('/api/sync/preview?bucket=needs_confirmation');
    assert(productPreview.ok, 'product sync preview should return ok');
    assert(productPreview.data?.bucket === 'needs_confirmation', 'product sync preview should honor bucket filter');
    const previewPageOne = await getJson('/api/sync/preview?bucket=needs_confirmation&limit=1');
    assert(previewPageOne.data?.items?.length === 1, 'product sync preview should honor page size');
    assert(previewPageOne.data?.nextCursor === '1', 'product sync preview should return the next cursor');
    const previewPageTwo = await getJson(`/api/sync/preview?bucket=needs_confirmation&limit=1&cursor=${previewPageOne.data.nextCursor}`);
    assert(previewPageTwo.data?.items?.length === 1, 'product sync preview should load the next page');
    assert(previewPageTwo.data.items[0].id !== previewPageOne.data.items[0].id, 'product sync preview cursor should advance without duplicate items');
    const staleMedia = await postJsonStatus('/api/sync/media', {
      previewId: 'preview-stale',
      operationId: productPreview.data.items[0]?.id,
      role: 'source',
    }, 409);
    assert(staleMedia.ok === false, 'sync media should reject stale preview ids before provider access');
    const unknownMedia = await postJsonStatus('/api/sync/media', {
      previewId: productPreview.data.previewId,
      operationId: 'unknown-operation',
      role: 'source',
    }, 404);
    assert(unknownMedia.ok === false, 'sync media should only resolve tracks from the current preview');
    assert(!JSON.stringify(unknownMedia).match(/cookie|qm_keyst|MUSIC_U|authorization/i), 'sync media errors must not expose credentials');
    const productResolveAdditions = await postJson('/api/sync/resolve-additions', {
      targets: ['qq', 'netease'],
      bucket: 'will_add',
      resolveLimit: 10,
      searchLimit: 3,
    });
    assert(productResolveAdditions.ok, 'product add resolution should return ok');
    assert(Array.isArray(productResolveAdditions.data?.addResolution?.targets), 'product add resolution should report per-target results');
    assert(!JSON.stringify(productResolveAdditions.data).includes('sk-'), 'product add resolution must not expose secrets');
    const productExplain = await postJson('/api/ai/explain', {
      operationId: productPreview.data.items[0]?.id,
      useModel: false,
    });
    assert(productExplain.ok, 'product AI explanation should return ok');
    assert(productExplain.data?.model?.used === false, 'product AI explanation should default to deterministic local mode');
    assert(productExplain.data?.explanation?.summary, 'product AI explanation should include a summary');
    assert(!JSON.stringify(productExplain.data).includes('sk-'), 'product AI explanation must not expose secrets');
    const productExplainNoConsent = await postJsonStatus('/api/ai/explain', {
      operationId: productPreview.data.items[0]?.id,
      useModel: true,
    }, 400);
    assert(productExplainNoConsent.ok === false, 'model-backed product AI explanation should require consent');
    const tombstoneRisk = await postJson('/api/ai/tombstones/analyze', {
      limit: 10,
      useModel: false,
    });
    assert(tombstoneRisk.ok, 'product tombstone risk analysis should return ok');
    assert(tombstoneRisk.data?.model?.used === false, 'product tombstone risk analysis should default to deterministic local mode');
    assert(Array.isArray(tombstoneRisk.data?.groups), 'product tombstone risk analysis should return group data');
    assert(!JSON.stringify(tombstoneRisk.data).includes('sk-'), 'product tombstone risk analysis must not expose secrets');
    const tombstoneRiskNoConsent = await postJsonStatus('/api/ai/tombstones/analyze', {
      limit: 10,
      useModel: true,
    }, 400);
    assert(tombstoneRiskNoConsent.ok === false, 'model-backed tombstone risk analysis should require consent');
    const productAddOnly = await postJson('/api/sync/execute-additions', {
      dryRun: true,
      targets: ['qq', 'netease'],
    });
    assert(productAddOnly.ok, 'product multi-target add-only execution should return ok');
    assert(productAddOnly.data?.target === 'multi', 'product multi-target add-only execution should aggregate targets');
    assert(productAddOnly.data?.targets?.qq, 'product add-only execution should include QQ target result');
    assert(productAddOnly.data?.targets?.netease, 'product add-only execution should include NetEase target result');
    assert(Number(productAddOnly.data?.remove?.requested || 0) === 0, 'product add-only execution must not request removals');
    const qqLiveValidationReport = path.join(tempRoot, 'reports', 'live-validation-qq.json');
    const qqLiveValidationReportText = await fs.readFile(qqLiveValidationReport, 'utf8');
    await fs.rm(qqLiveValidationReport, { force: true });
    const productAddWithoutLiveValidation = await postJsonStatus('/api/sync/execute-additions', {
      dryRun: false,
      targets: ['qq'],
    }, 409);
    assert(productAddWithoutLiveValidation.ok === false, 'real product additions should require live validation evidence');
    assert(
      String(productAddWithoutLiveValidation.error || '').includes('live validation'),
      'real product additions should explain the live validation requirement',
    );
    await fs.writeFile(qqLiveValidationReport, qqLiveValidationReportText, 'utf8');

    await fs.rm(path.join(tempRoot, 'data', 'sync-add-state.json'), { force: true });
    const neteaseProductCheck = await postJson('/api/sync/check', {
      mode: 'canonical_mirror',
      platforms: ['apple', 'netease'],
      target: 'netease',
      targets: ['netease'],
    });
    assert(neteaseProductCheck.ok, 'product single-target sync check should return ok for deletion flow');
    const currentProductDeletePreview = await getJson('/api/sync/preview?bucket=may_delete&limit=20');
    const currentProductDeletePlan = JSON.parse(await fs.readFile(path.join(tempRoot, 'data', 'sync-preview.json'), 'utf8'));
    const confirmableRemove = currentProductDeletePlan.operations.find((operation) => (
      operation.action === 'remove'
      && !productAddReferencesTarget(currentProductDeletePlan, operation)
    ));
    const firstRemove = currentProductDeletePreview.data.items.find((operation) => operation.id === confirmableRemove?.id);
    assert(firstRemove, 'product fixture should have a removable item');
    const deleteBeforeConfirm = await postJsonStatus('/api/sync/execute-deletions', {
      dryRun: true,
      targets: ['netease'],
      operationIds: [firstRemove.id],
    }, 409);
    assert(deleteBeforeConfirm.ok === false, 'delete execution should fail before confirmation');
    const confirmDelete = await postJson('/api/sync/confirm-deletions', {
      targets: ['netease'],
      operationIds: [firstRemove.id],
      confirmText: 'DELETE FROM NETEASE',
    });
    assert(confirmDelete.ok, 'product deletion confirmation should return ok');
    assert(confirmDelete.data?.confirmed === 1, 'product deletion confirmation should confirm one operation');
    const productDeleteOnly = await postJson('/api/sync/execute-deletions', {
      dryRun: true,
      targets: ['netease'],
      operationIds: [firstRemove.id],
    });
    assert(productDeleteOnly.ok, 'product delete-only dry-run should return ok after confirmation');
    assert(Number(productDeleteOnly.data?.add?.requested || 0) === 0, 'product delete-only execution must not request additions');
    assert(Number(productDeleteOnly.data?.remove?.requested || 0) === 1, 'product delete-only execution should request the confirmed deletion');
    result.productApi = {
      previewId: productCheck.data.previewId,
      needsConfirmation: productPreview.data.total,
      addResolutionTargets: productResolveAdditions.data.addResolution?.targets?.length || 0,
      tombstoneRiskGroups: tombstoneRisk.data.groups?.length || 0,
      addOnlyRemoveRequested: productAddOnly.data.remove?.requested || 0,
      addOnlyTargets: productAddOnly.data.targetOrder || [],
      deleteOnlyAddRequested: productDeleteOnly.data.add?.requested || 0,
      confirmedDeletes: confirmDelete.data.confirmed,
      explanation: productExplain.data.explanation?.recommendedAction || '',
    };

    const reviewItems = plan.plan.operations
      .filter((operation) => operation.action === 'review')
      .map((operation) => ({
        key: operation.decisionKey,
        target: plan.plan.target?.platform,
        operationId: operation.id,
        reason: operation.reason,
      }));
    assert(reviewItems.length > 0, 'fixture mirror plan should include review operations');

    const decision = await postJson('/api/mirror/decisions', {
      action: 'keep',
      target: plan.plan.target?.platform,
      items: reviewItems,
    });
    assert(decision.ok, 'mirror decision batch should return ok');
    assert(decision.result?.requested === reviewItems.length, 'mirror decision batch should process visible review items');
    assert(decision.result?.changed === reviewItems.length, 'mirror decision batch should change every fixture review item');
    assert(Number(decision.result?.plan?.summary?.review || 0) === 0, 'mirror decision batch should rebuild plan without reviewed items');

    const addOnly = await postJson('/api/mirror/apply', {
      dryRun: true,
      actions: ['add'],
    });
    const removeOnly = await postJson('/api/mirror/apply', {
      dryRun: true,
      actions: ['remove'],
    });
    const convergence = await postJson('/api/mirror/convergence', {
      refreshTarget: false,
      persist: false,
    });
    assert(addOnly.ok, 'add-only mirror dry-run should return ok');
    assert(removeOnly.ok, 'remove-only mirror dry-run should return ok');
    assert(convergence.ok, 'mirror convergence check should return ok');
    assert(Number(addOnly.result?.remove?.requested || 0) === 0, 'add-only dry-run must not request removals');
    assert(Number(removeOnly.result?.add?.requested || 0) === 0, 'remove-only dry-run must not request additions');
    assert(/^[a-f0-9]{64}$/i.test(String(addOnly.result?.idempotencyKey || '')), 'add-only dry-run should include an idempotency key');
    assert(/^[a-f0-9]{64}$/i.test(String(removeOnly.result?.idempotencyKey || '')), 'remove-only dry-run should include an idempotency key');
    assert(String(addOnly.result?.runId || '').startsWith('mirror-run-'), 'add-only dry-run should include a run id');
    assert(String(removeOnly.result?.runId || '').startsWith('mirror-run-'), 'remove-only dry-run should include a run id');
    result.addOnly = {
      addRequested: addOnly.result.add?.requested || 0,
      removeRequested: addOnly.result.remove?.requested || 0,
      runId: addOnly.result.runId,
    };
    result.removeOnly = {
      addRequested: removeOnly.result.add?.requested || 0,
      removeRequested: removeOnly.result.remove?.requested || 0,
      runId: removeOnly.result.runId,
    };
    result.convergence = {
      status: convergence.result?.convergence?.status || 'unknown',
      persisted: Boolean(convergence.result?.persisted),
      add: convergence.result?.convergence?.add || 0,
      remove: convergence.result?.convergence?.remove || 0,
      review: convergence.result?.convergence?.review || 0,
    };
    result.mirrorDecision = {
      requested: decision.result.requested || 0,
      changed: decision.result.changed || 0,
      reviewAfter: decision.result.plan?.summary?.review || 0,
    };

    const generatedQqPlan = await postJson('/api/mirror/plan', {
      target: 'qq',
      threshold: 0.82,
      reviewThreshold: 0.68,
    });
    assert(generatedQqPlan.ok, 'QQ mirror plan generation should return ok');
    const midOnlyRemove = await postJson('/api/mirror/apply', {
      dryRun: true,
      actions: ['remove'],
    });
    assert(midOnlyRemove.ok, 'QQ mid-only remove dry-run should return ok');
    assert(Number(midOnlyRemove.result?.remove?.requested || 0) > 0, 'QQ fixture should request a remove');
    assert(Number(midOnlyRemove.result?.remove?.blocked || 0) > 0, 'QQ mid-only remove should be blocked');
    assert(Number(midOnlyRemove.result?.remove?.executable || 0) === 0, 'QQ mid-only remove should not be executable');
    assert(Number(midOnlyRemove.result?.blocked?.invalidRemoves || 0) > 0, 'QQ mid-only remove should report invalidRemoves');
    result.midOnlyRemove = {
      requested: midOnlyRemove.result.remove?.requested || 0,
      executable: midOnlyRemove.result.remove?.executable || 0,
      blocked: midOnlyRemove.result.remove?.blocked || 0,
      invalidRemoves: midOnlyRemove.result.blocked?.invalidRemoves || 0,
    };

    await seedMirrorFixtures(tempRoot);
    const baselineBefore = await getJson('/api/sync/baseline');
    assert(baselineBefore.ok, 'product baseline read should return ok before save');
    assert(baselineBefore.data?.baseline?.exists === false, 'isolated product baseline should start missing');
    const savedBaseline = await postJson('/api/sync/baseline/save', {
      platforms: ['apple', 'qq', 'netease'],
      policy: 'managed_bidirectional',
      source: 'http-smoke',
    });
    assert(savedBaseline.ok, 'product baseline save should return ok');
    assert(savedBaseline.data?.baseline?.exists, 'product baseline save should persist a baseline summary');
    assert(Number(savedBaseline.data?.baseline?.summary?.platforms || 0) === 3, 'product baseline should include three platforms');

    await fs.writeFile(path.join(tempRoot, 'data', 'qq.json'), JSON.stringify(snapshot('qq', [
      track('q-1', 'Already There', 'Alice', 181000),
    ])), 'utf8');
    const baselineAfterTargetChange = await getJson('/api/sync/baseline?platforms=apple,qq,netease');
    assert(baselineAfterTargetChange.ok, 'product baseline read should return ok after target snapshot changes');
    assert(Number(baselineAfterTargetChange.data?.diff?.summary?.deleted || 0) >= 1, 'product baseline diff should summarize deletion signals');
    assert(Number(baselineAfterTargetChange.data?.diff?.platforms?.qq?.deleted || 0) >= 1, 'product baseline diff should expose per-platform deletion counts');
    const baselineExamples = baselineAfterTargetChange.data?.diff?.examples || [];
    assert(Array.isArray(baselineExamples) && baselineExamples.length > 0, 'product baseline diff should expose sanitized change examples');
    assert(
      baselineExamples.some((item) => item.platform === 'qq' && item.action === 'deleted' && item.title === 'Old Target Only'),
      'product baseline diff should include a readable QQ deletion example',
    );
    assert(
      baselineExamples.some((item) => Array.isArray(item.evidence) && item.evidence.includes('duration')),
      'product baseline diff examples should include compact evidence labels',
    );
    const agentBaselineDiff = await postJson('/api/agent/chat', {
      message: '基线和现在有什么差异',
      arguments: { platforms: ['apple', 'qq', 'netease'] },
    });
    assert(agentBaselineDiff.ok, '/api/agent/chat should return baseline diff evidence');
    assert(agentBaselineDiff.data?.tool === 'get_baseline_diff', 'agent baseline diff should route to the baseline diff tool');
    assert(agentBaselineDiff.data?.readOnly === true, 'agent baseline diff should be read-only');
    assert(agentBaselineDiff.data?.mutatesProvider === false, 'agent baseline diff must not mutate providers');
    assert(agentBaselineDiff.data?.result?.exists === true, 'agent baseline diff should report a saved baseline');
    assert(Number(agentBaselineDiff.data?.result?.diff?.summary?.deleted || 0) >= 1, 'agent baseline diff should include deletion signal counts');
    const agentBaselineText = JSON.stringify(agentBaselineDiff.data);
    assert(!agentBaselineText.includes('playlistId'), 'agent baseline diff must not expose playlist ids');
    assert(!agentBaselineText.includes('tombstoneKey'), 'agent baseline diff must not expose tombstone keys');
    assert(!agentBaselineText.includes('tokens'), 'agent baseline diff must not expose baseline tokens');
    const baselineExamplesText = JSON.stringify(baselineExamples);
    assert(!baselineExamplesText.includes('tombstoneKey'), 'product baseline diff examples must not expose tombstone keys');
    assert(!baselineExamplesText.includes('tokens'), 'product baseline diff examples must not expose match tokens');
    assert(!baselineExamplesText.includes('"id"'), 'product baseline diff examples must not expose provider track ids');
    const managedPreview = await postJson('/api/sync/check', {
      mode: 'managed_bidirectional',
      platforms: ['apple', 'qq', 'netease'],
      targets: ['qq', 'netease'],
    });
    assert(managedPreview.ok, 'managed product sync check should return ok with saved baseline');
    assert(Number(managedPreview.data?.counts?.needs_confirmation || 0) > 0, 'managed preview should keep tombstone candidates in manual review');
    const managedCandidateAddId = await markFirstManagedAddReviewCandidate(tempRoot, 'qq');
    const acceptedAddCandidate = await postJson('/api/sync/addition-decision', {
      operationId: managedCandidateAddId,
      action: 'accept_candidate',
    });
    assert(acceptedAddCandidate.ok, 'product add candidate acceptance should return ok');
    assert(acceptedAddCandidate.data?.operation?.status === 'ready', 'accepted add candidate should become ready');
    assert(acceptedAddCandidate.data?.operation?.addDecision?.action === 'accept_candidate', 'accepted add candidate should keep decision metadata');
    const skippedAddId = await markFirstManagedAddReviewCandidate(tempRoot, 'qq', [managedCandidateAddId]);
    const skippedAddCandidate = await postJson('/api/sync/addition-decision', {
      operationId: skippedAddId,
      action: 'skip',
    });
    assert(skippedAddCandidate.ok, 'product add candidate skip should return ok');
    assert(skippedAddCandidate.data?.operation?.status === 'blocked', 'skipped add candidate should become blocked');
    assert(skippedAddCandidate.data?.operation?.blockedReason === 'user_skipped_add_candidate', 'skipped add candidate should record a blocked reason');
    const batchCandidateIds = [];
    for (let index = 0; index < 2; index += 1) {
      try {
        batchCandidateIds.push(await markFirstManagedAddReviewCandidate(tempRoot, 'qq', [
          managedCandidateAddId,
          skippedAddId,
          ...batchCandidateIds,
        ]));
      } catch (error) {
        if (!String(error?.message || '').includes('managed preview should include an add operation')) throw error;
        break;
      }
    }
    assert(batchCandidateIds.length >= 1, 'managed preview should include at least one add candidate for batch decision coverage');
    const batchAcceptedCandidates = await postJson('/api/sync/addition-decisions', {
      operationIds: batchCandidateIds,
      action: 'accept_candidate',
    });
    assert(batchAcceptedCandidates.ok, 'product add candidate batch acceptance should return ok');
    assert(Number(batchAcceptedCandidates.data?.requested || 0) === batchCandidateIds.length, 'batch add decision should report requested ids');
    assert(Number(batchAcceptedCandidates.data?.changed || 0) === batchCandidateIds.length, 'batch add decision should accept every marked candidate');
    assert(batchAcceptedCandidates.data?.action === 'accept_candidate', 'batch add decision should echo the action');
    assert(typeof batchAcceptedCandidates.data?.batchId === 'string' && batchAcceptedCandidates.data.batchId.startsWith('add-decision-batch-'), 'batch add decision should include an audit batch id');
    const managedBatchAddOnly = await postJson('/api/sync/execute-additions', {
      dryRun: true,
      targets: ['qq'],
      operationIds: batchCandidateIds,
      resolve: false,
    });
    assert(managedBatchAddOnly.ok, 'managed add-only dry-run should return ok for batch-accepted policy additions');
    assert(Number(managedBatchAddOnly.data?.add?.requested || 0) === batchCandidateIds.length, 'managed add-only dry-run should request batch accepted additions only');
    const managedAddOnly = await postJson('/api/sync/execute-additions', {
      dryRun: true,
      targets: ['qq'],
      operationIds: [managedCandidateAddId],
      resolve: false,
    });
    assert(managedAddOnly.ok, 'managed add-only dry-run should return ok for ready policy additions');
    assert(Number(managedAddOnly.data?.add?.requested || 0) === 1, 'managed add-only dry-run should request the selected ready addition');
    assert(Number(managedAddOnly.data?.add?.executable || 0) === 1, 'managed add-only dry-run should treat resolved additions as executable');
    assert(Number(managedAddOnly.data?.remove?.requested || 0) === 0, 'managed add-only dry-run must not request removals');
    assert(managedAddOnly.data?.convergence?.skippedReason === 'dry_run', 'managed add dry-run should expose skipped post-write convergence');
    const managedDeleteBeforeTombstone = await postJsonStatus('/api/sync/execute-deletions', {
      dryRun: true,
      targets: ['netease'],
    }, 409);
    assert(managedDeleteBeforeTombstone.ok === false, 'managed delete execution should fail before tombstone confirmation');
    const tombstonePreview = await getJson('/api/sync/preview?bucket=needs_confirmation');
    const tombstoneCandidates = tombstonePreview.data.items.filter((item) => item.tombstoneKey);
    const tombstoneCandidate = tombstoneCandidates.find((item) => item.title === 'Provider Exclusive Archive') || tombstoneCandidates[0];
    assert(tombstoneCandidate, 'managed preview should include a tombstone candidate');
    const managedTombstoneRisk = await postJson('/api/ai/tombstones/analyze', {
      limit: 10,
      useModel: false,
    });
    assert(managedTombstoneRisk.ok, 'managed tombstone risk analysis should return ok');
    assert(Number(managedTombstoneRisk.data?.total || 0) >= tombstoneCandidates.length, 'managed tombstone risk analysis should cover deletion signals');
    assert(managedTombstoneRisk.data?.groups?.some((group) => group.id === 'needs_review'), 'managed tombstone risk analysis should group unhandled deletion signals');
    const batchTombstones = tombstoneCandidates.filter((item) => item.id !== tombstoneCandidate.id);
    let batchedTombstones = null;
    if (batchTombstones.length) {
      batchedTombstones = await postJson('/api/sync/tombstones', {
        action: 'current_platform_only',
        items: batchTombstones.map((item) => ({
          tombstoneKey: item.tombstoneKey,
          operationId: item.id,
          platform: item.sourcePlatform,
        })),
      });
      assert(batchedTombstones.ok, 'product tombstone batch decision should return ok');
      assert(batchedTombstones.data?.batch === true, 'product tombstone batch decision should report batch mode');
      assert(Number(batchedTombstones.data?.changed || 0) === batchTombstones.length, 'product tombstone batch should change every selected item');
      assert(Number(batchedTombstones.data?.tombstones?.actions?.current_platform_only || 0) >= batchTombstones.length, 'product tombstone batch should record current-platform-only actions');
    }
    const confirmedTombstone = await postJson('/api/sync/tombstones', {
      tombstoneKey: tombstoneCandidate.tombstoneKey,
      action: 'confirm_global_delete',
      confirmText: `CONFIRM GLOBAL DELETE FROM ${String(tombstoneCandidate.sourcePlatform || '').toUpperCase()}`,
    });
    assert(confirmedTombstone.ok, 'product tombstone global delete confirmation should return ok');
    assert(Number(confirmedTombstone.data?.tombstones?.actions?.confirm_global_delete || 0) >= 1, 'global tombstone confirmation should be recorded');
    const confirmedDeletePreview = await getJson('/api/sync/preview?bucket=all&limit=100');
    const policyRemove = confirmedDeletePreview.data.items.find((item) => (
      item.action === 'remove'
      && item.status === 'ready'
      && item.targetPlatforms?.[0]
    ));
    assert(policyRemove, `confirmed managed tombstone should create a ready policy remove operation: ${JSON.stringify(confirmedDeletePreview.data.items.map((item) => ({ action: item.action, status: item.status, title: item.title, reason: item.reason, blockedReason: item.blockedReason })))}`);
    const policyRemoveTarget = policyRemove.targetPlatforms[0];
    const managedDeleteOnly = await postJson('/api/sync/execute-deletions', {
      dryRun: true,
      targets: [policyRemoveTarget],
      operationIds: [policyRemove.id],
    });
    assert(managedDeleteOnly.ok, 'managed delete-only dry-run should return ok after tombstone confirmation');
    assert(Number(managedDeleteOnly.data?.remove?.requested || 0) === 1, 'managed delete-only dry-run should request the selected confirmed deletion');
    assert(Number(managedDeleteOnly.data?.add?.requested || 0) === 0, 'managed delete-only dry-run must not request additions');
    assert(managedDeleteOnly.data?.convergence?.skippedReason === 'dry_run', 'managed delete dry-run should expose skipped post-write convergence');
    const productConvergence = await postJson('/api/sync/convergence', {
      targets: ['qq', 'netease'],
      refreshTarget: false,
    });
    assert(productConvergence.ok, 'product convergence endpoint should return ok');
    assert(productConvergence.data?.convergence?.status, 'product convergence endpoint should expose a status');
    const blockedBaselineSave = await postJsonStatus('/api/sync/baseline/save', {
      platforms: ['apple', 'qq', 'netease'],
      policy: 'managed_bidirectional',
      source: 'http-smoke-require-converged',
      requireConverged: true,
      previewId: productConvergence.data?.convergence?.previewId,
    }, 409);
    assert(blockedBaselineSave.ok === false, 'convergence-gated baseline save should reject an open preview');
    const convergedPreviewId = await markSyncPreviewConverged(tempRoot);
    const convergedBaselineSave = await postJson('/api/sync/baseline/save', {
      platforms: ['apple', 'qq', 'netease'],
      policy: 'managed_bidirectional',
      source: 'http-smoke-converged-baseline',
      requireConverged: true,
      previewId: convergedPreviewId,
    });
    assert(convergedBaselineSave.ok, 'convergence-gated baseline save should accept a converged preview');
    assert(convergedBaselineSave.data?.convergence?.converged === true, 'convergence-gated baseline save should return converged evidence');
    const syncRuns = JSON.parse(await fs.readFile(path.join(tempRoot, 'data', 'sync-runs.json'), 'utf8'));
    assert(syncRuns.runs.some((run) => run.policy === 'managed_bidirectional' && run.action === 'add' && run.target === 'qq'), 'managed add execution should be recorded in sync-runs');
    assert(syncRuns.runs.some((run) => run.policy === 'managed_bidirectional' && run.action === 'remove' && run.target === policyRemoveTarget), 'managed delete execution should be recorded in sync-runs');
    const stateWithPolicyRuns = await getJson('/api/state');
    assert(Number(stateWithPolicyRuns.state?.sync?.policyRuns?.count || 0) >= 2, '/api/state should summarize policy sync runs');
    const appStateWithPolicyRuns = await getJson('/api/app/state');
    assert(Number(appStateWithPolicyRuns.data?.syncRuns?.count || 0) >= 2, '/api/app/state should expose product sync run summary');
    assert(appStateWithPolicyRuns.data?.lastSyncRun?.action === 'remove', '/api/app/state should expose the latest product sync run action');
    assert(appStateWithPolicyRuns.data?.lastSyncRun?.policy === 'managed_bidirectional', '/api/app/state should expose the latest product sync run policy');
    assert(appStateWithPolicyRuns.data?.lastSyncRun?.target === policyRemoveTarget, '/api/app/state should expose the latest product sync run target');
    assert(appStateWithPolicyRuns.data?.lastSyncRun?.dryRun === true, '/api/app/state should mark dry-run policy executions');
    assert(Number(appStateWithPolicyRuns.data?.lastSyncRun?.remove?.requested || 0) === 1, '/api/app/state should expose latest product remove counts');
    const lastRunText = JSON.stringify(appStateWithPolicyRuns.data?.lastSyncRun || {});
    assert(!lastRunText.includes('idempotencyKey'), '/api/app/state latest product run must not expose idempotency keys');
    assert(!lastRunText.includes('operationKeys'), '/api/app/state latest product run must not expose operation keys');
    assert(appStateWithPolicyRuns.data?.latestPreview?.convergence?.exists, '/api/app/state should expose product convergence summary');
    const ignoreCandidate = confirmedDeletePreview.data.items.find((item) => item.tombstoneKey && item.tombstoneKey !== tombstoneCandidate.tombstoneKey)
      || tombstoneCandidate;
    const ignoredTombstone = await postJson('/api/sync/tombstones', {
      tombstoneKey: ignoreCandidate.tombstoneKey,
      action: 'ignore',
    });
    assert(ignoredTombstone.ok, 'product tombstone decision should return ok');
    assert(Number(ignoredTombstone.data?.tombstones?.actions?.ignore || 0) >= 1, 'product tombstone decision should record ignore action');
    const activateManagedPreviewId = await markSyncPreviewConverged(tempRoot);
    const activatedManagedBaseline = await postJson('/api/sync/baseline/save', {
      platforms: ['apple', 'qq', 'netease'],
      targets: ['qq', 'netease'],
      policy: 'canonical_mirror',
      source: 'http-smoke-activate-managed',
      requireConverged: true,
      previewId: activateManagedPreviewId,
      activateManaged: true,
    });
    assert(activatedManagedBaseline.ok, 'baseline save should be able to activate managed sync after convergence');
    assert(activatedManagedBaseline.data?.activatedPolicy?.id === 'managed_bidirectional', 'baseline activation should return managed sync policy');
    const appStateAfterActivation = await getJson('/api/app/state');
    assert(appStateAfterActivation.data?.syncMode?.id === 'managed_bidirectional', 'app state should expose activated managed sync mode');
    const enabledAutoSync = await postJson('/api/auto-sync', {
      enabled: true,
      intervalMinutes: 15,
      targets: ['qq', 'netease'],
      refreshApple: false,
      refreshTargets: false,
      autoExecuteAdditions: false,
      requireBaseline: true,
      maxSourceAgeMinutes: 10080,
    });
    assert(enabledAutoSync.data?.automation?.enabled === true, 'auto-sync should enable after baseline and readiness gates pass');
    assert(enabledAutoSync.data?.readiness?.baseline?.required === true, 'managed sync should require its saved baseline');
    assert(!JSON.stringify(enabledAutoSync.data?.readiness?.baseline).includes('fixture-playlist'), 'auto-sync readiness must not expose baseline playlist ids');
    assert(enabledAutoSync.data?.automation?.nextRunAt, 'enabled auto-sync should persist the next run time');
    const autoSyncCheck = await postJson('/api/auto-sync/run', { dryRun: true, executeAdditions: false });
    assert(autoSyncCheck.data?.run?.dryRun === true, 'manual scheduled-flow check must remain non-mutating without explicit execute');
    assert(autoSyncCheck.data?.run?.preview?.previewId, 'manual scheduled-flow check should generate a sync preview');
    assert(autoSyncCheck.data?.history?.length >= 2, 'auto-sync history should retain canonical and managed checks');
    const appStateWithAutoSync = await getJson('/api/app/state');
    assert(appStateWithAutoSync.data?.autoSync?.enabled === true, '/api/app/state should expose enabled auto-sync state');
    assert(!JSON.stringify(appStateWithAutoSync.data?.autoSync).includes('operationId'), 'app auto-sync summary must not expose operation ids');
    result.productLifecycle = {
      baselineTracks: savedBaseline.data.baseline.summary?.tracks || 0,
      managedMayDelete: managedPreview.data.counts?.may_delete || 0,
      managedAddRequested: managedAddOnly.data.add?.requested || 0,
      managedAddExecutable: managedAddOnly.data.add?.executable || 0,
      managedDeleteRequested: managedDeleteOnly.data.remove?.requested || 0,
      managedDeleteTarget: policyRemoveTarget,
      managedAddConvergence: managedAddOnly.data.convergence?.skippedReason || '',
      managedDeleteConvergence: managedDeleteOnly.data.convergence?.skippedReason || '',
      productConvergence: productConvergence.data.convergence?.status || '',
      batchedTombstones: batchedTombstones?.data?.changed || 0,
      tombstoneRiskGroups: managedTombstoneRisk.data.groups?.length || 0,
      syncRuns: syncRuns.runs.length,
      tombstoneActions: ignoredTombstone.data.tombstones?.actions || {},
      activatedPolicy: activatedManagedBaseline.data.activatedPolicy?.id || '',
      autoSyncEnabled: appStateWithAutoSync.data.autoSync.enabled,
      autoSyncHistory: autoSyncCheck.data.history.length,
    };
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  child.kill();
  await sleep(250);
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with ${child.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    try {
      await getJson('/api/state');
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Server did not become ready\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `${path} HTTP ${response.status}`);
  return payload;
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `${path} HTTP ${response.status}`);
  return payload;
}

async function postJsonStatus(path, body, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(`${path} HTTP ${response.status}, expected ${expectedStatus}: ${JSON.stringify(payload).slice(0, 200)}`);
  }
  return payload;
}

async function postRaw(path, body, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const text = await response.text();
  const expectedStatus = options.expectedStatus || 200;
  if (response.status !== expectedStatus) {
    throw new Error(`${path} HTTP ${response.status}, expected ${expectedStatus}: ${text.slice(0, 200)}`);
  }
  return text;
}

async function fetchText(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { cache: 'no-store' });
  const text = await response.text();
  const expectedStatus = options.expectedStatus || 200;
  if (response.status !== expectedStatus) {
    throw new Error(`${path} HTTP ${response.status}, expected ${expectedStatus}: ${text.slice(0, 200)}`);
  }
  return text;
}

async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selectedPort = typeof address === 'object' && address ? Number(address.port) : 0;
      server.close(() => {
        if (selectedPort) resolve(selectedPort);
        else reject(new Error('Unable to reserve a local port for HTTP smoke.'));
      });
    });
  });
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function seedMirrorFixtures(root) {
  const dataDir = path.join(root, 'data');
  const reportDir = path.join(root, 'reports');
  const packageInfo = await readPackageInfo();
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'apple.json'), JSON.stringify(snapshot('apple', [
    track('a-1', 'Already There', 'Alice', 180000),
    track('a-2', 'New Day', 'Bob', 210000),
    track('a-3', 'Night Drive', 'Carol', 180000),
  ])), 'utf8');
  await fs.writeFile(path.join(dataDir, 'netease.json'), JSON.stringify(snapshot('netease', [
    track('n-1', 'Already There', 'Alice', 181000),
    track('n-2', 'Old Target Only', 'Dora', 200000),
    track('n-3', 'Night Drive Acoustic', 'Carol', 190000),
    track('n-4', 'Provider Exclusive Archive', 'Zed', 101000),
  ])), 'utf8');
  await fs.writeFile(path.join(dataDir, 'qq.json'), JSON.stringify(snapshot('qq', [
    track('q-1', 'Already There', 'Alice', 181000),
    qqMidOnlyTrack('qq-mid-old-target-only', 'Old Target Only', 'Dora', 200000),
    track('q-3', 'Night Drive Acoustic', 'Carol', 190000),
    qqMidOnlyTrack('qq-mid-provider-exclusive', 'Provider Exclusive Archive', 'Zed', 101000),
  ])), 'utf8');
  await fs.writeFile(path.join(reportDir, 'live-validation-qq.json'), JSON.stringify(liveValidationReport('qq', packageInfo)), 'utf8');
  await fs.writeFile(path.join(reportDir, 'live-validation-netease.json'), JSON.stringify(liveValidationReport('netease', packageInfo)), 'utf8');
}

async function readPackageInfo() {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  return {
    name: pkg.name,
    version: pkg.version,
  };
}

function liveValidationReport(target, packageInfo) {
  const now = new Date().toISOString();
  const trackId = target === 'qq' ? 'q-live-track' : 'n-live-track';
  return {
    schemaVersion: 1,
    tool: packageInfo,
    ok: true,
    verified: true,
    validatedAt: now,
    target,
    playlistId: `${target}-fixture-playlist`,
    playlistName: 'HTTP smoke disposable validation',
    createdPlaylist: true,
    query: 'HTTP smoke validation',
    selectedCandidateIndex: 0,
    preExistingCandidateCount: 0,
    track: {
      id: trackId,
      mid: target === 'qq' ? 'q-live-mid' : null,
      title: 'HTTP Smoke Validation Track',
      artist: 'Fixture Artist',
    },
    snapshots: {
      before: liveValidationSnapshot(target, now, 0, false),
      afterAdd: liveValidationSnapshot(target, now, 1, true),
      afterRemove: liveValidationSnapshot(target, now, 0, false),
    },
    add: { requested: 1, submitted: 1, accepted: 1, added: 1, verified: true, missingIds: [], stillPresentIds: [], unsupportedIds: [] },
    remove: { requested: 1, submitted: 1, accepted: 1, removed: 1, verified: true, missingIds: [], stillPresentIds: [], unsupportedIds: [] },
  };
}

function liveValidationSnapshot(target, fetchedAt, trackCount, containsValidatedTrack) {
  return {
    source: `${target}:http-smoke-live-validation`,
    fetchedAt,
    playlistId: `${target}-fixture-playlist`,
    trackCount,
    containsValidatedTrack,
  };
}

async function markFirstManagedAddReviewCandidate(root, target, excludeIds = []) {
  const previewPath = path.join(root, 'data', 'sync-preview.json');
  const preview = JSON.parse(await fs.readFile(previewPath, 'utf8'));
  const excluded = new Set(excludeIds);
  const operation = preview.operations.find((item) => (
    item.action === 'add'
    && item.targetPlatform === target
    && !excluded.has(item.id)
  )) || preview.operations.find((item) => (
    item.action === 'add'
    && !excluded.has(item.id)
  ));
  assert(operation, `managed preview should include an add operation for ${target}`);
  target = operation.targetPlatform || target;
  operation.status = 'needs_review';
  operation.resolvedScore = 0.72;
  operation.candidateTrack = {
    platform: target,
    id: `${target}-candidate-${operation.id}`,
    mid: target === 'qq' ? `mid-${operation.id}` : null,
    title: operation.sourceTrack?.title || 'Resolved Fixture',
    artist: operation.sourceTrack?.artist || 'Fixture Artist',
    artists: operation.sourceTrack?.artists || [],
    album: operation.sourceTrack?.album || 'HTTP Smoke Fixture',
    durationMs: operation.sourceTrack?.durationMs || 210000,
    isrc: operation.sourceTrack?.isrc || null,
  };
  operation.alternatives = [
    {
      ...operation.candidateTrack,
      id: `${target}-alternative-${operation.id}`,
      mid: target === 'qq' ? `mid-alt-${operation.id}` : null,
      title: `${operation.candidateTrack.title} Alternate`,
    },
  ];
  operation.resolvedTargetTrack = null;
  operation.targetTrack = null;
  operation.resolution = {
    reason: 'low_confidence_target_match',
    message: 'Fixture marks one policy addition as a reviewable candidate for product decision coverage.',
  };
  preview.summary = syncSummary(preview.operations);
  if (preview.baselineDiff?.summary) {
    preview.summary.baselineAdded = preview.baselineDiff.summary.added || 0;
    preview.summary.baselineDeleted = preview.baselineDiff.summary.deleted || 0;
  }
  await fs.writeFile(previewPath, JSON.stringify(preview), 'utf8');
  return operation.id;
}

async function markSyncPreviewConverged(root) {
  const previewPath = path.join(root, 'data', 'sync-preview.json');
  const preview = JSON.parse(await fs.readFile(previewPath, 'utf8'));
  preview.operations = [];
  preview.summary = syncSummary(preview.operations);
  if (preview.baselineDiff?.summary) {
    preview.summary.baselineAdded = preview.baselineDiff.summary.added || 0;
    preview.summary.baselineDeleted = preview.baselineDiff.summary.deleted || 0;
  }
  const previewId = syncPreviewId(preview);
  preview.convergence = {
    checked: true,
    skipped: false,
    status: 'converged',
    converged: true,
    refreshedAt: fixtureTimestamp,
    refreshedTargets: ['qq', 'netease'],
    previewId,
    generatedAt: preview.generatedAt,
    mode: preview.policy || preview.mode || 'managed_bidirectional',
    counts: {
      will_add: 0,
      will_keep: 0,
      needs_confirmation: 0,
      may_delete: 0,
    },
    openOperations: 0,
  };
  await fs.writeFile(previewPath, JSON.stringify(preview), 'utf8');
  return previewId;
}

function syncPreviewId(preview) {
  const stamp = String(preview?.generatedAt || '').replace(/[-:.TZ]/g, '').slice(0, 14) || 'latest';
  return `preview-${stamp}`;
}

function syncSummary(operations) {
  const summary = {
    total: operations.length,
    keep: 0,
    add: 0,
    remove: 0,
    review: 0,
    destructive: 0,
    ready: 0,
    blocked: 0,
    baselineAdded: 0,
    baselineDeleted: 0,
    tombstoneCandidates: 0,
  };
  for (const operation of operations) {
    if (Object.prototype.hasOwnProperty.call(summary, operation.action)) summary[operation.action] += 1;
    if (operation.destructive) summary.destructive += 1;
    if (operation.status === 'ready') summary.ready += 1;
    else summary.blocked += 1;
    if (operation.reason === 'tombstone_candidate') summary.tombstoneCandidates += 1;
  }
  return summary;
}

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:http-smoke`,
    fetchedAt: fixtureTimestamp,
    playlistId: platform === 'apple' ? null : `${platform}-fixture-playlist`,
    skipped: false,
    tracks,
  };
}

function track(id, title, artist, durationMs) {
  return {
    id,
    title,
    artists: [artist],
    album: 'HTTP Smoke Fixture',
    durationMs,
  };
}

function qqMidOnlyTrack(mid, title, artist, durationMs) {
  return {
    mid,
    title,
    artists: [artist],
    album: 'HTTP Smoke Fixture',
    durationMs,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
