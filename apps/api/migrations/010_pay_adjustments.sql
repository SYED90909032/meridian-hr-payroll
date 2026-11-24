-- 010 payroll: input generations (so a run can be unlocked and locked again without editing immutable snapshots) and adjustments.

alter table pay.pay_run add column input_gen integer not null default 1;
alter table pay.payroll_input_snapshot add column gen integer not null default 1;
alter table pay.payroll_input_snapshot drop constraint payroll_input_snapshot_pay_run_id_employee_id_key;
alter table pay.payroll_input_snapshot add constraint payroll_input_snapshot_gen_key unique (pay_run_id, gen, employee_id);

-- One-off earnings and deductions (bonus, advance, fine) for a pay period. Voiding keeps the row.
create table pay.adjustment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  effective_date date not null,
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  label text not null check (length(label) between 1 and 80),
  kind text not null check (kind in ('earning', 'deduction')),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  voluntary boolean not null default true,
  variable boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid
);
create index adjustment_emp on pay.adjustment (tenant_id, employee_id, effective_date);
select app.rls_walled('pay.adjustment');
create policy pay_read on pay.adjustment as permissive for select to meridian_app using (app.pay_tenant_read());
create policy pay_write_i on pay.adjustment as permissive for insert to meridian_app with check (app.pay_tenant_write());
create policy pay_write_u on pay.adjustment as permissive for update to meridian_app using (app.pay_tenant_write()) with check (app.pay_tenant_write());
revoke delete on pay.adjustment from meridian_app;
-- Only void is allowed on an existing row.
create function pay.adjustment_guard() returns trigger language plpgsql as $$
begin
  if new.employee_id <> old.employee_id or new.amount_minor <> old.amount_minor or new.kind <> old.kind or new.code <> old.code
     or new.effective_date <> old.effective_date or new.label <> old.label then
    raise exception 'an adjustment cannot be edited; void it and add a new one' using errcode = '42501';
  end if;
  if old.voided_at is not null then raise exception 'an adjustment that is void cannot change' using errcode = '42501'; end if;
  return new;
end $$;
create trigger adjustment_guard before update on pay.adjustment for each row execute function pay.adjustment_guard();
