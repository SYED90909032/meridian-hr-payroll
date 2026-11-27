import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { forbidden, notFound, HttpError } from '../../errors.js';
import { pid, short } from '../../http/schemas.js';
import { sha256, newToken } from '../../crypto/tokens.js';
import { API_KEY_SCOPES, API_KEY_WRITE_SCOPES } from '../../http/perms.js';
import { checkWebhookUrl } from './ssrf.js';
import { sealWebhookSecret } from './delivery.js';
import { urlMatchesAllowlist, type WebhookAllowRule } from './allowlist.js';

export const WEBHOOK_TOPICS = ['*', 'employee.created', 'employee.updated', 'leave.approved', 'leave.rejected', 'pay_run.approved', 'pay_run.paid', 'pay_run.published', 'approval.resolved'] as const;
function requireOwner(roles: string[]): void {
  if (!roles.includes('owner')) throw forbidden('Only the tenant owner may change this setting');
}

export function registerPlatformRoutes(svc: Services): void {
  // ---------------------------------------------------------------- API keys
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/platform/api-keys', summary: 'API keys (never the secret)', tag: 'Platform', auth: 'session', perm: 'apikey.manage',
    handler: async ({ db }) => {
      const r = await db.query(`select id, name, prefix, scopes, allow_write, rate_limit_max, rate_limit_window_seconds,
        expires_at, (expires_at <= now() + make_interval(days => $1)) as expiry_warning, revoked_at, last_used_at, created_at
        from plat.api_key order by created_at desc limit 200`, [svc.cfg.API_KEY_EXPIRY_WARNING_DAYS]);
      return { keys: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/platform/api-keys', summary: 'Create an API key. The secret is shown once.', tag: 'Platform', auth: 'session', perm: 'apikey.manage', stepUp: true,
    body: z.object({
      name: short(100),
      scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
      allow_write: z.boolean().default(false),
      rate_limit_per_minute: z.number().int().min(1).max(10000).default(600),
      expires_in_days: z.number().int().min(1).max(3650).default(90),
    }).strict(),
    handler: async ({ db, ctx, p, body, audit }) => {
      if (body.expires_in_days > svc.cfg.API_KEY_MAX_LIFETIME_DAYS) throw new HttpError(422, 'expiry_too_long', `API keys may expire no later than ${svc.cfg.API_KEY_MAX_LIFETIME_DAYS} days from creation`);
      const scopes = [...new Set(body.scopes)];
      for (const s of scopes) if (!p.perms.has(s)) throw forbidden(`You cannot grant ${s}: you do not hold it`);
      if (body.allow_write) {
        if (!scopes.some((s) => API_KEY_WRITE_SCOPES.has(s))) throw new HttpError(422, 'write_scope_required', 'Write opt-in requires a permitted write scope');
      }
      const prefix = randomBytes(4).toString('hex');
      const key = `mk_${prefix}_${newToken(32)}`;
      const r = await db.query(
        `insert into plat.api_key (tenant_id, name, prefix, key_hash, scopes, allow_write, rate_limit_max, created_by, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9)) returning id, expires_at`,
        [ctx.tenantId, body.name, prefix, sha256(key), scopes, body.allow_write, body.rate_limit_per_minute, ctx.userId, body.expires_in_days]);
      await audit('apikey.created', 'api_key', r.rows[0].id, { scopes, allow_write: body.allow_write, rate_limit_per_minute: body.rate_limit_per_minute, expires_at: r.rows[0].expires_at });
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
  // ---------------------------------------------------------- webhook allow-list
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/platform/webhook-allowlist', summary: 'Webhook destination allow-list', tag: 'Platform', auth: 'session', perm: 'webhook.manage',
    handler: async ({ db, p }) => { requireOwner(p.roles); const r = await db.query('select id, host, path_prefix from plat.webhook_allowlist order by host, path_prefix'); return { rules: r.rows }; },
  });
  defineRoute(svc, {
    method: 'PUT', path: '/api/v1/platform/webhook-allowlist', summary: 'Replace the webhook destination allow-list', tag: 'Platform', auth: 'session', perm: 'webhook.manage', stepUp: true,
    body: z.object({ rules: z.array(z.object({ host: z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/), path_prefix: z.string().min(1).max(500).regex(/^\//) }).strict()).max(100) }).strict(),
    handler: async ({ db, p, ctx, body, audit }) => {
      requireOwner(p.roles);
      for (const rule of body.rules) {
        if (rule.host.includes('..') || rule.host.startsWith('.') || rule.host.endsWith('.')) throw new HttpError(422, 'invalid_allowlist_host', 'Invalid destination host');
        const url = checkWebhookUrl(`https://${rule.host}${rule.path_prefix}`);
        if (url.hostname !== rule.host) throw new HttpError(422, 'invalid_allowlist_host', 'Invalid destination host');
      }
      await db.query('delete from plat.webhook_allowlist');
      for (const rule of body.rules) await db.query('insert into plat.webhook_allowlist (tenant_id, host, path_prefix) values ($1, $2, $3)', [ctx.tenantId, rule.host, rule.path_prefix]);
      await audit('webhook.allowlist_changed', 'tenant', ctx.tenantId, { count: body.rules.length });
      return { rules: body.rules };
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
      const url = checkWebhookUrl(body.url);
      const rules = (await db.query<WebhookAllowRule>('select host, path_prefix from plat.webhook_allowlist')).rows;
      if (!urlMatchesAllowlist(url, rules)) throw new HttpError(422, 'webhook_destination_not_allowed', 'The destination is not in this tenant allow-list');
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
