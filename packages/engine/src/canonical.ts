import { createHash } from 'node:crypto';

/**
 * Canonical JSON in the spirit of RFC 8785: keys sorted by UTF-16 code units, no whitespace.
 * Only integers are allowed as numbers. A float anywhere is a bug, so it throws.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) throw new Error('canonicalize: non-integer or unsafe number');
      return String(value);
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map((v) => canonicalize(v === undefined ? null : v)).join(',') + ']';
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function hashOf(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
