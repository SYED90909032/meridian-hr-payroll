import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { boot, stepUp, type Booted } from './api-helpers.js';
import { payWorld, runTo, type PayWorld } from './pay-fixtures.js';
import { withTx } from '../src/db/tx.js';

let b: Booted; let w: PayWorld; let owner: pg.Pool;
const PACK = 'ae-private-sector';
let fixtureEvidenceReady = false;
async function installThrowawayEvidence(): Promise<void> {
  if (fixtureEvidenceReady) return;
  const pack = (await owner.query<{ version: string; pack_hash: string }>('select version, pack_hash from pay.pack_registry where pack_id = $1', [PACK])).rows[0]!;
  const existing = await owner.query('select 1 from pay.pack_signoff where pack_id = $1 and version = $2 and pack_hash = $3', [PACK, pack.version, pack.pack_hash]);
  if (existing.rowCount) { fixtureEvidenceReady = true; return; }
  const runs: string[] = [];
  const parallel: string[] = [];
  await withTx(b.pools.app, { tenantId: w.t.tenantId, userId: w.owner.userId, employeeId: w.owner.employeeId }, async (db) => {
    for (const month of ['2027-01', '2027-02']) {
      const run = (await db.query<{ id: string }>(`insert into pay.pay_run (tenant_id, pay_group_id, period_start, period_end, mode, pack_id, pack_version, pack_hash, prepared_by) values ($1, $2, $3::date, ($3::date + interval '27 days')::date, 'parallel', $4, $5, $6, $7) returning id`, [w.t.tenantId, w.groupId, `${month}-01`, PACK, pack.version, pack.pack_hash, w.owner.userId])).rows[0]!.id;
      runs.push(run);
      const p = (await db.query<{ id: string }>(`insert into pay.parallel_run (tenant_id, pay_run_id, period_start, period_end, external_file_hash, status, zero_unexplained, created_by, completed_at) select tenant_id, id, period_start, period_end, $2, 'zero_variance', true, prepared_by, now() from pay.pay_run where id = $1 returning id`, [run, randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64)])).rows[0]!.id;
      parallel.push(p);
    }
  }, ['payroll']);
  await owner.query(`insert into pay.pack_signoff (pack_id, version, pack_hash, reviewer_name, reviewer_organisation, credential_note, signed_at, scope, document_reference, document_hash, golden_vector_set_hash, bank_wps_acceptance_reference, parallel_run_ids) values ($1,$2,$3,'Test fixture reviewer','Throwaway test organisation','Synthetic fixture only',now(),'Test-only state-machine path','fixture://throwaway',$4,$5,'BANK-FIXTURE',$6::uuid[])`, [PACK, pack.version, pack.pack_hash, 'a'.repeat(64), 'b'.repeat(64), parallel]);
  fixtureEvidenceReady = true;
}
const setAssurance = async (a: 'L0' | 'L2') => {
  if (a === 'L2') await installThrowawayEvidence();
  await owner.query(`update pay.pack_registry set assurance = $2, reviewer = $3, reviewed_at = $4 where pack_id = $1`, [PACK, a, a === 'L0' ? null : 'Test Reviewer (fixture)', a === 'L0' ? null : new Date()]);
};
beforeAll(async () => {
  b = await boot(); w = await payWorld(b, 'live', 2);
  owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 2 });
  await setAssurance('L0');
});
afterAll(async () => { await setAssurance('L0'); await owner.end(); await b.close(); });

const detail = async (id: string) => (await w.preparer.client.get(`/api/v1/pay/runs/${id}`)).body;
async function approveAndFinalise(id: string): Promise<{ bankHash: string }> {
  const hash = (await detail(id)).run.result_set_hash as string;
  await stepUp(b, w.approver);
  const a = await w.approver.client.post(`/api/v1/pay/runs/${id}/approve`, { resultSetHash: hash });
  if (a.status !== 200) throw new Error('approve failed ' + JSON.stringify(a.body));
  await stepUp(b, w.preparer);
  const f = await w.preparer.client.post(`/api/v1/pay/runs/${id}/finalise`);
  if (f.status !== 200) throw new Error('finalise failed ' + JSON.stringify(f.body));
  return { bankHash: f.body.bankFileHash as string };
}

describe('live payment gates', () => {
  let id = ''; let bankHash = '';
  it('payment cannot be released while the rule pack is unreviewed (L0)', async () => {
    id = await runTo(b, w, { mode: 'live', period: ['2025-07-01', '2025-07-31'] });
    ({ bankHash } = await approveAndFinalise(id));
    const d = await detail(id);
    expect(d.packAssurance).toBe('L0');
    expect(d.livePaymentAllowed).toBe(false);
    await stepUp(b, w.approver);
    const r = await w.approver.client.post(`/api/v1/pay/runs/${id}/release`, { bankFileHash: bankHash });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await detail(id)).run.status).toBe('finalised');
  });
  it('release is refused for a bank file that differs from what was reviewed', async () => {
    await setAssurance('L2');
    await stepUp(b, w.approver);
    const r = await w.approver.client.post(`/api/v1/pay/runs/${id}/release`, { bankFileHash: 'b'.repeat(64) });
    expect(r.status).toBe(409);
    expect((await detail(id)).run.status).toBe('finalised');
  });
  it('sandbox runs can never release payment', async () => {
    const sid = await runTo(b, w, { mode: 'sandbox', period: ['2025-06-01', '2025-06-30'] });
    const { bankHash: h } = await approveAndFinalise(sid);
    await stepUp(b, w.approver);
    const r = await w.approver.client.post(`/api/v1/pay/runs/${sid}/release`, { bankFileHash: h });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('not_live');
  });
  it('with a reviewed pack, the approver releases the exact file; then mark paid and publish', async () => {
    await setAssurance('L2');
    await stepUp(b, w.approver);
    const r = await w.approver.client.post(`/api/v1/pay/runs/${id}/release`, { bankFileHash: bankHash });
    expect(r.status).toBe(200);
    expect((await detail(id)).run.status).toBe('payment_released');
    // publishing before payment is confirmed is refused
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/publish`)).status).toBeGreaterThanOrEqual(400);
    await stepUp(b, w.approver);
    const paid = await w.approver.client.post(`/api/v1/pay/runs/${id}/mark-paid`, { kind: 'bank_confirmation', evidence: 'Bank confirmation ref 12345' });
    expect(paid.status).toBe(200);
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/publish`)).status).toBe(200);
    expect((await detail(id)).run.status).toBe('published');
  });
  it('a published run cannot be reopened or cancelled', async () => {
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/reopen`, { reason: 'trying to change history' })).status).toBeGreaterThanOrEqual(400);
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/cancel`, { reason: 'trying to cancel history' })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('approval content binding and reopening', () => {
  it('reopening voids the approval path: the old results hash no longer works', async () => {
    const id = await runTo(b, w, { period: ['2025-05-01', '2025-05-31'] });
    const oldHash = (await detail(id)).run.result_set_hash as string;
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/reopen`, { reason: 'Correct an input before approval' })).status).toBe(200);
    expect((await detail(id)).run.status).toBe('inputs_locked');
    // add an adjustment, re-lock via unlock, recalculate, resubmit: the hash must change
    const adj = await w.preparer.client.post('/api/v1/pay/adjustments', { employeeId: w.employees[0]!.id, effectiveDate: '2025-05-15', code: 'BONUS', label: 'Spot bonus', kind: 'earning', amountMinor: 100000 });
    expect(adj.status).toBe(201);
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/unlock`)).status).toBe(200);
    for (const s of ['lock-inputs', 'calculate', 'submit']) expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/${s}`)).status).toBe(200);
    const newHash = (await detail(id)).run.result_set_hash as string;
    expect(newHash).not.toBe(oldHash);
    await stepUp(b, w.approver);
    const stale = await w.approver.client.post(`/api/v1/pay/runs/${id}/approve`, { resultSetHash: oldHash });
    expect(stale.status).toBe(409);
    const ok = await w.approver.client.post(`/api/v1/pay/runs/${id}/approve`, { resultSetHash: newHash });
    expect(ok.status).toBe(200);
  });
  it('rejecting sends the run back with a reason', async () => {
    const id = await runTo(b, w, { period: ['2025-04-01', '2025-04-30'] });
    await stepUp(b, w.approver);
    const r = await w.approver.client.post(`/api/v1/pay/runs/${id}/reject`, { reason: 'Overtime totals look wrong' });
    expect(r.status).toBe(200);
    expect((await detail(id)).run.status).not.toBe('in_review');
  });
});

describe('single-admin exception', () => {
  it('lets the preparer approve their own run, flags it, and delays release by 24 hours', async () => {
    await setAssurance('L2');
    await stepUp(b, w.owner);
    const pol = await w.owner.client.post('/api/v1/pay/policy/single-admin', { secondContactEmail: 'accountant@example.test', acknowledge: true });
    expect(pol.status).toBe(201);
    const r = await w.owner.client.post('/api/v1/pay/runs', { payGroupId: w.groupId, periodStart: '2025-03-01', periodEnd: '2025-03-31', mode: 'live' });
    const id = r.body.id as string;
    for (const s of ['lock-inputs', 'calculate', 'submit']) expect((await w.owner.client.post(`/api/v1/pay/runs/${id}/${s}`)).status).toBe(200);
    const hash = (await detail(id)).run.result_set_hash as string;
    await stepUp(b, w.owner);
    const a = await w.owner.client.post(`/api/v1/pay/runs/${id}/approve`, { resultSetHash: hash });
    expect(a.status).toBe(200);
    expect(a.body.flagged).toBe(true);
    expect(new Date(a.body.releaseNotBefore).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    await stepUp(b, w.owner);
    const f = await w.owner.client.post(`/api/v1/pay/runs/${id}/finalise`);
    expect(f.status).toBe(200);
    await stepUp(b, w.owner);
    const rel = await w.owner.client.post(`/api/v1/pay/runs/${id}/release`, { bankFileHash: f.body.bankFileHash });
    expect(rel.status).toBeGreaterThanOrEqual(400);
    expect((await detail(id)).run.status).toBe('finalised');
    await stepUp(b, w.owner);
    expect((await w.owner.client.del('/api/v1/pay/policy/single-admin')).status).toBe(200);
  });
});

describe('lock-phase exceptions', () => {
  it('a live run is blocked from calculating when someone has no bank details', async () => {
    const e = await w.hr.client.post('/api/v1/people/employees', { firstName: 'No', lastName: 'Bank', hireDate: '2025-01-01' });
    await stepUp(b, w.hr);
    await w.hr.client.post(`/api/v1/people/employees/${e.body.id}/compensation`, { effectiveFrom: '2025-01-01', basic: 500000, housing: 0, transport: 0, other: 0, reason: 'Initial' });
    const id = await runTo(b, w, { mode: 'live', until: 'locked', period: ['2025-02-01', '2025-02-28'] });
    const d = await detail(id);
    const codes = d.exceptions.map((x: { code: string }) => x.code);
    expect(codes).toContain('NO_BANK_DETAILS');
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/calculate`)).status).toBe(200);
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/submit`)).status).toBe(200);
    const hash = (await detail(id)).run.result_set_hash as string;
    await stepUp(b, w.approver);
    const blocked = await w.approver.client.post(`/api/v1/pay/runs/${id}/approve`, { resultSetHash: hash });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('blocking_exceptions');
    // the preparer may not accept exceptions on their own run; the approver may, with a reason
    const open = (await detail(id)).exceptions.filter((e: { severity: string; status: string }) => e.severity === 'blocking' && e.status === 'open');
    expect(open.map((e: { code: string }) => e.code)).toContain('NO_BANK_DETAILS');
    await stepUp(b, w.preparer);
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${id}/exceptions/${open[0].id}/waive`, { reason: 'I want to proceed' })).status).toBe(403);
    await stepUp(b, w.approver);
    for (const x of open) expect((await w.approver.client.post(`/api/v1/pay/runs/${id}/exceptions/${x.id}/waive`, { reason: 'Paid outside WPS this month, documented' })).status).toBe(200);
    await stepUp(b, w.approver);
    expect((await w.approver.client.post(`/api/v1/pay/runs/${id}/approve`, { resultSetHash: hash })).status).toBe(200);
  });
});
