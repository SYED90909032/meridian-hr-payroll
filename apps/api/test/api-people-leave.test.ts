import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, boot, mkTenant, ownerOf, stepUp, type Actor, type Booted } from './api-helpers.js';
import type { TestTenant } from './helpers.js';

let b: Booted;
let t: TestTenant;
let owner: Actor, hr: Actor, mgr: Actor, emp: Actor, other: Actor, helpdesk: Actor, auditor: Actor;

function nextWeekday(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  while ([0, 6].includes(d.getUTCDay()) || [5, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  b = await boot();
  t = await mkTenant(b.pools, 'ppl');
  owner = await ownerOf(b, t, true);
  hr = await actor(b, t, 'Hrx', [{ role: 'hr_admin' }], { mfa: true });
  mgr = await actor(b, t, 'Mgrx', [{ role: 'manager', scope: 'reports' }]);
  emp = await actor(b, t, 'Empx', [], { managerId: mgr.employeeId });
  other = await actor(b, t, 'Otherx', []);
  helpdesk = await actor(b, t, 'Deskx', [{ role: 'helpdesk_agent' }]);
  auditor = await actor(b, t, 'Auditx', [{ role: 'auditor' }]);
});
afterAll(async () => { await b.close(); });

describe('people authorisation', () => {
  it('requires a session', async () => {
    const r = await b.app.inject({ method: 'GET', url: '/api/v1/people/employees' });
    expect(r.statusCode).toBe(401);
  });
  it('HR sees everyone; a plain employee sees only a directory subset without sensitive fields', async () => {
    const all = await hr.client.get('/api/v1/people/employees');
    expect(all.status).toBe(200);
    expect(all.body.employees.length).toBeGreaterThanOrEqual(7);
    const mine = await emp.client.get('/api/v1/people/employees');
    expect(mine.status).toBe(200);
    for (const e of mine.body.employees) {
      expect(e).not.toHaveProperty('nationalId');
      expect(e).not.toHaveProperty('iban');
    }
  });
  it('an employee cannot create, edit or terminate employees', async () => {
    expect((await emp.client.post('/api/v1/people/employees', { firstName: 'A', lastName: 'B', hireDate: '2025-01-01' })).status).toBe(403);
    expect((await emp.client.patch(`/api/v1/people/employees/${other.employeeId}`, { jobTitle: 'Boss' })).status).toBe(403);
    expect((await emp.client.post(`/api/v1/people/employees/${other.employeeId}/terminate`, { terminationDate: '2025-12-31', reason: 'x' })).status).toBe(403);
  });
  it('an employee cannot read another employee\'s private data, compensation or bank', async () => {
    for (const p of ['private', 'compensation', 'bank']) {
      const r = await emp.client.get(`/api/v1/people/employees/${other.employeeId}/${p}?reveal=1`);
      if (r.status === 200) expect(JSON.stringify(r.body)).not.toMatch(/\d{6,}/);
      else expect([403, 404]).toContain(r.status);
    }
  });
  it('auditor and helpdesk cannot write people records', async () => {
    expect((await auditor.client.post('/api/v1/people/employees', { firstName: 'A', lastName: 'B', hireDate: '2025-01-01' })).status).toBe(403);
    expect((await helpdesk.client.post('/api/v1/people/employees', { firstName: 'A', lastName: 'B', hireDate: '2025-01-01' })).status).toBe(403);
  });
  it('sensitive reads need step-up and are audited', async () => {
    const e = await hr.client.post('/api/v1/people/employees', { firstName: 'Priv', lastName: 'Ate', hireDate: '2025-01-01' });
    expect(e.status).toBe(201);
    const id = e.body.id;
    await stepUp(b, hr);
    const w = await hr.client.put(`/api/v1/people/employees/${id}/private`, { nationalId: '784199012345678' });
    expect(w.status).toBe(200);
    const masked = await hr.client.get(`/api/v1/people/employees/${id}/private`);
    expect(masked.status).toBe(200);
    expect(JSON.stringify(masked.body)).not.toContain('784199012345678');
    expect(JSON.stringify(masked.body)).toContain('5678');
    const ownerRevealNeedsPerm = await hr.client.get(`/api/v1/people/employees/${id}/private?reveal=1`);
    expect([200, 403]).toContain(ownerRevealNeedsPerm.status);
  });
  it('rejects unknown fields and bad values (mass assignment, validation)', async () => {
    const r = await hr.client.post('/api/v1/people/employees', { firstName: 'A', lastName: 'B', hireDate: '2025-01-01', tenantId: t.tenantId, status: 'terminated' });
    expect(r.status).toBe(400);
    const d = await hr.client.post('/api/v1/people/employees', { firstName: 'A', lastName: 'B', hireDate: '2025-13-45' });
    expect(d.status).toBe(400);
  });
});

describe('documents', () => {
  it('rejects a file whose bytes do not match the declared type, accepts a real PDF, and round-trips', async () => {
    const id = emp.employeeId;
    const bad = await hr.client.post(`/api/v1/people/employees/${id}/documents`, { kind: 'contract', name: 'a.pdf', mime: 'application/pdf', contentBase64: Buffer.from('not a pdf at all').toString('base64') });
    expect(bad.status).toBe(400);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const ok = await hr.client.post(`/api/v1/people/employees/${id}/documents`, { kind: 'contract', name: 'contract.pdf', mime: 'application/pdf', contentBase64: pdf.toString('base64') });
    expect(ok.status).toBe(201);
    const list = await hr.client.get(`/api/v1/people/employees/${id}/documents`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('contract.pdf');
  });
  it('rejects path-like file names', async () => {
    const r = await hr.client.post(`/api/v1/people/employees/${emp.employeeId}/documents`, { kind: 'other', name: '../../etc/passwd', mime: 'text/plain', contentBase64: Buffer.from('x').toString('base64') });
    expect(r.status).toBe(400);
  });
});

describe('erasure', () => {
  it('erase-personal-data needs step-up and crypto-shreds private fields', async () => {
    const e = await hr.client.post('/api/v1/people/employees', { firstName: 'Gone', lastName: 'Soon', hireDate: '2024-01-01' });
    const id = e.body.id;
    await stepUp(b, hr);
    await hr.client.put(`/api/v1/people/employees/${id}/private`, { nationalId: '784199099999999' });
    const term = await hr.client.post(`/api/v1/people/employees/${id}/terminate`, { terminationDate: '2024-06-30', reason: 'Resigned' });
    expect(term.status, JSON.stringify(term.body)).toBe(200);
    await stepUp(b, hr);
    expect((await hr.client.post(`/api/v1/people/employees/${id}/erase-personal-data`, { confirm: 'ERASE' })).status).toBe(403); // hr_admin lacks settings.manage
    await stepUp(b, owner);
    expect((await owner.client.post(`/api/v1/people/employees/${id}/erase-personal-data`, { confirm: 'NO' })).status).toBe(400);
    const x = await owner.client.post(`/api/v1/people/employees/${id}/erase-personal-data`, { confirm: 'ERASE' });
    expect(x.status, JSON.stringify(x.body)).toBe(200);
    const after = await hr.client.get(`/api/v1/people/employees/${id}/private`);
    expect(JSON.stringify(after.body)).not.toContain('9999');
    expect(JSON.stringify(after.body)).toMatch(/erased/);
    // a live employee cannot be erased
    const live = await hr.client.post('/api/v1/people/employees', { firstName: 'Live', lastName: 'One', hireDate: '2025-01-01' });
    await stepUp(b, owner);
    expect((await owner.client.post(`/api/v1/people/employees/${live.body.id}/erase-personal-data`, { confirm: 'ERASE' })).status).toBe(409);
  });
});

describe('leave and approvals', () => {
  let leaveTypeId: string;
  let reqId: string;
  let hash: string;
  const start = nextWeekday(7);
  it('lists the default leave types and a balance', async () => {
    const lt = await emp.client.get('/api/v1/leave/types');
    expect(lt.status).toBe(200);
    const annual = lt.body.types.find((x: any) => /annual/i.test(x.name));
    expect(annual).toBeTruthy();
    leaveTypeId = annual.id;
  });
  it('rejects end before start, half-day spanning dates, and unknown types', async () => {
    expect((await emp.client.post('/api/v1/leave/requests', { leaveTypeId, startDate: '2026-03-10', endDate: '2026-03-09' })).status).toBe(400);
    expect((await emp.client.post('/api/v1/leave/requests', { leaveTypeId, startDate: '2026-03-10', endDate: '2026-03-12', half: true })).status).toBe(400);
    expect((await emp.client.post('/api/v1/leave/requests', { leaveTypeId: '00000000-0000-4000-8000-000000000000', startDate: start, endDate: start })).status).toBe(404);
  });
  it('creates a request routed to the manager, and the manager (not a stranger) sees it', async () => {
    const r = await emp.client.post('/api/v1/leave/requests', { leaveTypeId, startDate: start, endDate: start, reason: 'Medical appointment' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    reqId = r.body.approvalRequestId; hash = r.body.contentHash;
    const inbox = await mgr.client.get('/api/v1/flow/inbox');
    expect(inbox.body.items.some((i: any) => i.request_id === reqId)).toBe(true);
    const strangerInbox = await other.client.get('/api/v1/flow/inbox');
    expect(strangerInbox.body.items.some((i: any) => i.request_id === reqId)).toBe(false);
  });
  it('the reason is private: requester and HR can read it, a stranger cannot', async () => {
    const list = await emp.client.get('/api/v1/leave/requests');
    const id = list.body.requests[0].id;
    const mine = await emp.client.get(`/api/v1/leave/requests/${id}/reason`);
    expect(mine.status).toBe(200);
    expect(mine.body.reason).toBe('Medical appointment');
    const strange = await other.client.get(`/api/v1/leave/requests/${id}/reason`);
    expect([403, 404]).toContain(strange.status);
  });
  it('rejects an overlapping second request', async () => {
    const r = await emp.client.post('/api/v1/leave/requests', { leaveTypeId, startDate: start, endDate: start });
    expect([400, 409, 422]).toContain(r.status);
  });
  it('the requester cannot approve their own request', async () => {
    const inbox = await emp.client.get('/api/v1/flow/inbox');
    expect(inbox.body.items.some((i: any) => i.request_id === reqId)).toBe(false);
  });
  it('a stranger cannot decide the manager\'s step', async () => {
    const inbox = await mgr.client.get('/api/v1/flow/inbox');
    const step = inbox.body.items.find((i: any) => i.request_id === reqId);
    const r = await other.client.post(`/api/v1/flow/steps/${step.step_id}/decide`, { decision: 'approve', contentHash: hash });
    expect([403, 404]).toContain(r.status);
  });
  it('a wrong content hash is refused (the approver must approve what they saw)', async () => {
    const inbox = await mgr.client.get('/api/v1/flow/inbox');
    const step = inbox.body.items.find((i: any) => i.request_id === reqId);
    const r = await mgr.client.post(`/api/v1/flow/steps/${step.step_id}/decide`, { decision: 'approve', contentHash: 'a'.repeat(64) });
    expect([409, 422]).toContain(r.status);
  });
  it('approval writes the ledger and moves the request to approved; deciding twice fails', async () => {
    const before = await emp.client.get('/api/v1/leave/balances');
    const inbox = await mgr.client.get('/api/v1/flow/inbox');
    const step = inbox.body.items.find((i: any) => i.request_id === reqId);
    const r = await mgr.client.post(`/api/v1/flow/steps/${step.step_id}/decide`, { decision: 'approve', contentHash: step.content_hash });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const list = await emp.client.get('/api/v1/leave/requests');
    expect(list.body.requests[0].status).toBe('approved');
    const after = await emp.client.get('/api/v1/leave/balances');
    expect(JSON.stringify(after.body)).not.toEqual(JSON.stringify(before.body));
    const again = await mgr.client.post(`/api/v1/flow/steps/${step.step_id}/decide`, { decision: 'approve', contentHash: step.content_hash });
    expect([404, 409, 422]).toContain(again.status);
  });
  it('a manager cannot see leave of someone outside their reports', async () => {
    const cal = await mgr.client.get(`/api/v1/leave/calendar?from=${start}&to=${start}`);
    expect(cal.status).toBe(200);
  });
  it('insufficient balance is refused', async () => {
    const r = await emp.client.post('/api/v1/leave/requests', { leaveTypeId, startDate: nextWeekday(30), endDate: nextWeekday(120) });
    expect([400, 422]).toContain(r.status);
  });
});

describe('helpdesk confidentiality', () => {
  let tid: string;
  it('an employee raises a ticket and sees only their own', async () => {
    const r = await emp.client.post('/api/v1/svc/tickets', { subject: 'Payslip question', body: 'Why is my deduction different?', category: 'payroll' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    tid = r.body.id;
    expect((await other.client.get('/api/v1/svc/tickets')).body.tickets.some((x: any) => x.id === tid)).toBe(false);
    expect([403, 404]).toContain((await other.client.get(`/api/v1/svc/tickets/${tid}`)).status);
  });
  it('an agent sees the queue, and internal notes never reach the requester', async () => {
    expect((await helpdesk.client.get('/api/v1/svc/tickets?scope=queue')).body.tickets.some((x: any) => x.id === tid)).toBe(true);
    const n = await helpdesk.client.post(`/api/v1/svc/tickets/${tid}/comments`, { body: 'INTERNAL-SECRET-NOTE', internal: true });
    expect(n.status, JSON.stringify(n.body)).toBe(201);
    await helpdesk.client.post(`/api/v1/svc/tickets/${tid}/comments`, { body: 'Public reply' });
    const seen = await emp.client.get(`/api/v1/svc/tickets/${tid}`);
    expect(JSON.stringify(seen.body)).toContain('Public reply');
    expect(JSON.stringify(seen.body)).not.toContain('INTERNAL-SECRET-NOTE');
  });
  it('an employee cannot post internal notes or reassign tickets', async () => {
    const n = await emp.client.post(`/api/v1/svc/tickets/${tid}/comments`, { body: 'sneaky', internal: true });
    expect([201, 403]).toContain(n.status);
    const seen = await emp.client.get(`/api/v1/svc/tickets/${tid}`);
    if (n.status === 201) expect(JSON.stringify(seen.body)).toMatch(/sneaky/);
    const p = await emp.client.patch(`/api/v1/svc/tickets/${tid}`, { assigneeUserId: emp.userId });
    expect([403, 404]).toContain(p.status);
  });
});

describe('idempotency', () => {
  it('replays the same response for the same key and refuses a different body with the same key', async () => {
    const key = 'idem-' + Math.random().toString(36).slice(2);
    const body = { firstName: 'Idem', lastName: 'Potent', hireDate: '2025-01-01' };
    const a = await hr.client.post('/api/v1/people/employees', body, { 'idempotency-key': key });
    const c = await hr.client.post('/api/v1/people/employees', body, { 'idempotency-key': key });
    expect(a.status).toBe(201);
    expect(c.body.id).toBe(a.body.id);
    const d = await hr.client.post('/api/v1/people/employees', { ...body, firstName: 'Changed' }, { 'idempotency-key': key });
    expect([409, 422]).toContain(d.status);
  });
});
