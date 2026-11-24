# Handoff note
Repo: https://github.com/SYED90909032/meridian-hr-payroll (private, branch main).
State: API (139 routes, migrations 001-012), engine, and web UI (17 pages) are built and tested. 33 engine + 117 API tests pass; `pnpm typecheck`, `pnpm audit --prod` clean.
Run: see README.md. Dev DB `meridian`, test DB `meridian_test`; reset with `./scripts/db-reset.sh <db>`.
Conventions: all routes via `defineRoute`; tenant tables use forced RLS; the app role never owns objects.
Open items: see tasks/todo.md "Not done", docs/SECURITY.md section 2 (payroll assumptions) and section 3 (gaps), ADRs marked provisional (D1-D16 were never answered by the product owner), D11 KMS open.
Next slices (suggested): (1) UAE pack review to L1/L2 and bank WPS validation; (2) email delivery + invitation/reset flows; (3) SSO/OIDC + passkeys; (4) KMS adapter; (5) leave proration and mid-period comp split; (6) web component tests and Playwright suite in CI.
