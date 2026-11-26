# Meridian integration with an existing Microsoft 365 subscription

**Research date: 24 November 2026.** This note uses Microsoft first-party documentation and pricing pages. Prices are public US list prices, generally shown per user/month on an annual commitment; promotions, region, channel and tax can change them.

## 1. Microsoft 365 Copilot extensibility

A **plugin** is an installable package that can include a declarative agent, skills, Copilot connectors and/or references to remote services. An API or MCP plugin is normally an **action of a declarative agent**, not a free-standing capability; its service remains hosted separately. [1] (last updated 16 Nov 2026)

For Meridian, a declarative agent can provide goal-directed HR answers and actions with grounding and confirmation for consequential operations. A **synced Copilot connector** (the successor terminology for Graph connectors) ingests Meridian content into Microsoft Graph for semantic search and Copilot grounding. A **federated connector** uses MCP at query time, without indexing the content in Microsoft Graph, which is better for live, sensitive or rapidly changing payroll/HR data. [2] (16 Nov 2026) [3] (6 Oct 2026) Synced content must carry item-level ACLs; deployed connectors are tenant-wide unless external-item security restricts access. [2] [3]

A remote MCP server can be consumed in two ways. In a Microsoft 365 plugin package, declare it in root `agentConnectors[]` with an HTTPS `mcpServerUrl`, tool descriptions (or supported dynamic `tools/list` discovery), and credentials referenced outside the manifest. Supported authorization types in that route include `OAuthPluginVault`, `ApiKeyPluginVault`, `DynamicClientRegistration`, `AzureKeyVault`, and `ConnectionVault`; `ConnectionVault` is explicitly developer preview. The target experience must support the chosen schema, transport and auth; the manifest alone does not grant source permissions. [4] (16 Nov 2026)

For a declarative-agent action, Microsoft documents Entra SSO, OAuth 2.0 authorization code, dynamic client registration, anonymous access and (for API plugins) API key authentication. [5] (16 Nov 2026) Copilot Studio’s current MCP onboarding wizard supports **Streamable** transport; Microsoft says SSE is no longer supported after August 2025. It supports no auth, API key (header or query) and OAuth 2.0, including dynamic discovery, dynamic DCR or manual configuration. Generative orchestration must be enabled. [6] (18 Nov 2026) Copilot Studio supports MCP tools and resources; certification of an MCP server is a separate preview route. [7] (26 Aug 2026)

There is no blanket GA statement for every remote-MCP host or target Copilot experience; availability varies by host. The explicit status that can be verified is **Microsoft Agent 365 BYO-MCP registration: preview**. In that flow, an admin reviews and approves the request and grants required Entra permissions; after approval/consent, appearance in Copilot Studio can take up to 30 minutes. [6] Meridian should therefore design a customer admin approval and connection-consent step, and label unsupported host combinations **unverified** until tested in a customer tenant.

For distribution, Meridian should validate the exact package, then either (a) share for testing, (b) submit to the customer organization’s plugin registry/app catalog, or (c) submit publicly through Partner Center to Microsoft Marketplace. Public publication is not automatic: Microsoft reviews/certifies the offer, and each customer admin still installs/approves it, allows the publisher category, assigns availability and completes required consent/connections. [8] (16 Nov 2026) Teams apps have the parallel route: organization distribution requires Teams-admin approval, while Teams Store publication requires Microsoft approval. [9] (22 Jul 2026) Agent/Teams Store validation includes differentiated value, security, responsible-AI checks, SSO registration details, compatibility and explicit user confirmation for consequential actions. [10] (13 Aug 2026)

## 2. Entra ID multi-tenant SaaS identity

Register Meridian as **Accounts in any organizational directory**, use the `/common` or `/organizations` authority as appropriate, and implement OpenID Connect sign-in. Validate the token issuer against the tenant (`tid`) rather than assuming one issuer, then use the customer tenant endpoint after sign-in. First sign-in creates a service principal in that tenant after consent. [11] (13 Nov 2024)

Split permissions by scenario. Delegated permissions let Meridian act only as the signed-in user and cannot exceed that user’s rights; application permissions run without a user and can reach the permission’s tenant-wide data, so they require administrator consent. [12] (18 Mar 2025) Request only the exact least-privileged Graph scopes needed, preferably delegated for user-driven actions and narrowly scoped application access for background jobs. Admin consent may be required for app-only scopes and high-privilege delegated scopes; customers can disable end-user consent, making admin approval the normal path. [11] [12]

For lifecycle provisioning, expose a SCIM 2.0 endpoint and let the Microsoft Entra provisioning service create, update and deactivate Meridian users/groups using customer-configured credentials and attribute mappings. Microsoft recommends SCIM when an ISV wants interoperability with multiple identity providers; SCIM does not prevent separate Graph integration for mail, calendar or files. [13] (4 Mar 2025) Support scoping filters and deprovisioning so terminated employees lose Meridian access promptly.

Conditional Access runs after first-factor authentication and can require MFA, compliant devices, authentication strength, approved apps, terms of use or block access. It can target users, groups, applications and (where supported) agent identities. Business Premium includes Conditional Access features; Entra P1 is otherwise required for the feature. [14] (27 Apr 2026) Meridian must handle CA-driven interactive challenges and avoid assuming that a successful OIDC login implies every Graph operation will succeed. App-only background calls are a workload-identity governance issue and should be separately scoped, monitored and revocable.

## 3. Useful Microsoft Graph building blocks

* **Mail:** `Mail.Send` is least privilege for `sendMail`, delegated or application; application permission means “send mail as any user” and requires admin consent, while delegated means send as the user. `Mail.Send.Shared` supports delegated send on behalf of others where the user has mailbox rights. Graph supports primary and shared mailboxes. [15] (23 Jul 2025) [16] (11 May 2026) Where available, use an application access policy or equivalent mailbox restriction instead of tenant-wide app-only mail.
* **Bulk mail limits:** Exchange Online documents a hard **10,000 recipients per mailbox per 24-hour sliding window**, **30 messages/minute**, and a default **500 recipients/message** (customizable 1–1,000). Limits apply to internal and external recipients; a tenant external-recipient limit can block all tenant users sending externally. Exchange says it is not designed for bulk mailing; Meridian should use a dedicated bulk provider/Azure Communication Services Email for payroll campaigns, not fan-out through one user mailbox. [17] (27 May 2026)
* **Calendar and interviews/onboarding:** `Calendars.ReadWrite` creates, reads, updates and deletes events for a user (delegated) or all mailboxes (application). The Calendar API supports event lifecycle, attendees, free/busy (`Calendars.Read`/`Calendars.ReadWrite` as appropriate) and `findMeetingTimes`. [18] (29 Jan 2025) For standalone Teams meetings, `OnlineMeetings.ReadWrite` is delegated; `OnlineMeetings.ReadWrite.All` is application and requires an application access policy. Calendar-backed event creation is preferable when the meeting must appear on calendars and support later transcript retrieval. [19] (current v1.0 page accessed 24 Nov 2026)
* **Teams approvals and notifications:** `ChatMessage.Send` sends one-to-one/group chat messages as the user; `ChannelMessage.Send` sends channel messages as the user. Reading is more sensitive: `Chat.ReadWrite` is delegated user chat read/write, `Chat.ReadWrite.All` is app-only read/write but does not itself allow sending; `ChannelMessage.Read.All` reads all channel messages and is admin-consent-required. [20] (14 Sep 2026) Teams bots can send rich text and Adaptive Cards for approvals/confirmations; Graph chat messages can carry Adaptive Card attachments. [21] (current page accessed 24 Nov 2026) Use Teams Resource-Specific Consent where a bot only needs a particular team/chat rather than tenant-wide permissions.
* **Files:** `Files.ReadWrite.All` is broad; delegated access is limited to files the user can access, while application access spans site collections. Prefer `Sites.Selected` (or newer `Lists.SelectedOperations.Selected`, `ListItems.SelectedOperations.Selected`, `Files.SelectedOperations.Selected`) for customer-controlled least privilege. Selected scopes require both Entra consent and an explicit SharePoint/OneDrive resource assignment; initially the app has no access. [22] (7 Nov 2024)
* **People and tenant data:** `User.ReadBasic.All` returns a constrained profile (name, ID, mail, photo and related basics); `User.Read.All` includes full profiles, reports and managers and is admin-consent-required for application access. `Organization.Read.All` reads organization metadata such as subscribed SKUs and tenant branding and is admin-consent-required. [20] Use `$select`, delta queries and SCIM rather than repeatedly copying the whole directory.

## 4. Email signatures: hard boundary

Microsoft Graph’s documented Outlook mail surface covers messages, folders, rules, contacts, calendar and MIME, but it does not document a supported API to centrally create/update Outlook roaming-signature content or set a user’s default signature. Treat “set Outlook signatures centrally through Graph” as **not supported / unverified** rather than promising it. The Exchange PowerShell documentation exposes organization configuration, including a roaming-signature-related setting, but not a supported third-party signature-management API. [16] [23] (current Exchange PowerShell page accessed 24 Nov 2026)

What is supported: Exchange Online mail-flow/transport rules can prepend or append organization-wide HTML/plain-text disclaimers, signatures, footers or headers. An Exchange administrator can create them in the EAC or with `New-TransportRule`; users can also set their own signatures in Outlook/Outlook on the web. [24] (17 Jun 2024) A third-party Outlook add-in can insert signature text while composing, but central enforcement/roaming behavior, exact client support and API capabilities are **unverified** here. Meridian should offer transport-rule deployment as an admin-led option, not claim Graph signature control.

## 5. Purview and Copilot data protection

Copilot honors Microsoft Purview sensitivity labels and encryption. Permissions come first; Copilot only summarizes/references content the user can already access. Encrypted content requires VIEW and EXTRACT rights for Copilot to summarize it; labels can be shown in Copilot Chat and inherited by newly generated content where supported. [25] (9 Nov 2026)

The key Meridian risk is oversharing, not Copilot bypassing permissions. Synced connector items are indexed into the tenant and each item needs a correct ACL; Copilot and Search permission-trim results to users authorized by the source ACL. If the source ACL or Meridian-to-Entra identity mapping is wrong, HR/payroll data can be exposed to the wrong employees. Copilot also respects existing SharePoint/OneDrive permissions, which means it can surface already-overshared content. Use federated MCP for data that should remain in Meridian, minimize indexed fields, maintain per-item ACLs, apply Purview labels/DLP, and audit connector ingestion and Copilot access. [3] [25]

## 6. Current US list prices

As displayed on Microsoft’s US pages on 24 Nov 2026: **Business Standard $14.00/user/month** and **Business Premium $22.00/user/month** base plans paid yearly; the same business page currently also shows bundled “with Copilot” offers of $23.50 and $32.00 respectively and a **Microsoft 365 Copilot Business add-on starting at $18.00/user/month** (the page also shows an original $21.00 figure and a promotion). [26] (accessed 24 Nov 2026) Because the promotion is time-limited, quote current eligibility rather than hard-code it.

Enterprise list prices are **Microsoft 365 E3 $39.00/user/month**, **E5 $60.00/user/month**, paid yearly. The **Microsoft 365 Copilot add-on is $30.00/user/month**, paid yearly, with an eligible Microsoft 365 subscription required. [27] (accessed 24 Nov 2026)

Copilot Studio is not a simple per-user add-on for an ISV’s external SaaS. Microsoft’s pricing page states tenant-wide **25,000 Copilot Credits for $200/pack/month**, plus pay-as-you-go and prepaid options; an Azure subscription is required. Microsoft 365 Copilot license holders can build/use agents in Copilot Chat, Teams or SharePoint for specified authenticated “classic/generative answers” and Graph-tenant-grounding usage without billed credits, while external channels/non-licensed users require the standalone Copilot Studio model. [28] (accessed 24 Nov 2026) [29] (last updated 16 Nov 2026)

## 10 design implications for Meridian

1. Make Entra OIDC multitenant sign-in and SCIM deprovisioning the default onboarding path.
2. Separate interactive delegated Graph calls from tightly scoped, admin-consented background application jobs.
3. Start with a declarative agent plus read-only Meridian MCP/API actions; require explicit confirmation for payroll mutations.
4. Implement Copilot Studio’s Streamable MCP transport; do not depend on deprecated SSE.
5. Treat remote MCP, plugin package, Meridian runtime, credentials and consent as separate lifecycle components.
6. Offer federated MCP for live/payroll-sensitive records and synced connectors only for content with rigorously maintained item ACLs.
7. Request exact scopes such as `Mail.Send`, `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `ChatMessage.Send`, `ChannelMessage.Send` and `Sites.Selected`, not broad `*.ReadWrite.All` by default.
8. Design mail queues around 10,000 recipients/day and 30 messages/minute per mailbox; use a bulk-mail service for campaigns.
9. Store onboarding/interview documents in a customer-selected SharePoint site using `Sites.Selected` assignments and Purview labels/DLP.
10. Sell the integration as reusing the customer’s Microsoft 365 identity, mail, calendar, Teams, files and Copilot licenses—not as silently including Copilot Studio capacity or central Outlook signature management.

## References

[1]: https://learn.microsoft.com/en-us/plugins/overview "What is a Microsoft 365 Copilot plugin? — last updated 2026-11-16"
[2]: https://learn.microsoft.com/en-us/plugins/overview-copilot-connector "Microsoft 365 Copilot connectors overview — last updated 2026-11-16"
[3]: https://learn.microsoft.com/en-us/microsoft-365/copilot/connectors/overview "Copilot connectors overview — last updated 2026-10-06"
[4]: https://learn.microsoft.com/en-us/plugins/configure-plugin-mcp-servers "Configure remote MCP servers for Microsoft 365 Copilot plugins — last updated 2026-11-16"
[5]: https://learn.microsoft.com/en-us/plugins/plugin-authentication "Configure authentication for MCP and API plugins — last updated 2026-11-16"
[6]: https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent "Connect your agent to an existing MCP server — last updated 2026-11-18"
[7]: https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp "Extend your agent with Model Context Protocol — last updated 2026-08-26"
[8]: https://learn.microsoft.com/en-us/plugins/publish "Choose how to publish and distribute your plugin — last updated 2026-11-16"
[9]: https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-publish-overview "Publish your Microsoft Teams agent or app — last updated 2026-07-22"
[10]: https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/review-copilot-validation-guidelines "Guidelines to Validate Agents — last updated 2026-08-13"
[11]: https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant "Convert single-tenant app to multitenant on Microsoft Entra ID — last updated 2024-11-13"
[12]: https://learn.microsoft.com/en-us/entra/identity-platform/permissions-consent-overview "Overview of permissions and consent — last updated 2025-03-18"
[13]: https://learn.microsoft.com/en-us/entra/identity/app-provisioning/isv-automatic-provisioning-multi-tenant-apps "Enable automatic user provisioning for your multitenant application — last updated 2025-03-04"
[14]: https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview "What is Conditional Access? — last updated 2026-04-27"
[15]: https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0 "user: sendMail — last updated 2025-07-23"
[16]: https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview "Outlook mail API overview — last updated 2026-05-11"
[17]: https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-sending-limits-troubleshoot "Troubleshoot outbound sending limits and blocked users — last updated 2026-05-27"
[18]: https://learn.microsoft.com/en-us/graph/api/resources/calendar-overview?view=graph-rest-1.0 "Working with calendars and events using Microsoft Graph — last updated 2025-01-29"
[19]: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0 "Create onlineMeeting — current v1.0 documentation accessed 2026-11-24"
[20]: https://learn.microsoft.com/en-us/graph/permissions-reference "Microsoft Graph permissions reference — last updated 2026-09-14"
[21]: https://learn.microsoft.com/en-us/graph/teams-messaging-overview "Working with Microsoft Teams messaging APIs — current documentation accessed 2026-11-24"
[22]: https://learn.microsoft.com/en-us/graph/permissions-selected-overview "Overview of Selected permissions in OneDrive and SharePoint — last updated 2024-11-07"
[23]: https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/set-organizationconfig?view=exchange-ps "Set-OrganizationConfig — current Exchange PowerShell documentation accessed 2026-11-24"
[24]: https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/disclaimers-signatures-footers-or-headers "Organization-wide message disclaimers, signatures, footers, or headers in Exchange Online — last updated 2024-06-17"
[25]: https://learn.microsoft.com/en-us/copilot/plan/architecture-data-protection-auditing "Data protection and auditing for Microsoft Copilot — last updated 2026-11-09"
[26]: https://www.microsoft.com/en-us/microsoft-365/business/microsoft-365-plans-and-pricing "Microsoft 365 business plans and pricing — accessed 2026-11-24"
[27]: https://www.microsoft.com/en-us/microsoft-365/enterprise/microsoft-365-plans-and-pricing "Microsoft 365 enterprise plans and pricing — accessed 2026-11-24"
[28]: https://www.microsoft.com/en-us/copilot/pricing/copilot-studio "Microsoft Copilot Studio pricing — accessed 2026-11-24"
[29]: https://learn.microsoft.com/en-us/microsoft-copilot-studio/billing-licensing "Licensing for agents powered by the standard harness — last updated 2026-11-16"
