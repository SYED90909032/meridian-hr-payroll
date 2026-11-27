# Key rotation runbook

This runbook applies to the Meridian envelope hierarchy. It does not authorize live payment or change any payroll assurance level. Test commands must use the workstream/test database or a throwaway database.

## Pre-flight

1. Confirm the deployment uses `KEY_PROVIDER=aws-kms`, a deployment-bound KMS encryption context, and `MERIDIAN_WRAPPED_MASTER_KEY`; do not put a plaintext master in production env. Keep the old KMS key enabled until verification completes.
2. Take and verify a database backup. Confirm the object-store bucket is reachable and that `audit-keys/<keyId>.pem` objects are retained.
3. Record the operator, change ticket, KMS key IDs, wrapped-key versions, database migration version, and current seal reconciliation result. Never copy plaintext key material into the ticket or logs.

## Upgrade legacy subject keys

The one-off resumable upgrade leaves field ciphertext untouched and converts v0 HKDF salts to random DEKs wrapped under a versioned tenant key:

```sh
. ./.testenv                         # test/throwaway DB only
pnpm --filter @meridian/api keys:upgrade [tenant-uuid]
```

Omitting the tenant UUID processes all tenants. The command is idempotent; rerun it after an interruption. Verify `select count(*) from kernel.subject_key where key_version = 0 and wrapped_key is not null` is zero for the intended scope and decrypt a representative bank/national-ID record through the application.

## Tenant-key rotation

```sh
pnpm --filter @meridian/api keys:rotate-tenant <tenant-uuid>
```

The command inserts the next active tenant-key version, re-wraps that tenant's subject DEKs, then retires the old tenant key. Verify the new version is active, all subject rows reference it, field ciphertext hashes are unchanged, a representative decrypt succeeds, and `audit` contains the operational event from the change procedure. Webhook/TOTP/blind-index v0 derivations remain compatible across this rotation by design.

## Master-key rotation

Generate a new KMS data key/wrapped ciphertext using the deployment's KMS adapter (`keys:init` prints only the configured wrapped form when `KEY_PROVIDER=aws-kms`), deploy it to an isolated process, and run the master re-wrap operation from the operator rotation tool using the old and new providers. The operation updates only `kernel.tenant_key.wrapped_key`; it never rewrites field ciphertext or subject DEKs. Restart API and worker instances only after the database re-wrap commits. Verify sensitive decrypts, non-sensitive health/read routes, seal reconciliation, and old KMS permission denial.

The repository test primitive is `rotateMasterKey` in `apps/api/src/crypto/key-rotation.ts`; a production wrapper must obtain both providers from the secret manager and must not print either plaintext key.

## Emergency revoke

1. Disable the application's KMS `Decrypt` permission or disable the compromised KMS key version. Do not delete database envelopes.
2. Keep the API up for health and non-sensitive routes; sensitive decryption should fail closed. Capture alerts and audit/incident records without including plaintext or key material.
3. Rotate the KMS key and master data key after incident containment, then re-wrap tenant envelopes. If compromise includes a tenant key, rotate that tenant key and its subject envelopes.

## Verification and rollback

Required checks are: API typecheck/build, full API tests, provider/KMS integration tests against moto (not real AWS), `keys:upgrade` idempotence, tenant/master rotation decrypt checks, catalog RLS review generation, legal-hold erasure tests, and local/S3 seal reconciliation including tamper, missing, and extra-object cases.

Before committing a rotation, export only metadata (versions, counts, hashes) and retain the old KMS key permission. If verification fails before the old envelopes are retired, stop the deployment and point the application back to the prior wrapped master. If a tenant rotation committed, do not restore old ciphertext metadata by hand; re-run the forward rotation or restore the database backup with its corresponding KMS key version under incident change control. All rotation, revoke, failed-decrypt, and reconciliation events must be auditable without secrets.
