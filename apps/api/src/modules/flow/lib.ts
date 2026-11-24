import { randomBytes } from 'node:crypto';
import { hashOf } from '@meridian/engine';
import type { Ctx, Db } from '../../db/tx.js';
import { audit } from '../../db/tx.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { sha256 } from '../../crypto/tokens.js';
import { notifyUser } from './notify.js';

export interface ApprovalRecord { id: string; kind: string; entity: string; entity_id: string; title: string; requester_user_id: string; subject_employee_id: string | null; payload: Record<string, unknown>; content_hash: string }
export interface ApprovalHandler {
  onApproved(db: Db, ctx: Ctx, req: ApprovalRecord): Promise<void>;
  onRejected(db: Db, ctx: Ctx, req: ApprovalRecord): Promise<void>;
}
const handlers = new Map<string, ApprovalHandler>();
export const registerApprovalHandler = (kind: string, h: ApprovalHandler): void => { handlers.set(kind, h); };

export interface CreateApprovalInput {
  kind: 'leave' | 'bank_change' | 'comp_change' | 'role_change' | 'document' | 'other';
  entity: string; entityId: string; title: string;
  requesterUserId: string; subjectEmployeeId: string | null;
  payload: Record<string, unknown>;
  approverUserIds: string[];
  maxAssurance?: 'app' | 'app_stepup';
}

export const contentHashOf = (i: { kind: string; entity: string; entityId: string; payload: Record<string, unknown> }): string =>
  hashOf({ kind: i.kind, entity: i.entity, entity_id: i.entityId, payload: i.payload });

export async function createApproval(db: Db, ctx: Ctx, i: CreateApprovalInput): Promise<{ id: string; contentHash: string }> {
  if (!i.approverUserIds.length) throw conflict('No approver is available for this request. Ask an administrator to assign a manager.', 'no_approver');
  if (i.approverUserIds.includes(i.requesterUserId)) throw new HttpError(422, 'self_approval', 'You cannot approve your own request');
  const contentHash = contentHashOf(i);
  const r = await db.query<{ id: string }>(
    `insert into flow.approval_request (tenant_id, kind, entity, entity_id, title, requester_user_id, content_hash, payload, max_channel_assurance, approver_ids, subject_employee_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11) returning id`,
    [ctx.tenantId, i.kind, i.entity, i.entityId, i.title.slice(0, 200), i.requesterUserId, contentHash, JSON.stringify(i.payload), i.maxAssurance ?? 'app', i.approverUserIds, i.subjectEmployeeId]);
  const id = r.rows[0]!.id;
  let n = 1;
  for (const a of i.approverUserIds) {
    await db.query('insert into flow.approval_step (tenant_id, request_id, step_no, approver_user_id, requester_user_id, subject_employee_id) values ($1, $2, $3, $4, $5, $6)', [ctx.tenantId, id, n++, a, i.requesterUserId, i.subjectEmployeeId]);
  }
  await notifyUser(db, ctx.tenantId, i.approverUserIds[0]!, { kind: 'approval.requested', title: i.title, body: 'Waiting for your decision.', link: '/approvals' });
  await audit(db, ctx, 'approval.requested', i.entity, i.entityId, { request_id: id, kind: i.kind, approvers: i.approverUserIds.length });
  return { id, contentHash };
}

export interface DecideInput { stepId: string; decision: 'approve' | 'reject'; comment?: string; contentHash: string; via: 'app' | 'token'; stepUpFresh: boolean }

/** Applies one decision. The caller has already established who the approver is (session or one-time token). */
export async function decide(db: Db, ctx: Ctx, i: DecideInput): Promise<{ status: string }> {
  const s = await db.query(
    `select st.*, rq.status as rq_status, rq.content_hash, rq.kind, rq.entity, rq.entity_id, rq.title, rq.requester_user_id as rq_requester, rq.payload, rq.max_channel_assurance, rq.subject_employee_id as rq_subject
       from flow.approval_step st join flow.approval_request rq on rq.id = st.request_id where st.id = $1 for update of st`, [i.stepId]);
  const st = s.rows[0];
  if (!st) throw notFound('Approval not found');
  if (st.approver_user_id !== ctx.userId) throw forbidden('This approval is assigned to someone else');
  if (st.status !== 'pending' || st.rq_status !== 'pending') throw conflict('This request has already been decided', 'already_decided');
  if (st.requester_user_id === ctx.userId) throw new HttpError(422, 'self_approval', 'You cannot approve your own request');
  if (st.content_hash !== i.contentHash) throw new HttpError(409, 'content_changed', 'The request changed after you opened it. Reload and review again.');
  if (i.via === 'token' && st.max_channel_assurance !== 'app') throw forbidden('This approval must be made inside the app');
  if (st.max_channel_assurance === 'app_stepup' && !i.stepUpFresh) throw new HttpError(401, 'step_up_required', 'Confirm your identity to continue');
  const earlier = await db.query(`select 1 from flow.approval_step where request_id = $1 and step_no < $2 and status <> 'approved'`, [st.request_id, st.step_no]);
  if (earlier.rowCount) throw conflict('An earlier approver has not decided yet', 'not_your_turn');

  const status = i.decision === 'approve' ? 'approved' : 'rejected';
  await db.query('update flow.approval_step set status = $2, decided_by = $3, decided_at = now(), comment = $4 where id = $1', [i.stepId, status, ctx.userId, i.comment ?? null]);
  const rec: ApprovalRecord = { id: st.request_id, kind: st.kind, entity: st.entity, entity_id: st.entity_id, title: st.title, requester_user_id: st.rq_requester, subject_employee_id: st.rq_subject, payload: st.payload, content_hash: st.content_hash };
  let final: string;
  if (i.decision === 'reject') {
    await db.query(`update flow.approval_step set status = 'voided' where request_id = $1 and status = 'pending'`, [st.request_id]);
    await db.query(`update flow.approval_request set status = 'rejected', decided_at = now() where id = $1`, [st.request_id]);
    await handlers.get(st.kind)?.onRejected(db, ctx, rec);
    await notifyUser(db, ctx.tenantId, st.rq_requester, { kind: 'approval.rejected', title: `Declined: ${st.title}`, body: i.comment, link: '/approvals' });
    final = 'rejected';
  } else {
    const next = await db.query(`select approver_user_id from flow.approval_step where request_id = $1 and status = 'pending' order by step_no limit 1`, [st.request_id]);
    if (next.rows[0]) {
      await notifyUser(db, ctx.tenantId, next.rows[0].approver_user_id, { kind: 'approval.requested', title: st.title, body: 'Waiting for your decision.', link: '/approvals' });
      final = 'pending';
    } else {
      await db.query(`update flow.approval_request set status = 'approved', decided_at = now() where id = $1`, [st.request_id]);
      await handlers.get(st.kind)?.onApproved(db, ctx, rec);
      await notifyUser(db, ctx.tenantId, st.rq_requester, { kind: 'approval.approved', title: `Approved: ${st.title}`, link: '/approvals' });
      final = 'approved';
    }
  }
  await audit(db, ctx, `approval.${status}`, st.entity, st.entity_id, { request_id: st.request_id, step: st.step_no, via: i.via });
  return { status: final };
}

export async function cancelApproval(db: Db, ctx: Ctx, requestId: string): Promise<ApprovalRecord> {
  const r = await db.query('select * from flow.approval_request where id = $1 for update', [requestId]);
  const rq = r.rows[0];
  if (!rq) throw notFound('Request not found');
  if (rq.requester_user_id !== ctx.userId) throw forbidden();
  if (rq.status !== 'pending') throw conflict('Only open requests can be withdrawn', 'not_pending');
  await db.query(`update flow.approval_step set status = 'voided' where request_id = $1 and status = 'pending'`, [requestId]);
  await db.query(`update flow.approval_request set status = 'cancelled', decided_at = now() where id = $1`, [requestId]);
  await db.query(`update flow.action_token set used_at = now() where step_id in (select id from flow.approval_step where request_id = $1) and used_at is null`, [requestId]);
  return { id: rq.id, kind: rq.kind, entity: rq.entity, entity_id: rq.entity_id, title: rq.title, requester_user_id: rq.requester_user_id, subject_employee_id: rq.subject_employee_id, payload: rq.payload, content_hash: rq.content_hash };
}

// ------------------------------------------------------------------ one-time action tokens (approve from a notification link)
export async function issueActionToken(db: Db, ctx: Ctx, stepId: string): Promise<string> {
  const s = await db.query(`select st.approver_user_id, rq.content_hash, rq.max_channel_assurance from flow.approval_step st join flow.approval_request rq on rq.id = st.request_id where st.id = $1 and st.status = 'pending'`, [stepId]);
  const st = s.rows[0];
  if (!st) throw notFound('Step not found');
  if (st.max_channel_assurance !== 'app') throw forbidden('Tokens are not issued for this kind of request');
  const raw = randomBytes(32).toString('base64url');
  await db.query(`insert into flow.action_token (tenant_id, step_id, token_hash, approver_user_id, content_hash, expires_at) values ($1, $2, $3, $4, $5, now() + interval '15 minutes')`,
    [ctx.tenantId, stepId, sha256(raw), st.approver_user_id, st.content_hash]);
  return `${ctx.tenantId}.${raw}`;
}

export async function consumeActionToken(db: Db, tenantId: string, raw: string): Promise<{ stepId: string; approverUserId: string; contentHash: string }> {
  // Single use: the update succeeds for exactly one caller.
  const r = await db.query(`update flow.action_token set used_at = now() where token_hash = $1 and tenant_id = $2 and used_at is null and expires_at > now() returning step_id, approver_user_id, content_hash`, [sha256(raw), tenantId]);
  if (!r.rows[0]) throw new HttpError(410, 'token_invalid', 'This link has expired or was already used');
  return { stepId: r.rows[0].step_id, approverUserId: r.rows[0].approver_user_id, contentHash: r.rows[0].content_hash };
}

/** Walks up the management chain to the first manager who has a user account. Falls back to HR and owners, never the requester. */
export async function resolveApprovers(db: Db, tenantId: string, employeeId: string, requesterUserId: string): Promise<string[]> {
  const chain = await db.query<{ user_id: string }>(
    `with recursive up as (
        select manager_id, 1 as depth from people.employee where id = $1
        union all
        select e.manager_id, up.depth + 1 from people.employee e join up on e.id = up.manager_id where up.depth < 12
     )
     select m.user_id from up join kernel.membership m on m.employee_id = up.manager_id and m.tenant_id = $2 and m.status = 'active'
     where up.manager_id is not null and m.user_id <> $3 order by up.depth limit 1`, [employeeId, tenantId, requesterUserId]);
  if (chain.rows[0]) return [chain.rows[0].user_id];
  const fallback = await db.query<{ user_id: string }>(
    `select distinct ra.user_id from kernel.role_assignment ra join kernel.membership m on m.user_id = ra.user_id and m.tenant_id = ra.tenant_id and m.status = 'active'
      where ra.tenant_id = $1 and ra.role in ('hr_admin', 'owner') and ra.revoked_at is null and ra.user_id <> $2 order by ra.user_id limit 1`, [tenantId, requesterUserId]);
  return fallback.rows.map((x) => x.user_id);
}

export { badRequest };
