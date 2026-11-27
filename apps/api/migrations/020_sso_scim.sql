-- 020 enterprise identity: OIDC configuration, group mappings, and tenant-scoped SCIM credentials.
create table kernel.sso_config (
  tenant_id uuid primary key references kernel.tenant(id) on delete cascade,
  issuer_url text not null check (length(issuer_url) between 1 and 2048),
  client_id text not null check (length(client_id) between 1 and 512),
  client_secret_enc text not null,
  allowed_email_domains text[] not null default '{}',
  enabled boolean not null default false,
  jit_provision boolean not null default false,
  default_role text not null default 'employee' check (default_role in ('employee','manager','auditor','helpdesk_agent')),
  group_claim text,
  idp_mfa_satisfies boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references kernel.user_account(id)
);
select app.rls_standard('kernel.sso_config');
create table kernel.sso_group_role (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id) on delete cascade,
  group_name text not null check (length(group_name) between 1 and 200),
  role text not null check (role in ('employee','manager','auditor','helpdesk_agent','hr_admin','payroll_admin','payroll_approver','owner')),
  created_at timestamptz not null default now(),
  unique (tenant_id, group_name)
);
select app.rls_standard('kernel.sso_group_role');
create policy auth_sso_config_read on kernel.sso_config as permissive for select to meridian_auth using (true);
create policy auth_sso_group_read on kernel.sso_group_role as permissive for select to meridian_auth using (true);
create table kernel.sso_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id) on delete cascade,
  state_hash bytea not null unique,
  nonce text not null,
  pkce_verifier_enc text not null,
  redirect_path text not null default '/',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
select app.rls_standard('kernel.sso_state');
create policy auth_state_access on kernel.sso_state as permissive for all to meridian_auth using (true) with check (true);
create index sso_state_active on kernel.sso_state (expires_at) where used_at is null;
create table kernel.scim_token (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id) on delete cascade,
  token_hash bytea not null unique,
  token_prefix text not null,
  label text not null check (length(label) between 1 and 100),
  scopes text[] not null default '{scim:write}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references kernel.user_account(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
select app.rls_standard('kernel.scim_token');
create policy auth_scim_lookup on kernel.scim_token as permissive for select to meridian_auth using (true);
create policy auth_scim_touch on kernel.scim_token as permissive for update to meridian_auth using (true) with check (true);
create index scim_token_tenant on kernel.scim_token (tenant_id, created_at desc);
revoke all on kernel.sso_state, kernel.scim_token from meridian_app;
grant select, insert, update, delete on kernel.sso_state to meridian_auth;
grant select, update on kernel.scim_token to meridian_auth;
grant select, insert, update, delete on kernel.scim_token to meridian_app;
grant select on kernel.sso_config, kernel.sso_group_role to meridian_auth;
