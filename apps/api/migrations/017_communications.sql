-- 017 communications: account lifecycle tokens, notification preferences and delivery state.
-- Account tokens are identity data, not tenant data: only the auth role can access them,
-- and only a SHA-256 digest is persisted.
create schema if not exists comms;
grant usage on schema comms to meridian_app;

create table comms.suppression (
  tenant_id uuid not null references kernel.tenant(id),
  email_hash text not null check (email_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check (reason in ('bounce', 'complaint', 'manual')),
  created_by uuid,
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  primary key (tenant_id, email_hash)
);
select app.rls_standard('comms.suppression');
revoke delete on comms.suppression from meridian_app;
grant select, insert, update on comms.suppression to meridian_app;

create table comms.notification_preference (
  tenant_id uuid not null references kernel.tenant(id),
  user_id uuid not null references kernel.user_account(id),
  kind text not null,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, kind)
);
select app.rls_standard('comms.notification_preference');
grant select, insert, update on comms.notification_preference to meridian_app;

alter table kernel.membership drop constraint membership_status_check;
alter table kernel.membership add constraint membership_status_check check (status in ('active', 'suspended', 'invited'));

create table kernel.account_token (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references kernel.tenant(id),
  user_id uuid not null references kernel.user_account(id) on delete cascade,
  purpose text not null check (purpose in ('invitation', 'password_reset')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index account_token_lookup on kernel.account_token (token_hash, purpose) where used_at is null;
revoke all on kernel.account_token from public, meridian_app, meridian_worker;
grant select, insert, update, delete on kernel.account_token to meridian_auth;

alter table kernel.outbox add column provider_message_id text;
alter table kernel.outbox add column failure_kind text check (failure_kind is null or failure_kind in ('transient', 'permanent', 'suppressed'));

create function kernel.record_outbox_provider(p_id bigint, p_provider_message_id text)
returns void language sql security definer set search_path = pg_catalog, kernel as $$
  update kernel.outbox set provider_message_id = left(p_provider_message_id, 300)
  where id = p_id and processed_at is null and provider_message_id is null
$$;
create function kernel.fail_outbox_permanent(p_id bigint, p_error text, p_kind text default 'permanent')
returns void language plpgsql security definer set search_path = pg_catalog, kernel as $$
begin
  update kernel.outbox set claimed_until = null, last_error = left(p_error, 500), failure_kind = p_kind,
    processed_at = now() where id = p_id and processed_at is null;
end $$;
revoke execute on function kernel.record_outbox_provider(bigint, text), kernel.fail_outbox_permanent(bigint, text, text) from public;
grant execute on function kernel.record_outbox_provider(bigint, text), kernel.fail_outbox_permanent(bigint, text, text) to meridian_worker;
