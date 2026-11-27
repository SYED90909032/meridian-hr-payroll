-- Versioned envelope hierarchy. key_version=0 on subject_key is the deterministic HKDF compatibility path.
create table kernel.tenant_key (
  tenant_id uuid not null references kernel.tenant(id),
  version integer not null check (version > 0),
  wrapped_key bytea not null,
  status text not null default 'active' check (status in ('active', 'retired', 'revoked')),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (tenant_id, version)
);
create unique index tenant_key_one_active on kernel.tenant_key (tenant_id) where status = 'active';
alter table kernel.subject_key add column key_version integer not null default 0 check (key_version >= 0);
select app.rls_standard('kernel.tenant_key');
-- The app needs to read and maintain envelopes only through its tenant wall. No runtime role can bypass it.
revoke delete on kernel.tenant_key from meridian_app;

-- The review tooling treats these as the only intentional global reference tables with no tenant_id.
comment on table kernel.tenant_key is 'Tenant-scoped envelope keys. wrapped_key is ciphertext, never plaintext key material.';
comment on column kernel.subject_key.key_version is '0 is the legacy HKDF salt path; positive values refer to kernel.tenant_key versions.';
