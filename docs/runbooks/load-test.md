# Payroll load test

This runbook measures the sandbox payroll lifecycle against the dedicated test database. It is deliberately not safe for a development or production database: the script creates a fresh tenant and synthetic employees, and it requires `TEST_DATABASE_URL_*` variables.

## Run

From the repository root:

```bash
. ./.testenv
pnpm --filter @meridian/api exec tsx scripts/payroll-load-test.ts
```

The script forcibly maps `TEST_DATABASE_URL_OWNER`, `TEST_DATABASE_URL_APP`, `TEST_DATABASE_URL_AUTH`, and `TEST_DATABASE_URL_WORKER` to the process database variables after loading `.env`. It uses an in-process Fastify listener and ephemeral local object storage under `/tmp`; it does not bind a server port or contact a bank. The seed uses the HR-scoped transaction path and direct SQL for the synthetic tenant. The approver is a separate MFA-enabled user whose service employee record is terminated before the run so maker-checker remains intact.

The measured lifecycle is start group, start run, lock inputs, calculate, submit for review, approve, finalise payslip outputs, and publish. The JSON output includes stage wall-clock durations, total wall-clock, `process.cpuUsage()`, event-loop delay, peak RSS, machine class, row counts, and output counts.

## Recorded run

Run date: 2026-11-27. Target: the dedicated `meridian_test_p8gaps` PostgreSQL 16 database, using the local shared sandbox VM (6 vCPUs, 24 GB RAM, Node v22.23.4). The tenant had 1,000 active synthetic employees. This is one benchmark sample, so stage p50/p95 latency percentiles are not meaningful; the script reports event-loop p50/p95 only.

| Stage | Wall-clock |
|---|---:|
| Seed | 701.02 ms |
| Start group | 9.27 ms |
| Start run | 11.92 ms |
| Lock inputs | 3,832.52 ms |
| Calculate | 1,925.42 ms |
| Submit/review | 16.04 ms |
| Approve | 536.94 ms |
| Finalise payslip outputs | 4,150.83 ms |
| Publish | 174.38 ms |
| **Total lifecycle** | **12,509.93 ms** |

The run locked and calculated 1,000 employees, finalised and published 1,000 payslips, and ended in `published`. CPU usage was 2,837.02 ms user and 806.01 ms system. Peak RSS was 203.51 MB. Event-loop delay was mean 20.17 ms, p50 20.07 ms, p95 20.69 ms, and maximum 77.33 ms.

The blueprint's stated target is calculation p95 under 30 seconds for a 1,000-employee run (`docs/production-readiness-blueprint.md`, §10). This single observed calculation was 1.93 seconds, so it is below that target in this run. This does not prove a p95 SLO: repeated runs, a 10,000-employee run, database contention, horizontal topology, and production-class storage were not exercised.

## Limits and safety

The run is sandbox mode only. It never enables L2/L3, finalises live payment, submits a bank file, or contacts a bank. No bank or WPS data was seeded, so `sifRows=0` and no payment file was produced; this is expected for the sandbox fixture. Payslip archives were still encrypted, finalised, and published through the local object-store implementation. The UAE pack remains L0. The benchmark runs on a shared sandbox VM, not a production-sized or managed HA environment.
