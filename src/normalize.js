const PUNCT_RE = /[\u200b-\u200f\u202a-\u202e'"`’‘“”()[\]{}【】（）<>《》,，.。!！?？:：;；|/\\_-]+/g;
const FEAT_RE = /\s*(feat\.?|ft\.?|featuring|with|伴奏|纯音乐|伴唱)\s+/gi;
const VERSION_RE = /\s*(live|remaster(ed)?|remix|mix|伴奏|instrumental|explicit|clean|radio edit|single version|专辑版|现场版|重制版|混音版)\s*/gi;

export function normalizeTrack(input, platform = 'unknown') {
  const title = cleanDisplay(input.title || input.name || input.song || '');
  const artists = normalizeArtists(input.artists || input.artist || input.singer || []);
  const album = cleanDisplay(input.album || input.albumName || '');
  const durationMs = normalizeDuration(input.durationMs ?? input.duration ?? input.interval ?? input.time);
  const id = input.id ?? input.songId ?? input.songid ?? null;
  const raw = input.raw ?? input;
  const isrc = normalizeIsrc(input.isrc ?? input.isrcCode ?? raw?.isrc ?? raw?.raw?.isrc ?? raw?.raw?.catalogIsrc);
  const aliases = normalizeAliases(input.aliases, raw, platform);

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
    metadata: input.metadata || null,
    raw,
  };
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
