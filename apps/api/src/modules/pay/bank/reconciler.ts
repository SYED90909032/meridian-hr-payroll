import type { Db } from '../../../db/tx.js';

export interface ParsedAcknowledgement {
  employeeRef: string;
  status: 'accepted' | 'rejected';
  reason: string | null;
}

/** Bank acknowledgements contain references only; file contents and credentials are never logged. */
export function parseAcknowledgement(content: string): ParsedAcknowledgement[] {
  const out: ParsedAcknowledgement[] = [];
  const lines = content.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const [kind, employeeRef, status, ...reason] = line.split(',');
    if (kind !== 'ACK' || !employeeRef || (status !== 'ACCEPTED' && status !== 'REJECTED')) throw new Error('invalid bank acknowledgement');
    out.push({ employeeRef, status: status === 'ACCEPTED' ? 'accepted' : 'rejected', reason: reason.join(',').trim() || null });
  }
  if (!out.length) throw new Error('bank acknowledgement has no employee records');
  return out;
}

export async function reconcileAcknowledgement(db: Db, submissionId: string, content: string): Promise<{ accepted: number; rejected: number }> {
  const rows = parseAcknowledgement(content);
  const sub = (await db.query<{ pay_run_id: string; tenant_id: string }>('select pay_run_id, tenant_id from pay.bank_submission where id = $1 for update', [submissionId])).rows[0];
  if (!sub) throw new Error('bank submission not found');
  let accepted = 0, rejected = 0;
  for (const row of rows) {
    const employee = (await db.query<{ id: string }>('select id from people.employee where tenant_id = $1 and employee_no = $2', [sub.tenant_id, row.employeeRef])).rows[0];
    await db.query('insert into pay.bank_acknowledgement (tenant_id, pay_run_id, bank_submission_id, employee_id, instruction_ref, status, reason) values ($1, $2, $3, $4, $5, $6, $7)',
      [sub.tenant_id, sub.pay_run_id, submissionId, employee?.id ?? null, row.employeeRef, row.status, row.reason]);
    if (row.status === 'accepted') accepted++; else rejected++;
  }
  await db.query("update pay.bank_submission set status = $2, acknowledged_at = now() where id = $1", [submissionId, rejected ? 'rejected' : 'acknowledged']);
  return { accepted, rejected };
}
