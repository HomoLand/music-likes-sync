#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_VALIDATION_REPORT_SCHEMA_VERSION } from '../src/live-validation.js';
import { REPORT_DIR } from '../src/utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPORTS_DIR = REPORT_DIR;
const REQUIRED_TARGETS = ['qq', 'netease'];
const DOCKER_SMOKE_REPORT_SCHEMA_VERSION = 1;
const DOCKER_REPORT_MAX_AGE_DAYS = 14;
const LIVE_REPORT_MAX_AGE_DAYS = 14;
const LIVE_REPORT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const STRICT_TEST_BYPASS_ENV = 'MUSIC_LIKES_SYNC_STRICT_TEST_BYPASS';
const SECRET_KEY_PATTERN = /(^|[._-])(authorization|cookie|csrf|music_u|password|qm_keyst|secret|session|token)([._-]|$)/iu;
const SECRET_VALUE_PATTERNS = [
  /\bMUSIC_U\s*=\s*[^;\s]+/iu,
  /\bqm_keyst\s*=\s*[^;\s]+/iu,
  /\bcookie\s*:\s*[^;\n]+/iu,
  /\bauthorization\s*:\s*(?:bearer|basic)\s+[^;\s]+/iu,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{16,}/u,
];

const args = parseArgs(process.argv.slice(2));
const reportsDir = path.resolve(args.reportsDir || DEFAULT_REPORTS_DIR);
const dockerReportPath = path.resolve(args.dockerReport || path.join(reportsDir, 'docker-smoke.json'));
const packageInfo = readCurrentPackageInfo();
const checks = [
  checkDockerSmoke({ skip: args.skipDockerCheck, dockerReportPath, packageInfo }),
  ...REQUIRED_TARGETS.map((target) => checkLiveReport(target, reportsDir, packageInfo)),
];

const result = {
  ok: checks.every((check) => check.ok),
  status: checks.every((check) => check.ok) ? 'release_ready' : 'blocked',
  reportsDir,
  checks,
};

const output = JSON.stringify(result, null, 2);
if (!result.ok) {
  console.error(output);
  process.exit(1);
}

console.log(output);

function checkDockerSmoke(options = {}) {
  if (options.skip) {
    if (process.env[STRICT_TEST_BYPASS_ENV] !== '1') {
      return {
        id: 'docker.smoke',
        ok: false,
        skipped: false,
        message: `--skip-docker-check requires ${STRICT_TEST_BYPASS_ENV}=1 and is only for tests.`,
      };
    }
    return {
      id: 'docker.smoke',
      ok: true,
      skipped: true,
      message: 'Docker check skipped by explicit test-only flag.',
    };
  }

  const result = spawnSync(process.execPath, ['./scripts/docker-smoke.mjs', '--require-docker'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 240000,
  });
  const payload = parseJsonOutput(result.stdout || result.stderr);
  const ok = result.status === 0 && payload?.ok === true && payload?.skipped === false;
  if (ok) {
    return {
      id: 'docker.smoke',
      ok,
      message: 'Docker build/run smoke passed.',
      docker: payload?.docker || '',
      image: payload?.image || '',
      skipped: false,
    };
  }

  const reportCheck = checkDockerReport(options.dockerReportPath, options.packageInfo, {
    dockerError: payload?.reason || result.error?.message || String(result.stderr || result.stdout || '').trim() || 'Docker smoke failed.',
  });
  return reportCheck;
}

function checkDockerReport(filePath, expectedPackage, options = {}) {
  const base = {
    id: 'docker.smoke',
    file: filePath,
    fromReport: true,
  };
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      ...base,
      exists: false,
      ok: false,
      message: `Docker smoke failed (${options.dockerError || 'no live Docker run'}); missing Docker evidence report.`,
    };
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      ...base,
      exists: true,
      ok: false,
      message: `Docker smoke failed (${options.dockerError || 'no live Docker run'}); invalid Docker evidence JSON: ${error.message}`,
    };
  }

  const errors = validateDockerReport(report, expectedPackage);
  return {
    ...base,
    exists: true,
    ok: errors.length === 0,
    message: errors.length
      ? `Docker smoke failed (${options.dockerError || 'no live Docker run'}); Docker evidence report invalid: ${errors.join('; ')}`
      : 'Docker build/run smoke evidence report is complete.',
    docker: report.docker || '',
    image: report.image || '',
    validatedAt: report.validatedAt || '',
    skipped: Boolean(report.skipped),
  };
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
  }
  errors.push(...validationFreshnessErrors(report, {
    maxAgeDays: DOCKER_REPORT_MAX_AGE_DAYS,
    label: 'validatedAt',
  }));
  if (!String(report.docker || '').trim()) errors.push('docker version is required');
  if (!String(report.image || '').trim()) errors.push('image is required');
  if (report.staticChecks?.ok !== true) errors.push('staticChecks.ok must be true');
  if (report.build?.ok !== true) errors.push('build.ok must be true');
  if (report.runtime?.stateOk !== true) errors.push('runtime.stateOk must be true');
  errors.push(...credentialLeakErrors(report));
  return errors;
}

function parseJsonOutput(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readCurrentPackageInfo() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return {
    name: String(pkg.name || ''),
    version: String(pkg.version || ''),
  };
}

function checkLiveReport(target, dir, expectedPackage) {
  const filePath = path.join(dir, `live-validation-${target}.json`);
  const base = {
    id: `live.${target}`,
    target,
    file: filePath,
  };
  if (!fs.existsSync(filePath)) {
    return {
      ...base,
      ok: false,
      message: `Missing ${target} live validation evidence report.`,
    };
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      ...base,
      ok: false,
      message: `Invalid JSON: ${error.message}`,
    };
  }

  const errors = validateLiveReport(target, report, expectedPackage);
  return {
    ...base,
    ok: errors.length === 0,
    message: errors.length ? errors.join('; ') : 'Live add/remove validation evidence is complete.',
    validatedAt: report.validatedAt || '',
    playlistIdPresent: Boolean(String(report.playlistId || '').trim()),
    createdPlaylist: Boolean(report.createdPlaylist),
  };
}

function validateLiveReport(target, report = {}, expectedPackage = {}) {
  const errors = [];
  if (report.schemaVersion !== LIVE_VALIDATION_REPORT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${LIVE_VALIDATION_REPORT_SCHEMA_VERSION}`);
  }
  if (report.tool?.name !== expectedPackage.name) {
    errors.push(`tool.name must be ${expectedPackage.name}`);
  }
  if (report.tool?.version !== expectedPackage.version) {
    errors.push(`tool.version must be ${expectedPackage.version}`);
  }
  if (report.ok !== true) errors.push('ok must be true');
  if (report.verified !== true) errors.push('verified must be true');
  if (report.target !== target) errors.push(`target must be ${target}`);
  if (!report.validatedAt || Number.isNaN(Date.parse(report.validatedAt))) {
    errors.push('validatedAt must be an ISO timestamp');
  }
  errors.push(...validationFreshnessErrors(report));
  if (!String(report.playlistId || '').trim()) errors.push('playlistId is required');
  if (typeof report.createdPlaylist !== 'boolean') errors.push('createdPlaylist must be boolean');
  if (!report.track?.id && !report.track?.mid) errors.push('validated track id or mid is required');
  errors.push(...credentialLeakErrors(report));

  for (const key of ['before', 'afterAdd', 'afterRemove']) {
    const snapshot = report.snapshots?.[key];
    if (!snapshot || !Number.isInteger(snapshot.trackCount)) {
      errors.push(`snapshots.${key}.trackCount must be an integer`);
    }
    if (!snapshot?.fetchedAt || Number.isNaN(Date.parse(snapshot.fetchedAt))) {
      errors.push(`snapshots.${key}.fetchedAt must be an ISO timestamp`);
    }
    if (typeof snapshot?.containsValidatedTrack !== 'boolean') {
      errors.push(`snapshots.${key}.containsValidatedTrack must be boolean`);
    }
    if (String(snapshot?.playlistId || '').trim() !== String(report.playlistId || '').trim()) {
      errors.push(`snapshots.${key}.playlistId must match playlistId`);
    }
  }

  if (!acceptedMutation(report.add)) errors.push('add mutation must be accepted');
  if (!acceptedMutation(report.remove)) errors.push('remove mutation must be accepted');
  if (report.add?.verified !== true) errors.push('add mutation must be verified');
  if (report.remove?.verified !== true) errors.push('remove mutation must be verified');
  if (Number(report.add?.added || 0) < 1) errors.push('add mutation must report one added track');
  if (Number(report.remove?.removed || 0) < 1) errors.push('remove mutation must report one removed track');
  errors.push(...snapshotProgressionErrors(report));
  errors.push(...snapshotPresenceErrors(report));
  errors.push(...snapshotTimeOrderErrors(report));
  return errors;
}

function validationFreshnessErrors(report = {}, options = {}) {
  const now = options.now || new Date();
  const maxAgeDays = options.maxAgeDays || LIVE_REPORT_MAX_AGE_DAYS;
  const label = options.label || 'validatedAt';
  const validatedAt = Date.parse(report.validatedAt || '');
  if (Number.isNaN(validatedAt)) return [];

  const nowMs = now.getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const errors = [];
  if (validatedAt > nowMs + LIVE_REPORT_FUTURE_SKEW_MS) {
    errors.push(`${label} must not be in the future`);
  }
  if (validatedAt < nowMs - maxAgeMs) {
    errors.push(`${label} must be within ${maxAgeDays} days`);
  }
  return errors;
}

function acceptedMutation(result = {}) {
  const submitted = Number(result.submitted || 0);
  const accepted = Number(result.accepted || 0);
  const changed = Number(result.added || 0) + Number(result.removed || 0);
  return submitted > 0 && (accepted > 0 || changed > 0);
}

function snapshotProgressionErrors(report = {}) {
  const before = report.snapshots?.before?.trackCount;
  const afterAdd = report.snapshots?.afterAdd?.trackCount;
  const afterRemove = report.snapshots?.afterRemove?.trackCount;
  if (![before, afterAdd, afterRemove].every(Number.isInteger)) return [];

  const errors = [];
  if (afterAdd !== before + 1) {
    errors.push('snapshots.afterAdd.trackCount must equal snapshots.before.trackCount + 1');
  }
  if (afterRemove !== before) {
    errors.push('snapshots.afterRemove.trackCount must equal snapshots.before.trackCount');
  }
  return errors;
}

function snapshotPresenceErrors(report = {}) {
  const before = report.snapshots?.before?.containsValidatedTrack;
  const afterAdd = report.snapshots?.afterAdd?.containsValidatedTrack;
  const afterRemove = report.snapshots?.afterRemove?.containsValidatedTrack;
  if (![before, afterAdd, afterRemove].every((value) => typeof value === 'boolean')) return [];

  const errors = [];
  if (before !== false) errors.push('snapshots.before.containsValidatedTrack must be false');
  if (afterAdd !== true) errors.push('snapshots.afterAdd.containsValidatedTrack must be true');
  if (afterRemove !== false) errors.push('snapshots.afterRemove.containsValidatedTrack must be false');
  return errors;
}

function snapshotTimeOrderErrors(report = {}) {
  const before = Date.parse(report.snapshots?.before?.fetchedAt || '');
  const afterAdd = Date.parse(report.snapshots?.afterAdd?.fetchedAt || '');
  const afterRemove = Date.parse(report.snapshots?.afterRemove?.fetchedAt || '');
  if ([before, afterAdd, afterRemove].some(Number.isNaN)) return [];
  if (before <= afterAdd && afterAdd <= afterRemove) return [];
  return ['snapshot fetchedAt timestamps must be ordered before <= afterAdd <= afterRemove'];
}

function credentialLeakErrors(report) {
  return collectCredentialLeaks(report)
    .slice(0, 5)
    .map((finding) => `credential-like data found at ${finding.path}`);
}

function collectCredentialLeaks(value, pathParts = ['$'], findings = []) {
  if (findings.length >= 5) return findings;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectCredentialLeaks(value[index], [...pathParts, `[${index}]`], findings);
      if (findings.length >= 5) break;
    }
    return findings;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...pathParts, key];
      if (SECRET_KEY_PATTERN.test(key)) {
        findings.push({ path: formatPath(childPath), reason: 'key' });
        if (findings.length >= 5) break;
      }
      collectCredentialLeaks(child, childPath, findings);
      if (findings.length >= 5) break;
    }
    return findings;
  }
  if (typeof value === 'string' && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    findings.push({ path: formatPath(pathParts), reason: 'value' });
  }
  return findings;
}

function formatPath(parts) {
  return parts
    .map((part, index) => {
      if (index === 0) return part;
      if (String(part).startsWith('[')) return part;
      return `.${part}`;
    })
    .join('');
}

function parseArgs(argv) {
  const result = {
    reportsDir: '',
    dockerReport: '',
    skipDockerCheck: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--reports-dir') result.reportsDir = requireValue(argv, index += 1, arg);
    else if (arg === '--docker-report') result.dockerReport = requireValue(argv, index += 1, arg);
    else if (arg === '--skip-docker-check') result.skipDockerCheck = true;
    else if (arg === '--json') {
      // JSON is the only output format; the flag is accepted for script symmetry.
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node ./scripts/release-readiness.mjs [options]

Checks release-only evidence that is intentionally not required by normal PR gates:
- Docker build/run smoke via scripts/docker-smoke.mjs --require-docker.
- reports/live-validation-qq.json from a successful live add/remove validation.
- reports/live-validation-netease.json from a successful live add/remove validation.

Options:
  --reports-dir <path>     Directory containing live-validation reports.
  --docker-report <path>   Docker smoke evidence report. Defaults to reports/docker-smoke.json.
  --skip-docker-check      Skip Docker smoke only when ${STRICT_TEST_BYPASS_ENV}=1.
  --json                   Accepted for symmetry; output is always JSON.
`);
}
