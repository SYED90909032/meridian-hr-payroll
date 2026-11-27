# ADR-030: Redis rate limits and privacy-safe observability

Status: Accepted for the production-readiness implementation

## Context

The API is intended to run as multiple stateless instances. An in-process rate-limit store gives each instance an independent budget and therefore does not protect a shared deployment. The platform also needs request latency, database, outbox, worker, payroll, audit, and watchdog signals without putting personal data, SQL parameters, credentials, or raw identifiers into telemetry.

## Decision

When `REDIS_URL` is configured, `@fastify/rate-limit` uses the supplied ioredis client, a deployment-specific `RATE_LIMIT_KEY_PREFIX`, and `skipOnError: true`. Redis errors increment `meridian_rate_limiter_backend_errors_total` and emit a structured warning; the API remains available during a limiter outage. Without `REDIS_URL`, the plugin uses its normal in-process store. The limiter key is Fastify's trusted `req.ip`, so `TRUST_PROXY=false` ignores spoofed forwarding headers and `TRUST_PROXY=true` delegates client-IP selection to Fastify's configured proxy trust behavior.

Prometheus output is disabled unless `METRICS_TOKEN` is set. When enabled, `/metrics` requires an exact bearer token comparison. Labels use route templates, methods, status classes, and bounded stage/state values; raw URLs, IDs, request bodies, SQL, and secrets are excluded. OpenTelemetry tracing is a no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is configured; then the API exports OTLP/HTTP spans with only route, method, status, and request correlation attributes.

## Consequences

Horizontal instances share a Redis budget, while a Redis outage is fail-open but visible and countable. Operators must provision Redis and give every deployment an isolated prefix. Metrics can be scraped only from a network path that is also protected by the bearer token; a separate internal listener remains a recommended edge control. OTLP export is intentionally opt-in and must be configured with an internal collector. The implementation does not claim vendor availability, managed Redis durability, or staging alert exercise.
