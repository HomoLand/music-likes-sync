import { randomUUID } from 'node:crypto';

const DEFAULT_TTL_MS = 3 * 60 * 1000;

export class AuthSessionStore {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.createId = options.createId || randomUUID;
    this.sessions = new Map();
  }

  create(platform, data = {}, options = {}) {
    const createdAtMs = this.now();
    const ttlMs = positiveNumber(options.ttlMs, DEFAULT_TTL_MS);
    const session = {
      id: this.createId(),
      platform: String(platform || '').trim(),
      createdAtMs,
      expiresAtMs: createdAtMs + ttlMs,
      data,
    };
    if (!session.platform) throw new Error('Auth session platform is required.');
    this.sessions.set(session.id, session);
    return session;
  }

  get(id, platform) {
    const session = this.sessions.get(String(id || ''));
    if (!session) return null;
    if (session.expiresAtMs <= this.now()) {
      this.sessions.delete(session.id);
      return null;
    }
    if (platform && session.platform !== platform) return null;
    return session;
  }

  delete(id) {
    return this.sessions.delete(String(id || ''));
  }

  clearPlatform(platform) {
    for (const session of this.sessions.values()) {
      if (session.platform === platform) this.sessions.delete(session.id);
    }
  }

  toPublic(session) {
    if (!session) return null;
    return {
      key: session.id,
      platform: session.platform,
      createdAt: new Date(session.createdAtMs).toISOString(),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
    };
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
