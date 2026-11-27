import type { Db } from '../../db/tx.js';
import { randomDataKey, wipe, type Kms } from '../../crypto/kms.js';
import { HttpError } from '../../errors.js';

/**
 * Returns the data key for one person. Version zero is the original HKDF salt format. New rows use a random DEK
 * wrapped by a versioned tenant key; ciphertexts therefore survive tenant-key and master-key re-wrapping.
 */
export async function subjectKey(db: Db, kms: Kms, tenantId: string, subjectId: string, create: boolean): Promise<Buffer | null> {
  const r = await db.query<{ wrapped_key: Buffer | null; key_version: number; destroyed_at: string | null }>('select wrapped_key, key_version, destroyed_at from kernel.subject_key where tenant_id = $1 and subject_id = $2', [tenantId, subjectId]);
  const row = r.rows[0];
  if (row?.destroyed_at) { if (create) throw new HttpError(409, 'erased', 'This person\'s personal data has been erased'); return null; }
  if (row?.wrapped_key && row.key_version === 0) return kms.subjectKey(tenantId, subjectId, row.wrapped_key);
  if (row?.wrapped_key && row.key_version > 0) {
    const t = await db.query<{ version: number; wrapped_key: Buffer }>('select version, wrapped_key from kernel.tenant_key where tenant_id = $1 and version = $2', [tenantId, row.key_version]);
    if (!t.rows[0]) throw new Error('subject key references a missing tenant key version');
    const tenantKey = kms.unwrapTenantKey(tenantId, t.rows[0].version, t.rows[0].wrapped_key);
    try { return kms.unwrapSubjectKey(tenantId, subjectId, t.rows[0].version, tenantKey, row.wrapped_key); } finally { wipe(tenantKey); }
  }
  if (!create) return null;
  let tenantKey: Buffer;
  const active = await db.query<{ version: number; wrapped_key: Buffer }>('select version, wrapped_key from kernel.tenant_key where tenant_id = $1 and status = \'active\' order by version desc limit 1', [tenantId]);
  if (active.rows[0]) tenantKey = kms.unwrapTenantKey(tenantId, active.rows[0].version, active.rows[0].wrapped_key);
  else {
    tenantKey = randomDataKey();
    const version = 1;
    await db.query('insert into kernel.tenant_key (tenant_id, version, wrapped_key) values ($1, $2, $3) on conflict (tenant_id, version) do nothing', [tenantId, version, kms.wrapTenantKey(tenantId, version, tenantKey)]);
  }
  try {
    const version = active.rows[0]?.version ?? 1;
    const dek = randomDataKey();
    const wrapped = kms.wrapSubjectKey(tenantId, subjectId, version, tenantKey, dek);
    await db.query('insert into kernel.subject_key (tenant_id, subject_id, wrapped_key, key_version) values ($1, $2, $3, $4) on conflict (tenant_id, subject_id) do nothing', [tenantId, subjectId, wrapped, version]);
    const again = await db.query<{ wrapped_key: Buffer; key_version: number }>('select wrapped_key, key_version from kernel.subject_key where tenant_id = $1 and subject_id = $2', [tenantId, subjectId]);
    if (again.rows[0]!.key_version === 0) return kms.subjectKey(tenantId, subjectId, again.rows[0]!.wrapped_key);
    return kms.unwrapSubjectKey(tenantId, subjectId, again.rows[0]!.key_version, tenantKey, again.rows[0]!.wrapped_key);
  } finally { wipe(tenantKey); }
}

/** ISO 13616 mod-97 check. */
export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
export const normaliseIban = (s: string): string => s.replace(/\s+/g, '').toUpperCase();

/** Checks the first bytes of an upload against the declared type. A declared type alone is never trusted. */
export function magicMatches(mime: string, buf: Buffer): boolean {
  switch (mime) {
    case 'application/pdf': return buf.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/png': return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg': return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'text/plain': return !buf.includes(0);
    default: return false;
  }
}

/** UAE Emirates ID: 15 digits, starts with 784. Format only: a check-digit rule is not verified against a primary source, so it is not enforced. */
export function emiratesIdValid(v: string): boolean {
  return /^784\d{12}$/.test(v.replace(/[\s-]/g, ''));
}
