import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { exportJWK, SignJWT } from 'jose';
import { boot, ownerOf, mkTenant, type Booted } from './api-helpers.js';
import { Client } from '../src/testing/client.js';
import { hashPassword } from '../src/crypto/password.js';
import { sha256 } from '../src/crypto/tokens.js';
import { withTx } from '../src/db/tx.js';
import type { TestTenant } from './helpers.js';

const b64u = (value: Uint8Array | Buffer): string => Buffer.from(value).toString('base64url');
const sha256b64u = (value: string): string => b64u(createHash('sha256').update(value).digest());

function cbor(value: unknown): Buffer {
  if (typeof value === 'string') return cborText(value);
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return cborBytes(Buffer.from(value));
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= 0) return cborUint(0, value);
    return cborUint(1, -1 - value);
  }
  if (typeof value === 'boolean') return Buffer.from([value ? 0xf5 : 0xf4]);
  if (Array.isArray(value)) return Buffer.concat([cborUint(4, value.length), ...value.map(cbor)]);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return Buffer.concat([cborUint(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(typeof key === 'string' && /^-?\d+$/.test(key) ? Number(key) : key), cbor(item)])]);
  }
  throw new Error('unsupported cbor value');
}
function cborUint(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  if (value < 65_536) { const out = Buffer.alloc(3); out[0] = (major << 5) | 25; out.writeUInt16BE(value, 1); return out; }
  const out = Buffer.alloc(5); out[0] = (major << 5) | 26; out.writeUInt32BE(value, 1); return out;
}
function cborText(value: string): Buffer { const raw = Buffer.from(value); return Buffer.concat([cborUint(3, raw.length), raw]); }
function cborBytes(value: Buffer): Buffer { return Buffer.concat([cborUint(2, value.length), value]); }

interface SoftwareCredential {
  id: Buffer;
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'];
  counter: number;
}
function makeSoftwareCredential(options: { challenge: string; rp: string; origin: string }): { credential: SoftwareCredential; response: Record<string, unknown> } {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' }) as JsonWebKey;
  const x = Buffer.from(jwk.x!, 'base64url');
  const y = Buffer.from(jwk.y!, 'base64url');
  const id = randomBytes(32);
  const cose = cbor({ 1: 2, 3: -7, '-1': 1, '-2': x, '-3': y });
  const authData = Buffer.concat([createHash('sha256').update(options.rp).digest(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([id.length >> 8, id.length]), id, cose]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: options.origin, crossOrigin: false }));
  const attestationObject = cbor({ fmt: 'none', attStmt: {}, authData });
  return {
    credential: { id, privateKey: pair.privateKey, publicKey: pair.publicKey, counter: 0 },
    response: { id: b64u(id), rawId: b64u(id), type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) } },
  };
}
function assertion(credential: SoftwareCredential, options: { challenge: string; rp: string; origin: string; counter?: number }): Record<string, unknown> {
  const counter = options.counter ?? credential.counter + 1;
  const authenticatorData = Buffer.concat([createHash('sha256').update(options.rp).digest(), Buffer.from([0x05]), Buffer.alloc(4)]);
  authenticatorData.writeUInt32BE(counter, 33);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: options.origin, crossOrigin: false }));
  const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]), credential.privateKey);
  credential.counter = counter;
  return { id: b64u(credential.id), rawId: b64u(credential.id), type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature), userHandle: null } };
}

interface FakeClaims {
  email: string;
  name?: string;
  groups?: string[];
  email_verified?: boolean;
  iss?: string;
  aud?: string | string[];
  nonce?: string;
  exp?: number;
}
interface FakeCode { verifier: string; redirectUri: string; clientId: string; nonce: string; claims: FakeClaims }
class FakeOidcProvider {
  readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  readonly badKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  readonly codes = new Map<string, FakeCode>();
  server!: Server;
  issuer = '';
  claims: FakeClaims = { email: 'sso-user@allowed.test', name: 'SSO User', groups: ['employees'], email_verified: true };
  badPkce = false;
  badSignature = false;
  async start(): Promise<void> {
    this.server = createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('fake provider did not bind');
    this.issuer = `http://127.0.0.1:${address.port}`;
  }
  async close(): Promise<void> { await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve())); }
  private json(res: import('node:http').ServerResponse, status: number, body: unknown): void { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); }
  private async body(req: import('node:http').IncomingMessage): Promise<string> { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString('utf8'); }
  private async handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', this.issuer || 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') return this.json(res, 200, { issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], scopes_supported: ['openid', 'email', 'profile'], claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'email', 'email_verified', 'name', 'groups'] });
      if (req.method === 'GET' && url.pathname === '/jwks') {
        const jwk = await exportJWK(this.keys.publicKey); return this.json(res, 200, { keys: [{ ...jwk, kid: 'fake-1', use: 'sig', alg: 'RS256' }] });
      }
      if (req.method === 'GET' && url.pathname === '/authorize') {
        const code = randomBytes(18).toString('base64url');
        this.codes.set(code, { verifier: url.searchParams.get('code_challenge') ?? '', redirectUri: url.searchParams.get('redirect_uri') ?? '', clientId: url.searchParams.get('client_id') ?? '', nonce: url.searchParams.get('nonce') ?? '', claims: { ...this.claims } });
        const target = new URL(url.searchParams.get('redirect_uri')!); target.searchParams.set('code', code); target.searchParams.set('state', url.searchParams.get('state')!); res.statusCode = 302; res.setHeader('location', target.href); res.end(); return;
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        const form = new URLSearchParams(await this.body(req)); const code = this.codes.get(form.get('code') ?? '');
        if (!code || form.get('client_id') !== code.clientId || form.get('redirect_uri') !== code.redirectUri || (this.badPkce ? form.get('code_verifier') !== 'deliberately-wrong' : sha256b64u(form.get('code_verifier') ?? '') !== code.verifier)) return this.json(res, 400, { error: 'invalid_grant' });
        this.codes.delete(form.get('code')!);
        const now = Math.floor(Date.now() / 1000); const claims = code.claims; const payload = { iss: claims.iss ?? this.issuer, sub: 'fake-subject', aud: claims.aud ?? code.clientId, email: claims.email, email_verified: claims.email_verified ?? true, name: claims.name ?? claims.email, groups: claims.groups ?? [], nonce: claims.nonce ?? code.nonce, iat: now, exp: claims.exp ?? now + 300 };
        const idToken = await new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'fake-1' }).sign(this.badSignature ? this.badKeys.privateKey : this.keys.privateKey);
        return this.json(res, 200, { access_token: randomBytes(20).toString('base64url'), token_type: 'Bearer', expires_in: 300, id_token: idToken });
      }
      this.json(res, 404, { error: 'not_found' });
    } catch { this.json(res, 500, { error: 'fake_provider_error' }); }
  }
}

let b: Booted;
let t: TestTenant;
let oidc: FakeOidcProvider;
beforeAll(async () => { b = await boot(); t = await mkTenant(b.pools, 'scim'); oidc = new FakeOidcProvider(); await oidc.start(); });
afterAll(async () => { await oidc.close(); await b.close(); });

async function ssoConfig(tenant: TestTenant, client: Client, options: Partial<{ jitProvision: boolean; domains: string[]; groupClaim: string; clientId: string }> = {}): Promise<void> {
  const response = await client.put('/api/v1/iam/sso', { issuerUrl: oidc.issuer, clientId: options.clientId ?? 'meridian-test', clientSecret: 'fake-secret', allowedEmailDomains: options.domains ?? ['allowed.test'], enabled: true, jitProvision: options.jitProvision ?? false, defaultRole: 'employee', groupClaim: options.groupClaim ?? 'groups', idpMfaSatisfies: false });
  expect(response.status).toBe(200);
  void tenant;
}
async function startSso(slug: string, redirect = '/'): Promise<{ start: string; callback: string }> {
  const response = await b.app.inject({ method: 'GET', url: `/api/v1/auth/sso/${slug}/start?redirect=${encodeURIComponent(redirect)}` });
  expect(response.statusCode).toBe(302);
  const start = String(response.headers.location);
  const auth = await fetch(start, { redirect: 'manual' });
  expect(auth.status).toBe(302);
  return { start, callback: String(auth.headers.get('location')) };
}
async function finishSso(callback: string): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined> }> {
  const u = new URL(callback);
  const response = await b.app.inject({ method: 'GET', url: `${u.pathname}${u.search}` });
  return { statusCode: response.statusCode, headers: response.headers as Record<string, string | string[] | undefined> };
}

async function webauthnRegister(actor: { client: Client }): Promise<SoftwareCredential> {
  const options = (await actor.client.post('/api/v1/auth/passkeys/register/options')).body as { challenge: string; rp: { id: string } };
  const made = makeSoftwareCredential({ challenge: options.challenge, rp: options.rp.id, origin: 'http://localhost:5173' });
  const verified = await actor.client.post('/api/v1/auth/passkeys/register/verify', { response: made.response, label: 'Software authenticator' });
  expect(verified.status).toBe(200);
  return made.credential;
}

 describe('SCIM 2.0 tenant provisioning', () => {
  it('runs the SCIM client sequence and keeps identity access in meridian_auth', async () => {
    const owner = await ownerOf(b, t, false);
    const made = await owner.client.post<{ token: string; prefix: string }>('/api/v1/iam/scim-tokens', { label: 'vitest directory', expiresInDays: 2 });
    expect(made.status).toBe(201);
    const token = made.body.token; const headers = { authorization: `Bearer ${token}` }; const directoryEmail = `directory-${randomBytes(6).toString('hex')}@example.test`;
    expect((await b.app.inject({ method: 'GET', url: '/api/v1/scim/v2/ServiceProviderConfig', headers })).statusCode).toBe(200);
    const created = await b.app.inject({ method: 'POST', url: '/api/v1/scim/v2/Users', headers: { ...headers, 'content-type': 'application/scim+json' }, payload: JSON.stringify({ userName: directoryEmail, displayName: 'Directory User', active: true }) });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const listed = await b.app.inject({ method: 'GET', url: `/api/v1/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${directoryEmail}"`)}`, headers });
    expect(listed.statusCode).toBe(200); expect((listed.json() as { totalResults: number }).totalResults).toBe(1);
    const patched = await b.app.inject({ method: 'PATCH', url: `/api/v1/scim/v2/Users/${id}`, headers: { ...headers, 'content-type': 'application/scim+json' }, payload: JSON.stringify({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: false }] }) });
    expect(patched.statusCode).toBe(200); expect((patched.json() as { active: boolean }).active).toBe(false);
    const authUser = await b.pools.auth.query<{ email: string }>('select email::text as email from kernel.user_account where id = $1', [id]);
    await b.pools.auth.query('update kernel.user_account set password_hash = $2 where id = $1', [id, await hashPassword('correct horse battery staple 42')]);
    const userClient = new Client(b.app); expect((await userClient.login(authUser.rows[0]!.email, 'correct horse battery staple 42')).status).toBe(200);
    const apiKeyPrefix = `p3-${randomBytes(8).toString('hex')}`;
    await withTx(b.pools.app, { tenantId: t.tenantId, userId: owner.userId, employeeId: owner.employeeId }, async (db) => { await db.query('insert into plat.api_key (tenant_id, name, prefix, key_hash, scopes, created_by, expires_at) values ($1,$2,$3,$4,$5,$6,now()+interval \'1 day\')', [t.tenantId, 'SCIM test key', apiKeyPrefix, sha256(`p3-${id}`), ['people.read'], id]); });
    const deleted = await b.app.inject({ method: 'DELETE', url: `/api/v1/scim/v2/Users/${id}`, headers });
    expect(deleted.statusCode).toBe(204);
    expect((await userClient.get('/api/v1/auth/me')).status).toBe(401);
    const key = await b.pools.auth.query<{ revoked_at: string | null }>('select revoked_at from plat.api_key where created_by = $1 and tenant_id = $2', [id, t.tenantId]);
    expect(key.rows[0]?.revoked_at).not.toBeNull();
    const revokedId = (await owner.client.get('/api/v1/iam/scim-tokens')).body.tokens.find((x: { token_prefix: string }) => x.token_prefix === made.body.prefix)?.id;
    expect(revokedId).toBeTruthy(); expect((await owner.client.del(`/api/v1/iam/scim-tokens/${revokedId}`)).status).toBe(200);
    expect((await b.app.inject({ method: 'GET', url: '/api/v1/scim/v2/Users', headers })).statusCode).toBe(401);
  });
  it('rejects bad or cross-tenant bearer tokens and exposes mapped groups only in their tenant', async () => {
    const other = await mkTenant(b.pools, 'scim-other'); const owner = await ownerOf(b, other, false); const made = await owner.client.post<{ token: string }>('/api/v1/iam/scim-tokens', { label: 'other', expiresInDays: 2 });
    const headers = { authorization: `Bearer ${made.body.token}` };
    expect((await b.app.inject({ method: 'GET', url: '/api/v1/scim/v2/Users', headers: { authorization: 'Bearer scim_invalid' } })).statusCode).toBe(401);
    const outsiderId = (await b.pools.auth.query<{ user_id: string }>('select user_id from kernel.membership where tenant_id = $1 order by created_at limit 1', [t.tenantId])).rows[0]!.user_id;
    expect((await b.app.inject({ method: 'GET', url: `/api/v1/scim/v2/Users/${outsiderId}`, headers })).statusCode).toBe(404);
    await withTx(b.pools.app, { tenantId: other.tenantId, userId: owner.userId, employeeId: owner.employeeId }, async (db) => { await db.query('insert into kernel.sso_group_role (tenant_id, group_name, role) values ($1,$2,$3)', [other.tenantId, 'SCIM Employees', 'employee']); });
    const groups = await b.app.inject({ method: 'GET', url: '/api/v1/scim/v2/Groups', headers });
    expect(groups.statusCode).toBe(200); expect((groups.json() as { totalResults: number }).totalResults).toBe(1);
  });
 });

describe('OIDC single sign-on against an in-process fake IdP', () => {
  it('completes discovery, JWKS signature validation, nonce, PKCE, JIT, and group-role mapping', async () => {
    const owner = await ownerOf(b, t, false); await ssoConfig(t, owner.client, { jitProvision: true });
    await owner.client.put('/api/v1/iam/sso/groups', { mappings: [{ groupName: 'employees', role: 'auditor' }] });
    oidc.claims = { email: `jit-${Date.now()}@allowed.test`, name: 'JIT Person', groups: ['employees'], email_verified: true };
    const flow = await startSso(t.slug, '/dashboard'); const result = await finishSso(flow.callback);
    expect(result.statusCode).toBe(302); expect(result.headers.location).toBe('/dashboard'); expect(result.headers['set-cookie']).toBeTruthy();
    const user = await b.pools.auth.query<{ id: string }>('select id from kernel.user_account where email = $1', [oidc.claims.email]);
    const mapped = await b.pools.auth.query<{ role: string }>('select role from kernel.role_assignment where user_id = $1 and tenant_id = $2 and revoked_at is null', [user.rows[0]!.id, t.tenantId]);
    expect(mapped.rows.map((x) => x.role)).toContain('auditor');
  });
  it('rejects state replay, nonce and PKCE failures, unverified email, issuer/audience/expiry/signature failures, and open redirects', async () => {
    const owner = await ownerOf(b, t, false); await ssoConfig(t, owner.client, { jitProvision: false });
    const open = await b.app.inject({ method: 'GET', url: `/api/v1/auth/sso/${t.slug}/start?redirect=${encodeURIComponent('https://evil.example')}` }); expect(open.statusCode).toBe(400);
    oidc.claims = { email: 'not-provisioned@allowed.test', email_verified: true }; const stateFlow = await startSso(t.slug); const stateUrl = new URL(stateFlow.callback); stateUrl.searchParams.set('state', `${stateUrl.searchParams.get('state')!}replay`); expect((await finishSso(stateUrl.href)).statusCode).toBe(401);
    oidc.claims = { email: 'not-provisioned@allowed.test', email_verified: false }; expect((await finishSso((await startSso(t.slug)).callback)).statusCode).toBe(401);
    oidc.claims = { email: 'not-provisioned@allowed.test', email_verified: true, iss: `${oidc.issuer}/wrong` }; expect((await finishSso((await startSso(t.slug)).callback)).statusCode).toBe(401);
    oidc.claims = { email: 'not-provisioned@allowed.test', email_verified: true, aud: 'wrong-client' }; expect((await finishSso((await startSso(t.slug)).callback)).statusCode).toBe(401);
    oidc.claims = { email: 'not-provisioned@allowed.test', email_verified: true, exp: Math.floor(Date.now() / 1000) - 10 }; expect((await finishSso((await startSso(t.slug)).callback)).statusCode).toBe(401);
    oidc.claims = { email: 'not-provisioned@allowed.test', email_verified: true, nonce: 'wrong-nonce' }; expect((await finishSso((await startSso(t.slug)).callback)).statusCode).toBe(401);
    oidc.badSignature = true; oidc.claims = { email: 'not-provisioned@allowed.test', email_verified: true }; expect((await finishSso((await startSso(t.slug)).callback)).statusCode).toBe(401); oidc.badSignature = false;
    oidc.badPkce = true; oidc.claims = { email: 'not-provisioned@allowed.test', email_verified: true }; expect((await finishSso((await startSso(t.slug)).callback)).statusCode).toBe(401); oidc.badPkce = false;
    const valid = await startSso(t.slug); oidc.claims = { email: 'not-provisioned@allowed.test', email_verified: true }; const done = await finishSso(valid.callback); expect(done.statusCode).toBe(403); expect((await finishSso(valid.callback)).statusCode).toBe(401);
  });
  it('does not accept an authorization code issued for another tenant client', async () => {
    const other = await mkTenant(b.pools, 'sso-other'); const owner = await ownerOf(b, other, false); await ssoConfig(other, owner.client, { jitProvision: true, clientId: 'tenant-b' });
    const flow = await startSso(other.slug); const foreignAuthorize = new URL(flow.start); foreignAuthorize.searchParams.set('client_id', 'meridian-test');
    const auth = await fetch(foreignAuthorize.href, { redirect: 'manual' }); expect(auth.status).toBe(302);
    expect((await finishSso(String(auth.headers.get('location')))).statusCode).toBe(401);
  });
  it('rejects a domain outside policy and a suspended existing membership', async () => {
    const owner = await ownerOf(b, t, false); await ssoConfig(t, owner.client, { jitProvision: true, domains: ['allowed.test'] });
    oidc.claims = { email: 'bad-domain@blocked.test', email_verified: true }; expect((await finishSso((await startSso(t.slug)).callback)).statusCode).toBe(403);
    const suspended = await b.pools.auth.query<{ id: string; email: string }>('insert into kernel.user_account (email, password_hash, display_name) values ($1,$2,$3) returning id,email::text as email', [`suspended-${Date.now()}@allowed.test`, 'x', 'Suspended']);
    await withTx(b.pools.app, { tenantId: t.tenantId, userId: owner.userId, employeeId: owner.employeeId }, async (db) => { await db.query('insert into kernel.membership (tenant_id,user_id,email,display_name,status) values ($1,$2,$3,$4,\'suspended\')', [t.tenantId, suspended.rows[0]!.id, suspended.rows[0]!.email, 'Suspended']); }, ['iam']);
    oidc.claims = { email: suspended.rows[0]!.email, email_verified: true }; expect((await finishSso((await startSso(t.slug)).callback)).statusCode).toBe(403);
  });
});

describe('WebAuthn passkeys with a software authenticator', () => {
  it('registers, signs in, rejects counter regression and consumes challenges once', async () => {
    const owner = await ownerOf(b, t, false); await owner.client.stepUp('correct horse battery staple 42');
    const credential = await webauthnRegister(owner);
    expect((await owner.client.get('/api/v1/auth/passkeys')).body.passkeys).toHaveLength(1);
    const login = new Client(b.app); const options = (await login.post('/api/v1/auth/passkey/options', { email: owner.email })).body as { challenge: string; rpId: string; allowCredentials: Array<{ id: string }> };
    expect(options.allowCredentials[0]!.id).toBe(b64u(credential.id));
    const first = assertion(credential, { challenge: options.challenge, rp: options.rpId, origin: 'http://localhost:5173', counter: 1 });
    expect((await login.post('/api/v1/auth/passkey/verify', { response: first })).status).toBe(200);
    expect((await login.post('/api/v1/auth/passkey/verify', { response: first })).status).toBe(401);
    const regressionOptions = (await new Client(b.app).post('/api/v1/auth/passkey/options', { email: owner.email })).body as { challenge: string; rpId: string };
    const regression = assertion(credential, { challenge: regressionOptions.challenge, rp: regressionOptions.rpId, origin: 'http://localhost:5173', counter: 1 });
    expect((await new Client(b.app).post('/api/v1/auth/passkey/verify', { response: regression })).status).toBe(401);
    const other = await mkTenant(b.pools, 'passkey-other'); const otherOwner = await ownerOf(b, other, false);
    const otherOptions = (await new Client(b.app).post('/api/v1/auth/passkey/options', { email: otherOwner.email })).body as { challenge: string; rpId: string };
    const crossUser = assertion(credential, { challenge: otherOptions.challenge, rp: otherOptions.rpId, origin: 'http://localhost:5173', counter: 2 });
    expect((await new Client(b.app).post('/api/v1/auth/passkey/verify', { response: crossUser })).status).toBe(401);
  });
});
