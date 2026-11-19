import { trackArtworkUrl, trackPreviewUrl } from './track-media.js';

const PUNCT_RE = /[\u200b-\u200f\u202a-\u202e'"`’‘“”()[\]{}【】（）<>《》!?！？:：;；,，.。、·•|/\\_—–-]+/g;
const FEAT_RE = /\s*(feat\.?|ft\.?|featuring|with|伴唱|合作|客串)\s+/gi;
const VERSION_RE = /\s*(live|concert|remaster(?:ed)?|remix(?:ed)?|instrumental|inst\.?|off vocal|karaoke|acoustic|piano version|cover|explicit|clean|radio edit|single version|album version|现场(?:版)?|現場(?:版)?|实况|實況|重制(?:版)?|重製(?:版)?|修复(?:版)?|修復(?:版)?|混音(?:版)?|伴奏(?:版)?|纯音乐|純音樂|翻唱(?:版)?|健康版|洁净版|潔淨版|不插电|不插電|ライブ|リマスター|リミックス|インスト(?:ゥルメンタル)?|オフボーカル|カラオケ|アコースティック|カバー)\s*/gi;

export function normalizeTrack(input, platform = 'unknown') {
  const title = cleanDisplay(input.title || input.name || input.song || '');
  const artists = normalizeArtists(input.artists || input.artist || input.singer || []);
  const album = cleanDisplay(input.album || input.albumName || '');
  const durationMs = normalizeDuration(input.durationMs ?? input.duration ?? input.interval ?? input.time);
  const id = input.id ?? input.songId ?? input.songid ?? null;
  const raw = input.raw ?? input;
  const isrc = normalizeIsrc(input.isrc ?? input.isrcCode ?? raw?.isrc ?? raw?.raw?.isrc ?? raw?.raw?.catalogIsrc);
  const aliases = normalizeAliases(input.aliases, raw, platform);
  const metadata = mergeTrackMetadata(input.metadata, providerCatalogMetadata(raw, platform));
  const mediaInput = {
    ...input,
    platform,
    raw,
  };

  return {
    platform,
    id: id === null || id === undefined ? null : String(id),
    mid: input.mid ?? input.songmid ?? input.songMid ?? null,
    title,
    artists,
    artist: artists.join(' / '),
    album,
    durationMs,
    isrc,
    artworkUrl: trackArtworkUrl(mediaInput, { platform }),
    previewUrl: trackPreviewUrl(mediaInput),
    aliases,
    normalized: {
      title: normalizeText(title, { stripVersion: true }),
      artist: normalizeText(artists.join(' ')),
      album: normalizeText(album, { stripVersion: true }),
      aliases: {
        titles: aliases.titles.map((item) => normalizeText(item, { stripVersion: true })).filter(Boolean),
        artists: aliases.artists.map((item) => normalizeText(item)).filter(Boolean),
        albums: aliases.albums.map((item) => normalizeText(item, { stripVersion: true })).filter(Boolean),
      },
    },
    metadata,
    raw,
  };
}

function mergeTrackMetadata(metadata, providerCatalog) {
  if (!providerCatalog) return metadata || null;
  return {
    ...(metadata || {}),
    providerCatalog: {
      ...(metadata?.providerCatalog || {}),
      ...providerCatalog,
    },
  };
}

function providerCatalogMetadata(raw, platform) {
  const layers = rawObjectLayers(raw);
  const result = { platform };
  if (platform === 'qq') {
    const source = layers.find((value) => value.index_album !== undefined || value.album?.mid) || {};
    assignPositiveInteger(result, 'trackNumber', source.index_album);
    assignPositiveInteger(result, 'discNumber', source.index_cd);
    assignText(result, 'albumId', source.album?.id);
    assignText(result, 'albumMid', source.album?.mid || source.album?.pmid);
    assignText(result, 'subtitle', source.subtitle);
    assignText(result, 'releaseDate', source.time_public);
  } else if (platform === 'netease') {
    const source = layers.find((value) => (
      value.no !== undefined
      || value.position !== undefined
      || value.al?.id
      || value.album?.id
    )) || {};
    assignPositiveInteger(
      result,
      'trackNumber',
      source.no ?? source.position ?? (Number(source.album?.size) === 1 ? 1 : undefined),
    );
    assignPositiveInteger(result, 'discNumber', source.cd);
    assignText(result, 'albumId', source.al?.id || source.album?.id);
    assignText(result, 'subtitle', [...asArray(source.alia), ...asArray(source.tns)].filter(Boolean).join(' / '));
    const publishTime = Number(source.publishTime || source.album?.publishTime || 0);
    if (publishTime > 0) {
      result.releaseDate = new Date(publishTime + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
  } else if (platform === 'apple') {
    const source = layers.find((value) => value.trackNumber !== undefined || value.discNumber !== undefined) || {};
    assignPositiveInteger(result, 'trackNumber', source.trackNumber);
    assignPositiveInteger(result, 'discNumber', source.discNumber);
    assignText(result, 'releaseDate', source.releaseDate);
  }
  return Object.keys(result).length > 1 ? result : null;
}

function rawObjectLayers(raw) {
  const result = [];
  const queue = raw && typeof raw === 'object' ? [raw] : [];
  const seen = new Set();
  while (queue.length && result.length < 16) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    for (const child of [value.raw, value.data, value.attributes]) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return result;
}

function assignPositiveInteger(target, key, value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (Number.isFinite(number) && number > 0) target[key] = number;
}

function assignText(target, key, value) {
  const text = cleanDisplay(value);
  if (text) target[key] = text;
}

export function cleanDisplay(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeArtists(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        return item?.name || item?.title || item?.singer_name || item?.mid || '';
      })
      .flatMap(splitArtist)
      .map(cleanDisplay)
      .filter(Boolean);
  }
  return splitArtist(String(value ?? ''))
    .map(cleanDisplay)
    .filter(Boolean);
}

export function normalizeIsrc(value) {
  const text = String(value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return text.length === 12 ? text : null;
}

export function normalizeAliasObject(value) {
  return {
    titles: uniqueClean(value?.titles || value?.title || []),
    artists: uniqueClean(value?.artists || value?.artist || []),
    albums: uniqueClean(value?.albums || value?.album || []),
  };
}

function normalizeAliases(inputAliases, raw, platform) {
  const aliases = normalizeAliasObject(inputAliases);
  const rawAliases = extractRawAliases(raw, platform);
  return {
    titles: uniqueClean([...aliases.titles, ...rawAliases.titles]),
    artists: uniqueClean([...aliases.artists, ...rawAliases.artists]),
    albums: uniqueClean([...aliases.albums, ...rawAliases.albums]),
  };
}

function extractRawAliases(raw, platform) {
  if (!raw || typeof raw !== 'object') return normalizeAliasObject();
  const source = raw.raw && typeof raw.raw === 'object' ? raw.raw : raw;
  const titles = [];
  const artists = [];
  const albums = [];

  titles.push(...asArray(source.alia), ...asArray(source.alias), ...asArray(source.tns));
  titles.push(source.transName, source.transname, source.subtitle, source.additionalTitle);
  albums.push(...asArray(source.al?.tns), ...asArray(source.album?.tns));

  const rawArtists = asArray(source.ar || source.artists || source.singer || source.singers);
  for (const artist of rawArtists) {
    if (!artist || typeof artist !== 'object') continue;
    artists.push(...asArray(artist.alias), ...asArray(artist.aliases), ...asArray(artist.tns));
  }

  if (platform === 'qq') {
    const data = source.data || source;
    titles.push(data.transname, data.subtitle);
    albums.push(data.album?.transName, data.album?.transname);
  }

  return {
    titles: uniqueClean(titles),
    artists: uniqueClean(artists),
    albums: uniqueClean(albums),
  };
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueClean(values) {
  const seen = new Set();
  const result = [];
  for (const value of asArray(values).flatMap(asArray)) {
    const text = typeof value === 'string'
      ? cleanDisplay(value)
      : cleanDisplay(value?.name || value?.title || value?.['sort-name'] || '');
    if (!text) continue;
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function splitArtist(value) {
  return String(value)
    .replace(FEAT_RE, '/')
    .split(/\s*(?:\/|、|,|，|&| and | x | × |;|；)\s*/i)
    .filter(Boolean);
}

export function normalizeDuration(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 10000 ? Math.round(value * 1000) : Math.round(value);
  }
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const number = Number(text);
    return number > 0 && number < 10000 ? Math.round(number * 1000) : Math.round(number);
  }
  const parts = text.split(':').map((part) => Number(part));
  if (parts.every((part) => Number.isFinite(part))) {
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + part;
    return Math.round(seconds * 1000);
  }
  return null;
}

export function normalizeText(value, options = {}) {
  let text = String(value ?? '').toLowerCase();
  text = text.normalize('NFKC');
  text = text.replace(/\s+-\s+.*$/g, ' ');
  if (options.stripVersion) text = text.replace(VERSION_RE, ' ');
  text = text.replace(PUNCT_RE, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export function durationLabel(durationMs) {
  if (!durationMs) return '';
  const total = Math.round(durationMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
