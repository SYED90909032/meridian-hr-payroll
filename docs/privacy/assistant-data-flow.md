# Assistant data flow and privacy boundary

When a tenant owner enables model use with a recorded consent text version, the gateway may send the following fields to the configured OpenAI-compatible provider: the user's scrubbed question text; the fixed tool name; and the fixed tool's scrubbed summary fields (for example leave-balance labels, pseudonym tokens, leave dates, holiday names/dates, aggregate counts, approval kinds and timestamps, attendance status counts, or non-confidential ticket category counts). Requests are capped by `ASSISTANT_REQUEST_MAX_CHARS`, restricted to the configured model allow-list, and timed out by `ASSISTANT_TIMEOUT_MS`.

The gateway scrubs email addresses, phone numbers, IBANs, Emirates IDs, long account-like digit runs, and currency amounts to stable per-value placeholders before sending. It does not send database IDs, tenant IDs, user IDs, employee names when pseudonyms are available, pay, bank, national-ID, leave-reason, confidential-ticket, session, API-key, webhook-secret, role-assignment, or conversation-storage metadata. The fixed tools cannot query those fields.

The model output is scrubbed again and is treated as untrusted text. A provider outage, disabled consent setting, disallowed model, or DLP refusal falls back to the deterministic no-model answer from tool results. Assistant messages remain in Meridian's tenant/user-scoped conversation tables under the existing retention policy; the provider's retention, logging and training policy is outside Meridian's control and must be confirmed contractually before production use.

This note describes the implemented technical boundary. Legal/privacy review, a DPA, residency decision, and provider-specific retention review are external and have not been completed.
