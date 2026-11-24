-- 008 time and leave: restrict the leave ledger to the team class, dedupe lookup index, one entitlement per year.

-- The ledger is personal. Self and the team class may read it; writes come from the flow and time services only.
drop policy open on tm.leave_ledger;
create policy scope_read on tm.leave_ledger as permissive for select to meridian_app using (app.can_see(tenant_id, employee_id, 'team'));
create policy self_read on tm.leave_ledger as permissive for select to meridian_app using (app.is_self(tenant_id, employee_id));
create policy sys_insert on tm.leave_ledger as permissive for insert to meridian_app with check (app.system('flow') or app.system('time'));

-- Late punch reviews and shifts belong to people with the team class.
drop policy open on tm.late_punch_review;
create policy read_team on tm.late_punch_review as permissive for select to meridian_app using (app.can_see(tenant_id, employee_id, 'team'));
create policy sys_insert on tm.late_punch_review as permissive for insert to meridian_app with check (app.system('time'));
create policy sys_update on tm.late_punch_review as permissive for update to meridian_app using (app.system('time')) with check (app.system('time'));

create index punch_dedupe_lookup on tm.punch_dedupe (tenant_id, device_id, idempotency_key);

-- One yearly entitlement credit per employee and leave type.
create unique index leave_ledger_entitlement on tm.leave_ledger (tenant_id, employee_id, leave_type_id, reason) where reason like 'entitlement:%';
create index leave_request_emp on tm.leave_request (tenant_id, employee_id, start_date);

-- Shift assignments follow the team class.
drop policy open on tm.shift_assignment;
create policy read_team on tm.shift_assignment as permissive for select to meridian_app using (app.can_see(tenant_id, employee_id, 'team') or app.is_self(tenant_id, employee_id));
create policy sys_write on tm.shift_assignment as permissive for all to meridian_app using (app.system('time')) with check (app.system('time'));

-- Tenant settings (time zone, weekend days) are a JSON column on kernel.tenant, edited by the IAM service.

-- ------------------------------------------------------------------ flow: who can see an approval
-- Denormalised columns keep the two policies from referring to each other (which PostgreSQL rejects as infinite recursion).
alter table flow.approval_request add column approver_ids uuid[] not null default '{}';
alter table flow.approval_step add column requester_user_id uuid;
alter table flow.approval_step add column subject_employee_id uuid;
alter table flow.approval_request add column subject_employee_id uuid;

drop policy open on flow.approval_request;
create policy read_involved on flow.approval_request as permissive for select to meridian_app
  using (requester_user_id = (select app.user_id()) or (select app.user_id()) = any (approver_ids) or app.system('flow') or app.has_tenant_class('audit', false));
create policy insert_own on flow.approval_request as permissive for insert to meridian_app
  with check (requester_user_id = (select app.user_id()) or app.system('flow'));
create policy update_system on flow.approval_request as permissive for update to meridian_app using (app.system('flow')) with check (app.system('flow'));

drop policy open on flow.approval_step;
create policy read_involved on flow.approval_step as permissive for select to meridian_app
  using (approver_user_id = (select app.user_id()) or requester_user_id = (select app.user_id()) or app.system('flow') or app.has_tenant_class('audit', false));
create policy insert_own on flow.approval_step as permissive for insert to meridian_app
  with check (requester_user_id = (select app.user_id()) or app.system('flow'));
create policy decide_own on flow.approval_step as permissive for update to meridian_app
  using (approver_user_id = (select app.user_id()) or app.system('flow')) with check (approver_user_id = (select app.user_id()) or app.system('flow'));
revoke delete on flow.approval_request, flow.approval_step from meridian_app;

-- Action tokens are written and consumed by the flow service only.
drop policy open on flow.action_token;
create policy sys_all on flow.action_token as permissive for all to meridian_app using (app.system('flow')) with check (app.system('flow'));
revoke delete on flow.action_token from meridian_app;
