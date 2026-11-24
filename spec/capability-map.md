# Capability Map: Meridian (build 0.1)

Source: `capability_map.png` in the project files, narrowed to what this build implements.

| Module id | Responsibility | Depends on | Build status |
|---|---|---|---|
| kernel | tenancy, identity (password + TOTP), sessions, step-up, RBAC role x scope, RLS, audit hash chain, outbox, idempotency, field encryption, crypto-shredding | - | built |
| people-core | employee, org units, employment, bitemporal compensation, bank + national ID (encrypted, blind-indexed), documents | kernel | built |
| flow | approvals engine: content-bound single-use tokens, step-up gating, void-on-change, inbox, notifications | kernel, people-core | built |
| time | punch ingest (202 + receipt, DB dedupe, partitioned), attendance by event time, shifts, leave types, ledger, requests | kernel, people-core, flow | built |
| pay | deterministic engine, UAE pack (L0), pay-run state machine, immutable snapshots, maker-checker, payslips frozen at finalise, WPS SIF file | kernel, people-core, time, flow | built (sandbox mode; live gated on L2) |
| service | helpdesk (confidential class RLS), announcements, knowledge base | kernel, people-core | built |
| intelligence | assistant behind a data firewall: pseudonym tokens, tool tiers, draft-only writes | kernel, people-core, time, pay, service | built (rule-based; LLM adapter optional) |
| insight | dashboards, headcount/attendance/payroll cost, audit explorer | all | built |
| platform | REST API + OpenAPI, API keys, webhooks via outbox with HMAC + SSRF guard | kernel | built (SCIM, plugins, marketplace staged) |
| talent, rewards, flow journeys | hiring, reviews, goals, comp cycles | - | staged |

Build order: kernel -> people-core -> flow -> time -> pay -> service -> intelligence, insight, platform -> web UI.
