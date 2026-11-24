import type { Db } from '../../db/tx.js';

export interface Note { kind: string; title: string; body?: string; link?: string }

export async function notifyUser(db: Db, tenantId: string, userId: string, n: Note): Promise<void> {
  await db.query('insert into flow.notification (tenant_id, user_id, kind, title, body, link) values ($1, $2, $3, $4, $5, $6)', [tenantId, userId, n.kind, n.title.slice(0, 200), n.body ?? null, n.link ?? null]);
}

export async function notifyEmployee(db: Db, tenantId: string, employeeId: string, n: Note): Promise<void> {
  const r = await db.query<{ user_id: string }>('select user_id from kernel.membership where tenant_id = $1 and employee_id = $2 and status = $3', [tenantId, employeeId, 'active']);
  for (const row of r.rows) await notifyUser(db, tenantId, row.user_id, n);
}

export async function notifyRoles(db: Db, tenantId: string, roles: string[], n: Note, exceptUserId?: string | null): Promise<void> {
  const r = await db.query<{ user_id: string }>('select distinct user_id from kernel.role_assignment where tenant_id = $1 and role = any($2) and revoked_at is null', [tenantId, roles]);
  for (const row of r.rows) if (row.user_id !== exceptUserId) await notifyUser(db, tenantId, row.user_id, n);
}
