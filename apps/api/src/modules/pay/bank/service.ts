import type { Db } from '../../../db/tx.js';
import { HttpError } from '../../../errors.js';

export async function queueBankSubmission(db: Db, tenantId: string, userId: string, runId: string): Promise<{ submissionId: string; fileHash: string }> {
  const run = (await db.query<{ status: string; bank_file_hash: string | null }>('select status, bank_file_hash from pay.pay_run where id = $1 and tenant_id = $2 for update', [runId, tenantId])).rows[0];
  if (!run) throw new HttpError(404, 'not_found', 'Pay run not found');
  if (run.status !== 'payment_released') throw new HttpError(409, 'bank_submission_not_ready', 'Bank submission is available only after payment is released');
  if (!run.bank_file_hash) throw new HttpError(422, 'payment_file_unavailable', 'This pay run has no bank file');
  const file = (await db.query<{ content: string }>('select content from pay.payment_file where pay_run_id = $1 and content_hash = $2', [runId, run.bank_file_hash])).rows[0];
  if (!file) throw new HttpError(422, 'payment_file_unavailable', 'The bank file is unavailable');
  const r = await db.query<{ id: string }>("insert into pay.bank_submission (tenant_id, pay_run_id, transport, file_hash, submitted_by) values ($1, $2, 'manual', $3, $4) on conflict (pay_run_id, file_hash) do update set submitted_by = excluded.submitted_by returning id", [tenantId, runId, run.bank_file_hash, userId]);
  await db.query('insert into kernel.outbox (tenant_id, topic, payload, dedupe_key) values ($1, $2, $3::jsonb, $4) on conflict do nothing', [tenantId, 'bank.submit', JSON.stringify({ submission_id: r.rows[0]!.id, pay_run_id: runId, file_hash: run.bank_file_hash }), `bank.submit:${runId}:${run.bank_file_hash}`]);
  return { submissionId: r.rows[0]!.id, fileHash: run.bank_file_hash };
}
