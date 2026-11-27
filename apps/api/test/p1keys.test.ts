import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kms, LocalKeyProvider, randomDataKey, seal, open } from '../src/crypto/kms.js';
import { rotateTenantKey } from '../src/crypto/key-rotation.js';
import { LocalObjectStore } from '../src/storage/localStore.js';
import { S3ObjectStore } from '../src/storage/s3Store.js';
import { reconcileAuditSeals, writeSealOffBox } from '../src/modules/audit/seals.js';
import { mkPools, mkTenant, as, type TestTenant } from './helpers.js';
import type { Pools } from '../src/db/pool.js';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { MOTO, reachable } from './infra.js';

const key = Buffer.alloc(32, 44);
describe('p1 key custody and envelope hierarchy', () => {
  it('binds local wrapping to its deployment and preserves v0 compatibility', async () => {
    const p = new LocalKeyProvider(key, 'test-a');
    const wrapped = await p.wrapMasterKey(randomDataKey());
    expect((await p.unwrapMasterKey()).equals(key)).toBe(true);
    expect(await new LocalKeyProvider(key, 'test-a').wrapMasterKey(Buffer.alloc(32, 1))).not.toEqual(wrapped);
    const kms = new Kms(key);
    const legacy = kms.subjectKey('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', Buffer.alloc(32, 3));
    expect(open(legacy, seal(legacy, Buffer.from('legacy'), 'legacy-aad'), 'legacy-aad').toString()).toBe('legacy');
    const tenant = randomDataKey();
    const wrappedTenant = kms.wrapTenantKey('00000000-0000-0000-0000-000000000001', 1, tenant);
    const dek = randomDataKey();
    const wrappedDek = kms.wrapSubjectKey('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 1, tenant, dek);
    expect(kms.unwrapSubjectKey('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 1, kms.unwrapTenantKey('00000000-0000-0000-0000-000000000001', 1, wrappedTenant), wrappedDek)).toEqual(dek);
    expect(() => new Kms(Buffer.alloc(32, 45)).unwrapTenantKey('00000000-0000-0000-0000-000000000001', 1, wrappedTenant)).toThrow();
  });
});

describe('p1 database enforcement', () => {
  let pools: Pools; let owner: pg.Pool; let tenant: TestTenant;
  beforeAll(async () => { pools = mkPools(); owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER }); tenant = await mkTenant(pools, 'p1'); });
  afterAll(async () => { await pools.end(); await owner.end(); });
  it('fails loudly when a newly created tenant table lacks forced RLS', async () => {
    const c = await owner.connect();
    try {
      await c.query('begin');
      await c.query('create table people.p1_catalog_probe (id uuid, tenant_id uuid)');
      const r = await c.query(`select c.relrowsecurity enabled, c.relforcerowsecurity forced from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'people' and c.relname = 'p1_catalog_probe'`);
      expect(r.rows[0]).toEqual({ enabled: false, forced: false });
    } finally { await c.query('rollback'); c.release(); }
  });
  it('requires forced RLS on every catalog tenant table and least-privilege runtime roles', async () => {
    const tables = await owner.query(`select c.oid::regclass::text as table_name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where c.relkind in ('r','p') and not c.relispartition and n.nspname in ('kernel','people','flow','tm','pay','svc','plat','ai')`);
    expect(tables.rows.length).toBeGreaterThan(40);
    expect(tables.rows.filter((r) => !r.enabled || !r.forced).map((r) => r.table_name)).toEqual([]);
    const roles = await owner.query(`select rolname, rolsuper, rolbypassrls, exists (select 1 from pg_class c where c.relowner = r.oid and c.relkind in ('r','p')) as owns_table
      from pg_roles r where rolname in ('meridian_app','meridian_auth','meridian_worker') order by rolname`);
    for (const r of roles.rows) { expect(r.rolsuper).toBe(false); expect(r.rolbypassrls).toBe(false); expect(r.owns_table).toBe(false); }
  });
  it('blocks owner-level crypto-shred while a legal hold is active, then allows release', async () => {
    const id = tenant.employeeId!;
    await as(pools, tenant, { userId: tenant.userId, employeeId: tenant.employeeId }, async (db) => {
      await db.query('insert into kernel.subject_key (tenant_id, subject_id, wrapped_key, key_version) values ($1, $2, $3, 0) on conflict do nothing', [tenant.tenantId, id, Buffer.alloc(32, 8)]);
      await db.query('insert into kernel.legal_hold (tenant_id, subject_id, reason, created_by) values ($1, $2, $3, $4)', [tenant.tenantId, id, 'test hold', tenant.userId]);
    });
    await expect(owner.query('update kernel.subject_key set wrapped_key = null, destroyed_at = now() where tenant_id = $1 and subject_id = $2', [tenant.tenantId, id])).rejects.toThrow(/legal hold/);
    await owner.query('update kernel.legal_hold set released_at = now() where tenant_id = $1 and subject_id = $2', [tenant.tenantId, id]);
    await owner.query('update kernel.subject_key set wrapped_key = null, destroyed_at = now() where tenant_id = $1 and subject_id = $2', [tenant.tenantId, id]);
  });
});

describe('p1 off-box seals', () => {
  it('writes write-once records and reports deletion drift', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meridian-seals-'));
    const store = new LocalObjectStore(dir);
    const row = { tenant_id: '00000000-0000-0000-0000-000000000011', from_seq: 1, to_seq: 2, merkle_root: 'root', signature: 'sig', key_id: 'key', sealed_at: new Date('2026-01-01T00:00:00.000Z') };
    await writeSealOffBox(store, row, 'PUBLIC KEY');
    const db = { query: async (sql: string) => sql.startsWith('select tenant_id') ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 } } as never;
    expect((await reconcileAuditSeals(db, store, row.tenant_id)).drift).toBe(false);
    await store.delete('audit-seals/00000000-0000-0000-0000-000000000011/1-2.json');
    const drift = await reconcileAuditSeals(db, store, row.tenant_id);
    expect(drift.missing).toHaveLength(1);
    await rm(dir, { recursive: true, force: true });
  });
});

const motoUp = await reachable(MOTO);
describe.skipIf(!motoUp)('p1 off-box seals: S3 (moto)', () => {
  const tenantId = '00000000-0000-0000-0000-000000000012';
  const cfg = { bucket: `meridian-seals-${Date.now()}`, region: 'us-east-1', endpoint: MOTO, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } };
  const row = { tenant_id: tenantId, from_seq: 3, to_seq: 4, merkle_root: 'root-s3', signature: 'sig-s3', key_id: 'key-s3', sealed_at: new Date('2026-01-01T00:00:00.000Z') };
  const db = { query: async (sql: string) => sql.startsWith('select tenant_id') ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 } } as never;
  it('reconciles a seal and detects a deleted S3 object', async () => {
    await new S3Client(cfg).send(new CreateBucketCommand({ Bucket: cfg.bucket }));
    const store = new S3ObjectStore(cfg);
    await writeSealOffBox(store, row, 'PUBLIC KEY S3');
    expect((await reconcileAuditSeals(db, store, tenantId)).drift).toBe(false);
    await store.delete('audit-seals/00000000-0000-0000-0000-000000000012/3-4.json');
    expect((await reconcileAuditSeals(db, store, tenantId)).missing).toHaveLength(1);
  });
});
