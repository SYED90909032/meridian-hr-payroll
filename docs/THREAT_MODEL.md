# Threat model

Method: assets and trust boundaries first, then threats per boundary (STRIDE), then what is mitigated, where it is tested, and what remains. This is the author's model, not an independent review.

## 1. Assets, ranked

1. Salary, bank and identity data of employees (confidentiality, regulatory exposure).
2. Integrity of pay runs and the bank file (direct financial loss).
3. Tenant isolation (one customer must never see another).
4. Audit trail integrity (evidence after an incident).
5. Availability of payroll around pay day.

## 2. Actors

External attacker; malicious or curious tenant user (employee, manager, HR admin); malicious payroll admin acting alone; compromised API key or webhook endpoint; compromised database credential for one role; malicious content passed to the assistant (prompt injection); the platform operator with database access.

## 3. Trust boundaries

Browser to API (cookies, CSRF) / API to database (three least-privilege roles, row-level security) / API to the internet (webhooks, optional model endpoint) / worker to database / devices to ingest endpoint (device keys) / operator to database (owner role).

## 4. Threats and controls

| # | Threat | Control | Evidence | Residual risk |
| --- | --- | --- | --- | --- |
| T1 | Credential stuffing or password guessing | scrypt, lockout with back-off, per-route rate limits, uniform timing for unknown emails, local common-password floor and HIBP range k-anonymity on registration/invite/reset/change | `api-auth.test.ts`, `comms.test.ts` | HIBP availability policy is configurable; CAPTCHA is an optional hook and real provider behavior is not tested |
| T2 | Session theft | HttpOnly, Secure, SameSite cookies; hashed tokens at rest; idle and absolute expiry; revoke list | `api-auth.test.ts` | Token theft from a compromised browser still works until expiry. No device binding |
| T3 | CSRF | Origin check and custom header on cookie mutations; SameSite=Lax; API keys cannot mutate | `api-auth.test.ts` | Relies on browsers sending Origin |
| T4 | XSS | React escaping, strict CSP (`script-src 'self'`, no inline script), no `dangerouslySetInnerHTML`, user text rendered as text | CSP header checked in production boot | `style-src 'unsafe-inline'` is allowed for React inline styles |
| T5 | Cross-tenant data access (IDOR, SQL mistakes) | Forced RLS on every tenant table; app role has no BYPASSRLS; tenant bound per transaction; ids never trusted without tenant filter | `db-security.test.ts` (26 tests) | Policies are written and reviewed by one author. **Needs independent review** |
| T6 | Privilege escalation inside a tenant | Per-route permission, scoped assignments, database data-class policies, no self-role-change, step-up for role changes | `api-auth.test.ts`, `api-people-leave.test.ts` | Scope enforcement not audited for every module |
| T7 | A single payroll admin diverts pay | Approver differs from preparer, approval bound to the result-set hash (409 `content_changed` if anything moved), release bound to the bank-file hash, open exceptions block approval, step-up + MFA on approve and release, audit | `api-pay.test.ts`, `api-pay-live.test.ts` | Single-admin exception (ADR-006) lets an owner approve their own run after a 24 h delay with a flagged line. Collusion of two admins is not prevented |
| T8 | Tampering with a run after approval | Result-set hash compared at approval, bank-file hash compared at release; payslips frozen at finalise | `api-pay.test.ts` | Database owner role can still rewrite data; detected only through audit seals |
| T9 | Audit log tampering or deletion | Append-only for the app role, hash chain, signed Merkle blocks, externally verifiable public key | `db-security.test.ts`, `api-platform.test.ts` | Operator with owner role can truncate the tail after the last seal. Seal frequently and store the public key and latest seal off-box |
| T10 | SSRF through webhooks | Resolve once, reject private/loopback/link-local/metadata ranges, connect to the pinned IP, no redirects, size and time caps, deliveries use TLS only | `api-platform.test.ts` | Allow-list of destination domains per tenant is not implemented |
| T11 | Webhook forgery or replay at the receiver | HMAC-SHA256 over timestamp and body, per-webhook secret shown once, delivery id header | `api-platform.test.ts` | Receiver must check the timestamp window |
| T12 | Prompt injection through the assistant | Fixed read-only tools, no pay/bank/ID data in tool results, pseudonyms, tool outputs treated as data, no write tools | `api-platform.test.ts` (assistant firewall) | A model endpoint is optional. If enabled, text the model sees (names are pseudonymised, but leave dates and team data are not) leaves the system |
| T13 | Data exposure from backups or a stolen disk | Sensitive fields encrypted per employee (AES-256-GCM) with wrapped keys; crypto-erasure | `unit.test.ts`, `api-people-leave.test.ts` | Master key is an environment variable (open decision D11). Whoever holds it and the database can decrypt |
| T14 | Time-clock device spoofing | Per-device keys, shown once and stored hashed; revocation; ingest rate limits; manual punches audited | `api-people-leave.test.ts` | Keys travel over TLS only; no hardware attestation |
| T15 | Supply-chain compromise | Lockfile, `pnpm audit --prod` in CI, minimal dependencies, dependency build scripts allowed only for esbuild | CI | No SBOM or provenance signing yet |
| T16 | Denial of service | Rate limits, body size limits, zod collection limits (zod upgraded after an advisory), pagination caps | route tests | No WAF; payroll calculation is synchronous in the request |
| T17 | Insider at operator level reads data | Field encryption, audit of reveals | partial | Operator who also holds the master key sees everything. Needs KMS with separation of duties |
| T18 | Wrong payroll maths (a correctness threat) | Integer-only arithmetic, rule packs with assurance levels, live payment blocked below L2, explanations per line, exceptions instead of silent clamping | `packages/engine` (33 tests) | **UAE pack is L0.** See SECURITY.md, Payroll assumptions |
| T19 | Invitation/reset token theft, replay or email-provider abuse | Raw account tokens are random, purpose-bound, expiring and stored only as SHA-256 digests; atomic consume is single-use; reset revokes sessions; outbox dedupe stores provider ids; bounce/complaint events create hashed suppressions; provider secrets are configuration-only | `comms.test.ts`; `docs/runbooks/email-deliverability.md` | A compromised mailbox or provider account can still expose a live link; DNS reputation and provider security remain external controls |

## 5. Not modelled yet

Physical and cloud account security of whoever hosts it; organisational controls (joiner/mover/leaver, key ceremony, incident response); tenant-supplied files (virus scanning is not implemented for documents); mailbox/provider compromise and DNS reputation; SSO account takeover paths (no SSO yet); mobile clients (not built).

## 6. Review plan before real data

1. Independent PostgreSQL RLS and role review (T5, T6).
2. KMS adapter with separate custodians (T13, T17).
3. UAE payroll/legal sign-off and a bank WPS validation run (T18).
4. External penetration test of the deployed system (T1 to T4, T10).
5. Off-box storage of audit seals (T9).
