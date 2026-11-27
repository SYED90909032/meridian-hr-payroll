# Meridian PostgreSQL RLS review pack

**Status: review has NOT happened.** This pack is prepared for an independent PostgreSQL security reviewer who has not yet been appointed. It is evidence and a starting point, not a sign-off.

## Scope and role model

Meridian uses one schema per module: `kernel`, `people`, `flow`, `tm`, `pay`, `svc`, `plat`, and `ai`. The `meridian_owner` role is migration/operations-only and is not used by the running API. `meridian_app` handles tenant transactions, `meridian_auth` handles identity lookups and login state, and `meridian_worker` can claim/finish outbox work only through the two `SECURITY DEFINER` functions. Runtime roles must be non-superuser, `NOBYPASSRLS`, and own no tables.

The request pipeline performs authentication, permission checks, step-up/MFA, strict validation, and a tenant-bound transaction. PostgreSQL remains the final tenant boundary: `app.tenant_id()`, `app.user_id()`, and `app.employee_id()` read transaction-local settings. `app.system(actor)` is only raised after the route permission check. `app.can_see` and `app.can_write` resolve role classes and report/org-unit scope. `app.is_self` limits employee self-service. `app.has_tenant_class` is used for audit visibility. Payroll uses `app.pay_tenant_read` and `app.pay_tenant_write`.

## Policy and helper inventory

Migrations 001–012 define restrictive `tenant_wall` policies and permissive functional policies. Standard tenant tables use `app.rls_standard`; restricted classes use `app.rls_restricted` with tenant wall plus class/scope/self policies. Restricted classes are compensation, bank, national ID, payroll/pay results, payslips, confidential helpdesk tickets/comments, documents, special-leave reasons, and team-scoped time records. Append-only audit rows are protected by database triggers and are readable only through audit policy. Global reference data such as `pay.pack_registry` and `kernel.role_field_grant` deliberately has no `tenant_id`; those exceptions are owner-maintained or read-only to runtime roles.

## Catalog matrix

Regenerate the table-by-table matrix (including RLS flags, forced flags, policies, and runtime-role ownership) with:

```sh
pnpm --filter @meridian/api review:rls
```

The generated file is `docs/reviews/rls-catalog-matrix.md`. The catalog-driven tests independently assert that every table in the eight tenant schemas with a `tenant_id` column has RLS enabled and forced. Audit and session tables are also forced; narrow migration-owner and auth-role policies allow their required definer/login operations without weakening runtime tenant tables.

## Existing attack tests and threat mapping

`apps/api/test/db-security.test.ts` covers no-context reads, cross-tenant reads and writes, guessed identifiers, pooled-connection context leakage, runtime-role capabilities, identity-table denial, restricted-class self/scope separation, append-only audit tampering, audit-chain verification, and worker-function-only access. These map primarily to T5/T6 (tenant isolation and authorization), T9 (audit integrity), T13/T17 (key custody/data protection), and T15 (least privilege) in `docs/THREAT_MODEL.md`. The new key-provider tests cover KMS-context binding and denied unwrap behavior; off-box seal tests cover missing, mismatched, and extra objects (T9).

## Review questions

1. Are the narrow audit/session owner and auth policies correctly scoped, and can any be reduced further without breaking definer/login operations?
2. Are all `SECURITY DEFINER` functions restricted to a fixed `search_path`, and do their grants expose any unintended cross-tenant operation?
3. Are role membership, default privileges, ownership, and future-schema grants safe during migrations?
4. Do partitioned time tables inherit the intended forced-RLS posture and policy set?
5. Should blind indexes receive explicit versioning before a production master-key rotation, or is the documented v0 compatibility policy acceptable for the deployment threat model?
6. Does the legal-hold trigger remain enforceable under the operational owner procedures used for incident response?

No independent review, staging rotation drill, real AWS KMS test, or production authorization is claimed by this document.
