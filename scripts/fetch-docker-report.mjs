#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKFLOW = 'ci.yml';
const DEFAULT_ARTIFACT = 'docker-smoke-report-node-24';
const DOCKER_SMOKE_REPORT_SCHEMA_VERSION = 1;
const REPORT_MAX_AGE_DAYS = 14;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const SECRET_KEY_PATTERN = /(^|[._-])(authorization|cookie|csrf|music_u|password|qm_keyst|secret|session|token)([._-]|$)/iu;
const SECRET_VALUE_PATTERNS = [
  /\bMUSIC_U\s*=\s*[^;\s]+/iu,
  /\bqm_keyst\s*=\s*[^;\s]+/iu,
  /\bcookie\s*:\s*[^;\n]+/iu,
  /\bauthorization\s*:\s*(?:bearer|basic)\s+[^;\s]+/iu,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{16,}/u,
];

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || path.join(ROOT, 'reports', 'docker-smoke.json'));
const repo = args.repo || inferRepo();
const workflow = args.workflow || DEFAULT_WORKFLOW;
const artifact = args.artifact || DEFAULT_ARTIFACT;
const branch = args.branch || '';
const runId = args.runId || '';
const dryRun = Boolean(args.dryRun);

if (!repo) {
  fail('No GitHub repository could be inferred. Pass --repo owner/name or configure a GitHub remote.');
}

const selectedRun = runId
  ? { databaseId: String(runId), source: 'argument' }
  : selectLatestSuccessfulRun({ repo, workflow, branch });

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-docker-report-'));
try {
  runGh([
    'run',
    'download',
    String(selectedRun.databaseId),
    '--name',
    artifact,
    '--dir',
    tempDir,
    '--repo',
    repo,
  ]);
  const downloadedReport = findReport(tempDir);
  if (!downloadedReport) {
    fail(`Downloaded artifact did not contain docker-smoke.json: ${artifact}`);
  }
  const report = readJson(downloadedReport);
  const errors = validateDockerReport(report, readCurrentPackageInfo());
  if (errors.length) {
    fail(`Docker smoke report from ${artifact} is not valid release evidence: ${errors.join('; ')}`);
  }

  if (!dryRun) {
    await fsp.mkdir(path.dirname(reportPath), { recursive: true });
    await fsp.copyFile(downloadedReport, reportPath);
  }

  console.log(JSON.stringify({
    ok: true,
    repo,
    workflow,
    artifact,
    runId: String(selectedRun.databaseId),
    branch: selectedRun.headBranch || branch || '',
    report: dryRun ? '' : reportPath,
    dryRun,
    validatedAt: report.validatedAt || '',
    docker: report.docker || '',
    image: report.image || '',
  }, null, 2));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function selectLatestSuccessfulRun(options = {}) {
  const listArgs = [
    'run',
    'list',
    '--workflow',
    options.workflow,
    '--status',
    'success',
    '--limit',
    '20',
    '--json',
    'databaseId,status,conclusion,headBranch,createdAt,workflowName,displayTitle',
    '--repo',
    options.repo,
  ];
  if (options.branch) listArgs.push('--branch', options.branch);

  const result = runGh(listArgs);
  const runs = parseJson(result.stdout, 'GitHub run list output');
  const candidates = Array.isArray(runs) ? runs : [];
  const selected = candidates.find((run) => (
    run?.databaseId
    && (!run.status || run.status === 'completed')
    && (!run.conclusion || run.conclusion === 'success')
  ));
  if (!selected) {
    const branchMessage = options.branch ? ` on branch ${options.branch}` : '';
    fail(`No successful ${options.workflow} run found for ${options.repo}${branchMessage}.`);
  }
  return selected;
}

function inferRepo() {
  const remote = runGit(['config', '--get', 'remote.origin.url'], { allowFailure: true }).stdout.trim();
  return parseGitHubRepo(remote);
}

function parseGitHubRepo(remote) {
  const value = String(remote || '').trim();
  if (!value) return '';
  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/iu);
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;
  const sshMatch = value.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/iu);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
  const sshUrlMatch = value.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/iu);
  if (sshUrlMatch) return `${sshUrlMatch[1]}/${sshUrlMatch[2]}`;
  return '';
}

function findReport(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findReport(fullPath);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === 'docker-smoke.json') {
      return fullPath;
    }
  }
  return '';
}

function validateDockerReport(report = {}, expectedPackage = {}) {
  const errors = [];
  if (report.schemaVersion !== DOCKER_SMOKE_REPORT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${DOCKER_SMOKE_REPORT_SCHEMA_VERSION}`);
  }
  if (report.tool?.name !== expectedPackage.name) {
    errors.push(`tool.name must be ${expectedPackage.name}`);
  }
  if (report.tool?.version !== expectedPackage.version) {
    errors.push(`tool.version must be ${expectedPackage.version}`);
  }
  if (report.ok !== true) errors.push('ok must be true');
  if (report.skipped !== false) errors.push('skipped must be false');
  if (!report.validatedAt || Number.isNaN(Date.parse(report.validatedAt))) {
    errors.push('validatedAt must be an ISO timestamp');
  } else {
    const timestamp = Date.parse(report.validatedAt);
    const now = Date.now();
    if (timestamp > now + FUTURE_SKEW_MS) errors.push('validatedAt is too far in the future');
    if (now - timestamp > REPORT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      errors.push(`validatedAt is older than ${REPORT_MAX_AGE_DAYS} days`);
    }
  }
  if (!String(report.docker || '').trim()) errors.push('docker version is required');
  if (!String(report.image || '').trim()) errors.push('image is required');
  if (report.staticChecks?.ok !== true) errors.push('staticChecks.ok must be true');
  if (report.build?.ok !== true) errors.push('build.ok must be true');
  if (report.runtime?.stateOk !== true) errors.push('runtime.stateOk must be true');
  errors.push(...credentialLeakErrors(report));
  return errors;
}

function credentialLeakErrors(value, trail = []) {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...credentialLeakErrors(item, [...trail, String(index)]));
    });
    return errors;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        errors.push(`credential-shaped key ${[...trail, key].join('.')} is not allowed`);
      }
      errors.push(...credentialLeakErrors(nested, [...trail, key]));
    }
    return errors;
  }
  if (typeof value === 'string') {
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        errors.push(`credential-shaped value at ${trail.join('.') || '<root>'} is not allowed`);
      }
    }
  }
  return errors;
}

function runGh(argsForGh) {
  const command = ghCommand();
  const result = spawnSync(command.bin, [...command.prefixArgs, ...argsForGh], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail(`gh ${argsForGh.join(' ')} failed: ${String(result.stderr || result.stdout || result.error?.message || '').trim()}`);
  }
  return result;
}

function runGit(argsForGit, options = {}) {
  const result = spawnSync('git', argsForGit, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 && !options.allowFailure) {
    fail(`git ${argsForGit.join(' ')} failed: ${String(result.stderr || result.stdout || result.error?.message || '').trim()}`);
  }
  return result;
}

function ghCommand() {
  if (process.env.MUSIC_LIKES_SYNC_GH_COMMAND_JSON) {
    const command = parseJson(process.env.MUSIC_LIKES_SYNC_GH_COMMAND_JSON, 'MUSIC_LIKES_SYNC_GH_COMMAND_JSON');
    if (!Array.isArray(command) || command.length === 0 || !command.every((part) => typeof part === 'string' && part)) {
      fail('MUSIC_LIKES_SYNC_GH_COMMAND_JSON must be a non-empty JSON string array.');
    }
    return { bin: command[0], prefixArgs: command.slice(1) };
  }
  return { bin: 'gh', prefixArgs: [] };
}

function readJson(filePath) {
  return parseJson(fs.readFileSync(filePath, 'utf8'), filePath);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`Invalid JSON in ${label}: ${error.message}`);
  }
}

function readCurrentPackageInfo() {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  return {
    name: String(pkg.name || ''),
    version: String(pkg.version || ''),
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (!arg.startsWith('--')) fail(`Unknown argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${arg}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/fetch-docker-report.mjs [options]

Downloads the CI docker-smoke-report-node-24 artifact and writes reports/docker-smoke.json.

Options:
  --repo <owner/name>      GitHub repository. Defaults to remote.origin when it is a GitHub remote.
  --run-id <id>           Download from a specific workflow run instead of the latest successful run.
  --workflow <name>       Workflow file or name. Default: ${DEFAULT_WORKFLOW}.
  --artifact <name>       Artifact name. Default: ${DEFAULT_ARTIFACT}.
  --branch <name>         Restrict latest-run lookup to one branch.
  --report <path>         Output report path. Default: reports/docker-smoke.json.
  --dry-run               Validate the artifact without writing the report.
`);
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, message }, null, 2));
  process.exit(1);
}
