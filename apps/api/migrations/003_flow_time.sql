-- 003 flow (approvals, notifications) and time (punches, attendance, leave).

-- ------------------------------------------------------------------ flow
create table flow.approval_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  kind text not null check (kind in ('leave', 'bank_change', 'comp_change', 'pay_run', 'role_change', 'document', 'other')),
  entity text not null,
  entity_id text not null,
  title text not null check (length(title) <= 200),
  requester_user_id uuid not null,
  content_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'voided', 'cancelled')),
  -- app: any signed-in session; app_stepup: signed in with recent step-up; Tenants can tighten and never loosen.
  max_channel_assurance text not null default 'app' check (max_channel_assurance in ('app', 'app_stepup')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index approval_request_entity on flow.approval_request (tenant_id, entity, entity_id);

create table flow.approval_step (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  request_id uuid not null references flow.approval_request(id) on delete cascade,
  step_no integer not null check (step_no >= 1),
  approver_user_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'voided', 'skipped')),
  decided_by uuid,
  decided_at timestamptz,
  comment text check (comment is null or length(comment) <= 1000),
  unique (request_id, step_no)
);
create index approval_step_approver on flow.approval_step (tenant_id, approver_user_id) where status = 'pending';

-- Only the hash is stored. Single use, bound to approver, step and content hash.
create table flow.action_token (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  step_id uuid not null references flow.approval_step(id) on delete cascade,
  token_hash bytea not null unique,
  approver_user_id uuid not null,
  content_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table flow.notification (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  user_id uuid not null,
  kind text not null,
  title text not null check (length(title) <= 200),
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notification_user on flow.notification (tenant_id, user_id, created_at desc);

select app.rls_standard('flow.approval_request');
select app.rls_standard('flow.approval_step');
select app.rls_standard('flow.action_token');
-- Notifications: a user can read only their own. Anyone in the tenant may create one for another user (system events).
select app.rls_walled('flow.notification');
create policy notif_read_own on flow.notification as permissive for select to meridian_app using (user_id = (select app.user_id()));
create policy notif_update_own on flow.notification as permissive for update to meridian_app using (user_id = (select app.user_id())) with check (user_id = (select app.user_id()));
create policy notif_insert on flow.notification as permissive for insert to meridian_app with check (true);
revoke delete on flow.notification from meridian_app;

-- ------------------------------------------------------------------ time
create table tm.device (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  name text not null check (length(name) <= 100),
  kind text not null check (kind in ('biometric', 'kiosk', 'mobile', 'api')),
  key_prefix text not null unique,
  key_hash bytea not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
-- Device authentication runs before a tenant is known: the auth role may read devices by prefix.
grant select, update on tm.device to meridian_auth;
grant usage on schema tm to meridian_auth;
alter table tm.device enable row level security;
alter table tm.device force row level security;
create policy tenant_wall on tm.device as restrictive for all to meridian_app using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
create policy open on tm.device as permissive for all to meridian_app using (true) with check (true);
create policy auth_lookup on tm.device as permissive for select to meridian_auth using (true);
create policy auth_touch on tm.device as permissive for update to meridian_auth using (true) with check (true);

create table tm.punch (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  employee_id uuid not null,
  device_id uuid,
  event_time timestamptz not null,
  received_at timestamptz not null default now(),
  direction text not null check (direction in ('in', 'out')),
  source text not null check (source in ('biometric', 'kiosk', 'mobile', 'api', 'manual')),
  confidence text not null default 'normal' check (confidence in ('normal', 'low')),
  receipt_id uuid not null,
  idempotency_key text not null,
  primary key (id, event_time)
) partition by range (event_time);
create index punch_emp_time on tm.punch (tenant_id, employee_id, event_time);

create table tm.punch_dedupe (
  tenant_id uuid not null,
  device_id uuid not null,
  idempotency_key text not null,
  event_time timestamptz not null,
  punch_id uuid not null,
  receipt_id uuid not null,
  primary key (tenant_id, device_id, idempotency_key, event_time)
) partition by range (event_time);

-- Creates month partitions. Definer so the app role needs no DDL rights; partitions are not directly accessible to it.
create function tm.ensure_punch_partition(p_at timestamptz) returns void language plpgsql security definer
  set search_path = pg_catalog, tm as $$
declare
  s timestamptz := date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC';
  e timestamptz := (date_trunc('month', p_at at time zone 'UTC') + interval '1 month') at time zone 'UTC';
  sfx text := to_char(p_at at time zone 'UTC', 'YYYY_MM');
begin
  if p_at < now() - interval '5 years' or p_at > now() + interval '2 days' then
    raise exception 'punch time outside the accepted range';
  end if;
  execute format('create table if not exists tm.%I partition of tm.punch for values from (%L) to (%L)', 'punch_' || sfx, s, e);
  execute format('create table if not exists tm.%I partition of tm.punch_dedupe for values from (%L) to (%L)', 'punch_dedupe_' || sfx, s, e);
  execute format('revoke all on tm.%I from meridian_app', 'punch_' || sfx);
  execute format('revoke all on tm.%I from meridian_app', 'punch_dedupe_' || sfx);
end $$;
revoke execute on function tm.ensure_punch_partition(timestamptz) from public;
grant execute on function tm.ensure_punch_partition(timestamptz) to meridian_app;
select tm.ensure_punch_partition(now());
select tm.ensure_punch_partition(now() - interval '1 month');
select tm.ensure_punch_partition(now() - interval '2 months');

create table tm.late_punch_review (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null,
  device_id uuid,
  event_time timestamptz not null,
  direction text not null,
  idempotency_key text not null,
  receipt_id uuid not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

create table tm.shift (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  name text not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 60 check (break_minutes between 0 and 240),
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 120),
  overnight boolean not null default false
);
create table tm.shift_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  shift_id uuid not null references tm.shift(id),
  valid_during daterange not null,
  exclude using gist (tenant_id with =, employee_id with =, valid_during with &&)
);

create table tm.attendance_day (
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  work_date date not null,
  first_in timestamptz,
  last_out timestamptz,
  worked_minutes integer not null default 0,
  late_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  overtime_special_minutes integer not null default 0,
  status text not null check (status in ('present', 'absent', 'incomplete', 'leave', 'holiday', 'rest_day')),
  computed_at timestamptz not null default now(),
  primary key (tenant_id, employee_id, work_date)
);

create table tm.public_holiday (
  tenant_id uuid not null references kernel.tenant(id),
  holiday_date date not null,
  name text not null,
  primary key (tenant_id, holiday_date)
);

create table tm.leave_type (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  code text not null check (code ~ '^[A-Z_]{2,20}$'),
  name text not null,
  paid boolean not null default true,
  annual_days_x1000 integer not null default 0 check (annual_days_x1000 >= 0),
  allow_negative boolean not null default false,
  special boolean not null default false,
  unique (tenant_id, code)
);

create table tm.leave_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  leave_type_id uuid not null references tm.leave_type(id),
  delta_x1000 integer not null,
  reason text not null,
  ref_id uuid,
  effective_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index leave_ledger_emp on tm.leave_ledger (tenant_id, employee_id, leave_type_id);
create trigger leave_ledger_append_only before update or delete on tm.leave_ledger for each row execute function kernel.block_mutation();

create table tm.leave_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  leave_type_id uuid not null references tm.leave_type(id),
  start_date date not null,
  end_date date not null,
  days_x1000 integer not null check (days_x1000 > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'voided')),
  approval_request_id uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (end_date >= start_date),
  exclude using gist (tenant_id with =, employee_id with =, daterange(start_date, end_date, '[]') with &&) where (status in ('pending', 'approved'))
);

-- Reasons are class special_leave: separate table so the policy can differ from the request itself.
create table tm.leave_reason (
  request_id uuid primary key references tm.leave_request(id),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  reason_enc bytea not null
);

select app.rls_standard('tm.shift');
select app.rls_standard('tm.shift_assignment');
select app.rls_standard('tm.public_holiday');
select app.rls_standard('tm.leave_type');
select app.rls_standard('tm.late_punch_review');
select app.rls_standard('tm.leave_ledger');
revoke update, delete on tm.leave_ledger from meridian_app;

-- Time data of other people: class team. Self always allowed.
select app.rls_restricted('tm.attendance_day', 'team', 'employee_id', true);
select app.rls_restricted('tm.leave_request', 'team', 'employee_id', true);
select app.rls_restricted('tm.leave_reason', 'special_leave', 'employee_id', true);

-- Punch parents: partitions are not reachable by the app role; policies sit on the parents.
select app.rls_restricted('tm.punch', 'team', 'employee_id', true);
select app.rls_standard('tm.punch_dedupe');
revoke update, delete on tm.punch, tm.punch_dedupe from meridian_app;

-- ------------------------------------------------------------------ system actors
-- Trusted server code paths (device ingest, attendance recompute, approval decisions, payroll engine) set app.system_actor
-- inside their own transaction. The DB limits what each system actor can write.
create function app.system(p_kind text) returns boolean language sql stable
  as $$ select coalesce(current_setting('app.system_actor', true), '') = p_kind $$;
grant execute on function app.system(text) to meridian_app;

create policy system_insert on tm.punch as permissive for insert to meridian_app with check (app.system('time'));
create policy system_ins_att on tm.attendance_day as permissive for insert to meridian_app with check (app.system('time'));
create policy system_upd_att on tm.attendance_day as permissive for update to meridian_app using (app.system('time')) with check (app.system('time'));

create policy self_insert_leave on tm.leave_request as permissive for insert to meridian_app with check (app.is_self(tenant_id, employee_id));
create policy flow_update_leave on tm.leave_request as permissive for update to meridian_app using (app.system('flow')) with check (app.system('flow'));
create policy self_insert_reason on tm.leave_reason as permissive for insert to meridian_app with check (app.is_self(tenant_id, employee_id));
