# Meridian integration with an existing Google Workspace subscription

**Research date:** 24 November 2026. This note uses official Google documentation only. Dates are given where the source exposes an update or release date. “Unverified” means the official sources reviewed did not establish the requested fact; it is not a claim that the feature is impossible.

## 1. Gemini, Gemini Enterprise, add-ons, and agents

Google’s current Workspace developer overview documents AI-powered add-ons, Chat apps, Vertex AI agents, Gemini Enterprise agents, and A2A agent quickstarts. It does not document a general, GA mechanism for a third-party SaaS to plug a remote MCP server or an A2A agent directly into the ordinary Gemini-in-Workspace user interface. Workspace add-ons are documented as extensions of Gmail, Calendar, Chat, Docs, Drive, Meet, Sheets, and Slides; public add-ons are published through Marketplace and require Google app review. [1] [2] A Meridian Workspace add-on can therefore put HR actions in those hosts, especially Chat, but “extend Gemini in Workspace” as a distinct Marketplace capability is **unverified** in the official pages reviewed.

Gemini Enterprise, formerly called Agentspace, is different. Its custom MCP data-store feature connects public or private MCP-compliant tools and third-party systems to Gemini Enterprise. A customer can host Meridian’s MCP endpoint externally, including with a third-party provider; Gemini Enterprise can call it directly over the public internet or route egress through Agent Gateway for private-network or static-IP use cases. The August 7, 2026 release note labels custom MCP server data stores **GA**, although the feature is off by default and an Organization Policy Administrator must remove the blocking organization constraint. [3] [4]

Gemini Enterprise also supports registering an A2A agent hosted on any platform. However, the current “Register and manage A2A agents” page is explicitly labeled **Preview** and subject to the Pre-GA terms. It makes the agent available in the Gemini Enterprise web app, but traffic to an agent added through that method does not go through Agent Gateway. [5] The November 13 release note says 3-legged OAuth with Agent Identity for A2A agents is **GA**; that is the authentication integration, not a reclassification of the whole direct A2A registration page. [4] For Meridian, the production-safe commitment is therefore: build a remote MCP server as the GA Gemini Enterprise route; treat direct A2A registration as Preview until Google changes the page status.

## 2. Identity, Marketplace install, and provisioning

Use Google Identity Services/OIDC for customer and employee sign-in. Google’s OIDC flow uses the `openid email` scopes for basic login, returns a signed ID token, and says the stable unique identifier is `sub`, not the user’s email address. The `hd` parameter can optimize the flow for a particular Google Workspace or Cloud organization, but Meridian must still validate the token and use `sub` as its account key. [6]

Marketplace supports Google Workspace add-ons, Chat apps, Drive apps, and web apps. The Marketplace OAuth configuration page says the scopes entered in the Marketplace SDK are used for both domain-wide and individual installs. Public apps using sensitive or restricted scopes need OAuth verification before approval; Marketplace app review is a separate process. [7] [8] A customer administrator can install or authorize an app for the organization, and admins control API access and domain-wide delegation in the Admin console. Domain-wide delegation is powerful: it can let an OAuth client or service account act for all users without individual consent, so Meridian should request it only when a customer explicitly chooses centrally managed automation and should keep its scope list narrow. [9]

Cloud Identity’s official documentation describes the Cloud Identity API as an API for provisioning and managing identity resources. Google’s Directory API supports programmatic create, update, delete, and lookup of Workspace users, and also manages groups and group members. [10] [11] The official sources reviewed do not document a general Google-provided SCIM endpoint that any arbitrary third-party SaaS can turn on for every Workspace customer. Native SCIM auto-provisioning for Meridian through a custom Marketplace listing is therefore **unverified**. Offer OIDC plus just-in-time provisioning first; for admin-managed lifecycle sync, use the Directory API with customer-authorized admin credentials or a customer’s existing identity provider.

## 3. Drive: customer-owned employee documents with least privilege

The Drive API classifies `https://www.googleapis.com/auth/drive.file` as **non-sensitive**. It lets Meridian create new files or modify files that the user opens with the app or shares with it through Google Picker or the app’s file picker. Broad `drive` and `drive.readonly` access are **restricted**; metadata-wide scopes such as `drive.metadata` are also restricted. Sensitive and restricted scopes require additional OAuth verification, and restricted-scope data stored or transmitted through a server triggers a security assessment. Google’s restricted-scope guidance describes the assessment as an annual Google-empanelled review using the CASA framework. [12] [13]

This makes a customer-owned document design feasible without Meridian paying for a second document store. On onboarding or payroll workflows, Meridian can create a folder or file in the customer’s Drive, return the Drive URL, and let the customer own retention, sharing, Vault, and pooled-storage policy. For a durable HR repository, prefer a customer-managed shared drive where the edition supports it. Shared-drive files belong to the organization rather than an employee, count against organizational pooled storage, have no separate per-drive fee, and service accounts cannot own files; they must upload into a shared drive or act on behalf of a human user. [14]

Use Google Picker for employee uploads and attachments. Picker lets a user select or upload Drive files without leaving Meridian and returns file metadata and URLs. Combined with `drive.file`, it keeps access per-file and user-directed. [15] Meridian should avoid requesting `drive` merely because it wants to find a customer folder: ask the user to pick the target folder/file, store only IDs and links needed for the workflow, and request broader scopes only as a separately justified feature. Sheets creation can also use `drive.file`; the Sheets `spreadsheets.create` method accepts `drive.file`, `drive`, or `spreadsheets`, so Meridian can create a payroll export in the user’s Drive without broad Drive access. [16]

## 4. Gmail, announcements, Groups, and signatures

The Gmail API can send as the authenticated user via `users.messages.send` or send a draft via `users.drafts.send`. The least-purposeful Gmail scope for simple sending is `gmail.send`, which Google classifies as **sensitive**; broad mailbox scopes such as `mail.google.com`, `gmail.modify`, and `gmail.compose` are **restricted**. [17] A send-only design avoids reading employee mail and is much easier to justify in OAuth review.

Workspace’s current Gmail limits are per user over a rolling 24-hour period: 2,000 messages per day for paid accounts, 1,500 for mail merge, and 500 for trials. Gmail API messages may have up to 500 recipients per message; total daily recipients are 10,000, with lower external and unique-recipient limits. Limits can change without notice and exceeding them can suspend sending for up to 24 hours. [18] Use Gmail API for individualized notices, approvals, payslip links, and low-volume HR messages that should appear in the employee’s mailbox as sent by the user. Do not make it Meridian’s bulk campaign engine. For large HR announcements, opt-in transactional or bulk-mail infrastructure is the safer architecture; this recommendation is an engineering judgment based on Google’s quotas and anti-spam limits, not a Google product mandate.

Google Groups are suitable customer-owned department or distribution lists. The Directory API can create groups and add members, and Google documents that a new group initially has no members. Meridian should normally use customer-created Groups rather than silently creating lists, and should obtain admin authorization before membership changes. [19]

For signatures, `users.settings.sendAs.update` accepts an HTML `signature` and requires either `gmail.settings.basic` or `gmail.settings.sharing`. Google classifies `gmail.settings.basic` as restricted; `gmail.settings.sharing` is restricted and administrative-only, available to Workspace customers using a service account with domain-wide delegation. The API reference says addresses other than the primary account address can only be updated by a service-account client with delegated domain-wide authority. Therefore, a user-authorized OAuth token can update the primary address with `gmail.settings.basic`; updating aliases across a domain requires customer-super-admin-approved domain-wide delegation and a service account. [17] [20] Admin policy requirements for whether an organization permits employee signature changes are **unverified** in the official sources reviewed; Meridian should expose an admin-controlled opt-in and report Google API errors rather than assume permission.

## 5. Calendar, Meet, Chat, and Sheets workflows

For interviews, onboarding, and manager meetings, Calendar `events.insert` creates events on a user’s primary calendar, invites attendees, and can send updates. Creating or editing events requires the Calendar scope. Calendar supports `conferenceData` with `conferenceDataVersion=1` to request a Google Meet conference; the Meet REST API can also create and manage meeting spaces, members, attendance, transcripts, recordings, and smart notes. Meet artifacts are saved to the meeting organizer’s Drive, which reinforces the customer-owned-storage model. [21] [22]

Use a Google Chat app or Workspace add-on for approvals such as payroll sign-off, leave approval, or onboarding checklists. Chat apps can send interactive card messages with buttons and text formatting; the card action should call Meridian’s backend, enforce the user’s tenant and role, and return an auditable result. [23] Chat is preferable to email for a decision loop because it avoids reading mail and supports a clear approval surface.

For exports, create a spreadsheet with the Sheets API, populate it with the Sheets values/batch-update methods, and return the spreadsheet URL. With `drive.file`, the spreadsheet can stay in the customer’s Drive while Meridian retains only the spreadsheet ID, tenant ID, and export audit metadata. [16]

## 6. Price and Gemini bundling

The official USD pricing page accessed on November 24, 2026 displays the standard annual-commitment prices as **Business Starter $7**, **Business Standard $14**, and **Business Plus $22 per user/month**, excluding tax; Enterprise is **contact sales**, with no public list price. The page also says Starter, Standard, and Plus are capped at 300 users and Enterprise has no minimum or maximum. The extracted page is showing annual pricing (“save 16%”); an official flexible-monthly USD list price was not exposed in the page content and is therefore **unverified** here. [24]

Gemini is now bundled, but not uniformly. Starter includes limited Gemini in Workspace apps, including Gemini in Gmail, plus basic Gemini app access. Standard, Plus, and Enterprise show Gemini in Workspace apps and expanded Gemini app access, including Docs, Sheets, Slides, Drive, Meet, and Chat features that Starter does not support. The pricing page separately lists “AI Expanded Access” as an add-on, so bundled Gemini does not mean every advanced model, quota, or automation is unlimited. Gemini Enterprise licensing is a separate Google Cloud product; its inclusion in a customer’s ordinary Workspace price is **unverified** and should not be promised by Meridian.

## 10 design implications for Meridian

- Make OIDC `sub` the immutable external identity key; treat email as a mutable attribute.
- Publish a Marketplace add-on/Chat app for host-surface workflows, but do not promise a direct Gemini-in-Workspace extension until Google documents it as GA.
- Offer a GA Gemini Enterprise custom-MCP integration; label direct A2A registration Preview in product and contract language.
- Make every customer a separate tenant boundary in MCP, OAuth tokens, Drive IDs, Chat callbacks, and audit logs.
- Default to `drive.file` plus Google Picker; design the UX around user-selected files and folders.
- Store employee documents and exports in the customer’s My Drive or shared drive, not Meridian’s storage, with customer-controlled sharing and retention.
- Use send-only `gmail.send` for low-volume user-authored HR notices; never request mailbox-read scopes for that feature.
- Route bulk announcements through a transactional/bulk provider or customer-managed Groups, not through a single Workspace mailbox.
- Treat signature management as an optional admin feature: primary-address updates can be user-authorized, while alias-wide automation needs service-account domain-wide delegation.
- Use Calendar/Meet for scheduling, Chat cards for approvals, and Sheets for customer-owned exports; document edition-dependent Gemini, shared-drive, Meet, and quota behavior at onboarding.

## References

[1]: https://developers.google.com/workspace/guides/ai-overview "Build with AI for Google Workspace"
[2]: https://developers.google.com/workspace/add-ons/how-tos/building-workspace-addons "Build Google Workspace add-ons"
[3]: https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server "Set up your custom MCP server data store"
[4]: https://docs.cloud.google.com/gemini/enterprise/docs/release-notes "Gemini Enterprise release notes"
[5]: https://docs.cloud.google.com/gemini/enterprise/docs/register-and-manage-an-a2a-agent "Register and manage A2A agents"
[6]: https://developers.google.com/identity/openid-connect/openid-connect "OpenID Connect"
[7]: https://developers.google.com/workspace/marketplace/configure-oauth-consent-screen "Configure OAuth for Marketplace apps"
[8]: https://developers.google.com/workspace/marketplace "Google Workspace Marketplace"
[9]: https://support.google.com/a/answer/162106 "Control API access with domain-wide delegation"
[10]: https://docs.cloud.google.com/identity/docs "Cloud Identity documentation"
[11]: https://developers.google.com/admin-sdk/directory/v1/guides/manage-users "Manage user accounts with the Directory API"
[12]: https://developers.google.com/drive/api/guides/api-specific-auth "Choose Google Drive API scopes"
[13]: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification "Restricted scope verification"
[14]: https://developers.google.com/drive/api/guides/about-shareddrives "Shared drives overview"
[15]: https://developers.google.com/drive/picker/guides/overview "Overview of the Google Picker"
[16]: https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/create "Create a spreadsheet"
[17]: https://developers.google.com/gmail/api/auth/scopes "Choose Gmail API scopes"
[18]: https://support.google.com/a/answer/166852 "Gmail sending limits in Google Workspace"
[19]: https://developers.google.com/admin-sdk/directory/v1/guides/manage-groups "Manage groups with the Directory API"
[20]: https://developers.google.com/gmail/api/reference/rest/v1/users.settings.sendAs/update "Update a Gmail send-as alias"
[21]: https://developers.google.com/workspace/calendar/api/guides/create-events "Create Calendar events"
[22]: https://developers.google.com/workspace/meet/api/guides/overview "Google Meet REST API overview"
[23]: https://developers.google.com/workspace/chat/format-messages "Format Google Chat messages"
[24]: https://workspace.google.com/pricing?hl=en-US&currency=USD "Google Workspace pricing in USD"
