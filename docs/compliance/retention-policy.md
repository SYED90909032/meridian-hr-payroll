# Data retention and legal-hold policy

| | |
|---|---|
| Status | **Draft.** Periods marked "confirm" depend on legal advice. Defaults are engineering proposals, not legal conclusions. |
| Mechanism in code | Crypto-erasure (destroying a subject's data key), legal holds (`kernel.legal_hold`) that block erasure, and scheduled pruning jobs in the worker (webhook delivery logs in Phase 6; others listed below as they are built). |

## Principles
1. Keep personal data only as long as the purpose or a legal duty needs it.
2. A **legal hold** always wins over a retention or erasure request until released by an authorised owner. Holds are audited.
3. Payroll and audit records are retained for statutory periods even after an employee leaves.
4. Erasure is performed by crypto-erasure plus scrubbing of unencrypted direct identifiers. The audit chain retains identifiers and event metadata only.

## Schedule

| Data | Default retention | Trigger | Method | Status of automation |
|---|---|---|---|---|
| Payroll results, payslips, payment files | **Confirm with UAE reviewer** (commonly at least 5 years) | Pay-run finalisation | Manual review, then crypto-erasure of employee keys where permitted | Not automated, by design: deletion of financial records needs a human decision |
| HR core record | Employment + statutory period (**confirm**) | Termination date | Crypto-erasure then scrub | Operator-run, with legal-hold check |
| Identity and bank fields | With the HR core record | Same | Key destruction | Built (crypto-erasure) |
| HR documents (contracts, ID copies, certificates) | Contracts: employment + statutory period; ID copies: shortest period the law allows after verification (**confirm**) | Termination or document kind rule | Delete object and DB row | Object deletion built in Phase 5; time-based sweep not automated |
| Time punches and attendance | 2 years (tenant-set) | Date of record | Scheduled delete | Not yet automated |
| Leave records | 2 years after leave-year end | Year end | Scheduled delete | Not yet automated |
| Service tickets and comments | 2 years after closure | Closure | Scheduled delete | Not yet automated |
| Assistant conversations | 30 days (tenant-set) | Message time | Scheduled delete | Not yet automated |
| Sessions, login attempts | 90 days after expiry | Expiry | Scheduled delete | Not yet automated |
| Outbox (processed) | 30 days | Processing | Scheduled delete | Check current worker behaviour |
| Idempotency records | 24 hours | Creation | Scheduled delete | Existing expiry column; confirm pruning |
| Webhook delivery logs | 90 days (configurable) | Delivery time | Scheduled delete | Built in Phase 6 |
| Application logs | 30 days | Log time | Platform log retention | Operator-side |
| Audit events and seals | At least the longest pay-record period; effectively indefinite while the chain must verify | n/a | Never deleted by the app; archival of whole sealed blocks only after sealed copies are stored off-box | By design |
| Backups | 35 days point-in-time window; encrypted | Backup time | Platform lifecycle | Operator-side |

## Erasure request handling
1. Verify the request comes from the controller (the tenant) and identify the employee.
2. Check `kernel.legal_hold` and statutory retention. If either applies, refuse and record the reason.
3. Run crypto-erasure, which destroys the subject key and, with Phase 5, deletes the employee's stored objects.
4. Scrub unencrypted direct identifiers as defined in the erasure runbook (`docs/runbooks/crypto-erasure-request.md`).
5. Record completion in the audit chain and tell the controller in writing.
6. Backups age out under the 35-day window; the ciphertext in them is unreadable because the key is gone.

## Gaps
Most time-based sweeps in the table are not implemented. They are listed so the owner can decide which are required before GA; the progress tracker carries them as open items.
