import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { z } from 'zod';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Services } from '../../http/route.js';
import { defineRoute } from '../../http/route.js';
import { SESSION_COOKIE } from '../../http/principal.js';
import { HttpError, badRequest, forbidden, notFound, unauthorized } from '../../errors.js';
import { newToken, sha256 } from '../../crypto/tokens.js';
import { withTx } from '../../db/tx.js';
import type { Config } from '../../config.js';
import type { Pools } from '../../db/pool.js';

const responseSchema = z.record(z.string(), z.unknown());
const credentialBody = z.object({ response: responseSchema, label: z.string().trim().min(1).max(80).default('Passkey') }).strict();
const authBody = z.object({ response: responseSchema }).strict();
const email = z.string().trim().toLowerCase().email().max(254);
const uuid = z.string().uuid();
const CHALLENGE_TTL_MS = 5 * 60_000;

export function setPasskeyCookie(svc: Services, req: FastifyRequest, reply: FastifyReply, token: string, expires: Date): void {
  const secure = svc.cfg.COOKIE_SECURE === 'true' || (svc.cfg.COOKIE_SECURE === 'auto' && (svc.cfg.NODE_ENV === 'production' || req.protocol === 'https'));
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: svc.cfg.COOKIE_SAMESITE, path: '/', expires });
}
function rp(svc: Services): { id: string; origin: string } {
  return { id: svc.cfg.WEBAUTHN_RP_ID, origin: svc.cfg.WEBAUTHN_ORIGIN };
}
function jsonResponse(v: unknown): RegistrationResponseJSON | AuthenticationResponseJSON {
  return v as RegistrationResponseJSON | AuthenticationResponseJSON;
}
async function saveChallenge(pools: Pools, challenge: string, userId: string | null, sessionId: string | null, ceremony: 'registration' | 'authentication' | 'step_up'): Promise<void> {
  await pools.auth.query('insert into kernel.webauthn_challenge (challenge, challenge_hash, user_id, session_id, ceremony, expires_at) values ($1, $2, $3, $4, $5, $6)', [challenge, sha256(challenge), userId, sessionId, ceremony, new Date(Date.now() + CHALLENGE_TTL_MS)]);
}
async function takeChallenge(pools: Pools, challenge: string, ceremony: string, sessionId?: string | null): Promise<{ user_id: string | null; session_id: string | null }> {
  const r = await pools.auth.query<{ user_id: string | null; session_id: string | null }>(
    `update kernel.webauthn_challenge set used_at = now() where challenge_hash = $1 and ceremony = $2 and used_at is null and expires_at > now() and ($3::uuid is null or session_id = $3) returning user_id, session_id`,
    [sha256(challenge), ceremony, sessionId ?? null],
  );
  if (!r.rowCount) throw new HttpError(401, 'invalid_challenge', 'That passkey ceremony is no longer valid');
  return r.rows[0]!;
}
async function activeCredentials(pools: Pools, userId: string): Promise<Array<{ id: Buffer; public_key: Buffer; counter: number; transports: string[]; device_label: string; created_at: string; last_used_at: string | null }>> {
  return (await pools.auth.query('select credential_id as id, public_key, counter, transports, device_label, created_at, last_used_at from kernel.passkey_credential where user_id = $1 order by created_at', [userId])).rows;
}
function credential(row: { id: Buffer | string; public_key: Buffer; counter: number; transports: string[] }): WebAuthnCredential {
  return { id: typeof row.id === 'string' ? row.id : row.id.toString('base64url'), publicKey: new Uint8Array(row.public_key), counter: Number(row.counter), transports: row.transports as WebAuthnCredential['transports'] };
}
async function auditUser(svc: Services, userId: string, action: string, data: Record<string, unknown>): Promise<void> {
  const memberships = await svc.pools.auth.query<{ tenant_id: string; employee_id: string | null }>('select tenant_id, employee_id from kernel.membership where user_id = $1 and status = \'active\'', [userId]);
  for (const m of memberships.rows) {
    await withTx(svc.pools.app, { tenantId: m.tenant_id, userId, employeeId: m.employee_id }, async (db) => {
      await db.query('select kernel.append_audit($1, $2, $3, $4, $5, $6::jsonb, $7, $8)', [m.tenant_id, userId, action, 'passkey', null, JSON.stringify(data), null, null]);
    });
  }
}
export async function createPasskeySession(pools: Pools, cfg: Config, userId: string, ip: string | undefined, userAgent: string | undefined, mfaVerified = true): Promise<{ token: string; expiresAt: Date; tenantId: string | null }> {
  const u = await pools.auth.query<{ disabled: boolean; email: string; tenant_id: string; status: string }>(
    `select u.disabled, u.email::text as email, m.tenant_id, m.status from kernel.user_account u join kernel.membership m on m.user_id = u.id join kernel.tenant t on t.id = m.tenant_id where u.id = $1 and t.status = 'active' and m.status = 'active' order by m.created_at`, [userId]);
  if (!u.rowCount || u.rows[0]!.disabled) throw unauthorized('Passkey sign-in failed');
  const tenantId = u.rows.length === 1 ? u.rows[0]!.tenant_id : null;
  const token = newToken();
  const expiresAt = new Date(Date.now() + cfg.SESSION_ABSOLUTE_HOURS * 3600_000);
  await pools.auth.query(`insert into kernel.session (user_id, tenant_id, token_hash, mfa_verified, step_up_at, expires_at, idle_expires_at, ip, user_agent) values ($1, $2, $3, $4, now(), $5, least($5::timestamptz, now() + make_interval(mins => $6)), $7, $8)`, [userId, tenantId, sha256(token), mfaVerified, expiresAt, cfg.SESSION_IDLE_MINUTES, ip ?? null, (userAgent ?? '').slice(0, 300)]);
  await pools.auth.query('update kernel.user_account set last_login_at = now(), failed_attempts = 0, locked_until = null where id = $1', [userId]);
  return { token, expiresAt, tenantId };
}
export function registerPasskeyRoutes(svc: Services): void {
  const { pools, cfg } = svc;
  defineRoute(svc, { method: 'POST', path: '/api/v1/auth/passkeys/register/options', summary: 'Begin passkey registration', tag: 'Auth', auth: 'user', tx: false, stepUp: true, handler: async ({ p }) => {
    const user = await pools.auth.query<{ email: string; display_name: string }>('select email::text as email, display_name from kernel.user_account where id = $1', [p.userId]);
    if (!user.rowCount) throw unauthorized();
    const existing = await activeCredentials(pools, p.userId!);
    const challenge = randomBytes(32).toString('base64url');
    const options = await generateRegistrationOptions({ rpName: 'Meridian', rpID: rp(svc).id, userName: user.rows[0]!.email, userDisplayName: user.rows[0]!.display_name, userID: Buffer.from(p.userId!, 'utf8'), challenge, attestationType: 'none', userVerification: 'required', excludeCredentials: existing.map((x) => ({ id: x.id.toString('base64url'), transports: x.transports })) } as Parameters<typeof generateRegistrationOptions>[0]);
    await saveChallenge(pools, options.challenge, p.userId!, p.sessionId, 'registration');
    return options;
  }});
  defineRoute(svc, { method: 'POST', path: '/api/v1/auth/passkeys/register/verify', summary: 'Complete passkey registration', tag: 'Auth', auth: 'user', tx: false, stepUp: true, body: credentialBody, handler: async ({ p, body }) => {
    const r = jsonResponse(body.response) as RegistrationResponseJSON;
    // The challenge is consumed only after cryptographic verification succeeds; a failed response cannot burn a ceremony.
    const raw = await pools.auth.query<{ challenge: string; challenge_hash: Buffer }>('select challenge, challenge_hash from kernel.webauthn_challenge where user_id = $1 and session_id = $2 and ceremony = \'registration\' and used_at is null and expires_at > now() order by created_at desc limit 1', [p.userId, p.sessionId]);
    if (!raw.rowCount) throw unauthorized();
    const result = await verifyRegistrationResponse({ response: r, expectedChallenge: raw.rows[0]!.challenge, expectedOrigin: rp(svc).origin, expectedRPID: rp(svc).id, requireUserVerification: true });
    if (!result.verified || !result.registrationInfo) throw new HttpError(401, 'passkey_invalid', 'Passkey registration could not be verified');
    const info = result.registrationInfo;
    const cid = Buffer.from(info.credential.id, 'base64url');
    await takeChallenge(pools, raw.rows[0]!.challenge, 'registration', p.sessionId);
    await pools.auth.query('insert into kernel.passkey_credential (user_id, credential_id, public_key, counter, transports, device_label) values ($1, $2, $3, $4, $5, $6)', [p.userId, cid, Buffer.from(info.credential.publicKey), info.credential.counter, info.credential.transports ?? [], body.label]);
    await auditUser(svc, p.userId!, 'iam.passkey_registered', { label: body.label });
    return { ok: true };
  }});
  defineRoute(svc, { method: 'GET', path: '/api/v1/auth/passkeys', summary: 'List your passkeys', tag: 'Auth', auth: 'user', tx: false, handler: async ({ p }) => ({ passkeys: (await activeCredentials(pools, p.userId!)).map((x) => ({ id: x.id.toString('base64url'), label: x.device_label, createdAt: x.created_at, lastUsedAt: x.last_used_at })) }) });
  defineRoute(svc, { method: 'PATCH', path: '/api/v1/auth/passkeys/:id', summary: 'Rename a passkey', tag: 'Auth', auth: 'user', tx: false, body: z.object({ label: z.string().trim().min(1).max(80) }).strict(), handler: async ({ p, params, body }) => {
    const id = Buffer.from(params.id!, 'base64url');
    const r = await pools.auth.query('update kernel.passkey_credential set device_label = $3 where user_id = $1 and credential_id = $2 returning id', [p.userId, id, body.label]);
    if (!r.rowCount) throw notFound('Passkey not found');
    await auditUser(svc, p.userId!, 'iam.passkey_renamed', { label: body.label });
    return { ok: true };
  }});
  defineRoute(svc, { method: 'DELETE', path: '/api/v1/auth/passkeys/:id', summary: 'Remove a passkey', tag: 'Auth', auth: 'user', tx: false, handler: async ({ p, params }) => {
    const r = await pools.auth.query('delete from kernel.passkey_credential where user_id = $1 and credential_id = $2 returning id', [p.userId, Buffer.from(params.id!, 'base64url')]);
    if (!r.rowCount) throw notFound('Passkey not found');
    await auditUser(svc, p.userId!, 'iam.passkey_removed', {});
    return { ok: true };
  }});
  defineRoute(svc, { method: 'POST', path: '/api/v1/auth/passkey/options', summary: 'Begin passkey sign-in', tag: 'Auth', auth: 'public', tx: false, body: z.object({ email: email.optional() }).strict(), handler: async ({ body }) => {
    const user = body.email ? await pools.auth.query<{ id: string }>('select id from kernel.user_account where email = $1 and disabled = false', [body.email]) : { rows: [] as Array<{ id: string }> };
    const ids = user.rows.length ? (await activeCredentials(pools, user.rows[0]!.id)).map((x) => ({ id: x.id.toString('base64url'), transports: x.transports })) : undefined;
    const challenge = randomBytes(32).toString('base64url');
    const options = await generateAuthenticationOptions({ rpID: rp(svc).id, challenge, allowCredentials: ids, userVerification: 'required' });
    await saveChallenge(pools, options.challenge, user.rows[0]?.id ?? null, null, 'authentication');
    return options;
  }});
  defineRoute(svc, { method: 'POST', path: '/api/v1/auth/passkey/verify', summary: 'Complete passkey sign-in', tag: 'Auth', auth: 'public', tx: false, body: authBody, handler: async ({ body, req, reply }) => {
    const r = jsonResponse(body.response) as AuthenticationResponseJSON;
    const cid = Buffer.from(r.id, 'base64url');
    const c = await pools.auth.query<{ user_id: string; id: Buffer; public_key: Buffer; counter: number; transports: string[] }>('select credential_id as id, user_id, public_key, counter, transports from kernel.passkey_credential where credential_id = $1', [cid]);
    if (!c.rowCount) throw unauthorized('Passkey sign-in failed');
    const ch = await pools.auth.query<{ challenge: string; id: string }>('select challenge, id from kernel.webauthn_challenge where (user_id = $1 or user_id is null) and ceremony = \'authentication\' and used_at is null and expires_at > now() order by created_at desc limit 1', [c.rows[0]!.user_id]);
    if (!ch.rowCount) throw unauthorized('Passkey sign-in failed');
    let vr;
    try {
      vr = await verifyAuthenticationResponse({ response: r, expectedChallenge: ch.rows[0]!.challenge, expectedOrigin: rp(svc).origin, expectedRPID: rp(svc).id, requireUserVerification: true, credential: credential(c.rows[0]!) });
    } catch {
      await pools.auth.query('update kernel.webauthn_challenge set used_at = now() where id = $1 and used_at is null', [ch.rows[0]!.id]);
      await auditUser(svc, c.rows[0]!.user_id, 'iam.passkey_clone_rejected', { credentialId: r.id });
      throw new HttpError(401, 'passkey_rejected', 'This passkey was rejected');
    }
    if (!vr.verified || vr.authenticationInfo.newCounter < Number(c.rows[0]!.counter) || (Number(c.rows[0]!.counter) > 0 && vr.authenticationInfo.newCounter === Number(c.rows[0]!.counter))) {
      await pools.auth.query('update kernel.webauthn_challenge set used_at = now() where id = $1 and used_at is null', [ch.rows[0]!.id]);
      await auditUser(svc, c.rows[0]!.user_id, 'iam.passkey_clone_rejected', { credentialId: r.id });
      throw new HttpError(401, 'passkey_rejected', 'This passkey was rejected');
    }
    await takeChallenge(pools, ch.rows[0]!.challenge, 'authentication');
    await pools.auth.query('update kernel.passkey_credential set counter = $2, last_used_at = now() where credential_id = $1', [cid, vr.authenticationInfo.newCounter]);
    const session = await createPasskeySession(pools, cfg, c.rows[0]!.user_id, req.ip, req.headers['user-agent']);
    setPasskeyCookie(svc, req, reply, session.token, session.expiresAt);
    await auditUser(svc, c.rows[0]!.user_id, 'iam.passkey_signed_in', {});
    return { ok: true, tenantId: session.tenantId };
  }});
  defineRoute(svc, { method: 'POST', path: '/api/v1/auth/step-up/passkey/options', summary: 'Begin passkey step-up', tag: 'Auth', auth: 'user', tx: false, handler: async ({ p }) => {
    const rows = await activeCredentials(pools, p.userId!); if (!rows.length) throw forbidden('Register a passkey first');
    const challenge = randomBytes(32).toString('base64url');
    const options = await generateAuthenticationOptions({ rpID: rp(svc).id, challenge, allowCredentials: rows.map((x) => ({ id: x.id.toString('base64url'), transports: x.transports })), userVerification: 'required' });
    await saveChallenge(pools, options.challenge, p.userId!, p.sessionId, 'step_up'); return options;
  }});
  defineRoute(svc, { method: 'POST', path: '/api/v1/auth/step-up/passkey/verify', summary: 'Complete passkey step-up', tag: 'Auth', auth: 'user', tx: false, body: authBody, handler: async ({ p, body }) => {
    const r = jsonResponse(body.response) as AuthenticationResponseJSON;
    const row = await pools.auth.query<{ id: string; credential_id: Buffer; public_key: Buffer; counter: number; transports: string[] }>('select id, credential_id, public_key, counter, transports from kernel.passkey_credential where user_id = $1 and credential_id = $2', [p.userId, Buffer.from(r.id, 'base64url')]);
    if (!row.rowCount) throw unauthorized('Passkey step-up failed');
    const ch = await pools.auth.query<{ challenge: string; challenge_hash: Buffer }>('select challenge, challenge_hash from kernel.webauthn_challenge where user_id = $1 and session_id = $2 and ceremony = \'step_up\' and used_at is null and expires_at > now() order by created_at desc limit 1', [p.userId, p.sessionId]);
    if (!ch.rowCount) throw new HttpError(401, 'invalid_challenge', 'Start passkey step-up again');
    let vr;
    try {
      vr = await verifyAuthenticationResponse({ response: r, expectedChallenge: ch.rows[0]!.challenge, expectedOrigin: rp(svc).origin, expectedRPID: rp(svc).id, requireUserVerification: true, credential: credential({ ...row.rows[0]!, id: row.rows[0]!.credential_id }) });
    } catch {
      await pools.auth.query('update kernel.webauthn_challenge set used_at = now() where challenge_hash = $1 and used_at is null', [ch.rows[0]!.challenge_hash]);
      throw unauthorized('Passkey step-up failed');
    }
    if (!vr.verified || vr.authenticationInfo.newCounter < Number(row.rows[0]!.counter) || (Number(row.rows[0]!.counter) > 0 && vr.authenticationInfo.newCounter === Number(row.rows[0]!.counter))) throw unauthorized('Passkey step-up failed');
    await takeChallenge(pools, ch.rows[0]!.challenge, 'step_up', p.sessionId);
    await pools.auth.query('update kernel.passkey_credential set counter = $2, last_used_at = now() where id = $1', [row.rows[0]!.id, vr.authenticationInfo.newCounter]);
    await pools.auth.query('update kernel.session set step_up_at = now(), mfa_verified = true where id = $1', [p.sessionId]);
    await auditUser(svc, p.userId!, 'iam.passkey_step_up', {}); return { ok: true, validForMinutes: 10 };
  }});
  void uuid;
}
