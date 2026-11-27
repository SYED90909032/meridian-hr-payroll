# Production-readiness progress

Tracks every task in `docs/production-readiness-blueprint.md` section 8. This file is the single place to see what is built, what is verified and what is waiting on someone outside the repository. The narrative of **what was built and how** is in `CHANGELOG.md` (section "Production-readiness programme"); the reasoning behind each choice is in `docs/adr/` and `docs/DECISIONS.md`.

Legend:

- **Done**: built and covered by tests that run in CI.
- **Done (partial)**: built, with a stated limit.
- **Blocked: external**: needs a person, account or third party that this repository cannot supply. The mechanism is built; nothing is faked.
- **Not built**: deliberately not built, with the reason.

"Verified against" says what the tests actually ran against. A test against a stand-in (for example `moto` for AWS, an in-process fake identity provider, an in-process SFTP server) proves protocol handling, not the real vendor, and the table says which is which. "Real" here means a real local process (PostgreSQL 16, Redis, ClamAV `clamd`), not a hosted service.

## Standing position on the live-payment gate

The UAE pack is still **L0**. No migration, seed, fixture, script or default sets L2/L3. Phase 2 built the *mechanism* that can unlock L2 (a database trigger that demands reviewer sign-off, a bank acceptance reference and two zero-variance parallel runs, all keyed to the exact pack hash). None of that external evidence exists, so the gate stays closed.

## Phase 0 - Decisions and scope lock

| Task | Status | Verified against | Notes |
|---|---|---|---|
| Decisions log | Done (partial) | n/a | `docs/DECISIONS.md`. Working defaults adopted; owner confirmation still outstanding for AGPL, cloud provider, KMS vendor, mail provider, target size, D-1. |
| Appoint the two reviewers | Blocked: external | n/a | Review packs are prepared (`docs/reviews/`) so a reviewer can start at once. |
| Freeze target cloud provider | Blocked: external | n/a | Owner decision. Code stays provider-neutral (S3-compatible store, KMS port). |
| Security-reporting channel and incident-response draft | Done (draft) | n/a | `docs/runbooks/incident-response.md`; not exercised in a drill. |
| Object-storage port (ADR-025) | Done | local FS, moto S3 | 15 contract tests per backend. Not run against real AWS S3 or R2. |

## Phase 1 - Data protection and database hardening (ADR-023)

| Task | Status | Verified against | Notes |
|---|---|---|---|
| Cloud KMS adapter and boot | Done (partial) | local provider, moto KMS | Real AWS KMS not run. Production refuses the local provider. |
| Versioned envelope keys and rotation | Done | PostgreSQL 16 | Re-wrap without re-encrypting fields. A staging rotation drill is external. |
| Key-custody separation | Done (partial) | PostgreSQL 16, local KMS | Wrapping is bound to the deployment and tested; a stolen database alone holds only wrapped keys. A dedicated "attacker with DB dump and no KMS" test is covered by the wrap-binding test, not a separate scenario. |
| Catalog-driven RLS coverage test | Done | PostgreSQL 16 | Every table with `tenant_id` must have forced RLS. It caught `kernel.account_token` during integration (fixed in migration 027). |
| Independent RLS review | Blocked: external | n/a | `docs/reviews/rls-review-pack.md` is ready; the review has not happened. |
| Off-box audit seals and reconciler | Done (partial) | local store, moto S3 | Real AWS or R2 not run. |
| Secrets manager port | Done (partial) | env, moto | Env-backed secrets log a loud warning unless `REQUIRE_SECRET_MANAGER=true`. |
| Legal hold blocks crypto-erasure | Done | PostgreSQL 16 | Enforced by a database trigger, so owner-level updates are refused too. |

## Phase 2 - UAE assurance L0 to L2 (ADR-027)

| Task | Status | Verified against | Notes |
|---|---|---|---|
| Rule review | Blocked: external | n/a | `docs/reviews/uae-pack-review-pack.md` lists every parameter with its source and status. |
| Independent golden vectors | Done (partial) | in-process engine | Derived independently of the engine code; they caught a real defect (see "Integration findings"). Reviewer confirmation is external. |
| SIF self-checks | Done (partial) | in-process engine | Structural checks only. No bank has validated a file. |
| Bank WPS validation | Blocked: external | n/a | Needs the bank or exchange house validator. |
| Parallel-run harness | Done | PostgreSQL 16 | Import, exact comparison, variance reporting. No real employer run exists. |
| Sign-off gate (database trigger) | Done | PostgreSQL 16 | Tests cover refusal with missing or mismatched evidence. |
| Flip pack to L2 | Not done, by design | n/a | Requires all of the external evidence above. |
| Bank transport connector | Done (partial) | in-process `ssh2` SFTP server | Host-key-pinned SFTP and a manual transport. Not run against a bank. |

## Phase 3 - Communications and identity (ADR-024, ADR-031)

| Task | Status | Verified against | Notes |
|---|---|---|---|
| Email and SMS outbox channels | Done (partial) | in-process SMTP server | Postmark and Twilio adapters exist but were not run against the real services. |
| Invitations and password reset | Done | PostgreSQL 16, fake HIBP endpoint | Single-use hashed tokens. The temporary-password path is removed. |
| Transactional notifications and MFA policy | Done | PostgreSQL 16 | |
| Passkeys (WebAuthn) | Done (partial) | software authenticator | No hardware or platform authenticator tested. |
| OIDC SSO | Done (partial) | in-process fake IdP | Real Okta, Entra and Google not tested. |
| SAML | Not built | n/a | No vetted library was integrated. Recorded in ADR-031. |
| SCIM 2.0 | Done (partial) | PostgreSQL 16, HTTP client | No real IdP provisioning run. |
| Deliverability (SPF, DKIM, DMARC, suppression) | Done (partial) | n/a | Suppression handling is in code and tested. DNS is operator work: `docs/runbooks/email-deliverability.md`. |

## Phase 4 - Payroll and time completeness (ADR-026)

| Task | Status | Verified against | Notes |
|---|---|---|---|
| Proration (30-day basis) | Done | engine golden vectors | An integration defect was found and fixed; see "Integration findings". |
| Mid-period compensation split | Done | engine golden vectors | |
| Overnight shift attribution | Done | unit tests, UTC+4 arithmetic | Configurable; defaults to shift start date in `Asia/Dubai`. |
| Notice pay and end-of-service preview | Done (partial) | engine golden vectors | Statutory treatment awaits reviewer sign-off. |
| Off-cycle adjustment runs | Done | PostgreSQL 16 | |
| Contractors in pay runs | Done (off by default) | engine, PostgreSQL 16 | Opt-in. Treatment awaits reviewer confirmation. |
| Reversal correctness | Done | PostgreSQL 16 | Compensating run linked to the original; chains rejected. |
| Golden vectors and property tests | Done | engine | 40 engine tests. Parallel-run diff for the new cases is external. |

## Phase 5 - Documents and storage (ADR-028)

| Task | Status | Verified against | Notes |
|---|---|---|---|
| Object-storage adapter | Done | local FS, moto S3 | See Phase 0. |
| Envelope encryption before storage | Done | PostgreSQL 16, local store | AES-GCM with the subject key; plaintext hash retained. |
| Virus scanning and quarantine | Done | real ClamAV daemon | EICAR is quarantined; scanner errors retry and never release the file. |
| Crypto-erasure deletes object references | Done | PostgreSQL 16, local store | |
| Legacy blob migration tool | Done | PostgreSQL 16 | `docs:migrate-to-store`; resumable, dry-run, verifies read-back before clearing. |
| Payslip archive | Done | PostgreSQL 16 | Integrity checked on write and on every read. |
| Drive and SharePoint connectors | Blocked: external | n/a | Owner decision D-1. Only the interface is staged. |

## Phase 6 - Platform and API surface (ADR-029)

| Task | Status | Verified against | Notes |
|---|---|---|---|
| API-key write opt-in, per-key rate limit, expiry | Done | PostgreSQL 16 | |
| Webhook allow-list and delivery-log retention | Done | PostgreSQL 16 | Provider delivery is stubbed in tests. |
| MCP server | Not built (design only) | n/a | `docs/mcp-server-design.md`; the blueprint says only after the API is stable. |
| SDK | Done (partial) | TypeScript build, drift test | `packages/sdk`, Apache-2.0. **Not published**; publishing needs the owner's registry account. |

## Phase 7 - Observability, reliability, operations (ADR-030)

| Task | Status | Verified against | Notes |
|---|---|---|---|
| Metrics, tracing, log redaction | Done (partial) | real process | Prometheus metrics are token-guarded. OTLP export to a vendor not run. |
| Pay-day watchdog and alerts | Done (partial) | PostgreSQL 16 | Firing in a staging stack is external. |
| Redis-backed rate limit, multi-instance | Done | real Redis | Two API instances share limits. |
| HA database, PITR | Blocked: external | n/a | Needs a managed Postgres account. |
| Restore drill | Done | PostgreSQL 16 | Positive and negative runs (a tampered copy is detected). Managed PITR not exercised. |
| Runbooks | Done (drafts) | n/a | `docs/runbooks/`. |
| Outbox exactly-once with two workers and lease expiry | Done | PostgreSQL 16 | 200 rows, a killed batch, two concurrent claimers: each row accepted once by an idempotency-keyed provider stand-in (not a real mail vendor). |
| Concurrent pay-run start and idempotency | Done | PostgreSQL 16, real Fastify | Ten simultaneous starts gave one 201 and nine 409s; ten same-key requests gave one side effect; same key with a different body gave 422. |
| Load test (1,000 employees) | Done (single sample) | PostgreSQL 16, shared 6-vCPU/24-GB sandbox VM | Calculate 1,925 ms, finalise outputs 4,151 ms, whole lifecycle 12,510 ms, peak RSS 204 MB. Blueprint target is calculation p95 < 30 s; one sample is below it but is not a p95. No bank data seeded (SIF rows 0). Larger tenants and a CPU flame graph are not done. See `docs/runbooks/load-test.md`. |
| Authenticated browser E2E | Done (Chromium) | local API + Vite preview | Fresh tenant, UI login, dashboard/people/payroll/audit at 375 and 1280 px, no overflow or console errors, logout. 6 Playwright tests pass; WebKit not run for the authenticated path. |
| Multi-instance deployment topology (2 API + 2 worker behind a balancer) | Blocked: external | n/a | Needs a hosting environment. Redis rate limit and outbox claiming were tested with multiple instances in one machine. |
| CI changes | Done (partial) | YAML parse, actionlint | Not yet observed running on GitHub Actions. |

## Phase 8 - AI assistant hardening (ADR-029, ADR-032)

| Task | Status | Verified against | Notes |
|---|---|---|---|
| LLM gateway with consent, allow-list, DLP | Done (partial) | stub model | No real model provider was called. |
| Prompt-injection eval suite | Done | stub model | 40 hostile cases. A stub proves the firewall, not a real model's behaviour. |
| Privacy note | Done (draft) | n/a | `docs/privacy/assistant-data-flow.md`; counsel or DPO review is external. |
| Grounding and no-model fallback | Done | PostgreSQL 16 | |

## Phase 9 - Compliance and certification

| Task | Status | Notes |
|---|---|---|
| Data inventory, DPIA, breach procedure, retention policy, SOC 2 mapping, pen-test scope | Done (drafts) | `docs/compliance/`. None has been reviewed by counsel, a DPO or an auditor, and each says so. |
| Penetration test | Blocked: external | Scope is written; a vendor must be engaged. |
| SOC 2 audit | Blocked: external | Control mapping only. |

## Phase 10 - Go-to-market and scale

Business work, not engineering. Nothing here was built. Pricing, multi-cell residency and any Rust/WASM engine port depend on owner decisions and on real profiling data.

## Integration findings (made while merging the eight parallel workstreams)

| Finding | How it was found | Fix |
|---|---|---|
| Proration divided by the 30-day basis with no cap, so a full 31-day month paid 31/30. | The independent golden vector from Phase 2 disagreed with the Phase 4 engine. | New `period.is_full` input; a full period pays in full, a partial period uses `min(days_payable, days_basis)/days_basis`. The UAE pack stays version `0.2.0` and its hash changed; the pack is L0, so no sign-off was invalidated. Commit `e443b3e`. |
| `kernel.account_token` (a Phase 3 table) had no RLS. | The Phase 1 catalog RLS test failed on the merged tree. | Migration 027 enables and forces RLS with auth and owner policies. |
| `docs:migrate-to-store` could not read tenant keys under forced RLS. | The Phase 5 migration test failed on the merged tree. | Migration 027 adds a read-only policy for `meridian_owner` on `kernel.tenant_key`. RLS was not weakened for any runtime role. |
| The scanner defaulted to `none` in tests, so the EICAR test saw a clean file. | Same test run. | The test helper defaults to the real `clamd`; CI gains a ClamAV service. |

## Test totals on the merged branch

API 184 tests (18 files; real PostgreSQL 16, Redis and ClamAV, `moto` for S3 and KMS), engine 40, web component tests 5, Playwright 6. API and web typecheck and build pass. The CLIs `docs:migrate-to-store` (dry run), `keys:init`, `keys:upgrade` and `review:rls` were run against a test database after the merge. Not yet observed: a GitHub Actions run of the extended pipeline.
