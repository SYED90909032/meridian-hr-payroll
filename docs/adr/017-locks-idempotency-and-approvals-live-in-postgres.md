# ADR-017: Locks, idempotency and approvals live in Postgres

Blueprint ref: Fixed
Status: Accepted

## Decision
Partial unique index on active pay runs, idempotency rows written in the business transaction, approvals in tables.

## Reason
One system for data and its guards.

## Rejected alternative
Durable Object locks

## Change this
Syed can change any provisional decision. Say which ADR and what to switch to.
