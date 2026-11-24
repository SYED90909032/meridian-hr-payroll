#!/usr/bin/env bash
# Drops all Meridian schemas in the given database (default meridian_test) and re-migrates. DEV/TEST ONLY.
set -euo pipefail
DB="${1:-meridian_test}"
if [[ "$DB" == *prod* ]]; then echo "refusing to reset $DB"; exit 1; fi
PGPASSWORD="${OWNER_PW:-owner_dev_pw}" psql -h localhost -U meridian_owner -d "$DB" -v ON_ERROR_STOP=1 -q -c \
 "drop schema if exists app, kernel, people, flow, tm, pay, svc, plat, ai cascade;"
DATABASE_URL_OWNER="postgres://meridian_owner:${OWNER_PW:-owner_dev_pw}@localhost:5432/$DB" pnpm --filter @meridian/api db:migrate
