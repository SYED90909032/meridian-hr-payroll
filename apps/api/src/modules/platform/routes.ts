import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { forbidden, notFound } from '../../errors.js';
import { pid, short } from '../../http/schemas.js';
import { sha256 } from '../../crypto/tokens.js';
import { newToken } from '../../crypto/tokens.js';
import { API_KEY_SCOPES } from '../../http/perms.js';
import { checkWebhookUrl } from './ssrf.js';
import { sealWebhookSecret } from './delivery.js';

export const WEBHOOK_TOPICS = ['*', 'employee.created', 'employee.updated', 'leave.approved', 'leave.rejected', 'pay_run.approved', 'pay_run.paid', 'pay_run.published', 'approval.resolved'] as const;

export function registerPlatformRoutes(svc: Services): void {
  // ---------------------------------------------------------------- API keys
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/platform/api-keys', summary: 'API keys (never the secret)', tag: 'Platform', auth: 'session', perm: 'apikey.manage',
    handler: async ({ db }) => {
      const r = await db.query('select id, name, prefix, scopes, expires_at, revoked_at, last_used_at, created_at from plat.api_key order by created_at desc limit 200');
      return { keys: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/platform/api-keys', summary: 'Create a read-only API key. The secret is shown once.', tag: 'Platform', auth: 'session', perm: 'apikey.manage', stepUp: true,
    body: z.object({
      name: short(100),
      scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
      expires_in_days: z.number().int().min(1).max(365).default(90),
    }).strict(),
    handler: async ({ db, ctx, p, body, audit }) => {
      // A key can never carry a scope its creator does not hold. The principal builder intersects again on every request.
      for (const s of body.scopes) if (!p.perms.has(s)) throw forbidden(`You cannot grant ${s}: you do not hold it`);
      const prefix = randomBytes(4).toString('hex');
      const key = `mk_${prefix}_${newToken(32)}`;
      const r = await db.query(
        `insert into plat.api_key (tenant_id, name, prefix, key_hash, scopes, created_by, expires_at) values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7)) returning id, expires_at`,
        [ctx.tenantId, body.name, prefix, sha256(key), [...new Set(body.scopes)], ctx.userId, body.expires_in_days]);
      await audit('apikey.created', 'api_key', r.rows[0].id, { scopes: body.scopes, expires_at: r.rows[0].expires_at });
      return { status: 201, body: { id: r.rows[0].id, key, expires_at: r.rows[0].expires_at, note: 'Copy this key now. It cannot be shown again.' } };
    },
  });
  defineRoute(svc, {
    method: 'DELETE', path: '/api/v1/platform/api-keys/:id', summary: 'Revoke an API key', tag: 'Platform', auth: 'session', perm: 'apikey.manage', stepUp: true,
    handler: async ({ db, params, audit }) => {
      const id = pid(params.id);
      const r = await db.query('update plat.api_key set revoked_at = now() where id = $1 and revoked_at is null returning id', [id]);
      if (!r.rows[0]) throw notFound('Key not found');
      await audit('apikey.revoked', 'api_key', id, {});
      return { revoked: true };
    },
  });
  // ---------------------------------------------------------------- webhooks
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/platform/webhooks', summary: 'Webhook endpoints', tag: 'Platform', auth: 'session', perm: 'webhook.manage',
    handler: async ({ db }) => {
      const r = await db.query('select id, url, events, active, created_at from plat.webhook_endpoint order by created_at desc limit 100');
      return { endpoints: r.rows, topics: WEBHOOK_TOPICS };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/platform/webhooks', summary: 'Register a webhook endpoint. The signing secret is shown once.', tag: 'Platform', auth: 'session', perm: 'webhook.manage', stepUp: true,
    body: z.object({ url: z.string().url().max(500), events: z.array(z.enum(WEBHOOK_TOPICS)).min(1).max(20) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const url = checkWebhookUrl(body.url); // static checks now, DNS-level checks again at every delivery
      const id = randomUUID();
      const secret = 'whsec_' + newToken(32);
      await db.query('insert into plat.webhook_endpoint (id, tenant_id, url, secret_enc, events, created_by) values ($1, $2, $3, $4, $5, $6)',
        [id, ctx.tenantId, url.toString(), sealWebhookSecret(svc.kms, ctx.tenantId, id, secret), [...new Set(body.events)], ctx.userId]);
      await audit('webhook.created', 'webhook_endpoint', id, { host: url.host, events: body.events });
      return { status: 201, body: { id, secret, note: 'Copy the signing secret now. It cannot be shown again. Signature: HMAC-SHA256 of "<timestamp>.<body>" in X-Meridian-Signature.' } };
    },
  });
  defineRoute(svc, {
    method: 'PATCH', path: '/api/v1/platform/webhooks/:id', summary: 'Enable or disable an endpoint', tag: 'Platform', auth: 'session', perm: 'webhook.manage',
    body: z.object({ active: z.boolean() }).strict(),
    handler: async ({ db, params, body, audit }) => {
      const id = pid(params.id);
      const r = await db.query('update plat.webhook_endpoint set active = $2 where id = $1 returning id', [id, body.active]);
      if (!r.rows[0]) throw notFound('Endpoint not found');
      await audit('webhook.toggled', 'webhook_endpoint', id, { active: body.active });
      return { id, active: body.active };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/platform/webhooks/:id/deliveries', summary: 'Recent deliveries for an endpoint', tag: 'Platform', auth: 'session', perm: 'webhook.manage',
    handler: async ({ db, params }) => {
      const r = await db.query('select id, event, status, attempts, response_code, last_error, created_at, delivered_at from plat.webhook_delivery where endpoint_id = $1 order by created_at desc limit 100', [pid(params.id)]);
      return { deliveries: r.rows };
    },
  });
}
