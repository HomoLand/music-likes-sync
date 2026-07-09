import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, ensureDirs } from './utils.js';

const DEFAULT_QQ_URL = 'https://y.qq.com/';
const DEBUG_PORT = Number(process.env.QQ_EDGE_PORT || 9324);
const EDGE_PROFILE_DIR = path.join(DATA_DIR, 'qq-edge-profile');
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

let edgeProcess = null;

export async function openQQMusicBrowser(url = DEFAULT_QQ_URL) {
  await ensureDirs();
  const targetUrl = normalizeQQUrl(url);
  if (!(await isDebuggerReady())) {
    const edgePath = await findEdgePath();
    await fs.mkdir(EDGE_PROFILE_DIR, { recursive: true });
    edgeProcess = spawn(edgePath, [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${EDGE_PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      targetUrl,
    ], {
      detached: true,
      stdio: 'ignore',
    });
    edgeProcess.unref();
    await waitForDebugger();
  } else {
    await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' }).catch(() => null);
  }

  return {
    url: targetUrl,
    port: DEBUG_PORT,
    profileDir: EDGE_PROFILE_DIR,
  };
}

export async function captureQQMusicCookies() {
  if (!(await isDebuggerReady())) {
    throw new Error('QQ 登录窗口还没有启动，请先点击“打开 QQ 登录页”。');
  }

  const tabs = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = tabs.find((item) => item.type === 'page' && /(^|\.)qq\.com/i.test(new URL(item.url || 'about:blank').hostname))
    || tabs.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('没有找到可抓取的 QQ 音乐页面。请确认专用 Edge 窗口还开着。');
  }

  let cookies = [];
  try {
    const result = await callCdp(page.webSocketDebuggerUrl, 'Network.getAllCookies', {}, 15000);
    cookies = result?.cookies || [];
  } catch {
    const result = await callCdp(page.webSocketDebuggerUrl, 'Storage.getCookies', {}, 15000);
    cookies = result?.cookies || [];
  }

  const qqCookies = cookies
    .filter((cookie) => isQQCookie(cookie))
    .sort((a, b) => cookiePriority(a.name) - cookiePriority(b.name) || a.name.localeCompare(b.name));
  if (!qqCookies.length) {
    throw new Error('没有在 QQ 登录窗口里抓到 qq.com cookie。请先在打开的 QQ 音乐窗口完成登录。');
  }

  const cookie = qqCookies.map((item) => `${item.name}=${item.value}`).join('; ');
  const names = qqCookies.map((item) => item.name);
  const hasUin = names.includes('uin') || names.includes('wxuin');
  const hasKey = names.includes('qm_keyst') || names.includes('qqmusic_key') || names.includes('p_skey');
  if (!hasUin || !hasKey) {
    throw new Error('抓到了 QQ Cookie，但缺少 uin/wxuin 或登录 key。请确认 QQ 音乐页面已经登录完成后再抓取。');
  }

  return {
    cookie,
    url: page.url,
    count: qqCookies.length,
    names,
    hasUin,
    hasKey,
  };
}

export async function checkQQMusicBrowserLogin() {
  if (!(await isDebuggerReady())) {
    return {
      done: false,
      waiting: true,
      code: 'browser_not_ready',
      message: 'QQ 登录窗口未启动或已关闭，请重新开始 QQ 扫码登录。',
    };
  }

  try {
    const capture = await captureQQMusicCookies();
    return {
      done: true,
      waiting: false,
      code: 'cookie_ready',
      message: 'QQ 登录成功，Cookie 已就绪。',
      capture,
    };
  } catch (error) {
    const message = error.message || String(error);
    if (isWaitingForQQLogin(message)) {
      return {
        done: false,
        waiting: true,
        code: 'waiting_for_login',
        message: qqLoginWaitingMessage(message),
      };
    }

    return {
      done: false,
      waiting: false,
      code: 'login_check_failed',
      message,
    };
  }
}

async function findEdgePath() {
  for (const candidate of EDGE_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next common install path.
    }
  }
  throw new Error('没有找到 Microsoft Edge，请确认 Edge 安装在默认路径。');
}

function normalizeQQUrl(url) {
  const value = String(url || '').trim() || DEFAULT_QQ_URL;
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || !/(^|\.)qq\.com$/i.test(parsed.hostname)) {
    throw new Error('请输入 https://y.qq.com/ 开头的 QQ 音乐链接');
  }
  return parsed.href;
}

async function isDebuggerReady() {
  try {
    const version = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    return Boolean(version?.webSocketDebuggerUrl || version?.Browser);
  } catch {
    return false;
  }
}

async function waitForDebugger() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (await isDebuggerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Edge 已启动，但调试端口没有就绪，请稍后再试。');
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function callCdp(webSocketUrl, method, params = {}, timeout = 15000) {
  if (typeof WebSocket !== 'function') {
    throw new Error('当前 Node.js 不支持 WebSocket，无法连接 Edge 调试端口。');
  }

  const ws = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    const entry = pending.get(payload.id);
    if (!entry) return;
    pending.delete(payload.id);
    if (payload.error) {
      entry.reject(new Error(payload.error.message || `${method} failed`));
      return;
    }
    entry.resolve(payload.result);
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const response = await new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timeout`));
    }, timeout);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

  ws.close();
  return response;
}

function isQQCookie(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  return domain === 'qq.com' || domain.endsWith('.qq.com');
}

function cookiePriority(name) {
  if (name === 'uin' || name === 'wxuin') return 0;
  if (name === 'qm_keyst' || name === 'qqmusic_key') return 1;
  if (name === 'p_skey') return 2;
  return 10;
}

function isWaitingForQQLogin(message) {
  return /登录窗口|没有找到可抓取|没有在 QQ 登录窗口|缺少 uin\/wxuin|登录 key|完成登录/u.test(message);
}

function qqLoginWaitingMessage(message) {
  if (/缺少 uin\/wxuin|登录 key/u.test(message)) {
    return '已检测到 QQ 页面 Cookie，但还缺少写入所需登录凭据；请确认手机端已允许登录并等待页面完成跳转。';
  }
  if (/没有在 QQ 登录窗口/u.test(message)) {
    return '等待 QQ 音乐登录。请在打开的 QQ 音乐窗口中扫码并确认。';
  }
  return message || '等待 QQ 音乐登录。';
}
