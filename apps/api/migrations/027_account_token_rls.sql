-- 027: Integration fixes found when the parallel workstreams were merged.
-- (1) kernel.account_token carries a tenant_id but was created (017) without row-level security.
-- The RLS catalog test (migration 013/014 coverage) requires every tenant-bearing table to be forced-RLS.
-- Same pattern as kernel.session in 014: only the auth role (pre-login token handling) and the migration owner may touch it;
-- runtime app/worker roles have no grant at all.
alter table kernel.account_token enable row level security;
alter table kernel.account_token force row level security;
create policy account_token_auth_rw on kernel.account_token as permissive for all to meridian_auth using (true) with check (true);
create policy account_token_owner_rw on kernel.account_token as permissive for all to meridian_owner using (true) with check (true);

-- The legacy-document migration CLI (023) runs as meridian_owner under FORCE RLS and must unwrap the employee's
-- key through its tenant key version (013). Without this read policy the lookup silently returned no rows and the
-- tool failed with "subject key references a missing tenant key version". Read-only; owner role only.
create policy owner_tenant_key_migration_read on kernel.tenant_key as permissive for select to meridian_owner using (true);
