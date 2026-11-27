import { randomDataKey, wipe, type Kms } from './kms.js';

type Queryable = { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> };

export interface RotationResult { tenants: number; subjects: number; }

/** Idempotently upgrades legacy subject salts. It commits per tenant so a failed run can safely resume. */
export async function upgradeLegacySubjectKeys(db: Queryable, kms: Kms, tenantId?: string): Promise<RotationResult> {
  const tenants = await db.query<{ tenant_id: string }>(tenantId ? 'select $1::uuid as tenant_id' : 'select id as tenant_id from kernel.tenant order by id', tenantId ? [tenantId] : []);
  let subjects = 0;
  for (const t of tenants.rows) {
    let tk: Buffer;
    const active = await db.query<{ version: number; wrapped_key: Buffer }>('select version, wrapped_key from kernel.tenant_key where tenant_id = $1 and status = \'active\' order by version desc limit 1', [t.tenant_id]);
    if (active.rows[0]) tk = kms.unwrapTenantKey(t.tenant_id, active.rows[0].version, active.rows[0].wrapped_key);
    else {
      tk = randomDataKey();
      await db.query('insert into kernel.tenant_key (tenant_id, version, wrapped_key) values ($1, 1, $2) on conflict do nothing', [t.tenant_id, kms.wrapTenantKey(t.tenant_id, 1, tk)]);
    }
    const version = active.rows[0]?.version ?? 1;
    try {
      const rows = await db.query<{ subject_id: string; wrapped_key: Buffer }>('select subject_id, wrapped_key from kernel.subject_key where tenant_id = $1 and key_version = 0 and wrapped_key is not null order by subject_id', [t.tenant_id]);
      for (const row of rows.rows) {
        const dek = kms.subjectKey(t.tenant_id, row.subject_id, row.wrapped_key);
        const wrapped = kms.wrapSubjectKey(t.tenant_id, row.subject_id, version, tk, dek);
        await db.query('update kernel.subject_key set wrapped_key = $3, key_version = $4 where tenant_id = $1 and subject_id = $2 and key_version = 0', [t.tenant_id, row.subject_id, wrapped, version]);
        wipe(dek);
        subjects++;
      }
    } finally { wipe(tk); }
  }
  return { tenants: tenants.rows.length, subjects };
}

/** Re-wraps tenant envelopes only. Field ciphertext and subject DEKs are untouched. */
export async function rotateMasterKey(db: Queryable, oldKms: Kms, newKms: Kms): Promise<RotationResult> {
  const rows = await db.query<{ tenant_id: string; version: number; wrapped_key: Buffer }>("select tenant_id, version, wrapped_key from kernel.tenant_key where status <> 'revoked' order by tenant_id, version");
  const seen = new Set<string>();
  for (const row of rows.rows) {
    const key = oldKms.unwrapTenantKey(row.tenant_id, row.version, row.wrapped_key);
    try {
      const wrapped = newKms.wrapTenantKey(row.tenant_id, row.version, key);
      await db.query('update kernel.tenant_key set wrapped_key = $3 where tenant_id = $1 and version = $2', [row.tenant_id, row.version, wrapped]);
    } finally { wipe(key); }
    seen.add(row.tenant_id);
  }
  return { tenants: seen.size, subjects: 0 };
}

/** Creates a new tenant key and re-wraps that tenant's subject DEKs, without touching field ciphertext. */
export async function rotateTenantKey(db: Queryable, kms: Kms, tenantId: string): Promise<RotationResult> {
  const active = await db.query<{ version: number; wrapped_key: Buffer }>('select version, wrapped_key from kernel.tenant_key where tenant_id = $1 and status = \'active\' order by version desc limit 1', [tenantId]);
  if (!active.rows[0]) throw new Error('tenant has no active envelope key; run keys:upgrade first');
  const oldKey = kms.unwrapTenantKey(tenantId, active.rows[0].version, active.rows[0].wrapped_key);
  const nextVersion = active.rows[0].version + 1;
  const nextKey = randomDataKey();
  try {
    await db.query('insert into kernel.tenant_key (tenant_id, version, wrapped_key) values ($1, $2, $3)', [tenantId, nextVersion, kms.wrapTenantKey(tenantId, nextVersion, nextKey)]);
    const rows = await db.query<{ subject_id: string; wrapped_key: Buffer }>('select subject_id, wrapped_key from kernel.subject_key where tenant_id = $1 and key_version = $2 and wrapped_key is not null', [tenantId, active.rows[0].version]);
    for (const row of rows.rows) {
      const dek = kms.unwrapSubjectKey(tenantId, row.subject_id, active.rows[0].version, oldKey, row.wrapped_key);
      try { await db.query('update kernel.subject_key set wrapped_key = $3, key_version = $4 where tenant_id = $1 and subject_id = $2', [tenantId, row.subject_id, kms.wrapSubjectKey(tenantId, row.subject_id, nextVersion, nextKey, dek), nextVersion]); }
      finally { wipe(dek); }
    }
    await db.query('update kernel.tenant_key set status = \'retired\', retired_at = now() where tenant_id = $1 and version = $2', [tenantId, active.rows[0].version]);
    return { tenants: 1, subjects: rows.rows.length };
  } finally { wipe(oldKey, nextKey); }
}
