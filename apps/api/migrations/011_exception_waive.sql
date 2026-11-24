-- 011: an approver holds only pay read, but must be able to accept a payroll exception with a reason (route: waive, actor 'payroll').
-- The exception_guard trigger limits what an update may change (status, waiver fields); this only lets the row be reached.
drop policy pay_write_u on pay.payroll_exception;
create policy pay_write_u on pay.payroll_exception as permissive for update to meridian_app
  using (app.pay_tenant_write() or app.system('payroll'))
  with check (app.pay_tenant_write() or app.system('payroll'));
