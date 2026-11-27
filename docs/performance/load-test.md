# Performance/load-test evidence

The repository now includes `scripts/load/measure.mjs` for repeatable API read measurements and `scripts/load/run.sh` as the guarded entry point. The harness uses synthetic HTTP requests only and never changes a payroll pack to L2/L3 or reaches live payment. A lifecycle fixture must be supplied with real sandbox tenant data before publishing payroll-stage numbers; IDs and secrets are intentionally not fabricated in source control.

Blueprint SLOs are login p95 under 300 ms, list/read p95 under 200 ms, and sandbox calculation p95 under 30 s for 1,000 employees. The required production comparison must record p50/p95 per lock, calculate, submit, approve, finalise, publish stage, plus concurrent read endpoints and a `--cpu-prof` profile. Results from this sandbox (6 vCPU, 24 GB RAM, PostgreSQL on the same host) are not production-topology evidence. Managed database, Redis, edge, object storage, and worker contention must be measured separately before a go-live decision.

## Measurements run here

On 2026-11-27, the built API ran on the local sandbox at an ephemeral port with PostgreSQL on the same host. `scripts/load/run.sh` issued concurrent batches of 20 against `GET /api/v1/health` (no authentication and no database read), with no errors:

| Request count | Concurrency | p50 | p95 | Max | Result |
|---:|---:|---:|---:|---:|---|
| 1,000 | 20 | 8.15 ms | 18.07 ms | 113.90 ms | Read smoke passes; not the list/read SLO |
| 5,000 | 20 | 6.14 ms | 15.38 ms | 122.12 ms | Read smoke passes; not the list/read SLO |

These are measured concurrent health-endpoint numbers, not a 1,000- or 5,000-employee payroll calculation. The repository does not yet contain a runnable synthetic employee/pay-run fixture or CPU-profile command, so lock, calculate, submit, approve, finalise, publish p50/p95 and `--cpu-prof` evidence were **not run**. The 1,000-employee calculation SLO is therefore **not assessed**, not claimed as a pass. The measurements also do not prove the login or authenticated list/read SLOs.
