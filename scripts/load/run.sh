#!/usr/bin/env bash
set -euo pipefail
N="${N:-1000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
echo "Synthetic load target: ${N} employees; API: ${BASE_URL}"
echo "This harness deliberately does not promote a payroll pack or reach live payment."
node scripts/load/measure.mjs
# For a calculation-loop profile, run the dedicated sandbox fixture with:
#   node --cpu-prof scripts/load/payrun-sandbox.mjs --employees "$N"
# The fixture is environment-specific because tenant/auth/pay-run IDs are never fabricated here.
