-- Phase 6 platform hardening: explicit API-key write opt-in and tenant webhook destinations.

alter table plat.api_key
  add column if not exists allow_write boolean not null default false,
  add column if not exists rate_limit_max integer not null default 600,
  add column if not exists rate_limit_window_seconds integer not null default 60;

alter table plat.api_key
  add constraint api_key_rate_limit_max_ck check (rate_limit_max between 1 and 10000),
  add constraint api_key_rate_limit_window_ck check (rate_limit_window_seconds between 1 and 86400);

create table if not exists plat.webhook_allowlist (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  host text not null check (host = lower(host) and length(host) between 1 and 253),
  path_prefix text not null default '/' check (path_prefix like '/%')
);
create unique index if not exists webhook_allowlist_tenant_host_path on plat.webhook_allowlist (tenant_id, host, path_prefix);
create index if not exists webhook_allowlist_tenant on plat.webhook_allowlist (tenant_id);
select app.rls_standard('plat.webhook_allowlist');

-- Retention runs as the least-privileged worker through a definer-owned function. Delivery rows
-- have no inbound references, so deleting old log rows cannot break outbox or endpoint records.
create or replace function plat.purge_webhook_deliveries(p_retention_days integer)
returns integer
language plpgsql
security definer
set search_path = plat, pg_temp
as $$
declare n integer;
begin
  if p_retention_days < 1 or p_retention_days > 3650 then raise exception 'invalid retention'; end if;
  delete from plat.webhook_delivery where created_at < now() - make_interval(days => p_retention_days);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function plat.purge_webhook_deliveries(integer) from public;
grant usage on schema plat to meridian_worker;
grant execute on function plat.purge_webhook_deliveries(integer) to meridian_worker;
