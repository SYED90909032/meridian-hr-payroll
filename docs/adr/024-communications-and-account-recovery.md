# ADR-024: Outbox communications and account recovery tokens

Status: Accepted (Phase 3a working default)

## Context

Meridian previously created users with a temporary password displayed to an administrator. That path is unsafe: the password can be copied into chat, screenshots or logs, and it makes invitation acceptance dependent on an administrator transmitting a secret. Password resets and transactional notifications also need a reliable asynchronous delivery path that does not put provider availability in the request transaction.

The platform already has a PostgreSQL outbox and worker. Account lifecycle links need stronger guarantees than a general notification: they must be opaque, single-use, expiring, bound to a purpose, and safe if an attacker reads the database. Provider credentials must stay outside payloads and logs, and a provider retry must not create duplicate sends after acceptance.

## Decision

Use `email.send` and `sms.send` as outbox topics handled by the existing worker. Delivery is behind `Mailer` and `SmsSender` interfaces in `apps/api/src/modules/comms/providers.ts`, with SMTP, Postmark and Twilio adapters plus log-only development adapters. Provider selection is configuration-driven; production refuses the log providers. Successful sends persist a provider message id on the outbox row, permanent recipient/suppression failures stop retrying, and transient failures use the existing exponential backoff.

Invitations and password resets use random base64url account tokens. Only SHA-256 digests are stored in `kernel.account_token`; the raw token is encrypted in the tenant-scoped outbox payload and is decrypted only while rendering the message. Tokens carry a purpose, expiry and used timestamp. Validation happens before the atomic consume update so an invalid password cannot burn a valid link; concurrent successful requests still have exactly one winner. Passwords are checked against the local policy and the HIBP range API using only the first five SHA-1 characters, with configurable fail-open/fail-closed behavior.

Transactional notification rows and their email outbox rows are created in the same application transaction as the business event. Email preferences default to enabled, while security mail cannot be disabled. Bounce/complaint webhooks require the configured authentication secret and record tenant-scoped suppressions by email hash.

## Consequences

Administrators no longer receive or see a temporary password. Users choose their own password through a short-lived invitation or reset link, and a reset revokes existing sessions without automatically signing the user in. The API can be horizontally scaled because delivery state and deduplication remain in PostgreSQL.

No real provider or mailbox is exercised by the repository tests: SMTP tests use an in-process SMTP server, Postmark/Twilio seams accept injectable HTTP fetchers, and HIBP tests use a fake range response. Operators must configure a sending domain and provider credentials, and must publish SPF, DKIM and DMARC records as described in `docs/runbooks/email-deliverability.md`.
