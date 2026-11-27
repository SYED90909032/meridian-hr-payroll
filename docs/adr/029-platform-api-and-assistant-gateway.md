# ADR-029: Platform API and assistant gateway hardening

## Context

Meridian's API keys were read-only, webhook destinations had no tenant policy, and the assistant called an optional model provider directly. External integrations need bounded write access, per-key budgets, expiry, delivery policy and a typed client, while model use needs consent and DLP.

## Decision

API-key writes require `allow_write=true`, a fresh step-up at creation, current creator permissions and only the documented `people.write`/`leave.admin` allow-list; step-up routes never accept API keys. Keys have mandatory bounded expiry and creation-time per-key rate settings enforced through `@fastify/rate-limit`'s `keyGenerator`. Webhook allow-list rules are owner-managed and checked both at registration and delivery, in addition to the SSRF guard. Delivery logs are purged by the worker through a restricted database function.

Model calls go through `LlmGateway`, default off per tenant, owner-consented and audited with a consent version, model allow-list, timeout, request cap and DLP scrubbing. The deterministic no-model path remains the fallback. The SDK is Apache-2.0, generated from the committed OpenAPI snapshot with zero runtime dependencies. MCP remains a documented read-only design until the public API is stable.

## Consequences

Integrators can use narrow write keys but cannot automate payroll, approvals, audit, access, key or webhook actions. Allow-list changes can fail previously valid deliveries. SDK publication and provider/legal review remain external work. Local tests prove behavior against PostgreSQL, Fastify, and stub model responses; they do not prove a real provider's retention or availability.

## Status

Accepted for Phase 6/8 implementation; SDK not published and legal/privacy review pending.
