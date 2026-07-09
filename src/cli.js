#!/usr/bin/env node
import './env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadAppleFile } from './apple.js';
import { compareAppleToPlatform } from './match.js';
import { buildMarkdownReport, compactComparison } from './report.js';
import {
  DATA_DIR,
  PACKAGE_ROOT,
  REPORT_DIR,
  parseArgs,
  parsePort,
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
  mirrorPlan: path.join(DATA_DIR, 'mirror-plan.json'),
};

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});

async function main() {
  const [, , command = 'help', ...rest] = process.argv;
  const args = parseArgs(rest);

  if (command === 'version' || command === '--version' || command === '-v') return version();
  if (command === 'snapshot') return snapshot(args);
  if (command === 'match') return match(args);
  if (command === 'check') return check(args);
  if (command === 'mirror-plan') return mirrorPlan(args);
  if (command === 'mirror-resolve') return mirrorResolve(args);
  if (command === 'mirror-convergence') return mirrorConvergence(args);
  if (command === 'mirror-decision') return mirrorDecision(args);
  if (command === 'mirror-apply') return mirrorApply(args);
  if (command === 'agent-mcp') return agentMcp(args);
  if (command === 'web') return web(args);
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

async function mirrorPlan(args) {
  const target = normalizeMirrorTargetArg(args.target || 'qq');
  const workflow = await loadWorkflow();
  const plan = await withOptionalQuiet(args.json, () => workflow.generateMirrorSyncPlan({
    target,
    threshold: args.threshold,
    reviewThreshold: args['review-threshold'],
  }));
  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  printMirrorPlanSummary(plan);
}

async function mirrorResolve(args) {
  const workflow = await loadWorkflow();
  const plan = await withOptionalQuiet(args.json, () => workflow.resolveMirrorAdds({
    threshold: args.threshold,
    reviewThreshold: args['review-threshold'],
    limit: args.limit,
    offset: args.offset,
    searchLimit: args['search-limit'],
  }));
  if (args.json) {
    console.log(JSON.stringify(plan.addResolution || {}, null, 2));
    return;
  }
  const resolution = plan.addResolution || {};
  console.log(`Mirror add resolution: processed ${resolution.processed || 0}, ready ${resolution.resolved || 0}, review ${resolution.review || 0}, not found ${resolution.notFound || 0}.`);
  if (resolution.hasMore) {
    console.log(`More add operations remain. Re-run mirror-resolve to process the next unresolved batch. Pending before this batch: ${resolution.pendingAdd || 0}.`);
  }
}

async function mirrorConvergence(args) {
  const workflow = await loadWorkflow();
  const result = await withOptionalQuiet(args.json, () => workflow.checkMirrorConvergence({
    target: args.target,
    playlistId: args['playlist-id'],
    refreshTarget: Boolean(args['refresh-target']),
    persist: args.persist !== false && args.persist !== 'false',
  }));
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printMirrorConvergenceSummary(result.convergence);
}

async function mirrorDecision(args) {
  const action = normalizeMirrorDecisionActionArg(args.action);
  const workflow = await loadWorkflow();
  const result = args.items
    ? await withOptionalQuiet(args.json, async () => workflow.saveMirrorDecisionBatch({
      action,
      target: args.target,
      items: await readDecisionItemsFile(resolvePath(args.items)),
    }))
    : await withOptionalQuiet(args.json, () => workflow.saveMirrorDecision({
      key: requiredMirrorDecisionKey(args.key),
      action,
      target: args.target,
      operationId: args['operation-id'],
      reason: args.reason,
      note: args.note,
    }));
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printMirrorDecisionSummary(result, action, Boolean(args.items));
}

async function mirrorApply(args) {
  const dryRun = !args.execute;
  const actions = normalizeActions(args);
  const workflow = await loadWorkflow();
  const result = await withOptionalQuiet(args.json, () => workflow.runMirrorSyncPlan({
    dryRun,
    actions,
    confirmText: args.confirm,
    playlistId: args['playlist-id'],
    batchSize: args['batch-size'],
    force: Boolean(args.force),
  }));
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printMirrorRunSummary(result);
}

async function web(args) {
  if (args.port) process.env.PORT = String(parsePort(args.port, { name: '--port' }));
  if (args.host) process.env.HOST = String(args.host);
  await import('./server.js');
}

async function agentMcp() {
  const { startAgentMcpStdio } = await import('./agent-mcp.js');
  await startAgentMcpStdio();
}

async function version() {
  const pkg = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  console.log(`${pkg.name}@${pkg.version}`);
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

function normalizeMirrorTargetArg(target) {
  const value = String(target || 'qq').trim().toLowerCase();
  if (value === 'qq' || value === 'netease') return value;
  throw new Error('mirror-plan --target must be qq or netease.');
}

function normalizeActions(args = {}) {
  if (args['add-only']) return ['add'];
  if (args['remove-only']) return ['remove'];
  if (!args.actions) return [];
  const actions = String(args.actions)
    .split(',')
    .map((action) => action.trim())
    .filter(Boolean);
  for (const action of actions) {
    if (action !== 'add' && action !== 'remove') {
      throw new Error('--actions only accepts add, remove, or add,remove.');
    }
  }
  return [...new Set(actions)];
}

function normalizeMirrorDecisionActionArg(action) {
  const value = String(action || '').trim().toLowerCase();
  if (['keep', 'separate', 'clear'].includes(value)) return value;
  throw new Error('mirror-decision --action must be keep, separate, or clear.');
}

function requiredMirrorDecisionKey(key) {
  const value = String(key || '').trim();
  if (!value) throw new Error('mirror-decision requires --key for single-item decisions, or --items for batch decisions.');
  return value;
}

async function readDecisionItemsFile(filePath) {
  if (!filePath) throw new Error('mirror-decision --items requires a JSON file path.');
  const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const items = Array.isArray(payload) ? payload : payload.items;
  if (!Array.isArray(items)) throw new Error('mirror-decision --items must point to a JSON array or an object with an items array.');
  return items;
}

async function loadWorkflow() {
  return withOptionalQuiet(true, () => import('./workflow.js'));
}

async function withOptionalQuiet(quiet, action) {
  if (!quiet) return action();
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
  };
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  try {
    return await action();
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
  }
}

function printMirrorPlanSummary(plan) {
  const summary = plan.summary || {};
  console.log(`Mirror plan: Apple -> ${plan.target?.platform || 'target'}`);
  console.log(`  keep:   ${summary.keep || 0}`);
  console.log(`  add:    ${summary.add || 0}`);
  console.log(`  remove: ${summary.remove || 0}`);
  console.log(`  review: ${summary.review || 0}`);
  console.log(`  file:   ${DEFAULTS.mirrorPlan}`);
}

function printMirrorRunSummary(result) {
  const add = result.add || {};
  const remove = result.remove || {};
  const blocked = result.blocked || {};
  const mode = result.skipped ? 'duplicate-skip' : result.dryRun ? 'dry-run' : 'apply';
  console.log(`Mirror ${mode}: ${result.target || 'target'}`);
  if (result.runId) console.log(`  run id:             ${result.runId}`);
  if (result.idempotencyKey) console.log(`  idempotency key:    ${result.idempotencyKey}`);
  if (result.resumed) console.log(`  resumed from:       ${result.resumeOf || result.runId || 'previous checkpoint'}`);
  if (result.skipped) console.log(`  skipped duplicate:  ${result.duplicateOf || result.runId || 'completed run'}`);
  console.log(`  add requested:      ${add.requested || 0}`);
  console.log(`  add executable:     ${add.executable || 0}`);
  console.log(`  add unresolved:     ${add.blocked || blocked.unresolvedAdds || 0}`);
  console.log(`  remove executable:  ${remove.executable || 0}`);
  console.log(`  remove confirmed:   ${result.removeResult?.removed || 0}`);
  console.log(`  review blocked:     ${result.review?.blocked || blocked.reviewItems || 0}`);
}

function printMirrorDecisionSummary(result, action, batch) {
  const decisions = result.decisions || {};
  const plan = result.plan || {};
  const summary = plan.summary || {};
  console.log(`Mirror decision ${batch ? 'batch' : 'item'}: ${action}`);
  if (batch) {
    console.log(`  requested: ${result.requested || 0}`);
    console.log(`  changed:   ${result.changed || 0}`);
    if (result.batchId) console.log(`  batch id:  ${result.batchId}`);
  } else {
    console.log(`  saved:     ${result.item ? 'yes' : 'cleared'}`);
  }
  console.log(`  decisions: ${decisions.total || 0}`);
  console.log(`  add:       ${summary.add || 0}`);
  console.log(`  remove:    ${summary.remove || 0}`);
  console.log(`  review:    ${summary.review || 0}`);
}

function printMirrorConvergenceSummary(convergence = {}) {
  console.log(`Mirror convergence: ${convergence.target || 'target'}`);
  console.log(`  status:           ${convergence.status || 'unknown'}`);
  console.log(`  refreshed target: ${convergence.refreshedTarget ? 'yes' : 'no'}`);
  console.log(`  add:              ${convergence.add || 0}`);
  console.log(`  remove:           ${convergence.remove || 0}`);
  console.log(`  review:           ${convergence.review || 0}`);
  console.log(`  checked at:       ${convergence.checkedAt || ''}`);
}

function help() {
  console.log(`Usage:
  music-likes-sync --version
  music-likes-sync check [--apple data/apple.csv]
  music-likes-sync snapshot --apple data/apple.csv [--qq-cookie data/qq.cookie] [--netease-cookie data/netease.cookie]
  music-likes-sync match [--threshold 0.82] [--review-threshold 0.68]
  music-likes-sync mirror-plan --target qq|netease [--threshold 0.82] [--review-threshold 0.68]
  music-likes-sync mirror-resolve [--limit 50] [--offset 0] [--search-limit 12]
  music-likes-sync mirror-convergence [--refresh-target] [--playlist-id <id>]
  music-likes-sync mirror-decision --action keep|separate|clear (--key <decision-key>|--items decisions.json)
  music-likes-sync mirror-apply [--add-only|--remove-only|--actions add,remove] [--execute] [--confirm "REMOVE QQ"] [--playlist-id <id>] [--force]
  music-likes-sync agent-mcp
  music-likes-sync web [--host 127.0.0.1] [--port 4319]

Options:
  --qq-playlist-id <id>          Compare against a specific QQ Music playlist.
  --netease-playlist-id <id>     Compare against a specific NetEase playlist.
  --qq-uin <uin>                 Override QQ user id.
  --netease-uid <uid>            Override NetEase user id.
  --execute                      Actually mutate the target platform. Without it mirror-apply is a dry-run.
  --confirm <text>               Required for real mirror deletion, for example REMOVE QQ.
  --force                        Re-run even when the same idempotency key is already completed.
  --items <path>                 JSON array or { "items": [...] } for batch mirror-decision.
  --refresh-target                Refresh the target snapshot before mirror-convergence.
  --host <host>                   Host for the local Web UI.
  --port <port>                   Port for the local Web UI.
  --json                         Print machine-readable JSON.

From a source checkout, use the same commands through node ./src/cli.js.
Use agent-mcp as a local stdio MCP server for Hermes or other Agent runtimes; exposed tools are read-only and credential-free.
`);
}
