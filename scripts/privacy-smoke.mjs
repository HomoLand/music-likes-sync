#!/usr/bin/env node

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_TEXT_BYTES = 1024 * 1024;

const PUBLIC_FILE_ALLOWLIST = new Set([
  '.env.example',
]);

const ALLOWED_SECRET_VALUES = new Set([
  '',
  '...',
  '<redacted>',
  '<target-playlist-id>',
  '<existing-disposable-playlist-id>',
  '<token>',
  'token',
  'fixture',
  '123',
]);

const SECRET_ASSIGNMENTS = [
  { name: 'DEEPSEEK_API_KEY', pattern: /\bDEEPSEEK_API_KEY[ \t]*=[ \t]*([^\r\n\s"'`;]*)/giu },
  { name: 'MUSIC_U', pattern: /\bMUSIC_U[ \t]*=[ \t]*([^\r\n\s"'`;]*)/giu },
  { name: 'qm_keyst', pattern: /\bqm_keyst[ \t]*=[ \t]*([^\r\n\s"'`;]*)/giu },
  { name: 'qqmusic_key', pattern: /\bqqmusic_key[ \t]*=[ \t]*([^\r\n\s"'`;]*)/giu },
  { name: 'p_skey', pattern: /\bp_skey[ \t]*=[ \t]*([^\r\n\s"'`;]*)/giu },
  { name: 'QQ_COOKIE_FILE', pattern: /\bQQ_COOKIE_FILE[ \t]*=[ \t]*([^\r\n\s"'`;]*)/giu },
  { name: 'NETEASE_COOKIE_FILE', pattern: /\bNETEASE_COOKIE_FILE[ \t]*=[ \t]*([^\r\n\s"'`;]*)/giu },
];

const LOCAL_MACHINE_PATTERNS = [
  { name: 'Windows user profile path', pattern: /\b[A-Z]:\\Users\\(?!Public\\)[^\\\r\n]+\\/giu },
  { name: 'Unix user home path', pattern: /(?:^|[\s"'`])\/(?:Users|home)\/(?!shared\/|Shared\/)[^/\s"'`]+/giu },
];

const PLACEHOLDER_TEXT_PATTERNS = [
  {
    name: 'placeholder repository URL',
    pattern: new RegExp(String.raw`github\.com\/your-name\/`, 'giu'),
  },
  {
    name: 'placeholder repository URL',
    pattern: new RegExp(`<${'your-fork-or-release-repo-url'}>`, 'giu'),
  },
  {
    name: 'placeholder repository URL',
    pattern: /<你的\s*fork\s*或发布仓库\s*URL>/giu,
  },
];

const findings = [];
const publicFiles = listPublicGitFiles();
for (const file of publicFiles) {
  checkPublicPath(file);
  checkPublicText(file);
}

const pack = npmPackDryRun();
for (const file of pack.files) {
  checkPackedPath(file.path);
}

const result = {
  ok: findings.length === 0,
  publicFileCount: publicFiles.length,
  packageFileCount: pack.files.length,
  findings,
};

const output = JSON.stringify(result, null, 2);
if (!result.ok) {
  console.error(output);
  process.exit(1);
}

console.log(output);

function listPublicGitFiles() {
  const stdout = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith('node_modules/'))
    .sort();
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
  return packs[0] || { files: [] };
}

function checkPublicPath(filePath) {
  const reason = forbiddenPathReason(filePath);
  if (!reason) return;
  findings.push({ file: filePath, kind: 'forbidden-public-path', reason });
}

function checkPackedPath(filePath) {
  const reason = forbiddenPathReason(filePath);
  if (!reason) return;
  findings.push({ file: filePath, kind: 'forbidden-package-path', reason });
}

function forbiddenPathReason(filePath) {
  if (PUBLIC_FILE_ALLOWLIST.has(filePath)) return '';
  if (filePath === '.env') return 'root env file';
  if (filePath.startsWith('.env.')) return 'non-example env file';
  if (filePath.startsWith('web-app/dist/')) return 'generated frontend build output';
  if (filePath.startsWith('data/')) return 'local runtime state';
  if (filePath.startsWith('reports/')) return 'generated report output';
  if (filePath.includes('-edge-profile')) return 'browser profile';
  if (/\.(bak|cookie|db|jsonl|log|ndjson|sqlite|tmp)$/iu.test(filePath)) return 'local generated artifact';
  return '';
}

function checkPublicText(filePath) {
  const absolute = path.join(ROOT, filePath);
  if (!isTextFile(absolute)) return;
  const text = fs.readFileSync(absolute, 'utf8');
  for (const rule of SECRET_ASSIGNMENTS) {
    for (const match of text.matchAll(rule.pattern)) {
      const value = sanitizeValue(match[1]);
      if (isAllowedSecretPlaceholder(value)) continue;
      findings.push({
        file: filePath,
        kind: 'secret-like-value',
        name: rule.name,
        value: redactValue(value),
      });
    }
  }

  for (const match of text.matchAll(/\bAuthorization\s*:\s*Bearer\s+([A-Za-z0-9._-]{16,})/giu)) {
    const value = sanitizeValue(match[1]);
    if (value.includes('${') || isAllowedSecretPlaceholder(value)) continue;
    findings.push({
      file: filePath,
      kind: 'secret-like-value',
      name: 'Authorization Bearer',
      value: redactValue(value),
    });
  }

  for (const rule of LOCAL_MACHINE_PATTERNS) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        file: filePath,
        kind: 'local-machine-path',
        name: rule.name,
        value: redactValue(String(match[0]).trim()),
      });
    }
  }

  for (const rule of PLACEHOLDER_TEXT_PATTERNS) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        file: filePath,
        kind: 'placeholder-public-text',
        name: rule.name,
        value: redactValue(String(match[0]).trim()),
      });
    }
  }
}

function isTextFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return false;
  const buffer = fs.readFileSync(filePath);
  return !buffer.includes(0);
}

function sanitizeValue(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/gu, '')
    .replace(/[;,\]}).]+$/gu, '')
    .trim();
}

function isAllowedSecretPlaceholder(value) {
  if (ALLOWED_SECRET_VALUES.has(value)) return true;
  if (/^\$\{[A-Za-z0-9_]+\}$/u.test(value)) return true;
  if (/^<[^>]+>$/u.test(value)) return true;
  if (/^\.\.\.?$/u.test(value)) return true;
  if (/^C:\\path\\to\\[^\\]+\.cookie$/iu.test(value)) return true;
  if (/^\.\\data\\[^\\]+\.cookie$/iu.test(value)) return true;
  if (/^data\/[^/]+\.cookie$/iu.test(value)) return true;
  return false;
}

function redactValue(value) {
  if (value.length <= 8) return '<redacted>';
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}
