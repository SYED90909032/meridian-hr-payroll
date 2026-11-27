import { formatMinor } from './money.js';

/**
 * UAE WPS Salary Information File (SIF) builder.
 * Layout from the DIB WPS reference guide (https://www.dib.ae/docs/default-source/wps-guidelines/wps-file-format-reference-guide_v1-1.pdf).
 * Status: unverified against any bank's validator (blueprint item D-20). Use only in sandbox until a bank has accepted a test file.
 */
export interface SifRow {
  employee_uid: string;
  agent_routing: string;
  iban: string;
  pay_start: string;
  pay_end: string;
  days_in_period: number;
  fixed_minor: number;
  variable_minor: number;
  unpaid_leave_days: number;
}

export interface SifHeader {
  employer_id: string;
  employer_routing: string;
  file_date: string;
  file_time: string;
  salary_month: string;
  employer_ref?: string;
}

export interface SifValidationExpected {
  employeeCount?: number;
  totalMinor?: number;
}

export interface SifValidationResult { employeeCount: number; totalMinor: number; zeroNetRows: number }

export class SifError extends Error {
  constructor(message: string) { super(message); this.name = 'SifError'; }
}

const SAFE_TEXT = /^[A-Za-z0-9 ._-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string): boolean => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const minor = (v: string): number => {
  if (!/^\d+(?:\.\d{2})$/.test(v)) throw new SifError('monetary fields must have exactly two decimal places');
  const n = Number(v.replace('.', ''));
  if (!Number.isSafeInteger(n)) throw new SifError('monetary field is outside the safe integer range');
  return n;
};

export function buildSif(h: SifHeader, rows: SifRow[]): string {
  if (!/^[A-Za-z0-9]{13,35}$/.test(h.employer_id)) throw new SifError('employer_id must be 13 to 35 alphanumerics');
  if (!/^\d{9}$/.test(h.employer_routing)) throw new SifError('employer routing code must be 9 digits');
  if (!validDate(h.file_date) || !/^\d{4}$/.test(h.file_time)) throw new SifError('bad file date or time');
  if (!/^\d{6}$/.test(h.salary_month)) throw new SifError('salary_month must be MMYYYY');
  const ref = (h.employer_ref ?? '').slice(0, 35);
  if (!SAFE_TEXT.test(ref)) throw new SifError('employer_ref has characters not allowed in a SIF');
  if (rows.length === 0) throw new SifError('a SIF needs at least one employee record');
  const out: string[] = [];
  let total = 0;
  for (const r of rows) {
    if (!/^[A-Za-z0-9]{14,35}$/.test(r.employee_uid)) throw new SifError('employee_uid must be 14 to 35 alphanumerics');
    if (!/^\d{9}$/.test(r.agent_routing)) throw new SifError('agent routing code must be 9 digits');
    if (!/^AE\d{21}$/.test(r.iban)) throw new SifError('IBAN must be AE + 21 digits');
    if (!validDate(r.pay_start) || !validDate(r.pay_end) || r.pay_end < r.pay_start) throw new SifError('bad pay period');
    if (!Number.isInteger(r.days_in_period) || r.days_in_period < 1 || r.days_in_period > 31 || !Number.isInteger(r.unpaid_leave_days) || r.unpaid_leave_days < 0 || r.unpaid_leave_days > 31) throw new SifError('invalid day count');
    if (r.fixed_minor < 0 || r.variable_minor < 0) throw new SifError('negative amounts are not permitted');
    if (!Number.isSafeInteger(r.fixed_minor) || !Number.isSafeInteger(r.variable_minor)) throw new SifError('amounts must be integers');
    out.push(['EDR', r.employee_uid, r.agent_routing, r.iban, r.pay_start, r.pay_end, String(r.days_in_period), formatMinor(r.fixed_minor, 2), formatMinor(r.variable_minor, 2), String(r.unpaid_leave_days)].join(','));
    total += r.fixed_minor + r.variable_minor;
  }
  out.push(['SCR', h.employer_id, h.employer_routing, h.file_date, h.file_time, h.salary_month, String(rows.length), formatMinor(total, 2), 'AED', ref].join(','));
  return out.join('\n') + '\n';
}

/** Self-check only: this proves structural reconciliation, never bank acceptance. */
export function validateSif(content: string, expected: SifValidationExpected = {}): SifValidationResult {
  if (!content || /[^\x00-\x7F]/.test(content)) throw new SifError('SIF contains non-ASCII data');
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length || lines.at(-1)?.startsWith('SCR,') !== true) throw new SifError('SIF must end with one SCR summary record');
  const edr = lines.slice(0, -1);
  if (edr.some((line) => !line.startsWith('EDR,'))) throw new SifError('SIF contains an unexpected record type');
  const summary = lines.at(-1)!.split(',');
  if (summary.length !== 10 || summary[0] !== 'SCR' || !/^[A-Za-z0-9]{13,35}$/.test(summary[1]!) || !/^\d{9}$/.test(summary[2]!) || !validDate(summary[3]!) || !/^\d{4}$/.test(summary[4]!) || !/^\d{6}$/.test(summary[5]!) || summary[8] !== 'AED' || !SAFE_TEXT.test(summary[9]!)) throw new SifError('SCR fields have invalid widths or formats');
  const count = Number(summary[6]);
  if (!Number.isSafeInteger(count) || count !== edr.length) throw new SifError('SCR record count does not match EDR records');
  const total = minor(summary[7]!);
  let computed = 0, zeroNetRows = 0;
  for (const line of edr) {
    const cells = line.split(',');
    if (cells.length !== 10 || !/^[A-Za-z0-9]{14,35}$/.test(cells[1]!) || !/^\d{9}$/.test(cells[2]!) || !/^AE\d{21}$/.test(cells[3]!) || !validDate(cells[4]!) || !validDate(cells[5]!) || cells[5]! < cells[4]!) throw new SifError('EDR fields have invalid widths or formats');
    const days = Number(cells[6]);
    if (!Number.isInteger(days) || days < 1 || days > 31) throw new SifError('EDR days_in_period is invalid');
    const fixed = minor(cells[7]!), variable = minor(cells[8]!);
    const unpaid = Number(cells[9]);
    if (!Number.isInteger(unpaid) || unpaid < 0 || unpaid > 31) throw new SifError('EDR unpaid leave days is invalid');
    computed += fixed + variable;
    if (fixed + variable === 0) zeroNetRows++;
  }
  if (computed !== total) throw new SifError('SCR total does not reconcile to EDR rows');
  if (expected.employeeCount !== undefined && count !== expected.employeeCount) throw new SifError('SIF employee count does not reconcile to pay run');
  if (expected.totalMinor !== undefined && total !== expected.totalMinor) throw new SifError('SIF total does not reconcile to pay run');
  return { employeeCount: count, totalMinor: total, zeroNetRows };
}
