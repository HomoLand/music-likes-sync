import { normalizeText } from './normalize.js';

const DEFAULT_QUERY_LIMIT = 8;
const MAX_QUERY_LIMIT = 16;
const TARGET_STOREFRONTS = {
  qq: ['cn', 'hk', 'tw'],
  netease: ['cn'],
};

export function buildMatchSearchPlan(track = {}, options = {}) {
  const targetPlatform = String(options.targetPlatform || '').trim().toLowerCase();
  const limit = clampInteger(options.limit, DEFAULT_QUERY_LIMIT, 1, MAX_QUERY_LIMIT);
  const plan = [];
  const seen = new Set();
  const primaryTitle = clean(track.title);
  const primaryArtist = clean(track.artist || track.artists?.[0]);
  const primaryAlbum = clean(track.album);
  const equivalents = trustedEquivalents(track, targetPlatform);
  const titleAliases = distinctAliases(track.aliases?.titles, primaryTitle, 8);
  const artistAliases = distinctAliases(track.aliases?.artists, primaryArtist, 8);
  const albumAliases = distinctAliases(track.aliases?.albums, primaryAlbum, 6);

  for (const equivalent of equivalents) {
    addQuery(plan, seen, {
      query: join(equivalent.title, equivalent.artist),
      strategy: 'apple_storefront_title_artist',
      storefront: equivalent.storefront,
      authoritativeAlias: equivalent.isrcMatch === true,
    });
  }

  addQuery(plan, seen, {
    query: join(primaryTitle, primaryArtist),
    strategy: 'source_title_artist',
  });

  for (const [title, artist] of pairedAliases(titleAliases, artistAliases, 4)) {
    addQuery(plan, seen, {
      query: join(title, artist),
      strategy: 'title_alias_artist_alias',
    });
  }

  for (const equivalent of equivalents) {
    addQuery(plan, seen, {
      query: join(equivalent.title, equivalent.album),
      strategy: 'apple_storefront_title_album',
      storefront: equivalent.storefront,
      authoritativeAlias: equivalent.isrcMatch === true,
    });
  }

  for (const title of titleAliases) {
    addQuery(plan, seen, {
      query: join(title, primaryArtist),
      strategy: 'title_alias_primary_artist',
    });
  }

  for (const artist of artistAliases) {
    addQuery(plan, seen, {
      query: join(primaryTitle, artist),
      strategy: 'source_title_artist_alias',
    });
  }

  addQuery(plan, seen, {
    query: join(primaryTitle, primaryAlbum),
    strategy: 'source_title_album',
  });

  for (const album of albumAliases) {
    addQuery(plan, seen, {
      query: join(primaryTitle, album),
      strategy: 'source_title_album_alias',
    });
  }

  for (const equivalent of equivalents) {
    addQuery(plan, seen, {
      query: equivalent.title,
      strategy: 'apple_storefront_title',
      storefront: equivalent.storefront,
      authoritativeAlias: equivalent.isrcMatch === true,
    });
  }

  for (const title of titleAliases) {
    addQuery(plan, seen, {
      query: title,
      strategy: 'title_alias',
    });
  }

  addQuery(plan, seen, {
    query: primaryTitle,
    strategy: 'source_title',
  });

  return plan.slice(0, limit).map((item, index) => ({
    ...item,
    priority: index + 1,
  }));
}

function trustedEquivalents(track, targetPlatform) {
  const values = Array.isArray(track?.metadata?.appleStorefronts?.equivalents)
    ? track.metadata.appleStorefronts.equivalents
    : [];
  const preferred = TARGET_STOREFRONTS[targetPlatform] || [];
  const trusted = values
    .filter((item) => item?.aliasTrusted === true && clean(item.title))
    .map((item, index) => ({
      ...item,
      storefront: clean(item.storefront).toLowerCase(),
      _index: index,
    }));
  const preferredValues = trusted.filter((item) => preferred.includes(item.storefront));
  return (preferredValues.length ? preferredValues : trusted)
    .sort((left, right) => (
      storefrontRank(left.storefront, preferred) - storefrontRank(right.storefront, preferred)
      || Number(right.isrcMatch === true) - Number(left.isrcMatch === true)
      || left._index - right._index
    ));
}

function pairedAliases(titles, artists, limit) {
  const result = [];
  for (const title of titles.slice(0, 4)) {
    for (const artist of artists.slice(0, 4)) {
      result.push([title, artist]);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function storefrontRank(storefront, preferred) {
  const index = preferred.indexOf(storefront);
  return index >= 0 ? index : preferred.length + 1;
}

function distinctAliases(values, primary, limit) {
  const primaryKey = normalizeText(primary);
  const seen = new Set(primaryKey ? [primaryKey] : []);
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = clean(value);
    const key = normalizeText(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function addQuery(plan, seen, item) {
  const query = clean(item.query).slice(0, 240);
  const key = normalizeText(query);
  if (!query || !key || seen.has(key)) return;
  seen.add(key);
  plan.push({
    query,
    strategy: item.strategy,
    ...(item.storefront ? { storefront: item.storefront } : {}),
    ...(item.authoritativeAlias ? { authoritativeAlias: true } : {}),
  });
}

function join(...values) {
  return values.map(clean).filter(Boolean).join(' ');
}

function clean(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
