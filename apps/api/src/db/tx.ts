import type pg from 'pg';
import { withDbSpan } from '../observability.js';

export type SystemActor = 'register' | 'iam' | 'hr' | 'time' | 'flow' | 'payroll';

export interface Ctx {
  tenantId: string;
  userId: string | null;
  employeeId: string | null;
  requestId?: string;
  ip?: string;
}

export type Db = pg.PoolClient;

/**
 * Runs fn in a transaction on the app pool with tenant, user and employee set locally.
 * The settings vanish at commit or rollback, so a pooled connection never carries a previous caller's identity.
 * Row level security does the rest.
 */
export async function withTx<T>(pool: pg.Pool, ctx: Ctx, fn: (db: Db) => Promise<T>, actors: SystemActor[] = [], reason?: string): Promise<T> {
  const db = await pool.connect();
  return withDbSpan('db.transaction', async () => {
    try {
      await db.query('begin');
      await db.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.employee_id', $3, true), set_config('app.system_actor', $4, true), set_config('app.transition_reason', $5, true)`,
        [ctx.tenantId, ctx.userId ?? '', ctx.employeeId ?? '', actors.join(','), reason ?? ''],
      );
      const out = await fn(db);
      await db.query('commit');
      return out;
    } catch (e) {
      try { await db.query('rollback'); } catch { /* connection already gone */ }
      throw e;
    } finally {
      db.release();
    }
  });
}

/** Writes an audit event in the caller's transaction. */
export async function audit(db: Db, ctx: Ctx, action: string, entity: string | null, entityId: string | null, data: Record<string, unknown> = {}): Promise<void> {
  await db.query('select kernel.append_audit($1, $2, $3, $4, $5, $6::jsonb, $7, $8)', [
    ctx.tenantId, ctx.userId, action, entity, entityId, JSON.stringify(data), ctx.ip ?? null, ctx.requestId ?? null,
  ]);
}

export async function emit(db: Db, ctx: Ctx, topic: string, payload: Record<string, unknown>, dedupeKey?: string): Promise<void> {
  await db.query(
    'insert into kernel.outbox (tenant_id, topic, payload, dedupe_key) values ($1, $2, $3::jsonb, $4) on conflict do nothing',
    [ctx.tenantId, topic, JSON.stringify(payload), dedupeKey ?? null],
  );
}

/** Raises one system actor for a small block of work, then restores the previous setting. Keeps the elevated window as small as possible. */
export async function withActor<T>(db: Db, actor: SystemActor, fn: () => Promise<T>): Promise<T> {
  const prev = (await db.query<{ v: string }>(`select coalesce(current_setting('app.system_actor', true), '') as v`)).rows[0]!.v;
  await db.query(`select set_config('app.system_actor', $1, true)`, [prev ? `${prev},${actor}` : actor]);
  try { return await fn(); } finally { await db.query(`select set_config('app.system_actor', $1, true)`, [prev]); }
}
