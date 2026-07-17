#!/usr/bin/env node
import './env.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import {
  fetchPlatformSnapshots,
  generateMatchReport,
  getState,
  importAppleContent,
  importAppleRows,
  importAppleUrl,
  saveCookies,
  FILES,
  createNeteaseQrLogin,
  checkNeteaseQrLogin,
  enrichAppleMetadata,
  generateUnifiedLibrary,
  getUnifiedItems,
  generateAiSuggestions,
  applyAiSuggestions,
  saveUnifiedDecision,
  generateWritePlan,
  generateMirrorSyncPlan,
  checkMirrorConvergence,
  resolveMirrorAdds,
  runMirrorSyncPlan,
  saveMirrorDecision,
  saveMirrorDecisionBatch,
  generateMirrorAiSuggestions,
  applyMirrorAiSuggestions,
  runPlatformWrite,
  saveSyncDecision,
  generateSyncAiSuggestions,
  applySyncAiSuggestions,
  getProductAppState,
  getProductSyncModes,
  generateProductSyncPreview,
  getProductSyncPreview,
  resolveProductSyncMedia,
  resolveProductSyncAdditions,
  reviewProductAddCandidates,
  reviewProductIdentityCandidates,
  applyProductIdentityDecision,
  applyProductIdentityAiSuggestions,
  applyProductAddAiSuggestions,
  applyProductAddCandidateDecision,
  applyProductAddCandidateDecisionBatch,
  getProductSyncBaseline,
  saveProductSyncBaseline,
  saveProductTombstoneDecision,
  checkProductSyncConvergence,
  confirmProductSyncDeletions,
  executeProductSyncAdditions,
  executeProductSyncDeletions,
  getProductSyncBackups,
  createProductSyncBackup,
  restoreProductSyncBackup,
  getProductAiProviderState,
  getProductLiveValidationState,
  runProductLiveValidation,
  saveProductAiProviderState,
  testProductAiProvider,
  explainProductSyncItem,
  analyzeProductTombstoneRisks,
  generateProductMusicProfile,
  findProductSimilarTracks,
  generateProductRecommendations,
  getAgentToolRegistry,
  getAgentSessions,
  saveAgentTraceFeedback,
  runAgentToolRequest,
  getProductAutoSyncState,
  saveProductAutoSyncSettings,
  runProductAutoSync,
} from './workflow.js';
import {
  captureAppleMusicPage,
  checkAppleMusicBrowserConnection,
  openAppleMusicBrowser,
} from './apple-edge.js';
import {
  captureQQMusicCookies,
  checkQQMusicBrowserLogin,
  checkQQMusicQrLogin,
  completeQQMusicQrLogin,
  openQQMusicBrowser,
  startQQMusicQrLogin,
} from './qq-edge.js';
import { createObservability } from './observability.js';
import { listQQPlaylists } from './providers/qq.js';
import { WEB_APP_DIST_DIR, WEB_DIR, ensureDirs, formatErrorMessage, parsePort, pathExists } from './utils.js';

const cliPort = process.argv[2];
const PORT = parsePort(process.env.PORT || cliPort, { name: process.env.PORT ? 'PORT' : 'port', defaultValue: 4319 });
const HOST = process.env.HOST || '127.0.0.1';
const AUTO_SYNC_POLL_MS = Math.max(5000, Number(process.env.MUSIC_LIKES_SYNC_SCHEDULER_POLL_MS || 30000));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};
const LEGACY_ASSET_PATHS = new Set([
  '/app.js',
  '/product-app.js',
  '/styles.css',
  '/product.css',
  '/mark.svg',
]);
let syncProgress = {
  active: false,
  title: '',
  phase: '',
  done: 0,
  total: 0,
  current: null,
  startedAt: '',
  updatedAt: '',
  finishedAt: '',
  error: '',
};
let autoSyncTimer = null;

await ensureDirs();
const observability = createObservability({ getSyncProgress: () => syncProgress });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/metrics') {
      return await observability.handleMetrics(res);
    }

    return await observability.observeRequest(req, res, url, async () => {
      try {
        if (url.pathname.startsWith('/api/')) {
          return await handleApi(req, res, url);
        }

        return await serveStatic(req, res, url);
      } catch (error) {
        if (res.headersSent) {
          res.destroy(error);
          return null;
        }
        if ((req.url || '').startsWith('/api/sync/')) {
          finishSyncProgress({
            error: formatErrorMessage(error),
          });
        }
        const status = error.httpStatus || 500;
        return sendJson(res, status, {
          ok: false,
          error: formatErrorMessage(error),
        });
      }
    });
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return null;
    }
    if ((req.url || '').startsWith('/api/sync/')) {
      finishSyncProgress({
        error: formatErrorMessage(error),
      });
    }
    const status = error.httpStatus || 500;
    return sendJson(res, status, {
      ok: false,
      error: formatErrorMessage(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`music-likes-sync web UI: http://${HOST}:${PORT}`);
  startAutoSyncScheduler();
});

server.on('close', () => {
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = null;
});

function startAutoSyncScheduler() {
  scheduleAutoSyncTick(Math.min(AUTO_SYNC_POLL_MS, 5000));
}

function scheduleAutoSyncTick(delay = AUTO_SYNC_POLL_MS) {
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(runAutoSyncTick, delay);
  autoSyncTimer.unref?.();
}

async function runAutoSyncTick() {
  autoSyncTimer = null;
  try {
    const state = await getProductAutoSyncState({ limit: 1 });
    const automation = state.automation || {};
    const nextRunAt = Date.parse(automation.nextRunAt || '');
    const due = automation.enabled && (Number.isNaN(nextRunAt) || nextRunAt <= Date.now());
    if (due && !automation.running) {
      await runProductAutoSync({ trigger: 'scheduled' });
    }
  } catch (error) {
    console.error(`auto-sync scheduler: ${formatErrorMessage(error)}`);
  } finally {
    scheduleAutoSyncTick();
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/sync/progress') {
    return sendJson(res, 200, { ok: true, progress: syncProgress });
  }

  if (req.method === 'GET' && url.pathname === '/api/auto-sync') {
    return sendJson(res, 200, {
      ok: true,
      data: await getProductAutoSyncState({ limit: url.searchParams.get('limit') || 20 }),
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/auto-sync') {
    const body = await readJsonBody(req);
    const result = await saveProductAutoSyncSettings({
      enabled: body.enabled,
      intervalMinutes: body.intervalMinutes,
      targets: body.targets,
      refreshApple: body.refreshApple,
      refreshTargets: body.refreshTargets,
      autoExecuteAdditions: body.autoExecuteAdditions,
      requireBaseline: body.requireBaseline,
      maxSourceAgeMinutes: body.maxSourceAgeMinutes,
    });
    return sendJson(res, 200, { ok: true, data: result, warnings: [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/auto-sync/run') {
    const body = await readJsonBody(req);
    const result = await runProductAutoSync({
      trigger: 'manual',
      dryRun: body.dryRun !== false,
      executeAdditions: body.executeAdditions === true,
    });
    return sendJson(res, 200, { ok: true, data: result, warnings: [] });
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, { ok: true, state: await getState() });
  }

  if (req.method === 'GET' && url.pathname === '/api/app/state') {
    return sendJson(res, 200, {
      ok: true,
      data: await getProductAppState(),
      warnings: [],
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/sync/modes') {
    return sendJson(res, 200, {
      ok: true,
      data: getProductSyncModes(),
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/check') {
    const body = await readJsonBody(req);
    const result = await generateProductSyncPreview({
      mode: body.mode,
      policy: body.policy,
      platforms: body.platforms,
      source: body.source,
      target: body.target,
      targets: body.targets,
      deletionPolicy: body.deletionPolicy,
      threshold: body.threshold,
      minScore: body.minScore,
      reviewThreshold: body.reviewThreshold,
    });
    return sendJson(res, 200, {
      ok: true,
      data: {
        previewId: result.previewId,
        generatedAt: result.generatedAt,
        mode: result.mode,
        counts: result.counts,
        blocked: result.blocked,
        compatibility: result.compatibility,
      },
      warnings: [],
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/sync/preview') {
    const result = await getProductSyncPreview({
      previewId: url.searchParams.get('previewId') || '',
      bucket: url.searchParams.get('bucket') || 'all',
      cursor: url.searchParams.get('cursor') || 0,
      offset: url.searchParams.get('offset') || 0,
      limit: url.searchParams.get('limit') || 50,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/media') {
    const body = await readJsonBody(req);
    const result = await resolveProductSyncMedia({
      previewId: body.previewId,
      operationId: body.operationId,
      role: body.role,
      alternativeIndex: body.alternativeIndex,
      alignWithSource: body.alignWithSource === true,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/resolve-additions') {
    const body = await readJsonBody(req);
    const result = await resolveProductSyncAdditions({
      operationIds: body.operationIds,
      target: body.target,
      targets: Array.isArray(body.targets) ? body.targets : undefined,
      playlistId: body.playlistId,
      resolveLimit: body.resolveLimit,
      limit: body.limit,
      searchLimit: body.searchLimit,
      threshold: body.threshold,
      reviewThreshold: body.reviewThreshold,
      refresh: body.refresh === true,
      bucket: body.bucket,
      previewLimit: body.previewLimit,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/additions/review') {
    const body = await readJsonBody(req);
    const result = await reviewProductAddCandidates({
      consent: body.consent,
      operationIds: body.operationIds,
      targets: body.targets,
      limit: body.limit,
      refresh: body.refresh,
      thinking: body.thinking,
      model: body.model,
      bucket: body.bucket,
      previewLimit: body.previewLimit,
    });
    return sendJson(res, 200, { ok: true, data: result, warnings: [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/identity/review') {
    const body = await readJsonBody(req);
    const result = await reviewProductIdentityCandidates({
      consent: body.consent,
      operationIds: body.operationIds,
      targets: body.targets,
      limit: body.limit,
      refresh: body.refresh,
      thinking: body.thinking,
      model: body.model,
      bucket: body.bucket,
      previewLimit: body.previewLimit,
    });
    return sendJson(res, 200, { ok: true, data: result, warnings: [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/identity/apply') {
    const body = await readJsonBody(req);
    const result = await applyProductIdentityAiSuggestions({
      confirmText: body.confirmText,
      threshold: body.threshold,
      overwrite: body.overwrite,
      operationIds: body.operationIds,
      targets: body.targets,
      authorizationNote: body.authorizationNote,
      bucket: body.bucket,
      previewLimit: body.previewLimit,
    });
    return sendJson(res, 200, { ok: true, data: result, warnings: [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/additions/apply') {
    const body = await readJsonBody(req);
    const result = await applyProductAddAiSuggestions({
      confirmText: body.confirmText,
      threshold: body.threshold,
      operationIds: body.operationIds,
      targets: body.targets,
      authorizationNote: body.authorizationNote,
      bucket: body.bucket,
      previewLimit: body.previewLimit,
    });
    return sendJson(res, 200, { ok: true, data: result, warnings: [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/identity-decision') {
    const body = await readJsonBody(req);
    const result = await applyProductIdentityDecision({
      operationId: body.operationId,
      action: body.action,
      target: body.target,
      note: body.note,
      bucket: body.bucket,
      previewLimit: body.previewLimit,
    });
    return sendJson(res, 200, { ok: true, data: result, warnings: [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/addition-decision') {
    const body = await readJsonBody(req);
    const result = await applyProductAddCandidateDecision({
      operationId: body.operationId,
      action: body.action,
      alternativeIndex: body.alternativeIndex,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/addition-decisions') {
    const body = await readJsonBody(req);
    const result = await applyProductAddCandidateDecisionBatch({
      operationIds: body.operationIds,
      action: body.action,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/sync/baseline') {
    const result = await getProductSyncBaseline({
      platforms: url.searchParams.get('platforms') || '',
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/baseline/save') {
    const body = await readJsonBody(req);
    const result = await saveProductSyncBaseline({
      platforms: body.platforms,
      targets: body.targets,
      policy: body.policy,
      source: body.source,
      requireConverged: body.requireConverged,
      previewId: body.previewId,
      activateManaged: body.activateManaged,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/tombstones') {
    const body = await readJsonBody(req);
    const result = await saveProductTombstoneDecision({
      key: body.key || body.tombstoneKey,
      operationId: body.operationId,
      action: body.action || body.tombstoneAction,
      platform: body.platform,
      track: body.track,
      note: body.note,
      confirmText: body.confirmText,
      refreshPreview: body.refreshPreview,
      items: Array.isArray(body.items) ? body.items : undefined,
      decisions: Array.isArray(body.decisions) ? body.decisions : undefined,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/convergence') {
    const body = await readJsonBody(req);
    const result = await checkProductSyncConvergence({
      target: body.target,
      targets: Array.isArray(body.targets) ? body.targets : undefined,
      playlistId: body.playlistId,
      refreshTarget: body.refreshTarget,
      persist: body.persist,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/confirm-deletions') {
    const body = await readJsonBody(req);
    const result = await confirmProductSyncDeletions({
      operationIds: body.operationIds,
      confirmText: body.confirmText,
      target: body.target,
      targets: Array.isArray(body.targets) ? body.targets : undefined,
      authorizationNote: body.authorizationNote,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/execute-additions') {
    const body = await readJsonBody(req);
    const result = await executeProductSyncAdditions({
      dryRun: body.dryRun,
      operationIds: body.operationIds,
      target: body.target,
      targets: Array.isArray(body.targets) ? body.targets : undefined,
      playlistId: body.playlistId,
      batchSize: body.batchSize,
      force: body.force,
      resolve: body.resolve,
      resolveLimit: body.resolveLimit,
      searchLimit: body.searchLimit,
      threshold: body.threshold,
      reviewThreshold: body.reviewThreshold,
      refreshAfterWrite: body.refreshAfterWrite,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/execute-deletions') {
    const body = await readJsonBody(req);
    const result = await executeProductSyncDeletions({
      dryRun: body.dryRun,
      operationIds: body.operationIds,
      target: body.target,
      targets: Array.isArray(body.targets) ? body.targets : undefined,
      playlistId: body.playlistId,
      batchSize: body.batchSize,
      force: body.force,
      refreshAfterWrite: body.refreshAfterWrite,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/sync/backups') {
    const result = await getProductSyncBackups({
      limit: url.searchParams.get('limit'),
      runLimit: url.searchParams.get('runLimit'),
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/backups') {
    const body = await readJsonBody(req);
    const result = await createProductSyncBackup({
      targets: Array.isArray(body.targets) ? body.targets : undefined,
      refresh: body.refresh !== false,
      playlistId: body.playlistId,
      reason: body.reason || 'manual',
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/backups/restore') {
    const body = await readJsonBody(req);
    const result = await restoreProductSyncBackup({
      backupId: body.backupId,
      targets: Array.isArray(body.targets) ? body.targets : undefined,
      dryRun: body.dryRun !== false,
      refresh: body.refresh !== false,
      confirmText: body.confirmText,
      playlistId: body.playlistId,
      batchSize: body.batchSize,
      force: body.force,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/sync/plan') {
    const plan = await readJsonFile(FILES.writePlan, null);
    return sendJson(res, 200, { ok: true, plan });
  }

  if (req.method === 'GET' && url.pathname === '/api/mirror/plan') {
    const plan = await readJsonFile(FILES.mirrorPlan, null);
    return sendJson(res, 200, { ok: true, plan });
  }

  if (req.method === 'GET' && url.pathname === '/api/report.md') {
    const text = await fs.readFile(FILES.reportMd, 'utf8').catch(() => '');
    return sendText(res, 200, text, 'text/markdown; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/api/report.json') {
    const text = await fs.readFile(FILES.reportJson, 'utf8').catch(() => '{}');
    return sendText(res, 200, text, 'application/json; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/api/unified.md') {
    const text = await fs.readFile(FILES.unifiedMd, 'utf8').catch(() => '');
    return sendText(res, 200, text, 'text/markdown; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/api/unified.json') {
    const text = await fs.readFile(FILES.unifiedJson, 'utf8').catch(() => '{}');
    return sendText(res, 200, text, 'application/json; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/api/unified/items') {
    const result = await getUnifiedItems({
      filter: url.searchParams.get('filter') || 'all-gaps',
      query: url.searchParams.get('q') || '',
      offset: url.searchParams.get('offset') || 0,
      limit: url.searchParams.get('limit') || 40,
    });
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (req.method === 'POST' && url.pathname === '/api/apple') {
    const body = await readJsonBody(req);
    const apple = await importAppleContent(body.content || '', body.filename || 'web-upload');
    return sendJson(res, 200, {
      ok: true,
      message: `Apple Music 已导入 ${apple.tracks.length} 首`,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/apple/url') {
    const body = await readJsonBody(req);
    const apple = await importAppleUrl(body.url || '', {
      appleCookie: body.appleCookie,
    });
    return sendJson(res, 200, {
      ok: true,
      message: `Apple Music 链接已抓取 ${apple.tracks.length} 首`,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/apple/connect/start') {
    const sourceUrl = await readSavedAppleSourceUrl();
    const existing = await checkAppleMusicBrowserConnection({ sourceUrl });
    if (existing.ready) {
      const connected = await completeAppleBrowserConnection(existing);
      return sendJson(res, 200, { ok: true, ...connected, state: await getState() });
    }
    await openAppleMusicBrowser(sourceUrl || '', { headless: false });
    const status = await checkAppleMusicBrowserConnection({ sourceUrl });
    return sendJson(res, 200, {
      ok: true,
      message: status.message,
      status: publicAppleConnectionStatus(status),
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/apple/connect/check') {
    const sourceUrl = await readSavedAppleSourceUrl();
    const status = await checkAppleMusicBrowserConnection({ sourceUrl });
    if (!status.ready) {
      return sendJson(res, 200, {
        ok: true,
        message: status.message,
        status: publicAppleConnectionStatus(status),
        state: await getState(),
      });
    }

    const connected = await completeAppleBrowserConnection(status);
    return sendJson(res, 200, { ok: true, ...connected, state: await getState() });
  }

  if (req.method === 'POST' && url.pathname === '/api/apple/browser/open') {
    const body = await readJsonBody(req);
    const browser = await openAppleMusicBrowser(body.url || '');
    return sendJson(res, 200, {
      ok: true,
      message: 'Apple 登录窗口已打开。登录完成后回到这里点“抓取 Apple 页面”。',
      browser,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/apple/browser/capture') {
    const capture = await captureAppleMusicPage();
    const apple = await importAppleRows(capture.tracks, capture.source || 'apple-browser');
    return sendJson(res, 200, {
      ok: true,
      message: `Apple 页面已抓取 ${apple.tracks.length} 首`,
      capture: {
        title: capture.title,
        url: capture.url,
        count: capture.count,
      },
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/cookies') {
    const body = await readJsonBody(req);
    const state = await saveCookies({
      appleCookie: body.appleCookie,
      qqCookie: body.qqCookie,
      neteaseCookie: body.neteaseCookie,
    });
    return sendJson(res, 200, { ok: true, message: 'Cookie 已保存到本地 data 目录', state });
  }

  if (req.method === 'POST' && url.pathname === '/api/qq/qr/start') {
    const body = await readJsonBody(req);
    let qr = null;
    if (body.force !== true) {
      const savedCookie = await fs.readFile(FILES.qqCookie, 'utf8').catch(() => '');
      if (savedCookie.trim()) {
        try {
          await listQQPlaylists(savedCookie);
          qr = {
            done: true,
            waiting: false,
            code: 'credential_ready',
            message: 'QQ 音乐登录状态仍然有效，已直接续用。',
            capture: { cookie: savedCookie },
          };
        } catch {
          // The provider API, not cookie shape, decides whether reauthentication is required.
        }
      }
    }
    if (!qr) qr = await startQQMusicQrLogin({ force: body.force === true });
    if (qr.done && qr.capture?.cookie) {
      try {
        await listQQPlaylists(qr.capture.cookie);
      } catch {
        if (body.force !== true) qr = await startQQMusicQrLogin({ force: true });
      }
    }
    let state = await getState();
    if (qr.done && qr.capture?.cookie) {
      state = await saveCookies({ qqCookie: qr.capture.cookie });
    }
    return sendJson(res, 200, {
      ok: true,
      message: qr.message,
      status: publicQQConnectionStatus(qr),
      qr: qr.done ? null : {
        key: qr.key,
        images: qr.images,
        expiresAt: qr.expiresAt,
      },
      state,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/qq/qr/check') {
    const body = await readJsonBody(req);
    const status = await checkQQMusicQrLogin(body.key);
    let state = await getState();
    if (status.done && status.capture?.cookie) {
      try {
        await listQQPlaylists(status.capture.cookie);
      } catch {
        return sendJson(res, 200, {
          ok: true,
          message: '手机确认已完成，正在等待 QQ 音乐会话就绪。',
          status: {
            code: 'credential_verifying',
            message: '手机确认已完成，正在等待 QQ 音乐会话就绪。',
            done: false,
            waiting: true,
          },
          state,
        });
      }
      completeQQMusicQrLogin(body.key);
      state = await saveCookies({ qqCookie: status.capture.cookie });
    }
    return sendJson(res, 200, {
      ok: true,
      message: status.message,
      status: publicQQConnectionStatus(status),
      state,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/qq/browser/open') {
    const browser = await openQQMusicBrowser();
    return sendJson(res, 200, {
      ok: true,
      message: '腾讯官方登录页已打开。可使用本机 QQ/微信快捷登录，完成后这里会自动继续。',
      browser,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/qq/browser/check') {
    const status = await checkQQMusicBrowserLogin();
    let state = await getState();
    let qqCookie = null;
    if (status.done && status.capture?.cookie) {
      state = await saveCookies({ qqCookie: status.capture.cookie });
      qqCookie = {
        count: status.capture.count,
        names: status.capture.names,
        hasUin: status.capture.hasUin,
        hasKey: status.capture.hasKey,
        url: status.capture.url,
      };
    }
    return sendJson(res, 200, {
      ok: true,
      message: status.message,
      status: {
        code: status.code,
        message: status.message,
        done: Boolean(status.done),
        waiting: Boolean(status.waiting),
      },
      qqCookie,
      state,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/qq/browser/capture') {
    const capture = await captureQQMusicCookies();
    const state = await saveCookies({ qqCookie: capture.cookie });
    return sendJson(res, 200, {
      ok: true,
      message: `QQ Cookie 已保存：${capture.count} 项`,
      qqCookie: {
        count: capture.count,
        names: capture.names,
        hasUin: capture.hasUin,
        hasKey: capture.hasKey,
        url: capture.url,
      },
      state,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/qq/playlists') {
    const cookie = await fs.readFile(FILES.qqCookie, 'utf8').catch(() => '');
    if (!cookie.trim()) {
      return sendJson(res, 400, {
        ok: false,
        error: '请先完成 QQ 登录或保存 QQ Cookie',
      });
    }
    const playlists = await listQQPlaylists(cookie);
    return sendJson(res, 200, {
      ok: true,
      message: `已读取 QQ 歌单：${playlists.length} 个`,
      playlists,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/netease/qr/start') {
    const qr = await createNeteaseQrLogin();
    return sendJson(res, 200, {
      ok: true,
      message: '网易云二维码已生成',
      qr,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/netease/qr/check') {
    const body = await readJsonBody(req);
    const status = await checkNeteaseQrLogin(body.key);
    return sendJson(res, 200, {
      ok: true,
      message: status.message,
      status,
      state: status.state || await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/snapshot') {
    const body = await readJsonBody(req);
    const snapshots = await fetchPlatformSnapshots({
      qq: body.qq !== false,
      netease: body.netease !== false,
      qqUin: body.qqUin,
      qqPlaylistId: body.qqPlaylistId,
      neteaseUid: body.neteaseUid,
      neteasePlaylistId: body.neteasePlaylistId,
      refreshBrowserCredential: body.refreshBrowserCredential !== false,
    });
    return sendJson(res, 200, {
      ok: true,
      message: '平台快照已更新',
      snapshots: summarizeSnapshots(snapshots),
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/metadata/enrich') {
    const body = await readJsonBody(req);
    const result = await enrichAppleMetadata({
      limit: body.limit,
      refresh: body.refresh,
    });
    return sendJson(res, 200, {
      ok: true,
      message: `元数据已补完：ISRC ${result.stats.withIsrc} 首，MusicBrainz 新查 ${result.stats.fetched} 首，缓存命中 ${result.stats.cacheHits} 首`,
      stats: result.stats,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/match') {
    const body = await readJsonBody(req);
    const report = await generateMatchReport({
      threshold: body.threshold,
      reviewThreshold: body.reviewThreshold,
    });
    return sendJson(res, 200, {
      ok: true,
      message: '匹配报告已生成',
      report: {
        generatedAt: report.generatedAt,
        platforms: report.platforms,
      },
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/unified/generate') {
    const body = await readJsonBody(req);
    const unified = await generateUnifiedLibrary({
      threshold: body.threshold,
      reviewThreshold: body.reviewThreshold,
    });
    return sendJson(res, 200, {
      ok: true,
      message: `统一曲库已生成：${unified.summary.totalUnified} 首`,
      unified: unified.summary,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/unified/decision') {
    const body = await readJsonBody(req);
    const result = await saveUnifiedDecision(body);
    return sendJson(res, 200, {
      ok: true,
      message: '选择已保存',
      ...result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/review') {
    const body = await readJsonBody(req);
    const result = await generateAiSuggestions({
      filter: body.filter,
      query: body.query,
      offset: body.offset,
      limit: body.limit,
      model: body.model,
      apiKey: body.apiKey,
      thinking: body.thinking,
      refresh: body.refresh,
      dryRun: body.dryRun,
    });
    return sendJson(res, 200, {
      ok: true,
      message: result.dryRun ? 'AI 预览已生成' : `AI 建议已生成：${result.decisions.length} 条`,
      result: {
        dryRun: result.dryRun,
        batchId: result.batchId || result.batch?.batch_id,
        model: result.model,
        itemCount: result.itemCount || result.batch?.items?.length || 0,
        decisionCount: result.decisions.length,
        total: result.total || result.batch?.items?.length || 0,
        remaining: result.remaining || 0,
      },
      state: await getState(),
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/ai/profile') {
    const profile = await generateProductMusicProfile({
      refresh: false,
      save: false,
    });
    return sendJson(res, 200, {
      ok: true,
      data: profile,
      warnings: [],
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/ai/provider') {
    return sendJson(res, 200, {
      ok: true,
      data: await getProductAiProviderState(),
      warnings: [],
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/validation/live') {
    return sendJson(res, 200, {
      ok: true,
      data: await getProductLiveValidationState(),
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/validation/live/run') {
    const body = await readJsonBody(req);
    const result = await runProductLiveValidation({
      target: body.target,
      query: body.query,
      confirm: body.confirm,
      playlistId: body.playlistId,
      playlistName: body.playlistName,
      writeReport: body.writeReport,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/provider') {
    const body = await readJsonBody(req);
    const result = await saveProductAiProviderState({
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      batchSize: body.batchSize,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/provider/test') {
    const body = await readJsonBody(req);
    const result = await testProductAiProvider({
      consent: body.consent,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/explain') {
    const body = await readJsonBody(req);
    const result = await explainProductSyncItem({
      operationId: body.operationId,
      tombstoneKey: body.tombstoneKey,
      bucket: body.bucket,
      useModel: body.useModel,
      consent: body.consent,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      thinking: body.thinking,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/tombstones/analyze') {
    const body = await readJsonBody(req);
    const result = await analyzeProductTombstoneRisks({
      limit: body.limit,
      useModel: body.useModel,
      consent: body.consent,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      thinking: body.thinking,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/profile') {
    const body = await readJsonBody(req);
    const profile = await generateProductMusicProfile({
      refresh: body.refresh,
      save: body.save !== false,
      useModel: body.useModel,
      consent: body.consent,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      thinking: body.thinking,
    });
    return sendJson(res, 200, {
      ok: true,
      data: profile,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/similar') {
    const body = await readJsonBody(req);
    const result = await findProductSimilarTracks({
      seed: body.seed,
      limit: body.limit,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/recommend') {
    const body = await readJsonBody(req);
    const result = await generateProductRecommendations({
      limit: body.limit,
      excludeApple: body.excludeApple,
      refreshProfile: body.refreshProfile,
      saveShortlist: body.saveShortlist,
      shortlistName: body.shortlistName,
      useModel: body.useModel,
      consent: body.consent,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      thinking: body.thinking,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/agent/tools') {
    return sendJson(res, 200, {
      ok: true,
      data: getAgentToolRegistry(),
      warnings: [],
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/agent/sessions') {
    const result = await getAgentSessions({
      limit: Number(url.searchParams.get('limit') || 10),
      traceLimit: Number(url.searchParams.get('traceLimit') || 20),
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/trace-feedback') {
    const body = await readJsonBody(req);
    const result = await saveAgentTraceFeedback({
      sessionId: body.sessionId,
      traceId: body.traceId,
      label: body.label,
      source: 'product-ui',
      limit: body.limit,
      traceLimit: body.traceLimit,
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/chat') {
    const body = await readJsonBody(req);
    const result = await runAgentToolRequest({
      message: body.message,
      tool: body.tool,
      arguments: body.arguments,
      sessionId: body.sessionId,
      refresh: body.refresh,
      source: 'http',
    });
    return sendJson(res, 200, {
      ok: true,
      data: result,
      warnings: [],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/apply') {
    const body = await readJsonBody(req);
    const result = await applyAiSuggestions({
      threshold: body.threshold,
      overwrite: body.overwrite,
      dryRun: body.dryRun,
    });
    return sendJson(res, 200, {
      ok: true,
      message: result.dryRun
        ? `可采纳 ${result.applied} 条高置信 AI 建议`
        : `已采纳 ${result.applied} 条高置信 AI 建议`,
      result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/plan') {
    const body = await readJsonBody(req);
    const target = normalizeSyncTarget(body.target);
    const label = platformLabel(target);
    startSyncProgress('生成写入计划', `搜索${label}候选`);
    const plan = await generateWritePlan({
      target,
      resolve: body.resolve,
      limit: body.limit,
      offset: body.offset,
      minScore: body.minScore,
      reviewScore: body.reviewScore,
      searchLimit: body.searchLimit,
      onProgress: (progress) => updateSyncProgress({
        phase: `搜索${label}候选`,
        ...progress,
      }),
    });
    finishSyncProgress({
      done: plan.items?.length || 0,
      total: plan.items?.length || 0,
    });
    return sendJson(res, 200, {
      ok: true,
      message: writePlanMessage(plan),
      plan,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/mirror/plan') {
    const body = await readJsonBody(req);
    const target = normalizeMirrorTarget(body.target);
    const plan = await generateMirrorSyncPlan({
      target,
      threshold: body.threshold || body.minScore,
      reviewThreshold: body.reviewThreshold,
    });
    return sendJson(res, 200, {
      ok: true,
      message: `Apple -> ${platformLabel(target)} 镜像计划已生成：新增 ${plan.summary.add} / 删除 ${plan.summary.remove} / 待判断 ${plan.summary.review}`,
      plan,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/mirror/resolve-adds') {
    const body = await readJsonBody(req);
    const plan = await resolveMirrorAdds({
      threshold: body.threshold || body.minScore,
      reviewThreshold: body.reviewThreshold,
      limit: body.limit,
      offset: body.offset,
      searchLimit: body.searchLimit,
    });
    const resolution = plan.addResolution || {};
    return sendJson(res, 200, {
      ok: true,
      message: `新增候选已解析：本批 ${resolution.processed || 0}，可新增 ${resolution.resolved || 0}，待判断 ${resolution.review || 0}，未命中 ${resolution.notFound || 0}`,
      plan,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/mirror/convergence') {
    const body = await readJsonBody(req);
    const result = await checkMirrorConvergence({
      target: body.target,
      playlistId: body.playlistId,
      refreshTarget: body.refreshTarget,
      persist: body.persist,
    });
    return sendJson(res, 200, {
      ok: true,
      message: mirrorConvergenceMessage(result.convergence),
      result,
      plan: result.plan,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/mirror/decision') {
    const body = await readJsonBody(req);
    const result = await saveMirrorDecision({
      key: body.key,
      action: body.action,
      target: body.target,
      operationId: body.operationId,
      reason: body.reason,
      note: body.note,
    });
    return sendJson(res, 200, {
      ok: true,
      message: mirrorDecisionMessage(body.action),
      result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/mirror/decisions') {
    const body = await readJsonBody(req);
    const result = await saveMirrorDecisionBatch({
      action: body.action,
      target: body.target,
      items: Array.isArray(body.items) ? body.items : [],
    });
    return sendJson(res, 200, {
      ok: true,
      message: mirrorDecisionBatchMessage(result),
      result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/mirror/ai/review') {
    const body = await readJsonBody(req);
    const result = await generateMirrorAiSuggestions({
      consent: body.consent,
      apiKey: body.apiKey,
      model: body.model,
      thinking: body.thinking,
      aiLimit: body.aiLimit || body.batchSize,
      refresh: body.refresh,
      includeSuggested: body.includeSuggested,
    });
    return sendJson(res, 200, {
      ok: true,
      message: `Mirror AI reviewed ${result.itemCount || 0} candidates and saved ${result.decisionCount || 0} suggestions.`,
      result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/mirror/ai/apply') {
    const body = await readJsonBody(req);
    const result = await applyMirrorAiSuggestions({
      threshold: body.threshold,
      overwrite: body.overwrite,
      target: body.target,
    });
    return sendJson(res, 200, {
      ok: true,
      message: `Mirror AI applied ${result.applied || 0} decisions: keep ${result.kept || 0}, separate ${result.separated || 0}.`,
      result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/mirror/apply') {
    const body = await readJsonBody(req);
    const result = await runMirrorSyncPlan({
      dryRun: body.dryRun,
      actions: Array.isArray(body.actions) ? body.actions : [],
      confirmText: body.confirmText,
      playlistId: body.playlistId,
      batchSize: body.batchSize,
      force: body.force,
    });
    return sendJson(res, 200, {
      ok: true,
      message: mirrorRunMessage(result),
      result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/decision') {
    const body = await readJsonBody(req);
    const result = await saveSyncDecision({
      key: body.key,
      action: body.action,
      target: body.target,
      clusterId: body.clusterId,
      trackId: body.trackId,
    });
    return sendJson(res, 200, {
      ok: true,
      message: '写入候选选择已保存',
      result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/ai/review') {
    const body = await readJsonBody(req);
    const result = await generateSyncAiSuggestions({
      target: normalizeSyncTarget(body.target),
      consent: body.consent,
      apiKey: body.apiKey,
      model: body.model,
      thinking: body.thinking,
      aiLimit: body.aiLimit,
      minScore: body.minScore,
      reviewScore: body.reviewScore,
      searchLimit: body.searchLimit,
      refresh: body.refresh,
    });
    return sendJson(res, 200, {
      ok: true,
      message: `写入候选 AI 已分析：${result.decisionCount} 条`,
      result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/ai/apply') {
    const body = await readJsonBody(req);
    const result = await applySyncAiSuggestions({
      threshold: body.threshold,
      overwrite: body.overwrite,
      minScore: body.minScore,
      reviewScore: body.reviewScore,
      searchLimit: body.searchLimit,
    });
    return sendJson(res, 200, {
      ok: true,
      message: `写入候选 AI 已采纳：确认 ${result.accepted} / 跳过 ${result.rejected}`,
      result,
      state: await getState(),
    });
  }

  if (req.method === 'POST' && (url.pathname === '/api/sync/netease' || url.pathname === '/api/sync/write')) {
    const body = await readJsonBody(req);
    const target = normalizeSyncTarget(body.target);
    const label = platformLabel(target);
    startSyncProgress(body.dryRun ? `${label} Dry-run` : `写入${label}歌单`, '重新校验写入计划');
    const result = await runPlatformWrite({
      target,
      playlistId: body.playlistId,
      playlistName: body.playlistName,
      privacy: body.privacy,
      dryRun: body.dryRun,
      limit: body.limit,
      offset: body.offset,
      minScore: body.minScore,
      reviewScore: body.reviewScore,
      searchLimit: body.searchLimit,
      batchSize: body.batchSize,
      onProgress: (progress) => updateSyncProgress({
        phase: '重新校验写入计划',
        ...progress,
      }),
    });
    finishSyncProgress({
      done: result.plan?.items?.length || 0,
      total: result.plan?.items?.length || 0,
    });
    return sendJson(res, 200, {
      ok: true,
      message: writeRunMessage(result),
      result,
      state: await getState(),
    });
  }

  return sendJson(res, 404, { ok: false, error: 'API not found' });
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method not allowed');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }

  if (pathname === '/workbench' || pathname.startsWith('/workbench/')) {
    return serveLegacyWorkbench(req, res, pathname);
  }

  if (LEGACY_ASSET_PATHS.has(pathname)) {
    return serveLegacyStatic(req, res, pathname);
  }

  if (pathname === '/app' || pathname.startsWith('/app/')) {
    return serveReactApp(req, res, pathname, { basePath: '/app' });
  }

  return serveReactApp(req, res, pathname, { basePath: '' });
}

async function serveLegacyWorkbench(req, res, pathname) {
  const appPath = pathname === '/workbench' || pathname === '/workbench/'
    ? '/index.html'
    : pathname.slice('/workbench'.length) || '/index.html';
  return serveLegacyStatic(req, res, appPath);
}

async function serveLegacyStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(WEB_DIR, `.${pathname}`);
  const relative = path.relative(WEB_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return sendText(res, 403, 'Forbidden');
  }

  if (!(await pathExists(filePath))) {
    return sendText(res, 404, 'Not found');
  }

  const ext = path.extname(filePath);
  const body = await fs.readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  return res.end(body);
}

async function serveReactApp(req, res, pathname, options = {}) {
  if (!(await pathExists(WEB_APP_DIST_DIR))) {
    return sendText(res, 404, 'React app build not found. Run npm run check:web-app first.');
  }

  const basePath = options.basePath || '';
  const appPath = basePath
    ? (pathname === basePath || pathname === `${basePath}/` ? '/index.html' : pathname.slice(basePath.length))
    : (pathname === '/' || pathname === '/index.html' ? '/index.html' : pathname);
  let filePath = path.resolve(WEB_APP_DIST_DIR, `.${appPath}`);
  const relative = path.relative(WEB_APP_DIST_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return sendText(res, 403, 'Forbidden');
  }

  if (!(await pathExists(filePath)) && path.extname(appPath)) {
    return sendText(res, 404, 'Not found');
  }
  if (!(await pathExists(filePath))) {
    filePath = path.join(WEB_APP_DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const body = await fs.readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  return res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 25 * 1024 * 1024) throw httpError(413, '请求体过大');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, '请求体不是有效 JSON');
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.httpStatus = status;
  return error;
}

async function readSavedAppleSourceUrl() {
  try {
    const snapshot = JSON.parse(await fs.readFile(FILES.appleJson, 'utf8'));
    const source = String(snapshot?.source || '').trim();
    return /^https:\/\/music\.apple\.com\//iu.test(source) ? source : '';
  } catch {
    return '';
  }
}

async function completeAppleBrowserConnection(status) {
  const capture = await captureAppleMusicPage({
    playlistId: status.playlistId,
    playlistType: status.playlistType,
    sourceUrl: status.sourceUrl,
  });
  const apple = await importAppleRows(capture.tracks, capture.source || 'apple-browser');
  const connectedStatus = {
    code: 'connected',
    message: `Apple Music 已连接，读取 ${apple.tracks.length} 首喜爱歌曲。`,
    done: true,
    waiting: false,
    count: apple.tracks.length,
  };
  return {
    message: connectedStatus.message,
    status: connectedStatus,
  };
}

function publicAppleConnectionStatus(status = {}) {
  return {
    code: String(status.code || 'unknown'),
    message: String(status.message || ''),
    done: false,
    waiting: Boolean(status.waiting),
    count: 0,
  };
}

function publicQQConnectionStatus(status = {}) {
  return {
    code: String(status.code || 'unknown'),
    message: String(status.message || ''),
    done: Boolean(status.done),
    waiting: Boolean(status.waiting),
  };
}

function summarizeSnapshots(snapshots) {
  return Object.fromEntries(
    Object.entries(snapshots).map(([platform, snapshot]) => [platform, {
      skipped: Boolean(snapshot.skipped),
      reason: snapshot.reason || '',
      count: snapshot.tracks?.length || 0,
    }]),
  );
}

function writePlanMessage(plan) {
  const summary = plan?.summary || {};
  const label = platformLabel(plan?.target || 'netease');
  if (summary.rate_limited || summary.deferred) {
    return `${label}搜索触发频控：已暂停，待重试 ${summary.deferred || 0} 条`;
  }
  const blocked = (summary.needs_review || 0) + (summary.excluded_by_decision || 0);
  const blockedText = blocked ? `，待决定 ${blocked} 条` : '';
  return plan?.resolve
    ? `写入计划已解析：可写入 ${(summary.ready || 0) + (summary.accepted || 0)} 条，已存在 ${summary.already_present || 0} 条${blockedText}`
    : `写入计划已生成：待同步 ${plan?.totalQueue || 0} 条`;
}

function writeRunMessage(result) {
  const summary = result?.plan?.summary || {};
  const label = platformLabel(result?.target || result?.plan?.target || 'netease');
  if (summary.rate_limited || summary.deferred) {
    return `${label}搜索触发频控：本次已暂停，待重试 ${summary.deferred || 0} 条`;
  }
  if (result?.dryRun) {
    return `${label} dry-run 完成：可写入 ${result.add.requested || 0} 首`;
  }
  const requested = result.add?.requested || 0;
  const added = result.add?.added || 0;
  const already = result.add?.alreadyPresent || result.add?.alreadyPresentBefore || 0;
  const missing = result.add?.missingIds?.length || 0;
  const pieces = [`新增 ${added} 首`];
  if (already) pieces.push(`已存在 ${already} 首`);
  if (missing) pieces.push(`被平台过滤 ${missing} 首`);
  pieces.push(`请求 ${requested} 首`);
  return `${label}写入完成：${pieces.join(' / ')}`;
}

function mirrorRunMessage(result) {
  const label = platformLabel(result?.target || 'qq');
  const add = result?.add || {};
  const remove = result?.remove || {};
  const blocked = result?.blocked || {};
  if (result?.skipped && result?.status === 'duplicate') {
    return `${label}镜像执行已跳过：相同幂等键的执行已完成（${result.duplicateOf || result.runId || 'existing run'}）`;
  }
  if (result?.dryRun) {
    return `${label}镜像 dry-run：待新增 ${add.requested || 0}（可执行 ${add.executable || 0} / 未解析 ${add.blocked || 0}），待删除 ${remove.executable || 0}，待判断 ${result.review?.blocked || 0}`;
  }
  const resumeText = result?.resumed ? '（已从中断 checkpoint 续跑）' : '';
  return `${label}镜像执行完成${resumeText}：新增 ${result.addResult?.added || 0} / 删除 ${result.removeResult?.removed || 0}，未解析新增 ${blocked.unresolvedAdds || 0}，待判断 ${blocked.reviewItems || 0}`;
}

function mirrorDecisionMessage(action) {
  if (action === 'clear') return '镜像复核选择已清除，计划已重建';
  if (action === 'keep') return '镜像复核选择已保存：视为同一首，计划已重建';
  if (action === 'separate') return '镜像复核选择已保存：视为不同曲目，计划已重建';
  return '镜像复核选择已保存，计划已重建';
}

function mirrorDecisionBatchMessage(result = {}) {
  const actionText = result.action === 'clear'
    ? '清除复核'
    : result.action === 'keep'
      ? '视为同一首'
      : '视为不同曲目';
  return `批量镜像复核已处理：${actionText} ${result.changed || 0} / ${result.requested || 0} 条，计划已重建`;
}

function mirrorConvergenceMessage(convergence = {}) {
  if (convergence.converged) {
    return convergence.refreshedTarget
      ? '收敛检查通过：刷新目标快照后没有新增、删除或待判断项'
      : '收敛检查通过：当前本地快照没有新增、删除或待判断项';
  }
  return `收敛检查未通过：新增 ${convergence.add || 0} / 删除 ${convergence.remove || 0} / 待判断 ${convergence.review || 0}`;
}

function normalizeMirrorTarget(target) {
  const value = String(target || 'qq').trim();
  if (value === 'qq' || value === 'netease') return value;
  throw new Error('Apple 可信源镜像同步目前只支持 QQ 音乐或网易云目标');
}

function normalizeSyncTarget(target) {
  const value = String(target || 'netease').trim();
  if (value === 'qq' || value === 'netease' || value === 'apple') return value;
  throw new Error('当前只支持写入 Apple Music、QQ 音乐或网易云');
}

function platformLabel(target) {
  if (target === 'apple') return 'Apple Music';
  return target === 'qq' ? 'QQ 音乐' : '网易云';
}

function startSyncProgress(title, phase) {
  const now = new Date().toISOString();
  syncProgress = {
    active: true,
    title,
    phase,
    done: 0,
    total: 0,
    current: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: '',
    error: '',
  };
}

function updateSyncProgress(progress = {}) {
  syncProgress = {
    ...syncProgress,
    ...progress,
    active: true,
    updatedAt: new Date().toISOString(),
  };
}

function finishSyncProgress(progress = {}) {
  const now = new Date().toISOString();
  syncProgress = {
    ...syncProgress,
    ...progress,
    active: false,
    updatedAt: now,
    finishedAt: now,
  };
}

function sendJson(res, status, payload) {
  return sendText(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  return res.end(text);
}

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
