# Personal-data breach notification process

| | |
|---|---|
| Status | **Draft process.** Notification windows and thresholds must be confirmed by counsel for each jurisdiction. Not yet rehearsed with a real exercise. |
| Applies to | Any confirmed or suspected loss, unauthorised access, alteration or disclosure of tenant personal data. |
| Companion | `docs/runbooks/incident-response.md` (technical response), `docs/runbooks/data-breach.md` (command-level steps, written in Phase 7). |

## Roles
| Role | Responsibility | Holder |
|---|---|---|
| Incident commander | Runs the incident, owns decisions | On-call engineer, escalating to the product owner |
| Security lead | Scoping, forensics, evidence | _to be appointed_ |
| Privacy lead / DPO | Notification decisions, regulator and customer wording | _to be appointed_ |
| Communications | Customer messages | Product owner until a team exists |

## Timeline

| When | Action |
|---|---|
| T0 | Detection (alert, report, researcher). Open an incident record. Start a UTC timeline. |
| T0 + 1 h | Severity assigned. Containment started: revoke sessions, rotate keys or API keys, disable the affected feature. Preserve evidence (do not delete logs). |
| T0 + 24 h | Scope assessment: which tenants, which data categories, which individuals, whether encrypted fields were exposed **with** their keys. Run **seal and verify audit** to confirm the audit chain is intact. |
| **As soon as the controller can be told, and within 24 h of confirmation** | **Processor to controller notification** to each affected tenant's named security contact, with the facts known so far. (Target set by engineering; contractual period to come from the DPA.) |
| Within the statutory window | **Controller to authority and individuals** where the law requires it. The UAE PDPL regime and the free zone regimes (DIFC DP Law, ADGM) have their own thresholds and periods; GDPR is 72 hours from awareness. Counsel confirms which apply. Meridian supplies the information; the controller decides and files. |
| After containment | Post-incident review within 5 working days: root cause, control failures, tests added. Seal and verify the audit chain, record the result. |

## Content of the notice to the controller
1. What happened and when it was detected.
2. Categories and approximate number of individuals and records.
3. Whether affected fields were encrypted and whether keys were exposed.
4. Likely consequences.
5. Measures taken and recommended actions for the controller.
6. Contact point.

## Decision aids
- **Encrypted fields and keys not exposed**: usually lower risk; still notify the controller of the event.
- **Keys exposed or KMS custody compromised**: treat as high risk; rotate (see key-rotation runbook), re-wrap, assess re-encryption.
- **Cross-tenant exposure**: treat as high risk for every tenant involved.
- **Payment diversion (bank details altered)**: freeze payment files, contact the bank, require step-up verification for all tenants' bank edits until cleared.

## Evidence the platform produces
Audit chain with signed seals and off-box copies, step-up and reveal events, API key and session logs, request ids in logs, outbox and webhook delivery logs.

## Not yet done
Contact list for each regulator, template wording reviewed by counsel, a tabletop exercise, customer security-contact capture at onboarding.
