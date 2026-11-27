# Data-breach response

1. Page the incident owner and privacy/legal owner. Do not investigate by changing production data.
2. Contain access: disable suspected users, revoke sessions/API/device keys, and apply the edge provider's emergency rule. Preserve the exact rule change and time.
3. Preserve API, worker, edge, database, Redis, and secret-manager logs in a restricted evidence location. Never paste credentials, national IDs, bank details, or raw request bodies into the incident channel.
4. Export and verify the affected tenant audit chain using the audit verification endpoint and separately backed-up public key. Run the restore verifier against a forensic copy if database integrity is in question.
5. Rotate exposed credentials through the secret manager and, if applicable, rotate KMS wrapping keys. Do not rotate the Ed25519 signing key without preserving the old public key for historical seals.
6. Determine affected data classes, tenants, time window, and whether data was accessed or only exposed. Legal/privacy owners determine notification obligations; this runbook does not invent jurisdictional deadlines.
7. Record containment, evidence hashes, decisions, and follow-up controls in the incident record. Re-enable traffic only after the incident owner signs off.
