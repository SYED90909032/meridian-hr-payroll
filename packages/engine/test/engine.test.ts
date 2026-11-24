import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ENGINE_HASH, PACK_REGISTRY, UAE_PACK, buildSif, calculate, canonicalize, compilePack, divRound, formatMinor, hashOf,
  InputError, RuleError, resultBytes, type PayrollCalcInputV1, type PackSource,
} from '../src/index.js';

const pack = PACK_REGISTRY['ae-private-sector'].pack;

function base(over: Partial<PayrollCalcInputV1> = {}): PayrollCalcInputV1 {
  return {
    schema: 'payroll.calc.input.v1',
    run: { type: 'regular', mode: 'sandbox' },
    employee: { id: 'e1', is_uae_national: false },
    period: { start: '2026-11-01', end: '2026-11-30', days_in_period: 30, days_payable: 30 },
    comp: { basic: 1_000_000, housing: 500_000, transport: 100_000, other: 0 },
    attendance: { unpaid_leave_days_x1000: 0, overtime_minutes: 0, overtime_special_minutes: 0 },
    statutory: { contribution_salary_minor: 1_600_000 },
    adjustments: [],
    payment_instruction_ref: 'bank:abc',
    ...over,
  };
}
const line = (r: ReturnType<typeof calculate>, code: string) => r.lines.find((l) => l.code === code)?.amount_minor;

describe('money', () => {
  it('rounds halves per mode, including negatives', () => {
    expect(divRound(5n, 2n, 'half_up')).toBe(3n);
    expect(divRound(-5n, 2n, 'half_up')).toBe(-3n);
    expect(divRound(5n, 2n, 'half_even')).toBe(2n);
    expect(divRound(7n, 2n, 'half_even')).toBe(4n);
    expect(divRound(5n, 3n, 'down')).toBe(1n);
    expect(divRound(5n, 3n, 'up')).toBe(2n);
    expect(() => divRound(1n, 0n, 'down')).toThrow();
  });
  it('formats minor units without floats', () => {
    expect(formatMinor(1_600_000, 2)).toBe('16000.00');
    expect(formatMinor(5, 2)).toBe('0.05');
    expect(formatMinor(-1234, 2)).toBe('-12.34');
    expect(formatMinor(1234, 0)).toBe('1234');
  });
});

describe('canonical JSON', () => {
  it('sorts keys and is stable', () => {
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
  it('rejects floats and unsafe integers', () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow();
    expect(() => canonicalize({ a: 2 ** 60 })).toThrow();
  });
});

describe('UAE pack golden vectors (L0, hand-calculated)', () => {
  it('expat, full month, no variables', () => {
    const r = calculate(base(), pack);
    expect(r.status).toBe('ok');
    expect(r.totals).toMatchObject({ gross_minor: 1_600_000, deductions_minor: 0, net_minor: 1_600_000, employer_cost_minor: 1_600_000 });
  });
  it('UAE national: GPSSA 5% employee, 12.5% employer, 2.5% government not in employer cost', () => {
    const r = calculate(base({ employee: { id: 'e2', is_uae_national: true } }), pack);
    expect(line(r, 'GPSSA_EE')).toBe(80_000);
    expect(line(r, 'GPSSA_ER')).toBe(200_000);
    expect(line(r, 'GPSSA_GOV')).toBe(40_000);
    expect(r.totals.net_minor).toBe(1_520_000);
    expect(r.totals.employer_cost_minor).toBe(1_800_000);
  });
  it('GPSSA base is clamped to the 1,000 and 50,000 AED bounds', () => {
    const hi = calculate(base({ employee: { id: 'e', is_uae_national: true }, statutory: { contribution_salary_minor: 9_000_000 } }), pack);
    expect(line(hi, 'GPSSA_EE')).toBe(250_000); // 5% of 50,000.00
    const lo = calculate(base({ employee: { id: 'e', is_uae_national: true }, statutory: { contribution_salary_minor: 50_000 } }), pack);
    expect(line(lo, 'GPSSA_EE')).toBe(5_000); // 5% of 1,000.00
  });
  it('overtime rounds once, half up', () => {
    const r = calculate(base({ attendance: { unpaid_leave_days_x1000: 0, overtime_minutes: 120, overtime_special_minutes: 0 } }), pack);
    expect(line(r, 'OVERTIME')).toBe(10_417); // 1,000,000*120*125/1,440,000 = 10416.67
  });
  it('special overtime uses 150%', () => {
    const r = calculate(base({ attendance: { unpaid_leave_days_x1000: 0, overtime_minutes: 0, overtime_special_minutes: 60 } }), pack);
    expect(line(r, 'OVERTIME')).toBe(6_250); // 1,000,000*60*150/1,440,000 = 6250
  });
  it('unpaid leave: total fixed wage / 30 per day', () => {
    const r = calculate(base({ attendance: { unpaid_leave_days_x1000: 2500, overtime_minutes: 0, overtime_special_minutes: 0 } }), pack);
    expect(line(r, 'UNPAID_LEAVE')).toBe(133_333);
    expect(r.totals.net_minor).toBe(1_600_000 - 133_333);
  });
  it('mid-month joiner is pro-rated by calendar days', () => {
    const r = calculate(base({ period: { start: '2026-11-21', end: '2026-11-30', days_in_period: 30, days_payable: 10 } }), pack);
    expect(line(r, 'BASIC')).toBe(333_333);
    expect(line(r, 'HOUSING')).toBe(166_667);
  });
  it('gratuity: 3 years = 63 days of basic/30', () => {
    const r = calculate(base({ run: { type: 'final', mode: 'sandbox' }, final: { service_days: 1095, leave_balance_days_x1000: 0, notice_pay_days_x1000: 0 } }), pack);
    expect(line(r, 'GRATUITY')).toBe(2_100_000);
  });
  it('gratuity: 7 years = 5.5 months of basic (21x5 + 30x2 days)', () => {
    const r = calculate(base({ run: { type: 'final', mode: 'sandbox' }, final: { service_days: 2555, leave_balance_days_x1000: 0, notice_pay_days_x1000: 0 } }), pack);
    expect(line(r, 'GRATUITY')).toBe(5_500_000);
  });
  it('gratuity is capped at 24 months of basic', () => {
    const r = calculate(base({ run: { type: 'final', mode: 'sandbox' }, final: { service_days: 10_950, leave_balance_days_x1000: 0, notice_pay_days_x1000: 0 } }), pack);
    expect(line(r, 'GRATUITY')).toBe(24_000_000);
  });
  it('no gratuity under one year, and none for UAE nationals (GPSSA covers them)', () => {
    const short = calculate(base({ run: { type: 'final', mode: 'sandbox' }, final: { service_days: 364, leave_balance_days_x1000: 0, notice_pay_days_x1000: 0 } }), pack);
    expect(line(short, 'GRATUITY')).toBeUndefined();
    const nat = calculate(base({ employee: { id: 'n', is_uae_national: true }, run: { type: 'final', mode: 'sandbox' }, final: { service_days: 2555, leave_balance_days_x1000: 0, notice_pay_days_x1000: 0 } }), pack);
    expect(line(nat, 'GRATUITY')).toBeUndefined();
  });
  it('leave encashment and notice pay', () => {
    const r = calculate(base({ run: { type: 'final', mode: 'sandbox' }, final: { service_days: 400, leave_balance_days_x1000: 12_500, notice_pay_days_x1000: 30_000 } }), pack);
    expect(line(r, 'LEAVE_ENCASHMENT')).toBe(416_667); // 1,000,000 * 12.5 / 30
    expect(line(r, 'NOTICE_PAY')).toBe(1_600_000);
  });
  it('voluntary deductions are capped at 50% of gross and the rest is carried', () => {
    const r = calculate(base({ adjustments: [{ code: 'LOAN', label: 'Loan', kind: 'deduction', amount_minor: 1_000_000, source_id: 'loan-1', voluntary: true, variable: true }] }), pack);
    expect(line(r, 'LOAN')).toBe(800_000);
    expect(r.carry_forward).toEqual([{ code: 'LOAN', source_id: 'loan-1', amount_minor: 200_000 }]);
    expect(r.exceptions.map((e) => e.code)).toContain('DEDUCTION_CAP_APPLIED');
  });
  it('earnings adjustments add to gross and count as variable pay', () => {
    const r = calculate(base({ adjustments: [{ code: 'BONUS', label: 'Bonus', kind: 'earning', amount_minor: 250_000, source_id: 'b1', voluntary: true, variable: true }] }), pack);
    expect(r.totals.gross_minor).toBe(1_850_000);
    expect(r.totals.variable_earnings_minor).toBe(250_000);
  });
  it('negative net raises a blocking exception', () => {
    const r = calculate(base({ attendance: { unpaid_leave_days_x1000: 40_000, overtime_minutes: 0, overtime_special_minutes: 0 } }), pack);
    expect(r.exceptions.find((e) => e.code === 'NEGATIVE_NET')?.severity).toBe('blocking');
  });
  it('missing statutory base for a national excludes the employee, no silent default', () => {
    const r = calculate(base({ employee: { id: 'n', is_uae_national: true }, statutory: { contribution_salary_minor: 0 } }), pack);
    expect(r.status).toBe('excluded');
    expect(r.exceptions[0]).toMatchObject({ code: 'MISSING_INPUT', severity: 'blocking' });
    expect(r.lines).toHaveLength(0);
  });
});

describe('input contract', () => {
  it('rejects unknown keys, floats and inconsistent periods', () => {
    expect(() => calculate({ ...base(), extra: 1 }, pack)).toThrow(InputError);
    expect(() => calculate(base({ comp: { basic: 100.5, housing: 0, transport: 0, other: 0 } }), pack)).toThrow(InputError);
    expect(() => calculate(base({ period: { start: '2026-11-01', end: '2026-11-30', days_in_period: 30, days_payable: 31 } }), pack)).toThrow(InputError);
    expect(() => calculate(base({ run: { type: 'final', mode: 'sandbox' } }), pack)).toThrow(InputError);
  });
  it('does not accept a bank account number (reference only)', () => {
    expect(() => calculate({ ...base(), iban: 'AE000000000000000000000' }, pack)).toThrow(InputError);
  });
});

describe('determinism and invariants', () => {
  it('same input gives byte-identical output and records the hashes', () => {
    const a = resultBytes(calculate(base(), pack));
    const b = resultBytes(calculate(structuredClone(base()), pack));
    expect(a).toBe(b);
    const r = calculate(base(), pack);
    expect(r.meta.engine_hash).toBe(ENGINE_HASH);
    expect(r.meta.pack_hash).toBe(pack.packHash);
    expect(r.meta.input_hash).toBe(hashOf(base()));
  });
  const arb = fc.record({
    basic: fc.integer({ min: 100_000, max: 9_000_000 }),
    housing: fc.integer({ min: 0, max: 5_000_000 }),
    transport: fc.integer({ min: 0, max: 500_000 }),
    other: fc.integer({ min: 0, max: 500_000 }),
    payable: fc.integer({ min: 1, max: 30 }),
    ot: fc.integer({ min: 0, max: 6000 }),
    ots: fc.integer({ min: 0, max: 3000 }),
    unpaid: fc.integer({ min: 0, max: 10_000 }),
    national: fc.boolean(),
    contrib: fc.integer({ min: 100_000, max: 8_000_000 }),
    loan: fc.integer({ min: 0, max: 5_000_000 }),
  });
  it('property: totals reconcile and no line is negative', () => {
    fc.assert(
      fc.property(arb, (a) => {
        const inp = base({
          employee: { id: 'p', is_uae_national: a.national },
          comp: { basic: a.basic, housing: a.housing, transport: a.transport, other: a.other },
          period: { start: '2026-11-01', end: '2026-11-30', days_in_period: 30, days_payable: a.payable },
          attendance: { unpaid_leave_days_x1000: a.unpaid, overtime_minutes: a.ot, overtime_special_minutes: a.ots },
          statutory: { contribution_salary_minor: a.contrib },
          adjustments: a.loan ? [{ code: 'LOAN', label: 'Loan', kind: 'deduction', amount_minor: a.loan, source_id: 'l', voluntary: true, variable: true }] : [],
        });
        const r = calculate(inp, pack);
        const earn = r.lines.filter((l) => l.kind === 'earning').reduce((s, l) => s + l.amount_minor, 0);
        const ded = r.lines.filter((l) => l.kind === 'deduction').reduce((s, l) => s + l.amount_minor, 0);
        const er = r.lines.filter((l) => l.kind === 'employer').reduce((s, l) => s + l.amount_minor, 0);
        expect(r.totals.gross_minor).toBe(earn);
        expect(r.totals.deductions_minor).toBe(ded);
        expect(r.totals.net_minor).toBe(earn - ded);
        expect(r.totals.employer_cost_minor).toBe(earn + er);
        expect(r.lines.every((l) => l.amount_minor >= 0)).toBe(true);
        expect(r.totals.variable_earnings_minor).toBeLessThanOrEqual(r.totals.gross_minor);
        expect(resultBytes(calculate(inp, pack))).toBe(resultBytes(r));
        // Voluntary deductions never exceed the cap.
        const vol = r.lines.filter((l) => l.code === 'LOAN').reduce((s, l) => s + l.amount_minor, 0);
        expect(vol).toBeLessThanOrEqual(Math.floor((earn * 5000) / 10_000));
      }),
      { numRuns: 400 },
    );
  });
  it('property: full-period payable equals contract amounts exactly', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9_000_000 }), (basic) => {
      const r = calculate(base({ comp: { basic, housing: 0, transport: 0, other: 0 } }), pack);
      expect(line(r, 'BASIC')).toBe(basic);
    }));
  });
  it('property: more days payable never lowers gross', () => {
    fc.assert(fc.property(fc.integer({ min: 100_000, max: 5_000_000 }), fc.integer({ min: 0, max: 29 }), (basic, d) => {
      const mk = (p: number) => calculate(base({ comp: { basic, housing: 0, transport: 0, other: 0 }, period: { start: '2026-11-01', end: '2026-11-30', days_in_period: 30, days_payable: p } }), pack).totals.gross_minor;
      expect(mk(d + 1)).toBeGreaterThanOrEqual(mk(d));
    }));
  });
});

describe('pack compiler rejects unsafe rule sets', () => {
  const clone = (): PackSource => structuredClone(UAE_PACK);
  it('rejects a float constant', () => {
    const p = clone();
    p.rules[0]!.amount = { k: 'const', v: 1.5 };
    expect(() => compilePack(p)).toThrow(RuleError);
  });
  it('rejects unknown operations and references', () => {
    const p = clone();
    (p.rules[0]!.amount as unknown) = { k: 'eval', code: 'process.exit()' };
    expect(() => compilePack(p)).toThrow(RuleError);
    const q = clone();
    q.rules[0]!.amount = { k: 'ref', p: 'process.env.SECRET' };
    expect(() => compilePack(q)).toThrow(RuleError);
  });
  it('rejects oversize expressions and unexpected keys', () => {
    const p = clone();
    let e: any = { k: 'const', v: 1 };
    for (let i = 0; i < 500; i++) e = { k: 'add', a: [e, { k: 'const', v: 1 }] };
    p.rules[0]!.amount = e;
    expect(() => compilePack(p)).toThrow(RuleError);
    const q = clone();
    (q.rules[0]!.amount as any) = { k: 'const', v: 1, evil: true };
    expect(() => compilePack(q)).toThrow(RuleError);
  });
  it('the shipped pack hash changes when any parameter changes', () => {
    const p = clone();
    p.params.gpssa_ee_num!.value = 6;
    expect(compilePack(p).packHash).not.toBe(pack.packHash);
  });
  it('shipped UAE pack is registered at L0 and every unverified parameter is flagged', () => {
    expect(PACK_REGISTRY['ae-private-sector'].assurance).toBe('L0');
    const flagged = Object.values(UAE_PACK.params).filter((p) => p.status === 'needs_reviewer').length;
    expect(flagged).toBeGreaterThan(5);
  });
});

describe('WPS SIF builder', () => {
  const header = { employer_id: '0000000123456', employer_routing: '802420101', file_date: '2026-11-26', file_time: '1130', salary_month: '112026', employer_ref: 'ACME LLC' };
  const row = { employee_uid: '00915012345663', agent_routing: '802420101', iban: 'AE160240043520123456701', pay_start: '2026-11-01', pay_end: '2026-11-30', days_in_period: 30, fixed_minor: 400_000, variable_minor: 250_000, unpaid_leave_days: 0 };
  it('emits EDR lines and one SCR control line with the total', () => {
    const s = buildSif(header, [row, { ...row, employee_uid: '00915012345664' }]);
    const lines = s.trim().split('\n');
    expect(lines[0]).toBe('EDR,00915012345663,802420101,AE160240043520123456701,2026-11-01,2026-11-30,30,4000.00,2500.00,0');
    expect(lines[2]).toBe('SCR,0000000123456,802420101,2026-11-26,1130,112026,2,13000.00,AED,ACME LLC');
  });
  it('rejects bad IBANs, negative amounts and injection characters', () => {
    expect(() => buildSif(header, [{ ...row, iban: 'XX12' }])).toThrow();
    expect(() => buildSif(header, [{ ...row, fixed_minor: -1 }])).toThrow();
    expect(() => buildSif({ ...header, employer_ref: 'a,b\nEDR' }, [row])).toThrow();
    expect(() => buildSif(header, [])).toThrow();
  });
});
