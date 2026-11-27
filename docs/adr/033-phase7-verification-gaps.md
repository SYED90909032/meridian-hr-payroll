# ADR-033: Phase 7 verification evidence and limits

Status: Accepted

## Context

Phase 7 requires evidence for multi-instance outbox delivery, concurrent pay-run creation, concurrent idempotency, a 1,000-employee payroll load, and authenticated web navigation. These checks must preserve forced RLS, the database pay-run uniqueness constraint, the fixed route pipeline, and the L2 live-payment gate. Some providers are necessarily represented by local stand-ins in this sandbox.

## Decision

Keep the verification at the boundary that owns each guarantee. `apps/api/test/p8-concurrency.test.ts` uses separate real PostgreSQL worker connections for lease claims and expiry, the real Fastify route pipeline for concurrent pay-run starts and idempotency replays, and the existing in-process provider-idempotency stand-in keyed by outbox id. `apps/api/scripts/payroll-load-test.ts` seeds only a dedicated `TEST_DATABASE_URL_*` database, drives the real API lifecycle in sandbox mode, and reports wall-clock, CPU, event-loop delay, RSS, and output counts. `apps/web/e2e/` registers a fresh tenant through the API and then authenticates through the UI over an ephemeral API/Vite-preview pair.

The evidence must name its target. PostgreSQL and local Redis/ClamAV/moto/SMTP infrastructure are local test services, not managed production services. The load test does not claim bank validation, live payment readiness, or a production p95 SLO from one sample. The UAE pack stays L0 and SIF generation remains outside the benchmark when no bank/WPS fixture is seeded.

## Consequences

The checks are reproducible without credentials for an external vendor and cannot silently fall back to `meridian`: the load script and E2E runner explicitly map `TEST_DATABASE_URL_*`. The evidence is strong for transaction, RLS, lease, route-pipeline, and browser integration behavior, but it does not replace independent RLS review, managed HA/failover testing, real bank validation, or repeated production-class load runs.
