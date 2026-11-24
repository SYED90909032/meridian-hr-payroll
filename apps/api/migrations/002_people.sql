-- 002 people-core, scope resolution, restricted-class policies.

create table people.org_unit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  parent_id uuid references people.org_unit(id),
  code text not null check (code ~ '^[A-Za-z0-9_-]{1,32}$'),
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index org_unit_parent on people.org_unit (tenant_id, parent_id);

create table people.employee (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_no text not null check (employee_no ~ '^[A-Za-z0-9_-]{1,32}$'),
  first_name text not null check (length(first_name) between 1 and 80),
  last_name text not null check (length(last_name) between 1 and 80),
  work_email citext,
  org_unit_id uuid references people.org_unit(id),
  manager_id uuid references people.employee(id),
  job_title text,
  status text not null default 'active' check (status in ('active', 'on_leave', 'terminated')),
  employment_type text not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'contractor')),
  hire_date date not null,
  termination_date date,
  is_uae_national boolean not null default false,
  nationality text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_no),
  check (termination_date is null or termination_date >= hire_date),
  check (manager_id is null or manager_id <> id)
);
create index employee_org on people.employee (tenant_id, org_unit_id);
create index employee_manager on people.employee (tenant_id, manager_id);
alter table kernel.membership add constraint membership_employee_fk foreign key (employee_id) references people.employee(id);

-- Sensitive identity data: class national_id.
create table people.employee_private (
  employee_id uuid primary key references people.employee(id),
  tenant_id uuid not null references kernel.tenant(id),
  national_id_enc bytea,
  national_id_bidx bytea,
  wps_uid_enc bytea,
  dob date,
  phone text,
  address text,
  updated_at timestamptz not null default now()
);
create unique index employee_private_nid on people.employee_private (tenant_id, national_id_bidx) where national_id_bidx is not null;

-- Bank details: class bank. Active row has superseded_at null.
create table people.employee_bank (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  bank_name text not null,
  routing_code text not null check (routing_code ~ '^\d{9}$'),
  iban_enc bytea not null,
  iban_bidx bytea not null,
  iban_last4 text not null,
  changed_by uuid,
  step_up_verified boolean not null default false,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);
create unique index employee_bank_active on people.employee_bank (tenant_id, employee_id) where superseded_at is null;
create index employee_bank_bidx on people.employee_bank (tenant_id, iban_bidx) where superseded_at is null;

-- Compensation: class comp. Bitemporal: valid_during is business time, recorded/superseded is system time.
-- A correction supersedes the old row. History is never overwritten.
create table people.compensation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  valid_during daterange not null,
  basic_minor bigint not null check (basic_minor >= 0),
  housing_minor bigint not null default 0 check (housing_minor >= 0),
  transport_minor bigint not null default 0 check (transport_minor >= 0),
  other_minor bigint not null default 0 check (other_minor >= 0),
  currency char(3) not null,
  reason text,
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  superseded_at timestamptz,
  check (not isempty(valid_during)),
  exclude using gist (tenant_id with =, employee_id with =, valid_during with &&) where (superseded_at is null)
);
create index compensation_emp on people.compensation (tenant_id, employee_id);

create table people.document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  kind text not null check (kind in ('contract', 'id_copy', 'certificate', 'letter', 'other')),
  name text not null check (length(name) between 1 and 200),
  mime text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  sha256 text not null,
  content_enc bytea not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index document_emp on people.document (tenant_id, employee_id);

-- Employee history for lifecycle events (hire, transfer, terminate). Append-only.
create table people.employee_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  employee_id uuid not null references people.employee(id),
  kind text not null,
  effective_date date not null,
  detail jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create trigger employee_event_append_only before update or delete on people.employee_event for each row execute function kernel.block_mutation();

-- ------------------------------------------------------------------ org tree: cycle guard and descendants
create function people.org_no_cycle() returns trigger language plpgsql as $$
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'org unit cannot be its own parent'; end if;
  if exists (
    with recursive up as (
      select id, parent_id from people.org_unit where id = new.parent_id
      union all
      select o.id, o.parent_id from people.org_unit o join up on o.id = up.parent_id
    ) select 1 from up where id = new.id) then
    raise exception 'org unit cycle detected';
  end if;
  return new;
end $$;
create trigger org_unit_no_cycle before insert or update of parent_id on people.org_unit for each row execute function people.org_no_cycle();

create function people.manager_no_cycle() returns trigger language plpgsql as $$
begin
  if new.manager_id is null then return new; end if;
  if exists (
    with recursive up as (
      select id, manager_id from people.employee where id = new.manager_id
      union all
      select e.id, e.manager_id from people.employee e join up on e.id = up.manager_id
    ) select 1 from up where id = new.id) then
    raise exception 'management cycle detected';
  end if;
  return new;
end $$;
create trigger employee_manager_no_cycle before insert or update of manager_id on people.employee for each row execute function people.manager_no_cycle();

create function people.touch_employee() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;
create trigger employee_touch before update on people.employee for each row execute function people.touch_employee();

create function app.org_descendants(p_tenant uuid, p_root uuid) returns setof uuid language sql stable
  set search_path = pg_catalog, people as $$
  with recursive d as (
    select id from people.org_unit where tenant_id = p_tenant and id = p_root
    union all
    select o.id from people.org_unit o join d on o.parent_id = d.id where o.tenant_id = p_tenant
  ) select id from d
$$;

create function app.reports_of(p_tenant uuid, p_manager uuid) returns setof uuid language sql stable
  set search_path = pg_catalog, people as $$
  with recursive d as (
    select id from people.employee where tenant_id = p_tenant and manager_id = p_manager
    union all
    select e.id from people.employee e join d on e.manager_id = d.id where e.tenant_id = p_tenant
  ) select id from d
$$;

-- ------------------------------------------------------------------ scope checks (SECURITY INVOKER, so the lookup tables' own RLS applies)
create function app.can_access(p_tenant uuid, p_employee uuid, p_class text, p_write boolean) returns boolean
  language sql stable set search_path = pg_catalog, kernel, people, app as $$
  select exists (
    select 1
    from kernel.role_assignment ra
    join kernel.role_field_grant g on g.role = ra.role and g.class = p_class and (case when p_write then g.can_write else g.can_read end)
    join kernel.role_assignment_scope s on s.assignment_id = ra.id and s.tenant_id = ra.tenant_id
    where ra.tenant_id = p_tenant
      and ra.user_id = app.user_id()
      and ra.revoked_at is null
      and (
        s.scope_type = 'tenant'
        or (p_employee is not null and s.scope_type = 'employee' and s.employee_id = p_employee)
        or (p_employee is not null and s.scope_type = 'reports' and p_employee in (select app.reports_of(p_tenant, app.employee_id())))
        or (p_employee is not null and s.scope_type = 'org_unit' and exists (
              select 1 from people.employee e
              where e.id = p_employee and e.tenant_id = p_tenant
                and (e.org_unit_id = s.org_unit_id
                     or (s.include_descendants and e.org_unit_id in (select app.org_descendants(p_tenant, s.org_unit_id))))))
      )
  )
$$;
create function app.can_see(p_tenant uuid, p_employee uuid, p_class text) returns boolean language sql stable
  set search_path = pg_catalog, app as $$ select app.can_access(p_tenant, p_employee, p_class, false) $$;
create function app.can_write(p_tenant uuid, p_employee uuid, p_class text) returns boolean language sql stable
  set search_path = pg_catalog, app as $$ select app.can_access(p_tenant, p_employee, p_class, true) $$;
create function app.is_self(p_tenant uuid, p_employee uuid) returns boolean language sql stable
  set search_path = pg_catalog, app as $$ select p_employee is not null and p_employee = app.employee_id() and p_tenant = app.tenant_id() $$;
-- Tenant-wide class check (no employee), for tables such as audit.
create function app.has_tenant_class(p_class text, p_write boolean) returns boolean language sql stable
  set search_path = pg_catalog, app as $$ select app.can_access(app.tenant_id(), null, p_class, p_write) $$;

grant execute on function app.org_descendants(uuid, uuid), app.reports_of(uuid, uuid), app.can_access(uuid, uuid, text, boolean),
  app.can_see(uuid, uuid, text), app.can_write(uuid, uuid, text), app.is_self(uuid, uuid), app.has_tenant_class(text, boolean) to meridian_app;

-- ------------------------------------------------------------------ policies
select app.rls_standard('people.org_unit');
select app.rls_standard('people.employee');
-- Employees are a directory: everyone in the tenant sees names and titles. Writes are checked in the API; the wall holds in the DB.

-- Restricted classes: tenant wall + scope-read + self-read + scoped write. No delete policy: no deletes.
create function app.rls_restricted(tbl regclass, p_class text, p_employee_col text, p_self_read boolean, p_allow_delete boolean default false)
returns void language plpgsql as $$
begin
  perform app.rls_walled(tbl);
  execute format('create policy scope_read on %s as permissive for select to meridian_app using (app.can_see(tenant_id, %I, %L))', tbl, p_employee_col, p_class);
  if p_self_read then
    execute format('create policy self_read on %s as permissive for select to meridian_app using (app.is_self(tenant_id, %I))', tbl, p_employee_col);
  end if;
  execute format('create policy scope_insert on %s as permissive for insert to meridian_app with check (app.can_write(tenant_id, %I, %L))', tbl, p_employee_col, p_class);
  execute format('create policy scope_update on %s as permissive for update to meridian_app using (app.can_write(tenant_id, %I, %L)) with check (app.can_write(tenant_id, %I, %L))', tbl, p_employee_col, p_class, p_employee_col, p_class);
  if p_allow_delete then
    execute format('create policy scope_delete on %s as permissive for delete to meridian_app using (app.can_write(tenant_id, %I, %L))', tbl, p_employee_col, p_class);
  else
    execute format('revoke delete on %s from meridian_app', tbl);
  end if;
end $$;

select app.rls_restricted('people.employee_private', 'national_id', 'employee_id', true);
select app.rls_restricted('people.employee_bank', 'bank', 'employee_id', true);
select app.rls_restricted('people.compensation', 'comp', 'employee_id', true);
select app.rls_restricted('people.document', 'document', 'employee_id', true);
select app.rls_standard('people.employee_event');

-- Audit reads: only roles with the audit class.
create policy audit_read on kernel.audit_event as permissive for select to meridian_app using (app.has_tenant_class('audit', false));
create policy audit_block_rw on kernel.audit_block as permissive for all to meridian_app
  using (app.has_tenant_class('audit', false)) with check (app.has_tenant_class('audit', false));
