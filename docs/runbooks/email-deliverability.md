# Email deliverability runbook

This runbook covers Meridian's transactional email channel. DNS publication, provider account ownership and mailbox reputation are operator responsibilities; the application cannot create or validate SPF, DKIM or DMARC records for the sending domain.

## Before enabling production mail

Choose a dedicated sending subdomain such as `notify.example.com`. Use a provider that supports an HTTPS or authenticated SMTP submission endpoint, a stable provider message id, bounce/complaint webhooks and suppression management. Configure `MAIL_PROVIDER` as `smtp` or `postmark`, set `MAIL_FROM` to the verified sender, and provide the provider credentials through the production secret manager. Do not use `MAIL_PROVIDER=log` or `SMS_PROVIDER=log` in production; the API refuses to start with those settings. Keep `POSTMARK_TOKEN`, SMTP passwords and webhook secrets out of source control and logs.

The application sends links from versioned templates only. Invitation and reset tokens are encrypted in the outbox payload, are never included in logs or API responses, and are rendered only for the intended recipient. Do not add sensitive data to templates: salary, bank, national-ID, leave-reason and payslip-content fields must remain behind the authenticated application link.

## DNS records to publish

The exact hostnames and values come from the chosen provider. Replace the examples below with the provider-issued values, and verify them from an external DNS resolver before sending.

### SPF

Publish one SPF TXT record at the sending domain, for example:

```text
notify.example.com. TXT "v=spf1 include:<provider-spf-domain> -all"
```

There must be one SPF record only. Consolidate existing mechanisms and keep the lookup count within the SPF limit. Do not copy the example literally.

### DKIM

Generate or obtain a provider-specific selector and publish its public key, for example:

```text
<selector>._domainkey.notify.example.com. TXT "v=DKIM1; k=rsa; p=<provider-public-key>"
```

Enable DKIM signing in the provider console, then send a test message and verify the `DKIM-Signature` result is `pass`. Rotate selectors according to the provider's process; keep the old selector during the overlap window.

### DMARC

Start with monitoring at the organisational or sending domain, then move to enforcement after reviewing aggregate reports. A cautious starting record is:

```text
_dmarc.notify.example.com. TXT "v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com; adkim=s; aspf=s; pct=100"
```

After SPF/DKIM alignment and legitimate senders are confirmed, progress to `p=quarantine` and finally `p=reject` according to the organisation's security decision. Use a monitored report mailbox or a DMARC analysis service; do not send reports to an unmonitored address.

## Provider setup and verification

1. Verify the sending domain and sender identity in the provider console.
2. Configure the provider endpoint and credentials in the secret manager, then set the corresponding environment variables (`MAIL_PROVIDER`, `MAIL_FROM`, `SMTP_*` or `POSTMARK_*`).
3. Configure the bounce/complaint webhook URL and the same `BOUNCE_WEBHOOK_SECRET` expected by Meridian. The endpoint accepts only the documented event types and records a tenant-scoped hash of the recipient address.
4. Run a staging worker against an in-process SMTP server or the provider sandbox. Confirm the outbox row gets a provider message id and is not delivered again after a worker restart.
5. Send a controlled message to an operator mailbox and verify SPF, DKIM, DMARC alignment, TLS, the `From` domain and the provider event trail. This repository does not claim a real-provider result unless an operator records it separately.

## Bounces and suppressions

Permanent invalid-recipient responses and provider bounce/complaint events must be treated as non-retryable. Meridian records a SHA-256 email hash, reason (`bounce` or `complaint`) and tenant; the sender skips active suppressions before calling the provider. This avoids repeatedly sending to a known bad or complaining address and avoids exposing the clear address in the suppression list.

An administrator can view active suppressions and clear one only after confirming the address has been repaired or the suppression was a false positive. Clearing a suppression does not resend old outbox rows automatically. For a hard bounce or spam complaint, do not clear it merely to force delivery; investigate the recipient, consent and domain reputation first.

If the provider reports a temporary failure, leave the outbox row pending for exponential backoff and monitor its attempt count. If a provider accepts a message, the provider message id is stored before the worker marks the row processed; a later retry returns the stored id and does not call the provider again.

## Warm-up and monitoring

Warm up a new domain gradually with opted-in recipients and stable, useful traffic. Avoid sudden volume spikes, purchased lists and high-risk content. Monitor provider acceptance, deferred, bounce, complaint, unsubscribe and suppression rates; SPF/DKIM/DMARC pass rates; delivery latency; pending outbox depth; retry counts; permanent failures; and worker health. Alert on a rising complaint rate, sustained deferrals, authentication failures, a growing outbox or a worker that is repeatedly crashing.

Keep a dated record of DNS changes, provider configuration, webhook tests, suppression reviews and incident actions. A real mailbox test, provider reputation, DNS propagation and final DMARC enforcement remain external operational evidence, not code-level guarantees.
