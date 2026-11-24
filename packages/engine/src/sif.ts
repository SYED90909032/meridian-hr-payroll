import { formatMinor } from './money.js';

/**
 * UAE WPS Salary Information File (SIF) builder.
 * Layout from the DIB WPS reference guide (https://www.dib.ae/docs/default-source/wps-guidelines/wps-file-format-reference-guide_v1-1.pdf).
 * Status: unverified against any bank's validator (blueprint item D-20). Use only in sandbox until a bank has accepted a test file.
 */
export interface SifRow {
  employee_uid: string; // MoHRE person code, 14 to 35 chars
  agent_routing: string; // 9 digits, employee's bank routing code
  iban: string; // AE + 21 digits
  pay_start: string; // YYYY-MM-DD
  pay_end: string;
  days_in_period: number;
  fixed_minor: number;
  variable_minor: number;
  unpaid_leave_days: number;
}

export interface SifHeader {
  employer_id: string; // 13 to 35 chars
  employer_routing: string; // 9 digits
  file_date: string; // YYYY-MM-DD
  file_time: string; // HHMM
  salary_month: string; // MMYYYY
  employer_ref?: string;
}

export class SifError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SifError';
  }
}

const SAFE_TEXT = /^[A-Za-z0-9 ._-]*$/;

export function buildSif(h: SifHeader, rows: SifRow[]): string {
  if (!/^[A-Za-z0-9]{13,35}$/.test(h.employer_id)) throw new SifError('employer_id must be 13 to 35 alphanumerics');
  if (!/^\d{9}$/.test(h.employer_routing)) throw new SifError('employer routing code must be 9 digits');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.file_date) || !/^\d{4}$/.test(h.file_time)) throw new SifError('bad file date or time');
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
    if (r.fixed_minor < 0 || r.variable_minor < 0) throw new SifError('negative amounts are not permitted');
    if (!Number.isSafeInteger(r.fixed_minor) || !Number.isSafeInteger(r.variable_minor)) throw new SifError('amounts must be integers');
    out.push(['EDR', r.employee_uid, r.agent_routing, r.iban, r.pay_start, r.pay_end, String(r.days_in_period), formatMinor(r.fixed_minor, 2), formatMinor(r.variable_minor, 2), String(r.unpaid_leave_days)].join(','));
    total += r.fixed_minor + r.variable_minor;
  }
  out.push(['SCR', h.employer_id, h.employer_routing, h.file_date, h.file_time, h.salary_month, String(rows.length), formatMinor(total, 2), 'AED', ref].join(','));
  return out.join('\n') + '\n';
}
