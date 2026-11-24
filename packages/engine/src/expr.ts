import { clamp, divRound, mulRate, MoneyError, toBig, type RoundMode } from './money.js';

/**
 * Pack rule language: a closed, JSON expression tree over integers. No eval, no loops, no floats.
 * ADR-004: this is the host-function contract that a CEL front end or a Rust port must reproduce exactly.
 */
export type Expr =
  | { k: 'const'; v: number }
  | { k: 'ref'; p: string }
  | { k: 'add'; a: Expr[] }
  | { k: 'sub'; a: Expr; b: Expr }
  | { k: 'mul'; a: Expr; b: Expr }
  | { k: 'mul_rate'; x: Expr; num: Expr; den: Expr; mode?: RoundMode }
  | { k: 'min'; a: Expr[] }
  | { k: 'max'; a: Expr[] }
  | { k: 'clamp'; x: Expr; lo: Expr; hi: Expr }
  | { k: 'if'; c: Cond; t: Expr; e: Expr }
  | { k: 'tax_table'; table: string; base: Expr };

export type Cond =
  | { k: 'cmp'; op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq'; a: Expr; b: Expr }
  | { k: 'and'; a: Cond[] }
  | { k: 'or'; a: Cond[] }
  | { k: 'not'; a: Cond };

export interface TaxTable {
  /** Progressive brackets in ascending order. upTo null means "no upper bound" and must be last. */
  brackets: { upTo: number | null; rate: { num: number; den: number } }[];
  mode: RoundMode;
}

export const MAX_STATIC_NODES = 400;
export const MAX_EVAL_COST = 20_000;

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

export interface EvalEnv {
  vars: Map<string, bigint>;
  tables: Record<string, TaxTable>;
  defaultMode: RoundMode;
  cost: { n: number };
}

function tick(env: EvalEnv) {
  if (++env.cost.n > MAX_EVAL_COST) throw new RuleError('evaluation cost limit exceeded');
}

export function evalExpr(e: Expr, env: EvalEnv): bigint {
  tick(env);
  switch (e.k) {
    case 'const':
      return toBig(e.v, 'const');
    case 'ref': {
      const v = env.vars.get(e.p);
      if (v === undefined) throw new RuleError(`missing value: ${e.p}`);
      return v;
    }
    case 'add':
      return e.a.reduce((s, x) => s + evalExpr(x, env), 0n);
    case 'sub':
      return evalExpr(e.a, env) - evalExpr(e.b, env);
    case 'mul':
      return evalExpr(e.a, env) * evalExpr(e.b, env);
    case 'mul_rate':
      return mulRate(evalExpr(e.x, env), evalExpr(e.num, env), evalExpr(e.den, env), e.mode ?? env.defaultMode);
    case 'min': {
      const xs = e.a.map((x) => evalExpr(x, env));
      return xs.reduce((m, x) => (x < m ? x : m));
    }
    case 'max': {
      const xs = e.a.map((x) => evalExpr(x, env));
      return xs.reduce((m, x) => (x > m ? x : m));
    }
    case 'clamp':
      return clamp(evalExpr(e.x, env), evalExpr(e.lo, env), evalExpr(e.hi, env));
    case 'if':
      return evalCond(e.c, env) ? evalExpr(e.t, env) : evalExpr(e.e, env);
    case 'tax_table': {
      const t = env.tables[e.table];
      if (!t) throw new RuleError(`unknown table ${e.table}`);
      const base = evalExpr(e.base, env);
      let remaining = base;
      let lower = 0n;
      let tax = 0n;
      for (const b of t.brackets) {
        if (remaining <= 0n) break;
        const upper = b.upTo === null ? null : BigInt(b.upTo);
        const width = upper === null ? remaining : upper - lower;
        const slice = remaining < width ? remaining : width;
        tax += divRound(slice * BigInt(b.rate.num), BigInt(b.rate.den), t.mode); // rounded once per bracket using the table's declared mode
        remaining -= slice;
        if (upper !== null) lower = upper;
      }
      return tax;
    }
    default: {
      const _x: never = e;
      throw new RuleError(`unknown op ${(_x as { k: string }).k}`);
    }
  }
}

export function evalCond(c: Cond, env: EvalEnv): boolean {
  tick(env);
  switch (c.k) {
    case 'cmp': {
      const a = evalExpr(c.a, env);
      const b = evalExpr(c.b, env);
      switch (c.op) {
        case 'lt': return a < b;
        case 'lte': return a <= b;
        case 'gt': return a > b;
        case 'gte': return a >= b;
        case 'eq': return a === b;
        case 'neq': return a !== b;
      }
      throw new RuleError('bad cmp op');
    }
    case 'and':
      return c.a.every((x) => evalCond(x, env));
    case 'or':
      return c.a.some((x) => evalCond(x, env));
    case 'not':
      return !evalCond(c.a, env);
    default: {
      const _x: never = c;
      throw new RuleError(`unknown cond ${(_x as { k: string }).k}`);
    }
  }
}

const EXPR_KEYS: Record<string, string[]> = {
  const: ['k', 'v'], ref: ['k', 'p'], add: ['k', 'a'], sub: ['k', 'a', 'b'], mul: ['k', 'a', 'b'],
  mul_rate: ['k', 'x', 'num', 'den', 'mode'], min: ['k', 'a'], max: ['k', 'a'], clamp: ['k', 'x', 'lo', 'hi'],
  if: ['k', 'c', 't', 'e'], tax_table: ['k', 'table', 'base'],
};
const COND_KEYS: Record<string, string[]> = { cmp: ['k', 'op', 'a', 'b'], and: ['k', 'a'], or: ['k', 'a'], not: ['k', 'a'] };

/** Static validation used by the pack compiler. Returns node count; throws RuleError on any violation. */
export function validateExpr(e: unknown, refs: Set<string>, tables: Set<string>, counter = { n: 0 }): number {
  if (!e || typeof e !== 'object') throw new RuleError('expression must be an object');
  const o = e as Record<string, unknown>;
  if (++counter.n > MAX_STATIC_NODES) throw new RuleError('expression too large');
  const k = o.k as string;
  const allowed = EXPR_KEYS[k];
  if (!allowed) throw new RuleError(`unknown expression op: ${String(k)}`);
  for (const key of Object.keys(o)) if (!allowed.includes(key)) throw new RuleError(`unexpected key ${key} in ${k}`);
  const sub = (x: unknown) => validateExpr(x, refs, tables, counter);
  switch (k) {
    case 'const':
      if (typeof o.v !== 'number' || !Number.isSafeInteger(o.v)) throw new RuleError('const must be a safe integer (no floats)');
      break;
    case 'ref':
      if (typeof o.p !== 'string' || !refs.has(o.p)) throw new RuleError(`unknown reference: ${String(o.p)}`);
      break;
    case 'add': case 'min': case 'max':
      if (!Array.isArray(o.a) || o.a.length === 0) throw new RuleError(`${k} needs a non-empty list`);
      o.a.forEach(sub);
      break;
    case 'sub': case 'mul': sub(o.a); sub(o.b); break;
    case 'mul_rate':
      sub(o.x); sub(o.num); sub(o.den);
      if (o.mode !== undefined && !['half_up', 'half_even', 'up', 'down'].includes(o.mode as string)) throw new RuleError('bad rounding mode');
      break;
    case 'clamp': sub(o.x); sub(o.lo); sub(o.hi); break;
    case 'if': validateCond(o.c, refs, tables, counter); sub(o.t); sub(o.e); break;
    case 'tax_table':
      if (typeof o.table !== 'string' || !tables.has(o.table)) throw new RuleError(`unknown table ${String(o.table)}`);
      sub(o.base);
      break;
  }
  return counter.n;
}

export function validateCond(c: unknown, refs: Set<string>, tables: Set<string>, counter = { n: 0 }): void {
  if (!c || typeof c !== 'object') throw new RuleError('condition must be an object');
  const o = c as Record<string, unknown>;
  if (++counter.n > MAX_STATIC_NODES) throw new RuleError('expression too large');
  const allowed = COND_KEYS[o.k as string];
  if (!allowed) throw new RuleError(`unknown condition: ${String(o.k)}`);
  for (const key of Object.keys(o)) if (!allowed.includes(key)) throw new RuleError(`unexpected key ${key}`);
  if (o.k === 'cmp') {
    if (!['lt', 'lte', 'gt', 'gte', 'eq', 'neq'].includes(o.op as string)) throw new RuleError('bad comparison');
    validateExpr(o.a, refs, tables, counter);
    validateExpr(o.b, refs, tables, counter);
  } else if (o.k === 'not') validateCond(o.a, refs, tables, counter);
  else {
    if (!Array.isArray(o.a) || o.a.length === 0) throw new RuleError('and/or need a list');
    o.a.forEach((x) => validateCond(x, refs, tables, counter));
  }
}

export { MoneyError };
