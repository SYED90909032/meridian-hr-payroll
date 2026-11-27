-- Phase 4 payroll inputs: reviewer-controlled notice/contractor settings, adjustment claims,
-- and explicit reversal runs. Defaults preserve the existing safe behavior.

alter table people.employee
  add column contract_notice_days integer not null default 0 check (contract_notice_days between 0 and 3660);

alter table pay.adjustment
  add column claimed_by_run_id uuid references pay.pay_run(id);
create index adjustment_claimed_run on pay.adjustment (claimed_by_run_id) where claimed_by_run_id is not null;

alter table pay.pay_run
  add column is_reversal boolean not null default false;
create unique index pay_run_one_reversal
  on pay.pay_run (reverses_run_id) where reverses_run_id is not null;

-- A claimed adjustment belongs to exactly one locked run. The existing immutable
-- adjustment trigger is extended in 022 so only this bookkeeping field can change.
