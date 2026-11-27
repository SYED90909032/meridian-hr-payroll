-- API checks are useful UX, but the database must enforce the hold for owner-level tooling and accidental bypasses too.
create or replace function kernel.block_subject_shred_under_hold() returns trigger
language plpgsql security invoker set search_path = pg_catalog, kernel as $$
begin
  if old.wrapped_key is not null and new.wrapped_key is null and exists (
    select 1 from kernel.legal_hold h
     where h.tenant_id = old.tenant_id and h.subject_id = old.subject_id and h.released_at is null
  ) then
    raise exception 'A legal hold prevents erasure' using errcode = 'P0001';
  end if;
  return new;
end $$;
-- The trigger may run as the migration owner during incident tooling. A narrow owner-only read policy keeps
-- legal_hold forced-RLS while ensuring owner-level shredding cannot hide an active hold from the trigger.
create policy legal_hold_owner_rw on kernel.legal_hold as permissive for all to meridian_owner using (true) with check (true);
create policy subject_key_owner_rw on kernel.subject_key as permissive for all to meridian_owner using (true) with check (true);
alter table kernel.audit_event force row level security;
alter table kernel.audit_block force row level security;
alter table kernel.audit_head force row level security;
create policy audit_event_owner_rw on kernel.audit_event as permissive for all to meridian_owner using (true) with check (true);
create policy audit_block_owner_rw on kernel.audit_block as permissive for all to meridian_owner using (true) with check (true);
create policy audit_head_owner_rw on kernel.audit_head as permissive for all to meridian_owner using (true) with check (true);
alter table kernel.session enable row level security;
alter table kernel.session force row level security;
create policy session_auth_rw on kernel.session as permissive for all to meridian_auth using (true) with check (true);
create policy session_owner_rw on kernel.session as permissive for all to meridian_owner using (true) with check (true);
create trigger subject_key_legal_hold
  before update of wrapped_key on kernel.subject_key
  for each row execute function kernel.block_subject_shred_under_hold();
