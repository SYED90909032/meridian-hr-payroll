# SOC 2 control mapping (Trust Services Criteria)

| | |
|---|---|
| Status | **Engineering mapping, not an audit.** It records which controls exist in code or documents and where evidence lives. A SOC 2 Type I report needs an independent CPA firm; Type II needs a period of operation (typically 6 to 12 months). Neither has started. |
| Scope proposed | Security, Availability and Confidentiality criteria first; Processing Integrity second (payroll accuracy); Privacy after the PDPL work. |
| How to read "Evidence" | A repository path or test that demonstrates the control today. "Operator" means the control depends on how the service is deployed and cannot be proved from the repository. |

Legend for **State**: **Built** (in the repository with tests), **Partial**, **Operator** (depends on deployment), **Open** (not done).

## CC1 to CC5: Control environment, communication, risk, monitoring

| Criterion | Control | State | Evidence / gap |
|---|---|---|---|
| CC1 Ethics and oversight | Documented decision log, ADRs, change log | Built | `docs/DECISIONS.md`, `docs/adr/`, `CHANGELOG.md` |
| CC1 Governance | Named security owner, board oversight, background checks | Open | Needs an organisation, not code |
| CC2 Communication | Security and privacy documentation, runbooks | Partial | `docs/SECURITY.md`, `docs/runbooks/*`, public security contact to be added |
| CC3 Risk assessment | Threat model and risk register | Built | `docs/THREAT_MODEL.md`, blueprint §14, `docs/compliance/dpia.md` |
| CC4 Monitoring | Tests in CI, dependency audit, SBOM | Partial | `.github/workflows/ci.yml`; branch protection and required reviews are repository settings (**Operator**) |
| CC5 Control activities | Policies mapped to controls | Partial | This document |

## CC6: Logical and physical access

| Control | State | Evidence / gap |
|---|---|---|
| Unique user accounts, Argon2id password hashing, lockout, TOTP, recovery codes | Built | `modules/iam`, auth tests |
| Passkeys, OIDC SSO, SCIM provisioning and deprovisioning | Built against stand-ins (Phase 3). Real IdP not exercised | `modules/iam` Phase 3 tests, `docs/adr/031` |
| Session management: hashed tokens, idle and absolute expiry, revocation, step-up for sensitive actions | Built | `kernel.session`, step-up tests |
| Role-based access with field grants and scoped assignments | Built | `http/perms.ts`, permission tests |
| Tenant isolation by forced RLS, separate database roles | Built; **independent review Open** | RLS tests, catalog coverage test (Phase 1); external review required |
| Least-privilege API keys: read-only default, opt-in write scopes, expiry, per-key rate limits | Built (Phase 6) | platform tests |
| Encryption in transit | Operator | TLS termination at the edge; `docs/runbooks/edge-and-waf.md` |
| Encryption at rest and field-level encryption | Built; **real KMS custody Operator** | `crypto/*`, KMS adapter tests against a local KMS stand-in |
| Physical security | Inherited from the cloud provider | Provider's SOC report once chosen |
| Offboarding of staff access | Documented | `docs/runbooks/leaver-revoke.md` |

## CC7: System operations

| Control | State | Evidence / gap |
|---|---|---|
| Logging with secret redaction | Built | Redaction test (Phase 7) |
| Tamper-evident audit chain with signed seals and off-box copies and drift reconcile | Built; real off-box target Operator | Audit tests; Phase 1 sinks tested against stand-ins |
| Metrics, tracing, alert rules, pay-day watchdog | Built; alert delivery Operator | `deploy/observability/` |
| Vulnerability management: dependency audit, SBOM, image signing | Partial | CI; signing runs only on main in a real pipeline, not exercised here |
| Penetration testing | Open | `docs/compliance/pentest-scope.md` |
| Incident response | Draft | `docs/runbooks/incident-response.md`, breach process |

## CC8: Change management

| Control | State | Evidence / gap |
|---|---|---|
| Version control, pull requests, CI gates, change log | Built | repository; protected branches and mandatory reviewers are **Operator** settings |
| Migrations applied by a separate owner role, forward compatible | Built / documented | `docs/runbooks/deployment.md` |

## CC9: Risk mitigation, vendors

| Control | State | Evidence / gap |
|---|---|---|
| Vendor inventory and DPAs | Open | Providers not chosen (see `docs/DECISIONS.md`) |
| Business continuity | Partial | Restore drill script and results in `docs/runbooks/backup-restore.md`; failover Operator |

## A1: Availability

| Control | State | Evidence / gap |
|---|---|---|
| Capacity measurement | Built | `docs/performance/load-test.md` (single host figures only) |
| Backups, PITR, restore testing | Partial | Restore drill passed on a local database; managed PITR Operator |
| Multi-instance operation | Built | Concurrency tests with shared database and Redis |

## C1: Confidentiality

| Control | State | Evidence / gap |
|---|---|---|
| Data classification | Built | `docs/compliance/data-inventory.md` |
| Field encryption and crypto-erasure | Built | tests |
| Disposal | Built | Erasure runbook; object deletion (Phase 5) |
| AI data minimisation | Built | Tool firewall tests, DLP, eval suite |

## PI1: Processing integrity

| Control | State | Evidence / gap |
|---|---|---|
| Deterministic payroll with golden vectors and property tests | Built | `packages/engine` tests |
| Hash-bound approvals and immutable payslips | Built | pay tests and triggers |
| Reviewer sign-off and parallel runs before live payments (L2 gate) | Mechanism built; **sign-offs Open** | UAE pack stays at L0 |

## P: Privacy
Mapped through the PDPL documents in this folder. Not assessed against the criteria one by one yet.

## Next steps toward Type I
1. Appoint a security owner and an auditor-facing contact.
2. Choose hosting, KMS and providers, then write the vendor register.
3. Turn the Operator rows into configured, evidenced controls in a staging environment.
4. Engage an auditor for a readiness assessment.
