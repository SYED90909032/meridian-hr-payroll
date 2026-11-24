import type { FastifyRequest } from 'fastify';
import type { Pools } from '../db/pool.js';
import { sha256 } from '../crypto/tokens.js';
import type { Perm } from './perms.js';
import { permsFor } from './perms.js';

export interface Principal {
  kind: 'user' | 'apikey' | 'device';
  userId: string | null;
  tenantId: string | null;
  employeeId: string | null;
  sessionId: string | null;
  email: string;
  displayName: string;
  roles: string[];
  perms: Set<Perm>;
  mfa: boolean;
  totpEnabled: boolean;
  stepUpAt: Date | null;
  mustChangePassword: boolean;
  /** Present for API keys and devices. */
  credentialId?: string;
  deviceId?: string;
}

export const SESSION_COOKIE = 'mer_sid';

/** Loads the session principal from the cookie. Returns null when absent, expired, revoked or the user is disabled. */
export async function principalFromSession(pools: Pools, token: string | undefined, idleMinutes: number): Promise<Principal | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await pools.auth.query(
    `select s.id, s.user_id, s.tenant_id, s.mfa_verified, s.step_up_at, s.expires_at, s.idle_expires_at, s.last_seen_at,
            u.email::text as email, u.display_name, u.disabled, u.must_change_password, u.totp_enabled,
            m.employee_id, m.status as mstatus,
            coalesce((select array_agg(ra.role) from kernel.role_assignment ra
                       where ra.user_id = s.user_id and ra.tenant_id = s.tenant_id and ra.revoked_at is null), '{}') as roles
       from kernel.session s
       join kernel.user_account u on u.id = s.user_id
       left join kernel.membership m on m.user_id = s.user_id and m.tenant_id = s.tenant_id
      where s.token_hash = $1 and s.revoked_at is null`, [sha256(token)]);
  const s = r.rows[0];
  if (!s) return null;
  const now = Date.now();
  if (s.disabled || new Date(s.expires_at).getTime() < now || new Date(s.idle_expires_at).getTime() < now) return null;
  if (s.tenant_id && s.mstatus !== 'active') return null;
  if (now - new Date(s.last_seen_at).getTime() > 60_000) {
    pools.auth.query('update kernel.session set last_seen_at = now(), idle_expires_at = least(expires_at, now() + make_interval(mins => $2)) where id = $1', [s.id, idleMinutes]).catch(() => undefined);
  }
  const roles: string[] = s.roles;
  return {
    kind: 'user', userId: s.user_id, tenantId: s.tenant_id, employeeId: s.employee_id ?? null, sessionId: s.id,
    email: s.email, displayName: s.display_name, roles, perms: permsFor(roles), mfa: s.mfa_verified, totpEnabled: s.totp_enabled,
    stepUpAt: s.step_up_at ? new Date(s.step_up_at) : null, mustChangePassword: s.must_change_password,
  };
}

export function clientIp(req: FastifyRequest): string { return req.ip; }
