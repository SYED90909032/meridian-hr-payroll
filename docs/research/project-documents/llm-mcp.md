# Connecting Meridian to paid AI assistants without exposing employee data

**Research cut-off: 24 November 2026.** “Unverified” means the requested fact was not stated clearly in the cited official material and should not be assumed in a contract or design.

## ChatGPT: custom MCP apps/connectors

OpenAI documents custom MCP server connections and full MCP support for ChatGPT **Business** and **Enterprise/Edu** on the web. An HR customer can expose Meridian as a remote HTTPS MCP endpoint with read tools and narrowly scoped writes. OpenAI’s Apps SDK builds ChatGPT apps on MCP and can add an interactive UI. [1]

The workspace workflow is important. In Business, only admins and owners can create and publish custom MCP apps. In Enterprise/Edu, admins and owners can create/test; admins can use RBAC to delegate connection creation to selected members, while only admins/owners publish. The creation permission is “Create plugins with MCPs.” After tool discovery, Enterprise/Edu admins can configure actions and access by group. Newly discovered actions are disabled by default; refreshes show changes as a diff, which is a useful defense against a silent tool “rug pull.” Business and Enterprise/Edu admins can refresh a server’s tool list. [1]

ChatGPT connects to remote servers, not local ones directly; OpenAI points private/on-premises customers to Secure MCP Tunnel. Meridian should therefore support public HTTPS or a customer-controlled tunnel. OAuth is supported, and OpenAI recommends discovery metadata plus refresh-token capability such as `offline_access` for long-lived connectivity. [1]

Write/modify tools are supported, but ChatGPT may request user confirmation based on action permissions, context, and impact; especially risky actions can be blocked. Admins see warnings when enabling write-capable apps. Meridian should treat confirmation as helpful UI, not its only control: enforce authorization, approval, idempotency and segregation of duties on Meridian itself. OpenAI says custom apps are not automatically updated: ChatGPT uses a frozen approved tool snapshot until an admin refreshes it. [1]

OpenAI says it does not train models on ChatGPT Business, Enterprise or Edu inputs/outputs by default, encrypts in transit/at rest, and offers retention controls; eligible Enterprise/Edu customers can select data-residency regions. The exact default conversation retention period and connected-app coverage are **unverified** here; confirm them contractually and in workspace settings. [2]

## Claude: remote and local MCP

Anthropic’s current connector help page says custom remote MCP connectors are available on Claude, Cowork and Claude Desktop for Free, Pro, Max, Ultra, Team and Enterprise; Free users are limited to one custom connector. Remote connectors are brokered from Anthropic’s cloud even when the user is in the Desktop app, so Meridian must be reachable over public HTTPS/443 or allowlist Anthropic’s published IP ranges. A local Claude Desktop server is different: it runs on the user’s machine and local network, configured or packaged as a desktop extension. Team/Enterprise owners can allowlist or disable public desktop extensions and distribute custom ones; secrets marked sensitive in an extension are stored using the operating system’s secure storage. [3] [4]

For Team, an Owner/Primary Owner adds a custom connector under Organization settings; Enterprise also permits a custom role with library-management access. Members authenticate individually unless the connector uses a shared credential. Claude supports its published identity, automatic registration, or a customer-registered OAuth client. Meridian must register the callback URL and return least-privilege scopes. Fixed API keys/bearer headers are possible, but shared credentials give every user that credential’s access. [3]

Owners can restrict connector tools org-wide as **Always allow**, **Needs approval**, or **Blocked**, and the stricter custom-role setting wins. This allows Meridian to publish separate read-only and write/delete tools and let a customer block writes centrally. Claude warns that remote servers can inject hidden instructions and that tool behavior can change unexpectedly. Interactive connectors can render inline cards or full-screen UI; Team/Enterprise owners can disable specific tool calls that render those interfaces. [3] [5]

Claude’s connector pages state that source-system permissions still apply and that connector data is encrypted in transit. Exact Team/Enterprise retention and model-training defaults for custom-connector content are **unverified** in the cited pages; require Anthropic’s commercial terms/DPA and customer settings to establish the contractual answer. [5]

## Other clients

* **Gemini CLI / Gemini Enterprise.** Google documents remote MCP over Streamable HTTP. Gemini CLI can configure an extension with an HTTP endpoint and Google ADC/OAuth scopes. Gemini Enterprise’s custom MCP data store accepts an HTTPS endpoint, OAuth authorization/token URLs, client ID/secret and scopes; it supports StreamableHTTP and can include an audience parameter. Admins can also impose allowed egress FQDNs and regional locations. [6] [7]
* **Microsoft Copilot Studio.** The MCP onboarding wizard supports Streamable transport (SSE is no longer supported after August 2025) and None, API-key or OAuth 2.0 authentication. OAuth can use dynamic discovery, dynamic registration or manual endpoints. The agent connection is governed by Power Platform data policies. [8]
* **VS Code and Cursor.** VS Code supports remote HTTP/SSE and local stdio servers, with sign-in/tool approval and MCP Apps UI; exact OAuth behavior is publisher-specific in the cited page, so mark “remote OAuth” **unverified** for a particular Meridian deployment. Cursor explicitly supports remote SSE and Streamable HTTP with OAuth, authorization-code PKCE, RFC 9728 metadata and RFC 8707 resource indicators; it also supports static OAuth client credentials when DCR is unavailable, plus team distribution and tool allowlists. [9] [10]

## MCP security baseline

The current MCP site labels specification **2026-07-28** as latest. Its HTTP authorization profile uses OAuth 2.1 concepts, PKCE-compatible flows, RFC 9728 Protected Resource Metadata, RFC 8414/OIDC authorization-server discovery, RFC 8707 resource indicators, and Client ID Metadata Documents. Clients should prefer a Client ID Metadata Document or pre-registration; Dynamic Client Registration remains for backwards compatibility but is **deprecated** in this version. MCP servers must publish protected-resource metadata, clients must use it, and authorization servers must support OAuth 2.1. [11]

Meridian’s authorization server should issue tokens whose audience/resource is Meridian’s canonical MCP URI. The server must validate signature/issuer, expiry, scopes, subject/tenant and audience before every request. MCP explicitly forbids accepting or transiting a token issued for another resource. Do not pass an upstream assistant token through to a payroll API; exchange it server-side for a downstream credential or use a separately scoped service token. [11] [12]

Design for the MCP threat model: bind codes to PKCE and state; exact-match redirect URIs; prevent open redirects; use per-client consent in proxy architectures; and validate metadata URLs against SSRF protections. Treat tools, resources, files and employee text as untrusted. Defend against prompt injection, tool poisoning and rug pulls with versioned/signed schemas, diff review, separated read/write tools and human approval for high-impact payroll actions. OWASP recommends least privilege, input/output validation, external-content segregation, adversarial testing and human approval, and calls out sensitive-information disclosure, improper output handling, excessive agency and unbounded consumption. [12] [13]

## BYO model key and gateway patterns

Meridian should offer two distinct modes. In **assistant-owned mode**, ChatGPT/Claude/Gemini/Copilot authenticates to Meridian with OAuth and Meridian never receives a customer model key. In **customer-owned mode**, the customer stores an OpenAI-compatible key or cloud-provider credential in a vault and Meridian sends only a minimized, policy-approved prompt to the selected endpoint. Never ask a model to handle raw keys; use a server-side vault, one key per tenant/project, rotation, spend limits and audit logs.

An OpenAI-compatible adapter can front OpenAI API, Azure OpenAI/Foundry, Vertex AI, Bedrock and gateways, but tool calling, retention and residency remain model-specific. Azure says standard Foundry inference is stateless and prompts/completions are not used to train base models; Global/DataZone can process in broader geographies. Bedrock exposes retention modes: `none` is zero retention, `default` follows model policy, and `aws_review` permits AWS review. [14] [15] Vertex-specific ZDR/residency behavior for the exact Gemini endpoint is **unverified** here; validate region, logging and provider terms per model.

A gateway can vault keys and centralize controls. LiteLLM documents virtual keys, model allowlists, per-key/team budgets, RPM/TPM limits and spend tracking. Cloudflare AI Gateway documents encrypted BYOK storage, key rotation, caching, routing/fallbacks, rate limits, analytics, logs, DLP and spend limits; core caching/analytics/rate limiting are free, while log retention and guardrail inference can have plan/provider costs. OpenRouter documents provider/model allowlists, budget limits, ZDR enforcement, data-region restrictions, prompt-injection and sensitive-info filters, including BYOK spend accounting. Gateways improve governance but become a high-value processor: disable raw prompt/response logging or redact before logging, and confirm cache isolation so one tenant cannot receive another’s cached result. [16] [17] [18]

Indicative official prices checked 24 Nov 2026 (input/output per million tokens; prices change): OpenAI lists GPT-6 Luna at **$0.10/$0.50**; Anthropic lists Claude Haiku 5.5 from **$0.10/$0.50**; Gemini’s dynamic AI Studio page did not expose a stable table, so a current Gemini Flash figure is **unverified**. ChatGPT subscriptions do not include API usage; OpenAI bills it separately. [19] [20] [21]

## PII minimization

Use a policy gateway before every model call. Classify fields first: payroll bank details, tax IDs, compensation, health/leave data and disciplinary records should default to “do not send.” Prefer structured tool calls that return only the fields needed for the task, not whole employee records. For permitted fields, tokenize or pseudonymize identifiers with a tenant-scoped mapping held in Meridian; send `EMP_7F2A` rather than a name, and rehydrate only after model output passes validation. Pseudonyms must be non-reversible to the model and resistant to guessing.

Apply field-level redaction and deterministic allowlists before prompt construction. Microsoft recommends Azure Language PII detection or Microsoft Presidio for fine-grained identification/anonymization; Azure Language can classify and redact text, conversations and documents with confidence scores. Scan tool outputs and model responses again, validate schemas and authorization, escape HTML/Markdown, and block unrequested instructions/links. Keep raw payloads out of logs, traces, caches and analytics; log tenant, tool, model, policy decision and hashes. [22] [23]

## Ten design implications for Meridian

1. Publish a remote Streamable HTTP MCP server with OAuth 2.1/PKCE, RFC 9728 metadata, RFC 8707 audience binding and exact redirect-URI validation.
2. Model every request as tenant + user + role + purpose; never rely on the assistant’s plan-level entitlement as Meridian authorization.
3. Expose read/search/fetch and write/delete as separate tools with separate scopes; make payroll writes idempotent and approval-gated.
4. Maintain signed, versioned tool manifests and require customer/admin review before enabling changed or newly added tools.
5. Support both per-user OAuth and explicitly labeled shared service credentials, warning customers about shared-credential blast radius.
6. Provide a local stdio/desktop-extension option for customers that cannot expose a public endpoint, but treat local code execution as a separate supply-chain risk.
7. Offer BYO-key storage through a vault or gateway, with per-tenant keys, provider/model allowlists, rotation, budgets, rate limits and no raw-key exposure to models.
8. Make residency and retention a model/provider policy decision: record region, training use, abuse review, ZDR mode and cache/log behavior before routing employee data.
9. Default to pseudonymized, field-minimized prompts; keep the re-identification map inside Meridian and never send it to an LLM.
10. Treat all model/tool/resource content as untrusted: apply prompt-injection defenses, output schemas, DLP/PII filters, human approval and continuous red-team tests.

## References

[1]: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt "Connecting custom MCP servers in ChatGPT"
[2]: https://openai.com/business-data/ "Business data privacy, security, and compliance"
[3]: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp "Get started with custom connectors using remote MCP"
[4]: https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop "Getting Started with Local MCP Servers on Claude Desktop"
[5]: https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities "Use connectors to extend Claude's capabilities"
[6]: https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server "Set up your custom MCP server data store"
[7]: https://docs.cloud.google.com/mcp/configure-mcp-ai-application "Configure MCP in an AI application"
[8]: https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent "Connect your agent to an existing MCP server"
[9]: https://code.visualstudio.com/docs/copilot/chat/mcp-servers "MCP servers in Visual Studio Code"
[10]: https://cursor.com/docs/mcp "Model Context Protocol in Cursor"
[11]: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization "MCP Authorization Specification 2026-07-28"
[12]: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices "MCP Security Best Practices 2026-07-28"
[13]: https://genai.owasp.org/llmrisk/llm01-prompt-injection/ "LLM01:2025 Prompt Injection"
[14]: https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy "Data, privacy, and security for Models sold by Azure"
[15]: https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html "Data retention in Amazon Bedrock"
[16]: https://docs.litellm.ai/docs/proxy/virtual_keys "LiteLLM Virtual Keys"
[17]: https://developers.cloudflare.com/ai-gateway/features/ "Cloudflare AI Gateway Features"
[18]: https://openrouter.ai/docs/guides/features/guardrails "OpenRouter Guardrails"
[19]: https://openai.com/api/pricing/ "OpenAI API Pricing"
[20]: https://docs.anthropic.com/en/docs/about-claude/models "Claude Models Overview and Pricing"
[21]: https://ai.google.dev/gemini-api/docs/pricing "Gemini Developer API Pricing"
[22]: https://learn.microsoft.com/en-us/ai/playbook/solutions/genai-gateway/key-considerations "Key considerations for designing a GenAI gateway solution"
[23]: https://learn.microsoft.com/en-us/azure/ai-services/language-service/personally-identifiable-information/overview "What is PII detection in Azure Language"
