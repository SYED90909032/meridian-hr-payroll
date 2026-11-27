# ADR-031: Passkeys, OIDC SSO and SCIM stay behind the identity boundary

Status: Accepted (working default; provider and hardware staging validation remain open)

## Context

Enterprise tenants need phishing-resistant sign-in, federated login and directory provisioning. Meridian already separates identity operations (`meridian_auth`) from tenant business data (`meridian_app`), uses a fixed route pipeline, forced RLS and audited mutations. The new authentication paths must not weaken those properties or introduce hand-written cryptographic protocol code.

The platform needs to support WebAuthn passkey registration, sign-in and step-up; OIDC authorization-code sign-in with discovery, state, nonce and PKCE; and inbound SCIM 2.0 user/group lifecycle operations. Client secrets and temporary ceremony state are sensitive. SCIM provisioning must be tenant-scoped and must be able to revoke access on deactivation. SAML is also requested by the wider blueprint, but a maintained, practical implementation and signed-assertion test path were not available in this workstream.

## Decision

1. Keep all three capabilities in the IAM boundary. Use `@simplewebauthn/server` and `@simplewebauthn/browser` for WebAuthn and `openid-client` for OIDC. Do not hand-roll signature, token, WebAuthn or XML protocol verification.
2. Store passkey credentials and short-lived, single-use challenges in identity tables. Bind registration and step-up challenges to the current session; require user verification; bind verification to configured RP ID/origin; reject counter regression and consume challenges atomically.
3. Store one OIDC configuration per tenant. Seal the client secret with the tenant key. Discover the provider metadata before authorization, guard discovery/token fetches with the existing SSRF rules, require HTTPS outside tests, and bind each callback to a single-use state record containing nonce, PKCE verifier and a local post-login path. Require a valid signature, canonical issuer, configured audience, unexpired ID token and `email_verified=true`.
4. Treat verified email as the linking key only within the target tenant. JIT provisioning is opt-in and starts with the tenant default role; external groups receive roles only through an explicit owner-managed mapping. An IdP claim cannot grant an unmapped privileged role.
5. Give SCIM its own fixed-pipeline authentication kind. Store only a hash of each tenant-scoped bearer token, with expiry and revocation. SCIM tenant transactions read and write membership/business rows through `meridian_app`; identity lookup/create and session/API-key revocation use `meridian_auth`. Never grant `meridian_app` access to `kernel.user_account`.
6. Implement the supported SCIM subset honestly: service metadata, user list/lookup/create/replace/PatchOp/deactivate, `userName eq` filtering, mapped groups read and group membership PATCH. Do not hard-delete user identities.
7. Defer SAML. It is not built until a maintained vetted library, signed-assertion test tooling and provider interoperability plan are selected.

## Consequences

Passkeys and SSO use the same session security properties as password login, and SCIM offboarding can revoke active access without crossing the identity-role boundary. The browser needs configured WebAuthn values and each OIDC client needs an exact callback URL. Operators must rotate SCIM tokens and review group mappings as part of joiner/mover/leaver controls.

The integration tests prove protocol handling against an in-process fake OIDC provider and a software authenticator, not Okta, Entra, Google, hardware keys or a browser platform authenticator. Provider-specific claims, redirect registration, SCIM retry/concurrency behavior and IdP compromise remain staging and operational review items. SAML remains a documented gap.
