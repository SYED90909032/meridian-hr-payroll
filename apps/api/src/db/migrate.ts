import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export interface MigrateResult { applied: string[]; skipped: string[] }

/** Applies SQL files in name order as the owner role. Each file runs in its own transaction. */
export async function migrate(ownerUrl: string, dir: string): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query(`set timezone = 'UTC'`);
    await client.query('create schema if not exists kernel');
    await client.query('create table if not exists kernel.migration (name text primary key, applied_at timestamptz not null default now())');
    const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    // A lock keeps two deploys from migrating at once.
    await client.query('select pg_advisory_lock(727001)');
    for (const f of files) {
      const done = await client.query('select 1 from kernel.migration where name = $1', [f]);
      if (done.rowCount) { skipped.push(f); continue; }
      const sql = readFileSync(join(dir, f), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into kernel.migration (name) values ($1)', [f]);
        await client.query('commit');
        applied.push(f);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
    await client.query('select pg_advisory_unlock(727001)');
  } finally {
    await client.end();
  }
  return { applied, skipped };
}
