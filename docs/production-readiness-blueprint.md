# Meridian — Production-Readiness Blueprint

**People & Payroll Platform · Backend Architecture & Go-to-Market Development Plan**

| | |
|---|---|
| **Repository analysed** | `SYED90909032/meridian-hr-payroll` (branch `main`, commit `23848ae`) |
| **Current status** | Working reference implementation — API (139 routes, migrations 001–012), deterministic engine, 17-page web UI, 33 engine + 117 API tests green |
| **Payroll assurance** | UAE pack at **L0** — sandbox/parallel runs only, live payment blocked in code |
| **This document** | The complete plan to move from "reference implementation" to a secure, audited, commercially deployable payroll platform |

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [What Meridian is — product analysis](#2-what-meridian-is)
3. [How it works — architecture deep-dive](#3-how-it-works)
4. [Current-state maturity assessment](#4-current-state-maturity-assessment)
5. [Production-readiness gap analysis](#5-production-readiness-gap-analysis)
6. [Target architecture — the recommended backend](#6-target-architecture)
7. [Technology decisions (with rationale)](#7-technology-decisions)
8. [Development plan — phases and steps](#8-development-plan)
9. [Security hardening roadmap](#9-security-hardening-roadmap)
10. [Operations, reliability & disaster recovery](#10-operations-reliability--disaster-recovery)
11. [Compliance & certification roadmap](#11-compliance--certification-roadmap)
12. [Testing & QA strategy](#12-testing--qa-strategy)
13. [Migration & go-live plan](#13-migration--go-live-plan)
14. [Risk register](#14-risk-register)
15. [Open decisions required from the product owner](#15-open-decisions-required)
16. [Appendix — success metrics & timeline](#16-appendix)

---

## 1. Executive summary

Meridian is an **open-source, multi-tenant people & payroll platform** built UAE-first. Its differentiators are structural rather than cosmetic: a **deterministic, integer-only payroll engine** that returns byte-identical results for identical inputs; a **database that enforces tenant isolation itself** via forced row-level security (RLS); an **append-only, hash-chained, Ed25519-sealed audit trail**; and **field-level encryption with crypto-erasure** for the most sensitive data.

The current code is a *working reference implementation*, not a production payroll system. Every feature the product promises runs and is tested, but three things deliberately stand between the code and real salaries:

1. The UAE rule pack is assurance **L0** (written from published sources, not reviewed by a qualified payroll/legal professional) and the WPS bank file has never been validated by a bank.
2. The master key lives in an environment variable, not a managed KMS.
3. Email delivery does not exist, so invitations and password resets are shown on-screen instead of sent.

This blueprint is organised as a **gated release plan**: it keeps the architecture that is already correct (the modular monolith, PostgreSQL as the source of truth, the deterministic engine, the layered security model) and adds what a production, bank-facing, multi-tenant payroll product must have to be trusted with salaries, bank details and national IDs.

**The headline recommendation:** keep the modular monolith. Do **not** decompose Meridian into microservices. Payroll's hardest property — "an approval is bound to an exact set of calculated results" — depends on atomic, multi-table transactions inside one database. Microservices would move that integrity to distributed coordination, where it is much easier to get wrong. Instead, scale the monolith horizontally (stateless API instances behind a load balancer) and put async work behind the outbox pattern that already exists.

---

## 2. What Meridian is

### 2.1 Product positioning

A single platform for small and mid-size employers to run **people operations and payroll in one place**, with a hard focus on **correctness, explainability and auditability** rather than breadth of features. The intended users are the seven roles below, all scoped to a single tenant (company):

| Role | Purpose |
|---|---|
| `owner` | Full tenant administration |
| `hr_admin` | People, org, time, leave, documents |
| `payroll_admin` | Prepares and runs payroll |
| `payroll_approver` (finance) | Independent approver of pay runs |
| `manager` | Approves leave/expense for their reports (scope `reports`) |
| `employee` | Self-service: own payslips, leave, time |
| `auditor` | Read-only access to audit + integrity |
| `helpdesk_agent` | Helpdesk tickets, announcements, knowledge base |

### 2.2 What is in the box today (built and tested)

| Area | What works |
|---|---|
| **Identity & access** | Registration; scrypt password hashing (N=2¹⁵); account lockout with exponential back-off; sessions with idle (30 min) + absolute (12 h) expiry; TOTP MFA with recovery codes; step-up re-authentication (10-min window); 7 roles with per-route permission checks; per-user session list + revoke |
| **People** | Directory; employee records with optimistic concurrency; organisation tree (cycle-proof); managers/teams; contract types; termination; field-level reveal of ID & bank data (audited) |
| **Time** | Attendance; manual punches; shift templates + assignment; public holidays; device ingest with per-device keys; settings |
| **Leave** | Leave types; balances/entitlements; working-day counting (weekends + holidays); requests; approval routing up the manager chain; calendar |
| **Approvals** | One engine for leave and payroll; content-hash-bound decisions; no self-approval; single-admin exception with 24 h release delay (ADR-006) |
| **Payroll** | Pay groups; one-off adjustments; run lifecycle (draft → calculated → submitted → approved → finalised → published); deterministic calc with per-line explanations; exceptions that block approval; WPS SIF export; frozen payslips; rule packs with assurance levels |
| **Service** | Helpdesk tickets (confidential class RLS); announcements; knowledge base |
| **Assistant** | Tool-restricted assistant; pseudonymised people; pay/bank/ID data never reaches the model |
| **Audit** | Hash-chained events; Ed25519-sealed Merkle blocks; integrity verification; public-key export |
| **Platform** | Read-only API keys; signed webhooks with SSRF protection; delivery log; OpenAPI at `/api/v1/openapi.json` |
| **Data protection** | Per-employee data keys; AES-256-GCM field encryption; crypto-erasure on termination request |

### 2.3 Feature catalogue that is *staged* (from the v2 blueprint, not yet built)

The repository carries a broader blueprint (`docs/blueprint-v2.md` + `blueprint-v2.1-delta.md`) describing 17 product pages. The following are **staged**: passkeys, OIDC/SAML SSO, SCIM, MCP OAuth server, Google Drive/SharePoint document connectors, mobile apps, the Rust/WASM engine port, Cloudflare edge workers + Go biometric bridge, talent/rewards/recruiting modules, countries other than the UAE, email delivery, leave proration, overnight shifts, and contractors in pay runs.

### 2.4 What it *deliberately* does not do yet (and must not pretend to)

Per `docs/SECURITY.md`: the UAE pack is **L0** (unreviewed); the WPS SIF file is **unvalidated by any bank**; live bank payment is **blocked in code** until a pack reaches **L2**; the RLS policies have only been reviewed by their author; there is **no email delivery**; no penetration test; no SOC 2 / ISO 27001 evidence; no DPA/privacy review.

---

## 3. How it works

### 3.1 Repository layout

```
packages/engine      pure deterministic payroll engine (integer arithmetic, no floats)
apps/api             Fastify 5 API — PostgreSQL migrations (001-012), outbox worker, seed
apps/web             React 19 + Vite single-page app (17 pages), own CSS tokens
docs/                SPEC, ADRs (001-021), SECURITY, THREAT_MODEL, research notes, blueprint
spec/, tasks/        capability map, plan, todo, progress notes
scripts/             database bootstrap + reset
```

One Postgres **schema per module** (`kernel`, `people`, `flow`, `tm`, `pay`, `svc`, `plat`, `ai`). Application code reads another module's data **only through that module's service functions** (a light modular-monolith discipline, not a microservice boundary).

### 3.2 The request pipeline (the "cannot be bypassed" path)

Every route is registered through `defineRoute` (`apps/api/src/http/route.ts`). The pipeline order is **fixed and cannot be skipped**:

1. **Authentication** — API key → device key → session cookie, in that order.
2. **Authorisation** — role × scope permission check, deny by default.
3. **Step-up / MFA** — sensitive actions require re-auth within 10 min and/or MFA enabled.
4. **Validation** — strict zod schemas; unknown fields rejected.
5. **Handler** — runs inside one database transaction with `tenant_id` and `user_id` bound to the session.
6. **Idempotency** — `Idempotency-Key` replays the stored response on mutating routes.

Because `GET /api/v1/openapi.json` is generated from the same registry, **documentation cannot drift from code**.

### 3.3 The layered security model (the part that must not break)

The platform's security is layered from the outside in (`docs/SECURITY.md`, `docs/THREAT_MODEL.md`):

1. **Edge/transport** — Helmet, strict CSP (`default-src 'self'`, no inline script), HSTS in prod, no CORS by default, per-route rate limits, 256 KB body cap.
2. **Authentication** — scrypt (N=2¹⁵) constant-time compare; lockout with back-off; opaque 256-bit session tokens in `HttpOnly`/`SameSite` cookies (only SHA-256 stored); TOTP MFA; step-up.
3. **Authorisation (app)** — role × scope permission on every route.
4. **Authorisation (database)** — two runtime roles (`meridian_auth` for identity only, `meridian_app` with no `BYPASSRLS` and no table ownership). Every tenant table uses `FORCE ROW LEVEL SECURITY`; restricted classes (compensation, bank, national ID, payroll results, payslips, confidential tickets, special leave reasons) add scope-read/self-read/scope-write policies via `app.can_see` / `app.can_write`.
5. **Data at rest** — bank + national ID are AES-256-GCM encrypted under a per-subject key, wrapped by a tenant key, wrapped by the master key. HMAC blind indexes allow duplicate detection without decryption. Crypto-erasure destroys the wrapped key.
6. **Integrity** — hash-chained audit events written in the same transaction; payroll snapshots/results/payslips immutable by trigger; pay-run transitions enforced by trigger.
7. **Approvals** — content-hash-bound single-use tokens (15 min); no self-approval; single-admin exception with 24 h delay.
8. **Outbound** — HMAC-SHA256-signed webhooks; SSRF guard (private/loopback/link-local/metadata ranges blocked; DNS resolved once; pinned IP; no redirects).
9. **AI** — fixed read-only tools; pseudonymised people; no pay/bank/ID in tool output.
10. **Operations** — no secrets in repo; no stack traces; log redaction.

### 3.4 The payroll engine (why results are trustworthy)

`packages/engine` is a pure package with **no floats** — all money is integer minor units with `BigInt` intermediates. Rules are a **JSON expression tree** over a closed set of host functions (`mul_rate`, `pro_rata`, `round`, `min`, `max`, `tax_table`) — no `eval`, a cost limit, and central rounding. The UAE pack (`packs/uae.ts`) covers GPSSA (employee + employer, contribution clamp), WPS SIF generation, gratuity, and overtime.

The pay-run lifecycle is a trigger-enforced state machine: `draft → inputs_locked → calculated → in_review → approved → finalised → payment_released → paid → published`, plus `cancelled / rejected / reopened / reversed`. Locking snapshots each employee's input with a canonical (RFC 8785-style) hash; the engine reads **snapshots only**, so the same snapshot + pack + engine version gives byte-identical results (the golden-vector contract that a future Rust/WASM port must match).

### 3.5 Asynchronous work (outbox)

The worker (`apps/api/src/worker.ts`) claims outbox rows with a least-privilege `meridian_worker` role (two `SECURITY DEFINER` functions), delivers webhooks through the app role, and re-queues failed rows with exponential back-off. This is the correct pattern and must be extended (not replaced) for email/SMS.

---

## 4. Current-state maturity assessment

| Dimension | Grade | Notes |
|---|---|---|
| Code quality & architecture | **A** | Clean modular monolith, excellent separation, engine isolated as a pure package |
| Security design | **A−** | Genuinely strong and unusually complete; the gaps are *organisational* (independent review, KMS) not architectural |
| Test coverage | **B+** | 33 engine + 117 API tests, negative auth tests, catalog-driven cross-tenant tests; **no web component tests / Playwright in CI** |
| Payroll correctness | **C− (gated)** | Engine is deterministic and explainable, but the UAE pack is **L0** — unreviewed and bank-unvalidated |
| Production operations | **D** | No observability, no HA story, no backup/DR runbook, single-instance rate limits, env-var master key |
| Compliance | **D** | No pen test, no SOC 2 / ISO 27001, no privacy/DPA review, no data-residency policy in code |
| Product completeness | **B−** | Core R1–R4 works; communications (email), SSO, document storage, and several payroll edge cases are missing |
| Commercial readiness | **Not ready** | Correctly self-labelled as a reference implementation |

**Verdict:** the *hardest engineering problems* (deterministic calculation, tenant isolation at the database, tamper-evident audit, field encryption) are already solved correctly. The path to production is dominated by **assurance, operations, compliance and a small set of missing features** — not by architectural rework.

---

## 5. Production-readiness gap analysis

Prioritised by **risk to real salaries and real personal data** (not by effort):

| # | Gap | Severity | Blocking for |
|---|---|---|---|
| G1 | UAE rule pack at L0; WPS file unvalidated by a bank | **Critical** | Any live payroll |
| G2 | Master key in an env var; no cloud KMS / HSM with separation of duties | **Critical** | Real data at rest (T13, T17) |
| G3 | RLS policies reviewed by only one author | **Critical** | Multi-tenant launch |
| G4 | No email/SMS delivery → no invitations/reset, approval links unrouteable | **High** | Usability, security (temporary passwords shown on-screen) |
| G5 | No penetration test | **High** | Trust, certification |
| G6 | No observability (metrics/tracing/alerting); no HA; no DR/backup runbook | **High** | Running payroll at scale, pay-day reliability |
| G7 | No SSO/OIDC/SAML, passkeys, SCIM | **Medium** | Enterprise customers |
| G8 | Payroll edge cases missing (leave proration, mid-period comp split, overnight shifts, notice pay, contractors, off-cycle runs) | **Medium** | Correct payroll for many real workforces |
| G9 | Document storage in DB; no virus scanning; no Drive/SharePoint | **Medium** | Document-heavy HR workflows |
| G10 | Rate limiting is in-process → breaks under horizontal scaling | **Medium** | Multi-instance deployment |
| G11 | No SOC 2 / ISO 27001 / PDPL / GDPR evidence; no DPA | **Medium** | Contracts with employers |
| G12 | No SBOM / dependency provenance signing | **Low** | Supply-chain hardening (T15) |
| G13 | Audit seals not stored off-box | **Medium** | True independent verification (T9) |
| G14 | API key/webhook destination allow-list per tenant absent | **Low** | Defence-in-depth (T10) |

---

## 6. Target architecture

### 6.1 The recommended backend — keep the modular monolith, scale it out

```
                        ┌───────────────────────────────────────────────────────────────┐
                        │                      Edge (Cloudflare or equivalent)           │
                        │   TLS termination · WAF · DDoS · bot mgmt · rate-limit shield   │
                        └───────────────────────────────┬───────────────────────────────┘
                                                         │ HTTPS
                        ┌───────────────────────────────▼───────────────────────────────┐
                        │                 Load balancer / API gateway (L7)                │
                        └───────┬───────────────────────┬───────────────────────────────┘
                                │                       │
                    ┌───────────▼───────────┐   ┌───────▼───────────┐
                    │  API instance (N ≥ 2) │   │ API instance ...  │   ← stateless, identical
                    │  Fastify 5 + Node 22  │   │                   │
                    └───────────┬───────────┘   └───────┬───────────┘
                                │                       │
                    ┌───────────▼───────────┐   ┌───────▼───────────┐
                    │  Worker instance (N)  │   │  Worker ...       │   ← outbox consumers
                    └───────────┬───────────┘   └───────┬───────────┘
                                │                       │
        ┌───────────────────────┼───────────────────────┼───────────────────────┐
        │                       │                       │                       │
┌───────▼───────┐     ┌─────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
│ PostgreSQL 16 │     │  Redis (cache /  │     │  Object storage │     │  Managed KMS /  │
│ primary + HA  │     │  distributed     │     │  (S3 / R2 / GCS)│     │  HSM (envelope) │
│ + PITR backups│     │  rate limit)     │     │  encrypted docs │     │  + Secrets Mgr  │
└───────────────┘     └──────────────────┘     └─────────────────┘     └─────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│  Auxiliary (all driven by the outbox, never inline in a request):                       │
│  Email/SMS provider · Bank/WPS file transport · LLM gateway (optional)                  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Why not microservices:** a pay run's guarantee — "approval is bound to a content hash of results, and finalisation rebuilds that hash from stored rows to prove nothing moved" — is a *single-transaction* property. It lives in Postgres (partial unique index on active runs, immutable snapshots, trigger-enforced transitions, idempotency rows in the business transaction). Splitting this across services would replace database guarantees with distributed coordination and is the most likely way to introduce a payroll-integrity bug. The modular-monolith discipline (schema-per-module + service-only cross-module access) already gives the *organisation* of microservices without the *consistency* cost.

**Scale the monolith horizontally instead:**
- Stateless API instances (session state already in DB; secrets via secret manager; no local files).
- Move rate limiting from in-process to **Redis** (or a Postgres-backed store) so instances share a limit budget.
- N worker instances claim from the outbox (the existing `claim_outbox` uses a lease, so it already tolerates concurrency).

### 6.2 Target technology stack (recommended)

| Layer | Recommendation | Rationale / rejected alternative |
|---|---|---|
| Runtime | Node 22 LTS | Already chosen (ADR-001); HA unit |
| API | Fastify 5 + TypeScript | In place; excellent schema/perf; OpenAPI from registry |
| Database | **PostgreSQL 16, managed** (RDS Multi-AZ, Aurora PostgreSQL, or Neon/Supabase per ADR-009) | RLS, triggers, partitioning, PITR — core Postgres; keep vendor-portable SQL |
| Search | Postgres full-text + `pg_trgm` first; OpenSearch only when analytics outgrow SQL | Payroll search volume is modest; avoid premature infra |
| Cache / rate limit | **Redis** (managed) | Shared rate-limit budget + ephemeral caching; sticky sessions avoided |
| Object storage | **S3 / Cloudflare R2 / GCS** with client-side (envelope) encryption before upload | Documents + archived payslips; solves G9; R2 avoids egress fees |
| KMS | **AWS KMS / GCP KMS / Vault** behind the existing `Kms` interface | Resolves ADR-011 (G2); separation of duties |
| Secrets | AWS Secrets Manager / GCP Secret Manager / Vault | No env-var secrets in prod |
| Email / SMS | Postmark/SES/SendGrid via outbox; Twilio for SMS | Resolves G4; provider behind an interface |
| Edge | Cloudflare (WAF, DDoS, TLS, bot) | API logic stays on Node (ADR-001) |
| Observability | OpenTelemetry (traces + metrics) → Grafana/Datadog; pino structured logs; Sentry | Resolves G6 |
| CI/CD | Existing GitHub Actions extended with deploy + E2E + SBOM | Resolves G12 |
| Engine | TypeScript engine is the **golden reference**; Rust/WASM port later must pass the same golden tests | ADR-004/ADR-008 |

### 6.3 Key architectural additions (all minimal, all behind existing interfaces)

1. **Cloud KMS adapter** — a new `CloudKms` implementation of the existing `Kms` class (the interface already exists: `tenantKey`, `subjectKey`, `blindIndex`, `hmacKey`). Wrapping/unwrapping the master key moves to the managed KMS; the API never holds the raw master key after boot.
2. **Email/SMS channel** — extend the outbox with `email`/`sms` topics and a delivery channel alongside the existing webhook channel. Templates versioned, secrets in the secret manager.
3. **Object-storage adapter** — an `ObjectStore` interface (put/get/presign) with a local-filesystem implementation for dev and S3/R2 for prod. Documents encrypted client-side with the per-employee data key; payslips written to the store and the hash retained in the DB.
4. **Distributed rate limiter** — swap `@fastify/rate-limit`'s in-memory store for a Redis store (config-only change in most cases).
5. **Bank/WPS transport** — UAE payroll is file-based (SIF submitted to the bank/exchange house). "Live payment" = generate the SIF, deliver it over the bank's channel (SFTP or API), and reconcile. This is a **connector behind an interface**, not a PSP integration, and is gated on L2.

---

## 7. Technology decisions

These are recommendations. Where an ADR already exists and I agree with it, it is marked **keep**; where I recommend a change, it is marked **change** and cross-references the ADR.

| ID | Decision | Verdict | Detail |
|---|---|---|---|
| A | Keep the modular monolith | **Keep** | See §6.1. Revisit only if a clear horizontal boundary emerges (e.g. a separate read/analytics replica is fine; separate write services are not). |
| B | PostgreSQL remains the source of truth for authz, locks, idempotency, approvals | **Keep** | ADR-017/018/019. Correct and hard to beat. |
| C | Envelope encryption with a managed KMS | **Change ADR-011** | Resolve the open decision: **AWS KMS** (or GCP KMS) as the default; Vault for self-hosted/regulated customers. Master key never in an env var in prod. |
| D | Email + SMS delivery as outbox topics | **Resolve ADR-015** | Pick a provider (Postmark default, SES for AWS deployments). |
| E | Object storage for documents + payslips | **Change ADR-012** | Move from "encrypted in DB" to "encrypted object in S3/R2, hash in DB." Keeps DB small and payslips durable. |
| F | SSO via a vetted OIDC/SAML library (not hand-written) | **Keep ADR-010** | Passkeys + OIDC/SAML behind the same identity module; never hand-roll OAuth. |
| G | Multi-instance rate limiting via Redis | **New** | Config change; removes the G10 blocker. |
| H | Rust/WASM engine port | **Defer** | The TS engine is the golden reference; only pursue the port when CPU profiling *of a real workload* shows the need. Do not build it speculatively. |
| I | UAE-first, India second | **Keep ADR-002** | Land UAE at L2 first to prove the assurance process. |
| J | AGPL-3.0 core, Apache-2.0 SDK/bridge | **Keep ADR-016** | Confirm the business model accepts AGPL for the core. |
| K | Observability stack: OTel + Grafana (or Datadog) | **New** | Traces, metrics, logs; pay-day alerting. |
| L | CI/CD: extend existing workflow; add deploy, E2E, SBOM | **New** | See §10. |

---

## 8. Development plan

The plan is **gated** — each phase has a *definition of done* and the payroll live-gate is **not** crossed until Phases 0, 1 and 2 are complete. Phases are ordered by risk; several can run in parallel (noted).

### Phase 0 — Decisions, scope lock & security baseline (1–2 weeks)

**Objective:** turn every provisional/assumption into a recorded decision so the rest of the plan is stable.

**Tasks**
- [ ] Resolve ADR-011 (KMS vendor), ADR-015 (email provider), ADR-012 (object storage), ADR-001–008 provisional flags (D1–D16) with the product owner.
- [ ] Confirm the AGPL licensing/business model (ADR-016) and the residency baseline (ADR-014).
- [ ] Freeze the target cloud provider (AWS/GCP/Neon/Supabase) — this affects KMS, secrets, storage, backup tooling.
- [ ] Appoint the two independent reviewers required downstream: **PostgreSQL security reviewer** and **UAE payroll/legal reviewer**.
- [ ] Open a private security-reporting channel (GitHub private advisory is already named in SECURITY.md) and an internal incident-response draft.

**Exit criteria:** a signed "decisions log" replacing the `D1–D16` provisional flags; two named reviewers; cloud provider chosen.

### Phase 1 — Data-protection & database hardening (2–4 weeks) *(can overlap Phase 2)*

**Objective:** close G2, G3, G13 — the three that touch *stored* sensitive data.

**Tasks**
1. **Cloud KMS adapter**
   - Implement `CloudKms extends Kms` using AWS KMS (or GCP KMS) for master-key wrap/unwrap; keep the dev `Kms` for local/test.
   - Boot sequence: fetch + unwrap the data-encryption master key once at startup; never log it; zero it from memory when possible.
   - Add a **key-rotation** path (rotate the tenant-key wrapping without re-encrypting every field — re-wrap the tenant key).
   - Add a **key-custody separation** test proving an operator with DB access but not KMS access cannot decrypt.
2. **Independent RLS review**
   - Engage the named PostgreSQL reviewer to audit migrations 001–012 RLS/role design, the `app.can_see`/`app.can_write` helpers, and the `FORCE ROW LEVEL SECURITY` coverage.
   - Add a **catalog-driven coverage test** that asserts *every* tenant table has forced RLS and no `BYPASSRLS` on runtime roles (extends the existing `db-security.test.ts`).
   - Fix findings; record them.
3. **Off-box audit seals**
   - After each seal, write the seal hash + public key to immutable object storage (S3/R2) and to an operator-owned key-value; add a reconciler that alerts on drift.
4. **Secrets management**
   - Move `MERIDIAN_MASTER_KEY`/`MERIDIAN_SIGNING_KEY`, DB role passwords, and provider keys into the secret manager; remove them from `.env` in prod.
5. **Legal hold on crypto-erasure**
   - Verify the shred operation is blocked under a legal hold and add a test for it.

**Exit criteria:** cloud KMS in use in staging; independent RLS review signed off; off-box seal reconciliation green; no long-lived secrets in env; key-rotation exercised in staging.

### Phase 2 — UAE payroll assurance L0 → L2 (4–8 weeks, parallel-track)

**Objective:** the only gate that blocks live money. This is **not** a code-heavy phase; it is review + evidence.

**Tasks**
1. **Rule review** — the UAE payroll/legal reviewer checks every parameter in `packs/uae.ts` against primary sources; every line keeps its source + review status.
2. **Independent test vectors** — produce a golden set of computed payslips for representative cases (monthly, daily, overtime, unpaid leave, gratuity, GPSSA clamp, negative net) and have the reviewer (or an independent actuary) confirm them.
3. **Bank WPS validation** — obtain the bank/exchange house's WPS SIF validator; generate files for edge cases (variable earnings, unpaid leave days, zero net, multiple employees); iterate until the validator accepts them.
4. **Parallel runs** — run Meridian **in parallel** against a live employer's existing payroll for 2–3 pay cycles; diff gross/net per employee; reconcile to zero unexplained variance.
5. **Flip the assurance flag** — set the UAE pack to **L2** (unlocking `payment_released`) only after all of the above; record the reviewer's sign-off with the pack version it covers.
6. **Bank transport connector** — implement the SIF delivery connector (SFTP/API) behind an interface; add an end-to-end test that uploads to a bank sandbox and reconciles the returned acknowledgement.

**Exit criteria:** signed payroll/legal sign-off; bank-accepted WPS file (evidence on record); ≥2 zero-variance parallel runs; pack promoted to L2; live payment **unblocked in code only** after this phase.

> **Note:** if the bank cannot validate a SIF in a sandbox, live payment stays blocked — do not weaken the gate. This is a *product* gate, not a schedule gate.

### Phase 3 — Communications & identity (3–5 weeks)

**Objective:** close G4 and G7; make the product usable for real workforces.

**Tasks**
1. **Email/SMS outbox channel** — add `email`/`sms` topics to the outbox; delivery worker writes through a provider interface (Postmark/SES + Twilio); templates versioned in-repo; secrets in the secret manager; idempotent send via outbox dedupe.
2. **Invitation & password-reset flows** — send invitation emails with single-use, expiring, content-bound tokens (reuse the existing action-token machinery); add "forgot password" and remove the "temporary password shown on screen" path.
3. **Transactional notifications** — leave-request, approval-pending, pay-run-ready, payslip-published emails.
4. **Passkeys (WebAuthn)** — behind the identity module; store the credential; allow sign-in + step-up.
5. **OIDC/SAML SSO** — via a vetted library (e.g. `openid-client`, a maintained SAML lib); map external groups → Meridian roles; honour `must_change_password` and MFA policy; **never** hand-roll OAuth.
6. **SCIM provisioning** — user/group lifecycle for IdPs that require it (staged; do after SSO).
7. **Email deliverability** — SPF/DKIM/DMARC on the sending domain; bounce + suppression handling.

**Exit criteria:** invitations and resets delivered end-to-end in staging; SSO sign-in works for at least one IdP; passkeys enroll + authenticate; no plaintext temporary passwords.

### Phase 4 — Payroll & time completeness (4–8 weeks, high test discipline)

**Objective:** close G8 — the edge cases that make payroll *wrong* for real workforces.

**Tasks**
1. **Leave proration** — prorate new hires/leavers (resolve the open decision on the proration basis; default to a documented 30-day month basis consistent with the pack).
2. **Mid-period compensation split** — split a pay period at a compensation-change boundary (the bitemporal compensation table already exists; extend the snapshot builder).
3. **Overnight shifts** — attribute a shift that spans midnight to the correct day (staged in the blueprint).
4. **Notice pay & end-of-service on termination** — automatic notice-pay and gratuity calculations per contract type (subject to reviewer sign-off).
5. **Off-cycle / bonus / adjustment runs** — support one-off runs that do not disturb the main cycle.
6. **Contractors in pay runs** — a distinct input path (not statutory employees) once the reviewer confirms treatment.
7. **Reversal correctness** — prove a `reversed` run produces compensating entries and a clean audit trail.
8. **Every new rule** — add golden vectors + property tests before merging; every line keeps its rule id + explanation.

**Exit criteria:** each feature has golden vectors and negative tests; parallel-run diff stays at zero for the new cases; reviewer sign-off on the new statutory rules.

### Phase 5 — Documents & storage (2–3 weeks)

**Objective:** close G9.

1. **Object-storage adapter** (`put`/`get`/`presign`) with local + S3/R2 backends.
2. **Client-side (envelope) encryption** of documents with the employee data key before upload; hash retained in DB; the platform never sees plaintext documents in transit/logs.
3. **Virus scanning** — stream uploaded files through ClamAV (or a managed scanner) before they become retrievable; quarantine on detection.
4. **Crypto-erasure** must also delete/blank the object references on termination request.
5. **Drive/SharePoint connectors** — after the Google decision (D-1); use OAuth service-account + restricted scopes (ADR-007 signature-manager stays deferred).

**Exit criteria:** upload → scan → encrypt → store → retrieve (with step-up reveal + audit) works end-to-end; scan quarantine verified.

### Phase 6 — Platform, integrations & API surface (2–4 weeks)

**Objective:** make Meridian a trustworthy *platform*, not just an app.

1. **Public API hardening** — versioned SDK (Apache-2.0, ADR-016); API-key scopes extended to write scopes only behind an explicit opt-in (today keys are read-only); per-key rate limits and expiry.
2. **Webhook hardening** — per-tenant destination allow-list (closes G14); signed payload replay-window guidance documented for receivers; delivery-log retention policy.
3. **MCP server / OAuth** — staged; only after the public API is stable.
4. **OpenAPI client generation** — publish generated SDK from `/api/v1/openapi.json`.

**Exit criteria:** external integrations (at least one webhook consumer + one API-key consumer) run against staging; SDK published.

### Phase 7 — Observability, reliability & operations (3–5 weeks, run in parallel from Phase 1)

**Objective:** close G6, G10; make pay-day boring.

1. **Observability** — OpenTelemetry traces (per-request trace id already exists as `requestId`); pino structured logs with redaction; metrics (request rate, p50/p95 latency, DB pool, outbox depth, pay-run durations); a **pay-day dashboard + alerts** (e.g. "pay run stuck in `in_review` > N hours", "outbox depth > N", "seal reconciliation drift").
2. **Horizontal scaling** — deploy ≥2 API + ≥2 worker instances; Redis-backed rate limiting; run the existing integration suite against a multi-instance topology.
3. **HA database** — managed Postgres with automatic failover + PITR; a read replica for dashboards/audit if needed.
4. **Backups & DR** — scheduled PITR; periodic **restore drills**; document RPO/RTO per data class (see `blueprint-v2.1-delta` §C0); back up the signing public key **separately** from the DB.
5. **Runbooks** — pay-day runbook, incident-response, key-rotation, leaver (staff) revoke, data-breach, crypto-erasure-request.
6. **Load test** — simulate a large tenant's pay run (thousands of employees) and prove calculation + finalisation stay within SLOs; profile the calculation loop before considering any Rust/WASM port.

**Exit criteria:** pay-day alerts firing in staging; restore drill successful; load test within SLO; multi-instance deployment green.

### Phase 8 — AI assistant hardening (2–3 weeks)

**Objective:** keep the assistant useful without leaking personal data.

1. **LLM gateway** — a dedicated proxy with per-tenant opt-in, model allow-list, and data-loss-prevention on outbound text.
2. **Prompt-injection eval suite** — regression tests for the fixed-tool firewall, pseudonymisation, and refusal of pay/bank/ID.
3. **Privacy review** of exactly what leaves the process (pseudonyms, leave dates, team data) — document it and gate the LLM path behind explicit consent.
4. **Grounding/audit** — every assistant answer cites the tools it called; keep the "no-model, direct-from-tool-results" fallback as a supported mode.

**Exit criteria:** eval suite green; DLP gateway in place; privacy note approved.

### Phase 9 — Compliance, certification & pen test (ongoing, 6–16 weeks)

See §11 for the full roadmap. This phase runs **in parallel** with 1–8 but must **complete before** general availability to enterprise customers.

### Phase 10 — Go-to-market & scale (continuous)

- Pricing/tiers (from `blueprint-v2.md` §"Meridian pricing") finalised against real support costs.
- Multi-cell strategy (ADR-014) for geo-residency; performance tuning; the Rust/WASM engine only if profiling demands it.
- Mobile apps only after the API is stable and the SDK is published.

### Dependency & sequencing summary

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► [LIVE-PAYROLL GATE] ──► Phase 4 ──► GA
                │            ▲
                └── Phase 7 (runs alongside 1–8)
Phase 3, 5, 6, 8 ── can start once Phase 1 is underway
Phase 9 ── parallel throughout; must finish before enterprise GA
```

---

## 9. Security hardening roadmap

Beyond the code, these are the *specific* security actions, mapped to the threat model:

| Action | Threat(s) | Phase | Verification |
|---|---|---|---|
| Cloud KMS with custody separation | T13, T17 | 1 | Operator-with-DB-only cannot decrypt (test) |
| Independent RLS/role review + coverage test | T5, T6 | 1 | Reviewer sign-off; catalog test green |
| Off-box audit seals + drift alert | T9 | 1 | Tamper → reconcile alert |
| Key rotation runbook + drill | T13, T17 | 1 | Rotation exercised in staging |
| Breached-password check (e.g. HIBP k-anonymity) + optional CAPTCHA on login | T1 | 3 | Login hardening tests |
| Device-binding option for sessions | T2 | 3 | Optional, post-SSO |
| Per-tenant webhook allow-list | T10 | 6 | SSRF/allow-list tests |
| SBOM + dependency provenance (`pnpm` lock + `cosign`/SLSA) | T15 | 7 | CI artefact signed |
| External penetration test (web + API + DB boundary) | T1–T4, T10 | 9 | Vendor report |
| WAF + DDoS at edge | T16 | 7 | Config-reviewed |
| Payroll-calc moved off the hot request path if profiling shows it | T16 | 7/10 | Load test |
| Document virus scanning | (unmodelled) | 5 | Quarantine test |
| Session/MFA policy per tenant (enforce MFA for all admins) | T6 | 3 | Policy test |
| Data-retention + legal-hold policy in code | T13 | 1/9 | Test |

**Non-negotiables to keep intact** (regression-guard these): the fixed route pipeline, forced RLS, the append-only audit chain, content-hash-bound approvals, field encryption + crypto-erasure, and the L2 live-payment gate.

---

## 10. Operations, reliability & disaster recovery

| Concern | Approach |
|---|---|
| **SLOs** | Login p95 < 300 ms; list/read p95 < 200 ms; pay-run calculation p95 < 30 s for a 1,000-employee run (tune after load test); availability 99.9% with 99.5% on pay-day communicated up front |
| **RPO/RTO** | Per data class (from blueprint §C0): transactional + audit → RPO ~0 (synchronous + PITR), RTO < 1 h; document/payslip objects → RPO ≤ 15 min, RTO < 4 h |
| **Backups** | Continuous PITR on Postgres; versioned object store; signing public key + latest seal stored off-box |
| **DR** | Warm standby region for the DB; restore drills quarterly; runbook that fails over the API to a second AZ |
| **Pay-day readiness** | Pay-run state watchdog, outbox-depth alerts, "approval pending" alerts, a pre-payday checklist (bank file validated, exceptions zeroed, approver available) |
| **Deployment** | Blue/green or rolling; migrations run via the `meridian_owner` role as a separate step, never by the app; forward-compatible migrations only |
| **Incident response** | Documented owner; private security advisory channel; post-incident "seal + verify audit" step is mandatory |
| **Secrets** | All via secret manager; rotation on a schedule and on any staff change (leaver) |

---

## 11. Compliance & certification roadmap

| Target | Why | Effort | When |
|---|---|---|---|
| **UAE PDPL** | Primary market (UAE-first) | Data inventory, DPIA, breach-notification process | Before UAE GA |
| **SOC 2 Type I → Type II** | Enterprise/HR buyer expectation | Control mapping to the security model above | 6–12 months; start after Phase 1 |
| **ISO 27001** | International (optional but credible) | ISMS | Optional; 6–12 months |
| **GDPR** (for later EU entry) | EU employers | DPA, DSAR, erasure (already crypto-erase capable) | Before EU entry |
| **Penetration test** | G5 | Annual external pentest | Before GA, then annually |
| **Privacy review / DPA** | G11 | Independent privacy counsel | Before GA |

**Evidence the code already provides** (reuse it): crypto-erasure for the right-to-erasure, field encryption for breach mitigation, audit chain for accountability, SSRF guard for outbound safety, pseudonymised AI for data minimisation.

---

## 12. Testing & QA strategy

| Layer | Today | Add |
|---|---|---|
| Engine | 33 unit + property tests | **Independent golden vectors** (Phase 2); property tests for new rules (Phase 4) |
| API integration | 117 tests on real Postgres | Multi-instance concurrency tests; KMS-key-rotation tests; SSO/OIDC tests; email outbox tests |
| Database security | 26 RLS/role attacks | **Catalog-driven coverage** test (every tenant table forced RLS); custody-separation test |
| Web | None in CI | **Playwright E2E** (login → leave → approve → pay run → payslip) + component tests |
| Performance | None | Load test for 1,000/10,000-employee pay runs; calc-loop profiling |
| Security | Secret scan, `pnpm audit` | SBOM + provenance, pen test (annual), dependency policy |
| Payroll correctness | Golden tests | Parallel-run diff harness (Phase 2) |

**Definition of "fully functional"** (per feature): a route has (1) schema validation, (2) permission + step-up/MFA wiring, (3) an audit row, (4) a positive test, (5) a negative authorisation test, and (6) — if it touches money — a golden vector.

---

## 13. Migration & go-live plan

1. **Staging** mirrors prod exactly (managed Postgres, KMS, secrets, Redis, object store, observability).
2. **Data import** from the reference DB via a reviewed, idempotent import tool (or start fresh for beta tenants).
3. **Beta** with 1–3 friendly employers on **sandbox payroll**, parallel-run diff against their existing provider for ≥2 cycles (Phase 2 doubles as this).
4. **First live pay run** (small, single-employer, owner-present, runbook in hand) after the L2 gate.
5. **Ramp** — add tenants gradually; monitor the pay-day dashboard and seal reconciliation each cycle.
6. **GA** — open signups only after Phase 9 compliance artefacts are in place.

---

## 14. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| UAE payroll rule is wrong in an edge case | Medium | High (real salary error) | L2 process, parallel runs, per-line explanations, golden vectors |
| Bank rejects WPS file in prod | Medium | High (late pay) | Bank validation in Phase 2; fallback manual file path |
| RLS has a latent bug | Low–Medium | High (data leak) | Independent review + coverage test + negative tests |
| Operator + KMS custody collusion | Low | High | KMS separation of duties; audit-of-reveal |
| Single-admin exception abused | Low | Medium | 24 h delay + flagged line + second-contact notice (ADR-006) |
| Pay-day outage | Medium | Medium | HA DB, multi-instance, alerts, DR runbook |
| SSO misconfiguration | Medium | Medium | Vetted library, no hand-rolled OAuth, IdP config review |
| Scope creep (mobile, talent, Rust) | High | Medium | Gate on profiling/business need; stick to R1–R4 first |
| AGPL/business-model mismatch | Low | High | Confirm in Phase 0 |

---

## 15. Open decisions required

These **must** be answered by the product owner (they were left as `D1–D16` / open ADRs). Everything in this blueprint assumes a default; record the final answers in Phase 0:

1. **Cloud provider / hosting** (AWS vs GCP vs Neon/Supabase) — drives KMS, secrets, storage, backup tooling (ADR-009/011/014).
2. **KMS vendor + custody model** — AWS KMS, GCP KMS, or Vault (ADR-011, open).
3. **Email/SMS provider** (ADR-015) and **object-storage vendor** (ADR-012).
4. **Business model vs AGPL-3.0** (ADR-016) — is an AGPL core acceptable for the intended commercial product?
5. **UAE reviewer + bank channel** — who signs off the pack, and which bank/exchange validates WPS (Phase 2 is impossible without this).
6. **Proration basis and mid-period split semantics** — the exact legal bases (currently assumed 30-day month).
7. **Target customer profile & scale** — "small and mid-size" needs a number (100 vs 5,000 employees) to set the load-test target and pricing.
8. **Which compliance marks are contractual** (SOC 2 vs ISO 27001 vs PDPL-only) — changes the Phase 9 timeline.

---

## 16. Appendix

### 16.1 Success metrics (post-GA)

- **Payroll correctness:** zero unexplained gross/net variance across all parallel runs and every live cycle.
- **Security:** annual pen test with no high/critical findings open; RLS review sign-off; KMS custody separation proven.
- **Reliability:** pay-day availability 99.5%+; every pay run completes with a sealed, verifiable audit chain.
- **Product:** a new employer can onboard (register → add people → run a sandbox payroll → publish payslips) without engineering help.
- **Trust:** an independent auditor can verify the audit chain using the exported public key, without any access to the platform.

### 16.2 Indicative timeline

| Milestone | Rough elapsed time | Cumulative |
|---|---|---|
| Phase 0 (decisions) | 1–2 w | 1–2 w |
| Phase 1 (security/KMS/RLS) | 2–4 w | 3–6 w |
| Phase 2 (UAE L0→L2) | 4–8 w (mostly review/parallel) | 7–14 w |
| Phase 7 (ops/observability) | 3–5 w (parallel) | in parallel |
| Phases 3, 4, 5, 6, 8 | 3–8 w each, partially parallel | 14–26 w |
| Phase 9 (compliance) | 6–16 w (parallel) | gates GA |
| **First live pay run** | — | **after Phase 2 + Phase 7, ≈ week 12–18** |
| **General availability** | — | **≈ month 6–9, gated on Phase 9** |

### 16.3 The single most important line to defend

> **Do not weaken the L2 gate.** Live bank payment stays blocked until the UAE pack has a named reviewer's sign-off, independent test vectors, a bank-accepted WPS file, and zero-variance parallel runs. Everything else in this blueprint is negotiable; that is not.
