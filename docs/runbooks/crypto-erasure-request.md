# Crypto-erasure request

1. Authenticate the requestor and locate the tenant/employee subject through the approved data-rights workflow.
2. Check for a legal hold, payroll retention requirement, active dispute, or audit preservation requirement. If any applies, stop and obtain the legal owner's written decision; do not shred keys.
3. Confirm the scope: encrypted bank/national-ID fields, employee data keys, document/object references, and any downstream copy. The audit record itself remains append-only and must not contain plaintext secrets.
4. Run the platform's crypto-erasure operation through the normal route pipeline with step-up/MFA. Never update encryption tables manually.
5. Verify that encrypted fields cannot be decrypted, object references are blank/deleted according to the configured object-store retention policy, and subsequent reveal attempts fail safely.
6. Record the request, scope, actor, legal-hold result, and verification outcome in the audit trail. Preserve only the minimum metadata required by the retention policy.
7. If the object store or backup copy is managed by a vendor, open the vendor deletion/retention ticket and attach only object keys and hashes, never plaintext.
