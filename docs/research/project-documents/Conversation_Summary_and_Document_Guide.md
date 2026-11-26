# Meridian Project: Conversation Breakdown and Document Guide

**Prepared by:** Manus AI. **Date:** 24 November 2026. **Status:** research and design only. Nothing has been built, and nothing will be built without your approval.

This file explains what was asked and what was delivered in each turn. It describes how the requirements changed, then what each document contains, and finally where everything currently stands.

## 1. The conversation, turn by turn

### Turn 1: Keka's use cases and 50 alternatives

You shared the Keka website and asked what the application is mainly used for, and for a list of the top 50 alternatives worldwide.

The answer was given in chat. It explained Keka's main use cases:

- core HR and employee records
- payroll and statutory compliance
- attendance, leave and shifts
- recruiting through Keka Hire
- performance and goals
- expenses
- helpdesk
- analytics
- project operations through Keka PSA

It also listed 50 global and regional alternatives. That list became the long-list for the next turn.

### Turn 2: Deep study of the top 30 platforms and a blueprint for an open-source alternative

You asked for the 50 to be narrowed to the top 20–30, and for each platform to be studied in depth. For each one you wanted the name, official URL, founding date, number of users, and the exact features it offers.

You also asked for a blueprint for an open-source platform that would beat all of them. Your requirements for it were:

- real gaps solved, with no bloated or repeated features
- a clean, organised interface
- an architecture strong enough that it "should not get failed"
- MCP and AI-agent integration
- attention to security, budget, smoothness and reliability

You asked for two methods to be applied. The first was the agent-skills from `github.com/addyosmani/agent-skills`. The second was the reverse-engineering approach from `github.com/morluto/rea`, used to understand the backends of the top three platforms. You also said clearly: **"Do not build a platform without my approval."**

Partway through this turn you said "stop", and then "no continue from where exactly you stopped". The work resumed and finished.

This turn produced two documents: the **Research Dossier** and **Blueprint v1**, described in section 3.

### Turn 3: Blueprint v2, covering integrations, AI, a fail-proof backend and pricing

You attached the dossier, the v1 blueprint and a longer brief in `pasted_content.txt`. The main asks were:

1. Explain how businesses can use their premium **Google Workspace or Microsoft 365** subscriptions, including Gemini and Copilot, inside Meridian.
2. Explain how customers can connect **their own AI**, such as ChatGPT, Claude or others, through **MCP**, designed so that sensitive data does not leak.
3. Design a **"very perfect" backend** that does not fail and resists hacking. It should use the best and cheapest providers, starting on **free plans** such as Cloudflare and Supabase.
4. Analyse the **pricing of every platform** in the dossier. Design Meridian's own tiers, and decide between **per-employee and per-feature** pricing, keeping prices cheap but profitable.
5. Use the dossier instead of re-researching, and search the web only for gaps.
6. From the longer brief:
   - features **organised into pages**, each with a name, description, how it works, its architecture and why it is the best approach
   - HR utilities: **email signatures**, **document collection into folders**, and **bulk or targeted messaging** by department
   - the **HR manager, executive and employee** views, including **1–3 or more handlers per department**, and the company side versus the employee side
   - **onboarding** and **scheduling**
   - **biometric, face, IoT and location** attendance
   - storing files in the customer's **Google storage** so Meridian does not pay for it, plus **Excel and Sheets exports**
   - the best **programming languages**, **React and React Native**, an easy path to **native apps**, and what to **build now versus later**
   - **global** scope, not country-specific, and **no timelines**

**Mid-turn steer.** You then said to ignore the user interface for now and focus only on the backend architecture and the full feature set. UI will be decided later. This steer replaced the UI parts of the brief.

To fill the gaps the dossier did not cover, five focused research notes were produced. The **Blueprint v2** was then written from them, together with the dossier.

### Turn 4 (this request): a complete breakdown of the conversation

You asked for a complete summary of the whole conversation and of every document. This file is that summary.

## 2. How your requirements changed

The direction moved in three steps. Turn 2 asked for breadth: understand every major platform and design something better, with a clean interface and a strong architecture. Turn 3 shifted towards commercial reality:

- reuse the customer's existing Google, Microsoft and AI subscriptions
- keep Meridian's own running costs near zero
- price below the competition while staying profitable
- make the system secure and resilient enough to hand to developers

The mid-turn steer then narrowed the scope to backend and features only.

Four constraints have held from the start. Nothing gets built without your approval. Features must not be repeated or bloated. Security and reliability come first. The platform is open-source and global.

## 3. The documents and what each contains

All files are in the sandbox under `/home/ubuntu/hr_research/`.

| Document | Size | Purpose |
|---|---|---|
| [HR_Platforms_Research_Dossier.md](/home/ubuntu/hr_research/deliverables/HR_Platforms_Research_Dossier.md) | about 158,000 words, 1,058 references | Deep study of Keka and 30 alternatives |
| [Open_Source_People_Platform_Blueprint.md](/home/ubuntu/hr_research/deliverables/Open_Source_People_Platform_Blueprint.md) | about 8,500 words, 53 references | Blueprint v1, "Meridian" |
| [Meridian_Blueprint_v2_Features_and_Backend.md](/home/ubuntu/hr_research/v2/Meridian_Blueprint_v2_Features_and_Backend.md) | about 18,700 words, 143 references | Blueprint v2: features, backend, integrations and pricing |
| Five research notes in [v2/notes](/home/ubuntu/hr_research/v2/notes/) | about 2,000 words each | Gap research used to write v2 |
| Diagrams in [diagrams](/home/ubuntu/hr_research/diagrams/) and [v2/diagrams](/home/ubuntu/hr_research/v2/diagrams/) | 11 images | Architecture, flows, maps and charts |

### 3.1 HR Platforms Research Dossier

This is the factual foundation. It begins by explaining how the 30 platforms were chosen from the 50. Each was scored on four things: scale, breadth across 34 standard HR modules, relevance to a Keka-type buyer, and market direction (AI, MCP, open APIs, global payroll). Freshteam was excluded because it has been discontinued.

The platforms are grouped into three tiers:

- **Tier 1, global enterprise suites:** Workday, SAP SuccessFactors, Oracle Fusion HCM, UKG Pro, Dayforce and ADP Workforce Now.
- **Tier 2, modern unified and global-employment platforms:** Rippling, Deel, Darwinbox, Zoho People, BambooHR, Gusto, HiBob, Personio, Paycom, Paylocity, greytHR, Remote, Factorial and Employment Hero.
- **Tier 3, regional payroll and compliance specialists:** Paychex Flex, HROne, PeopleStrong, factoHR, Zimyo, ZingHR, Razorpay Payroll, Sprout Solutions, Bayzat and ZenHR.

A summary table and a coverage analysis follow. A **heatmap** shows which of the 34 modules each vendor offers natively, as an add-on, through partners, or not at all. Three findings stand out:

- A native MCP server is offered by only 11 platforms.
- True multi-country payroll is native in only 11.
- EOR and contractor management are native in only 4.

Each of the 31 platform profiles, Keka included, contains the following:

- a fact sheet: official URL, founding year, scale and users, headquarters, pricing, payroll coverage, AI, integrations and compliance
- an overview
- a **complete feature list grouped by module**, about 6,155 features in total
- AI and automation
- integrations and API
- security, compliance and reliability
- strengths
- weaknesses and common user complaints

Three **backend teardowns** apply the reverse-engineering method to Workday, SAP SuccessFactors and Oracle Fusion. They cover how each structures its data model, effective dating, APIs, security roles and integration patterns.

Five **thematic studies** complete the dossier:

1. Real pain points and gaps in HR and payroll software.
2. Regulatory and compliance requirements across key markets.
3. AI agents in HR software and the Model Context Protocol.
4. Technical architecture of HR and payroll platforms, with lessons from real outages.
5. The open-source HR landscape and open-source business models.

The dossier is also the source of all the competitor pricing used in v2.

### 3.2 Blueprint v1, "Meridian"

The first design for the open-source alternative. It identifies **eight real gaps** in the market:

1. One vendor outage becomes a payroll crisis.
2. Recovery promises are weak and often unpublished.
3. Budgets break on modules, add-ons and exit costs.
4. Payroll is a black box.
5. Compliance changes are opaque.
6. AI is either a chatbot or an uncontrolled agent.
7. Lock-in comes through closed schemas and weak exports.
8. Frontline and mobile workers are treated as second-class users.

It reduces the dossier's 34 modules to **11 modules** on one shared core: kernel, people-core, flow, time, pay, talent, rewards, service, insight, platform and intelligence. One approvals inbox, rules engine, journey builder, document service, metrics layer, and notification and search service are shared by all of them. For each module it lists what reaches parity with the market, what goes beyond it, and what Meridian deliberately does not do.

It includes a section on **user experience**: information architecture, key journeys and a design system. This was later set aside by your v2 steer.

Its technical architecture is recorded in **10 architecture decision records**:

- ADR-001: a modular monolith in regional cells.
- ADR-002: tiered tenant isolation (pooled, bridge and silo).
- ADR-003: PostgreSQL with bitemporal records.
- ADR-004: a transactional outbox with NATS.
- ADR-005: Temporal for workflows.
- ADR-006: a deterministic Rust payroll engine compiled to WASM.
- ADR-007: signed, versioned country packs.
- ADR-008: relationship-based and field-level authorisation with OpenFGA and Cerbos.
- ADR-009: Keycloak or Zitadel for identity.
- ADR-010: envelope encryption with crypto-shredding.

It also covers the data model, the payroll pipeline, service level objectives, failure design, observability, security and privacy. It has an intelligence plane (a staged MCP server, bounded agents and a model gateway) and AGPL licensing. A hosted pricing hypothesis of about **US$3 or ₹199 per employee per month** was included, and so was a phased roadmap with acceptance criteria. Finally, it explains how the agent-skills and reverse-engineering methods shaped the design, and lists open decisions.

### 3.3 The five v2 research notes

These were written only where the dossier did not have the answer, as you instructed.

- **microsoft.md (29 references).** It covers:
  - Copilot declarative agents, and the difference between synced and federated connectors.
  - Remote MCP in Copilot Studio, which needs Streamable HTTP and OAuth.
  - Entra multi-tenant sign-in, SCIM provisioning and Conditional Access.
  - The exact least-privilege Graph scopes for mail, calendar, Teams and SharePoint.
  - Exchange sending limits: 10,000 recipients a day and 30 messages a minute.
  - Signatures: there is no Graph API for Outlook signatures, so Exchange transport rules are used.
  - Purview label behaviour and current Microsoft 365 and Copilot prices.
- **google.md (24 references).** It covers:
  - Gemini Enterprise custom MCP data stores (generally available) and A2A agents (preview).
  - Workspace add-ons and Chat apps.
  - Google sign-in keyed on `sub`, and provisioning through the Directory API.
  - The least-privilege `drive.file` scope with Google Picker, and shared drives.
  - Creating Sheets exports in the customer's Drive.
  - Gmail `gmail.send` and sending limits.
  - Signatures through `sendAs.update` with domain-wide delegation.
  - Calendar with Meet, and Workspace prices.
- **llm-mcp.md (23 references).** It covers:
  - How ChatGPT Business and Enterprise and Claude connect to custom MCP servers, and the admin controls each offers.
  - Gemini, Copilot Studio, VS Code and Cursor support.
  - The MCP specification of 2026-07-28: OAuth 2.1, PKCE, protected resource metadata, resource indicators and the ban on passing tokens through.
  - The main threats.
  - Bring-your-own-key and gateway options: LiteLLM, Cloudflare AI Gateway and OpenRouter.
  - Model prices, and techniques for minimising and pseudonymising personal data.
- **infra-costs.md (39 references).** It covers:
  - Free and paid limits for Cloudflare: Workers, R2, D1, KV, Durable Objects, Queues and AI Gateway.
  - Free and paid limits for Supabase, Neon, Aurora, Hetzner, Fly, Render, Resend, SES, Postmark, Upstash, Inngest, Temporal, Grafana, Sentry, Better Stack, Clerk, WorkOS and Twilio.
  - Cost arithmetic for three stages: about $0 a month, about $125–175 a month for 10,000 employees, and about $7,344 a month for one million employees.
- **devices.md (29 references).** It covers:
  - Integration methods for ZKTeco, eSSL, Hikvision, Suprema, Dahua, Anviz and Matrix devices.
  - How Keka and Zoho connect to devices.
  - Device security risks.
  - Mobile anti-spoofing: Play Integrity, mock-location detection and App Attest.
  - Face liveness options and the biometric laws (GDPR, BIPA and DPDP).
  - Kiosk, QR and NFC methods, and a recommended Go edge bridge.

### 3.4 Blueprint v2, "Meridian": features and backend

This is the current, developer-ready design. It has no UI design and no timelines.

**Roles and access.** A role-by-scope model, so a department can have several HR handlers with a primary and backups. It defines standard roles from account owner to auditor, and five field-sensitivity classes. The company side and the employee side share one API.

**Shared services.** Seven services are built once and reused: approvals, documents, notifications, policy rules, workflows, audit and search.

**Feature catalogue in 17 pages.** Each feature has its name, description, how it works, its backend design and why that design was chosen.

1. Company setup and structure
2. People
3. Documents and HR utilities: document collection into the customer's own Drive or SharePoint folders, the employee folder, letters, acknowledgements and the **email signature manager**
4. Communications: targeted and bulk messaging that respects provider limits, Chat and Teams posting, surveys and digests
5. Onboarding and offboarding, with account provisioning
6. Scheduling with Calendar, Meet and Teams, plus shifts and holidays
7. Time and attendance: the punch ingestion hub, the biometric device bridge, mobile punch with location and device trust, face liveness, kiosk, QR and NFC, IoT signals and attendance rules
8. Leave
9. Payroll: the global engine with country packs, safe pay runs, payslips, bank files, statutory reports, partner mode and the continuity kit
10. Expenses
11. Performance and growth
12. Helpdesk and knowledge
13. Reports, analytics and **exports to Sheets and Excel**
14. Automation
15. The AI assistant and bounded agents
16. Integrations and marketplace
17. Trust, privacy and account administration

**Google and Microsoft integration.** How sign-in, provisioning, storage, mail, calendar, chat, Copilot and Gemini are reused, with each permission and limitation stated honestly.

**Connecting the customer's own AI.** Two modes. In the first, the customer's assistant connects to Meridian through MCP. In the second, Meridian uses the customer's own model key.

**MCP server and the no-leak data firewall.** It covers:

- The OAuth 2.1 security profile.
- Tools in four tiers: read, analyse, draft and commit.
- Signed, pinned tool manifests.
- A five-rule data firewall: field classes, minimisation, pseudonymisation with sealed reference links, output scanning, and rate and volume limits.
- AI security tests.

**Backend architecture.** It covers:

- A modular monolith in regional cells.
- Language choices: TypeScript for the API and React/React Native clients, Rust for payroll, Go for the device bridge.
- The path to native apps.
- PostgreSQL with forced row-level security, per-tenant encryption keys and bitemporal records.
- The outbox, queues, state-machine workflows and Durable Objects.
- The storage strategy, search and analytics.

**Fail-safe design and security hardening.** Service level objectives, backups and restore drills, degraded modes, payroll guards, safe releases and provider independence. Passkeys allow face or fingerprint login without the biometric leaving the device. It also covers edge protection, supply-chain security and privacy by design.

**Provider stack by stage.** The free, paid and scale stages, with cost arithmetic, the limits of each free plan and the migration path.

**Competitor pricing analysis.** Five pricing models are identified, with the add-on traps, a comparison chart and Indian price benchmarks.

**Meridian pricing.** It is per active employee with no module add-ons:

- Self-hosted: free.
- Free hosted: up to 10 employees.
- Essential: $2, or ₹59 in India.
- Growth: $4, or ₹119, including payroll.
- Enterprise: $7, or ₹229.

There are three regional price bands. Usage is passed through for SMS, face checks and extra AI. Gross margins come to about 80–85%.

**The rest of v2** covers what to build now versus later, the developer handoff (repository layout, environments, pipeline and definition of done), and the decisions that need your approval.

### 3.5 Diagrams and charts

From turn 2, in `/home/ubuntu/hr_research/diagrams/`:

- the v1 architecture
- the payroll pipeline
- the agent and MCP flow
- the capability map
- the data model
- the module heatmap
- the feature-prevalence chart

From turn 3, in `/home/ubuntu/hr_research/v2/diagrams/`:

- the free-tier-first backend architecture
- the AI and MCP plane
- the device and mobile attendance flow
- the pricing comparison chart

![Meridian v2 backend architecture](https://private-us-east-1.manuscdn.com/sessionFile/KGhbCBmkeEpMjagsxbq7Z1/sandbox/GVtiI0o2m9E1XieO9TDb7s-images_1795523768465_na1fn_L2hvbWUvdWJ1bnR1L2hyX3Jlc2VhcmNoL3YyL2RpYWdyYW1zL2FyY2hpdGVjdHVyZQ.png?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvS0doYkNCbWtlRXBNamFnc3hicTdaMS9zYW5kYm94L0dWdGlJMG8ybTlFMVhpZU85VERiN3MtaW1hZ2VzXzE3OTU1MjM3Njg0NjVfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwyaHlYM0psYzJWaGNtTm9MM1l5TDJScFlXZHlZVzF6TDJGeVkyaHBkR1ZqZEhWeVpRLnBuZyIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc5NzI5MjgwMH19fV19&Key-Pair-Id=K2QY5QTL8JSY6C&Signature=MEQCICqoL~dEhtOwp8UBt0CEZT1oH8WAzFPT6oL9dlugVNNzAiAyLudF679jvc28xR~HVBJZZIQnle7ebP~OoCAmFG1pMg__)

## 4. What changed from v1 to v2

v2 keeps v1's core guarantees:

- a modular monolith in cells
- PostgreSQL with row-level security
- bitemporal records and a hash-chained audit log
- a deterministic Rust payroll engine
- signed country packs
- envelope encryption
- MCP tools behind approvals
- an open-source licence

The way it gets there is cheaper and simpler. NATS, Temporal, OpenFGA, Cerbos and Keycloak are no longer required from day one. Instead, v2 uses:

- Cloudflare at the edge (Workers, Queues, Durable Objects, R2 and Turnstile)
- Supabase or Neon for PostgreSQL
- PostgreSQL-backed state machines for workflows
- an in-process policy engine

Each heavier tool keeps a stated point at which it becomes worth adding.

v2 adds several things v1 did not have:

- Reuse of the customer's Google and Microsoft subscriptions, including customer-owned storage.
- Concrete Copilot, Gemini, ChatGPT and Claude connection paths.
- The data firewall.
- Device-level attendance design.
- The HR utilities: signatures, document collection and bulk messaging.
- Role-by-scope handlers.
- A costed free-to-scale provider plan.
- A full pricing model that replaces v1's single $3 hypothesis.

It removes the UI section and the month-based roadmap, as you asked.

## 5. Where things stand

The research phase and the design phase are both complete. No code has been written, and no accounts or services have been created.

These decisions are waiting for your input before any build:

1. Supabase or Neon as the starting database.
2. Which country payroll packs come first. India and the UAE were suggested, plus one more market.
3. The free-tier limit and the exact country lists for the regional price bands.
4. The key-management service and the face-liveness vendor.
5. Whether bulk email is sent from each customer's own domain or from a Meridian sub-domain by default.
6. Google's confirmation on whether the signature feature needs a CASA security review.
7. Final confirmation of AGPL for the core and Apache-2.0 for the SDKs and device bridge.

The UI design is deferred and will be decided later, as you instructed.
