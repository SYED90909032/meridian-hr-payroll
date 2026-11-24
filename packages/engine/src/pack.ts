import { validateCond, validateExpr, RuleError, type Cond, type Expr, type TaxTable } from './expr.js';
import { hashOf } from './canonical.js';
import type { RoundMode } from './money.js';

export type LineKind = 'earning' | 'deduction' | 'employer' | 'gov' | 'info';
export type AssuranceLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface PackParam {
  value: number;
  source: string;
  status: 'verified' | 'needs_reviewer';
}

export interface Rule {
  id: string;
  code: string;
  label: string;
  kind: LineKind;
  /** Statutory lines are never subject to the voluntary-deduction cap. */
  statutory?: boolean;
  when?: Cond;
  amount: Expr;
  explain: string;
  /** Keep the line even when the amount is zero. */
  always?: boolean;
}

export interface RequiredInput {
  path: string;
  when?: Cond;
  /** Treat a zero value as missing (for example a statutory base that must be provided). */
  nonZero?: boolean;
}

export interface PackSource {
  id: string;
  version: string;
  jurisdiction: string;
  currency: { code: string; exponent: number };
  defaultRounding: RoundMode;
  params: Record<string, PackParam>;
  tables: Record<string, TaxTable>;
  required: RequiredInput[];
  /** Voluntary deductions are capped at this many basis points of gross. */
  deductionCapParam: string;
  runTypes: ('regular' | 'final' | 'off_cycle')[];
  rules: Rule[];
}

export interface CompiledPack {
  source: PackSource;
  packHash: string;
}

/** Input paths a pack rule may read. Kept in one place so the compiler and the calculator agree. */
export const INPUT_PATHS = [
  'period.days_in_period', 'period.days_payable',
  'comp.basic', 'comp.housing', 'comp.transport', 'comp.other',
  'attendance.unpaid_leave_days_x1000', 'attendance.overtime_minutes', 'attendance.overtime_special_minutes',
  'statutory.contribution_salary_minor',
  'final.service_days', 'final.leave_balance_days_x1000', 'final.notice_pay_days_x1000',
  'flags.is_uae_national', 'flags.is_final', 'flags.is_expat',
] as const;

export function compilePack(src: PackSource): CompiledPack {
  const paramRefs = Object.keys(src.params).map((k) => `param.${k}`);
  const refs = new Set<string>([...INPUT_PATHS, ...paramRefs]);
  const tables = new Set(Object.keys(src.tables));
  const codes = new Set<string>();
  if (!src.params[src.deductionCapParam]) throw new RuleError('deductionCapParam missing');
  for (const [k, p] of Object.entries(src.params)) {
    if (!Number.isSafeInteger(p.value)) throw new RuleError(`param ${k} must be a safe integer`);
    if (!p.source) throw new RuleError(`param ${k} needs a source`);
  }
  for (const [name, t] of Object.entries(src.tables)) {
    let last = -1;
    t.brackets.forEach((b, i) => {
      if (!Number.isSafeInteger(b.rate.num) || !Number.isSafeInteger(b.rate.den) || b.rate.den <= 0) throw new RuleError(`table ${name}: bad rate`);
      if (b.upTo === null) {
        if (i !== t.brackets.length - 1) throw new RuleError(`table ${name}: open bracket must be last`);
      } else {
        if (!Number.isSafeInteger(b.upTo) || b.upTo <= last) throw new RuleError(`table ${name}: brackets must ascend`);
        last = b.upTo;
      }
    });
  }
  for (const r of src.rules) {
    if (codes.has(r.code)) throw new RuleError(`duplicate rule code ${r.code}`);
    validateExpr(r.amount, refs, tables);
    if (r.when) validateCond(r.when, refs, tables);
    codes.add(r.code);
  }
  for (const req of src.required) {
    if (!refs.has(req.path)) throw new RuleError(`required path unknown: ${req.path}`);
    if (req.when) validateCond(req.when, refs, tables);
  }
  return { source: src, packHash: hashOf(src) };
}
