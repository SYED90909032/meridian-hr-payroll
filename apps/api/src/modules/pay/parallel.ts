import { createHash } from 'node:crypto';
import type { Db } from '../../db/tx.js';
import { HttpError } from '../../errors.js';

export interface ExternalPayrollRow { employeeNo: string; grossMinor: number; deductionsMinor: number; netMinor: number; lines: Record<string, number> }

const integer = (v: string, field: string): number => {
  if (!/^-?\d+$/.test(v) || !Number.isSafeInteger(Number(v))) throw new HttpError(400, 'invalid_csv', `${field} must be an integer minor-unit amount`);
  return Number(v);
};

export function parseParallelCsv(csv: string): { rows: ExternalPayrollRow[]; hash: string } {
  if (csv.length > 512 * 1024 || csv.includes('\0')) throw new HttpError(400, 'invalid_csv', 'CSV is too large or contains invalid bytes');
  const raw = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (raw.length && raw[raw.length - 1] === '') raw.pop();
  if (raw[0] !== 'employee_no,gross_minor,deductions_minor,net_minor,lines') throw new HttpError(400, 'invalid_csv', 'CSV header must be employee_no,gross_minor,deductions_minor,net_minor,lines');
  if (raw.length < 2 || raw.length > 10001) throw new HttpError(400, 'invalid_csv', 'CSV must contain between 1 and 10000 employees');
  const seen = new Set<string>();
  const rows: ExternalPayrollRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const cells = raw[i]!.split(',');
    if (cells.length !== 5 || cells.some((x) => x.includes('"'))) throw new HttpError(400, 'invalid_csv', `CSV row ${i} has invalid quoting or column count`);
    const employeeNo = cells[0]!.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(employeeNo) || seen.has(employeeNo)) throw new HttpError(400, 'invalid_csv', `CSV row ${i} has an invalid or duplicate employee number`);
    const grossMinor = integer(cells[1]!, 'gross_minor');
    const deductionsMinor = integer(cells[2]!, 'deductions_minor');
    const netMinor = integer(cells[3]!, 'net_minor');
    if (grossMinor < 0 || deductionsMinor < 0) throw new HttpError(400, 'invalid_csv', `CSV row ${i} has negative gross or deductions`);
    if (netMinor !== grossMinor - deductionsMinor) throw new HttpError(400, 'invalid_csv', `CSV row ${i} net does not equal gross minus deductions`);
    const lines: Record<string, number> = {};
    if (cells[4]) for (const part of cells[4]!.split('|')) {
      const [code, amount, ...extra] = part.split(':');
      if (!code || extra.length || !/^[A-Z][A-Z0-9_]{1,31}$/.test(code) || amount === undefined) throw new HttpError(400, 'invalid_csv', `CSV row ${i} has an invalid line item`);
      lines[code] = integer(amount, `line ${code}`);
    }
    seen.add(employeeNo); rows.push({ employeeNo, grossMinor, deductionsMinor, netMinor, lines });
  }
  return { rows, hash: createHash('sha256').update(csv, 'utf8').digest('hex') };
}

export async function compareParallelRun(db: Db, tenantId: string, userId: string, payRunId: string, csv: string): Promise<{ id: string; status: string; employees: number; unexplained: number; externalFileHash: string }> {
  const parsed = parseParallelCsv(csv);
  const run = (await db.query<{ period_start: string; period_end: string; mode: string; status: string }>('select period_start::text, period_end::text, mode, status from pay.pay_run where id = $1 and tenant_id = $2', [payRunId, tenantId])).rows[0];
  if (!run) throw new HttpError(404, 'not_found', 'Pay run not found');
  if (run.mode !== 'parallel') throw new HttpError(422, 'parallel_mode_required', 'The Meridian run must be in parallel mode');
  if (!['calculated', 'in_review'].includes(run.status)) throw new HttpError(409, 'wrong_state', 'The Meridian run must be calculated or in review');
  const meridian = (await db.query<{ employee_id: string; employee_no: string; gross_minor: string; deductions_minor: string; net_minor: string; result: { lines?: Array<{ code: string; amount_minor: number }> } }>(
    `select r.employee_id, e.employee_no, r.gross_minor::text, (r.gross_minor - r.net_minor)::text as deductions_minor, r.net_minor::text, r.result
       from pay.pay_result r join people.employee e on e.id = r.employee_id
      where r.tenant_id = $1 and r.pay_run_id = $2 and r.is_current and r.status = 'ok' order by e.employee_no`, [tenantId, payRunId])).rows;
  const ext = new Map(parsed.rows.map((r) => [r.employeeNo, r]));
  if (meridian.length !== parsed.rows.length || meridian.some((r) => !ext.has(r.employee_no))) throw new HttpError(422, 'employee_set_mismatch', 'External payroll must contain exactly the same employee numbers as the Meridian run');
  const created = await db.query<{ id: string }>(`insert into pay.parallel_run (tenant_id, pay_run_id, period_start, period_end, external_file_hash, created_by) values ($1, $2, $3, $4, $5, $6) returning id`, [tenantId, payRunId, run.period_start, run.period_end, parsed.hash, userId]);
  const id = created.rows[0]!.id;
  let unexplained = 0;
  for (const m of meridian) {
    const e = ext.get(m.employee_no)!;
    const mg = Number(m.gross_minor), md = Number(m.deductions_minor), mn = Number(m.net_minor);
    const gv = e.grossMinor - mg, dv = e.deductionsMinor - md, nv = e.netMinor - mn;
    const actualLines = Object.fromEntries(((m.result?.lines ?? []) as Array<{ code: string; amount_minor: number }>).map((l) => [l.code, l.amount_minor]));
    const codes = new Set([...Object.keys(actualLines), ...Object.keys(e.lines)]);
    const lineDifferences = [...codes].sort().flatMap((code) => actualLines[code] === e.lines[code] ? [] : [{ code, external_minor: e.lines[code] ?? 0, meridian_minor: actualLines[code] ?? 0, variance_minor: (e.lines[code] ?? 0) - (actualLines[code] ?? 0) }]);
    const status = gv === 0 && dv === 0 && nv === 0 && lineDifferences.length === 0 ? 'matched' : 'unexplained';
    if (status === 'unexplained') unexplained++;
    await db.query(`insert into pay.parallel_run_employee (tenant_id, parallel_run_id, employee_id, employee_no, external_gross_minor, external_deductions_minor, external_net_minor, meridian_gross_minor, meridian_deductions_minor, meridian_net_minor, gross_variance_minor, deductions_variance_minor, net_variance_minor, line_differences, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`, [tenantId, id, m.employee_id, m.employee_no, e.grossMinor, e.deductionsMinor, e.netMinor, mg, md, mn, gv, dv, nv, JSON.stringify(lineDifferences), status]);
  }
  const status = unexplained ? 'needs_review' : 'zero_variance';
  await db.query(`update pay.parallel_run set status = $2, zero_unexplained = $3, completed_at = case when $3 then now() else null end where id = $1`, [id, status, unexplained === 0]);
  return { id, status, employees: meridian.length, unexplained, externalFileHash: parsed.hash };
}

export async function explainParallelVariance(db: Db, tenantId: string, userId: string, parallelId: string, employeeId: string, reason: string): Promise<void> {
  if (reason.trim().length < 5 || reason.length > 1000) throw new HttpError(400, 'invalid_reason', 'Explanation must be 5 to 1000 characters');
  const row = await db.query(`update pay.parallel_run_employee e set status = 'explained', explanation = $1, explained_by = $2, explained_at = now() from pay.parallel_run p where e.employee_id = $3 and e.parallel_run_id = p.id and p.id = $4 and p.tenant_id = $5 and e.status = 'unexplained' returning e.id`, [reason.trim(), userId, employeeId, parallelId, tenantId]);
  if (!row.rowCount) throw new HttpError(404, 'variance_not_found', 'Unexplained variance not found');
  const left = await db.query<{ n: number }>(`select count(*)::int as n from pay.parallel_run_employee where parallel_run_id = $1 and status = 'unexplained'`, [parallelId]);
  if (Number(left.rows[0]!.n) === 0) await db.query(`update pay.parallel_run set status = 'zero_variance', zero_unexplained = true, completed_at = now() where id = $1 and tenant_id = $2`, [parallelId, tenantId]);
}
