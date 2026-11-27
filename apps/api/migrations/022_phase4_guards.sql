-- Phase 4 integrity guards. Reversals are separate runs and cannot reverse a reversal.

create or replace function pay.adjustment_guard() returns trigger language plpgsql as $$
begin
  if new.employee_id <> old.employee_id or new.amount_minor <> old.amount_minor or new.kind <> old.kind or new.code <> old.code
     or new.effective_date <> old.effective_date or new.label <> old.label then
    raise exception 'an adjustment cannot be edited; void it and add a new one' using errcode = '42501';
  end if;
  if old.voided_at is not null and new.voided_at is distinct from old.voided_at then
    raise exception 'an adjustment that is void cannot change' using errcode = '42501';
  end if;
  if old.claimed_by_run_id is distinct from new.claimed_by_run_id then
    if old.claimed_by_run_id is not null and exists (
      select 1 from pay.pay_run r where r.id = old.claimed_by_run_id
        and r.status not in ('draft', 'inputs_locked', 'rejected', 'cancelled')
    ) then
      raise exception 'a locked adjustment claim cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function pay.reversal_guard() returns trigger language plpgsql as $$
declare original pay.pay_run%rowtype;
begin
  if new.is_reversal and new.reverses_run_id is null then
    raise exception 'a reversal run must link an original run' using errcode = '23514';
  end if;
  if new.reverses_run_id is not null then
    select * into original from pay.pay_run where id = new.reverses_run_id;
    if not found then raise exception 'the original pay run does not exist' using errcode = '23503'; end if;
    if original.is_reversal or original.reverses_run_id is not null then
      raise exception 'a reversal of a reversal is not allowed' using errcode = '23514';
    end if;
    if new.id = original.id then raise exception 'a pay run cannot reverse itself' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
drop trigger if exists pay_reversal_guard on pay.pay_run;
create trigger pay_reversal_guard before insert or update of reverses_run_id, is_reversal on pay.pay_run
  for each row execute function pay.reversal_guard();
