import https from 'node:https';
import { createHmac } from 'node:crypto';
import type { Pools } from '../../db/pool.js';
import type { Kms } from '../../crypto/kms.js';
import type { Config } from '../../config.js';
import { open, seal } from '../../crypto/kms.js';
import { withTx } from '../../db/tx.js';
import { resolveSafeTarget, type SafeTarget } from './ssrf.js';
import { DeliveryError, mailerFor, smsSenderFor, type Mailer, type SmsSender } from '../comms/providers.js';
import { renderTemplate, type TemplateName } from '../comms/templates/index.js';
import { sha256hex } from '../../crypto/tokens.js';

export interface OutboxRow { id: string; tenant_id: string; topic: string; payload: Record<string, unknown>; created_at: Date | string; attempts: number; provider_message_id?: string | null }
export const webhookAad = (endpointId: string): string => `webhook:${endpointId}`;
export function sealWebhookSecret(kms: Kms, tenantId: string, endpointId: string, secret: string): Buffer { return seal(kms.tenantKey(tenantId), Buffer.from(secret, 'utf8'), webhookAad(endpointId)); }
export function sealDeliveryToken(kms: Kms, tenantId: string, token: string): string { return seal(kms.tenantKey(tenantId), Buffer.from(token, 'utf8'), 'account-token').toString('base64'); }
export function signPayload(secret: string, timestamp: number, body: string): string { return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex'); }
export type Sender = (target: SafeTarget, body: string, headers: Record<string, string>) => Promise<number>;
/** Connects to the already-validated IP, presents the original host as SNI, never follows redirects, and caps time. */
export const httpsSender: Sender = (target, body, headers) => new Promise((resolve, reject) => {
  const req = https.request({ host: target.address, family: target.family, port: 443, method: 'POST', path: target.url.pathname + target.url.search, servername: target.url.hostname,
    headers: { ...headers, Host: target.url.host, 'Content-Length': Buffer.byteLength(body).toString(), 'User-Agent': 'Meridian-Webhooks/1' }, timeout: 5000, rejectUnauthorized: true },
    (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
  req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end(body);
});

/** Delivers one webhook outbox row to every matching active endpoint. */
export async function deliverOutbox(pools: Pools, kms: Kms, row: OutboxRow, send: Sender = httpsSender, lookup?: Parameters<typeof resolveSafeTarget>[1]): Promise<void> {
  const ctx = { tenantId: row.tenant_id, userId: null, employeeId: null };
  const eps = await withTx(pools.app, ctx, async (db) => {
    const r = await db.query(`select id, url, secret_enc from plat.webhook_endpoint where active and (events @> array[$1]::text[] or events @> array['*']::text[])`, [row.topic]);
    for (const e of r.rows) await db.query(`insert into plat.webhook_delivery (tenant_id, endpoint_id, outbox_id, event) values ($1, $2, $3, $4) on conflict (endpoint_id, outbox_id) do nothing`, [row.tenant_id, e.id, row.id, row.topic]);
    const pending = await db.query(`select endpoint_id from plat.webhook_delivery where outbox_id = $1 and status = 'pending'`, [row.id]);
    const ids = new Set(pending.rows.map((p) => p.endpoint_id)); return r.rows.filter((e) => ids.has(e.id));
  });
  let failed: string | null = null;
  for (const e of eps) {
    const ts = Math.floor(Date.now() / 1000); const body = JSON.stringify({ id: String(row.id), topic: row.topic, tenant_id: row.tenant_id, created_at: new Date(row.created_at).toISOString(), data: row.payload });
    let code: number | null = null; let err: string | null = null;
    try {
      const secret = open(kms.tenantKey(row.tenant_id), e.secret_enc as Buffer, webhookAad(e.id)).toString('utf8'); const target = await resolveSafeTarget(e.url, lookup);
      code = await send(target, body, { 'Content-Type': 'application/json', 'X-Meridian-Event': row.topic, 'X-Meridian-Delivery': `${e.id}:${row.id}`, 'X-Meridian-Timestamp': String(ts), 'X-Meridian-Signature': signPayload(secret, ts, body) });
      if (code < 200 || code >= 300) err = `HTTP ${code}`;
    } catch (x) { err = (x as Error).message.slice(0, 200); }
    await withTx(pools.app, ctx, async (db) => { await db.query(`update plat.webhook_delivery set attempts = attempts + 1, response_code = $3, last_error = $4, status = case when $4::text is null then 'delivered' when attempts + 1 >= 8 then 'failed' else 'pending' end, delivered_at = case when $4::text is null then now() else delivered_at end where endpoint_id = $1 and outbox_id = $2`, [e.id, row.id, code, err]); });
    if (err) failed = err;
  }
  if (failed) throw new Error(failed);
}

function requiredString(payload: Record<string, unknown>, key: string): string { const v = payload[key]; if (typeof v !== 'string' || !v) throw new DeliveryError(`Invalid ${key}`, true); return v; }
export async function deliverChannel(pools: Pools, kms: Kms, cfg: Config, row: OutboxRow, mailer: Mailer = mailerFor(cfg), sms: SmsSender = smsSenderFor(cfg)): Promise<string | null> {
  if (row.provider_message_id) return row.provider_message_id;
  if (row.topic === 'email.send') {
    const p = row.payload; const to = requiredString(p, 'to'); const template = requiredString(p, 'template') as TemplateName;
    const suppressed = await withTx(pools.app, { tenantId: row.tenant_id, userId: null, employeeId: null }, async (db) => {
      const r = await db.query('select 1 from comms.suppression where tenant_id = $1 and email_hash = $2 and cleared_at is null', [row.tenant_id, sha256hex(to.trim().toLowerCase())]);
      return !!r.rowCount;
    });
    if (suppressed) throw new DeliveryError('recipient is suppressed', true, 'suppressed');
    const token = typeof p.tokenEnc === 'string' ? open(kms.tenantKey(row.tenant_id), Buffer.from(p.tokenEnc, 'base64'), 'account-token').toString('utf8') : undefined;
    const rendered = renderTemplate(template, { recipientName: typeof p.recipientName === 'string' ? p.recipientName : undefined, link: requiredString(p, 'link').replace('{token}', token ?? ''), token });
    const result = await mailer.send({ to, from: cfg.MAIL_FROM, subject: rendered.subject, text: rendered.text, html: rendered.html, idempotencyKey: `outbox-${row.id}` });
    return result.messageId;
  }
  if (row.topic === 'sms.send') {
    const p = row.payload; const to = requiredString(p, 'to'); const body = requiredString(p, 'body');
    const result = await sms.send({ to, from: requiredString(p, 'from'), body, idempotencyKey: `outbox-${row.id}` }); return result.messageId;
  }
  await deliverOutbox(pools, kms, row); return null;
}
