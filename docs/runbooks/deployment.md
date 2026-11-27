# Deployment runbook

1. Build the immutable image and record the commit, lockfile, SBOM, and image digest. Deploy to staging first; staging/managed failover evidence is an external gate.
2. Provision secrets through the secret manager. Production must provide database URLs, `MERIDIAN_MASTER_KEY`, `MERIDIAN_SIGNING_KEY`, a unique `RATE_LIMIT_KEY_PREFIX`, and `METRICS_TOKEN`; never put these in the image or repository.
3. Run migrations as a separate one-shot job using the `meridian_owner` URL: `DATABASE_URL_OWNER=... pnpm --filter @meridian/api db:migrate`. Do not let the application role run migrations.
4. Verify migration status, forced RLS catalog checks, API readiness, Redis connectivity, and worker readiness before shifting traffic.
5. For rolling deploys, keep migrations backward-compatible with the previous app, start new API instances, drain old instances, then restart workers. For blue/green, shift a small percentage first and inspect error/latency/pay-run metrics.
6. Rollback application images only when the schema remains compatible. Never roll back a forward-only migration; prepare a reviewed corrective migration instead.
7. After traffic shift, exercise health/readiness, login, a non-money read, metrics scrape, and a sandbox payroll smoke path. Record image digest, migration IDs, timings, and operator approvals.
