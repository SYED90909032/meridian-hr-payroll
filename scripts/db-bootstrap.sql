-- Run once as a PostgreSQL superuser. Replace the passwords. Roles are cluster-wide; databases are created per environment.
-- meridian_owner : runs migrations and owns objects. Never used by the running app.
-- meridian_app   : the application role. No BYPASSRLS, owns nothing. Subject to forced row level security.
-- meridian_auth  : identity tables only (user_account, session, membership read, api_key lookup).
-- meridian_worker: claims outbox rows across tenants through two SECURITY DEFINER functions. Nothing else.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'meridian_owner')  then create role meridian_owner  login password 'CHANGE_ME_owner'  createdb; end if;
  if not exists (select 1 from pg_roles where rolname = 'meridian_app')    then create role meridian_app    login password 'CHANGE_ME_app'    nosuperuser nobypassrls nocreatedb nocreaterole; end if;
  if not exists (select 1 from pg_roles where rolname = 'meridian_auth')   then create role meridian_auth   login password 'CHANGE_ME_auth'   nosuperuser nobypassrls nocreatedb nocreaterole; end if;
  if not exists (select 1 from pg_roles where rolname = 'meridian_worker') then create role meridian_worker login password 'CHANGE_ME_worker' nosuperuser nobypassrls nocreatedb nocreaterole; end if;
end $$;
