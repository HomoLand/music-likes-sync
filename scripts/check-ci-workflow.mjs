#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci.yml');

const REQUIRED_SNIPPETS = [
  ['read-only permissions', 'permissions:\n  contents: read'],
  ['manual workflow trigger', 'workflow_dispatch:'],
  ['pull request trigger', 'pull_request:'],
  ['main push trigger', 'branches:\n      - main'],
  ['Node 20 matrix', '- 20.x'],
  ['Node 24 matrix', '- 24.x'],
  ['checkout action', 'actions/checkout@v4'],
  ['setup-node action', 'actions/setup-node@v4'],
  ['npm cache', 'cache: npm'],
  ['reproducible install', 'npm ci'],
  ['CI workflow self-check', 'npm run check:ci'],
  ['privacy smoke', 'npm run check:privacy'],
  ['source verification', 'npm run verify'],
  ['state migration dry-run', 'npm run migrate:state'],
  ['package smoke', 'npm run smoke:package'],
  ['fresh install smoke', 'npm run smoke:fresh-install'],
  ['live validation default gate', 'npm run validate:live'],
  ['production audit', 'npm run audit'],
  ['HTTP smoke', 'npm run smoke:http'],
  ['React app smoke', 'npm run smoke:web-app'],
  ['Agent MCP smoke', 'npm run smoke:agent-mcp'],
  ['Playwright browser install', 'npx playwright install chromium --with-deps'],
  ['React UI smoke', 'npm run smoke:react-ui'],
  ['UI smoke', 'npm run smoke:ui'],
  ['Docker required smoke report', 'npm run smoke:docker -- --require-docker --write-report'],
  ['artifact upload action', 'actions/upload-artifact@v4'],
  ['Docker report artifact name', 'docker-smoke-report-node-24'],
  ['Docker report artifact path', 'reports/docker-smoke.json'],
  ['Docker report artifact missing-file guard', 'if-no-files-found: error'],
];

const FORBIDDEN_SNIPPETS = [
  ['secrets in CI env', 'MUSIC_LIKES_SYNC_LIVE_VALIDATE: "1"'],
  ['secrets in CI env', 'MUSIC_LIKES_SYNC_LIVE_CONFIRM: DISPOSABLE_PLAYLIST'],
  ['broad write permissions', 'contents: write'],
  ['unbounded job runtime', 'timeout-minutes: 0'],
];

if (!fs.existsSync(WORKFLOW)) {
  console.error(`Missing workflow: ${path.relative(ROOT, WORKFLOW)}. This release gate must run from a source checkout; npm package installs intentionally omit .github/.`);
  process.exit(1);
}

const text = fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
const missing = REQUIRED_SNIPPETS
  .filter(([, snippet]) => !text.includes(snippet))
  .map(([label]) => label);
const forbidden = FORBIDDEN_SNIPPETS
  .filter(([, snippet]) => text.includes(snippet))
  .map(([label]) => label);

const hasNode24GatedUi = /if:\s*matrix\.node-version\s*==\s*'24\.x'[\s\S]*?run:\s*npm run smoke:ui/u.test(text);
const hasNode24GatedReactUi = /if:\s*matrix\.node-version\s*==\s*'24\.x'[\s\S]*?run:\s*npm run smoke:react-ui/u.test(text);
const hasNode24GatedDocker = /if:\s*matrix\.node-version\s*==\s*'24\.x'[\s\S]*?run:\s*npm run smoke:docker -- --require-docker --write-report/u.test(text);
const hasNode24GatedDockerArtifact = /if:\s*matrix\.node-version\s*==\s*'24\.x'[\s\S]*?uses:\s*actions\/upload-artifact@v4[\s\S]*?name:\s*docker-smoke-report-node-24[\s\S]*?path:\s*reports\/docker-smoke\.json[\s\S]*?if-no-files-found:\s*error/u.test(text);
if (!hasNode24GatedUi) missing.push('Node 24 gated UI smoke');
if (!hasNode24GatedReactUi) missing.push('Node 24 gated React UI smoke');
if (!hasNode24GatedDocker) missing.push('Node 24 gated Docker smoke report');
if (!hasNode24GatedDockerArtifact) missing.push('Node 24 gated Docker smoke artifact upload');

const result = {
  ok: missing.length === 0 && forbidden.length === 0,
  workflow: path.relative(ROOT, WORKFLOW).replace(/\\/g, '/'),
  missing,
  forbidden,
};

const output = JSON.stringify(result, null, 2);
if (!result.ok) {
  console.error(output);
  process.exit(1);
}

console.log(output);
