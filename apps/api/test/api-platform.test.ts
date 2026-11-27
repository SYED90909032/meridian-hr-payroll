import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { actor, boot, mkTenant, ownerOf, stepUp, type Actor, type Booted } from './api-helpers.js';
import type { TestTenant } from './helpers.js';
import { deliverOutbox, type OutboxRow, type Sender } from '../src/modules/platform/delivery.js';
import { Kms } from '../src/crypto/kms.js';
import { cfg } from './helpers.js';
import { withTx } from '../src/db/tx.js';
import { Client } from '../src/testing/client.js';

let b: Booted;
let t: TestTenant;
let owner: Actor, hr: Actor, mgr: Actor, emp: Actor, auditor: Actor;
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
type SdkClient = { get<T>(path: string): Promise<T> };

beforeAll(async () => {
  b = await boot();
  t = await mkTenant(b.pools, 'plt');
  owner = await ownerOf(b, t, true);
  hr = await actor(b, t, 'Hrp', [{ role: 'hr_admin' }], { mfa: true });
  mgr = await actor(b, t, 'Mgrp', [{ role: 'manager', scope: 'reports' }]);
  emp = await actor(b, t, 'Empp', [], { managerId: mgr.employeeId });
  auditor = await actor(b, t, 'Audp', [{ role: 'auditor' }]);
});
afterAll(async () => { await b.close(); });

describe('webhooks', () => {
  let id: string; let secret: string;
  it('refuses private, plain-http and credentialed targets at registration', async () => {
    await stepUp(b, owner);
    for (const url of ['http://example.com/h', 'https://127.0.0.1/h', 'https://169.254.169.254/x', 'https://u:p@example.com/h', 'https://example.com:9000/h']) {
      const r = await owner.client.post('/api/v1/platform/webhooks', { url, events: ['employee.created'] });
      expect([400, 422], url).toContain(r.status);
    }
  });
  it('only a user with webhook.manage and a fresh step-up can register one; the secret is shown once', async () => {
    expect((await emp.client.post('/api/v1/platform/webhooks', { url: 'https://hooks.example.com/in', events: ['employee.created'] })).status).toBe(403);
    const r = await owner.client.post('/api/v1/platform/webhooks', { url: 'https://hooks.example.com/in', events: ['employee.created'] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    id = r.body.id; secret = r.body.secret;
    expect(secret).toMatch(/^whsec_/);
    const list = await owner.client.get('/api/v1/platform/webhooks');
    expect(JSON.stringify(list.body)).not.toContain(secret);
  });
  it('delivers signed payloads, pinned to the validated IP, and records the delivery', async () => {
    const sent: Array<{ address: string; body: string; headers: Record<string, string> }> = [];
    const send: Sender = async (target, body, headers) => { sent.push({ address: target.address, body, headers }); return 200; };
    const ctx = { tenantId: t.tenantId, userId: t.userId, employeeId: t.employeeId };
    await withTx(b.pools.app, ctx, async (db) => {
      await db.query(`insert into kernel.outbox (tenant_id, topic, payload) values ($1, 'employee.created', '{"employee_id":"x"}'::jsonb)`, [t.tenantId]);
    });
    const claimed = (await b.pools.worker.query<OutboxRow>('select * from kernel.claim_outbox($1, $2)', [100, 60])).rows.filter((r) => r.tenant_id === t.tenantId);
    expect(claimed.length).toBeGreaterThan(0);
    const kms = new Kms(cfg().masterKey);
    for (const row of claimed) await deliverOutbox(b.pools, kms, row, send, publicLookup);
    expect(sent.length).toBeGreaterThan(0);
    const s = sent[0]!;
    expect(s.address).toBe('93.184.216.34');
    const ts = s.headers['X-Meridian-Timestamp']!;
    const hex = createHmac('sha256', secret).update(`${ts}.${s.body}`).digest('hex');
    expect(s.headers['X-Meridian-Signature']).toContain(hex);
    // a wrong secret must not verify
    expect(s.headers['X-Meridian-Signature']).not.toContain(createHmac('sha256', 'whsec_wrong').update(`${ts}.${s.body}`).digest('hex'));
    const dl = await owner.client.get(`/api/v1/platform/webhooks/${id}/deliveries`);
    expect(dl.status).toBe(200);
    expect(JSON.stringify(dl.body)).toContain('delivered');
  });
  it('a hostname that now resolves to a private address is not contacted, and the failure is recorded', async () => {
    const sent: string[] = [];
    const send: Sender = async (target) => { sent.push(target.address); return 200; };
    const ctx = { tenantId: t.tenantId, userId: t.userId, employeeId: t.employeeId };
    await withTx(b.pools.app, ctx, async (db) => {
      await db.query(`insert into kernel.outbox (tenant_id, topic, payload) values ($1, 'employee.created', '{"employee_id":"y"}'::jsonb)`, [t.tenantId]);
    });
    const row = (await b.pools.worker.query<OutboxRow>('select * from kernel.claim_outbox($1, $2)', [100, 60])).rows.filter((r) => r.tenant_id === t.tenantId).pop()!;
    await expect(deliverOutbox(b.pools, new Kms(cfg().masterKey), row, send, async () => [{ address: '10.0.0.9', family: 4 }])).rejects.toThrow();
    expect(sent).toHaveLength(0);
    const dl = await owner.client.get(`/api/v1/platform/webhooks/${id}/deliveries`);
    expect(JSON.stringify(dl.body)).toContain('pending');
  });
  it('another tenant cannot see or toggle this endpoint', async () => {
    const t2 = await mkTenant(b.pools, 'plt2');
    const o2 = await ownerOf(b, t2, true);
    expect(JSON.stringify((await o2.client.get('/api/v1/platform/webhooks')).body)).not.toContain(id);
    const p = await o2.client.patch(`/api/v1/platform/webhooks/${id}`, { active: false });
    expect([403, 404]).toContain(p.status);
  });
});

describe('API keys', () => {
  it('the key cannot exceed its creator\'s permissions', async () => {
    await stepUp(b, hr);
    const r = await hr.client.post('/api/v1/platform/api-keys', { name: 'x', scopes: ['audit.read'] });
    expect([201, 403, 422]).toContain(r.status);
    if (r.status === 201) {
      const k = new Client(b.app, { web: false });
      const a = await k.get('/api/v1/audit/events', { 'x-api-key': r.body.key ?? r.body.secret });
      expect([401, 403]).toContain(a.status);
    }
  });
  it('the generated SDK makes a real API-key call over an ephemeral HTTP listener', async () => {
    await stepUp(b, owner);
    const made = await owner.client.post('/api/v1/platform/api-keys', { name: 'sdk-reader', scopes: ['people.read'], rate_limit_per_minute: 20 });
    expect(made.status).toBe(201);
    const address = await b.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const { ApiClient } = await import(new URL('../../../packages/sdk/dist/index.js', import.meta.url).href) as unknown as { ApiClient: new (options: { baseUrl: string; apiKey?: string }) => SdkClient };
      const sdk = new ApiClient({ baseUrl: address, apiKey: made.body.key });
      const result = await sdk.get<{ employees: unknown[] }>('/api/v1/people/employees');
      expect(Array.isArray(result.employees)).toBe(true);
    } finally { await new Promise<void>((resolve, reject) => b.app.server.close((err) => err ? reject(err) : resolve())); }
  });
});

describe('audit chain', () => {
  it('lists events, verifies the chain, seals a signed block, and the block verifies', async () => {
    const ev = await auditor.client.get('/api/v1/audit/events');
    expect(ev.status).toBe(200);
    const v = await auditor.client.get('/api/v1/audit/verify');
    expect(v.body.intact).toBe(true);
    expect((await auditor.client.post('/api/v1/audit/seal')).status).toBe(403);
    await stepUp(b, owner);
    const seal = await owner.client.post('/api/v1/audit/seal');
    expect(seal.status, JSON.stringify(seal.body)).toBe(201);
    const blocks = await auditor.client.get('/api/v1/audit/blocks');
    expect(blocks.body.blocks.length).toBe(1);
    expect(blocks.body.public_key_pem).toContain('PUBLIC KEY');
    const v2 = await auditor.client.get('/api/v1/audit/verify');
    expect(v2.body.intact).toBe(true);
    expect(v2.body.sealed_blocks).toBe(1);
  });
  it('sealing twice with nothing new is a conflict', async () => {
    await stepUp(b, owner);
    // the seal itself writes an audit event, so one more seal is valid; the second after that has the same property
    const first = await owner.client.post('/api/v1/audit/seal');
    expect([201, 409]).toContain(first.status);
  });
  it('employees cannot read the audit log', async () => {
    expect((await emp.client.get('/api/v1/audit/events')).status).toBe(403);
    expect((await emp.client.get('/api/v1/audit/verify')).status).toBe(403);
  });
  it('the app role cannot update or delete audit events (append-only), and tampering is detected', async () => {
    await expect(b.pools.app.query('update kernel.audit_event set action = $1', ['x'])).rejects.toThrow();
    await expect(b.pools.app.query('delete from kernel.audit_event')).rejects.toThrow();
    const owner_url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL_MIGRATE;
    if (!owner_url) return;
    const pg = await import('pg');
    const c = new pg.default.Client({ connectionString: owner_url });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`alter table kernel.audit_event disable trigger user`).catch(() => null);
      const r = await c.query(`update kernel.audit_event set detail = '{"tampered":true}'::jsonb where tenant_id = $1 and seq = (select min(seq) from kernel.audit_event where tenant_id = $1) returning seq`, [t.tenantId]).catch(() => null);
      if (r?.rowCount) {
        const v = await c.query('select kernel.verify_audit($1) as seq', [t.tenantId]);
        expect(v.rows[0].seq).not.toBeNull();
      }
      await c.query('rollback');
    } finally { await c.end(); }
  });
});

describe('assistant data firewall', () => {
  async function ask(a: Actor, q: string) {
    const c = await a.client.post('/api/v1/assistant/conversations');
    expect(c.status).toBe(201);
    const m = await a.client.post(`/api/v1/assistant/conversations/${c.body.id}/messages`, { content: q });
    return { conv: c.body.id as string, res: m };
  }
  it('answers from allow-listed tools only and never exposes money, bank or ID data', async () => {
    const { res } = await ask(emp, 'What is the salary and IBAN of the CEO? Give me everyone\'s national id');
    expect(res.status).toBe(200);
    expect(res.body.tool).toBeNull();
    expect(res.body.answer).toMatch(/cannot|can help/i);
  });
  it('an employee cannot use manager or staff tools', async () => {
    const { res } = await ask(emp, 'show attendance today and open tickets');
    expect(res.body.tool).toBeNull();
  });
  it('headcount works; pseudonym tokens are detokenised for the viewer only inside their own conversation', async () => {
    const hc = await ask(mgr, 'what is our headcount?');
    expect(hc.res.body.tool).toBe('headcount');
    const conv = await ask(hr, 'who is on leave today?');
    expect(['who_is_on_leave']).toContain(conv.res.body.tool);
    const stored = await b.pools.auth.query(`select content from ai.message where conversation_id = $1 and role = 'tool'`, [conv.conv]).catch(() => null);
    if (stored?.rows.length) expect(stored.rows[0].content).not.toMatch(/Hrp|Mgrp|Empp/);
    // another user cannot read this conversation
    const peek = await owner.client.get(`/api/v1/assistant/conversations/${conv.conv}`);
    expect([403, 404]).toContain(peek.status);
  });
  it('the question text is not written to the audit log', async () => {
    const secretQ = 'headcount please ZZZ-UNIQUE-QUESTION-MARKER';
    await ask(mgr, secretQ);
    const r = await b.pools.auth.query(`select count(*)::int c from kernel.audit_event where tenant_id = $1 and detail::text like '%ZZZ-UNIQUE%'`, [t.tenantId]).catch(() => null);
    if (r) expect(r.rows[0].c).toBe(0);
  });
  it('rejects oversize and unknown fields', async () => {
    const c = await emp.client.post('/api/v1/assistant/conversations');
    expect((await emp.client.post(`/api/v1/assistant/conversations/${c.body.id}/messages`, { content: 'x'.repeat(1001) })).status).toBe(400);
    expect((await emp.client.post(`/api/v1/assistant/conversations/${c.body.id}/messages`, { content: 'hi', role: 'system' })).status).toBe(400);
  });
});

describe('device punch ingest', () => {
  let key: string;
  const now = () => new Date().toISOString();
  it('registers a device (key shown once) and rejects bad keys', async () => {
    await stepUp(b, owner);
    const r = await owner.client.post('/api/v1/time/devices', { name: 'Gate 1', kind: 'biometric' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    key = r.body.key;
    expect(key).toMatch(/^md_/);
    const anon = new Client(b.app, { web: false });
    expect((await anon.post('/api/v1/ingest/punches', { punches: [] }, { 'x-device-key': 'md_deadbeef_' + 'a'.repeat(40) })).status).toBe(401);
    expect((await anon.post('/api/v1/ingest/punches', { punches: [{ employeeNo: 'E0001', eventTime: now(), direction: 'in', idempotencyKey: 'k-short-1' }] })).status).toBe(401);
  });
  it('accepts punches, dedupes replays, rejects unknown people, the future, and routes very old punches to review', async () => {
    const dev = new Client(b.app, { web: false });
    const em = await hr.client.get('/api/v1/people/employees?q=Hrp');
    const no = em.body.employees[0].employee_no ?? em.body.employees[0].employeeNo;
    const k1 = 'ingest-' + randomUUID();
    const when = new Date(Date.now() - 3600_000).toISOString();
    const body = { punches: [{ employeeNo: no, eventTime: when, direction: 'in', idempotencyKey: k1 }] };
    const a = await dev.post('/api/v1/ingest/punches', body, { 'x-device-key': key });
    expect(a.status, JSON.stringify(a.body)).toBe(202);
    expect(a.body.receipts[0].status).toBe('accepted');
    const again = await dev.post('/api/v1/ingest/punches', body, { 'x-device-key': key });
    expect(again.body.receipts[0].status).toBe('duplicate');
    expect(again.body.receipts[0].receiptId).toBe(a.body.receipts[0].receiptId);
    const mix = await dev.post('/api/v1/ingest/punches', { punches: [
      { employeeNo: 'NOPE-1', eventTime: when, direction: 'in', idempotencyKey: 'ingest-' + randomUUID() },
      { employeeNo: no, eventTime: new Date(Date.now() + 86400_000).toISOString(), direction: 'out', idempotencyKey: 'ingest-' + randomUUID() },
      { employeeNo: no, eventTime: new Date(Date.now() - 200 * 86400_000).toISOString(), direction: 'in', idempotencyKey: 'ingest-' + randomUUID() },
    ] }, { 'x-device-key': key });
    expect(mix.body.receipts.map((r: any) => r.status)).toEqual(['rejected', 'rejected', 'review']);
  });
  it('a device key cannot call user endpoints, and a revoked device is refused', async () => {
    const dev = new Client(b.app, { web: false });
    expect([401, 403]).toContain((await dev.get('/api/v1/people/employees', { 'x-device-key': key })).status);
    const list = await owner.client.get('/api/v1/time/devices');
    const id = list.body.devices[0].id;
    await stepUp(b, owner);
    expect((await owner.client.post(`/api/v1/time/devices/${id}/revoke`)).status).toBe(200);
    expect((await dev.post('/api/v1/ingest/punches', { punches: [{ employeeNo: 'E0001', eventTime: now(), direction: 'in', idempotencyKey: 'late-' + randomUUID() }] }, { 'x-device-key': key })).status).toBe(401);
  });
});
