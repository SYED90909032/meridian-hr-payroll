import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { badRequest, conflict, forbidden, notFound, HttpError } from '../../errors.js';
import { open, seal } from '../../crypto/kms.js';
import { sha256hex } from '../../crypto/tokens.js';
import { emiratesIdValid, ibanValid, magicMatches, normaliseIban, subjectKey } from './lib.js';
import { notifyEmployee, notifyRoles } from '../flow/notify.js';
import type { Db } from '../../db/tx.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), 'Invalid date');
const short = (n: number) => z.string().trim().min(1).max(n);
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const EMP_COLS = `e.id, e.employee_no, e.first_name, e.last_name, e.work_email::text as work_email, e.org_unit_id, ou.name as org_unit_name, e.manager_id,
  (m.first_name || ' ' || m.last_name) as manager_name, e.job_title, e.status, e.employment_type, e.hire_date, e.termination_date, e.is_uae_national, e.nationality, e.version`;
const EMP_FROM = `people.employee e left join people.org_unit ou on ou.id = e.org_unit_id left join people.employee m on m.id = e.manager_id`;

function pid(v: string | undefined): string {
  const r = uuid.safeParse(v);
  if (!r.success) throw badRequest('Invalid id');
  return r.data;
}

/** Self or a role with the permission. The database applies the same rule to the rows. */
const isSelf = (p: { employeeId: string | null }, id: string) => !!p.employeeId && p.employeeId === id;

async function mustExist(db: Db, id: string): Promise<{ id: string; status: string }> {
  const r = await db.query('select id, status from people.employee where id = $1', [id]);
  if (!r.rows[0]) throw notFound('Employee not found');
  return r.rows[0];
}

export function registerPeopleRoutes(svc: Services): void {
  const { kms, pools } = svc;

  // ---------------------------------------------------------------- directory
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/people/employees', summary: 'Employee directory', tag: 'People', auth: 'any',
    query: z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['active', 'on_leave', 'terminated']).optional(), orgUnitId: uuid.optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) }),
    handler: async ({ db, query }) => {
      const where: string[] = []; const args: unknown[] = [];
      if (query.q) { args.push(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`); where.push(`(e.first_name || ' ' || e.last_name ilike $${args.length} or e.employee_no ilike $${args.length} or e.job_title ilike $${args.length})`); }
      if (query.status) { args.push(query.status); where.push(`e.status = $${args.length}`); }
      if (query.orgUnitId) { args.push(query.orgUnitId); where.push(`e.org_unit_id in (select app.org_descendants(e.tenant_id, $${args.length}))`); }
      args.push(query.limit, query.offset);
      const sql = `select ${EMP_COLS}, count(*) over()::int as total from ${EMP_FROM} ${where.length ? 'where ' + where.join(' and ') : ''} order by e.last_name, e.first_name limit $${args.length - 1} offset $${args.length}`;
      const r = await db.query(sql, args);
      return { employees: r.rows.map(({ total: _t, ...e }) => e), total: r.rows[0]?.total ?? 0 };
    },
  });

  defineRoute(svc, {
    method: 'GET', path: '/api/v1/people/employees/:id', summary: 'One employee', tag: 'People', auth: 'any',
    handler: async ({ db, params, p }) => {
      const id = pid(params.id);
      const r = await db.query(`select ${EMP_COLS} from ${EMP_FROM} where e.id = $1`, [id]);
      if (!r.rows[0]) throw notFound('Employee not found');
      const ev = await db.query('select kind, effective_date, detail, created_at from people.employee_event where employee_id = $1 order by created_at desc limit 50', [id]);
      const reports = await db.query(`select id, first_name, last_name, job_title from people.employee where manager_id = $1 and status <> 'terminated' order by last_name`, [id]);
      return { employee: r.rows[0], events: p.perms.has('people.read') || isSelf(p, id) ? ev.rows : [], directReports: reports.rows };
    },
  });

  const empBody = z.object({
    firstName: short(80), lastName: short(80), workEmail: z.string().trim().toLowerCase().email().max(254).optional(), orgUnitId: uuid.optional(), managerId: uuid.optional(),
    jobTitle: short(120).optional(), employmentType: z.enum(['full_time', 'part_time', 'contractor']).default('full_time'), hireDate: isoDate,
    isUaeNational: z.boolean().default(false), nationality: short(60).optional(),
  }).strict();

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/people/employees', summary: 'Create an employee', tag: 'People', auth: 'session', perm: 'people.write', actors: ['hr'], idempotent: 'optional', body: empBody,
    handler: async ({ db, ctx, body, audit }) => {
      const n = await db.query(`select coalesce(max(substring(employee_no from 2)::int), 0) + 1 as n from people.employee where employee_no ~ '^E[0-9]+$'`);
      const no = 'E' + String(n.rows[0].n).padStart(4, '0');
      const org = body.orgUnitId ?? (await db.query(`select id from people.org_unit where code = 'ROOT'`)).rows[0]?.id ?? null;
      if (body.orgUnitId && !(await db.query('select 1 from people.org_unit where id = $1', [body.orgUnitId])).rowCount) throw badRequest('Org unit not found');
      if (body.managerId && !(await db.query('select 1 from people.employee where id = $1', [body.managerId])).rowCount) throw badRequest('Manager not found');
      const r = await db.query(
        `insert into people.employee (tenant_id, employee_no, first_name, last_name, work_email, org_unit_id, manager_id, job_title, employment_type, hire_date, is_uae_national, nationality)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id, employee_no`,
        [ctx.tenantId, no, body.firstName, body.lastName, body.workEmail ?? null, org, body.managerId ?? null, body.jobTitle ?? null, body.employmentType, body.hireDate, body.isUaeNational, body.nationality ?? null]);
      const e = r.rows[0];
      await db.query(`insert into people.employee_event (tenant_id, employee_id, kind, effective_date, detail, created_by) values ($1, $2, 'hired', $3, '{}', $4)`, [ctx.tenantId, e.id, body.hireDate, ctx.userId]);
      // Opening leave entitlement is created by the time module on the first leave query; nothing else to do here.
      await audit('employee.created', 'employee', e.id, { employee_no: e.employee_no });
      return { status: 201, body: { id: e.id, employeeNo: e.employee_no } };
    },
  });

  defineRoute(svc, {
    method: 'PATCH', path: '/api/v1/people/employees/:id', summary: 'Update an employee (optimistic version check)', tag: 'People', auth: 'session', perm: 'people.write', actors: ['hr'],
    body: z.object({ version: z.number().int().min(1), firstName: short(80).optional(), lastName: short(80).optional(), workEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
      orgUnitId: uuid.nullable().optional(), managerId: uuid.nullable().optional(), jobTitle: short(120).nullable().optional(),
      employmentType: z.enum(['full_time', 'part_time', 'contractor']).optional(), isUaeNational: z.boolean().optional(), nationality: short(60).nullable().optional(),
      status: z.enum(['active', 'on_leave']).optional(), effectiveDate: isoDate.optional() }).strict(),
    handler: async ({ db, ctx, params, body, audit }) => {
      const id = pid(params.id);
      const cur = await db.query('select * from people.employee where id = $1 for update', [id]);
      const e = cur.rows[0];
      if (!e) throw notFound('Employee not found');
      if (e.status === 'terminated') throw conflict('Terminated employees cannot be edited', 'terminated');
      if (e.version !== body.version) throw conflict('Someone else changed this record. Reload and try again.', 'version_conflict');
      const map: Record<string, [string, unknown]> = {
        firstName: ['first_name', body.firstName], lastName: ['last_name', body.lastName], workEmail: ['work_email', body.workEmail], orgUnitId: ['org_unit_id', body.orgUnitId],
        managerId: ['manager_id', body.managerId], jobTitle: ['job_title', body.jobTitle], employmentType: ['employment_type', body.employmentType],
        isUaeNational: ['is_uae_national', body.isUaeNational], nationality: ['nationality', body.nationality], status: ['status', body.status],
      };
      const sets: string[] = []; const args: unknown[] = []; const changed: string[] = [];
      for (const [k, [col, v]] of Object.entries(map)) if (v !== undefined) { args.push(v); sets.push(`${col} = $${args.length}`); changed.push(k); }
      if (!sets.length) return { id, unchanged: true };
      if (body.managerId === id) throw badRequest('A person cannot manage themselves');
      if (body.managerId && !(await db.query('select 1 from people.employee where id = $1', [body.managerId])).rowCount) throw badRequest('Manager not found');
      if (body.orgUnitId && !(await db.query('select 1 from people.org_unit where id = $1', [body.orgUnitId])).rowCount) throw badRequest('Org unit not found');
      args.push(id);
      await db.query(`update people.employee set ${sets.join(', ')} where id = $${args.length}`, args);
      const kinds = changed.filter((c) => ['orgUnitId', 'managerId', 'jobTitle'].includes(c));
      if (kinds.length) await db.query(`insert into people.employee_event (tenant_id, employee_id, kind, effective_date, detail, created_by) values ($1, $2, 'changed', $3, $4::jsonb, $5)`,
        [ctx.tenantId, id, body.effectiveDate ?? new Date().toISOString().slice(0, 10), JSON.stringify({ fields: kinds }), ctx.userId]);
      await audit('employee.updated', 'employee', id, { fields: changed });
      return { id, version: e.version + 1 };
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/people/employees/:id/terminate', summary: 'Terminate an employee', tag: 'People', auth: 'session', perm: 'people.write', stepUp: true, actors: ['hr', 'iam'],
    body: z.object({ terminationDate: isoDate, reason: short(300) }).strict(),
    handler: async ({ db, ctx, p, params, body, audit }) => {
      const id = pid(params.id);
      if (isSelf(p, id)) throw forbidden('You cannot terminate yourself');
      const cur = await db.query('select status, hire_date from people.employee where id = $1 for update', [id]);
      if (!cur.rows[0]) throw notFound('Employee not found');
      if (cur.rows[0].status === 'terminated') throw conflict('Already terminated', 'terminated');
      if (body.terminationDate < cur.rows[0].hire_date) throw badRequest('Termination date is before the hire date');
      await db.query(`update people.employee set status = 'terminated', termination_date = $2 where id = $1`, [id, body.terminationDate]);
      await db.query(`insert into people.employee_event (tenant_id, employee_id, kind, effective_date, detail, created_by) values ($1, $2, 'terminated', $3, $4::jsonb, $5)`, [ctx.tenantId, id, body.terminationDate, JSON.stringify({ reason: body.reason }), ctx.userId]);
      // Access ends with employment: suspend the membership, revoke sessions, cancel open requests.
      const mem = await db.query<{ user_id: string }>(`update kernel.membership set status = 'suspended' where employee_id = $1 returning user_id`, [id]);
      for (const m of mem.rows) await pools.auth.query('update kernel.session set revoked_at = now() where user_id = $1 and tenant_id = $2 and revoked_at is null', [m.user_id, ctx.tenantId]);
      await db.query(`update kernel.role_assignment set revoked_at = now() where user_id = any($1) and revoked_at is null`, [mem.rows.map((m) => m.user_id)]);
      await notifyRoles(db, ctx.tenantId, ['payroll_admin', 'hr_admin'], { kind: 'employee.terminated', title: 'An employee was terminated', body: `Final settlement may be needed (effective ${body.terminationDate}).`, link: `/people/${id}` }, ctx.userId);
      await audit('employee.terminated', 'employee', id, { date: body.terminationDate });
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- org
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/people/org', summary: 'Org units with headcount', tag: 'People', auth: 'any',
    handler: async ({ db }) => {
      const r = await db.query(`select o.id, o.parent_id, o.code, o.name, (select count(*)::int from people.employee e where e.org_unit_id = o.id and e.status <> 'terminated') as headcount from people.org_unit o order by o.name`);
      return { units: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/people/org', summary: 'Create an org unit', tag: 'People', auth: 'session', perm: 'org.write',
    body: z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), name: short(120), parentId: uuid.optional() }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const parent = body.parentId ?? (await db.query(`select id from people.org_unit where code = 'ROOT'`)).rows[0]?.id ?? null;
      const r = await db.query('insert into people.org_unit (tenant_id, code, name, parent_id) values ($1, $2, $3, $4) returning id', [ctx.tenantId, body.code, body.name, parent]);
      await audit('org.created', 'org_unit', r.rows[0].id, { code: body.code });
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });
  defineRoute(svc, {
    method: 'PATCH', path: '/api/v1/people/org/:id', summary: 'Rename or move an org unit', tag: 'People', auth: 'session', perm: 'org.write',
    body: z.object({ name: short(120).optional(), parentId: uuid.nullable().optional() }).strict(),
    handler: async ({ db, params, body, audit }) => {
      const id = pid(params.id);
      const sets: string[] = []; const args: unknown[] = [];
      if (body.name !== undefined) { args.push(body.name); sets.push(`name = $${args.length}`); }
      if (body.parentId !== undefined) { args.push(body.parentId); sets.push(`parent_id = $${args.length}`); }
      if (!sets.length) return { ok: true };
      args.push(id);
      const r = await db.query(`update people.org_unit set ${sets.join(', ')} where id = $${args.length} and code <> 'ROOT'`, args);
      if (!r.rowCount) throw notFound('Org unit not found, or it is the root');
      await audit('org.updated', 'org_unit', id, body);
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- compensation (class comp)
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/people/employees/:id/compensation', summary: 'Compensation history', tag: 'People', auth: 'session',
    handler: async ({ db, params, audit }) => {
      const id = pid(params.id);
      await mustExist(db, id);
      const r = await db.query('select id, lower(valid_during)::text as valid_from, upper(valid_during)::text as valid_to, basic_minor, housing_minor, transport_minor, other_minor, currency, reason, recorded_at, superseded_at from people.compensation where employee_id = $1 order by lower(valid_during) desc, recorded_at desc', [id]);
      // Rows the caller may not see are filtered by the database, so an empty list is normal for others' pay.
      if (r.rowCount) await audit('compensation.viewed', 'employee', id, {});
      return { history: r.rows.map((x) => ({ ...x, basic_minor: Number(x.basic_minor), housing_minor: Number(x.housing_minor), transport_minor: Number(x.transport_minor), other_minor: Number(x.other_minor) })) };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/people/employees/:id/compensation', summary: 'Set compensation from a date (history is kept)', tag: 'People', auth: 'session', perm: 'comp.write', stepUp: true, idempotent: 'optional',
    body: z.object({ effectiveFrom: isoDate, basic: minor, housing: minor.default(0), transport: minor.default(0), other: minor.default(0), reason: short(300) }).strict(),
    handler: async ({ db, ctx, params, body, audit }) => {
      const id = pid(params.id);
      const emp = await mustExist(db, id);
      if (emp.status === 'terminated') throw conflict('Terminated employees cannot receive new compensation', 'terminated');
      const cur = (await db.query('select currency from kernel.tenant where id = $1', [ctx.tenantId])).rows[0].currency;
      const active = await db.query(`select * from people.compensation where employee_id = $1 and superseded_at is null and valid_during && daterange($2::date, null) for update`, [id, body.effectiveFrom]);
      for (const row of active.rows) {
        await db.query('update people.compensation set superseded_at = now() where id = $1', [row.id]);
        const lowerStr = String(row.valid_during).slice(1).split(',')[0]!;
        if (lowerStr && lowerStr < body.effectiveFrom) {
          await db.query(`insert into people.compensation (tenant_id, employee_id, valid_during, basic_minor, housing_minor, transport_minor, other_minor, currency, reason, recorded_by)
            values ($1, $2, daterange($3::date, $4::date), $5, $6, $7, $8, $9, 'earlier period kept when a change took effect', $10)`,
            [ctx.tenantId, id, lowerStr, body.effectiveFrom, row.basic_minor, row.housing_minor, row.transport_minor, row.other_minor, row.currency, ctx.userId]);
        }
      }
      const ins = await db.query(`insert into people.compensation (tenant_id, employee_id, valid_during, basic_minor, housing_minor, transport_minor, other_minor, currency, reason, recorded_by)
        values ($1, $2, daterange($3::date, null), $4, $5, $6, $7, $8, $9, $10) returning id`, [ctx.tenantId, id, body.effectiveFrom, body.basic, body.housing, body.transport, body.other, cur, body.reason, ctx.userId]);
      await db.query(`insert into people.employee_event (tenant_id, employee_id, kind, effective_date, detail, created_by) values ($1, $2, 'compensation_changed', $3, '{}', $4)`, [ctx.tenantId, id, body.effectiveFrom, ctx.userId]);
      await notifyRoles(db, ctx.tenantId, ['payroll_admin', 'payroll_approver'], { kind: 'comp.changed', title: 'Compensation changed', body: `Effective ${body.effectiveFrom}. Review before the next pay run.`, link: `/people/${id}` }, ctx.userId);
      await audit('compensation.changed', 'employee', id, { effective_from: body.effectiveFrom, total_minor: body.basic + body.housing + body.transport + body.other });
      return { status: 201, body: { id: ins.rows[0].id } };
    },
  });

  // ---------------------------------------------------------------- identity data (class national_id)
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/people/employees/:id/private', summary: 'Identity details (masked unless revealed)', tag: 'People', auth: 'session',
    query: z.object({ reveal: z.enum(['1']).optional() }),
    handler: async ({ db, ctx, p, params, query, audit }) => {
      const id = pid(params.id);
      const r = await db.query('select national_id_enc, wps_uid_enc, dob::text as dob, phone, address from people.employee_private where employee_id = $1', [id]);
      const row = r.rows[0];
      if (!row) return { private: null };
      const key = await subjectKey(db, kms, ctx.tenantId, id, false);
      const dec = (b: Buffer | null, col: string) => (b && key ? open(key, b, `${id}:${col}`).toString('utf8') : null);
      const nid = dec(row.national_id_enc, 'national_id');
      const wps = dec(row.wps_uid_enc, 'wps_uid');
      const self = isSelf(p, id);
      const reveal = query.reveal === '1';
      if (reveal && !self && !p.perms.has('pii.reveal')) throw forbidden();
      if (reveal && !self) await audit('pii.revealed', 'employee', id, { fields: ['national_id', 'wps_uid'] });
      const mask = (s: string | null) => (s ? (reveal || self ? s : '•'.repeat(Math.max(0, s.length - 4)) + s.slice(-4)) : null);
      const erased = !key && (row.national_id_enc || row.wps_uid_enc);
      return { private: { nationalId: mask(nid), wpsUid: mask(wps), dob: row.dob, phone: row.phone, address: row.address, erased: !!erased } };
    },
  });
  defineRoute(svc, {
    method: 'PUT', path: '/api/v1/people/employees/:id/private', summary: 'Set identity details', tag: 'People', auth: 'session', perm: 'people.write', stepUp: true,
    body: z.object({ nationalId: z.string().trim().max(30).optional(), wpsUid: z.string().trim().regex(/^[A-Za-z0-9]{14,35}$/, 'WPS person code is 14 to 35 letters or digits').optional(),
      dob: isoDate.optional(), phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/).optional(), address: short(300).optional() }).strict(),
    handler: async ({ db, ctx, params, body, audit }) => {
      const id = pid(params.id);
      await mustExist(db, id);
      if (body.nationalId !== undefined && !emiratesIdValid(body.nationalId)) throw badRequest('Emirates ID must be 15 digits starting with 784');
      const key = (await subjectKey(db, kms, ctx.tenantId, id, true))!;
      const nidEnc = body.nationalId !== undefined ? seal(key, Buffer.from(body.nationalId.replace(/[\s-]/g, '')), `${id}:national_id`) : null;
      const nidIdx = body.nationalId !== undefined ? kms.blindIndex(ctx.tenantId, 'national_id', body.nationalId.replace(/[\s-]/g, '')) : null;
      const wpsEnc = body.wpsUid !== undefined ? seal(key, Buffer.from(body.wpsUid), `${id}:wps_uid`) : null;
      await db.query(
        `insert into people.employee_private (employee_id, tenant_id, national_id_enc, national_id_bidx, wps_uid_enc, dob, phone, address)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (employee_id) do update set
           national_id_enc = coalesce($3, people.employee_private.national_id_enc), national_id_bidx = coalesce($4, people.employee_private.national_id_bidx),
           wps_uid_enc = coalesce($5, people.employee_private.wps_uid_enc), dob = coalesce($6, people.employee_private.dob),
           phone = coalesce($7, people.employee_private.phone), address = coalesce($8, people.employee_private.address), updated_at = now()`,
        [id, ctx.tenantId, nidEnc, nidIdx, wpsEnc, body.dob ?? null, body.phone ?? null, body.address ?? null]);
      await audit('identity.updated', 'employee', id, { fields: Object.keys(body) });
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- bank (class bank)
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/people/employees/:id/bank', summary: 'Bank details (masked)', tag: 'People', auth: 'session',
    handler: async ({ db, params }) => {
      const id = pid(params.id);
      const r = await db.query('select bank_name, routing_code, iban_last4, created_at, changed_by from people.employee_bank where employee_id = $1 and superseded_at is null', [id]);
      return { bank: r.rows[0] ?? null };
    },
  });
  defineRoute(svc, {
    method: 'PUT', path: '/api/v1/people/employees/:id/bank', summary: 'Change bank details (step-up, audited, employee is notified)', tag: 'People', auth: 'session', perm: 'bank.write', stepUp: true,
    body: z.object({ bankName: short(100), routingCode: z.string().regex(/^\d{9}$/, 'Routing code is 9 digits'), iban: z.string().trim().max(40) }).strict(),
    handler: async ({ db, ctx, params, body, audit }) => {
      const id = pid(params.id);
      await mustExist(db, id);
      const iban = normaliseIban(body.iban);
      if (!/^AE\d{21}$/.test(iban) || !ibanValid(iban)) throw badRequest('Enter a valid UAE IBAN (AE + 21 digits)');
      const key = (await subjectKey(db, kms, ctx.tenantId, id, true))!;
      const idx = kms.blindIndex(ctx.tenantId, 'iban', iban);
      // The same account must not be shared by two active employees: a common payroll fraud pattern.
      const dup = await db.query('select employee_id from people.employee_bank where iban_bidx = $1 and superseded_at is null and employee_id <> $2', [idx, id]);
      if (dup.rowCount) throw new HttpError(409, 'iban_in_use', 'That account is already registered to another employee');
      await db.query('update people.employee_bank set superseded_at = now() where employee_id = $1 and superseded_at is null', [id]);
      await db.query(`insert into people.employee_bank (tenant_id, employee_id, bank_name, routing_code, iban_enc, iban_bidx, iban_last4, changed_by, step_up_verified)
        values ($1, $2, $3, $4, $5, $6, $7, $8, true)`, [ctx.tenantId, id, body.bankName, body.routingCode, seal(key, Buffer.from(iban), `${id}:iban`), idx, iban.slice(-4), ctx.userId]);
      await notifyEmployee(db, ctx.tenantId, id, { kind: 'bank.changed', title: 'Your bank details were changed', body: 'If you did not expect this, tell HR straight away.' });
      await notifyRoles(db, ctx.tenantId, ['payroll_approver', 'owner'], { kind: 'bank.changed', title: 'Employee bank details changed', link: `/people/${id}` }, ctx.userId);
      await audit('bank.changed', 'employee', id, { last4: iban.slice(-4), bank: body.bankName });
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- documents (class document)
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/people/employees/:id/documents', summary: 'Documents on file', tag: 'People', auth: 'session',
    handler: async ({ db, params }) => {
      const r = await db.query('select id, kind, name, mime, size_bytes, sha256, created_at from people.document where employee_id = $1 order by created_at desc', [pid(params.id)]);
      return { documents: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/people/employees/:id/documents', summary: 'Upload a document (base64, up to 5 MB, encrypted at rest)', tag: 'People', auth: 'session', perm: 'docs.write', bodyLimit: 8 * 1024 * 1024,
    body: z.object({ kind: z.enum(['contract', 'id_copy', 'certificate', 'letter', 'other']), name: z.string().trim().min(1).max(200).regex(/^[^\\/\x00-\x1f]+$/, 'File name has invalid characters'),
      mime: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'text/plain']), contentBase64: z.string().max(7_200_000) }).strict(),
    handler: async ({ db, ctx, params, body, audit }) => {
      const id = pid(params.id);
      await mustExist(db, id);
      const buf = Buffer.from(body.contentBase64, 'base64');
      if (buf.length < 1 || buf.length > 5 * 1024 * 1024) throw badRequest('File must be between 1 byte and 5 MB');
      if (!magicMatches(body.mime, buf)) throw badRequest('File content does not match its type');
      const key = (await subjectKey(db, kms, ctx.tenantId, id, true))!;
      const docId = crypto.randomUUID();
      await db.query('insert into people.document (id, tenant_id, employee_id, kind, name, mime, size_bytes, sha256, content_enc, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [docId, ctx.tenantId, id, body.kind, body.name, body.mime, buf.length, sha256hex(buf), seal(key, buf, `${id}:doc:${docId}`), ctx.userId]);
      await audit('document.uploaded', 'document', docId, { employee_id: id, kind: body.kind, size: buf.length });
      return { status: 201, body: { id: docId } };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/people/documents/:docId', summary: 'Download a document', tag: 'People', auth: 'session',
    handler: async ({ db, ctx, p, params, audit, reply }) => {
      const r = await db.query('select id, employee_id, name, mime, content_enc, sha256 from people.document where id = $1', [pid(params.docId)]);
      const d = r.rows[0];
      if (!d) throw notFound('Document not found');
      const key = await subjectKey(db, kms, ctx.tenantId, d.employee_id, false);
      if (!key) throw new HttpError(410, 'erased', 'This document has been erased');
      const buf = open(key, d.content_enc, `${d.employee_id}:doc:${d.id}`);
      if (sha256hex(buf) !== d.sha256) throw new Error('document integrity check failed');
      if (!isSelf(p, d.employee_id)) await audit('document.downloaded', 'document', d.id, { employee_id: d.employee_id });
      reply.header('Content-Type', d.mime).header('Content-Disposition', `attachment; filename="${d.name.replace(/["\r\n]/g, '_')}"`).header('X-Content-Type-Options', 'nosniff');
      return { body: buf };
    },
  });

  // ---------------------------------------------------------------- erasure (crypto-shredding)
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/people/employees/:id/erase-personal-data', summary: 'Destroy the person\'s encryption key (identity data and documents become unreadable)', tag: 'People', auth: 'session', perm: 'settings.manage', stepUp: true,
    body: z.object({ confirm: z.literal('ERASE') }).strict(),
    handler: async ({ db, ctx, params, audit }) => {
      const id = pid(params.id);
      const emp = await mustExist(db, id);
      if (emp.status !== 'terminated') throw conflict('Only terminated employees can be erased', 'not_terminated');
      const hold = await db.query('select 1 from kernel.legal_hold where subject_id = $1 and released_at is null', [id]);
      if (hold.rowCount) throw conflict('A legal hold prevents erasure', 'legal_hold');
      await db.query('update kernel.subject_key set wrapped_key = null, destroyed_at = now() where subject_id = $1 and destroyed_at is null', [id]);
      await db.query('update people.employee_private set dob = null, phone = null, address = null where employee_id = $1', [id]);
      await audit('employee.erased', 'employee', id, { note: 'key destroyed; payroll records retained under statutory retention' });
      return { ok: true, note: 'Payroll records are retained as the law requires. Personal identifiers and documents can no longer be read.' };
    },
  });
}
