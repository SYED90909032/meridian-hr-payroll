# Build progress (handoff note)

Repo: /home/ubuntu/projects/hr-payroll-10987a11/meridian (git, branch main). GitHub target: SYED90909032 account (gh authenticated), create private repo `meridian-hr-payroll`, push at the end of each major slice.

DB (local): PostgreSQL 16, databases `meridian` and `meridian_test`; roles meridian_owner/app/auth/worker (passwords in .env, gitignored). Start with `sudo pg_ctlcluster 16 main start`.
pnpm 11: build scripts allowed through `allowBuilds` in pnpm-workspace.yaml.

Done: slice 1 engine (33 tests green, committed). Migrations 001 and 002 written (not yet run).
Next: migrations 003 (flow, time), 004 (pay), 005 (svc, plat, ai); migration runner; API (Fastify) modules; tests on meridian_test; web UI; CI; push.

Design notes to keep:
- App role has FORCE RLS everywhere; definer functions only for audit, outbox claim, punch partitions.
- Registration: set app.tenant_id to the new tenant id, insert tenant row (policy allows it), user_account via the auth pool.
- Pay run unique index excludes only cancelled and reversed (rejected stays active). Resolves the open point in v2.1.
- UAE pack assurance L0: live runs and payment_released are blocked by trigger.
- Terminology: class names comp, bank, national_id, pay, payslip, helpdesk_conf, helpdesk, special_leave, document, team, audit.
