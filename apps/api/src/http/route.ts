import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeAny } from 'zod';
import { ZodError, z } from 'zod';
import type { Config } from '../config.js';
import type { Pools } from '../db/pool.js';
import type { Kms } from '../crypto/kms.js';
import type { ObjectStore } from '../storage/objectStore.js';
import { audit, emit, withTx, type Ctx, type Db, type SystemActor } from '../db/tx.js';
import { HttpError, badRequest, forbidden, unauthorized } from '../errors.js';
import { sha256hex } from '../crypto/tokens.js';
import type { Perm } from './perms.js';
import type { Principal } from './principal.js';

export interface Services { cfg: Config; pools: Pools; kms: Kms; objects: ObjectStore; app: FastifyInstance; routes: RouteMeta[] }

export interface RouteMeta {
  method: string; path: string; summary: string; tag: string; auth: AuthKind; perm?: Perm; stepUp: boolean;
  body?: ZodTypeAny; query?: ZodTypeAny; idempotent?: 'required' | 'optional'; readOnlyKey: boolean;
}
export type AuthKind = 'public' | 'user' | 'session' | 'device' | 'any';

export interface HandlerArgs<B, Q> {
  p: Principal; ctx: Ctx; db: Db; body: B; query: Q; params: Record<string, string>; req: FastifyRequest; reply: FastifyReply;
  audit: (action: string, entity: string | null, entityId: string | null, data?: Record<string, unknown>) => Promise<void>;
  emit: (topic: string, payload: Record<string, unknown>, dedupeKey?: string) => Promise<void>;
}
export interface Reply { status?: number; body: unknown; headers?: Record<string, string> }

export interface RouteDef<B extends ZodTypeAny, Q extends ZodTypeAny> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  tag: string;
  /** public: no login. user: signed in, tenant optional. session: signed in with a tenant. device: device key. any: session or API key. */
  auth: AuthKind;
  perm?: Perm;
  stepUp?: boolean;
  requireMfa?: boolean;
  body?: B;
  query?: Q;
  idempotent?: 'required' | 'optional';
  /** System actors to set for the transaction (see migrations). Set only after the permission check above. */
  actors?: SystemActor[];
  rateLimit?: { max: number; timeWindow: string };
  bodyLimit?: number;
  /** Set false for handlers that manage their own database access (login and similar). */
  tx?: boolean;
  handler: (a: HandlerArgs<z.infer<B>, z.infer<Q>>) => Promise<Reply | unknown>;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const isReply = (x: unknown): x is Reply => typeof x === 'object' && x !== null && 'body' in x && Object.keys(x).every((k) => ['status', 'body', 'headers'].includes(k));

export function defineRoute<B extends ZodTypeAny = ZodTypeAny, Q extends ZodTypeAny = ZodTypeAny>(svc: Services, def: RouteDef<B, Q>): void {
  svc.routes.push({
    method: def.method, path: def.path, summary: def.summary, tag: def.tag, auth: def.auth, perm: def.perm, stepUp: !!def.stepUp,
    body: def.body, query: def.query, idempotent: def.idempotent, readOnlyKey: def.method === 'GET',
  });

  svc.app.route({
    method: def.method, url: def.path, bodyLimit: def.bodyLimit,
    // Tests would otherwise trip the per-route limits that exist to stop password guessing. A test sets MERIDIAN_TEST_RATELIMIT=on to exercise them.
    config: def.rateLimit ? { rateLimit: svc.cfg.NODE_ENV === 'test' && process.env.MERIDIAN_TEST_RATELIMIT !== 'on' ? { ...def.rateLimit, max: def.rateLimit.max * 1000 } : def.rateLimit } : undefined,
    handler: async (req, reply) => {
      const p = (req as FastifyRequest & { principal?: Principal | null }).principal ?? null;

      // 1. Authentication
      if (def.auth !== 'public') {
        if (!p) throw unauthorized();
        if (def.auth === 'session' && p.kind !== 'user') throw forbidden('This action needs a signed-in user');
        if (def.auth === 'device' && p.kind !== 'device') throw unauthorized();
        if (def.auth === 'any' && p.kind === 'device') throw forbidden();
        if ((def.auth === 'session' || def.auth === 'any') && !p.tenantId) throw new HttpError(409, 'tenant_required', 'Choose a company first');
        if (p.kind === 'apikey' && def.method !== 'GET') throw forbidden('API keys are read-only');
        if (p.mustChangePassword && !def.path.startsWith('/api/v1/auth/')) throw new HttpError(403, 'password_change_required', 'Change your password to continue');
        if (p.kind === 'user' && p.tenantId && !p.totpEnabled && !['/api/v1/auth/me', '/api/v1/auth/logout', '/api/v1/auth/step-up'].includes(def.path) && !def.path.startsWith('/api/v1/auth/mfa/')) {
          const policy = await svc.pools.auth.query<{ required_roles: string[] }>('select required_roles from kernel.tenant_mfa_policy where tenant_id = $1', [p.tenantId]);
          const required = policy.rows[0]?.required_roles ?? [];
          if (required.some((role) => p.roles.includes(role))) throw new HttpError(403, 'mfa_enrollment_required', 'Enrol two-step verification before using this company');
        }
      }
      // 2. Authorisation
      if (def.perm && (!p || !p.perms.has(def.perm))) throw forbidden();
      if (def.requireMfa && !(p?.totpEnabled && p.mfa)) throw new HttpError(403, 'mfa_required', 'Turn on two-step verification to do this');
      if (def.stepUp) {
        const fresh = p?.stepUpAt && Date.now() - p.stepUpAt.getTime() < 10 * 60_000;
        if (!fresh) throw new HttpError(401, 'step_up_required', 'Confirm your identity to continue');
      }
      // 3. Validation
      let body: unknown = undefined;
      let query: unknown = undefined;
      try {
        if (def.body) body = def.body.parse(req.body ?? {});
        if (def.query) query = def.query.parse(req.query ?? {});
      } catch (e) {
        if (e instanceof ZodError) throw badRequest('Invalid request', e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
        throw e;
      }
      const params = (req.params ?? {}) as Record<string, string>;
      for (const v of Object.values(params)) if (typeof v !== 'string' || v.length > 128) throw badRequest('Invalid path parameter');

      const ctx: Ctx = { tenantId: p?.tenantId ?? '', userId: p?.userId ?? null, employeeId: p?.employeeId ?? null, requestId: req.id, ip: req.ip };
      const finish = (out: unknown): { status: number; body: unknown; headers?: Record<string, string> } =>
        isReply(out) ? { status: out.status ?? 200, body: out.body, headers: out.headers } : { status: 200, body: out };

      let result: { status: number; body: unknown; headers?: Record<string, string> };
      if (def.tx === false || !p?.tenantId) {
        result = finish(await def.handler({ p: p as Principal, ctx, db: undefined as unknown as Db, body: body as never, query: query as never, params, req, reply,
          audit: async () => undefined, emit: async () => undefined }));
      } else {
        const idemKey = req.headers['idempotency-key'];
        if (def.idempotent === 'required' && typeof idemKey !== 'string') throw badRequest('Idempotency-Key header is required');
        if (typeof idemKey === 'string' && (idemKey.length < 8 || idemKey.length > 128)) throw badRequest('Idempotency-Key must be 8 to 128 characters');
        const useIdem = !!def.idempotent && typeof idemKey === 'string' && MUTATING.has(def.method);
        result = await withTx(svc.pools.app, ctx, async (db) => {
          let scope = '', reqHash = '';
          if (useIdem) {
            scope = `${def.method} ${def.path}:${p.userId ?? p.credentialId}`;
            reqHash = sha256hex(JSON.stringify({ params, body }));
            const ins = await db.query('insert into kernel.idempotency (tenant_id, scope, key, request_hash) values ($1, $2, $3, $4) on conflict do nothing returning 1', [ctx.tenantId, scope, idemKey, reqHash]);
            if (!ins.rowCount) {
              const prev = await db.query('select request_hash, status_code, response from kernel.idempotency where tenant_id = $1 and scope = $2 and key = $3', [ctx.tenantId, scope, idemKey]);
              const row = prev.rows[0];
              if (row.request_hash !== reqHash) throw new HttpError(422, 'idempotency_key_reuse', 'This Idempotency-Key was used with a different request');
              return { status: row.status_code ?? 200, body: row.response, headers: { 'idempotent-replay': 'true' } };
            }
          }
          const out = finish(await def.handler({
            p, ctx, db, body: body as never, query: query as never, params, req, reply,
            audit: (a, e, id, d) => audit(db, ctx, a, e, id, d),
            emit: (t, pl, k) => emit(db, ctx, t, pl, k),
          }));
          if (useIdem) await db.query('update kernel.idempotency set status_code = $4, response = $5::jsonb where tenant_id = $1 and scope = $2 and key = $3', [ctx.tenantId, scope, idemKey, out.status, JSON.stringify(out.body ?? null)]);
          return out;
        }, def.actors ?? [], undefined);
      }
      for (const [k, v] of Object.entries(result.headers ?? {})) reply.header(k, v);
      reply.code(result.status);
      return result.body === undefined ? reply.send() : reply.send(result.body);
    },
  });
}

function toSchema(schema: ZodTypeAny): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any', reused: 'inline' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export function openApiDocument(routes: RouteMeta[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const p = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const params = [...r.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const op: Record<string, unknown> = {
      summary: r.summary, tags: [r.tag], parameters: params,
      security: r.auth === 'public' ? [] : r.auth === 'device' ? [{ deviceKey: [] }] : r.auth === 'any' ? [{ cookieAuth: [] }, { apiKey: [] }] : [{ cookieAuth: [] }],
      'x-required-permission': r.perm ?? null, 'x-step-up': r.stepUp, 'x-idempotency': r.idempotent ?? null,
      responses: { '200': { description: 'OK' }, '400': { description: 'Invalid request' }, '401': { description: 'Not signed in' }, '403': { description: 'Not allowed' } },
    };
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: toSchema(r.body) } } };
    if (r.query) {
      const js = toSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] };
      (op.parameters as unknown[]).push(...Object.entries(js.properties ?? {}).map(([name, schema]) => ({ name, in: 'query', required: js.required?.includes(name) ?? false, schema })));
    }
    (paths[p] ??= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.0.3',
    info: { title: 'Meridian API', version: '0.1.0', description: 'People and payroll platform. All data endpoints are tenant-scoped; see docs/SECURITY.md.' },
    servers: [{ url: '/' }], paths,
    components: { securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'mer_sid' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      deviceKey: { type: 'apiKey', in: 'header', name: 'X-Device-Key' },
    } },
  };
}
