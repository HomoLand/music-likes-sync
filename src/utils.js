import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = runtimeRoot();
export const DATA_DIR = path.join(ROOT, 'data');
export const REPORT_DIR = path.join(ROOT, 'reports');
export const WEB_DIR = path.join(PACKAGE_ROOT, 'web');
export const WEB_APP_DIST_DIR = path.join(PACKAGE_ROOT, 'web-app', 'dist');

export async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(REPORT_DIR, { recursive: true });
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(filePath) {
  if (!filePath || !(await pathExists(filePath))) return null;
  return fs.readFile(filePath, 'utf8');
}

export async function readJsonIfExists(filePath) {
  const text = await readTextIfExists(filePath);
  if (!text) return null;
  return JSON.parse(text);
}

export async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

export function formatErrorMessage(error) {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;

  const direct = [
    error.message,
    error.msg,
    error.error,
    error.body?.message,
    error.body?.msg,
    error.body?.error,
    error.data?.message,
    error.data?.msg,
  ].find((item) => typeof item === 'string' && item.trim());
  const code = error.code || error.status || error.statusCode || error.body?.code || error.body?.status;
  if (direct) return code ? `${direct}（${code}）` : direct;

  try {
    return JSON.stringify(toPlainError(error)).slice(0, 1000);
  } catch {
    return String(error);
  }
}

function toPlainError(error) {
  if (!error || typeof error !== 'object') return error;
  const plain = {};
  for (const key of Object.keys(error)) {
    const value = error[key];
    if (typeof value === 'function') continue;
    plain[key] = value;
  }
  return plain;
}

export function resolvePath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export async function readCookie(value) {
  if (!value) return '';
  const maybePath = resolvePath(value);
  if (await pathExists(maybePath)) {
    return normalizeCookie(await fs.readFile(maybePath, 'utf8'));
  }
  return String(value).includes('=') ? normalizeCookie(value) : '';
}

export function normalizeCookie(cookie) {
  return String(cookie || '')
    .replace(/\r?\n/g, '; ')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ');
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function parsePort(value, options = {}) {
  const name = options.name || 'port';
  if (value === undefined || value === null || value === '') {
    if (options.defaultValue !== undefined) return options.defaultValue;
    throw new Error(`${name} must be an integer from 1 to 65535.`);
  }
  const raw = typeof value === 'string' ? value.trim() : value;
  const port = typeof raw === 'boolean' || raw === '' ? NaN : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535; received ${JSON.stringify(String(value))}.`);
  }
  return port;
}

export function pick(obj, keys) {
  const lookup = new Map(
    Object.entries(obj || {}).map(([key, value]) => [normalizeKey(key), value]),
  );
  for (const key of keys) {
    const value = obj?.[key] ?? lookup.get(normalizeKey(key));
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function normalizeKey(key) {
  return String(key || '')
    .trim()
    .replace(/^\ufeff/, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function runtimeRoot() {
  const configured = String(process.env.MUSIC_LIKES_SYNC_HOME || '').trim();
  return configured ? path.resolve(configured) : process.cwd();
}
