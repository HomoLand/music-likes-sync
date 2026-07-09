#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-sync-agent-mcp-smoke-'));
const child = spawn(process.execPath, ['src/cli.js', 'agent-mcp'], {
  cwd: ROOT,
  env: {
    ...process.env,
    MUSIC_LIKES_SYNC_HOME: tempRoot,
    MUSIC_LIKES_SYNC_OTEL_ENABLED: '0',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

const responses = new Map();
const pending = new Map();
let stdout = '';
let stderr = '';

child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

const rl = readline.createInterface({
  input: child.stdout,
  crlfDelay: Infinity,
  terminal: false,
});

rl.on('line', (line) => {
  stdout += `${line}\n`;
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }
  if (payload?.id !== undefined && pending.has(payload.id)) {
    pending.get(payload.id)(payload);
    pending.delete(payload.id);
  } else if (payload?.id !== undefined) {
    responses.set(payload.id, payload);
  }
});

try {
  const initialized = await sendMcp({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      clientInfo: { name: 'agent-mcp-smoke', version: '1.0.0' },
      protocolVersion: '2024-11-05',
    },
  });
  assert(initialized.result?.serverInfo?.name === 'music-likes-sync', 'MCP initialize should identify music-likes-sync.');

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const listed = await sendMcp({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  const tools = listed.result?.tools || [];
  assert(tools.length >= 11, `MCP tools/list should expose read-only and draft tools, got ${tools.length}.`);
  assert(tools.some((tool) => tool.name === 'get_track_evidence' && tool.annotations?.readOnlyHint === true), 'MCP tools/list should expose get_track_evidence as a read-only tool.');
  assert(tools.some((tool) => tool.name === 'get_baseline_diff' && tool.annotations?.readOnlyHint === true), 'MCP tools/list should expose get_baseline_diff as a read-only tool.');
  assert(tools.some((tool) => tool.name === 'get_review_queue' && tool.annotations?.readOnlyHint === true), 'MCP tools/list should expose get_review_queue as a read-only tool.');
  assert(tools.some((tool) => tool.name === 'save_local_shortlist' && tool.annotations?.readOnlyHint === false), 'MCP tools/list should expose save_local_shortlist as a local draft tool.');
  assert(tools.filter((tool) => tool.name !== 'save_local_shortlist').every((tool) => tool.annotations?.readOnlyHint === true), 'Every non-draft MCP tool should advertise readOnlyHint.');
  assert(tools.every((tool) => tool.annotations?.destructiveHint === false), 'MCP tools must not advertise destructive behavior.');
  assert(!JSON.stringify(tools).match(/cookie|apikey|api_key|secret/i), 'MCP tools/list must not expose credential-shaped fields.');

  const called = await sendMcp({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'get_sync_policy',
      arguments: {},
      _meta: { sessionId: 'agent-mcp-smoke-session' },
    },
  });
  assert(called.result?.isError === false, 'MCP tools/call should succeed for get_sync_policy.');
  assert(called.result?.structuredContent?.readOnly === true, 'MCP tools/call response should be marked read-only.');
  assert(called.result?.structuredContent?.mutatesProvider === false, 'MCP tools/call response should be non-mutating.');
  assert(called.result?.structuredContent?.exposesCredentials === false, 'MCP tools/call response should be credential-free.');
  assert(!JSON.stringify(called).includes('sk-'), 'MCP tools/call output must not expose API keys.');

  const forbidden = await sendMcp({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'delete_provider_track',
      arguments: {},
    },
  });
  assert(forbidden.error?.code === -32001, 'MCP should reject direct provider mutation-shaped tool calls.');

  child.stdin.end();
  await waitForExit();

  const tracePath = path.join(tempRoot, 'data', 'agent-sessions.json');
  const traces = JSON.parse(await fs.readFile(tracePath, 'utf8'));
  const traceText = JSON.stringify(traces);
  const trace = traces.sessions?.[0]?.toolTraces?.find((item) => item.tool === 'get_sync_policy');
  assert(trace, 'MCP tools/call should persist a sanitized local Agent trace.');
  assert(trace.source === 'mcp', 'MCP Agent trace should record source=mcp.');
  assert(trace.readOnly === true, 'MCP Agent trace should be read-only.');
  assert(trace.mutatesProvider === false, 'MCP Agent trace should be non-mutating.');
  assert(trace.exposesCredentials === false, 'MCP Agent trace should be credential-free.');
  assert(!traceText.match(/cookie|apikey|api_key|secret|sk-/i), 'MCP Agent trace must not persist credential-shaped data.');

  console.log(JSON.stringify({
    ok: true,
    tools: tools.length,
    calledTool: trace.tool,
    traceSource: trace.source,
    runtimeRoot: tempRoot,
  }, null, 2));
} catch (error) {
  child.kill();
  console.error(JSON.stringify({
    ok: false,
    error: error.message || String(error),
    stdout,
    stderr,
  }, null, 2));
  process.exit(1);
}

function sendMcp(message) {
  const id = message.id;
  if (responses.has(id)) {
    const response = responses.get(id);
    responses.delete(id);
    return response;
  }
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for MCP response id ${id}. stderr=${stderr}`));
    }, 10000);
    pending.set(id, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
  child.stdin.write(`${JSON.stringify(message)}\n`);
  return promise;
}

function waitForExit() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out waiting for MCP process exit.'));
    }, 10000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) resolve();
      else reject(new Error(`MCP process exited with ${code}. stderr=${stderr}`));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
