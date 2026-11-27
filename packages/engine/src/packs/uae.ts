import type { Cond, Expr } from '../expr.js';
import type { PackSource, Rule } from '../pack.js';

const c = (v: number): Expr => ({ k: 'const', v });
const ref = (p: string): Expr => ({ k: 'ref', p });
const add = (...a: Expr[]): Expr => ({ k: 'add', a });
const mul = (a: Expr, b: Expr): Expr => ({ k: 'mul', a, b });
const rate = (x: Expr, num: Expr, den: Expr): Expr => ({ k: 'mul_rate', x, num, den });
const flag = (p: string, on = true): Cond => ({ k: 'cmp', op: on ? 'eq' : 'eq', a: ref(p), b: c(on ? 1 : 0) });
const notContractor: Cond = flag('flags.is_contractor', false);
const statutoryForEmployee = (condition: Cond): Cond => ({ k: 'and', a: [notContractor, condition] });

const SRC_LAW = 'Federal Decree-Law 33/2021 (UAE Labour Law), via secondary sources; primary text to be checked by L2 reviewer';
const SRC_GPSSA = 'https://gpssa.gov.ae/pages/en/help/faq (read 2026-11-25)';
const NEEDS = 'needs_reviewer' as const;

const fixedTotal = add(ref('comp.basic'), ref('comp.housing'), ref('comp.transport'), ref('comp.other'));
// This is an exposed L0 pack parameter; its legal interpretation needs reviewer sign-off.
const prorated = (p: string): Expr => rate(ref(p), ref('period.days_payable'), ref('param.days_basis'));

const rules: Rule[] = [
  { id: 'ae.earn.basic', code: 'BASIC', label: 'Basic salary', kind: 'earning', always: true, amount: prorated('comp.basic'),
    explain: 'Contract basic salary x days payable / days in period.' },
  { id: 'ae.earn.housing', code: 'HOUSING', label: 'Housing allowance', kind: 'earning', amount: prorated('comp.housing'),
    explain: 'Contract housing allowance x days payable / days in period.' },
  { id: 'ae.earn.transport', code: 'TRANSPORT', label: 'Transport allowance', kind: 'earning', amount: prorated('comp.transport'),
    explain: 'Contract transport allowance x days payable / days in period.' },
  { id: 'ae.earn.other', code: 'OTHER_ALLOW', label: 'Other allowances', kind: 'earning', amount: prorated('comp.other'),
    explain: 'Contract other allowances x days payable / days in period.' },
  {
    id: 'ae.earn.overtime', code: 'OVERTIME', label: 'Overtime', kind: 'earning',
    amount: add(
      rate(ref('comp.basic'), mul(ref('attendance.overtime_minutes'), ref('param.ot_normal_num')), mul(mul(ref('param.days_basis'), ref('param.hours_per_day')), mul(c(60), ref('param.ot_den')))),
      rate(ref('comp.basic'), mul(ref('attendance.overtime_special_minutes'), ref('param.ot_special_num')), mul(mul(ref('param.days_basis'), ref('param.hours_per_day')), mul(c(60), ref('param.ot_den')))),
    ),
    explain: 'Hourly basic (basic / days basis / hours per day) x overtime hours x premium (normal and special rates).',
  },
  { id: 'ae.ded.unpaid', code: 'UNPAID_LEAVE', label: 'Unpaid leave', kind: 'deduction', statutory: true,
    when: statutoryForEmployee({ k: 'cmp', op: 'gt', a: ref('attendance.unpaid_leave_days_x1000'), b: c(0) }),
    amount: rate(fixedTotal, ref('attendance.unpaid_leave_days_x1000'), mul(ref('param.days_basis'), c(1000))),
    explain: 'Total fixed wage / days basis x unpaid leave days.' },
  {
    id: 'ae.ded.gpssa_ee', code: 'GPSSA_EE', label: 'GPSSA pension (employee)', kind: 'deduction', statutory: true, when: statutoryForEmployee(flag('flags.is_uae_national')),
    amount: rate({ k: 'clamp', x: ref('statutory.contribution_salary_minor'), lo: ref('param.gpssa_min'), hi: ref('param.gpssa_max') }, ref('param.gpssa_ee_num'), ref('param.gpssa_ee_den')),
    explain: 'Contribution salary (clamped to the GPSSA minimum and maximum) x employee rate. UAE nationals only.',
  },
  {
    id: 'ae.er.gpssa_er', code: 'GPSSA_ER', label: 'GPSSA pension (employer)', kind: 'employer', statutory: true, when: statutoryForEmployee(flag('flags.is_uae_national')),
    amount: rate({ k: 'clamp', x: ref('statutory.contribution_salary_minor'), lo: ref('param.gpssa_min'), hi: ref('param.gpssa_max') }, ref('param.gpssa_er_num'), ref('param.gpssa_er_den')),
    explain: 'Contribution salary (clamped) x employer rate. UAE nationals only.',
  },
  {
    id: 'ae.gov.gpssa', code: 'GPSSA_GOV', label: 'GPSSA government support', kind: 'gov', statutory: true, when: statutoryForEmployee(flag('flags.is_uae_national')),
    amount: rate({ k: 'clamp', x: ref('statutory.contribution_salary_minor'), lo: ref('param.gpssa_min'), hi: ref('param.gpssa_max') }, ref('param.gpssa_gov_num'), ref('param.gpssa_gov_den')),
    explain: 'Government support share, shown for completeness. Not paid by the employer.',
  },
  {
    id: 'ae.final.gratuity', code: 'GRATUITY', label: 'End-of-service gratuity', kind: 'earning', statutory: true,
    when: { k: 'and', a: [notContractor, flag('flags.is_final'), flag('flags.is_expat'), { k: 'cmp', op: 'gte', a: ref('final.service_days'), b: ref('param.grat_min_days') }] },
    amount: {
      k: 'min',
      a: [
        rate(
          ref('comp.basic'),
          add(
            mul(ref('param.grat_first_days'), { k: 'min', a: [ref('final.service_days'), ref('param.grat_threshold_days')] }),
            mul(ref('param.grat_after_days'), { k: 'max', a: [{ k: 'sub', a: ref('final.service_days'), b: ref('param.grat_threshold_days') }, c(0)] }),
          ),
          mul(ref('param.days_basis'), ref('param.days_in_year')),
        ),
        mul(ref('comp.basic'), ref('param.grat_cap_months')),
      ],
    },
    explain: '21 days of basic wage per year for the first 5 years plus 30 days per year after, capped at 24 months of basic wage. Not payable under one year of service. Calculated per day of service.',
  },
  { id: 'ae.final.leave', code: 'LEAVE_ENCASHMENT', label: 'Leave encashment', kind: 'earning', statutory: true, when: { k: 'and', a: [notContractor, flag('flags.is_final'), flag('flags.leave_encashment_enabled')] },
    amount: rate(ref('comp.basic'), ref('final.leave_balance_days_x1000'), mul(ref('param.days_basis'), c(1000))),
    explain: 'Basic / days basis x unused annual leave days.' },
  { id: 'ae.final.notice', code: 'NOTICE_PAY', label: 'Notice pay', kind: 'earning', statutory: true, when: { k: 'and', a: [notContractor, flag('flags.is_final')] },
    amount: rate(fixedTotal, ref('final.notice_pay_days_x1000'), mul(ref('param.days_basis'), c(1000))),
    explain: 'Total fixed wage / days basis x notice days payable in lieu.' },
];

export const UAE_PACK: PackSource = {
  id: 'ae-private-sector',
  version: '0.2.0',
  jurisdiction: 'AE',
  currency: { code: 'AED', exponent: 2 },
  defaultRounding: 'half_up',
  params: {
    days_basis: { value: 30, source: 'Common UAE practice: wage divided by 30 for daily rate', status: NEEDS },
    hours_per_day: { value: 8, source: SRC_LAW, status: NEEDS },
    days_in_year: { value: 365, source: 'Gratuity per day of service', status: NEEDS },
    ot_normal_num: { value: 125, source: SRC_LAW + ' (normal wage plus at least 25%)', status: NEEDS },
    ot_special_num: { value: 150, source: SRC_LAW + ' (night 10pm-4am at 50% premium; rest day and holiday rules differ)', status: NEEDS },
    ot_den: { value: 100, source: 'Rate denominator', status: 'verified' },
    gpssa_ee_num: { value: 5, source: SRC_GPSSA, status: 'verified' },
    gpssa_ee_den: { value: 100, source: SRC_GPSSA, status: 'verified' },
    gpssa_er_num: { value: 125, source: SRC_GPSSA, status: 'verified' },
    gpssa_er_den: { value: 1000, source: SRC_GPSSA, status: 'verified' },
    gpssa_gov_num: { value: 25, source: SRC_GPSSA, status: 'verified' },
    gpssa_gov_den: { value: 1000, source: SRC_GPSSA, status: 'verified' },
    gpssa_min: { value: 100_000, source: SRC_GPSSA + ' (AED 1,000 minimum, in fils)', status: 'verified' },
    gpssa_max: { value: 5_000_000, source: SRC_GPSSA + ' (AED 50,000 maximum, in fils)', status: 'verified' },
    grat_min_days: { value: 365, source: SRC_LAW + ' (no gratuity below one year)', status: NEEDS },
    grat_first_days: { value: 21, source: SRC_LAW, status: NEEDS },
    grat_after_days: { value: 30, source: SRC_LAW, status: NEEDS },
    grat_threshold_days: { value: 1825, source: SRC_LAW + ' (5 years x 365)', status: NEEDS },
    grat_cap_months: { value: 24, source: SRC_LAW + ' (cap of two years of wage)', status: NEEDS },
    deduction_cap_bps: { value: 5000, source: SRC_LAW + ' (deductions capped at 50% of wage)', status: NEEDS },
  },
  tables: {},
  required: [
    { path: 'comp.basic', nonZero: true, when: flag('flags.is_off_cycle', false) },
    { path: 'period.days_in_period' },
    { path: 'period.days_payable' },
    { path: 'statutory.contribution_salary_minor', nonZero: true, when: statutoryForEmployee(flag('flags.is_uae_national')) },
    { path: 'final.service_days', when: flag('flags.is_final') },
  ],
  deductionCapParam: 'deduction_cap_bps',
  runTypes: ['regular', 'final', 'off_cycle'],
  rules,
};
