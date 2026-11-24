-- The self-update policy on svc.ticket referenced svc.ticket in its own check, which Postgres rejects as infinite recursion.
-- Replace it with a plain self policy and a trigger that stops a requester from changing the assignee or confidentiality.
drop policy ticket_self_update on svc.ticket;
create policy ticket_self_update on svc.ticket as permissive for update to meridian_app
  using (app.is_self(tenant_id, requester_employee_id)) with check (app.is_self(tenant_id, requester_employee_id));

create or replace function svc.guard_ticket_update() returns trigger language plpgsql as $$
begin
  if new.requester_employee_id is distinct from old.requester_employee_id or new.tenant_id is distinct from old.tenant_id then
    raise exception 'ticket owner cannot change' using errcode = '42501';
  end if;
  if (new.assignee_user_id is distinct from old.assignee_user_id or new.confidential is distinct from old.confidential)
     and not ((not old.confidential and app.can_write(old.tenant_id, old.requester_employee_id, 'helpdesk'))
              or (old.confidential and app.can_write(old.tenant_id, old.requester_employee_id, 'helpdesk_conf'))) then
    raise exception 'only helpdesk staff can reassign a ticket or change its confidentiality' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger ticket_guard before update on svc.ticket for each row execute function svc.guard_ticket_update();
