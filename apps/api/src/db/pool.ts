import pg from 'pg';
import type { Config } from '../config.js';

// bigint columns come back as strings by default. We keep strings for ids and counts, and parse money explicitly.
pg.types.setTypeParser(1082, (v: string) => v); // date as YYYY-MM-DD, no timezone shifts
pg.types.setTypeParser(1114, (v: string) => v);

export interface Pools { app: pg.Pool; auth: pg.Pool; worker: pg.Pool; end(): Promise<void> }

function mk(url: string, name: string, max: number): pg.Pool {
  const p = new pg.Pool({ connectionString: url, max, application_name: `meridian-${name}`, statement_timeout: 15000, idle_in_transaction_session_timeout: 20000 });
  p.on('connect', (c) => { c.query(`set timezone = 'UTC'`).catch(() => undefined); });
  p.on('error', () => undefined);
  return p;
}

export function createPools(cfg: Pick<Config, 'DATABASE_URL_APP' | 'DATABASE_URL_AUTH' | 'DATABASE_URL_WORKER'>): Pools {
  const app = mk(cfg.DATABASE_URL_APP, 'app', 12);
  const auth = mk(cfg.DATABASE_URL_AUTH, 'auth', 4);
  const worker = mk(cfg.DATABASE_URL_WORKER, 'worker', 2);
  return { app, auth, worker, async end() { await Promise.all([app.end(), auth.end(), worker.end()]); } };
}
