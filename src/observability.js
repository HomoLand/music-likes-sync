import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import promClient from 'prom-client';

const DEFAULT_OTLP_GRPC_ENDPOINT = 'http://127.0.0.1:4317';
const SERVICE_NAME = 'music-likes-sync-web';
const SERVICE_NAMESPACE = 'music-likes-sync';
const DEPLOYMENT_ENVIRONMENT = 'local';
const K8S_CLUSTER_NAME = '';

const API_ROUTES = new Set([
  '/api/sync/progress',
  '/api/state',
  '/api/app/state',
  '/api/sync/modes',
  '/api/sync/check',
  '/api/sync/preview',
  '/api/sync/media',
  '/api/sync/resolve-additions',
  '/api/sync/addition-decision',
  '/api/sync/addition-decisions',
  '/api/sync/identity-decision',
  '/api/sync/confirm-deletions',
  '/api/sync/execute-additions',
  '/api/sync/execute-deletions',
  '/api/sync/convergence',
  '/api/sync/plan',
  '/api/mirror/plan',
  '/api/mirror/resolve-adds',
  '/api/mirror/convergence',
  '/api/mirror/decision',
  '/api/mirror/decisions',
  '/api/mirror/ai/review',
  '/api/mirror/ai/apply',
  '/api/mirror/apply',
  '/api/report.md',
  '/api/report.json',
  '/api/unified.md',
  '/api/unified.json',
  '/api/unified/items',
  '/api/apple',
  '/api/apple/url',
  '/api/apple/connect/start',
  '/api/apple/connect/check',
  '/api/apple/browser/open',
  '/api/apple/browser/capture',
  '/api/cookies',
  '/api/qq/qr/start',
  '/api/qq/qr/check',
  '/api/qq/browser/open',
  '/api/qq/browser/check',
  '/api/qq/browser/capture',
  '/api/qq/playlists',
  '/api/netease/qr/start',
  '/api/netease/qr/check',
  '/api/snapshot',
  '/api/metadata/enrich',
  '/api/match',
  '/api/unified/generate',
  '/api/unified/decision',
  '/api/ai/review',
  '/api/ai/additions/review',
  '/api/ai/additions/apply',
  '/api/ai/identity/review',
  '/api/ai/identity/apply',
  '/api/ai/provider',
  '/api/ai/provider/test',
  '/api/ai/explain',
  '/api/ai/tombstones/analyze',
  '/api/ai/profile',
  '/api/ai/similar',
  '/api/ai/recommend',
  '/api/validation/live',
  '/api/validation/live/run',
  '/api/agent/tools',
  '/api/agent/sessions',
  '/api/agent/chat',
  '/api/ai/apply',
  '/api/sync/decision',
  '/api/sync/ai/review',
  '/api/sync/ai/apply',
  '/api/sync/netease',
  '/api/sync/write',
]);

export function createObservability({ getSyncProgress = () => null } = {}) {
  const config = loadConfig();
  configureTracing(config);

  const registry = new promClient.Registry();
  const metrics = buildMetrics(registry, config, getSyncProgress);
  const tracer = trace.getTracer(SERVICE_NAME);

  return {
    async handleMetrics(res) {
      res.writeHead(200, {
        'content-type': registry.contentType,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(await registry.metrics());
    },

    async observeRequest(req, res, url, handler) {
      const route = routeTemplate(url.pathname);
      const method = String(req.method || 'GET').toUpperCase();
      const spanName = `${method} ${route}`;
      const parentContext = propagation.extract(context.active(), req.headers);
      const inflight = metrics.inflight.labels(method, route);

      inflight.inc();
      const started = process.hrtime.bigint();

      return context.with(parentContext, () => tracer.startActiveSpan(
        spanName,
        {
          kind: SpanKind.SERVER,
          attributes: {
            'http.request.method': method,
            'url.path': route === 'static' ? 'static' : url.pathname,
            'http.route': route,
            'server.address': req.headers.host || '',
            'service.name': config.serviceName,
            'service.namespace': config.serviceNamespace,
          },
        },
        async (span) => {
          let error = null;
          try {
            return await handler();
          } catch (caught) {
            error = caught;
            span.recordException(caught);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: caught?.name || 'request failed',
            });
            throw caught;
          } finally {
            const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
            const statusCode = Number(res.statusCode || (error ? 500 : 200));
            const statusClass = toStatusClass(statusCode);
            const traceId = getTraceId(span, req);

            inflight.dec();
            metrics.requests.labels(method, route, String(statusCode), statusClass).inc();
            metrics.duration.labels(method, route, statusClass).observe(durationSeconds);

            span.setAttributes({
              'http.response.status_code': statusCode,
              'http.status_code': statusCode,
            });
            if (statusCode >= 500 && !error) {
              span.setStatus({ code: SpanStatusCode.ERROR });
            }
            span.end();

            logRequest({
              method,
              route,
              statusCode,
              statusClass,
              durationSeconds,
              traceId,
              error,
            });
          }
        },
      ));
    },
  };
}

export function routeTemplate(pathname) {
  if (API_ROUTES.has(pathname)) return pathname;
  if (pathname.startsWith('/api/')) return '/api/*';
  return 'static';
}

export function toStatusClass(statusCode) {
  return `${Math.floor(statusCode / 100)}xx`;
}

function loadConfig() {
  return loadObservabilityConfig(process.env);
}

export function loadObservabilityConfig(env = process.env) {
  const otlpEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    || env.OTEL_EXPORTER_OTLP_ENDPOINT
    || DEFAULT_OTLP_GRPC_ENDPOINT;
  const otelEnabled = boolEnvFrom(env, 'MUSIC_LIKES_SYNC_OTEL_ENABLED', Boolean(
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ));

  return {
    serviceName: env.MUSIC_LIKES_SYNC_OTEL_SERVICE_NAME || SERVICE_NAME,
    serviceNamespace: env.MUSIC_LIKES_SYNC_OTEL_SERVICE_NAMESPACE || SERVICE_NAMESPACE,
    deploymentEnvironment: env.MUSIC_LIKES_SYNC_DEPLOYMENT_ENVIRONMENT || DEPLOYMENT_ENVIRONMENT,
    k8sClusterName: env.MUSIC_LIKES_SYNC_K8S_CLUSTER_NAME || K8S_CLUSTER_NAME,
    serviceVersion: env.MUSIC_LIKES_SYNC_SERVICE_VERSION || env.SERVICE_VERSION || '0.1.0',
    otelEnabled,
    otlpEndpoint,
    traceSampleRatio: ratioEnvFrom(env, 'MUSIC_LIKES_SYNC_OTEL_SAMPLE_RATIO', 0.25),
  };
}

function configureTracing(config) {
  if (!config.otelEnabled || globalThis.__musicLikesSyncTracerProvider) return;

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': config.serviceName,
      'service.namespace': config.serviceNamespace,
      'deployment.environment': config.deploymentEnvironment,
      'k8s.cluster.name': config.k8sClusterName,
      'service.version': config.serviceVersion,
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.traceSampleRatio),
    }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: config.otlpEndpoint })),
    ],
  });
  provider.register();
  globalThis.__musicLikesSyncTracerProvider = provider;
}

function buildMetrics(registry, config, getSyncProgress) {
  const requests = new promClient.Counter({
    name: 'music_likes_sync_http_requests_total',
    help: 'Total HTTP requests served by music-likes-sync.',
    labelNames: ['method', 'route', 'status_code', 'status_class'],
    registers: [registry],
  });
  const duration = new promClient.Histogram({
    name: 'music_likes_sync_http_request_duration_seconds',
    help: 'HTTP request duration for music-likes-sync.',
    labelNames: ['method', 'route', 'status_class'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  const inflight = new promClient.Gauge({
    name: 'music_likes_sync_http_inflight_requests',
    help: 'In-flight HTTP requests handled by music-likes-sync.',
    labelNames: ['method', 'route'],
    registers: [registry],
  });
  const info = new promClient.Gauge({
    name: 'music_likes_sync_service_info',
    help: 'Build and deployment information for music-likes-sync.',
    labelNames: [
      'service_name',
      'service_namespace',
      'deployment_environment',
      'k8s_cluster_name',
      'service_version',
    ],
    registers: [registry],
  });
  info.labels(
    config.serviceName,
    config.serviceNamespace,
    config.deploymentEnvironment,
    config.k8sClusterName,
    config.serviceVersion,
  ).set(1);

  new promClient.Gauge({
    name: 'music_likes_sync_sync_active',
    help: 'Whether a platform sync workflow is currently active.',
    registers: [registry],
    collect() {
      this.set(getSyncProgress()?.active ? 1 : 0);
    },
  });
  new promClient.Gauge({
    name: 'music_likes_sync_sync_items_done',
    help: 'Completed items in the current platform sync workflow.',
    registers: [registry],
    collect() {
      this.set(Number(getSyncProgress()?.done || 0));
    },
  });
  new promClient.Gauge({
    name: 'music_likes_sync_sync_items_total',
    help: 'Total items in the current platform sync workflow.',
    registers: [registry],
    collect() {
      this.set(Number(getSyncProgress()?.total || 0));
    },
  });

  return { requests, duration, inflight };
}

function getTraceId(span, req) {
  const spanTraceId = span.spanContext?.().traceId;
  if (spanTraceId && !/^0+$/.test(spanTraceId)) return spanTraceId;

  const traceparent = req.headers?.traceparent;
  if (!traceparent) return null;
  const parts = String(traceparent).split('-');
  if (parts.length >= 2 && /^[0-9a-f]{32}$/i.test(parts[1])) return parts[1].toLowerCase();
  return null;
}

function logRequest({
  method,
  route,
  statusCode,
  statusClass,
  durationSeconds,
  traceId,
  error,
}) {
  const payload = {
    event: 'http_request',
    method,
    route,
    status_code: statusCode,
    status_class: statusClass,
    duration_ms: Math.round(durationSeconds * 100000) / 100,
    trace_id: traceId,
  };
  if (error) payload.error_type = error?.name || 'Error';
  console.log(JSON.stringify(payload));
}

function boolEnvFrom(env, name, defaultValue) {
  const value = env[name];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function ratioEnvFrom(env, name, defaultValue) {
  const value = Number(env[name] ?? defaultValue);
  if (!Number.isFinite(value)) return defaultValue;
  return Math.min(Math.max(value, 0), 1);
}
