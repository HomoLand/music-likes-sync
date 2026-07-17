import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAiProviderState,
  requestAiJson,
  resolveAiProviderConfig,
  sanitizeAiProviderConfig,
  testAiProviderJson,
} from '../src/ai-provider.js';
import { validateAiProviderState } from '../src/state-schema.js';

describe('AI provider abstraction', () => {
  it('resolves provider config without exposing API keys in sanitized output', () => {
    const config = resolveAiProviderConfig({
      apiKey: 'sk-local-test-key',
      model: 'deepseek-test',
      batchSize: 25,
    }, {});
    const sanitized = sanitizeAiProviderConfig(config);

    assert.equal(config.provider, 'deepseek');
    assert.equal(config.hasApiKey, true);
    assert.equal(sanitized.hasApiKey, true);
    assert.equal(JSON.stringify(sanitized).includes('sk-local-test-key'), false);
  });

  it('builds state that validates and omits secrets', () => {
    const state = buildAiProviderState({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-local-test-key',
      batchSize: 8,
    }, {}, '2026-07-08T00:00:00.000Z');

    assert.equal(validateAiProviderState(state).ok, true);
    assert.equal(JSON.stringify(state).includes('sk-local-test-key'), false);
  });

  it('calls a JSON chat provider through an injectable fetch implementation', async () => {
    const calls = [];
    const response = await requestAiJson({
      providerConfig: resolveAiProviderConfig({
        apiKey: 'sk-local-test-key',
        model: 'deepseek-test',
        baseUrl: 'https://example.test/v1',
      }, {}),
      messages: [{ role: 'user', content: 'Return json' }],
      thinking: false,
      fetchImpl: async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return {
          ok: true,
          statusText: 'OK',
          async text() {
            return JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ status: 'ok' }) } }],
              usage: { total_tokens: 12 },
            });
          },
        };
      },
    });

    assert.equal(calls[0].url, 'https://example.test/v1/chat/completions');
    assert.equal(calls[0].body.thinking.type, 'disabled');
    assert.deepEqual(response.json, { status: 'ok' });
    assert.equal(response.usage.total_tokens, 12);
  });

  it('runs a provider JSON self-test without leaking keys', async () => {
    const result = await testAiProviderJson({
      providerConfig: resolveAiProviderConfig({
        apiKey: 'sk-local-test-key',
        model: 'deepseek-test',
        baseUrl: 'https://example.test/v1',
      }, {}),
      now: '2026-07-08T00:00:00.000Z',
      fetchImpl: async () => ({
        ok: true,
        statusText: 'OK',
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ ok: true, capability: 'json_object' }) } }],
            usage: { total_tokens: 8 },
          });
        },
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.response.capability, 'json_object');
    assert.equal(JSON.stringify(result).includes('sk-local-test-key'), false);
  });

  it('retries transient provider failures without changing the request payload', async () => {
    let calls = 0;
    const result = await requestAiJson({
      providerConfig: resolveAiProviderConfig({
        apiKey: 'sk-local-test-key',
        model: 'deepseek-test',
        baseUrl: 'https://example.test/v1',
      }, {}),
      messages: [{ role: 'user', content: 'Return json' }],
      thinking: false,
      maxAttempts: 2,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            status: 503,
            statusText: 'Unavailable',
            async text() { return JSON.stringify({ error: { message: 'try again' } }); },
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          async text() {
            return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] });
          },
        };
      },
    });

    assert.equal(calls, 2);
    assert.deepEqual(result.json, { ok: true });
  });
});
