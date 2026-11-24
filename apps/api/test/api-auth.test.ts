import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '../src/testing/client.js';
import { actor, boot, mkTenant, ownerOf, PW, stepUp, type Booted } from './api-helpers.js';

let b: Booted;
beforeAll(async () => { b = await boot(); });
afterAll(async () => { await b.close(); });

describe('authentication', () => {
  it('registers a company over HTTP, sets a hardened cookie and reports permissions', async () => {
    const c = new Client(b.app);
    const slug = 'reg-' + Math.random().toString(36).slice(2, 8);
    const r = await c.post('/api/v1/auth/register', { companyName: 'Registered Co', slug, country: 'AE', currency: 'AED', email: `${slug}@example.test`, displayName: 'Reg Owner', password: PW });
    expect(r.status).toBe(201);
    const sc = String(([] as string[]).concat(r.headers['set-cookie'] as string)[0]);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    const me = await c.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.roles).toContain('owner');
    expect(me.body.perms).toContain('pay.approve');
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });
  it('weak passwords are refused at registration', async () => {
    const c = new Client(b.app);
    const r = await c.post('/api/v1/auth/register', { companyName: 'Weak Co', slug: 'weak-' + Math.random().toString(36).slice(2, 7), country: 'AE', currency: 'AED', email: 'w@example.test', displayName: 'Weak', password: 'password1234' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
  it('gives the same answer for an unknown email and a wrong password', async () => {
    const t = await mkTenant(b.pools, 'au');
    const o = await ownerOf(b, t, false);
    const a = await new Client(b.app).login(o.email, 'wrong password entirely');
    const u = await new Client(b.app).login('nobody@example.test', 'wrong password entirely');
    expect(a.status).toBe(401); expect(u.status).toBe(401);
    expect(a.body.error.message).toBe(u.body.error.message);
  });
  it('locks the account after repeated failures, even for the right password', async () => {
    const t = await mkTenant(b.pools, 'lock');
    const o = await ownerOf(b, t, false);
    for (let i = 0; i < 12; i++) await new Client(b.app).login(o.email, 'definitely wrong ' + i);
    const r = await new Client(b.app).login(o.email, PW);
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('locked');
  });
  it('rejects a replayed TOTP code', async () => {
    const t = await mkTenant(b.pools, 'totp');
    const o = await ownerOf(b, t, true);
    await b.pools.auth.query('update kernel.user_account set totp_last_counter = 0 where id = $1', [o.userId]);
    const code = o.client.code();
    const first = await new Client(b.app).login(o.email, PW, code);
    expect(first.status).toBe(200);
    const again = await new Client(b.app).login(o.email, PW, code);
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('bad_code');
  });
  it('requires a code when two-step verification is on, and recovery codes work once', async () => {
    const t = await mkTenant(b.pools, 'rec');
    const o = await ownerOf(b, t, false);
    const rc = await o.client.enrolMfa(PW);
    expect(rc).toHaveLength(8);
    const none = await new Client(b.app).login(o.email, PW);
    expect(none.status).toBe(401); expect(none.body.error.code).toBe('mfa_required');
    const c1 = new Client(b.app);
    const ok = await c1.post('/api/v1/auth/login', { email: o.email, password: PW, recoveryCode: rc[0] });
    expect(ok.status).toBe(200);
    const reuse = await new Client(b.app).post('/api/v1/auth/login', { email: o.email, password: PW, recoveryCode: rc[0] });
    expect(reuse.status).toBe(401);
  });
  it('logout revokes the session server-side', async () => {
    const t = await mkTenant(b.pools, 'lo');
    const o = await ownerOf(b, t, false);
    const stolen = o.client.cookie!;
    expect((await o.client.get('/api/v1/auth/me')).status).toBe(200);
    await o.client.post('/api/v1/auth/logout');
    const replay = new Client(b.app); replay.cookie = stolen;
    expect((await replay.get('/api/v1/auth/me')).status).toBe(401);
  });
  it('step-up is required for sensitive actions and expires', async () => {
    const t = await mkTenant(b.pools, 'su');
    const o = await ownerOf(b, t, true);
    await b.pools.auth.query(`update kernel.session set step_up_at = now() - interval '11 minutes' where user_id = $1`, [o.userId]);
    const r = await o.client.post('/api/v1/platform/api-keys', { name: 'k', scopes: ['people.read'] });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('step_up_required');
    await stepUp(b, o);
    expect((await o.client.post('/api/v1/platform/api-keys', { name: 'k', scopes: ['people.read'] })).status).toBe(201);
  });
});

describe('request-level protections', () => {
  it('unauthenticated requests get 401', async () => {
    expect((await new Client(b.app).get('/api/v1/people/employees')).status).toBe(401);
  });
  it('cookie-authenticated mutations without the client header are refused (CSRF)', async () => {
    const t = await mkTenant(b.pools, 'csrf');
    const o = await ownerOf(b, t, false);
    const raw = new Client(b.app, { web: false });
    raw.cookie = o.client.cookie;
    const r = await raw.post('/api/v1/people/org', { name: 'X', code: 'XX' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf');
  });
  it('mutations from a foreign Origin are refused', async () => {
    const t = await mkTenant(b.pools, 'orig');
    const o = await ownerOf(b, t, false);
    const evil = new Client(b.app, { origin: 'https://evil.example' });
    evil.cookie = o.client.cookie;
    const r = await evil.post('/api/v1/people/org', { name: 'X', code: 'XX' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('bad_origin');
  });
  it('errors never leak internals', async () => {
    const t = await mkTenant(b.pools, 'err');
    const o = await ownerOf(b, t, false);
    const r = await o.client.get('/api/v1/people/employees/not-a-uuid');
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/select |stack|pg_|at \w+\.\w+/i);
  });
  it('API keys are read-only and limited to their scopes', async () => {
    const t = await mkTenant(b.pools, 'key');
    const o = await ownerOf(b, t, true);
    await stepUp(b, o);
    const k = await o.client.post('/api/v1/platform/api-keys', { name: 'reader', scopes: ['people.read'] });
    expect(k.status).toBe(201);
    const key = k.body.key as string;
    expect(key).toMatch(/^mk_[a-z0-9]{8}_/);
    const anon = new Client(b.app, { web: false });
    expect((await anon.get('/api/v1/people/employees', { 'x-api-key': key })).status).toBe(200);
    expect((await anon.post('/api/v1/people/org', { name: 'X', code: 'XX' }, { 'x-api-key': key })).status).toBe(403);
    expect((await anon.get('/api/v1/audit/events', { 'x-api-key': key })).status).toBe(403);
    expect((await anon.get('/api/v1/people/employees', { 'x-api-key': key + 'x' })).status).toBe(401);
    // a key cannot be created with a scope the creator does not hold
    const emp = await actor(b, t, 'Plain');
    const bad = await emp.client.post('/api/v1/platform/api-keys', { name: 'x', scopes: ['audit.read'] });
    expect(bad.status).toBe(403);
    // revoked keys stop working
    await stepUp(b, o);
    expect((await o.client.del(`/api/v1/platform/api-keys/${k.body.id}`)).status).toBe(200);
    expect((await anon.get('/api/v1/people/employees', { 'x-api-key': key })).status).toBe(401);
  });
  it('one company cannot read another company', async () => {
    const a = await mkTenant(b.pools, 'xa'); const z = await mkTenant(b.pools, 'xz');
    const oa = await ownerOf(b, a, false); const oz = await ownerOf(b, z, false);
    const mine = await oa.client.get('/api/v1/people/employees');
    const victim = mine.body.employees[0].id as string;
    expect((await oa.client.get(`/api/v1/people/employees/${victim}`)).status).toBe(200);
    expect((await oz.client.get(`/api/v1/people/employees/${victim}`)).status).toBe(404);
    const theirs = await oz.client.get('/api/v1/people/employees');
    expect(theirs.body.employees.map((e: { id: string }) => e.id)).not.toContain(victim);
  });
});
