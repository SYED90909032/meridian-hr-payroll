-- 006 hardening: role and scope writes need the 'iam' system actor, which only the IAM service sets after its own permission check.
-- This narrows what a stray statement under the app role can do. It is defence in depth, not a replacement for the API check.

drop policy open on kernel.role_assignment;
create policy read_all on kernel.role_assignment as permissive for select to meridian_app using (true);
create policy iam_insert on kernel.role_assignment as permissive for insert to meridian_app with check (app.system('iam'));
create policy iam_update on kernel.role_assignment as permissive for update to meridian_app using (app.system('iam')) with check (app.system('iam'));
revoke delete on kernel.role_assignment from meridian_app;

drop policy open on kernel.role_assignment_scope;
create policy read_all on kernel.role_assignment_scope as permissive for select to meridian_app using (true);
create policy iam_insert on kernel.role_assignment_scope as permissive for insert to meridian_app with check (app.system('iam'));
create policy iam_delete on kernel.role_assignment_scope as permissive for delete to meridian_app using (app.system('iam'));
revoke update on kernel.role_assignment_scope from meridian_app;

drop policy open on kernel.membership;
create policy read_all on kernel.membership as permissive for select to meridian_app using (true);
create policy iam_insert on kernel.membership as permissive for insert to meridian_app with check (app.system('iam'));
create policy iam_update on kernel.membership as permissive for update to meridian_app using (app.system('iam')) with check (app.system('iam'));
revoke delete on kernel.membership from meridian_app;

-- Employees: writes need the 'hr' system actor (set by the people service after the permission check).
drop policy open on people.employee;
create policy read_all on people.employee as permissive for select to meridian_app using (true);
create policy hr_insert on people.employee as permissive for insert to meridian_app with check (app.system('hr'));
create policy hr_update on people.employee as permissive for update to meridian_app using (app.system('hr')) with check (app.system('hr'));
revoke delete on people.employee from meridian_app;

-- The tenant row can be created only by the registration flow.
drop policy tenant_self on kernel.tenant;
create policy tenant_read on kernel.tenant as permissive for select to meridian_app using (id = (select app.tenant_id()));
create policy tenant_insert on kernel.tenant as permissive for insert to meridian_app with check (id = (select app.tenant_id()) and app.system('register'));
create policy tenant_update on kernel.tenant as permissive for update to meridian_app using (id = (select app.tenant_id()) and app.system('iam'))
  with check (id = (select app.tenant_id()));
revoke delete on kernel.tenant from meridian_app;

-- A transaction may hold several system actors, comma separated (for example 'register,iam,hr' during tenant registration).
create or replace function app.system(p_kind text) returns boolean language sql stable
  as $$ select p_kind = any (string_to_array(coalesce(current_setting('app.system_actor', true), ''), ',')) $$;

-- The outbox claim functions are SECURITY DEFINER and run as the owner. Under FORCE RLS the owner needs its own policy.
-- Tenant isolation still holds for the app role; the worker role reaches rows only through the two functions.
create policy owner_functions on kernel.outbox as permissive for all to meridian_owner using (true) with check (true);
