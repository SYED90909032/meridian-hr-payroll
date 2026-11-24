import { buildSif, calculate, ENGINE_HASH, hashOf, PACK_REGISTRY, sha256Hex, type PayrollCalcInputV1, type PayrollResultV1 } from '@meridian/engine';
import type { Ctx, Db } from '../../db/tx.js';
import type { Kms } from '../../crypto/kms.js';
import { open } from '../../crypto/kms.js';
import { HttpError, conflict, notFound } from '../../errors.js';
import { subjectKey } from '../people/lib.js';
import { tenantTime } from '../time/attendance.js';
import { buildInputs, LOCK_CODES, type RunRow } from './inputs.js';

export const packFor = (packId: string) => (PACK_REGISTRY as Record<string, { pack: ReturnType<typeof import('@meridian/engine').compilePack>; assurance: string }>)[packId];

export async function loadRun(db: Db, id: string, lock = false): Promise<RunRow> {
  const r = await db.query<RunRow>(`select id, tenant_id, pay_group_id, period_start::text, period_end::text, run_type, mode, scope_key, status, pack_id, pack_version, pack_hash, engine_hash,
      input_set_hash, result_set_hash, bank_file_hash, prepared_by, input_gen, version from pay.pay_run where id = $1 ${lock ? 'for update' : ''}`, [id]);
  if (!r.rows[0]) throw notFound('Pay run not found');
  return r.rows[0];
}

export async function move(db: Db, run: RunRow, to: string, reason?: string, extra: Record<string, unknown> = {}): Promise<void> {
  await db.query(`select set_config('app.transition_reason', $1, true)`, [reason ?? '']);
  const cols = Object.keys(extra);
  const sets = ['status = $3', ...cols.map((c, i) => `${c} = $${i + 4}`)];
  const r = await db.query(`update pay.pay_run set ${sets.join(', ')} where id = $1 and status = $2 returning id`, [run.id, run.status, to, ...cols.map((c) => extra[c])]);
  if (!r.rowCount) throw conflict('The pay run changed while you were working. Reload and try again.', 'run_changed');
}

/** Locks inputs: builds one immutable snapshot per eligible employee for the run's current input generation. */
export async function lockInputs(db: Db, ctx: Ctx, run: RunRow): Promise<{ employees: number; exceptions: number }> {
  const tt = await tenantTime(db, ctx.tenantId);
  const { inputs, exceptions } = await buildInputs(db, run, tt);
  await db.query(`update pay.payroll_exception set status = 'resolved' where pay_run_id = $1 and status = 'open'`, [run.id]);
  for (const b of inputs) {
    await db.query('insert into pay.payroll_input_snapshot (tenant_id, pay_run_id, employee_id, input, input_hash, gen) values ($1, $2, $3, $4::jsonb, $5, $6)', [ctx.tenantId, run.id, b.employeeId, JSON.stringify(b.input), b.inputHash, run.input_gen]);
  }
  for (const x of exceptions) {
    await db.query('insert into pay.payroll_exception (tenant_id, pay_run_id, employee_id, code, severity, message) values ($1, $2, $3, $4, $5, $6)', [ctx.tenantId, run.id, x.employeeId, x.code, x.severity, x.message]);
  }
  const inputSetHash = hashOf({ run: run.id, gen: run.input_gen, inputs: inputs.map((b) => [b.employeeId, b.inputHash]).sort() });
  await move(db, run, 'inputs_locked', undefined, { input_set_hash: inputSetHash });
  return { employees: inputs.length, exceptions: exceptions.length };
}

export async function calculateRun(db: Db, ctx: Ctx, run: RunRow): Promise<{ ok: number; excluded: number; resultSetHash: string }> {
  const reg = packFor(run.pack_id);
  if (!reg) throw new HttpError(422, 'pack_unknown', 'The pay group uses a rule pack that is not installed');
  const snaps = (await db.query<{ employee_id: string; input: PayrollCalcInputV1; input_hash: string }>(
    'select employee_id, input, input_hash from pay.payroll_input_snapshot where pay_run_id = $1 and gen = $2 order by employee_id', [run.id, run.input_gen])).rows;
  // Keep exceptions raised at lock time; replace those raised by an earlier calculation.
  await db.query(`update pay.payroll_exception set status = 'resolved' where pay_run_id = $1 and status = 'open' and code <> all($2)`, [run.id, [...LOCK_CODES]]);
  await db.query('update pay.pay_result set is_current = false where pay_run_id = $1 and is_current', [run.id]);
  let ok = 0, excluded = 0;
  const hashes: [string, string][] = [];
  for (const s of snaps) {
    const res: PayrollResultV1 = calculate(s.input, reg.pack);
    await db.query(
      `insert into pay.pay_result (tenant_id, pay_run_id, employee_id, input_hash, engine_hash, pack_hash, result, status, gross_minor, net_minor, result_hash, is_current)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, true)
       on conflict (pay_run_id, employee_id, input_hash, engine_hash, pack_hash) do update set is_current = true`,
      [ctx.tenantId, run.id, s.employee_id, res.meta.input_hash, res.meta.engine_hash, res.meta.pack_hash, JSON.stringify(res), res.status, res.totals.gross_minor, res.totals.net_minor, res.result_hash]);
    hashes.push([s.employee_id, res.result_hash]);
    if (res.status === 'ok') ok++; else excluded++;
    for (const x of res.exceptions) {
      await db.query('insert into pay.payroll_exception (tenant_id, pay_run_id, employee_id, code, severity, message) values ($1, $2, $3, $4, $5, $6)', [ctx.tenantId, run.id, s.employee_id, x.code, x.severity, x.message]);
    }
  }
  const resultSetHash = hashOf({ run: run.id, gen: run.input_gen, engine: ENGINE_HASH, pack: reg.pack.packHash, results: hashes.sort() });
  await db.query('update pay.pay_run set pack_hash = $2, engine_hash = $3, calculated_at = now() where id = $1', [run.id, reg.pack.packHash, ENGINE_HASH]);
  await move(db, { ...run, pack_hash: reg.pack.packHash }, 'calculated', undefined, { result_set_hash: resultSetHash });
  return { ok, excluded, resultSetHash };
}

/** The hash that approvers sign. Recomputed from stored rows so that it cannot drift from what they saw. */
export async function currentResultSetHash(db: Db, run: RunRow): Promise<string> {
  const r = await db.query<{ employee_id: string; result_hash: string }>('select employee_id, result_hash from pay.pay_result where pay_run_id = $1 and is_current order by employee_id', [run.id]);
  const row = await db.query<{ pack_hash: string; engine_hash: string }>('select pack_hash, engine_hash from pay.pay_run where id = $1', [run.id]);
  return hashOf({ run: run.id, gen: run.input_gen, engine: row.rows[0]!.engine_hash, pack: row.rows[0]!.pack_hash, results: r.rows.map((x) => [x.employee_id, x.result_hash]).sort() });
}

export interface FinaliseOutput { payslips: number; sifRows: number; bankFileHash: string | null }

/** Freezes payslips and builds the payment file from the stored results. Everything here reads the current, hash-bound result set. */
export async function finaliseRun(db: Db, ctx: Ctx, kms: Kms, run: RunRow): Promise<FinaliseOutput> {
  const grp = (await db.query<{ employer_id: string | null; employer_routing: string | null; currency: string }>('select employer_id, employer_routing, currency from pay.pay_group where id = $1', [run.pay_group_id])).rows[0];
  if (!grp) throw notFound('Pay group not found');
  if (await currentResultSetHash(db, run) !== run.result_set_hash) throw conflict('The results changed after approval. Start the review again.', 'results_changed');

  const rows = (await db.query<{ employee_id: string; result: PayrollResultV1; input_hash: string; employee_no: string; first_name: string; last_name: string; job_title: string | null }>(
    `select r.employee_id, r.result, r.input_hash, e.employee_no, e.first_name, e.last_name, e.job_title
       from pay.pay_result r join people.employee e on e.id = r.employee_id where r.pay_run_id = $1 and r.is_current and r.status = 'ok' order by e.employee_no`, [run.id])).rows;
  const snapIn = new Map((await db.query<{ employee_id: string; input: PayrollCalcInputV1 }>('select employee_id, input from pay.payroll_input_snapshot where pay_run_id = $1 and gen = $2', [run.id, run.input_gen])).rows.map((s) => [s.employee_id, s.input]));

  let payslips = 0;
  for (const r of rows) {
    const t = r.result.totals;
    const content = {
      template: 'payslip.v1',
      employee: { id: r.employee_id, employee_no: r.employee_no, name: `${r.first_name} ${r.last_name}`, job_title: r.job_title },
      period: { start: run.period_start, end: run.period_end, days_payable: snapIn.get(r.employee_id)?.period.days_payable ?? null, days_in_period: snapIn.get(r.employee_id)?.period.days_in_period ?? null },
      run: { type: run.run_type, mode: run.mode },
      currency: r.result.currency, exponent: r.result.exponent,
      lines: r.result.lines.filter((l) => l.kind === 'earning' || l.kind === 'deduction').map((l) => ({ code: l.code, label: l.label, kind: l.kind, amount_minor: l.amount_minor, explain: l.explain })),
      employer_contributions: r.result.lines.filter((l) => l.kind === 'employer').map((l) => ({ code: l.code, label: l.label, amount_minor: l.amount_minor })),
      totals: { gross_minor: t.gross_minor, deductions_minor: t.deductions_minor, net_minor: t.net_minor },
      provenance: { result_hash: r.result.result_hash, input_hash: r.input_hash, pack: `${r.result.meta.pack_id}@${r.result.meta.pack_version}`, pack_hash: r.result.meta.pack_hash, engine_hash: r.result.meta.engine_hash },
    };
    await db.query('insert into pay.payslip (tenant_id, pay_run_id, employee_id, template_version, content, content_hash) values ($1, $2, $3, $4, $5::jsonb, $6) on conflict (pay_run_id, employee_id) do nothing',
      [ctx.tenantId, run.id, r.employee_id, 'payslip.v1', JSON.stringify(content), hashOf(content)]);
    payslips++;
  }

  // Payment file. Built only for employees with bank details and a WPS code. Missing data was raised as an exception at lock time.
  let sifRows = 0;
  let bankFileHash: string | null = null;
  if (grp.employer_id && grp.employer_routing && run.pack_id === 'ae-private-sector') {
    const sif = [];
    for (const r of rows) {
      if (r.result.totals.net_minor <= 0) continue;
      const bank = (await db.query<{ routing_code: string; iban_enc: Buffer }>('select routing_code, iban_enc from people.employee_bank where employee_id = $1 and superseded_at is null', [r.employee_id])).rows[0];
      const priv = (await db.query<{ wps_uid_enc: Buffer | null }>('select wps_uid_enc from people.employee_private where employee_id = $1', [r.employee_id])).rows[0];
      const key = await subjectKey(db, kms, ctx.tenantId, r.employee_id, false);
      if (!bank || !priv?.wps_uid_enc || !key) {
        if (run.mode !== 'sandbox') throw new HttpError(422, 'payment_data_missing', `Bank or WPS data is missing for ${r.first_name} ${r.last_name}`);
        continue;
      }
      const variable = Math.min(r.result.totals.variable_earnings_minor, r.result.totals.net_minor);
      const inp = snapIn.get(r.employee_id)!;
      sif.push({
        employee_uid: open(key, priv.wps_uid_enc, `${r.employee_id}:wps_uid`).toString('utf8'), agent_routing: bank.routing_code, iban: open(key, bank.iban_enc, `${r.employee_id}:iban`).toString('utf8'),
        pay_start: run.period_start, pay_end: run.period_end, days_in_period: inp.period.days_in_period, fixed_minor: r.result.totals.net_minor - variable, variable_minor: variable,
        unpaid_leave_days: Math.round(inp.attendance.unpaid_leave_days_x1000 / 1000),
      });
    }
    if (sif.length) {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const content = buildSif({
        employer_id: grp.employer_id, employer_routing: grp.employer_routing, file_date: now.toISOString().slice(0, 10), file_time: pad(now.getUTCHours()) + pad(now.getUTCMinutes()),
        salary_month: run.period_end.slice(5, 7) + run.period_end.slice(0, 4), employer_ref: run.id.replace(/-/g, '').slice(0, 20),
      }, sif);
      bankFileHash = sha256Hex(content);
      await db.query('insert into pay.payment_file (tenant_id, pay_run_id, format, content, content_hash) values ($1, $2, $3, $4, $5)', [ctx.tenantId, run.id, 'wps_sif', content, bankFileHash]);
      sifRows = sif.length;
    }
  } else if (run.mode !== 'sandbox') {
    throw new HttpError(422, 'payment_file_unavailable', 'This pay group has no employer WPS details, so no payment file can be built');
  }
  await move(db, run, 'finalised', undefined, bankFileHash ? { bank_file_hash: bankFileHash } : {});
  return { payslips, sifRows, bankFileHash };
}
