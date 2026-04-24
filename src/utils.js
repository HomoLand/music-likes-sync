import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const REPORT_DIR = path.join(ROOT, 'reports');
export const WEB_DIR = path.join(ROOT, 'web');

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
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
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
