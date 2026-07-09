import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('cli', () => {
  it('documents mirror commands in help without loading provider SDKs', () => {
    const output = execFileSync(process.execPath, ['src/cli.js', 'help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    assert.match(output, /music-likes-sync check/);
    assert.match(output, /mirror-plan --target qq\|netease/);
    assert.match(output, /mirror-resolve/);
    assert.match(output, /mirror-convergence/);
    assert.match(output, /mirror-decision --action keep\|separate\|clear/);
    assert.match(output, /mirror-apply/);
    assert.match(output, /music-likes-sync agent-mcp/);
    assert.match(output, /music-likes-sync web/);
    assert.match(output, /node \.\/src\/cli\.js/);
    assert.doesNotMatch(output, /Loaded \d+ Chinese IP ranges/);
    assert.doesNotMatch(output, /injected env/);
  });

  it('prints package version without creating runtime state', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const output = execFileSync(process.execPath, ['src/cli.js', '--version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();

    assert.equal(output, `${pkg.name}@${pkg.version}`);
  });

  it('rejects invalid web ports before creating runtime state', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-cli-port-'));
    const cliPath = path.resolve('src/cli.js');
    const result = spawnSync(process.execPath, [cliPath, 'web', '--port', 'not-a-port'], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        MUSIC_LIKES_SYNC_OTEL_ENABLED: '0',
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--port must be an integer from 1 to 65535/);
    assert.equal(fs.existsSync(path.join(cwd, 'data')), false);
    assert.equal(fs.existsSync(path.join(cwd, 'reports')), false);
  });

  it('rejects invalid server PORT before creating runtime state', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-server-port-'));
    const serverPath = path.resolve('src/server.js');
    const result = spawnSync(process.execPath, [serverPath], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '70000',
        MUSIC_LIKES_SYNC_OTEL_ENABLED: '0',
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PORT must be an integer from 1 to 65535/);
    assert.equal(fs.existsSync(path.join(cwd, 'data')), false);
    assert.equal(fs.existsSync(path.join(cwd, 'reports')), false);
  });

  it('serves Agent MCP initialize and tools/list over stdio', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-cli-mcp-'));
    const cliPath = path.resolve('src/cli.js');
    const input = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      '',
    ].join('\n');
    const result = spawnSync(process.execPath, [cliPath, 'agent-mcp'], {
      cwd,
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        MUSIC_LIKES_SYNC_OTEL_ENABLED: '0',
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const lines = result.stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    assert.equal(lines[0].result.serverInfo.name, 'music-likes-sync');
    assert.equal(lines[1].result.tools.some((tool) => tool.name === 'get_library_summary'), true);
    assert.equal(fs.existsSync(path.join(cwd, 'data')), false);
    assert.equal(fs.existsSync(path.join(cwd, 'reports')), false);
  });

  it('saves mirror review decisions from a CLI batch JSON file', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-cli-mirror-decision-'));
    const cliPath = path.resolve('src/cli.js');
    const dataDir = path.join(cwd, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'apple.json'), JSON.stringify(snapshot('apple', [
      track('a-1', 'Shared Song', 'Alice', 180000),
      track('a-2', 'Shared Song', 'Alice', 180500),
    ])), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'netease.json'), JSON.stringify(snapshot('netease', [
      track('n-1', 'Shared Song', 'Alice', 180000),
    ])), 'utf8');

    const planResult = spawnSync(process.execPath, [
      cliPath,
      'mirror-plan',
      '--target',
      'netease',
      '--json',
    ], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(planResult.status, 0, planResult.stderr || planResult.stdout);

    const plan = JSON.parse(planResult.stdout);
    const items = plan.operations
      .filter((operation) => operation.action === 'review')
      .map((operation) => ({
        key: operation.decisionKey,
        operationId: operation.id,
        reason: operation.reason,
      }));
    assert.equal(items.length, 2);

    const decisionsPath = path.join(cwd, 'decisions.json');
    fs.writeFileSync(decisionsPath, JSON.stringify({ items }), 'utf8');
    const decisionResult = spawnSync(process.execPath, [
      cliPath,
      'mirror-decision',
      '--action',
      'keep',
      '--items',
      decisionsPath,
      '--json',
    ], {
      cwd,
      encoding: 'utf8',
    });

    assert.equal(decisionResult.status, 0, decisionResult.stderr || decisionResult.stdout);
    const payload = JSON.parse(decisionResult.stdout);
    assert.equal(payload.requested, 2);
    assert.equal(payload.changed, 2);
    assert.equal(payload.plan.summary.review, 0);
    assert.equal(payload.plan.summary.keep, 2);

    const decisions = JSON.parse(fs.readFileSync(path.join(dataDir, 'mirror-decisions.json'), 'utf8'));
    assert.equal(Object.keys(decisions.items).length, 2);
    assert.equal(Object.values(decisions.items).every((item) => item.target === 'netease'), true);
  });
});

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:fixture`,
    fetchedAt: '2026-07-07T00:00:00.000Z',
    skipped: false,
    tracks,
  };
}

function track(id, title, artist, durationMs) {
  return {
    id,
    title,
    artists: [artist],
    album: 'Fixture Album',
    durationMs,
  };
}
