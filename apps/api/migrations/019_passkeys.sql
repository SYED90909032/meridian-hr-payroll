-- 019 passkeys: WebAuthn credentials are global to a user; ceremonies are short-lived and single-use.
create table kernel.passkey_credential (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kernel.user_account(id) on delete cascade,
  credential_id bytea not null unique,
  public_key bytea not null,
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}',
  device_label text not null default 'Passkey' check (length(device_label) between 1 and 80),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkey_credential_user on kernel.passkey_credential (user_id);
create table kernel.webauthn_challenge (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  challenge_hash bytea not null unique,
  user_id uuid references kernel.user_account(id) on delete cascade,
  session_id uuid references kernel.session(id) on delete cascade,
  ceremony text not null check (ceremony in ('registration', 'authentication', 'step_up')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index webauthn_challenge_active on kernel.webauthn_challenge (expires_at) where used_at is null;
revoke all on kernel.passkey_credential, kernel.webauthn_challenge from meridian_app;
grant select, insert, update, delete on kernel.passkey_credential, kernel.webauthn_challenge to meridian_auth;
