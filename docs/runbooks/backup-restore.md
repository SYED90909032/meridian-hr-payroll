# Backup and restore

## Drill command

Use a throwaway source and fresh target database only. Because the application tables use forced RLS, the owner URL creates the target database but a privileged dump/restore role must carry the data path (`DUMP_URL` and `RESTORE_URL`); do not weaken RLS to make a backup work:

```sh
SOURCE_URL='postgres://...' OWNER_URL='postgres://meridian_owner:...@host:5432/meridian' \
DUMP_URL='postgres://restore_privileged:...@host:5432/source' RESTORE_BASE_URL='postgres://restore_privileged:...@host:5432' \
PUBLIC_KEY_PATH=/secure/audit-signing-public.pem ./scripts/restore-drill.sh
```

The script creates a custom-format `pg_dump`, creates a fresh database, restores with `pg_restore --no-owner`, and runs `scripts/restore-verifier.mjs`. The verifier calls the database audit-chain verifier, recomputes every Merkle root, verifies every seal with the separately supplied Ed25519 public key, counts rows in each application table, and checks forced RLS on restored tenant tables. It prints the row counts and elapsed time; the shell trap drops the throwaway database and dump afterward. `KEEP_TARGET=1` is available only for a controlled negative check and must be followed by manual cleanup. After a `--no-owner` restore, reapply schema/table ownership and grants for the runtime roles before owner-level operational checks; do not grant runtime roles `BYPASSRLS`.

## Targets and operator controls

Transactional and audit data: target RPO approximately 0 with synchronous managed-Postgres replication and continuous PITR; target RTO under 1 hour. Documents and payslip objects: target RPO at most 15 minutes with versioned object storage replication; target RTO under 4 hours. Operators must enable managed-Postgres WAL/PITR, Multi-AZ or equivalent failover, encrypted backups, and quarterly restore drills. Back up the signing public key separately from the database and keep old public keys for historical seal verification.

## Evidence

On 2026-11-27, the drill was run end to end on PostgreSQL 16.15 on the local 6-vCPU/24-GB sandbox. A clean source database was migrated through 001–012 and 026, seeded through the real API routes (1 tenant, 8 employees, 50 audit events after the fixture event), and given one Ed25519 Merkle seal using the configured signing key. With privileged dump and restore data paths, the positive restore completed with `status=ok` in `duration_ms=1239`; the verifier reported `auditTenants=1`, `seals=1`, `tableCount=69`, `forcedRlsTables=51`, and key row counts `kernel.tenant=1`, `people.employee=8`, `pay.pay_run=1`, `pay.pay_result=7`, `kernel.audit_event=51`, and `kernel.audit_block=1`. The database was restored and then dropped after verification.

For the required negative check, a retained restored copy was tampered as `meridian_owner` by temporarily disabling the audit append-only trigger and changing the first audit row. The verifier exited non-zero and reported `audit hash chain failed` with `broken="1"`; the tampered database was then dropped. This proves the check fails closed rather than merely checking that the script exits successfully.

Managed failover/PITR, object-store recovery, vendor credentials, and production timings were not exercised in this sandbox. Operators must supply a managed backup/restore role with the equivalent ability to read/restore forced-RLS tables, and must record the database version, host topology, full verifier JSON, and timing for each release evidence pack.
