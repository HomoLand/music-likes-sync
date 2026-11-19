import { spawn } from 'node:child_process';

const CHROMAPRINT_SAMPLE_RATE = 11025;
const CHROMAPRINT_FRAME_SIZE = 4096;
const CHROMAPRINT_FRAME_OVERLAP = 3;
const DEFAULT_MINIMUM_OVERLAP_SECONDS = 15;
const DEFAULT_MATCH_THRESHOLD = 0.82;
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_MAX_INPUT_SECONDS = 20 * 60;
const MAX_FINGERPRINT_BYTES = 256 * 1024;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 120;

export const CHROMAPRINT_SECONDS_PER_HASH = CHROMAPRINT_FRAME_SIZE
  / (CHROMAPRINT_SAMPLE_RATE * CHROMAPRINT_FRAME_OVERLAP);

const fingerprintCache = new Map();

export function alignChromaprintFingerprints(referenceInput, candidateInput, options = {}) {
  const reference = normalizeFingerprint(referenceInput);
  const candidate = normalizeFingerprint(candidateInput);
  const minimumOverlapSeconds = Math.max(
    5,
    Number(options.minimumOverlapSeconds || DEFAULT_MINIMUM_OVERLAP_SECONDS),
  );
  const minimumOverlap = Math.max(
    Math.ceil(minimumOverlapSeconds / CHROMAPRINT_SECONDS_PER_HASH),
    Math.ceil(Math.min(reference.length, candidate.length) * 0.6),
  );

  if (!reference.length || !candidate.length || minimumOverlap > Math.min(reference.length, candidate.length)) {
    return unavailableAlignment('音频片段太短，无法可靠对齐。');
  }

  let best = null;
  let runnerUp = null;
  const separatedBy = Math.ceil(4 / CHROMAPRINT_SECONDS_PER_HASH);
  for (let shift = -reference.length + minimumOverlap; shift <= candidate.length - minimumOverlap; shift += 1) {
    const referenceStart = Math.max(0, -shift);
    const candidateStart = Math.max(0, shift);
    const overlap = Math.min(
      reference.length - referenceStart,
      candidate.length - candidateStart,
    );
    if (overlap < minimumOverlap) continue;

    let differingBits = 0;
    for (let index = 0; index < overlap; index += 1) {
      differingBits += popcount32(reference[referenceStart + index] ^ candidate[candidateStart + index]);
    }
    const score = 1 - differingBits / (overlap * 32);
    const match = { score, shift, overlap, referenceStart, candidateStart };
    if (!best || score > best.score) {
      if (best && Math.abs(best.shift - shift) >= separatedBy) runnerUp = best;
      best = match;
    } else if (
      Math.abs(best.shift - shift) >= separatedBy
      && (!runnerUp || score > runnerUp.score)
    ) {
      runnerUp = match;
    }
  }

  if (!best) return unavailableAlignment('音频片段太短，无法可靠对齐。');
  const threshold = Number(options.matchThreshold || DEFAULT_MATCH_THRESHOLD);
  const confidence = round(best.score, 4);
  if (best.score < threshold) {
    return {
      status: 'not_aligned',
      method: 'chromaprint',
      confidence,
      offsetFromSourceSeconds: 0,
      sourceStartSeconds: 0,
      targetStartSeconds: 0,
      overlapSeconds: round(best.overlap * CHROMAPRINT_SECONDS_PER_HASH, 2),
      maxPreviewSeconds: 30,
      reason: '音频指纹不足以可靠对齐，将从各平台片段起点试听。',
    };
  }

  const overlapSeconds = best.overlap * CHROMAPRINT_SECONDS_PER_HASH;
  const offsetFromSourceSeconds = best.shift * CHROMAPRINT_SECONDS_PER_HASH;
  return {
    status: 'aligned',
    method: 'chromaprint',
    confidence,
    peakMargin: round(best.score - (runnerUp?.score || 0), 4),
    offsetFromSourceSeconds: round(offsetFromSourceSeconds, 3),
    sourceStartSeconds: round(best.referenceStart * CHROMAPRINT_SECONDS_PER_HASH, 3),
    targetStartSeconds: round(best.candidateStart * CHROMAPRINT_SECONDS_PER_HASH, 3),
    overlapSeconds: round(overlapSeconds, 2),
    maxPreviewSeconds: Math.max(1, Math.min(30, Math.floor(overlapSeconds - 0.5))),
    reason: '',
  };
}

export async function alignAudioMedia(source, target, options = {}) {
  if (!source?.previewUrl || !target?.previewUrl) {
    return unavailableAlignment('缺少可用于对齐的试听音频。');
  }
  const fingerprint = options.fingerprintAudio || fingerprintAudioUrl;
  const [sourceFingerprint, targetFingerprint] = await Promise.all([
    fingerprint(source.previewUrl, {
      ...options,
      cacheKey: source.cacheKey,
      expiresAt: source.expiresAt,
    }),
    fingerprint(target.previewUrl, {
      ...options,
      cacheKey: target.cacheKey,
      expiresAt: target.expiresAt,
    }),
  ]);
  return alignChromaprintFingerprints(sourceFingerprint, targetFingerprint, options);
}

export async function fingerprintAudioUrl(value, options = {}) {
  const url = validatedAudioUrl(value);
  const cacheKey = String(options.cacheKey || '').trim();
  const now = Date.now();
  const cached = cacheKey ? fingerprintCache.get(cacheKey) : null;
  if (cached?.validUntil > now) return cached.promise;

  const promise = runFfmpegChromaprint(url, options);
  if (cacheKey) {
    const suppliedExpiry = Date.parse(options.expiresAt || '');
    const validUntil = Number.isFinite(suppliedExpiry) && suppliedExpiry > now
      ? Math.min(suppliedExpiry, now + 60 * 60 * 1000)
      : now + 30 * 60 * 1000;
    fingerprintCache.set(cacheKey, { promise, validUntil });
    pruneFingerprintCache(now);
    promise.catch(() => fingerprintCache.delete(cacheKey));
  }
  return promise;
}

export function clearAudioFingerprintCache() {
  fingerprintCache.clear();
}

function runFfmpegChromaprint(url, options = {}) {
  const ffmpegPath = String(options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg').trim();
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const maxInputSeconds = Math.max(30, Number(options.maxInputSeconds || DEFAULT_MAX_INPUT_SECONDS));
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let child = null;
    const output = [];
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      controller.abort();
      child?.kill();
      finish(new Error('音频对齐处理超时。'));
    }, timeoutMs);

    void start();

    async function start() {
      try {
        const request = options.fetchImpl || fetch;
        const response = await request(url, {
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            accept: 'audio/*,*/*;q=0.1',
            'user-agent': 'music-likes-sync/0.1',
          },
        });
        if (!response.ok || !response.body) throw new Error('平台没有返回可读取的试听音频。');
        const contentLength = Number(response.headers?.get?.('content-length') || 0);
        if (contentLength > MAX_AUDIO_BYTES) throw new Error('试听音频超过本地对齐大小上限。');

        child = spawn(ffmpegPath, [
          '-hide_banner',
          '-loglevel', 'error',
          '-nostdin',
          '-i', 'pipe:0',
          '-map', '0:a:0',
          '-vn',
          '-t', String(maxInputSeconds),
          '-ac', '1',
          '-ar', String(CHROMAPRINT_SAMPLE_RATE),
          '-f', 'chromaprint',
          '-fp_format', 'raw',
          'pipe:1',
        ], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stdin.on('error', () => {});
        child.stdout.on('data', (chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > MAX_FINGERPRINT_BYTES) {
            child.kill();
            finish(new Error('音频指纹超过安全上限。'));
            return;
          }
          output.push(chunk);
        });
        child.stderr.resume();
        child.on('error', () => finish(new Error('没有找到支持 Chromaprint 的 FFmpeg。')));
        child.on('close', (code) => {
          if (code !== 0) {
            finish(new Error('FFmpeg 无法读取该平台的试听音频。'));
            return;
          }
          const buffer = Buffer.concat(output);
          if (!buffer.length || buffer.length % 4 !== 0) {
            finish(new Error('FFmpeg 没有返回有效的 Chromaprint 指纹。'));
            return;
          }
          finish(null, new Uint32Array(
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          ));
        });
        await pipeAudioResponse(response.body, child.stdin, controller.signal);
      } catch (error) {
        if (!settled) finish(new Error(error?.name === 'AbortError' ? '音频对齐处理超时。' : error.message));
      }
    }

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      if (error) reject(error);
      else resolve(result);
    }
  });
}

async function pipeAudioResponse(body, destination, signal) {
  const reader = body.getReader();
  let bytes = 0;
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_AUDIO_BYTES) throw new Error('试听音频超过本地对齐大小上限。');
      if (!destination.write(Buffer.from(value))) {
        await new Promise((resolve) => destination.once('drain', resolve));
      }
    }
  } finally {
    reader.releaseLock();
    if (!destination.destroyed) destination.end();
  }
}

function normalizeFingerprint(value) {
  if (value instanceof Uint32Array) return value;
  if (Buffer.isBuffer(value)) {
    if (value.length % 4 !== 0) return new Uint32Array();
    return new Uint32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (Array.isArray(value)) return Uint32Array.from(value);
  return new Uint32Array();
}

function validatedAudioUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('试听音频地址无效。');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('试听音频地址协议不受支持。');
  return parsed.toString();
}

function unavailableAlignment(reason) {
  return {
    status: 'unavailable',
    method: 'chromaprint',
    confidence: null,
    offsetFromSourceSeconds: 0,
    sourceStartSeconds: 0,
    targetStartSeconds: 0,
    overlapSeconds: 0,
    maxPreviewSeconds: 30,
    reason,
  };
}

function pruneFingerprintCache(now) {
  for (const [key, entry] of fingerprintCache) {
    if (!entry?.validUntil || entry.validUntil <= now) fingerprintCache.delete(key);
  }
  while (fingerprintCache.size > MAX_CACHE_ENTRIES) {
    fingerprintCache.delete(fingerprintCache.keys().next().value);
  }
}

function popcount32(value) {
  let input = value >>> 0;
  input -= (input >>> 1) & 0x55555555;
  input = (input & 0x33333333) + ((input >>> 2) & 0x33333333);
  return ((((input + (input >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
