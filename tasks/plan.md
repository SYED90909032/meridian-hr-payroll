# Implementation plan (build 0.1)

Spec: `docs/SPEC.md`. Capability map: `spec/capability-map.md`.

## Dependency graph
engine (pure) -> pay module
DB migrations -> kernel -> people-core -> flow -> time -> pay -> service -> intelligence/insight/platform -> web

## Slices (vertical, each ends green and committed)
1. Repo scaffold, CI, engine package with golden and property tests.
2. DB: roles, migrations, RLS helper, audit chain, outbox. Cross-tenant test generated from the catalog.
3. Kernel API: register, login, TOTP, step-up, sessions, RBAC, audit, idempotency.
4. People-core API: org, employees, compensation (bitemporal), bank/national ID encryption.
5. Flow: approvals engine and tokens.
6. Time: punch ingest, attendance, leave.
7. Pay: snapshots, calculation, exceptions, state machine, approvals, payslips, WPS file.
8. Service, assistant with firewall, insight, platform (API keys, webhooks, OpenAPI).
9. Web UI.
10. Security review pass, README, Docker, CI, push.

## Risks
- RLS policy mistakes (mitigated by catalog-driven cross-tenant tests and a restricted-class matrix test).
- Payroll rule accuracy (mitigated by the L0 gate and by labelling every pack parameter with its source and review status).
- Scope (mitigated by vertical slices; staged items listed in SPEC section 8).

## Deviations from the blueprint (recorded)
- Cross-module foreign keys exist in SQL; application code still crosses modules only through services.
- Rule language is a JSON expression tree (ADR-004), not CEL.
