import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { HttpError, badRequest, forbidden, notFound } from '../../errors.js';
import { withTx } from '../../db/tx.js';
import { cancelApproval, consumeActionToken, decide, issueActionToken } from './lib.js';

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pid = (v: string | undefined) => { const r = uuid.safeParse(v); if (!r.success) throw badRequest('Invalid id'); return r.data; };

export function registerFlowRoutes(svc: Services): void {
  const { pools } = svc;

  defineRoute(svc, {
    method: 'GET', path: '/api/v1/flow/inbox', summary: 'Approvals waiting for you', tag: 'Approvals', auth: 'session',
    handler: async ({ db, ctx }) => {
      const r = await db.query(
        `select st.id as step_id, st.step_no, rq.id as request_id, rq.kind, rq.title, rq.payload, rq.content_hash, rq.created_at, rq.max_channel_assurance,
                (select display_name from kernel.membership m where m.user_id = rq.requester_user_id) as requester_name
           from flow.approval_step st join flow.approval_request rq on rq.id = st.request_id
          where st.approver_user_id = $1 and st.status = 'pending' and rq.status = 'pending'
            and not exists (select 1 from flow.approval_step e where e.request_id = st.request_id and e.step_no < st.step_no and e.status <> 'approved')
          order by rq.created_at`, [ctx.userId]);
      return { items: r.rows };
    },
  });

  defineRoute(svc, {
    method: 'GET', path: '/api/v1/flow/requests', summary: 'Requests you made', tag: 'Approvals', auth: 'session',
    handler: async ({ db, ctx }) => {
      const r = await db.query(`select id, kind, title, status, created_at, decided_at from flow.approval_request where requester_user_id = $1 order by created_at desc limit 100`, [ctx.userId]);
      return { requests: r.rows };
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/flow/steps/:id/decide', summary: 'Approve or decline a request assigned to you', tag: 'Approvals', auth: 'session', actors: ['flow'], idempotent: 'optional',
    body: z.object({ decision: z.enum(['approve', 'reject']), comment: z.string().trim().max(1000).optional(), contentHash: hash }).strict(),
    handler: async ({ db, ctx, p, params, body }) => {
      const stepUpFresh = !!p.stepUpAt && Date.now() - p.stepUpAt.getTime() < 10 * 60_000;
      return decide(db, ctx, { stepId: pid(params.id), decision: body.decision, comment: body.comment, contentHash: body.contentHash, via: 'app', stepUpFresh });
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/flow/requests/:id/cancel', summary: 'Withdraw your own open request', tag: 'Approvals', auth: 'session', actors: ['flow'],
    handler: async ({ db, ctx, params, audit }) => {
      const rec = await cancelApproval(db, ctx, pid(params.id));
      if (rec.kind === 'leave') await db.query(`update tm.leave_request set status = 'cancelled', decided_at = now() where id = $1 and status = 'pending'`, [rec.entity_id]);
      await audit('approval.cancelled', rec.entity, rec.entity_id, { request_id: rec.id });
      return { ok: true };
    },
  });

  // Approving from a link. Single use, 15 minutes, bound to the approver and the exact content, and only for low-risk kinds.
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/flow/token/decide', summary: 'Decide a request using a one-time link token', tag: 'Approvals', auth: 'public', tx: false, rateLimit: { max: 20, timeWindow: '1 minute' },
    body: z.object({ token: z.string().min(40).max(200), decision: z.enum(['approve', 'reject']), contentHash: hash }).strict(),
    handler: async ({ body, req }) => {
      const [tenantId, raw] = body.token.split('.');
      if (!tenantId || !raw || !uuid.safeParse(tenantId).success) throw new HttpError(410, 'token_invalid', 'This link has expired or was already used');
      const mem = (id: string) => pools.auth.query('select employee_id from kernel.membership where tenant_id = $1 and user_id = $2 and status = $3', [tenantId, id, 'active']);
      return withTx(pools.app, { tenantId, userId: null, employeeId: null, ip: req.ip, requestId: req.id }, async (db) => {
        const t = await consumeActionToken(db, tenantId, raw);
        if (t.contentHash !== body.contentHash) throw new HttpError(409, 'content_changed', 'The request changed. Open it in the app to review.');
        const m = await mem(t.approverUserId);
        if (!m.rowCount) throw forbidden();
        const ctx = { tenantId, userId: t.approverUserId, employeeId: m.rows[0].employee_id as string | null, ip: req.ip, requestId: req.id };
        await db.query(`select set_config('app.user_id', $1, true), set_config('app.employee_id', $2, true)`, [ctx.userId, ctx.employeeId ?? '']);
        return decide(db, ctx, { stepId: t.stepId, decision: body.decision, contentHash: t.contentHash, via: 'token', stepUpFresh: false });
      }, ['flow']);
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/flow/steps/:id/token', summary: 'Create a one-time approval link token (delivered by email; requires a mail provider)', tag: 'Approvals', auth: 'session', perm: 'settings.manage', actors: ['flow'],
    handler: async ({ db, ctx, params, audit }) => {
      const token = await issueActionToken(db, ctx, pid(params.id));
      await audit('approval.token_issued', 'approval_step', params.id!, {});
      return { token, expiresInMinutes: 15 };
    },
  });

  defineRoute(svc, {
    method: 'GET', path: '/api/v1/flow/notifications', summary: 'Your notifications', tag: 'Approvals', auth: 'session',
    query: z.object({ unread: z.enum(['1']).optional() }),
    handler: async ({ db, ctx, query }) => {
      const r = await db.query(`select id, kind, title, body, link, created_at, read_at from flow.notification where user_id = $1 ${query.unread ? 'and read_at is null' : ''} order by created_at desc limit 50`, [ctx.userId]);
      const c = await db.query('select count(*)::int as n from flow.notification where user_id = $1 and read_at is null', [ctx.userId]);
      return { notifications: r.rows, unread: c.rows[0].n };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/flow/notifications/read', summary: 'Mark notifications read', tag: 'Approvals', auth: 'session',
    body: z.object({ ids: z.array(uuid).max(100).optional() }).strict(),
    handler: async ({ db, ctx, body }) => {
      if (body.ids?.length) await db.query('update flow.notification set read_at = now() where user_id = $1 and id = any($2) and read_at is null', [ctx.userId, body.ids]);
      else await db.query('update flow.notification set read_at = now() where user_id = $1 and read_at is null', [ctx.userId]);
      return { ok: true };
    },
  });
  void notFound;
}
