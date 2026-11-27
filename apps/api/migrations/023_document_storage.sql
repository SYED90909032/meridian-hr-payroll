-- Phase 5: encrypted object storage and virus-scan lifecycle.
-- Existing content_enc/content JSONB remain the migration source of truth until a verified object exists.
alter table people.document add column object_key text;
alter table people.document add column status text not null default 'available' check (status in ('pending_scan', 'available', 'quarantined', 'scan_failed'));
alter table people.document add column scan_signature text;
alter table people.document add column scan_error text;
alter table people.document add column scan_attempts integer not null default 0 check (scan_attempts >= 0);
alter table people.document add column scanned_at timestamptz;
alter table people.document alter column content_enc drop not null;
create unique index document_object_key on people.document (object_key) where object_key is not null;
create index document_scan_queue on people.document (tenant_id, status, scan_attempts) where status in ('pending_scan', 'scan_failed');

-- The existing restricted policy intentionally had no delete policy. Phase 5 permits only a scoped
-- docs.write actor to delete a quarantine/object row; object deletion is performed first by the API.
grant delete on people.document to meridian_app;
create policy scope_delete on people.document as permissive for delete to meridian_app
  using (app.can_write(tenant_id, employee_id, 'document'));

-- The resumable migration CLI runs as meridian_owner, which is non-superuser and is
-- therefore still subject to FORCE RLS. Keep its maintenance window explicit and
-- limited to the rows/keys needed to move legacy ciphertext to object storage.
create policy owner_document_migration_read on people.document as permissive for select to meridian_owner
  using (true);
create policy owner_document_migration_update on people.document as permissive for update to meridian_owner
  using (true) with check (true);
create policy owner_subject_key_migration_read on kernel.subject_key as permissive for select to meridian_owner
  using (true);

alter table pay.payslip add column object_key text;
create unique index payslip_object_key on pay.payslip (object_key) where object_key is not null;
create index payslip_object_lookup on pay.payslip (tenant_id, employee_id, object_key) where object_key is not null;
-- The existing payslip_guard remains authoritative: only the new storage reference is mutable;
-- content, content_hash, employee and run identity remain frozen at finalise.

grant select on pay.payslip to meridian_app;
