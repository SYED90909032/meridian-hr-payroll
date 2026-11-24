import { z } from 'zod';
import { badRequest } from '../errors.js';

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((d) => !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d, 'Invalid date');
export const short = (n: number) => z.string().trim().min(1).max(n);
export const limitQ = z.coerce.number().int().min(1).max(500).default(100);

export function pid(v: string | undefined): string {
  const r = uuid.safeParse(v);
  if (!r.success) throw badRequest('Invalid id');
  return r.data;
}
