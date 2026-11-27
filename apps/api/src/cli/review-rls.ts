import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadDotEnv } from '../env.js';
loadDotEnv();
const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error('DATABASE_URL_OWNER is required');
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const tables = await db.query<{ schema: string; table: string; tenant: boolean; enabled: boolean; forced: boolean; policies: string[] | null }>(`
    select n.nspname as schema, c.relname as table,
      exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tenant,
      c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
      coalesce(array_agg(p.polname order by p.polname) filter (where p.polname is not null), '{}') as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
     where c.relkind in ('r','p') and n.nspname in ('kernel','people','flow','tm','pay','svc','plat','ai') and not c.relispartition
     group by n.nspname, c.relname, c.oid, c.relrowsecurity, c.relforcerowsecurity order by n.nspname, c.relname`);
  const roles = await db.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; owner_tables: string[] | null }>(`
    select r.rolname, r.rolsuper, r.rolbypassrls,
      coalesce(array_agg(n.nspname || '.' || c.relname) filter (where c.oid is not null), '{}') as owner_tables
      from pg_roles r left join pg_class c on c.relowner = r.oid and c.relkind in ('r','p')
      left join pg_namespace n on n.oid = c.relnamespace
     where r.rolname in ('meridian_app','meridian_auth','meridian_worker') group by r.rolname, r.rolsuper, r.rolbypassrls order by r.rolname`);
  const lines = ['# RLS catalog matrix', '', `Generated: ${new Date().toISOString()}`, '', '| Schema | Table | tenant_id | RLS | Forced | Policies |', '|---|---|---:|---:|---:|---|'];
  for (const t of tables.rows) {
    const policies = Array.isArray(t.policies) ? t.policies : String(t.policies ?? '{}').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
    lines.push(`| ${t.schema} | ${t.table} | ${t.tenant} | ${t.enabled} | ${t.forced} | ${policies.join(', ')} |`);
  }
  lines.push('', '## Runtime roles', '', '| Role | Superuser | BYPASSRLS | Owned tables |', '|---|---:|---:|---|');
  for (const r of roles.rows) {
    const owned = Array.isArray(r.owner_tables) ? r.owner_tables : String(r.owner_tables ?? '{}').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
    lines.push(`| ${r.rolname} | ${r.rolsuper} | ${r.rolbypassrls} | ${owned.join(', ') || 'none'} |`);
  }
  lines.push('', 'Global reference exceptions are tables without tenant_id whose contents are intentionally shared (for example pay.pack_registry and kernel.role_field_grant). All rows with tenant_id remain tenant-scoped.', '');
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const out = join(repo, 'docs', 'reviews', 'rls-catalog-matrix.md');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, lines.join('\n'));
  console.log(out);
} finally { await db.end(); }
