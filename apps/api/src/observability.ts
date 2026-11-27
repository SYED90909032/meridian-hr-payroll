import { context, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { Config } from './config.js';
import type { Pools } from './db/pool.js';

export const metrics = {
  requests: new Counter({ name: 'meridian_http_requests_total', help: 'HTTP requests by route template and status class', labelNames: ['route', 'method', 'status_class'] }),
  latency: new Histogram({ name: 'meridian_http_request_duration_seconds', help: 'HTTP request latency by route template and status class', labelNames: ['route', 'method', 'status_class'], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15, 30] }),
  dbPool: new Gauge({ name: 'meridian_db_pool_connections', help: 'Database pool connections', labelNames: ['pool', 'state'] }),
  outbox: new Gauge({ name: 'meridian_outbox_rows', help: 'Outbox rows by delivery state', labelNames: ['state'] }),
  outboxOldest: new Gauge({ name: 'meridian_outbox_oldest_age_seconds', help: 'Age of oldest pending outbox row' }),
  outboxFailures: new Counter({ name: 'meridian_outbox_failures_total', help: 'Outbox delivery failures' }),
  workerTick: new Histogram({ name: 'meridian_worker_tick_duration_seconds', help: 'Worker tick duration', buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30] }),
  payRun: new Histogram({ name: 'meridian_pay_run_stage_duration_seconds', help: 'Pay run stage duration', labelNames: ['stage'], buckets: [0.1, 1, 5, 15, 30, 60, 300] }),
  payRunsStuck: new Gauge({ name: 'meridian_pay_runs_stuck', help: 'Pay runs over watchdog threshold', labelNames: ['state'] }),
  auditSealAge: new Gauge({ name: 'meridian_audit_seal_age_seconds', help: 'Age of newest audit seal' }),
  auditDrift: new Gauge({ name: 'meridian_audit_reconcile_drift', help: 'Audit reconciliation drift indicator' }),
  limiterErrors: new Counter({ name: 'meridian_rate_limiter_backend_errors_total', help: 'Rate limiter backend errors', labelNames: ['backend'] }),
  watchdogAlerts: new Counter({ name: 'meridian_watchdog_alerts_total', help: 'Watchdog threshold crossings', labelNames: ['kind'] }),
};

const registry = new Registry();
for (const metric of Object.values(metrics)) registry.registerMetric(metric);
collectDefaultMetrics({ register: registry, prefix: 'meridian_' });

export function metricsText(): Promise<string> { return registry.metrics(); }
export function metricsContentType(): string { return registry.contentType; }

let sdk: NodeSDK | undefined;
export function startTracing(cfg: Pick<Config, 'OTEL_EXPORTER_OTLP_ENDPOINT'>): void {
  if (!cfg.OTEL_EXPORTER_OTLP_ENDPOINT || sdk) return;
  sdk = new NodeSDK({ resource: resourceFromAttributes({ 'service.name': 'meridian-api' }), traceExporter: new OTLPTraceExporter({ url: cfg.OTEL_EXPORTER_OTLP_ENDPOINT }) });
  void sdk.start();
}
export async function stopTracing(): Promise<void> { if (sdk) await sdk.shutdown(); sdk = undefined; }

const tracer = trace.getTracer('meridian-api');
export function startRequestSpan(requestId: string, method: string): Span {
  const span = tracer.startSpan(`HTTP ${method}`, { attributes: { 'meridian.request_id': requestId, 'http.request.method': method } });
  return span;
}
export function finishRequestSpan(span: Span, route: string, status: number, error?: Error): void {
  span.updateName(route);
  span.setAttribute('http.route', route);
  span.setAttribute('http.response.status_code', status);
  if (error) { span.recordException(error); span.setStatus({ code: SpanStatusCode.ERROR }); }
  else span.setStatus({ code: status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
  span.end();
}
export async function withDbSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => { try { return await fn(); } catch (e) { span.recordException(e as Error); span.setStatus({ code: SpanStatusCode.ERROR }); throw e; } finally { span.end(); } });
}

export function updatePoolMetrics(pools: Pools): void {
  for (const [name, pool] of [['app', pools.app], ['auth', pools.auth], ['worker', pools.worker] ] as const) {
    metrics.dbPool.set({ pool: name, state: 'total' }, pool.totalCount);
    metrics.dbPool.set({ pool: name, state: 'idle' }, pool.idleCount);
    metrics.dbPool.set({ pool: name, state: 'waiting' }, pool.waitingCount);
  }
}

export function routeTemplate(req: { routeOptions?: { url?: string }; url: string }): string {
  const route = req.routeOptions?.url;
  if (route && route.startsWith('/')) return route;
  return req.url.split('?')[0]!.replace(/\/[^/]+(?=\/|$)/g, '/:param');
}

export function activeContextSpan(span: Span): void { void context.with(trace.setSpan(context.active(), span), () => undefined); }
