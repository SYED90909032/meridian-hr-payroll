# Build progress (handoff note)

Repo: /home/ubuntu/projects/hr-payroll-10987a11/meridian (branch main). GitHub: https://github.com/SYED90909032/meridian-hr-payroll (private). `gh` is authenticated.
DB: PostgreSQL 16 local; DBs `meridian` and `meridian_test`; roles meridian_owner/app/auth/worker (passwords in .env). Start: `sudo pg_ctlcluster 16 main start`. Reset test DB: `./scripts/db-reset.sh meridian_test`.
Tests: `pnpm --filter @meridian/api test` (vitest, real Postgres, env from ../../.env with /meridian swapped to /meridian_test).

## Done and committed
- Slice 1 engine (33 tests). Slice 2 DB: migrations 001-006, 26 DB security tests green (commit 0afae56, pushed).

## Written since, NOT yet committed or typechecked/run
- migration 007 (auth columns, recovery codes, login attempts), 008 (time hardening + flow policies, approver_ids denormalised columns).
- apps/api/src: config.ts, errors.ts, db/{pool,tx,migrate,migrate-cli}.ts, crypto/{kms,password,totp,tokens}.ts, http/{perms,principal,route}.ts, app.ts,
  modules/iam/{registration,auth,routes}.ts, modules/people/{lib,routes}.ts, modules/flow/{notify,lib,routes}.ts, modules/time/lib.ts.
- app.ts imports route modules that do NOT exist yet: time/routes, pay/routes, service/routes, platform/routes, audit/routes, insight/routes, assistant/routes. Create them (or stub) before typecheck.

## Conventions
- All routes via defineRoute(svc, {...}) (auth, perm, stepUp, idempotent, actors, tx). System actors set per tx: register, iam, hr, time, flow, payroll (RLS policies check app.system(kind)).
- Data classes enforced by RLS; permissions by role in http/perms.ts.
- CSRF: Origin==Host check + X-Meridian-Client: web header on cookie-authenticated mutations.
- The `write` tool refuses to overwrite existing files: rm first, or use `edit`.

## Remaining
(Update: 007/008 applied, 26 DB tests green. New unrun migrations 009_system_reads, 010_pay_adjustments. Written but NOT typechecked: time/{routes,leave,attendance}.ts, pay/{inputs,service,routes,payslips}.ts, service/routes.ts, http/schemas.ts, db/tx.ts withActor, migrate-cli syncPacks. Still missing: platform/routes, audit/routes, insight/routes, assistant/routes, main.ts, worker.ts, seed.ts.)

time/routes (devices, ingest/punches, attendance, shifts, holidays, leave + registerApprovalHandler('leave')), pay module (engine integration, run lifecycle, SIF, payslips),
service (tickets, announcements, KB), platform (API keys, webhooks, worker, SSRF guard), audit routes (list, verify, seal Merkle Ed25519), insight, assistant,
main.ts + worker.ts + seed.ts, API integration tests, web UI (React+Vite, white Astryx-like), CI, Dockerfile, README, THREAT_MODEL, SECURITY, final push, final reply.

## Honesty notes for final reply
UAE pack L0 (overtime rules, unpaid-leave day basis, 50% deduction cap unverified); WPS file unverified with any bank; Emirates ID check digit not enforced; email delivery not implemented (approval tokens exist, no mail provider);
RLS needs expert review; D1-D16 provisional; D11 KMS open; staged: Rust/WASM, edge, Go bridge, mobile, passkeys, OIDC, SCIM, other countries.
