import { createHash } from 'node:crypto';
import { canonicalize, hashOf } from './canonical.js';
import { evalCond, evalExpr, MAX_EVAL_COST, RuleError, type EvalEnv } from './expr.js';
import { mulRate, toBig, toSafeNumber } from './money.js';
import { INPUT_PATHS, type CompiledPack } from './pack.js';
import { PayrollCalcInputV1, type PayrollResultV1, type ResultException, type ResultLine } from './contracts.js';

export const ENGINE_ID = 'meridian-engine-ts/1.0.0';
/** Hash of the engine identity and its closed set of host functions. A Rust port must publish its own id and hash and pass the same golden vectors. */
export const ENGINE_HASH = createHash('sha256')
  .update(ENGINE_ID + '|' + ['add', 'sub', 'mul', 'mul_rate', 'min', 'max', 'clamp', 'if', 'tax_table'].join(','))
  .digest('hex');

function inputVars(input: PayrollCalcInputV1): Map<string, bigint> {
  const m = new Map<string, bigint>();
  const set = (k: string, v: number | boolean | undefined) => {
    if (v === undefined) return;
    m.set(k, typeof v === 'boolean' ? (v ? 1n : 0n) : toBig(v, k));
  };
  set('period.days_in_period', input.period.days_in_period);
  set('period.days_payable', input.period.days_payable);
  // 1 when the employee is payable for the whole period; then pay is the full amount (never 31/30 of a 31-day month).
  set('period.is_full', input.period.days_payable >= input.period.days_in_period);
  set('comp.basic', input.comp.basic);
  set('comp.housing', input.comp.housing);
  set('comp.transport', input.comp.transport);
  set('comp.other', input.comp.other);
  set('attendance.unpaid_leave_days_x1000', input.attendance.unpaid_leave_days_x1000);
  set('attendance.overtime_minutes', input.attendance.overtime_minutes);
  set('attendance.overtime_special_minutes', input.attendance.overtime_special_minutes);
  set('statutory.contribution_salary_minor', input.statutory.contribution_salary_minor);
  set('final.service_days', input.final?.service_days);
  set('final.leave_balance_days_x1000', input.final?.leave_balance_days_x1000);
  set('final.notice_pay_days_x1000', input.final?.notice_pay_days_x1000);
  set('flags.is_uae_national', input.employee.is_uae_national);
  set('flags.is_expat', !input.employee.is_uae_national);
  set('flags.is_contractor', input.employee.employment_type === 'contractor');
  set('flags.is_final', input.run.type === 'final');
  set('flags.is_off_cycle', input.run.type === 'off_cycle');
  set('flags.leave_encashment_enabled', input.final?.leave_encashment_enabled !== false);
  return m;
}

// Guard: every declared input path has a producer above (caught by a test).
export const PRODUCED_PATHS = INPUT_PATHS;

export class InputError extends Error {
  constructor(public issues: string[]) {
    super('invalid payroll input: ' + issues.join('; '));
    this.name = 'InputError';
  }
}

function finish(
  base: Omit<PayrollResultV1, 'result_hash'>,
): PayrollResultV1 {
  return { ...base, result_hash: hashOf(base) };
}

/**
 * Pure function. Same input + same pack + same engine gives byte-identical output.
 * It never reads the clock, the environment or the database.
 */
export function calculate(rawInput: unknown, pack: CompiledPack): PayrollResultV1 {
  const parsed = PayrollCalcInputV1.safeParse(rawInput);
  if (!parsed.success) {
    throw new InputError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const input = parsed.data;
  const src = pack.source;
  const input_hash = hashOf(input);
  const meta = {
    engine_id: ENGINE_ID,
    engine_hash: ENGINE_HASH,
    pack_id: src.id,
    pack_version: src.version,
    pack_hash: pack.packHash,
    input_hash,
    rounding_mode: src.defaultRounding,
  };
  const zeroTotals = { gross_minor: 0, deductions_minor: 0, net_minor: 0, employer_contributions_minor: 0, employer_cost_minor: 0, variable_earnings_minor: 0 };
  const exceptions: ResultException[] = [];
  const header = { schema: 'payroll.result.v1' as const, employee_id: input.employee.id, currency: src.currency.code, exponent: src.currency.exponent };

  if (!src.runTypes.includes(input.run.type)) {
    exceptions.push({ code: 'RUN_TYPE_UNSUPPORTED', severity: 'blocking', message: `Pack does not support run type ${input.run.type}` });
    return finish({ ...header, status: 'excluded', lines: [], totals: zeroTotals, carry_forward: [], exceptions, meta });
  }

  const vars = inputVars(input);
  for (const [k, p] of Object.entries(src.params)) vars.set(`param.${k}`, toBig(p.value, k));
  for (const r of src.rules) vars.set(`line.${r.code}`, 0n);
  const env: EvalEnv = { vars, tables: src.tables, defaultMode: src.defaultRounding, cost: { n: 0 } };

  // Required fields: no silent defaults. A missing one excludes the employee with a blocking exception.
  for (const req of src.required) {
    const needed = req.when ? evalCond(req.when, env) : true;
    if (needed && (!vars.has(req.path) || (req.nonZero && vars.get(req.path) === 0n))) {
      exceptions.push({ code: 'MISSING_INPUT', severity: 'blocking', message: `Required input missing: ${req.path}` });
    }
  }
  if (input.period.days_payable === 0 && input.run.type === 'regular') {
    exceptions.push({ code: 'NO_PAYABLE_DAYS', severity: 'warning', message: 'No payable days in the period' });
  }
  if (exceptions.some((e) => e.severity === 'blocking')) {
    return finish({ ...header, status: 'excluded', lines: [], totals: zeroTotals, carry_forward: [], exceptions, meta });
  }

  const lines: ResultLine[] = [];
  try {
    const segmentedCodes = new Set(['BASIC', 'HOUSING', 'TRANSPORT', 'OTHER_ALLOW']);
    for (const r of src.rules) {
      if (r.when && !evalCond(r.when, env)) continue;
      if (input.comp_segments?.length && segmentedCodes.has(r.code)) {
        for (const segment of input.comp_segments) {
          vars.set('comp.basic', toBig(segment.basic, 'comp.basic'));
          vars.set('comp.housing', toBig(segment.housing, 'comp.housing'));
          vars.set('comp.transport', toBig(segment.transport, 'comp.transport'));
          vars.set('comp.other', toBig(segment.other, 'comp.other'));
          vars.set('period.days_payable', toBig(segment.days, 'period.days_payable'));
          const amount = evalExpr(r.amount, env);
          if (amount < 0n) throw new RuleError(`rule ${r.id} produced a negative amount`);
          if (amount === 0n && !r.always) continue;
          lines.push({ code: r.code, label: r.label, kind: r.kind, amount_minor: toSafeNumber(amount, r.code), rule_id: r.id,
            explain: `${r.explain} Segment ${segment.from} to ${segment.to} (${segment.days} payable day(s)).` });
        }
        vars.set('comp.basic', toBig(input.comp.basic, 'comp.basic'));
        vars.set('comp.housing', toBig(input.comp.housing, 'comp.housing'));
        vars.set('comp.transport', toBig(input.comp.transport, 'comp.transport'));
        vars.set('comp.other', toBig(input.comp.other, 'comp.other'));
        vars.set('period.days_payable', toBig(input.period.days_payable, 'period.days_payable'));
        continue;
      }
      const amt = evalExpr(r.amount, env);
      if (amt < 0n) throw new RuleError(`rule ${r.id} produced a negative amount`);
      vars.set(`line.${r.code}`, amt);
      if (amt === 0n && !r.always) continue;
      lines.push({ code: r.code, label: r.label, kind: r.kind, amount_minor: toSafeNumber(amt, r.code), rule_id: r.id, explain: r.explain });
    }
  } catch (e) {
    if (e instanceof RuleError) {
      exceptions.push({ code: 'RULE_ERROR', severity: 'blocking', message: e.message });
      return finish({ ...header, status: 'excluded', lines: [], totals: zeroTotals, carry_forward: [], exceptions, meta });
    }
    throw e;
  }
  if (env.cost.n > MAX_EVAL_COST) throw new RuleError('cost limit');

  // Adjustments from the input snapshot. Earnings first, then deductions subject to the cap.
  let gross = 0n;
  let variable = 0n;
  for (const l of lines) if (l.kind === 'earning') gross += BigInt(l.amount_minor);
  for (const a of input.adjustments) {
    if (a.kind !== 'earning') continue;
    lines.push({ code: a.code, label: a.label, kind: 'earning', amount_minor: a.amount_minor, rule_id: 'adjustment', explain: 'Approved adjustment from the input snapshot.', source_id: a.source_id });
    gross += BigInt(a.amount_minor);
    if (a.variable) variable += BigInt(a.amount_minor);
  }
  for (const l of lines) if (l.code === 'OVERTIME') variable += BigInt(l.amount_minor);

  const capBps = BigInt(src.params[src.deductionCapParam]!.value);
  const cap = mulRate(gross, capBps, 10_000n, 'down');
  let voluntaryUsed = 0n;
  const carry: PayrollResultV1['carry_forward'] = [];
  for (const a of input.adjustments) {
    if (a.kind !== 'deduction') continue;
    const want = BigInt(a.amount_minor);
    let apply = want;
    if (a.voluntary) {
      const room = cap - voluntaryUsed;
      apply = want < room ? want : room < 0n ? 0n : room;
      voluntaryUsed += apply;
    }
    if (apply < want) {
      carry.push({ code: a.code, source_id: a.source_id, amount_minor: toSafeNumber(want - apply, a.code) });
      exceptions.push({ code: 'DEDUCTION_CAP_APPLIED', severity: 'warning', message: `${a.code} reduced by the ${Number(capBps) / 100}% deduction cap; remainder carried forward` });
    }
    if (apply > 0n) {
      lines.push({
        code: a.code, label: a.label, kind: 'deduction', amount_minor: toSafeNumber(apply, a.code), rule_id: 'adjustment',
        explain: a.voluntary ? 'Approved deduction, subject to the deduction cap.' : 'Approved statutory deduction.',
        source_id: a.source_id, ...(apply < want ? { capped_from_minor: toSafeNumber(want, a.code) } : {}),
      });
    }
  }

  let deductions = 0n;
  let employer = 0n;
  for (const l of lines) {
    if (l.kind === 'deduction') deductions += BigInt(l.amount_minor);
    if (l.kind === 'employer') employer += BigInt(l.amount_minor);
  }
  gross = 0n;
  for (const l of lines) if (l.kind === 'earning') gross += BigInt(l.amount_minor);
  const net = gross - deductions;
  if (net < 0n) exceptions.push({ code: 'NEGATIVE_NET', severity: 'blocking', message: 'Net pay is negative' });
  if (net === 0n) exceptions.push({ code: 'ZERO_NET', severity: 'warning', message: 'Net pay is zero' });
  if (variable > gross) variable = gross;

  return finish({
    ...header,
    status: 'ok',
    lines,
    totals: {
      gross_minor: toSafeNumber(gross, 'gross'),
      deductions_minor: toSafeNumber(deductions, 'deductions'),
      net_minor: toSafeNumber(net, 'net'),
      employer_contributions_minor: toSafeNumber(employer, 'employer'),
      employer_cost_minor: toSafeNumber(gross + employer, 'employer cost'),
      variable_earnings_minor: toSafeNumber(variable, 'variable'),
    },
    carry_forward: carry,
    exceptions,
    meta,
  });
}

/** Canonical bytes of a result, for cross-runtime determinism tests. */
export function resultBytes(r: PayrollResultV1): string {
  return canonicalize(r);
}
