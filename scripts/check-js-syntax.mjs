import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCOPES = ['src', 'test', 'web', 'scripts'];
const files = SCOPES.flatMap((scope) => listJavaScriptFiles(path.join(ROOT, scope)));

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}

console.log(`node --check passed for ${files.length} JS files`);

function listJavaScriptFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(fullPath);
    if (!entry.isFile()) return [];
    if (!/\.[cm]?js$/i.test(entry.name)) return [];
    if (statSync(fullPath).size === 0) return [];
    return [fullPath];
  });
}
