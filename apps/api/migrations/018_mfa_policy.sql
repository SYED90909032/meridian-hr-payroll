-- 018 MFA policy: tenants opt in to requiring enrolment for selected roles.
-- The default is intentionally empty so existing tenants are not locked out at deploy time.
create table kernel.tenant_mfa_policy (
  tenant_id uuid primary key references kernel.tenant(id) on delete cascade,
  required_roles text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (required_roles <@ array['owner','hr_admin','payroll_admin','payroll_approver','manager','auditor','helpdesk_agent']::text[])
);
select app.rls_standard('kernel.tenant_mfa_policy');
grant select on kernel.tenant_mfa_policy to meridian_auth;
create policy auth_read on kernel.tenant_mfa_policy as permissive for select to meridian_auth using (true);
