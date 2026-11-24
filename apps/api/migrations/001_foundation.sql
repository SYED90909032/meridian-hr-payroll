-- 001 foundation: schemas, helper functions, kernel tables, audit chain, outbox, idempotency.
-- Runs as meridian_owner. Roles are created by scripts/db-bootstrap.sql.

create extension if not exists citext;
create extension if not exists btree_gist;

revoke all on schema public from public;
-- public holds extension types and operators only (citext, btree_gist). Roles may use them, never create objects there.
grant usage on schema public to meridian_app, meridian_auth, meridian_worker;

create schema if not exists app;
create schema if not exists kernel;
create schema if not exists people;
create schema if not exists flow;
create schema if not exists tm;
create schema if not exists pay;
create schema if not exists svc;
create schema if not exists plat;
create schema if not exists ai;

grant usage on schema app, kernel, people, flow, tm, pay, svc, plat, ai to meridian_app;
grant usage on schema kernel, app to meridian_auth;
grant usage on schema kernel to meridian_worker;

-- Default privileges: the app role may use tables and sequences created here, never more than DML.
-- Functions are not executable by PUBLIC; each is granted explicitly.
alter default privileges for role meridian_owner in schema app, kernel, people, flow, tm, pay, svc, plat, ai
  grant select, insert, update, delete on tables to meridian_app;
alter default privileges for role meridian_owner in schema app, kernel, people, flow, tm, pay, svc, plat, ai
  grant usage, select on sequences to meridian_app;
alter default privileges for role meridian_owner in schema app, kernel, people, flow, tm, pay, svc, plat, ai
  revoke execute on functions from public;

-- ------------------------------------------------------------------ session context helpers
-- The API sets these with set_config(..., true) at the start of every transaction.
create function app.tenant_id() returns uuid language sql stable
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;
create function app.user_id() returns uuid language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create function app.employee_id() returns uuid language sql stable
  as $$ select nullif(current_setting('app.employee_id', true), '')::uuid $$;
grant execute on function app.tenant_id(), app.user_id(), app.employee_id() to meridian_app, meridian_auth;

-- ------------------------------------------------------------------ RLS helpers
create function app.rls_walled(tbl regclass) returns void language plpgsql as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('alter table %s force row level security', tbl);
  execute format($p$create policy tenant_wall on %s as restrictive for all to meridian_app
                    using (tenant_id = (select app.tenant_id()))
                    with check (tenant_id = (select app.tenant_id()))$p$, tbl);
end $$;

create function app.rls_standard(tbl regclass) returns void language plpgsql as $$
begin
  perform app.rls_walled(tbl);
  execute format('create policy open on %s as permissive for all to meridian_app using (true) with check (true)', tbl);
end $$;

-- ------------------------------------------------------------------ kernel: tenants and identity
create table kernel.tenant (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  slug citext not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  country char(2) not null,
  currency char(3) not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table kernel.user_account (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique check (length(email) <= 254),
  password_hash text not null,
  display_name text not null,
  totp_secret_enc text,
  totp_enabled boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  disabled boolean not null default false,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table kernel.membership (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  user_id uuid not null references kernel.user_account(id),
  employee_id uuid,
  email citext not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index membership_user on kernel.membership (user_id);

create table kernel.session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kernel.user_account(id),
  tenant_id uuid references kernel.tenant(id),
  token_hash bytea not null unique,
  mfa_verified boolean not null default false,
  step_up_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  ip text,
  user_agent text,
  revoked_at timestamptz
);
create index session_by_user on kernel.session (user_id) where revoked_at is null;

-- ------------------------------------------------------------------ kernel: authorisation reference data
create table kernel.role_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  user_id uuid not null references kernel.user_account(id),
  role text not null check (role in ('owner','hr_admin','payroll_admin','payroll_approver','manager','auditor','helpdesk_agent')),
  granted_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index role_assignment_active on kernel.role_assignment (tenant_id, user_id, role) where revoked_at is null;

create table kernel.role_assignment_scope (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  assignment_id uuid not null references kernel.role_assignment(id) on delete cascade,
  scope_type text not null check (scope_type in ('tenant', 'org_unit', 'employee', 'reports')),
  org_unit_id uuid,
  employee_id uuid,
  include_descendants boolean not null default true,
  is_primary boolean not null default false,
  check ((scope_type = 'org_unit') = (org_unit_id is not null)),
  check ((scope_type = 'employee') = (employee_id is not null))
);
create index role_assignment_scope_assignment on kernel.role_assignment_scope (tenant_id, assignment_id);

-- Which role may read or write which data class. Global reference data (no tenant column).
create table kernel.role_field_grant (
  role text not null,
  class text not null,
  can_read boolean not null default false,
  can_write boolean not null default false,
  primary key (role, class)
);
insert into kernel.role_field_grant (role, class, can_read, can_write) values
  ('owner','comp',true,true), ('owner','bank',true,true), ('owner','national_id',true,true), ('owner','pay',true,true),
  ('owner','payslip',true,true), ('owner','helpdesk_conf',true,true), ('owner','helpdesk',true,true), ('owner','special_leave',true,false),
  ('owner','document',true,true), ('owner','team',true,true), ('owner','audit',true,false),
  ('hr_admin','comp',true,true), ('hr_admin','national_id',true,true), ('hr_admin','helpdesk_conf',true,true), ('hr_admin','helpdesk',true,true),
  ('hr_admin','special_leave',true,false), ('hr_admin','document',true,true), ('hr_admin','team',true,true),
  ('payroll_admin','comp',true,false), ('payroll_admin','bank',true,true), ('payroll_admin','national_id',true,false), ('payroll_admin','pay',true,true),
  ('payroll_admin','payslip',true,true), ('payroll_admin','team',true,false),
  ('payroll_approver','comp',true,false), ('payroll_approver','pay',true,false), ('payroll_approver','payslip',true,false),
  ('manager','team',true,true),
  ('auditor','audit',true,false), ('auditor','team',true,false),
  ('helpdesk_agent','helpdesk',true,true);
grant select on kernel.role_field_grant to meridian_app;
revoke insert, update, delete on kernel.role_field_grant from meridian_app;

-- Per-subject data keys, wrapped by the tenant key (crypto-shredding).
create table kernel.subject_key (
  tenant_id uuid not null references kernel.tenant(id),
  subject_id uuid not null,
  wrapped_key bytea,
  created_at timestamptz not null default now(),
  destroyed_at timestamptz,
  primary key (tenant_id, subject_id)
);
create table kernel.legal_hold (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  subject_id uuid not null,
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

-- ------------------------------------------------------------------ kernel: outbox and idempotency
create table kernel.outbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  topic text not null,
  payload jsonb not null,
  dedupe_key text,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  claimed_until timestamptz,
  processed_at timestamptz,
  last_error text
);
create unique index outbox_dedupe on kernel.outbox (tenant_id, topic, dedupe_key) where dedupe_key is not null;
create index outbox_pending on kernel.outbox (available_at) where processed_at is null;

create table kernel.idempotency (
  tenant_id uuid not null,
  scope text not null,
  key text not null check (length(key) between 8 and 128),
  request_hash text not null,
  status_code integer,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, scope, key)
);

-- ------------------------------------------------------------------ kernel: audit hash chain
create table kernel.audit_head (
  tenant_id uuid primary key,
  last_seq bigint not null default 0,
  last_hash text not null default repeat('0', 64)
);
create table kernel.audit_event (
  tenant_id uuid not null,
  seq bigint not null,
  at timestamptz not null,
  actor_user_id uuid,
  action text not null,
  entity text,
  entity_id text,
  data jsonb not null default '{}'::jsonb,
  ip text,
  request_id text,
  prev_hash text not null,
  hash text not null,
  primary key (tenant_id, seq)
);
create table kernel.audit_block (
  tenant_id uuid not null,
  from_seq bigint not null,
  to_seq bigint not null,
  merkle_root text not null,
  signature text,
  key_id text,
  sealed_at timestamptz not null default now(),
  primary key (tenant_id, from_seq)
);

create function kernel.audit_hash_input(
  p_prev text, p_seq bigint, p_tenant uuid, p_at timestamptz, p_actor uuid, p_action text, p_entity text, p_entity_id text, p_data jsonb
) returns text language sql immutable as $$
  select concat_ws('|', p_prev, p_seq::text, p_tenant::text,
    to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p_actor::text, '-'), p_action, coalesce(p_entity, '-'), coalesce(p_entity_id, '-'), p_data::text)
$$;

-- Appends to the per-tenant chain. The head row is locked, so concurrent writers serialise per tenant.
create function kernel.append_audit(
  p_tenant uuid, p_actor uuid, p_action text, p_entity text, p_entity_id text, p_data jsonb, p_ip text, p_request_id text
) returns bigint language plpgsql security definer set search_path = pg_catalog, kernel as $$
declare
  ctx uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  h kernel.audit_head%rowtype;
  v_at timestamptz := clock_timestamp();
  v_hash text;
begin
  if ctx is not null and ctx <> p_tenant then
    raise exception 'audit tenant does not match session tenant' using errcode = '42501';
  end if;
  insert into kernel.audit_head (tenant_id) values (p_tenant) on conflict do nothing;
  select * into h from kernel.audit_head where tenant_id = p_tenant for update;
  v_hash := encode(sha256(convert_to(kernel.audit_hash_input(h.last_hash, h.last_seq + 1, p_tenant, v_at, p_actor, p_action, p_entity, p_entity_id, coalesce(p_data, '{}'::jsonb)), 'UTF8')), 'hex');
  insert into kernel.audit_event (tenant_id, seq, at, actor_user_id, action, entity, entity_id, data, ip, request_id, prev_hash, hash)
    values (p_tenant, h.last_seq + 1, v_at, p_actor, p_action, p_entity, p_entity_id, coalesce(p_data, '{}'::jsonb), p_ip, p_request_id, h.last_hash, v_hash);
  update kernel.audit_head set last_seq = h.last_seq + 1, last_hash = v_hash where tenant_id = p_tenant;
  return h.last_seq + 1;
end $$;

-- Recomputes the whole chain. Returns the first broken sequence number, or null when intact.
create function kernel.verify_audit(p_tenant uuid) returns bigint language plpgsql security definer set search_path = pg_catalog, kernel as $$
declare
  ctx uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  r kernel.audit_event%rowtype;
  expect_prev text := repeat('0', 64);
  expect_seq bigint := 1;
  h text;
  head kernel.audit_head%rowtype;
begin
  if ctx is not null and ctx <> p_tenant then raise exception 'tenant mismatch' using errcode = '42501'; end if;
  for r in select * from kernel.audit_event where tenant_id = p_tenant order by seq loop
    if r.seq <> expect_seq or r.prev_hash <> expect_prev then return r.seq; end if;
    h := encode(sha256(convert_to(kernel.audit_hash_input(r.prev_hash, r.seq, r.tenant_id, r.at, r.actor_user_id, r.action, r.entity, r.entity_id, r.data), 'UTF8')), 'hex');
    if h <> r.hash then return r.seq; end if;
    expect_prev := r.hash;
    expect_seq := expect_seq + 1;
  end loop;
  select * into head from kernel.audit_head where tenant_id = p_tenant;
  if found and (head.last_seq <> expect_seq - 1 or head.last_hash <> expect_prev) then return expect_seq; end if;
  return null;
end $$;

create function kernel.block_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not permitted: append-only', tg_op, tg_table_name using errcode = '42501';
end $$;
create trigger audit_event_no_update before update or delete on kernel.audit_event for each row execute function kernel.block_mutation();
create trigger audit_event_no_truncate before truncate on kernel.audit_event for each statement execute function kernel.block_mutation();
create trigger audit_block_no_update before update or delete on kernel.audit_block for each row execute function kernel.block_mutation();

revoke all on kernel.audit_event, kernel.audit_head, kernel.audit_block from meridian_app;
grant select on kernel.audit_event, kernel.audit_block to meridian_app;
grant insert on kernel.audit_block to meridian_app;

revoke execute on function kernel.append_audit(uuid, uuid, text, text, text, jsonb, text, text) from public;
revoke execute on function kernel.verify_audit(uuid) from public;
grant execute on function kernel.append_audit(uuid, uuid, text, text, text, jsonb, text, text) to meridian_app, meridian_auth;
grant execute on function kernel.verify_audit(uuid) to meridian_app;

-- ------------------------------------------------------------------ outbox claim (worker role only)
create function kernel.claim_outbox(p_batch integer, p_lease_seconds integer)
returns setof kernel.outbox language plpgsql security definer set search_path = pg_catalog, kernel as $$
begin
  return query
  with c as (
    select id from kernel.outbox
    where processed_at is null and available_at <= now() and (claimed_until is null or claimed_until < now())
    order by id limit least(greatest(p_batch, 1), 200) for update skip locked
  )
  update kernel.outbox o set claimed_until = now() + make_interval(secs => p_lease_seconds), attempts = o.attempts + 1
  from c where o.id = c.id returning o.*;
end $$;
create function kernel.finish_outbox(p_id bigint, p_ok boolean, p_error text, p_retry_seconds integer)
returns void language plpgsql security definer set search_path = pg_catalog, kernel as $$
begin
  if p_ok then
    update kernel.outbox set processed_at = now(), claimed_until = null, last_error = null where id = p_id;
  else
    update kernel.outbox set claimed_until = null, last_error = left(p_error, 500),
      available_at = now() + make_interval(secs => p_retry_seconds),
      processed_at = case when attempts >= 8 then now() else null end
    where id = p_id;
  end if;
end $$;
revoke execute on function kernel.claim_outbox(integer, integer), kernel.finish_outbox(bigint, boolean, text, integer) from public;
grant execute on function kernel.claim_outbox(integer, integer), kernel.finish_outbox(bigint, boolean, text, integer) to meridian_worker;
revoke all on kernel.outbox from meridian_worker;

-- ------------------------------------------------------------------ RLS on kernel tables
-- Tenant table: the app role may see and write only the session tenant's row.
alter table kernel.tenant enable row level security;
alter table kernel.tenant force row level security;
create policy tenant_self on kernel.tenant as permissive for all to meridian_app
  using (id = (select app.tenant_id())) with check (id = (select app.tenant_id()));
create policy tenant_auth on kernel.tenant as permissive for select to meridian_auth using (true);
grant select on kernel.tenant to meridian_auth;

-- Membership: the auth role lists a user's tenants at login; the app role sees its own tenant.
alter table kernel.membership enable row level security;
alter table kernel.membership force row level security;
create policy tenant_wall on kernel.membership as restrictive for all to meridian_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
create policy open on kernel.membership as permissive for all to meridian_app using (true) with check (true);
create policy auth_read on kernel.membership as permissive for select to meridian_auth using (true);
grant select on kernel.membership to meridian_auth;

-- Identity tables belong to the auth role only.
revoke all on kernel.user_account, kernel.session from meridian_app;
grant select, insert, update, delete on kernel.user_account, kernel.session to meridian_auth;
grant select on kernel.role_assignment to meridian_auth;
alter table kernel.role_assignment enable row level security;
alter table kernel.role_assignment force row level security;
create policy tenant_wall on kernel.role_assignment as restrictive for all to meridian_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
create policy open on kernel.role_assignment as permissive for all to meridian_app using (true) with check (true);
create policy auth_read on kernel.role_assignment as permissive for select to meridian_auth using (true);

select app.rls_standard('kernel.role_assignment_scope');
select app.rls_standard('kernel.subject_key');
select app.rls_standard('kernel.legal_hold');
select app.rls_standard('kernel.idempotency');

-- Outbox: the app role may insert for its tenant and read its own rows. The worker role has no table access.
select app.rls_standard('kernel.outbox');
revoke update, delete on kernel.outbox from meridian_app;

-- Audit and head tables: RLS enabled (not forced) so the definer functions keep working as owner.
alter table kernel.audit_event enable row level security;
alter table kernel.audit_block enable row level security;
alter table kernel.audit_head enable row level security;
create policy tenant_wall on kernel.audit_event as restrictive for select to meridian_app using (tenant_id = (select app.tenant_id()));
create policy tenant_wall on kernel.audit_block as restrictive for all to meridian_app
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));

-- ------------------------------------------------------------------ scope resolution used by restricted-class policies
-- Descendants of an org unit (including itself). Reads people.org_unit, created in the next migration.
