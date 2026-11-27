-- 016 Phase 2 parallel-run evidence and bank hand-off records.
create table pay.parallel_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  period_start date not null,
  period_end date not null,
  external_file_hash text not null check (external_file_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'needs_review' check (status in ('needs_review', 'zero_variance')),
  zero_unexplained boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (pay_run_id, external_file_hash)
);
create table pay.parallel_run_employee (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  parallel_run_id uuid not null references pay.parallel_run(id),
  employee_id uuid not null references people.employee(id),
  employee_no text not null,
  external_gross_minor bigint not null,
  external_deductions_minor bigint not null,
  external_net_minor bigint not null,
  meridian_gross_minor bigint not null,
  meridian_deductions_minor bigint not null,
  meridian_net_minor bigint not null,
  gross_variance_minor bigint not null,
  deductions_variance_minor bigint not null,
  net_variance_minor bigint not null,
  line_differences jsonb not null default '[]'::jsonb,
  explanation text,
  explained_by uuid,
  explained_at timestamptz,
  status text not null check (status in ('unexplained', 'matched', 'explained')),
  created_at timestamptz not null default now(),
  unique (parallel_run_id, employee_id),
  check ((status = 'explained') = (explanation is not null and explained_by is not null and explained_at is not null)),
  check (status <> 'matched' or (gross_variance_minor = 0 and deductions_variance_minor = 0 and net_variance_minor = 0)),
  check (status <> 'explained' or length(trim(explanation)) >= 5)
);
create index parallel_run_employee_status on pay.parallel_run_employee (parallel_run_id, status);

create table pay.bank_submission (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  transport text not null check (transport in ('sftp', 'manual')),
  file_hash text not null check (file_hash ~ '^[a-f0-9]{64}$'),
  receipt text,
  status text not null default 'submitted' check (status in ('submitted', 'acknowledged', 'rejected')),
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (pay_run_id, file_hash)
);
create table pay.bank_acknowledgement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  pay_run_id uuid not null references pay.pay_run(id),
  bank_submission_id uuid not null references pay.bank_submission(id),
  employee_id uuid references people.employee(id),
  instruction_ref text not null,
  status text not null check (status in ('accepted', 'rejected')),
  reason text,
  received_at timestamptz not null default now()
);

select app.rls_walled('pay.parallel_run');
create policy parallel_owner_evidence_read on pay.parallel_run for select to meridian_owner using (true);
create policy parallel_read on pay.parallel_run as permissive for select to meridian_app using (app.pay_tenant_read());
create policy parallel_insert on pay.parallel_run as permissive for insert to meridian_app with check (app.pay_tenant_write() or app.system('payroll'));
create policy parallel_update on pay.parallel_run as permissive for update to meridian_app using (app.pay_tenant_write()) with check (app.pay_tenant_write() or app.system('payroll'));
revoke delete on pay.parallel_run from meridian_app;
select app.rls_walled('pay.parallel_run_employee');
create policy parallel_employee_read on pay.parallel_run_employee as permissive for select to meridian_app using (app.pay_tenant_read());
create policy parallel_employee_insert on pay.parallel_run_employee as permissive for insert to meridian_app with check (app.pay_tenant_write() or app.system('payroll'));
create policy parallel_employee_update on pay.parallel_run_employee as permissive for update to meridian_app using (app.pay_tenant_write()) with check (app.pay_tenant_write() or app.system('payroll'));
revoke delete on pay.parallel_run_employee from meridian_app;
create policy pay_run_owner_evidence_read on pay.pay_run for select to meridian_owner using (true);
select app.rls_walled('pay.bank_submission');
create policy bank_submission_read on pay.bank_submission as permissive for select to meridian_app using (app.pay_tenant_read());
create policy bank_submission_insert on pay.bank_submission as permissive for insert to meridian_app with check (app.pay_tenant_write() or app.system('payroll'));
create policy bank_submission_update on pay.bank_submission as permissive for update to meridian_app using (app.pay_tenant_write()) with check (app.pay_tenant_write() or app.system('payroll'));
revoke delete on pay.bank_submission from meridian_app;
select app.rls_walled('pay.bank_acknowledgement');
create policy bank_ack_read on pay.bank_acknowledgement as permissive for select to meridian_app using (app.pay_tenant_read());
create policy bank_ack_insert on pay.bank_acknowledgement as permissive for insert to meridian_app with check (app.pay_tenant_write() or app.system('payroll'));
revoke update, delete on pay.bank_acknowledgement from meridian_app;

-- Qualifying runs are immutable evidence: the period and pack must match, and every employee must be matched or explained.
create or replace function pay.pack_evidence_complete(p pay.pack_signoff) returns boolean language plpgsql stable as $$
declare
  n integer;
begin
  if length(trim(coalesce(p.golden_vector_set_hash, ''))) = 0 or length(trim(coalesce(p.bank_wps_acceptance_reference, ''))) = 0 or cardinality(p.parallel_run_ids) < 2 then return false; end if;
  select count(distinct r.id) into n
    from unnest(p.parallel_run_ids) as ids(id)
    join pay.parallel_run r on r.id = ids.id
    join pay.pay_run pr on pr.id = r.pay_run_id
   where r.status = 'zero_variance' and r.zero_unexplained and r.completed_at is not null
     and pr.pack_id = p.pack_id and pr.pack_version = p.version and pr.pack_hash = p.pack_hash;
  return n >= 2;
end $$;
revoke all on function pay.pack_evidence_complete(pay.pack_signoff) from public, meridian_app;

create or replace function pay.pack_registry_guard() returns trigger language plpgsql as $$
declare
  s pay.pack_signoff%rowtype;
begin
  if new.assurance in ('L2', 'L3') then
    if new.reviewer is null or new.reviewed_at is null then
      raise exception 'L2 or L3 assurance needs a named reviewer and a review date';
    end if;
    select * into s from pay.pack_signoff where pack_id = new.pack_id and version = new.version and pack_hash = new.pack_hash;
    if not found then raise exception 'assurance promotion blocked: matching sign-off is missing'; end if;
    if not pay.pack_evidence_complete(s) then
      raise exception 'assurance promotion blocked: golden vectors, bank acceptance, and two zero-variance parallel runs are required';
    end if;
  end if;
  return new;
end $$;
