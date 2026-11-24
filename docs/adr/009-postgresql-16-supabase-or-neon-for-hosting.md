# ADR-009: PostgreSQL 16; Supabase or Neon for hosting

Blueprint ref: D9
Status: Accepted (provisional)

## Decision
Plain PostgreSQL with our own migrations. No Supabase-specific features, so any host works.

## Reason
Portability; RLS and partitioning are core Postgres.

## Rejected alternative
Supabase client features

## Change this
Syed can change any provisional decision. Say which ADR and what to switch to.
