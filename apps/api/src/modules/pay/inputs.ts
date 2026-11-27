import { hashOf, type PayrollCalcInputV1 } from '@meridian/engine';
import type { Db } from '../../db/tx.js';
import { addDays, eachDate, leaveDaysX1000 } from '../time/lib.js';
import type { TenantTime } from '../time/attendance.js';

export interface RunRow {
  id: string; tenant_id: string; pay_group_id: string; period_start: string; period_end: string;
  run_type: 'regular' | 'final' | 'off_cycle';
  mode: 'sandbox' | 'parallel' | 'live'; scope_key: string; status: string; pack_id: string; pack_version: string;
  pack_hash: string | null; engine_hash: string | null; input_set_hash: string | null; result_set_hash: string | null;
  bank_file_hash: string | null; prepared_by: string; input_gen: number; version: number; is_reversal?: boolean; reverses_run_id?: string | null;
}
export interface BuiltInput { employeeId: string; input: PayrollCalcInputV1; inputHash: string; adjustmentIds: string[] }
export interface BuildException { employeeId: string | null; code: string; severity: 'blocking' | 'warning'; message: string }

/** Exception codes raised when inputs are locked. Calculation never clears these. */
export const LOCK_CODES = new Set(['NO_COMPENSATION', 'NO_BANK_DETAILS', 'NO_WPS_ID', 'COMP_CHANGE_MID_PERIOD', 'NO_EMPLOYEES', 'NOT_TERMINATED', 'NO_OFF_CYCLE_ITEMS', 'CONTRACTOR_PAYROLL_DISABLED']);

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
const maxD = (a: string, b: string) => (a > b ? a : b);
const minD = (a: string, b: string) => (a < b ? a : b);

/**
 * Builds calculation inputs from the locked period. The 30-day basis is the
 * blueprint default, not a UAE legal conclusion; it remains pack data at L0.
 * Compensation rows are valid-time segments, while superseded rows are ignored.
 */
export async function buildInputs(db: Db, run: RunRow, tt: TenantTime): Promise<{ inputs: BuiltInput[]; exceptions: BuildException[] }> {
  const exceptions: BuildException[] = [];
  const start = run.period_start, end = run.period_end;
  const inPeriod = daysBetween(start, end) + 1;
  const only = run.scope_key.startsWith('emp:') ? run.scope_key.slice(4) : null;
  const tenant = (await db.query<{ settings: { payroll?: { contractors_enabled?: boolean; leave_encashment_enabled?: boolean } } }>('select settings from kernel.tenant where id = $1', [run.tenant_id])).rows[0];
  const payrollSettings = tenant?.settings?.payroll ?? {};
  const contractorsEnabled = payrollSettings.contractors_enabled === true;
  const leaveEncashmentEnabled = payrollSettings.leave_encashment_enabled === true;
  const offCycle = run.run_type === 'off_cycle';
  // The pack default is 30 days. Keep this explicit until a reviewer confirms a different basis.
  const daysBasis = 30;

  const emps = (await db.query<{
    id: string; employee_no: string; first_name: string; last_name: string; hire_date: string; termination_date: string | null;
    is_uae_national: boolean; employment_type: 'full_time' | 'part_time' | 'contractor'; contract_notice_days: number;
  }>(
    `select id, employee_no, first_name, last_name, hire_date::text, termination_date::text, is_uae_national, employment_type, contract_notice_days
       from people.employee
      where hire_date <= $2 and (termination_date is null or termination_date >= $1)
        and ($4::boolean or employment_type <> 'contractor') and ($3::uuid is null or id = $3::uuid) order by employee_no`,
    [start, end, only, contractorsEnabled])).rows;
  if (!emps.length) { exceptions.push({ employeeId: null, code: 'NO_EMPLOYEES', severity: 'blocking', message: 'No employees are eligible for this period' }); return { inputs: [], exceptions }; }
  const ids = emps.map((e) => e.id);

  const comps = (await db.query<{
    employee_id: string; basic_minor: string; housing_minor: string; transport_minor: string; other_minor: string;
    lo: string; hi: string | null; contains_end: boolean;
  }>(
    `select employee_id, basic_minor::text, housing_minor::text, transport_minor::text, other_minor::text,
            lower(valid_during)::text as lo, upper(valid_during)::text as hi, valid_during @> $3::date as contains_end
       from people.compensation where employee_id = any($1) and superseded_at is null
         and valid_during && daterange($2::date, ($3::date + 1)) order by employee_id, lower(valid_during)`,
    [ids, start, end])).rows;
  const banks = new Map((await db.query<{ employee_id: string; id: string }>('select employee_id, id from people.employee_bank where employee_id = any($1) and superseded_at is null', [ids])).rows.map((b) => [b.employee_id, b.id]));
  const wps = new Set((await db.query<{ employee_id: string }>('select employee_id from people.employee_private where employee_id = any($1) and wps_uid_enc is not null', [ids])).rows.map((r) => r.employee_id));
  const att = new Map((await db.query<{ employee_id: string; ot: string; sp: string }>(
    'select employee_id, coalesce(sum(overtime_minutes),0)::text as ot, coalesce(sum(overtime_special_minutes),0)::text as sp from tm.attendance_day where employee_id = any($1) and work_date between $2 and $3 group by employee_id',
    [ids, start, end])).rows.map((r) => [r.employee_id, r]));
  const holidays = new Set((await db.query<{ d: string }>('select holiday_date::text as d from tm.public_holiday where holiday_date between $1 and $2', [start, end])).rows.map((r) => r.d));
  const unpaidReq = (await db.query<{ employee_id: string; start_date: string; end_date: string; days_x1000: number }>(
    `select lr.employee_id, lr.start_date::text, lr.end_date::text, lr.days_x1000 from tm.leave_request lr join tm.leave_type lt on lt.id = lr.leave_type_id
      where lr.employee_id = any($1) and lr.status = 'approved' and not lt.paid and lr.start_date <= $3 and lr.end_date >= $2`, [ids, start, end])).rows;
  const adj = (await db.query<{ id: string; employee_id: string; code: string; label: string; kind: 'earning' | 'deduction'; amount_minor: string; voluntary: boolean; variable: boolean }>(
    `select id, employee_id, code, label, kind, amount_minor::text, voluntary, variable from pay.adjustment
      where employee_id = any($1) and effective_date between $2 and $3 and voided_at is null
        and (claimed_by_run_id is null or claimed_by_run_id = $4) order by created_at`, [ids, start, end, run.id])).rows;
  const annualBal = new Map((await db.query<{ employee_id: string; s: string }>(
    `select l.employee_id, sum(l.delta_x1000)::text as s from tm.leave_ledger l join tm.leave_type t on t.id = l.leave_type_id
      where t.code = 'ANNUAL' and l.employee_id = any($1) group by l.employee_id`, [ids])).rows.map((r) => [r.employee_id, Number(r.s)]));

  const inputs: BuiltInput[] = [];
  const strictBank = run.mode === 'sandbox' ? 'warning' : 'blocking';
  for (const e of emps) {
    const who = `${e.first_name} ${e.last_name} (${e.employee_no})`;
    const rows = comps.filter((c) => c.employee_id === e.id);
    if (!offCycle && !rows.length) { exceptions.push({ employeeId: e.id, code: 'NO_COMPENSATION', severity: 'blocking', message: `${who} has no compensation record for this period` }); continue; }
    if (e.employment_type === 'contractor' && !contractorsEnabled) {
      exceptions.push({ employeeId: e.id, code: 'CONTRACTOR_PAYROLL_DISABLED', severity: 'blocking', message: `${who} is a contractor and contractor payroll is disabled for this tenant` });
      continue;
    }
    if (!banks.has(e.id)) exceptions.push({ employeeId: e.id, code: 'NO_BANK_DETAILS', severity: strictBank, message: `${who} has no bank details on file` });
    if (!wps.has(e.id)) exceptions.push({ employeeId: e.id, code: 'NO_WPS_ID', severity: strictBank, message: `${who} has no WPS person code on file` });

    const first = maxD(e.hire_date, start), last = e.termination_date ? minD(e.termination_date, end) : end;
    const payableActual = Math.max(0, daysBetween(first, last) + 1);
    const payable = offCycle ? 0 : Math.min(payableActual, daysBasis);
    let unpaid = 0;
    for (const r of unpaidReq.filter((x) => x.employee_id === e.id)) {
      const s = maxD(r.start_date, start), t = minD(r.end_date, end);
      unpaid += r.days_x1000 === 500 ? 500 : leaveDaysX1000(s, t, tt.weekend, holidays);
    }

    const current = rows.find((r) => r.contains_end) ?? rows[rows.length - 1];
    const basic = offCycle ? 0 : Number(current?.basic_minor ?? 0);
    const housing = offCycle ? 0 : Number(current?.housing_minor ?? 0);
    const transport = offCycle ? 0 : Number(current?.transport_minor ?? 0);
    const other = offCycle ? 0 : Number(current?.other_minor ?? 0);
    const segments: PayrollCalcInputV1['comp_segments'] = [];
    let remaining = payable;
    if (!offCycle) {
      for (const c of rows) {
        const segFrom = maxD(maxD(c.lo, start), first);
        const rowLast = c.hi ? addDays(c.hi, -1) : end;
        const segTo = minD(minD(rowLast, end), last);
        const actualDays = segTo >= segFrom ? daysBetween(segFrom, segTo) + 1 : 0;
        const segmentDays = Math.min(actualDays, remaining);
        if (segmentDays > 0) {
          segments.push({ from: segFrom, to: segTo, days: segmentDays, basic: Number(c.basic_minor), housing: Number(c.housing_minor), transport: Number(c.transport_minor), other: Number(c.other_minor) });
          remaining -= segmentDays;
        }
      }
      if (rows.length > 1) exceptions.push({ employeeId: e.id, code: 'COMP_CHANGE_MID_PERIOD', severity: 'warning', message: `${who} has compensation segments inside this period; each valid-time segment is calculated separately.` });
    }

    let employeeAdj = adj.filter((x) => x.employee_id === e.id);
    if (offCycle && !employeeAdj.length) {
      exceptions.push({ employeeId: e.id, code: 'NO_OFF_CYCLE_ITEMS', severity: 'blocking', message: `${who} has no unclaimed one-off items in this period` });
      continue;
    }
    const a = att.get(e.id);
    const input: PayrollCalcInputV1 = {
      schema: 'payroll.calc.input.v1',
      run: { type: run.run_type, mode: run.mode },
      employee: { id: e.id, is_uae_national: e.is_uae_national, employment_type: e.employment_type },
      period: { start, end, days_in_period: inPeriod, days_payable: payable },
      comp: { basic, housing, transport, other },
      ...(segments.length ? { comp_segments: segments } : {}),
      attendance: { unpaid_leave_days_x1000: offCycle ? 0 : unpaid, overtime_minutes: offCycle ? 0 : Number(a?.ot ?? 0), overtime_special_minutes: offCycle ? 0 : Number(a?.sp ?? 0) },
      // Assumption pending reviewer sign-off: the contribution salary is the total fixed wage. See docs/SECURITY.md.
      statutory: { contribution_salary_minor: e.is_uae_national && !offCycle ? basic + housing + transport + other : 0 },
      adjustments: employeeAdj.map((x) => ({ code: x.code, label: x.label, kind: x.kind, amount_minor: Number(x.amount_minor), source_id: x.id, voluntary: x.voluntary, variable: x.variable })),
      payment_instruction_ref: banks.has(e.id) ? `bank:${banks.get(e.id)}` : null,
    };
    if (run.run_type === 'final') {
      if (!e.termination_date) { exceptions.push({ employeeId: e.id, code: 'NOT_TERMINATED', severity: 'blocking', message: `${who} has no termination date, so a final settlement cannot be calculated` }); continue; }
      input.final = { service_days: daysBetween(e.hire_date, e.termination_date) + 1, leave_balance_days_x1000: Math.max(0, annualBal.get(e.id) ?? 0), notice_pay_days_x1000: e.contract_notice_days * 1000, leave_encashment_enabled: leaveEncashmentEnabled };
    }
    const adjustmentIds = employeeAdj.map((x) => x.id);
    inputs.push({ employeeId: e.id, input, inputHash: hashOf(input), adjustmentIds });
  }
  return { inputs, exceptions };
}

export { addDays, eachDate };
