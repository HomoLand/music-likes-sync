const DEFAULT_PROVIDER = 'deepseek';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_BATCH_SIZE = 12;

export function resolveAiProviderConfig(options = {}, env = process.env) {
  const provider = clean(options.provider || env.MUSIC_LIKES_SYNC_AI_PROVIDER || env.AI_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  const model = clean(options.model || env.DEEPSEEK_MODEL || DEFAULT_MODEL);
  const baseUrl = clean(options.baseUrl || env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/g, '');
  const apiKey = clean(options.apiKey || env.DEEPSEEK_API_KEY || '');
  const batchSize = clampInteger(options.batchSize || env.MUSIC_LIKES_SYNC_AI_BATCH_SIZE || DEFAULT_BATCH_SIZE, 1, 50);
  return {
    provider,
    model,
    baseUrl,
    apiKey,
    hasApiKey: Boolean(apiKey),
    batchSize,
  };
}

export function sanitizeAiProviderConfig(config = {}) {
  return {
    provider: clean(config.provider || DEFAULT_PROVIDER),
    model: clean(config.model || DEFAULT_MODEL),
    baseUrl: clean(config.baseUrl || DEFAULT_BASE_URL),
    hasApiKey: Boolean(config.hasApiKey || config.apiKey),
    batchSize: clampInteger(config.batchSize || DEFAULT_BATCH_SIZE, 1, 50),
  };
}

export function buildAiProviderState(input = {}, env = process.env, now = new Date().toISOString()) {
  const resolved = resolveAiProviderConfig(input, env);
  return {
    version: 1,
    updatedAt: now,
    provider: resolved.provider,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    batchSize: resolved.batchSize,
    hasEnvKey: Boolean(resolveAiProviderConfig({}, env).apiKey),
  };
}

export async function requestAiJson(options = {}) {
  const config = resolveAiProviderConfig(options.providerConfig || options, options.env || process.env);
  if (config.provider !== 'deepseek') {
    throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
  if (!config.apiKey) {
    throw new Error('Missing AI provider API key. Set DEEPSEEK_API_KEY or pass an explicit local key.');
  }

  const body = {
    model: config.model,
    messages: options.messages || [],
    response_format: { type: 'json_object' },
    max_tokens: Number(options.maxTokens || 12000),
    reasoning_effort: options.reasoningEffort || 'high',
    thinking: { type: options.thinking === false ? 'disabled' : 'enabled' },
  };

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const payload = parseJsonOrNull(text);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || response.statusText;
    throw new Error(`AI provider request failed: ${message}`);
  }

  const content = payload?.choices?.[0]?.message?.content || '';
  if (!content.trim()) throw new Error('AI provider returned an empty response.');

  let json = null;
  try {
    json = JSON.parse(content);
  } catch (error) {
    throw new Error(`AI provider JSON parse failed: ${error.message}`);
  }

  return {
    provider: config.provider,
    model: config.model,
    usage: payload?.usage || null,
    content,
    json,
  };
}

export async function testAiProviderJson(options = {}) {
  const config = resolveAiProviderConfig(options.providerConfig || options, options.env || process.env);
  const startedAt = options.now || new Date().toISOString();
  const response = await requestAiJson({
    providerConfig: config,
    messages: [
      {
        role: 'system',
        content: 'Return strict JSON only. Do not include prose.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'provider_health_check',
          required_json: {
            ok: true,
            capability: 'json_object',
          },
        }),
      },
    ],
    maxTokens: 300,
    reasoningEffort: 'low',
    thinking: false,
    fetchImpl: options.fetchImpl,
  });
  const ok = response.json?.ok === true && response.json?.capability === 'json_object';
  return {
    ok,
    checkedAt: startedAt,
    provider: config.provider,
    model: response.model,
    usage: response.usage,
    response: {
      ok: response.json?.ok === true,
      capability: clean(response.json?.capability || ''),
    },
  };
}

function parseJsonOrNull(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}
