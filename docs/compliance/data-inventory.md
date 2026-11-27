# Personal-data inventory (UAE PDPL / GDPR Article 30 style)

| | |
|---|---|
| Status | **Engineering draft.** Prepared from the actual schema (migrations 001 onward) and code. It has **not** been reviewed by privacy counsel or a data-protection officer. Blueprint §11 requires an independent privacy review before GA (task G11); that review is external and has not happened. |
| Scope | The Meridian platform when operated as a service for employer tenants. |
| Roles | The employer (tenant) is the **controller**. The operator of Meridian is a **processor**. Meridian's own staff, if any, act as sub-processors only when they touch tenant data. Confirm this allocation with counsel before signing customer DPAs. |
| Owner | Product owner, with the DPO role to be appointed (see `docs/DECISIONS.md`). |
| Last reviewed | Update this date on every schema change that touches personal data. |

How to keep this accurate: any migration that adds a column holding personal data must add or change a row here in the same pull request. The progress tracker lists this as a standing review item.

## 1. Data subjects

| Subject | Examples | Source |
|---|---|---|
| Employees and contractors of a tenant | Staff records, pay, leave, time, documents | Entered by tenant HR, imported, or entered by the employee |
| Tenant users | HR admins, approvers, payroll admins | Account creation, invitation |
| Candidates / ex-employees | Terminated records retained for statutory periods | Same records after termination |
| Ticket and portal users | Employees raising service requests | Entered by the user |

## 2. Data categories, purpose, protection and retention

Sensitivity: **S3** = special or financial (identity numbers, bank, pay, health-adjacent such as sick leave), **S2** = personal, **S1** = business-only.

| Table (schema) | Personal data held | Sens. | Purpose | Lawful basis (typical, controller decides) | Protection in the system | Retention (default, tenant-configurable) |
|---|---|---|---|---|---|---|
| `people.employee` | Employee number, names, work email, job title, manager, org unit, employment type, hire and termination dates, nationality, UAE-national flag | S2 | Employment administration | Contract, legal obligation | Forced RLS by tenant; permission and field-grant checks; audit on change | Employment + statutory period (see retention policy) |
| `people.employee_private` | National ID (encrypted + blind index), WPS unique ID (encrypted), date of birth, phone, address | S3 | Statutory filings, WPS, identity | Legal obligation | AES-256-GCM per-employee data key, AAD-bound; blind index for lookup; reveal needs permission, step-up and writes audit; crypto-erasure | Statutory period then erase |
| `people.employee_bank` | Bank name, routing code, IBAN (encrypted, blind index, last4) | S3 | Salary payment | Contract | Same field encryption; change requires step-up; history preserved with `superseded_at` | Statutory period then erase |
| `people.compensation` | Salary components with valid-time and transaction-time | S3 | Payroll | Contract | RLS; field grants; audit | Statutory period |
| `people.document` | Contracts, ID copies, certificates (file content encrypted, hash, mime, size) | S3 | HR file | Contract, legal obligation | Per-employee AES-GCM encryption; magic-byte sniffing; ClamAV scan before release (infected files quarantined); ciphertext stored in the object store (local or S3-compatible), legacy rows migrated by `docs:migrate-to-store` | Per document kind, see retention policy |
| `people.employee_event` | Lifecycle events (hire, transfer, termination) | S2 | History | Contract | RLS; append-only | Employment + statutory |
| `tm.punch`, `tm.attendance_day`, `tm.shift*` | Clock-in/out times, device ids, shift assignment | S2 | Attendance, overtime | Contract | RLS; late-punch review; audit | 2 years default (tenant-set) |
| `tm.leave_request`, `tm.leave_ledger`, `tm.leave_reason` | Leave dates and balances; free-text reason may hold health data | S3 (reason) | Leave administration | Contract | RLS; reason visible only to approver chain and HR | 2 years after year-end default |
| `flow.approval_*`, `flow.notification`, `flow.action_token` | Approval decisions, notifications, single-use tokens (hashed) | S2 | Workflow | Contract | RLS; hash-bound approvals | 2 years |
| `pay.pay_run`, `pay.payroll_input_snapshot`, `pay.pay_result`, `pay.payslip`, `pay.payment_file`, `pay.reconciliation` | Gross, deductions, net pay, per-line explanations, bank file contents | S3 | Payroll and statutory records | Contract, legal obligation | RLS; immutable after finalise; content-hash binding; payslip frozen; payment files hold encrypted IBANs | Statutory (UAE: confirm with reviewer, commonly 5+ years) |
| `pay.adjustment`, `pay.payroll_exception`, `pay.payroll_policy_exception` | Manual adjustments, exceptions, reasons | S3 | Payroll | Contract | RLS; audit; flagged on payslip | Same as pay runs |
| `kernel.user_account` | Login email, display name, password hash (Argon2id), encrypted TOTP secret, failed-attempt counters, last login | S2 | Authentication | Contract, legitimate interest | Hash and encrypt; lockout; no plaintext secrets | Life of account + 90 days after disable |
| `kernel.session` | Session token hash, IP address, user agent, timestamps | S2 | Security | Legitimate interest | Token hashed; idle and absolute expiry; revocation | 90 days after expiry |
| `kernel.login_attempt`, `kernel.recovery_code` | Attempt records (email, IP, outcome); hashed recovery codes | S2 | Security | Legitimate interest | Hashed; rate limited | 90 days |
| `kernel.audit_event`, `kernel.audit_block`, `kernel.audit_head` | Actor, action, target ids, time, IP; hash chain and signed seals | S2 | Accountability, evidence | Legal obligation, legitimate interest | Append-only by trigger; hash chain; signed Merkle seals; contains ids and metadata, **not** field values | Long (at least the pay-record period); see note on erasure below |
| `kernel.outbox` | Queued events and webhook payloads | S2 | Reliable delivery | Contract | Processed then pruned; payloads avoid S3 fields | 30 days after processing |
| `kernel.idempotency` | Request fingerprints and cached responses | S2 | Safety | Legitimate interest | Short TTL | 24 hours |
| `kernel.subject_key`, `kernel.data_key` | Wrapped keys, never plaintext | n/a | Encryption | n/a | Envelope encryption under KMS (Phase 1); destroyed on erasure | Until erasure |
| `kernel.legal_hold` | Hold records preventing erasure | S1 | Legal compliance | Legal obligation | Owner-only; audit | Until released |
| `svc.ticket*`, `svc.announcement`, `svc.kb_article` | Ticket text (free text may hold anything), comments, attachments metadata | S2 | Employee service desk | Contract | RLS; AI use restricted by the tool firewall | 2 years after close |
| `plat.api_key`, `plat.webhook_endpoint`, `plat.webhook_delivery` | Key hashes and scopes; endpoint URLs; delivery logs (payload copies) | S2 | Integration | Contract | Key hash only; secrets encrypted; SSRF guard; delivery-log retention job (Phase 6) | Delivery logs 90 days default |
| `ai.conversation`, `ai.message`, `ai.pseudonym` | Chat text, pseudonym map | S2 | Assistant | Consent / legitimate interest (controller decides) | Pseudonymisation; field-blind tools; per-tenant model opt-in and outbound DLP (Phase 8); see `docs/privacy/assistant-data-flow.md` | 30 days default (tenant-set) |
| Application logs | Request ids, route templates, status, durations; **no bodies, no secrets** (redaction tested) | S1/S2 | Operations | Legitimate interest | pino redaction; log access limited | 30 days default |
| Backups | Encrypted copies of all of the above | S3 | Recovery | Legitimate interest | Encrypted at rest by the platform; PITR; field-level encryption survives into backups | Per backup policy; see erasure note |

## 3. Recipients and transfers

| Recipient | Data | Condition |
|---|---|---|
| Tenant bank (via WPS/SIF file or bank API) | Names, IBANs, amounts | Only when the L2 live-payment gate is satisfied; transport is tenant-configured (Phase 2) |
| Email/SMS provider | Recipient address, message text; payslip emails carry **no** pay figures | Processor; DPA needed. Provider not chosen (decision #3) |
| Identity provider (OIDC/SCIM) | Email, name, group membership | Tenant-configured; processor of the tenant |
| LLM provider (optional) | Scrubbed, pseudonymised prompts only | Off by default; per-tenant opt-in with consent text; DLP applied (Phase 8) |
| Cloud host, KMS, object store | Encrypted data only | Provider not chosen (decision #1, #2) |
| Webhook receivers | Event payloads | Tenant-defined; destination allow-list (Phase 6) |

Cross-border transfers: not yet determined because the hosting region is undecided. UAE PDPL and the sector rules in free zones (DIFC, ADGM) have their own transfer regimes; counsel must confirm before the first customer is onboarded.

## 4. Rights handling (how the system supports each)

| Right | Mechanism | Gap |
|---|---|---|
| Access | Employee self-service views; HR export of an employee's records | A single "subject access export" bundle route is **not** built. Tracked in the progress file. |
| Rectification | Bitemporal edits with audit | none |
| Erasure | Crypto-erasure destroys the employee's data key (and deletes the stored objects), making encrypted fields and documents unrecoverable; refused while a legal hold exists | Backups retain ciphertext only; without the key it is unreadable. Non-encrypted identifiers (names, employee number) are scrubbed by the same operation; confirm exactly which with counsel. The audit chain keeps ids and event metadata, which is a documented, deliberate retention for accountability |
| Restriction / objection | Legal hold and status flags | No automated processing-restriction flag beyond legal hold |
| Portability | JSON export of records | Not a packaged feature |

## 5. Known gaps for the DPO / counsel to settle
1. Controller/processor allocation and the DPA template.
2. Lawful basis per processing activity for each customer.
3. Retention periods for UAE payroll records (reviewer to confirm statutory minimums).
4. Cross-border transfer mechanism once hosting is decided.
5. Whether audit metadata counts as personal data that needs a separate retention rule.
6. Subject-access export bundle (engineering work, scheduled after GA blockers).
