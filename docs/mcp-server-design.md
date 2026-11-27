# MCP server design (staged)

The MCP server is intentionally not built in Phase 6. It may be started only after the versioned public API and SDK are stable. It will be a separate adapter over the API, not a second data-access path.

## OAuth approach

Use a vetted OAuth 2.1/OIDC provider and authorization-code flow with PKCE. Register MCP clients per tenant, issue short-lived access tokens with audience and tenant claims, rotate refresh tokens, and require explicit owner consent for each client. Tokens never carry payroll, bank, national-ID, approval, audit-write, key-management, or webhook-management capabilities. Token revocation and consent removal must take effect immediately through the API.

## Read-only tool list

The initial tool list is limited to `get_my_leave_balance`, `list_team_leave_today`, `get_headcount`, `list_my_pending_approvals`, `list_upcoming_holidays`, `get_attendance_summary` (only when the API permission permits it), and `list_open_nonconfidential_tickets` (only for helpdesk readers). No tool accepts raw SQL, a permission name, a user ID from another tenant, or a write operation.

## Data minimisation

Reuse the assistant gateway's fixed-tool firewall, tenant-bound RLS queries, per-conversation pseudonyms, DLP scrubber, model consent gate, request size cap, timeout and source grounding. Never expose pay, bank, national-ID, leave-reason, confidential-ticket, session, API-key, webhook-secret, or role-assignment values. Tool outputs contain only the fields required for the answer. Prompt text and database text are untrusted data, including second-order instructions in names, ticket titles, announcements, and knowledge-base content. Legal/privacy review remains external and is not implied by this design.
