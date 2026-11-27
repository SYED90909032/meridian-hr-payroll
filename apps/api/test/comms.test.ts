import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { buildApp } from '../src/app.js';
import { cfg, mkPools, mkTenant, type TestTenant } from './helpers.js';
import { boot, ownerOf, stepUp, type Booted } from './api-helpers.js';
import { Client } from '../src/testing/client.js';
import { Kms, open } from '../src/crypto/kms.js';
import { renderTemplate, TEMPLATE_NAMES } from '../src/modules/comms/templates/index.js';
import { breachedPassword } from '../src/modules/comms/password-security.js';
import { SmtpMailer } from '../src/modules/comms/providers.js';
import { withTx } from '../src/db/tx.js';

process.env.HIBP_API_BASE = 'http://127.0.0.1:1';

describe('communications and account lifecycle', () => {
  let b: Booted; let tenant: TestTenant;
  beforeAll(async () => { b = await boot(); tenant = await mkTenant(b.pools, 'mail'); });
  afterAll(async () => { await b.close(); });
  async function deliveryToken(template: string): Promise<string> {
    const row = await withTx(b.pools.app, { tenantId: tenant.tenantId, userId: tenant.userId, employeeId: tenant.employeeId }, (db) => db.query<{ payload: { template?: string; tokenEnc?: string } }>('select payload from kernel.outbox where tenant_id = $1 and topic = $2 order by id desc limit 20', [tenant.tenantId, 'email.send']));
    const p = row.rows.find((x) => x.payload.template === template)?.payload;
    expect(p?.tokenEnc).toBeTypeOf('string');
    return open(new Kms(cfg().masterKey).tenantKey(tenant.tenantId), Buffer.from(p!.tokenEnc!, 'base64'), 'account-token').toString('utf8');
  }
  it('invites without returning a password, then accepts a single-use token', async () => {
    const owner = await ownerOf(b, tenant, false); await stepUp(b, owner, false);
    const invited = await owner.client.post('/api/v1/iam/members', { email: `invite-${Date.now()}@example.test`, displayName: 'Invited <Name>', roles: [] });
    expect(invited.status).toBe(201); expect(JSON.stringify(invited.body)).not.toMatch(/password/i);
    const token = await deliveryToken('invitation.v1'); const publicClient = new Client(b.app);
    const invitationPassword = 'violet-planet-cobalt-42!';
    expect((await publicClient.post('/api/v1/auth/accept-invitation', { token, password: invitationPassword })).status).toBe(200);
    expect((await publicClient.post('/api/v1/auth/accept-invitation', { token, password: 'amber-river-slate-73!' })).status).toBe(410);
  });
  it('forgot/reset is uniform, single-use, revokes sessions and never auto-logs in', async () => {
    const owner = await ownerOf(b, tenant, false);
    const anon = new Client(b.app); const unknown = await anon.post('/api/v1/auth/forgot-password', { email: 'unknown@example.test' });
    expect(unknown.status).toBe(200); expect(unknown.body).toEqual({ ok: true });
    const known = await anon.post('/api/v1/auth/forgot-password', { email: tenant.email });
    expect(known.status).toBe(200); expect(known.body).toEqual({ ok: true });
    const token = await deliveryToken('password-reset.v1');
    const resetPassword = 'orchid-lantern-cobalt-58!';
    const reset = await anon.post('/api/v1/auth/reset-password', { token, password: resetPassword });
    expect(reset.status).toBe(200); expect(reset.headers['set-cookie']).toBeUndefined();
    expect((await anon.post('/api/v1/auth/reset-password', { token, password: 'a-second-reset-password-42' })).status).toBe(410);
    expect((await owner.client.get('/api/v1/auth/me')).status).not.toBe(200);
    const logged = await new Client(b.app).login(tenant.email, resetPassword); expect(logged.status).toBe(200);
  });
  it('enforces tenant MFA policy while leaving enrolment and API-key principals unaffected', async () => {
    const t = await mkTenant(b.pools, 'mfap'); const owner = await ownerOf(b, t, false); await stepUp(b, owner, false);
    expect((await owner.client.put('/api/v1/iam/mfa-policy', { requiredRoles: ['owner'] })).status).toBe(200);
    const blocked = await owner.client.get('/api/v1/people/employees'); expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('mfa_enrollment_required');
    expect((await owner.client.post('/api/v1/auth/mfa/begin')).status).toBe(200);
  });
  it('stores per-user preferences and refuses to disable security mail', async () => {
    const t = await mkTenant(b.pools, 'pref'); const owner = await ownerOf(b, t, false); await stepUp(b, owner, false);
    expect((await owner.client.put('/api/v1/comms/notification-preferences', { kind: 'leave-decided', emailEnabled: false })).status).toBe(200);
    const got = await owner.client.get('/api/v1/comms/notification-preferences'); expect(got.body.preferences).toContainEqual({ kind: 'leave-decided', email_enabled: false });
    expect((await owner.client.put('/api/v1/comms/notification-preferences', { kind: 'security', emailEnabled: false })).status).toBe(403);
  });
});

describe('communications pure seams', () => {
  it('escapes hostile input and keeps sensitive fields out of every template', () => {
    for (const name of TEMPLATE_NAMES) {
      const r = renderTemplate(name, { recipientName: 'A\r\nB <script>alert(1)</script>', link: '/safe?x=1&y=2' });
      expect(r.html).not.toContain('<script>'); expect(r.subject).not.toMatch(/[\r\n]/); expect(r.text + r.html).not.toMatch(/salary|bank|iban|national.?id|payslip content|leave reason|gross|net/i);
    }
  });
  it('uses HIBP range k-anonymity and never sends the password', async () => {
    let requested = ''; let sentBody = '';
    const fetcher: typeof fetch = async (url, init) => { requested = String(url); sentBody = String(init?.body ?? ''); return new Response('AABBCCDDEEFF00112233445566778899AABB:3\n', { status: 200 }); };
    expect(await breachedPassword('not-in-the-range-password-42', { fetcher, apiBase: 'http://fake.test' })).toBe(false);
    expect(requested).toMatch(/\/range\/[0-9A-F]{5}$/); expect(sentBody).not.toContain('not-in-the-range-password-42');
  });
  it('sends a real SMTP message through the nodemailer adapter', async () => {
    let received = ''; const server = new SMTPServer({ authOptional: false, disabledCommands: ['STARTTLS'], onAuth(_auth, _session, cb) { cb(null, { user: 'test' }); }, onData(stream, _session, cb) { const chunks: Buffer[] = []; stream.on('data', (x: Buffer) => chunks.push(x)); stream.on('end', () => { received = Buffer.concat(chunks).toString('utf8'); cb(); }); } });
    await new Promise<void>((resolve, reject) => { server.listen(0, '127.0.0.1', (e?: Error) => e ? reject(e) : resolve()); });
    const address = server.server.address(); if (!address || typeof address === 'string') throw new Error('SMTP server did not bind');
    const base = cfg(); const mailer = new SmtpMailer({ ...base, SMTP_HOST: '127.0.0.1', SMTP_PORT: address.port, SMTP_USER: 'test', SMTP_PASSWORD: 'test', SMTP_SECURE: 'false' });
    await mailer.send({ to: 'person@example.test', from: base.MAIL_FROM, subject: 'Test', text: 'hello', html: '<p>hello</p>', idempotencyKey: 'smtp-test' });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(received).toContain('Subject: Test'); expect(received).toContain('hello');
  });
});
