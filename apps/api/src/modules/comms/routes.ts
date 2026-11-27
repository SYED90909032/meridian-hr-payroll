import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { HttpError, badRequest, forbidden } from '../../errors.js';
import { audit, withTx } from '../../db/tx.js';
import { hashPassword } from '../../crypto/password.js';
import { accountDeepLink, consumeAccountToken, enqueueAccountEmail, findAccountToken, issueAccountToken } from '../iam/account-recovery.js';
import { passwordProblemWithBreach } from './password-security.js';

const email = z.string().trim().toLowerCase().email().max(254);
const uuid = z.string().uuid();
const preferenceKind = z.enum(['leave-requested', 'leave-decided', 'approval-pending', 'pay-run-ready', 'payslip-published', 'security']);
const uniform = { ok: true } as const;
function tokenBody() { return z.object({ token: z.string().min(40).max(200), password: z.string().min(1).max(128) }).strict(); }
function basicSecret(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Basic ')) return false;
  const given = Buffer.from(header.slice(6)); const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function registerCommsRoutes(svc: Services): void {
  const { pools, cfg, kms } = svc;
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/forgot-password', summary: 'Request a password reset email', tag: 'Auth', auth: 'public', tx: false, rateLimit: { max: 5, timeWindow: '15 minutes' },
    body: z.object({ email, captcha: z.string().max(400).optional() }).strict(),
    handler: async ({ body, req }) => {
      try {
        const u = (await pools.auth.query<{ id: string; display_name: string; email: string }>('select id, display_name, email::text from kernel.user_account where email = $1 and disabled = false', [body.email])).rows[0];
        if (u) {
          const m = (await pools.auth.query<{ tenant_id: string }>(`select tenant_id from kernel.membership where user_id = $1 and status = 'active' order by created_at limit 1`, [u.id])).rows[0];
          if (m) {
            const t = await issueAccountToken(pools.auth, u.id, m.tenant_id, 'password_reset', 30 * 60_000);
            await withTx(pools.app, { tenantId: m.tenant_id, userId: null, employeeId: null, ip: req.ip, requestId: req.id }, async (db) => {
              await enqueueAccountEmail(db, kms, m.tenant_id, `password-reset:${t.id}`, u.email, u.display_name, 'password-reset.v1', accountDeepLink('reset'), t.raw);
            });
          }
        }
      } catch { /* Uniform public response: do not expose account existence or delivery state. */ }
      return uniform;
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/reset-password', summary: 'Set a new password with a single-use reset token', tag: 'Auth', auth: 'public', tx: false, rateLimit: { max: 10, timeWindow: '15 minutes' },
    body: tokenBody(),
    handler: async ({ body, req }) => {
      const candidate = await findAccountToken(pools.auth, body.token, 'password_reset');
      if (!candidate) throw new HttpError(410, 'token_invalid', 'This link has expired or was already used');
      const token = candidate;
      const u = (await pools.auth.query<{ email: string; display_name: string }>('select email::text, display_name from kernel.user_account where id = $1', [token.userId])).rows[0];
      if (!u) throw new HttpError(410, 'token_invalid', 'This link has expired or was already used');
      const problem = await passwordProblemWithBreach(body.password, u.email, cfg);
      if (problem) throw badRequest(problem);
      try { await consumeAccountToken(pools.auth, body.token, 'password_reset'); } catch { throw new HttpError(410, 'token_invalid', 'This link has expired or was already used'); }
      const hash = await hashPassword(body.password);
      await pools.auth.query('update kernel.user_account set password_hash = $2, must_change_password = false, password_changed_at = now(), failed_attempts = 0, locked_until = null where id = $1', [token.userId, hash]);
      await pools.auth.query('update kernel.session set revoked_at = now() where user_id = $1 and revoked_at is null', [token.userId]);
      const tenantId = token.tenantId;
      if (tenantId) await withTx(pools.app, { tenantId, userId: token.userId, employeeId: null, ip: req.ip, requestId: req.id }, async (db) => {
        await enqueueAccountEmail(db, kms, tenantId, `password-changed:${token.userId}:${token.id}`, u.email, u.display_name, 'password-changed.v1', '/settings/security');
        await audit(db, { tenantId, userId: token.userId, employeeId: null, ip: req.ip, requestId: req.id }, 'iam.password_reset', 'user', token.userId, {});
      }, ['iam']);
      return uniform;
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/auth/accept-invitation', summary: 'Accept an invitation and choose a password', tag: 'Auth', auth: 'public', tx: false, rateLimit: { max: 10, timeWindow: '15 minutes' },
    body: tokenBody(),
    handler: async ({ body, req }) => {
      const candidate = await findAccountToken(pools.auth, body.token, 'invitation');
      if (!candidate) throw new HttpError(410, 'token_invalid', 'This invitation has expired or was already used');
      const token = candidate;
      if (!token.tenantId) throw new HttpError(410, 'token_invalid', 'This invitation has expired or was already used');
      const u = (await pools.auth.query<{ email: string; display_name: string }>('select email::text, display_name from kernel.user_account where id = $1', [token.userId])).rows[0];
      if (!u) throw new HttpError(410, 'token_invalid', 'This invitation has expired or was already used');
      const problem = await passwordProblemWithBreach(body.password, u.email, cfg);
      if (problem) throw badRequest(problem);
      try { await consumeAccountToken(pools.auth, body.token, 'invitation'); } catch { throw new HttpError(410, 'token_invalid', 'This invitation has expired or was already used'); }
      await pools.auth.query('update kernel.user_account set password_hash = $2, must_change_password = false, password_changed_at = now(), disabled = false where id = $1', [token.userId, await hashPassword(body.password)]);
      const tenantId = token.tenantId;
      await withTx(pools.app, { tenantId, userId: token.userId, employeeId: null, ip: req.ip, requestId: req.id }, async (db) => {
        await db.query(`update kernel.membership set status = 'active' where tenant_id = $1 and user_id = $2 and status = 'invited'`, [tenantId, token.userId]);
        await audit(db, { tenantId, userId: token.userId, employeeId: null, ip: req.ip, requestId: req.id }, 'iam.invitation_accepted', 'user', token.userId, {});
      }, ['iam']);
      return uniform;
    },
  });

  defineRoute(svc, { method: 'GET', path: '/api/v1/comms/notification-preferences', summary: 'Your notification email preferences', tag: 'Communications', auth: 'session',
    handler: async ({ db, ctx }) => ({ preferences: (await db.query('select kind, email_enabled from comms.notification_preference where user_id = $1', [ctx.userId])).rows,
      securityEmailRequired: true }) });
  defineRoute(svc, { method: 'PUT', path: '/api/v1/comms/notification-preferences', summary: 'Update a notification email preference', tag: 'Communications', auth: 'session', idempotent: 'optional',
    body: z.object({ kind: preferenceKind, emailEnabled: z.boolean() }).strict(),
    handler: async ({ db, ctx, body, audit: log }) => {
      if (body.kind === 'security' && !body.emailEnabled) throw forbidden('Security emails cannot be turned off');
      await db.query(`insert into comms.notification_preference (tenant_id, user_id, kind, email_enabled) values ($1, $2, $3, $4) on conflict (tenant_id, user_id, kind) do update set email_enabled = excluded.email_enabled, updated_at = now()`, [ctx.tenantId, ctx.userId, body.kind, body.emailEnabled]);
      await log('comms.preference_changed', 'user', ctx.userId, { kind: body.kind, email_enabled: body.emailEnabled }); return uniform;
    } });

  defineRoute(svc, { method: 'GET', path: '/api/v1/comms/suppressions', summary: 'List suppressed email addresses', tag: 'Communications', auth: 'session', perm: 'settings.manage',
    handler: async ({ db }) => ({ suppressions: (await db.query(`select email_hash, reason, created_at, cleared_at from comms.suppression where cleared_at is null order by created_at desc limit 200`)).rows }) });
  defineRoute(svc, { method: 'POST', path: '/api/v1/comms/suppressions/:hash/clear', summary: 'Clear an email suppression', tag: 'Communications', auth: 'session', perm: 'settings.manage', stepUp: true,
    handler: async ({ db, ctx, params, audit: log }) => { const hash = params.hash ?? ''; if (!/^[a-f0-9]{64}$/.test(hash)) throw badRequest('Invalid suppression'); await db.query('update comms.suppression set cleared_at = now() where email_hash = $1 and cleared_at is null', [hash]); await log('comms.suppression_cleared', 'suppression', hash, {}); return uniform; } });
  defineRoute(svc, { method: 'POST', path: '/api/v1/comms/webhooks/postmark', summary: 'Record a provider bounce or complaint', tag: 'Communications', auth: 'public', tx: false, rateLimit: { max: 60, timeWindow: '1 minute' },
    body: z.object({ tenantId: uuid, email, type: z.enum(['Bounce', 'SpamComplaint', 'bounce', 'complaint']) }).strict(),
    handler: async ({ body, req }) => {
      if (!basicSecret(req.headers.authorization, cfg.BOUNCE_WEBHOOK_SECRET)) throw new HttpError(401, 'unauthorized', 'Unauthorized');
      await withTx(pools.app, { tenantId: body.tenantId, userId: null, employeeId: null, ip: req.ip, requestId: req.id }, async (db) => {
        await db.query(`insert into comms.suppression (tenant_id, email_hash, reason) values ($1, $2, $3) on conflict (tenant_id, email_hash) do update set reason = excluded.reason, cleared_at = null, created_at = now()`, [body.tenantId, (await import('../../crypto/tokens.js')).sha256hex(body.email), body.type.toLowerCase().includes('complaint') ? 'complaint' : 'bounce']);
      });
      return uniform;
    }, });

  defineRoute(svc, { method: 'GET', path: '/api/v1/iam/mfa-policy', summary: 'Read this company MFA enrolment policy', tag: 'Security', auth: 'session',
    handler: async ({ db }) => ({ requiredRoles: (await db.query(`select required_roles from kernel.tenant_mfa_policy where tenant_id = current_setting('app.tenant_id')::uuid`)).rows[0]?.required_roles ?? [] }) });
  defineRoute(svc, { method: 'PUT', path: '/api/v1/iam/mfa-policy', summary: 'Require MFA enrolment for selected roles', tag: 'Security', auth: 'session', perm: 'settings.manage', stepUp: true, idempotent: 'optional',
    body: z.object({ requiredRoles: z.array(z.enum(['owner', 'hr_admin', 'payroll_admin', 'payroll_approver', 'manager', 'auditor', 'helpdesk_agent'])).max(7) }).strict(),
    handler: async ({ db, ctx, body, audit: log }) => { await db.query(`insert into kernel.tenant_mfa_policy (tenant_id, required_roles) values ($1, $2) on conflict (tenant_id) do update set required_roles = excluded.required_roles, updated_at = now()`, [ctx.tenantId, body.requiredRoles]); await log('iam.mfa_policy_changed', 'tenant', ctx.tenantId, { required_roles: body.requiredRoles }); return { requiredRoles: body.requiredRoles }; } });
}
