import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AuthSessionStore } from './auth-session.js';
import { DATA_DIR, ensureDirs } from './utils.js';

const DEFAULT_QQ_URL = 'https://y.qq.com/';
const DEBUG_PORT = Number(process.env.QQ_EDGE_PORT || 9324);
const EDGE_PROFILE_DIR = path.join(DATA_DIR, 'qq-edge-profile');
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const QR_SESSION_TTL_MS = 2 * 60 * 1000;

let edgeProcess = null;
const authSessions = new AuthSessionStore();

export async function openQQMusicBrowser(url = DEFAULT_QQ_URL) {
  return openQQMusicQuickLogin(url);
}

export async function openQQMusicQuickLogin(url = DEFAULT_QQ_URL) {
  const browser = await ensureQQMusicBrowser(url, { headless: false, replaceMode: true });
  const page = await ensureQQMusicPage(browser.url, { reload: true });
  await openQQLoginPanel(page).catch(() => null);
  return browser;
}

export async function startQQMusicQrLogin(options = {}) {
  const browser = await ensureQQMusicBrowser(DEFAULT_QQ_URL, { headless: true, replaceMode: true });
  let page = await ensureQQMusicPage(browser.url, { reload: true });
  if (options.force !== true) {
    try {
      const capture = await captureQQMusicCookies();
      return {
        done: true,
        waiting: false,
        code: 'cookie_ready',
        message: 'QQ 音乐仍处于登录状态，已自动续用。',
        capture,
      };
    } catch {
      // Continue into Tencent's official login flow.
    }
  } else {
    await callCdp(page.webSocketDebuggerUrl, 'Network.clearBrowserCookies', {}, 10000);
    page = await ensureQQMusicPage(browser.url, { reload: true });
  }
  await openQQLoginPanel(page);

  const images = await waitForQQQrImages(page, 16000).catch(() => null);
  if (!images?.qq && !images?.wechat) {
    try {
      const capture = await captureQQMusicCookies();
      return {
        done: true,
        waiting: false,
        code: 'cookie_ready',
        message: 'QQ 音乐仍处于登录状态，已自动续用。',
        capture,
      };
    } catch {
      throw new Error('腾讯登录页没有生成二维码，请重新开始或使用本机快捷登录。');
    }
  }

  authSessions.clearPlatform('qq');
  const session = authSessions.create('qq', {
    methods: Object.keys(images).filter((key) => Boolean(images[key])),
  }, { ttlMs: QR_SESSION_TTL_MS });
  return {
    ...authSessions.toPublic(session),
    done: false,
    waiting: true,
    code: 'waiting_for_scan',
    message: '请用手机 QQ 或微信扫码，并在手机上确认登录。',
    images,
  };
}

export async function checkQQMusicQrLogin(key) {
  const session = authSessions.get(key, 'qq');
  if (!session) {
    return {
      done: false,
      waiting: false,
      code: 'qr_expired',
      message: '二维码已过期，请重新生成。',
    };
  }

  return checkQQMusicBrowserLogin();
}

export function completeQQMusicQrLogin(key) {
  return authSessions.delete(key);
}

export async function refreshQQMusicBrowserCredential() {
  try {
    await fs.access(EDGE_PROFILE_DIR);
  } catch {
    return null;
  }

  const browser = await ensureQQMusicBrowser(DEFAULT_QQ_URL, { headless: true, replaceMode: false });
  await ensureQQMusicPage(browser.url, { reload: true });
  await new Promise((resolve) => setTimeout(resolve, 1400));
  return captureQQMusicCookies();
}

async function ensureQQMusicBrowser(url, options = {}) {
  await ensureDirs();
  const targetUrl = normalizeQQUrl(url);
  const requestedHeadless = options.headless === true;
  if (await isDebuggerReady()) {
    const currentHeadless = await isHeadlessBrowser();
    if (currentHeadless !== requestedHeadless && options.replaceMode !== false) {
      await closeDebuggerBrowser();
    }
  }

  if (!(await isDebuggerReady())) {
    const edgePath = await findEdgePath();
    await fs.mkdir(EDGE_PROFILE_DIR, { recursive: true });
    const args = [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${EDGE_PROFILE_DIR}`,
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (requestedHeadless) args.push('--headless=new', '--window-size=1280,900');
    args.push(targetUrl);
    edgeProcess = spawn(edgePath, args, {
      detached: true,
      stdio: 'ignore',
    });
    edgeProcess.unref();
    await waitForDebugger();
  }

  return {
    url: targetUrl,
    port: DEBUG_PORT,
    profileDir: EDGE_PROFILE_DIR,
    mode: await isHeadlessBrowser() ? 'background' : 'visible',
  };
}

export async function captureQQMusicCookies() {
  if (!(await isDebuggerReady())) {
    throw new Error('QQ 登录窗口还没有启动，请先点击“打开 QQ 登录页”。');
  }

  const tabs = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = findQQPage(tabs) || tabs.find((item) => item.type === 'page');
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

async function ensureQQMusicPage(targetUrl, options = {}) {
  let tabs = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  let page = findQQPage(tabs);
  if (!page) {
    await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10000) {
      tabs = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      page = findQQPage(tabs);
      if (page) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } else if (options.reload) {
    await callCdp(page.webSocketDebuggerUrl, 'Page.navigate', { url: targetUrl }, 15000);
  }

  if (!page?.webSocketDebuggerUrl) throw new Error('QQ 音乐页面没有加载成功。');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const result = await callCdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    }, 5000).catch(() => null);
    if (result?.result?.value === 'complete' || result?.result?.value === 'interactive') break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return page;
}

async function openQQLoginPanel(page) {
  const expression = `(() => {
    const trigger = document.querySelector('.top_login__link');
    if (trigger) {
      trigger.click();
      return 'clicked';
    }
    return 'already_logged_in';
  })()`;
  const result = await callCdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  }, 10000);
  if (result?.result?.value === 'already_logged_in') return result.result.value;

  const startedAt = Date.now();
  while (Date.now() - startedAt < 12000) {
    const tree = await callCdp(page.webSocketDebuggerUrl, 'Page.getFrameTree', {}, 5000).catch(() => null);
    const urls = flattenFrameTree(tree?.frameTree).map((frame) => frame.url);
    if (urls.some((url) => /ptlogin2\.qq\.com|open\.weixin\.qq\.com/i.test(url))) return 'opened';
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return 'loading';
}

async function waitForQQQrImages(page, timeout) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeout) {
    last = await captureQQQrImages(page.webSocketDebuggerUrl).catch(() => null);
    if (last?.qq || last?.wechat) return last;
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  return last;
}

async function captureQQQrImages(webSocketDebuggerUrl) {
  const session = new CdpSession(webSocketDebuggerUrl);
  await session.open();
  try {
    await session.call('Runtime.enable');
    await session.call('Page.enable');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const tree = await session.call('Page.getFrameTree');
    const frames = flattenFrameTree(tree?.frameTree);
    const contexts = session.events
      .filter((event) => event.method === 'Runtime.executionContextCreated')
      .map((event) => event.params?.context)
      .filter(Boolean);
    const qq = await captureFrameQr(session, frames, contexts, 'xui.ptlogin2.qq.com', 'img.qrImg');
    const wechat = await captureFrameQr(session, frames, contexts, 'open.weixin.qq.com', 'img.js_qrcode_img');
    return { ...(qq ? { qq } : {}), ...(wechat ? { wechat } : {}) };
  } finally {
    session.close();
  }
}

async function captureFrameQr(session, frames, contexts, hostname, selector) {
  const frame = frames.find((candidate) => {
    try {
      return new URL(candidate.url).hostname === hostname;
    } catch {
      return false;
    }
  });
  const context = contexts.find((candidate) => (
    candidate.auxData?.frameId === frame?.id && candidate.auxData?.isDefault === true
  ));
  if (!context) return '';

  const expression = `(() => {
    const image = document.querySelector(${JSON.stringify(selector)});
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return '';
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  })()`;
  const result = await session.call('Runtime.evaluate', {
    expression,
    contextId: context.id,
    returnByValue: true,
  });
  const image = String(result?.result?.value || '');
  return image.startsWith('data:image/png;base64,') && image.length > 500 ? image : '';
}

function flattenFrameTree(frameTree, result = []) {
  if (!frameTree?.frame) return result;
  result.push({ id: frameTree.frame.id, url: frameTree.frame.url || '' });
  for (const child of frameTree.childFrames || []) flattenFrameTree(child, result);
  return result;
}

function findQQPage(tabs) {
  return tabs.find((item) => {
    if (item.type !== 'page') return false;
    try {
      const hostname = new URL(item.url || 'about:blank').hostname;
      return hostname === 'y.qq.com' || hostname.endsWith('.y.qq.com');
    } catch {
      return false;
    }
  });
}

async function closeDebuggerBrowser() {
  const version = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  if (version?.webSocketDebuggerUrl) {
    await callCdp(version.webSocketDebuggerUrl, 'Browser.close', {}, 5000).catch(() => null);
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    if (!(await isDebuggerReady())) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('QQ 登录会话正在关闭，请稍后重试。');
}

async function isHeadlessBrowser() {
  try {
    const version = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    return /HeadlessChrome/i.test(String(version?.['User-Agent'] || ''));
  } catch {
    return false;
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

class CdpSession {
  constructor(webSocketUrl, timeout = 15000) {
    this.webSocketUrl = webSocketUrl;
    this.timeout = timeout;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    this.ws = new WebSocket(this.webSocketUrl);
    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id) {
        this.events.push(payload);
        return;
      }
      const entry = this.pending.get(payload.id);
      if (!entry) return;
      this.pending.delete(payload.id);
      clearTimeout(entry.timer);
      if (payload.error) entry.reject(new Error(payload.error.message || 'CDP command failed'));
      else entry.resolve(payload.result);
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CDP session closed'));
    }
    this.pending.clear();
    this.ws?.close();
  }
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
