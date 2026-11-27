import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/tx.js';

export interface Note { kind: string; title: string; body?: string; link?: string }

export async function notifyUser(db: Db, tenantId: string, userId: string, n: Note): Promise<void> {
  // RETURNING would apply the recipient-only SELECT policy to a notification addressed to another user.
  const notificationId = randomUUID();
  await db.query('insert into flow.notification (id, tenant_id, user_id, kind, title, body, link) values ($1, $2, $3, $4, $5, $6, $7)', [notificationId, tenantId, userId, n.kind, n.title.slice(0, 200), n.body ?? null, n.link ?? null]);
  const template = templateFor(n.kind);
  if (!template) return;
  const recipient = (await db.query<{ email: string; display_name: string }>('select email::text, display_name from kernel.membership where tenant_id = $1 and user_id = $2 and status = $3', [tenantId, userId, 'active'])).rows[0];
  if (!recipient) return;
  const preference = (await db.query<{ email_enabled: boolean }>('select email_enabled from comms.notification_preference where tenant_id = $1 and user_id = $2 and kind = $3', [tenantId, userId, preferenceFor(n.kind)])).rows[0];
  if (preference?.email_enabled === false && !n.kind.startsWith('security.')) return;
  const payload = { to: recipient.email, recipientName: recipient.display_name, template, link: n.link?.startsWith('/') ? n.link : '/' };
  await db.query('insert into kernel.outbox (tenant_id, topic, payload, dedupe_key) values ($1, $2, $3::jsonb, $4) on conflict do nothing', [tenantId, 'email.send', JSON.stringify(payload), `notification:${notificationId}`]);
}

function templateFor(kind: string): string | null {
  if (kind === 'leave.requested') return 'leave-requested.v1';
  if (kind === 'leave.approved' || kind === 'leave.rejected') return 'leave-decided.v1';
  if (kind === 'approval.requested') return 'approval-pending.v1';
  if (kind === 'pay.review') return 'pay-run-ready.v1';
  if (kind === 'payslip.published') return 'payslip-published.v1';
  return null;
}
function preferenceFor(kind: string): string {
  if (kind === 'leave.requested') return 'leave-requested';
  if (kind === 'leave.approved' || kind === 'leave.rejected') return 'leave-decided';
  if (kind === 'approval.requested') return 'approval-pending';
  if (kind === 'pay.review') return 'pay-run-ready';
  return 'payslip-published';
}

export async function notifyEmployee(db: Db, tenantId: string, employeeId: string, n: Note): Promise<void> {
  const r = await db.query<{ user_id: string }>('select user_id from kernel.membership where tenant_id = $1 and employee_id = $2 and status = $3', [tenantId, employeeId, 'active']);
  for (const row of r.rows) await notifyUser(db, tenantId, row.user_id, n);
}

export async function notifyRoles(db: Db, tenantId: string, roles: string[], n: Note, exceptUserId?: string | null): Promise<void> {
  const r = await db.query<{ user_id: string }>('select distinct user_id from kernel.role_assignment where tenant_id = $1 and role = any($2) and revoked_at is null', [tenantId, roles]);
  for (const row of r.rows) if (row.user_id !== exceptUserId) await notifyUser(db, tenantId, row.user_id, n);
}
