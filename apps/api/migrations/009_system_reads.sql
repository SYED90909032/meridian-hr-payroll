-- 009 system actor reads, and approver updates on pay runs.
-- Trusted service code paths (device ingest, approval handlers, payroll) act without a human data scope.
-- They need to read the rows they update. The permission check happens in the route before the actor is set.

-- Device ingest recomputes attendance from punches. There is no signed-in user on that path.
create policy sys_read on tm.punch as permissive for select to meridian_app using (app.system('time'));
create policy sys_read on tm.attendance_day as permissive for select to meridian_app using (app.system('time'));
create policy sys_read_leave on tm.leave_request as permissive for select to meridian_app
  using (app.system('time') or app.system('flow') or app.system('payroll'));
create policy sys_read on tm.leave_ledger as permissive for select to meridian_app using (app.system('time') or app.system('flow'));

-- The approver (pay.approve, pay.release) holds the pay class read only, so the state change to approved or payment_released
-- is made by the payroll service after its own check. The database still enforces the state machine, hash binding and L2 gate.
drop policy pay_write_u on pay.pay_run;
create policy pay_write_u on pay.pay_run as permissive for update to meridian_app
  using (app.pay_tenant_write() or app.system('payroll')) with check (app.pay_tenant_write() or app.system('payroll'));
drop policy pay_write_u on pay.pay_run_approval;
create policy pay_write_u on pay.pay_run_approval as permissive for update to meridian_app
  using (app.pay_tenant_write() or app.system('payroll')) with check (app.pay_tenant_write() or app.system('payroll'));

-- Payroll reads the employee rows it snapshots through the preparer's own scope. Nothing more is granted here.
