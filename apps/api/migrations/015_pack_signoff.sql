-- 015 Phase 2 assurance evidence. These are global owner-controlled records, not tenant data.
create table pay.pack_signoff (
  pack_id text not null,
  version text not null,
  pack_hash text not null,
  reviewer_name text not null check (length(trim(reviewer_name)) between 2 and 200),
  reviewer_organisation text not null check (length(trim(reviewer_organisation)) between 2 and 200),
  credential_note text not null check (length(trim(credential_note)) between 5 and 1000),
  signed_at timestamptz not null,
  scope text not null check (length(trim(scope)) between 5 and 1000),
  document_reference text not null check (length(trim(document_reference)) between 2 and 500),
  document_hash text not null check (document_hash ~ '^[a-f0-9]{64}$'),
  golden_vector_set_hash text,
  bank_wps_acceptance_reference text,
  parallel_run_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (pack_id, version, pack_hash),
  check (golden_vector_set_hash is null or golden_vector_set_hash ~ '^[a-f0-9]{64}$'),
  check (cardinality(parallel_run_ids) is null or cardinality(parallel_run_ids) <= 100)
);

-- No runtime role may create or alter evidence. The owner role is the deliberate human change process.
revoke all on pay.pack_signoff from meridian_app, meridian_auth, meridian_worker;
revoke insert, update, delete on pay.pack_registry from meridian_app, meridian_auth, meridian_worker;

comment on table pay.pack_signoff is 'Owner-controlled external evidence for a specific immutable pack hash; absence keeps live payment blocked.';
comment on column pay.pack_signoff.document_hash is 'SHA-256 of the reviewer evidence document, not the pack hash.';
comment on column pay.pack_signoff.parallel_run_ids is 'IDs of qualifying tenant-scoped parallel runs; validated by the assurance trigger.';
