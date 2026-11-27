# Phase 5 document and storage review pack

## Implementation evidence

- Migration 023 adds document scan state, plaintext hash retention, nullable legacy ciphertext, scoped deletion, and payslip object references. Existing forced RLS and the payslip immutability trigger remain in force.
- `ClamdScanner` uses TCP `zINSTREAM` with a null terminator, bounded chunks, bounded responses and timeouts. Scanner errors remain unavailable and retry through the outbox; detections are quarantined.
- New documents and payslip archives use `subjectKey()` and AES-256-GCM AAD bound to record identity/version. Downloads verify GCM and SHA-256 before returning bytes. Presigned ciphertext URLs are not exposed because clients cannot decrypt them.
- Employee erasure deletes object references/objects and destroys the subject key after the existing legal-hold gate. Google Drive/SharePoint are **Blocked: owner decision D-1**.

## Verification performed

- `pnpm --filter @meridian/api typecheck`: passed.
- `pnpm --filter @meridian/api build`: passed.
- `pnpm --filter @meridian/web typecheck`: passed.
- `pnpm --filter @meridian/web build`: passed.
- Full API suite: 9 files, 140 tests passed on real PostgreSQL 16 database `meridian_test_p5docs` with `REQUIRE_INFRA=1`; document tests and scanner real-infrastructure tests used clamd at `127.0.0.1:3310` with a runtime-constructed EICAR sequence. The migration test calls Fastify inject directly and compares `rawPayload` to the seeded bytes. Erasure tests verify object deletion/reference blanking and legal-hold refusal with object survival. Object-store contract tests used local storage and moto S3. Fake daemon tests covered connection errors, hangs/timeouts and oversized responses.
- `docs:migrate-to-store --dry-run` was executed explicitly against the isolated p5docs URLs with real ClamAV and returned `{"dry_run":true,"scanned":0,"migrated":0,"already_done":0,"quarantined":0,"pending_scan":0,"failed":0,"skipped":3}`; the three skipped rows were already erased/non-legacy rows and no legacy ciphertext remained to migrate.

## Limits and follow-ups

ClamAV detection depends on the daemon signature database update process. Moto proves S3-compatible request behavior, not AWS S3 or Cloudflare R2 operations. No provider connector or external OAuth verification was implemented. A production deployment still needs object-store versioning/retention policy, scanner signature-update monitoring, and an operational restore drill.
