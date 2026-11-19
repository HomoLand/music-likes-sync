import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeTrack } from './normalize.js';
import { pick } from './utils.js';

const TITLE_KEYS = ['title', 'name', 'song', 'track', '歌曲', '名称', '曲名'];
const ARTIST_KEYS = ['artist', 'artists', 'singer', '歌手', '艺术家', '表演者'];
const ALBUM_KEYS = ['album', 'albumName', '专辑', '专辑名'];
const DURATION_KEYS = ['durationMs', 'duration', 'time', '时长', '时间'];
const ID_KEYS = ['id', 'persistentId', 'appleMusicId', 'catalogId'];
const ISRC_KEYS = ['isrc', 'isrcCode', 'ISRC'];

export async function loadAppleFile(filePath) {
  if (!filePath) {
    throw new Error('缺少 Apple Music 导入文件，请传 --apple data/apple.csv 或 data/apple.json');
  }
  const ext = path.extname(filePath).toLowerCase();
  const text = await fs.readFile(filePath, 'utf8');
  const rows = ext === '.json' ? JSON.parse(text) : parseDelimited(text);
  if (!Array.isArray(rows)) {
    throw new Error('Apple JSON 必须是歌曲数组');
  }

  const tracks = rows
    .map((row, index) => normalizeTrack({
      id: pick(row, ID_KEYS) || `apple-row-${index + 1}`,
      title: pick(row, TITLE_KEYS),
      artists: pick(row, ARTIST_KEYS),
      album: pick(row, ALBUM_KEYS),
      duration: pick(row, DURATION_KEYS),
      isrc: pick(row, ISRC_KEYS),
      raw: row,
    }, 'apple'))
    .filter((track) => track.title && track.artist);

  return {
    platform: 'apple',
    source: filePath,
    fetchedAt: new Date().toISOString(),
    tracks,
  };
}

export async function loadApplePlaylistUrl(url, options = {}) {
  if (!url || !/^https:\/\/music\.apple\.com\//i.test(url)) {
    throw new Error('请输入 https://music.apple.com/ 开头的 Apple Music 歌单链接');
  }

  const cookie = String(options.cookie || '').trim();
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 music-likes-sync/0.1',
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (cookie) headers.cookie = cookie;

  const response = await fetch(url, {
    redirect: 'follow',
    headers,
  });
  if (!response.ok) {
    throw new Error(`Apple Music 页面读取失败：HTTP ${response.status}`);
  }

  const finalUrl = response.url || url;
  if (isAppleMusicLandingPage(finalUrl)) {
    throw new Error(applePlaylistAccessError(url, finalUrl, Boolean(cookie)));
  }

  const html = await response.text();
  let payload;
  try {
    payload = extractSerializedServerData(html);
  } catch (error) {
    throw new Error(`${error.message}。${applePlaylistAccessError(url, finalUrl, Boolean(cookie))}`);
  }

  const tracks = extractTracksFromApplePayload(payload)
    .map((track, index) => normalizeTrack({
      id: track.id || `apple-url-row-${index + 1}`,
      title: track.title,
      artists: track.artists,
      album: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
      raw: track.raw,
    }, 'apple'))
    .filter((track) => track.title && track.artist);

  if (!tracks.length) {
    throw new Error(applePlaylistAccessError(url, finalUrl, Boolean(cookie)));
  }

  return {
    platform: 'apple',
    source: finalUrl,
    fetchedAt: new Date().toISOString(),
    tracks,
  };
}

export function buildAppleSnapshotFromTracks(rows, source = 'apple-browser') {
  const tracks = (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeTrack({
      id: row.id || row.appleMusicId || `apple-browser-row-${index + 1}`,
      title: row.title || row.name,
      artists: row.artists || row.artist || row.subtitle,
      album: row.album || row.collectionName,
      durationMs: row.durationMs,
      duration: row.duration,
      isrc: row.isrc || row.raw?.isrc || row.raw?.raw?.isrc || row.raw?.raw?.catalogIsrc,
      artworkUrl: row.artworkUrl || row.raw?.artworkUrl || row.raw?.raw?.artworkUrl,
      previewUrl: row.previewUrl || row.raw?.previewUrl || row.raw?.raw?.previewUrl,
      aliases: row.aliases,
      metadata: row.metadata,
      raw: row,
    }, 'apple'))
    .filter((track) => track.title && track.artist);

  return {
    platform: 'apple',
    source,
    fetchedAt: new Date().toISOString(),
    tracks,
  };
}

export function parseAppleText(text, source = 'inline') {
  const trimmed = String(text || '').trim();
  const rows = trimmed.startsWith('[') ? JSON.parse(trimmed) : parseDelimited(trimmed);
  if (!Array.isArray(rows)) {
    throw new Error('Apple 导入内容必须是 CSV/TSV 文本或 JSON 数组');
  }

  const tracks = rows
    .map((row, index) => normalizeTrack({
      id: pick(row, ID_KEYS) || `apple-row-${index + 1}`,
      title: pick(row, TITLE_KEYS),
      artists: pick(row, ARTIST_KEYS),
      album: pick(row, ALBUM_KEYS),
      duration: pick(row, DURATION_KEYS),
      isrc: pick(row, ISRC_KEYS),
      raw: row,
    }, 'apple'))
    .filter((track) => track.title && track.artist);

  return {
    platform: 'apple',
    source,
    fetchedAt: new Date().toISOString(),
    tracks,
  };
}

function parseDelimited(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuote && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuote = !inQuote;
    } else if (char === delimiter && !inQuote) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuote) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((item) => item.trim() !== '')) rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((item) => item.trim().replace(/^\ufeff/, ''));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/, 1)[0] || '';
  if ((firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length) return '\t';
  if (firstLine.includes(';') && !firstLine.includes(',')) return ';';
  return ',';
}

function extractSerializedServerData(html) {
  const match = String(html).match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Apple Music 页面里没有找到 serialized-server-data');
  return JSON.parse(match[1]);
}

function isAppleMusicLandingPage(url) {
  try {
    const parsed = new URL(url);
    return /^\/[a-z]{2}\/(?:new|browse|listen-now)(?:\/)?$/i.test(parsed.pathname)
      || /^\/(?:new|browse|listen-now)(?:\/)?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function applePlaylistAccessError(inputUrl, finalUrl, hasCookie) {
  const redirected = finalUrl && finalUrl !== inputUrl ? `，实际打开到 ${finalUrl}` : '';
  if (!hasCookie) {
    return `没有从 Apple Music 链接里解析到歌曲${redirected}。这个链接看起来需要 Apple Music 登录态，请先在“登录凭据”里保存 Apple Music Cookie 后再抓取。`;
  }
  return `没有从 Apple Music 链接里解析到歌曲${redirected}。Apple 返回的页面不是可解析的歌单详情，可能是 Cookie 过期、账号地区跳转，或这个歌单没有在网页端展开完整曲目。`;
}

function extractTracksFromApplePayload(payload) {
  const tracks = [];
  const seen = new Set();

  function walk(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object') return;

    if (isAppleTrack(value)) {
      const id = value.contentDescriptor?.identifiers?.storeAdamID || value.id || value.title;
      if (!seen.has(id)) {
        seen.add(id);
        tracks.push({
          id,
          title: value.title,
          artists: value.subtitleLinks?.map((item) => item.title).filter(Boolean) || value.artistName,
          album: value.tertiaryLinks?.[0]?.title || '',
          durationMs: value.duration || null,
          raw: value,
        });
      }
    }

    for (const child of Object.values(value)) walk(child);
  }

  walk(payload);
  return tracks;
}

function isAppleTrack(value) {
  return value.contentDescriptor?.kind === 'song'
    && value.title
    && (value.artistName || value.subtitleLinks?.length)
    && (value.id?.startsWith?.('track-lockup') || value.layoutStyle?.kind === 'playlistTrackList');
}
