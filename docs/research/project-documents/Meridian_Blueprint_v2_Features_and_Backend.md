# Meridian v2: Features and Backend Blueprint

**Author:** Manus AI. **Status:** design for developer handoff, not yet approved for build. **Scope:** the complete feature set and the backend that runs it. User-interface design is intentionally left out and will be decided later, so every feature below is described as behaviour, data and services that any web, mobile or kiosk interface can call. There are no timelines in this document; the "build now" and "build later" lists at the end describe order of priority only.

Meridian is one global people platform for companies of any size and in any country. It covers core HR, documents, communications, onboarding, scheduling, attendance, leave, payroll, expenses, performance, helpdesk, analytics, automation and AI. Three decisions make it different from the 31 platforms studied in the research dossier. First, it reuses what the customer already pays for: their Google Workspace or Microsoft 365 identity, storage, mail, calendar and chat, and their ChatGPT, Claude, Copilot or Gemini subscription. Second, it is built free-tier-first on Cloudflare and managed PostgreSQL, so the running cost per employee stays around one to two US cents a month. Third, every module shares one core of approvals, documents, notifications, policies and audit, so features are not repeated across modules the way bolt-on suites repeat them [1] [2].

## How the design was reasoned

Each major choice was tested against four questions before it went in. Does it still work if one provider fails? Does it keep sensitive employee data inside a boundary the customer controls? Does it keep Meridian's own cost per employee near zero as volume grows? Can a small team build and run it? Where two options passed all four, the simpler one won. For example, v1 proposed Temporal, NATS, OpenFGA and Cerbos from day one. v2 keeps the same guarantees but starts with PostgreSQL-backed state machines, Cloudflare Queues and an in-process policy engine, and it names the exact point at which each heavier tool is worth adding.

The dossier showed three recurring buyer complaints: pricing that is opaque or split into add-ons, payroll that is a black box, and AI that is either a chatbot or an uncontrolled agent [1] [2] [3]. The features below answer those complaints directly, rather than copying every feature that a competitor lists.

## Who uses Meridian: tenants, roles and scoped handlers

A **tenant** is one customer company. A tenant contains one or more **legal entities** (the employing companies, each in a country), and each legal entity contains **org units** such as departments, locations, teams and cost centres. People hold **employments** in a legal entity and are placed in org units through **positions**. This layout is what allows a single customer to run staff in India, the UAE and Germany under one login, with different payroll rules for each entity.

Meridian has two sides that share one API. The **company side** is where owners, HR, payroll, finance and IT run the organisation. The **employee side** is self-service for every worker, on the web and on mobile. The two sides are not separate apps or separate databases. They are the same services seen through different permissions, which removes the duplicate logic that many suites carry between their admin and employee products.

Roles are assigned as **role × scope** pairs instead of fixed global roles. A scope can be the whole tenant, one or more legal entities, departments, locations, cost centres, or an explicit list of employees. This is how a department can have one, two or three HR handlers. Each handler gets the HR Executive role scoped to that department. One handler is marked primary and the others are backups, and work such as document reviews or helpdesk cases is shared between them in rotation or by current workload. When the primary handler is on leave, the leave calendar automatically routes work to a backup.

The standard roles are listed here because developers need the exact set.

- **Account owner**: billing, subscription, tenant deletion and break-glass recovery.
- **HR administrator**: tenant-wide HR configuration and all HR data except restricted payroll fields unless also granted payroll.
- **HR manager**: full HR operations within a scope, plus approval of handler actions.
- **HR executive (handler)**: day-to-day HR work within a scope, such as documents, onboarding tasks, cases and attendance corrections.
- **Payroll preparer** and **payroll approver**: kept separate so that no single person can both prepare and release a pay run.
- **Finance approver**: expenses and payroll funding approval.
- **People manager**: their own reports, for approvals, reviews and team views.
- **Executive viewer**: leadership analytics as aggregates only, with no individual restricted fields.
- **IT administrator**: integrations, SSO, devices and the MCP connector, without access to HR records.
- **Auditor**: time-boxed, read-only access with every view logged.
- **Employee**, **contractor** and **new hire (pre-boarding)**: self-service with progressively fewer rights.

**Backend.** Role assignments live in a `role_assignment` table with `tenant_id`, `principal_id`, `role`, `scope_type`, `scope_ids`, `valid_from` and `valid_to`. A policy engine inside the API evaluates every request as *who* (principal and roles), *what* (resource and field class), *where* (scope match) and *why* (purpose, such as payroll run or helpdesk case). PostgreSQL row-level security enforces the tenant boundary on every table. The application policy layer enforces scope and field rules on top of it. Field classes are `public`, `internal`, `confidential`, `restricted` (salary, bank, national ID) and `special` (health, biometrics, disciplinary). Each class has a default visibility per role.

**Why this way.** Fixed roles force customers to create dozens of near-duplicate roles, one per department. Role × scope keeps the role list short and makes delegation and backup handlers a data change, not a configuration project. Putting the tenant check in the database means a coding mistake in one endpoint cannot leak another customer's data.

## Shared services every feature reuses

Seven shared services appear in almost every feature below. Each is built once, and modules call it instead of re-implementing it.

The **approvals engine** runs multi-step approvals. It supports sequential, parallel and "any one of" steps, delegation, escalation timers, and the rule that a requester cannot approve their own item. An approval is a row in `approval_instance` with an ordered list of steps; actions are appended as events, never updated in place. Approvals can be answered in Meridian, in an email link, in a Google Chat card or in a Microsoft Teams Adaptive Card. All four routes call the same signed action endpoint [4] [5].

The **document service** stores metadata, versions, hashes and retention rules in Meridian. The file bytes go to the customer's own Google Drive or SharePoint by default, and to an encrypted Meridian R2 bucket only when the customer has neither.

The **notification service** decides channel (in-app, push, email, chat), language, quiet hours and digesting for every message.

The **policy and rules service** holds country, entity and company rules (leave, attendance, payroll, expenses) as versioned, signed rule packs, so rules change without code changes.

The **workflow engine** runs long processes such as onboarding, pay runs and offboarding. Each process is a PostgreSQL state machine with steps, timers and retries, driven by queue messages.

The **audit service** writes an append-only, hash-chained record of every read of restricted data and every change.

The **search service** provides typo-tolerant search over people, documents and cases, filtered by the caller's permissions before results are returned.

## Feature catalogue, organised by page

Each area below is a "page" or product area. Every feature gives its name, what it does, how it works, the backend design, and why that design was chosen. Features marked **(later)** are designed now but listed in the build-later section.

### Page 1: Company setup and structure

#### Tenant and legal-entity setup

**What it does.** Creates the company, its legal entities, registered addresses, tax registrations, pay frequencies, working weeks, currencies and default language.

**How it works.** The owner signs in with Google or Microsoft. Meridian reads basic organisation details where the customer allows it. The owner adds entities by country, and choosing a country attaches that country's rule pack, such as public holidays, leave minimums and payroll rules, with a visible version number.

**Backend.** The `tenant` row is created in the global control plane, which assigns the tenant to a regional cell. `legal_entity` rows live in the cell database and carry `country_code`, `rule_pack_id` and `rule_pack_version`. Setup is one idempotent API call per step, so a dropped connection can be retried safely.

**Why this way.** Binding rule packs per entity, not per tenant, is what makes one tenant global. Recording the pack version on each entity means any payroll or leave result can later be explained against the exact rules that produced it.

#### Org structure and positions

**What it does.** Models departments, locations, teams, cost centres and positions, with reporting lines and matrix managers.

**How it works.** HR builds the structure by import or by editing. Changes can be dated in the future, for example a reorganisation that takes effect on the first of next month, and Meridian shows the structure as of any date.

**Backend.** Org units are a closure table (`org_unit`, `org_unit_path`) so "everyone under this department" is one indexed query. All structural rows are bitemporal. `valid_from` and `valid_to` say when the fact is true in the business, and `recorded_at` says when Meridian learned it. Scope checks for handlers reuse the same closure table.

**Why this way.** Effective dating is required for payroll, audits and backdated corrections. A closure table keeps permission checks fast even for companies with deep hierarchies.

#### Company policies as rules

**What it does.** Holds the company's own policies, such as probation length, notice periods, overtime rules, expense limits and attendance grace times, on top of the country rule pack.

**How it works.** HR picks a template and edits parameters. Meridian checks the policy against the country pack's legal minimums and warns when a policy is below them.

**Backend.** Policies are stored as typed parameters plus optional expressions in CEL (Common Expression Language, a small, safe, non-Turing-complete expression language). They are evaluated by the rules service. Each change creates a new version; old versions remain for history.

**Why this way.** Parameters cover most needs without code. CEL covers the rest safely, because an expression cannot loop forever, call the network or read other tenants' data.

### Page 2: People

#### Employee profile and effective-dated record

**What it does.** One record per person: personal details, employment details, job and pay history, emergency contacts, bank details, identity documents and custom fields.

**How it works.** Employees edit their own permitted fields, and changes to sensitive fields such as bank account or legal name go to HR for approval with proof attached. HR sees a timeline of every change.

**Backend.** Data is split into `person` (the human) and `employment` (each job contract), so a rehire or a second contract in another entity keeps one person and one history. Restricted fields such as bank account and national ID are encrypted in the application with a per-tenant data key before they reach the database. Only a masked form, such as the last four digits, is stored for display. Custom fields are typed JSONB validated against a per-tenant schema.

**Why this way.** Separating person from employment avoids duplicate people, the most common data-quality problem in HR systems. Application-level encryption means a database backup or a leaked read replica does not expose bank details.

#### Directory and org chart

**What it does.** Searchable people directory and live org chart, with presence and contact details pulled from Google or Microsoft where connected.

**How it works.** Employees search by name, skill, team or location. What they see depends on their role, so an employee sees work contact details while HR sees more.

**Backend.** The search index stores only `public` and `internal` fields and is filtered by tenant and scope at query time. Profile photos and basic directory attributes can be read from Microsoft Graph with `User.ReadBasic.All` or from the Google Directory API, instead of asking people to upload them again [6] [7].

**Why this way.** Keeping restricted fields out of the search index removes a whole class of leaks, because search can never return what it never stored.

#### Lifecycle changes: promotions, transfers and pay changes

**What it does.** Handles promotions, transfers between departments or entities, title and pay changes, and probation confirmation as single dated events.

**How it works.** A manager or HR raises the change. The approvals engine routes it, and on approval the change takes effect on its effective date. Letters are generated, payroll picks up the new pay from the correct date, and access scopes move automatically.

**Backend.** Each change is a `lifecycle_event` that writes new bitemporal versions of the affected rows inside one transaction. It emits an outbox event that payroll, access, documents and notifications consume.

**Why this way.** One event with many consumers means a transfer updates payroll, permissions and documents together, rather than relying on HR to remember four separate screens.

#### Bulk import and bulk update

**What it does.** Imports or updates thousands of records from CSV, Excel or Google Sheets, with validation before anything is saved.

**How it works.** HR uploads a file or picks a Sheet. Meridian maps the columns, shows every error and warning row by row, and applies only when the file is clean or when HR chooses to skip the bad rows.

**Backend.** The import runs as a background job: parse, validate against schema and rules, stage the rows in a staging table, then apply in batches with one idempotency key per row. A Google Sheet is read through the Sheets API using a file the user picked with Google Picker, so the `drive.file` scope is enough [8] [9].

**Why this way.** Staging first means a half-applied import can never happen. Row-level idempotency means a retried job never creates duplicates.

### Page 3: Documents and HR utilities

#### Document collection requests into the customer's own folders

**What it does.** HR asks one person, a department or the whole company for documents, such as ID proof, degree certificates, signed policies or tax declarations. Each file lands automatically in the right folder in the company's Google Drive or SharePoint, for example `HR / Employees / EMP-0142 Priya Sharma / Identity`.

**How it works.** HR creates a request with a list of required items, file rules (type, size, whether it expires), a due date and reminders. Each employee receives a task with a secure upload link. When they upload, Meridian checks the file, places it in their folder, names it to a standard pattern, records the expiry date and marks the item complete. HR sees a live tracker of who has submitted, who is late and what is about to expire, and can send reminders in bulk.

**Backend.** At connection time the customer's admin chooses a root folder or shared drive. For Google, Meridian uses the non-sensitive `drive.file` scope together with Google Picker, so it can only touch the folders and files created by or shared with the app [10] [8]. A shared drive is preferred because files there belong to the organisation rather than to an individual, and they use the customer's pooled storage [11]. For Microsoft, Meridian uses `Sites.Selected` or `Files.SelectedOperations.Selected`, which start with no access until the customer's admin grants a specific site [12]. The upload goes from the browser or app to a short-lived, pre-signed upload session, is scanned for malware in a worker, and is then streamed into the customer's folder. Meridian stores only the file ID, path, hash, item type, expiry and status. Customers without either suite fall back to an encrypted R2 bucket.

**Why this way.** The customer already pays for this storage, keeps control of retention and legal hold, and Meridian's storage bill stays near zero. Least-privilege scopes also keep the Google verification burden low, because `drive.file` avoids the restricted-scope security assessment that broad Drive access triggers [13].

#### Employee digital folder

**What it does.** Gives each employee one place for their own documents: contract, letters, payslips, tax forms, certificates and policy acknowledgements.

**How it works.** Employees see only their own documents and the company documents shared with them. HR sees the folders within their scope. Expiring documents such as visas and work permits create reminders for both sides.

**Backend.** The folder is a view over `document` metadata filtered by owner and permissions, not a separate store. Payslips are rendered on demand from the stored, immutable payroll result. If the company turns on filing, a copy is also written to the employee's folder in Drive or SharePoint.

**Why this way.** Rendering on demand removes the cost of storing millions of PDFs, and the immutable payroll result guarantees the same payslip every time it is opened.

#### Letter and template generation

**What it does.** Generates offer letters, appointment letters, experience letters, salary certificates and custom templates in bulk or one at a time.

**How it works.** HR writes templates with merge fields, such as `{{employee.first_name}}` and `{{employment.salary.annual}}`. Meridian previews the result, and HR can generate for one person or a filtered list, then send for acknowledgement or signature.

**Backend.** Templates are stored as HTML with a sandboxed Liquid-style renderer that can read only whitelisted fields the caller is allowed to see. PDF rendering runs in a background worker. Output goes to the customer's Drive folder through the document service.

**Why this way.** A sandboxed template language prevents a template from pulling fields the author is not allowed to see. That is a real risk when handlers can edit templates.

#### Acknowledgements and e-signature

**What it does.** Collects "I have read and accept" acknowledgements for policies and simple signatures on letters, with a full audit trail. Legally heavier signatures go to a connected e-signature provider.

**How it works.** An employee opens the document, confirms, and Meridian records who, when, from which device, and the hash of the exact document version.

**Backend.** Each acknowledgement is an append-only row with a document hash, signer identity, authentication method and timestamp, chained into the audit log. Provider signatures use a pluggable adapter interface.

**Why this way.** Most HR acknowledgements do not need a paid signature provider. Recording the document hash proves what was accepted, and the adapter keeps qualified signatures available where the law requires them.

#### Email signature manager

**What it does.** Gives every employee a consistent, correct company email signature built from HR data, so a new title or phone number updates the signature automatically.

**How it works.** HR or marketing designs one or more signature templates with fields such as name, title, department, phone, office address, pronouns, a banner and legal text. Templates are assigned by department, location or entity. When a profile changes, Meridian regenerates that person's signature.

**Backend.** For Google Workspace, Meridian calls the Gmail `users.settings.sendAs.update` method, which accepts an HTML signature. Updating aliases across the domain requires the `gmail.settings.sharing` scope, used by a service account with domain-wide delegation that the customer's super admin explicitly grants. A single user can authorise their own primary address with `gmail.settings.basic`, which Google classifies as restricted [14] [15]. For Microsoft 365, Microsoft Graph has no documented API to set Outlook signatures centrally, so Meridian does not promise it [16] [17]. Instead, Meridian generates the HTML and, with the Exchange admin's approval, deploys it as an Exchange Online transport rule that appends the signature to outgoing mail. This is a documented, supported mechanism [18]. A copy-and-install option is always available as a fallback.

**Why this way.** The approach uses only documented APIs and is honest about the Microsoft limit. Domain-wide delegation is powerful, so it is opt-in, limited to one scope, and revocable by the customer at any time [19].

### Page 4: Communications

#### Announcements and targeted messages

**What it does.** Sends messages to everyone, to departments, locations or entities, to a saved audience such as "all managers in Dubai", or to hand-picked people. Messages can require a read confirmation.

**How it works.** HR writes the message, chooses the audience and channels (in-app, push, email, Google Chat or Teams), and schedules or sends it. Meridian shows delivery, open and acknowledgement rates, and can resend to people who have not read it.

**Backend.** An audience is stored as a rule, such as `department in (D12, D14) AND location = 'Dubai'`, evaluated at send time against current data. It can also be a static list. The send job expands the audience, writes one `message_delivery` row per person per channel, and hands each row to the right channel adapter through a queue. Department lists can sync to customer-owned Google Groups or Microsoft 365 groups when the customer prefers distribution lists [20].

**Why this way.** Rule-based audiences stay correct as people join and leave. Per-delivery rows make retries safe and give exact delivery reports.

#### Bulk email engine that respects provider limits

**What it does.** Delivers large email sends, such as payslip notices or policy updates to 5,000 staff, reliably and without getting the customer's mailbox blocked.

**How it works.** Personal, low-volume messages can be sent "as" HR from their own Gmail or Outlook, so they appear in HR's sent folder. Large sends go through Meridian's transactional mail provider using the customer's verified domain, with proper SPF, DKIM and DMARC records.

**Backend.** Google Workspace allows about 2,000 messages a day per paid user and at most 500 recipients per message, and exceeding the limits can suspend sending for up to 24 hours [21]. Exchange Online allows 10,000 recipients a day per mailbox and 30 messages a minute, and Microsoft says it is not designed for bulk mail [22]. Meridian therefore keeps a token bucket per connected mailbox in a Cloudflare Durable Object, which acts as a single-threaded counter per mailbox. It routes anything above a safe threshold to Amazon SES at about US$0.10–0.16 per 1,000 emails [23]. The Gmail integration uses only the sensitive `gmail.send` scope and never a mailbox-reading scope [14].

**Why this way.** Sending large volumes through one mailbox gets blocked. Routing by volume gives the personal touch where it matters and reliability where it counts, at a cost of cents.

#### Chat and Teams posting

**What it does.** Posts announcements, reminders and approval cards into Google Chat spaces or Microsoft Teams channels and chats.

**How it works.** IT connects the Meridian Chat app or Teams app once. HR then picks spaces or channels as message channels, and approvals arrive as interactive cards.

**Backend.** Google Chat apps send card messages with buttons that call Meridian's backend [4]. On Teams, Meridian uses a bot with Adaptive Cards and Resource-Specific Consent where possible, so it gets access to only the teams it is added to. It uses `ChannelMessage.Send` and `ChatMessage.Send` only where a message must be sent as a user [6] [5]. Every card action is verified against the tenant and role before it is executed.

**Why this way.** People act faster in the tools they already have open, and verifying every card action on the server prevents a forwarded card from being used by the wrong person.

#### Surveys and pulse checks

**What it does.** Runs short engagement and pulse surveys, eNPS and onboarding or exit surveys, with anonymous results.

**How it works.** HR picks a template, an audience and a schedule. Results appear only when at least five people in a group have answered.

**Backend.** Responses are stored with a per-survey random respondent key, not the employee ID, when the survey is anonymous. Reports enforce a minimum group size of five, and free-text comments are scanned for names before display.

**Why this way.** Anonymity enforced in the data model is stronger than anonymity promised in the interface.

#### Notification preferences and digests

**What it does.** Lets every user choose channels and quiet hours, and bundles low-priority notices into a daily digest.

**How it works.** Urgent items, such as an approval that blocks payroll, ignore the digest. Everything else follows the user's settings and time zone.

**Backend.** The notification service holds a priority per message type and a preference per user. A scheduled job builds digests in each user's local time.

**Why this way.** Notification fatigue is a common cause of missed approvals, and digests reduce message volume and mail cost.

### Page 5: Onboarding and offboarding

#### Pre-boarding portal for new hires

**What it does.** Gives a new hire limited access before day one, to accept the offer, fill personal and bank details, upload documents, read the welcome pack and see their first-week schedule.

**How it works.** When an offer is accepted, Meridian creates a `new_hire` principal and emails a sign-in link. The new hire signs in with email OTP or a passkey, and becomes a full employee on their start date.

**Backend.** The new hire role has the narrowest scope in the system: their own record and the documents shared with them. Their document collection request is created from the onboarding plan and files land in their Drive or SharePoint folder, as in the document collection feature.

**Why this way.** Collecting data before day one removes the first-day paperwork rush, and the narrow role means a pre-boarding link cannot see anything else.

#### Onboarding plans and checklists

**What it does.** Runs a repeatable onboarding plan for each role, location or entity. Tasks are assigned to HR, IT, the manager, a buddy and the new hire, each with a due date relative to the start date.

**How it works.** HR builds plans from templates, such as "Engineering, India" or "Sales, UAE". When a hire is confirmed, the plan is instantiated with real dates and owners. Overdue tasks escalate, and the manager sees one view of what is ready.

**Backend.** A plan is a workflow definition (steps, owners as role-in-scope, relative offsets and conditions). An instance is a PostgreSQL state machine row that advances on events. Timers are stored as due rows scanned by a scheduler, so nothing depends on a process staying alive.

**Why this way.** Relative dates and role-based owners make one template work for every hire. Durable timers in the database survive restarts and deploys.

#### Account provisioning to Google Workspace and Microsoft 365

**What it does.** Creates the new hire's work account, adds them to the right groups and licences, and removes access on exit, driven by HR data.

**How it works.** The customer chooses a direction. Meridian can be the source of truth and push accounts to Google or Microsoft, or the customer's identity provider can push users into Meridian. Either way, joining, moving and leaving are synchronised.

**Backend.** Inbound provisioning uses Meridian's SCIM 2.0 endpoint, which Microsoft Entra's provisioning service calls to create, update and deactivate users [24]. For Google there is no general SCIM provisioning to third-party apps, so Meridian uses the Directory API with admin-authorised credentials for create, update, suspend and group membership [25] [7]. Outbound writes are optional, admin-approved and logged. Every change is an idempotent job keyed by employee and target system.

**Why this way.** HR data is the most reliable signal that someone has joined, moved or left. Driving accounts from it closes the gap where ex-employees keep access for days.

#### Offboarding and deprovisioning

**What it does.** Runs the exit process: resignation or termination capture, notice period, handover tasks, asset return, exit interview, final settlement, experience letter, and access removal on the last day.

**How it works.** HR or the manager records the exit. Meridian builds the offboarding checklist, schedules the access cut-off for the exact local time, and blocks the final settlement until assets are returned and approvals are complete.

**Backend.** Offboarding is a workflow instance. The access cut-off is a scheduled job that deactivates the Meridian account, revokes MCP and API tokens, and calls the SCIM or Directory deprovisioning path. The final settlement is an off-cycle pay run in the payroll engine. Drive ownership transfer stays a customer admin action in Google or Microsoft, and Meridian creates the task and the reminder for it.

**Why this way.** Most security incidents after an exit come from forgotten access. A scheduled, audited cut-off tied to the HR record is the dependable fix.

### Page 6: Scheduling

#### Interview, onboarding and review meeting scheduling

**What it does.** Finds a time that works for everyone and books it with a Google Meet or Teams link: interviews, induction sessions, one-to-ones and review meetings.

**How it works.** The organiser picks participants and a duration. Meridian reads free and busy times only, proposes slots, and books the chosen one on the organiser's calendar with invites.

**Backend.** On Google, Calendar `events.insert` with `conferenceData` creates the event and the Meet link [26] [27]. On Microsoft, Graph calendar events and `findMeetingTimes` handle the same job, and an online meeting is attached to the event [28] [29]. Meridian requests free and busy access, never the content of other people's events. It stores only the event ID and link.

**Why this way.** Using the customer's calendar means invites appear where people already work, recordings and notes stay in the organiser's storage [27], and Meridian runs no meeting infrastructure.

#### Shift scheduling and rosters

**What it does.** Builds weekly or monthly rosters for shift-based teams, with templates, rotations, open shifts, swaps and coverage rules such as "at least two supervisors on every night shift".

**How it works.** A scheduler copies last week, applies a rotation or uses auto-fill. Meridian checks every assignment against availability, approved leave, maximum hours, minimum rest and skills, and highlights conflicts. Employees accept swaps with each other, and a manager approves when the policy requires it.

**Backend.** Shifts and assignments are rows with time ranges in the location's time zone and an exclusion constraint that blocks double-booking. The constraint checker is a pure function in the rules service, so the web app, mobile app and auto-fill all call the same logic. Auto-fill is a greedy assignment with constraint checks. An optimiser is a later option.

**Why this way.** One shared constraint checker prevents the common bug where the mobile app allows a swap that the web app would have blocked.

#### Holiday and work calendars

**What it does.** Maintains public holidays per country and region, company holidays and optional or floating holidays.

**How it works.** The country rule pack supplies public holidays. HR adds company days and chooses which apply to which locations.

**Backend.** Holiday calendars are data in rule packs, versioned per year, and joined to locations. Leave, attendance and payroll read them through one calendar function.

**Why this way.** A single calendar source stops leave and payroll from disagreeing about whether a day was a holiday.

### Page 7: Time and attendance

![Device and mobile attendance flow](/home/ubuntu/hr_research/v2/diagrams/devices.png)

#### Punch ingestion hub

**What it does.** Accepts every kind of attendance event in one pipeline: biometric terminals, face devices, RFID and NFC, mobile app punches, web punches, kiosks, QR scans and vendor clouds.

**How it works.** Every source sends a punch to one ingestion API. Meridian answers each punch as accepted, duplicate or rejected, then turns raw punches into worked time using the employee's shift and policy.

**Backend.** A Cloudflare Worker receives punches at the edge, verifies the source credential, signature, nonce and timestamp window, writes the event to a queue and returns immediately. A normaliser converts each event into one canonical punch with tenant, site, device, employee external ID, event time, received time, time-zone offset, direction, verification method, confidence and the hash of the raw payload. The idempotency key is the vendor event ID per device when one exists, otherwise a hash of device, employee, time, status and sequence [30] [31]. Late and duplicate events are kept for audit but never double-counted. The batch API accepts up to 1,000 events per call and backfill over a window, which matches what device vendors already expect from Keka's ingestion API [31].

**Why this way.** Accepting at the edge and processing behind a queue means a database incident never loses a punch. One canonical format means attendance rules never care which device produced the event.

#### Biometric device bridge

**What it does.** Connects fingerprint and face terminals from the common vendors, including ZKTeco, eSSL, Hikvision, Suprema, Dahua, Anviz and Matrix, even when the devices sit behind an office firewall.

**How it works.** IT installs a small Meridian bridge on any always-on Windows, Linux or ARM machine at the site, or points push-capable devices at it. The bridge discovers devices, collects punches, syncs employee lists and corrects device clocks. Where the vendor offers a cloud with webhooks, such as Anviz CrossChex Cloud or eSSL eBioServer, Meridian connects cloud to cloud with no bridge [32] [33].

**Backend.** The bridge is a single static Go binary. It has one adapter interface with `discover`, `read_events`, `ack`, `set_time`, `sync_users` and `health`. The first adapter is the ZKTeco ADMS push receiver (`/iclock/cdata`, `getrequest`, `devicecmd`, with ATTLOG rows) [30] [34], followed by adapters for eSSL eBioServer, Hikvision ISAPI and HikCentral OpenAPI [35] [36], Suprema BioStar X API [37], Dahua HTTP Push [38] and Matrix COSEC API or database [39]. Each event is written to an encrypted local SQLite queue before the device is acknowledged. The bridge then signs the normalised event with its own key and sends it over mutual TLS with exponential backoff, so punches survive internet outages of days. The bridge tracks clock drift per device and flags jumps instead of rewriting history.

**Security.** A device serial number is visible in ADMS traffic and is not a secret, and researchers have found serious vulnerabilities in some terminals [30] [40]. Devices are therefore treated as untrusted. They sit on an isolated network segment, talk only to the bridge, are bound to a site and an enrolment secret, and are never exposed to the internet directly.

**Why this way.** This mirrors the patterns that working HR platforms use, a local sync agent or direct push [41] [42], but adds signed events, durable buffering and idempotency, which those patterns often lack. Go gives a tiny, dependency-free install on any operating system.

#### Mobile punch with location and device trust

**What it does.** Lets field and remote staff punch in and out from the app, inside approved geofences or anywhere, depending on policy, with protection against fake GPS and modified apps.

**How it works.** The employee taps to punch. The app collects location, accuracy, network and device signals and requests a fresh integrity verdict. Meridian scores the punch and accepts it, accepts it with a flag for review, or asks for an extra proof such as a selfie or a QR scan.

**Backend.** On Android, Play Integrity verifies the genuine app on a certified device, bound to a server nonce and a hash of the request [43]. `Location.isMock()` is used as one signal among several, because mock locations can be legitimate [44]. On iOS, App Attest proves that the request came from a genuine app instance [45]. The risk score combines geofence match and dwell time, accuracy, speed since the last punch, Wi-Fi or BLE beacon evidence, IP network anomalies and the integrity verdict. The server always makes the decision, and the app never decides on its own.

**Why this way.** GPS alone is easy to fake, and blocking every low-trust device causes support tickets. Scoring with review keeps honest users moving and still catches fraud.

#### Face verification with liveness

**What it does.** Confirms that the person punching is the employee and is physically present, for sites that choose it.

**How it works.** The app takes a short selfie video. Meridian checks liveness and matches against the employee's enrolled reference, then records the result on the punch.

**Backend.** On-device face detection, such as ML Kit, guides framing only, because it detects faces but does not recognise people or prove liveness [46]. Liveness and matching use a pluggable provider, such as AWS Rekognition Face Liveness, which returns a 0–100 confidence score, or FaceTec [47] [48]. Each check is billed to the tenant as usage. Enrolment requires explicit, recorded consent. Raw face images are not kept after the check by default, and the stored reference is encrypted and separated from the identity mapping. A non-biometric fallback is always available.

**Why this way.** Biometric data is special-category data under GDPR Article 9, and laws such as Illinois BIPA require notice, written release and a published retention policy [49] [50]. Making face checks opt-in, consent-recorded and pass-through priced keeps both the legal risk and Meridian's fixed costs low.

#### Kiosk, rotating QR and NFC punches

**What it does.** Supports a shared tablet at the entrance, a QR code on a screen that employees scan with their own phone, and NFC tags or cards.

**How it works.** A kiosk tablet runs locked to the Meridian app. In QR mode, a screen at the site shows a code that changes every few seconds, and employees scan it from their registered phone. In NFC mode, employees tap a tag or card, optionally with a PIN.

**Backend.** Kiosks are managed devices in Android lock-task mode [51]. The QR code contains only a short-lived signed site challenge, never names or employee IDs. The server checks freshness, single use, device attestation and location evidence. NFC tags can be cloned, so they act as an identifier plus a server nonce, combined with a PIN or selfie where the risk is higher [51].

**Why this way.** A rotating, signed QR proves presence at the site cheaply, with no hardware beyond a screen.

#### IoT presence signals (later)

**What it does.** Uses Wi-Fi network, BLE beacon or door-access events as evidence of presence or as automatic punches for sites that want hands-free attendance.

**How it works.** The site registers beacons or networks. The app or the bridge reports when an employee's registered device sees them, and policy decides whether that counts as a punch or only as supporting evidence.

**Backend.** These signals enter the same ingestion hub as low-confidence events. Beacon IDs can be cloned, so they never count as proof on their own [44].

**Why this way.** Treating IoT as evidence, not proof, adds convenience without opening a fraud path.

#### Attendance rules, regularisation and overtime

**What it does.** Turns punches into daily attendance: present, late, early exit, half day, absent, on leave, holiday, overtime and night hours. Employees request corrections for missed punches.

**How it works.** Each shift has rules for grace time, rounding, breaks, minimum hours and overtime thresholds. A missed punch creates a regularisation request that goes through approvals, and the attendance day is recalculated.

**Backend.** Attendance days are derived records. They are recomputed by a deterministic function from punches, shift, leave, holiday and policy version, and stored with the inputs' hash. Any late punch or approved correction triggers recomputation of only the affected days. Locked periods, those already paid, accept corrections only as dated adjustments into the next pay run.

**Why this way.** Derived, recomputable days mean the attendance shown is always explainable from its inputs. Locking paid periods prevents silent changes after payroll.

#### Timesheets and project time (later)

**What it does.** Records hours against projects, clients and tasks for billing and costing, with approval by project owners.

**How it works.** Employees log time weekly or from a timer. Project owners approve, and approved time flows to reports and, where applicable, to payroll.

**Backend.** Time entries reference a project dimension that is kept separate from the org structure. Approvals use the shared engine.

**Why this way.** Only 6 of the 31 platforms offer native project time, so it is a differentiator, but it is not needed for the first customers [1].

### Page 8: Leave

#### Leave policies and accruals

**What it does.** Defines leave types (annual, sick, parental, unpaid, compensatory and custom), how they accrue, carry forward, expire and encash, per entity, location or grade.

**How it works.** HR starts from the country pack's legal minimums and adds company rules. Meridian previews the effect on sample employees before a policy goes live.

**Backend.** Balances are never stored as a single number that gets edited. They are a ledger of accrual, use, adjustment, expiry and encashment entries. The balance is the sum, materialised for speed and rebuilt on any policy change. Accrual runs as a scheduled job per tenant and is idempotent per period.

**Why this way.** A ledger makes every balance auditable and makes backdated policy changes safe to replay. Editing a balance field directly is the usual source of leave disputes.

#### Leave requests and approvals

**What it does.** Employees request leave, see their balance after the request, see team overlap, and get a decision quickly.

**How it works.** The request checks the balance, the policy, blackout dates and minimum staffing for the team. It then routes to the manager and, if needed, HR. Approved leave appears on the shared calendar and blocks shifts.

**Backend.** The request is a `leave_request` with a status machine and an approval instance. On approval, a ledger entry and an outbox event are written in one transaction. The rostering and attendance modules consume the event. Optionally, an out-of-office event is created on the employee's Google or Microsoft calendar.

**Why this way.** A single transaction plus events keeps leave, rosters and payroll consistent without the modules calling each other directly.

### Page 9: Payroll

#### Global payroll engine with country packs

**What it does.** Calculates gross-to-net pay for any country that has a rule pack: earnings, deductions, employer contributions, taxes, arrears, loans, reimbursements and final settlements. It produces payslips, bank files and statutory reports.

**How it works.** Each legal entity uses its country pack. A pack defines pay components, tax tables, contribution rates, caps, rounding and report formats, with effective dates. Company-specific pay components are added on top. New packs are added by Meridian or by the community and are reviewed before they are accepted.

**Backend.** The calculation core is written in Rust and compiled to WebAssembly (WASM). It is a pure function: inputs (employee pay data, attendance and leave summary, pack version, period) go in, and a result with a full line-by-line explanation comes out. It has no network or database access. The same WASM module runs in the job workers for pay runs, in the API for "what-if" previews, and in tests. Country packs are signed, versioned bundles of data and CEL expressions, and each pack ships with golden test cases that must pass before the signature is accepted. Money is handled as integer minor units with explicit currency and rounding rules, never as floating point.

**Why this way.** A pure, deterministic function makes every payslip reproducible and explainable, which answers the "black box" complaint. Rust removes whole classes of memory and arithmetic bugs. WASM lets one engine run everywhere without separate implementations drifting apart.

#### Pay run with dry-run, diff and four-eyes approval

**What it does.** Runs payroll safely: lock inputs, dry-run, compare with last month, review exceptions, approve, finalise, pay and publish.

**How it works.** The payroll preparer starts the run. Meridian freezes the inputs, calculates everyone and shows a variance report, for example "net pay changed more than 10% for 14 people" with the reason for each. The preparer fixes or accepts exceptions. A different person, the payroll approver, approves. Only then are results finalised, bank files generated and payslips published.

**Backend.** A pay run is a workflow instance with explicit states: `draft`, `inputs_locked`, `calculated`, `in_review`, `approved`, `finalised`, `paid` and `published`. Each transition is guarded by role, segregation-of-duty and validation rules. A per-entity Durable Object lock allows only one active run per entity and period. Calculation fans out across workers in batches and every employee result is written with an idempotency key, so a crashed worker can resume without double results. Finalised results are immutable, and corrections happen through an off-cycle or next-cycle adjustment.

**Why this way.** These are the controls that prevent payroll disasters: no overlapping runs, no self-approval, no silent edits after approval, and a visible diff before money moves.

#### Payslips and tax documents

**What it does.** Gives every employee their payslips and annual tax documents, with a plain-language explanation of each line.

**How it works.** Employees open a payslip and can tap any line to see how it was calculated, using the engine's explanation trace.

**Backend.** Rendered on demand from the immutable result, as described for the employee folder. Optionally, payslips are filed to the employee's Drive folder, password-protected according to the entity's policy.

**Why this way.** Line-level explanations cut payroll helpdesk tickets, and on-demand rendering costs nothing to store.

#### Bank and payment files

**What it does.** Produces salary payment files in the formats banks accept, or sends payments through a connected payments provider.

**How it works.** After approval, Meridian generates the file for the entity's bank. The finance approver downloads it or releases it through the connected provider.

**Backend.** Bank formats are templates inside country packs (for example ISO 20022 pain.001 or local formats). Bank details are decrypted only inside the generation worker, the output file is encrypted, and download links expire in minutes.

**Why this way.** Keeping bank formats in packs lets the community add banks without code changes, and short-lived encrypted outputs limit exposure of the most sensitive file in HR.

#### Statutory filings and reports

**What it does.** Produces the returns and reports each country requires, such as contribution statements, tax returns and wage protection files.

**How it works.** The country pack defines each report's format and schedule. Meridian generates it from finalised runs, reminds the owner before deadlines, and keeps the filed version.

**Backend.** Reports are generated by pack-defined templates from finalised results only. Generated files are stored through the document service in the customer's storage.

**Why this way.** Building reports only from finalised, immutable results means a filed return always matches the payroll that was paid.

#### Payroll partner mode for countries without a pack

**What it does.** Lets a company with staff in a country that Meridian does not yet calculate still use Meridian for everything else, and exchange data with a local payroll provider or an employer of record.

**How it works.** Meridian exports the pay inputs (changes, attendance, leave, one-time payments) to the provider each period and imports the gross-to-net results back. Employees still see payslips in Meridian.

**Backend.** A standard payroll exchange file and API, with field mapping per provider and checksum reconciliation between what was sent and what came back. Employer-of-record services are provided by partners at their own price, because EOR prices such as US$599 per employee per month at Deel and Remote are services, not software [52] [53].

**Why this way.** It makes Meridian global on day one without pretending to calculate payroll in every country.

#### Payroll continuity kit

**What it does.** Ensures a company can still pay its people if Meridian, or any of its providers, is unavailable on payday.

**How it works.** After each finalised run, Meridian writes an encrypted continuity package to the customer's own Drive or SharePoint. It contains the payroll register, the bank file and the employee contact list. The customer's owner holds the decryption key, and the package opens in any spreadsheet tool after decryption.

**Backend.** A post-finalisation job builds the package, encrypts it with a key derived from a customer-held recovery secret, and writes it through the document service. Restore instructions are included in the package.

**Why this way.** The dossier records real vendor outages that disrupted payroll [54]. Keeping a usable copy in the customer's hands is the only protection that does not depend on Meridian itself being up.

### Page 10: Expenses and reimbursements

#### Expense claims with receipt capture

**What it does.** Employees photograph receipts, Meridian reads the amount, date, merchant and tax, and the claim goes through policy checks and approval to reimbursement in payroll or by direct payment.

**How it works.** Policies set limits per category, grade and city, for example daily meal limits or mileage rates. Claims over a limit, duplicate receipts or weekend claims are flagged for the approver. Approved claims are added to the next pay run as reimbursements or exported to accounting.

**Backend.** Receipts are stored in the customer's storage through the document service. Text extraction runs in a worker with the tenant's chosen model or a basic on-server OCR, and the result is validated against the policy in the rules service. A perceptual hash of each receipt image detects duplicates within the tenant. Approved claims emit events consumed by payroll and by the accounting export.

**Why this way.** Reusing payroll for reimbursement avoids a separate payout system, and duplicate detection catches the most common expense abuse cheaply.

#### Advances, travel requests and accounting export (later)

**What it does.** Handles cash advances and travel pre-approval, and posts approved expenses and payroll journals to accounting systems.

**How it works.** Advances are settled against later claims. Journals are mapped to the customer's chart of accounts.

**Backend.** These are ledger entries plus accounting connector adapters that share the same journal format.

**Why this way.** It completes the spend loop without building a full travel product, which is better left to partners.

### Page 11: Performance and growth

#### Goals and check-ins

**What it does.** Sets individual, team and company goals or OKRs, links them up the organisation, and tracks progress through short regular check-ins.

**How it works.** Managers and employees agree goals each cycle. Progress updates take seconds, and each person's one-to-one agenda pulls in their goals automatically.

**Backend.** Goals are a tree with an alignment edge to the parent goal. Check-ins are append-only progress events, and the current progress is a materialised value.

**Why this way.** Lightweight check-ins get used, while heavy annual-only systems do not. Append-only history allows fair reviews at cycle end.

#### Review cycles and feedback

**What it does.** Runs self, manager, peer and upward reviews on a schedule, with calibration and continuous feedback in between.

**How it works.** HR configures a cycle: who is in it, forms, rating scales, deadlines and the calibration step. Meridian sends tasks, collects responses and builds calibration views. The AI assistant can draft a review summary from the cycle's own feedback and goals, which the manager must edit and approve.

**Backend.** A cycle is a workflow instance over a participant set. Responses are stored per question with visibility rules, for example peers being anonymous to the reviewee. Calibration changes are logged with a reason.

**Why this way.** Visibility rules in the data, plus logged calibration, protect fairness and protect the company in disputes.

#### One-to-ones

**What it does.** Gives managers and reports a shared agenda, private notes and action items, booked on their calendars.

**How it works.** Recurring one-to-ones are created through the scheduling feature. Agenda items carry over until they are done.

**Backend.** Meetings link to calendar event IDs. Private notes are encrypted per author.

**Why this way.** It reuses scheduling and keeps genuinely private notes private, even from HR administrators.

#### Compensation planning (later)

**What it does.** Runs salary review and bonus cycles with budgets, guidelines and approvals, and pushes approved changes into payroll on the effective date.

**How it works.** HR sets the budget and guidelines. Managers propose, the approvals engine routes the proposals, and approved changes become lifecycle events.

**Backend.** Proposals are a staging table. Restricted salary fields are visible only within the planner's scope. Approval writes bitemporal pay changes.

**Why this way.** Reusing lifecycle events means a salary review flows into payroll with no re-keying.

#### Recruiting, light ATS (later)

**What it does.** Job requisitions, a careers page feed, candidate pipeline, interview scheduling, scorecards and offers that turn into onboarding.

**How it works.** It covers the basics most small and mid-size companies need, and it integrates with dedicated recruiting tools for heavy users.

**Backend.** Candidates are a separate entity with their own retention clock and consent. On offer acceptance, a person and employment are created and onboarding starts.

**Why this way.** Recruiting is often a paid add-on in competing products [52] [3]. A light, included version covers most needs without competing with full ATS products.

### Page 12: Helpdesk and knowledge

#### HR helpdesk cases

**What it does.** Employees raise questions or requests, such as a salary query, letter request or policy question, and the right handler resolves them within a set time.

**How it works.** Employees pick a category or just type a question. The assistant first suggests answers from the company's own policies. If a case is opened, it is routed to the handler group for the employee's scope and category, with a due time. Confidential categories, such as harassment or whistle-blowing, go only to named investigators.

**Backend.** A case has a category, scope, assignee, status machine, due time and a thread. Routing uses the role × scope model with primary and backup handlers. Confidential categories have a stricter access policy that even HR administrators do not bypass, and every access is audited. Common requests, such as salary certificates, are fulfilled automatically by templates.

**Why this way.** Routing by scope removes manual triage. Confidential access rules in the policy engine protect the cases where a leak would do the most harm.

#### Policy library and knowledge base

**What it does.** Publishes the handbook, policies and FAQs, with version history and acknowledgements, and makes them searchable and answerable by the assistant.

**How it works.** HR publishes documents, sometimes stored in the company's Drive or SharePoint. Meridian indexes the approved version and answers questions with citations to the exact paragraph.

**Backend.** Policy text is chunked and embedded per tenant into a vector index that is partitioned by tenant ID. Answers cite chunk IDs, and an answer without a citation is not shown.

**Why this way.** Citation-only answers stop the assistant from inventing policy, which is the main risk of HR chatbots.

#### Assets (later)

**What it does.** Tracks laptops, phones, ID cards and other items issued to employees, and ties their return to offboarding.

**How it works.** Assets are assigned and acknowledged, and returns are confirmed by IT.

**Backend.** These are simple asset and assignment tables, with an optional sync from device-management tools.

**Why this way.** Most needs are met with a small, integrated register rather than a full IT asset product.

### Page 13: Reports, analytics and exports

#### Report builder

**What it does.** Lets HR build tabular reports from any data they are allowed to see, such as headcount by department, attrition, leave taken or overtime cost, with filters, grouping and saved views.

**How it works.** Users pick a dataset, columns and filters. The report respects the user's scope and field permissions automatically, so two users running the same report may see different rows and columns.

**Backend.** Reports compile to SQL against curated reporting views. The query runs under the caller's database role and RLS context, and restricted columns are removed by the policy layer before the query is built. Large reports run as jobs and stream their results.

**Why this way.** Building permissions into query compilation, not into each report, means a new report can never bypass access rules.

#### Exports to Google Sheets and Excel in the customer's storage

**What it does.** Sends any report or list to a new Google Sheet or Excel file in the company's own Drive or OneDrive or SharePoint, once or on a schedule, for example a payroll register every month or a headcount sheet every Monday.

**How it works.** The user picks a destination folder once. Meridian creates the file, fills it, applies formatting and returns the link. Scheduled exports refresh the same file or create a dated copy.

**Backend.** For Google, the Sheets `spreadsheets.create` method works with the non-sensitive `drive.file` scope, so Meridian creates and fills the Sheet without broad Drive access [9]. For Microsoft, a streamed XLSX file is written into a site granted through `Sites.Selected` [12]. Meridian stores only the file ID and the export audit record. Exports that include restricted fields require the exporter to hold permission for those fields, and each such export is logged with its row count.

**Why this way.** Exports land where finance and leadership already work, under the customer's sharing and retention rules, and Meridian pays nothing for the storage.

#### Workforce analytics and executive view

**What it does.** Shows trends in headcount, hiring, attrition, absence, overtime, labour cost, diversity and engagement, for HR and for leadership.

**How it works.** Executives see aggregates only, and any group smaller than five people is suppressed. HR can drill down within their scope.

**Backend.** At first, analytics run on PostgreSQL materialised views refreshed by jobs. At scale, nightly per-tenant Parquet snapshots are written to R2 and queried with DuckDB in workers, which keeps analytics off the transactional database at very low cost. The minimum-group rule is enforced in the analytics query layer.

**Why this way.** It starts with zero extra infrastructure and has a cheap path to scale. Small-group suppression prevents leadership dashboards from revealing an individual's salary or health absence.

### Page 14: Automation

#### Rules and workflow builder

**What it does.** Lets HR automate routine work without code: "when someone's visa expires in 30 days, create a document request and notify their handler", or "when probation ends, start the confirmation review".

**How it works.** A rule has a trigger (an event or a schedule), conditions and actions. Actions include sending a message, creating a task, starting a workflow, requesting documents, updating a field (within the author's permissions) or calling a webhook.

**Backend.** Triggers subscribe to outbox events. Conditions are CEL expressions. Actions run as idempotent jobs under the identity and permissions of the rule's owner, not as a super-user. Every rule has a dry-run mode that shows what it would have done in the last 30 days.

**Why this way.** Running automation as its owner prevents privilege escalation through rules. Dry-run catches mistakes before they message 5,000 people.

#### Webhooks and public API

**What it does.** Gives customers and partners a documented REST API and signed webhooks for every main event.

**How it works.** IT creates an API client with specific scopes. Webhook deliveries are signed, retried and replayable from a delivery log.

**Backend.** The API is described by an OpenAPI specification that is generated from the same schemas the services use. Webhooks are HMAC-signed with a timestamp, delivered from the outbox with exponential backoff, and kept for replay for a fixed window.

**Why this way.** A generated specification never drifts from the real API, and signed, replayable webhooks are what integrators need to trust an event stream.

### Page 15: AI assistant and agents

#### In-app assistant

**What it does.** Answers questions and does work in plain language for every role. An employee can ask "how many leave days do I have and can I take next Friday off?". A handler can ask "who in my departments has missing documents?". An HR manager can ask "draft the probation confirmation letters for this month".

**How it works.** The assistant uses the same tools that Meridian exposes over MCP, under the user's own permissions. It reads and analyses freely within those permissions, prepares drafts, and asks for explicit confirmation before committing any change. High-impact changes go to the approvals engine.

**Backend.** A model router sends each request either to Meridian's default low-cost model through Cloudflare AI Gateway, or to the customer's own model key held in the vault (bring your own key), or nowhere if the tenant has turned AI off [55]. Every prompt passes through the data firewall described later. Models in the US$0.10 input and US$0.50 output per million tokens class are enough for most HR questions [56] [57]. At about 20 questions per employee per month, that is roughly one US cent per employee.

**Why this way.** One tool layer shared by the in-app assistant and external assistants means one set of permissions, one audit trail and one set of tests.

#### Bounded agents

**What it does.** Runs specific, narrow agents that do a recurring job end to end and stop for approval: a document chaser that follows up missing documents, an attendance anomaly reviewer, a payroll variance explainer and an onboarding coordinator.

**How it works.** Each agent has a written job, a fixed tool list, a budget and a human owner. It produces a summary of what it did and a list of proposed changes for approval.

**Backend.** Agents run as workflow instances with a tool allow-list, step limit, token budget and a "draft only" flag. Their actions use the owner's permissions and are fully audited.

**Why this way.** Narrow agents with budgets and approvals give real time savings without the risk of an open-ended agent acting on payroll.

### Page 16: Integrations and marketplace

#### Connector hub

**What it does.** Manages all connections in one place: Google Workspace, Microsoft 365, AI assistants, biometric devices, accounting, payment providers, payroll partners and messaging.

**How it works.** IT connects each service once, sees its health, scopes and last sync, and can disconnect it, which revokes Meridian's tokens immediately.

**Backend.** The connector service holds OAuth tokens encrypted with per-tenant keys. It refreshes them, tracks scopes granted versus scopes requested, and runs each connector's work through queues with per-connector rate limits and circuit breakers.

**Why this way.** Central token handling means one place to audit and one switch to revoke access, which is what security reviewers ask for.

#### Extension SDK and marketplace (later)

**What it does.** Lets partners and the community publish country packs, device adapters, connectors and report templates.

**How it works.** Extensions are reviewed, signed and installed per tenant with explicit permission grants.

**Backend.** Extensions run as data (packs and templates) or as sandboxed WASM with declared capabilities. They never run as arbitrary code inside the core.

**Why this way.** Sandboxed, signed extensions let the open-source community grow coverage without putting tenant data at risk.

### Page 17: Trust, privacy and account administration

#### Audit log explorer

**What it does.** Shows who viewed or changed what, when, from where and through which channel (web, app, API, MCP or automation).

**How it works.** Administrators and auditors search and export the log for their scope.

**Backend.** Audit events are appended to a hash-chained table, where each row includes the hash of the previous row. The daily chain head is written to a separate R2 bucket and can also be written to the customer's storage, so tampering becomes detectable.

**Why this way.** A hash chain with an external anchor proves the log has not been edited, at almost no cost.

#### Privacy requests and retention

**What it does.** Handles employee data access and deletion requests, and applies retention rules per data type and country, such as deleting candidate data after a set period.

**How it works.** Retention rules come from country packs and company settings. Requests are tracked as cases with deadlines.

**Backend.** Each record class has a retention clock. Deletion of restricted data uses crypto-shredding, which destroys the per-subject data key so that copies in backups also become unreadable.

**Why this way.** Crypto-shredding makes deletion real even in backups, which plain row deletion cannot do.

#### Full data export and exit

**What it does.** Lets a customer export all of their data at any time in open formats, and leave without penalty.

**How it works.** The owner requests an export. Meridian produces CSV and JSON files with a documented schema plus all document links, written to their own storage.

**Backend.** The export is a background job over every tenant table, with a manifest and checksums.

**Why this way.** Lock-in through closed schemas was one of the gaps found in the dossier. An open exit path is a selling point and a promise the open-source licence backs up.

#### Billing, usage and plan management

**What it does.** Shows the active employee count, plan, usage items (SMS, face checks, AI beyond the included allowance) and invoices, with spending caps.

**How it works.** Billing counts each active employee per day and prorates. Usage items are metered and capped by tenant-set limits.

**Backend.** Usage events are written to a metering table from each service and aggregated daily. Caps are enforced in the same Durable Object counters used for rate limits.

**Why this way.** Tenant-set caps prevent bill shocks from pass-through items such as SMS.

## Using the customer's Google Workspace or Microsoft 365 subscription

Most customers already pay for one of these suites. Business Standard costs about US$14 per user per month on both, and Business Plus or Business Premium about US$22 [58] [59]. Meridian is designed to reuse that spend instead of rebuilding it. The integration covers six capabilities, and each uses the narrowest permission that works.

**Sign-in.** Employees sign in with their existing Google or Microsoft work account. For Microsoft, Meridian is registered as a multi-tenant Entra application. It validates each token against the customer's tenant ID (`tid`), so Conditional Access policies such as MFA or compliant devices apply automatically [60] [61]. For Google, it uses OpenID Connect and keys every account on the stable `sub` identifier, not on the email address, which can change [62]. The `hd` parameter steers sign-in to the right Workspace domain, but the domain is still verified on the server.

**Provisioning.** On Microsoft, Entra pushes users and groups to Meridian's SCIM 2.0 endpoint [24]. On Google, Meridian syncs through the Directory API with admin approval [7]. Meridian can also run the other way and create accounts from HR data, as described under onboarding.

**Storage.** Documents, exports, letters and continuity kits go to the customer's Drive, shared drives, SharePoint or OneDrive. Meridian uses `drive.file` with Google Picker on Google and `Sites.Selected` on Microsoft [10] [12]. Copilot respects Purview sensitivity labels, and Meridian can apply a label to the HR folders it creates [63].

**Mail.** Meridian uses `gmail.send` or `Mail.Send` for personal, low-volume notices, and routes bulk sends through SES because of the daily limits on both suites [14] [21] [64] [22].

**Calendar, meetings and chat.** Scheduling uses Google Calendar and Meet or Microsoft Calendar and Teams. Approvals use Google Chat cards or Teams Adaptive Cards [26] [4] [28] [5].

**AI the customer already licenses.** This works differently on each suite.

- **Microsoft Copilot.** Meridian ships a declarative agent for Microsoft 365 Copilot that uses Meridian's remote MCP server as its action, declared in the plugin's `agentConnectors` with OAuth [65] [66]. For live HR and payroll data Meridian uses a **federated** connector, which queries Meridian through MCP at question time instead of copying data into Microsoft Graph. Microsoft describes federated connectors as the right fit for live or sensitive data [67] [68]. Only non-sensitive content with exact item-level permissions, such as the published policy handbook, is offered as a synced connector, because wrong permissions on synced items can expose HR data to the wrong employees [68] [63]. Copilot Studio users can add the same MCP server through its wizard, which supports the Streamable HTTP transport and OAuth 2.0 [69]. Distribution starts with each customer's own app catalogue and later moves to the Microsoft Marketplace after Microsoft's review [70] [71].
- **Google Gemini.** For customers with Gemini Enterprise, Meridian is added as a custom MCP server data store, a generally available feature that the customer's admin must enable [72] [73]. Registering Meridian as an A2A agent in Gemini Enterprise is still in preview, so it is offered as an option, not a commitment [74]. Plain Gemini inside Gmail and Docs has no documented way for a third-party app to extend it. Meridian therefore reaches those users through a Workspace add-on and a Google Chat app, published on the Workspace Marketplace after Google's review [75] [76] [77].

The pitch to the customer is straightforward: Meridian reuses the identity, storage, mail, calendar, chat and AI licences they already have. It does not resell Copilot Studio capacity, which Microsoft prices separately at US$200 for 25,000 credits a month, and it does not promise features the suites do not offer, such as central Outlook signatures through Graph [78] [16].

**Verification and review costs to plan for.** Public Google apps that use sensitive scopes such as `gmail.send` need OAuth verification. Apps that store restricted-scope data on a server, for example `gmail.settings.basic` for signatures, need an annual security assessment under Google's CASA framework [77] [13]. To keep the core app on non-sensitive and sensitive scopes only, the signature manager uses the customer-granted service-account path. Whether that path also triggers the assessment must be confirmed with Google before launch.

## Connecting the customer's own AI: ChatGPT, Claude, Gemini, Copilot or any model

![AI and MCP plane](/home/ubuntu/hr_research/v2/diagrams/ai_plane.png)

There are two separate ways to connect, and Meridian supports both.

**Mode 1: the assistant comes to Meridian (MCP).** The customer uses the assistant they already pay for, and connects Meridian as a tool through MCP (Model Context Protocol, an open standard that lets AI assistants call external tools). Meridian never sees the customer's model key in this mode. The assistant signs in to Meridian with OAuth as the individual user, and Meridian applies that user's permissions to every call.

- **ChatGPT Business and Enterprise** support custom remote MCP apps. Admins create and publish them. Newly discovered actions start disabled, and changes to the tool list appear as a diff for the admin to approve. That diff guards against a server silently changing its tools [79]. ChatGPT reaches only remote servers, so Meridian's MCP server is public HTTPS. Customers who want a private endpoint can use OpenAI's Secure MCP Tunnel [79]. OpenAI states that it does not train on Business or Enterprise data by default [80].
- **Claude** supports custom remote connectors on all plans, including one on the Free plan. Connections are made from Anthropic's cloud, so Meridian must accept traffic from Anthropic's published IP ranges. Owners can set each tool to Always allow, Needs approval or Blocked, so a customer can block write tools centrally [81] [82].
- **Copilot Studio and Gemini Enterprise** connect as described in the previous section [72] [69].
- **Developer tools** such as VS Code and Cursor can use the same server for HR operations teams that work there [83] [84].

**Mode 2: Meridian uses the customer's model (bring your own key).** Inside Meridian's own assistant, the customer can choose a model provider and enter an API key, or a cloud credential for Azure OpenAI, Amazon Bedrock or Google Vertex AI. The key is stored in Meridian's vault, encrypted with the tenant's key. It is used only by the model router and is never shown to any model or user after entry. Each key has its own model allow-list, monthly budget and rate limit. Azure's standard inference is stateless and does not train on prompts, and Bedrock lets the customer set data retention to none, so customers can choose the provider whose terms match their policy [85] [86]. Gateways such as Cloudflare AI Gateway or LiteLLM supply budgets, rate limits and caching [87] [55]. Meridian turns off raw prompt logging in the gateway and isolates any cache per tenant, because a shared cache could return one tenant's answer to another [55].

## MCP server design and the no-leak data firewall

### Protocol and authorisation

Meridian runs one remote MCP endpoint per regional cell, for example `https://mcp.eu.meridian.example/mcp`, over Streamable HTTP. Copilot Studio no longer supports the older SSE transport, so Streamable HTTP is the one to build [69]. The design follows the current MCP specification, version 2026-07-28 [88]:

- Meridian runs its own OAuth 2.1 authorisation server, with the authorisation-code flow and PKCE (proof key for code exchange) required.
- The MCP server publishes Protected Resource Metadata (RFC 9728), so clients discover the authorisation server automatically.
- Clients register with Client ID Metadata Documents. Dynamic Client Registration stays available only for hosts that still need it, because the specification now marks it deprecated.
- Every token is bound to Meridian's MCP address as its audience through resource indicators (RFC 8707). The server checks signature, issuer, expiry, audience, tenant, user and scope on every request.
- Meridian never accepts a token issued for another service and never passes the assistant's token on to anything else. Calls to internal services use a separate, narrowly scoped internal credential [88] [89].
- Refresh tokens (`offline_access`) are issued for long-lived connections, as ChatGPT recommends [79]. They are rotated on every use, revoked when the employee leaves, and limited in lifetime by tenant policy.
- Redirect URIs must match exactly, state is required, and every URL inside metadata is fetched through an SSRF-safe fetcher that blocks private network addresses [89].

### Tools in four tiers

Tools are grouped into four tiers. Each tier is a separate OAuth scope, so a customer can grant a host only the tiers it needs.

1. **Read** tools fetch facts the user may see, such as `get_leave_balance`, `list_missing_documents` and `get_policy_answer`.
2. **Analyse** tools return aggregates, such as `headcount_by_department` and `overtime_trend`. They have a minimum group size of five and never return individual restricted fields.
3. **Draft** tools prepare a change without applying it, such as `draft_leave_request`, `draft_letter_batch` and `draft_announcement`. They return a draft ID and a preview.
4. **Commit** tools apply a draft by its ID, such as `submit_draft`. Commits are idempotent, run under the user's permissions, and anything high-impact, such as pay changes, bulk messages or terminations, goes to Meridian's approval inbox, where a second person must approve. Meridian never relies on the AI host's own confirmation prompt as its only control [79].

There is deliberately no tool that runs arbitrary queries, fetches arbitrary URLs or exports whole tables. Bulk exports remain a Meridian feature with its own permission and audit.

### Signed, pinned tool manifests

Every tool's name, description, input schema and output schema is part of a signed manifest with a version number. Tool descriptions are fixed text written by Meridian, never generated from tenant data. When a new version adds or changes a tool, the tenant admin sees a diff and must approve it before the tool becomes available to their users. This mirrors what ChatGPT Enterprise does on its side, and it closes the "rug pull", where a tool changes behaviour after approval [79] [89].

### The data firewall

Every tool response and every prompt from the in-app assistant passes through one policy component before leaving Meridian. It applies five rules in order.

1. **Field class rules.** `restricted` fields (bank account, national ID, exact salary) and `special` fields (health, biometrics, disciplinary records) are never sent to an external assistant by default. A tenant can allow a specific class for a specific role and a specific host, such as salary to the payroll approver in Claude Enterprise. That exception is recorded and shown in the connector settings.
2. **Minimisation.** Tools return only the fields their schema declares, never whole employee records [90].
3. **Pseudonymisation.** Where policy requires it, people are replaced with tenant-scoped tokens such as `EMP_7F2A`, generated with a keyed hash so they cannot be guessed. The mapping never leaves Meridian [91]. Each token comes with a **sealed reference**, a Meridian link that shows the real person only after the user signs in to Meridian. The assistant can therefore say "EMP_7F2A has three missing documents", and the user clicks through to see who it is.
4. **Output scanning.** A PII detector such as Microsoft Presidio scans free text, such as case comments and survey answers, for names, phone numbers, IDs and account numbers that slipped into fields. Matches are masked [91] [92]. Employee-written text is wrapped and labelled as untrusted data, so an instruction hidden inside a helpdesk comment is treated as text, not as a command [90].
5. **Rate and volume limits.** Each user, host and tool has a call budget and a records-returned budget. A pattern that looks like scraping, such as hundreds of profile reads in a minute, is throttled and raised as a security alert.

Every call is audited with tenant, user, host, tool, policy decisions, record counts and hashes of the inputs and outputs. The raw content is never logged. The same firewall protects the in-app assistant, so there is one rule set to test.

### Testing the AI surface

The MCP server and assistant have their own test suite: cross-tenant access attempts, prompt-injection payloads planted in employee text, tool-description tampering, oversized responses, token-audience mismatches, and expired or revoked tokens. The suite runs on every change, and a red-team review happens before each new tool tier is enabled, in line with OWASP's guidance on prompt injection and excessive agency [90].

## Backend architecture

![Meridian v2 backend architecture](/home/ubuntu/hr_research/v2/diagrams/architecture.png)

### The shape of the system

Meridian is a **modular monolith deployed in regional cells**. A modular monolith is one codebase and one deployable API with strict internal module boundaries (people, time, leave, payroll and so on). Modules talk through defined interfaces and events, never by reading each other's tables. A cell is a complete, independent copy of the stack, with database, workers and storage, in one region such as Europe, India or the US. A small global control plane knows which cell each tenant lives in and routes requests there.

A monolith is chosen over microservices because a small team can build, test and deploy it reliably. A single transaction can update a person, their leave ledger and an outbox event together. The module boundaries still allow a module to be split out later if it ever needs separate scaling, and payroll calculation is already separate as a WASM worker. Cells limit the impact of a failure: one region's outage does not affect the others. They also give real data residency, because a European tenant's data stays in the European cell.

The request path works like this. Cloudflare handles DNS, DDoS protection, the web application firewall and Turnstile bot checks at the edge [93]. An API gateway Worker verifies the session or token, applies per-tenant and per-user rate limits, checks idempotency keys for writes, and forwards the request to the cell. The core API applies the policy engine and talks to PostgreSQL. Every write that other modules care about also writes an **outbox** row in the same transaction. A relay moves outbox rows to Cloudflare Queues, and job workers consume them for notifications, connector calls, recomputation, exports and payroll batches.

### Languages and why

Meridian uses three languages, each where it is clearly the best fit, and no more.

**TypeScript** is used for the API, the job workers, the Cloudflare Workers and all clients: web in React, and mobile and kiosk in React Native. Sharing one language and one set of schemas (validated with a schema library such as Zod and exported as OpenAPI) means the API contract, the web app and the mobile app cannot drift apart. Most of the code runs on both Cloudflare Workers and Node.js, so heavy jobs can move to a normal server without a rewrite. It also gives the largest hiring pool.

**Rust** is used for the payroll and rules calculation core, compiled to WASM. Payroll needs exact, deterministic arithmetic and no runtime surprises. Rust's type system and lack of garbage collection give that, and WASM lets the same engine run in workers, in the API and in tests.

**Go** is used for the on-site device bridge. It produces one small static binary that runs on Windows, Linux or ARM, with a strong built-in networking library [30].

**SQL** (PostgreSQL) holds the data model, row-level security policies and constraints. These are treated as code and reviewed like code.

**Clients and the path to native.** The clients should be built React Native first with a shared core: data access, validation, offline queue and business logic live in shared TypeScript packages, and only the presentation layer is per platform. The web app uses React, with React Native for Web where it helps. Native-only capabilities, such as Play Integrity, App Attest, NFC, BLE beacons and liveness SDKs, are wrapped in small native modules behind one TypeScript interface. If a fully native app is ever needed, only the presentation layer and those modules change, and the API, the logic and the offline sync protocol stay the same. The API is designed for mobile from the start: pagination everywhere, delta sync endpoints, small payloads, idempotent writes and an offline punch queue.

### Multi-tenant data organisation

All tenants in a cell share one PostgreSQL database by default, which is the "pool" model. Every table carries `tenant_id`, and row-level security is enabled and **forced** on every table, so even the table owner is subject to it. The API sets the tenant and user context per transaction (`SET LOCAL app.tenant_id`), and policies compare against it. The application connects as a role that cannot bypass RLS. Background jobs also run with an explicit tenant context, never as a superuser. Supabase documents RLS as its core isolation control, and every exposed table needs both grants and policies [94].

Enterprise tenants can be placed in a **dedicated database** in the same cell or region, the "silo" model. This uses the same schema and code, and only the connection routing in the control plane differs. That allows a customer to have its own database, keys and backups without a separate product.

Encryption has three layers. The provider encrypts disks. Each tenant has its own data-encryption key, wrapped by a master key in a managed key service. Restricted fields are encrypted in the application with the tenant key, and special-category data with a per-subject key so it can be crypto-shredded. Keys are rotated on a schedule, and rotation re-wraps data keys without re-encrypting all data.

Core records are **bitemporal**. Each row has a business-validity period and a recorded-at time. This answers both "what was true on 1 March" and "what did we believe on 1 March", which payroll corrections and audits need.

### Events, jobs and workflows

The **outbox pattern** guarantees that an event is published if and only if the change was committed. The relay is at-least-once, so every consumer is idempotent and keyed by event ID. Cloudflare Queues carry the messages. Paid queues retain messages for four days by default, configurable to 14, which is far longer than any realistic outage [95].

Long processes (onboarding, offboarding, pay runs, review cycles, document requests) are **PostgreSQL state machines**. Each instance row holds the current state, the next timer and a version number for optimistic locking. A scheduler scans due timers, and transitions happen in transactions. This needs no extra service at the start. When payroll volume or workflow complexity grows, the same workflow definitions can be moved to Temporal, which has a usage-based cloud plan, or Inngest, whose free tier includes 50,000 executions a month [96] [97].

**Durable Objects** provide single-writer coordination where it matters: one lock per entity's pay run, one token bucket per connected mailbox, and one counter per tenant for rate limits and usage caps. They are available on the Cloudflare free plan with SQLite storage [98].

### Storage strategy

Meridian pays for as little storage as possible.

- Structured data goes in PostgreSQL. Even 10,000 employees with full history fit comfortably in the 8 GB included with Supabase Pro [99].
- Documents, exports, letters, payslip copies and continuity kits go to the customer's Google Drive, shared drive, SharePoint or OneDrive.
- Temporary files, encrypted backups and storage for customers without a suite go to Cloudflare R2. R2 has 10 GB free, then US$0.015 per GB-month, with no egress charges [100].
- Payslips are rendered on demand from immutable results.

### Search and analytics

Search starts with PostgreSQL full-text search plus trigram indexes, filtered by RLS. Policy question answering uses pgvector in the same database, partitioned by tenant. Analytics starts on materialised views and moves to per-tenant Parquet files on R2 queried by DuckDB when needed. Neither path needs a separate search or analytics cluster at the start.

## Fail-safe design

No system can promise that it never fails. What can be promised is that failures are contained, data is never lost, and the work that matters most (punches, approvals and pay runs) continues or resumes safely. These are the concrete mechanisms.

**Service level objectives.** The targets are 99.9% monthly availability for the API in the starting stage and 99.95% for the Enterprise tier on dedicated cells. Punch ingestion targets 99.99% acceptance, because it runs at the edge with queue buffering. No punch, approval or finalised payroll result may be lost (a recovery point of zero for committed data). Restore for a regional cell must take less than four hours. Each SLO has an error budget, and feature releases pause when the budget is spent.

**Data durability.** The database has point-in-time recovery once payroll data is live; Supabase PITR costs US$100 a month for seven days [99]. Before that, and in addition to it, there are nightly encrypted logical backups to R2 in a different provider and region. Restores are tested monthly by automatically restoring a backup into a scratch database and running integrity checks. The customer-side continuity kit sits on top of these.

**Degraded modes.** If the database is unavailable, the edge still accepts punches into queues and Durable Objects and replays them later. The device bridge buffers locally for days. The API switches to read-only from replicas where available, and pay runs pause at their last committed state and resume. If a connector such as Gmail or Graph fails, its circuit breaker opens, messages wait in the queue, and email falls back to SES. If the AI provider is down, the assistant reports it, every feature still works without AI, and the router can fall back to another provider the tenant allows.

**Correctness guards.** Idempotency keys apply to every write API and every job. Optimistic locking applies to every mutable row. Exclusion constraints prevent double booking. Payroll uses a per-entity lock, immutable finalised results and segregation of duties. Every multi-step change happens inside a database transaction together with its outbox row.

**Safe change.** Every database migration is backward compatible across one release ("expand, then contract"). Releases go through feature flags and per-tenant canary rollout. A tested kill switch exists for each module and each connector. Rule pack updates are signed, versioned and rolled out per entity with a preview of their effect.

**Observability.** Structured logs, metrics and traces carry tenant and request IDs but never personal data. Alerts are defined on SLO burn rates, and synthetic checks run for sign-in, punch, leave request and pay-run dry-run. Free tiers of Grafana Cloud, Sentry and Better Stack cover the starting stage [101] [102] [103].

**Provider independence.** The only hard dependency is PostgreSQL. Cloudflare Workers code is portable to Node.js, queues sit behind an interface, R2 is S3-compatible, and identity is abstracted behind Meridian's own identity module. Moving from Supabase to Neon, Aurora or self-hosted PostgreSQL is a planned, tested path, not an emergency.

## Security hardening

The target is the OWASP Application Security Verification Standard at Level 2 for the whole product, and Level 3 for authentication, payroll and the MCP server.

**Identity and sessions.** Passkeys (WebAuthn) are the preferred sign-in for everyone. When a user "logs in with face" on a phone or laptop, the device's Face ID, fingerprint or Windows Hello unlocks a passkey locally. The face or fingerprint never leaves the device, and Meridian receives only a cryptographic signature. Google and Microsoft sign-in, email OTP and TOTP are also supported. Supabase includes TOTP MFA at no extra charge [94]. SMS OTP is a metered fallback only. MFA is mandatory for all company-side roles. Sessions are short-lived and bound to the device. Viewing bank details, approving payroll or changing roles requires step-up authentication. Admin sessions can be restricted to the customer's IP ranges or managed devices.

**Edge protection.** Cloudflare DDoS protection and WAF rules apply to all traffic, Turnstile protects public forms and sign-in, and rate limits apply per IP, per user and per tenant [93]. Device ingestion endpoints accept only enrolled bridges with mutual TLS.

**Application.** All input is validated against schemas at the edge of each module. Queries are parameterised. Strict content-security and security headers are set for the clients. Webhooks are signed and replay-protected. File uploads are scanned and type-checked, and never served from the application domain. There is no server-side fetching of user-supplied URLs except through the SSRF-safe fetcher.

**Secrets and keys.** Secrets live in the platform secret stores, such as Cloudflare Worker secrets and the database vault, never in code or images. Tenant keys are wrapped by a managed key service. Production access is just-in-time, approved and recorded, with no standing administrator access to tenant data.

**Supply chain.** Lockfiles are pinned, dependencies are updated automatically with review, every build produces a software bill of materials, and release artefacts are signed. Two-person review is required for the security, payroll and RLS code paths, and CI blocks merges that disable RLS on any table. Country packs and device bridge releases are signed, and the bridge verifies signatures before updating itself.

**Testing and assurance.** A cross-tenant test suite tries to read every table as another tenant on every build. Static analysis and secret scanning run in CI. Dependency vulnerability gates block known critical issues. External penetration tests happen before general availability and on every major release, and a public bug bounty is run as an open-source project. SOC 2 and ISO 27001 follow once paying enterprise demand justifies them.

**Devices.** Terminals sit on isolated network segments and connect only to the bridge. They are never exposed to the internet, and unknown serial numbers are rejected [40]. Mobile punches are bound to attested app instances [43] [45].

**Privacy by design.** Biometric features are opt-in with recorded consent and a fallback. Data-protection impact assessment templates are provided for GDPR, BIPA and India's DPDP Act [49] [50] [104]. Retention clocks and crypto-shredding apply throughout, and a data-processing addendum lists every subprocessor and region.

## Provider stack by stage, with costs

The stack starts on free plans and moves to paid plans when a clear trigger is reached, without code changes. All prices below were checked on 24 November 2026 and change over time.

### Stage 0: build and private beta on free plans

The web and mobile bundles are served from Cloudflare Pages, whose static requests are free and unlimited [105]. The gateway, MCP and ingest Workers run on Workers Free, which allows 100,000 requests a day with 10 ms of CPU per request [106] [107]. Storage uses R2 Free (10 GB), Queues Free (10,000 operations a day), Durable Objects Free, Turnstile and the free DDoS and CDN protection [100] [98] [95] [93]. PostgreSQL runs on Supabase Free (500 MB, 50,000 monthly active users, with Auth, RLS and TOTP) [99]. Email uses Resend Free, with 3,000 messages a month and 100 a day [108]. Monitoring uses the Grafana, Sentry and Better Stack free tiers [101] [102] [103]. AI requests go through AI Gateway, whose core features are free, using Workers AI's 10,000 free daily neurons or a small paid model [109] [110].

The monthly cash cost is about US$0, apart from the domain [106].

Free plans have limits that matter, and the design accounts for each one. Supabase Free projects can pause after seven days of low activity, so Stage 0 is for development and a supervised beta only. Neon Free, which does not pause and supports database branches for previews, is the drop-in alternative [111] [112]. The 10 ms CPU limit on Workers Free is too short for pay-run batches. Payroll previews in Stage 0 therefore stay small, and full pay runs start in Stage 1, where Workers Paid allows up to five minutes of CPU per invocation [106]. Free plans have no point-in-time recovery, so nightly encrypted backups to R2 start on the first day. Render's free tier is explicitly not for production and is not used [113].

### Stage 1: first paying customers, about 10,000 employees

The changes are:

- Workers Paid at US$5 a month.
- Supabase Pro at US$25, plus one compute step-up at about US$15.
- One always-on Hetzner worker in Singapore, CPX12 at about €15.99, for heavy jobs and PDF rendering.
- Amazon SES for bulk mail, at US$16 for 100,000 emails.
- Upstash Redis pay-as-you-go at about US$5, QStash at about US$1, and Sentry Team at US$26.
- About US$15 for the domain, backups and egress.

That comes to about US$126 a month [106] [99] [114] [23] [115] [116] [102]. Budgeting US$125–175 a month gives **about US$0.0125–0.0175 per employee per month**. Adding a second worker for failover costs US$18–55. Point-in-time recovery adds US$100 a month and is switched on with the first live payroll customer [99].

The triggers for this stage are concrete: the first paying customer moves the Workers to Paid, the first live payroll moves the database to Pro with PITR, and the first job that exceeds Worker limits adds the Hetzner worker.

### Stage 2: about one million employees

Each cell's database moves to Aurora Serverless v2 or equivalent managed PostgreSQL, which stores data across three availability zones [117]. The edge stays the same. With a 16 ACU writer, 8 ACU of read capacity, six dedicated workers, 5 million emails, Redis HA, observability and ten enterprise SSO connections through WorkOS, plus 25% headroom for disaster recovery, the estimate is about **US$7,344 a month, roughly US$0.0073 per employee**. A planning budget of US$0.01–0.02 per employee allows for variation [117] [118].

Three costs are kept out of the subscription price because they scale per use and can be large. SMS OTP at about US$0.13 per successful verification in India would add about US$13,320 a month at 100,000 verifications, so it is metered and passed through [119] [120]. Face liveness checks are billed per check by the vendor [47] [48]. WorkOS SAML or SCIM connections cost US$125 each, so they are used only for Enterprise convenience. Standard SAML and SCIM run in Meridian's own identity module or through Supabase SAML instead [121] [118].

**Migration path.** Supabase to Neon, Aurora or self-hosted PostgreSQL uses logical replication plus a short cutover per cell. Workers code runs on Node.js if Cloudflare ever has to be replaced at the compute layer. R2 is S3-compatible. Queues and workflows sit behind interfaces with tested alternatives in Temporal and Inngest [96] [97].

## How competitors price, and what that teaches

![Published per-employee prices compared with proposed Meridian tiers](/home/ubuntu/hr_research/v2/diagrams/pricing_comparison.png)

The 31 platforms in the dossier use five pricing models.

**Quote-only pricing** is the most common model at the top end. Workday, UKG, ADP, Darwinbox, HiBob, Personio, Paycom, Paylocity, Paychex, PeopleStrong, Sprout and Bayzat publish no list prices. Personio adds a one-time setup fee [122] [123] [124] [125] [126] [127] [128].

**Per employee per module** is how the enterprise suites publish prices. Dayforce's published MSRP lists Core at US$171.96 per employee per year and sells Payroll, Time, Benefits, Talent and AI separately. Eight modules add up to US$582.60 per employee per year, or about US$48.55 a month [129]. Oracle's US public-sector list adds up to about US$49 per employee per month across seven modules [130]. SAP lists Performance & Goals alone at US$3.72 per user per month [131].

**Per employee tiers with add-ons** are common in the mid-market. BambooHR lists Core at US$10.25, Pro at US$17.50 and Elite at US$25, with payroll, benefits and time sold as add-ons [132]. Deel lists HR Core at US$5, and recruiting is a paid add-on [52]. Factorial starts at US$8 [133]. Employment Hero starts at AUD 11 with a 10-user minimum and many add-ons [134]. Keka's directory listings start near US$20, and shift scheduling, helpdesk, API access, learning and rewards appear as add-ons or higher tiers [1] [135] [136]. Zimyo India runs ₹80–240 per user with a 50-user minimum, plus Analytics at ₹20,000 per licence a month [137].

**A base fee plus a per-person fee** is used by Gusto (US$49 plus US$6, US$80 plus US$12, or US$180 plus US$22) and by Rippling (from US$8 plus a base fee) [138] [2].

**Flat bands plus a per-extra fee** are common in India. greytHR Essential is ₹2,495 a month for 50 employees plus ₹45 for each extra. HROne Basic is ₹4,950 for 50 plus ₹99 each. Razorpay Payroll Elite is ₹6,499 for 50 plus ₹150 each, plus GST. factoHR advertises ₹2.5 per employee per day [139] [140] [141] [142].

Three lessons follow from this. First, the real price is hidden in add-ons and gated basics. ZenHR keeps SSO and open APIs for its Advanced bundle [143], Zoho People limits API calls by plan [3], and Keka gates APIs and helpdesk [1]. Second, pricing by module makes the full suite expensive: Dayforce's eight-module total is more than three times its core price [129]. Third, Indian pricing shows that HR software can sell profitably at about US$0.60–1.70 per employee per month at 50 employees, so a global product needs regional prices to compete there [139] [140] [141].

## Meridian pricing

### Per employee, not per feature

Meridian charges **per active employee per month, with three capability bundles and no module add-ons**. Per employee is the right unit because both value and Meridian's own cost scale with headcount, at about one to two cents per employee. It is also simple to forecast. Per feature is rejected because it creates the add-on traps buyers complain about and pushes customers to switch off useful modules. Flat bands are rejected because they overcharge small teams and create price cliffs as companies grow.

An **active employee** is anyone with an active employment record during the billing month, prorated by day. Former employees kept for records, candidates and pre-boarding new hires before their start date are free. Contractors count the same as employees.

### Tiers and what each covers

**Community (self-hosted): free.** The full open-source platform under the AGPL licence, run on the customer's own infrastructure, with community support.

**Free (hosted): free for up to 10 employees.** Core HR, directory and org chart, documents stored in the customer's own Drive or SharePoint, document collection, leave, web and mobile attendance with geofence, holidays, announcements, Google and Microsoft sign-in, passkeys, exports to Sheets or Excel, and the MCP read tier. It costs Meridian about US$0.40 a month per tenant to run.

**Essential: US$2 per employee per month (India ₹59), 10-employee minimum.** Everything for running HR operations, with no payroll:

- Free features plus onboarding and offboarding, with account provisioning.
- Biometric device bridge, kiosk, QR and NFC attendance, shifts and rosters, attendance rules and overtime.
- Scheduling with Calendar, Meet and Teams; letters and acknowledgements; the email signature manager.
- Bulk and targeted messaging, Chat and Teams approvals, surveys and the helpdesk.
- Report builder and scheduled exports; automation rules; the full API and webhooks.
- SAML and SCIM for any identity provider; MCP read, analyse and draft tiers.
- The in-app assistant with an included AI allowance, and one year of audit history.

**Growth: US$4 per employee per month (India ₹119).** Everything in Essential plus:

- Payroll in every country with a published pack, for unlimited legal entities; payroll partner mode elsewhere; payslips, bank files, statutory reports and the continuity kit.
- Expenses.
- Goals, reviews and one-to-ones.
- The MCP commit tier with the approval inbox; bring-your-own model keys; bounded agents.
- Workforce analytics, and three years of audit history.

**Enterprise: US$7 per employee per month (India ₹229), annual contract.** Everything in Growth plus a dedicated database or cell, a choice of region for data residency, customer-managed encryption keys, a 99.95% availability SLA, a sandbox tenant, audit log streaming to the customer's security tools, a private MCP endpoint or tunnel, custom retention and priority support.

Every tier includes sign-in with Google and Microsoft, MFA and passkeys, API access and data export, because these are basic safety and portability features, not upsells. Annual billing earns 15% off.

**Usage, passed through at cost plus a small handling margin, with tenant-set caps:** SMS and WhatsApp OTP, face liveness checks, AI usage above the included allowance (free when the tenant brings its own key), and Enterprise dedicated infrastructure above the standard cell size. Employer-of-record and local payroll partners bill the customer directly. Implementation help is optional and priced separately.

**Regional pricing** has three bands, set by the billing entity's country so it cannot be bought cheaply from elsewhere. Band 1 covers the US, Canada, Western Europe, Australia, New Zealand, Japan, Singapore and the Gulf, at the USD list price. Band 2 covers markets such as Eastern Europe, Latin America, Southeast Asia and South Africa, at about 60% of list. Band 3 covers markets such as India, Pakistan, Bangladesh, Sri Lanka, Egypt, Kenya, Nigeria and the Philippines, at about 30–33% of list. The exact country list is an open decision.

### Why this is cheap and still profitable

For a 200-employee company on Growth, Meridian costs US$800 a month including payroll. At published prices, BambooHR Pro would be US$3,500 before payroll add-ons, Gusto Plus US$2,480, and a US$20 Keka-style price US$4,000 [132] [138] [135]. In India, Growth at ₹119 is close to HROne Professional (₹130 per extra user) and below Razorpay Payroll's ₹150 per extra employee, while including attendance devices, documents, communications and AI [140] [141].

The margin works out as follows. The variable cost per employee per month is:

- infrastructure, about US$0.02 [106];
- email, about US$0.002;
- included AI, about US$0.016 for 30 requests at US$0.10 and US$0.50 per million tokens [56];
- payment fees, about 2–3% of price;
- an allowance for support: US$0.25 on Essential, US$0.45 on Growth and US$0.90 on Enterprise (lower in Band 3).

That gives gross margins of about 83% on Essential, 85% on Growth and 84% on Enterprise in USD, and about 80–83% at the Indian prices. Support, not infrastructure, is the largest cost. That is why self-service, the in-app assistant, line-level payslip explanations and clean imports are treated as cost controls as well as features. At these margins, a fixed team cost of US$25,000 a month is covered at roughly 12,500 paid employees at a blended US$2 contribution each.

## Build now and build later

There are no dates here, only order. "Now" is the first production release, and "later" is designed but deferred.

**Build now.**

- Identity: passkeys, Google and Microsoft sign-in, MFA, and SCIM.
- Structure and roles: tenant, legal entity and org structure; roles × scope with primary and backup handlers.
- People and documents: people records with effective dating; documents stored in the customer's Drive or SharePoint, with document collection requests, letters and acknowledgements.
- Communications: announcements and bulk email with limit-aware routing, plus Chat and Teams approval cards.
- Onboarding, offboarding and provisioning; calendar scheduling.
- Time: leave; holidays; basic shifts.
- Attendance: the punch ingestion hub, mobile punch with attestation, kiosk and rotating QR, and the Go bridge with the ZKTeco ADMS adapter.
- Payroll: the Rust payroll engine, the first country packs, partner mode and the continuity kit.
- Helpdesk with policy answers; report builder; exports to Sheets and Excel; audit log; data export; billing.
- AI: the MCP server with read, analyse and draft tiers, and the in-app assistant with bring-your-own key.
- Email signature manager for Google and Exchange.
- Goals and basic reviews.

**Build later.**

- AI and assistants: the MCP commit tier, enabled after a red-team review; bounded agents; the Copilot Marketplace listing and Gemini Enterprise A2A registration.
- Attendance: the other device adapters, in order of customer demand; face liveness; IoT presence signals.
- Talent and spend: timesheets and project time; compensation planning; light recruiting; expense advances and the accounting export.
- Assets; the extension SDK and marketplace.
- Scale and isolation: Parquet and DuckDB analytics; Temporal for workflows at scale; dedicated cells and customer-managed keys.

## Developer handoff essentials

**Repository.** One monorepo, using pnpm workspaces and Turborepo:

- `apps/api` is the core modular monolith.
- `apps/edge` holds the gateway, MCP and ingest Workers.
- `apps/jobs` holds the job workers.
- `apps/web` and `apps/mobile` are the clients, to be designed later.
- `packages/schema` holds the shared schemas and the generated OpenAPI.
- `packages/domain-*` has one package per module.
- `packages/policy` is the policy engine and data firewall.
- `packages/sdk` is the public SDK under Apache-2.0.
- `engines/payroll` is the Rust engine with its WASM build.
- `bridge` is the Go device bridge.
- `packs` holds the country packs with their golden tests.
- `db/migrations` and `db/policies` hold the SQL and RLS.
- `infra` holds infrastructure as code.
- `docs/adr` holds the architecture decision records.

**Environments.** Local development uses a PostgreSQL container and the Workers local runtime. Every pull request gets a preview environment with its own database branch. Above that sit staging, which uses synthetic data only, and production, one per cell. Production data never leaves production.

**Pipeline.** Every change runs lint, type checks, unit tests, RLS and cross-tenant tests, payroll golden tests and property-based tests, API contract tests, MCP security tests, dependency and secret scans, and SBOM generation with signing. Release then runs migrations in expand mode, a canary to internal tenants, a staged rollout by tenant ring, and the contract step one release later.

**Definition of done for any feature.** A feature is done when all of the following are in place:

- schemas and OpenAPI are updated;
- RLS policies and cross-tenant tests are written;
- the policy rules cover every field class it touches;
- audit events are emitted;
- idempotency is in place on writes;
- metrics and alerts exist;
- MCP tool exposure has been decided and documented;
- the documentation is written;
- a rollback path is tested.

## Decisions needed before any build

The following choices should be confirmed before development starts. Nothing will be built until you approve.

1. Supabase or Neon as the Stage 0–1 database. This blueprint assumes Supabase for its bundled auth and RLS tooling, with Neon as a tested alternative.
2. The first country packs to build. India and the UAE are suggested, since most dossier competitors are strongest there, plus one more market.
3. The free hosted tier limit (10 employees) and the exact country lists for the three regional price bands.
4. The managed key service for tenant keys, and the face-liveness vendor.
5. Whether bulk email is sent from the customer's own domain through SES, which requires DNS setup by the customer, or from a Meridian sub-domain by default.
6. Confirmation from Google on whether the service-account signature path needs a CASA assessment.
7. Final confirmation of AGPL for the core and Apache-2.0 for the SDKs and bridge, as proposed in v1.

## References

[1]: https://www.keka.com/us/pricing "Keka US pricing and plan matrix"
[2]: https://www.rippling.com/pricing "Rippling official pricing page"
[3]: https://www.zoho.com/people/zohopeople-pricing.html "Zoho People official pricing"
[4]: https://developers.google.com/workspace/chat/format-messages "Format Google Chat messages"
[5]: https://learn.microsoft.com/en-us/graph/teams-messaging-overview "Working with Microsoft Teams messaging APIs - current documentation accessed 2026-11-24"
[6]: https://learn.microsoft.com/en-us/graph/permissions-reference "Microsoft Graph permissions reference - last updated 2026-09-14"
[7]: https://developers.google.com/admin-sdk/directory/v1/guides/manage-users "Manage user accounts with the Directory API"
[8]: https://developers.google.com/drive/picker/guides/overview "Overview of the Google Picker"
[9]: https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/create "Create a spreadsheet"
[10]: https://developers.google.com/drive/api/guides/api-specific-auth "Choose Google Drive API scopes"
[11]: https://developers.google.com/drive/api/guides/about-shareddrives "Shared drives overview"
[12]: https://learn.microsoft.com/en-us/graph/permissions-selected-overview "Overview of Selected permissions in OneDrive and SharePoint - last updated 2024-11-07"
[13]: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification "Restricted scope verification"
[14]: https://developers.google.com/gmail/api/auth/scopes "Choose Gmail API scopes"
[15]: https://developers.google.com/gmail/api/reference/rest/v1/users.settings.sendAs/update "Update a Gmail send-as alias"
[16]: https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview "Outlook mail API overview - last updated 2026-05-11"
[17]: https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/set-organizationconfig?view=exchange-ps "Set-OrganizationConfig - current Exchange PowerShell documentation accessed 2026-11-24"
[18]: https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/disclaimers-signatures-footers-or-headers "Organization-wide message disclaimers, signatures, footers, or headers in Exchange Online - last updated 2024-06-17"
[19]: https://support.google.com/a/answer/162106 "Control API access with domain-wide delegation"
[20]: https://developers.google.com/admin-sdk/directory/v1/guides/manage-groups "Manage groups with the Directory API"
[21]: https://support.google.com/a/answer/166852 "Gmail sending limits in Google Workspace"
[22]: https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-sending-limits-troubleshoot "Troubleshoot outbound sending limits and blocked users - last updated 2026-05-27"
[23]: https://aws.amazon.com/ses/pricing/ "Amazon SES pricing"
[24]: https://learn.microsoft.com/en-us/entra/identity/app-provisioning/isv-automatic-provisioning-multi-tenant-apps "Enable automatic user provisioning for your multitenant application - last updated 2025-03-04"
[25]: https://docs.cloud.google.com/identity/docs "Cloud Identity documentation"
[26]: https://developers.google.com/workspace/calendar/api/guides/create-events "Create Calendar events"
[27]: https://developers.google.com/workspace/meet/api/guides/overview "Google Meet REST API overview"
[28]: https://learn.microsoft.com/en-us/graph/api/resources/calendar-overview?view=graph-rest-1.0 "Working with calendars and events using Microsoft Graph - last updated 2025-01-29"
[29]: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0 "Create onlineMeeting - current v1.0 documentation accessed 2026-11-24"
[30]: https://github.com/s0x90/zkteco-adms "ZKTeco ADMS Go implementation and protocol reference"
[31]: https://help.keka.com/hc/en-us/articles/39946756738577-API-Guide-for-Attendance-Log-Ingestion "Keka API Guide for Attendance Log Ingestion"
[32]: https://esslsecurity.com/eSSL-eBioserver-New "eSSL eBioServer New"
[33]: https://community.anviz.com/t/crosschex-cloud-api-definition/1139 "CrossChex Cloud API definition"
[34]: https://easytimehr.com/docs/developer-adms "ZKTeco ADMS Push Protocol"
[35]: https://www.hikvision.com/content/dam/hikvision/vn/webinar/Thang3_Hikvision_Tich_Hop_He_Thong_Overview-of-3rd-Party-Integration.pdf "Hikvision Overview of Third Party Integration"
[36]: https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html "HikCentral Professional OpenAPI Developer Guide"
[37]: https://www.supremainc.com/en/support/development-tools_biostar-2-api.asp "Suprema BioStar X API"
[38]: https://www.dahuasecurity.com/in/products/key-technologies/5e/dahua-http-push "Dahua HTTP Push"
[39]: https://www.matrixcomsec.com/cosec-time-attendance-integration-with-third-party-software/ "COSEC Time Attendance Integration with Third Party Software"
[40]: https://securelist.com/biometric-terminal-vulnerabilities/112800/ "Kaspersky QR code SQL injection and biometric terminal vulnerabilities"
[41]: https://help.keka.com/hc/en-us/articles/39946719141265-Prerequisites-for-different-Biometric-Integration-Methods "Keka prerequisites for biometric integration methods"
[42]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/biometric-device-integration/articles/biometric-device-integration-overview "Zoho People biometric integration overview"
[43]: https://developer.android.com/google/play/integrity/overview "Android Play Integrity API overview"
[44]: https://developer.android.com/reference/android/location/Location "Android Location API reference"
[45]: https://developer.apple.com/documentation/devicecheck "Apple DeviceCheck and App Attest"
[46]: https://developers.google.com/ml-kit/vision/face-detection "Google ML Kit face detection"
[47]: https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html "Amazon Rekognition Face Liveness"
[48]: https://www.facetec.com/pricing "FaceTec pricing"
[49]: https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng "EU General Data Protection Regulation"
[50]: https://www.ilga.gov/Legislation/ILCS/Articles?ActID=3004&ChapterID=57&Print=True "Illinois Biometric Information Privacy Act"
[51]: https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode "Android Enterprise lock task mode"
[52]: https://www.deel.com/pricing/ "Deel pricing and starting prices"
[53]: https://remote.com/pricing "Remote pricing and plans"
[54]: https://blog.workday.com/en-us/workday-data-center-outage-updates-on-status.html "Workday Data Center Outages and Availability"
[55]: https://developers.cloudflare.com/ai-gateway/features/ "Cloudflare AI Gateway Features"
[56]: https://openai.com/api/pricing/ "OpenAI API Pricing"
[57]: https://docs.anthropic.com/en/docs/about-claude/models "Claude Models Overview and Pricing"
[58]: https://workspace.google.com/pricing?hl=en-US&currency=USD "Google Workspace pricing in USD"
[59]: https://www.microsoft.com/en-us/microsoft-365/business/microsoft-365-plans-and-pricing "Microsoft 365 business plans and pricing - accessed 2026-11-24"
[60]: https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant "Convert single-tenant app to multitenant on Microsoft Entra ID - last updated 2024-11-13"
[61]: https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview "What is Conditional Access? - last updated 2026-04-27"
[62]: https://developers.google.com/identity/openid-connect/openid-connect "OpenID Connect"
[63]: https://learn.microsoft.com/en-us/copilot/plan/architecture-data-protection-auditing "Data protection and auditing for Microsoft Copilot - last updated 2026-11-09"
[64]: https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0 "user: sendMail - last updated 2025-07-23"
[65]: https://learn.microsoft.com/en-us/plugins/overview "What is a Microsoft 365 Copilot plugin? - last updated 2026-11-16"
[66]: https://learn.microsoft.com/en-us/plugins/configure-plugin-mcp-servers "Configure remote MCP servers for Microsoft 365 Copilot plugins - last updated 2026-11-16"
[67]: https://learn.microsoft.com/en-us/plugins/overview-copilot-connector "Microsoft 365 Copilot connectors overview - last updated 2026-11-16"
[68]: https://learn.microsoft.com/en-us/microsoft-365/copilot/connectors/overview "Copilot connectors overview - last updated 2026-10-06"
[69]: https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent "Connect your agent to an existing MCP server - last updated 2026-11-18"
[70]: https://learn.microsoft.com/en-us/plugins/publish "Choose how to publish and distribute your plugin - last updated 2026-11-16"
[71]: https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/review-copilot-validation-guidelines "Guidelines to Validate Agents - last updated 2026-08-13"
[72]: https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server "Set up your custom MCP server data store"
[73]: https://docs.cloud.google.com/gemini/enterprise/docs/release-notes "Gemini Enterprise release notes"
[74]: https://docs.cloud.google.com/gemini/enterprise/docs/register-and-manage-an-a2a-agent "Register and manage A2A agents"
[75]: https://developers.google.com/workspace/guides/ai-overview "Build with AI for Google Workspace"
[76]: https://developers.google.com/workspace/add-ons/how-tos/building-workspace-addons "Build Google Workspace add-ons"
[77]: https://developers.google.com/workspace/marketplace/configure-oauth-consent-screen "Configure OAuth for Marketplace apps"
[78]: https://www.microsoft.com/en-us/copilot/pricing/copilot-studio "Microsoft Copilot Studio pricing - accessed 2026-11-24"
[79]: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt "Connecting custom MCP servers in ChatGPT"
[80]: https://openai.com/business-data/ "Business data privacy, security, and compliance"
[81]: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp "Get started with custom connectors using remote MCP"
[82]: https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities "Use connectors to extend Claude's capabilities"
[83]: https://code.visualstudio.com/docs/copilot/chat/mcp-servers "MCP servers in Visual Studio Code"
[84]: https://cursor.com/docs/mcp "Model Context Protocol in Cursor"
[85]: https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy "Data, privacy, and security for Models sold by Azure"
[86]: https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html "Data retention in Amazon Bedrock"
[87]: https://docs.litellm.ai/docs/proxy/virtual_keys "LiteLLM Virtual Keys"
[88]: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization "MCP Authorization Specification 2026-07-28"
[89]: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices "MCP Security Best Practices 2026-07-28"
[90]: https://genai.owasp.org/llmrisk/llm01-prompt-injection/ "LLM01:2025 Prompt Injection"
[91]: https://learn.microsoft.com/en-us/ai/playbook/solutions/genai-gateway/key-considerations "Key considerations for designing a GenAI gateway solution"
[92]: https://learn.microsoft.com/en-us/azure/ai-services/language-service/personally-identifiable-information/overview "What is PII detection in Azure Language"
[93]: https://www.cloudflare.com/plans/free/ "Cloudflare Free Plan overview"
[94]: https://supabase.com/docs/guides/auth/auth-mfa/totp "Supabase TOTP MFA"
[95]: https://developers.cloudflare.com/queues/platform/pricing/ "Cloudflare Queues pricing"
[96]: https://www.inngest.com/pricing "Inngest pricing"
[97]: https://temporal.io/pricing "Temporal Cloud pricing"
[98]: https://developers.cloudflare.com/durable-objects/platform/pricing/ "Cloudflare Durable Objects pricing"
[99]: https://supabase.com/pricing "Supabase pricing"
[100]: https://developers.cloudflare.com/r2/pricing/ "Cloudflare R2 pricing"
[101]: https://grafana.com/docs/grafana-cloud/platform/pricing-and-usage/ "Grafana Cloud pricing and usage"
[102]: https://sentry.io/pricing/ "Sentry pricing"
[103]: https://betterstack.com/pricing "Better Stack pricing"
[104]: https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf "India Digital Personal Data Protection Act 2023"
[105]: https://pages.cloudflare.com/ "Cloudflare Pages"
[106]: https://developers.cloudflare.com/workers/platform/pricing/ "Cloudflare Workers pricing"
[107]: https://developers.cloudflare.com/workers/platform/limits/ "Cloudflare Workers limits"
[108]: https://resend.com/pricing "Resend pricing"
[109]: https://developers.cloudflare.com/ai-gateway/reference/pricing/ "Cloudflare AI Gateway pricing"
[110]: https://developers.cloudflare.com/workers-ai/platform/pricing/ "Cloudflare Workers AI pricing"
[111]: https://supabase.com/docs/guides/platform/free-project-pausing "Supabase Free project pausing"
[112]: https://neon.tech/pricing "Neon pricing"
[113]: https://render.com/pricing "Render pricing"
[114]: https://www.hetzner.com/cloud-singapore/ "Hetzner Cloud Singapore"
[115]: https://upstash.com/pricing/redis "Upstash Redis pricing"
[116]: https://upstash.com/pricing/qstash "Upstash QStash pricing"
[117]: https://aws.amazon.com/rds/aurora/pricing/ "Amazon Aurora pricing"
[118]: https://workos.com/pricing "WorkOS pricing"
[119]: https://www.twilio.com/verify/pricing "Twilio Verify pricing"
[120]: https://www.twilio.com/en-us/sms/pricing/in "Twilio India SMS pricing"
[121]: https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml "Supabase SAML SSO"
[122]: https://www.vendr.com/marketplace/workday "Vendr Workday pricing analysis"
[123]: https://www.adp.com/what-we-offer/products/adp-workforce-now/compare-options "ADP Workforce Now plans and feature comparison"
[124]: https://www.hibob.com/pricing-plans/ "HiBob pricing plans"
[125]: https://www.personio.com/pricing/ "Personio pricing and plan comparison"
[126]: https://www.paycom.com/pricing/ "Paycom HR Software Pricing"
[127]: https://www.paylocity.com/pricing/ "Paylocity pricing"
[128]: https://www.capterra.com/p/149254/Sprout-HR-Payroll/ "Capterra Sprout reviews and pricing profile"
[129]: https://www.dayforce.com/Ceridian/media/documents/pricing/Dayforce_Published-MSRP-Price-Book_02-APR-2026.pdf "Dayforce published MSRP price book dated April 2 2026"
[130]: https://www.oracle.com/ee/a/ocom/docs/corporate/pricing/us-public-sector-3904395.pdf "Oracle Public Sector Price List Nov 2026"
[131]: https://www.sap.com/products/hcm/performance-goals/pricing.html "SAP SuccessFactors Performance and Goals Pricing"
[132]: https://www.bamboohr.com/pricing/ "BambooHR plans pricing and included features"
[133]: https://factorialhr.com/pricing-plans "Factorial pricing plans"
[134]: https://employmenthero.com/au/pricing/ "Employment Hero Australia pricing and feature comparison"
[135]: https://www.g2.com/products/keka/reviews "G2 Keka reviews"
[136]: https://www.capterra.com/p/149253/Keka/ "Capterra Keka reviews"
[137]: https://www.zimyo.com/pricing/ "Zimyo India pricing and features"
[138]: https://gusto.com/product/pricing "Gusto official pricing"
[139]: https://www.greythr.com/pricing/ "greytHR India pricing"
[140]: https://hrone.cloud/pricing/ "HROne pricing plans"
[141]: https://razorpay.com/payroll/pricing/ "Razorpay Payroll pricing"
[142]: https://factohr.com/plans/ "factoHR plans and pricing"
[143]: https://www.zenhr.com/en/zenhr-pricing "ZenHR pricing and bundle comparison"
