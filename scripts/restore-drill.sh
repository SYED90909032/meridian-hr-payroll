#!/usr/bin/env bash
set -euo pipefail
# Usage: SOURCE_URL=... OWNER_URL=... PUBLIC_KEY_PATH=... [DUMP_URL=... RESTORE_URL=...] ./scripts/restore-drill.sh
: "${SOURCE_URL:?set SOURCE_URL to the throwaway source database URL}"
: "${OWNER_URL:?set OWNER_URL to the owner connection URL for creating/restoring the target database}"
: "${PUBLIC_KEY_PATH:?set PUBLIC_KEY_PATH to the separately backed-up Ed25519 public key PEM}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="${TMPDIR:-/tmp}/meridian-restore-${STAMP}.dump"
TARGET_DB="meridian_restore_${STAMP//[^a-zA-Z0-9]/}"
OWNER_NO_DB="${OWNER_URL%/*}/postgres"
TARGET_URL="${OWNER_URL%/*}/${TARGET_DB}"
DUMP_URL="${DUMP_URL:-$SOURCE_URL}"
RESTORE_BASE_URL="${RESTORE_BASE_URL:-${OWNER_URL%/*}}"
RESTORE_URL="${RESTORE_URL:-$RESTORE_BASE_URL/$TARGET_DB}"
KEEP_TARGET="${KEEP_TARGET:-0}"
cleanup() { if [[ "$KEEP_TARGET" != "1" ]]; then dropdb --if-exists --maintenance-db="$OWNER_NO_DB" "$TARGET_DB" >/dev/null 2>&1 || true; fi; rm -f "$DUMP"; }
trap cleanup EXIT
START=$(date +%s%3N)
echo "[restore-drill] dumping source"
# Forced RLS means the dump and restore data paths need a privileged role with
# row_security=off; OWNER_URL remains intentionally separate for database DDL.
pg_dump --format=custom --no-owner --file="$DUMP" "$DUMP_URL"
echo "[restore-drill] creating fresh database $TARGET_DB"
createdb --maintenance-db="$OWNER_NO_DB" --owner="$(psql "$OWNER_NO_DB" -Atc "select current_user")" "$TARGET_DB"
echo "[restore-drill] restoring dump"
pg_restore --no-owner --exit-on-error --dbname="$RESTORE_URL" "$DUMP"
echo "[restore-drill] verifying audit chains, Merkle seals, row counts, and forced RLS"
node "$ROOT/scripts/restore-verifier.mjs" "$RESTORE_URL" "$PUBLIC_KEY_PATH"
END=$(date +%s%3N)
printf '[restore-drill] status=ok duration_ms=%s target=%s\n' "$((END-START))" "$TARGET_DB"
