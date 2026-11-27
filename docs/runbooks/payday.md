# Pay-day runbook

## T-1 business day

1. Confirm the API and worker deployment versions match: `kubectl -n meridian get deploy meridian-api meridian-worker -o wide`.
2. Confirm `GET /api/v1/health/ready` is healthy on every API instance and that Redis is reachable from every instance.
3. Check the pay-day dashboard for `meridian_pay_runs_stuck`, `meridian_outbox_rows`, oldest outbox age, limiter errors, database pool saturation, and worker tick duration.
4. Confirm the payroll administrator and independent approver are available. Never bypass the approval/content-hash gate.
5. Confirm the UAE pack remains at its approved assurance level. The repository default is L0 and live payment must remain blocked until the external L2 gate is complete.
6. Check exceptions are zero or explicitly documented, and that the run is `sandbox` or `parallel` unless the approved live-pay gate is in force.

## During the run

1. Record the run ID and request IDs in the change record.
2. Lock inputs, calculate, inspect explanations/exceptions, submit for review, and obtain an independent approval. Do not edit snapshots or results directly.
3. If a watchdog alert fires, stop progression, inspect the run's audit trail and transition event, and resolve the underlying issue before retrying.
4. If the outbox grows, inspect worker logs and delivery errors. Do not delete or manually mark rows processed.
5. Publish payslips only after the stored result hash and approval hash agree.

## After the run

Capture the run status, result count, exceptions, approval actor, audit verification result, outbox depth, and dashboard screenshots in the change record. Escalate unexplained variance as a payroll incident; the platform is not a substitute for a bank or legal review.
