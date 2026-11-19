#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(readArg('--port') || process.env.PORT || 0) || await pickFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const browserPath = readArg('--browser') || process.env.MUSIC_LIKES_SYNC_BROWSER_PATH || findLocalBrowser();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-sync-react-ui-smoke-'));

await seedReactAppFixtures(tempRoot);

execSync('npm run check:web-app', {
  cwd: ROOT,
  stdio: 'pipe',
  env: {
    ...process.env,
    NO_UPDATE_NOTIFIER: '1',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  },
  windowsHide: true,
});

const child = spawn(process.execPath, ['src/server.js', String(port)], {
  cwd: ROOT,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    MUSIC_LIKES_SYNC_HOME: tempRoot,
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
  await resetReactAppFixtures(tempRoot);
  results.push(await runViewportSmoke(browser, {
    name: 'desktop',
    viewport: { width: 1440, height: 1000 },
  }));
  await resetReactAppFixtures(tempRoot);
  results.push(await runViewportSmoke(browser, {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
  }));

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    runtimeRoot: tempRoot,
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
  await context.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() { return this.__testPlaying !== true; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() { return this.__testCurrentTime || 0; },
      set(value) { this.__testCurrentTime = Number(value) || 0; },
    });
    HTMLMediaElement.prototype.play = function play() {
      this.__testPlaying = true;
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      this.__testPlaying = false;
    };
  });
  const page = await context.newPage();
  const problems = [];
  const apiCalls = new Set();
  const expectedClientErrorPaths = new Set(['/api/qq/playlists', '/api/sync/convergence']);
  const qrFixture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlS7gAAAABJRU5ErkJggg==';
  let mockConnectedQqPlaylists = false;

  await page.route('https://api.github.com/repos/HomoLand/music-likes-sync/releases/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/HomoLand/music-likes-sync/releases/tag/v0.2.0',
      }),
    });
  });

  await page.route('**/api/apple/connect/start', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        message: '请在 Apple 官方窗口完成登录；登录成功后会自动继续。',
        status: {
          code: 'waiting_for_login',
          message: '请在 Apple 官方窗口完成登录；登录成功后会自动继续。',
          done: false,
          waiting: true,
          count: 0,
        },
      }),
    });
  });

  await page.route('**/api/apple/connect/check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        message: '等待 Apple 登录。',
        status: { code: 'waiting_for_login', message: '等待 Apple 登录。', done: false, waiting: true, count: 0 },
      }),
    });
  });

  await page.route('**/api/qq/qr/start', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        message: '请用手机 QQ 或微信扫码，并在手机上确认登录。',
        status: { code: 'waiting_for_scan', message: '等待手机确认。', done: false, waiting: true },
        qr: {
          key: 'fixture-qq-qr-session',
          images: { qq: qrFixture, wechat: qrFixture },
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      }),
    });
  });

  await page.route('**/api/qq/qr/check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        message: '等待手机确认。',
        status: { code: 'waiting_for_scan', message: '等待手机确认。', done: false, waiting: true },
      }),
    });
  });

  await page.route('**/api/qq/playlists', async (route) => {
    if (!mockConnectedQqPlaylists) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        message: '已读取 QQ 歌单：1 个',
        playlists: [{
          index: 0,
          name: '我喜欢',
          dirid: '201',
          tid: 'fixture-liked-tid',
          dissid: '',
          id: '201',
          songCount: 38,
          listenCount: 0,
          isLiked: true,
        }],
      }),
    });
  });

  await page.route('**/api/sync/media', async (route) => {
    const body = route.request().postDataJSON() || {};
    const platform = body.role === 'source' ? 'apple' : 'qq';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          previewId: body.previewId,
          operationId: body.operationId,
          role: body.role,
          alternativeIndex: body.alternativeIndex ?? null,
          track: {
            platform,
            id: `${platform}-media-fixture`,
            title: 'Real media fixture',
            artist: 'Fixture Artist',
            album: 'Fixture Album',
            durationMs: 180000,
            artworkUrl: `${baseUrl}/assets/music/platform-${platform}.webp`,
          },
          media: {
            artworkUrl: `${baseUrl}/assets/music/platform-${platform}.webp`,
            previewUrl: 'https://audio.example.test/preview.mp3',
            playable: true,
            reason: '',
            expiresAt: '2099-01-01T00:00:00.000Z',
            maxPreviewSeconds: 30,
            alignment: body.alignWithSource ? {
              status: 'aligned',
              method: 'chromaprint',
              confidence: 0.96,
              offsetFromSourceSeconds: 44.954,
              sourceStartSeconds: 0,
              targetStartSeconds: 44.954,
              overlapSeconds: 87.31,
              maxPreviewSeconds: 30,
              reason: '',
            } : null,
          },
        },
        warnings: [],
      }),
    });
  });

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
    if (status < 500 && expectedClientError(response.url(), expectedClientErrorPaths)) return;
    problems.push(`http ${status}: ${response.url()}`);
  });
  page.on('request', (request) => {
    try {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) apiCalls.add(pathname);
    } catch {
      // Ignore browser-internal requests.
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await expectVisible(page, '[data-testid="react-app-shell"]', 'React app shell');
    assert((await page.locator('aside nav button').count()) >= 7, 'React app should expose seven navigation items');
    await assertNoHorizontalOverflow(page, 'initial load');

    await page.getByTestId('react-nav-connect').click();
    await expectVisible(page, '[data-testid="react-connect-screen"]', 'platform connection screen');
    await expectVisible(page, '[data-testid="react-apple-connect"]', 'Apple Music one-time connection action');
    await expectVisible(page, '[data-testid="react-apple-import-trigger"]', 'Apple Music import action');
    await expectVisible(page, '[data-testid="react-qq-login"]', 'QQ Music guided login action');
    assert(await page.getByTestId('react-qq-playlists').count() === 0, 'QQ playlist action must stay hidden without a credential');
    await expectVisible(page, '[data-testid="react-netease-login"]', 'NetEase QR login action');
    await assertNoHorizontalOverflow(page, 'platform connection');

    await page.getByTestId('react-apple-connect').click();
    await expectVisible(page, '[data-testid="react-apple-login-status"]', 'Apple Music automatic login status');
    await expectVisibleText(page, '等待 Apple 登录', 'Apple Music automatic polling state');
    await page.getByTestId('react-connection-close').click();

    await page.getByTestId('react-qq-login').click();
    await expectVisible(page, '[data-testid="react-qq-qr-image"]', 'embedded QQ official-page QR image');
    await expectVisibleText(page, 'QQ 扫码', 'QQ QR method switch');
    await expectVisibleText(page, '微信扫码', 'WeChat QR method switch');
    await expectVisibleText(page, '使用本机快捷登录', 'Tencent local quick-login fallback');
    await assertNoHorizontalOverflow(page, 'QQ connection dialog');
    await page.getByTestId('react-connection-close').click();

    await fs.writeFile(path.join(tempRoot, 'data', 'qq.cookie'), 'fixture-credential-present', 'utf8');
    mockConnectedQqPlaylists = true;
    await page.reload({ waitUntil: 'networkidle' });
    await expectVisible(page, '[data-testid="react-connect-screen"]', 'connected platform screen');
    assert(await page.getByTestId('react-qq-login').count() === 0, 'QQ login action must stay hidden with a saved credential');
    await expectVisible(page, '[data-testid="react-qq-playlists"]', 'QQ Music playlist action with a saved credential');

    const qqPlaylistRead = waitForApi(page, '/api/qq/playlists');
    await page.getByTestId('react-qq-playlists').click();
    await qqPlaylistRead;
    await expectVisible(page, '[data-testid="react-qq-connected"]', 'QQ connected-state dialog');
    await expectVisible(page, '[data-testid="react-qq-playlist-list"]', 'QQ playlist list');
    assert(await page.getByTestId('react-qq-qr-image').count() === 0, 'QQ QR must not render with a saved credential');
    assert(await page.getByText('使用本机快捷登录', { exact: true }).count() === 0, 'QQ quick login must not render with a saved credential');
    await expectVisible(page, '[data-testid="react-qq-connection-check"]', 'QQ credential health check action');
    await assertNoHorizontalOverflow(page, 'QQ connected dialog');
    await page.getByTestId('react-connection-close').click();

    await fs.rm(path.join(tempRoot, 'data', 'qq.cookie'), { force: true });
    mockConnectedQqPlaylists = false;
    await page.reload({ waitUntil: 'networkidle' });
    await expectVisible(page, '[data-testid="react-connect-screen"]', 'reset platform connection screen');

    await page.getByTestId('react-nav-overview').click();
    await expectVisible(page, '[data-testid="react-run-sync-check"]', 'overview sync action');

    const syncCheck = waitForApi(page, '/api/sync/check');
    const previewFetch = waitForApi(page, '/api/sync/preview');
    await page.getByTestId('react-run-sync-check').click();
    await syncCheck;
    await previewFetch;
    await expectVisible(page, '[data-testid="react-preview-list"]', 'sync preview list');
    await expectVisible(page, '[data-testid="react-preview-pagination"]', 'sync preview pagination status');
    await expectVisible(page, '[data-testid="react-preview-bucket-not_found"]', 'not-found preview bucket');
    await expectVisible(page, '[data-testid="react-write-panel"]', 'controlled write panel');
    await expectVisible(page, '[data-testid="react-deletion-safety"]', 'pre-delete recovery controls');
    await expectVisible(page, '[data-testid="react-ai-review-additions"]', 'AI addition review draft action');
    const previewItems = await page.getByTestId('react-preview-item').count();
    assert(previewItems > 0, 'React preview should render fixture operations');
    await assertNoHorizontalOverflow(page, 'sync preview');

    const reviewPage = waitForApi(page, '/api/sync/preview');
    const mediaResolve = waitForApi(page, '/api/sync/media');
    await page.getByTestId('react-preview-bucket-needs_confirmation').click();
    await reviewPage;
    await mediaResolve;
    await expectVisible(page, '[data-testid="react-version-audition"]', 'version audition comparison');
    await expectVisibleText(page, '版本试听对比', 'version audition heading');
    const identityDecisionPanels = page.locator('.audition-decision');
    await identityDecisionPanels.first().waitFor({ state: 'visible', timeout: 15000 });
    assert(await identityDecisionPanels.count() > 0, 'platform-scoped identity decision controls should be visible');
    await expectVisibleText(page, '可以，保留', 'keep-existing-version decision action');
    await expectVisibleText(page, '不可以，替换', 'replace-with-Apple-version decision action');
    await expectVisibleText(page, '每个决定只影响它所在的平台', 'platform-scoped decision explanation');
    const auditionRows = await page.locator('.audition-row').count();
    assert(auditionRows >= 2, 'manual review should compare the source and at least one provider version');
    assert(await page.locator('.audition-audio').evaluate((audio) => audio.paused), 'version audition must not autoplay');
    const artworkSources = await page.locator('.audition-row .album-art img').evaluateAll((images) => images.map((image) => image.getAttribute('src') || ''));
    assert(artworkSources.length > 0, 'version audition should render resolved artwork');
    assert(artworkSources.every((src) => !src.includes('album-imagine') && !src.includes('album-get-lucky')), 'version audition must not use demo album covers');
    const auditionAudio = page.locator('.audition-audio');
    const auditionSourcePlay = page.locator('.audition-row').nth(0).locator('.audition-play');
    const auditionTargetPlay = page.locator('.audition-row').nth(1).locator('.audition-play');
    const auditionSourceTitle = (await page.locator('.audition-row').nth(0).locator('.audition-track-copy > strong').textContent())?.trim() || '';
    await auditionSourcePlay.click();
    await page.waitForFunction((title) => (
      document.querySelector('[data-testid="react-sidebar-player-title"]')?.textContent?.trim() === title
    ), auditionSourceTitle, { timeout: 10000 });
    assert(auditionSourceTitle && auditionSourceTitle !== 'Night Driver', 'sidebar player should use the real auditioned track');
    await auditionAudio.evaluate((audio) => { audio.currentTime = 8; });
    const alignedMediaResolve = page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/sync/media'
      && response.request().postDataJSON()?.alignWithSource === true
    ));
    await auditionTargetPlay.click();
    await alignedMediaResolve;
    const alignedStart = await auditionAudio.evaluate((audio) => audio.currentTime);
    assert(Math.abs(alignedStart - 52.954) < 0.001, `aligned A/B switch should preserve the musical position, got ${alignedStart}`);
    await expectVisibleText(page, '片段已对齐 96%', 'aligned audition status');
    await assertNoHorizontalOverflow(page, 'version audition');

    const mayDeletePage = waitForApi(page, '/api/sync/preview');
    await page.getByTestId('react-preview-bucket-may_delete').click();
    await mayDeletePage;
    const firstDeletePageItems = await page.getByTestId('react-preview-item').count();
    assert(firstDeletePageItems === 30, 'React preview should render the first 30 deletion items');
    await expectVisible(page, '[data-testid="react-preview-load-more"]', 'sync preview load-more action');
    const nextDeletePage = waitForApi(page, '/api/sync/preview');
    await page.getByTestId('react-preview-load-more').click();
    await nextDeletePage;
    await page.waitForFunction((previousCount) => (
      document.querySelectorAll('[data-testid="react-preview-item"]').length > previousCount
    ), firstDeletePageItems, { timeout: 10000 });
    const paginatedPreviewItems = await page.getByTestId('react-preview-item').count();
    assert(paginatedPreviewItems > firstDeletePageItems, 'React preview should append the next page');
    await assertNoHorizontalOverflow(page, 'paginated sync preview');

    const dryRunAdd = page.getByTestId('react-execute-additions-dry-run');
    const realAdd = page.getByTestId('react-execute-additions-write');
    const saveBaseline = page.getByTestId('react-save-baseline');
    const deleteInput = page.getByTestId('react-delete-confirm-text');
    const confirmDelete = page.getByTestId('react-confirm-deletions');
    const executeDelete = page.getByTestId('react-execute-deletions');
    assert(!(await dryRunAdd.isDisabled()), 'addition dry-run should be available after preview');
    assert(await realAdd.isDisabled(), 'real additions should stay disabled without live validation');
    assert(await saveBaseline.isDisabled(), 'baseline save should stay disabled before convergence');
    assert(await confirmDelete.isDisabled(), 'delete confirmation should require exact text');
    assert(await executeDelete.isDisabled(), 'real deletions should stay disabled before confirmation and live validation');

    await waitForEnabled(dryRunAdd, 'addition dry-run action');
    const realAddDisabled = await realAdd.isDisabled();
    const additionDryRun = waitForApi(page, '/api/sync/execute-additions');
    await dryRunAdd.click();
    await additionDryRun;

    await waitForEnabled(deleteInput, 'delete confirmation input');
    await deleteInput.fill('DELETE FROM SELECTED TARGETS');
    await waitForEnabled(confirmDelete, 'delete confirmation action');
    assert(!(await confirmDelete.isDisabled()), 'delete confirmation should unlock after exact text');
    const deletionConfirmation = waitForApi(page, '/api/sync/confirm-deletions');
    await confirmDelete.click();
    await deletionConfirmation;
    assert(await executeDelete.isDisabled(), 'real deletions should remain blocked without live validation');
    const realDeleteDisabled = await executeDelete.isDisabled();

    await waitForEnabled(page.getByTestId('react-check-convergence'), 'convergence check action');
    const convergenceCheck = waitForApi(page, '/api/sync/convergence', { requireOk: false });
    await page.getByTestId('react-check-convergence').click();
    const convergenceResponse = await convergenceCheck;
    assert(convergenceResponse.status() < 500, `convergence check should not fail with ${convergenceResponse.status()}`);

    await page.getByTestId('react-nav-ai').click();
    await expectVisible(page, '[data-testid="react-ai-screen"]', 'AI assistant screen');
    assert(await page.getByTestId('react-ai-model-profile').isDisabled(), 'model profile should require consent and provider configuration');
    await waitForEnabled(page.getByTestId('react-ai-local-profile'), 'local profile action');
    const profileRequest = waitForApi(page, '/api/ai/profile');
    await page.getByTestId('react-ai-local-profile').click();
    await profileRequest;
    await expectVisible(page, '[data-testid="react-ai-profile-result"]', 'local profile result');
    await page.getByPlaceholder('Night Drive').fill('Night Drive');
    await page.getByPlaceholder('Carol').fill('Carol');
    await waitForEnabled(page.getByTestId('react-ai-similar-search'), 'similar-track action');
    const similarRequest = waitForApi(page, '/api/ai/similar');
    await page.getByTestId('react-ai-similar-search').click();
    await similarRequest;
    await waitForEnabled(page.getByTestId('react-agent-chat-send'), 'Agent chat action');
    const agentChatRequest = waitForApi(page, '/api/agent/chat');
    await page.getByTestId('react-agent-chat-send').click();
    await agentChatRequest;
    await expectVisible(page, '[data-testid="react-agent-chat-result"]', 'Agent chat result');
    await expectVisibleText(page, 'Agent 回复', 'Agent chat result heading');
    await expectVisibleText(page, '查看复核队列', 'Agent chat routed review queue tool label');
    await waitForEnabled(page.getByTestId('react-agent-audit-refresh'), 'Agent audit refresh action');
    const agentAudit = waitForApi(page, '/api/agent/sessions');
    await page.getByTestId('react-agent-audit-refresh').click();
    await agentAudit;
    await expectVisibleText(page, '保存推荐草稿', 'Agent local shortlist draft trace');
    await expectVisibleText(page, '本地草稿', 'Agent local draft access label');
    await expectVisibleText(page, '只写本地草稿', 'Agent local draft non-provider pill');
    await expectVisibleText(page, '查看单曲证据', 'Agent track evidence trace');
    await expectVisibleText(page, '只读', 'Agent read-only access label');
    await expectVisibleText(page, '不写平台', 'Agent read-only non-provider pill');
    await assertNoHorizontalOverflow(page, 'AI assistant');

    await page.getByTestId('react-nav-automation').click();
    await expectVisible(page, '[data-testid="react-auto-sync-screen"]', 'auto-sync screen');
    await expectVisible(page, '[data-testid="react-auto-sync-readiness"]', 'auto-sync readiness gate');
    await expectVisible(page, '[data-testid="react-auto-sync-history"]', 'auto-sync history');
    await expectVisible(page, '[data-testid="react-auto-sync-save"]', 'auto-sync save action');
    await expectVisible(page, '[data-testid="react-auto-sync-check"]', 'auto-sync manual check action');
    await expectVisible(page, '[data-testid="react-auto-sync-run"]', 'auto-sync real run action');
    assert(await page.getByTestId('react-auto-sync-run').isDisabled(), 'real auto-sync run should stay disabled before readiness and enablement');
    await expectVisibleText(page, '同步基线', 'auto-sync baseline gate');
    await assertNoHorizontalOverflow(page, 'auto-sync');
    await assertAutoSyncFitsViewport(page);

    await page.getByTestId('react-nav-advanced').click();
    await expectVisible(page, '[data-testid="react-advanced-screen"]', 'advanced settings screen');
    await expectVisible(page, '[data-testid="react-open-compat-workbench"]', 'compatibility workbench action');
    await expectVisible(page, '[data-testid="react-live-validation-form"]', 'live validation form');
    const liveValidationRun = page.getByTestId('react-run-live-validation');
    assert(await liveValidationRun.isDisabled(), 'live validation run should start disabled');
    await page.getByTestId('react-live-validation-query').fill('fixture song');
    await page.getByTestId('react-live-validation-confirm').fill('wrong');
    assert(await liveValidationRun.isDisabled(), 'live validation run should require exact confirmation text');
    await page.getByTestId('react-live-validation-confirm').fill('DISPOSABLE_PLAYLIST');
    await waitForEnabled(liveValidationRun, 'live validation guarded run action');
    await waitForEnabled(page.getByTestId('react-refresh-diagnostics'), 'advanced diagnostics refresh action');
    const validationRequest = waitForApi(page, '/api/validation/live');
    await page.getByTestId('react-refresh-diagnostics').click();
    await validationRequest;
    await assertNoHorizontalOverflow(page, 'advanced settings');

    await page.getByTestId('react-open-help').click();
    await expectVisible(page, '[data-testid="react-help-screen"]', 'help and about screen');
    await expectVisibleText(page, '没有 Likes Sync 云端账号', 'local-only account explanation');
    await expectVisibleText(page, '当前版本 v0.1.0', 'current application version');
    await page.getByRole('button', { name: '检查新版本' }).click();
    await expectVisibleText(page, '发现新版本 v0.2.0', 'explicit release update check');
    assert(await page.getByLabel('用户').count() === 0, 'misleading product account avatar should not be rendered');
    await assertNoHorizontalOverflow(page, 'help and about');

    assert(problems.length === 0, `browser problems:\n${problems.join('\n')}`);
    return {
      name: options.name,
      viewport: options.viewport,
      navItems: await page.locator('aside nav button').count(),
      previewItems,
      paginatedPreviewItems,
      realAddDisabled,
      realDeleteDisabled,
      deletionSafety: true,
      apiCalls: [...apiCalls].sort(),
      horizontalOverflowPx: await horizontalOverflow(page),
    };
  } finally {
    await context.close();
  }
}

function waitForApi(page, pathname, options = {}) {
  const requireOk = options.requireOk !== false;
  return page.waitForResponse((response) => {
    try {
      return new URL(response.url()).pathname === pathname && (!requireOk || response.status() < 500);
    } catch {
      return false;
    }
  }, { timeout: 15000 });
}

async function expectVisible(page, selector, label) {
  const locator = page.locator(selector);
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  assert(await locator.isVisible(), `${label} should be visible`);
}

async function expectVisibleText(page, text, label) {
  const locator = page.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  assert(await locator.isVisible(), `${label} should be visible`);
}

async function waitForEnabled(locator, label) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    await locator.waitFor({ state: 'visible', timeout: 15000 });
    if (!(await locator.isDisabled())) return;
    await sleep(100);
  }
  throw new Error(`${label} should become enabled`);
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await horizontalOverflow(page);
  const offenders = await horizontalOverflowOffenders(page);
  if (overflow <= 1 && offenders.length === 0) return;
  assert(false, `${label} should not overflow horizontally, got ${overflow}px. offenders=${JSON.stringify(offenders)}`);
}

async function assertAutoSyncFitsViewport(page) {
  const result = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const selectors = [
      '[data-testid="react-auto-sync-screen"]',
      '[data-testid="react-auto-sync-save"]',
      '[data-testid="react-auto-sync-check"]',
      '[data-testid="react-auto-sync-run"]',
      '[data-testid="react-auto-sync-readiness"]',
      '[data-testid="react-auto-sync-history"]',
      '.page-title-block .status-pill',
      '.automation-delete-guard',
    ];
    const items = selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return { selector, missing: true };
      const rect = element.getBoundingClientRect();
      return {
        selector,
        missing: false,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });
    return {
      viewport,
      items,
      problems: items.filter((item) => item.missing
        || item.left < -1
        || item.right > viewport + 1
        || item.scrollWidth > item.clientWidth + 1),
    };
  });
  assert(result.problems.length === 0, `auto-sync controls should fit the viewport: ${JSON.stringify(result)}`);
}

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return Math.max(
      0,
      doc.scrollWidth - doc.clientWidth,
      body ? body.scrollWidth - body.clientWidth : 0,
    );
  });
}

async function horizontalOverflowOffenders(page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const insideHorizontalScroller = (element) => {
      let current = element.parentElement;
      while (current && current !== document.body) {
        const overflowX = getComputedStyle(current).overflowX;
        if (['auto', 'scroll'].includes(overflowX) && current.scrollWidth > current.clientWidth + 1) return true;
        current = current.parentElement;
      }
      return false;
    };
    return [...document.querySelectorAll('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.getAttribute('class') || ''),
          testId: String(element.getAttribute('data-testid') || ''),
          text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          overflowRight: Math.round(rect.right - viewport),
          insideHorizontalScroller: insideHorizontalScroller(element),
        };
      })
      .filter((item) => !item.insideHorizontalScroller && (item.overflowRight > 1 || item.left < -1))
      .sort((left, right) => right.overflowRight - left.overflowRight)
      .slice(0, 8);
  });
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with ${child.exitCode}\nstdout:\n${tail(stdout)}\nstderr:\n${tail(stderr)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/state`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Server did not become ready\nstdout:\n${tail(stdout)}\nstderr:\n${tail(stderr)}`);
}

async function seedReactAppFixtures(root) {
  const dataDir = path.join(root, 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'apple.json'), JSON.stringify(snapshot('apple', [
    track('a-1', 'Already There', 'Alice', 180000),
    track('a-2', 'New Day', 'Bob', 210000),
    track('a-3', 'Night Drive', 'Carol', 180000),
  ])), 'utf8');
  await fs.writeFile(path.join(dataDir, 'netease.json'), JSON.stringify(snapshot('netease', [
    track('n-1', 'Already There', 'Alice', 181000),
    track('n-2', 'Old Target Only', 'Dora', 200000),
    track('n-3', 'Night Drive Acoustic', 'Carol', 190000),
    ...Array.from({ length: 35 }, (_, index) => track(`n-page-${index}`, `NetEase Page Fixture ${index}`, 'Page Artist', 200000 + index)),
  ])), 'utf8');
  await fs.writeFile(path.join(dataDir, 'qq.json'), JSON.stringify(snapshot('qq', [
    track('q-1', 'Already There', 'Alice', 181000),
    qqMidOnlyTrack('qq-mid-old-target-only', 'Old Target Only', 'Dora', 200000),
    track('q-3', 'Night Drive Acoustic', 'Carol', 190000),
    ...Array.from({ length: 35 }, (_, index) => track(`q-page-${index}`, `QQ Page Fixture ${index}`, 'Page Artist', 210000 + index)),
  ])), 'utf8');
  await fs.writeFile(path.join(dataDir, 'agent-sessions.json'), JSON.stringify({
    version: 1,
    updatedAt: '2026-07-07T00:00:00.000Z',
    sessions: [
      {
        id: 'agent-session-react-ui-smoke',
        startedAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        toolTraces: [
          {
            id: 'trace-react-ui-shortlist',
            tool: 'save_local_shortlist',
            calledAt: '2026-07-07T00:00:00.000Z',
            source: 'mcp',
            status: 'completed',
            readOnly: false,
            localDraft: true,
            mutatesProvider: false,
            exposesCredentials: false,
            durationMs: 14,
            argumentsSummary: { limit: 3, shortlistNameProvided: true },
            resultSummary: { savedShortlist: { present: true, trackCount: 2 } },
            evidenceRefs: ['shortlist:react-ui-smoke'],
          },
          {
            id: 'trace-react-ui-track-evidence',
            tool: 'get_track_evidence',
            calledAt: '2026-07-07T00:01:00.000Z',
            source: 'mcp',
            status: 'completed',
            readOnly: true,
            localDraft: false,
            mutatesProvider: false,
            exposesCredentials: false,
            durationMs: 9,
            argumentsSummary: { bucket: 'will_add', operationIdProvided: false },
            resultSummary: {
              exists: true,
              bucket: 'will_add',
              hasSourceTrack: true,
              evidenceRefCount: 2,
              recommendedAction: 'execute_addition',
            },
            evidenceRefs: ['reason:missing_on_target', 'source_isrc'],
          },
        ],
      },
    ],
  }), 'utf8');
}

async function resetReactAppFixtures(root) {
  await fs.rm(path.join(root, 'data'), { recursive: true, force: true });
  await seedReactAppFixtures(root);
}

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:react-ui-smoke`,
    fetchedAt: '2026-07-07T00:00:00.000Z',
    skipped: false,
    tracks,
  };
}

function track(id, title, artist, durationMs) {
  return {
    id,
    title,
    artists: [artist],
    album: 'React UI Smoke Fixture',
    durationMs,
  };
}

function qqMidOnlyTrack(mid, title, artist, durationMs) {
  return {
    mid,
    title,
    artists: [artist],
    album: 'React UI Smoke Fixture',
    durationMs,
  };
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Unable to reserve a local port for React UI smoke.'));
      });
    });
  });
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
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || '';
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function ignoredMissingResource(url) {
  try {
    return new URL(url).pathname === '/favicon.ico';
  } catch {
    return false;
  }
}

function expectedClientError(url, expectedPaths) {
  try {
    return expectedPaths.has(new URL(url).pathname);
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

function tail(value) {
  return String(value || '').split(/\r?\n/u).filter(Boolean).slice(-20).join('\n');
}
