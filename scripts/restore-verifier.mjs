#!/usr/bin/env node
import { createHash, createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('../apps/api/node_modules/pg');

const [url, publicKeyPath] = process.argv.slice(2);
if (!url || !publicKeyPath) {
  console.error('usage: restore-verifier.mjs <postgres-url> <audit-public-key.pem>');
  process.exit(2);
}
const sha = (hex) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
function merkleRoot(hashes) {
  const leaf = (x) => sha('00' + x);
  const node = (a, b) => sha('01' + a + b);
  let level = hashes.map(leaf);
  if (!level.length) throw new Error('empty seal block');
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? node(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}
const pool = new pg.Pool({ connectionString: url, max: 2 });
const pub = createPublicKey(fs.readFileSync(publicKeyPath, 'utf8'));
try {
  const client = await pool.connect();
  try {
    const broken = await client.query('select tenant_id, kernel.verify_audit(tenant_id) as broken from kernel.audit_head order by tenant_id');
    if (broken.rows.some((r) => r.broken !== null && r.broken !== '')) throw new Error(`audit hash chain failed: ${JSON.stringify(broken.rows)}`);
    const blocks = await client.query('select tenant_id, from_seq, to_seq, merkle_root, signature from kernel.audit_block order by tenant_id, from_seq');
    for (const block of blocks.rows) {
      const events = await client.query('select hash from kernel.audit_event where tenant_id = $1 and seq between $2 and $3 order by seq', [block.tenant_id, block.from_seq, block.to_seq]);
      if (merkleRoot(events.rows.map((r) => r.hash)) !== block.merkle_root) throw new Error(`Merkle root mismatch for ${block.tenant_id}:${block.from_seq}`);
      const message = `meridian-audit-block|${block.tenant_id}|${block.from_seq}|${block.to_seq}|${block.merkle_root}`;
      if (!block.signature || !verify(null, Buffer.from(message), pub, Buffer.from(block.signature, 'base64'))) throw new Error(`seal signature mismatch for ${block.tenant_id}:${block.from_seq}`);
    }
    const tables = await client.query("select n.nspname || '.' || c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in ('kernel','people','flow','tm','pay','svc','plat','ai') order by 1");
    const forced = await client.query("select n.nspname || '.' || c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and not c.relispartition and n.nspname in ('kernel','people','flow','tm','pay','svc','plat','ai') and c.relrowsecurity and c.relforcerowsecurity and (c.oid = 'kernel.tenant'::regclass or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) or n.nspname || '.' || c.relname like 'kernel.audit_%') and (has_table_privilege('meridian_app', c.oid, 'select') or has_table_privilege('meridian_app', c.oid, 'insert')) order by 1");
    const missing = forced.rows.length < 1 ? ['no tenant tables with forced RLS'] : [];
    const expectedTenantTables = await client.query("select n.nspname || '.' || c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and not c.relispartition and n.nspname in ('kernel','people','flow','tm','pay','svc','plat','ai') and (c.oid = 'kernel.tenant'::regclass or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)) and not n.nspname || '.' || c.relname like 'kernel.audit_%' and (has_table_privilege('meridian_app', c.oid, 'select') or has_table_privilege('meridian_app', c.oid, 'insert'))");
    for (const row of expectedTenantTables.rows) if (!forced.rows.some((f) => f.table_name === row.table_name)) missing.push(row.table_name);
    if (missing.length) throw new Error(`restored tables without forced RLS: ${missing.join(', ')}`);
    const counts = {};
    for (const row of tables.rows) counts[row.table_name] = Number((await client.query(`select count(*)::bigint as count from ${row.table_name}`)).rows[0].count);
    console.log(JSON.stringify({ auditTenants: broken.rowCount, seals: blocks.rowCount, tableCount: tables.rowCount, forcedRlsTables: forced.rowCount, rowCounts: counts, status: 'ok' }));
  } finally { client.release(); }
} finally { await pool.end(); }
