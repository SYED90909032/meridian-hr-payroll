-- 007 auth columns: TOTP replay protection, forced password change, recovery codes.
alter table kernel.user_account add column totp_last_counter bigint not null default 0;
alter table kernel.user_account add column must_change_password boolean not null default false;

create table kernel.recovery_code (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kernel.user_account(id) on delete cascade,
  code_hash bytea not null unique,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
revoke all on kernel.recovery_code from meridian_app;
grant select, insert, update, delete on kernel.recovery_code to meridian_auth;

-- Login attempt log for rate analysis and lockout review. No passwords, no tokens.
create table kernel.login_attempt (
  id bigint generated always as identity primary key,
  email citext,
  ip text,
  ok boolean not null,
  reason text,
  at timestamptz not null default now()
);
create index login_attempt_ip on kernel.login_attempt (ip, at desc);
revoke all on kernel.login_attempt from meridian_app;
grant select, insert on kernel.login_attempt to meridian_auth;
