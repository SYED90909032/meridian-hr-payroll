# Incident response runbook

| | |
|---|---|
| Status | **Draft.** Never exercised in a real incident or tabletop. Contacts and tool locations marked _to fill_ must be completed by the operator before GA. |
| Related | `docs/compliance/breach-notification.md` (who must be told and when), `docs/runbooks/data-breach.md`, `docs/runbooks/payday.md`, `docs/runbooks/backup-restore.md`, `docs/runbooks/leaver-revoke.md` |
| Principle | **Contain, preserve, assess, communicate, recover, learn.** Never delete evidence. Never disable the audit trail. Never weaken the live-payment gate to "get things moving". |

## 1. Severity

| Level | Definition | Examples | Response time |
|---|---|---|---|
| SEV1 | Confirmed data exposure, cross-tenant leak, payment diversion, audit tampering, or pay-day outage | Wrong tenant's data visible; bank details altered without step-up | Immediately, 24x7 |
| SEV2 | Credible vulnerability, partial outage, wrong calculation found in a draft run | Auth bypass reported but not exploited; calculation defect caught before approval | Within 1 hour |
| SEV3 | Minor defect, no data impact | Alert noise, degraded non-critical feature | Next working day |

## 2. Roles and channel
Incident commander (decides), scribe (timeline, UTC), technical lead, communications. Private channel and incident document: _to fill_. Private security advisory channel for external reports: GitHub private vulnerability reporting on the repository, plus a security contact address _to fill_.

## 3. First 30 minutes
1. Declare the incident, set severity, start the timeline.
2. **Contain** according to type:
   - *Credential or session compromise*: revoke the user's sessions and API keys in the admin console or with the revoke script in `docs/runbooks/leaver-revoke.md`; force password reset.
   - *Suspected cross-tenant leak*: put the affected route behind a feature switch or return 503 at the edge; do not delete data.
   - *Key exposure*: follow the key rotation runbook; disable the affected KMS key version for new encryption.
   - *Payment risk*: block the pay run (do not finalise), contact the bank if a file was released, require step-up for all bank-detail edits.
   - *Malicious upload*: confirm quarantine, search for the same hash across tenants.
   - *Webhook or SSRF abuse*: disable the endpoint, tighten the allow-list.
3. **Preserve**: snapshot the database (point-in-time marker), keep logs and metrics, record request ids.
4. Notify the incident commander's chain; start the breach clock if personal data may be involved (see the breach process).

## 4. Assess
- Use request ids and the audit chain to establish scope. **Seal and verify the audit chain now**: run the verifier (`/api/v1/audit/verify`) and compare with the off-box seal copy. A mismatch is itself a SEV1.
- Identify tenants, data categories, individuals, and whether encrypted fields and their keys were exposed.
- Decide if regulators, banks, or customers must be notified (breach process).

## 5. Recover
- Fix forward through the normal pipeline: a failing test first, then the fix, then deploy.
- Rotate anything that may have leaked (sessions, API keys, webhook secrets, KMS key versions, signing key if exposed: signing-key rotation is a documented, audited operation).
- Restore from backup only when the data itself is damaged, using the restore drill procedure, and verify the audit chain on the restored copy.
- Re-run reconciliation for any pay run touched; confirm totals against the frozen run hash.

## 6. Communicate
Customers (controllers) through their security contact with facts only, in the format in the breach process. Public statements only through the product owner.

## 7. Learn
Post-incident review within five working days: timeline, root cause, what detection missed, tests added, runbook changes. Store it under `docs/incidents/` (no personal data). Add or update a regression test for every confirmed defect.

## 8. Pay-day specifics
- Stuck run: check the watchdog alert, the worker health, and the outbox depth. Do not force a state change in the database by hand; use the supported transitions so that triggers and the audit chain stay valid.
- Wrong figure found after approval: **reverse** the run (compensating entries), never edit; see the reversal procedure in `docs/runbooks/payday.md`.
- Bank rejects a file: use the manual file fallback path, keep the rejected file for evidence.

## 9. Things never to do
Disable RLS, drop or edit audit rows, edit frozen payslips, set a pack to a higher assurance level without the sign-off evidence the gate demands, or paste production data into external tools, including AI services.

## 10. Contacts (to fill before GA)
On-call rota, product owner, security lead, DPO, hosting provider support, KMS provider support, bank relationship manager, legal counsel, email provider support.
