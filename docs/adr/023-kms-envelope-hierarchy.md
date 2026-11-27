# ADR-023: Provider-backed master keys and versioned envelope hierarchy
Status: Accepted (local provider for development/tests; AWS-KMS-compatible provider for production)

## Context
The reference implementation derived tenant and subject keys from one environment master with HKDF. That made master rotation impossible without invalidating existing field ciphertext, and an operator holding a database dump could use the environment master path to decrypt sensitive fields. The production blueprint requires custody separation, KMS-compatible tests, and rotation without field re-encryption.

## Decision
`KeyProvider` loads and wraps a 32-byte application data key. `LocalKeyProvider` is restricted to development and tests. `AwsKmsKeyProvider` uses AWS KMS `Encrypt`/`Decrypt` with a deployment-bound encryption context; only the wrapped master data key is configured in production. `Kms` receives the unwrapped key at boot and exposes envelope helpers.

New `kernel.tenant_key` rows contain a versioned tenant key wrapped by the boot-time master. New `kernel.subject_key` rows contain a random subject DEK wrapped by that tenant key and carry the tenant-key version. Existing rows remain `key_version=0` and use the deterministic HKDF compatibility path until `keys:upgrade` processes them. Master rotation re-wraps tenant keys only. Tenant rotation creates a new tenant version and re-wraps subject DEKs only. Field ciphertext is not rewritten. Legacy blind indexes and HMAC secrets remain on the v0 derivation until a separately versioned index migration is approved; this keeps lookups stable across envelope rotation.

## Consequences
A database-only operator cannot unwrap versioned keys without KMS/application custody. Losing KMS access prevents sensitive decryption while the API can remain available for non-sensitive routes. Rotation is resumable at the tenant/subject level, but a staging drill and independent reviewer are still operational requirements. The local provider remains useful for deterministic tests and self-hosted development but is refused in production configuration.
