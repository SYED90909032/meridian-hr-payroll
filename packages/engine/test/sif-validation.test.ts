import { describe, expect, it } from 'vitest';
import { buildSif, SifError, validateSif } from '../src/index.js';

const header = { employer_id: 'EMP12345678901', employer_routing: '012345678', file_date: '2026-11-27', file_time: '0619', salary_month: '112026', employer_ref: 'run-123' };

describe('SIF structural self-check', () => {
  it('reconciles variable earnings, unpaid leave, multiple employees and a zero-net row', () => {
    const file = buildSif(header, [
      { employee_uid: 'WPSUID00000001AB', agent_routing: '033000001', iban: 'AE070331000000000000001', pay_start: '2026-11-01', pay_end: '2026-11-30', days_in_period: 30, fixed_minor: 100000, variable_minor: 25000, unpaid_leave_days: 2 },
      { employee_uid: 'WPSUID00000002AB', agent_routing: '033000002', iban: 'AE080331000000000000002', pay_start: '2026-11-01', pay_end: '2026-11-30', days_in_period: 30, fixed_minor: 0, variable_minor: 0, unpaid_leave_days: 0 },
      { employee_uid: 'WPSUIDLONGNAME0003', agent_routing: '033000003', iban: 'AE090331000000000000003', pay_start: '2026-11-01', pay_end: '2026-11-30', days_in_period: 30, fixed_minor: 999, variable_minor: 1, unpaid_leave_days: 0 },
    ]);
    expect(validateSif(file, { employeeCount: 3, totalMinor: 126000 })).toEqual({ employeeCount: 3, totalMinor: 126000, zeroNetRows: 1 });
  });

  it('rejects a tampered summary total and non-ASCII data', () => {
    const file = buildSif(header, [{ employee_uid: 'WPSUID00000001AB', agent_routing: '033000001', iban: 'AE070331000000000000001', pay_start: '2026-11-01', pay_end: '2026-11-30', days_in_period: 30, fixed_minor: 100, variable_minor: 0, unpaid_leave_days: 0 }]);
    expect(() => validateSif(file.replace('1.00,AED', '2.00,AED'), { totalMinor: 100 })).toThrow(SifError);
    expect(() => validateSif(file.replace('EMP12345678901', 'EMPé2345678901'))).toThrow(/non-ASCII/);
  });
});
