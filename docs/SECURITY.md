# Security model

This document describes what Meridian enforces today, what it deliberately does not do yet, and the payroll assumptions a reviewer must check. It is written to be audited: every claim here maps to code or a test in `apps/api/test/`.

Report vulnerabilities privately to the repository owner (GitHub private advisory). Do not open public issues for security reports.

## 1. Layers of defence

**Request pipeline.** Every route is declared through `defineRoute` (`apps/api/src/http/route.ts`). The pipeline order is fixed: authenticate, permission check, step-up check, MFA requirement, strict zod validation (unknown fields rejected), then the handler inside one database transaction with the tenant and user bound to the session. A route cannot skip a stage because there is no other way to register one. `GET /api/v1/openapi.json` is generated from the same registry, so the documentation cannot drift from the code.

**Authentication.**
- Passwords hashed with scrypt (N=2^15, r=8, p=1, 16-byte salt), compared in constant time; unknown emails cost the same time as wrong passwords.
- Failed-attempt counters lock the account with exponential back-off (capped at 60 minutes) and every attempt is logged with IP.
- Sessions are opaque random tokens stored hashed, in `HttpOnly` cookies (`Secure` outside development, `SameSite=Lax` by default), with idle (30 min) and absolute (12 h) limits. Sessions can be listed and revoked.
- TOTP MFA (RFC 6238) with single-use codes inside a time window and 8 hashed recovery codes. Approving and releasing a pay run additionally require MFA to be turned on for the acting user (`requireMfa`).
- **Step-up:** sensitive actions require a password and MFA re-check within the last 10 minutes. These are: enabling or disabling MFA, adding members and changing roles or status, termination, compensation and bank changes, revealing identity data, erasing personal data, registering or revoking time devices, the single-admin policy, and in payroll waiving exceptions, approve, reject, finalise, release, mark-paid, reverse and the bank-file download, plus creating API keys and webhooks and sealing the audit log. The API answers `401 step_up_required` and the web app opens a dialog and retries.
- **Account lifecycle:** invitations and password resets use purpose-bound, expiring random tokens. Only SHA-256 token digests are stored; an atomic update makes each token single-use. Password validation includes the local policy and an HIBP k-anonymity range lookup (only five SHA-1 prefix characters leave the process). Resets revoke existing sessions and never auto-login the user. A tenant may require MFA enrolment for selected roles; API-key principals are not subject to that enrolment gate.
- Passkeys use `@simplewebauthn/server`/`@simplewebauthn/browser` with configured RP ID/origin, required user verification, five-minute session-bound challenges, atomic single use, counter regression/clone rejection and audit events. A passkey is MFA-strength for sign-in and step-up; tests use a software authenticator only.
- OIDC SSO uses `openid-client` discovery, guarded endpoint fetches, state/nonce/PKCE records with five-minute expiry and single use, JWKS-backed signature validation, issuer/audience/expiry checks and mandatory `email_verified`. JIT provisioning is off by default, limited to a tenant default role or explicit owner mapping, and post-login redirects are local paths only. Client secrets are sealed with the tenant key.
- SCIM uses tenant-scoped bearer tokens stored only as hashes. The SCIM route kind is separate from user sessions; identity lookup/create, session revocation and API-key revocation run through `meridian_auth`. Tenant transactions use membership rows only and do not grant `meridian_app` access to `kernel.user_account`.

**CSRF and cross-site requests.** Cookie-authenticated mutations must carry `X-Meridian-Client: web` and an `Origin` matching the host. API keys are read-only by default; only explicitly opted-in keys may carry the small `people.write`/`leave.admin` allow-list, and API keys can never use step-up routes.

**Authorisation.** Seven roles (owner, hr_admin, payroll_admin, payroll_approver, manager, auditor, helpdesk_agent) map to permissions in `http/perms.ts`. Role assignments carry a scope; the manager role is assigned with scope `reports` and this is covered by tests for leave requests and approvals (a manager cannot see leave outside their reports). Scoping for every other module has not been audited line by line; treat that as a review item. Permissions are checked in the route, and again by the database (below).

**Database isolation (two layers, ADR-018).** All tenant tables have `FORCE ROW LEVEL SECURITY`. Policies compare `tenant_id` to a transaction-local setting that only the pipeline sets, and sensitive data classes (pay, bank, identity) have additional policies. Four database roles with different rights: `meridian_owner` (migrations, never used at runtime), `meridian_app` (no `BYPASSRLS`, owns nothing), `meridian_auth` (identity tables only), `meridian_worker` (two `SECURITY DEFINER` functions to claim outbox rows). `apps/api/test/db-security.test.ts` attacks the policies directly (cross-tenant reads and writes, role escalation, forged settings).

**Data protection.** Identity numbers, bank details and private documents are encrypted per employee with their own data key, wrapped by a tenant key, wrapped by the master key (AES-256-GCM). New documents and frozen payslip archives are encrypted before object-store upload with AAD bound to the employee, record and version; new documents are unavailable until ClamAV scanning returns clean. Downloads require step-up, use attachment/no-store/nosniff headers and verify both the GCM tag and retained plaintext hash. The `erase-personal-data` action (step-up protected) deletes document/payslip/pending/quarantine objects, blanks references and destroys the employee's key (crypto-erasure): any surviving ciphertext is unreadable. Reveal actions are step-up protected and audited. Responses mask by default.

**Audit.** Mutations and reveals write an event with a hash that includes the previous hash; the application role can only append (update and delete are denied, and a test proves it). On demand (Audit log, Seal now, or the API) the chain is sealed into a Merkle block signed with Ed25519 (`MERIDIAN_SIGNING_KEY`). `GET /audit/verify` recomputes the chain and verifies signatures; the public key is downloadable so an external party can verify independently. Tampering with a row is detected at the exact sequence number (tested).

**Outbound requests (webhooks).** An owner-managed tenant destination allow-list, when present, is checked both at endpoint creation and every delivery. The destination is resolved, every resolved address is checked against private, loopback, link-local, metadata and reserved ranges, and the connection is pinned to the validated address so DNS rebinding cannot swap it. Redirects are not followed. Payloads are signed with HMAC-SHA256 using a per-webhook secret that is displayed once.
**Outbound requests (webhooks and communications).** Webhook destinations are resolved, checked against private, loopback, link-local, metadata and reserved ranges, and pinned so DNS rebinding cannot swap them; redirects are not followed. Email/SMS delivery runs from the outbox through provider interfaces with provider message ids, dedupe keys and transient/permanent failure classification. Account-link raw tokens are encrypted in outbox payloads and never logged. Bounce/complaint webhooks require the configured secret and create tenant-scoped hashed suppressions; suppressed recipients are skipped.

**Assistant firewall.** The assistant can only call a fixed list of read tools. People are replaced with pseudonyms before anything leaves the process; pay, bank and identity fields are never available to the tools. Model calls require owner consent, an allow-listed model, request caps and DLP scrubbing. Tool results and user text are treated as data. If no model endpoint is configured or consent is off, answers are produced directly from tool output.

**Transport and browser.** Helmet defaults, `Content-Security-Policy: default-src 'self'` (no inline scripts, no third-party origins), HSTS, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on API responses. Rate limits per route group.

**Payments.** Pay-run approval is bound to a content hash of the calculated results, so changing any line invalidates the approval. The approver cannot be the preparer, except through the recorded single-admin exception (ADR-006: step-up, 24-hour release delay, flagged line). Live payment is blocked while the rule pack is below assurance L2 (ADR-003); the database now also requires an exact-pack owner sign-off, independent vector hash, bank acceptance reference and two completed zero-unexplained parallel runs. The bank file download and post-release hand-off are permission-gated, step-up protected and audited. No reviewer, bank or live employer has supplied evidence for the shipped L0 pack.

## 2. Payroll assumptions

The UAE pack (`packages/engine/src/packs/uae.ts`) is assurance **L0**: written from published sources, **not** reviewed by a qualified UAE payroll or legal professional. Treat results as a draft for review.

| Item | Status |
| --- | --- |
| GPSSA employee and employer rates, contribution clamp | Verified against published sources (see `docs/research/RESEARCH_NOTES.md`) |
| Contribution salary | **Assumed** to be the total fixed wage. The legal base for some components differs; confirm per employer |
| Month basis | **Assumed** 30 days for daily-rate calculations |
| Overtime multipliers | **Unverified** |
| End-of-service gratuity | **Unverified** against current rules and each contract type |
| Deduction cap (50% of wage) | **Unverified** in detail; the engine raises an exception rather than silently capping |
| WPS SIF file | Built from the published layout. **Not validated by any bank or exchange house.** Treat as a draft until your bank's file validator accepts it |
| Emirates ID | Format checked; the check digit is not enforced |
| Mid-period compensation changes | Snapshot builder splits valid-time compensation segments; reviewer must confirm the calculation basis |
| Notice pay on termination | Contract notice days are parameterised and included in final settlement inputs; reviewer sign-off required |
| Leave proration | Calendar-day employment proration uses the pack's assumed 30-day basis; reviewer sign-off required |
| Overnight shifts | Supported with tenant-selectable start/end local-date attribution; default is shift start |
| Contractors | Excluded by default; an explicit tenant setting enables a separate, non-statutory input path pending reviewer confirmation |
| Sandbox mode | Missing bank or WPS data is a warning. In live mode it is a blocking exception |

Every pay line carries the rule id and an explanation (the Explain drawer in the pay run), so a reviewer can trace each number to a rule.

## 3. Known gaps (read before production)

- **RLS review.** One recursion bug in a policy was found and fixed during development (migration 012). An independent PostgreSQL security review is still needed.
- **Master key** is an environment variable (ADR-011, open decision D11). A cloud KMS or HSM adapter is the intended next step; until then, protect the process environment and rotate on staff change.
- **Email enumeration:** adding a member whose email exists returns `409 email_unavailable`. Registration, forgot-password and login do not reveal existence.
- **Provider and deliverability evidence:** no real provider or mailbox has been exercised by the repository tests. Operators must configure the provider and publish SPF, DKIM and DMARC records; see `docs/runbooks/email-deliverability.md`.
- **`payment_file`** is readable by anyone holding the pay-read class at the database layer. The API route is gated, step-up protected and audited, but a database-level reader could see it.
- **External identity assurance remains an operator responsibility.** SSO has not been run against a real Okta, Entra or Google tenant; SCIM tests are synthetic client requests; passkeys have not been tested with hardware or a browser platform authenticator. Before staging use, verify exact redirect URI registration, issuer/domain policy, group mappings, SCIM token rotation and IdP offboarding behavior. IdP compromise, mis-mapped groups, JIT policy errors and SCIM token theft remain residual risks.
- **No penetration test, no SOC 2 or ISO 27001 evidence, no DPA or privacy review.** These are organisational work, not code.
- **Supply chain:** `pnpm audit --prod` is clean at the time of writing and runs in CI. Dependencies are pinned by lockfile.
- **Documents:** ClamAV detection quality depends on the daemon signature database freshness. `moto` tests the S3 protocol but is not real AWS/R2. Google Drive and SharePoint connectors are intentionally blocked pending owner decision D-1.

## 4. Verification you can run

```bash
pnpm test              # engine + API tests (real PostgreSQL; see the workstream report for the exact run)
pnpm audit --prod
curl -s localhost:8080/api/v1/openapi.json | jq '.paths | length'
```

In the UI: Audit log, Verify integrity (should say intact); tamper with an `audit.event` row in SQL as the owner role and verify again to see the broken sequence number.
