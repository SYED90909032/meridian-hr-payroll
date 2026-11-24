-- 004 payroll: packs, pay groups, pay runs with a trigger-enforced state machine, immutable snapshots and results,
-- maker-checker approvals, payslips frozen at finalise, payment files.

create table pay.pack_registry (
  pack_id text not null,
  version text not null,
  pack_hash text not null,
  assurance text not null check (assurance in ('L0', 'L1', 'L2', 'L3')),
  reviewer text,
  reviewed_at timestamptz,
  notes text,
  primary key (pack_id, version)
);
-- Global reference data. Only the owner role (a human change process) may change assurance.
revoke insert, update, delete on pay.pack_registry from meridian_app;
create function pay.pack_registry_guard() returns trigger language plpgsql as $$
begin
  if new.assurance in ('L2', 'L3') and (new.reviewer is null or new.reviewed_at is null) then
    raise exception 'L2 or L3 assurance needs a named reviewer and a review date';
  end if;
  return new;
end $$;
create trigger pack_registry_guard before insert or update on pay.pack_registry for each row execute function pay.pack_registry_guard();

create table pay.pay_group (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  name text not null check (length(name) <= 100),
  country char(2) not null,
  currency char(3) not null,
  pack_id text not null,
  employer_id text,
  employer_routing text check (employer_routing is null or employer_routing ~ '^\d{9}$'),
  pay_day integer not null default 28 check (pay_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table pay.payroll_policy_exception (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  kind text not null check (kind in ('single_admin')),
  active boolean not null default true,
  second_contact_email text not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create unique index payroll_policy_exception_active on pay.payroll_policy_exception (tenant_id, kind) where active;

create table pay.pay_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_group_id uuid not null references pay.pay_group(id),
  period_start date not null,
  period_end date not null,
  run_type text not null default 'regular' check (run_type in ('regular', 'final', 'off_cycle')),
  mode text not null default 'sandbox' check (mode in ('sandbox', 'parallel', 'live')),
  scope_key text not null default 'all' check (length(scope_key) <= 64),
  status text not null default 'draft' check (status in (
    'draft', 'inputs_locked', 'calculated', 'in_review', 'approved', 'finalised', 'payment_released', 'paid', 'published',
    'cancelled', 'rejected', 'reversed')),
  pack_id text not null,
  pack_version text not null,
  pack_hash text,
  engine_hash text,
  input_set_hash text,
  result_set_hash text,
  bank_file_hash text,
  prepared_by uuid not null,
  reverses_run_id uuid references pay.pay_run(id),
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  calculated_at timestamptz,
  finalised_at timestamptz,
  version integer not null default 1,
  check (period_end >= period_start)
);
-- One active run per entity, pay group, period, type and scope. 'rejected' stays active because that run can resume.
create unique index pay_run_one_active on pay.pay_run (tenant_id, pay_group_id, period_start, period_end, run_type, scope_key)
  where status not in ('cancelled', 'reversed');

create table pay.run_transition (from_status text not null, to_status text not null, primary key (from_status, to_status));
insert into pay.run_transition values
  ('draft','inputs_locked'), ('draft','cancelled'),
  ('inputs_locked','calculated'), ('inputs_locked','draft'), ('inputs_locked','cancelled'),
  ('calculated','in_review'), ('calculated','inputs_locked'), ('calculated','cancelled'),
  ('in_review','approved'), ('in_review','rejected'), ('in_review','inputs_locked'), ('in_review','cancelled'),
  ('rejected','inputs_locked'), ('rejected','draft'), ('rejected','cancelled'),
  ('approved','finalised'), ('approved','inputs_locked'),
  ('finalised','payment_released'), ('finalised','published'), ('finalised','reversed'),
  ('payment_released','paid'), ('payment_released','reversed'),
  ('paid','published'), ('paid','reversed'),
  ('published','reversed');
revoke insert, update, delete on pay.run_transition from meridian_app;

create table pay.run_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  from_status text,
  to_status text not null,
  actor_user_id uuid,
  reason text,
  at timestamptz not null default now()
);
create trigger run_event_append_only before update or delete on pay.run_event for each row execute function kernel.block_mutation();

create table pay.payroll_input_snapshot (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  employee_id uuid not null references people.employee(id),
  input jsonb not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  unique (pay_run_id, employee_id)
);
create trigger snapshot_immutable before update or delete on pay.payroll_input_snapshot for each row execute function kernel.block_mutation();

create table pay.pay_result (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  employee_id uuid not null references people.employee(id),
  input_hash text not null,
  engine_hash text not null,
  pack_hash text not null,
  result jsonb not null,
  status text not null check (status in ('ok', 'excluded')),
  gross_minor bigint not null,
  net_minor bigint not null,
  result_hash text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (pay_run_id, employee_id, input_hash, engine_hash, pack_hash)
);
create index pay_result_current on pay.pay_result (tenant_id, pay_run_id) where is_current;

create table pay.payroll_exception (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  employee_id uuid references people.employee(id),
  code text not null,
  severity text not null check (severity in ('blocking', 'warning')),
  message text not null,
  status text not null default 'open' check (status in ('open', 'waived', 'resolved')),
  waived_by uuid,
  waived_reason text,
  created_at timestamptz not null default now(),
  check (status <> 'waived' or (waived_by is not null and length(coalesce(waived_reason, '')) >= 5))
);

create table pay.pay_run_approval (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  kind text not null check (kind in ('approve', 'release')),
  approver_id uuid not null,
  result_set_hash text not null,
  bank_file_hash text,
  step_up_at timestamptz not null,
  flagged_self_approval boolean not null default false,
  release_not_before timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create table pay.payslip (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  employee_id uuid not null references people.employee(id),
  template_version text not null,
  content jsonb not null,
  content_hash text not null,
  published_at timestamptz,
  storage_status text not null default 'pending' check (storage_status in ('pending', 'confirmed')),
  created_at timestamptz not null default now(),
  unique (pay_run_id, employee_id)
);

create table pay.payment_file (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  format text not null check (format in ('wps_sif')),
  content text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (pay_run_id, format)
);

create table pay.reconciliation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  kind text not null check (kind in ('bank_confirmation', 'return_file', 'manual')),
  evidence text not null check (length(evidence) >= 5),
  confirmed_by uuid not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ guards
create function pay.run_is_frozen(p_run uuid) returns boolean language sql stable
  set search_path = pg_catalog, pay as $$
  select exists (select 1 from pay.pay_run where id = p_run and status in ('finalised', 'payment_released', 'paid', 'published', 'reversed'))
$$;
grant execute on function pay.run_is_frozen(uuid) to meridian_app;

create function pay.result_guard() returns trigger language plpgsql as $$
declare rid uuid := coalesce(new.pay_run_id, old.pay_run_id);
begin
  if pay.run_is_frozen(rid) then
    raise exception 'results of a finalised pay run are immutable' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (new.result is distinct from old.result) or (new.result_hash <> old.result_hash) or (new.input_hash <> old.input_hash) then
      raise exception 'a stored result cannot be edited; recalculate instead' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger pay_result_guard before insert or update or delete on pay.pay_result for each row execute function pay.result_guard();

create function pay.payslip_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'payslips cannot be deleted' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and (new.content is distinct from old.content or new.content_hash <> old.content_hash or new.template_version <> old.template_version
       or new.pay_run_id <> old.pay_run_id or new.employee_id <> old.employee_id) then
    raise exception 'a payslip is frozen at finalise' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger payslip_guard before update or delete on pay.payslip for each row execute function pay.payslip_guard();

create function pay.payment_file_guard() returns trigger language plpgsql as $$
begin raise exception 'payment files are immutable' using errcode = '42501'; end $$;
create trigger payment_file_guard before update or delete on pay.payment_file for each row execute function pay.payment_file_guard();

create function pay.exception_guard() returns trigger language plpgsql as $$
begin
  if pay.run_is_frozen(new.pay_run_id) then raise exception 'exceptions of a finalised run cannot change' using errcode = '42501'; end if;
  return new;
end $$;
create trigger exception_guard before update on pay.payroll_exception for each row execute function pay.exception_guard();

-- Maker-checker guard with the single-admin exception (ADR-006).
create function pay.guard_approval() returns trigger language plpgsql as $$
declare
  r pay.pay_run%rowtype;
  exc boolean;
  is_subject boolean;
begin
  select * into r from pay.pay_run where id = new.pay_run_id and tenant_id = new.tenant_id;
  if not found then raise exception 'pay run not found'; end if;
  exc := exists (select 1 from pay.payroll_policy_exception e where e.tenant_id = new.tenant_id and e.kind = 'single_admin' and e.active);
  is_subject := exists (
    select 1 from pay.payroll_input_snapshot s
    join kernel.membership m on m.employee_id = s.employee_id and m.tenant_id = s.tenant_id
    where s.pay_run_id = new.pay_run_id and m.user_id = new.approver_id);
  if new.approver_id = r.prepared_by and not exc then
    raise exception 'approver must differ from the preparer' using errcode = '42501';
  end if;
  if is_subject and not exc then
    raise exception 'approver is a subject of this pay run' using errcode = '42501';
  end if;
  if (is_subject or new.approver_id = r.prepared_by) then
    new.flagged_self_approval := true;
    new.release_not_before := now() + interval '24 hours';
  end if;
  if new.step_up_at < now() - interval '10 minutes' then
    raise exception 'step-up authentication is too old' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger pay_run_approval_guard before insert on pay.pay_run_approval for each row execute function pay.guard_approval();

-- State machine.
create function pay.guard_run_transition() returns trigger language plpgsql as $$
declare
  assurance text;
  open_blocking integer;
  ok_approvals integer;
  late_approvals integer;
  pf_hash text;
begin
  if new.status is distinct from old.status then
    if not exists (select 1 from pay.run_transition t where t.from_status = old.status and t.to_status = new.status) then
      raise exception 'pay run cannot move from % to %', old.status, new.status using errcode = '23514';
    end if;

    if new.status in ('payment_released', 'paid') and new.mode <> 'live' then
      raise exception 'only live pay runs can release or confirm payment' using errcode = '23514';
    end if;
    if new.status = 'published' and old.status = 'finalised' and new.mode = 'live' then
      raise exception 'a live pay run is published only after payment' using errcode = '23514';
    end if;
    if new.status = 'published' and old.status = 'paid' and new.mode <> 'live' then
      raise exception 'invalid publish path' using errcode = '23514';
    end if;

    if new.status = 'inputs_locked' and old.status = 'draft' then new.locked_at := now(); end if;

    if new.status = 'approved' then
      select count(*) into ok_approvals from pay.pay_run_approval a
        where a.pay_run_id = new.id and a.kind = 'approve' and a.voided_at is null and a.result_set_hash = new.result_set_hash;
      if ok_approvals < 1 then raise exception 'approval bound to the current result set is required' using errcode = '23514'; end if;
    end if;

    if new.status = 'finalised' then
      select count(*) into open_blocking from pay.payroll_exception x
        where x.pay_run_id = new.id and x.severity = 'blocking' and x.status = 'open';
      if open_blocking > 0 then raise exception 'blocking exceptions are still open' using errcode = '23514'; end if;
      new.finalised_at := now();
    end if;

    if new.status = 'payment_released' then
      select p.assurance into assurance from pay.pack_registry p where p.pack_id = new.pack_id and p.version = new.pack_version and p.pack_hash = new.pack_hash;
      if assurance is null or assurance not in ('L2', 'L3') then
        raise exception 'live payment needs a pack at assurance L2 or L3 (found %)', coalesce(assurance, 'none') using errcode = '23514';
      end if;
      select content_hash into pf_hash from pay.payment_file where pay_run_id = new.id and format = 'wps_sif';
      if pf_hash is null or pf_hash <> new.bank_file_hash then raise exception 'bank file hash does not match' using errcode = '23514'; end if;
      select count(*) into ok_approvals from pay.pay_run_approval a
        where a.pay_run_id = new.id and a.kind = 'release' and a.voided_at is null and a.bank_file_hash = pf_hash;
      if ok_approvals < 1 then raise exception 'a release approval for this bank file is required' using errcode = '23514'; end if;
      select count(*) into late_approvals from pay.pay_run_approval a
        where a.pay_run_id = new.id and a.voided_at is null and a.release_not_before is not null and a.release_not_before > now();
      if late_approvals > 0 then raise exception 'release delay has not elapsed' using errcode = '23514'; end if;
    end if;

    -- Reopen: back to inputs_locked from review or approved voids every approval.
    if new.status in ('inputs_locked', 'draft', 'rejected', 'cancelled') and old.status in ('in_review', 'approved', 'calculated') then
      update pay.pay_run_approval set voided_at = now() where pay_run_id = new.id and voided_at is null;
      new.result_set_hash := null;
    end if;

    new.version := old.version + 1;
    insert into pay.run_event (tenant_id, pay_run_id, from_status, to_status, actor_user_id, reason)
      values (new.tenant_id, new.id, old.status, new.status, app.user_id(), nullif(current_setting('app.transition_reason', true), ''));
  else
    -- Non-status updates after finalise are blocked, except bank_file_hash for sandbox publish bookkeeping.
    if old.status in ('finalised', 'payment_released', 'paid', 'published', 'reversed')
       and (new.result_set_hash is distinct from old.result_set_hash or new.input_set_hash is distinct from old.input_set_hash
            or new.pack_hash is distinct from old.pack_hash or new.engine_hash is distinct from old.engine_hash) then
      raise exception 'finalised pay run is immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger pay_run_guard before update on pay.pay_run for each row execute function pay.guard_run_transition();
create function pay.run_insert_guard() returns trigger language plpgsql as $$
begin
  if new.status <> 'draft' then raise exception 'a pay run starts in draft' using errcode = '23514'; end if;
  insert into pay.run_event (tenant_id, pay_run_id, from_status, to_status, actor_user_id) values (new.tenant_id, new.id, null, 'draft', app.user_id());
  return new;
end $$;
create trigger pay_run_insert_guard after insert on pay.pay_run for each row execute function pay.run_insert_guard();

-- ------------------------------------------------------------------ policies
select app.rls_standard('pay.pay_group');
select app.rls_standard('pay.payroll_policy_exception');
select app.rls_standard('pay.run_event');
-- Pay runs, approvals, exceptions and files carry money. Only roles with the pay class see them.
create function app.pay_tenant_read() returns boolean language sql stable set search_path = pg_catalog, app
  as $$ select app.has_tenant_class('pay', false) $$;
create function app.pay_tenant_write() returns boolean language sql stable set search_path = pg_catalog, app
  as $$ select app.has_tenant_class('pay', true) $$;
grant execute on function app.pay_tenant_read(), app.pay_tenant_write() to meridian_app;

do $$
declare t text;
begin
  foreach t in array array['pay.pay_run', 'pay.pay_run_approval', 'pay.payroll_exception', 'pay.payment_file', 'pay.reconciliation', 'pay.payroll_input_snapshot'] loop
    perform app.rls_walled(t::regclass);
    execute format('create policy pay_read on %s as permissive for select to meridian_app using (app.pay_tenant_read())', t);
    execute format('create policy pay_write_i on %s as permissive for insert to meridian_app with check (app.pay_tenant_write() or app.system(''payroll''))', t);
    execute format('create policy pay_write_u on %s as permissive for update to meridian_app using (app.pay_tenant_write()) with check (app.pay_tenant_write() or app.system(''payroll''))', t);
    execute format('revoke delete on %s from meridian_app', t);
  end loop;
end $$;
revoke update on pay.payroll_input_snapshot from meridian_app;

-- Results and payslips: per-employee class pay / payslip with self-read.
select app.rls_restricted('pay.pay_result', 'pay', 'employee_id', false);
create policy self_result_read on pay.pay_result as permissive for select to meridian_app
  using (app.is_self(tenant_id, employee_id) and exists (select 1 from pay.payslip p where p.pay_run_id = pay_result.pay_run_id and p.employee_id = pay_result.employee_id and p.published_at is not null));
select app.rls_restricted('pay.payslip', 'payslip', 'employee_id', false);
-- An employee sees only a published payslip of their own.
create policy self_payslip_read on pay.payslip as permissive for select to meridian_app using (app.is_self(tenant_id, employee_id) and published_at is not null);

-- The payroll service sets app.system_actor = 'payroll' after its own permission check (pay.prepare, pay.approve, pay.release).
create policy sys_result_ins on pay.pay_result as permissive for insert to meridian_app with check (app.system('payroll'));
create policy sys_result_upd on pay.pay_result as permissive for update to meridian_app using (app.system('payroll')) with check (app.system('payroll'));
create policy sys_payslip_ins on pay.payslip as permissive for insert to meridian_app with check (app.system('payroll'));
create policy sys_payslip_upd on pay.payslip as permissive for update to meridian_app using (app.system('payroll')) with check (app.system('payroll'));
create policy sys_payslip_read on pay.payslip as permissive for select to meridian_app using (app.system('payroll'));
create policy sys_result_read on pay.pay_result as permissive for select to meridian_app using (app.system('payroll'));
