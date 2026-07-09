#!/usr/bin/env node

import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-fresh-'));
const packageRoot = path.join(tempRoot, 'package');
const installRoot = path.join(tempRoot, 'install');

try {
  const pack = npmPackDryRun();
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const file of pack.files || []) {
    copyPackedFile(file.path);
  }

  const help = runNode(['src/cli.js', 'help']);
  assertIncludes(help.stdout, 'music-likes-sync mirror-plan --target qq|netease', 'CLI help should expose public mirror commands.');
  assertIncludes(help.stdout, 'music-likes-sync mirror-decision --action keep|separate|clear', 'CLI help should expose mirror review decision commands.');
  assertIncludes(help.stdout, 'music-likes-sync agent-mcp', 'CLI help should expose the optional Agent MCP command.');
  assert(!packagePathExists('data'), 'CLI help should not create data/.');
  assert(!packagePathExists('reports'), 'CLI help should not create reports/.');

  const check = runNode(['src/cli.js', 'check']);
  assertIncludes(check.stdout, 'Apple 快照：missing', 'fresh check should report missing Apple snapshot.');
  assertIncludes(check.stdout, 'QQ cookie：missing', 'fresh check should report missing QQ cookie.');
  assertIncludes(check.stdout, '网易云 cookie：missing', 'fresh check should report missing NetEase cookie.');
  assert(!packagePathExists('data'), 'CLI check should not create data/.');
  assert(!packagePathExists('reports'), 'CLI check should not create reports/.');

  const state = runNode(['scripts/check-state.mjs', '--data-dir', 'data', '--json']);
  const statePayload = JSON.parse(state.stdout);
  assert(statePayload.ok === true, 'fresh state validation should pass.');
  assert(statePayload.reports.every((report) => report.skipped === true), 'fresh state validation should skip missing local state.');

  const sourceOnlyCi = runNode(['scripts/check-ci-workflow.mjs'], { allowFailure: true });
  assert(sourceOnlyCi.status !== 0, 'packaged source-only CI workflow check should fail clearly.');
  assertIncludes(sourceOnlyCi.stderr || sourceOnlyCi.stdout, 'source checkout', 'source-only CI workflow check should explain source checkout requirement.');

  const sourceOnlyDocker = runNode(['scripts/docker-smoke.mjs'], { allowFailure: true });
  assert(sourceOnlyDocker.status !== 0, 'packaged Docker smoke should fail clearly because Docker build files are source-only.');
  assertIncludes(sourceOnlyDocker.stdout || sourceOnlyDocker.stderr, 'source checkout', 'packaged Docker smoke should explain source checkout requirement.');

  const snapshot = runNode([
    'src/cli.js',
    'snapshot',
    '--apple',
    'examples/apple.sample.csv',
    '--qq-cookie',
    'missing.qq.cookie',
    '--netease-cookie',
    'missing.netease.cookie',
  ]);
  assertIncludes(snapshot.stdout, 'Apple Music: 3 tracks', 'sample snapshot should import Apple tracks.');
  assertIncludes(snapshot.stdout, 'QQ 音乐: skipped', 'sample snapshot should skip QQ without cookies.');
  assertIncludes(snapshot.stdout, '网易云音乐: skipped', 'sample snapshot should skip NetEase without cookies.');

  const apple = readPackageJson('data/apple.json');
  const qq = readPackageJson('data/qq.json');
  const netease = readPackageJson('data/netease.json');
  assert(apple.tracks.length === 3, 'sample Apple snapshot should contain 3 tracks.');
  assert(qq.skipped === true, 'fresh QQ snapshot should be skipped.');
  assert(netease.skipped === true, 'fresh NetEase snapshot should be skipped.');

  const match = runNode(['src/cli.js', 'match'], { allowFailure: true });
  assert(match.status !== 0, 'match should fail clearly when only skipped target snapshots exist.');
  assertIncludes(match.stderr || match.stdout, '缺少可比较的平台快照', 'match failure should explain missing comparable snapshots.');

  const installed = runTarballInstallSmoke();

  console.log(JSON.stringify({
    ok: true,
    packageFileCount: pack.files.length,
    readonlyCommandsLeftNoData: true,
    tarballInstallBin: installed.binOk,
    tarballRuntimeRoot: installed.runtimeRootOk,
    tarballWeb: installed.webOk,
    tarballTests: installed.testsOk,
    appleTracks: apple.tracks.length,
    qqSkipped: qq.skipped,
    neteaseSkipped: netease.skipped,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function runTarballInstallSmoke() {
  fs.mkdirSync(installRoot, { recursive: true });
  const tarball = npmPackTarball();
  runNpm(['init', '-y'], installRoot);
  runNpm(['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installRoot);

  const bin = path.join(
    installRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'music-likes-sync.cmd' : 'music-likes-sync',
  );
  assert(fs.existsSync(bin), 'installed package should expose node_modules/.bin/music-likes-sync.');

  const pkg = readPackageJson('package.json');
  const version = runCommand(bin, ['--version'], { cwd: installRoot, windowsCmd: process.platform === 'win32' });
  assertIncludes(version.stdout, `${pkg.name}@${pkg.version}`, 'installed CLI bin should print the installed package version.');
  assert(!fs.existsSync(path.join(installRoot, 'data')), 'installed CLI version should not create installRoot data/.');
  assert(!fs.existsSync(path.join(installedPackageRoot(), 'data')), 'installed CLI version should not create package data/.');

  const help = runCommand(bin, ['help'], { cwd: installRoot, windowsCmd: process.platform === 'win32' });
  assertIncludes(help.stdout, 'music-likes-sync mirror-plan --target qq|netease', 'installed CLI bin should expose public mirror commands.');
  assertIncludes(help.stdout, 'music-likes-sync mirror-decision --action keep|separate|clear', 'installed CLI bin should expose mirror review decision commands.');
  assertIncludes(help.stdout, 'music-likes-sync agent-mcp', 'installed CLI bin should expose the optional Agent MCP command.');
  assert(!fs.existsSync(path.join(installRoot, 'data')), 'installed CLI help should not create installRoot data/.');
  assert(!fs.existsSync(path.join(installedPackageRoot(), 'data')), 'installed CLI help should not create package data/.');

  const check = runCommand(bin, ['check'], { cwd: installRoot, windowsCmd: process.platform === 'win32' });
  assertIncludes(check.stdout, `工作目录：${installRoot}`, 'installed CLI check should use the caller working directory as runtime root.');
  assert(!fs.existsSync(path.join(installRoot, 'data')), 'installed CLI check should not create installRoot data/.');
  assert(!fs.existsSync(path.join(installedPackageRoot(), 'data')), 'installed CLI check should not create package data/.');

  runInstalledPackageTests(bin);
  runInstalledWebSmoke(bin);

  const sample = path.join(installedPackageRoot(), 'examples', 'apple.sample.csv');
  const snapshot = runCommand(bin, [
    'snapshot',
    '--apple',
    sample,
    '--qq-cookie',
    'missing.qq.cookie',
    '--netease-cookie',
    'missing.netease.cookie',
  ], { cwd: installRoot, windowsCmd: process.platform === 'win32' });
  assertIncludes(snapshot.stdout, 'Apple Music: 3 tracks', 'installed CLI snapshot should import packaged sample tracks.');

  const installedApple = JSON.parse(fs.readFileSync(path.join(installRoot, 'data', 'apple.json'), 'utf8'));
  assert(installedApple.tracks.length === 3, 'installed CLI should write runtime data under the caller working directory.');
  assert(!fs.existsSync(path.join(installedPackageRoot(), 'data')), 'installed CLI must not write runtime data under node_modules/music-likes-sync.');

  return {
    binOk: true,
    runtimeRootOk: true,
    webOk: true,
    testsOk: true,
  };
}

function runInstalledPackageTests(bin) {
  assert(fs.existsSync(bin), 'installed package tests should run against the installed package bin.');
  const result = runNpm(['test'], installedPackageRoot());
  assertIncludes(result.stdout, 'pass', 'installed package npm test should pass.');
  assert(!fs.existsSync(path.join(installRoot, 'data')), 'installed package npm test should not create installRoot data/.');
  assert(!fs.existsSync(path.join(installedPackageRoot(), 'data')), 'installed package npm test should not create package data/.');
}

function runInstalledWebSmoke(bin) {
  const port = randomPort();
  const command = process.platform === 'win32' ? 'cmd.exe' : bin;
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', windowsCommandLine([bin, 'web', '--host', '127.0.0.1', '--port', String(port)])]
    : ['web', '--host', '127.0.0.1', '--port', String(port)];
  const child = spawn(command, args, {
    cwd: installRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      MUSIC_LIKES_SYNC_LIVE_VALIDATE: '0',
      MUSIC_LIKES_SYNC_OTEL_ENABLED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    waitForInstalledWeb(port, child, () => ({ stdout, stderr }));
    assert(fs.existsSync(path.join(installRoot, 'data')), 'installed Web UI should create runtime data/ under caller working directory.');
    assert(fs.existsSync(path.join(installRoot, 'reports')), 'installed Web UI should create runtime reports/ under caller working directory.');
    assert(!fs.existsSync(path.join(installedPackageRoot(), 'data')), 'installed Web UI must not create package data/.');
    assert(!fs.existsSync(path.join(installedPackageRoot(), 'reports')), 'installed Web UI must not create package reports/.');
  } finally {
    killProcessTree(child);
  }
}

function waitForInstalledWeb(port, child, output) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) {
      const { stdout, stderr } = output();
      throw new Error(`installed Web UI exited early with ${child.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    const probe = spawnSync(process.execPath, [
      '-e',
      `fetch('http://127.0.0.1:${port}/api/state').then(async (response) => { const payload = await response.json(); process.exit(response.ok && payload.ok ? 0 : 1); }).catch(() => process.exit(1));`,
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    if (probe.status === 0) return;
    sleepSync(250);
  }
  const { stdout, stderr } = output();
  throw new Error(`installed Web UI did not answer /api/state on port ${port}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

function randomPort() {
  return 5600 + Math.floor(Math.random() * 1000);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function npmPackDryRun() {
  const stdout = execSync('npm pack --dry-run --json', {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: '1',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
    shell: true,
    windowsHide: true,
  });
  const packs = JSON.parse(stdout);
  if (!Array.isArray(packs) || !packs[0]) {
    throw new Error('npm pack returned no package entries.');
  }
  return packs[0];
}

function npmPackTarball() {
  const { stdout } = runNpm(['pack', '--json', '--pack-destination', tempRoot], ROOT);
  const packs = JSON.parse(stdout);
  const filename = packs?.[0]?.filename;
  if (!filename) throw new Error('npm pack did not return a tarball filename.');
  const tarball = path.isAbsolute(filename) ? filename : path.join(tempRoot, filename);
  if (!fs.existsSync(tarball)) throw new Error(`npm pack tarball was not created: ${tarball}`);
  return tarball;
}

function copyPackedFile(filePath) {
  const source = path.join(ROOT, filePath);
  const destination = path.join(packageRoot, filePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function runNpm(args, cwd) {
  return runCommand(npmCommand(), args, {
    cwd,
    env: npmEnv(),
    windowsCmd: process.platform === 'win32',
  });
}

function runNode(args, options = {}) {
  return runCommand(process.execPath, args, {
    cwd: packageRoot,
    allowFailure: options.allowFailure,
  });
}

function readPackageJson(filePath) {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, filePath), 'utf8'));
}

function packagePathExists(filePath) {
  return fs.existsSync(path.join(packageRoot, filePath));
}

function installedPackageRoot() {
  return path.join(installRoot, 'node_modules', 'music-likes-sync');
}

function runCommand(command, args, options = {}) {
  const useWindowsCmd = Boolean(options.windowsCmd);
  const result = spawnSync(useWindowsCmd ? 'cmd.exe' : command, useWindowsCmd ? ['/d', '/s', '/c', windowsCommandLine([command, ...args])] : args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env || {}),
      MUSIC_LIKES_SYNC_LIVE_VALIDATE: '0',
      MUSIC_LIKES_SYNC_OTEL_ENABLED: '0',
    },
    windowsHide: true,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}\n${result.error?.message || result.stderr || result.stdout}`);
  }
  return result;
}

function windowsCommandLine(parts) {
  return parts.map(quoteWindowsArg).join(' ');
}

function quoteWindowsArg(value) {
  const text = String(value ?? '');
  if (!text) return '""';
  if (!/[\s"&|<>^]/u.test(text)) return text;
  return `"${text.replace(/"/gu, '\\"')}"`;
}

function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return;
  }
  child.kill();
}

function npmCommand() {
  return 'npm';
}

function npmEnv() {
  return {
    ...process.env,
    NO_UPDATE_NOTIFIER: '1',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, expected, message) {
  if (!String(text || '').includes(expected)) {
    throw new Error(`${message}\nExpected to find: ${expected}\nOutput:\n${text}`);
  }
}
