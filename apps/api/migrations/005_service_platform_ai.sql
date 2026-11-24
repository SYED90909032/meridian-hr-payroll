-- 005 service (helpdesk, announcements, knowledge), platform (API keys, webhooks), AI (pseudonyms, conversations).

-- ------------------------------------------------------------------ svc
create table svc.announcement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) <= 10000),
  author_user_id uuid not null,
  published_at timestamptz not null default now()
);

create table svc.ticket (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  requester_employee_id uuid not null references people.employee(id),
  category text not null check (category in ('payroll', 'leave', 'benefits', 'it', 'policy', 'grievance', 'other')),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) <= 10000),
  confidential boolean not null default false,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  assignee_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ticket_requester on svc.ticket (tenant_id, requester_employee_id);

create table svc.ticket_comment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  ticket_id uuid not null references svc.ticket(id),
  author_user_id uuid not null,
  body text not null check (length(body) between 1 and 5000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table svc.kb_article (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) <= 20000),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

select app.rls_standard('svc.announcement');
select app.rls_standard('svc.kb_article');

-- Tickets: ordinary tickets are visible to the helpdesk class; confidential ones only to the requester and the helpdesk_conf class.
select app.rls_walled('svc.ticket');
create policy ticket_self on svc.ticket as permissive for select to meridian_app using (app.is_self(tenant_id, requester_employee_id));
create policy ticket_staff_read on svc.ticket as permissive for select to meridian_app
  using ((not confidential and app.can_see(tenant_id, requester_employee_id, 'helpdesk')) or (confidential and app.can_see(tenant_id, requester_employee_id, 'helpdesk_conf')));
create policy ticket_insert_self on svc.ticket as permissive for insert to meridian_app
  with check (app.is_self(tenant_id, requester_employee_id) or app.can_write(tenant_id, requester_employee_id, 'helpdesk'));
create policy ticket_staff_update on svc.ticket as permissive for update to meridian_app
  using ((not confidential and app.can_write(tenant_id, requester_employee_id, 'helpdesk')) or (confidential and app.can_write(tenant_id, requester_employee_id, 'helpdesk_conf')))
  with check ((not confidential and app.can_write(tenant_id, requester_employee_id, 'helpdesk')) or (confidential and app.can_write(tenant_id, requester_employee_id, 'helpdesk_conf')));
create policy ticket_self_update on svc.ticket as permissive for update to meridian_app
  using (app.is_self(tenant_id, requester_employee_id)) with check (app.is_self(tenant_id, requester_employee_id) and assignee_user_id is not distinct from (select t.assignee_user_id from svc.ticket t where t.id = ticket.id));
revoke delete on svc.ticket from meridian_app;

-- Comments follow the ticket: visible if and only if the ticket is visible to the caller (the sub-select is itself row-filtered).
select app.rls_walled('svc.ticket_comment');
create policy comment_read on svc.ticket_comment as permissive for select to meridian_app
  using (exists (select 1 from svc.ticket t where t.id = ticket_comment.ticket_id)
         and (not internal or exists (select 1 from svc.ticket t where t.id = ticket_comment.ticket_id and not app.is_self(t.tenant_id, t.requester_employee_id))));
create policy comment_insert on svc.ticket_comment as permissive for insert to meridian_app
  with check (author_user_id = (select app.user_id()) and exists (select 1 from svc.ticket t where t.id = ticket_comment.ticket_id));
revoke update, delete on svc.ticket_comment from meridian_app;

-- ------------------------------------------------------------------ plat
create table plat.api_key (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  name text not null check (length(name) between 1 and 100),
  prefix text not null unique,
  key_hash bytea not null,
  scopes text[] not null check (cardinality(scopes) between 1 and 20),
  created_by uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table plat.api_key enable row level security;
alter table plat.api_key force row level security;
create policy tenant_wall on plat.api_key as restrictive for all to meridian_app using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));
create policy open on plat.api_key as permissive for all to meridian_app using (true) with check (true);
create policy auth_lookup on plat.api_key as permissive for select to meridian_auth using (true);
create policy auth_touch on plat.api_key as permissive for update to meridian_auth using (true) with check (true);
grant usage on schema plat to meridian_auth;
grant select, update on plat.api_key to meridian_auth;

create table plat.webhook_endpoint (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  url text not null check (url ~ '^https://' and length(url) <= 500),
  secret_enc bytea not null,
  events text[] not null check (cardinality(events) >= 1),
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table plat.webhook_delivery (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  endpoint_id uuid not null references plat.webhook_endpoint(id),
  outbox_id bigint not null,
  event text not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  response_code integer,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (endpoint_id, outbox_id)
);
select app.rls_standard('plat.webhook_endpoint');
select app.rls_standard('plat.webhook_delivery');

-- ------------------------------------------------------------------ ai
create table ai.conversation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create table ai.pseudonym (
  tenant_id uuid not null references kernel.tenant(id),
  conversation_id uuid not null references ai.conversation(id),
  token text not null check (token ~ '^P-[A-Z2-7]{8}$'),
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id, token),
  unique (tenant_id, conversation_id, subject_id)
);
create table ai.message (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  conversation_id uuid not null references ai.conversation(id),
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null check (length(content) <= 20000),
  created_at timestamptz not null default now()
);
-- A conversation belongs to its user. Nobody else in the tenant reads it, including admins.
select app.rls_walled('ai.conversation');
create policy conv_own on ai.conversation as permissive for all to meridian_app using (user_id = (select app.user_id())) with check (user_id = (select app.user_id()));
select app.rls_walled('ai.pseudonym');
create policy pseudo_own on ai.pseudonym as permissive for all to meridian_app
  using (exists (select 1 from ai.conversation c where c.id = conversation_id)) with check (exists (select 1 from ai.conversation c where c.id = conversation_id));
select app.rls_walled('ai.message');
create policy msg_own on ai.message as permissive for all to meridian_app
  using (exists (select 1 from ai.conversation c where c.id = conversation_id)) with check (exists (select 1 from ai.conversation c where c.id = conversation_id));
revoke update, delete on ai.message from meridian_app;

-- ------------------------------------------------------------------ final hardening
revoke all on kernel.migration from meridian_app;
revoke all on kernel.audit_head from meridian_app;
