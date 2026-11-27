import { createHash } from 'node:crypto';
import type { Db } from '../../db/tx.js';
import { audit } from '../../db/tx.js';
import type { ObjectStore } from '../../storage/objectStore.js';
import { ObjectExistsError } from '../../storage/objectStore.js';

export interface SealRecord {
  tenant: string; from_seq: number; to_seq: number; merkle_root: string; signature: string; key_id: string; sealed_at: string; hash: string;
}
export interface ReconcileResult { tenant: string; missing: string[]; mismatched: string[]; extra: string[]; drift: boolean; }
const bodyWithoutHash = (r: Omit<SealRecord, 'hash'>): string => JSON.stringify(r);
export function sealRecordHash(r: Omit<SealRecord, 'hash'>): string { return createHash('sha256').update(bodyWithoutHash(r)).digest('hex'); }
export function sealObjectKey(tenant: string, from: number, to: number): string { return `audit-seals/${tenant}/${from}-${to}.json`; }

export async function writeSealOffBox(objects: ObjectStore, row: { tenant_id: string; from_seq: number | string; to_seq: number | string; merkle_root: string; signature: string; key_id: string; sealed_at: Date | string }, publicKeyPem: string): Promise<SealRecord> {
  const base = { tenant: row.tenant_id, from_seq: Number(row.from_seq), to_seq: Number(row.to_seq), merkle_root: row.merkle_root, signature: row.signature, key_id: row.key_id, sealed_at: new Date(row.sealed_at).toISOString() };
  const record: SealRecord = { ...base, hash: sealRecordHash(base) };
  const body = Buffer.from(JSON.stringify(record));
  const key = sealObjectKey(record.tenant, record.from_seq, record.to_seq);
  try { await objects.put(key, body, { contentType: 'application/json', overwrite: false }); }
  catch (e) {
    if (!(e instanceof ObjectExistsError)) throw e;
    const existing = await objects.get(key);
    if (!existing?.equals(body)) throw new Error('off-box audit seal already exists with different content');
  }
  const publicKeyKey = `audit-keys/${record.key_id}.pem`;
  try { await objects.put(publicKeyKey, Buffer.from(publicKeyPem), { contentType: 'application/x-pem-file', overwrite: false }); }
  catch (e) { if (!(e instanceof ObjectExistsError)) throw e; }
  return record;
}

export async function reconcileAuditSeals(db: Db, objects: ObjectStore, tenantId: string, actorUserId: string | null = null): Promise<ReconcileResult> {
  const rows = await db.query<{ tenant_id: string; from_seq: string; to_seq: string; merkle_root: string; signature: string; key_id: string; sealed_at: string }>('select tenant_id, from_seq, to_seq, merkle_root, signature, key_id, sealed_at from kernel.audit_block where tenant_id = $1 order by from_seq', [tenantId]);
  const expected = new Map<string, SealRecord>();
  for (const row of rows.rows) {
    const base = { tenant: row.tenant_id, from_seq: Number(row.from_seq), to_seq: Number(row.to_seq), merkle_root: row.merkle_root, signature: row.signature, key_id: row.key_id, sealed_at: new Date(row.sealed_at).toISOString() };
    expected.set(sealObjectKey(tenantId, base.from_seq, base.to_seq), { ...base, hash: sealRecordHash(base) });
  }
  const missing: string[] = [], mismatched: string[] = [];
  for (const [key, record] of expected) {
    const body = await objects.get(key);
    if (!body) { missing.push(key); continue; }
    try {
      const got: unknown = JSON.parse(body.toString('utf8'));
      if (JSON.stringify(got) !== JSON.stringify(record)) mismatched.push(key);
    } catch { mismatched.push(key); }
  }
  const listed = await objects.list(`audit-seals/${tenantId}/`);
  const extra = listed.map((x) => x.key).filter((key) => !expected.has(key)).sort();
  const result = { tenant: tenantId, missing, mismatched, extra, drift: missing.length > 0 || mismatched.length > 0 || extra.length > 0 };
  if (result.drift) await audit(db, { tenantId, userId: actorUserId, employeeId: null }, 'audit.seal_drift', 'audit_block', tenantId, { missing, mismatched, extra });
  return result;
}
