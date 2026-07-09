#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCKER_SMOKE_REPORT_SCHEMA_VERSION = 1;
const requireDocker = hasFlag('--require-docker') || process.env.MUSIC_LIKES_SYNC_REQUIRE_DOCKER === '1';
const writeReport = hasFlag('--write-report');
const tag = readArg('--tag') || `music-likes-sync:smoke-${Date.now()}`;
const port = Number(readArg('--port') || process.env.PORT || 0) || await randomPort();
const reportDir = path.resolve(readArg('--report-dir') || path.join(ROOT, 'reports'));
const reportPath = path.resolve(readArg('--report') || path.join(reportDir, 'docker-smoke.json'));
const dockerfilePath = path.join(ROOT, 'Dockerfile');
const dockerignorePath = path.join(ROOT, '.dockerignore');
const dockerBin = resolveDockerBinary();

const staticChecks = runStaticChecks();
if (!staticChecks.ok) {
  const payload = {
    ok: false,
    skipped: false,
    reason: 'Docker smoke requires source checkout Docker build files.',
    staticChecks,
  };
  await emitPayload(payload);
  process.exitCode = 1;
} else {
  const docker = await getDockerVersion();
  if (!docker.ok) {
    const payload = {
      ok: !requireDocker,
      skipped: true,
      reason: docker.error,
      staticChecks,
    };
    await emitPayload(payload);
    if (!payload.ok) process.exitCode = 1;
  } else {
    const build = await runDocker(['build', '-t', tag, '.'], { timeoutMs: 180000 });
    let containerId = '';
    try {
      const run = await runDocker([
        'run',
        '--rm',
        '-d',
        '-p',
        `${port}:4319`,
        '-e',
        'MUSIC_LIKES_SYNC_OTEL_ENABLED=0',
        tag,
      ], { timeoutMs: 30000 });
      containerId = run.stdout.trim();
      await waitForContainer(port);
      const payload = {
        ok: true,
        skipped: false,
        docker: docker.version,
        image: tag,
        port,
        staticChecks,
        build: {
          ok: true,
          stdoutTail: tail(build.stdout),
          stderrTail: tail(build.stderr),
        },
        runtime: {
          stateOk: true,
        },
      };
      await emitPayload(payload, { writeReportAllowed: payload.ok });
    } finally {
      if (containerId) {
        await runDocker(['rm', '-f', containerId], { timeoutMs: 30000, allowFailure: true });
      }
    }
  }
}

async function emitPayload(payload, options = {}) {
  const output = {
    schemaVersion: DOCKER_SMOKE_REPORT_SCHEMA_VERSION,
    tool: readCurrentPackageInfo(),
    validatedAt: new Date().toISOString(),
    ...payload,
  };
  if (writeReport && options.writeReportAllowed) {
    await fsp.mkdir(path.dirname(reportPath), { recursive: true });
    await fsp.writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    output.report = reportPath;
  }
  console.log(JSON.stringify(output, null, 2));
}

function readCurrentPackageInfo() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return {
    name: String(pkg.name || ''),
    version: String(pkg.version || ''),
  };
}

function runStaticChecks() {
  const checks = [];
  const hasDockerfile = fs.existsSync(dockerfilePath);
  const hasDockerignore = fs.existsSync(dockerignorePath);
  const dockerfile = readFile(dockerfilePath);
  const dockerignore = readFile(dockerignorePath);

  checks.push({
    ok: hasDockerfile,
    message: 'Dockerfile exists in the source checkout',
    expected: 'Dockerfile',
    hint: hasDockerfile ? '' : 'Run Docker smoke from a source checkout; npm package installs intentionally omit Docker build files.',
  });
  checks.push({
    ok: hasDockerignore,
    message: '.dockerignore exists in the source checkout',
    expected: '.dockerignore',
    hint: hasDockerignore ? '' : 'Run Docker smoke from a source checkout; npm package installs intentionally omit Docker build files.',
  });
  checks.push(assertIncludes(dockerfile, 'FROM node:24-alpine', 'uses the intended Node 24 Alpine base image'));
  checks.push(assertIncludes(dockerfile, 'ENV NODE_ENV=production', 'sets production NODE_ENV'));
  checks.push(assertIncludes(dockerfile, 'HOST=0.0.0.0', 'binds the container server to all interfaces'));
  checks.push(assertIncludes(dockerfile, 'RUN npm ci --omit=dev', 'installs production dependencies reproducibly'));
  checks.push(assertIncludes(dockerfile, 'COPY src ./src', 'copies backend source'));
  checks.push(assertIncludes(dockerfile, 'COPY web ./web', 'copies frontend assets'));
  checks.push(assertIncludes(dockerfile, 'EXPOSE 4319', 'documents the web port'));
  checks.push(assertIncludes(dockerfile, 'CMD ["node", "src/server.js"]', 'starts the HTTP server directly'));
  checks.push(assertNotIncludes(dockerfile, 'sed -i', 'does not patch source code during image build'));
  checks.push(assertNotIncludes(dockerfile, 'perl -', 'does not patch source code during image build'));
  checks.push(assertIncludes(dockerignore, 'node_modules/', 'excludes node_modules from build context'));
  checks.push(assertIncludes(dockerignore, 'data/', 'excludes private runtime data from build context'));
  checks.push(assertIncludes(dockerignore, 'reports/', 'excludes generated reports from build context'));
  checks.push(assertIncludes(dockerignore, '.env', 'excludes local env files from build context'));

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

async function getDockerVersion() {
  try {
    const result = await runDocker(['--version'], { timeoutMs: 10000 });
    return { ok: true, version: result.stdout.trim() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function waitForContainer(containerPort) {
  const baseUrl = `http://127.0.0.1:${containerPort}`;
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const response = await fetch(`${baseUrl}/api/state`, { cache: 'no-store' });
      const payload = await response.json();
      if (response.ok && payload.ok) return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Container did not answer ${baseUrl}/api/state`);
}

function runDocker(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBin, args, {
      cwd: ROOT,
      env: dockerProcessEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`docker ${args.join(' ')} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs || 60000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || options.allowFailure) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`docker ${args.join(' ')} failed with ${code}\n${tail(stderr || stdout)}`));
      }
    });
  });
}

function resolveDockerBinary() {
  const configured = process.env.DOCKER_BIN || process.env.DOCKER;
  if (configured) return configured;
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
    ];
    const candidate = candidates.find((filePath) => fs.existsSync(filePath));
    if (candidate) return candidate;
  }
  return 'docker';
}

function dockerProcessEnv() {
  const env = { ...process.env };
  const dir = path.dirname(dockerBin);
  if (dir && dir !== '.') {
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
    const currentPath = env[pathKey] || env.PATH || '';
    const delimiter = process.platform === 'win32' ? ';' : ':';
    if (!currentPath.split(delimiter).some((part) => part.toLowerCase() === dir.toLowerCase())) {
      env[pathKey] = `${dir}${delimiter}${currentPath}`;
    }
  }
  return env;
}

function readFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function assertIncludes(text, needle, message) {
  return {
    ok: text.includes(needle),
    message,
    expected: needle,
  };
}

function assertNotIncludes(text, needle, message) {
  return {
    ok: !text.includes(needle),
    message,
    forbidden: needle,
  };
}

function tail(value) {
  return String(value || '').split(/\r?\n/).filter(Boolean).slice(-20).join('\n');
}

function randomPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selected = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(selected);
      });
    });
  });
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
