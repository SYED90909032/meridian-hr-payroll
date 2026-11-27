# Phase 5 document storage runbook

## Scope

This runbook covers scan-gated employee documents and encrypted payslip archives introduced by migration 023. PostgreSQL remains the metadata/source-of-truth system; the configured `ObjectStore` holds ciphertext only.

## Startup and scanner checks

Production must use `SCANNER=clamd` unless the operator deliberately sets `ALLOW_UNSCANNED_DOCUMENTS=true`; that exception emits a warning and is not a normal deployment. Check `CLAMD_HOST`, `CLAMD_PORT`, `CLAMD_TIMEOUT_MS`, `SCANNER_MAX_RESPONSE_BYTES`, and `SCAN_MAX_ATTEMPTS`. The scanner protocol test should be run against the actual daemon after deployment. ClamAV's signature database freshness is an operational dependency.

## Scanner outage

A scanner error never makes a document available. The API stores only an employee-encrypted pending object, marks the row `pending_scan`, and emits a `document.scan` outbox job. Inspect pending rows and outbox attempts, restore/reconnect clamd, and allow the worker to retry. After the configured attempt limit the row becomes `scan_failed`; do not manually mark it available. Re-upload or run a reviewed repair procedure after the daemon is healthy.

## Quarantine

A detection becomes `quarantined`, records the scanner signature, stores no object in the normal document prefix, creates in-app notices for HR/owner and the uploader, and cannot be downloaded. Only a user with `docs.write` and a fresh step-up may delete the quarantine record. Do not inspect or copy the payload into a workstation.

## Legacy migration

Set the isolated target environment explicitly, then run:

```bash
DOCS_DRY_RUN=true pnpm --filter @meridian/api docs:migrate-to-store
pnpm --filter @meridian/api docs:migrate-to-store
```

The command is idempotent and resumable. It opens legacy encrypted content with the original AAD, verifies the stored plaintext hash, scans it, writes versioned AAD ciphertext to the normal object prefix, reads it back, verifies GCM and the hash, and only then nulls `content_enc`. Review the JSON count report (`migrated`, `quarantined`, `pending_scan`, `failed`, `skipped`) before and after each batch. Always set `DATABASE_URL_OWNER` and the API URLs to the intended environment; never rely on an ambient shell value.

## Integrity incident

A missing object, GCM failure, or plaintext hash mismatch returns `integrity_error` and does not return content. Preserve the row and object-store audit evidence, do not overwrite a write-once object, and investigate object-store versioning/permissions. Payslip JSON in PostgreSQL remains the source of truth; an archive mismatch is still a release-blocking integrity incident.

## Crypto-erasure

The API rechecks the legal hold before erasure, deletes document/pending/quarantine and payslip archive objects, blanks object references, and destroys the employee subject key. Verify no object key contains the employee path, the rows have no references, and a held employee's objects remain after a refused request. Do not bypass the hold gate or the route transaction.

## External providers

Google Drive and SharePoint are not implemented. Their connector port is blocked pending owner decision D-1; do not add credentials, broad OAuth scopes, or ad-hoc provider calls to this path.
