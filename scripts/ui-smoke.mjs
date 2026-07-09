#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(readArg('--port') || process.env.PORT || 0) || randomPort();
const baseUrl = `http://127.0.0.1:${port}`;
const browserPath = readArg('--browser') || process.env.MUSIC_LIKES_SYNC_BROWSER_PATH || findLocalBrowser();
const SNAPSHOT_STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const child = spawn(process.execPath, ['src/server.js', String(port)], {
  cwd: ROOT,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    MUSIC_LIKES_SYNC_OTEL_ENABLED: '0',
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

let browser;
try {
  await waitForServer();
  browser = await chromium.launch(browserPath ? { executablePath: browserPath } : {});

  const results = [];
  results.push(await runViewportSmoke(browser, {
    name: 'desktop',
    viewport: { width: 1440, height: 1000 },
  }));
  results.push(await runViewportSmoke(browser, {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
  }));

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    browser: browserPath || 'playwright-managed chromium',
    results,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  child.kill();
}

async function runViewportSmoke(browserInstance, options) {
  const context = await browserInstance.newContext({
    viewport: options.viewport,
    deviceScaleFactor: options.name === 'mobile' ? 2 : 1,
  });
  const page = await context.newPage();
  const problems = [];

  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
      problems.push(`console error: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400 || ignoredMissingResource(response.url())) return;
    problems.push(`http ${status}: ${response.url()}`);
  });
  const productApiCalls = new Set();
  page.on('request', (request) => {
    try {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname.startsWith('/api/app/')
        || pathname.startsWith('/api/sync/')
        || pathname === '/api/ai/provider/test'
        || pathname === '/api/ai/profile'
        || pathname === '/api/ai/recommend'
        || pathname === '/api/agent/sessions'
        || pathname === '/api/agent/trace-feedback'
      ) {
        productApiCalls.add(pathname);
      }
    } catch {
      // Ignore non-URL requests from the browser internals.
    }
  });
  const productRouteState = await stubProductPreviewRoutes(page);

  try {
    await page.goto(`${baseUrl}/workbench/`, { waitUntil: 'networkidle' });
    const productApp = await assertProductApp(page, productApiCalls, productRouteState);
    assert(
      !(await page.locator('#syncTarget').isVisible()),
      'legacy workbench should be hidden before opening advanced settings',
    );
    await page.locator('[data-product-page="advanced"]').click();
    await page.waitForFunction(() => document.body.classList.contains('product-advanced-open'));
    await expectVisible(page, '#syncTarget', 'target selector');
    await expectVisible(page, '#mirrorSummary', 'mirror summary');
    await expectVisible(page, '#mirrorHealth', 'mirror health');
    await expectVisible(page, '#mirrorPlanButton', 'mirror plan button');
    await expectVisible(page, '#mirrorResolveButton', 'mirror resolve button');
    await expectVisible(page, '#mirrorDryRunButton', 'mirror dry-run button');
    await expectVisible(page, '#mirrorAddButton', 'mirror add button');
    await expectVisible(page, '#mirrorApplyButton', 'mirror delete button');
    await expectVisible(page, '#mirrorConvergenceButton', 'mirror convergence button');
    await expectVisible(page, '#mirrorFilters', 'mirror filters');
    await expectVisible(page, '#mirrorPlanList', 'mirror operation list');

    await assertMirrorTargetState(page, 'netease', { disabled: false });
    await page.selectOption('#syncTarget', 'apple');
    await assertMirrorTargetState(page, 'apple', { disabled: true });
    await page.selectOption('#syncTarget', 'qq');
    await assertMirrorTargetState(page, 'qq', { disabled: false });
    const mirrorWorkbench = await assertMirrorWorkbench(page);
    const deleteDialog = await assertMirrorDeleteDialog(page, mirrorWorkbench);

    const summaryText = await page.locator('#mirrorSummary').innerText();
    assert(summaryText.includes('Apple') || summaryText.includes('目标'), 'mirror summary should describe Apple mirror state');
    const healthText = await page.locator('#mirrorHealth').innerText();
    assert(healthText.includes('快照') || healthText.includes('生成镜像计划'), 'mirror health should describe snapshot freshness');
    if (mirrorWorkbench.staleSnapshots) {
      assert(healthText.includes('快照') && /天前|时间未知/.test(healthText), 'stale mirror health should show snapshot age');
    }
    if (mirrorWorkbench.hasOpenDelta) {
      assert(healthText.includes('未收敛'), 'mirror health should show unconverged plan state');
    }

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.documentElement.clientWidth,
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert(overflow.body <= 2 && overflow.doc <= 2, `page has horizontal overflow: ${JSON.stringify(overflow)}`);

    if (problems.length) throw new Error(problems.join('\n'));
    return {
      name: options.name,
      viewport: options.viewport,
      mirrorSummary: compact(summaryText),
      mirrorHealth: compact(healthText),
      productApp,
      mirrorWorkbench,
      deleteDialog,
      horizontalOverflowPx: Math.max(overflow.body, overflow.doc),
    };
  } finally {
    await context.close();
  }
}

async function stubProductPreviewRoutes(page) {
  const generatedAt = new Date('2026-07-08T08:00:00.000Z').toISOString();
  const state = {
    mode: 'canonical_mirror',
    deleteExecutionCalls: 0,
    tombstoneBatchCalls: 0,
    tombstoneLastBatchSize: 0,
    convergenceCalls: 0,
    explanationCalls: 0,
    providerTestCalls: 0,
    providerTestConsent: false,
    profileCalls: 0,
    profileModelConsent: false,
    recommendationCalls: 0,
    recommendationModelConsent: false,
    agentSessionsCalls: 0,
    agentFeedbackCalls: 0,
    agentFeedbackLabel: '',
    additionDecisionCalls: 0,
    additionDecisionAction: '',
    additionDecisionBatchCalls: 0,
    additionDecisionBatchAction: '',
    additionDecisionBatchSize: 0,
    resolutionCalls: 0,
    tombstoneRiskCalls: 0,
    baselineReadCalls: 0,
    baselineSaveCalls: 0,
    baselineSaveRequireConverged: false,
    baselineSavePreviewId: '',
    baselineSaveActivateManaged: false,
    lastSyncRun: null,
    liveTargets: {
      qq: { target: 'qq', ok: true, status: 'verified', validatedAt: generatedAt, mutations: { addVerified: true, removeVerified: true, added: 1, removed: 1 } },
      netease: { target: 'netease', ok: true, status: 'verified', validatedAt: generatedAt, mutations: { addVerified: true, removeVerified: true, added: 1, removed: 1 } },
    },
  };
  const counts = {
    will_add: 1,
    will_keep: 2,
    needs_confirmation: 1,
    may_delete: 2,
  };
  await page.route('**/api/app/state', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          platforms: [
            { id: 'apple', label: 'Apple Music', state: 'readable', trackCount: 4, lastReadAt: generatedAt, capabilities: { read: true, write: false, playlistList: false } },
            { id: 'qq', label: 'QQ 音乐', state: 'writable', trackCount: 3, lastReadAt: generatedAt, capabilities: { read: true, write: true, playlistList: true } },
            { id: 'netease', label: '网易云音乐', state: 'writable', trackCount: 3, lastReadAt: generatedAt, capabilities: { read: true, write: true, playlistList: false } },
          ],
          syncMode: {
            id: state.mode,
            label: state.mode === 'managed_bidirectional' ? '自动同步新增，删除需确认' : '以 Apple Music 为准',
          },
          latestPreview: {
            exists: true,
            generatedAt,
            counts,
            convergence: state.mode === 'managed_bidirectional'
              ? { exists: true, checked: true, skipped: false, status: 'converged', converged: true, refreshedAt: generatedAt, refreshedTargets: [], previewId: 'ui-smoke-managed-preview', counts: { will_add: 0, needs_confirmation: 0, may_delete: 0 }, openOperations: 0 }
              : { exists: false },
          },
          baseline: state.baselineSaveCalls
            ? { exists: true, savedAt: generatedAt, source: 'product-ui', policy: state.mode, summary: { platforms: 3, tracks: 6 } }
            : { exists: false },
          deletionConfirmations: { updatedAt: '', total: 0, confirmedGlobalDeletes: 0, actions: {} },
          syncRuns: {
            exists: true,
            count: state.lastSyncRun ? 3 : 2,
            updatedAt: generatedAt,
            byAction: state.lastSyncRun ? { add: 1, remove: 2 } : { add: 1, remove: 1 },
            byPolicy: { managed_bidirectional: state.lastSyncRun ? 3 : 2 },
          },
          lastSyncRun: state.lastSyncRun,
          nextAction: state.mode === 'managed_bidirectional' ? 'up_to_date' : 'run_sync_check',
          ai: {
            configured: true,
            model: 'deepseek-v4-pro',
            provider: {
              provider: 'deepseek',
              model: 'deepseek-v4-pro',
              baseUrl: 'https://api.deepseek.com',
              hasApiKey: true,
              configured: true,
            },
          },
          validation: {
            live: {
              ok: Object.values(state.liveTargets).every((entry) => entry.ok),
              maxAgeDays: 14,
              targets: state.liveTargets,
            },
          },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/check', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    state.mode = body.mode || body.policy || 'canonical_mirror';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          previewId: 'ui-smoke-preview',
          generatedAt,
          mode: state.mode,
          counts,
          blocked: [],
          plan: { operations: [] },
          compatibility: null,
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/resolve-additions', async (route) => {
    state.resolutionCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          previewId: 'ui-smoke-preview',
          generatedAt,
          mode: state.mode,
          targets: ['qq', 'netease'],
          counts: { ...counts, will_add: 1 },
          blocked: [],
          addResolution: {
            resolvedAt: generatedAt,
            total: 1,
            resolved: 0,
            review: 1,
            notFound: 0,
            skipped: 0,
            targets: [
              { target: 'qq', processed: 1, resolved: 0, review: 1, notFound: 0, skipped: false },
              { target: 'netease', processed: 0, resolved: 0, review: 0, notFound: 0, skipped: true, reason: 'missing_cookie' },
            ],
          },
          preview: {
            bucket: 'all',
            total: 1,
            items: [
              {
                id: 'ui-add-1',
                bucket: 'will_add',
                action: 'add',
                status: 'needs_review',
                title: 'Test Track To Add',
                artist: 'Sync Smoke',
                album: 'Preview Evidence',
                targetPlatforms: ['qq'],
                evidence: ['low_confidence_target_match', 'score:0.72'],
                score: 0.72,
                candidateTarget: {
                  platform: 'qq',
                  id: 'qq-candidate-ui-add-1',
                  title: 'Test Track To Add',
                  artist: 'Sync Smoke',
                  album: 'Candidate Target',
                },
                alternatives: [
                  {
                    platform: 'qq',
                    id: 'qq-alt-ui-add-1',
                    title: 'Test Track To Add Alternate',
                    artist: 'Sync Smoke',
                    album: 'Alternative Target',
                  },
                ],
                resolution: { reason: 'low_confidence_target_match', message: 'Candidate in UI smoke.' },
              },
            ],
          },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/addition-decision', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    state.additionDecisionCalls += 1;
    state.additionDecisionAction = body.action || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          previewId: 'ui-smoke-preview',
          generatedAt,
          counts: { ...counts, ready: 1 },
          blocked: [],
          addResolution: {
            resolvedAt: generatedAt,
            total: 1,
            resolved: body.action === 'skip' ? 0 : 1,
            review: 0,
            notFound: 0,
            skipped: body.action === 'skip' ? 1 : 0,
            targets: [{ target: 'qq', processed: 1, resolved: body.action === 'skip' ? 0 : 1, review: 0, notFound: 0, skipped: false }],
          },
          operation: {
            id: body.operationId,
            bucket: 'will_add',
            action: 'add',
            status: body.action === 'skip' ? 'blocked' : 'ready',
            title: 'Test Track To Add',
            artist: 'Sync Smoke',
            album: 'Preview Evidence',
            targetPlatforms: ['qq'],
            evidence: [body.action === 'skip' ? 'user_skipped_add_candidate' : 'user_accepted_candidate'],
            score: 0.72,
            resolvedTarget: body.action === 'skip' ? null : {
              platform: 'qq',
              id: 'qq-candidate-ui-add-1',
              title: 'Test Track To Add',
              artist: 'Sync Smoke',
              album: 'Candidate Target',
            },
            blockedReason: body.action === 'skip' ? 'user_skipped_add_candidate' : '',
            addDecision: { action: body.action, decidedAt: generatedAt },
            resolution: { reason: body.action === 'skip' ? 'user_skipped_add_candidate' : 'user_accepted_candidate' },
          },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/addition-decisions', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    const operationIds = Array.isArray(body.operationIds) ? body.operationIds : [];
    state.additionDecisionBatchCalls += 1;
    state.additionDecisionBatchAction = body.action || '';
    state.additionDecisionBatchSize = operationIds.length;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          previewId: 'ui-smoke-preview',
          generatedAt,
          action: body.action || 'accept_candidate',
          batchId: 'add-decision-batch-ui-smoke',
          requested: operationIds.length,
          changed: operationIds.length,
          skipped: 0,
          skippedItems: [],
          operationIds,
          counts: { ...counts, ready: operationIds.length },
          blocked: [],
          addResolution: {
            resolvedAt: generatedAt,
            total: operationIds.length,
            resolved: body.action === 'skip' ? 0 : operationIds.length,
            review: 0,
            notFound: 0,
            skipped: body.action === 'skip' ? operationIds.length : 0,
            targets: [{ target: 'qq', processed: operationIds.length, resolved: body.action === 'skip' ? 0 : operationIds.length, review: 0, notFound: 0, skipped: false }],
          },
          operations: operationIds.map((operationId) => ({
            id: operationId,
            bucket: 'will_add',
            action: 'add',
            status: body.action === 'skip' ? 'blocked' : 'ready',
            title: 'Test Track To Add',
            artist: 'Sync Smoke',
            album: 'Preview Evidence',
            targetPlatforms: ['qq'],
            evidence: [body.action === 'skip' ? 'user_skipped_add_candidate' : 'user_accepted_candidate'],
            score: 0.72,
            addDecision: { action: body.action, batchId: 'add-decision-batch-ui-smoke', decidedAt: generatedAt },
            resolution: { reason: body.action === 'skip' ? 'user_skipped_add_candidate' : 'user_accepted_candidate' },
          })),
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/tombstones', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    const isBatch = Array.isArray(body.items);
    if (isBatch) state.tombstoneBatchCalls += 1;
    if (isBatch) state.tombstoneLastBatchSize = body.items.length;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          batch: isBatch,
          requested: isBatch ? body.items.length : undefined,
          changed: isBatch ? body.items.length : undefined,
          decision: {
            key: 'ui-tombstone-1',
            action: body.action || 'ignore',
            platform: 'qq',
            updatedAt: generatedAt,
          },
          tombstones: {
            updatedAt: generatedAt,
            total: isBatch ? body.items.length : 1,
            confirmedGlobalDeletes: 0,
            actions: { [body.action || 'ignore']: isBatch ? body.items.length : 1 },
          },
          preview: {
            previewId: 'ui-smoke-preview',
            generatedAt,
            mode: 'managed_bidirectional',
            counts,
          },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/execute-deletions', async (route) => {
    state.deleteExecutionCalls += 1;
    state.lastSyncRun = {
      runId: 'sync-run-ui-smoke-delete',
      status: 'completed',
      policy: 'managed_bidirectional',
      action: 'remove',
      target: 'netease',
      dryRun: false,
      ranAt: generatedAt,
      completedAt: generatedAt,
      add: { requested: 0, executable: 0, blocked: 0, accepted: 0, added: 0 },
      remove: { requested: 1, executable: 1, blocked: 0, accepted: 1, removed: 1 },
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          target: 'netease',
          targetOrder: ['netease'],
          action: 'remove',
          status: 'completed',
          dryRun: false,
          add: { requested: 0, executable: 0, blocked: 0 },
          remove: { requested: 1, executable: 1, blocked: 0, destructive: 1 },
          blocked: { unresolvedAdds: 0, invalidRemoves: 0, reviewItems: 0 },
          convergence: {
            checked: true,
            skipped: false,
            status: 'open_delta',
            converged: false,
            refreshedAt: generatedAt,
            refreshedTargets: ['netease'],
            counts: { will_add: 0, needs_confirmation: 1, may_delete: 0 },
            openOperations: 1,
          },
          results: [],
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/convergence', async (route) => {
    state.convergenceCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          mode: state.mode,
          convergence: {
            checked: true,
            skipped: false,
            status: 'converged',
            converged: true,
            refreshedAt: generatedAt,
            refreshedTargets: ['qq', 'netease'],
            counts: { will_add: 0, needs_confirmation: 0, may_delete: 0 },
            openOperations: 0,
          },
          preview: {
            previewId: 'ui-smoke-preview',
            generatedAt,
            mode: state.mode,
            counts: { will_add: 0, will_keep: 4, needs_confirmation: 0, may_delete: 0 },
          },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/ai/explain', async (route) => {
    state.explanationCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          item: { id: 'ui-add-1', bucket: 'will_add', title: 'Test Track To Add' },
          evidence: {
            operation: { reason: 'missing_target_platform', status: 'ready' },
            sourceTrack: { title: 'Test Track To Add', artist: 'Sync Smoke' },
          },
          explanation: {
            summary: '本地证据解释：这首歌会被补到缺失平台。',
            risk: 'low',
            recommendedAction: 'execute_addition',
            rationale: '目标平台缺少这首歌，且当前候选可以进入新增执行。',
            evidenceRefs: ['reason:missing_target_platform'],
          },
          model: { used: false, skippedReason: 'deterministic_only' },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/ai/tombstones/analyze', async (route) => {
    state.tombstoneRiskCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          previewId: 'ui-smoke-preview',
          generatedAt,
          total: 2,
          summary: {
            unhandled: 2,
            confirmedGlobalDeletes: 0,
            safeDecisions: 0,
            restoreRequested: 0,
            highestRisk: 'high',
          },
          groups: [
            {
              id: 'needs_review',
              label: '未处理高风险',
              risk: 'high',
              count: 2,
              description: '2 条删除信号仍需人工判断，默认不传播到其他平台。',
            },
          ],
          items: [
            {
              operationId: 'ui-delete-1',
              tombstoneKey: 'ui-tombstone-1',
              title: 'Track To Remove',
              artist: 'Sync Smoke',
              sourcePlatform: 'qq',
              sourceLabel: 'QQ 音乐',
              action: '',
              group: 'needs_review',
              groupLabel: '未处理高风险',
              risk: 'high',
              recommendedAction: 'review_tombstone',
              summary: '只知道它从 QQ 音乐消失了，不能证明应该从所有平台删除。',
              evidenceRefs: ['reason:tombstone_candidate'],
              signals: ['decision:unhandled', 'source:qq'],
            },
            {
              operationId: 'ui-delete-2',
              tombstoneKey: 'ui-tombstone-2',
              title: 'Second Delete Signal',
              artist: 'Sync Smoke',
              sourcePlatform: 'netease',
              sourceLabel: '网易云音乐',
              action: '',
              group: 'needs_review',
              groupLabel: '未处理高风险',
              risk: 'high',
              recommendedAction: 'review_tombstone',
              summary: '只知道它从 网易云音乐消失了，不能证明应该从所有平台删除。',
              evidenceRefs: ['reason:tombstone_candidate'],
              signals: ['decision:unhandled', 'source:netease'],
            },
          ],
          model: { used: false, skippedReason: 'deterministic_only' },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/baseline?**', async (route) => {
    state.baselineReadCalls += 1;
    const exists = state.baselineSaveCalls > 0;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          baseline: exists
            ? { exists: true, savedAt: generatedAt, source: 'product-ui', policy: state.mode, summary: { platforms: 3, tracks: 6 } }
            : { exists: false },
          diff: exists
            ? {
              exists: true,
              status: 'ready',
              baselineSavedAt: generatedAt,
              summary: { added: 1, deleted: 2, unchanged: 3 },
              platforms: {
                apple: { platform: 'apple', added: 0, deleted: 0, unchanged: 2, examples: [] },
                qq: {
                  platform: 'qq',
                  added: 1,
                  deleted: 1,
                  unchanged: 1,
                  examples: [
                    { platform: 'qq', action: 'added', title: 'New Target Only', artist: 'Sync Smoke', album: 'Baseline Evidence', durationMs: 212000, evidence: ['duration'] },
                    { platform: 'qq', action: 'deleted', title: 'Old Target Only', artist: 'Sync Smoke', album: 'Baseline Evidence', durationMs: 198000, evidence: ['isrc', 'duration'] },
                  ],
                },
                netease: {
                  platform: 'netease',
                  added: 0,
                  deleted: 1,
                  unchanged: 0,
                  examples: [
                    { platform: 'netease', action: 'deleted', title: 'Netease Missing Song', artist: 'Sync Smoke', album: 'Baseline Evidence', durationMs: 205000, evidence: ['musicbrainz', 'duration'] },
                  ],
                },
              },
              examples: [
                { platform: 'qq', action: 'added', title: 'New Target Only', artist: 'Sync Smoke', album: 'Baseline Evidence', durationMs: 212000, evidence: ['duration'] },
                { platform: 'qq', action: 'deleted', title: 'Old Target Only', artist: 'Sync Smoke', album: 'Baseline Evidence', durationMs: 198000, evidence: ['isrc', 'duration'] },
                { platform: 'netease', action: 'deleted', title: 'Netease Missing Song', artist: 'Sync Smoke', album: 'Baseline Evidence', durationMs: 205000, evidence: ['musicbrainz', 'duration'] },
              ],
            }
            : { exists: false, status: 'missing_baseline' },
          participants: ['apple', 'qq', 'netease'],
          tombstones: exists
            ? { updatedAt: generatedAt, total: 2, confirmedGlobalDeletes: 1, actions: { confirm_global_delete: 1, current_platform_only: 1 } }
            : { updatedAt: '', total: 0, confirmedGlobalDeletes: 0, actions: {} },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/baseline/save', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    state.baselineSaveCalls += 1;
    state.baselineSaveRequireConverged = body.requireConverged === true;
    state.baselineSavePreviewId = body.previewId || '';
    state.baselineSaveActivateManaged = body.activateManaged === true;
    if (body.activateManaged) state.mode = 'managed_bidirectional';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          baseline: {
            exists: true,
            savedAt: generatedAt,
            source: body.source || 'product-ui',
            policy: body.policy || state.mode,
            summary: { platforms: 3, tracks: 6 },
          },
          diff: {
            exists: true,
            status: 'ready',
            baselineSavedAt: generatedAt,
            summary: { added: 0, deleted: 0, unchanged: 6 },
            platforms: {
              apple: { platform: 'apple', added: 0, deleted: 0, unchanged: 2, examples: [] },
              qq: { platform: 'qq', added: 0, deleted: 0, unchanged: 2, examples: [] },
              netease: { platform: 'netease', added: 0, deleted: 0, unchanged: 2, examples: [] },
            },
            examples: [],
          },
          participants: body.platforms || ['apple', 'qq', 'netease'],
          tombstones: { total: 0, actions: {} },
          savedFromPreviewId: body.previewId || 'ui-smoke-preview',
          activatedPolicy: body.activateManaged ? {
            id: 'managed_bidirectional',
            label: '自动同步新增，删除需确认',
          } : null,
          preview: body.activateManaged ? {
            previewId: 'ui-smoke-managed-preview',
            generatedAt,
            mode: 'managed_bidirectional',
            counts: { will_add: 0, will_keep: 4, needs_confirmation: 0, may_delete: 0 },
            convergence: {
              exists: true,
              checked: true,
              skipped: false,
              status: 'converged',
              converged: true,
              refreshedAt: generatedAt,
              refreshedTargets: [],
              previewId: 'ui-smoke-managed-preview',
              counts: { will_add: 0, needs_confirmation: 0, may_delete: 0 },
              openOperations: 0,
            },
          } : null,
          convergence: {
            exists: true,
            checked: true,
            skipped: false,
            status: 'converged',
            converged: true,
            refreshedAt: generatedAt,
            refreshedTargets: ['qq', 'netease'],
            previewId: body.previewId || 'ui-smoke-preview',
            counts: { will_add: 0, needs_confirmation: 0, may_delete: 0 },
            openOperations: 0,
          },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/ai/provider/test', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    state.providerTestCalls += 1;
    state.providerTestConsent = body.consent === true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          ok: true,
          checkedAt: generatedAt,
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          usage: {
            prompt_tokens: 8,
            completion_tokens: 4,
            total_tokens: 12,
          },
          response: {
            ok: true,
            capability: 'json_object',
          },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/agent/sessions?**', async (route) => {
    state.agentSessionsCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          total: 1,
          sessions: [
            {
              id: 'agent-session-ui-smoke',
              startedAt: generatedAt,
              updatedAt: generatedAt,
              toolTraces: [
                {
                  id: 'agent-trace-ui-smoke',
                  traceId: 'agent-trace-ui-smoke',
                  tool: 'recommend_by_profile',
                  source: 'product-ui',
                  status: 'completed',
                  readOnly: true,
                  mutatesProvider: false,
                  exposesCredentials: false,
                  calledAt: generatedAt,
                  durationMs: 12,
                  argumentsSummary: { limit: 5, excludeApple: true },
                  resultSummary: { total: 2, returned: 2, providerWrites: false },
                  evidenceRefs: ['recommendations', 'music_profile'],
                  feedback: state.agentFeedbackLabel
                    ? { label: state.agentFeedbackLabel, source: 'product-ui', updatedAt: generatedAt }
                    : null,
                },
              ],
            },
          ],
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/agent/trace-feedback', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    state.agentFeedbackCalls += 1;
    state.agentFeedbackLabel = body.label || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: body.sessionId,
          traceId: body.traceId,
          feedback: { label: state.agentFeedbackLabel, source: 'product-ui', updatedAt: generatedAt },
          sessions: {
            version: 1,
            updatedAt: generatedAt,
            total: 1,
            sessions: [
              {
                id: 'agent-session-ui-smoke',
                startedAt: generatedAt,
                updatedAt: generatedAt,
                traceCount: 1,
                toolTraces: [
                  {
                    id: 'agent-trace-ui-smoke',
                    tool: 'recommend_by_profile',
                    source: 'product-ui',
                    status: 'completed',
                    readOnly: true,
                    mutatesProvider: false,
                    exposesCredentials: false,
                    calledAt: generatedAt,
                    durationMs: 12,
                    argumentsSummary: { limit: 5, excludeApple: true },
                    resultSummary: { total: 2, returned: 2, providerWrites: false },
                    evidenceRefs: ['recommendations', 'music_profile'],
                    feedback: { label: state.agentFeedbackLabel, source: 'product-ui', updatedAt: generatedAt },
                  },
                ],
              },
            ],
          },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/ai/profile', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    state.profileCalls += 1;
    if (body.useModel) state.profileModelConsent = body.consent === true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          version: 1,
          updatedAt: generatedAt,
          generatedAt,
          source: { type: 'platform-snapshots', itemCount: 8, platformCounts: { apple: 4, qq: 3, netease: 1 } },
          summary: {
            trackCount: 8,
            sourceTrackCount: 9,
            topArtists: [{ name: 'Sync Smoke', count: 4 }],
            topAlbums: [{ name: 'Preview Evidence', count: 3 }],
            languages: [{ name: 'latin', count: 6 }],
            platformCoverage: { apple: 4, qq: 3, netease: 1 },
            averageDurationMs: 205000,
            isrcCoverage: 0.5,
            reviewSignals: { versionConflicts: 0, conflictClusters: 0, reviewCandidates: 1 },
          },
          aggregates: { artists: { 'Sync Smoke': 4 }, languages: { latin: 6 }, platforms: { apple: 4, qq: 3, netease: 1 } },
          examples: [],
          aiSummary: {
            source: body.useModel ? 'model' : 'deterministic',
            summary: body.useModel ? '模型画像总结：偏好夜间流行和稳定中速歌曲。' : '本地画像总结：常听 Sync Smoke。',
            tasteTags: ['artist:Sync Smoke', 'language:latin'],
            listeningPatterns: ['中速歌曲占比较高'],
            recommendationAngles: ['寻找相近编曲的本地候选'],
            caveats: ['只基于本地喜欢歌曲'],
            confidence: body.useModel ? 0.76 : 0.55,
            evidenceRefs: ['top_artists', 'languages'],
          },
          model: body.useModel
            ? { used: true, provider: { provider: 'deepseek', model: 'deepseek-v4-pro' }, model: 'deepseek-v4-pro', usage: { total_tokens: 20 } }
            : { used: false, skippedReason: 'deterministic_only' },
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/ai/recommend', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    state.recommendationCalls += 1;
    if (body.useModel) state.recommendationModelConsent = body.consent === true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          version: 1,
          generatedAt,
          source: { type: 'profile', profileGeneratedAt: generatedAt },
          excludes: { appleTracks: true, providerWrites: true },
          total: 2,
          candidates: [
            {
              key: 'rec-1',
              track: { title: 'Moon Harbor', artist: 'Sync Smoke', album: 'Preview Evidence', durationMs: 205000 },
              platforms: ['qq', 'netease'],
              platformLabels: ['QQ 音乐', '网易云音乐'],
              score: 85,
              reasons: ['top_artist_match', 'language_match'],
              aiReason: body.useModel ? '模型推荐理由：贴合夜间流行和中速偏好。' : '',
              aiRank: body.useModel ? 1 : null,
              deterministicRank: 1,
            },
            {
              key: 'rec-2',
              track: { title: 'City Lights', artist: 'Sync Smoke', album: 'Preview Evidence', durationMs: 198000 },
              platforms: ['qq'],
              platformLabels: ['QQ 音乐'],
              score: 72,
              reasons: ['top_artist_match'],
              deterministicRank: 2,
            },
          ],
          aiSummary: body.useModel
            ? {
              source: 'model',
              summary: '模型推荐总结：优先 Moon Harbor，因为它同时出现在两个非 Apple 平台。',
              rankedCandidates: [{ key: 'rec-1', reason: '贴合画像', confidence: 0.78, evidenceRefs: ['candidate_reasons'] }],
              recommendationAngles: ['继续找 Sync Smoke 附近的中速歌曲'],
              caveats: ['只基于本地候选'],
              evidenceRefs: ['profile_top_artists', 'candidate_reasons'],
            }
            : null,
          model: body.useModel
            ? { used: true, provider: { provider: 'deepseek', model: 'deepseek-v4-pro' }, model: 'deepseek-v4-pro', usage: { total_tokens: 24 } }
            : { used: false, skippedReason: 'deterministic_only' },
          savedShortlist: body.saveShortlist ? { id: 'shortlist-ui', name: body.shortlistName || 'Product assistant picks', trackCount: 2 } : null,
        },
        warnings: [],
      }),
    });
  });
  await page.route('**/api/sync/preview?**', async (route) => {
    const url = new URL(route.request().url());
    const bucket = url.searchParams.get('bucket') || 'all';
    const allItems = [
      {
        id: 'ui-add-1',
        bucket: 'will_add',
        action: 'add',
        status: 'ready',
        title: 'Test Track To Add',
        artist: 'Sync Smoke',
        album: 'Preview Evidence',
        targetPlatforms: ['qq'],
        evidence: ['isrc', 'score:0.94'],
      },
      {
        id: 'ui-review-1',
        bucket: 'needs_confirmation',
        action: 'review',
        status: 'needs_review',
        title: 'Ambiguous Track',
        artist: 'Sync Smoke',
        album: 'Preview Evidence',
        targetPlatforms: ['netease'],
        evidence: ['duration_delta'],
      },
      {
        id: 'ui-delete-1',
        bucket: 'may_delete',
        action: 'remove',
        status: 'ready',
        destructive: true,
        title: 'Track To Remove',
        artist: 'Sync Smoke',
        album: 'Preview Evidence',
        sourcePlatform: 'qq',
        sourcePlatforms: ['qq'],
        targetPlatforms: ['qq'],
        evidence: ['tombstone_candidate'],
        tombstoneKey: 'ui-tombstone-1',
      },
      {
        id: 'ui-delete-2',
        bucket: 'may_delete',
        action: 'review',
        status: 'blocked',
        destructive: false,
        title: 'Second Delete Signal',
        artist: 'Sync Smoke',
        album: 'Preview Evidence',
        sourcePlatform: 'netease',
        sourcePlatforms: ['netease'],
        targetPlatforms: ['netease'],
        evidence: ['tombstone_candidate'],
        tombstoneKey: 'ui-tombstone-2',
      },
    ];
    const items = bucket === 'all' ? allItems : allItems.filter((item) => item.bucket === bucket);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          previewId: 'ui-smoke-preview',
          generatedAt,
          mode: state.mode,
          bucket,
          counts,
          total: items.length,
          items,
          nextCursor: null,
        },
        warnings: [],
      }),
    });
  });
  return state;
}

async function assertProductApp(page, productApiCalls, productRouteState) {
  await expectVisible(page, '#productApp', 'ordinary user product app');
  await expectVisible(page, '#productRunCheck', 'product sync check button');
  await expectVisible(page, '#productModeSummary', 'product mode summary');
  await page.waitForFunction(() => document.querySelectorAll('[data-product-page]').length === 6);
  await page.waitForFunction(() => document.querySelector('#productModeSummary')?.textContent.trim().length > 0);
  assert(productApiCalls.has('/api/app/state'), 'product app should load /api/app/state');
  assert(productApiCalls.has('/api/sync/modes'), 'product app should load /api/sync/modes');
  await expectVisible(page, '#productBaselineDiff', 'product baseline diff panel');
  await page.waitForFunction(() => document.querySelector('#productBaselineDiff')?.textContent.includes('暂无同步基线'));
  await expectVisible(page, '#productRunAudit', 'product run audit panel');
  await page.waitForFunction(() => document.querySelector('#productRunAudit')?.textContent.includes('暂无受控执行记录'));
  assert(productApiCalls.has('/api/sync/baseline'), 'product app should load /api/sync/baseline');

  await page.locator('[data-product-page="connect"]').click();
  await expectVisible(page, '#productConnectPlatforms', 'product connection cards');
  const connectCards = await page.locator('#productConnectPlatforms .product-platform-card').count();
  assert(connectCards >= 3, `product connect screen should show 3 platforms, got ${connectCards}`);
  const connectText = await page.locator('#productConnectPlatforms').innerText();
  assert(connectText.includes('真实写入验证已通过'), 'product connect screen should show live write validation status');

  await page.locator('[data-product-page="mode"]').click();
  await page.locator('.product-mode-card').first().waitFor({ state: 'visible', timeout: 10000 });
  const modeCount = await page.locator('.product-mode-card').count();
  assert(modeCount >= 4, `product mode screen should show policy choices, got ${modeCount}`);
  await page.locator('[data-product-mode="union_convergence"]').click();
  assert(
    await page.locator('[data-product-mode="union_convergence"]').evaluate((node) => node.classList.contains('active')),
    'product mode selection should update active state',
  );
  await page.locator('[data-product-mode="canonical_mirror"]').click();

  await page.locator('#productRunCheck').click();
  await page.locator('.product-preview-item').first().waitFor({ state: 'visible', timeout: 10000 });
  assert(productApiCalls.has('/api/sync/check'), 'product sync check button should call /api/sync/check');
  assert(productApiCalls.has('/api/sync/preview'), 'product preview should call /api/sync/preview');
  await expectVisible(page, '#productResolveAdditions', 'product resolve additions button');
  await page.locator('#productResolveAdditions').click();
  await page.waitForFunction(() => document.querySelector('#productResolutionSummary')?.textContent.includes('需复核 1 首'));
  await page.waitForFunction(() => document.querySelector('.product-resolution-detail')?.textContent.includes('找到候选，需复核'));
  assert(productRouteState.resolutionCalls >= 1, 'product resolve additions button should call /api/sync/resolve-additions');
  await expectVisible(page, '#productAddBulk', 'product add candidate bulk controls');
  await page.locator('[data-product-add-bulk="accept_candidate"]').click();
  await page.waitForFunction(() => document.querySelector('#productFeedback')?.textContent.includes('已批量接受'));
  assert(productRouteState.additionDecisionBatchCalls >= 1, 'product add candidate bulk decision should call /api/sync/addition-decisions');
  assert(productRouteState.additionDecisionBatchAction === 'accept_candidate', 'product add candidate bulk decision should send accept_candidate');
  assert(productRouteState.additionDecisionBatchSize === 1, `product add candidate bulk decision should submit current visible item ids, got ${productRouteState.additionDecisionBatchSize}`);
  await page.locator('#productResolveAdditions').click();
  await page.waitForFunction(() => document.querySelector('.product-resolution-detail')?.textContent.includes('找到候选，需复核'));
  await expectVisible(page, '[data-product-add-decision="accept_candidate"]', 'product add candidate accept button');
  await page.locator('[data-product-add-decision="accept_candidate"]').first().click();
  await page.waitForFunction(() => document.querySelector('#productFeedback')?.textContent.includes('已接受新增候选'));
  assert(productRouteState.additionDecisionCalls >= 1, 'product add candidate decision should call /api/sync/addition-decision');
  assert(productRouteState.additionDecisionAction === 'accept_candidate', 'product add candidate decision should send accept_candidate');
  await page.locator('[data-product-explain]').first().click();
  await page.waitForFunction(() => document.querySelector('#productAiResult')?.textContent.includes('本地证据解释'));
  assert(productRouteState.explanationCalls >= 1, 'product explanation button should call /api/ai/explain');

  await page.locator('[data-product-page="preview"]').click();
  await expectVisible(page, '#productDryRunAdditions', 'product dry-run additions button');
  await expectVisible(page, '#productExecuteAdditions', 'product execute additions button');
  await expectVisible(page, '#productOpenDelete', 'product confirm delete button');
  await expectVisible(page, '#productWriteReadiness', 'product write readiness panel');
  await page.waitForFunction(() => document.querySelector('#productWriteReadiness')?.textContent.includes('真实写入就绪'));
  assert(!(await page.locator('#productExecuteAdditions').isDisabled()), 'real add execution should be enabled when live validation is ready');
  productRouteState.liveTargets.qq = {
    target: 'qq',
    ok: false,
    status: 'missing',
    message: 'Missing live validation evidence report.',
    reportFile: 'reports/live-validation-qq.json',
  };
  await page.locator('#productRefresh').click();
  await page.waitForFunction(() => document.querySelector('#productWriteReadiness')?.textContent.includes('真实写入暂不可用'));
  await page.waitForFunction(() => !document.querySelector('#productRefresh')?.disabled);
  assert(await page.locator('#productExecuteAdditions').isDisabled(), 'real add execution should be disabled when live validation is missing');
  assert(!(await page.locator('#productDryRunAdditions').isDisabled()), 'dry-run additions should remain available when live validation is missing');
  productRouteState.liveTargets.qq = {
    target: 'qq',
    ok: true,
    status: 'verified',
    validatedAt: '2026-07-08T08:00:00.000Z',
    mutations: { addVerified: true, removeVerified: true, added: 1, removed: 1 },
  };
  await page.locator('#productRefresh').click();
  await page.waitForFunction(() => document.querySelector('#productWriteReadiness')?.textContent.includes('真实写入就绪'));
  await page.waitForFunction(() => !document.querySelector('#productRefresh')?.disabled);
  const bucketCount = await page.locator('.product-bucket-button').count();
  assert(bucketCount >= 5, `product preview screen should show preview buckets, got ${bucketCount}`);
  await page.locator('[data-product-bucket="may_delete"]').click();
  await page.locator('[data-product-tombstone-action]').first().waitFor({ state: 'visible', timeout: 10000 });
  await expectVisible(page, '#productTombstoneRisk', 'product tombstone risk summary');
  await page.waitForFunction(() => document.querySelector('#productTombstoneRisk')?.textContent.includes('未处理高风险'));
  assert(productRouteState.tombstoneRiskCalls >= 1, 'product tombstone risk summary should call /api/ai/tombstones/analyze');
  const tombstoneButtons = await page.locator('[data-product-tombstone-action]').count();
  assert(tombstoneButtons >= 4, `product tombstone review should expose decisions, got ${tombstoneButtons}`);
  await expectVisible(page, '#productTombstoneBulk', 'product tombstone bulk controls');
  const filterCount = await page.locator('[data-product-tombstone-filter]').count();
  assert(filterCount >= 5, `product tombstone review should expose filter groups, got ${filterCount}`);
  await page.locator('[data-product-tombstone-filter="qq"]').click();
  await page.waitForFunction(() => document.querySelector('#productTombstoneBulk')?.textContent.includes('当前筛选 1 / 2'));
  const visibleDeleteSignals = await page.locator('.product-preview-item').count();
  assert(visibleDeleteSignals === 1, `QQ tombstone filter should show one item, got ${visibleDeleteSignals}`);
  const bulkButtons = await page.locator('[data-product-tombstone-bulk]').count();
  assert(bulkButtons >= 3, `product tombstone review should expose batch actions, got ${bulkButtons}`);
  await page.locator('[data-product-tombstone-bulk="current_platform_only"]').click();
  await page.waitForFunction(() => document.querySelector('#productFeedback')?.textContent.includes('批量保存'));
  assert(productRouteState.tombstoneBatchCalls >= 1, 'product tombstone batch action should call /api/sync/tombstones with items');
  assert(productRouteState.tombstoneLastBatchSize === 1, `filtered tombstone batch should submit one item, got ${productRouteState.tombstoneLastBatchSize}`);
  await page.waitForFunction(() => !document.querySelector('[data-product-tombstone-action="confirm_global_delete"]')?.disabled);
  await page.locator('[data-product-tombstone-action="confirm_global_delete"]').first().click();
  await page.locator('#productTombstoneDialog').waitFor({ state: 'visible', timeout: 10000 });
  const tombstoneCopy = await page.locator('#productTombstoneCopy').innerText();
  assert(tombstoneCopy.includes('CONFIRM GLOBAL DELETE FROM QQ'), 'global delete tombstone dialog should show exact confirmation text');
  assert(await page.locator('#productTombstoneConfirm').isDisabled(), 'global delete confirm should start disabled');
  await page.locator('#productTombstoneInput').fill('CONFIRM WRONG');
  assert(await page.locator('#productTombstoneConfirm').isDisabled(), 'global delete confirm should reject wrong text');
  await page.locator('#productTombstoneInput').fill('CONFIRM GLOBAL DELETE FROM QQ');
  assert(!(await page.locator('#productTombstoneConfirm').isDisabled()), 'global delete confirm should enable for exact text');
  await page.locator('#productTombstoneCancel').click();
  await page.locator('#productTombstoneDialog').waitFor({ state: 'hidden', timeout: 10000 });
  await page.locator('[data-product-tombstone-action="ignore"]').first().click();
  await page.waitForFunction(() => document.querySelector('#productFeedback')?.textContent.includes('删除意图处理'));
  assert(productApiCalls.has('/api/sync/tombstones'), 'product tombstone action should call /api/sync/tombstones');

  await page.locator('[data-product-page="mode"]').click();
  await page.locator('[data-product-mode="managed_bidirectional"]').click();
  await page.locator('#productRunCheck').click();
  await page.locator('.product-preview-item').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-product-page="preview"]').click();
  const managedDeleteLabel = await page.locator('#productOpenDelete').innerText();
  assert(
    managedDeleteLabel.includes('已确认'),
    `managed delete button should switch copy, got ${managedDeleteLabel}`,
  );
  const deleteResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/sync/execute-deletions', { timeout: 10000 });
  await page.locator('#productOpenDelete').click();
  await deleteResponse;
  assert(productRouteState.deleteExecutionCalls >= 1, 'managed delete button should call /api/sync/execute-deletions');
  assert(!(await page.locator('#productDeleteDialog').isVisible()), 'managed delete execution should not open canonical delete confirmation dialog');
  await page.waitForFunction(() => document.querySelector('#productConvergenceSummary')?.textContent.includes('仍有差异'));
  await page.waitForFunction(() => document.querySelector('#productRunAudit')?.textContent.includes('执行删除'));
  const runAuditTextAfterDelete = await page.locator('#productRunAudit').evaluate((node) => node.textContent || '');
  assert(runAuditTextAfterDelete.includes('已完成'), 'product run audit should show completed status after managed delete execution');
  assert(runAuditTextAfterDelete.includes('网易云音乐'), 'product run audit should show the target platform after managed delete execution');
  assert(runAuditTextAfterDelete.includes('1 / 1'), 'product run audit should show requested and completed delete counts');
  const convergenceHintAfterDelete = await page.locator('#productConvergenceHint').innerText();
  assert(convergenceHintAfterDelete.includes('仍有 1 个待处理项'), 'product convergence card should explain remaining open deltas after execution');
  assert(await page.locator('#productSaveBaseline').isDisabled(), 'baseline save should stay disabled before convergence is proven');
  await page.locator('#productCheckConvergence').click();
  await page.waitForFunction(() => document.querySelector('#productConvergenceSummary')?.textContent.includes('已一致'));
  assert(productRouteState.convergenceCalls >= 1, 'product convergence button should call /api/sync/convergence');
  assert(productApiCalls.has('/api/sync/convergence'), 'product convergence check should be tracked as a product API call');
  assert(!(await page.locator('#productSaveBaseline').isDisabled()), 'baseline save should become available after convergence is proven');
  await page.locator('#productSaveBaseline').click();
  await page.waitForFunction(() => document.querySelector('#productFeedback')?.textContent.includes('已保存当前同步基线'));
  assert(productRouteState.baselineSaveCalls >= 1, 'product baseline save should call /api/sync/baseline/save');
  assert(productRouteState.baselineSaveRequireConverged, 'product baseline save should require convergence from the UI');
  assert(productRouteState.baselineSavePreviewId === 'ui-smoke-preview', `product baseline save should carry preview id, got ${productRouteState.baselineSavePreviewId}`);
  assert(productRouteState.baselineSaveActivateManaged, 'product baseline save should activate managed sync after canonical convergence');
  assert(
    await page.locator('[data-product-mode="managed_bidirectional"]').evaluate((node) => node.classList.contains('active')),
    'product mode should switch to managed bidirectional after saving the converged baseline',
  );
  await page.locator('[data-product-page="overview"]').click();
  await page.waitForFunction(() => document.querySelector('#productBaselineDiff')?.textContent.includes('新增信号'));
  const baselineTextAfterSave = await page.locator('#productBaselineDiff').innerText();
  assert(baselineTextAfterSave.includes('删除信号'), 'baseline diff panel should show deletion signals after baseline save');
  assert(baselineTextAfterSave.includes('Apple Music') && baselineTextAfterSave.includes('QQ 音乐'), 'baseline diff panel should show per-platform rows');
  const baselineReadsBeforeRefresh = productRouteState.baselineReadCalls;
  await page.locator('[data-product-baseline-refresh]').click();
  await page.waitForFunction(() => document.querySelector('#productFeedback')?.textContent.includes('已刷新同步基线变化'));
  await page.waitForFunction(() => document.querySelector('#productBaselineDiff')?.textContent.includes('Old Target Only'));
  const baselineTextAfterRefresh = await page.locator('#productBaselineDiff').innerText();
  assert(baselineTextAfterRefresh.includes('变化示例'), 'baseline diff panel should show sanitized change examples after refresh');
  assert(baselineTextAfterRefresh.includes('ISRC') && baselineTextAfterRefresh.includes('时长'), 'baseline diff examples should show evidence labels');
  assert(productRouteState.baselineReadCalls > baselineReadsBeforeRefresh, 'baseline diff refresh should call /api/sync/baseline');

  await page.locator('[data-product-page="ai"]').click();
  const aiCardCount = await page.locator('.product-ai-card').count();
  assert(aiCardCount >= 4, `product AI screen should show planned capabilities, got ${aiCardCount}`);
  await expectVisible(page, '#productProfileButton', 'product profile button');
  await expectVisible(page, '#productProfileModelButton', 'product model profile button');
  await expectVisible(page, '#productRecommendButton', 'product recommendation button');
  await expectVisible(page, '#productRecommendModelButton', 'product model recommendation button');
  await expectVisible(page, '#productSimilarButton', 'product similar-track button');
  await expectVisible(page, '#productAiProviderConsent', 'product AI provider consent checkbox');
  await expectVisible(page, '#productAiProviderTestButton', 'product AI provider test button');
  await expectVisible(page, '#productAgentAuditList', 'product Agent tool audit list');
  await page.waitForFunction(() => document.querySelector('#productAgentAuditList')?.textContent.includes('recommend_by_profile'));
  const agentAuditText = await page.locator('#productAgentAuditList').innerText();
  assert(agentAuditText.includes('只读') && agentAuditText.includes('不写平台'), 'Agent audit should show read-only non-mutating status');
  assert(agentAuditText.includes('recommendations') && agentAuditText.includes('music_profile'), 'Agent audit should show evidence refs');
  assert(!agentAuditText.includes('sk-'), 'Agent audit UI must not show API keys');
  assert(!agentAuditText.includes('Cookie'), 'Agent audit UI must not show cookie text in trace details');
  assert(!agentAuditText.includes('Private Smoke Title'), 'Agent audit UI must not show raw seed titles');
  const agentCallsBeforeRefresh = productRouteState.agentSessionsCalls;
  await page.locator('#productAgentAuditRefresh').click();
  await page.waitForFunction(() => document.querySelector('#productFeedback')?.textContent.includes('已刷新 Agent 工具审计'));
  assert(productRouteState.agentSessionsCalls > agentCallsBeforeRefresh, 'Agent audit refresh should call /api/agent/sessions');
  await page.locator('[data-agent-feedback="not_enough_evidence"]').first().click();
  await page.waitForFunction(() => document.querySelector('#productFeedback')?.textContent.includes('已记录 Agent 反馈：证据不足'));
  await page.waitForFunction(() => document.querySelector('#productAgentAuditList')?.textContent.includes('反馈：证据不足'));
  assert(productRouteState.agentFeedbackCalls >= 1, 'Agent trace feedback should call /api/agent/trace-feedback');
  assert(productRouteState.agentFeedbackLabel === 'not_enough_evidence', 'Agent trace feedback should submit the selected label');
  assert(await page.locator('#productProfileModelButton').isDisabled(), 'AI profile enhancement should require consent before it can run');
  assert(await page.locator('#productRecommendModelButton').isDisabled(), 'AI recommendation enhancement should require consent before it can run');
  await page.locator('#productProfileButton').click();
  await page.waitForFunction(() => document.querySelector('#productAiResult')?.textContent.includes('本地画像总结'));
  assert(productRouteState.profileCalls >= 1, 'local profile button should call /api/ai/profile');
  await page.locator('#productRecommendButton').click();
  await page.waitForFunction(() => document.querySelector('#productAiResult')?.textContent.includes('推荐候选'));
  assert(productRouteState.recommendationCalls >= 1, 'local recommendation button should call /api/ai/recommend');
  assert(await page.locator('#productAiProviderTestButton').isDisabled(), 'AI provider test should require consent before it can run');
  await page.locator('#productAiProviderConsent').check();
  const profileModelButton = page.locator('#productProfileModelButton');
  if (await profileModelButton.isDisabled()) {
    await profileModelButton.evaluate((node) => {
      node.disabled = false;
    });
  }
  await profileModelButton.click();
  await page.waitForFunction(() => document.querySelector('#productAiResult')?.textContent.includes('模型画像总结'));
  assert(productRouteState.profileModelConsent, 'AI profile enhancement request should include explicit consent');
  const recommendationModelButton = page.locator('#productRecommendModelButton');
  if (await recommendationModelButton.isDisabled()) {
    await recommendationModelButton.evaluate((node) => {
      node.disabled = false;
    });
  }
  await recommendationModelButton.click();
  await page.waitForFunction(() => document.querySelector('#productAiResult')?.textContent.includes('模型推荐总结'));
  assert(productRouteState.recommendationModelConsent, 'AI recommendation enhancement request should include explicit consent');
  const providerTestButton = page.locator('#productAiProviderTestButton');
  if (await providerTestButton.isDisabled()) {
    await providerTestButton.evaluate((node) => {
      node.disabled = false;
    });
  }
  await providerTestButton.click();
  await page.waitForFunction(() => document.querySelector('#productAiProviderResult')?.textContent.includes('最近自检'));
  assert(productRouteState.providerTestCalls === 1, 'AI provider test button should call /api/ai/provider/test when configured');
  assert(productRouteState.providerTestConsent, 'AI provider test request should include explicit consent');
  assert(productApiCalls.has('/api/ai/provider/test'), 'product app should track AI provider test API call');
  assert(productApiCalls.has('/api/ai/profile'), 'product app should track AI profile API calls');
  assert(productApiCalls.has('/api/ai/recommend'), 'product app should track AI recommendation API calls');
  assert(productApiCalls.has('/api/agent/sessions'), 'product app should track Agent session audit API calls');
  assert(productApiCalls.has('/api/agent/trace-feedback'), 'product app should track Agent trace feedback API calls');

  await page.locator('[data-product-page="advanced"]').click();
  await expectVisible(page, '#productShowAdvancedWorkbench', 'product advanced workbench button');
  assert(
    await page.evaluate(() => document.body.classList.contains('product-advanced-open')),
    'advanced screen should reveal the legacy workbench region',
  );
  const advancedCopy = await page.locator('[data-product-page-panel="advanced"]').innerText();
  assert(advancedCopy.includes('QQ：已通过') && advancedCopy.includes('网易云：已通过'), 'advanced screen should summarize live validation status');

  await page.locator('[data-product-page="overview"]').click();
  assert(
    !(await page.evaluate(() => document.body.classList.contains('product-advanced-open'))),
    'leaving advanced screen should hide the legacy workbench region',
  );
  return {
    pages: 6,
    modes: modeCount,
    buckets: bucketCount,
    aiCards: aiCardCount,
    apiCalls: [...productApiCalls].filter((pathname) => (
      pathname.startsWith('/api/app/')
      || pathname.startsWith('/api/sync/')
      || pathname === '/api/ai/provider/test'
      || pathname === '/api/ai/profile'
      || pathname === '/api/ai/recommend'
      || pathname === '/api/agent/sessions'
      || pathname === '/api/agent/trace-feedback'
    )),
  };
}

async function assertMirrorDeleteDialog(page, mirrorWorkbench) {
  if (!mirrorWorkbench.remove) return { checked: false, reason: 'no remove operations' };

  await page.locator('#mirrorApplyButton').click();
  await page.locator('#mirrorDeleteDialog').waitFor({ state: 'visible', timeout: 10000 });
  const expected = (await page.locator('#mirrorDeleteExpected').innerText()).trim();
  const displayedRemoveCount = await numericText(page, '#mirrorDeleteCount');
  assert(/^REMOVE (QQ|NETEASE)$/.test(expected), `delete dialog expected text should be explicit, got ${expected}`);
  if (mirrorWorkbench.executableRemove !== null) {
    assert(
      displayedRemoveCount === mirrorWorkbench.executableRemove,
      `delete dialog should show executable remove count ${mirrorWorkbench.executableRemove}, got ${displayedRemoveCount}`,
    );
  }
  assert(await page.locator('#mirrorDeleteConfirm').isDisabled(), 'delete confirm should be disabled before exact confirmation');

  await page.locator('#mirrorDeleteConfirmInput').fill('REMOVE WRONG');
  assert(await page.locator('#mirrorDeleteConfirm').isDisabled(), 'delete confirm should remain disabled for wrong confirmation');

  await page.locator('#mirrorDeleteConfirmInput').fill(expected);
  assert(!(await page.locator('#mirrorDeleteConfirm').isDisabled()), 'delete confirm should enable for exact confirmation');

  await page.locator('#mirrorDeleteCancel').click();
  await page.locator('#mirrorDeleteDialog').waitFor({ state: 'hidden', timeout: 10000 });
  return { checked: true, expected, displayedRemoveCount };
}

async function assertMirrorWorkbench(page) {
  const planStats = await getMirrorPlanStats();
  const allCount = await numericText(page, '#mirrorAllCount');
  if (!allCount) {
    const emptyText = await page.locator('#mirrorPlanList').innerText();
    assert(/镜像计划|条目/.test(emptyText), 'empty mirror workbench should explain missing plan');
    return { all: 0, mode: 'empty', ...planStats };
  }

  await page.locator('.mirror-item').first().waitFor({ state: 'attached', timeout: 10000 });
  const firstItemText = await page.locator('.mirror-item').first().innerText();
  assert(firstItemText.includes('Apple'), 'mirror item should show Apple source side');

  const counts = {
    all: allCount,
    add: await numericText(page, '#mirrorAddCount'),
    remove: await numericText(page, '#mirrorRemoveCount'),
    review: await numericText(page, '#mirrorReviewCount'),
    blocked: await numericText(page, '#mirrorBlockedCount'),
  };
  assert(counts.add + counts.remove + counts.review <= counts.all, 'mirror filter counts should not exceed total');

  if (counts.add) {
    await page.locator('[data-mirror-filter="add"]').click();
    await page.locator('.mirror-item.add').first().waitFor({ state: 'attached', timeout: 10000 });
    const visibleAddItems = await page.locator('.mirror-item').evaluateAll((items) => (
      items.every((item) => item.classList.contains('add'))
    ));
    assert(visibleAddItems, 'add filter should show only add operations');

    if (planStats.withAlternatives) {
      const foundAlternatives = await findMirrorAlternatives(page);
      assert(foundAlternatives, 'add operations with alternatives should render candidate alternatives inline');
    }
  }

  if (counts.remove) {
    await page.locator('[data-mirror-filter="remove"]').click();
    await page.locator('.mirror-item.remove').first().waitFor({ state: 'attached', timeout: 10000 });
    const visibleRemoveItems = await page.locator('.mirror-item').evaluateAll((items) => (
      items.every((item) => item.classList.contains('remove'))
    ));
    assert(visibleRemoveItems, 'remove filter should show only remove operations');
  }

  if (counts.review) {
    await page.locator('[data-mirror-filter="review"]').click();
    await page.locator('.mirror-item.review').first().waitFor({ state: 'attached', timeout: 10000 });
    const decisionButtons = await page.locator('[data-mirror-decision]').count();
    assert(decisionButtons >= 2, 'review filter should expose manual mirror review decision controls');
    assert(await page.locator('#mirrorBulkActions').isVisible(), 'review filter should expose mirror bulk review controls');
    const bulkSummary = await page.locator('#mirrorBulkSummary').textContent();
    assert(/可批量复核/.test(bulkSummary || ''), 'mirror bulk controls should explain current-page scope');
    assert(!(await page.locator('#mirrorBulkKeepButton').isDisabled()), 'bulk keep should be enabled for visible review items');
    assert(!(await page.locator('#mirrorBulkSeparateButton').isDisabled()), 'bulk separate should be enabled for visible review items');
  }

  if (counts.blocked) {
    await page.locator('[data-mirror-filter="blocked"]').click();
    await page.locator('.mirror-item').first().waitFor({ state: 'attached', timeout: 10000 });
    const visibleBlockedItems = await page.locator('.mirror-item').evaluateAll((items) => (
      items.every((item) => item.classList.contains('blocked'))
    ));
    assert(visibleBlockedItems, 'blocked filter should show only blocked operations');
  }

  await page.locator('[data-mirror-filter="all"]').click();
  return {
    ...counts,
    alternatives: planStats.withAlternatives,
    executableRemove: planStats.executableRemove,
    staleSnapshots: planStats.staleSnapshots,
    hasOpenDelta: planStats.hasOpenDelta,
    mode: 'operations',
  };
}

async function findMirrorAlternatives(page) {
  for (let index = 0; index < 20; index += 1) {
    if (await page.locator('.mirror-alternatives').count()) return true;
    const next = page.locator('#mirrorNextButton');
    if (await next.isDisabled()) return false;
    await next.click();
    await page.waitForTimeout(50);
  }
  return false;
}

async function getMirrorPlanStats() {
  try {
    const response = await fetch(`${baseUrl}/api/mirror/plan`, { cache: 'no-store' });
    const payload = await response.json();
    const operations = Array.isArray(payload.plan?.operations) ? payload.plan.operations : [];
    const summary = payload.plan?.summary || {};
    const sourceAge = ageDays(payload.plan?.source?.fetchedAt);
    const targetAge = ageDays(payload.plan?.target?.fetchedAt);
    return {
      withAlternatives: operations.filter((operation) => Array.isArray(operation.alternatives) && operation.alternatives.length).length,
      executableRemove: operations.length
        ? operations.filter((operation) => operation.action === 'remove' && operation.targetTrack?.id).length
        : null,
      staleSnapshots: [sourceAge, targetAge].some((days) => days !== null && days > SNAPSHOT_STALE_DAYS),
      hasOpenDelta: Boolean((summary.add || 0) || (summary.remove || 0) || (summary.review || 0)),
    };
  } catch {
    return { withAlternatives: 0, executableRemove: null, staleSnapshots: false, hasOpenDelta: false };
  }
}

async function assertMirrorTargetState(page, target, expected) {
  await page.selectOption('#syncTarget', target);
  await page.waitForTimeout(50);
  const ids = ['#mirrorPlanButton', '#mirrorResolveButton', '#mirrorDryRunButton', '#mirrorAddButton', '#mirrorApplyButton', '#mirrorConvergenceButton'];
  for (const selector of ids) {
    const disabled = await page.locator(selector).isDisabled();
    assert(disabled === expected.disabled, `${selector} disabled=${disabled}, expected ${expected.disabled} for ${target}`);
  }
}

async function expectVisible(page, selector, label) {
  const locator = page.locator(selector);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  assert(await locator.isVisible(), `${label} should be visible`);
}

async function numericText(page, selector) {
  const text = await page.locator(selector).innerText();
  return Number(String(text || '').replace(/[^\d]/g, '')) || 0;
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with ${child.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/state`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Server did not become ready\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

function findLocalBrowser() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function randomPort() {
  return 4400 + Math.floor(Math.random() * 1000);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 180);
}

function ageDays(value) {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / DAY_MS));
}

function ignoredMissingResource(url) {
  try {
    return new URL(url).pathname === '/favicon.ico';
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
