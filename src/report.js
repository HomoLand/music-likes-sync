import { compactTrack } from './match.js';
import { durationLabel } from './normalize.js';

export function buildMarkdownReport(result) {
  const lines = [];
  lines.push('# Apple Music 收藏同步缺口报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  for (const [platform, summary] of Object.entries(result.platforms)) {
    lines.push(`## ${platformLabel(platform)}`);
    lines.push('');
    lines.push(`- Apple 主表：${summary.totalApple}`);
    lines.push(`- ${platformLabel(platform)} 已拉取：${summary.totalPlatform}`);
    lines.push(`- 自动匹配：${summary.matched}`);
    lines.push(`- 需要人工确认：${summary.review}`);
    lines.push(`- 可能缺失：${summary.missing}`);
    lines.push('');

    if (summary.missingItems.length) {
      lines.push('### 可能缺失');
      lines.push('');
      lines.push('| Apple 歌曲 | 歌手 | 专辑 | 时长 | 最接近候选 | 分数 |');
      lines.push('|---|---|---|---|---|---|');
      for (const item of summary.missingItems.slice(0, 200)) {
        lines.push(`| ${esc(item.apple.title)} | ${esc(item.apple.artist)} | ${esc(item.apple.album)} | ${durationLabel(item.apple.durationMs)} | ${candidateLabel(item.best)} | ${item.best?.score?.total ?? ''} |`);
      }
      if (summary.missingItems.length > 200) {
        lines.push(`| ... | ... | ... | ... | 仅显示前 200 条，共 ${summary.missingItems.length} 条 | |`);
      }
      lines.push('');
    }

    if (summary.reviewItems.length) {
      lines.push('### 需要人工确认');
      lines.push('');
      lines.push('| Apple 歌曲 | 候选歌曲 | 分数 |');
      lines.push('|---|---|---|');
      for (const item of summary.reviewItems.slice(0, 200)) {
        lines.push(`| ${trackLabel(item.apple)} | ${trackLabel(item.target)} | ${item.score.total} |`);
      }
      if (summary.reviewItems.length > 200) {
        lines.push(`| ... | 仅显示前 200 条，共 ${summary.reviewItems.length} 条 | |`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

export function compactComparison(summary) {
  return {
    totalApple: summary.totalApple,
    totalPlatform: summary.totalPlatform,
    matched: summary.matched,
    review: summary.review,
    missing: summary.missing,
    matches: summary.matches.map((item) => ({
      apple: compactTrack(item.apple),
      target: compactTrack(item.target),
      score: item.score,
    })),
    reviewItems: summary.reviewItems.map((item) => ({
      apple: compactTrack(item.apple),
      target: compactTrack(item.target),
      score: item.score,
    })),
    missingItems: summary.missingItems.map((item) => ({
      apple: compactTrack(item.apple),
      best: item.best ? {
        target: compactTrack(item.best.target),
        score: item.best.score,
      } : null,
    })),
  };
}

function platformLabel(platform) {
  if (platform === 'qq') return 'QQ 音乐';
  if (platform === 'netease') return '网易云音乐';
  return platform;
}

function trackLabel(track) {
  return `${esc(track.title)} - ${esc(track.artist)}${track.album ? ` / ${esc(track.album)}` : ''}${track.durationMs ? ` / ${durationLabel(track.durationMs)}` : ''}`;
}

function candidateLabel(best) {
  return best ? trackLabel(best.target) : '';
}

function esc(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
