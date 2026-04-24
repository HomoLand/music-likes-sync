#!/usr/bin/env node
import path from 'node:path';
import { loadAppleFile } from './apple.js';
import { compareAppleToPlatform } from './match.js';
import { buildMarkdownReport, compactComparison } from './report.js';
import {
  DATA_DIR,
  REPORT_DIR,
  ensureDirs,
  parseArgs,
  readCookie,
  readJsonIfExists,
  resolvePath,
  writeJson,
  writeText,
} from './utils.js';

const DEFAULTS = {
  appleJson: path.join(DATA_DIR, 'apple.json'),
  qqJson: path.join(DATA_DIR, 'qq.json'),
  neteaseJson: path.join(DATA_DIR, 'netease.json'),
  qqCookie: path.join(DATA_DIR, 'qq.cookie'),
  neteaseCookie: path.join(DATA_DIR, 'netease.cookie'),
  reportJson: path.join(REPORT_DIR, 'matches.json'),
  reportMd: path.join(REPORT_DIR, 'missing.md'),
};

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});

async function main() {
  await ensureDirs();
  const [, , command = 'help', ...rest] = process.argv;
  const args = parseArgs(rest);

  if (command === 'snapshot') return snapshot(args);
  if (command === 'match') return match(args);
  if (command === 'check') return check(args);
  return help();
}

async function snapshot(args) {
  const applePath = resolvePath(args.apple, null);
  const qqCookiePath = resolvePath(args['qq-cookie'], DEFAULTS.qqCookie);
  const neteaseCookiePath = resolvePath(args['netease-cookie'], DEFAULTS.neteaseCookie);

  if (applePath) {
    const apple = await loadAppleFile(applePath);
    await writeJson(DEFAULTS.appleJson, apple);
    console.log(`Apple Music: ${apple.tracks.length} tracks -> ${DEFAULTS.appleJson}`);
  } else {
    console.log('Apple Music: skipped, pass --apple data/apple.csv to import.');
  }

  const qqCookie = await readCookie(qqCookiePath);
  const qq = qqCookie
    ? await fetchQQ(qqCookie, {
      uin: args['qq-uin'],
      playlistId: args['qq-playlist-id'],
    })
    : skippedSnapshot('qq', '未提供 QQ 音乐 cookie');
  await writeJson(DEFAULTS.qqJson, qq);
  console.log(formatSnapshotLine('QQ 音乐', qq, DEFAULTS.qqJson));

  const neteaseCookie = await readCookie(neteaseCookiePath);
  const netease = neteaseCookie
    ? await fetchNetease(neteaseCookie, {
      uid: args['netease-uid'],
      playlistId: args['netease-playlist-id'],
    })
    : skippedSnapshot('netease', '未提供网易云音乐 cookie');
  await writeJson(DEFAULTS.neteaseJson, netease);
  console.log(formatSnapshotLine('网易云音乐', netease, DEFAULTS.neteaseJson));
}

async function match(args) {
  const apple = await readRequiredJson(DEFAULTS.appleJson, '缺少 data/apple.json，请先运行 snapshot --apple ...');
  const qq = await readJsonIfExists(DEFAULTS.qqJson);
  const netease = await readJsonIfExists(DEFAULTS.neteaseJson);
  const result = {
    generatedAt: new Date().toISOString(),
    thresholds: {
      match: Number(args.threshold ?? 0.82),
      review: Number(args['review-threshold'] ?? 0.68),
    },
    platforms: {},
  };

  if (qq && !qq.skipped) {
    result.platforms.qq = compactComparison(compareAppleToPlatform(apple.tracks, qq.tracks, result.thresholds));
  }
  if (netease && !netease.skipped) {
    result.platforms.netease = compactComparison(compareAppleToPlatform(apple.tracks, netease.tracks, result.thresholds));
  }
  if (!Object.keys(result.platforms).length) {
    throw new Error('缺少可比较的平台快照，请先配置 QQ/网易云 cookie 后运行 snapshot。');
  }

  await writeJson(DEFAULTS.reportJson, result);
  await writeText(DEFAULTS.reportMd, buildMarkdownReport(result));
  console.log(`报告已生成：${DEFAULTS.reportMd}`);
  console.log(`机器可读结果：${DEFAULTS.reportJson}`);
}

async function check(args) {
  const applePath = resolvePath(args.apple, null);
  const appleJson = await readJsonIfExists(DEFAULTS.appleJson);
  const qqCookie = await readCookie(resolvePath(args['qq-cookie'], DEFAULTS.qqCookie));
  const neteaseCookie = await readCookie(resolvePath(args['netease-cookie'], DEFAULTS.neteaseCookie));

  console.log(`工作目录：${path.dirname(DATA_DIR)}`);
  console.log(`Apple 导入文件：${applePath || '(未指定)'}`);
  console.log(`Apple 快照：${appleJson ? `${appleJson.tracks?.length ?? 0} tracks` : 'missing'}`);
  console.log(`QQ cookie：${qqCookie ? 'present' : 'missing'}`);
  console.log(`网易云 cookie：${neteaseCookie ? 'present' : 'missing'}`);
}

async function readRequiredJson(filePath, message) {
  const data = await readJsonIfExists(filePath);
  if (!data) throw new Error(message);
  return data;
}

function formatSnapshotLine(label, data, filePath) {
  if (data.skipped) return `${label}: skipped (${data.reason}) -> ${filePath}`;
  return `${label}: ${data.tracks.length} tracks -> ${filePath}`;
}

async function fetchQQ(cookie, options) {
  const { fetchQQLiked } = await import('./providers/qq.js');
  return fetchQQLiked(cookie, options);
}

async function fetchNetease(cookie, options) {
  const { fetchNeteaseLiked } = await import('./providers/netease.js');
  return fetchNeteaseLiked(cookie, options);
}

function skippedSnapshot(platform, reason) {
  return {
    platform,
    source: null,
    fetchedAt: new Date().toISOString(),
    skipped: true,
    reason,
    tracks: [],
  };
}

function help() {
  console.log(`Usage:
  node ./src/cli.js check [--apple data/apple.csv]
  node ./src/cli.js snapshot --apple data/apple.csv [--qq-cookie data/qq.cookie] [--netease-cookie data/netease.cookie]
  node ./src/cli.js match [--threshold 0.82] [--review-threshold 0.68]

Options:
  --qq-playlist-id <id>          Compare against a specific QQ Music playlist.
  --netease-playlist-id <id>     Compare against a specific NetEase playlist.
  --qq-uin <uin>                 Override QQ user id.
  --netease-uid <uid>            Override NetEase user id.
`);
}
