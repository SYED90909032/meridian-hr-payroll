# Meridian build 0.1: Specification

Status: working spec. Derived from `docs/blueprint-v2.md` plus `docs/blueprint-v2.1-delta.md`. Where they disagree, v2.1 wins.

## 1. Objective

Build a secure, open-source people and payroll platform for small and mid-size employers. One company (tenant) can manage its people, time and leave, approvals, helpdesk and payroll in one place. Payroll is deterministic, explainable and auditable.

Users: owner, HR admin, payroll admin, payroll approver (finance), manager, employee, auditor.

Success looks like this:
1. An employee can never read another employee's pay, bank or national ID, even through a bug in application code. The database refuses.
2. No pay run reaches `approved` without a different person, step-up authentication and a content-bound approval.
3. Recalculating the same snapshot with the same engine and pack gives byte-identical results.
4. Every state change is in a tamper-evident audit chain that can be verified.

## 2. Assumptions (correct me now)

1. TypeScript modular monolith on Node 22, PostgreSQL 16, one cell. (D1, D9)
2. The v2.1 provisional decisions D1 to D16 stand until you change them. See `docs/adr/`.
3. First country is UAE (D2). The UAE pack ships at assurance L0, so it can run sandbox and parallel runs only. Live money movement is blocked in code until a pack reaches L2 (D3).
4. This build uses a local envelope-encryption KMS adapter (master key from the environment). A cloud KMS plugs in behind the same interface (D11 stays open).
5. Auth is built on vetted primitives (Node scrypt, RFC 6238 TOTP) inside one identity module (D10). Passkeys, OIDC and the MCP OAuth server are staged.
6. Cloudflare edge Workers, the Go biometric bridge, the Rust/WASM engine and mobile apps are staged, not built. The engine's input and output contracts are fixed now so the Rust version can replace the TypeScript one and must pass the same golden tests.
7. UI is a React web app styled with the Spike Admin design system on MUI v7, light and dark mode (ADR-022, supersedes ADR-020).

## 3. Commands

```
Install:   pnpm install
DB setup:  pnpm db:migrate            (needs DATABASE_URL_OWNER)
Seed demo: pnpm db:seed
Dev API:   pnpm --filter @meridian/api dev
Dev web:   pnpm --filter @meridian/web dev
Test all:  pnpm test                  (engine unit/property tests, API integration tests on real Postgres)
Typecheck: pnpm typecheck
Build:     pnpm build
Audit:     pnpm audit --prod
```

## 4. Project structure

```
packages/engine      deterministic payroll engine: money, canonical JSON, pack compiler, UAE pack, calc
apps/api             Fastify API; src/modules/<module>; migrations/*.sql; test/*.test.ts
apps/web             React + Vite single-page app, served by the API in production
docs/                spec, ADRs, threat model, security notes, research
tasks/               plan.md and todo.md
```

One Postgres schema per module (`kernel`, `people`, `flow`, `tm`, `pay`, `svc`, `plat`, `ai`). Application code reads another module's data only through that module's service functions.

## 5. Security model (the part that must not break)

Layers, from the outside in:

1. **Edge and transport.** Security headers, strict CSP, no CORS by default, HSTS in production, rate limits on login, ingest and approval endpoints, body size caps.
2. **Authentication.** scrypt password hashes (N=2^15). Optional TOTP. Lockout with backoff. Sessions are random 256-bit tokens in an httpOnly, SameSite cookie; only the SHA-256 is stored. Step-up auth (password or TOTP re-verification) stamps the session for 10 minutes.
3. **Authorisation, app layer.** Role x scope permission check on every route. Deny by default.
4. **Authorisation, database.** Two roles: `meridian_auth` (identity tables only) and `meridian_app` (no `BYPASSRLS`, no table ownership). Every tenant table has `FORCE ROW LEVEL SECURITY` with a restrictive tenant wall. Restricted classes (compensation, bank, national ID, payroll results, payslips, confidential tickets, special leave reasons) add scope-read, self-read and scope-write policies through `app.can_see` and `app.can_write`.
5. **Data at rest.** Bank account and national ID are AES-256-GCM encrypted under a per-subject key wrapped by the tenant key. Blind indexes (HMAC) allow duplicate detection without decrypting. Shredding a subject destroys the wrapped key. Shredding is blocked under a legal hold.
6. **Integrity.** Audit chain with hash links written in the same transaction. Payroll snapshots, results and payslips are immutable by trigger. Pay-run transitions are enforced by a trigger.
7. **Approvals.** State changes only via POST. Action tokens are single-use, 15 minutes, bound to approver, step and content hash. Payroll, role and bank approvals require in-app step-up.
8. **Outbound.** Webhooks signed with HMAC-SHA256, URLs checked by an SSRF guard (blocks private, loopback, link-local and metadata ranges, resolves DNS before connecting, no redirects).
9. **AI.** The assistant sees only pseudonym tokens for people, never raw restricted fields. It can only read through tiered tools and can only draft; a human commits.
10. **Operations.** No secrets in the repo. Errors never expose stack traces. Logs redact tokens and passwords.

## 6. Modules and acceptance criteria

### kernel
- Register a tenant with an owner; login with password; enrol and verify TOTP; step-up; logout; session revocation.
- 5 failed logins lock the account for an increasing delay.
- Cross-tenant read, write and update on every tenant table returns zero rows or an error (test generated from the catalog).
- Audit chain verifies; tampering with any row is detected by the verifier.
- Idempotency-Key on mutating endpoints replays the stored response.

### people-core
- CRUD for org units (tree, cycle-proof), employees, employment dates, manager link.
- Documents are size/type/magic-byte validated, scanned before availability, encrypted with the employee data key and stored through the ObjectStore port. Rows retain plaintext SHA-256 and scan status; downloads require step-up, audit non-self access, and verify GCM plus hash. Scanner errors remain pending and retry via outbox; detections are quarantined and never downloadable.
- A resumable `docs:migrate-to-store` command dry-runs or scans/read-backs legacy encrypted blobs before nulling their database ciphertext. Erasure deletes/blank references for document, quarantine and payslip objects after the legal-hold gate. Google Drive/SharePoint remain staged pending D-1.
- Compensation is bitemporal: a correction closes the old row's `recorded_to`; history is never overwritten; overlapping valid periods are rejected by an exclusion constraint.
- Bank details: encrypted, masked in every response (last four only), duplicate account across employees flagged, change needs step-up and sets a flag that the next pay run reads.
- National ID: encrypted, only HR/payroll with the class grant can read it, access is audited in the same transaction and fails closed.

### flow
- Any module creates an approval request with ordered steps. Approver acts via POST with session. Content change voids pending steps. Token endpoint works only for the bound approver and only once.
- Inbox lists what is waiting on me. Notifications are created per event.

### time
- `POST /ingest/punches` returns 202 with a receipt. The DB dedupes on (tenant, device, idempotency key, event time). Replay returns the same receipt as a duplicate. Events older than 120 days go to a late-punch review queue.
- Attendance for a day is calculated from punches by event time (first in, last out, worked minutes, late, overtime) regardless of arrival order.
- Leave: types, entitlement ledger, request, approval through flow, balance. A request that exceeds the balance (when the type is not negative-allowed) is refused. Overlap with an approved request is refused.

### pay
- A pay run goes through: draft, inputs_locked, calculated, in_review, approved, finalised, payment_released, paid, published, plus cancelled, rejected, reopened, reversed. The trigger blocks any other move.
- Locking snapshots each employee's input with an RFC 8785 style canonical hash. The engine reads snapshots only.
- The engine returns lines with explanations, gross, deductions, net, employer cost. Same input gives the same bytes.
- Exceptions (missing bank, negative net, bank changed since last run, duplicate bank account, net change over threshold) block approval until resolved or waived with a reason.
- Approver must differ from preparer and must not be a subject of the run, unless the single-admin exception is active, in which case release is delayed 24 hours and the line is flagged.
- Finalise makes results immutable, renders each payslip once, hashes it, writes an employee-encrypted object archive and builds the WPS SIF file. Reads verify the archive against the retained hash while the immutable database JSON remains the source of truth.
- Live runs need an L2 or higher pack. Sandbox runs can reach `finalised` and `published` but never `payment_released`.

### service
- Helpdesk tickets with categories; confidential tickets visible only to the requester and users holding the confidential class grant. Announcements. Knowledge base articles.

### intelligence
- Assistant answers questions about policies, own leave and own payslip, and (for permitted roles) aggregate headcount and cost. People appear as pseudonym tokens (8 base32 characters from an HMAC) in the model context. A draft action (for example a leave request) is returned as a preview and committed only by the user through the normal API.

### insight and platform
- Dashboard: headcount, attendance today, pending approvals, payroll cost trend.
- OpenAPI document at `/api/v1/openapi.json`. API keys (hashed, scoped, expiring). Webhooks delivered from the outbox with signatures, retries with backoff, and a delivery log.

## 7. Boundaries

Always: validate all input with zod, parameterise all SQL, write audit rows for sensitive reads and every write, test authorisation negatively.
Ask first: new auth flows, new categories of sensitive data, new external integrations.
Never: commit secrets, log sensitive data, trust client-side checks, expose stack traces, change a finalised result.

## 8. Not built in this release (and why)

| Item | Why staged |
|---|---|
| Rust/WASM engine | Needs a Rust toolchain and an independent test-vector set. The TS engine defines the golden vectors it must match. |
| Cloudflare edge, Go bridge, mobile | Separate runtimes. Ingest contract is fixed and tested. |
| Passkeys, OIDC, MCP OAuth server | Auth surface. Needs your approval and expert review. |
| Customer Drive/SharePoint storage | Needs OAuth verification and a Google decision (D-1). Local encrypted storage is used meanwhile. |
| Live payroll for any country | Needs an L2 pack: a named qualified reviewer, independent vectors and a parallel run. |
| India pack, other countries | After UAE reaches L2. |
| Talent, rewards, recruiting | Later releases (D8). |
