import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, boot, freshTotp, loginForEmployee, PW, stepUp, type Booted } from './api-helpers.js';
import { payWorld, runTo, type PayWorld } from './pay-fixtures.js';
import { Client } from '../src/testing/client.js';
import pg from 'pg';
import { withTx } from '../src/db/tx.js';

let b: Booted; let w: PayWorld; let owner: pg.Pool;
beforeAll(async () => { b = await boot(); w = await payWorld(b, 'pay', 3); owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 2 }); });
afterAll(async () => { await owner.end(); await b.close(); });

const detail = async (id: string) => (await w.preparer.client.get(`/api/v1/pay/runs/${id}`)).body;

describe('payroll: sandbox run, end to end', () => {
  let runId = ''; let hash = '';
  it('locks, calculates, and reports totals with no blocking exceptions', async () => {
    runId = await runTo(b, w, { until: 'calculated', period: ['2025-10-01', '2025-10-31'] });
    const d = await detail(runId);
    expect(d.run.status).toBe('calculated');
    expect(d.totals.employees).toBe(3);
    expect(d.totals.gross_minor).toBeGreaterThan(0);
    expect(d.exceptions.filter((x: { severity: string; status: string }) => x.severity === 'blocking' && x.status === 'open')).toHaveLength(0);
    expect(d.run.pack_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(d.run.engine_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(d.packAssurance).toBe('L0');
  });
  it('UAE national gets pension contributions; an expatriate does not', async () => {
    const r = await w.preparer.client.get(`/api/v1/pay/runs/${runId}/results`);
    expect(r.status).toBe(200);
    const rows = r.body.results as Array<{ employee_id: string; result: { lines: Array<{ code: string }> } }>;
    const national = rows.find((x) => x.employee_id === w.employees[2]!.id)!;
    const expat = rows.find((x) => x.employee_id === w.employees[0]!.id)!;
    expect(national.result.lines.map((l) => l.code)).toContain('GPSSA_EE');
    expect(expat.result.lines.map((l) => l.code)).not.toContain('GPSSA_EE');
  });
  it('the preparer cannot approve (no permission) and the owner who prepared cannot approve own run', async () => {
    const id = await runTo(b, w, { period: ['2025-09-01', '2025-09-30'] });
    const hs = (await detail(id)).run.result_set_hash as string;
    const a = await w.preparer.client.post(`/api/v1/pay/runs/${id}/approve`, { resultSetHash: hs });
    expect(a.status).toBe(403);
    // a run the owner prepared cannot be approved by the owner (maker-checker, enforced in the database)
    const r = await w.owner.client.post('/api/v1/pay/runs', { payGroupId: w.groupId, periodStart: '2025-08-01', periodEnd: '2025-08-31' });
    const oid = r.body.id as string;
    for (const s of ['lock-inputs', 'calculate', 'submit']) expect((await w.owner.client.post(`/api/v1/pay/runs/${oid}/${s}`)).status).toBe(200);
    const oh = (await detail(oid)).run.result_set_hash as string;
    await stepUp(b, w.owner);
    const self = await w.owner.client.post(`/api/v1/pay/runs/${oid}/approve`, { resultSetHash: oh });
    expect(self.status).toBeGreaterThanOrEqual(400);
    expect((await detail(oid)).run.status).toBe('in_review');
  });
  it('approval is bound to the exact results hash and needs a fresh step-up', async () => {
    expect((await w.preparer.client.post(`/api/v1/pay/runs/${runId}/submit`)).status).toBe(200);
    hash = (await detail(runId)).run.result_set_hash;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    await b.pools.auth.query(`update kernel.session set step_up_at = now() - interval '20 minutes' where user_id = $1`, [w.approver.userId]);
    const stale = await w.approver.client.post(`/api/v1/pay/runs/${runId}/approve`, { resultSetHash: hash });
    expect(stale.status).toBe(401);
    await stepUp(b, w.approver);
    const wrong = await w.approver.client.post(`/api/v1/pay/runs/${runId}/approve`, { resultSetHash: 'a'.repeat(64) });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('content_changed');
    const ok = await w.approver.client.post(`/api/v1/pay/runs/${runId}/approve`, { resultSetHash: hash });
    expect(ok.status).toBe(200);
    expect(ok.body.flagged).toBe(false);
    expect((await detail(runId)).run.status).toBe('approved');
  });
  it('a second approval of the same run is refused', async () => {
    await stepUp(b, w.approver);
    const again = await w.approver.client.post(`/api/v1/pay/runs/${runId}/approve`, { resultSetHash: hash });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });
  it('finalise freezes payslips and builds the WPS file; the file is gated and audited', async () => {
    await stepUp(b, w.preparer);
    const f = await w.preparer.client.post(`/api/v1/pay/runs/${runId}/finalise`);
    expect(f.status).toBe(200);
    expect(f.body.payslips).toBe(3);
    expect(f.body.sifRows).toBe(3);
    expect(f.body.bankFileHash).toMatch(/^[a-f0-9]{64}$/);
    // download needs step-up
    await b.pools.auth.query(`update kernel.session set step_up_at = now() - interval '20 minutes' where user_id = $1`, [w.preparer.userId]);
    expect((await w.preparer.client.get(`/api/v1/pay/runs/${runId}/payment-file`)).status).toBe(401);
    await stepUp(b, w.preparer);
    const file = await w.preparer.client.get(`/api/v1/pay/runs/${runId}/payment-file`);
    expect(file.status).toBe(200);
    expect(String(file.headers['content-type'])).toMatch(/text\/csv/);
    const lines = String(file.body).trim().split(/\r?\n/);
    expect(lines[lines.length - 1]).toMatch(/^SCR,/);
    expect(lines.filter((l) => l.startsWith('EDR,'))).toHaveLength(3);
    const ev = await w.owner.client.get('/api/v1/audit/events?action=payment_file.downloaded');
    expect(JSON.stringify(ev.body)).toMatch(/payment_file/);
  });
  it('a sandbox run is published without payment; employees read only their own payslip', async () => {
    const pub = await w.preparer.client.post(`/api/v1/pay/runs/${runId}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.published).toBe(3);
    const e0 = await loginForEmployee(b, w.t, w.employees[0]!.id, 'Worker0');
    const e1 = await loginForEmployee(b, w.t, w.employees[1]!.id, 'Worker1');
    const mine = await e0.client.get('/api/v1/me/payslips');
    expect(mine.status).toBe(200);
    expect(mine.body.payslips).toHaveLength(1);
    const slipId = mine.body.payslips[0].id as string;
    expect((await e0.client.get(`/api/v1/me/payslips/${slipId}`)).status).toBe(200);
    expect((await e1.client.get(`/api/v1/me/payslips/${slipId}`)).status).toBe(404);
    expect((await e1.client.get(`/api/v1/pay/payslips/${slipId}`)).status).toBe(403);
    // employees cannot see runs, comp of others, or bank of others
    expect((await e0.client.get(`/api/v1/pay/runs/${runId}`)).status).toBe(403);
    const other = w.employees[1]!.id;
    // no data comes back at all (row level security filters the rows, so there is nothing to leak)
    expect((await e0.client.get(`/api/v1/people/employees/${other}/compensation`)).body.history).toEqual([]);
    expect((await e0.client.get(`/api/v1/people/employees/${other}/bank`)).body.bank).toBeNull();
  });
  it('payslips are immutable once finalised, even for the people who prepared them', async () => {
    const p = w.preparer;
    await expect(withTx(b.pools.app, { tenantId: w.t.tenantId, userId: p.userId, employeeId: p.employeeId }, async (db) => {
      const r = await db.query(`select id from pay.payslip where pay_run_id = $1 limit 1`, [runId]);
      expect(r.rows).toHaveLength(1);
      await db.query(`update pay.payslip set content = '{}'::jsonb where id = $1`, [r.rows[0].id]);
    }, ['payroll'])).rejects.toThrow();
  });
  it('the approver cannot read bank or national id data', async () => {
    const id = w.employees[0]!.id;
    expect((await w.approver.client.get(`/api/v1/people/employees/${id}/bank`)).body.bank).toBeNull();
    expect((await w.approver.client.get(`/api/v1/people/employees/${id}/private`)).body.private).toBeNull();
  });
});
