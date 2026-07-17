import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

import { loadObservabilityConfig, routeTemplate, toStatusClass } from '../src/observability.js';

describe('observability helpers', () => {
  it('keeps route labels low cardinality', () => {
    assert.equal(routeTemplate('/api/state'), '/api/state');
    assert.equal(routeTemplate('/api/app/state'), '/api/app/state');
    assert.equal(routeTemplate('/api/sync/check'), '/api/sync/check');
    assert.equal(routeTemplate('/api/sync/addition-decision'), '/api/sync/addition-decision');
    assert.equal(routeTemplate('/api/sync/addition-decisions'), '/api/sync/addition-decisions');
    assert.equal(routeTemplate('/api/sync/identity-decision'), '/api/sync/identity-decision');
    assert.equal(routeTemplate('/api/ai/identity/review'), '/api/ai/identity/review');
    assert.equal(routeTemplate('/api/ai/identity/apply'), '/api/ai/identity/apply');
    assert.equal(routeTemplate('/api/ai/additions/apply'), '/api/ai/additions/apply');
    assert.equal(routeTemplate('/api/mirror/plan'), '/api/mirror/plan');
    assert.equal(routeTemplate('/api/mirror/resolve-adds'), '/api/mirror/resolve-adds');
    assert.equal(routeTemplate('/api/mirror/convergence'), '/api/mirror/convergence');
    assert.equal(routeTemplate('/api/mirror/decision'), '/api/mirror/decision');
    assert.equal(routeTemplate('/api/mirror/decisions'), '/api/mirror/decisions');
    assert.equal(routeTemplate('/api/mirror/ai/review'), '/api/mirror/ai/review');
    assert.equal(routeTemplate('/api/mirror/ai/apply'), '/api/mirror/ai/apply');
    assert.equal(routeTemplate('/api/ai/profile'), '/api/ai/profile');
    assert.equal(routeTemplate('/api/ai/similar'), '/api/ai/similar');
    assert.equal(routeTemplate('/api/ai/recommend'), '/api/ai/recommend');
    assert.equal(routeTemplate('/api/agent/tools'), '/api/agent/tools');
    assert.equal(routeTemplate('/api/agent/sessions'), '/api/agent/sessions');
    assert.equal(routeTemplate('/api/agent/chat'), '/api/agent/chat');
    assert.equal(routeTemplate('/api/mirror/apply'), '/api/mirror/apply');
    assert.equal(routeTemplate('/api/sync/write'), '/api/sync/write');
    assert.equal(routeTemplate('/api/unified/items'), '/api/unified/items');
    assert.equal(routeTemplate('/api/unified/items?filter=all'), '/api/*');
    assert.equal(routeTemplate('/api/unknown/123'), '/api/*');
    assert.equal(routeTemplate('/'), 'static');
    assert.equal(routeTemplate('/assets/app.js'), 'static');
  });

  it('groups status codes by class', () => {
    assert.equal(toStatusClass(200), '2xx');
    assert.equal(toStatusClass(404), '4xx');
    assert.equal(toStatusClass(503), '5xx');
  });

  it('uses open-source-safe local observability defaults', () => {
    const config = loadObservabilityConfig({});
    const source = fs.readFileSync('src/observability.js', 'utf8');

    assert.equal(config.deploymentEnvironment, 'local');
    assert.equal(config.k8sClusterName, '');
    assert.equal(config.otlpEndpoint, 'http://127.0.0.1:4317');
    assert.equal(config.otelEnabled, false);
    assert.doesNotMatch(source, /homelab/i);
    assert.doesNotMatch(source, /svc\.cluster\.local/i);
  });

  it('enables OTEL when an endpoint is explicitly configured', () => {
    const config = loadObservabilityConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example:4317',
      MUSIC_LIKES_SYNC_DEPLOYMENT_ENVIRONMENT: 'production',
      MUSIC_LIKES_SYNC_K8S_CLUSTER_NAME: 'cluster-a',
      MUSIC_LIKES_SYNC_OTEL_SAMPLE_RATIO: '0.5',
    });

    assert.equal(config.otelEnabled, true);
    assert.equal(config.otlpEndpoint, 'http://collector.example:4317');
    assert.equal(config.deploymentEnvironment, 'production');
    assert.equal(config.k8sClusterName, 'cluster-a');
    assert.equal(config.traceSampleRatio, 0.5);
  });
});
