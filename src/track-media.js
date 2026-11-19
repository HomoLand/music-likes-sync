const DEFAULT_ARTWORK_SIZE = 300;

export function trackArtworkUrl(track = {}, options = {}) {
  const size = normalizedArtworkSize(options.size);
  const platform = String(track.platform || options.platform || '').trim().toLowerCase();
  const raw = track.raw && typeof track.raw === 'object' ? track.raw : {};
  const nestedRaw = raw.raw && typeof raw.raw === 'object' ? raw.raw : {};
  const data = raw.data && typeof raw.data === 'object' ? raw.data : raw;

  const direct = firstString([
    track.artworkUrl,
    track.media?.artworkUrl,
    raw.artworkUrl,
    nestedRaw.artworkUrl,
    raw.attributes?.artwork?.url,
    nestedRaw.attributes?.artwork?.url,
    raw.artwork?.url,
    nestedRaw.artwork?.url,
  ]);
  if (direct) return normalizeArtworkUrl(direct, { size, platform });

  if (platform === 'netease') {
    const picUrl = firstString([
      raw.al?.picUrl,
      raw.album?.picUrl,
      nestedRaw.al?.picUrl,
      nestedRaw.album?.picUrl,
    ]);
    return normalizeArtworkUrl(picUrl, { size, platform });
  }

  if (platform === 'qq') {
    const albumMid = firstString([
      track.albumMid,
      data.album?.mid,
      data.album?.pmid,
      raw.album?.mid,
      raw.album?.pmid,
      nestedRaw.album?.mid,
      nestedRaw.album?.pmid,
    ]).split('_')[0];
    return qqArtworkUrl(albumMid, size);
  }

  return '';
}

export function trackPreviewUrl(track = {}) {
  const raw = track.raw && typeof track.raw === 'object' ? track.raw : {};
  const nestedRaw = raw.raw && typeof raw.raw === 'object' ? raw.raw : {};
  const candidate = firstString([
    track.previewUrl,
    track.media?.previewUrl,
    raw.previewUrl,
    nestedRaw.previewUrl,
    raw.attributes?.previews?.[0]?.url,
    nestedRaw.attributes?.previews?.[0]?.url,
    raw.previews?.[0]?.url,
    nestedRaw.previews?.[0]?.url,
  ]);
  return normalizeHttpUrl(candidate);
}

export function normalizeArtworkUrl(value, options = {}) {
  const size = normalizedArtworkSize(options.size);
  const platform = String(options.platform || '').trim().toLowerCase();
  let text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('//')) text = `https:${text}`;
  text = text
    .replaceAll('{w}', String(size))
    .replaceAll('{h}', String(size))
    .replaceAll('{c}', 'bb')
    .replaceAll('{f}', 'jpg');
  const normalized = normalizeHttpUrl(text);
  if (!normalized) return '';

  try {
    const url = new URL(normalized);
    if (platform === 'netease' && /(^|\.)music\.126\.net$/i.test(url.hostname)) {
      url.searchParams.set('param', `${size}y${size}`);
    }
    return url.toString();
  } catch {
    return '';
  }
}

export function qqArtworkUrl(albumMid, size = DEFAULT_ARTWORK_SIZE) {
  const mid = String(albumMid || '').trim().split('_')[0];
  if (!/^[A-Za-z0-9]{8,32}$/.test(mid)) return '';
  const pixels = normalizedArtworkSize(size);
  return `https://y.gtimg.cn/music/photo_new/T002R${pixels}x${pixels}M000${mid}.jpg?max_age=2592000`;
}

export function normalizeHttpUrl(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('//')) text = `https:${text}`;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.protocol === 'http:' && isKnownMediaHost(url.hostname)) url.protocol = 'https:';
    return url.toString();
  } catch {
    return '';
  }
}

export function compactAppleArtwork(artwork = {}) {
  const url = String(artwork?.url || '').trim();
  return url ? { url } : null;
}

export function compactApplePreviews(previews = []) {
  const preview = Array.isArray(previews) ? previews.find((item) => item?.url) : null;
  return preview ? [{ url: normalizeHttpUrl(preview.url) }] : [];
}

function firstString(values) {
  for (const value of values || []) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizedArtworkSize(value) {
  const number = Number(value || DEFAULT_ARTWORK_SIZE);
  if (!Number.isFinite(number)) return DEFAULT_ARTWORK_SIZE;
  return Math.min(1200, Math.max(64, Math.round(number)));
}

function isKnownMediaHost(hostname) {
  return /(^|\.)(?:gtimg\.cn|qqmusic\.qq\.com|music\.126\.net|mzstatic\.com|apple\.com)$/i.test(hostname);
}
