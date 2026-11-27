# ADR-025: Object storage behind a port (supersedes the open part of ADR-012)

Status: Accepted (working default, see `docs/DECISIONS.md` row 3)

## Context
Documents and payslips live in the database today, and the blueprint (G9, G13) needs durable storage outside it: off-box audit seals must survive loss of the database, and documents should not bloat it. A vendor has not been chosen.

## Decision
Code depends on an `ObjectStore` interface (`apps/api/src/storage`) with `put`, `get`, `head`, `delete`, `list` and `presignGet`. Two backends ship: `local` (a directory; development and tests) and `s3` (any S3-compatible service: AWS S3, Cloudflare R2, MinIO, moto). `put(..., { overwrite: false })` is a write-once operation implemented with a conditional write (`If-None-Match: *`) so the service, not the application, prevents replacement.

Keys are validated by a conservative allow-list and reject `..`, leading slashes and empty segments. Content stored for people is encrypted by the application before upload (Phase 5), so the store never sees plaintext documents.

## Consequences
Moving vendor is a configuration change when the service is S3-compatible, and a new adapter otherwise. The `local` backend must not be used in production: operations must set `OBJECT_STORE=s3`.
