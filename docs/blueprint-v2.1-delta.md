# Meridian v2.1: Delta Specification

**Author:** Manus AI. **Status:** proposed amendments to v2, incorporated at the owner's request on 25 November 2026. Not approved for build. Decisions D1–D16 in Part B are unanswered, so every recommendation below is a provisional working assumption, not a final decision. v2 (`Meridian_Blueprint_v2_Features_and_Backend.md`) is unchanged except for a pointer banner at the top.

**How to read this.** Each change names the v2 section it amends. Where v2 already has a mechanism (PITR for live payroll, nightly R2 backups, monthly restore tests, SES fallback, degraded modes), the delta amends that paragraph instead of replacing it. Parts A and C are fixes and sketches. Part B is the decision list. Part D is the verification record. Part E holds the corrected SQL, the amended sections in v2's format and 19 provisional ADR drafts. Part F is the next steps. Appendix 1 holds the payroll input and output contracts, and Appendix 2 lists what changed from the review text this delta came from.

**Provenance.** Parts A to C come from an independent review of v2 and two rounds of critique. Before merging, I checked the review's factual claims against this workspace and against primary sources. The corrections are in Appendix 2. Citations in v2's References section have not yet been checked claim by claim.

---

## Part A: Fixes with no decision needed

These are defects or spec gaps. Apply them directly.

### A1. Authorisation and data access

| ID | v2 section | Change | Why |
|---|---|---|---|
| A1.1 | Roles, Backend | Replace `scope_ids` with the normalised `role_assignment_scope` table (C1). Define `include_descendants` explicitly. | An array can't be foreign-keyed, and v2 never says whether a department scope covers sub-departments. |
| A1.2 | Roles, Backend | Set `app.user_id` as well as `app.tenant_id` per transaction. Add scope-aware RLS on pay, bank, national ID, health, disciplinary and confidential helpdesk tables (C2). | v2 enforces only the tenant in the database. Scope and field rules in app code alone mean one bad report query leaks salaries across departments. |
| A1.3 | Report builder | Remove "runs under the caller's database role." Say instead: one application role, per-transaction user and scope context, reports compiled against `security_invoker` views. | Users aren't database roles in v2, so the sentence contradicts the architecture. |
| A1.4 | Multi-tenant data | Revoke all grants from `anon` and `authenticated` on application schemas and keep the auto-generated Data API off them. Lead every index with `tenant_id`. Read session settings in policies as `(select current_setting('app.tenant_id', true))`. | Supabase exposes tables through PostgREST by default. A policy that errors when the setting is unset fails open or crashes. This version returns no rows. |
| A1.5 | Modular monolith | One Postgres schema per module. Cross-module reads only through views or functions. An import-boundary lint in CI. | "Modules never read each other's tables" is stated but not enforced. |
| A1.6 | Lifecycle changes | The people module writes its own rows plus one outbox event. Payroll, access and documents update their own projections from it. Replace "one transaction across modules." | The v2 text contradicts the module boundary. |
| A1.7 | Org structure | Closure rows get `valid_during`, plus an exclusion constraint (C1). Specify the bitemporal pattern: `valid_during daterange`, `recorded_during tstzrange`, and corrections that close the old row's `recorded_during` instead of updating it. | v2 promises "structure as of any date" but the closure table isn't temporal. |
| A1.8 | Employee profile | Add blind indexes (HMAC of the normalised value under a per-tenant key) on bank account and national ID. A bank-detail or legal-name change needs step-up auth, notifies the previously registered contact, and sets a flag the pay run reads. | Application-level encryption makes duplicate detection impossible. A shared bank account is a classic payroll-fraud signal. |
| A1.9 | Field classes | Classify leave type and reason for medical leave, accommodation requests and disciplinary notes as `special`. | A "sick leave balance" tool would otherwise send health data to an AI host. |

### A2. Approvals, AI surface and communications

| ID | v2 section | Change | Why |
|---|---|---|---|
| A2.1 | Approvals engine | Email and chat links open an authenticated page, and the state change is a POST. No state change on GET. Action tokens are single-use, 15 minutes, bound to approver and step (C6). Verify the Google Chat and Bot Framework JWT on every card callback. | v2 doesn't say GET or POST. Mail scanners follow links, so a GET-based approval can be triggered by a scanner. |
| A2.2 | Approvals engine | An approval stores a hash of the item content. If the item changes, the approval is voided. | Prevents approving something that later changes. |
| A2.3 | Approvals engine | Each approval type carries `max_channel_assurance`. By default, pay changes, pay-run approval, role changes and terminations can be approved only in the Meridian app with step-up auth. Tenants can tighten this but not loosen it. | A chat card is too weak for payroll actions. |
| A2.4 | MCP, Commit tier | Every draft has a field-level preview rendered by Meridian and shown in the approval inbox. Drafts are bound to user, session and expiry. | The user could otherwise confirm what the model described, not what will execute. |
| A2.5 | Data firewall | Pseudonym tokens are at least 40 bits (8 base32 characters), derived from a keyed hash, with a per-tenant uniqueness constraint (C7). Tokens are per conversation by default. | `EMP_7F2A` has 16 bits, so collisions become likely at roughly 300 employees. Two people could be conflated. |
| A2.6 | Analytics, surveys, MCP analyse tools | Add differencing protection: complementary suppression, a fixed set of allowed slice dimensions for executives, and a per-user query-set budget. | A minimum group of five can be defeated by subtracting two overlapping queries. |
| A2.7 | Surveys | Separate `survey_participation` (who responded) from `survey_answer` (what was said), with no link between them (C8). Coarsen answer timestamps. Hold free text for moderation. | Anonymity "in the data model" is false if timing or joins can re-link answers. |
| A2.8 | Helpdesk RAG | Chunk-level ACLs are applied before retrieval. Only published, approved versions are indexed. | Draft, executive-only and entity-specific policies would otherwise be retrievable by everyone in the tenant. |
| A2.9 | Automation | Rule permissions are evaluated at run time. A rule is suspended when its owner is deactivated or loses scope. Add loop detection, a maximum chain depth, and a recipient cap above which the rule needs approval. Webhook URLs go through the SSRF-safe fetcher and payloads stay thin (IDs only). | Prevents orphaned or runaway automation and data in transit to third parties. |
| A2.10 | Bulk import, exports | Escape any cell that starts with `=`, `+`, `-`, `@`, tab or CR. | Employee-controlled text lands in spreadsheets. |
| A2.11 | Letters and PDF | The renderer has no network or filesystem access, with timeouts and output limits. | A template author could otherwise exfiltrate data through `<img src>` or SSRF. |
| A2.12 | Bulk email | Add SES out-of-sandbox access, bounce and complaint handling, a suppression list, and the SPF/DKIM/DMARC alignment that mailbox providers require of bulk senders. Payslip and payroll emails are link-only. | Missing from v2. Deliverability is a prerequisite for the SES fallback. |
| A2.13 | Chat/Teams | Add an app-installation step for Teams one-to-one messages, with the admin consent it needs. | A bot can't message a user it isn't installed for. |
| A2.14 | Sign-in | Microsoft: key on `tid` + `oid`, reject personal accounts, check `iss` per tenant. | Email or UPN is not a stable key. |

### A3. Payroll

Where the rest of this section refers to the "input contract," it means `PayrollCalcInput v1` and `PayrollResult v1` in Appendix 1. Part B decides the arithmetic style (D4). The contract is reproduced in Appendix 1, with its arithmetic section marked as depending on D4.

| ID | v2 section | Change | Why |
|---|---|---|---|
| A3.1 | Payroll engine | Replace the one-sentence input list with the input contract. It must cover tax profile, year-to-date accumulators, prior results for retro, adjustments with source IDs, calendars, FX, final-settlement inputs and `payment_instruction_ref` (a reference only, never raw bank data). | The v2 list can't produce a real gross-to-net. |
| A3.2 | Payroll engine | At lock time, write an immutable `payroll_input_snapshot` with `input_hash` (C4). The engine and any later explanation read the snapshot, never live tables. | "No database access" and "reproducible" are only compatible if the inputs are frozen. |
| A3.3 | Payroll engine | A missing required field excludes that employee with a blocking exception. The engine never applies a silent default. Every input line carries a `source_id`. | Silent defaults are how wrong payslips are issued. |
| A3.4 | Payroll engine | Record `engine_hash`, `pack_hash`, `input_hash` and `rounding_profile_id` on every result. Retain old engine versions. | Reproducing a result months later needs the exact engine. |
| A3.5 | Packs | Golden tests must include independent vectors: authority-published examples, reviewer-written cases and anonymised parallel-run cases. Tests written only by the pack author don't count. | They prove the code matches the author's reading, not the law. |
| A3.6 | Pay run | Replace the Durable Object run lock with the Postgres partial unique index (C3). The key includes pay group, run type and a scope key so weekly, monthly and off-cycle runs coexist. | A lock in a different system from the data can disagree with it. |
| A3.7 | Pay run states | Add `cancelled`, `rejected`, `reopened`, `payment_released` and `reversed`. Reopening voids all approvals. Reversal creates mirror results and never edits finalised ones. | v2 has no path for mistakes except new runs. |
| A3.8 | Pay run guards | Approval stores `result_set_hash`. Any recalculation voids the approval. The approver can't be the preparer and can't be a subject of the run (C3 trigger). Step-up auth is required. The bank-file hash at approval must equal the hash at release. | Closes self-approval, stale approval and swapped-file paths. |
| A3.9 | Pay run | Consistency barrier: a run can't lock until the outbox is drained for that entity up to time T and attendance recompute is complete for the period. After lock, master-data changes go to the next run, or the preparer reopens with a reason. | v2 says modules react through events, so payroll could calculate on stale data. |
| A3.10 | Pay run | After release, `paid` is set only from a bank or provider confirmation, a return file, or a manual reconciliation with evidence. A failed payment creates a re-pay item, not an edit. | v2 has no reconciliation. |
| A3.11 | Variance report | Add checks: bank details changed since last run, duplicate bank account across employees (blind index), negative or zero net, missing bank details, new and exiting employees, cap and threshold crossings, YTD discontinuities, headcount and total cost against previous run. | v2 only lists a net-change percentage. |
| A3.12 | Payroll results | DB commit is authoritative. The customer-storage copy (payslips, continuity kit) is written afterwards through the outbox with retries, and the kit shows `pending` or `confirmed`. An alert fires if a copy is unconfirmed after a configured time. The "independent of Meridian" claim applies only once confirmed. | A DB write and a Drive write can't be atomic. |
| A3.13 | Retro and year-end | Retro takes prior results plus corrected inputs and returns a delta, with the tax method defined by the pack. Year-end statements come from finalised results only. Track filing status `generated → submitted → acknowledged` with the authority reference. | Generating a file is not filing it. |
| A3.14 | Continuity kit | The kit contains the component-level register, accumulators, bank file, employee master snapshot and a manual-calculation fallback. Key custody is split across 2–3 named custodians (Shamir) or a printed recovery code. | A single key-holder is itself a continuity risk. |
| A3.15 | Payroll partner mode | Reconcile totals and per-employee net between what was sent and what came back, with a tolerance and an exceptions list. | v2 only mentions a checksum. |
| A3.16 | Pack extensions | Dynamic third-party WASM runs only in Node workers with declared capabilities. Packs in Workers are bundled at deploy. **Verified (D-3).** | Cloudflare documents that `WebAssembly.instantiate()` only supports pre-compiled modules, so arbitrary WASM can't be compiled at run time. |
| A3.17 | Policies as rules | A company policy below the country-pack legal minimum is blocked by default. Override only where the pack says the law allows it (for example under a collective agreement), with a recorded reason and a second approver. | A warning gets clicked through, and the result is an actual violation. |

### A4. Reliability

| ID | v2 section | Change | Why |
|---|---|---|---|
| A4.1 | Fail-safe, SLOs | Delete "a recovery point of zero for committed data" and use the RPO/RTO table in C0 by data class. | Stage 0 uses nightly backups, so zero is false. v2 already says PITR starts with the first live payroll, and the table keeps that as a hard gate. |
| A4.2 | Fail-safe, SLOs | Stage 1 API target is 99.5% internal, with no contractual SLA until the database has HA. The 99.95% Enterprise SLA applies only with multi-AZ DB, at least 2 API instances in separate zones, and a tested failover. Punch acceptance target is 99.9% at Stage 1. Zero punch loss comes from device, bridge and app buffering. No SLA exceeds the upstream providers' SLAs. **[open D-13]** | The doc promises more than a single-instance database and its providers can deliver. |
| A4.3 | Fail-safe, durability | The 4-hour restore time stays a claim only while the latest timed monthly drill beats it. Re-measure as data grows. Add a quarterly rebuild of a cell from infrastructure-as-code. | v2 already has monthly drills. This adds timing and a rebuild. |
| A4.4 | Fail-safe, durability | Backups go to a different provider in the same jurisdiction. Backup keys are stored separately from backups. | Residency and key separation were unstated. |
| A4.5 | Punch ingestion | Edge returns `202 Received` with a receipt ID once the event is durably queued. The final status (accepted, duplicate, rejected) comes from a status endpoint or webhook. The authoritative dedupe is the database (C5). A Durable Object window is an optimisation only. KV is not used for idempotency. Attendance is processed by event time, not arrival order. | v2 says "returns immediately" and also "answers accepted, duplicate or rejected." Duplicates can't be known without the store. |
| A4.6 | Punch ingestion | Device credentials are cached at the edge with a stated revocation delay (suggest 60 s). During a DB outage the edge accepts only from cached, non-revoked devices. Transport: Cloudflare mTLS with Cloudflare-managed client certificates, plus the bridge's own request signing (D-6). | An edge credential check can't depend on the database it is protecting. |
| A4.7 | Queues | Every queue has a dead-letter queue, backoff with jitter, a replay tool and an alert on depth. Queue retention must exceed the longest tolerated outage. Stage 0 isn't for real punches. **Verified (D-5):** Workers Free fixes retention at 24 hours; Workers Paid defaults to 4 days and is configurable up to 14. | Missing in v2. |
| A4.8 | Outbox | The relay uses `FOR UPDATE SKIP LOCKED`, runs on at least 2 instances, and alerts on lag and size. Consumers are idempotent by `event_id`. Timer lateness is a metric. | A single relay is a hidden single point of failure. |
| A4.9 | Idempotency | Same-transaction idempotency (C5) covers database writes only. External side effects (bank release, email, provider calls) pass the key to the provider and retry through the outbox. | The v2 and review wording overstated what a DB transaction covers. |
| A4.10 | Storage, capacity | Replace "10,000 employees fit comfortably in 8 GB" with a budget that includes punches. At roughly 4 punches per employee per day that is about 15 million rows a year. Partition `punch`, `audit` and `message_delivery` by month and archive old partitions to Parquet in R2. Add per-tenant statement timeouts. Load-test shift-start bursts. | The 8 GB claim ignores the largest table. |
| A4.11 | Audit | Per-tenant chain, sealed into signed Merkle blocks every N seconds, with roots anchored in an object-locked bucket. Reads of restricted or special data write their audit row in the same transaction and fail closed. Low-risk reads are async with a DLQ. | v2 doesn't say whether the chain is global. A global chain serialises writes, and async audit can leave a restricted read unlogged. |
| A4.12 | Blast radius | Job workers and API run per cell. A separate worker pool and queue for payroll. Per-connector credentials and kill switches. A payroll freeze window around configured pay dates for tenants with live runs. | The Singapore worker handles every cell's jobs, which breaks residency once a non-APAC cell exists. |
| A4.13 | Observability | Add synthetic checks for approval and restore, and alerts on DLQ depth, outbox lag and timer lateness. Define on-call, severity levels, runbooks per degraded mode, a status page and a quarterly game day. | v2 has the logs and SLO alerts but no operational process. |
| A4.14 | Degraded modes | Add rows for storage-token revoked, pack signing key unavailable, queue provider down and region loss. See C0. | v2's list omits them. |

### A5. Documents, offboarding and scheduling

| ID | v2 section | Change | Why |
|---|---|---|---|
| A5.1 | Document service | Add Drive change watches and Graph change notifications, plus a nightly reconciliation that marks moved or deleted files `broken` and alerts HR. State at setup that files added manually under `drive.file` are not tracked. | Customer-side storage means customer-side mutation. |
| A5.2 | Crypto-shredding | Every restricted and special field uses a per-subject data key wrapped by the tenant key. Shredding is blocked while a retention class or legal hold applies, and retention periods come from packs. Backups of the subject key expire on a documented schedule (suggest 35 days or less). Only after that does "unreadable in backups" become true. Cache unwrapped keys in memory with a short TTL. | v2 encrypts restricted fields with the tenant key but shreds a per-subject key. Statutory payroll retention also conflicts with "delete on request." |
| A5.3 | Offboarding | Replace "blocks the final settlement until assets are returned." Final settlement is not blocked by non-financial tasks. The country pack defines the final-pay due date and permitted deductions. Open items appear as flags on the settlement review. A countdown escalates before the statutory deadline. | Withholding final pay is restricted in some jurisdictions, so the rule has to be pack-defined. |
| A5.4 | Offboarding | Add an immediate-termination path: revoke Meridian sessions and MCP/API tokens, and call Google sign-out or token revocation and Entra session revocation, within minutes. | A scheduled cut-off can't handle a for-cause exit. |
| A5.5 | Provisioning | Default is inbound only (IdP pushes to Meridian). Outbound writes are opt-in per tenant, with a dry-run and a per-action list. | Outbound writes need broad admin scopes. |
| A5.6 | Scheduling | Store shifts as `timestamptz` plus an IANA zone, and recurring shifts as local wall-time rules. Define which attendance day an overnight shift belongs to. Exclusion constraints need `btree_gist`. Labour-law checks (rest, notice) come from packs. | DST and overnight shifts are the usual roster bugs. |
| A5.7 | Holidays | Add effective-dated overrides with an "announced on" date. | Some holidays are announced days in advance, and state holidays vary. |
| A5.8 | Calendar | Change "never reads the content of other people's events" to "does not store or display other people's event content and requests the narrowest permission Graph offers." **[open D-15]** | Don't promise what the permission model may not enforce. |
| A5.9 | Mobile punch | Offline punches have no server nonce, so they are accepted as `low_confidence` with received time and queued attestation, and routed to review per policy. | A server-bound nonce can't exist offline. |
| A5.10 | Biometric bridge | Fingerprint and face templates never leave the site network. Meridian stores only the user-ID mapping. | `sync_users` could otherwise move templates through the cloud. |
| A5.11 | Expenses | "Weekend" means the entity's work calendar. Tax treatment of reimbursements comes from the pack. Receipts sent to a model pass through the data firewall. | Fri–Sat weekends exist. |
| A5.12 | Performance | AI-drafted reviews and anomaly agents need human review, a transparency notice, input logging and a per-tenant switch. Under the AI Omnibus, the EU's Annex III high-risk obligations (which include employment uses) now apply from 2 December 2027, not 2 August 2026 (D-7, verified). Design to them now. | Employee evaluation is a regulated use. |
| A5.13 | Mobile punch, scale | **Added after verification (D-8).** Play Integrity's default quota is 10,000 requests a day per Cloud project, shared by every tenant using the Meridian app. Link the Cloud project in Play Console, request an increase before onboarding large field workforces (it can take up to a week and is subject to eligibility, including a Google Play listing), prefer standard requests over classic, and design a degraded path (`low_confidence` punch, A5.9) for when the quota is exhausted. | One shared quota is a platform-wide scale limit, and a sideloaded enterprise build would not qualify for an increase. |

### A6. Document hygiene

| ID | Change |
|---|---|
| A6.1 | Every external fact gets a source URL and a checked-on date. Don't pin "MCP spec 2026-07-28" or any dated price until checked (Part D). |
| A6.2 | Pricing text: state the FX rate used for Band 3, and fix the wording "every tier includes API access" against "full API and webhooks" in Essential (basic read API on all tiers, full API and webhooks from Essential). State the AI assumption (tokens per request and requests per employee), and use "20 questions" and "30 requests" consistently or define the difference. State the support allowance for Band 3. Show the break-even team composition. |
| A6.3 | Add a dependency table: provider, what breaks if down, degraded behaviour, exit path. Say honestly that Durable Objects have no portable equivalent, so they are kept out of correctness paths. |
| A6.4 | Say explicitly that only one cell exists at Stage 1. Residency in another region needs a new cell. |
| A6.5 | Add a data-path residency matrix (edge transit, queue payloads, DO state, R2, DB, AI, email, backups, DR). Don't claim data "stays in the cell" until it is filled in. |
| A6.6 | Add threat model, privacy review, runbook entry, data-classification entry, retention class and i18n keys to the Definition of Done. |
| A6.7 | Add a UI-contracts list, even though UI is deferred: approval inbox, draft preview, connector consent, pay-run review, exception handling. Each needs data shapes. |

---

## Part B: Decisions

Reply in the form `D1:A, D2:B, …`. Unanswered items stay provisional, with my recommendation marked as the working assumption. They are not final.

| ID | Decision | Options | My recommendation | Trade-off |
|---|---|---|---|---|
| D1 | Where the core API runs | **A.** Workers + Hyperdrive. **B.** Node containers per cell (≥2 instances from Stage 1), Workers for gateway, ingest and MCP front door. **C.** Hybrid. | **B**. | B costs roughly US$30–60 a month more at Stage 1 but avoids CPU limits and pooling and KMS-call problems. The US$30–60 figure is an estimate, not a quote. A is cheaper but needs the CPU, Hyperdrive and KMS latency limits checked first (D-4, still open). |
| D2 | Country order | **A.** UAE, then India. **B.** India, then UAE. | **A**. | UAE has no income tax and a simpler first pack. India has more demand but more statutory surface. Also pick the "one more market." |
| D3 | Pack assurance and liability | **A.** Meridian-owned L2 with a named reviewer and two-cycle parallel run, plus E&O cover. **B.** Partner-reviewed packs. **C.** Self-attested, with a customer warning. | **A**. | A is slower and costs insurance and reviewer fees. C means you can't credibly sell live payroll. Live payroll requires L2 or higher either way. |
| D4 | How pack formulas do arithmetic | **A.** Typed calculation graph evaluated by the Rust engine. **B.** CEL for predicates and glue, with Rust host functions for money (`mul_rate`, `round(mode)`, `pro_rata`) on scaled integers. | **B**. | B is lighter and keeps one pack language. A is stricter and easier to review, but a bigger build. Revisit A only if pack authors keep hand-rolling rounding. Under B, use one CEL evaluator (WASM) or run the CEL conformance suite on each implementation. |
| D5 | Payslip storage | **A.** Freeze at finalise with a pinned template and stored hash. **B.** Render on demand from the immutable result with a pinned engine and template. | **A**. | A needs small storage, written to customer storage. B stays cheap but drifts if templates change, and doesn't meet retention if Meridian is gone. |
| D6 | Small-company approval | **A.** Owner approves with step-up auth, a 24-hour release delay, notice to a second nominated contact, and their own line flagged. **B.** Require an external approver. **C.** No live payroll for single-admin tenants. | **A**. | A keeps small companies usable with weaker segregation, recorded as a policy exception. |
| D7 | Email signature manager | **A.** Build now. **B.** Later, gated on Google's written answer. | **B**. | B delays a feature but avoids a possible CASA assessment and a key-compromise blast radius. Rests on D-1. **Verified:** both `gmail.settings.*` scopes are restricted, which strengthens B. Whether a customer-granted service account avoids the assessment is still open, and only Google can answer it. |
| D8 | Release scope | **A.** One "Build now" list. **B.** R1 Core, R2 Time, R3 Payroll (one country), R4 Onboarding/helpdesk/reports/MCP read-analyse-draft/AI BYOK. | **B**. | B is order only, no dates. A doesn't match a small team. |
| D9 | Database host | **A.** Supabase. **B.** Neon. | **A**, as v2 assumed. | Supabase passkeys now exist but are marked experimental (D-2, verified). PITR price and prerequisites are still open (D-14). |
| D10 | Identity stack | **A.** One Meridian identity module on vetted components. **B.** Supabase Auth as source of truth. **C.** WorkOS. | **A**. | v2 names several. Hand-written OAuth is high risk, so use vetted libraries. B depends on D-2. C costs US$125 per connection. |
| D11 | Key management service and face-liveness vendor | Open from v2. | Decide KMS first, because crypto-shredding (A5.2) depends on it. | Liveness vendor can wait until face checks are built. |
| D12 | Storage identity | **A.** Service account added to a shared drive. **B.** Named integration user. **C.** An admin's OAuth token. | **A**, with **B** for My-Drive tenants. | C breaks when that admin leaves or is suspended. Microsoft's `Sites.Selected` already avoids this. |
| D13 | Pricing | **A.** Keep current prices and fix the text (A6.2). **B.** Recompute with the full cost model, including pack maintenance, security audits, tax, FX, insurance and support. | **B**. | A is less work. India margin depends on the support assumption: about 54% at US$0.25 support and about 77% at US$0.10 on a US$0.67 price. Also decide the free-tier limit and band country lists. |
| D14 | Residency strictness | **A.** Baseline: region-pinned DB, R2 jurisdiction, AI off by default. **B.** Strict: edge, queue payloads, DR and AI all region-locked. | **A** for launch, **B** as an Enterprise option. | B may need paid Cloudflare features (D-6, data localisation part still open). |
| D15 | Bulk email domain | **A.** Customer's domain through SES (needs DNS setup). **B.** Meridian sub-domain by default. | **B** by default, **A** optional. | A is better for deliverability but adds setup friction. |
| D16 | Licence | AGPL core, Apache-2.0 SDK and bridge, as v1 proposed. | Confirm, and add a CLA if you may relicense. | Also decide whether tax data in packs is redistributable. |

---

## Part C: SQL sketches

**Superseded in part.** Part E section 1 corrects C1 (primary handler), C2 (policy shape and helper), the C3 approval trigger (small-company exception) and C5 (partitioned dedupe). Read those versions where they differ.

These are sketches, not migrations. They assume Postgres with `btree_gist` and `pgcrypto` (or Postgres 13+ for `gen_random_uuid()`), and tables not shown here (`employment`, `pay_run` and so on) exist.

### C0. Reliability objectives by data class (replaces the single RPO line)

| Data class | RPO | RTO | Mechanism |
|---|---|---|---|
| Punch durably queued at edge | 0 | Replay after DB recovery | Queue retention plus device/bridge/app buffer |
| Punch not yet delivered | 0 | n/a | Local encrypted queue, retries with jitter |
| Committed DB data, Stage 0–1 before live payroll | Up to 24 h | Hours | Nightly encrypted backup to R2 |
| Committed DB data once payroll is live | Minutes | 4 h only while the latest drill beats it | PITR (hard gate) plus nightly backup |
| Committed DB data, Stage 2 | About 0 for AZ loss, minutes for region loss | Under 1 h AZ, under 4 h region | Multi-AZ plus same-jurisdiction replica |
| Finalised payroll copy in customer storage | 0 once confirmed | Independent of Meridian once confirmed | Outbox write with a `pending`/`confirmed` flag |
| Audit anchors | 0 | n/a | Object-locked bucket |

### C1. Role, scope and org structure

```sql
create extension if not exists btree_gist;

create table role_assignment (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  principal_id  uuid not null,
  role          text not null,
  is_primary    boolean not null default false,  -- one primary per role+scope is enforced in app/trigger
  valid_during  daterange not null default daterange(current_date, null),
  unique (tenant_id, id)
);

-- scope_type 'org_unit' covers departments, locations, teams and cost centres
-- (they are all org units in v2). Separate nullable FKs keep integrity.
create table role_assignment_scope (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  assignment_id       uuid not null,
  scope_type          text not null check (scope_type in ('tenant','legal_entity','org_unit','employee')),
  legal_entity_id     uuid,
  org_unit_id         uuid,
  employee_id         uuid,
  include_descendants boolean not null default true,
  foreign key (tenant_id, assignment_id) references role_assignment (tenant_id, id) on delete cascade,
  check (
    (scope_type = 'tenant'       and legal_entity_id is null and org_unit_id is null and employee_id is null) or
    (scope_type = 'legal_entity' and legal_entity_id is not null and org_unit_id is null and employee_id is null) or
    (scope_type = 'org_unit'     and org_unit_id     is not null and legal_entity_id is null and employee_id is null) or
    (scope_type = 'employee'     and employee_id     is not null and legal_entity_id is null and org_unit_id is null)
  )
);
create index on role_assignment_scope (tenant_id, assignment_id);
create index on role_assignment (tenant_id, principal_id);

-- Temporal closure table (A1.7)
create table org_unit_path (
  tenant_id       uuid not null,
  ancestor_id     uuid not null,
  descendant_id   uuid not null,
  depth           int  not null,
  valid_during    daterange not null,
  recorded_during tstzrange not null default tstzrange(now(), null),
  exclude using gist (
    tenant_id with =, ancestor_id with =, descendant_id with =,
    valid_during with &&
  ) where (upper_inf(recorded_during))
);
create index on org_unit_path (tenant_id, ancestor_id, descendant_id);

-- Which roles may see which field class (defaults; tenants can tighten)
create table role_field_grant (
  role        text not null,
  field_class text not null check (field_class in ('public','internal','confidential','restricted','special')),
  primary key (role, field_class)
);
```

### C2. Scope-aware RLS on a restricted table

```sql
-- Assumes employment_current(employee_id, tenant_id, legal_entity_id, org_unit_id)
create schema if not exists app;

create function app.can_see(p_tenant uuid, p_employee uuid, p_field_class text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from role_assignment ra
    join role_field_grant g
      on g.role = ra.role and g.field_class = p_field_class
    join role_assignment_scope s
      on s.tenant_id = ra.tenant_id and s.assignment_id = ra.id
    join employment_current e
      on e.tenant_id = ra.tenant_id and e.employee_id = p_employee
    where ra.tenant_id    = p_tenant
      and ra.principal_id = nullif(current_setting('app.user_id', true), '')::uuid
      and ra.valid_during @> current_date
      and (
        s.scope_type = 'tenant'
        or (s.scope_type = 'legal_entity' and s.legal_entity_id = e.legal_entity_id)
        or (s.scope_type = 'employee'     and s.employee_id     = e.employee_id)
        or (s.scope_type = 'org_unit' and (
              s.org_unit_id = e.org_unit_id
              or (s.include_descendants and exists (
                    select 1 from org_unit_path p
                    where p.tenant_id = e.tenant_id
                      and p.ancestor_id = s.org_unit_id
                      and p.descendant_id = e.org_unit_id
                      and p.valid_during @> current_date
                      and upper_inf(p.recorded_during)))
           ))
      )
  );
$$;

alter table compensation enable row level security;
alter table compensation force row level security;

create policy tenant_wall on compensation as restrictive
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy scope_wall on compensation as restrictive
  using (app.can_see(tenant_id, employee_id, 'restricted'));

create policy allow_authenticated_path on compensation as permissive
  using (true);  -- restrictive policies above do the gating
```

An employee reading their own record needs a separate permissive policy that tests `employee_id = current employee`. In Postgres, restrictive policies are ANDed with the permissive result, so the self-read path should be one of the permissive policies and the scope check should be reshaped as permissive for that table. Review this policy shape with a Postgres expert before building. Test every table with a cross-tenant and cross-scope suite.

### C3. Pay run: one active run, approval guard, immutable results

```sql
create table pay_run (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  legal_entity_id uuid not null,
  pay_group_id   uuid not null,
  period_id      uuid not null,
  run_type       text not null check (run_type in ('regular','off_cycle','final','retro')),
  scope_key      text not null default '',   -- '' for regular; e.g. employee id or sequence for off-cycle/final
  state          text not null check (state in (
    'draft','inputs_locked','calculated','in_review','approved','finalised',
    'payment_released','paid','published','cancelled','rejected','reopened','reversed')),
  prepared_by    uuid not null,
  version        int  not null default 1,     -- optimistic lock
  unique (tenant_id, id)
);

create unique index pay_run_one_active
  on pay_run (tenant_id, legal_entity_id, pay_group_id, period_id, run_type, scope_key)
  where state not in ('cancelled','reversed');

create table pay_run_approval (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  pay_run_id      uuid not null,
  approver_id     uuid not null,
  result_set_hash bytea not null,
  stepup_event_id uuid not null,
  approved_at     timestamptz not null default now(),
  voided_at       timestamptz,
  void_reason     text,
  foreign key (tenant_id, pay_run_id) references pay_run (tenant_id, id)
);

create function app.guard_pay_run_approval() returns trigger language plpgsql as $$
declare r pay_run%rowtype;
begin
  select * into r from pay_run where tenant_id = new.tenant_id and id = new.pay_run_id;
  if new.approver_id = r.prepared_by then
    raise exception 'approver must differ from preparer';
  end if;
  if exists (select 1 from payroll_run_subject s
             where s.pay_run_id = new.pay_run_id and s.principal_id = new.approver_id) then
    raise exception 'approver is a subject of this run';   -- D6 exception path handled by explicit policy flag
  end if;
  return new;
end $$;
create trigger trg_guard_approval before insert on pay_run_approval
  for each row execute function app.guard_pay_run_approval();

create table payroll_input_snapshot (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  pay_run_id     uuid not null,
  employment_id  uuid not null,
  schema_version int  not null,
  payload_enc    bytea not null,          -- encrypted with per-subject key
  input_hash     bytea not null,          -- hash of canonical (e.g. RFC 8785) plaintext
  created_at     timestamptz not null default now(),
  unique (pay_run_id, employment_id)
);

create table payroll_result (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  pay_run_id    uuid not null,
  employment_id uuid not null,
  input_hash    bytea not null,
  engine_hash   bytea not null,
  pack_hash     bytea not null,
  result_enc    bytea not null,
  unique (pay_run_id, employment_id, input_hash, engine_hash, pack_hash)
);

create function app.payroll_result_immutable() returns trigger language plpgsql as $$
declare rid uuid := coalesce(new.pay_run_id, old.pay_run_id);
begin
  if exists (select 1 from pay_run
             where id = rid and state in ('finalised','payment_released','paid','published','reversed')) then
    raise exception 'results are immutable once the run is finalised';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_result_immutable before insert or update or delete on payroll_result
  for each row execute function app.payroll_result_immutable();
```

Open point: the `pay_run_one_active` index excludes only `cancelled` and `reversed`, so a `rejected` run still blocks a replacement. Decide whether `rejected` should return to `draft` or `reopened`, or be excluded from the index.

Add a `pay_run_transition(from_state, to_state)` table and a before-update trigger on `pay_run.state` so only listed transitions are possible, and a trigger that sets `voided_at` on all approvals when the state moves to `reopened` or a recalculation occurs.

### C4. Outbox

```sql
create table outbox (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null,
  event_id     uuid not null unique,
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index on outbox (id) where published_at is null;

-- relay (run on ≥2 instances)
-- select id, event_id, event_type, payload from outbox
--  where published_at is null order by id limit 100 for update skip locked;
```

### C5. Idempotency and punch dedupe

```sql
-- Written in the SAME transaction as the business write.
-- A concurrent duplicate blocks on the primary key until the first commits, then conflicts and replays.
create table idempotency_key (
  tenant_id       uuid not null,
  principal_id    uuid not null,
  key             text not null,
  request_hash    bytea not null,
  response_status int  not null,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '48 hours',
  primary key (tenant_id, principal_id, key)
);
-- Protocol: insert ... on conflict do nothing.
--  conflict + same request_hash  -> return stored response
--  conflict + different hash     -> 422
-- External effects (bank release, email): pass the key to the provider and send via the outbox.

-- Punches: partitioned by month, with a non-partitioned dedupe table as the authoritative check.
create table punch_dedupe (
  tenant_id uuid not null,
  device_id uuid not null,
  idempotency_key text not null,
  punch_id uuid not null,
  primary key (tenant_id, device_id, idempotency_key)
);
create table punch (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  device_id uuid not null,
  employee_ext_id text not null,
  event_time timestamptz not null,
  received_at timestamptz not null default now(),
  direction text, verification_method text, confidence numeric,
  raw_hash bytea not null,
  primary key (tenant_id, id, event_time)
) partition by range (event_time);
-- Insert into punch_dedupe first; only if a row was inserted, insert the punch. Duplicates are logged, not counted.
-- punch_dedupe is not partitioned, so it grows without bound: purge rows older than the longest device retry window (decide N days).
```

### C6. Approval action tokens

```sql
create table approval_action_token (
  token_hash       bytea primary key,           -- store only a hash
  tenant_id        uuid not null,
  approval_step_id uuid not null,
  approver_id      uuid not null,
  content_hash     bytea not null,              -- item content at issue time
  expires_at       timestamptz not null,        -- issued + 15 min
  used_at          timestamptz
);
-- Consume with: update ... set used_at = now() where token_hash = $1 and used_at is null
--   and expires_at > now() and <current item content_hash matches>; require row count = 1.
```

### C7. Pseudonym mapping

```sql
create table pseudonym_map (
  tenant_id       uuid not null,
  conversation_id uuid not null,
  token           text not null check (token ~ '^[A-Z2-7]{8}$'),
  employee_id     uuid not null,
  primary key (tenant_id, conversation_id, token),
  unique (tenant_id, conversation_id, employee_id)
);
-- token = base32(first 5 bytes of HMAC-SHA256(tenant_key, conversation_id || employee_id || counter));
-- on unique-violation, increment counter and retry.
```

### C8. Survey anonymity

```sql
create table survey_participation (
  survey_id uuid not null, employee_id uuid not null, completed_on date not null,
  primary key (survey_id, employee_id)
);
create table survey_answer (
  survey_id uuid not null,
  respondent_key uuid not null default gen_random_uuid(),  -- random, never stored in participation
  question_id uuid not null,
  answer jsonb not null,
  submitted_week date not null                              -- coarsened
);
-- Both rows are written in separate statements with no shared key. Reports enforce min group size and complementary suppression.
```

---
---

## Part D: Verification record

Checked on 25 November 2026 against the primary source named. "Open" items still need a check before the section they block is final.

| ID | Question | Result | Source | Blocks |
|---|---|---|---|---|
| D-1 | Are `gmail.settings.basic` and `gmail.settings.sharing` restricted? Does a customer-granted domain-wide-delegation service account trigger the CASA assessment? | **Part verified.** Both scopes are restricted. `gmail.send` is sensitive. `gmail.settings.sharing` is limited to Workspace customers using a service account with domain-wide delegation. Whether that path avoids the security assessment is **open**: needs Google's written answer. | [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) (updated 2026-09-10) | D7, signature manager |
| D-2 | Does Supabase Auth support passkeys? | **Verified.** Yes, but marked experimental, API may change, client opt-in required, SSO users cannot register passkeys. | [Supabase passkeys](https://supabase.com/docs/guides/auth/passkeys) | D9, D10 |
| D-3 | Can Workers load WASM only from bundled modules? | **Verified.** `WebAssembly.instantiate()` supports only pre-compiled modules. Threads are not available. | [Workers WebAssembly](https://developers.cloudflare.com/workers/runtime-apis/webassembly/) | A3.16, D1 |
| D-4 | Workers CPU limits per plan, Hyperdrive behaviour, KMS-call latency | **Open.** Partial: a queue consumer's CPU limit is configurable up to 5 minutes. | [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) | D1 |
| D-5 | Queues retention and free-plan availability | **Verified.** Free: 10,000 operations a day, 24-hour retention fixed. Paid: 1,000,000 operations a month included, 4 days by default, up to 14. v2's Stage 0 text is correct. | [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [limits](https://developers.cloudflare.com/queues/platform/limits/) | A4.7 |
| D-6 | mTLS for device bridges; data localisation features and plan | **mTLS part verified.** mTLS can be enabled for any hostname with the Cloudflare-managed CA. Bringing your own CA is Enterprise. Data localisation is **open**. | [Enable mTLS](https://developers.cloudflare.com/ssl/client-certificates/enable-mtls/) | A4.6, D14 |
| D-7 | EU AI Act dates for employment systems | **Verified.** Annex III high-risk obligations apply from 2 December 2027 after the AI Omnibus. Check the Official Journal text before quoting article numbers. | [European Commission, AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai), [White & Case](https://www.whitecase.com/insight-alert/eu-ai-omnibus-enters-force-amending-ai-act) | A5.12 |
| D-8 | Play Integrity quotas | **Verified.** 10,000 requests a day per Cloud project (token requests and decryptions each). Increase needs a Play Console link, a Google Play listing and a form, up to a week. | [Play Integrity setup](https://developer.android.com/google/play/integrity/setup) | A5.13, mobile punch scale |
| D-9 | MCP specification revision, Client ID Metadata Documents, Dynamic Client Registration | Open | modelcontextprotocol.io specification and changelog | MCP section pin |
| D-10 | Copilot declarative agent `agentConnectors`, federated connectors, MCP support | Open | Microsoft Learn | Copilot section |
| D-11 | Gemini Enterprise MCP data store GA status, A2A preview status | Open | Google Cloud docs | Gemini section |
| D-12 | ChatGPT custom MCP app admin controls and any tunnel offering; Claude connector availability and IP ranges | Open | OpenAI and Anthropic help docs | MCP Mode 1 |
| D-13 | Upstream SLAs for Cloudflare, the DB host, SES | Open | Each provider's SLA page | A4.2 |
| D-14 | Supabase PITR price and prerequisites, Free-project pause policy | Open (v2 cites US$100 a month for 7 days) | Supabase pricing and docs | D9, Stage 1 cost |
| D-15 | Graph permission for free/busy of others; whether it exposes event content | Open | Graph permissions reference | A5.8 |
| D-16 | Exchange transport-rule signatures; no Graph signature API | Open (v2 and `microsoft.md` already state this) | Microsoft Learn | Signature manager |
| D-17 | Gmail and Yahoo bulk-sender rules; sending limits; SES pricing | Open | Provider docs | A2.12, cost |
| D-18 | Teams bot proactive messaging and installation requirements | Open | Microsoft Learn Teams docs | A2.13 |
| D-19 | Restrictions on biometric-device vendors for US federal contractors | Open, needs legal advice (NDAA §889) | Counsel | Device adapters |
| D-20 | UAE WPS file formats and end-of-service rules; India labour-code status, PF/ESI/TDS rules | Open, needs a local payroll professional | Official authority publications | D2, D3 |
| D-21 | Every price in the Stage and competitor sections | Open | Each vendor's price page, with a checked-on date | D13 |
| D-22 | Does Hetzner's Singapore site offer more than one availability zone? (affects the Stage 1 HA claim, F.1 item 7) | Open | Hetzner docs | Stage 1 SLA wording |

---

## Part E: Corrections and amended sections (document format)

Source: the reviewer's second draft, written after the Part A to D text above. It supplies corrected SQL, the amended sections in v2's own pattern (What it does / How it works / Backend / Why this way), the 19 provisional ADR drafts and a build order. Tags: `[Fixed]` is a defect fix needing no decision, `[D#]` is a provisional decision awaiting you, and `[open D-#]` waits on an unfinished Part D check. Where Part D has since been checked, the tag has been replaced with the result. Section numbers 1, 2.1 to 2.17 and 3 below refer to Part E. All numbers in 2.15 were recomputed and match (₹88 per US$ is the rate used).

### 1. Corrections to the Part C sketches (read first)

The reviewer re-read the Part C SQL before building on it and found these problems. The corrected SQL below supersedes C1 (primary handler), C2, the C3 approval trigger and C5 (punch dedupe).

| # | Problem | Fix |
|---|---|---|
| 1 | **C2 had the wrong policy shape.** A permissive `using (true)` plus a restrictive scope check blocks employees from reading their own record. | Corrected below. The tenant wall is restrictive. Scope-read and self-read are separate permissive policies, which Postgres ORs. |
| 2 | **C2's `SECURITY DEFINER` helper runs as the table owner**, and `FORCE ROW LEVEL SECURITY` applies to the owner too. The helper would be filtered by RLS on the lookup tables it reads. | The lookup tables get a restrictive tenant wall plus a permissive `true`. The helper then sees the current tenant's rows only. |
| 3 | **C2's per-row function is slow on list queries.** | Resolve the caller's visible employee set once per transaction and join to it. RLS stays as the backstop. |
| 4 | **C3's trigger had no path for the D6 small-company exception.** | Corrected below. |
| 5 | **C1 had `is_primary` on the assignment**, but "primary" is per role and scope. | Moved to the scope row, with a partial unique index. |
| 6 | **C5's `punch_dedupe` table grows without bound** (about 15M rows a year at the A4.10 sizing). | Partition it by month, keep a bounded dedupe window, and send events older than the window to a review path. |
| 7 | **The Stage 1 HA assumption.** Two API instances do not give zone separation on a provider with a single location in a region. As far as the reviewer knows, Hetzner's Singapore site is one location **[open D-22]**. | Stage 1 gets host-level redundancy only. The 99.95% Enterprise SLA needs an AZ-capable provider, which is Stage 2 or a dedicated cell. |

#### Corrected C1 (scope table, primary handler)

```sql
alter table role_assignment drop column is_primary;
alter table role_assignment_scope add column is_primary boolean not null default false;

-- one primary per role + scope target
create unique index one_primary_per_scope
on role_assignment_scope (
  tenant_id, scope_type,
  coalesce(legal_entity_id, org_unit_id, employee_id,
           '00000000-0000-0000-0000-000000000000'::uuid)
) where is_primary;
-- Note: the role must be part of the key. Join role via assignment in a trigger,
-- or denormalise role onto this table. Choose denormalising: add role text, include it in the index.
```

#### Corrected C2 (tenant wall, scope read, self read, scoped write)

```sql
-- lookup tables the helper reads: tenant wall only
alter table role_assignment       enable row level security; alter table role_assignment       force row level security;
alter table role_assignment_scope enable row level security; alter table role_assignment_scope force row level security;
alter table org_unit_path         enable row level security; alter table org_unit_path         force row level security;
-- repeat for each: restrictive tenant_wall + permissive using (true)
create policy tenant_wall on role_assignment as restrictive for all
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy open on role_assignment as permissive for all using (true);

-- protected table
alter table compensation enable row level security;
alter table compensation force row level security;

create policy tenant_wall on compensation as restrictive for all
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy scope_read on compensation as permissive for select
  using (app.can_see(tenant_id, employee_id, 'restricted'));

create policy self_read on compensation as permissive for select
  using (app.is_self(tenant_id, employee_id));   -- compares employment.person_id to app.person_id

create policy scope_insert on compensation as permissive for insert
  with check (app.can_write(tenant_id, employee_id, 'restricted'));
create policy scope_update on compensation as permissive for update
  using (app.can_write(tenant_id, employee_id, 'restricted'))
  with check (app.can_write(tenant_id, employee_id, 'restricted'));
-- No delete policy: deletion is not permitted; history is bitemporal.
```

`app.can_see` stays as written in the earlier C2. `app.can_write` is the same function checking a write grant. It should be a separate `role_field_grant.can_write` column, because read and write rights differ. Revoke `EXECUTE` from `PUBLIC`, and set `search_path` on every definer function. Run the cross-tenant and cross-scope suite on every table, and have a Postgres reviewer check this before migration.

#### Corrected C3 trigger (D6 exception path)

```sql
alter table pay_run_approval
  add column flagged_self_approval boolean not null default false,
  add column release_not_before timestamptz;

create function app.guard_pay_run_approval() returns trigger language plpgsql as $$
declare r pay_run%rowtype;
begin
  select * into r from pay_run where tenant_id = new.tenant_id and id = new.pay_run_id;
  if new.approver_id = r.prepared_by and not exists (
       select 1 from payroll_policy_exception e
       where e.tenant_id = new.tenant_id and e.kind = 'single_admin' and e.active) then
    raise exception 'approver must differ from preparer';
  end if;
  if exists (select 1 from payroll_run_subject s
             where s.pay_run_id = new.pay_run_id and s.principal_id = new.approver_id) then
    if not exists (select 1 from payroll_policy_exception e
                   where e.tenant_id = new.tenant_id and e.kind = 'single_admin' and e.active) then
      raise exception 'approver is a subject of this run';
    end if;
    new.flagged_self_approval := true;
  end if;
  if new.flagged_self_approval or new.approver_id = r.prepared_by then
    new.release_not_before := now() + interval '24 hours';   -- [D6]
  end if;
  return new;
end $$;
-- The approved -> payment_released transition trigger must require
--   now() >= release_not_before for every non-voided approval, and a notice row for the second contact.
```

#### Corrected C5 (bounded, partitioned dedupe)

```sql
create table punch_dedupe (
  tenant_id uuid not null, device_id uuid not null, idempotency_key text not null,
  event_time timestamptz not null, punch_id uuid not null,
  primary key (tenant_id, device_id, idempotency_key, event_time)
) partition by range (event_time);
-- Detach and drop partitions older than the dedupe window (suggest 120 days).
-- Events with event_time older than the window skip the dedupe insert and go to a
-- `late_punch_review` queue rather than being auto-accepted.
-- Vendor event IDs retried by a device keep the same event_time, so the key still collides on retry.
```

---

### 2. Amended sections

Each block lists the v2 section it amends, then follows v2's own pattern.

#### 2.1 Roles, scopes and field access *(amends: "Who uses Meridian", Backend)* `[Fixed]`

**What it does.** Unchanged: role × scope pairs, primary and backup handlers, standard roles.

**How it works.** A department scope covers its sub-departments by default, and `include_descendants` can switch that off per assignment. Scope is evaluated as of the current date, using the temporal closure table. Primary and backup handler are properties of the scope row.

**Backend.**
- Tables are `role_assignment`, `role_assignment_scope` and `role_field_grant`, with separate nullable foreign keys per scope type and a check constraint.
- Each transaction sets `app.tenant_id`, `app.user_id`, `app.person_id`, `app.scope_set_id`. Policies read them as `(select current_setting(..., true))`, so an unset value returns no rows.
- Layer 1 is the tenant wall on every table. Layer 2 is scope and field RLS on pay, bank, national ID, health, disciplinary and confidential-helpdesk tables. Layer 3 is the application policy engine, which handles purpose and field masking.
- Reports compile against `security_invoker` views under the one application role, not "the caller's database role."
- `anon` and `authenticated` have no grants on application schemas, and the auto-generated Data API stays off them.
- Every index leads with `tenant_id`.
- Medical leave type and reason, accommodation requests and disciplinary notes are class `special`.

**Why this way.** Two independent database layers mean one bad query can't leak salaries within a tenant. The app layer then adds purpose and masking.

#### 2.2 Approvals engine *(amends: "Shared services")* `[Fixed]`

**How it works.**
- Email and chat links open an authenticated Meridian page. The state change is a POST with sign-in. A GET never changes state.
- Action tokens are single-use, last 15 minutes, and are bound to approver, step and item content hash. Only the hash is stored (C6).
- Google Chat bearer tokens and Bot Framework tokens are verified on every card callback.
- If the underlying item changes, the approval is voided and re-requested.
- Each approval type has a `max_channel_assurance`. By default, pay changes, pay-run approval, role changes and terminations are approvable only in the Meridian app with step-up auth. Tenants can tighten this and cannot loosen it.

**Why this way.** Mail scanners follow links, and chat cards can be forwarded. Binding to content and approver closes both.

#### 2.3 Document service and storage identity *(amends: "Document collection", "Document service")*

**How it works.** Setup tells the admin plainly that files dropped into the folder by hand are not tracked under `drive.file`.

**Backend.**
- `[D12]` Google uses a **service account added to a shared drive** as Content manager. For My-Drive tenants it uses a **named integration user**, never a person. Microsoft uses `Sites.Selected` with an app-only grant. Neither depends on one admin's token.
- Connector health is checked. `invalid_grant` marks the connector degraded, queues writes and alerts HR.
- Drive change watches, Graph change notifications and a nightly reconciliation mark moved or deleted files `broken`.
- Restricted documents (contracts, payroll registers) get optional envelope encryption before upload.
- Stage 0 note: an unverified Google app has a user cap, and refresh tokens for apps in "Testing" status expire quickly. Plan the beta around that **[open D-1]**.

**Why this way.** Customer-side storage means customer-side mutation, so Meridian has to detect it.

#### 2.4 Org structure, policies, profile *(amends Page 1 and Page 2)* `[Fixed]`

- **Org units.** Closure rows carry `valid_during` and an exclusion constraint (C1). The bitemporal pattern is `valid_during daterange` plus `recorded_during tstzrange`. A correction closes the old row's `recorded_during` and never updates it.
- **Policies.** A company policy below the country pack's legal minimum is blocked. An override needs a pack flag saying the law allows it (for example a collective agreement), a recorded reason and a second approver.
- **Profile.** Bank account and national ID get blind indexes (HMAC of the normalised value under a per-tenant key). A bank or legal-name change needs step-up auth, notifies the previously registered contact and sets a flag the next pay run reads.
- **Lifecycle events.** The people module writes its own bitemporal rows and one outbox event. Payroll, access and documents update their own projections. A pay run cannot lock until the outbox is drained (§2.8).
- **Import and export.** Cells beginning `=`, `+`, `-`, `@`, tab or CR are escaped.

#### 2.5 Attendance ingestion *(amends: "Punch ingestion hub", "Mobile punch", "Biometric device bridge")* `[Fixed]`

**How it works.**
- The edge answers `202 Received` with a receipt ID once the event is durably queued. The final status (accepted, duplicate, rejected) comes from a status endpoint or webhook.
- The database is the authoritative dedupe, using `punch_dedupe` (C5, corrected). A Durable Object window is an optimisation only. KV is never used for idempotency.
- Attendance is calculated by event time, not arrival order.
- Offline mobile punches can't carry a server nonce. They are accepted as `low_confidence` with received time and queued attestation, and are routed to review per policy.
- Fingerprint and face templates never leave the site network. Meridian stores only the user-ID mapping.

**Backend.**
- Device keys are cached at the edge with a stated revocation delay (suggest 60 s). During a database outage the edge accepts only from cached, non-revoked devices.
- Every queue has a dead-letter queue, backoff with jitter, a replay tool and an alert on depth.
- Queue retention must exceed the longest tolerated outage. Stage 0 is not for real punches (D-5 verified: Workers Free retention is fixed at 24 hours).
- `punch`, `audit` and `message_delivery` are partitioned by month. Old partitions are archived to Parquet in R2. Statement timeouts are set per tenant. Shift-start bursts are load-tested.
- Bridges use Cloudflare mTLS with Cloudflare-managed client certificates (D-6 verified: available for any hostname; bring-your-own CA is Enterprise only). Each bridge also signs its requests with its own Ed25519 key, with rotation, so authentication survives a move off Cloudflare.

**Why this way.** v2 says the edge "returns immediately" and also answers "duplicate." Duplicates can't be known without the store, so the response is split in two.

#### 2.6 Offboarding *(amends Page 5)* `[Fixed]`

- **Final settlement is not blocked by non-financial tasks.** The country pack defines the final-pay due date and permitted deductions. Open items (assets, handover) appear as flags on the settlement review. A countdown escalates to HR and payroll before the statutory deadline.
- **Immediate-termination path.** Revoke Meridian sessions and MCP/API tokens, then call the Google sign-out/token revocation and Entra session revocation paths, all within minutes. The scheduled cut-off remains for normal exits.
- **Provisioning.** The default is inbound only (the identity provider pushes to Meridian). Outbound writes are opt-in per tenant, with a dry run and a per-action list.
- **Microsoft sign-in.** Users are keyed on `tid` + `oid`. Personal accounts are rejected, and `iss` is checked per tenant.

#### 2.7 Payroll engine *(replaces "Global payroll engine with country packs")* `[Fixed]` + `[D3, D4]`

**What it does.** Calculates gross-to-net for any entity whose country has a **verified** pack: earnings, deductions, employer contributions, taxes, arrears, loans, reimbursements, retro and final settlements. It produces results with a line-level explanation. Countries without a verified pack use partner mode.

**How it works.**
- The input is `PayrollCalcInput v1` and the output is `PayrollResult v1`, as specified in Appendix 1, with the amendments below.
- When a run locks, each employee's inputs are written to an immutable `payroll_input_snapshot` with an `input_hash`. The engine and every later explanation read the snapshot, never live tables.
- A missing required field excludes that employee with a blocking exception. There are no silent defaults. Every input line carries a `source_id`.
- Required fields are declared by the pack.

**Amendments to the §6.3 contract.**
- The canonical form for hashing is RFC 8785 JSON canonicalisation.
- Quantities are scaled integers: hours and days ×1000, rates as numerator/denominator or a scaled integer with the scale declared.
- `payment_instruction_ref` is a reference only. Raw bank data never enters the engine.
- The schema is versioned. An engine accepts a declared range of schema versions and rejects the rest.

**Arithmetic `[D4: option B]`.**
- Money is integer minor units, with the exponent taken from ISO 4217 (JPY 0, USD 2, KWD 3).
- Pack formulas are written in CEL for predicates and glue. All money maths goes through **host functions implemented in Rust**: `mul_rate(minor, rate, mode)`, `pro_rata(minor, num, den, mode)`, `round_minor(value, scale, mode)`, `tax_table(table_id, base)` and checked `add`/`sub`/`min`/`max`. Rounding modes are half-up, half-even, up and down, and each pack's rounding profile names the mode and the point of rounding.
- Host functions use 128-bit intermediates. CEL's 64-bit integers would overflow on `amount × scaled rate` for large amounts.
- The pack compiler rejects any `double` literal or double-typed expression in a numeric rule.
- Only one CEL evaluator is used (compiled to WASM), or each implementation must pass the CEL conformance suite. Evaluation has cost limits.
- Revisit a typed calculation graph only if pack authors keep hand-rolling rounding.

**Packs.** Signed bundles of effective-dated tables (brackets, rates, caps, thresholds, deduction priority, final-settlement rules, retention periods), component definitions (taxable, contributory, pensionable, overtime-base flags), report and bank-file templates, and metadata (jurisdiction, tax year, assurance level, maintainer, changelog, test-vector hash, signature).

| Level | Meaning | Live payroll |
|---|---|---|
| L0 | Draft, sandbox only | No |
| L1 | Peer reviewed | No |
| L2 | Reviewed by a named qualified local reviewer, **independent test vectors** pass, and a parallel run against the incumbent matched within tolerance for two consecutive cycles | Yes |
| L3 | Regulator-certified where a scheme exists | Yes |

**Liability `[D3: option A]`.** The customer remains employer of record for filings and payments. Meridian's warranty is limited to the documented scope of an L2 pack. E&O cover is in place before the first live payroll. Self-hosted community users run unverified packs at their own risk. Legal review of the exact terms is needed.

**Hosting.** Pay-run workers (Node, per cell) load the WASM engine from a hash-pinned, signed artefact store. Every result records `engine_hash`, `pack_hash`, `input_hash` and `rounding_profile_id`. Old engine versions are retained. Dynamic third-party WASM runs only in Node workers with declared capabilities. In Workers, engines and packs are bundled at deploy (D-3 verified).

**Tests.** Independent vectors (authority examples, reviewer-written cases, anonymised parallel-run cases), property tests (net = gross − deductions, totals equal the sum of lines, rounding invariants), boundary tests on every bracket edge and cap, differential tests between pack versions, a cross-runtime determinism test (Node, Workers and a standalone WASM runtime must give identical bytes), and an annual tax-year rollover checklist with a named owner per country.

**Why this way.** Frozen inputs make "pure and reproducible" true. Host functions give one place for rounding rules, which is lighter than a new formula language. Assurance levels make "any country" mean "any country with a verified pack."

#### 2.8 Pay run *(replaces "Pay run with dry-run, diff and four-eyes approval")* `[Fixed]` + `[D6]`

**States.** `draft → inputs_locked → calculated → in_review → approved → finalised → payment_released → paid → published`, plus `cancelled` (before finalised), `rejected` (back to `inputs_locked` or `draft`), `reopened` (from `in_review` or `approved` back to `inputs_locked`, voiding all approvals) and `reversed` (after finalised, by a reversal run that mirrors the results). A transition table and trigger enforce the allowed moves.

**Before the run can lock.**
1. The outbox is drained for the entity up to time T, and attendance recompute is complete for the period.
2. Input validation has run. Exceptions are resolved or waived by the preparer with a reason.

After lock, master-data changes go to the next run, or the preparer reopens with a reason.

**Guards.**
- `approved` requires a different person from the preparer, who is not a subject of the run, with step-up auth and the approval bound to `result_set_hash`. Any recalculation voids it.
- `finalised` makes results immutable (trigger in C3), and payslips and statutory files are generated and hashed.
- `payment_released` needs a finance approver with step-up auth, and the bank-file hash at approval must equal the hash at release.
- `paid` is set only from a bank or provider confirmation, a return file, or a manual reconciliation with evidence. A failed payment creates a re-pay item.
- `published` happens on the pay date (configurable), never before finalisation.

**Small-company exception `[D6: option A]`.** A single-admin tenant can have the account owner approve with step-up auth, a **24-hour release delay**, notice to a second nominated contact (for example the accountant), and the owner's own line flagged for review. This is stored as a `payroll_policy_exception` and visible in audit.

**Lock.** One active run per `(entity, pay group, period, run type, scope key)` via the partial unique index in C3, plus advisory locks for the calculation fan-out. Durable Objects are not used for payroll correctness.

**Idempotency.** Per-employee result key is `(run_id, employee_id, input_hash, engine_hash, pack_hash)`. A crashed worker resumes. A changed input creates a new key and never reuses a stale result.

**Pre-approval checks.** Net change over a configurable percentage, new and exiting employees, zero or negative net, missing bank details, bank details changed since the last run, a duplicate bank account across employees (blind index), pay above band, cap and threshold crossings, YTD discontinuities, headcount and total cost against the previous run, and employees with blocking exceptions.

**Retro, final settlement and year-end.** Retro takes prior results plus corrected inputs and returns a delta, with the tax method defined by the pack. Final settlement rules (notice pay, leave encashment, gratuity or end-of-service, deadline, permitted deductions) come from the pack. Year-end statements come only from finalised results. Filing status runs `generated → submitted → acknowledged` with the authority reference.

#### 2.9 Payslips, continuity, partner mode *(amends Page 9)* `[D5]`

- **Payslips `[D5: option A]`.** At `finalised`, render each payslip once with a pinned template version and store its hash. The explanation trace remains the live line-by-line view. Re-rendering exists for verification only. This amends v2's "rendered on demand" in the Employee folder and Payslips sections.
- **Confirmation of copies.** The database commit is authoritative. The customer-storage copy of payslips and the continuity kit is written afterwards through the outbox with retries. Each shows `pending` or `confirmed`. An alert fires if a copy stays unconfirmed past a configured time. The "independent of Meridian" claim applies only once confirmed.
- **Continuity kit.** Contains the component-level register, accumulators, bank file, employee master snapshot and a manual-calculation fallback. Key custody is split across 2-3 named custodians (Shamir) or a printed recovery code.
- **Bank files.** Generated after approval. Bank details are decrypted only in the worker. Download links expire. Files are reconciled against return files. Each format needs checking per bank **[open D-20]**.
- **Partner mode.** Reconcile totals and per-employee net between what was sent and what came back, with a tolerance and an exceptions list.

#### 2.10 AI surface *(amends "MCP server design", "Surveys", "Workforce analytics")* `[Fixed]`

- **Draft preview.** Every draft has a field-level preview rendered by Meridian and shown in the approval inbox. Drafts are bound to user, session and expiry. The AI host's own confirmation is never the only control.
- **Pseudonyms.** Tokens are at least 40 bits (8 base32 characters), derived from a keyed hash, with a uniqueness constraint (C7) and per-conversation tokens by default.
- **Analyse tools, analytics and executive view.** Add differencing protection: complementary suppression, a fixed set of slice dimensions for executives, and a per-user query-set budget.
- **Surveys.** `survey_participation` and `survey_answer` share no key (C8). Timestamps are coarsened and free text is held for moderation.
- **Helpdesk RAG.** Chunk-level access rules are applied before retrieval. Only published, approved versions are indexed.
- **Automation.** Permissions are evaluated at run time. A rule is suspended when its owner is deactivated or loses scope. Loop detection, a maximum chain depth and a recipient cap (above which the rule needs approval) apply. Webhook URLs go through the SSRF-safe fetcher and payloads carry IDs only.
- **Performance AI.** AI-drafted reviews and anomaly agents need human review, a transparency notice, input logging and a per-tenant switch. Annex III high-risk obligations apply from 2 December 2027 (D-7 verified).
- **Spec pins.** The MCP revision, Copilot connector model and Gemini status are not pinned in the spec until verified **[open D-9, D-10, D-11, D-12]**.

#### 2.11 Encryption, retention, audit *(amends "Multi-tenant data organisation", "Privacy requests and retention", "Audit log explorer")* `[Fixed]`

- **Keys.** Every restricted and special field uses a per-subject data key wrapped by the tenant key. The tenant key is wrapped by the KMS `[D11: decide KMS first]`. Unwrapped keys are cached in memory with a short TTL.
- **Shredding.** It is blocked while a retention class or legal hold applies. Retention periods come from packs. When a subject key is destroyed, copies in key backups expire on a documented schedule (suggest 35 days or less), and only after that are backups unreadable. Say so in the DPA.
- **Audit.** One chain per tenant. A sealer job batches events into signed Merkle blocks every N seconds. Roots are anchored in an object-locked bucket and optionally the customer's storage. Reads of restricted or special data write their audit row **in the same transaction and fail closed**. Low-risk reads are asynchronous with a DLQ.

#### 2.12 Backend architecture: hosting and request path *(amends "The shape of the system")* `[D1: option B]`

- **Edge Workers** handle the gateway, ingest and the MCP front door.
- **The core API** runs as **Node containers inside each cell**, with at least two instances from Stage 1. It handles the policy engine, encryption, validation and database access. Workers reach Postgres through a pooler or Hyperdrive **[open D-4]**.
- **Job workers** run per cell, with a separate pool and queue for payroll.
- **Only one cell exists at Stage 1.** Residency in another region needs a new cell.
- **Residency matrix.** Before claiming a European tenant's data "stays in the European cell," fill in one row each for edge transit, queue payloads, Durable Object state, R2 (jurisdiction set), database, AI provider, email, backups and DR. `[D14: baseline]` means region-pinned database and R2, DR in the same legal jurisdiction, AI off by default, and the other paths documented. Strict region-locking is an Enterprise option **[open D-6, data localisation part]**.
- **Dependency table.** One row per provider with what breaks, degraded behaviour and exit path. Durable Objects have no portable equivalent, so they stay out of correctness paths and are used for rate limits and mailbox token buckets only.
- **Identity `[D10: option A]`.** One Meridian identity module built on vetted components handles passkeys, TOTP, OIDC and the MCP authorisation server. Supabase Auth is optional convenience, not the source of truth. Supabase passkeys exist but are experimental (D-2 verified).

#### 2.13 Fail-safe design *(replaces v2's "Fail-safe design")*

What v2 already does and this keeps: nightly encrypted backups to R2 in another provider, monthly automated restore tests, PITR once payroll is live, SES fallback, circuit breakers, expand-then-contract migrations, feature flags, canaries, kill switches, synthetic checks.

**Objectives by data class** (replaces the "recovery point of zero" sentence):

| Data class | RPO | RTO | Mechanism |
|---|---|---|---|
| Punch durably queued at edge | 0 | Replay after DB recovery | Queue retention plus device, bridge and app buffer |
| Punch not yet delivered | 0 | n/a | Local encrypted queue, retries with jitter |
| DB, before live payroll | Up to 24 h | Hours | Nightly encrypted backup to R2 |
| DB, once payroll is live | Minutes | 4 h only while the latest timed drill beats it | PITR (**hard gate** for the first live payroll) plus nightly backup |
| DB, Stage 2 | About 0 for AZ loss, minutes for region loss | Under 1 h AZ, under 4 h region | Multi-AZ plus same-jurisdiction replica |
| Payroll copy in customer storage | 0 once confirmed | Independent of Meridian once confirmed | Outbox write with `pending`/`confirmed` |
| Audit anchors | 0 | n/a | Object-locked bucket |

**Availability.**
- Stage 1: API 99.5% internal, no contractual SLA until the database has HA.
- Enterprise 99.95% only with multi-AZ DB, at least two API instances in separate zones, and a tested failover.
- Punch acceptance 99.9% at Stage 1. Zero punch loss comes from buffering, not from acceptance availability.
- No SLA exceeds the upstream providers' SLAs **[open D-13]**.
- Error budgets pause releases (as in v2).

**Durability.**
- Base backups plus continuous WAL to a different provider in the same jurisdiction. Logical dumps are additional.
- Backup keys are stored separately from backups.
- Monthly restore drills are timed and recorded. A quarterly full cell rebuild from infrastructure-as-code is added.
- PITR prerequisites need checking **[open D-14]**.

**Correctness.**
- Locks live in Postgres.
- Idempotency is written in the same transaction as the business write (C5). It covers database writes only. External effects (bank release, email) pass the key to the provider and retry through the outbox.
- The outbox relay uses `SKIP LOCKED` on at least two instances, and alerts on lag and size.
- Timers are due-row scans, and lateness is a metric.
- Optimistic locking, exclusion constraints and immutable finalised results are kept.

**Degraded modes** (v2's rows plus these):

| Failure | Behaviour |
|---|---|
| DB primary down | Edge accepts from cached devices. API is read-only from a replica if one exists, otherwise a maintenance page. Workers pause and pay runs stay at the last committed state. |
| API instance down | At least two instances behind the gateway, health-checked. |
| Queue provider down | Bridge and app buffer. Edge returns 503 with `Retry-After`. No silent drops. |
| Google or Graph down | Circuit breaker, queue and retry, email falls back to SES, payroll unaffected. |
| Storage token revoked | Connector degraded, writes queue, HR alerted. Payslips remain in the DB. |
| Pack signing key unavailable | Existing signed packs keep working and no new packs are accepted. |
| AI provider down | AI features show unavailable and everything else works. |
| Region loss | Fail over or restore in the same jurisdiction, with RPO communicated honestly. |

**Operations.** On-call rota, severity levels, a runbook per row above, a status page, a post-incident template, a customer-notification SLA, DLQ/outbox-lag/timer-lateness alerts, and a quarterly game day (kill the DB, kill the queue, revoke a connector token). A payroll freeze window applies around configured pay dates for tenants with live runs.

#### 2.14 Stage costs *(amends Stage 1)*

Stage 1 now needs at least two API instances plus a job worker, so v2's one-worker line is too low. My estimate is **+US$30-60 a month**, which gives roughly **US$160-190 before PITR**, and PITR is a further US$100 once payroll is live. These are unverified **[open D-21]**. Per-employee cost at 10,000 employees stays near US$0.02-0.03. Disk budget must include punches (§2.5). Neither the zone separation nor the 99.95% SLA is available at this stage (§1, item 7).

#### 2.15 Pricing text fixes *(amends "Meridian pricing")* `[D13: option B, partly done]`

- **Band 3 ratios.** At ₹88/US$, ₹59 and ₹119 are about 33.5% and 33.8% of list, and ₹229 is about 37%. Either say "about 33-37%" or set Enterprise India near ₹209 (about 34%). State the rate used.
- **API wording.** A basic read API on every tier. The full API and webhooks from Essential.
- **AI assumption.** Say "20 questions" (employee questions) versus "30 requests" (model calls including retrieval), or unify them. State 3,000 input and 500 output tokens per request. At the stated model price this reproduces about US$0.016 for 30 requests.
- **Margin.** USD margins reproduce from v2's stated costs: Essential 83%, Growth 85%, Enterprise 84%. India depends on support allowance:

| Tier (India) | Price at ₹88 | Margin with USD support allowance | Margin with reduced Band 3 support |
|---|---|---|---|
| Essential ₹59 | US$0.67 | about 54% (US$0.25) | about 77% (US$0.10) |
| Growth ₹119 | US$1.35 | about 61% (US$0.45) | about 80% (US$0.20) |
| Enterprise ₹229 | US$2.60 | about 61% (US$0.90) | about 81% (US$0.40) |

Variable costs here are infrastructure US$0.02, email US$0.002, AI US$0.016 and payment fees 2.5%. Say which support allowance applies in Band 3, since it decides whether "80-83%" is true.
- **Break-even.** The US$25,000 monthly team figure needs a composition. Include payroll-compliance staff, security audits, insurance and pack maintenance. These are not in the current number. I can't fill it in without your team plan.
- **Still open.** The free-tier limit, band country lists, tax handling (VAT/GST/sales tax) and whether a merchant of record is used.

#### 2.16 Build order *(replaces "Build now" and "Build later")* `[D8: option B]`

Order only, no dates.

- **R1 Core.** Identity, tenant/entity/org, role × scope with database RLS, people, approvals, documents with the storage connector, leave, holidays, announcements and bulk email, audit, data export, billing and tax.
- **R2 Time.** Punch hub, mobile punch with attestation, kiosk and rotating QR, Go bridge with the ZKTeco ADMS adapter, attendance rules, basic shifts.
- **R3 Payroll, one country first** `[D2: UAE]`. Engine, UAE pack at L2 with a parallel run, pay-run controls, continuity kit, partner mode. India follows, then the third market.
- **R4 Operations and AI.** Onboarding, offboarding and provisioning, helpdesk with policy answers, report builder and exports, MCP read/analyse/draft, in-app assistant with bring-your-own key.
- **Later.** MCP commit tier after red-team review, bounded agents, goals and reviews, face liveness, other device adapters, IoT presence, timesheets, compensation, recruiting, assets, extension marketplace, Parquet analytics, Temporal, dedicated cells, and the **email signature manager `[D7: gated on D-1]`**.

**UI contracts needed even though UI is deferred:** approval inbox, draft preview, connector consent, pay-run review, exception handling. Each needs data shapes.

**Definition of done adds:** threat model updated, privacy review for new fields, failure-injection test for new queues and jobs, i18n keys, data-classification entry for every field, retention class assigned, runbook entry, and API versioning policy followed.

#### 2.17 Decisions needed *(replaces v2's list)*

Provisional answers are in brackets. Please confirm or change each.

1. API hosting `[D1: Node containers per cell]`
2. Country order `[D2: UAE then India]`, plus the third market
3. Pack assurance and liability `[D3]`
4. Pack arithmetic `[D4: CEL plus Rust host functions]`
5. Payslip storage `[D5: freeze at finalise]`
6. Small-company approval `[D6]`
7. Signature manager `[D7: later, gated]`
8. Release scope `[D8]`
9. Database host `[D9: Supabase, with Neon tested]`
10. Identity stack `[D10]`
11. KMS and face-liveness vendor `[D11: KMS first]`
12. Storage identity `[D12]`
13. Pricing recalculation `[D13]`
14. Residency strictness `[D14]`
15. Bulk email domain `[D15: Meridian sub-domain by default]`
16. Licence `[D16: AGPL core, Apache-2.0 SDK and bridge, CLA if relicensing]`

---

### 3. ADR drafts (provisional)

Each ADR is one page in `docs/adr`. This table is the content.

| ADR | Decision | Reason | Rejected alternative |
|---|---|---|---|
| 001 | Node API containers per cell, Workers at the edge `[D1]` | Avoids Worker CPU, pooling and KMS-call limits and gives a standard HA unit | Workers + Hyperdrive: cheaper but unverified at payroll scale |
| 002 | UAE pack first `[D2]` | Simpler statutory surface, so the L2 process is proven before India | India first: more demand, more risk |
| 003 | Meridian-owned L2 packs with E&O cover `[D3]` | Live payroll needs a defensible assurance claim | Self-attested packs: can't credibly sell live payroll |
| 004 | CEL plus Rust host functions for money `[D4]` | One pack language, central rounding | Typed graph: stricter but a larger build |
| 005 | Freeze payslips at finalise `[D5]` | Stable legal document, survives Meridian | On-demand render: drifts when templates change |
| 006 | Owner approval with 24-hour delay for single-admin tenants `[D6]` | Keeps small companies usable with recorded risk | Require external approver, or bar them from live payroll |
| 007 | Signature manager deferred `[D7]` | Possible CASA assessment and key-compromise blast radius | Build now |
| 008 | R1-R4 release order `[D8]` | Matches a small team | One "Build now" list |
| 009 | Supabase for Stage 0-1, Neon tested `[D9]` | Bundled RLS tooling, as v2 assumed | Neon first |
| 010 | One identity module on vetted components `[D10]` | Hand-written OAuth is high risk | Supabase Auth or WorkOS as source of truth |
| 011 | KMS chosen before build `[D11]` | Crypto-shredding depends on it | Defer |
| 012 | Service account or integration user for storage `[D12]` | Survives staff changes | An admin's personal OAuth token |
| 013 | Full cost model for pricing `[D13]` | Support and compliance dominate cost | Keep prices and fix text only |
| 014 | Baseline residency, strict as Enterprise option `[D14]` | Strict locking may need paid features | Strict for everyone |
| 015 | Meridian sub-domain for bulk email by default `[D15]` | No customer DNS friction | Customer domain by default |
| 016 | AGPL core, Apache-2.0 SDK and bridge `[D16]` | As v1 proposed | Single permissive licence |
| 017 | Locks, idempotency and approvals live in Postgres `[Fixed]` | One system for data and its guards | Durable Object locks |
| 018 | Two-layer database authorisation `[Fixed]` | One bug can't leak restricted data | App-layer scope checks only |
| 019 | Payroll inputs snapshotted at lock `[Fixed]` | Makes "pure and reproducible" true | Read live tables |

---

## Part F: What happens next

1. **You** answer D1–D16, or confirm the provisional answers shown in Part E section 2.17. Nothing is final until you do.
2. **Me**, once you say so: check v2's References claim by claim, finish the open Part D items, write `PayrollCalcInput v1` as a final JSON Schema, and merge the Part E sections into a single v2.1 document in v2's structure. Each accepted ADR then becomes a page in `docs/adr`.
3. Re-run the adversarial review on the merged document as the final gate before developer handoff.

The SQL is design-level. The corrected C2 in particular needs review by someone who knows Postgres RLS before it becomes a migration. The payroll content is a specification, not tax advice: UAE and India rules, end-of-service, WPS formats and labour-code status need a local payroll professional (D-20). No build starts without your approval.

---

## Appendix 1: Payroll engine contracts

Source: the review's §6.2 and §6.3, kept here so this document stands alone. **The arithmetic paragraph depends on decision D4.** The review proposed a typed calculation graph with CEL for booleans only. The recommended alternative (D4 option B) keeps CEL for predicates and glue and gives money operations as Rust host functions on scaled integers. The pack assurance levels and the liability wording depend on D3.

### Engine contract

**The engine** is a deterministic function `calculate(input_snapshot, pack, engine_version) → result`. It has no clock, randomness, network or DB access. It rejects incomplete input; it **never applies silent defaults**.

**Arithmetic.**
- Money is integer **minor units** with the currency exponent from the ISO 4217 table (JPY 0, USD 2, KWD/BHD 3).
- Rates and intermediate values use **fixed-point decimals with ≥ 8 fractional digits**, or exact rationals. Round **only** where the pack's rounding profile says so. Each profile defines mode (half-up, half-even, down, up), the point of rounding (per line or per total) and the ordering.
- Numeric formulas are expressed in a **typed calculation graph** (JSON/AST) evaluated by the Rust engine. **CEL is used only for boolean predicates** (eligibility, conditions), never for money.
- Hours are stored as integer thousandths, and days as integer thousandths.

**Packs** are signed bundles:
- Data tables with effective dates: tax brackets, rates, caps, thresholds, contribution bases, holiday-dependent rules, deduction priority order, minimums, final-settlement rules, retention periods.
- Component definitions with flags: taxable, contributory, pensionable, overtime-base, gratuity-base.
- Report and bank-file templates.
- Metadata: jurisdiction, tax year, `assurance_level`, maintainer, changelog, test-vector hash, signature.

**Assurance levels** (live payroll requires L2 or higher):
- **L0 draft:** sandbox only.
- **L1 community-reviewed:** peer reviewed, not for live pay.
- **L2 verified:** reviewed by a named qualified local reviewer (tax or payroll professional), **independent test vectors** passed, and a **parallel run** matched an incumbent provider within defined tolerance for two consecutive cycles.
- **L3 certified:** where a regulator certifies software (e.g. recognised payroll software schemes).

**Pack lifecycle:** each pack has an owner and an update SLA (e.g. statutory changes shipped ≥ 14 days before effective date where the law allows). A tenant accepts a pack version before first use. Patch updates preview their effect on the next dry run. Mid-year rule changes carry effective dates and trigger retro calculation where the law requires it.

**Liability.** The terms of service state that the customer remains the employer of record for filings and payments. Meridian's warranty is limited to the verified pack's documented scope. Carry professional indemnity (E&O) cover before the first live payroll. Community-tier self-hosters use unverified packs at their own risk.

**Engine hosting.**
- Pay-run workers (Node, per cell) load the WASM engine from a signed, hash-pinned artefact store. Every run records `engine_hash`, `pack_hash` and `input_hash`. **Old engine versions are retained** so any past result can be reproduced.
- In Workers, the engine is **bundled at deploy time** for previews. Dynamic third-party WASM extensions run only in Node workers with a runtime like Wasmtime, with declared capabilities.


### Input and output contracts

```ts
PayrollCalcInput v1 {
  meta: {
    schema_version, run_id, run_type: "regular"|"off_cycle"|"final"|"retro",
    entity_id, pay_group_id, country_code,
    period: { start, end, pay_date },        // dates in entity timezone
    fiscal_year: { start, end },             // India Apr–Mar, UK Apr 6, US Jan–Dec…
    currency, currency_exponent,
    engine_hash, pack_id, pack_version, pack_hash, rounding_profile_id
  },
  employee: {
    employee_id, employment_id,
    start_date, end_date?, status, termination_reason?,
    work_location: { country, region, locality },
    tax_residency, tax_profile: { /* regime, filing status, codes, declarations,
                                      dependants, exemptions – pack-defined schema */ },
    social_security_profile, prior_employer_income?, 
    payment_instruction_ref                  // reference only, never raw bank data
  },
  pay_structure: [{ component_code, kind: "fixed"|"rate"|"formula_param",
                    amount_minor?|rate?, basis?, effective_from, effective_to? }],
  time: {
    calendar_days, scheduled_days, paid_days, unpaid_days, lop_days,   // ×1000
    overtime_hours: { [rate_class]: hours_x1000 }, night_hours_x1000,
    holiday_worked_days_x1000, proration_basis: "calendar"|"working"|"fixed_30",
    source_hash                                      // hash of attendance derivation
  },
  leave: { paid: {[type]: days_x1000}, unpaid_days_x1000,
           encashment_days_x1000, encashable_balance_x1000, source_hash },
  adjustments: [{ source_id, kind: "bonus"|"allowance"|"reimbursement"|"deduction"|
                  "loan_emi"|"garnishment"|"arrears", component_code, amount_minor,
                  taxable?, priority?, idempotency_key }],
  accumulators_in: { ytd_by_component, fy_gross, fy_taxable, fy_tax_withheld,
                     contributions_ytd, cap_usage, months_remaining?, … },
  retro?: { prior_result_ids[], corrected_from_period },   // for backdated changes
  fx?: { rates: [{from,to,rate_decimal,date,source}] },
  calendar: { holidays[], weekend_days[], working_days_in_period },
  final_settlement?: { last_working_day, notice_days_served, notice_days_owed,
                       service_years_decimal, gratuity_or_eosb_inputs… }
}
```

**Input rules**
- Every record has `source_id`, so each result line traces to its origin.
- Employee master data, attendance and leave summaries are **snapshotted into an immutable `payroll_input_snapshot`** with `input_hash` when the run locks. All calculation and later explanation read the snapshot, not live tables.
- Required fields are pack-declared. Missing required field means the employee is **excluded with a blocking exception**, never defaulted.
- Garnishment and deduction **ordering** (protected earnings, statutory priority) comes from the pack.

**Output**

```ts
PayrollResult v1 {
  input_hash, engine_hash, pack_hash,
  lines: [{ code, label_key, kind: "earning"|"deduction"|"employer_cost"|"tax"|"reimbursement",
            amount_minor, currency, taxable_base_minor?, rate?, 
            trace: [{ step, formula_ref, operands, rounded_by }] }],
  totals: { gross, taxable_gross, deductions, net, employer_cost },
  accumulators_out, warnings[], blocking_errors[]
}
```

---

## Appendix 2: Corrections made while merging

These are places where the review text differed from this workspace or from a primary source, and what this document says instead.

1. **Reference list.** The review said v2 had no reference list. It does, and the dossier is in the project. The review's citation check is therefore still to be done (Part F).
2. **Queues.** One reviewer claimed the Free plan no longer exists and Stage 0 costs US$5 a month. Cloudflare's pages say otherwise (D-5). v2's Stage 0 text stands.
3. **EU AI Act.** One reviewer gave 2 August 2026. The date is 2 December 2027 (D-7).
4. **Gmail scopes.** One reviewer recalled both `settings.*` scopes as sensitive. Both are restricted (D-1). v2 and `google.md` were right.
5. **Supabase passkeys.** Native support now exists but is experimental (D-2).
6. **Payroll finalisation.** One proposal made `finalised` wait for the Drive upload and released bank files only from `finalised`. That would stop salary payment during a Drive outage. A3.12 keeps the database commit authoritative and tracks the customer-storage copy as `pending` or `confirmed`.
7. **Recovery points.** One proposal gave finalised payroll a recovery point of zero through PITR. PITR gives minutes. C0 states this by data class.
8. **Crypto-shredding.** One proposal said deleting a salt row shreds data in all backups. Backups still hold the row. A5.2 requires key backups to expire on a documented schedule.
9. **Added item.** A5.13 (Play Integrity shared quota) was not in the review. It came out of the D-8 check.
10. **Open points flagged in the sketches.** C3 (`rejected` state versus the unique index) and C5 (unbounded `punch_dedupe`).
11. **Second draft merged (Part E).** The reviewer's corrected SQL and amended sections were added as Part E. Its `[blocked D-#]` tags were updated where I have since verified the item (D-2, D-3, D-5, D-6 in part, D-7). Its cross-reference to "§6.3 of my first review" now points to Appendix 1. Its Hetzner single-zone assumption is logged as D-22 instead of being tagged to D-21 (a price item).
12. **Left as the reviewer wrote it.** Part E section 4 ("what I did not do") was dropped because Part F replaces it. Section 1 item 1 to 6 corrections stand. Two details remain for the Postgres reviewer: `app.is_self`, `app.can_write` and `role_field_grant.can_write` are named but not defined, and the corrected C1 note says the role must be denormalised onto the scope row but does not show the final DDL.
