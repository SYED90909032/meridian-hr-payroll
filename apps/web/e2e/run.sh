#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
API_PORT="${API_PORT:-$((49000 + RANDOM % 500))}"
WEB_PORT="${WEB_PORT:-$((49500 + RANDOM % 500))}"
cleanup() { kill ${API_PID:-} ${WEB_PID:-} 2>/dev/null || true; }
trap cleanup EXIT
cd "$ROOT"
pnpm --filter @meridian/api build
pnpm --filter @meridian/web build
(cd apps/api && . ../../.testenv && DATABASE_URL_OWNER="$TEST_DATABASE_URL_OWNER" DATABASE_URL_APP="$TEST_DATABASE_URL_APP" DATABASE_URL_AUTH="$TEST_DATABASE_URL_AUTH" DATABASE_URL_WORKER="$TEST_DATABASE_URL_WORKER" NODE_ENV=test PORT="$API_PORT" WEB_DIST="$ROOT/apps/web/dist" node dist/main.js) & API_PID=$!
(cd apps/web && E2E_API_URL="http://127.0.0.1:${API_PORT}" pnpm exec vite preview --host 127.0.0.1 --port "$WEB_PORT") & WEB_PID=$!
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:${API_PORT}/api/v1/health" >/dev/null && curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null && break; sleep 1; done
cd apps/web
E2E_BASE_URL="http://127.0.0.1:${WEB_PORT}" E2E_API_URL="http://127.0.0.1:${API_PORT}" pnpm exec playwright test --config e2e/playwright.config.ts
