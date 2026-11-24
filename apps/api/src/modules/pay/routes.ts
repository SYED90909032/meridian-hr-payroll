import { z } from 'zod';
import { PACK_REGISTRY } from '@meridian/engine';
import { defineRoute, type Services } from '../../http/route.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { isoDate, pid, short, uuid } from '../../http/schemas.js';
import { notifyEmployee, notifyRoles, notifyUser } from '../flow/notify.js';
import { calculateRun, currentResultSetHash, finaliseRun, loadRun, lockInputs, move, packFor } from './service.js';
import { registerPayslipRoutes } from './payslips.js';

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
const RUN_COLS = `r.id, r.pay_group_id, g.name as pay_group_name, r.period_start::text, r.period_end::text, r.run_type, r.mode, r.scope_key, r.status, r.pack_id, r.pack_version, r.pack_hash, r.engine_hash,
  r.input_set_hash, r.result_set_hash, r.bank_file_hash, r.prepared_by, r.created_at, r.locked_at, r.calculated_at, r.finalised_at, r.version`;

export function registerPayRoutes(svc: Services): void {
  const { kms } = svc;

  // ---------------------------------------------------------------- packs and groups
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/packs', summary: 'Rule packs installed and their assurance', tag: 'Payroll', auth: 'session', perm: 'pay.view',
    handler: async ({ db }) => {
      const reg = (await db.query('select pack_id, version, pack_hash, assurance, reviewer, reviewed_at, notes from pay.pack_registry order by pack_id, version')).rows;
      const params = Object.fromEntries(Object.entries(PACK_REGISTRY).map(([id, p]) => [id, Object.entries(p.pack.source.params).map(([k, v]) => ({ key: k, value: v.value, status: v.status, source: v.source }))]));
      return { packs: reg, params, note: 'Live payment is blocked unless the pack is registered at assurance L2 or L3 with a named reviewer. This is changed by a human process outside the app.' };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/groups', summary: 'Pay groups', tag: 'Payroll', auth: 'session', perm: 'pay.view',
    handler: async ({ db }) => ({ groups: (await db.query('select id, name, country, currency, pack_id, employer_id, employer_routing, pay_day, active from pay.pay_group order by name')).rows }),
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/groups', summary: 'Create a pay group', tag: 'Payroll', auth: 'session', perm: 'pay.admin',
    body: z.object({ name: short(100), packId: z.string().max(60), employerId: z.string().regex(/^[A-Za-z0-9]{13,35}$/).optional(), employerRouting: z.string().regex(/^\d{9}$/).optional(), payDay: z.number().int().min(1).max(31).default(28) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const reg = packFor(body.packId);
      if (!reg) throw badRequest('Unknown rule pack');
      const src = reg.pack.source;
      const r = await db.query('insert into pay.pay_group (tenant_id, name, country, currency, pack_id, employer_id, employer_routing, pay_day) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
        [ctx.tenantId, body.name, src.jurisdiction, src.currency.code, src.id, body.employerId ?? null, body.employerRouting ?? null, body.payDay]);
      await audit('pay_group.created', 'pay_group', r.rows[0].id, { name: body.name, pack: src.id });
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });

  // ---------------------------------------------------------------- single-admin policy exception (ADR-006)
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/policy', summary: 'Payroll policy exceptions in force', tag: 'Payroll', auth: 'session', perm: 'pay.view',
    handler: async ({ db }) => ({ exceptions: (await db.query('select id, kind, active, second_contact_email, created_at from pay.payroll_policy_exception order by created_at desc')).rows }),
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/policy/single-admin', summary: 'Allow one person to prepare and approve payroll (flagged, 24 hour release delay)', tag: 'Payroll', auth: 'session', perm: 'settings.manage', stepUp: true,
    body: z.object({ secondContactEmail: z.string().trim().toLowerCase().email().max(254), acknowledge: z.literal(true) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const r = await db.query('insert into pay.payroll_policy_exception (tenant_id, kind, second_contact_email, created_by) values ($1, $2, $3, $4) on conflict do nothing returning id', [ctx.tenantId, 'single_admin', body.secondContactEmail, ctx.userId]);
      if (!r.rowCount) throw conflict('This exception is already active');
      await audit('pay.policy_exception_enabled', 'tenant', ctx.tenantId, { kind: 'single_admin', second_contact: body.secondContactEmail });
      await notifyRoles(db, ctx.tenantId, ['owner', 'auditor'], { kind: 'pay.policy', title: 'Single-admin payroll exception enabled', body: 'Approvals by the preparer are flagged and delayed 24 hours.' }, ctx.userId);
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });
  defineRoute(svc, {
    method: 'DELETE', path: '/api/v1/pay/policy/single-admin', summary: 'Switch the single-admin exception off', tag: 'Payroll', auth: 'session', perm: 'settings.manage', stepUp: true,
    handler: async ({ db, audit }) => {
      await db.query(`update pay.payroll_policy_exception set active = false where kind = 'single_admin' and active`);
      await audit('pay.policy_exception_disabled', 'tenant', null, { kind: 'single_admin' });
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- adjustments
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/adjustments', summary: 'One-off earnings and deductions', tag: 'Payroll', auth: 'session', perm: 'pay.view',
    query: z.object({ from: isoDate.optional(), to: isoDate.optional(), employeeId: uuid.optional() }),
    handler: async ({ db, query }) => {
      const r = await db.query(
        `select a.id, a.employee_id, e.first_name, e.last_name, a.effective_date::text, a.code, a.label, a.kind, a.amount_minor::float8 as amount_minor, a.voluntary, a.variable, a.voided_at, a.created_at
           from pay.adjustment a join people.employee e on e.id = a.employee_id
          where ($1::date is null or a.effective_date >= $1) and ($2::date is null or a.effective_date <= $2) and ($3::uuid is null or a.employee_id = $3) order by a.effective_date desc, a.created_at desc limit 300`,
        [query.from ?? null, query.to ?? null, query.employeeId ?? null]);
      return { adjustments: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/adjustments', summary: 'Add a one-off earning or deduction', tag: 'Payroll', auth: 'session', perm: 'pay.prepare', idempotent: 'optional',
    body: z.object({ employeeId: uuid, effectiveDate: isoDate, code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/), label: short(80), kind: z.enum(['earning', 'deduction']), amountMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), voluntary: z.boolean().default(true), variable: z.boolean().default(true) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      if (!(await db.query('select 1 from people.employee where id = $1', [body.employeeId])).rowCount) throw notFound('Employee not found');
      const r = await db.query('insert into pay.adjustment (tenant_id, employee_id, effective_date, code, label, kind, amount_minor, voluntary, variable, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id',
        [ctx.tenantId, body.employeeId, body.effectiveDate, body.code, body.label, body.kind, body.amountMinor, body.voluntary, body.variable, ctx.userId]);
      await audit('pay.adjustment_added', 'employee', body.employeeId, { id: r.rows[0].id, code: body.code, kind: body.kind, amount_minor: body.amountMinor });
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/adjustments/:id/void', summary: 'Void an adjustment (takes effect in the next locked run)', tag: 'Payroll', auth: 'session', perm: 'pay.prepare',
    handler: async ({ db, ctx, params, audit }) => {
      const r = await db.query('update pay.adjustment set voided_at = now(), voided_by = $2 where id = $1 and voided_at is null returning employee_id', [pid(params.id), ctx.userId]);
      if (!r.rowCount) throw notFound('Adjustment not found');
      await audit('pay.adjustment_voided', 'employee', r.rows[0].employee_id, { id: params.id });
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- runs
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/runs', summary: 'Pay runs', tag: 'Payroll', auth: 'session', perm: 'pay.view',
    handler: async ({ db }) => ({ runs: (await db.query(`select ${RUN_COLS} from pay.pay_run r join pay.pay_group g on g.id = r.pay_group_id order by r.period_start desc, r.created_at desc limit 100`)).rows }),
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs', summary: 'Start a pay run', tag: 'Payroll', auth: 'session', perm: 'pay.prepare', idempotent: 'optional',
    body: z.object({ payGroupId: uuid, periodStart: isoDate, periodEnd: isoDate, runType: z.enum(['regular', 'final', 'off_cycle']).default('regular'), mode: z.enum(['sandbox', 'parallel', 'live']).default('sandbox'), employeeId: uuid.optional() }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const len = daysBetween(body.periodStart, body.periodEnd) + 1;
      if (len < 1 || len > 31) throw badRequest('A pay period is between 1 and 31 days');
      if (body.runType !== 'regular' && !body.employeeId) throw badRequest('Final and off-cycle runs are for one employee');
      const g = (await db.query<{ pack_id: string; active: boolean }>('select pack_id, active from pay.pay_group where id = $1', [body.payGroupId])).rows[0];
      if (!g || !g.active) throw notFound('Pay group not found');
      const reg = packFor(g.pack_id);
      if (!reg) throw new HttpError(422, 'pack_unknown', 'The rule pack is not installed');
      if (body.employeeId && !(await db.query('select 1 from people.employee where id = $1', [body.employeeId])).rowCount) throw notFound('Employee not found');
      const r = await db.query(
        `insert into pay.pay_run (tenant_id, pay_group_id, period_start, period_end, run_type, mode, scope_key, pack_id, pack_version, pack_hash, prepared_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [ctx.tenantId, body.payGroupId, body.periodStart, body.periodEnd, body.runType, body.mode, body.employeeId ? `emp:${body.employeeId}` : 'all', reg.pack.source.id, reg.pack.source.version, reg.pack.packHash, ctx.userId]);
      await audit('pay_run.created', 'pay_run', r.rows[0].id, { period: [body.periodStart, body.periodEnd], type: body.runType, mode: body.mode });
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/runs/:id', summary: 'One pay run with results, exceptions and approvals', tag: 'Payroll', auth: 'session', perm: 'pay.view',
    handler: async ({ db, params }) => {
      const id = pid(params.id);
      const run = (await db.query(`select ${RUN_COLS} from pay.pay_run r join pay.pay_group g on g.id = r.pay_group_id where r.id = $1`, [id])).rows[0];
      if (!run) throw notFound('Pay run not found');
      const events = (await db.query('select from_status, to_status, actor_user_id, reason, at from pay.run_event where pay_run_id = $1 order by at', [id])).rows;
      const exceptions = (await db.query(`select x.id, x.employee_id, e.first_name, e.last_name, x.code, x.severity, x.message, x.status, x.waived_reason from pay.payroll_exception x left join people.employee e on e.id = x.employee_id where x.pay_run_id = $1 and x.status <> 'resolved' order by x.severity, x.created_at`, [id])).rows;
      const approvals = (await db.query(`select a.id, a.kind, a.approver_id, u.display_name, a.flagged_self_approval, a.release_not_before, a.voided_at, a.created_at from pay.pay_run_approval a left join kernel.membership u on u.user_id = a.approver_id where a.pay_run_id = $1 order by a.created_at`, [id])).rows;
      const totals = (await db.query(
        `select count(*) filter (where status = 'ok')::int as employees, count(*) filter (where status = 'excluded')::int as excluded,
                coalesce(sum(gross_minor) filter (where status = 'ok'), 0)::float8 as gross_minor, coalesce(sum(net_minor) filter (where status = 'ok'), 0)::float8 as net_minor,
                coalesce(sum((result->'totals'->>'deductions_minor')::bigint) filter (where status = 'ok'), 0)::float8 as deductions_minor,
                coalesce(sum((result->'totals'->>'employer_cost_minor')::bigint) filter (where status = 'ok'), 0)::float8 as employer_cost_minor
           from pay.pay_result where pay_run_id = $1 and is_current`, [id])).rows[0];
      const pf = (await db.query(`select content_hash, created_at, (length(content) - length(replace(content, E'\\n', '')))::int as lines from pay.payment_file where pay_run_id = $1`, [id])).rows[0];
      const assurance = (await db.query('select assurance from pay.pack_registry where pack_id = $1 and version = $2 and pack_hash = $3', [run.pack_id, run.pack_version, run.pack_hash])).rows[0]?.assurance ?? 'none';
      return { run, events, exceptions, approvals, totals, paymentFile: pf ? { hash: pf.content_hash, createdAt: pf.created_at, employees: Math.max(0, pf.lines - 1) } : null, packAssurance: assurance,
        livePaymentAllowed: assurance === 'L2' || assurance === 'L3' };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/runs/:id/results', summary: 'Results per employee', tag: 'Payroll', auth: 'session', perm: 'pay.view',
    handler: async ({ db, params, audit }) => {
      const id = pid(params.id);
      const r = await db.query(
        `select r.employee_id, e.employee_no, e.first_name, e.last_name, r.status, r.gross_minor::float8 as gross_minor, r.net_minor::float8 as net_minor, r.result_hash, r.result
           from pay.pay_result r join people.employee e on e.id = r.employee_id where r.pay_run_id = $1 and r.is_current order by e.employee_no`, [id]);
      await audit('pay_run.results_viewed', 'pay_run', id, { rows: r.rowCount });
      return { results: r.rows };
    },
  });

  const run = async (db: import('../../db/tx.js').Db, id: string | undefined) => loadRun(db, pid(id), true);
  const need = (r: { status: string }, ...ok: string[]) => { if (!ok.includes(r.status)) throw new HttpError(409, 'wrong_state', `This pay run is ${r.status.replace('_', ' ')}. That action is not available now.`); };

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/lock-inputs', summary: 'Lock inputs: snapshot every employee', tag: 'Payroll', auth: 'session', perm: 'pay.prepare', actors: ['payroll'],
    handler: async ({ db, ctx, params, audit }) => {
      const r = await run(db, params.id); need(r, 'draft');
      const out = await lockInputs(db, ctx, r);
      await audit('pay_run.inputs_locked', 'pay_run', r.id, out);
      return out;
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/unlock', summary: 'Go back to draft to change inputs (starts a new input generation)', tag: 'Payroll', auth: 'session', perm: 'pay.prepare', actors: ['payroll'],
    handler: async ({ db, params, audit }) => {
      const r = await run(db, params.id); need(r, 'inputs_locked', 'rejected');
      await move(db, r, 'draft', 'unlock', { input_gen: r.input_gen + 1, input_set_hash: null });
      await audit('pay_run.unlocked', 'pay_run', r.id, {});
      return { ok: true };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/calculate', summary: 'Calculate with the rule pack', tag: 'Payroll', auth: 'session', perm: 'pay.prepare', actors: ['payroll'],
    handler: async ({ db, ctx, params, audit }) => {
      const r = await run(db, params.id); need(r, 'inputs_locked');
      const out = await calculateRun(db, ctx, r);
      await audit('pay_run.calculated', 'pay_run', r.id, out);
      return out;
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/reopen', summary: 'Reopen for changes. Voids any approval.', tag: 'Payroll', auth: 'session', perm: 'pay.prepare', actors: ['payroll'],
    body: z.object({ reason: z.string().trim().min(5).max(300) }).strict(),
    handler: async ({ db, params, body, audit }) => {
      const r = await run(db, params.id); need(r, 'calculated', 'in_review', 'approved', 'rejected');
      await move(db, r, 'inputs_locked', body.reason);
      await audit('pay_run.reopened', 'pay_run', r.id, { reason: body.reason });
      return { ok: true };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/submit', summary: 'Send for approval', tag: 'Payroll', auth: 'session', perm: 'pay.prepare', actors: ['payroll'],
    handler: async ({ db, ctx, params, audit }) => {
      const r = await run(db, params.id); need(r, 'calculated');
      const open = await db.query(`select count(*)::int as n from pay.payroll_exception where pay_run_id = $1 and status = 'open' and severity = 'blocking'`, [r.id]);
      await move(db, r, 'in_review');
      await notifyRoles(db, ctx.tenantId, ['payroll_approver', 'owner'], { kind: 'pay.review', title: 'Pay run waiting for approval', body: `${r.period_start} to ${r.period_end}`, link: `/payroll/${r.id}` }, ctx.userId);
      await audit('pay_run.submitted', 'pay_run', r.id, { open_blocking: open.rows[0].n });
      return { ok: true, openBlocking: open.rows[0].n };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/exceptions/:xid/waive', summary: 'Accept an exception with a reason', tag: 'Payroll', auth: 'session', perm: 'pay.approve', stepUp: true, actors: ['payroll'],
    body: z.object({ reason: z.string().trim().min(5).max(300) }).strict(),
    handler: async ({ db, ctx, params, body, audit }) => {
      const r = await run(db, params.id); need(r, 'calculated', 'in_review');
      const single = (await db.query(`select 1 from pay.payroll_policy_exception where kind = 'single_admin' and active`)).rowCount;
      if (r.prepared_by === ctx.userId && !single) throw forbidden('The person who prepared the run cannot accept its exceptions');
      const u = await db.query(`update pay.payroll_exception set status = 'waived', waived_by = $3, waived_reason = $4 where id = $1 and pay_run_id = $2 and status = 'open' returning code`, [pid(params.xid), r.id, ctx.userId, body.reason]);
      if (!u.rowCount) throw notFound('Open exception not found');
      await audit('pay_run.exception_waived', 'pay_run', r.id, { code: u.rows[0].code, reason: body.reason });
      return { ok: true };
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/approve', summary: 'Approve the exact results you reviewed (needs recent step-up and two-step verification)', tag: 'Payroll', auth: 'session', perm: 'pay.approve', stepUp: true, requireMfa: true, actors: ['payroll'],
    body: z.object({ resultSetHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    handler: async ({ db, ctx, p, params, body, audit }) => {
      const r = await run(db, params.id); need(r, 'in_review');
      const blocking = (await db.query(`select count(*)::int as n from pay.payroll_exception where pay_run_id = $1 and severity = 'blocking' and status = 'open'`, [r.id])).rows[0].n as number;
      if (blocking > 0) throw new HttpError(409, 'blocking_exceptions', `${blocking} blocking exception(s) are still open. Resolve or accept each one with a reason before approving.`);
      const now = await currentResultSetHash(db, r);
      if (body.resultSetHash !== r.result_set_hash || now !== r.result_set_hash) throw new HttpError(409, 'content_changed', 'The results changed after you opened them. Reload and review again.');
      const a = await db.query('insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, step_up_at) values ($1, $2, $3, $4, $5, $6) returning flagged_self_approval, release_not_before', [ctx.tenantId, r.id, 'approve', ctx.userId, r.result_set_hash, p.stepUpAt]);
      await move(db, r, 'approved');
      await notifyUser(db, ctx.tenantId, r.prepared_by, { kind: 'pay.approved', title: 'Pay run approved', link: `/payroll/${r.id}` });
      await audit('pay_run.approved', 'pay_run', r.id, { result_set_hash: r.result_set_hash, flagged: a.rows[0].flagged_self_approval });
      return { ok: true, flagged: a.rows[0].flagged_self_approval, releaseNotBefore: a.rows[0].release_not_before };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/reject', summary: 'Send back with a reason', tag: 'Payroll', auth: 'session', perm: 'pay.approve', stepUp: true, actors: ['payroll'],
    body: z.object({ reason: z.string().trim().min(5).max(300) }).strict(),
    handler: async ({ db, ctx, params, body, audit }) => {
      const r = await run(db, params.id); need(r, 'in_review');
      await move(db, r, 'rejected', body.reason);
      await notifyUser(db, ctx.tenantId, r.prepared_by, { kind: 'pay.rejected', title: 'Pay run sent back', body: body.reason, link: `/payroll/${r.id}` });
      await audit('pay_run.rejected', 'pay_run', r.id, { reason: body.reason });
      return { ok: true };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/cancel', summary: 'Cancel a run that has not been finalised', tag: 'Payroll', auth: 'session', perm: 'pay.prepare', actors: ['payroll'],
    body: z.object({ reason: z.string().trim().min(5).max(300) }).strict(),
    handler: async ({ db, params, body, audit }) => {
      const r = await run(db, params.id); need(r, 'draft', 'inputs_locked', 'calculated', 'in_review', 'rejected');
      await move(db, r, 'cancelled', body.reason);
      await audit('pay_run.cancelled', 'pay_run', r.id, { reason: body.reason });
      return { ok: true };
    },
  });

  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/finalise', summary: 'Freeze payslips and build the payment file', tag: 'Payroll', auth: 'session', perm: 'pay.admin', stepUp: true, actors: ['payroll'],
    handler: async ({ db, ctx, params, audit }) => {
      const r = await run(db, params.id); need(r, 'approved');
      const out = await finaliseRun(db, ctx, kms, r);
      await audit('pay_run.finalised', 'pay_run', r.id, { payslips: out.payslips, payment_rows: out.sifRows, bank_file_hash: out.bankFileHash });
      return out;
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/release', summary: 'Release payment for the exact bank file. Live runs on a reviewed pack only.', tag: 'Payroll', auth: 'session', perm: 'pay.release', stepUp: true, requireMfa: true, actors: ['payroll'],
    body: z.object({ bankFileHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    handler: async ({ db, ctx, p, params, body, audit }) => {
      const r = await run(db, params.id); need(r, 'finalised');
      if (r.mode !== 'live') throw new HttpError(422, 'not_live', 'Only live pay runs release payment. This run is ' + r.mode + '.');
      if (!r.bank_file_hash || body.bankFileHash !== r.bank_file_hash) throw new HttpError(409, 'content_changed', 'The bank file does not match what you reviewed');
      await db.query('insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, bank_file_hash, step_up_at) values ($1, $2, $3, $4, $5, $6, $7)', [ctx.tenantId, r.id, 'release', ctx.userId, r.result_set_hash, r.bank_file_hash, p.stepUpAt]);
      await move(db, r, 'payment_released');
      await audit('pay_run.payment_released', 'pay_run', r.id, { bank_file_hash: r.bank_file_hash });
      return { ok: true };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/mark-paid', summary: 'Confirm the bank paid, with evidence', tag: 'Payroll', auth: 'session', perm: 'pay.release', stepUp: true, actors: ['payroll'],
    body: z.object({ kind: z.enum(['bank_confirmation', 'return_file', 'manual']), evidence: z.string().trim().min(5).max(500) }).strict(),
    handler: async ({ db, ctx, params, body, audit }) => {
      const r = await run(db, params.id); need(r, 'payment_released');
      await db.query('insert into pay.reconciliation (tenant_id, pay_run_id, kind, evidence, confirmed_by) values ($1, $2, $3, $4, $5)', [ctx.tenantId, r.id, body.kind, body.evidence, ctx.userId]);
      await move(db, r, 'paid');
      await audit('pay_run.paid', 'pay_run', r.id, { kind: body.kind });
      return { ok: true };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/publish', summary: 'Publish payslips to employees', tag: 'Payroll', auth: 'session', perm: 'pay.admin', actors: ['payroll'],
    handler: async ({ db, ctx, params, audit }) => {
      const r = await run(db, params.id);
      need(r, r.mode === 'live' ? 'paid' : 'finalised');
      await move(db, r, 'published');
      const ps = await db.query(`update pay.payslip set published_at = now(), storage_status = 'confirmed' where pay_run_id = $1 and published_at is null returning employee_id`, [r.id]);
      for (const row of ps.rows) await notifyEmployee(db, ctx.tenantId, row.employee_id, { kind: 'payslip.published', title: 'Your payslip is ready', body: `${r.period_start} to ${r.period_end}`, link: '/me/payslips' });
      await audit('pay_run.published', 'pay_run', r.id, { payslips: ps.rowCount });
      return { published: ps.rowCount };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/pay/runs/:id/reverse', summary: 'Reverse a finalised run. Payslips stay on record; correct with a new run.', tag: 'Payroll', auth: 'session', perm: 'pay.admin', stepUp: true, actors: ['payroll'],
    body: z.object({ reason: z.string().trim().min(10).max(500) }).strict(),
    handler: async ({ db, ctx, params, body, audit }) => {
      const r = await run(db, params.id); need(r, 'finalised', 'payment_released', 'paid', 'published');
      await move(db, r, 'reversed', body.reason);
      await notifyRoles(db, ctx.tenantId, ['owner', 'payroll_approver', 'auditor'], { kind: 'pay.reversed', title: 'Pay run reversed', body: body.reason, link: `/payroll/${r.id}` }, ctx.userId);
      await audit('pay_run.reversed', 'pay_run', r.id, { reason: body.reason, was: r.status });
      return { ok: true };
    },
  });

  registerPayslipRoutes(svc);
}
