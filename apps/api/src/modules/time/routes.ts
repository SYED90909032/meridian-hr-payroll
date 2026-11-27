import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { badRequest, conflict, notFound, unauthorized } from '../../errors.js';
import { newToken, sha256 } from '../../crypto/tokens.js';
import { isoDate, limitQ, pid, short, uuid } from '../../http/schemas.js';
import { recomputeDays, tenantTime, validTimezone } from './attendance.js';
import { addDays, localParts } from './lib.js';
import { registerLeaveRoutes } from './leave.js';

const REVIEW_AFTER_DAYS = 120;
const FUTURE_SKEW_MS = 5 * 60_000;

export function registerTimeRoutes(svc: Services): void {
  // ---------------------------------------------------------------- settings
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/time/settings', summary: 'Time zone, weekend days, and overnight attribution', tag: 'Time', auth: 'session',
    handler: async ({ db, ctx }) => tenantTime(db, ctx.tenantId),
  });
  defineRoute(svc, {
    method: 'PUT', path: '/api/v1/time/settings', summary: 'Change time zone, weekend days, and overnight attribution', tag: 'Time', auth: 'session', perm: 'time.admin', actors: ['iam'],
    body: z.object({ tz: z.string().max(60).refine(validTimezone, 'Unknown time zone'), weekend: z.array(z.number().int().min(0).max(6)).min(1).max(3).refine((a) => new Set(a).size === a.length, 'Duplicate day'), overnightBucket: z.enum(['start', 'end']).default('start') }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      await db.query(`update kernel.tenant set settings = settings || $2::jsonb where id = $1`, [ctx.tenantId, JSON.stringify({ timezone: body.tz, weekend: body.weekend, overnight_bucket: body.overnightBucket })]);
      await audit('time.settings_changed', 'tenant', ctx.tenantId, body);
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- devices
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/time/devices', summary: 'Punch devices', tag: 'Time', auth: 'session', perm: 'time.admin',
    handler: async ({ db }) => ({ devices: (await db.query('select id, name, kind, key_prefix, revoked_at, last_seen_at, created_at from tm.device order by created_at desc')).rows }),
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/time/devices', summary: 'Register a punch device. The key is shown once.', tag: 'Time', auth: 'session', perm: 'time.admin', stepUp: true,
    body: z.object({ name: short(100), kind: z.enum(['biometric', 'kiosk', 'mobile', 'api']) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const prefix = randomBytes(4).toString('hex');
      const key = `md_${prefix}_${newToken(32)}`;
      const r = await db.query('insert into tm.device (tenant_id, name, kind, key_prefix, key_hash) values ($1, $2, $3, $4, $5) returning id', [ctx.tenantId, body.name, body.kind, prefix, sha256(key)]);
      await audit('device.registered', 'device', r.rows[0].id, { name: body.name, kind: body.kind });
      return { status: 201, body: { id: r.rows[0].id, key, note: 'Store this key now. It cannot be shown again.' } };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/time/devices/:id/revoke', summary: 'Revoke a device key', tag: 'Time', auth: 'session', perm: 'time.admin', stepUp: true,
    handler: async ({ db, params, audit }) => {
      const r = await db.query('update tm.device set revoked_at = now() where id = $1 and revoked_at is null returning id', [pid(params.id)]);
      if (!r.rowCount) throw notFound('Device not found');
      await audit('device.revoked', 'device', params.id!, {});
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- ingest (device key)
  const punchIn = z.object({
    employeeNo: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
    eventTime: z.string().datetime({ offset: true }),
    direction: z.enum(['in', 'out']),
    idempotencyKey: z.string().min(8).max(100),
    confidence: z.enum(['normal', 'low']).default('normal'),
  }).strict();
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/ingest/punches', summary: 'Submit punches from a device. Safe to retry.', tag: 'Time', auth: 'device', actors: ['time'],
    body: z.object({ punches: z.array(punchIn).min(1).max(500) }).strict(), bodyLimit: 512 * 1024, rateLimit: { max: 120, timeWindow: '1 minute' },
    handler: async ({ p, db, ctx, body, audit }) => {
      const dev = await db.query<{ kind: string }>('select kind from tm.device where id = $1 and revoked_at is null', [p.deviceId]);
      if (!dev.rows[0]) throw unauthorized();
      const source = dev.rows[0].kind;
      const tt = await tenantTime(db, ctx.tenantId);
      const now = Date.now();
      const emp = new Map<string, { id: string; status: string } | null>();
      const parts = new Set<string>();
      const touched = new Map<string, Set<string>>();
      const receipts: { idempotencyKey: string; receiptId: string | null; status: 'accepted' | 'duplicate' | 'review' | 'rejected'; reason?: string }[] = [];

      for (const x of body.punches) {
        const t = Date.parse(x.eventTime);
        if (!emp.has(x.employeeNo)) {
          const e = await db.query<{ id: string; status: string }>('select id, status from people.employee where employee_no = $1', [x.employeeNo]);
          emp.set(x.employeeNo, e.rows[0] ?? null);
        }
        const e = emp.get(x.employeeNo);
        if (!e) { receipts.push({ idempotencyKey: x.idempotencyKey, receiptId: null, status: 'rejected', reason: 'unknown_employee' }); continue; }
        if (e.status === 'terminated') { receipts.push({ idempotencyKey: x.idempotencyKey, receiptId: null, status: 'rejected', reason: 'employee_terminated' }); continue; }
        if (t > now + FUTURE_SKEW_MS) { receipts.push({ idempotencyKey: x.idempotencyKey, receiptId: null, status: 'rejected', reason: 'in_the_future' }); continue; }
        if (t < now - 5 * 365 * 86_400_000) { receipts.push({ idempotencyKey: x.idempotencyKey, receiptId: null, status: 'rejected', reason: 'too_old' }); continue; }

        const seen = await db.query<{ receipt_id: string }>('select receipt_id from tm.punch_dedupe where tenant_id = $1 and device_id = $2 and idempotency_key = $3 limit 1', [ctx.tenantId, p.deviceId, x.idempotencyKey]);
        if (seen.rows[0]) { receipts.push({ idempotencyKey: x.idempotencyKey, receiptId: seen.rows[0].receipt_id, status: 'duplicate' }); continue; }

        const month = x.eventTime.slice(0, 7);
        if (!parts.has(month)) { await db.query('select tm.ensure_punch_partition($1)', [new Date(t)]); parts.add(month); }
        const receipt = randomUUID(), id = randomUUID();
        const ins = await db.query('insert into tm.punch_dedupe (tenant_id, device_id, idempotency_key, event_time, punch_id, receipt_id) values ($1, $2, $3, $4, $5, $6) on conflict do nothing', [ctx.tenantId, p.deviceId, x.idempotencyKey, new Date(t), id, receipt]);
        if (!ins.rowCount) {
          const again = await db.query<{ receipt_id: string }>('select receipt_id from tm.punch_dedupe where tenant_id = $1 and device_id = $2 and idempotency_key = $3 limit 1', [ctx.tenantId, p.deviceId, x.idempotencyKey]);
          receipts.push({ idempotencyKey: x.idempotencyKey, receiptId: again.rows[0]?.receipt_id ?? null, status: 'duplicate' });
          continue;
        }
        if (t < now - REVIEW_AFTER_DAYS * 86_400_000) {
          await db.query('insert into tm.late_punch_review (id, tenant_id, employee_id, device_id, event_time, direction, idempotency_key, receipt_id) values ($1, $2, $3, $4, $5, $6, $7, $8)', [id, ctx.tenantId, e.id, p.deviceId, new Date(t), x.direction, x.idempotencyKey, receipt]);
          receipts.push({ idempotencyKey: x.idempotencyKey, receiptId: receipt, status: 'review' });
          continue;
        }
        await db.query(
          `insert into tm.punch (id, tenant_id, employee_id, device_id, event_time, direction, source, confidence, receipt_id, idempotency_key) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, ctx.tenantId, e.id, p.deviceId, new Date(t), x.direction, source, x.confidence, receipt, x.idempotencyKey]);
        const set = touched.get(e.id) ?? new Set<string>();
        const local = localParts(t, tt.tz).date;
        set.add(local); set.add(addDays(local, -1)); set.add(addDays(local, 1));
        touched.set(e.id, set);
        receipts.push({ idempotencyKey: x.idempotencyKey, receiptId: receipt, status: 'accepted' });
      }
      for (const [empId, dates] of touched) await recomputeDays(db, ctx.tenantId, empId, [...dates], tt);
      const counts = receipts.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
      if (receipts.some((r) => r.status !== 'duplicate')) await audit('punch.ingested', 'device', p.deviceId ?? null, counts);
      return { status: 202, body: { receipts, counts } };
    },
  });

  // ---------------------------------------------------------------- punches and attendance
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/time/punches', summary: 'Punches (yours, or your team)', tag: 'Time', auth: 'any',
    query: z.object({ employeeId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional(), limit: limitQ }),
    handler: async ({ db, p, query }) => {
      const emp = query.employeeId ?? p.employeeId;
      const from = query.from ?? addDays(new Date().toISOString().slice(0, 10), -7);
      const to = query.to ?? addDays(new Date().toISOString().slice(0, 10), 1);
      const r = await db.query('select id, employee_id, event_time, direction, source, confidence from tm.punch where employee_id = $1 and event_time >= $2::date and event_time < ($3::date + 1) order by event_time desc limit $4', [emp, from, to, query.limit]);
      return { punches: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/time/punches/manual', summary: 'Add a manual punch (audited)', tag: 'Time', auth: 'session', perm: 'time.admin', actors: ['time'],
    body: z.object({ employeeId: uuid, eventTime: z.string().datetime({ offset: true }), direction: z.enum(['in', 'out']), reason: z.string().trim().min(5).max(300) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const t = Date.parse(body.eventTime);
      if (t > Date.now() + FUTURE_SKEW_MS) throw badRequest('A punch cannot be in the future');
      const e = await db.query<{ status: string }>('select status from people.employee where id = $1', [body.employeeId]);
      if (!e.rows[0]) throw notFound('Employee not found');
      await db.query('select tm.ensure_punch_partition($1)', [new Date(t)]);
      const id = randomUUID();
      await db.query(`insert into tm.punch (id, tenant_id, employee_id, device_id, event_time, direction, source, confidence, receipt_id, idempotency_key) values ($1, $2, $3, null, $4, $5, 'manual', 'normal', $6, $7)`,
        [id, ctx.tenantId, body.employeeId, new Date(t), body.direction, randomUUID(), `manual:${id}`]);
      const tt = await tenantTime(db, ctx.tenantId);
      const d = localParts(t, tt.tz).date;
      await recomputeDays(db, ctx.tenantId, body.employeeId, [d, addDays(d, -1), addDays(d, 1)], tt);
      await audit('punch.manual', 'employee', body.employeeId, { punch_id: id, event_time: body.eventTime, direction: body.direction, reason: body.reason });
      return { status: 201, body: { id } };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/time/attendance', summary: 'Attendance days (yours, or your team)', tag: 'Time', auth: 'any',
    query: z.object({ employeeId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional(), limit: limitQ }),
    handler: async ({ db, query, p }) => {
      const today = new Date().toISOString().slice(0, 10);
      const from = query.from ?? addDays(today, -30), to = query.to ?? today;
      const args: unknown[] = [from, to, query.limit];
      let who = '';
      if (query.employeeId) { args.push(query.employeeId); who = `and a.employee_id = $${args.length}`; }
      else if (!p.perms.has('time.read') && p.employeeId) { args.push(p.employeeId); who = `and a.employee_id = $${args.length}`; }
      const r = await db.query(
        `select a.employee_id, e.first_name, e.last_name, e.employee_no, a.work_date, a.first_in, a.last_out, a.worked_minutes, a.late_minutes, a.overtime_minutes, a.overtime_special_minutes, a.status
           from tm.attendance_day a join people.employee e on e.id = a.employee_id where a.work_date between $1 and $2 ${who} order by a.work_date desc, e.last_name limit $3`, args);
      return { days: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/time/attendance/recompute', summary: 'Recompute attendance for a date range', tag: 'Time', auth: 'session', perm: 'time.admin', actors: ['time'],
    body: z.object({ employeeId: uuid.optional(), from: isoDate, to: isoDate }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      if (body.to < body.from) throw badRequest('End date is before the start date');
      const days: string[] = [];
      for (let d = body.from; d <= body.to; d = addDays(d, 1)) { days.push(d); if (days.length > 62) throw badRequest('At most 62 days at a time'); }
      const emps = body.employeeId ? [body.employeeId] : (await db.query<{ id: string }>(`select id from people.employee where status <> 'terminated' limit 2000`)).rows.map((x) => x.id);
      const tt = await tenantTime(db, ctx.tenantId);
      let n = 0;
      for (const id of emps) n += await recomputeDays(db, ctx.tenantId, id, days, tt);
      await audit('attendance.recomputed', 'tenant', ctx.tenantId, { from: body.from, to: body.to, employees: emps.length });
      return { rowsWritten: n };
    },
  });

  // ---------------------------------------------------------------- shifts and holidays
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/time/shifts', summary: 'Shifts', tag: 'Time', auth: 'session',
    handler: async ({ db }) => ({ shifts: (await db.query('select id, name, start_time::text, end_time::text, break_minutes, grace_minutes, overnight from tm.shift order by name')).rows }),
  });
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/time/shifts', summary: 'Create a shift', tag: 'Time', auth: 'session', perm: 'time.admin',
    body: z.object({ name: short(80), startTime: hhmm, endTime: hhmm, breakMinutes: z.number().int().min(0).max(240).default(60), graceMinutes: z.number().int().min(0).max(120).default(10), overnight: z.boolean().default(false) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const r = await db.query('insert into tm.shift (tenant_id, name, start_time, end_time, break_minutes, grace_minutes, overnight) values ($1, $2, $3, $4, $5, $6, $7) returning id', [ctx.tenantId, body.name, body.startTime, body.endTime, body.breakMinutes, body.graceMinutes, body.overnight]);
      await audit('shift.created', 'shift', r.rows[0].id, { name: body.name });
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/time/shifts/assign', summary: 'Assign a shift to an employee for a period', tag: 'Time', auth: 'session', perm: 'time.admin', actors: ['time'],
    body: z.object({ employeeId: uuid, shiftId: uuid, from: isoDate, to: isoDate.optional() }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      if (body.to && body.to < body.from) throw badRequest('End date is before the start date');
      if (!(await db.query('select 1 from tm.shift where id = $1', [body.shiftId])).rowCount) throw notFound('Shift not found');
      if (!(await db.query('select 1 from people.employee where id = $1', [body.employeeId])).rowCount) throw notFound('Employee not found');
      // An open-ended assignment ends the previous open one the day before, so a change of shift is a single call.
      await db.query(`update tm.shift_assignment set valid_during = daterange(lower(valid_during), $3::date, '[)') where employee_id = $1 and upper_inf(valid_during) and lower(valid_during) < $3::date and tenant_id = $2`, [body.employeeId, ctx.tenantId, body.from]);
      const r = await db.query(`insert into tm.shift_assignment (tenant_id, employee_id, shift_id, valid_during) values ($1, $2, $3, daterange($4::date, $5::date, '[)')) returning id`, [ctx.tenantId, body.employeeId, body.shiftId, body.from, body.to ? addDays(body.to, 1) : null]);
      await audit('shift.assigned', 'employee', body.employeeId, { shift_id: body.shiftId, from: body.from, to: body.to ?? null });
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/time/holidays', summary: 'Public holidays', tag: 'Time', auth: 'session',
    query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
    handler: async ({ db, query }) => {
      const y = query.year ?? new Date().getUTCFullYear();
      return { holidays: (await db.query('select holiday_date::text as date, name from tm.public_holiday where holiday_date between $1 and $2 order by holiday_date', [`${y}-01-01`, `${y}-12-31`])).rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/time/holidays', summary: 'Add a public holiday', tag: 'Time', auth: 'session', perm: 'time.admin',
    body: z.object({ date: isoDate, name: short(100) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const r = await db.query('insert into tm.public_holiday (tenant_id, holiday_date, name) values ($1, $2, $3) on conflict do nothing returning holiday_date', [ctx.tenantId, body.date, body.name]);
      if (!r.rowCount) throw conflict('That date is already a holiday');
      await audit('holiday.added', 'holiday', body.date, { name: body.name });
      return { status: 201, body: { ok: true } };
    },
  });
  defineRoute(svc, {
    method: 'DELETE', path: '/api/v1/time/holidays/:date', summary: 'Remove a public holiday', tag: 'Time', auth: 'session', perm: 'time.admin',
    handler: async ({ db, params, audit }) => {
      const d = isoDate.safeParse(params.date);
      if (!d.success) throw badRequest('Invalid date');
      const r = await db.query('delete from tm.public_holiday where holiday_date = $1 returning holiday_date', [d.data]);
      if (!r.rowCount) throw notFound('Holiday not found');
      await audit('holiday.removed', 'holiday', d.data, {});
      return { ok: true };
    },
  });

  registerLeaveRoutes(svc);
}
