import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'README.zh-CN.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'LICENSE',
  '.env.example',
  'src/cli.js',
  'src/server.js',
  'src/mirror-sync.js',
  'src/mirror-resolve.js',
  'src/mirror-apply.js',
  'src/workflow.js',
  'src/state-schema.js',
  'src/state-migrations.js',
  'src/live-validation.js',
  'src/auto-sync.js',
  'src/run-lock.js',
  'src/product-add-review.js',
  'src/sync-backup.js',
  'src/providers/qq.js',
  'src/providers/netease.js',
  'web/index.html',
  'web/app.js',
  'web/styles.css',
  'web-app/index.html',
  'web-app/vite.config.ts',
  'web-app/tsconfig.json',
  'web-app/src/app/App.tsx',
  'web-app/src/api/client.ts',
  'web-app/src/api/types.ts',
  'web-app/src/screens/AutoSyncScreen.tsx',
  'docs/PRODUCT_ROADMAP.md',
  'docs/PROVIDERS.md',
  'docs/STATE.md',
  'docs/VALIDATION.md',
  'scripts/check-state.mjs',
  'scripts/ai-eval.mjs',
  'scripts/check-ci-workflow.mjs',
  'scripts/privacy-smoke.mjs',
  'scripts/migrate-state.mjs',
  'scripts/http-smoke.mjs',
  'scripts/web-app-smoke.mjs',
  'scripts/ui-smoke.mjs',
  'scripts/agent-mcp-smoke.mjs',
  'scripts/docker-smoke.mjs',
  'scripts/fetch-docker-report.mjs',
  'scripts/fresh-install-smoke.mjs',
  'scripts/live-provider-validation.mjs',
  'scripts/package-smoke.mjs',
  'scripts/release-readiness.mjs',
  'test/ai-eval.test.js',
  'test/fixtures/ai-eval/track-match-cases.json',
  'test/fixtures/ai-eval/tombstone-model-cases.json',
  'test/live-validation.test.js',
  'test/netease-provider.test.js',
  'test/auto-sync.test.js',
  'test/run-lock.test.js',
  'test/product-add-review.test.js',
  'test/sync-ai.test.js',
  'test/sync-backup.test.js',
  'test/sync-backup-workflow.test.js',
  'test/fetch-docker-report.test.js',
  'test/release-readiness.test.js',
  'test/state-migrations.test.js',
];

const ALLOWED_EXACT = new Set([
  'package.json',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  '.env.example',
  'CONTRIBUTING.md',
  'SECURITY.md',
]);

const ALLOWED_PREFIXES = [
  'src/',
  'web/',
  'web-app/',
  'scripts/',
  'docs/',
  'examples/',
  'test/',
];

function parsePackJson(stdout) {
  try {
    const packs = JSON.parse(stdout);
    if (!Array.isArray(packs) || !packs[0]) {
      throw new Error('npm pack returned no package entries');
    }
    return packs[0];
  } catch (error) {
    throw new Error(`Failed to parse npm pack JSON output: ${error.message}`);
  }
}

function isAllowedPublicPath(filePath) {
  return ALLOWED_EXACT.has(filePath) || ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function forbiddenReason(filePath) {
  if (filePath === '.env') return 'root env file';
  if (filePath.startsWith('.env.') && filePath !== '.env.example') return 'non-example env file';
  if (filePath.startsWith('web-app/dist/')) return 'generated frontend build output';
  if (filePath.startsWith('data/')) return 'local runtime state';
  if (filePath.startsWith('reports/')) return 'local report output';
  if (filePath.startsWith('node_modules/')) return 'installed dependency tree';
  if (filePath.includes('-edge-profile')) return 'browser profile';
  if (filePath.includes('write-plan')) return 'generated write plan';
  if (filePath.includes('mirror-plan')) return 'generated mirror plan';
  if (filePath.includes('mirror-runs')) return 'generated mirror run log';
  if (filePath.includes('mirror-decisions')) return 'generated review decisions';
  if (filePath.includes('matches.json')) return 'generated match output';
  if (filePath.includes('unified-library')) return 'generated library snapshot';
  if (/\.(bak|cookie|db|jsonl|log|ndjson|sqlite|tmp)$/u.test(filePath)) {
    return 'local generated artifact';
  }
  return null;
}

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

const pack = parsePackJson(stdout);
const paths = pack.files.map((file) => file.path).sort();
const pathSet = new Set(paths);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const binProblems = packageBinProblems(pkg, pathSet);

const missing = REQUIRED_FILES.filter((file) => !pathSet.has(file));
const forbidden = paths
  .map((file) => ({ path: file, reason: forbiddenReason(file) }))
  .filter((entry) => entry.reason);
const unexpected = paths.filter((file) => !isAllowedPublicPath(file));

const result = {
  ok: missing.length === 0 && forbidden.length === 0 && unexpected.length === 0 && binProblems.length === 0,
  name: pack.name,
  version: pack.version,
  fileCount: paths.length,
  unpackedSize: pack.unpackedSize,
  missing,
  forbidden,
  unexpected,
  binProblems,
};

const output = JSON.stringify(result, null, 2);
if (!result.ok) {
  console.error(output);
  process.exit(1);
}

console.log(output);

function packageBinProblems(pkg, pathSet) {
  const entries = normalizeBinEntries(pkg);
  if (!entries.length) {
    return [{ name: pkg.name || '<package>', reason: 'package has no CLI bin entry' }];
  }

  return entries.flatMap(([name, target]) => {
    const problems = [];
    const normalized = normalizePackagePath(target);
    if (!name) problems.push({ name, target, reason: 'bin entry has no command name' });
    if (!target) problems.push({ name, target, reason: 'bin entry has no target path' });
    if (path.isAbsolute(String(target || ''))) problems.push({ name, target, reason: 'bin target must be package-relative' });
    if (!normalized || normalized.startsWith('../')) problems.push({ name, target, reason: 'bin target escapes the package root' });
    if (normalized && !pathSet.has(normalized)) problems.push({ name, target, reason: 'bin target is not included in npm pack output' });
    if (normalized && pathSet.has(normalized) && !hasNodeShebang(path.join(ROOT, normalized))) {
      problems.push({ name, target, reason: 'bin target does not start with a Node shebang' });
    }
    return problems;
  });
}

function normalizeBinEntries(pkg) {
  if (typeof pkg.bin === 'string') return [[pkg.name || '', pkg.bin]];
  return Object.entries(pkg.bin || {});
}

function normalizePackagePath(filePath) {
  const normalized = String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//u, '');
  if (!normalized) return '';
  return path.posix.normalize(normalized);
}

function hasNodeShebang(filePath) {
  const firstLine = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)[0] || '';
  return /^#!\/usr\/bin\/env\s+node(?:\s|$)/u.test(firstLine);
}
