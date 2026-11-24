import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { open, seal } from '../../crypto/kms.js';
import type { Db } from '../../db/tx.js';
import { audit, withActor } from '../../db/tx.js';
import { isoDate, pid, short, uuid } from '../../http/schemas.js';
import { cancelApproval, createApproval, registerApprovalHandler, resolveApprovers } from '../flow/lib.js';
import { notifyEmployee } from '../flow/notify.js';
import { subjectKey } from '../people/lib.js';
import { tenantTime } from './attendance.js';
import { addDays, leaveDaysX1000, todayIn } from './lib.js';

async function holidaysBetween(db: Db, tenantId: string, from: string, to: string): Promise<Set<string>> {
  const r = await db.query<{ d: string }>('select holiday_date::text as d from tm.public_holiday where tenant_id = $1 and holiday_date between $2 and $3', [tenantId, from, to]);
  return new Set(r.rows.map((x) => x.d));
}

/** Credits the yearly entitlement once per employee, leave type and year. Idempotent. No proration yet (staged). */
async function ensureEntitlements(db: Db, tenantId: string, employeeId: string, year: number): Promise<void> {
  const e = await db.query<{ hire_year: number; status: string }>('select extract(year from hire_date)::int as hire_year, status from people.employee where id = $1', [employeeId]);
  if (!e.rows[0] || e.rows[0].status === 'terminated' || e.rows[0].hire_year > year) return;
  await withActor(db, 'time', () => db.query(
    `insert into tm.leave_ledger (tenant_id, employee_id, leave_type_id, delta_x1000, reason, effective_date)
     select $1, $2, lt.id, lt.annual_days_x1000, 'entitlement:' || $3::text, make_date($3::int, 1, 1) from tm.leave_type lt where lt.tenant_id = $1 and lt.annual_days_x1000 > 0
     on conflict (tenant_id, employee_id, leave_type_id, reason) where reason like 'entitlement:%' do nothing`, [tenantId, employeeId, year]));
}

async function balanceOf(db: Db, employeeId: string, leaveTypeId: string): Promise<{ balance: number; pending: number }> {
  const b = await db.query<{ s: string | null }>('select sum(delta_x1000)::text as s from tm.leave_ledger where employee_id = $1 and leave_type_id = $2', [employeeId, leaveTypeId]);
  const p = await db.query<{ s: string | null }>(`select sum(days_x1000)::text as s from tm.leave_request where employee_id = $1 and leave_type_id = $2 and status = 'pending'`, [employeeId, leaveTypeId]);
  return { balance: Number(b.rows[0]?.s ?? 0), pending: Number(p.rows[0]?.s ?? 0) };
}

export function registerLeaveRoutes(svc: Services): void {
  const { kms } = svc;

  // Runs inside the approval decision, under the flow system actor.
  registerApprovalHandler('leave', {
    async onApproved(db, ctx, rec) {
      const r = await db.query(
        `select lr.*, lt.allow_negative, lt.paid, lt.name as type_name from tm.leave_request lr join tm.leave_type lt on lt.id = lr.leave_type_id where lr.id = $1 for update of lr`, [rec.entity_id]);
      const lr = r.rows[0];
      if (!lr) throw notFound('Leave request not found');
      if (lr.status !== 'pending') throw conflict('This leave request is no longer pending', 'not_pending');
      await ensureEntitlements(db, ctx.tenantId, lr.employee_id, Number(String(lr.start_date).slice(0, 4)));
      if (lr.paid && !lr.allow_negative) {
        const { balance } = await balanceOf(db, lr.employee_id, lr.leave_type_id);
        if (balance < lr.days_x1000) throw new HttpError(422, 'insufficient_balance', 'The leave balance is no longer enough for this request');
      }
      await db.query(`update tm.leave_request set status = 'approved', decided_at = now() where id = $1`, [lr.id]);
      await db.query(`insert into tm.leave_ledger (tenant_id, employee_id, leave_type_id, delta_x1000, reason, ref_id, effective_date) values ($1, $2, $3, $4, $5, $6, $7)`,
        [ctx.tenantId, lr.employee_id, lr.leave_type_id, -lr.days_x1000, `leave:${lr.id}`, lr.id, lr.start_date]);
      await notifyEmployee(db, ctx.tenantId, lr.employee_id, { kind: 'leave.approved', title: `Leave approved: ${lr.type_name}`, body: `${lr.start_date} to ${lr.end_date}`, link: '/time' });
      await audit(db, ctx, 'leave.approved', 'leave_request', lr.id, { days_x1000: lr.days_x1000 });
    },
    async onRejected(db, ctx, rec) {
      const r = await db.query(`update tm.leave_request set status = 'rejected', decided_at = now() where id = $1 and status = 'pending' returning employee_id`, [rec.entity_id]);
      if (r.rows[0]) await notifyEmployee(db, ctx.tenantId, r.rows[0].employee_id, { kind: 'leave.rejected', title: 'Leave request declined', link: '/time' });
    },
  });

  // ---------------------------------------------------------------- types
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/leave/types', summary: 'Leave types', tag: 'Leave', auth: 'session',
    handler: async ({ db }) => ({ types: (await db.query('select id, code, name, paid, annual_days_x1000, allow_negative, special from tm.leave_type order by name')).rows }),
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/leave/types', summary: 'Create a leave type', tag: 'Leave', auth: 'session', perm: 'leave.admin',
    body: z.object({ code: z.string().regex(/^[A-Z_]{2,20}$/), name: short(80), paid: z.boolean().default(true), annualDays: z.number().min(0).max(365).default(0), allowNegative: z.boolean().default(false), special: z.boolean().default(false) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const r = await db.query('insert into tm.leave_type (tenant_id, code, name, paid, annual_days_x1000, allow_negative, special) values ($1, $2, $3, $4, $5, $6, $7) returning id',
        [ctx.tenantId, body.code, body.name, body.paid, Math.round(body.annualDays * 1000), body.allowNegative, body.special]);
      await audit('leave_type.created', 'leave_type', r.rows[0].id, { code: body.code });
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });

  // ---------------------------------------------------------------- balances
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/leave/balances', summary: 'Leave balances (yours by default)', tag: 'Leave', auth: 'session',
    query: z.object({ employeeId: uuid.optional() }),
    handler: async ({ db, ctx, p, query }) => {
      const emp = query.employeeId ?? p.employeeId;
      if (!emp) throw new HttpError(409, 'no_employee', 'Your account is not linked to an employee record');
      if (emp !== p.employeeId && !p.perms.has('leave.read')) throw forbidden();
      const tt = await tenantTime(db, ctx.tenantId);
      await ensureEntitlements(db, ctx.tenantId, emp, Number(todayIn(tt.tz).slice(0, 4)));
      const r = await db.query(
        `select lt.id as leave_type_id, lt.code, lt.name, lt.paid, lt.special, coalesce(sum(l.delta_x1000), 0)::int as balance_x1000,
                coalesce((select sum(days_x1000) from tm.leave_request q where q.employee_id = $1 and q.leave_type_id = lt.id and q.status = 'pending'), 0)::int as pending_x1000
           from tm.leave_type lt left join tm.leave_ledger l on l.leave_type_id = lt.id and l.employee_id = $1 group by lt.id order by lt.name`, [emp]);
      return { employeeId: emp, balances: r.rows };
    },
  });

  // ---------------------------------------------------------------- requests
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/leave/requests', summary: 'Request leave', tag: 'Leave', auth: 'session', idempotent: 'optional',
    body: z.object({ leaveTypeId: uuid, startDate: isoDate, endDate: isoDate, half: z.boolean().default(false), reason: z.string().trim().min(1).max(1000).optional() }).strict(),
    handler: async ({ db, ctx, p, body, audit }) => {
      if (!p.employeeId || !ctx.userId) throw new HttpError(409, 'no_employee', 'Your account is not linked to an employee record');
      if (body.endDate < body.startDate) throw badRequest('The end date is before the start date');
      if (body.half && body.startDate !== body.endDate) throw badRequest('A half day must be a single date');
      if (body.endDate > addDays(body.startDate, 365)) throw badRequest('A request can cover at most one year');
      const tt = await tenantTime(db, ctx.tenantId);
      if (body.startDate < addDays(todayIn(tt.tz), -30)) throw new HttpError(422, 'too_far_back', 'Leave can be requested up to 30 days back');
      const emp = (await db.query<{ status: string; hire_date: string }>('select status, hire_date::text from people.employee where id = $1', [p.employeeId])).rows[0];
      if (!emp || emp.status === 'terminated') throw forbidden('Your employee record is not active');
      if (body.startDate < emp.hire_date) throw new HttpError(422, 'before_hire', 'The leave starts before your hire date');
      const lt = (await db.query('select id, name, paid, allow_negative, special from tm.leave_type where id = $1', [body.leaveTypeId])).rows[0];
      if (!lt) throw notFound('Leave type not found');
      const days = leaveDaysX1000(body.startDate, body.endDate, tt.weekend, await holidaysBetween(db, ctx.tenantId, body.startDate, body.endDate), body.half);
      if (days <= 0) throw new HttpError(422, 'no_working_days', 'That period has no working days');
      for (const y of new Set([body.startDate.slice(0, 4), body.endDate.slice(0, 4)])) await ensureEntitlements(db, ctx.tenantId, p.employeeId, Number(y));
      if (lt.paid && !lt.allow_negative) {
        const { balance, pending } = await balanceOf(db, p.employeeId, lt.id);
        if (balance - pending < days) throw new HttpError(422, 'insufficient_balance', `Your available balance is ${(Math.max(0, balance - pending) / 1000).toFixed(1)} days`);
      }
      const approvers = await resolveApprovers(db, ctx.tenantId, p.employeeId, ctx.userId);
      const id = randomUUID();
      const ap = await createApproval(db, ctx, {
        kind: 'leave', entity: 'leave_request', entityId: id, title: `${lt.name}: ${body.startDate} to ${body.endDate}`, requesterUserId: ctx.userId, subjectEmployeeId: p.employeeId,
        payload: { leave_request_id: id, employee_id: p.employeeId, leave_type_id: lt.id, start: body.startDate, end: body.endDate, days_x1000: days }, approverUserIds: approvers,
      });
      await db.query('insert into tm.leave_request (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days_x1000, approval_request_id) values ($1, $2, $3, $4, $5, $6, $7, $8)',
        [id, ctx.tenantId, p.employeeId, lt.id, body.startDate, body.endDate, days, ap.id]);
      if (body.reason) {
        const key = (await subjectKey(db, kms, ctx.tenantId, p.employeeId, true))!;
        await db.query('insert into tm.leave_reason (request_id, tenant_id, employee_id, reason_enc) values ($1, $2, $3, $4)', [id, ctx.tenantId, p.employeeId, seal(key, Buffer.from(body.reason, 'utf8'), `${id}:leave_reason`)]);
      }
      await audit('leave.requested', 'leave_request', id, { days_x1000: days, type: lt.name });
      return { status: 201, body: { id, days, daysX1000: days, status: 'pending', approvalRequestId: ap.id, contentHash: ap.contentHash } };
    },
  });

  defineRoute(svc, {
    method: 'GET', path: '/api/v1/leave/requests', summary: 'Leave requests (yours, or your team)', tag: 'Leave', auth: 'session',
    query: z.object({ scope: z.enum(['mine', 'team']).default('mine'), status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'voided']).optional(), employeeId: uuid.optional() }),
    handler: async ({ db, p, query }) => {
      const args: unknown[] = [];
      const where: string[] = [];
      if (query.employeeId) { args.push(query.employeeId); where.push(`lr.employee_id = $${args.length}`); }
      else if (query.scope === 'mine') { args.push(p.employeeId); where.push(`lr.employee_id = $${args.length}`); }
      if (query.status) { args.push(query.status); where.push(`lr.status = $${args.length}`); }
      const r = await db.query(
        `select lr.id, lr.employee_id, e.first_name, e.last_name, lt.name as type_name, lt.special, lr.start_date::text, lr.end_date::text, lr.days_x1000, lr.status, lr.created_at, lr.decided_at
           from tm.leave_request lr join people.employee e on e.id = lr.employee_id join tm.leave_type lt on lt.id = lr.leave_type_id
          ${where.length ? 'where ' + where.join(' and ') : ''} order by lr.start_date desc limit 200`, args);
      return { requests: r.rows };
    },
  });

  defineRoute(svc, {
    method: 'GET', path: '/api/v1/leave/requests/:id/reason', summary: 'Read the reason for a leave request', tag: 'Leave', auth: 'session',
    handler: async ({ db, ctx, params, audit }) => {
      const id = pid(params.id);
      const r = await db.query('select employee_id, reason_enc from tm.leave_reason where request_id = $1', [id]);
      if (!r.rows[0]) throw notFound('No reason on file');
      const key = await subjectKey(db, kms, ctx.tenantId, r.rows[0].employee_id, false);
      if (!key) throw new HttpError(410, 'erased', 'This data has been erased');
      await audit('leave.reason_read', 'leave_request', id, {});
      return { reason: open(key, r.rows[0].reason_enc, `${id}:leave_reason`).toString('utf8') };
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/leave/requests/:id/cancel', summary: 'Cancel your leave (pending, or approved and not yet started)', tag: 'Leave', auth: 'session', actors: ['flow'],
    handler: async ({ db, ctx, p, params, audit }) => {
      const id = pid(params.id);
      const r = await db.query('select * from tm.leave_request where id = $1 for update', [id]);
      const lr = r.rows[0];
      if (!lr || lr.employee_id !== p.employeeId) throw notFound('Leave request not found');
      const tt = await tenantTime(db, ctx.tenantId);
      if (lr.status === 'pending') {
        if (lr.approval_request_id) await cancelApproval(db, ctx, lr.approval_request_id);
        await db.query(`update tm.leave_request set status = 'cancelled', decided_at = now() where id = $1`, [id]);
      } else if (lr.status === 'approved') {
        if (String(lr.start_date) <= todayIn(tt.tz)) throw conflict('Leave that has started cannot be cancelled here. Ask HR.', 'already_started');
        await db.query(`update tm.leave_request set status = 'cancelled', decided_at = now() where id = $1`, [id]);
        await db.query(`insert into tm.leave_ledger (tenant_id, employee_id, leave_type_id, delta_x1000, reason, ref_id, effective_date) values ($1, $2, $3, $4, $5, $6, current_date)`,
          [ctx.tenantId, lr.employee_id, lr.leave_type_id, lr.days_x1000, `cancel:${id}`, id]);
      } else throw conflict('This request cannot be cancelled', 'not_cancellable');
      await audit('leave.cancelled', 'leave_request', id, { was: lr.status });
      return { ok: true };
    },
  });

  defineRoute(svc, {
    method: 'GET', path: '/api/v1/leave/calendar', summary: 'Approved leave in a period (people you can see)', tag: 'Leave', auth: 'session',
    query: z.object({ from: isoDate, to: isoDate }),
    handler: async ({ db, query }) => {
      if (query.to < query.from || query.to > addDays(query.from, 92)) throw badRequest('Choose a period of at most 92 days');
      const r = await db.query(
        `select lr.employee_id, e.first_name, e.last_name, lr.start_date::text, lr.end_date::text, case when lt.special then null else lt.name end as type_name
           from tm.leave_request lr join people.employee e on e.id = lr.employee_id join tm.leave_type lt on lt.id = lr.leave_type_id
          where lr.status = 'approved' and lr.start_date <= $2 and lr.end_date >= $1 order by lr.start_date limit 500`, [query.from, query.to]);
      return { leave: r.rows };
    },
  });
}
