# Meridian infrastructure cost note

**Pricing checked:** 24 November 2026. Prices are USD/month unless stated. These are list prices seen on official vendor pages on that date; taxes, support, regional price differences, credits, payment fees and engineering labor are excluded. Items marked **unverified** were not exposed clearly in the official page extraction and should be rechecked before procurement.

## Key numbers and platform fit

Cloudflare is the best edge and security shell for Meridian. Workers Free allows **100,000 requests/day**, 10 ms CPU per invocation, 128 MB memory and 50 subrequests; Workers Paid starts at **$5/account/month**, includes 10M requests/month and 30M CPU-ms, and permits up to five minutes CPU per invocation. Pages static-asset requests are free and unlimited; Pages Functions consume the same Workers request quota. [1] [2] [3]

The useful free storage bundle is substantial: R2 includes **10 GB-month**, 1M Class A and 10M Class B operations/month, with free Internet egress; paid Standard storage is $0.015/GB-month, Class A $4.50/M and Class B $0.36/M. D1 Free includes 5 GB total, 5M rows read/day, 100k rows written/day and 10 databases; Paid includes 5 GB, 25B rows read/month and 50M writes/month, then $0.001/M reads and $1/M writes. KV Free has 1 GB, 100k reads/day, 1k writes/deletes/lists per day; Paid includes 10M reads and 1M writes/month, with $0.50/M reads and $5/M writes overage. Hyperdrive is 100k database queries/day Free and unlimited on Paid. [1]

Durable Objects are now available on Free, but only SQLite-backed objects there: 100k requests/day, 13,000 GB-s/day and SQLite limits of 5M rows read/day, 100k rows written/day and 5 GB stored. Paid includes 1M requests and 400k GB-s/month, then $0.15/M requests and $12.50/M GB-s, plus SQLite overage. Cloudflare Queues Free includes 10k operations/day; Paid includes 1M operations/month and then $0.40/M, with no egress charge. Paid queue retention defaults to four days and is configurable to 14 days. [4] [5]

Turnstile is a good CAPTCHA replacement and the Cloudflare Free plan includes foundational DDoS protection and CDN/security. Exact Turnstile challenge quotas and the Free WAF managed-rule count were **unverified** from the extracted official pages; do not promise unlimited CAPTCHA or advanced WAF rules in a contract. Zero Trust/Access has a Free offering, but the exact free-seat ceiling was **unverified** here. Treat Access as an admin VPN replacement, not as Meridian’s end-user tenant auth. Email Routing is free on Free and Paid for inbound routing; arbitrary-recipient Email Sending requires Workers Paid. [6] [7] [8] [9]

AI Gateway’s core analytics, caching and rate limiting are free. Legacy log storage is 100k logs total on Workers Free and 10M logs per gateway on Paid; new gateways created from 24 September 2026 use Workers Logs pricing. Workers AI includes 10,000 Neurons/day free; Paid overage is $0.011/1,000 Neurons. [10] [11]

Supabase Free is attractive for a prototype: 500 MB Postgres, 50k MAU, 5 GB egress, 5 GB cached egress, 1 GB file storage, 500k Edge Function invocations, 2M Realtime messages and 200 peak Realtime connections. It grants two free projects across organizations, but projects with low database activity over seven days can pause. Pro starts at **$25/month**, includes 100k MAU, 8 GB database disk/project, 250 GB egress, 100 GB file storage, 2M Edge Function invocations and 5M Realtime messages; Micro compute is covered by the $10 compute credit, and the first extra project is from $10/month. PITR is $100/month per seven days of retention. Edge Function overage is $2/M and Realtime overage $2.50/M. [12] [13] [14] [15]

Supabase Auth includes TOTP MFA for all projects at no separate charge. SAML SSO is Pro and above; SSO MAU over quota is $0.015/MAU. RLS is the core tenant-isolation control: every exposed table should have grants and policies. Supabase says it is SOC 2 Type 2 compliant and HIPAA compliant, but the HIPAA-ready organization tier/add-on and BAA terms should be confirmed with sales; the public pricing page shows SOC2/ISO 27001 at Team ($599/month) and HIPAA as a paid add-on. [16] [17]

Neon is a strong database alternative when scale-to-zero and branches matter. Free has 100 projects, 10 branches/project, 100 CU-hours/project/month, 1 GB/project and 20 GB/account, 5 GB egress/project and compute scale-to-zero after five minutes. Launch is usage-based with no minimum: $0.106/CU-hour, $0.35/GB-month storage, 500 GB egress/project included, and $1.50/extra branch-month. Scale is $0.222/CU-hour, adds 25 branches, private networking, SOC 2/ISO and HIPAA availability. Neon Free does not pause for inactivity. [18] [19]

For later enterprise scale, Aurora Serverless v2 is the conservative managed alternative: Aurora Standard compute is shown at **$0.12 per ACU-hour**, with a 0.5 ACU minimum; Aurora storage is commonly $0.10/GB-month in the US example, plus I/O (or use I/O-Optimized at a higher storage/compute rate). Aurora storage is fault tolerant across three Availability Zones. A 16-ACU average cluster therefore starts around `16 × 730 × $0.12 = $1,401.60/month` before storage, I/O, replicas, backups and transfer. [20]

For background workers, Hetzner is the lowest-cost always-on option with Singapore availability and a 99.9% SLA: Singapore CPX12 is €15.99/month for 1 vCPU, 2 GB RAM and 40 GB; CCX13 is €54.49/month for 2 dedicated AMD cores, 8 GB and 80 GB. Included outbound traffic varies by plan; the Singapore page says overage is $8.49/TB. Fly.io has no platform fee; its smallest always-on Machine is $2.19/month for 256 MB, $3.69 for 512 MB and $6.70 for 1 GB, with Singapore 1 GB listed at $8.50/month in the example. Railway Free is $0 plus $1 usage credit/month, Hobby $5 and Pro $20; its free service is not a reliability tier. Render Free gives 750 instance-hours/workspace/month but spins down after 15 minutes and is explicitly not for production; paid worker compute starts at $7/month for 0.5 CPU/512 MB, while a 1 CPU/2 GB worker is $25/month. [21] [22] [23] [24]

Email economics favor SES. Resend Free is 3,000/month and 100/day; Pro is $20 for 50k plus $0.90/1k overage. SES’s current Essentials plan is $0.16/1k for the first 10M, while à-la-carte outbound is $0.10/1k. Postmark has a permanent 100-email/month developer tier, then $15 for 10k and $1.80/1k extra. Use Resend or Postmark while deliverability tooling matters; move bulk payroll notifications to SES. [25] [26] [27]

Upstash Redis Free is 250 MB, 10 GB bandwidth and 500k commands/month. Pay-as-you-go is $0.20/100k commands, first 1 GB storage free and 200 GB bandwidth free; Fixed 250 MB is $10/month. QStash Free is 1,000 messages/day and 50 GB bandwidth; PAYG is $1/100k messages, and Fixed 1M is $180/month. Inngest Free includes 50k executions, 500k events, five concurrent steps and three workers; Pro starts at $99. Temporal Cloud starts at $0 usage-based, with $150 new-account credits; actions are $50/M for the first 5M beyond plan allocations, active storage $0.042/GB-hour and retained storage $0.00105/GB-hour. [28] [29] [30] [31]

Observability can start free: Grafana Cloud Free includes 10k metrics, 50 GB logs, 50 GB traces, three active users and 14-day retention; Sentry Developer is one user with 5k errors, 5 GB logs, 5M spans, 50 replays and one uptime/cron monitor; Sentry Team is $26/month and Business $80/month. Better Stack Free includes 10 monitors, one status page, 100k exceptions, 5,000 replays, 3 GB logs and 3 GB traces retained three days, plus 30 GB metrics. [32] [33] [34]

For auth, Supabase is the best value when Postgres/RLS/Auth are one system. Clerk Hobby is free to 50k monthly retained users per app; Pro is $25 monthly or $20 annual, with 50k included and one SSO connection, then $75/connection. WorkOS AuthKit is free to the first 1M MAU; SAML SSO and Directory Sync are each $125 per connection for connections 1–15, $100 for 16–30, $80 for 31–50 and $65 for 51–100. This makes WorkOS excellent for enterprise SSO/SCIM but expensive if every customer demands a separate connection. [35] [36]

OTP is a variable cost, not core infrastructure. Twilio Verify charges $0.05 per successful verification plus channel fees; India SMS is listed at $0.0832/SMS before carrier fees, so a successful SMS OTP is roughly `$0.05 + $0.0832 = $0.1332`, or $133.20 per 1,000. Twilio WhatsApp adds $0.005/message plus Meta’s authentication-template fee; Twilio’s page shows $0.0034 as a US reference and says India must use Meta’s country rate card. Mark the India WhatsApp total **unverified** until the live Meta rate card is checked. Prefer passkeys/TOTP/email OTP and charge tenants for SMS/WhatsApp usage. [37] [38]

## Recommended stages and arithmetic

### Stage 0: public free-plan prototype

Use Cloudflare Pages static assets, Workers Free for API edge logic, D1 for small configuration/tenant metadata, R2 for documents, Turnstile, Free DDoS/CDN, KV for low-volume flags, and Cloudflare Queues or Inngest Free for asynchronous jobs. Use Neon Free for Postgres if avoiding Supabase’s inactivity pause; alternatively Supabase Free is simpler but must be kept active. Use Clerk Hobby or Supabase Auth Free, Grafana Free, Sentry Developer, Better Stack Free, and Resend Free for low-volume email.

**Estimated monthly cash cost:** `Cloudflare $0 + Neon $0 + Clerk/Supabase $0 + queues $0 + email $0 + observability $0 = $0`, excluding a domain and SMS. This is a demo/early beta, not an SLA-backed payroll production system. Set hard spend caps before adding a card.

### Stage 1: first 100 paying customers / about 10,000 employees

Use Cloudflare Workers Paid and Pages Functions, R2, Queues, Turnstile and WAF/DDoS; Supabase Pro for Postgres/Auth/Storage/RLS; one small always-on Singapore worker on Hetzner; SES for roughly 100k transactional emails/month; Upstash PAYG Redis; Inngest Free or QStash PAYG; and free observability until limits are exceeded.

A conservative monthly estimate is:

`Workers Paid $5 + Supabase Pro $25 + extra Small compute $15 + Hetzner CPX12 €15.99 ≈ $18 + SES 100k × $0.16/1k = $16 + Upstash Redis PAYG ≈ $5 + QStash 100k × $1/100k = $1 + Sentry Team $26 + domain/backups/egress allowance $15 = $126/month.`

Round to **$125–$175/month**, or **$0.0125–$0.0175 per employee/month**, before SMS and support. If two workers are required for failover, add roughly $18–$55/month depending on shared versus dedicated CPU. Supabase PITR adds $100/month, so defer it until payroll data requires it or export encrypted backups to R2.

### Stage 2: about 1M employees

Keep the edge multi-tenant and move the primary database to Aurora Serverless v2 or an equivalent enterprise managed Postgres. Assumptions: 100M API requests/month, 16 ACU average writer, 8 ACU read capacity, 500 GB database, 5M SES emails/month, 50M small queue operations/month, 5 GB Redis with HA, 10 enterprise SSO connections, six dedicated worker nodes, and 25% DR/backup/transfer headroom.

Illustrative arithmetic:

`Aurora compute: 16 × 730 × $0.12 = $1,402`

`Aurora read capacity: 8 × 730 × $0.12 = $701`

`Aurora storage/I/O/backups/transfer allowance = $650`

`Six dedicated Hetzner CCX13 nodes: 6 × ~$60 = $360`

`Workers: $5 + (100M − 10M) × $0.30/1M ≈ $32`

`R2 and queue allowance = $50; Upstash 5 GB fixed + HA/Prod Pack ≈ $300`

`SES: 5M × $0.16/1k = $800`

`Sentry Business $80 + Grafana/Better Stack paid allowance $250`

`WorkOS: 10 SSO connections × $125 = $1,250`

`Subtotal ≈ $5,875; 25% DR/backup/support/traffic headroom ≈ $1,469; total ≈ $7,344/month.`

That is about `$7,344 ÷ 1,000,000 = $0.0073 per employee/month`; budget **$0.01–$0.02/employee/month** for normal variation, excluding salaries, compliance audits, customer-specific private links, carrier OTP, and 24×7 human support. SMS OTP at only 100,000 successful Indian verifications/month would add roughly `100,000 × $0.1332 = $13,320`, so SMS must be metered and passed through rather than hidden in the SaaS price.

## References

[1]: https://developers.cloudflare.com/workers/platform/pricing/ "Cloudflare Workers pricing"
[2]: https://developers.cloudflare.com/workers/platform/limits/ "Cloudflare Workers limits"
[3]: https://developers.cloudflare.com/pages/functions/pricing/ "Cloudflare Pages Functions pricing"
[4]: https://developers.cloudflare.com/r2/pricing/ "Cloudflare R2 pricing"
[5]: https://developers.cloudflare.com/durable-objects/platform/pricing/ "Cloudflare Durable Objects pricing"
[6]: https://developers.cloudflare.com/queues/platform/pricing/ "Cloudflare Queues pricing"
[7]: https://www.cloudflare.com/plans/free/ "Cloudflare Free Plan overview"
[8]: https://developers.cloudflare.com/email-routing/ "Cloudflare Email Service and Email Routing"
[9]: https://pages.cloudflare.com/ "Cloudflare Pages"
[10]: https://developers.cloudflare.com/ai-gateway/reference/pricing/ "Cloudflare AI Gateway pricing"
[11]: https://developers.cloudflare.com/workers-ai/platform/pricing/ "Cloudflare Workers AI pricing"
[12]: https://supabase.com/pricing "Supabase pricing"
[13]: https://supabase.com/docs/guides/platform/billing-on-supabase "Supabase billing and quotas"
[14]: https://supabase.com/docs/guides/platform/free-project-pausing "Supabase Free project pausing"
[15]: https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages "Supabase Realtime messages usage"
[16]: https://supabase.com/docs/guides/auth/auth-mfa/totp "Supabase TOTP MFA"
[17]: https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml "Supabase SAML SSO"
[18]: https://neon.tech/pricing "Neon pricing"
[19]: https://neon.tech/docs/introduction/plans "Neon plans"
[20]: https://aws.amazon.com/rds/aurora/pricing/ "Amazon Aurora pricing"
[21]: https://www.hetzner.com/cloud-singapore/ "Hetzner Cloud Singapore"
[22]: https://docs.fly.io/about/pricing "Fly.io resource pricing"
[23]: https://docs.railway.com/pricing/plans "Railway pricing plans"
[24]: https://render.com/pricing "Render pricing"
[25]: https://resend.com/pricing "Resend pricing"
[26]: https://aws.amazon.com/ses/pricing/ "Amazon SES pricing"
[27]: https://postmarkapp.com/pricing "Postmark pricing"
[28]: https://upstash.com/pricing/redis "Upstash Redis pricing"
[29]: https://upstash.com/pricing/qstash "Upstash QStash pricing"
[30]: https://www.inngest.com/pricing "Inngest pricing"
[31]: https://temporal.io/pricing "Temporal Cloud pricing"
[32]: https://grafana.com/docs/grafana-cloud/platform/pricing-and-usage/ "Grafana Cloud pricing and usage"
[33]: https://sentry.io/pricing/ "Sentry pricing"
[34]: https://betterstack.com/pricing "Better Stack pricing"
[35]: https://clerk.com/pricing "Clerk pricing"
[36]: https://workos.com/pricing "WorkOS pricing"
[37]: https://www.twilio.com/verify/pricing "Twilio Verify pricing"
[38]: https://www.twilio.com/en-us/sms/pricing/in "Twilio India SMS pricing"
[39]: https://www.twilio.com/en-us/whatsapp/pricing "Twilio WhatsApp pricing"
