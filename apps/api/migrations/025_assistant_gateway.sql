-- Phase 8 assistant gateway: explicit tenant consent and auditable configuration state.
create table if not exists ai.tenant_setting (
  tenant_id uuid primary key references kernel.tenant(id),
  llm_enabled boolean not null default false,
  consent_text_version text,
  consented_by uuid,
  consented_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not llm_enabled or (consent_text_version is not null and consented_by is not null and consented_at is not null))
);
select app.rls_walled('ai.tenant_setting');
create policy tenant_setting_owner on ai.tenant_setting as permissive for all to meridian_app
  using (tenant_id = (select app.tenant_id()) and app.has_tenant_class('tenant', true))
  with check (tenant_id = (select app.tenant_id()) and app.has_tenant_class('tenant', true));
revoke delete on ai.tenant_setting from meridian_app;
grant select, insert, update on ai.tenant_setting to meridian_app;
