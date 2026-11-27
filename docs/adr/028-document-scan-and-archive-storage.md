# ADR-028: Scan-gated encrypted document and payslip archives

Status: Accepted for Phase 5; provider connectors blocked on owner decision D-1

## Context

Meridian's documents were encrypted in PostgreSQL, which made database growth and durable off-box retention difficult. The Phase 5 blueprint requires an object-store port, malware scanning before retrieval, encrypted employee-scoped archives, integrity verification, and crypto-erasure. The existing `ObjectStore` port (ADR-025), `subjectKey()` hierarchy, AES-256-GCM helpers, forced RLS, and immutable payslip trigger are established boundaries.

## Decision

Uploads are validated for size, filename, declared type and magic bytes, then scanned through the `Scanner` port. `ClamdScanner` uses clamd's TCP `zINSTREAM\0` framing with bounded chunks, response limits and timeouts. `NoneScanner` exists only for development/tests; production refuses it unless `ALLOW_UNSCANNED_DOCUMENTS=true`, which emits a loud warning. A scanner error never becomes clean: the encrypted pending object remains unavailable, a `document.scan` outbox entry retries it, and it becomes `scan_failed` after the configured attempt limit. Detections are not placed in the normal prefix; the row is `quarantined`, the signature is retained, and HR/owner and the uploader receive in-app notices.

Clean plaintext is encrypted with the employee data key obtained only through `subjectKey()`, using AAD bound to employee, document and version, and written to the configured object store. PostgreSQL retains metadata, plaintext SHA-256, status and object key; legacy `content_enc` is nullable during resumable migration. Downloads require the existing reveal step-up, are audited for non-self access, verify GCM and the plaintext hash, and return attachment/no-store/nosniff headers. Presigned URLs are not exposed because clients cannot decrypt ciphertext.

Frozen payslip JSON remains the database source of truth and immutable fields remain protected by the existing trigger. Finalisation writes a separately encrypted archive, reads it back, and verifies its retained `content_hash`; self-service and staff reads verify the archive before returning database content. Employee erasure deletes document, pending, quarantine and payslip objects and blanks references after rechecking legal hold, while destruction of the employee key remains the cryptographic backstop.

The migration CLI is idempotent and resumable, supports `--dry-run`, scans legacy encrypted rows, read-backs and hash-verifies before nulling `content_enc`. Google Drive and SharePoint are represented only by a restricted `DocumentConnector` port: OAuth service-account, least-privilege scopes, folder allow-lists and short-lived credentials are documented, but provider implementation is blocked pending D-1.

## Consequences

The database no longer needs to retain new document ciphertext, and object loss or tampering fails closed rather than returning data. A scanner outage delays availability and can require operator retry; it cannot silently publish an unchecked document. Local storage is suitable only for development/tests; moto is used as an S3-compatible stand-in in tests. ClamAV detections depend on the daemon's signature database freshness. Existing documents require the migration command before their DB blobs can be removed. Provider connectors remain intentionally unavailable until the owner decision is recorded.
