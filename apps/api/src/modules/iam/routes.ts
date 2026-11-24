import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { defineRoute, type Services } from '../../http/route.js';
import { SESSION_COOKIE } from '../../http/principal.js';
import { ROLES } from '../../http/perms.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { hashPassword, passwordProblem } from '../../crypto/password.js';
import { registerTenant } from './registration.js';
import * as auth from './auth.js';
import { audit, withTx } from '../../db/tx.js';

const email = z.string().trim().toLowerCase().email().max(254);
const roleName = z.enum(ROLES);
const uuid = z.string().uuid();

function setSessionCookie(svc: Services, req: FastifyRequest, reply: FastifyReply, token: string, expires: Date): void {
  const secure = svc.cfg.COOKIE_SECURE === 'true' || (svc.cfg.COOKIE_SECURE === 'auto' && (svc.cfg.NODE_ENV === 'production' || req.protocol === 'https'));
  const sameSite = svc.cfg.COOKIE_SAMESITE;
  if (sameSite === 'none' && !secure) throw new Error('SameSite=None needs a Secure cookie');
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite, path: '/', expires });
}

function uuidOrThrow(v: string | undefined): string {
  const r = uuid.safeParse(v);
  if (!r.success) throw new HttpError(400, 'bad_request', 'Invalid id');
  return r.data;
}

export function registerAuthRoutes(svc: Services): void {
  const { pools, kms, cfg } = svc;

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/register', summary: 'Create a company and its first owner', tag: 'Auth', auth: 'public', tx: false,
    rateLimit: { max: 10, timeWindow: '1 hour' },
    body: z.object({ companyName: z.string().trim().min(2).max(120), slug: z.string().trim().toLowerCase().min(2).max(41), country: z.string().length(2), currency: z.string().length(3),
      email, displayName: z.string().trim().min(2).max(100), password: z.string().min(1).max(200) }).strict(),
    handler: async ({ body, req, reply }) => {
      const r = await registerTenant(pools, body, { ip: req.ip, requestId: req.id });
      const l = await auth.login(pools, kms, cfg, { email: body.email, password: body.password }, req.ip, req.headers['user-agent']);
      setSessionCookie(svc, req, reply, l.token, l.expiresAt);
      return { status: 201, body: { tenantId: r.tenantId, userId: r.userId } };
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/login', summary: 'Sign in', tag: 'Auth', auth: 'public', tx: false, rateLimit: { max: 10, timeWindow: '1 minute' },
    body: z.object({ email, password: z.string().min(1).max(200), totp: z.string().regex(/^\d{6}$/).optional(), recoveryCode: z.string().max(20).optional() }).strict(),
    handler: async ({ body, req, reply }) => {
      const l = await auth.login(pools, kms, cfg, body, req.ip, req.headers['user-agent']);
      setSessionCookie(svc, req, reply, l.token, l.expiresAt);
      return { memberships: l.memberships, tenantId: l.tenantId, mustChangePassword: l.mustChangePassword };
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/logout', summary: 'Sign out', tag: 'Auth', auth: 'user', tx: false,
    handler: async ({ p, reply }) => { await auth.logout(pools, p.sessionId!); reply.clearCookie(SESSION_COOKIE, { path: '/' }); return { ok: true }; },
  });

  defineRoute(svc, {
    method: 'GET', path: '/api/v1/auth/me', summary: 'Current user, company and permissions', tag: 'Auth', auth: 'user', tx: false,
    handler: async ({ p }) => {
      const mem = await pools.auth.query(`select t.id, t.name, t.slug::text as slug from kernel.membership m join kernel.tenant t on t.id = m.tenant_id where m.user_id = $1 and m.status = 'active' and t.status = 'active' order by t.name`, [p.userId]);
      let tenant: unknown = null;
      if (p.tenantId) tenant = (await pools.auth.query('select id, name, slug::text as slug, country, currency from kernel.tenant where id = $1', [p.tenantId])).rows[0] ?? null;
      return {
        user: { id: p.userId, email: p.email, displayName: p.displayName, employeeId: p.employeeId, totpEnabled: p.totpEnabled, mfa: p.mfa, mustChangePassword: p.mustChangePassword,
          stepUpValid: !!p.stepUpAt && Date.now() - p.stepUpAt.getTime() < 10 * 60_000 },
        tenant, memberships: mem.rows, roles: p.roles, perms: [...p.perms].sort(),
      };
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/select-tenant', summary: 'Choose which company this session works in', tag: 'Auth', auth: 'user', tx: false,
    body: z.object({ tenantId: uuid }).strict(),
    handler: async ({ p, body }) => { await auth.selectTenant(pools, p.sessionId!, p.userId!, body.tenantId); return { ok: true }; },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/step-up', summary: 'Confirm identity for sensitive actions (valid 10 minutes)', tag: 'Auth', auth: 'user', tx: false, rateLimit: { max: 10, timeWindow: '1 minute' },
    body: z.object({ password: z.string().min(1).max(200), totp: z.string().regex(/^\d{6}$/).optional() }).strict(),
    handler: async ({ p, body }) => { await auth.stepUp(pools, kms, p.userId!, p.sessionId!, body); return { ok: true, validForMinutes: 10 }; },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/change-password', summary: 'Change password', tag: 'Auth', auth: 'user', tx: false, rateLimit: { max: 5, timeWindow: '1 minute' },
    body: z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).strict(),
    handler: async ({ p, body }) => { await auth.changePassword(pools, p.userId!, p.sessionId!, body.current, body.next, p.email); return { ok: true }; },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/mfa/begin', summary: 'Start two-step verification setup', tag: 'Auth', auth: 'user', tx: false, stepUp: true,
    handler: async ({ p }) => {
      if (p.totpEnabled) throw conflict('Two-step verification is already on', 'already_enabled');
      return auth.mfaBegin(pools, kms, p.userId!, p.email);
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/mfa/confirm', summary: 'Confirm setup with a code. Returns recovery codes once.', tag: 'Auth', auth: 'user', tx: false,
    body: z.object({ code: z.string().regex(/^\d{6}$/) }).strict(),
    handler: async ({ p, body }) => ({ recoveryCodes: await auth.mfaConfirm(pools, kms, p.userId!, p.sessionId!, body.code) }),
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/mfa/disable', summary: 'Turn off two-step verification', tag: 'Auth', auth: 'user', tx: false, stepUp: true,
    handler: async ({ p }) => {
      if (p.roles.some((r) => ['owner', 'payroll_admin', 'payroll_approver'].includes(r))) throw forbidden('Payroll and owner roles must keep two-step verification on');
      await auth.mfaDisable(pools, p.userId!); return { ok: true };
    },
  });

  defineRoute(svc, {
    method: 'GET', path: '/api/v1/auth/sessions', summary: 'Your active sessions', tag: 'Auth', auth: 'user', tx: false,
    handler: async ({ p }) => ({ sessions: (await auth.listSessions(pools, p.userId!)).map((s) => ({ ...s, current: s.id === p.sessionId })) }),
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/sessions/revoke-others', summary: 'Sign out everywhere else', tag: 'Auth', auth: 'user', tx: false,
    handler: async ({ p }) => { await pools.auth.query('update kernel.session set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null', [p.userId, p.sessionId]); return { ok: true }; },
  });

  // ---------------------------------------------------------------- members and roles
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/iam/members', summary: 'People with access to this company', tag: 'Access', auth: 'session', perm: 'roles.view',
    handler: async ({ db }) => {
      const r = await db.query(`
        select m.user_id, m.email::text as email, m.display_name, m.status, m.employee_id,
          coalesce((select jsonb_agg(jsonb_build_object('role', ra.role, 'scope', (select s.scope_type from kernel.role_assignment_scope s where s.assignment_id = ra.id limit 1)) order by ra.role)
                     from kernel.role_assignment ra where ra.user_id = m.user_id and ra.revoked_at is null), '[]') as roles
        from kernel.membership m order by m.display_name`);
      return { members: r.rows };
    },
  });

  const roleGrant = z.object({ role: roleName, scope: z.enum(['tenant', 'reports', 'org_unit']).default('tenant'), orgUnitId: uuid.optional() }).strict()
    .refine((g) => (g.scope === 'org_unit') === !!g.orgUnitId, 'orgUnitId is needed for org_unit scope, and only then');

  /** Who may hand out which role. Owner and payroll roles stay with owners so HR cannot grant themselves the ability to pay people. */
  const OWNER_ONLY = new Set(['owner', 'hr_admin', 'payroll_admin', 'payroll_approver']);
  function checkGrantable(actorRoles: string[], roles: Array<{ role: string }>): void {
    if (!actorRoles.includes('owner') && roles.some((r) => OWNER_ONLY.has(r.role))) throw forbidden('Only an owner can grant that role');
  }

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/iam/members', summary: 'Add a person with a one-time temporary password', tag: 'Access', auth: 'session', perm: 'roles.manage', stepUp: true, tx: false,
    body: z.object({ email, displayName: z.string().trim().min(2).max(100), employeeId: uuid.optional(), roles: z.array(roleGrant).max(7).default([]) }).strict(),
    handler: async ({ p, ctx, body }) => {
      checkGrantable(p.roles, body.roles);
      const temp = randomBytes(12).toString('base64url') + 'aZ';
      if (passwordProblem(temp)) throw new Error('generated password rejected');
      const exists = await pools.auth.query('select 1 from kernel.user_account where email = $1', [body.email]);
      if (exists.rowCount) throw conflict('That email cannot be added. Ask the person to use another address.', 'email_unavailable');
      const hash = await hashPassword(temp);
      const u = await pools.auth.query<{ id: string }>('insert into kernel.user_account (email, password_hash, display_name, must_change_password) values ($1, $2, $3, true) returning id', [body.email, hash, body.displayName]);
      const userId = u.rows[0]!.id;
      try {
        await withTx(pools.app, ctx, async (db) => {
          if (body.employeeId) {
            const e = await db.query('select 1 from people.employee where id = $1', [body.employeeId]);
            if (!e.rowCount) throw badRequest('Employee not found');
          }
          await db.query('insert into kernel.membership (tenant_id, user_id, employee_id, email, display_name) values ($1, $2, $3, $4, $5)', [ctx.tenantId, userId, body.employeeId ?? null, body.email, body.displayName]);
          for (const g of body.roles) {
            const ra = await db.query<{ id: string }>('insert into kernel.role_assignment (tenant_id, user_id, role, granted_by) values ($1, $2, $3, $4) returning id', [ctx.tenantId, userId, g.role, p.userId]);
            await db.query('insert into kernel.role_assignment_scope (tenant_id, assignment_id, scope_type, org_unit_id) values ($1, $2, $3, $4)', [ctx.tenantId, ra.rows[0]!.id, g.scope, g.orgUnitId ?? null]);
          }
          await audit(db, ctx, 'iam.member_added', 'user', userId, { email: body.email, roles: body.roles.map((r) => r.role) });
        }, ['iam']);
      } catch (e) {
        await pools.auth.query('delete from kernel.user_account where id = $1', [userId]).catch(() => undefined);
        throw e;
      }
      return { status: 201, body: { userId, temporaryPassword: temp, note: 'Shown once. The person must change it at first sign-in.' } };
    },
  });

  defineRoute(svc, {
    method: 'PUT', path: '/api/v1/iam/members/:userId/roles', summary: "Replace a member's roles", tag: 'Access', auth: 'session', perm: 'roles.manage', stepUp: true, actors: ['iam'], idempotent: 'optional',
    body: z.object({ roles: z.array(roleGrant).max(7) }).strict(),
    handler: async ({ p, db, ctx, params, body, audit: log }) => {
      const target = uuidOrThrow(params.userId);
      if (target === p.userId) throw forbidden('You cannot change your own roles');
      checkGrantable(p.roles, body.roles);
      const m = await db.query('select 1 from kernel.membership where user_id = $1', [target]);
      if (!m.rowCount) throw notFound('Member not found');
      const cur = await db.query<{ id: string; role: string }>('select id, role from kernel.role_assignment where user_id = $1 and revoked_at is null for update', [target]);
      const wanted = new Set<string>(body.roles.map((r) => r.role));
      const have = new Set(cur.rows.map((r) => r.role));
      const removing = cur.rows.filter((r) => !wanted.has(r.role));
      if (!p.roles.includes('owner') && removing.some((r) => OWNER_ONLY.has(r.role))) throw forbidden('Only an owner can remove that role');
      if (removing.some((r) => r.role === 'owner')) {
        const owners = await db.query(`select count(*)::int as n from kernel.role_assignment where role = 'owner' and revoked_at is null and user_id <> $1`, [target]);
        if (owners.rows[0].n < 1) throw conflict('A company must keep at least one owner', 'last_owner');
      }
      for (const r of removing) await db.query('update kernel.role_assignment set revoked_at = now() where id = $1', [r.id]);
      for (const g of body.roles.filter((x) => !have.has(x.role))) {
        const ra = await db.query<{ id: string }>('insert into kernel.role_assignment (tenant_id, user_id, role, granted_by) values ($1, $2, $3, $4) returning id', [ctx.tenantId, target, g.role, p.userId]);
        await db.query('insert into kernel.role_assignment_scope (tenant_id, assignment_id, scope_type, org_unit_id) values ($1, $2, $3, $4)', [ctx.tenantId, ra.rows[0]!.id, g.scope, g.orgUnitId ?? null]);
      }
      await log('iam.roles_changed', 'user', target, { from: [...have], to: [...wanted] });
      await pools.auth.query('update kernel.session set step_up_at = null where user_id = $1', [target]);
      return { ok: true };
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/iam/members/:userId/status', summary: 'Suspend or reactivate a member', tag: 'Access', auth: 'session', perm: 'roles.manage', stepUp: true, actors: ['iam'],
    body: z.object({ status: z.enum(['active', 'suspended']) }).strict(),
    handler: async ({ p, db, params, body, audit: log }) => {
      const target = uuidOrThrow(params.userId);
      if (target === p.userId) throw forbidden('You cannot suspend yourself');
      const roles = await db.query<{ role: string }>('select role from kernel.role_assignment where user_id = $1 and revoked_at is null', [target]);
      if (!p.roles.includes('owner') && roles.rows.some((r) => OWNER_ONLY.has(r.role))) throw forbidden('Only an owner can do that');
      const r = await db.query('update kernel.membership set status = $2 where user_id = $1', [target, body.status]);
      if (!r.rowCount) throw notFound('Member not found');
      if (body.status === 'suspended') await pools.auth.query('update kernel.session set revoked_at = now() where user_id = $1 and tenant_id = $2 and revoked_at is null', [target, p.tenantId]);
      await log('iam.member_status', 'user', target, { status: body.status });
      return { ok: true };
    },
  });
}
