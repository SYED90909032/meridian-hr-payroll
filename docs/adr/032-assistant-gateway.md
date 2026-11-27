# ADR-032: Consent-gated assistant gateway

## Context

A language model can be fooled by user text or database text containing instructions. The assistant must remain useful without allowing model-selected tools or sensitive-data leakage.

## Decision

All outbound model calls use one tenant-aware gateway. A tenant is opt-in only after an owner changes the audited setting with a consent text version. The gateway enforces a configured model allow-list, request caps, timeout, stable DLP placeholders for common identifiers and amounts, and a refusal path for unsafe input. It sends only summaries from fixed read-only tools and scrubs model output. No-model direct answers are first-class and the default.

## Consequences

Provider outages and unconsented tenants receive deterministic answers. Placeholder text may remain in a model answer rather than risk restoration of sensitive content. Provider retention and legal/privacy approval remain external.

## Status

Accepted for Phase 8 implementation; external privacy review not complete.
