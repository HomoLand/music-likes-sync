import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('Docker smoke report artifact fetcher', () => {
  it('downloads the latest successful CI artifact and writes a validated Docker report', () => {
    const fixture = setupFakeGh(fixtureDockerReport());
    const outputPath = path.join(fixture.tempDir, 'reports', 'docker-smoke.json');

    const result = runFetcher(['--repo', 'owner/music-likes-sync', '--report', outputPath], fixture);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.repo, 'owner/music-likes-sync');
    assert.equal(payload.runId, '987654321');
    assert.equal(payload.artifact, 'docker-smoke-report-node-24');
    assert.equal(payload.report, outputPath);

    const saved = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(saved.ok, true);
    assert.equal(saved.skipped, false);
    assert.equal(saved.runtime.stateOk, true);

    const calls = fs.readFileSync(fixture.logPath, 'utf8')
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.deepEqual(calls[0].slice(0, 8), [
      'run',
      'list',
      '--workflow',
      'ci.yml',
      '--status',
      'success',
      '--limit',
      '20',
    ]);
    assert.deepEqual(calls[1].slice(0, 6), [
      'run',
      'download',
      '987654321',
      '--name',
      'docker-smoke-report-node-24',
      '--dir',
    ]);
    assert.doesNotMatch(result.stdout, /cookie|qm_keyst|MUSIC_U|authorization/iu);
  });

  it('rejects skipped artifact reports before writing release evidence', () => {
    const report = {
      ...fixtureDockerReport(),
      skipped: true,
    };
    const fixture = setupFakeGh(report);
    const outputPath = path.join(fixture.tempDir, 'reports', 'docker-smoke.json');

    const result = runFetcher(['--repo', 'owner/music-likes-sync', '--report', outputPath], fixture);

    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(outputPath), false);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.ok, false);
    assert.match(payload.message, /skipped must be false/);
  });
});

function runFetcher(args, fixture) {
  return spawnSync(process.execPath, ['scripts/fetch-docker-report.mjs', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MUSIC_LIKES_SYNC_GH_COMMAND_JSON: JSON.stringify([process.execPath, fixture.fakeGhPath]),
      FAKE_GH_LOG: fixture.logPath,
      FAKE_DOCKER_REPORT: fixture.reportPath,
    },
    encoding: 'utf8',
    windowsHide: true,
  });
}

function setupFakeGh(report) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-fetch-docker-report-'));
  const fakeGhPath = path.join(tempDir, 'fake-gh.mjs');
  const reportPath = path.join(tempDir, 'fixture-docker-smoke.json');
  const logPath = path.join(tempDir, 'gh-calls.jsonl');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(fakeGhPath, `
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n', 'utf8');

if (args[0] === 'run' && args[1] === 'list') {
  console.log(JSON.stringify([{
    databaseId: 987654321,
    status: 'completed',
    conclusion: 'success',
    headBranch: 'main',
    createdAt: new Date().toISOString(),
    workflowName: 'CI',
    displayTitle: 'CI fixture'
  }]));
  process.exit(0);
}

if (args[0] === 'run' && args[1] === 'download') {
  const dir = args[args.indexOf('--dir') + 1];
  const targetDir = path.join(dir, 'reports');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(process.env.FAKE_DOCKER_REPORT, path.join(targetDir, 'docker-smoke.json'));
  process.exit(0);
}

console.error('unexpected fake gh call: ' + JSON.stringify(args));
process.exit(1);
`, 'utf8');
  return { tempDir, fakeGhPath, reportPath, logPath };
}

function fixtureDockerReport() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return {
    schemaVersion: 1,
    tool: {
      name: pkg.name,
      version: pkg.version,
    },
    ok: true,
    skipped: false,
    validatedAt: new Date().toISOString(),
    docker: 'Docker version 28.0.0, build fixture',
    image: 'music-likes-sync:smoke-fixture',
    staticChecks: {
      ok: true,
    },
    build: {
      ok: true,
    },
    runtime: {
      stateOk: true,
    },
  };
}
