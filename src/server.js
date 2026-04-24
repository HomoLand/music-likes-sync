#!/usr/bin/env node
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
  saveUnifiedDecision,
} from './workflow.js';
import { captureAppleMusicPage, openAppleMusicBrowser } from './apple-edge.js';
import { captureQQMusicCookies, openQQMusicBrowser } from './qq-edge.js';
import { WEB_DIR, ensureDirs, pathExists } from './utils.js';

const PORT = Number(process.env.PORT || process.argv[2] || 4319);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

await ensureDirs();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(req, res, url);
    }

    return serveStatic(req, res, url);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error?.message || String(error),
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`music-likes-sync web UI: http://127.0.0.1:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, { ok: true, state: await getState() });
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

  if (req.method === 'POST' && url.pathname === '/api/qq/browser/open') {
    const browser = await openQQMusicBrowser();
    return sendJson(res, 200, {
      ok: true,
      message: 'QQ 音乐登录窗口已打开。登录完成后回到这里点“抓取 QQ Cookie”。',
      browser,
      state: await getState(),
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
      dryRun: body.dryRun,
    });
    return sendJson(res, 200, {
      ok: true,
      message: result.dryRun ? 'AI dry-run 已生成' : `AI 建议已生成：${result.decisions.length} 条`,
      result: {
        dryRun: result.dryRun,
        batchId: result.batchId || result.batch?.batch_id,
        model: result.model,
        itemCount: result.itemCount || result.batch?.items?.length || 0,
        decisionCount: result.decisions.length,
      },
      state: await getState(),
    });
  }

  return sendJson(res, 404, { ok: false, error: 'API not found' });
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method not allowed');
  }

  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(WEB_DIR, `.${pathname}`);
  if (!filePath.startsWith(WEB_DIR)) {
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

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 25 * 1024 * 1024) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
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

function sendJson(res, status, payload) {
  return sendText(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
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
