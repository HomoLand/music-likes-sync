import fs from 'node:fs';
import path from 'node:path';

const ENV_FILE = path.resolve(process.cwd(), '.env');

loadLocalEnv();

export function loadLocalEnv(filePath = ENV_FILE, env = process.env) {
  if (!fs.existsSync(filePath)) return { loaded: false, filePath };
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (env[parsed.key] === undefined) env[parsed.key] = parsed.value;
  }
  return { loaded: true, filePath };
}

function parseEnvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const index = trimmed.indexOf('=');
  if (index <= 0) return null;
  const key = trimmed.slice(0, index).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return {
    key,
    value: unquote(trimmed.slice(index + 1).trim()),
  };
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
