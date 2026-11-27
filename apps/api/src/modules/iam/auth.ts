import type { Pools } from '../../db/pool.js';
import { HttpError, badRequest, unauthorized } from '../../errors.js';
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from '../../crypto/password.js';
import { newTotpSecret, otpauthUri, verifyTotp } from '../../crypto/totp.js';
import { newToken, sha256 } from '../../crypto/tokens.js';
import { open, seal } from '../../crypto/kms.js';
import type { Kms } from '../../crypto/kms.js';
import type { Config } from '../../config.js';
import { randomBytes } from 'node:crypto';
import { passwordProblemWithBreach } from '../comms/password-security.js';

const LOCK_AFTER = 5;

export interface Membership { tenantId: string; name: string; slug: string }
export interface LoginResult { token: string; expiresAt: Date; memberships: Membership[]; tenantId: string | null; mustChangePassword: boolean }

function totpKey(kms: Kms, userId: string): Buffer { return kms.hmacKey('00000000-0000-0000-0000-000000000000', 'totp-user-' + userId); }

async function logAttempt(pools: Pools, email: string, ip: string | undefined, ok: boolean, reason?: string): Promise<void> {
  await pools.auth.query('insert into kernel.login_attempt (email, ip, ok, reason) values ($1, $2, $3, $4)', [email.slice(0, 254), ip ?? null, ok, reason ?? null]).catch(() => undefined);
}

async function registerFailure(pools: Pools, userId: string): Promise<void> {
  // Exponential back-off after the fifth failure: 1, 2, 4 ... capped at 60 minutes.
  await pools.auth.query(
    `update kernel.user_account set failed_attempts = failed_attempts + 1,
       locked_until = case when failed_attempts + 1 >= $2 then now() + make_interval(mins => least(60, power(2, failed_attempts + 1 - $2)::int)) else locked_until end
     where id = $1`, [userId, LOCK_AFTER]);
}

export async function login(pools: Pools, kms: Kms, cfg: Config, input: { email: string; password: string; totp?: string; recoveryCode?: string }, ip?: string, userAgent?: string): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const generic = unauthorized('Invalid email or password');
  const r = await pools.auth.query('select * from kernel.user_account where email = $1', [email]);
  const u = r.rows[0];
  if (!u) { await verifyPassword(input.password, await dummyHash()); await logAttempt(pools, email, ip, false, 'unknown_user'); throw generic; }
  if (u.disabled) { await verifyPassword(input.password, await dummyHash()); await logAttempt(pools, email, ip, false, 'disabled'); throw generic; }
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    await logAttempt(pools, email, ip, false, 'locked');
    throw new HttpError(429, 'locked', 'Too many failed attempts. Try again later.');
  }
  if (!(await verifyPassword(input.password, u.password_hash))) { await registerFailure(pools, u.id); await logAttempt(pools, email, ip, false, 'bad_password'); throw generic; }

  let mfa = false;
  if (u.totp_enabled) {
    if (!input.totp && !input.recoveryCode) throw new HttpError(401, 'mfa_required', 'Enter your verification code');
    if (input.totp) {
      const secret = open(totpKey(kms, u.id), Buffer.from(u.totp_secret_enc, 'base64'), 'totp:' + u.id).toString('utf8');
      const counter = verifyTotp(secret, input.totp, Date.now(), Number(u.totp_last_counter));
      if (counter === null) { await registerFailure(pools, u.id); await logAttempt(pools, email, ip, false, 'bad_totp'); throw new HttpError(401, 'bad_code', 'That code is not valid'); }
      await pools.auth.query('update kernel.user_account set totp_last_counter = $2 where id = $1', [u.id, counter]);
    } else {
      const used = await pools.auth.query('update kernel.recovery_code set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning id', [u.id, sha256((input.recoveryCode ?? '').replace(/[\s-]/g, '').toUpperCase())]);
      if (!used.rowCount) { await registerFailure(pools, u.id); await logAttempt(pools, email, ip, false, 'bad_recovery'); throw new HttpError(401, 'bad_code', 'That code is not valid'); }
    }
    mfa = true;
  }

  await pools.auth.query('update kernel.user_account set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1', [u.id]);
  const mem = await pools.auth.query('select t.id, t.name, t.slug::text as slug from kernel.membership m join kernel.tenant t on t.id = m.tenant_id where m.user_id = $1 and m.status = $2 and t.status = $3 order by t.name', [u.id, 'active', 'active']);
  const memberships: Membership[] = mem.rows.map((x) => ({ tenantId: x.id, name: x.name, slug: x.slug }));
  const tenantId = memberships.length === 1 ? memberships[0]!.tenantId : null;

  const token = newToken();
  const expiresAt = new Date(Date.now() + cfg.SESSION_ABSOLUTE_HOURS * 3600_000);
  await pools.auth.query(
    `insert into kernel.session (user_id, tenant_id, token_hash, mfa_verified, step_up_at, expires_at, idle_expires_at, ip, user_agent)
     values ($1, $2, $3, $4, now(), $5, least($5::timestamptz, now() + make_interval(mins => $6)), $7, $8)`,
    [u.id, tenantId, sha256(token), mfa, expiresAt, cfg.SESSION_IDLE_MINUTES, ip ?? null, (userAgent ?? '').slice(0, 300)]);
  await logAttempt(pools, email, ip, true);
  return { token, expiresAt, memberships, tenantId, mustChangePassword: u.must_change_password };
}

export async function selectTenant(pools: Pools, sessionId: string, userId: string, tenantId: string): Promise<void> {
  const ok = await pools.auth.query(`select 1 from kernel.membership m join kernel.tenant t on t.id = m.tenant_id where m.user_id = $1 and m.tenant_id = $2 and m.status = 'active' and t.status = 'active'`, [userId, tenantId]);
  if (!ok.rowCount) throw new HttpError(403, 'forbidden', 'You do not belong to that company');
  await pools.auth.query('update kernel.session set tenant_id = $2 where id = $1', [sessionId, tenantId]);
}

export async function logout(pools: Pools, sessionId: string): Promise<void> {
  await pools.auth.query('update kernel.session set revoked_at = now() where id = $1', [sessionId]);
}

/** Re-checks the password (and TOTP when enabled) and stamps the session. Used before pay approval, bank changes and role changes. */
export async function stepUp(pools: Pools, kms: Kms, userId: string, sessionId: string, input: { password: string; totp?: string }): Promise<void> {
  const r = await pools.auth.query('select * from kernel.user_account where id = $1', [userId]);
  const u = r.rows[0];
  if (!u) throw unauthorized();
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) throw new HttpError(429, 'locked', 'Too many failed attempts. Try again later.');
  if (!(await verifyPassword(input.password, u.password_hash))) { await registerFailure(pools, userId); throw new HttpError(401, 'bad_password', 'Password is not correct'); }
  if (u.totp_enabled) {
    if (!input.totp) throw new HttpError(401, 'mfa_required', 'Enter your verification code');
    const secret = open(totpKey(kms, userId), Buffer.from(u.totp_secret_enc, 'base64'), 'totp:' + userId).toString('utf8');
    const counter = verifyTotp(secret, input.totp, Date.now(), Number(u.totp_last_counter));
    if (counter === null) { await registerFailure(pools, userId); throw new HttpError(401, 'bad_code', 'That code is not valid'); }
    await pools.auth.query('update kernel.user_account set totp_last_counter = $2 where id = $1', [userId, counter]);
  }
  await pools.auth.query('update kernel.user_account set failed_attempts = 0 where id = $1', [userId]);
  await pools.auth.query('update kernel.session set step_up_at = now() where id = $1', [sessionId]);
}

export async function changePassword(pools: Pools, userId: string, sessionId: string, current: string, next: string, email: string, cfg?: Pick<Config, 'HIBP_MODE' | 'HIBP_API_BASE'>): Promise<void> {
  const r = await pools.auth.query('select password_hash from kernel.user_account where id = $1', [userId]);
  if (!r.rows[0] || !(await verifyPassword(current, r.rows[0].password_hash))) throw new HttpError(401, 'bad_password', 'Current password is not correct');
  const problem = cfg ? await passwordProblemWithBreach(next, email, cfg) : passwordProblem(next, email);
  if (problem) throw badRequest(problem);
  if (await verifyPassword(next, r.rows[0].password_hash)) throw badRequest('Choose a password you have not used before');
  const hash = await hashPassword(next);
  await pools.auth.query('update kernel.user_account set password_hash = $2, must_change_password = false, password_changed_at = now() where id = $1', [userId, hash]);
  // Every other session ends when the password changes.
  await pools.auth.query('update kernel.session set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null', [userId, sessionId]);
}

export async function mfaBegin(pools: Pools, kms: Kms, userId: string, email: string): Promise<{ secret: string; uri: string }> {
  const secret = newTotpSecret();
  const enc = seal(totpKey(kms, userId), Buffer.from(secret), 'totp:' + userId).toString('base64');
  // Stored but not enabled until the first code is confirmed.
  await pools.auth.query('update kernel.user_account set totp_secret_enc = $2, totp_enabled = false, totp_last_counter = 0 where id = $1 and totp_enabled = false', [userId, enc]);
  return { secret, uri: otpauthUri(secret, email) };
}

export async function mfaConfirm(pools: Pools, kms: Kms, userId: string, sessionId: string, code: string): Promise<string[]> {
  const r = await pools.auth.query('select totp_secret_enc, totp_enabled from kernel.user_account where id = $1', [userId]);
  const u = r.rows[0];
  if (!u?.totp_secret_enc) throw badRequest('Start setup first');
  if (u.totp_enabled) throw new HttpError(409, 'already_enabled', 'Two-step verification is already on');
  const secret = open(totpKey(kms, userId), Buffer.from(u.totp_secret_enc, 'base64'), 'totp:' + userId).toString('utf8');
  const counter = verifyTotp(secret, code);
  if (counter === null) throw new HttpError(401, 'bad_code', 'That code is not valid');
  const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex').toUpperCase());
  await pools.auth.query('delete from kernel.recovery_code where user_id = $1', [userId]);
  for (const c of codes) await pools.auth.query('insert into kernel.recovery_code (user_id, code_hash) values ($1, $2)', [userId, sha256(c)]);
  await pools.auth.query('update kernel.user_account set totp_enabled = true, totp_last_counter = $2 where id = $1', [userId, counter]);
  await pools.auth.query('update kernel.session set mfa_verified = true, step_up_at = now() where id = $1', [sessionId]);
  return codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`);
}

export async function mfaDisable(pools: Pools, userId: string): Promise<void> {
  await pools.auth.query('update kernel.user_account set totp_enabled = false, totp_secret_enc = null where id = $1', [userId]);
  await pools.auth.query('delete from kernel.recovery_code where user_id = $1', [userId]);
}

export async function listSessions(pools: Pools, userId: string): Promise<Array<Record<string, unknown>>> {
  const r = await pools.auth.query(`select id, created_at, last_seen_at, ip, user_agent from kernel.session where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc`, [userId]);
  return r.rows;
}
