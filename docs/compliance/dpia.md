# Data Protection Impact Assessment (draft)

| | |
|---|---|
| Status | **Engineering draft for review by a DPO or privacy counsel. Not approved.** No approval is claimed anywhere in this document. |
| Processing assessed | Payroll, HR records, time and leave, document storage, service desk, optional AI assistant and platform integrations, as implemented in the repository |
| Related | `docs/compliance/data-inventory.md`, `docs/THREAT_MODEL.md`, `docs/SECURITY.md`, `docs/privacy/assistant-data-flow.md` |

## 1. Why a DPIA is needed
The platform processes financial and identity data of employees at scale, includes a systematic evaluation of pay, may involve special-category inference (sick leave reasons), and offers an optional AI feature. Each of these is a recognised trigger for a DPIA.

## 2. Description of processing
Employers load employee records. The platform calculates pay with a deterministic engine, routes approvals, generates payslips and bank files, stores HR documents, records time and leave, and provides a service desk and read-only integrations. See the inventory for every data category. Volumes: tens to thousands of employees per tenant (target size is an open decision).

## 3. Necessity and proportionality
- **Data minimisation**: sensitive fields are field-encrypted and revealed only on demand with a permission, step-up and audit. Payslip emails carry no pay figures. The assistant never receives pay, bank or ID values (tool firewall, tested).
- **Purpose limitation**: tenant isolation by forced row-level security; API keys scoped and read-only by default.
- **Storage limitation**: retention schedule in `retention-policy.md`; crypto-erasure.
- **Accuracy**: bitemporal records; every pay line carries its rule and explanation.
- **Transparency**: assistant data-flow note; sources shown in answers.

## 4. Risk assessment

Likelihood and severity are engineering estimates (L/M/H), to be replaced by the DPO's assessment.

| # | Risk to individuals | Likelihood | Severity | Controls present | Residual | Further action |
|---|---|---|---|---|---|---|
| 1 | Cross-tenant disclosure through a query defect | Low–Med | High | Forced RLS; tenant-scoped helpers; negative tests per module; RLS catalog test (Phase 1) | Medium until independently reviewed | **External:** independent RLS/role review |
| 2 | Disclosure of identity or bank data by a malicious or curious operator with database access | Low | High | Field encryption; keys in a separate custody domain (Phase 1, cloud KMS adapter) | Medium until real KMS custody is in place | Select KMS and custody model (decision #2); live-KMS test |
| 3 | Incorrect salary calculation harming individuals | Med | High | Deterministic engine, golden vectors, per-line explanations, L2 gate blocking live payment until reviewed and parallel-run | Low once L2 achieved; **gate currently locks live payment** | **External:** UAE reviewer, parallel runs, bank validation |
| 4 | Account takeover | Med | High | Argon2id, TOTP, recovery codes, lockout, step-up for sensitive actions, passkeys and SSO (Phase 3) | Low–Med | Enforce MFA policy per tenant; pen test |
| 5 | Exposure of documents through storage or malware | Low–Med | High | Encryption before storage, virus scanning, quarantine, access audit (Phase 5) | Low–Med | Real object-store configuration review |
| 6 | Leakage to an AI provider | Low | High | Off by default; per-tenant consent; DLP; field-blind tools; evaluated against injection (Phase 8) | Low | Legal review of the data-flow note |
| 7 | Unauthorised outbound data via webhooks (SSRF, exfiltration) | Low | Med | SSRF guard, per-tenant destination allow-list, signed deliveries | Low | Pen test |
| 8 | Loss of availability on pay day | Med | Med | Multi-instance, shared rate-limit state, watchdog alerts, restore drill (Phase 7) | Medium until HA is deployed | Choose hosting; run DR drill in staging |
| 9 | Erasure incomplete or blocked wrongly | Low | Med | Crypto-erasure; legal-hold gate; object deletion | Low | Counsel to confirm scope of scrubbing |
| 10 | Excessive retention | Med | Low–Med | Retention schedule and jobs (see policy) | Low once jobs run | Tenant-level configuration review |

## 5. Consultation
Employee representatives and tenant HR have not been consulted. No supervisory-authority consultation has occurred. These are required steps before GA and are recorded as **not done**.

## 6. Conclusion and sign-off
The residual risks listed as "until reviewed" depend on external actions. This draft does not conclude that processing is acceptable; that decision belongs to the controller with the DPO.

| Role | Name | Decision | Date |
|---|---|---|---|
| DPO / privacy counsel | _not appointed_ | _pending_ | |
| Product owner | _pending_ | _pending_ | |
