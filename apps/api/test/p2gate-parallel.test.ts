import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ownerOf, stepUp, type Booted } from './api-helpers.js';
import { mkTenant } from './helpers.js';
import { payWorld, runTo, type PayWorld } from './pay-fixtures.js';

let b: Booted; let w: PayWorld; let otherOwner: Awaited<ReturnType<typeof ownerOf>>;
let runId = '';

beforeAll(async () => {
  b = await boot();
  w = await payWorld(b, 'parallel', 2);
  const other = await mkTenant(b.pools, 'parallel-other');
  otherOwner = await ownerOf(b, other, true);
  runId = await runTo(b, w, { mode: 'parallel', until: 'calculated', period: ['2028-01-01', '2028-01-31'] });
});
afterAll(async () => { await b.close(); });

async function matchingCsv(run: string): Promise<string> {
  const result = await w.preparer.client.get(`/api/v1/pay/runs/${run}/results`);
  return ['employee_no,gross_minor,deductions_minor,net_minor,lines', ...result.body.results.map((r: { employee_no: string; gross_minor: number; net_minor: number; result: { lines: Array<{ code: string; amount_minor: number }> } }) => {
    const lines = r.result.lines.map((l) => `${l.code}:${l.amount_minor}`).join('|');
    return `${r.employee_no},${r.gross_minor},${r.gross_minor - r.net_minor},${r.net_minor},${lines}`;
  })].join('\n');
}

describe('parallel-run variance harness', () => {
  it('accepts an exact integer CSV and records zero unexplained variance', async () => {
    const r = await w.preparer.client.post('/api/v1/pay/parallel-runs', { payRunId: runId, csv: await matchingCsv(runId) });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('zero_variance');
    const report = await w.preparer.client.get(`/api/v1/pay/parallel-runs/${r.body.id}`);
    expect(report.status).toBe(200);
    expect(report.body.employees.every((e: { status: string }) => e.status === 'matched')).toBe(true);
  });

  it('requires an explanation for a variance and then marks the pair zero unexplained', async () => {
    const csv = await matchingCsv(runId);
    const rows = csv.split('\n');
    const cells = rows[1]!.split(',');
    cells[1] = String(Number(cells[1]) + 1); cells[3] = String(Number(cells[3]) + 1); rows[1] = cells.join(',');
    const created = await w.preparer.client.post('/api/v1/pay/parallel-runs', { payRunId: runId, csv: rows.join('\n') });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('needs_review');
    expect(created.body.unexplained).toBe(1);
    await stepUp(b, w.preparer);
    const employeeId = w.employees[0]!.id;
    const explained = await w.preparer.client.post(`/api/v1/pay/parallel-runs/${created.body.id}/employees/${employeeId}/explain`, { reason: 'Employer payroll included a documented rounding adjustment.' });
    expect(explained.status).toBe(200);
    const report = await w.preparer.client.get(`/api/v1/pay/parallel-runs/${created.body.id}`);
    expect(report.body.run.status).toBe('zero_variance');
  });

  it('denies an approver without parallel permission and a different tenant', async () => {
    const exact = await w.preparer.client.post('/api/v1/pay/parallel-runs', { payRunId: runId, csv: await matchingCsv(runId) });
    expect((await w.approver.client.post('/api/v1/pay/parallel-runs', { payRunId: runId, csv: await matchingCsv(runId) })).status).toBe(403);
    expect((await otherOwner.client.get(`/api/v1/pay/parallel-runs/${exact.body.id}`)).status).toBeGreaterThanOrEqual(400);
  });
});
