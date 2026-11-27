import { describe, expect, it } from 'vitest';
import { calculate, PACK_REGISTRY } from '../src/index.js';
import vectors from '../golden/uae-vectors.json' with { type: 'json' };

const pack = PACK_REGISTRY['ae-private-sector'].pack;

describe('independent UAE golden vector set', () => {
  it('matches every documented expected line and total without relying on result hashes', () => {
    for (const c of vectors.cases) {
      const result = calculate(c.input, pack);
      expect(result.status, c.id).toBe(c.expected.status);
      expect(result.lines.map((l) => [l.code, l.amount_minor]), c.id).toEqual(c.expected.lines);
      expect(result.totals, c.id).toEqual(c.expected.totals);
    }
  });
});
