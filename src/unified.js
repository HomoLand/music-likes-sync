import { compactTrack, compareAppleToPlatform } from './match.js';
import { durationLabel, normalizeText } from './normalize.js';

const PLATFORMS = ['apple', 'qq', 'netease'];
const PLATFORM_LABELS = {
  apple: 'Apple Music',
  qq: 'QQ 音乐',
  netease: '网易云',
};

const PAIRS = [
  ['apple', 'qq'],
  ['apple', 'netease'],
  ['qq', 'netease'],
];

const VERSION_PATTERNS = [
  { key: 'live', label: '现场/Live', re: /\b(live|concert)\b|ライブ|现场|現場|演唱会/i },
  { key: 'cover', label: '翻唱/Cover', re: /\bcover\b|カバー|翻唱/i },
  { key: 'acoustic', label: 'Acoustic', re: /\bacoustic\b|アコースティック|不插电/i },
  { key: 'piano', label: '钢琴/Piano', re: /\bpiano\b|ピアノ|钢琴|鋼琴/i },
  { key: 'instrumental', label: '纯音乐/Instrumental', re: /\binstrumental|inst\.?\b|インスト|伴奏|纯音乐|純音樂/i },
  { key: 'off_vocal', label: 'Off Vocal', re: /\boff\s*vocal\b|オフボーカル|カラオケ|karaoke/i },
  { key: 'remix', label: '混音/Remix', re: /\bremix|mix\b|リミックス|混音/i },
  { key: 'remaster', label: '重制/Remaster', re: /\bremaster(?:ed)?\b|リマスター|重制|重製/i },
  { key: 'movie', label: 'Movie/Edit', re: /\bmovie\s*(?:edit|ver(?:sion)?\.?)?\b|劇場版|剧场版|映画|电影版|電影版/i },
  { key: 'tv_size', label: 'TV Size', re: /\btv\s*(?:size|edit|ver(?:sion)?\.?)\b|テレビサイズ|TVサイズ/i },
  { key: 'album_version', label: 'Album Version', re: /\balbum\s*(?:version|ver\.?)\b|专辑版|專輯版/i },
  { key: 'single_version', label: 'Single Version', re: /\bsingle\s*(?:version|ver\.?)\b|单曲版|單曲版/i },
  { key: 'original_version', label: 'Original Version', re: /\boriginal\s*(?:version|ver\.?)\b|オリジナル|原版/i },
  { key: 'short', label: 'Short', re: /\bshort\s*(?:version|ver\.?|edit)?\b|ショート|短版/i },
  { key: 'extended', label: 'Extended', re: /\bextended\b|エクステンデッド|加长版|加長版/i },
  { key: 'orchestral', label: 'Orchestral', re: /\borchestral|orchestra\b|オーケストラ|管弦|交响|交響/i },
  { key: 'jazz', label: 'Jazz', re: /\bjazz\b|ジャズ/i },
];

export function buildUnifiedLibrary(snapshots, options = {}) {
  const thresholds = {
    match: Number(options.threshold ?? 0.82),
    review: Number(options.reviewThreshold ?? 0.68),
  };
  const tracksByPlatform = Object.fromEntries(
    PLATFORMS.map((platform) => [platform, snapshotTracks(snapshots?.[platform])]),
  );
  const sourceCounts = Object.fromEntries(
    PLATFORMS.map((platform) => [platform, tracksByPlatform[platform].length]),
  );

  if (!Object.values(sourceCounts).some(Boolean)) {
    throw new Error('缺少可合并的平台快照，请先拉取 Apple/QQ/网易云。');
  }

  const union = new UnionFind();
  const keyByTrack = Object.fromEntries(PLATFORMS.map((platform) => [platform, new Map()]));
  const refByKey = new Map();

  for (const platform of PLATFORMS) {
    tracksByPlatform[platform].forEach((track, index) => {
      const key = `${platform}:${index}`;
      const ref = { key, platform, index, track };
      union.add(key);
      keyByTrack[platform].set(track, key);
      refByKey.set(key, ref);
    });
  }

  const comparisons = {};
  const matchEdges = [];
  const reviewEdges = [];

  for (const [source, target] of PAIRS) {
    const sourceTracks = tracksByPlatform[source];
    const targetTracks = tracksByPlatform[target];
    if (!sourceTracks.length || !targetTracks.length) continue;

    const comparison = compareAppleToPlatform(sourceTracks, targetTracks, thresholds);
    const pairKey = `${source}-${target}`;
    comparisons[pairKey] = {
      source,
      target,
      sourceCount: sourceTracks.length,
      targetCount: targetTracks.length,
      matched: comparison.matched,
      review: comparison.review,
      missing: comparison.missing,
    };

    for (const item of comparison.matches) {
      const edge = makeEdge(source, target, item, keyByTrack);
      if (!edge) continue;
      union.union(edge.source.key, edge.target.key);
      matchEdges.push(edge);
    }

    for (const item of comparison.reviewItems) {
      const edge = makeEdge(source, target, item, keyByTrack);
      if (edge) reviewEdges.push(edge);
    }
  }

  const refsByRoot = new Map();
  for (const [key, ref] of refByKey.entries()) {
    const root = union.find(key);
    const refs = refsByRoot.get(root) || [];
    refs.push(ref);
    refsByRoot.set(root, refs);
  }

  const clusters = [...refsByRoot.entries()]
    .map(([root, refs]) => buildCluster(root, refs, matchEdges, union))
    .sort(compareClusters);

  const clusterIdByRoot = new Map();
  clusters.forEach((cluster, index) => {
    cluster.id = `u-${String(index + 1).padStart(5, '0')}`;
    clusterIdByRoot.set(cluster._root, cluster.id);
    delete cluster._root;
    delete cluster.sortKey;
  });

  const reviewCandidates = reviewEdges
    .map((edge) => {
      const sourceRoot = union.find(edge.source.key);
      const targetRoot = union.find(edge.target.key);
      return {
        sourceCluster: clusterIdByRoot.get(sourceRoot) || null,
        targetCluster: clusterIdByRoot.get(targetRoot) || null,
        source: compactEndpoint(edge.source),
        target: compactEndpoint(edge.target),
        score: edge.score,
      };
    })
    .filter((edge) => edge.sourceCluster && edge.targetCluster && edge.sourceCluster !== edge.targetCluster)
    .sort((a, b) => b.score.total - a.score.total);

  const statusCounts = countBy(clusters, (cluster) => cluster.status);
  const missingByPlatform = Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      clusters.filter((cluster) => !cluster.platforms.includes(platform)).length,
    ]),
  );
  const conflictClusters = clusters.filter((cluster) => cluster.needsReview).length;
  const versionConflicts = clusters.filter((cluster) => cluster.versionReview).length;

  return {
    generatedAt: new Date().toISOString(),
    thresholds,
    sourceCounts,
    summary: {
      totalUnified: clusters.length,
      allThree: statusCounts.all_three || 0,
      pairs: {
        appleQq: statusCounts.apple_qq || 0,
        appleNetease: statusCounts.apple_netease || 0,
        qqNetease: statusCounts.qq_netease || 0,
      },
      only: {
        apple: statusCounts.apple_only || 0,
        qq: statusCounts.qq_only || 0,
        netease: statusCounts.netease_only || 0,
      },
      missingByPlatform,
      conflictClusters,
      versionConflicts,
      reviewCandidates: reviewCandidates.length,
    },
    comparisons,
    clusters,
    reviewCandidates,
  };
}

export function buildUnifiedMarkdown(library) {
  const lines = [];
  const { summary } = library;

  lines.push('# 统一曲库报告');
  lines.push('');
  lines.push(`生成时间：${new Date(library.generatedAt).toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('## 摘要');
  lines.push('');
  lines.push(`- 源数据：Apple ${library.sourceCounts.apple} 首 / QQ ${library.sourceCounts.qq} 首 / 网易云 ${library.sourceCounts.netease} 首`);
  lines.push(`- 去重后统一曲库：${summary.totalUnified} 首`);
  lines.push(`- 三端都有：${summary.allThree} 首`);
  lines.push(`- 仅 Apple：${summary.only.apple} 首；仅 QQ：${summary.only.qq} 首；仅 网易云：${summary.only.netease} 首`);
  lines.push(`- 双端共有：Apple+QQ ${summary.pairs.appleQq} 首；Apple+网易云 ${summary.pairs.appleNetease} 首；QQ+网易云 ${summary.pairs.qqNetease} 首`);
  lines.push(`- 版本/冲突待确认：${summary.conflictClusters} 个；其中版本疑点：${summary.versionConflicts || 0} 个；低置信候选：${summary.reviewCandidates} 条`);
  lines.push('');

  lines.push('## 平台缺口');
  lines.push('');
  lines.push('| 目标平台 | 待补条目 |');
  lines.push('|---|---:|');
  for (const platform of PLATFORMS) {
    lines.push(`| ${PLATFORM_LABELS[platform]} | ${summary.missingByPlatform[platform] || 0} |`);
  }
  lines.push('');

  appendClusterTable(lines, `待补到 ${PLATFORM_LABELS.qq}`, library.clusters.filter((cluster) => !cluster.platforms.includes('qq')));
  appendClusterTable(lines, `待补到 ${PLATFORM_LABELS.netease}`, library.clusters.filter((cluster) => !cluster.platforms.includes('netease')));
  appendClusterTable(lines, `待补到 ${PLATFORM_LABELS.apple}`, library.clusters.filter((cluster) => !cluster.platforms.includes('apple')));

  appendClusterTable(lines, '只在 Apple', library.clusters.filter((cluster) => cluster.status === 'apple_only'));
  appendClusterTable(lines, '只在 QQ', library.clusters.filter((cluster) => cluster.status === 'qq_only'));
  appendClusterTable(lines, '只在网易云', library.clusters.filter((cluster) => cluster.status === 'netease_only'));

  const conflictClusters = library.clusters.filter((cluster) => cluster.needsReview);
  if (conflictClusters.length) {
    lines.push('## 版本/冲突待确认');
    lines.push('');
    lines.push('| ID | 平台 | 数量 | 歌曲 | 疑点 |');
    lines.push('|---|---|---:|---|---|');
    for (const cluster of conflictClusters.slice(0, 120)) {
      if (cluster.conflicts.length) {
        for (const conflict of cluster.conflicts) {
          lines.push(`| ${cluster.id} | ${PLATFORM_LABELS[conflict.platform]} | ${conflict.count} | ${esc(trackListLabel(conflict.tracks))} | ${esc((cluster.versionReview?.reasons || []).join('; '))} |`);
        }
      } else {
        lines.push(`| ${cluster.id} | - | - | ${esc(trackListLabel(Object.values(cluster.sources).flat()))} | ${esc((cluster.versionReview?.reasons || []).join('; '))} |`);
      }
    }
    if (conflictClusters.length > 120) {
      lines.push(`| ... | ... | ... | 仅显示前 120 个，合计 ${conflictClusters.length} 个 |`);
    }
    lines.push('');
  }

  if (library.reviewCandidates.length) {
    lines.push('## 低置信候选');
    lines.push('');
    lines.push('| 来源 cluster | 候选 cluster | 分数 | 来源 | 候选 |');
    lines.push('|---|---|---:|---|---|');
    for (const item of library.reviewCandidates.slice(0, 160)) {
      lines.push(`| ${item.sourceCluster} | ${item.targetCluster} | ${item.score.total} | ${esc(endpointLabel(item.source))} | ${esc(endpointLabel(item.target))} |`);
    }
    if (library.reviewCandidates.length > 160) {
      lines.push(`| ... | ... | ... | 仅显示前 160 条，合计 ${library.reviewCandidates.length} 条 | |`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function snapshotTracks(snapshot) {
  if (!snapshot || snapshot.skipped) return [];
  return snapshot.tracks || [];
}

function makeEdge(source, target, item, keyByTrack) {
  const sourceKey = keyByTrack[source].get(item.apple);
  const targetKey = keyByTrack[target].get(item.target);
  if (!sourceKey || !targetKey) return null;
  return {
    source: { platform: source, key: sourceKey, track: item.apple },
    target: { platform: target, key: targetKey, track: item.target },
    score: item.score,
  };
}

function buildCluster(root, refs, matchEdges, union) {
  const sortedRefs = [...refs].sort((a, b) => {
    const platformDiff = PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform);
    return platformDiff || a.index - b.index;
  });
  const platforms = PLATFORMS.filter((platform) => sortedRefs.some((ref) => ref.platform === platform));
  const sources = {};
  for (const platform of platforms) {
    sources[platform] = sortedRefs
      .filter((ref) => ref.platform === platform)
      .map((ref) => compactSourceTrack(ref.track));
  }

  const conflicts = [];
  for (const platform of platforms) {
    if (sources[platform].length <= 1) continue;
    conflicts.push({
      platform,
      count: sources[platform].length,
      tracks: sources[platform],
    });
  }

  const displayRef = chooseDisplayRef(sortedRefs);
  const aliases = mergeAliases(sortedRefs.map((ref) => ref.track));
  const clusterEdges = matchEdges
    .filter((edge) => union.find(edge.source.key) === root && union.find(edge.target.key) === root)
    .map((edge) => ({
      source: compactEndpoint(edge.source),
      target: compactEndpoint(edge.target),
      score: edge.score,
    }));

  const versionReview = buildVersionReview(sources);

  return {
    _root: root,
    id: '',
    title: displayRef.track.title,
    artist: displayRef.track.artist,
    album: displayRef.track.album,
    duration: durationLabel(displayRef.track.durationMs),
    durationMs: displayRef.track.durationMs,
    isrcs: unique(sortedRefs.map((ref) => ref.track.isrc).filter(Boolean)),
    musicbrainzRecordingIds: unique(sortedRefs.flatMap((ref) => ref.track.metadata?.musicbrainz?.recordingIds || [])),
    aliases,
    platforms,
    status: clusterStatus(platforms),
    sources,
    matchEdges: clusterEdges,
    needsReview: conflicts.length > 0 || Boolean(versionReview),
    conflicts,
    versionReview,
    sortKey: normalizeText(`${displayRef.track.title} ${displayRef.track.artist}`),
  };
}

function buildVersionReview(sources) {
  const tracks = Object.entries(sources).flatMap(([platform, items]) => (
    items.map((track) => ({
      platform,
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      durationMs: track.durationMs,
      isrc: track.isrc,
      tags: extractVersionTags(track),
    }))
  ));
  if (tracks.length <= 1) return null;

  const reasons = [];
  const allTags = unique(tracks.flatMap((track) => track.tags.map((tag) => tag.label)));
  const tagSignatures = unique(tracks.map((track) => track.tags.map((tag) => tag.key).sort().join('+')));
  if (allTags.length && tagSignatures.length > 1) {
    reasons.push(`版本标记不一致：${allTags.join(' / ')}`);
  }

  const durationValues = tracks
    .map((track) => track.durationMs)
    .filter((value) => Number.isFinite(value) && value > 0);
  const durationSpreadMs = durationValues.length > 1
    ? Math.max(...durationValues) - Math.min(...durationValues)
    : 0;
  if (durationSpreadMs > 15000) {
    reasons.push(`时长差 ${durationLabel(durationSpreadMs)}`);
  }

  const isrcs = unique(tracks.map((track) => track.isrc).filter(Boolean));
  if (isrcs.length > 1) {
    reasons.push(`ISRC 不一致：${isrcs.join(' / ')}`);
  }

  if (!reasons.length) return null;
  return {
    reasons,
    tags: allTags,
    durationSpreadMs,
    durationSpread: durationSpreadMs ? durationLabel(durationSpreadMs) : '',
    tracks: tracks.map((track) => ({
      platform: track.platform,
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      isrc: track.isrc,
      tags: track.tags.map((tag) => tag.label),
    })),
  };
}

function extractVersionTags(track) {
  const text = `${track.title || ''}`;
  return VERSION_PATTERNS
    .filter((pattern) => pattern.re.test(text))
    .map(({ key, label }) => ({ key, label }));
}

function chooseDisplayRef(refs) {
  return [...refs].sort((a, b) => displayScore(b) - displayScore(a))[0];
}

function displayScore(ref) {
  const track = ref.track;
  let score = 0;
  if (track.title) score += 4;
  if (track.artist) score += 3;
  if (track.album) score += 1;
  if (track.isrc) score += 1;
  if (hasCjk(track.title)) score += 8;
  if (hasKana(track.title)) score += 3;
  if (hasCjk(track.artist)) score += 3;
  if (ref.platform === 'apple') score += 2;
  if (ref.platform === 'qq') score += 1;
  return score;
}

function compactSourceTrack(track) {
  return {
    ...compactTrack(track),
    platform: track.platform,
    durationMs: track.durationMs,
  };
}

function compactEndpoint(endpoint) {
  return {
    platform: endpoint.platform,
    track: compactSourceTrack(endpoint.track),
  };
}

function clusterStatus(platforms) {
  const key = platforms.join('_');
  if (key === 'apple_qq_netease') return 'all_three';
  if (platforms.length === 1) return `${platforms[0]}_only`;
  return key;
}

function compareClusters(a, b) {
  return a.sortKey.localeCompare(b.sortKey, 'zh-CN') || a.status.localeCompare(b.status);
}

function mergeAliases(tracks) {
  return {
    titles: unique(tracks.flatMap((track) => [track.title, ...(track.aliases?.titles || [])])).slice(0, 60),
    artists: unique(tracks.flatMap((track) => [track.artist, ...(track.artists || []), ...(track.aliases?.artists || [])])).slice(0, 60),
    albums: unique(tracks.flatMap((track) => [track.album, ...(track.aliases?.albums || [])])).slice(0, 60),
  };
}

function appendClusterTable(lines, title, clusters, limit = 200) {
  lines.push(`## ${title}`);
  lines.push('');
  if (!clusters.length) {
    lines.push('暂无。');
    lines.push('');
    return;
  }

  lines.push('| ID | 歌曲 | 歌手 | 专辑 | 时长 | 已有来源 | 缺失平台 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const cluster of clusters.slice(0, limit)) {
    const missing = PLATFORMS.filter((platform) => !cluster.platforms.includes(platform))
      .map((platform) => PLATFORM_LABELS[platform])
      .join(' / ');
    lines.push(`| ${cluster.id} | ${esc(cluster.title)} | ${esc(cluster.artist)} | ${esc(cluster.album)} | ${cluster.duration || ''} | ${sourceLabels(cluster.platforms)} | ${esc(missing)} |`);
  }
  if (clusters.length > limit) {
    lines.push(`| ... | ... | ... | ... | ... | 仅显示前 ${limit} 条 | 合计 ${clusters.length} 条 |`);
  }
  lines.push('');
}

function sourceLabels(platforms) {
  return platforms.map((platform) => PLATFORM_LABELS[platform]).join(' / ');
}

function trackListLabel(tracks) {
  return tracks.map((track) => `${track.title} - ${track.artist}`).join('; ');
}

function endpointLabel(endpoint) {
  return `${PLATFORM_LABELS[endpoint.platform]}: ${endpoint.track.title} - ${endpoint.track.artist}`;
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || '').trim();
    const key = normalizeText(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ''));
}

function hasKana(value) {
  return /[\u3040-\u30ff]/u.test(String(value || ''));
}

function esc(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

class UnionFind {
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  add(key) {
    if (this.parent.has(key)) return;
    this.parent.set(key, key);
    this.rank.set(key, 0);
  }

  find(key) {
    const parent = this.parent.get(key);
    if (parent === undefined) {
      this.add(key);
      return key;
    }
    if (parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return leftRoot;

    const leftRank = this.rank.get(leftRoot) || 0;
    const rightRank = this.rank.get(rightRoot) || 0;
    if (leftRank < rightRank) {
      this.parent.set(leftRoot, rightRoot);
      return rightRoot;
    }
    if (leftRank > rightRank) {
      this.parent.set(rightRoot, leftRoot);
      return leftRoot;
    }
    this.parent.set(rightRoot, leftRoot);
    this.rank.set(leftRoot, leftRank + 1);
    return leftRoot;
  }
}
