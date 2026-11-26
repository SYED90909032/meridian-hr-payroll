# Meridian: Blueprint for an Open-Source People and Payroll Platform

**Author:** Manus AI. **Status:** Draft specification for approval. Nothing will be built until you approve it. **Working codename:** Meridian. The name is a placeholder and can change.

This blueprint draws on the research dossier covering Keka and 30 alternatives. It also uses evidence-graded teardowns of the public API contracts of Workday, SAP SuccessFactors and Oracle HCM. It is written as a specification, following the spec-driven-development skill from the agent-skills repository [42]. It covers the objective, the evidence, the product scope, the architecture decisions, the boundaries, the acceptance criteria and the open questions that need your decision.

## Objective and who it is for

Meridian is a single open-source platform for people, time, payroll, talent and service. A five-person startup can self-host it on one server. A 200,000-employee multi-country group can run it on the managed cloud. The promise has four parts. Every pay run can be explained line by line. The system keeps working when parts of it fail. Pricing has no surprise add-ons. AI assistants and agents can act safely through the same permission model that humans use.

The first users are the buyers Keka serves today: Indian, Gulf and Southeast Asian employers with 20 to 20,000 employees. They need deep statutory payroll and frontline attendance, and they are tired of paying per module. The design also serves global teams, so that the second and third countries are configuration and country packs, not a separate product.

## The real gaps, and what Meridian does about each

The gaps below come from the pain-points, architecture, regulatory and AI studies in the dossier. Each gap links a documented failure to a design answer.

### Gap 1: One vendor outage becomes a payroll crisis

The December 2021 ransomware attack on Kronos Private Cloud made affected UKG services unavailable for several weeks. Customers had to fall back to manual time capture [1]. The University of Utah warned employees about overpayments, underpayments and later special cheques [2]. Canada's Phoenix system shows how bad a failure can get. The Auditor General found the system launched without critical pay functions, complete testing or adequate contingency plans, and more than $520 million in pay was outstanding by June 2017 [3].

Meridian's answer has four parts. First, it uses regional cells, so one incident cannot take down every tenant. Second, an offline payroll continuity kit is produced every time a pay run is locked: the last approved bank file and pay register are kept outside the platform. Third, time capture works offline and queues signed punches. Fourth, migration requires a parallel run that blocks go-live while critical variances remain.

### Gap 2: Recovery promises are weak and often unpublished

The largest vendors publish modest disaster-recovery targets. Workday's security datasheet states a 12-hour recovery time objective (RTO) and a one-hour recovery point objective (RPO) [4]. Oracle's SaaS pillar document states the same 12-hour RTO and one-hour RPO for Fusion HCM after a disaster is declared [5]. SAP documents regional data centres and secondary sites, but product-specific RPO and RTO for SuccessFactors were not public. Keka, BambooHR and Razorpay have published no technical architecture at all.

RTO is how long recovery takes. RPO is how much recent data can be lost. Meridian publishes its targets for each capability and tests them in public game days. Payroll data targets an RPO under one minute and an RTO under one hour inside a region.

### Gap 3: Budgets break on modules, add-ons and exit costs

Public SMB prices look low but are modular. Gusto lists a base fee plus a per-person fee and charges extra for add-ons [10]. Rippling starts at $8 per employee on top of a platform fee [11]. BambooHR spans roughly $10 to $25 per employee before key add-ons [12]. Dayforce's published MSRP price book sells every module separately. It lists AI Agents at US$66 per employee per year, on top of the AI Assistant [13]. EOR from Deel or Remote starts at $599 per employee per month [14] [15].

The coverage data in the dossier shows the same pattern. Compensation planning is an add-on or partial module in 18 of 31 platforms, and workforce planning in 15. Meridian removes paid module tiers. Every module ships in the open-source core. The hosted service charges one transparent per-employee price, and data export is always free.

### Gap 4: Payroll is a black box

Reviewers of large suites describe complex configuration, hard reporting and a reliance on specialist consultants. Government audits of the Oregon and Maine Workday programmes cite underpayments, overpayments, faulty legacy data and incomplete documentation. These are summarised in the pain-points study. Buyers cannot see why a figure is what it is, which rule produced it, or which law that rule implements.

Meridian treats every pay result as evidence. Each result stores its inputs, the country-pack version, the rule digest, the rounding steps and the approvals. An "explain this payslip" view walks from the net figure back to the statute that produced each line.

### Gap 5: Compliance changes are opaque

The regulatory study shows that India's DPDP Rules 2025 [28], the UAE's June 2026 change to its wage protection system [29] and Saudi GOSI rules [30] all change faster than annual release cycles. No vendor publishes the legal source, the effective date and the test evidence for each rule. The research also could not verify any vendor's actual statutory-update lag, so the gap to close is transparency, not just speed.

Meridian ships country packs as versioned, signed and testable rule bundles. Each rule cites its legal source and effective date. Each pack includes fixtures that reproduce official worked examples. Before a pack is adopted, an impact preview shows which employees and pay lines it would change.

### Gap 6: AI is either a chatbot or an uncontrolled agent

The leading vendors are racing to ship agents and MCP servers. In the coverage data, a native MCP server exists in 11 of 31 platforms and is absent or undocumented in 17. The better implementations show what good looks like. Rippling's MCP enforces its native role-based access control, redacts national identifiers and publishes rate limits [21]. Darwinbox uses OAuth 2.1 with PKCE and recomputes permissions on every request [22]. Gusto lets an assistant prepare a payroll but not submit it silently [23].

Regulation is tightening at the same time. The EU AI Act classes employment and worker-management AI as high-risk [24], and those rules apply from December 2027 [25]. New York City's Local Law 144 requires bias audits of automated employment decision tools [26]. The EEOC warns that AI in pay, promotion and termination can cause disparate-impact discrimination [27].

Meridian's rule is that AI suggests and humans decide. Agents use the delegating user's permissions. Consequential writes become draft actions that a human approves. Every agent step is recorded in the audit ledger.

### Gap 7: Lock-in through closed schemas and weak exports

Oracle exposes a very large API surface: 5,219 paths in its public OpenAPI file [8]. Workday's HR WSDL has 324 operations [9]. Even so, buyers depend on generic staging tables, report-as-API patterns and vendor-only extension models. The open-source alternatives have the opposite problem. Frappe HR is capable but is built on the Frappe framework [35]. Horilla is young [36]. Neither offers cells, bitemporal payroll evidence or a governed agent layer.

Meridian publishes a versioned public schema. It offers a full human- and machine-readable export of people, payroll, documents, permissions, audit events and workflow history. It also has an extension model that never requires direct database access.

### Gap 8: Frontline and mobile users are second-class

Every platform has a mobile app, but deskless workers still report problems with patchy connectivity, shared devices and biometric sync. The HROne and Zimyo profiles in the dossier record these complaints. Meridian treats offline, low-bandwidth and multilingual right-to-left use as core requirements, not as features for a later release.

## Product principles

These principles settle trade-offs when requirements conflict. They are ordered by priority.

1. **Correct pay beats new features.** Nothing ships that can change a payroll figure without a fixture proving the change.
2. **One way to do each thing.** Each capability has one owner module and one user interface surface. Duplicated features are treated as defects.
3. **Explain everything.** Every number, permission decision and agent action can be traced to its inputs and its rule.
4. **Fail small and recover fast.** Isolate each failure to a cell, a tenant or a pay group. Publish recovery targets and test them.
5. **Open by default.** The schema, APIs, country-pack format and exports are public. The core is never held back to sell an enterprise edition.
6. **AI suggests, humans decide.** Consequential actions always need an accountable human approval.
7. **Calm interface.** The default view shows the few things a person must do today. Depth is one step away, never in the way.

## Capability map: 11 modules instead of 34 products

The dossier classified 34 modules. Many incumbents sell each one as a separate SKU, which creates overlapping inboxes, rule builders, document stores and report writers. Meridian collapses them into 11 modules that share one kernel. Each module owns a clear set of nouns. Cross-cutting needs such as approvals, rules, documents, notifications, search and analytics are built once and reused everywhere.

![Meridian capability map with module dependencies](https://private-us-east-1.manuscdn.com/sessionFile/KGhbCBmkeEpMjagsxbq7Z1/sandbox/kTzfIkpS2jrD7Uh2lf3Fld-images_1795503748959_na1fn_L2hvbWUvdWJ1bnR1L2hyX3Jlc2VhcmNoL2RpYWdyYW1zL2NhcGFiaWxpdHlfbWFw.png?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvS0doYkNCbWtlRXBNamFnc3hicTdaMS9zYW5kYm94L2tUemZJa3BTMmpyRDdVaDJsZjNGbGQtaW1hZ2VzXzE3OTU1MDM3NDg5NTlfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwyaHlYM0psYzJWaGNtTm9MMlJwWVdkeVlXMXpMMk5oY0dGaWFXeHBkSGxmYldGdy5wbmciLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3OTcyOTI4MDB9fX1dfQ__&Key-Pair-Id=K2QY5QTL8JSY6C&Signature=MEUCIQCC9QUCxi3Mt2-46gUjm-DMb9MyJZOwE0grpnbbV7L-ZgIgQyRaCXd~HF9JKaRv394eSalJwEYfjs2H2g~L0O9vVzI_)

The arrows in the map point from a module to the modules it depends on. The build order follows them upward: kernel first, then people-core, then flow, then time and pay.

### Shared services that remove duplication

Several incumbent "modules" are really the same machinery in different clothes. Meridian builds each of these once:

- **One approvals inbox.** Leave, expenses, offers, shift swaps, payroll sign-off, agent draft actions and helpdesk escalations all land in the same inbox. They share delegation, SLA timers and mobile actions.
- **One rules engine.** Eligibility, accruals, overtime, approval routing, pay formulas and policy checks are all expressed in CEL (Common Expression Language, a small, safe expression language) with effective dates and test fixtures. There is no second "workflow condition builder".
- **One journey builder.** Onboarding, offboarding, transfers, probation confirmation and contractor conversion are all journeys: ordered tasks with owners, due dates and conditions.
- **One document service.** Letters, policies, contracts, payslips, tax forms and e-signature use one template engine, one store and one retention policy.
- **One metrics layer.** Headcount, attrition, overtime cost and payroll variance are each defined once. Dashboards, reports, exports, the assistant and MCP tools all read the same definitions.
- **One notification and search service.** It serves the web app, mobile, email, WhatsApp/SMS and chat apps.

Some incumbent features are merged because they describe the same need. Goals, OKRs, KRAs and KPIs become one goals model with configurable frameworks. Policies, the knowledge base and policy Q&A become one knowledge service that both the helpdesk and the assistant use. Timesheets and attendance become one time ledger with two views. Reimbursements, expenses, travel and advances become one spend flow that feeds payroll or accounts payable.

### Module scope: parity, advanced, and deliberately not doing

For each module, "parity" lists what a buyer switching from Keka, greytHR or BambooHR expects on day one. "Advanced" lists where Meridian goes beyond the incumbents. "Not doing" keeps scope honest.

**kernel.** Parity: tenants, legal entities, SSO (SAML/OIDC), MFA, roles, audit trail, multi-language UI. Advanced: cell placement and residency, relationship-based access control plus field-level policy, passkeys and phone OTP for deskless staff, a hash-chained audit ledger that customers can verify, a metadata layer for custom fields and objects with versioned schemas, and crypto-shredding for data erasure. Not doing: a general low-code app platform. Custom objects exist to extend HR data, not to build unrelated apps.

**people-core.** Parity: employee records, the directory, org chart, positions, departments, locations, documents, lifecycle history and bulk import. Advanced: bitemporal history that answers both "what was true on 1 March" and "what did payroll know on 1 March"; one person with many employments (employee, contractor, intern, gig worker, rehire); stable business keys separate from internal IDs, a lesson from Oracle's composite keys; and validate-only and dry-run modes on every import, a lesson from Workday [47]. Not doing: a full CRM-style contact database.

**flow.** Parity: onboarding and offboarding checklists, approvals, letters, announcements and notifications. Advanced: durable journeys that survive restarts; SLA timers with automatic escalation; delegation while a person is on leave; and one inbox that works the same on web, mobile, chat and MCP. Not doing: a separate "workflow product" with its own pricing.

**time.** Parity: attendance from web, mobile, GPS, geofence, biometric and kiosk; shifts and rosters; leave policies and accruals; holidays; overtime; regularisation; and timesheets against projects. Advanced: an append-only time ledger with signed offline punches; an edge agent that bridges biometric devices over LAN and survives internet loss; rule-checked rosters that warn before a shift breaks labour law or creates overtime cost; and continuous pay preview as time is captured, the pattern Dayforce markets for payroll (see the Dayforce profile in the dossier). Not doing: advanced labour forecasting for retail demand in version 1. It is planned for a later phase through the metrics layer.

**pay.** Parity: India payroll (PF, ESI, PT, LWF, TDS, Form 16, Form 24Q, challans), UAE WPS/SIF, Saudi GOSI and Mudad files, Philippine BIR/SSS/PhilHealth/Pag-IBIG, full and final settlement, arrears, loans and advances, reimbursements, bank files, payslips, GL journals, and contractor payments. Advanced: a deterministic Rust payroll engine; signed country packs with legal citations and fixtures; continuous preview; a line-by-line explanation of every payslip; recalculation of only the affected people after a fix; multi-entity and multi-currency runs; a parallel-run migration harness; the offline continuity kit; and earned wage access through partner rails, controlled by the employer. Not doing: becoming an employer of record or a licensed money transmitter. EOR, money movement and benefits brokerage connect through partners using an open connector contract.

**talent.** Parity: requisitions, job posting, ATS pipeline, interviews, offers, goals and OKRs, review cycles, 360 feedback, 1:1s, skills and succession. Advanced: structured, evidence-based reviews in which managers see goal progress and feedback history in one place; calibration with bias checks such as rating distribution by group; and a skills graph shared with learning links. Not doing: AI scoring or ranking of candidates, and flight-risk or emotion prediction. These are high-risk under the EU AI Act [24] and are a liability for customers.

**rewards.** Parity: salary structures, pay bands, compensation review cycles, bonuses, benefits enrolment and total-rewards statements. Advanced: budget-aware compensation cycles that preview payroll cost before approval, using the same engine; pay-equity analysis; and benefits through a partner contract. Not doing: in-house insurance brokerage.

**service.** Parity: HR helpdesk tickets, categories, SLAs, the knowledge base, policy documents and letter requests. Advanced: grounded policy answers with citations to the exact policy version; and the ability to turn an answer into a ticket or action in one step. Not doing: a general IT service desk. Device management connects through integrations.

**insight.** Parity: standard reports, a custom report builder, dashboards, scheduled exports and headcount and attrition analytics. Advanced: one governed metrics layer with lineage; effective-dated snapshots; payroll-register reconciliation; natural-language questions that compile to the metrics layer instead of raw SQL; and headcount planning that writes approved positions back to people-core. Not doing: a general BI tool. Meridian exposes a governed SQL and Parquet feed for Power BI, Superset or Metabase.

**platform.** Parity: a REST API, webhooks, SCIM, SSO, an integration marketplace, and accounting and ERP connectors (Tally, Zoho Books, QuickBooks, Xero, SAP, NetSuite). Advanced: an OpenAPI-first contract with a one-version rule and deprecation windows; idempotency keys on every write; transactional batch writes, following Workday's Batch Protocol [7]; snapshot and delta feeds, following SAP's CompoundEmployee API [6]; signed webhooks with replay; WASM plugins that run in a sandbox; and a typed connector SDK. Not doing: GraphQL in version 1. One well-designed API surface is easier to keep stable, which applies Hyrum's Law from the API-design skill.

**intelligence.** Parity: an in-app assistant for employees and managers, and AI help with writing job descriptions, letters and summaries. Advanced: a first-class MCP server; a bounded catalogue of agents with an approval gate; payroll anomaly detection; agent registry, evaluations and kill switches; and a choice of hosted or self-hosted models. Not doing: autonomous decisions about hiring, firing or pay.

## User experience: clean, organized and fast

### Information architecture

The incumbents expose their org chart of modules in the navigation. Meridian organizes around what a person needs to do. Every role sees the same six spaces, filtered by permission:

1. **Home.** One inbox of things to do, today's schedule, and the next pay date. Most employees never need to leave it.
2. **People.** The directory, profiles, the org chart, positions and journeys.
3. **Time.** Attendance, leave, shifts and timesheets on one calendar.
4. **Pay.** Pay runs, payslips, expenses, compensation and benefits.
5. **Grow.** Goals, reviews, feedback, hiring and skills.
6. **Insights.** Metrics, reports and planning.

Settings, the helpdesk and the assistant are always reachable from the top bar. They are not separate apps.

Four interaction rules keep the interface calm:

- **A command palette** (Ctrl/Cmd+K) finds any person, action, report or setting. The palette and the assistant share the same command registry.
- **Progressive disclosure.** Each page shows a summary, then the detail one click away, then an audit trail one click further.
- **Every list is an inbox.** Lists support bulk actions, saved filters and keyboard shortcuts.
- **No dead ends.** Every error explains what happened and the next step. Every number links to its explanation.

### Key journeys and the target experience

The interface is designed and tested around journeys, not screens. Each journey has a measurable target:

- An employee applies for leave on mobile in under 15 seconds. This includes the balance check and the conflict warning.
- A manager clears 20 approvals from the mobile inbox in under two minutes. The inbox shows the context and the cost impact before approval.
- A payroll admin goes from input freeze to bank file for 1,000 employees in under 30 minutes. Exceptions are grouped and each has a suggested fix.
- A new hire completes onboarding tasks and documents in one guided flow, with e-signature and no paper.
- An employee asks "why is my net pay lower this month?" and gets a line-by-line answer that cites the rule and the input change.

### Design system

The frontend is a React and TypeScript progressive web app. It uses Radix primitives and shadcn-style components with design tokens for colour, spacing, type and motion. One token set drives light mode, dark mode and high-contrast mode.

Following the frontend-ui-engineering skill, the UI targets WCAG 2.2 AA. It is fully keyboard-operable, supports screen readers, uses logical CSS properties so Arabic and Urdu right-to-left layouts work without forks, and keeps the main bundle small so pages are interactive within 2.5 seconds on a mid-range Android phone over 3G. Language packs ship for English, Hindi, Arabic, Tamil, Telugu, Bengali, Marathi, Filipino, Bahasa and others through community translation. Numbers, dates and currencies follow the locale, including the Indian lakh and crore format.

The mobile app is React Native and works offline first. Payslips, schedules, leave balances and documents are cached and encrypted on the device. Punches are signed with a device key and queued until the network returns. Kiosk mode lets several deskless workers share one device, using face or PIN checks and automatic sign-out.

## Technical architecture

![Meridian technical architecture: edge, cells, control plane and intelligence plane](https://private-us-east-1.manuscdn.com/sessionFile/KGhbCBmkeEpMjagsxbq7Z1/sandbox/kTzfIkpS2jrD7Uh2lf3Fld-images_1795503748959_na1fn_L2hvbWUvdWJ1bnR1L2hyX3Jlc2VhcmNoL2RpYWdyYW1zL2FyY2hpdGVjdHVyZQ.png?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvS0doYkNCbWtlRXBNamFnc3hicTdaMS9zYW5kYm94L2tUemZJa3BTMmpyRDdVaDJsZjNGbGQtaW1hZ2VzXzE3OTU1MDM3NDg5NTlfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwyaHlYM0psYzJWaGNtTm9MMlJwWVdkeVlXMXpMMkZ5WTJocGRHVmpkSFZ5WlEucG5nIiwiQ29uZGl0aW9uIjp7IkRhdGVMZXNzVGhhbiI6eyJBV1M6RXBvY2hUaW1lIjoxNzk3MjkyODAwfX19XX0_&Key-Pair-Id=K2QY5QTL8JSY6C&Signature=MEUCIQDnfbRiunCpCFu7bSGhieFIMSB9vu9w0cSsOTDVPQQt9AIgc4DtpMwLrNL~rbEIb~lECZZetYaX14YbnXYddB6buwc_)

The architecture has four planes. The **edge** handles TLS, the WAF, rate limits and routing each tenant to its home cell. A **cell** is a complete, independent copy of the application stack serving a bounded set of tenants in one region. The **control plane** handles provisioning, tenant placement, country-pack distribution, feature flags and fleet observability. It is never in the request path for payroll. The **intelligence plane** runs the assistant, agents and model gateway, and reaches the domain only through the same MCP and API surface that external clients use.

### Architecture decision records

The documentation-and-adrs skill recommends recording each significant decision with its context and consequences. The summaries below would become separate ADR files in the repository.

**ADR-001: A modular monolith inside each cell, not microservices.** Context: Square's payroll team found that more than 100 polling cron jobs caused availability and database-load problems. Moving to event-driven workflows and isolated filing services fixed this [48]. Gusto cut P90 to-do latency from about 1.1 seconds to about 500 milliseconds by persisting event-driven workflows instead of evaluating them at runtime [16]. Decision: each cell runs one deployable application, written in Go or Kotlin (to be decided in open question 2), split into strictly bounded modules with their own schemas and public interfaces. Durable workflows and the payroll engine run as separate worker pools. Consequences: simpler operations and transactions for a small open-source team. Module boundaries are enforced by architecture tests, so a module can be extracted later if load requires it.

**ADR-002: Regional cells with tiered tenant isolation.** Context: AWS documents three tenant-isolation models. In the pool model tenants share tables. In the bridge model they share a database but get separate schemas. In the silo model each tenant has its own database. PostgreSQL row-level security (RLS) enforces pool isolation, but table owners and BYPASSRLS roles can bypass it [51]. The Kronos incident shows the cost of a shared blast radius [1]. Decision: the long tail of small tenants uses pooled tables with forced RLS, and the application role never owns tables. Sensitive or large tenants get their own schema or database. Regulated tenants can get a dedicated cell. Each cell has its own database, queues, object store and keys. Consequences: one tenant or cell failure stays contained. The cell router and the placement service become critical components and are kept very simple.

**ADR-003: PostgreSQL as the system of record, with bitemporal facts.** Context: the teardowns confirm that effective dating is a core primitive at all three leaders. Workday exposes Effective_Date, As_Of_Date and As_Of_Moment [9]. SAP's EmpJob keys on startDate plus a sequence number [53]. Oracle uses EffectiveStartDate, EffectiveEndDate and EffectiveSequence [8]. Bitemporal history separates when a fact was true from when the system recorded it [52]. Decision: every HR fact carries a valid-time range and a record-time range. Corrections append new rows and never overwrite history. Issued pay results are immutable, and changes create compensating entries. Consequences: retroactive changes, audits and "what did payroll know" questions become plain queries. Storage grows, so partitioning by tenant and time is designed in from day one.

**ADR-004: Transactional outbox and a durable event backbone.** Decision: every domain change writes its event to an outbox table in the same transaction. A relay publishes it to NATS JetStream. Consumers are idempotent and carry tenant, correlation, causation and schema-version IDs. ClickHouse receives analytics data through change-data capture. Consequences: no event is lost or invented when a crash happens, and analytics never loads the transactional database. Events are not the source of truth; PostgreSQL is.

**ADR-005: Temporal for durable workflows.** Context: durable execution keeps workflow progress through worker crashes and retries [49]. Decision: pay runs, approvals, journeys, filings, bank instructions and long imports run as Temporal workflows. The financial ledger and payslips stay in PostgreSQL. Workflow state is never the record of money. Consequences: no hand-written retry or cron logic. Temporal is MIT-licensed, which keeps the stack open.

**ADR-006: A deterministic payroll engine in Rust, compiled to WASM as well.** Decision: the engine is a pure function. It takes an input snapshot and a country-pack version and returns results with a full trace. It uses fixed-point decimal arithmetic with explicit rounding rules and no floating point. The same code compiles to WASM, so the browser can run what-if calculations ("what if I opt for the new tax regime?") without a server round-trip. Consequences: results can be reproduced bit for bit, years later, from the stored snapshot and the pack digest.

**ADR-007: Country packs as signed, versioned, tested rule bundles.** Context: OpenFisca shows that rules-as-code for tax and benefits works, but it is AGPL and Python-based [41]. The regulatory study shows each pack must separate five layers. These are taxes and social insurance; filings and payment files; employment rules that change calculations; data rights; and evidence. Decision: a country pack is a bundle of CEL rules, tables and templates. Each rule cites its legal source and effective date. Fixtures reproduce official examples, such as EPFO and ESIC contribution examples [46]. A WASM escape hatch handles the rare rule that CEL cannot express. Packs are signed with Sigstore. Tenants pin a version and adopt a new one only after an impact preview. Consequences: the community can maintain local packs under an Apache licence, and certified packs with update SLAs become a commercial offering.

**ADR-008: Relationship-based authorization plus field-level policy.** Context: OpenFGA implements Zanzibar-style relationship checks [50]. Oracle's documented model combines job, duty and data roles. SAP scopes API permissions by entity, field and target population [6]. Decision: OpenFGA answers relationship questions, such as whether a person manages someone or is the HR partner for a legal entity. Cerbos evaluates contextual rules, such as "salary fields are visible only to compensation admins, and only for their entities" [44]. The same check runs in the UI, the API, exports, search, reports, MCP and background jobs. Consequences: there is no path that skips authorization, which is the main risk the Oracle teardown identifies.

**ADR-009: Open, standard identity.** Decision: Keycloak or Zitadel (to be decided in open question 2) handles OIDC, SAML 2.0, SCIM provisioning, passkeys, MFA and phone OTP [40]. Human and agent principals are separate types. Agents get short-lived, task-scoped tokens. Consequences: SSO and SCIM come free in every edition, so there is no "SSO tax".

**ADR-010: Envelope encryption with tenant keys and crypto-shredding.** Decision: sensitive fields are encrypted at the application level with per-tenant data keys. These include national IDs, bank details, salary, health and documents. Data keys are wrapped by OpenBao or a cloud KMS, and enterprise tenants can bring their own key. Erasure destroys a person's key, so backups and replicas become unreadable for that person. Consequences: DPDP and GDPR erasure requests can be met without rewriting backups. Search indexes and analytics must use tokenized values.

### Data model

![Meridian core data model](https://private-us-east-1.manuscdn.com/sessionFile/KGhbCBmkeEpMjagsxbq7Z1/sandbox/kTzfIkpS2jrD7Uh2lf3Fld-images_1795503748959_na1fn_L2hvbWUvdWJ1bnR1L2hyX3Jlc2VhcmNoL2RpYWdyYW1zL2RhdGFfbW9kZWw.png?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvS0doYkNCbWtlRXBNamFnc3hicTdaMS9zYW5kYm94L2tUemZJa3BTMmpyRDdVaDJsZjNGbGQtaW1hZ2VzXzE3OTU1MDM3NDg5NTlfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwyaHlYM0psYzJWaGNtTm9MMlJwWVdkeVlXMXpMMlJoZEdGZmJXOWtaV3cucG5nIiwiQ29uZGl0aW9uIjp7IkRhdGVMZXNzVGhhbiI6eyJBV1M6RXBvY2hUaW1lIjoxNzk3MjkyODAwfX19XX0_&Key-Pair-Id=K2QY5QTL8JSY6C&Signature=MEUCIQDP9jwp5OTtdGYJncxqrTepn1dK-jM3hxnOf1T4oxqAoQIgY7PWzYNCs8x-3FYNa7RirYgFf6v9h9bvUIsv31RRcOw_)

The model separates a person from their employments. This lets one person be an employee in one entity, a contractor in another, and a rehire later, without duplicate records. Assignments link an employment to a position, an org unit and a location over time. Compensation elements are effective-dated and attached to the assignment.

Time events and leave entries are append-only ledgers, so balances are always derived and auditable. A pay run is pinned to a country-pack version. Each pay result holds its lines and the hash of its input snapshot. The audit ledger is hash-chained per tenant. Customers can export it and check it independently.

Custom fields and objects live in a metadata layer. This follows the Workday and SAP pattern of metadata-defined objects, but with one change the teardowns recommend: every metadata change creates a new schema version. API shapes never change silently.

### The payroll pipeline

![Meridian payroll pipeline from continuous inputs to continuity kit](https://private-us-east-1.manuscdn.com/sessionFile/KGhbCBmkeEpMjagsxbq7Z1/sandbox/kTzfIkpS2jrD7Uh2lf3Fld-images_1795503748959_na1fn_L2hvbWUvdWJ1bnR1L2hyX3Jlc2VhcmNoL2RpYWdyYW1zL3BheXJvbGxfcGlwZWxpbmU.png?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvS0doYkNCbWtlRXBNamFnc3hicTdaMS9zYW5kYm94L2tUemZJa3BTMmpyRDdVaDJsZjNGbGQtaW1hZ2VzXzE3OTU1MDM3NDg5NTlfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwyaHlYM0psYzJWaGNtTm9MMlJwWVdkeVlXMXpMM0JoZVhKdmJHeGZjR2x3Wld4cGJtVS5wbmciLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3OTcyOTI4MDB9fX1dfQ__&Key-Pair-Id=K2QY5QTL8JSY6C&Signature=MEQCIBNl-wvekCkbHsXGvs3IhcP5FU7A2Bl-Lz0kENh8HL-EAiBMUGO~yYkVT2z1RYyV5gdJazHGz3TRA0ZpY3dpijSCkQ__)

Payroll is continuous, not a monthly scramble. Every time, leave or compensation change triggers a preview recalculation for the affected employee. The admin always sees the current projected payroll and its variance against last period.

At cut-off, inputs freeze into an immutable, hashed snapshot. The engine then calculates in parallel by pay group, with bounded worker pools, checkpointing and backpressure. Statutory deadlines are always scheduled ahead of bulk analytics work.

Results pass through validation gates. These include rule checks, variance thresholds against last period, and AI anomaly flags such as a duplicate bank account or an unexpected tax jump. Exceptions go to a queue grouped by cause. After a fix, only the affected employees are recalculated. Approval follows a maker-checker rule: the person who prepared the run cannot approve it. The approver uses step-up authentication.

Locking the period makes the results immutable. It also triggers the downstream outputs: bank files or bank API instructions with idempotency keys, WPS/SIF files where required, statutory returns and challans, GL journals and payslips. Bank status is reconciled against expected payments. The continuity kit is written to customer-controlled storage.

### Integration surface

Meridian has one public contract. That contract is an OpenAPI 3.1 REST API with cursor pagination, field selection, validate-only mode and idempotency keys on every write. It also includes transactional batch requests with dependencies; signed webhooks with replay and a dead-letter view; snapshot and delta feeds for data warehouses; SCIM 2.0; and bulk import lanes.

The import lanes learn from Oracle's HCM Data Loader. They have request IDs, per-line status, failed-line files, rollback and reconciliation keys, but the public contract is the typed API, not the staging tables. Rate limits are per tenant and per client, and return Retry-After headers. They are designed as published quotas, like SAP's 600 requests per minute per tenant [6], but with a separate lane for bulk migration so that go-live is never blocked by a quota.

Following the api-and-interface-design skill, the API obeys a one-version rule. There is one current version, additive changes only within it, and a deprecation window of at least 12 months with usage telemetry before anything is removed.

### Extensibility without forks

Customers extend Meridian in three ways. Custom fields and objects are declared in metadata and appear automatically in the API, the UI, reports and MCP. Rules and journeys are configured in CEL and the journey builder, with test fixtures and sandbox promotion. Plugins are WASM modules that run in a sandbox with declared capabilities. A plugin can call the public API and subscribe to events. It cannot touch the database directly or call the network without an allowlist.

Every tenant gets a free sandbox that is masked and refreshed from production. Changes are promoted from sandbox to production with a diff and an impact report.

## Reliability engineering

### Service level objectives

The targets below are Meridian's own commitments for the managed cloud. They will be published and reported monthly. Self-hosted operators get the same runbooks and dashboards.

| Capability | Availability SLO | RPO | RTO within region | RTO after region loss |
|---|---|---|---|---|
| Payroll calculation, approval and bank files | 99.95% | under 1 minute | under 1 hour | under 4 hours |
| Time capture (web, mobile, devices) | 99.95%, plus offline capture | 0 for queued punches | under 30 minutes | under 4 hours |
| Employee self-service and inbox | 99.9% | under 1 minute | under 1 hour | under 8 hours |
| Analytics and reports | 99.5% | under 15 minutes | under 4 hours | under 24 hours |
| Assistant and agents | 99.5% | not applicable | degrade to manual UI | degrade to manual UI |

For comparison, Workday and Oracle publish a 12-hour RTO and a one-hour RPO [4] [5]. Meridian reaches its targets with synchronous replicas inside each cell, continuous WAL archiving to a second region, and restore drills.

### Designing for failure

Each cell is sized to a fixed maximum number of employees. Cells are added as the platform grows, and existing cells are not scaled up indefinitely. Releases roll out through rings: internal tenants, then a canary cell, then 10% of cells, then the rest. Automatic rollback triggers on SLO burn. Every risky feature sits behind an OpenFeature flag with a kill switch.

The platform degrades in a defined order. The assistant switches off first, then analytics, then non-urgent notifications. Payroll and time capture are protected last.

Quarterly game days rehearse specific failures, including:

- loss of a cell or a region
- corrupted country-pack versions
- duplicate bank messages
- delayed bank acknowledgements
- a stuck Temporal cluster
- a ransomware scenario with restore into a clean room.

### Observability

Following the observability skill, every service emits OpenTelemetry traces, metrics and logs [39]. PII is redacted in the collector. Request-driven services are measured by RED metrics: rate, errors and duration. Resources are measured by USE metrics: utilisation, saturation and errors.

Payroll gets its own domain signals:

- queue lag by pay group
- calculation latency per thousand employees
- the share of runs with exceptions
- variance against the previous period
- approval age
- bank acknowledgement delay
- duplicate-instruction count.

Alerts fire on symptoms users feel, such as "payroll preview older than 5 minutes" or "punch sync backlog over 10 minutes". Each alert links to a runbook. A public status page reports by cell and capability.

## Security and privacy

The security-and-hardening skill asks for a threat model, clear trust boundaries and secure defaults. The STRIDE review below covers spoofing, tampering, repudiation, information disclosure, denial of service and privilege escalation. Its highest-impact threats and their controls are:

1. **Bank-detail change fraud.** An attacker or insider redirects a salary payment. Controls: bank changes need step-up authentication, a cooling-off period before the first payment, a notification to the employee on a second channel, and maker-checker approval on payroll.
2. **Cross-tenant data leaks.** Controls: forced RLS with no owner role in the application, tenant IDs in every cache and search key, automated cross-tenant penetration tests in CI, and per-tenant encryption keys.
3. **Payroll tampering after approval.** Controls: immutable locked results, hash-chained audit, signed bank files, and reconciliation against approved totals.
4. **Agent misuse or prompt injection.** Controls: delegated permissions, typed tools, approval gates, egress limits and audit. These are described in the next section.
5. **Supply-chain compromise.** Controls: SBOMs, signed releases with Sigstore, SLSA level 3 build provenance, pinned dependencies, and reproducible builds for the payroll engine.

The skill's three-tier boundary model is applied as follows. **Always allowed** is limited to reading one's own data and data within one's permitted population. **Needs confirmation** covers any write that affects pay, bank details, employment status or access rights; these need approval and step-up authentication. **Never allowed** covers bulk export of national IDs or bank details without a dual-control request, and any agent approving its own action.

Privacy is designed in. Data minimisation applies per field. Retention schedules are set per country and per document type. Consent and purpose are recorded under the DPDP Act and Rules [28] and GDPR. Data-subject requests are handled through a self-service workflow. Data stays in its home region, and backups, logs and search indexes stay in the same residency boundary.

The managed cloud targets SOC 2 Type II and ISO 27001 within the first 18 months, and ISO 27701 after that. All security documentation is public in the repository, so self-hosted users can run the same controls.

## Intelligence plane: assistant, agents and MCP

### Design stance

AI in Meridian has three jobs. It answers questions with citations. It prepares work so that humans can approve it faster. It spots problems before they reach a payslip. It never does arithmetic on pay, because the deterministic engine does that. It never makes a final decision on hiring, termination, pay or worker classification.

This keeps Meridian clear of the high-risk employment uses defined in Annex III of the EU AI Act [24], while still giving people most of the time saved. Where a customer enables a feature that touches candidates, such as interview summaries, Meridian provides the notices, logs, human-oversight records and bias-audit data that the AI Act and NYC Local Law 144 require [26].

### How an agent action flows

![Agent and MCP flow with permission checks and approval gate](https://private-us-east-1.manuscdn.com/sessionFile/KGhbCBmkeEpMjagsxbq7Z1/sandbox/kTzfIkpS2jrD7Uh2lf3Fld-images_1795503748959_na1fn_L2hvbWUvdWJ1bnR1L2hyX3Jlc2VhcmNoL2RpYWdyYW1zL2FnZW50X21jcF9mbG93.png?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvS0doYkNCbWtlRXBNamFnc3hicTdaMS9zYW5kYm94L2tUemZJa3BTMmpyRDdVaDJsZjNGbGQtaW1hZ2VzXzE3OTU1MDM3NDg5NTlfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwyaHlYM0psYzJWaGNtTm9MMlJwWVdkeVlXMXpMMkZuWlc1MFgyMWpjRjltYkc5My5wbmciLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3OTcyOTI4MDB9fX1dfQ__&Key-Pair-Id=K2QY5QTL8JSY6C&Signature=MEUCIQCpUBhAyGJNXBJDNSICaZxd32HtaxeWsosUgB1v6mXTEQIgZYFjfN2M~V12l4X6gJsYUtWOlnwIRsFgyeeLrNIY22I_)

In the flow above, a manager asks the assistant to approve a leave request and move a shift. The leave approval is low risk and within the manager's rights, so it commits straight away. The shift change creates overtime cost, so the policy engine marks it as risky. It becomes a pending action in the approvals inbox, with the cost difference shown. The manager confirms, and the audit ledger records both identities: the agent, and the user it acted for.

### MCP server

Meridian ships a first-party MCP server that follows the 2026-07-28 MCP specification [17]. It uses the Streamable HTTP transport [45]. Authorization follows the specification's OAuth 2.1 model: PKCE, Protected Resource Metadata, Resource Indicators and strict audience validation, with no token passthrough [18]. Missing inputs are requested through elicitation. Secrets and third-party OAuth flows use URL-mode elicitation, so the model never sees them [19]. Every tool returns structured output against a JSON Schema [20]. Results include source citations, the affected records, warnings and an idempotency key.

Tools are narrow and typed, and they come in four stages. There is no generic SQL tool or raw API proxy.

- **Read:** people.search, people.get_profile, time.get_balances, pay.get_payslip, policy.search, approvals.list
- **Analyze:** pay.explain_payslip, pay.variance_report, time.overtime_risk, insight.query_metric (which compiles to the governed metrics layer)
- **Draft:** time.draft_leave_request, flow.draft_letter, pay.prepare_run, talent.draft_review_summary, service.draft_case_reply
- **Commit:** approvals.decide, time.submit_leave_request, service.create_case. Commits that touch pay, bank details, employment status or access always become pending actions for an authorised human.

The server checks permissions on every call using the same OpenFGA and Cerbos policies as the UI. Tenant administrators choose which tools are exposed and to which roles. Rate limits are published. The default is 60 tool calls per minute per user and 10 concurrent agent runs per tenant, comparable to the 50 calls per 60 seconds that Rippling publishes [21].

The official MCP Registry is a metadata catalogue, not a security endorsement [38]. Meridian therefore pins and verifies any third-party MCP servers that its own agents call. For agent-to-agent collaboration, such as a customer's procurement agent asking Meridian's onboarding agent to provision a laptop, Meridian adds the A2A protocol in phase 3. A2A complements MCP rather than replacing it [37].

### Bounded agent catalogue

Meridian ships eight agents. Each has a clear owner, declared tools, a risk tier and evaluation suites. The list is deliberately short:

1. **Employee helper:** leave, payslips, policies, letters and tickets, by chat, voice or WhatsApp.
2. **Manager copilot:** approvals with context, team schedule conflicts, review preparation.
3. **Payroll variance analyst:** explains changes against the last period and flags anomalies before approval.
4. **Onboarding coordinator:** chases tasks and documents and answers new-hire questions.
5. **Policy and knowledge answerer:** grounded answers that cite the exact policy version.
6. **Compliance watcher:** reads official gazettes and circulars, maps them to affected rules, and drafts a country-pack change with fixtures for human maintainers to review.
7. **Recruiting coordinator:** interview scheduling, job-description drafts and interview-note summaries. It never scores or ranks candidates.
8. **Migration assistant:** maps legacy exports from Keka, greytHR, Zoho, BambooHR and others to the Meridian schema, then runs the parallel-run reconciliation.

### Model gateway and data protection

The model gateway routes each request to a hosted frontier model or a self-hosted open-weight model served through vLLM, depending on the tenant's choice and residency rules. Before any prompt leaves the cell, PII is tokenized. Retrieval uses tenant-partitioned pgvector indexes that honour the same permissions as the UI. A user only retrieves documents they are allowed to open.

Customer data is never used to train shared models. The agent registry records each agent's owner, version, tools, data classes, model, region, risk tier and expiry, and it shows diffs when tool definitions change. There is one kill switch per agent and one per tenant.

### Evaluations

Every agent change runs against evaluation suites. These measure:

- citation correctness
- permission leakage, using adversarial users who try to read data outside their population
- resistance to prompt injection in documents and tickets
- safe failure when tools return errors
- disparate impact in any summarisation that touches people
- latency and cost.

Production telemetry tracks the rate at which humans override agent suggestions. A rising override rate triggers a review.

## Open-source model and pricing

### Licence and governance

The open-source study compared the licence choices of comparable projects. Cal.com moved from MIT to AGPL-3.0 to stop hosted forks from taking the code without contributing back [31]. HashiCorp's move to the Business Source License [32] led to the OpenTofu fork under the Linux Foundation [33]. Redis's shift to source-available licensing [34] produced Valkey. These cases show that a broken licence promise costs more trust than the licence text protects.

Meridian therefore proposes three licences:

- **AGPL-3.0** for the server core.
- **Apache-2.0** for the SDKs, the connector SDK, the country-pack format and community country packs. This lets partners, banks and payroll bureaus embed them freely.
- **CC BY 4.0** for documentation.

Contributors sign off under the DCO, not a CLA. The project publishes a pledge never to relicense the core to a non-open-source licence. Within three years, it would move the trademark and the pledge to a neutral foundation.

### What is free and what is paid

Every module is free in the open-source edition, including SSO, SCIM, audit, the API, MCP and exports. Revenue comes from four sources:

- the managed cloud
- certified country packs with update SLAs and filing support
- support and implementation services
- a revenue share on marketplace apps from partners.

This answers the budget gap directly. Customers pay for operations and guarantees, not for features held back.

### Hosted pricing hypothesis

To test with design partners, the proposal is one plan with all modules. It would cost about US$3 per employee per month, or about ₹199 in India, including payroll for one country. Each additional payroll country would cost about US$1 per employee per month. Usage of the assistant and agents would be included within a fair-use limit. Above that limit, the customer pays the published price of the model plus a small margin, or brings their own model.

For comparison, Rippling starts at $8 per employee before add-ons [11]. BambooHR's tiers range from roughly $10 to $25 [12]. These figures are hypotheses and need validation against the actual cost to serve.

## Engineering system

### CONSTRAINTS.md

The constraint-driven-development skill recommends writing hard thresholds into the repository, so that every change and every coding agent is checked against them. The proposed constraints are:

- **Performance:** API reads p95 under 200 ms and writes p95 under 400 ms within a cell. Initial web bundle under 200 KB gzipped. Payroll calculation for 10,000 employees under 5 minutes on a standard worker pool.
- **Correctness:** no change to the pay module merges without passing 100% of country-pack fixtures, property tests and mutation testing on the engine.
- **Architecture:** no module imports another module's internals, enforced by architecture tests. No new direct database access from plugins. No floating point in money code.
- **Compatibility:** database migrations use expand-and-contract and stay backward-compatible for one release. API changes are additive within a version.
- **Security:** zero known high or critical CVEs at release. Every endpoint is covered by an authorization test. No secrets in code.
- **Accessibility:** zero critical axe violations on the key journeys.
- **Compliance:** every statutory rule cites its legal source and effective date.

### Testing and delivery

The test pyramid has four layers:

- Unit and property tests. For example, gross minus deductions always equals net, and rounding never produces a cent that does not exist.
- Golden fixtures for every country pack.
- Contract tests generated from the OpenAPI specification.
- End-to-end tests for the key journeys, run in Playwright on web and Detox on mobile.

Load tests run each week at twice the largest cell's capacity. Chaos tests run in staging before every ring promotion.

Following the ci-cd and shipping-and-launch skills, development is trunk-based with required checks and preview environments for each pull request. Releases are staged through deployment rings. Each release has a written rollback plan and a launch checklist covering monitoring, runbooks, documentation and customer communication.

### Deployment profiles

The same codebase runs in three profiles:

| Profile | Who it is for | How it runs |
|---|---|---|
| Solo | Up to about 500 employees, self-hosted | One Docker Compose stack with embedded Temporal, NATS and object storage |
| Scale | Large self-hosted enterprises or payroll bureaus | Kubernetes with Helm charts, external PostgreSQL, a Temporal cluster and optional ClickHouse |
| Cloud | The managed service | Multiple regional cells (India, UAE, EU, US first) behind the cell router, with a separate control plane |

## Roadmap with acceptance criteria

The planning-and-task-breakdown skill recommends vertical slices: each phase delivers something a real customer can use from end to end.

**Phase 0, foundations (months 0 to 3).** Scope: kernel, a basic people-core, a cell in a box, CI, ADRs, CONSTRAINTS.md and the design system. Acceptance: a tenant can sign in with SSO and import 1,000 employees using validate-only mode. The audit trail is complete. Cross-tenant isolation tests pass. The Solo profile installs in under 15 minutes.

**Phase 1, India payroll slice (months 3 to 9).** Scope: time and leave, the flow inbox, the India country pack (PF, ESI, PT, LWF, TDS, Form 16, 24Q and challans), payslip explanations, bank files, offline mobile self-service, the biometric edge agent and a read-only MCP server. Acceptance: three design partners each run two parallel payroll cycles against their current vendor. No variance above ₹1 is left unexplained. A 1,000-employee run takes under 30 minutes from freeze to bank file.

**Phase 2, Gulf and Philippines, talent and service (months 9 to 15).** Scope: UAE WPS/SIF, Saudi GOSI and Mudad, and Philippine packs; goals, reviews and ATS; the helpdesk; the metrics layer; MCP draft and commit with approvals; managed cloud general availability in the India and UAE cells; and SOC 2 Type I. Acceptance: a multi-entity customer runs India and UAE payroll in one tenant. The published SLOs are met for 90 days.

**Phase 3, ecosystem (months 15 to 24).** Scope: rewards and planning; the marketplace and WASM plugins; partner connectors for EOR and earned wage access; community packs for Singapore, Malaysia, the UK and the US with partners; A2A; SOC 2 Type II and ISO 27001. Acceptance: at least five community-maintained country packs pass certification. Plugin sandbox penetration tests pass.

A realistic core team for phases 0 to 2 is about 12 to 16 engineers. This includes two payroll domain experts per launch country, plus design, security and developer relations.

## How the agent-skills and REA methods shaped this blueprint

The user asked for skills from the addyosmani/agent-skills repository [42] to be applied. Each was used for a specific part of this document:

- **spec-driven-development:** the overall structure of objective, evidence, scope, decisions, boundaries, acceptance criteria and open questions.
- **idea-refine:** narrowing 34 incumbent modules down to 11, with explicit "not doing" lists.
- **api-and-interface-design:** the one-version rule, Hyrum's Law, idempotency keys and the choice of a single REST contract.
- **security-and-hardening:** the STRIDE review, the three-tier boundaries and the LLM-specific risks.
- **documentation-and-adrs:** the ten ADRs.
- **constraint-driven-development:** CONSTRAINTS.md.
- **observability:** RED and USE metrics, symptom-based alerts and runbooks.
- **frontend-ui-engineering:** WCAG 2.2 AA, design tokens and performance budgets.
- **planning-and-task-breakdown:** the vertical-slice roadmap.
- **ci-cd and shipping-and-launch:** delivery and rollout.
- **context-engineering:** the agent registry, tool scoping and retrieval design.

The REA repository [43] was applied for its evidence-first method: every conclusion about the backends of Workday, SAP SuccessFactors and Oracle HCM is graded CONFIRMED, INFERRED or UNKNOWN. That analysis used only lawful public material. This included downloading and parsing Workday's public HR WSDL and XSD, Oracle's public OpenAPI file and SAP's public API guide, along with vendor whitepapers, trust documents and engineering pages. No proprietary software was decompiled or traced. REA's own licence limits it to authorised software, vendor terms forbid reverse engineering, and an open-source project needs a clean-room record to stay safe from copyright claims. The full teardowns are in the research dossier.

## Decisions needed before any build

Nothing will be built until you approve. These are the decisions that would unlock Phase 0:

1. **Scope and name.** Do you approve the 11-module scope and the "not doing" lists? Should the codename Meridian stay?
2. **Core stack.** My recommendation is Go for the application, Rust for the payroll engine and Keycloak for identity. The alternatives are Kotlin for the application and Zitadel for identity.
3. **Licence.** AGPL-3.0 core with Apache-2.0 SDKs and packs, as recommended, or Apache-2.0 for everything. Apache-2.0 everywhere maximises adoption but allows closed hosted forks.
4. **First markets.** India plus UAE first, as recommended, or a different pair.
5. **Pricing hypothesis.** Should the one-plan, all-modules hosted price of about US$3 or ₹199 per employee per month be tested with design partners?
6. **Design partners.** Can you introduce three companies with 200 to 2,000 employees willing to run parallel payroll in Phase 1?
7. **Build approval.** On approval, I would start only Phase 0: the repository, ADRs, CONSTRAINTS.md, the kernel and the cell-in-a-box. I would then report back before Phase 1.

## References

[1]: https://www.aha.org/h-isac-reports/2021-12-13-h-isac-tlp-white-kronos-private-cloud-kpc-ransomware-incident-causes "Kronos Private Cloud ransomware incident causes downtime"
[2]: https://attheu.utah.edu/facultystaff/kronos-service-outage-and-impacts/ "University of Utah Kronos service outage and impacts"
[3]: https://publications.gc.ca/collections/collection_2018/bvg-oag/FA1-27-2018-1-1-eng.pdf "Auditor General of Canada - Building and Implementing the Phoenix Pay System"
[4]: https://www.workday.com/content/dam/web/se/documents/datasheets/datasheet-workday-security-se.pdf "Workday security and data privacy datasheet"
[5]: https://www.oracle.com/contracts/docs/saas_public_cloud_services_pillar_3610529.pdf "Oracle SaaS Cloud Services Pillar Document"
[6]: https://help.sap.com/doc/a7c08a422cc14e1eaaffee83610a981d/2611/en-US/SF_HCM_OData_API_DEV.pdf "SAP SuccessFactors API Reference Guide 2H 2026"
[7]: https://developer.workday.com/documentation/GUID-52feabc4-6c3e-4cd4-a4bc-cf58a5bdfab7-enHYPHENus/ConceptBatchProtocolforWorkdayRESTAPIs "Workday Batch Protocol for REST APIs"
[8]: https://docs.oracle.com/en/cloud/saas/human-resources/farws/openapi.json "Oracle Fusion Cloud HCM OpenAPI 3 specification"
[9]: https://wd2-impl-services1.workday.com/ccx/service/amn1/Human_Resources/v28.2/?wsdl "Workday Human Resources v28.2 WSDL"
[10]: https://gusto.com/product/pricing "Gusto pricing plans and add-on fees"
[11]: https://www.rippling.com/pricing "Rippling pricing and custom quote structure"
[12]: https://www.bamboohr.com/pricing/ "BambooHR plans pricing and add-ons"
[13]: https://www.dayforce.com/Ceridian/media/documents/pricing/Dayforce_Published-MSRP-Price-Book_02-APR-2026.pdf "Dayforce published MSRP price book April 2 2026"
[14]: https://www.deel.com/pricing/ "Deel global employment and contractor pricing"
[15]: https://remote.com/pricing "Remote global payroll and employment pricing"
[16]: https://engineering.gusto.com/platform-engineering-at-gusto-part-1-d86d13a3f5bd "Platform Engineering at Gusto Part 1"
[17]: https://modelcontextprotocol.io/specification/2026-07-28 "MCP specification 2026-07-28"
[18]: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization "MCP authorization - OAuth and Resource Indicators"
[19]: https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation "MCP elicitation"
[20]: https://modelcontextprotocol.io/specification/2026-07-28/server/tools "MCP tools - structured output and human control"
[21]: https://developer.rippling.com/documentation/rippling-platform/rippling-mcp/overview "Rippling MCP overview - security and rate limits"
[22]: https://darwinbox.com/innovations/artificial-intelligence-in-hr/mcp-server "Darwinbox MCP Server"
[23]: https://gusto.com/product/agents "Gusto for AI - MCP and CLI"
[24]: https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3 "EU AI Act Annex III high-risk employment systems"
[25]: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai "European Commission AI Act framework and timeline"
[26]: https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page "NYC Local Law 144 AEDT requirements"
[27]: https://www.eeoc.gov/sites/default/files/2024-04/20240429_What%20is%20the%20EEOCs%20role%20in%20AI.pdf "EEOC role in artificial intelligence and employment"
[28]: https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf "Digital Personal Data Protection Rules 2025 Gazette"
[29]: https://mohre.gov.ae/en/media-center/news/4/6/2026/mohre-new-wage-protection-system-decision-adopts-a-gradual-approach-allowing-establishments-to "UAE MoHRE wage protection system decision June 2026"
[30]: https://www.gosi.gov.sa/GOSIOnline/FAQ_Employer%26locale=en_US "Saudi GOSI employer FAQ"
[31]: https://cal.com/blog/changing-to-agplv3-and-introducing-enterprise-edition "Cal.com AGPL and Enterprise announcement"
[32]: https://www.hashicorp.com/en/license-faq "HashiCorp BSL licensing FAQ"
[33]: https://opentofu.org/ "OpenTofu Linux Foundation project"
[34]: https://redis.io/blog/redis-adopts-dual-source-available-licensing/ "Redis source-available licensing announcement"
[35]: https://github.com/frappe/hrms "Frappe HR repository"
[36]: https://github.com/horilla/horilla-hr "Horilla HRMS repository"
[37]: https://a2a-protocol.org/latest/specification/ "A2A Protocol specification 1.0.0"
[38]: https://modelcontextprotocol.io/registry/about "Official MCP Registry"
[39]: https://opentelemetry.io/docs/what-is-opentelemetry/ "What Is OpenTelemetry"
[40]: https://www.keycloak.org/ "Keycloak Identity and Access Management"
[41]: https://openfisca.org/en/ "OpenFisca rules-as-code project"
[42]: https://github.com/addyosmani/agent-skills "addyosmani agent-skills repository"
[43]: https://github.com/morluto/rea "morluto REA repository"
[44]: https://github.com/cerbos/cerbos/blob/main/LICENSE "Cerbos License"
[45]: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http "MCP Streamable HTTP transport"
[46]: https://roap.esic.gov.in/ro-sro-contribution "ESIC contribution rates and payment"
[47]: https://developer.workday.com/documentation/rni1611281077170/ConceptValidateOnlyModeforRESTAPIs "Workday Validate Only Mode for REST APIs"
[48]: https://developer.squareup.com/blog/square-payrolls-migration-from-a-monolith-to-microservices/ "Square Payrolls Migration from a Monolith to Microservices"
[49]: https://docs.temporal.io/durable-execution "What Is Durable Execution - Temporal"
[50]: https://openfga.dev/docs/fga "Introduction to OpenFGA"
[51]: https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/ "Multi Tenant Data Isolation with PostgreSQL Row Level Security"
[52]: https://martinfowler.com/articles/bitemporal-history.html "Bitemporal History - Martin Fowler"
[53]: https://help.sap.com/docs/successfactors-platform/sap-successfactors-api-reference-guide-odata-v2/empjob "SAP SuccessFactors EmpJob API Reference"
