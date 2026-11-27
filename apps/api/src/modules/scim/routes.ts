import { randomBytes } from 'node:crypto';
import { z, type ZodTypeAny } from 'zod';
import { defineRoute, type RouteDef, type Services } from '../../http/route.js';
import { newToken, sha256 } from '../../crypto/tokens.js';
import { hashPassword } from '../../crypto/password.js';
import { badRequest, conflict, notFound } from '../../errors.js';

const SCIM = 'urn:ietf:params:scim:api:messages:2.0';
const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_OP = `${SCIM}:PatchOp`;
const userSchema = z.object({
  userName: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().default(true),
  emails: z.array(z.object({ value: z.string().email(), primary: z.boolean().optional() }).strict()).max(5).optional(),
}).strict();
const patchSchema = z.object({
  schemas: z.array(z.string()).max(5).optional(),
  Operations: z.array(z.object({ op: z.string().trim().toLowerCase().pipe(z.enum(['add', 'replace', 'remove'])), path: z.string().max(200).optional(), value: z.unknown().optional() }).strict()).max(20),
}).strict();
const tokenSchema = z.object({ label: z.string().trim().min(1).max(100), expiresInDays: z.number().int().min(1).max(730).default(365) }).strict();
const listQuery = z.object({ filter: z.string().max(300).optional(), startIndex: z.coerce.number().int().min(1).default(1), count: z.coerce.number().int().min(1).max(200).default(100) }).strict();
const groupPatchSchema = z.object({
  schemas: z.array(z.string()).max(5).optional(),
  Operations: z.array(z.object({ op: z.string().trim().toLowerCase().pipe(z.enum(['add', 'replace', 'remove'])), path: z.string().max(200).optional(), value: z.unknown().optional() }).strict()).max(20),
}).strict();

type UserInput = z.infer<typeof userSchema>;
type PatchInput = z.infer<typeof patchSchema>;
type GroupPatchInput = z.infer<typeof groupPatchSchema>;
type ScimUserRow = { id: string; email: string; display_name: string; status: string; created_at: string };

function scimUser(row: ScimUserRow): Record<string, unknown> {
  return {
    schemas: [CORE_USER],
    id: row.id,
    userName: row.email,
    displayName: row.display_name,
    active: row.status === 'active',
    meta: { resourceType: 'User', created: row.created_at, lastModified: row.created_at, location: `/api/v1/scim/v2/Users/${row.id}` },
  };
}

function parsePatch(ops: PatchInput['Operations']): { active?: boolean; displayName?: string } {
  const out: { active?: boolean; displayName?: string } = {};
  for (const op of ops) {
    const path = (op.path ?? '').toLowerCase();
    const value = op.value;
    if (path === 'active' || (!path && typeof value === 'object' && value !== null && 'active' in value)) {
      const v = typeof value === 'boolean' ? value : (value as { active?: unknown }).active;
      if (typeof v !== 'boolean') throw badRequest('active must be a boolean');
      out.active = v;
    } else if (path === 'displayname' || (!path && typeof value === 'object' && value !== null && 'displayName' in value)) {
      const v = typeof value === 'string' ? value : (value as { displayName?: unknown }).displayName;
      if (typeof v !== 'string' || !v.trim()) throw badRequest('displayName must be a string');
      out.displayName = v.trim();
    } else {
      throw badRequest('Only active and displayName PATCH operations are supported');
    }
  }
  if (out.active === undefined && out.displayName === undefined) throw badRequest('No supported SCIM changes were supplied');
  return out;
}

/**
 * Deactivation is tenant-scoped: a user may still belong to another active tenant.
 * Identity data, sessions and integration credentials therefore use the auth pool,
 * while the membership status is changed by the tenant transaction.
 */
async function revokeTenantAccess(svc: Services, userId: string, tenantId: string): Promise<void> {
  await svc.pools.auth.query('update kernel.session set revoked_at = now() where user_id = $1 and (tenant_id = $2 or tenant_id is null) and revoked_at is null', [userId, tenantId]);
  await svc.pools.auth.query('update plat.api_key set revoked_at = now() where created_by = $1 and tenant_id = $2 and revoked_at is null', [userId, tenantId]);
}

async function mappedGroupUsers(db: { query: <T = unknown>(text: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }> }, tenantId: string, groupId: string): Promise<{ role: string; userIds: string[] }> {
  const group = await db.query<{ role: string }>('select role from kernel.sso_group_role where tenant_id = $1 and id = $2', [tenantId, groupId]);
  if (!group.rowCount) throw notFound('SCIM group not found');
  const users = await db.query<{ user_id: string }>('select user_id from kernel.role_assignment where tenant_id = $1 and role = $2 and revoked_at is null', [tenantId, group.rows[0]!.role]);
  return { role: group.rows[0]!.role, userIds: users.rows.map((x) => x.user_id) };
}

export function registerScimRoutes(svc: Services): void {
  const scim = <B extends ZodTypeAny = ZodTypeAny, Q extends ZodTypeAny = ZodTypeAny>(def: Omit<RouteDef<B, Q>, 'auth'>): void => defineRoute(svc, { ...def, auth: 'scim' });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/iam/scim-tokens', summary: 'Create a SCIM bearer token', tag: 'Access', auth: 'session', perm: 'settings.manage', stepUp: true, actors: ['iam'], body: tokenSchema,
    handler: async ({ p, db, body, audit }) => {
      const token = `scim_${randomBytes(32).toString('base64url')}`;
      const prefix = token.slice(0, 14);
      await db.query('insert into kernel.scim_token (tenant_id, token_hash, token_prefix, label, expires_at, created_by) values ($1,$2,$3,$4,$5,$6)', [p.tenantId, sha256(token), prefix, body.label, new Date(Date.now() + body.expiresInDays * 86_400_000), p.userId]);
      await audit('iam.scim_token_created', 'scim_token', prefix, { label: body.label });
      return { status: 201, body: { token, prefix, note: 'Shown once. Store it in the identity provider now.' } };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/iam/scim-tokens', summary: 'List SCIM bearer tokens', tag: 'Access', auth: 'session', perm: 'settings.manage',
    handler: async ({ db }) => ({ tokens: (await db.query('select id, token_prefix, label, scopes, expires_at, revoked_at, created_at, last_used_at from kernel.scim_token order by created_at desc')).rows }),
  });
  defineRoute(svc, {
    method: 'DELETE', path: '/api/v1/iam/scim-tokens/:id', summary: 'Revoke a SCIM bearer token', tag: 'Access', auth: 'session', perm: 'settings.manage', stepUp: true, actors: ['iam'],
    handler: async ({ p, db, params, audit }) => {
      const r = await db.query('update kernel.scim_token set revoked_at = now() where tenant_id = $1 and id = $2 returning id', [p.tenantId, params.id!]);
      if (!r.rowCount) throw notFound('SCIM token not found');
      await audit('iam.scim_token_revoked', 'scim_token', params.id!, {});
      return { ok: true };
    },
  });

  scim({ method: 'GET', path: '/api/v1/scim/v2/ServiceProviderConfig', summary: 'SCIM service provider capabilities', tag: 'SCIM', handler: async () => ({ schemas: [`${SCIM}:ServiceProviderConfig`], patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 200 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer', description: 'Tenant-scoped SCIM bearer token' }] }) });
  scim({ method: 'GET', path: '/api/v1/scim/v2/Schemas', summary: 'SCIM supported schemas', tag: 'SCIM', handler: async () => ({ schemas: [CORE_USER, PATCH_OP] }) });
  scim({ method: 'GET', path: '/api/v1/scim/v2/ResourceTypes', summary: 'SCIM resource types', tag: 'SCIM', handler: async () => ({ schemas: [`${SCIM}:ResourceType`], Resources: [{ id: 'User', name: 'User', endpoint: '/Users', schema: CORE_USER }, { id: 'Group', name: 'Group', endpoint: '/Groups', schema: `${SCIM}:Group` }] }) });

  // The app role can read membership rows but deliberately cannot join user_account.
  scim({
    method: 'GET', path: '/api/v1/scim/v2/Users', summary: 'List SCIM users', tag: 'SCIM', query: listQuery,
    handler: async ({ p, db, query }) => {
      const m = query.filter ? /^userName\s+eq\s+"([^"]+)"$/i.exec(query.filter) : null;
      if (query.filter && !m) throw badRequest('Only userName eq filters are supported');
      const email = m?.[1]?.toLowerCase() ?? null;
      const r = await db.query<ScimUserRow>('select user_id as id, email::text as email, display_name, status, created_at from kernel.membership where tenant_id = $1 and ($2::text is null or email = $2) order by created_at offset $3 limit $4', [p.tenantId, email, query.startIndex - 1, query.count]);
      return { schemas: [`${SCIM}:ListResponse`], totalResults: r.rowCount, startIndex: query.startIndex, itemsPerPage: r.rowCount, Resources: r.rows.map(scimUser) };
    },
  });
  scim({
    method: 'GET', path: '/api/v1/scim/v2/Users/:id', summary: 'Get a SCIM user', tag: 'SCIM',
    handler: async ({ p, db, params }) => {
      const r = await db.query<ScimUserRow>('select user_id as id, email::text as email, display_name, status, created_at from kernel.membership where tenant_id = $1 and user_id = $2', [p.tenantId, params.id!]);
      if (!r.rowCount) throw notFound('SCIM user not found');
      return scimUser(r.rows[0]!);
    },
  });
  scim({
    method: 'POST', path: '/api/v1/scim/v2/Users', summary: 'Provision a SCIM user', tag: 'SCIM', body: userSchema, idempotent: 'optional', actors: ['iam'],
    handler: async ({ p, db, body, audit }) => {
      const input = body as UserInput;
      const existingMembership = await svc.pools.auth.query('select 1 from kernel.membership where tenant_id = $1 and email = $2', [p.tenantId, input.userName]);
      if (existingMembership.rowCount) throw conflict('That SCIM user already exists');
      const identity = await svc.pools.auth.query<{ id: string }>('select id from kernel.user_account where email = $1', [input.userName]);
      const identityId = identity.rows[0]?.id ?? (await svc.pools.auth.query<{ id: string }>('insert into kernel.user_account (email, password_hash, display_name) values ($1,$2,$3) returning id', [input.userName, await hashPassword(newToken(24)), input.displayName ?? input.userName])).rows[0]!.id;
      const status = input.active ? 'active' : 'suspended';
      await db.query('insert into kernel.membership (tenant_id, user_id, email, display_name, status) values ($1,$2,$3,$4,$5)', [p.tenantId, identityId, input.userName, input.displayName ?? input.userName, status]);
      if (status !== 'active') await revokeTenantAccess(svc, identityId, p.tenantId!);
      await audit('scim.user_created', 'user', identityId, { userName: input.userName, active: input.active });
      return { status: 201, body: scimUser({ id: identityId, email: input.userName, display_name: input.displayName ?? input.userName, status, created_at: new Date().toISOString() }) };
    },
  });
  scim({
    method: 'PUT', path: '/api/v1/scim/v2/Users/:id', summary: 'Replace a SCIM user', tag: 'SCIM', body: userSchema, actors: ['iam'],
    handler: async ({ p, db, params, body, audit }) => {
      const input = body as UserInput;
      const existing = await db.query<{ id: string }>('select user_id as id from kernel.membership where tenant_id = $1 and user_id = $2', [p.tenantId, params.id!]);
      if (!existing.rowCount) throw notFound('SCIM user not found');
      await svc.pools.auth.query('update kernel.user_account set email = $2, display_name = $3 where id = $1', [params.id!, input.userName, input.displayName ?? input.userName]);
      const status = input.active ? 'active' : 'suspended';
      const r = await db.query<ScimUserRow>('update kernel.membership set email = $3, display_name = $4, status = $5 where tenant_id = $1 and user_id = $2 returning user_id as id, email::text as email, display_name, status, created_at', [p.tenantId, params.id!, input.userName, input.displayName ?? input.userName, status]);
      if (status !== 'active') await revokeTenantAccess(svc, params.id!, p.tenantId!);
      await audit('scim.user_replaced', 'user', params.id!, { active: input.active });
      return scimUser(r.rows[0]!);
    },
  });
  scim({
    method: 'PATCH', path: '/api/v1/scim/v2/Users/:id', summary: 'Patch a SCIM user', tag: 'SCIM', body: patchSchema, actors: ['iam'],
    handler: async ({ p, db, params, body, audit }) => {
      const change = parsePatch((body as PatchInput).Operations);
      const existing = await db.query<{ id: string }>('select user_id as id from kernel.membership where tenant_id = $1 and user_id = $2', [p.tenantId, params.id!]);
      if (!existing.rowCount) throw notFound('SCIM user not found');
      if (change.displayName !== undefined) await svc.pools.auth.query('update kernel.user_account set display_name = $2 where id = $1', [params.id!, change.displayName]);
      const r = await db.query<ScimUserRow>('update kernel.membership set status = coalesce($3, status), display_name = coalesce($4, display_name) where tenant_id = $1 and user_id = $2 returning user_id as id, email::text as email, display_name, status, created_at', [p.tenantId, params.id!, change.active === undefined ? null : (change.active ? 'active' : 'suspended'), change.displayName ?? null]);
      if (change.active === false) await revokeTenantAccess(svc, params.id!, p.tenantId!);
      await audit('scim.user_patched', 'user', params.id!, change);
      return scimUser(r.rows[0]!);
    },
  });
  scim({
    method: 'DELETE', path: '/api/v1/scim/v2/Users/:id', summary: 'Deactivate a SCIM user', tag: 'SCIM', actors: ['iam'],
    handler: async ({ p, db, params, audit }) => {
      const r = await db.query<{ user_id: string }>('update kernel.membership set status = \'suspended\' where tenant_id = $1 and user_id = $2 returning user_id', [p.tenantId, params.id!]);
      if (!r.rowCount) throw notFound('SCIM user not found');
      await revokeTenantAccess(svc, r.rows[0]!.user_id, p.tenantId!);
      await audit('scim.user_deactivated', 'user', r.rows[0]!.user_id, {});
      return { status: 204, body: undefined };
    },
  });

  scim({
    method: 'GET', path: '/api/v1/scim/v2/Groups', summary: 'List mapped SCIM groups', tag: 'SCIM',
    handler: async ({ p, db }) => {
      const r = await db.query('select id, group_name as display, role from kernel.sso_group_role where tenant_id = $1 order by group_name', [p.tenantId]);
      return { schemas: [`${SCIM}:ListResponse`], Resources: r.rows, totalResults: r.rowCount, startIndex: 1, itemsPerPage: r.rowCount };
    },
  });
  scim({
    method: 'GET', path: '/api/v1/scim/v2/Groups/:id', summary: 'Get a mapped SCIM group', tag: 'SCIM',
    handler: async ({ p, db, params }) => {
      const group = await db.query<{ id: string; display: string; role: string }>('select id, group_name as display, role from kernel.sso_group_role where tenant_id = $1 and id = $2', [p.tenantId, params.id!]);
      if (!group.rowCount) throw notFound('SCIM group not found');
      const members = await db.query<{ user_id: string }>('select distinct user_id from kernel.role_assignment where tenant_id = $1 and role = $2 and revoked_at is null', [p.tenantId, group.rows[0]!.role]);
      return { schemas: [`${SCIM}:Group`], ...group.rows[0], members: members.rows.map((x) => ({ value: x.user_id })) };
    },
  });
  scim({
    method: 'PATCH', path: '/api/v1/scim/v2/Groups/:id', summary: 'Patch mapped SCIM group membership', tag: 'SCIM', body: groupPatchSchema, actors: ['iam'],
    handler: async ({ p, db, params, body, audit }) => {
      const group = await mappedGroupUsers(db, p.tenantId!, params.id!);
      for (const op of (body as GroupPatchInput).Operations) {
        const path = (op.path ?? '').toLowerCase();
        if (path !== 'members' && path !== '') throw badRequest('Only group members PATCH operations are supported');
        const raw = op.value;
        const values = Array.isArray(raw) ? raw : (typeof raw === 'object' && raw !== null && 'members' in raw ? (raw as { members?: unknown }).members : undefined);
        if (!Array.isArray(values)) throw badRequest('members must be an array');
        for (const value of values) {
          if (typeof value !== 'object' || value === null || typeof (value as { value?: unknown }).value !== 'string') throw badRequest('Each group member needs a user id');
          const userId = (value as { value: string }).value;
          const member = await db.query('select 1 from kernel.membership where tenant_id = $1 and user_id = $2', [p.tenantId, userId]);
          if (!member.rowCount) throw notFound('SCIM group member not found');
          if (op.op === 'remove') {
            await db.query('update kernel.role_assignment set revoked_at = now() where tenant_id = $1 and user_id = $2 and role = $3 and revoked_at is null', [p.tenantId, userId, group.role]);
          } else {
            const assignment = await db.query<{ id: string }>('insert into kernel.role_assignment (tenant_id, user_id, role, granted_by) values ($1,$2,$3,null) returning id', [p.tenantId, userId, group.role]);
            await db.query('insert into kernel.role_assignment_scope (tenant_id, assignment_id, scope_type) values ($1,$2,\'tenant\')', [p.tenantId, assignment.rows[0]!.id]);
          }
        }
      }
      await audit('scim.group_membership_changed', 'scim_group', params.id!, { role: group.role });
      return { ok: true };
    },
  });
}
