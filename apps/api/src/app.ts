import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';
import type { Pools } from './db/pool.js';
import { createKms } from './crypto/kms.js';
import { createObjectStore } from './storage/index.js';
import { HttpError } from './errors.js';
import { principalFromSession, SESSION_COOKIE, type Principal } from './http/principal.js';
import { permsFor, type Perm } from './http/perms.js';
import { openApiDocument, type Services } from './http/route.js';
import { sha256 } from './crypto/tokens.js';
import { registerAuthRoutes } from './modules/iam/routes.js';
import { registerPeopleRoutes } from './modules/people/routes.js';
import { registerTimeRoutes } from './modules/time/routes.js';
import { registerFlowRoutes } from './modules/flow/routes.js';
import { registerPayRoutes } from './modules/pay/routes.js';
import { registerServiceRoutes } from './modules/service/routes.js';
import { registerPlatformRoutes } from './modules/platform/routes.js';
import { registerAuditRoutes } from './modules/audit/routes.js';
import { registerInsightRoutes } from './modules/insight/routes.js';
import { registerAssistantRoutes } from './modules/assistant/routes.js';
import { registerCommsRoutes } from './modules/comms/routes.js';

declare module 'fastify' { interface FastifyRequest { principal?: Principal | null } }

const PUBLIC_ERRORS = new Set([400, 401, 403, 404, 409, 410, 413, 415, 422, 429]);

export async function buildApp(cfg: Config, pools: Pools): Promise<{ app: FastifyInstance; svc: Services }> {
  const app = Fastify({
    logger: cfg.NODE_ENV === 'test' && process.env.MERIDIAN_TEST_LOG !== 'on' ? false : {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]', 'req.headers["x-device-key"]', 'res.headers["set-cookie"]'], censor: '[redacted]' },
    },
    trustProxy: cfg.TRUST_PROXY === 'true',
    bodyLimit: 256 * 1024,
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: cfg.NODE_ENV === 'test',
  });
  const kms = await createKms(cfg);
  const svc: Services = { cfg, pools, kms, objects: createObjectStore(cfg), app, routes: [] };

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: cfg.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cookie);
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/')) { reply.header('Cache-Control', 'no-store'); reply.header('Pragma', 'no-cache'); }
  });

  // --- Cross-site request forgery: reject browser mutations from other origins, and require our custom header on cookie-authenticated mutations.
  app.addHook('onRequest', async (req) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.url.startsWith('/api/')) return;
    const origin = req.headers.origin;
    if (origin) {
      let host: string;
      try { host = new URL(origin).host; } catch { throw new HttpError(403, 'bad_origin', 'Request origin not allowed'); }
      if (host !== req.headers.host) throw new HttpError(403, 'bad_origin', 'Request origin not allowed');
    }
  });

  // --- Authentication: API key, device key or session cookie.
  app.addHook('preHandler', async (req) => {
    req.principal = null;
    if (!req.url.startsWith('/api/')) return;
    const apiKey = req.headers['x-api-key'];
    const deviceKey = req.headers['x-device-key'];
    if (typeof apiKey === 'string') { req.principal = await principalFromApiKey(pools, apiKey); return; }
    if (typeof deviceKey === 'string') { req.principal = await principalFromDeviceKey(pools, deviceKey); return; }
    const token = req.cookies[SESSION_COOKIE];
    req.principal = await principalFromSession(pools, token, cfg.SESSION_IDLE_MINUTES);
    // Cookie-authenticated mutations must carry our custom header. Browsers will not add it cross-site without a CORS preflight, which we never grant.
    if (req.principal && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-meridian-client'] !== 'web') {
      throw new HttpError(403, 'csrf', 'Missing client header');
    }
  });
  // Run after authentication so API keys get an isolated, creation-time budget. The plugin's
  // built-in store remains in use; another workstream can replace it with Redis without changing this contract.
  await app.register(rateLimit, {
    global: true, hook: 'preHandler', allowList: [],
    max: async (req) => (req.principal?.kind === 'apikey' ? req.principal.rateLimitMax ?? 600 : 600),
    timeWindow: async (req) => (req.principal?.kind === 'apikey' ? (req.principal.rateLimitWindowSeconds ?? 60) * 1000 : 60_000),
    keyGenerator: (req) => req.principal?.kind === 'apikey' ? `apikey:${req.principal.credentialId}` : req.ip,
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
    const requestId = req.id;
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details, request_id: requestId } });
    }
    const pg = mapPgError(err);
    if (pg) return reply.code(pg.status).send({ error: { code: pg.code, message: pg.message, request_id: requestId } });
    if (err.validation || err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || err.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Invalid request', request_id: requestId } });
    }
    const sc = err.statusCode ?? 500;
    if (sc === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.', request_id: requestId } });
    if (sc === 413) return reply.code(413).send({ error: { code: 'too_large', message: 'Request is too large', request_id: requestId } });
    if (PUBLIC_ERRORS.has(sc) && sc < 500) return reply.code(sc).send({ error: { code: 'error', message: 'Request failed', request_id: requestId } });
    req.log.error({ err: { message: err.message, code: err.code, stack: err.stack } }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong. Quote this reference if you contact support.', request_id: requestId } });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found', request_id: req.id } });
    // Single page app fallback.
    const dist = cfg.WEB_DIST;
    if (dist && existsSync(dist) && req.method === 'GET' && !req.url.includes('.')) return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    return reply.code(404).send({ error: { code: 'not_found', message: 'Not found', request_id: req.id } });
  });

  app.get('/api/v1/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/api/v1/health/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    try { await pools.app.query('select 1'); return { status: 'ready' }; } catch { return reply.code(503).send({ status: 'unavailable' }); }
  });

  registerAuthRoutes(svc);
  registerCommsRoutes(svc);
  registerPeopleRoutes(svc);
  registerTimeRoutes(svc);
  registerFlowRoutes(svc);
  registerPayRoutes(svc);
  registerServiceRoutes(svc);
  registerPlatformRoutes(svc);
  registerAuditRoutes(svc);
  registerInsightRoutes(svc);
  registerAssistantRoutes(svc);

  app.get('/api/v1/openapi.json', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async () => openApiDocument(svc.routes));

  if (cfg.WEB_DIST && existsSync(cfg.WEB_DIST)) {
    await app.register(fastifyStatic, { root: cfg.WEB_DIST, wildcard: false, maxAge: '1h', setHeaders: (reply, path) => { if (path.endsWith('index.html')) reply.header('Cache-Control', 'no-cache'); } });
  }
  return { app, svc };
}

function mapPgError(err: Error & { code?: string }): { status: number; code: string; message: string } | null {
  const c = err.code;
  if (!c || !/^[0-9A-Z]{5}$/.test(c)) return null;
  const m = err.message ?? '';
  if (c === '42501') {
    if (/row-level security|permission denied/.test(m)) return { status: 403, code: 'forbidden', message: 'You do not have access to this' };
    return { status: 403, code: 'forbidden', message: m.slice(0, 200) };
  }
  if (c === '23505') return { status: 409, code: 'conflict', message: 'That already exists or conflicts with an existing record' };
  if (c === '23P01') return { status: 409, code: 'conflict', message: 'That overlaps an existing record' };
  if (c === '23503') return { status: 409, code: 'conflict', message: 'A related record does not exist or is still in use' };
  if (c === '23514') return /^new row for relation|violates check constraint/.test(m) ? { status: 422, code: 'invalid', message: 'A value is not allowed' } : { status: 422, code: 'rule_violation', message: m.slice(0, 200) };
  if (c === '23502') return { status: 400, code: 'bad_request', message: 'A required value is missing' };
  if (['22P02', '22007', '22008', '22003', '22001', '22023'].includes(c)) return { status: 400, code: 'bad_request', message: 'A value has the wrong format' };
  if (c === 'P0001') return { status: 422, code: 'rule_violation', message: m.slice(0, 200) };
  return null;
}

async function principalFromApiKey(pools: Pools, key: string): Promise<Principal | null> {
  const m = /^mk_([a-z0-9]{8})_([A-Za-z0-9_-]{32,64})$/.exec(key);
  if (!m) return null;
  const r = await pools.auth.query(
    `select k.id, k.tenant_id, k.key_hash, k.scopes, k.expires_at, k.revoked_at, k.created_by, k.allow_write, k.rate_limit_max, k.rate_limit_window_seconds,
            u.email::text as email, u.display_name, u.disabled, m.employee_id, m.status as mstatus,
            coalesce((select array_agg(ra.role) from kernel.role_assignment ra where ra.user_id = k.created_by and ra.tenant_id = k.tenant_id and ra.revoked_at is null), '{}') as roles
       from plat.api_key k join kernel.user_account u on u.id = k.created_by
       left join kernel.membership m on m.user_id = k.created_by and m.tenant_id = k.tenant_id
      where k.prefix = $1`, [m[1]]);
  const k = r.rows[0];
  if (!k) return null;
  const given = sha256(key), have = k.key_hash as Buffer;
  if (given.length !== have.length || !timingSafeEqual(given, have)) return null;
  if (k.revoked_at || new Date(k.expires_at).getTime() < Date.now() || k.disabled || k.mstatus !== 'active') return null;
  pools.auth.query('update plat.api_key set last_used_at = now() where id = $1', [k.id]).catch(() => undefined);
  const owned = permsFor(k.roles);
  const perms = new Set<Perm>((k.scopes as Perm[]).filter((s) => owned.has(s)));
  return { kind: 'apikey', userId: k.created_by, tenantId: k.tenant_id, employeeId: k.employee_id ?? null, sessionId: null, email: k.email, displayName: k.display_name,
    roles: k.roles, perms, mfa: false, totpEnabled: false, stepUpAt: null, mustChangePassword: false, credentialId: k.id,
    allowWrite: k.allow_write, rateLimitMax: k.rate_limit_max, rateLimitWindowSeconds: k.rate_limit_window_seconds };
}

async function principalFromDeviceKey(pools: Pools, key: string): Promise<Principal | null> {
  const m = /^md_([a-z0-9]{8})_([A-Za-z0-9_-]{32,64})$/.exec(key);
  if (!m) return null;
  const r = await pools.auth.query('select id, tenant_id, key_hash, revoked_at from tm.device where key_prefix = $1', [m[1]]);
  const d = r.rows[0];
  if (!d || d.revoked_at) return null;
  const given = sha256(key), have = d.key_hash as Buffer;
  if (given.length !== have.length || !timingSafeEqual(given, have)) return null;
  pools.auth.query('update tm.device set last_seen_at = now() where id = $1', [d.id]).catch(() => undefined);
  return { kind: 'device', userId: null, tenantId: d.tenant_id, employeeId: null, sessionId: null, email: '', displayName: 'device', roles: [], perms: new Set<Perm>(),
    mfa: false, totpEnabled: false, stepUpAt: null, mustChangePassword: false, credentialId: d.id, deviceId: d.id };
}

export type { FastifyRequest };
