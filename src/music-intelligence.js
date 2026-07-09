import { durationLabel, normalizeText, normalizeTrack } from './normalize.js';

export const MUSIC_INTELLIGENCE_VERSION = 1;

const PLATFORMS = ['apple', 'qq', 'netease'];
const PLATFORM_LABELS = {
  apple: 'Apple Music',
  qq: 'QQ Music',
  netease: 'NetEase Cloud Music',
};
const VERSION_TAGS = [
  ['live', /\b(live|concert)\b|现场|現場/iu],
  ['cover', /\bcover\b|翻唱/iu],
  ['acoustic', /\bacoustic\b|不插电|不插電/iu],
  ['instrumental', /\binstrumental|inst\.?\b|伴奏|纯音乐|純音樂/iu],
  ['remix', /\bremix|mix\b|混音/iu],
  ['remaster', /\bremaster(?:ed)?\b|重制|重製/iu],
  ['movie', /\bmovie\s*(?:edit|ver(?:sion)?\.?)?\b|电影|電影|剧场|劇場/iu],
  ['tv_size', /\btv\s*(?:size|edit|ver(?:sion)?\.?)\b|tv size|电视|電視/iu],
  ['short', /\bshort\s*(?:version|ver\.?|edit)?\b|短版/iu],
  ['extended', /\bextended\b|加长|加長/iu],
];

export function buildMusicProfile(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const items = collectLibraryItems(input);
  const artists = new Map();
  const albums = new Map();
  const languages = new Map();
  const platforms = Object.fromEntries(PLATFORMS.map((platform) => [platform, 0]));
  const versionTags = new Map();
  const durationBuckets = { short: 0, medium: 0, long: 0, unknown: 0 };
  let durationTotal = 0;
  let durationCount = 0;
  let isrcCount = 0;

  for (const item of items) {
    const track = item.track || {};
    incrementMany(artists, track.artists?.length ? track.artists : [track.artist || 'Unknown']);
    if (track.album) increment(albums, track.album);
    increment(languages, detectLanguage(`${track.title || ''} ${track.artist || ''}`));
    for (const platform of item.platforms || []) {
      if (platforms[platform] !== undefined) platforms[platform] += 1;
    }
    if (track.isrc) isrcCount += 1;
    for (const tag of extractVersionTags(track)) increment(versionTags, tag);
    const duration = Number(track.durationMs || 0);
    if (duration > 0) {
      durationTotal += duration;
      durationCount += 1;
      durationBuckets[duration < 150000 ? 'short' : duration > 330000 ? 'long' : 'medium'] += 1;
    } else {
      durationBuckets.unknown += 1;
    }
  }

  const topArtists = topEntries(artists, 12).map(([name, count]) => ({ name, count }));
  const topAlbums = topEntries(albums, 8).map(([name, count]) => ({ name, count }));
  const languageSummary = topEntries(languages, 6).map(([name, count]) => ({ name, count }));

  return {
    version: MUSIC_INTELLIGENCE_VERSION,
    updatedAt: generatedAt,
    generatedAt,
    source: {
      type: input.unified?.clusters?.length ? 'unified-library' : 'platform-snapshots',
      platformCounts: platformTrackCounts(input.snapshots),
      itemCount: items.length,
    },
    summary: {
      trackCount: items.length,
      sourceTrackCount: totalSourceTracks(input.snapshots),
      topArtists,
      topAlbums,
      languages: languageSummary,
      platformCoverage: platforms,
      averageDurationMs: durationCount ? Math.round(durationTotal / durationCount) : null,
      isrcCoverage: items.length ? Math.round((isrcCount / items.length) * 1000) / 1000 : 0,
      reviewSignals: {
        versionConflicts: Number(input.unified?.summary?.versionConflicts || 0),
        conflictClusters: Number(input.unified?.summary?.conflictClusters || 0),
        reviewCandidates: Number(input.unified?.summary?.reviewCandidates || 0),
      },
    },
    aggregates: {
      artists: Object.fromEntries(topEntries(artists, 50)),
      albums: Object.fromEntries(topEntries(albums, 30)),
      languages: Object.fromEntries(topEntries(languages, 10)),
      platforms,
      durationBuckets,
      versionTags: Object.fromEntries(topEntries(versionTags, 20)),
    },
    examples: items.slice(0, 20).map((item) => compactLibraryItem(item)),
  };
}

export function buildMusicProfileAiEvidence(profile = {}) {
  const summary = profile.summary || {};
  const aggregates = profile.aggregates || {};
  return {
    version: 1,
    profileGeneratedAt: profile.generatedAt || profile.updatedAt || '',
    source: {
      type: profile.source?.type || '',
      itemCount: Number(profile.source?.itemCount || summary.trackCount || 0),
      platformCounts: profile.source?.platformCounts || {},
    },
    summary: {
      trackCount: Number(summary.trackCount || 0),
      sourceTrackCount: Number(summary.sourceTrackCount || 0),
      topArtists: (summary.topArtists || []).slice(0, 12),
      topAlbums: (summary.topAlbums || []).slice(0, 8),
      languages: (summary.languages || []).slice(0, 6),
      platformCoverage: summary.platformCoverage || {},
      averageDurationMs: summary.averageDurationMs || null,
      isrcCoverage: summary.isrcCoverage || 0,
      reviewSignals: summary.reviewSignals || {},
    },
    aggregates: {
      durationBuckets: aggregates.durationBuckets || {},
      versionTags: pickObjectEntries(aggregates.versionTags, 12),
      languages: pickObjectEntries(aggregates.languages, 8),
    },
    examples: (profile.examples || []).slice(0, 8).map((item) => ({
      title: item.track?.title || '',
      artist: item.track?.artist || '',
      album: item.track?.album || '',
      platforms: item.platforms || [],
      needsReview: Boolean(item.needsReview),
    })),
  };
}

export function deterministicMusicProfileSummary(profile = {}) {
  const summary = profile.summary || {};
  const topArtists = (summary.topArtists || []).slice(0, 3).map((item) => item.name).filter(Boolean);
  const languages = (summary.languages || []).slice(0, 3).map((item) => item.name).filter(Boolean);
  const versionTags = Object.keys(profile.aggregates?.versionTags || {}).slice(0, 4);
  return normalizeMusicProfileAiSummary({
    summary: [
      `画像基于 ${Number(summary.trackCount || 0)} 首清洗后的本地歌曲生成。`,
      topArtists.length ? `常见艺人包括 ${topArtists.join('、')}。` : '',
      languages.length ? `主要语言线索是 ${languages.join('、')}。` : '',
    ].filter(Boolean).join(' '),
    taste_tags: [
      ...topArtists.map((artist) => `artist:${artist}`),
      ...languages.map((language) => `language:${language}`),
      ...versionTags.map((tag) => `version:${tag}`),
    ],
    listening_patterns: [
      summary.averageDurationMs ? `平均时长约 ${Math.round(summary.averageDurationMs / 1000)} 秒` : '',
      summary.isrcCoverage ? `ISRC 覆盖率 ${Math.round(summary.isrcCoverage * 100)}%` : '',
    ].filter(Boolean),
    recommendation_angles: topArtists.map((artist) => `优先寻找与 ${artist} 相近的歌曲`),
    caveats: [
      summary.reviewSignals?.reviewCandidates ? '曲库中仍有需要人工复核的匹配，画像会保持保守。' : '',
      '画像只基于本地清洗后的喜欢歌曲，不代表完整收听历史。',
    ].filter(Boolean),
    confidence: Number(summary.trackCount || 0) >= 20 ? 0.72 : 0.55,
    evidence_refs: ['profile_summary', 'top_artists', 'languages', 'duration_buckets'].filter(Boolean),
  }, { source: 'deterministic' });
}

export function normalizeMusicProfileAiSummary(raw = {}, options = {}) {
  const confidence = Number(raw.confidence ?? raw.score ?? 0);
  return {
    source: String(options.source || raw.source || 'model').trim(),
    summary: cleanText(raw.summary || raw.overview || '', 600),
    tasteTags: cleanStringList(raw.taste_tags || raw.tasteTags || raw.tags, 16, 80),
    listeningPatterns: cleanStringList(raw.listening_patterns || raw.listeningPatterns || raw.patterns, 8, 160),
    recommendationAngles: cleanStringList(raw.recommendation_angles || raw.recommendationAngles || raw.recommendations, 8, 180),
    caveats: cleanStringList(raw.caveats || raw.limitations, 6, 180),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    evidenceRefs: cleanStringList(raw.evidence_refs || raw.evidenceRefs, 10, 80),
  };
}

export function evaluateMusicProfileModelOutput(testCase = {}) {
  const output = normalizeMusicProfileAiSummary(testCase.output || {});
  const expected = testCase.expected || {};
  const requiredTags = expected.requiredTags || [];
  const forbidden = expected.forbiddenTerms || [];
  const text = JSON.stringify(output).toLowerCase();
  const missingTags = requiredTags.filter((tag) => !output.tasteTags.map((item) => item.toLowerCase()).includes(String(tag).toLowerCase()));
  const forbiddenHits = forbidden.filter((term) => text.includes(String(term).toLowerCase()));
  const passed = Boolean(output.summary)
    && output.evidenceRefs.length >= Number(expected.minEvidenceRefs || 1)
    && output.confidence >= Number(expected.minConfidence || 0)
    && !missingTags.length
    && !forbiddenHits.length;
  return {
    id: testCase.id || '',
    category: testCase.category || 'profile_summary',
    passed,
    missingTags,
    forbiddenHits,
    confidence: output.confidence,
    evidenceRefs: output.evidenceRefs,
    summaryLength: output.summary.length,
  };
}

export function evaluateMusicProfileModelFixtures(cases = [], options = {}) {
  const evaluated = cases.map((testCase) => evaluateMusicProfileModelOutput(testCase));
  const total = evaluated.length;
  const passed = evaluated.filter((item) => item.passed).length;
  const minPassRate = Number(options.minPassRate ?? 1);
  return {
    ok: total ? passed / total >= minPassRate && passed === total : true,
    minPassRate,
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate: total ? Number((passed / total).toFixed(4)) : 1,
    },
    cases: evaluated,
  };
}

export function findSimilarTracks(input = {}) {
  const items = collectLibraryItems(input);
  const seed = resolveSeed(input.seed || {}, items);
  if (!seed) {
    return {
      seed: null,
      candidates: [],
      total: 0,
      reason: 'seed_not_found',
    };
  }
  const limit = clampInteger(input.limit, 1, 50, 12);
  const candidates = items
    .filter((item) => item.key !== seed.key)
    .map((item) => scoreSimilarity(seed, item))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.track.title.localeCompare(right.track.title, 'zh-CN'))
    .slice(0, limit);

  return {
    seed: compactLibraryItem(seed),
    total: candidates.length,
    candidates,
  };
}

export function buildRecommendations(input = {}) {
  const items = collectLibraryItems(input);
  const profile = input.profile || buildMusicProfile(input);
  const limit = clampInteger(input.limit, 1, 50, 20);
  const excludeApple = input.excludeApple !== false;
  const topArtists = new Set((profile.summary?.topArtists || []).slice(0, 20).map((item) => normalizeText(item.name)));
  const topLanguages = new Set((profile.summary?.languages || []).slice(0, 3).map((item) => item.name));
  const candidates = items
    .filter((item) => !(excludeApple && item.platforms.includes('apple')))
    .map((item) => scoreRecommendation(item, { topArtists, topLanguages, profile }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.track.title.localeCompare(right.track.title, 'zh-CN'))
    .slice(0, limit);

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    source: 'local-library',
    excludes: {
      appleLiked: excludeApple,
      providerWrites: true,
    },
    total: candidates.length,
    candidates,
  };
}

export function buildRecommendationAiEvidence(recommendations = {}, profile = {}) {
  return {
    version: 1,
    generatedAt: recommendations.generatedAt || '',
    source: recommendations.source || 'local-library',
    excludes: recommendations.excludes || {},
    profile: {
      trackCount: Number(profile.summary?.trackCount || 0),
      topArtists: (profile.summary?.topArtists || []).slice(0, 8),
      languages: (profile.summary?.languages || []).slice(0, 5),
      averageDurationMs: profile.summary?.averageDurationMs || null,
      isrcCoverage: profile.summary?.isrcCoverage || 0,
      aiSummary: profile.aiSummary ? {
        summary: profile.aiSummary.summary || '',
        tasteTags: (profile.aiSummary.tasteTags || []).slice(0, 12),
        recommendationAngles: (profile.aiSummary.recommendationAngles || []).slice(0, 6),
        caveats: (profile.aiSummary.caveats || []).slice(0, 4),
      } : null,
    },
    candidates: (recommendations.candidates || []).slice(0, 12).map((candidate) => ({
      key: candidate.key || '',
      title: candidate.track?.title || '',
      artist: candidate.track?.artist || '',
      album: candidate.track?.album || '',
      platforms: candidate.platforms || [],
      score: candidate.score || 0,
      reasons: candidate.reasons || [],
    })),
  };
}

export function normalizeRecommendationAiSummary(raw = {}, options = {}) {
  const candidateKeys = new Set((options.candidates || []).map((item) => item.key).filter(Boolean));
  const ranked = Array.isArray(raw.ranked_candidates || raw.rankedCandidates)
    ? (raw.ranked_candidates || raw.rankedCandidates).map((item) => normalizeRecommendationRank(item, candidateKeys)).filter(Boolean)
    : [];
  return {
    source: String(options.source || raw.source || 'model').trim(),
    summary: cleanText(raw.summary || raw.overview || '', 600),
    rankedCandidates: ranked.slice(0, 12),
    recommendationAngles: cleanStringList(raw.recommendation_angles || raw.recommendationAngles || raw.angles, 8, 180),
    caveats: cleanStringList(raw.caveats || raw.limitations, 6, 180),
    evidenceRefs: cleanStringList(raw.evidence_refs || raw.evidenceRefs, 10, 80),
  };
}

export function applyRecommendationAiSummary(recommendations = {}, aiSummary = {}) {
  const candidates = recommendations.candidates || [];
  const rank = new Map((aiSummary.rankedCandidates || []).map((item, index) => [item.key, { ...item, index }]));
  const reranked = candidates
    .map((candidate, index) => ({
      ...candidate,
      aiReason: rank.get(candidate.key)?.reason || '',
      aiConfidence: rank.get(candidate.key)?.confidence ?? null,
      aiEvidenceRefs: rank.get(candidate.key)?.evidenceRefs || [],
      aiRank: rank.has(candidate.key) ? rank.get(candidate.key).index + 1 : null,
      deterministicRank: index + 1,
    }))
    .sort((left, right) => {
      const leftRank = left.aiRank || Number.POSITIVE_INFINITY;
      const rightRank = right.aiRank || Number.POSITIVE_INFINITY;
      return leftRank - rightRank || right.score - left.score || left.deterministicRank - right.deterministicRank;
    });
  return {
    ...recommendations,
    candidates: reranked,
    aiSummary,
  };
}

export function evaluateRecommendationModelOutput(testCase = {}) {
  const candidates = testCase.candidates || [];
  const output = normalizeRecommendationAiSummary(testCase.output || {}, { candidates });
  const expected = testCase.expected || {};
  const requiredKeys = expected.requiredCandidateKeys || [];
  const forbidden = expected.forbiddenTerms || [];
  const text = JSON.stringify(output).toLowerCase();
  const rankedKeys = output.rankedCandidates.map((item) => item.key);
  const missingCandidateKeys = requiredKeys.filter((key) => !rankedKeys.includes(key));
  const unknownCandidateKeys = rankedKeys.filter((key) => !candidates.some((candidate) => candidate.key === key));
  const forbiddenHits = forbidden.filter((term) => text.includes(String(term).toLowerCase()));
  const passed = Boolean(output.summary)
    && output.evidenceRefs.length >= Number(expected.minEvidenceRefs || 1)
    && !missingCandidateKeys.length
    && !unknownCandidateKeys.length
    && !forbiddenHits.length;
  return {
    id: testCase.id || '',
    category: testCase.category || 'recommendation_summary',
    passed,
    missingCandidateKeys,
    unknownCandidateKeys,
    forbiddenHits,
    evidenceRefs: output.evidenceRefs,
    rankedCandidateCount: output.rankedCandidates.length,
  };
}

export function evaluateRecommendationModelFixtures(cases = [], options = {}) {
  const evaluated = cases.map((testCase) => evaluateRecommendationModelOutput(testCase));
  const total = evaluated.length;
  const passed = evaluated.filter((item) => item.passed).length;
  const minPassRate = Number(options.minPassRate ?? 1);
  return {
    ok: total ? passed / total >= minPassRate && passed === total : true,
    minPassRate,
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate: total ? Number((passed / total).toFixed(4)) : 1,
    },
    cases: evaluated,
  };
}

export function appendRecommendationShortlist(state = {}, options = {}) {
  const now = options.updatedAt || new Date().toISOString();
  const safeState = state && typeof state === 'object' ? state : {};
  const existing = Array.isArray(safeState.shortlists) ? safeState.shortlists : [];
  const id = options.id || `shortlist-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const name = String(options.name || 'Local recommendations').trim();
  const tracks = (options.candidates || []).map((candidate) => compactTrack(candidate.track || candidate));
  return {
    version: MUSIC_INTELLIGENCE_VERSION,
    updatedAt: now,
    shortlists: [
      {
        id,
        name,
        createdAt: now,
        updatedAt: now,
        source: options.source || 'local-library',
        tracks,
      },
      ...existing.filter((item) => item.id !== id),
    ].slice(0, 20),
  };
}

export function compactTrack(track = {}) {
  const normalized = track.platform ? track : normalizeTrack(track, track.platform || 'unknown');
  return {
    platform: normalized.platform || track.platform || '',
    id: normalized.id || null,
    mid: normalized.mid || null,
    title: normalized.title || '',
    artists: normalized.artists || [],
    artist: normalized.artist || '',
    album: normalized.album || '',
    durationMs: normalized.durationMs || null,
    duration: normalized.duration || durationLabel(normalized.durationMs),
    isrc: normalized.isrc || null,
  };
}

export function collectLibraryItems(input = {}) {
  if (Array.isArray(input.items)) return input.items.map(normalizeLibraryItem);
  if (input.unified?.clusters?.length) {
    return input.unified.clusters.map((cluster) => {
      const sources = Object.entries(cluster.sources || {}).flatMap(([platform, tracks]) => (
        (tracks || []).map((track) => ({ platform, track: compactTrack({ ...track, platform: track.platform || platform }) }))
      ));
      const display = compactTrack(sources[0]?.track || {
        platform: cluster.platforms?.[0] || 'unknown',
        title: cluster.title,
        artist: cluster.artist,
        album: cluster.album,
        durationMs: cluster.durationMs,
      });
      return normalizeLibraryItem({
        key: cluster.id,
        clusterId: cluster.id,
        track: display,
        platforms: cluster.platforms || sources.map((source) => source.platform),
        sources,
        needsReview: Boolean(cluster.needsReview),
      });
    });
  }

  const seen = new Map();
  for (const [platform, snapshot] of Object.entries(input.snapshots || {})) {
    if (!snapshot || snapshot.skipped) continue;
    for (const rawTrack of snapshot.tracks || []) {
      const track = compactTrack(normalizeTrack(rawTrack, rawTrack.platform || platform));
      const key = trackKey(track);
      const current = seen.get(key) || {
        key,
        clusterId: '',
        track,
        platforms: [],
        sources: [],
        needsReview: false,
      };
      if (!current.platforms.includes(platform)) current.platforms.push(platform);
      current.sources.push({ platform, track });
      seen.set(key, current);
    }
  }
  return [...seen.values()].map(normalizeLibraryItem);
}

function normalizeLibraryItem(item = {}) {
  const track = compactTrack(item.track || {});
  const platforms = [...new Set((item.platforms || item.sources?.map((source) => source.platform) || [track.platform]).filter(Boolean))];
  return {
    key: item.key || item.clusterId || trackKey(track),
    clusterId: item.clusterId || '',
    track,
    platforms,
    sources: (item.sources || []).map((source) => ({
      platform: source.platform || source.track?.platform || '',
      track: compactTrack(source.track || {}),
    })),
    needsReview: Boolean(item.needsReview),
  };
}

function scoreSimilarity(seed, item) {
  const reasons = [];
  let score = 0;
  const seedTrack = seed.track || {};
  const track = item.track || {};
  const seedArtists = new Set((seedTrack.artists || [seedTrack.artist]).map(normalizeText).filter(Boolean));
  const artists = new Set((track.artists || [track.artist]).map(normalizeText).filter(Boolean));
  const artistOverlap = intersectionSize(seedArtists, artists);
  if (artistOverlap) {
    score += 35;
    reasons.push('same_artist');
  }
  const titleScore = jaccard(tokenize(seedTrack.title), tokenize(track.title));
  if (titleScore > 0) {
    score += Math.round(titleScore * 20);
    if (titleScore >= 0.5) reasons.push('title_tokens');
  }
  if (seedTrack.album && normalizeText(seedTrack.album) === normalizeText(track.album)) {
    score += 12;
    reasons.push('same_album');
  }
  const durationScore = durationSimilarity(seedTrack.durationMs, track.durationMs);
  if (durationScore > 0) {
    score += Math.round(durationScore * 18);
    if (durationScore >= 0.8) reasons.push('close_duration');
  }
  const versionOverlap = intersectionSize(new Set(extractVersionTags(seedTrack)), new Set(extractVersionTags(track)));
  if (versionOverlap) {
    score += 8;
    reasons.push('same_version_signal');
  }
  if (detectLanguage(`${seedTrack.title} ${seedTrack.artist}`) === detectLanguage(`${track.title} ${track.artist}`)) {
    score += 5;
    reasons.push('same_language');
  }
  return {
    ...compactLibraryItem(item),
    score,
    reasons,
  };
}

function scoreRecommendation(item, context) {
  let score = 0;
  const reasons = [];
  const track = item.track || {};
  const artistKeys = (track.artists || [track.artist]).map(normalizeText);
  if (artistKeys.some((artist) => context.topArtists.has(artist))) {
    score += 35;
    reasons.push('top_artist_match');
  }
  const language = detectLanguage(`${track.title} ${track.artist}`);
  if (context.topLanguages.has(language)) {
    score += 18;
    reasons.push('language_match');
  }
  if (item.platforms.includes('qq') && item.platforms.includes('netease')) {
    score += 18;
    reasons.push('liked_on_multiple_non_apple_platforms');
  } else if (item.platforms.length === 1) {
    score += 8;
    reasons.push(`liked_on_${item.platforms[0] || 'one_platform'}`);
  }
  const profileAverage = Number(context.profile.summary?.averageDurationMs || 0);
  const durationScore = durationSimilarity(profileAverage, track.durationMs);
  if (durationScore > 0) {
    score += Math.round(durationScore * 12);
    if (durationScore >= 0.75) reasons.push('fits_duration_profile');
  }
  if (track.isrc) {
    score += 4;
    reasons.push('has_isrc');
  }
  return {
    ...compactLibraryItem(item),
    score,
    reasons,
  };
}

function compactLibraryItem(item = {}) {
  return {
    key: item.key || '',
    clusterId: item.clusterId || '',
    track: compactTrack(item.track || {}),
    platforms: item.platforms || [],
    platformLabels: (item.platforms || []).map((platform) => PLATFORM_LABELS[platform] || platform),
    needsReview: Boolean(item.needsReview),
  };
}

function pickObjectEntries(input = {}, limit = 10) {
  return Object.fromEntries(Object.entries(input || {}).slice(0, limit));
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanStringList(value, limit, maxLength) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => cleanText(item, maxLength)).filter(Boolean))].slice(0, limit);
}

function normalizeRecommendationRank(item = {}, candidateKeys = new Set()) {
  const key = cleanText(item.key || item.candidate_key || item.candidateKey, 120);
  if (!key || !candidateKeys.has(key)) return null;
  const confidence = Number(item.confidence ?? item.score ?? 0);
  return {
    key,
    reason: cleanText(item.reason || item.rationale || '', 240),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    evidenceRefs: cleanStringList(item.evidence_refs || item.evidenceRefs, 6, 80),
  };
}

function resolveSeed(seed, items) {
  if (!seed) return null;
  if (seed.key || seed.clusterId || seed.id || seed.mid) {
    const wanted = new Set([seed.key, seed.clusterId, seed.id, seed.mid].map((value) => String(value || '').trim()).filter(Boolean));
    const found = items.find((item) => (
      wanted.has(item.key)
      || wanted.has(item.clusterId)
      || wanted.has(String(item.track?.id || ''))
      || wanted.has(String(item.track?.mid || ''))
    ));
    if (found) return found;
  }
  if (seed.title || seed.artist) {
    const normalizedSeed = compactTrack(normalizeTrack(seed, seed.platform || 'seed'));
    return normalizeLibraryItem({
      key: 'seed:input',
      track: normalizedSeed,
      platforms: [normalizedSeed.platform || 'seed'],
    });
  }
  return null;
}

function platformTrackCounts(snapshots = {}) {
  return Object.fromEntries(PLATFORMS.map((platform) => [
    platform,
    Array.isArray(snapshots?.[platform]?.tracks) && !snapshots?.[platform]?.skipped
      ? snapshots[platform].tracks.length
      : 0,
  ]));
}

function totalSourceTracks(snapshots = {}) {
  return Object.values(platformTrackCounts(snapshots)).reduce((sum, count) => sum + count, 0);
}

function trackKey(track = {}) {
  if (track.isrc) return `isrc:${track.isrc}`;
  return normalizeText([
    track.title,
    track.artist,
    track.album,
    track.durationMs ? Math.round(track.durationMs / 10000) : '',
  ].filter(Boolean).join(' '));
}

function detectLanguage(text) {
  const value = String(text || '');
  const hasCjk = /[\u3400-\u9fff]/u.test(value);
  const hasKana = /[\u3040-\u30ff]/u.test(value);
  const hasLatin = /[a-z]/iu.test(value);
  if (hasCjk && hasLatin) return 'mixed_cjk_latin';
  if (hasCjk) return 'cjk';
  if (hasKana) return 'japanese';
  if (hasLatin) return 'latin';
  return 'unknown';
}

function extractVersionTags(track = {}) {
  const text = `${track.title || ''} ${track.album || ''}`;
  return VERSION_TAGS.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

function increment(map, key, amount = 1) {
  const value = String(key || '').trim() || 'Unknown';
  map.set(value, (map.get(value) || 0) + amount);
}

function incrementMany(map, values = []) {
  for (const value of values) increment(map, value);
}

function topEntries(map, limit) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
    .slice(0, limit);
}

function tokenize(value) {
  return new Set(normalizeText(value).split(/\s+/u).filter(Boolean));
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  const intersection = intersectionSize(left, right);
  return intersection / (left.size + right.size - intersection);
}

function intersectionSize(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function durationSimilarity(left, right) {
  const a = Number(left || 0);
  const b = Number(right || 0);
  if (!a || !b) return 0;
  const diff = Math.abs(a - b);
  return Math.max(0, 1 - (diff / Math.max(a, b, 1)));
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
