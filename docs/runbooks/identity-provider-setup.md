# Identity provider setup: OIDC SSO and SCIM

This runbook describes Meridian's supported Phase 3b identity integrations. It is an operator guide, not a claim that a real provider has been exercised in this repository. The automated tests use an in-process fake OIDC provider and synthetic SCIM client requests only.

## Before configuration

Set these API values for the deployment:

- `WEBAUTHN_RP_ID`: the production host name covered by the passkey RP, without a scheme.
- `WEBAUTHN_ORIGIN`: the exact HTTPS browser origin used for WebAuthn.
- `SSO_CALLBACK_URL`: the exact public callback URL, normally `https://<host>/api/v1/auth/sso/callback`.

The API must use HTTPS in production. Use a stable tenant slug. Decide whether JIT provisioning is appropriate; leave it disabled until the tenant has reviewed the default role and group mappings.

## OIDC client registration

Create a confidential OIDC web client in the provider with authorization-code flow, S256 PKCE, and the exact `SSO_CALLBACK_URL` as its redirect URI. Request the `openid`, `email` and `profile` scopes. Copy the issuer URL, client ID and client secret into Meridian's **Integrations → SSO** settings as an owner after completing step-up authentication. Meridian performs discovery from the issuer, validates the provider's metadata and seals the client secret with the tenant key; the secret is not displayed again.

Restrict **Allowed email domains** to domains controlled by the tenant. If JIT is enabled, choose the least-privileged default role (`employee` unless the owner has a documented reason to choose another supported role). Add group mappings explicitly and review every privileged mapping. An IdP group that is not mapped cannot grant a Meridian role.

### Okta

In Okta, create an **OIDC - Web Application** integration. Set the sign-in redirect URI to the exact callback above, use a client authentication method that keeps the secret server-side, and note the issuer for the authorization server used by the tenant. Assign only the intended Okta users/groups to the application. Configure the groups claim in the ID token if group-to-role mapping is needed, then map the claim name in Meridian (usually `groups`). Verify that the assigned users have a verified email.

### Microsoft Entra ID

In Microsoft Entra admin center, register a web application and add the exact callback under **Web redirect URIs**. Create a client secret with an expiry recorded in the operator's secret-rotation calendar. Use the tenant-specific issuer rather than a consumer/common issuer when tenant isolation is required. Expose a `groups` claim only for the groups needed by Meridian and test overage behavior in staging; if Entra returns a groups-overage indicator instead of the configured claim, do not assume a role mapping succeeded.

### Google Workspace / Google Identity

Create an OAuth web client in the Google Cloud project controlled by the organization and add the exact callback under **Authorized redirect URIs**. Use the issuer `https://accounts.google.com`, retain the client secret server-side, and restrict allowed email domains to the Workspace domains that the tenant owns. Google group membership is not automatically a Meridian role mapping: use only a verified claim supplied by the configured client/provider, and review the resulting groups in a staging sign-in before enabling any privileged mapping.

## SCIM provisioning

Meridian's SCIM base URL is:

```text
https://<meridian-host>/api/v1/scim/v2
```

The tenant owner creates a token in **Integrations → SCIM** after step-up. The API returns the bearer token once. Store it immediately in the IdP provisioning secret store; Meridian stores only a hash. Do not put the token in tickets, screenshots, shell history, source control or logs. Set a short expiry appropriate for the tenant and create a replacement before rotation. Revoking a token is immediate.

Configure the IdP with:

- Base URL: `https://<meridian-host>/api/v1/scim/v2`
- Authentication: HTTP Bearer token
- Token: the one-time value returned by Meridian
- User identifier: `userName` (an email address)
- Provisioning actions: create, update, deactivate; delete is interpreted as deactivate

Supported endpoints are `ServiceProviderConfig`, `Schemas`, `ResourceTypes`, `Users` list/get/create/PUT/PATCH/DELETE, `userName eq` filtering, and mapped `Groups` read/PATCH membership. Bulk, sorting, ETags and password changes are not supported. The implementation accepts the case-insensitive PatchOp names used by common IdP clients and the `application/scim+json` media type.

Deactivation suspends the tenant membership and revokes that tenant user's sessions and API keys. It never hard-deletes the identity. Verify that the IdP sends a deactivation when a test user is unassigned, and verify that reactivation is deliberate before production use.

## Staging verification checklist

1. Complete one sign-in with a test account whose email is verified and whose domain is allowed.
2. Confirm an unmapped group does not grant a role; confirm each mapped group grants only the reviewed role.
3. Test an unknown user with JIT disabled and enabled, and record the resulting default role.
4. Test a suspended membership and a revoked/expired SCIM token.
5. Run SCIM create, update, PatchOp deactivate, list filter and delete-as-deactivate against the provider's provisioning test connection.
6. Verify the exact callback URL, issuer, audience, claim name and email-domain policy after any provider change.
7. Rotate the client secret and SCIM token using the operator's change record. Never claim provider compatibility from the local fake-provider tests alone.
