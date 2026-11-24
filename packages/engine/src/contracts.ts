import { z } from 'zod';

const int = z.number().int().safe();
const nonNeg = int.nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ADJUSTMENT_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;

export const AdjustmentSchema = z.object({
  code: z.string().regex(ADJUSTMENT_CODE),
  label: z.string().min(1).max(80),
  kind: z.enum(['earning', 'deduction']),
  amount_minor: nonNeg,
  source_id: z.string().min(1).max(80),
  /** Voluntary deductions (loans, advances, fines) are subject to the pack's cap. */
  voluntary: z.boolean().default(true),
  /** Earnings that are not fixed pay (bonus, commission). Used for the WPS variable component. */
  variable: z.boolean().default(true),
}).strict();

export const PayrollCalcInputV1 = z.object({
  schema: z.literal('payroll.calc.input.v1'),
  run: z.object({
    type: z.enum(['regular', 'final', 'off_cycle']),
    mode: z.enum(['sandbox', 'parallel', 'live']),
  }).strict(),
  employee: z.object({
    id: z.string().min(1).max(64),
    is_uae_national: z.boolean(),
  }).strict(),
  period: z.object({
    start: isoDate,
    end: isoDate,
    days_in_period: int.min(1).max(31),
    days_payable: int.min(0).max(31),
  }).strict(),
  comp: z.object({
    basic: nonNeg,
    housing: nonNeg,
    transport: nonNeg,
    other: nonNeg,
  }).strict(),
  attendance: z.object({
    unpaid_leave_days_x1000: nonNeg,
    overtime_minutes: nonNeg,
    overtime_special_minutes: nonNeg,
  }).strict(),
  statutory: z.object({
    contribution_salary_minor: nonNeg,
  }).strict(),
  final: z.object({
    service_days: nonNeg,
    leave_balance_days_x1000: nonNeg,
    notice_pay_days_x1000: nonNeg,
  }).strict().optional(),
  adjustments: z.array(AdjustmentSchema).max(200),
  /** Reference only. Raw bank data never enters the engine. */
  payment_instruction_ref: z.string().max(80).nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.run.type === 'final' && !v.final) ctx.addIssue({ code: 'custom', message: 'final run needs a final section', path: ['final'] });
  if (v.period.days_payable > v.period.days_in_period) ctx.addIssue({ code: 'custom', message: 'days_payable exceeds days_in_period', path: ['period', 'days_payable'] });
  if (v.period.end < v.period.start) ctx.addIssue({ code: 'custom', message: 'period end before start', path: ['period', 'end'] });
});
export type PayrollCalcInputV1 = z.infer<typeof PayrollCalcInputV1>;

export interface ResultLine {
  code: string;
  label: string;
  kind: 'earning' | 'deduction' | 'employer' | 'gov' | 'info';
  amount_minor: number;
  rule_id: string;
  explain: string;
  source_id?: string;
  capped_from_minor?: number;
}

export interface ResultException {
  code: string;
  severity: 'blocking' | 'warning';
  message: string;
}

export interface PayrollResultV1 {
  schema: 'payroll.result.v1';
  status: 'ok' | 'excluded';
  employee_id: string;
  currency: string;
  exponent: number;
  lines: ResultLine[];
  totals: {
    gross_minor: number;
    deductions_minor: number;
    net_minor: number;
    employer_contributions_minor: number;
    employer_cost_minor: number;
    variable_earnings_minor: number;
  };
  carry_forward: { code: string; source_id: string; amount_minor: number }[];
  exceptions: ResultException[];
  meta: {
    engine_id: string;
    engine_hash: string;
    pack_id: string;
    pack_version: string;
    pack_hash: string;
    input_hash: string;
    rounding_mode: string;
  };
  result_hash: string;
}
