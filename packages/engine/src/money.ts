/**
 * Integer money maths. All amounts are minor units held as bigint, so intermediates never
 * overflow (the blueprint asks for 128-bit intermediates; bigint is unbounded).
 * There is no floating point anywhere in this package.
 */
export type RoundMode = 'half_up' | 'half_even' | 'up' | 'down';

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Divide n by d (d != 0) and round to an integer. 'half_up' rounds halves away from zero. 'up'/'down' are away from / toward zero. */
export function divRound(n: bigint, d: bigint, mode: RoundMode): bigint {
  if (d === 0n) throw new MoneyError('division by zero');
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  const r = an % ad;
  if (r !== 0n) {
    switch (mode) {
      case 'down':
        break;
      case 'up':
        q += 1n;
        break;
      case 'half_up':
        if (r * 2n >= ad) q += 1n;
        break;
      case 'half_even': {
        const twice = r * 2n;
        if (twice > ad || (twice === ad && q % 2n === 1n)) q += 1n;
        break;
      }
    }
  }
  return neg ? -q : q;
}

/** minor * num / den, rounded once. */
export function mulRate(minor: bigint, num: bigint, den: bigint, mode: RoundMode): bigint {
  return divRound(minor * num, den, mode);
}

export const proRata = mulRate;

export function clamp(x: bigint, lo: bigint, hi: bigint): bigint {
  if (lo > hi) throw new MoneyError('clamp bounds inverted');
  return x < lo ? lo : x > hi ? hi : x;
}

export function toSafeNumber(x: bigint, what = 'value'): number {
  if (x > BigInt(Number.MAX_SAFE_INTEGER) || x < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`${what} outside the safe integer range`);
  }
  return Number(x);
}

export function toBig(n: number, what = 'value'): bigint {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${what} must be a safe integer`);
  return BigInt(n);
}

/** Format minor units as a decimal string with the given exponent (2 for AED). Pure integer formatting. */
export function formatMinor(minor: number | bigint, exponent: number): string {
  const v = typeof minor === 'bigint' ? minor : BigInt(minor);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = a.toString().padStart(exponent + 1, '0');
  const whole = s.slice(0, s.length - exponent);
  const frac = exponent > 0 ? '.' + s.slice(s.length - exponent) : '';
  return (neg ? '-' : '') + whole + frac;
}
