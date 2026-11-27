# Staff leaver credential revocation

1. Confirm the leaver identity and effective time through the employer's approved HR process.
2. Disable the user in the Meridian admin UI/API and revoke every active session. Verify the response with a new login attempt returning `401`.
3. Revoke API keys created by the user and device keys assigned to their devices. Record key IDs, not secret values.
4. Remove role assignments and review pending approval tokens or approval requests owned by the user. A leaver must never be used to satisfy an independent payroll approval.
5. If the person handled signing or encryption custody, invoke the separately approved key-rotation procedure; do not delete a signing key required to verify historical audit seals.
6. Revoke IdP/SSO access in the identity provider and invalidate downstream device sessions. These are operator-side actions outside this repository.
7. Check the audit log for session, key, role, and crypto-erasure events. Preserve the audit export and request IDs in the offboarding record.
8. If compromise is suspected, use `data-breach.md` rather than treating this as routine offboarding.
