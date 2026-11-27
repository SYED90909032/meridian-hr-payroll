# ADR-026: Phase 4 payroll and time completeness stays parameterised at L0

Status: Accepted (implementation mechanism; reviewer sign-off pending)

## Context

Phase 4 closes payroll edge cases that affect real workforces: partial-period hires and leavers, valid-time compensation changes, overnight attendance, termination settlement inputs, off-cycle items, contractor treatment, and reversals. The UAE pack is still assurance L0. No statutory interpretation may be promoted to a legal claim by code.

## Decision

The engine remains the deterministic reference implementation. The API snapshot builder supplies explicit valid-time compensation segments and the pack's 30-day basis is used for daily proration. Each segment produces separate lines retaining the same rule id and an explanation containing its dates and payable days. Contract notice days, leave-encashment enablement, contractor enablement, and overnight attribution are data/settings, not hidden constants; contractor payroll and leave encashment default off.

An off-cycle run claims each one-off adjustment to exactly one run at input lock, so a regular run cannot count it again. A reversal is a new linked run with cloned immutable snapshots and compensating result lines with equal and opposite amounts. The original run is frozen as `reversed`; a reversal of a reversal is rejected by database and service guards.

Overnight shifts default to the shift start local date in the tenant timezone (`Asia/Dubai` by default). Tenants may choose end-date attribution. Punches are evaluated on both sides of midnight and neighboring dates are recomputed after ingest.

## Consequences

Finalised payslips and original result rows remain untouched; approvals still bind to each new run's result hash. Existing runs retain their original pack hash/version; the UAE pack changed to version 0.2.0 and remains L0. These mechanisms require an independent payroll/legal reviewer, bank/WPS validation, and parallel-run evidence before any live payment use. No live-payment gate was weakened.
