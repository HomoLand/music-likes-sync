import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, ensureDirs } from './utils.js';

const DEFAULT_APPLE_URL = 'https://music.apple.com/';
const DEBUG_PORT = Number(process.env.APPLE_EDGE_PORT || 9323);
const EDGE_PROFILE_DIR = path.join(DATA_DIR, 'apple-edge-profile');
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

let edgeProcess = null;

export function selectAppleFavoritePlaylist(items = []) {
  const normalizeName = (value) => String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s·・_\-]+/gu, ' ');
  const favoriteNames = new Set([
    'favorite songs',
    'favourite songs',
    '喜爱歌曲',
    '喜爱的歌曲',
    '我喜欢的歌曲',
    '喜欢的歌曲',
  ].map(normalizeName));

  const item = Array.isArray(items)
    ? items.find((candidate) => favoriteNames.has(normalizeName(candidate?.attributes?.name)))
    : null;
  if (!item?.id) return null;

  const catalog = item.relationships?.catalog?.data?.find((candidate) => candidate?.id)
    || item.relationships?.catalog?.data?.[0]
    || null;
  return {
    name: String(item.attributes?.name || 'Favorite Songs'),
    playlistId: String(item.id),
    playlistType: String(item.type || 'library-playlists'),
    catalogId: String(catalog?.id || item.attributes?.playParams?.catalogId || ''),
  };
}

export async function openAppleMusicBrowser(url = DEFAULT_APPLE_URL, options = {}) {
  await ensureDirs();
  const targetUrl = normalizeAppleUrl(url);
  const requestedHeadless = options.headless === true;
  await ensureBrowserMode(requestedHeadless);
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
  } else {
    await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' }).catch(() => null);
  }

  return {
    url: targetUrl,
    port: DEBUG_PORT,
    profileDir: EDGE_PROFILE_DIR,
    mode: await isHeadlessBrowser() ? 'background' : 'visible',
  };
}

export async function captureAppleMusicPage(options = {}) {
  if (!(await isDebuggerReady())) {
    throw new Error('Apple 登录窗口还没有启动，请先点击“打开 Apple 登录页”。');
  }

  const page = await findApplePage();
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('没有找到可抓取的 Apple Music 页面。请确认专用 Edge 窗口还开着。');
  }

  const scrapeOptions = {
    playlistId: String(options.playlistId || ''),
    playlistType: String(options.playlistType || ''),
  };
  const result = await evaluateCdp(
    page.webSocketDebuggerUrl,
    `(${scrapeAppleMusicPage.toString()})(${JSON.stringify(scrapeOptions)})`,
    240000,
  );
  if (!result?.tracks?.length) {
    throw new Error(result?.message || '当前页面没有抓到歌曲。请确认已经登录，并停留在 Apple Music 的“Favorite Songs / 我喜欢的歌曲”页面。');
  }

  return {
    ...result,
    source: normalizeOptionalAppleUrl(options.sourceUrl) || result.url || page.url,
  };
}

export async function checkAppleMusicBrowserConnection(options = {}) {
  if (!(await isDebuggerReady())) {
    return {
      ready: false,
      waiting: true,
      code: 'browser_not_ready',
      message: 'Apple 登录窗口未启动或已关闭，请重新连接。',
    };
  }

  const page = await findApplePage();
  if (!page?.webSocketDebuggerUrl) {
    return {
      ready: false,
      waiting: true,
      code: 'page_not_ready',
      message: '正在等待 Apple Music 页面加载。',
    };
  }

  const taskOptions = {
    sourceUrl: normalizeOptionalAppleUrl(options.sourceUrl),
  };
  try {
    return await evaluateCdp(
      page.webSocketDebuggerUrl,
      `(${inspectAppleMusicConnection.toString()})(${JSON.stringify(taskOptions)}, ${selectAppleFavoritePlaylist.toString()})`,
      60000,
    );
  } catch (error) {
    return {
      ready: false,
      waiting: false,
      code: 'connection_check_failed',
      message: error.message || String(error),
    };
  }
}

export async function runAppleMusicKitTask(task, args = {}, timeout = 120000) {
  if (!(await isDebuggerReady())) {
    await openAppleMusicBrowser();
  }
  const tabs = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = tabs.find((item) => item.type === 'page' && /music\.apple\.com/i.test(item.url))
    || tabs.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('No debuggable Apple Music page found. Open the Apple Music login window first.');
  }
  const expression = `(${task.toString()})(${JSON.stringify(args)})`;
  const result = await evaluateCdp(page.webSocketDebuggerUrl, expression, timeout);
  if (result?.error) throw new Error(result.error);
  return result;
}

async function findApplePage() {
  const tabs = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  return tabs.find((item) => item.type === 'page' && /music\.apple\.com/i.test(item.url))
    || tabs.find((item) => item.type === 'page');
}

async function ensureBrowserMode(requestedHeadless) {
  if (!(await isDebuggerReady())) return;
  const currentHeadless = await isHeadlessBrowser();
  if (currentHeadless === requestedHeadless) return;
  if (requestedHeadless && !currentHeadless) return;

  const version = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  if (version?.webSocketDebuggerUrl) {
    await sendCdpCommand(version.webSocketDebuggerUrl, 'Browser.close').catch(() => null);
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    if (!(await isDebuggerReady())) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Apple 后台登录会话正在关闭，请稍后重试。');
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
  throw new Error('没有找到 Microsoft Edge：请确认 Edge 安装在默认路径。');
}

function normalizeAppleUrl(url) {
  const value = String(url || '').trim() || DEFAULT_APPLE_URL;
  if (!/^https:\/\/music\.apple\.com\//i.test(value)) {
    throw new Error('请输入 https://music.apple.com/ 开头的 Apple Music 链接');
  }
  return value;
}

function normalizeOptionalAppleUrl(url) {
  const value = String(url || '').trim();
  return value ? normalizeAppleUrl(value) : '';
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

async function evaluateCdp(webSocketUrl, expression, timeout = 120000) {
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
      entry.reject(new Error(payload.error.message || 'CDP evaluate failed'));
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
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout,
      },
    }));
  });

  ws.close();
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Apple 页面脚本执行失败');
  }
  return response.result?.value;
}

async function sendCdpCommand(webSocketUrl, method, params = {}, timeout = 15000) {
  if (typeof WebSocket !== 'function') {
    throw new Error('当前 Node.js 不支持 WebSocket，无法连接 Edge 调试端口。');
  }

  const ws = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), timeout);
    ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== 1) return;
      clearTimeout(timer);
      if (payload.error) reject(new Error(payload.error.message || `${method} failed`));
      else resolve(payload.result);
    });
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  return response;
}

async function inspectAppleMusicConnection(options, selectFavoritePlaylist) {
  const musicKit = window.MusicKit?.getInstance?.();
  if (!musicKit?.api?.music) {
    return {
      ready: false,
      waiting: true,
      code: 'page_loading',
      message: '正在等待 Apple Music 页面加载。',
    };
  }

  if (!musicKit.isAuthorized && !musicKit.musicUserToken) {
    return {
      ready: false,
      waiting: true,
      code: 'waiting_for_login',
      message: '请在 Apple 官方窗口完成登录；登录成功后会自动继续。',
    };
  }

  let storefront = '';
  try {
    const response = await musicKit.api.music('/v1/me/storefront', { platform: 'web' });
    if (Number(response?.status || 200) >= 400) throw new Error(`HTTP ${response.status}`);
    storefront = response?.data?.data?.[0]?.id || response?.json?.data?.[0]?.id || '';
  } catch {
    return {
      ready: false,
      waiting: true,
      code: 'waiting_for_login',
      message: 'Apple 登录尚未完成，请在官方窗口继续。',
    };
  }

  try {
    let next = '/v1/me/library/playlists';
    let selected = null;
    let pageCount = 0;
    while (next && pageCount < 20 && !selected) {
      const parsed = new URL(next, location.origin);
      const params = {
        limit: 100,
        platform: 'web',
        include: 'catalog',
        ...Object.fromEntries(parsed.searchParams.entries()),
      };
      const response = await musicKit.api.music(parsed.pathname, params);
      if (Number(response?.status || 200) >= 400) throw new Error(`HTTP ${response.status}`);
      const payload = response?.data || response?.json || {};
      selected = selectFavoritePlaylist(payload.data || []);
      next = payload.next || payload.meta?.next || '';
      pageCount += 1;
    }

    const favoriteLink = Array.from(document.querySelectorAll('a[href*="/playlist/"]'))
      .find((link) => /favorite-songs/i.test(link.href)
        || /favorite songs|favourite songs|\u559c\u7231\u6b4c\u66f2|\u559c\u7231\u7684\u6b4c\u66f2|\u6211\u559c\u6b22\u7684\u6b4c\u66f2|\u559c\u6b22\u7684\u6b4c\u66f2/i.test(link.textContent || ''));
    const fallbackUrl = favoriteLink?.href || options?.sourceUrl || '';
    if (!selected && fallbackUrl) {
      const parsed = new URL(fallbackUrl, location.origin);
      const fallbackId = parsed.pathname.split('/').filter(Boolean).at(-1) || '';
      if (fallbackId) {
        selected = {
          name: 'Favorite Songs',
          playlistId: fallbackId,
          playlistType: 'playlists',
          catalogId: fallbackId,
        };
      }
    }

    if (!selected) {
      return {
        ready: false,
        waiting: false,
        code: 'favorite_songs_not_found',
        message: '已登录，但没有找到“喜爱歌曲”。请先在 Apple Music 中喜欢至少一首歌。',
      };
    }

    const sourceUrl = selected.catalogId && storefront
      ? `${location.origin}/${storefront}/playlist/favorite-songs/${selected.catalogId}`
      : fallbackUrl || location.href;
    return {
      ready: true,
      waiting: false,
      code: 'favorite_songs_ready',
      message: '已找到 Apple Music 的“喜爱歌曲”，正在读取。',
      playlistId: selected.playlistId,
      playlistType: selected.playlistType,
      sourceUrl,
    };
  } catch (error) {
    return {
      ready: false,
      waiting: false,
      code: 'playlist_lookup_failed',
      message: `读取 Apple Music 歌单失败：${error?.message || String(error)}`,
    };
  }
}

async function scrapeAppleMusicPage(options = {}) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const tracks = [];
  const seen = new Set();

  function addTrack(track) {
    const title = clean(track.title);
    const artists = Array.isArray(track.artists)
      ? track.artists.map(clean).filter(Boolean)
      : clean(track.artists || track.artist);
    const album = clean(track.album);
    if (!title || !artists || title.length > 160) return;

    const fallbackKey = `${title.toLowerCase()}::${Array.isArray(artists) ? artists.join(',').toLowerCase() : String(artists).toLowerCase()}`;
    const key = track.id ? `id:${track.id}` : fallbackKey;
    if (seen.has(key)) return;
    seen.add(key);
    tracks.push({
      id: track.id || key,
      title,
      artists,
      album,
      duration: clean(track.duration),
      isrc: clean(track.isrc),
      artworkUrl: clean(track.artworkUrl),
      previewUrl: clean(track.previewUrl),
      raw: track.raw || null,
    });
  }

  function getPlaylistId() {
    if (options.playlistId) return options.playlistId;
    const playlistPath = location.pathname.match(/\/playlist\/([^?#]+)/)?.[1] || '';
    const pathSegments = playlistPath.split('/').map((item) => item.trim()).filter(Boolean);
    const urlPlaylistId = pathSegments.findLast((item) => /^pl[.-]/i.test(item)) || pathSegments.at(-1);
    if (urlPlaylistId) return urlPlaylistId;

    const apiUrl = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /\/v1\/me\/library\/playlists\/[^/?#]+/.test(name));
    const apiMatch = apiUrl?.match(/\/v1\/me\/library\/playlists\/([^/?#]+)/);
    return apiMatch?.[1] || '';
  }

  function paramsFromUrl(url) {
    const parsed = new URL(url, location.origin);
    return {
      path: parsed.pathname,
      params: Object.fromEntries(parsed.searchParams.entries()),
    };
  }

  async function collectMusicKitApiTracks() {
    const musicKit = window.MusicKit?.getInstance?.();
    const playlistId = getPlaylistId();
    if (!musicKit?.api?.music || !playlistId) return false;

    async function resolveStorefront() {
      try {
        const response = await musicKit.api.music('/v1/me/storefront', { platform: 'web' });
        return response?.data?.data?.[0]?.id || response?.json?.data?.[0]?.id || '';
      } catch {
        return '';
      }
    }

    const baseParams = {
      'l': document.documentElement.lang || 'zh-Hans-CN',
      'platform': 'web',
      'include': 'catalog,artists',
      'include[songs]': 'artists',
      'fields[songs]': 'artistName,albumName,name,durationInMillis,isrc,url,artwork,previews',
      'format[resources]': 'map',
      'omit[resource]': 'autos',
    };
    const isCatalogPlaylist = options.playlistType === 'playlists'
      || (!options.playlistType && /^pl[.-]/i.test(playlistId));
    const storefront = isCatalogPlaylist
      ? await resolveStorefront() || musicKit.storefrontId || musicKit.storefront?.id || 'us'
      : '';
    let next = isCatalogPlaylist
      ? `/v1/catalog/${storefront}/playlists/${playlistId}/tracks`
      : `/v1/me/library/playlists/${playlistId}/tracks`;
    let pageCount = 0;

    while (next && pageCount < 200) {
      const { path, params } = paramsFromUrl(next);
      const response = await musicKit.api.music(path, { ...baseParams, ...params });
      if (Number(response?.status || 0) >= 400) return false;
      const payload = response?.data || response?.json || {};
      const resources = payload.resources || {};
      const stubs = payload.data || [];

      for (const stub of stubs) {
        const item = resources?.[stub.type]?.[stub.id] || stub;
        const attrs = item.attributes || {};
        const catalog = item.relationships?.catalog?.data?.[0];
        const catalogResource = catalog
          ? resources?.[catalog.type]?.[catalog.id] || resources?.songs?.[catalog.id]
          : null;
        const catalogAttrs = catalogResource?.attributes || {};
        const catalogId = attrs.playParams?.catalogId || catalog?.id || catalogResource?.id || '';
        const isrc = catalogAttrs.isrc || attrs.isrc || '';
        const artworkUrl = catalogAttrs.artwork?.url || attrs.artwork?.url || '';
        const previewUrl = catalogAttrs.previews?.[0]?.url || attrs.previews?.[0]?.url || '';
        addTrack({
          id: catalogId || item.id || stub.id,
          title: catalogAttrs.name || attrs.name,
          artists: catalogAttrs.artistName || attrs.artistName,
          album: catalogAttrs.albumName || attrs.albumName,
          duration: catalogAttrs.durationInMillis || attrs.durationInMillis,
          isrc,
          artworkUrl,
          previewUrl,
          raw: {
            id: item.id || stub.id,
            type: item.type || stub.type,
            catalogId,
            catalogType: catalog?.type || catalogResource?.type || '',
            catalogIsrc: isrc,
            url: catalogAttrs.url || '',
            artworkUrl,
            previewUrl,
          },
        });
      }

      pageCount += 1;
      next = payload.next || '';
      await sleep(120);
    }

    return tracks.length > 0;
  }

  function walkApplePayload(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walkApplePayload);
      return;
    }
    if (typeof value !== 'object') return;

    if (
      value.contentDescriptor?.kind === 'song'
      && value.title
      && (value.artistName || value.subtitleLinks?.length)
      && (String(value.id || '').startsWith('track-lockup') || value.layoutStyle?.kind === 'playlistTrackList')
    ) {
      addTrack({
        id: value.contentDescriptor?.identifiers?.storeAdamID || value.id || value.title,
        title: value.title,
        artists: value.subtitleLinks?.map((item) => item.title).filter(Boolean) || value.artistName,
        album: value.tertiaryLinks?.[0]?.title || '',
        duration: value.duration,
        raw: value,
      });
    }

    Object.values(value).forEach(walkApplePayload);
  }

  function collectSerializedData() {
    const node = document.querySelector('script#serialized-server-data[type="application/json"]');
    if (!node?.textContent) return;
    try {
      walkApplePayload(JSON.parse(node.textContent));
    } catch {
      // DOM scraping below is the fallback.
    }
  }

  function textFrom(root, selectors) {
    for (const selector of selectors) {
      const value = clean(root.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return '';
  }

  function parseFallbackLines(row) {
    const lines = String(row.innerText || '')
      .split(/\n+/)
      .map(clean)
      .filter(Boolean)
      .filter((line) => !/^(歌曲|艺人|艺术家|时长|播放|预览|更多|添加|已喜欢|喜欢|歌词|无损|杜比|E|·|\.\.\.)$/i.test(line));
    if (lines.length < 2) return null;
    const durationIndex = lines.findIndex((line) => /^\d{1,2}:\d{2}$/.test(line));
    if (durationIndex > 1) lines.splice(durationIndex, 1);
    return {
      title: lines[0],
      artists: lines[1],
      album: lines[2] || '',
      raw: { lines },
    };
  }

  function collectDomRows() {
    const rows = Array.from(document.querySelectorAll([
      '.songs-list-row',
      '[data-testid="tracklist-track"]',
      '[data-testid="track-lockup"]',
      '[data-testid="track-row"]',
      '[role="row"]',
      'music-track-lockup',
    ].join(',')));

    for (const row of rows) {
      if (row.classList?.contains('songs-list__header')) continue;
      const title = textFrom(row, [
        '.songs-list-row__song-name',
        '[data-testid="track-title"]',
        '[data-testid="track-name"]',
        '.track-lockup__title',
        '.song-name',
      ]);
      const artists = textFrom(row, [
        '.songs-list-row__by-line',
        '[data-testid="track-artist"]',
        '.track-lockup__subtitle',
        '.by-line',
      ]);
      const album = textFrom(row, [
        '.songs-list-row__album',
        '[data-testid="track-album"]',
        '.songs-list-row__column-data',
      ]);
      const fallback = title && artists ? null : parseFallbackLines(row);
      addTrack({
        title: title || fallback?.title,
        artists: artists || fallback?.artists,
        album: album || fallback?.album,
        raw: {
          className: row.className,
          text: clean(row.innerText),
          fallback: fallback?.raw,
        },
      });
    }
  }

  function findScroller() {
    const candidates = Array.from(document.querySelectorAll('*'))
      .filter((node) => node.scrollHeight > node.clientHeight + 300)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    return candidates[0] || document.scrollingElement || document.documentElement;
  }

  const usedApi = await collectMusicKitApiTracks();
  if (usedApi) {
    return {
      url: location.href,
      title: document.title,
      count: tracks.length,
      method: 'musickit-api',
      tracks,
      message: '',
    };
  }

  collectSerializedData();
  const scroller = findScroller();
  let stableRounds = 0;
  let lastTop = -1;
  let lastCount = tracks.length;

  for (let round = 0; round < 260 && stableRounds < 10; round += 1) {
    collectDomRows();
    const beforeTop = scroller.scrollTop;
    const step = Math.max(window.innerHeight * 0.86, 640);
    scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
    await sleep(360);

    const topChanged = Math.abs(scroller.scrollTop - beforeTop) > 8 && scroller.scrollTop !== lastTop;
    const countChanged = tracks.length !== lastCount;
    if (!topChanged && !countChanged) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }
    lastTop = scroller.scrollTop;
    lastCount = tracks.length;
  }
  collectDomRows();

  return {
    url: location.href,
    title: document.title,
    count: tracks.length,
    method: 'dom-scroll',
    tracks,
    message: tracks.length ? '' : '页面脚本没有找到歌曲行',
  };
}
