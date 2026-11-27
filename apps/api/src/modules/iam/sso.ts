import { randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  customFetch,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { defineRoute, type Services } from '../../http/route.js';
import { HttpError, badRequest, forbidden, notFound, unauthorized } from '../../errors.js';
import { open, seal } from '../../crypto/kms.js';
import { hashPassword } from '../../crypto/password.js';
import { newToken, sha256 } from '../../crypto/tokens.js';
import { withTx } from '../../db/tx.js';
import { ROLES } from '../../http/perms.js';
import { createPasskeySession, setPasskeyCookie } from './passkeys.js';
import { resolveSafeTarget } from '../platform/ssrf.js';
import type { Config } from '../../config.js';

const tenantSlug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/);
const role = z.enum(['employee', ...ROLES]);
const configBody = z.object({
  issuerUrl: z.string().url().max(2048), clientId: z.string().min(1).max(512), clientSecret: z.string().min(1).max(4096),
  allowedEmailDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+$/)).max(50).default([]), enabled: z.boolean().default(false),
  jitProvision: z.boolean().default(false), defaultRole: role.default('employee'), groupClaim: z.string().trim().min(1).max(100).optional(), idpMfaSatisfies: z.boolean().default(false),
}).strict();
const groupBody = z.object({ mappings: z.array(z.object({ groupName: z.string().trim().min(1).max(200), role }).strict()).max(100) }).strict();
const callbackQuery = z.object({ code: z.string().min(1).max(4096).optional(), state: z.string().min(16).max(512), error: z.string().max(200).optional() }).strict();
function safeIssuer(cfg: Config, raw: string): URL {
  let u: URL; try { u = new URL(raw); } catch { throw badRequest('The identity provider URL is invalid'); }
  if (u.username || u.password || u.hash || !['https:', 'http:'].includes(u.protocol)) throw badRequest('The identity provider URL is invalid');
  if (cfg.NODE_ENV === 'production' && u.protocol !== 'https:') throw forbidden('Identity providers must use HTTPS');
  return u;
}
function redirectPath(raw: string | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('\n')) throw badRequest('Invalid post-login redirect');
  return raw;
}
async function guardedFetch(cfg: Config, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (cfg.NODE_ENV === 'production' && u.protocol !== 'https:') throw new Error('OIDC endpoint must use HTTPS');
  const testLoopback = cfg.NODE_ENV === 'test' && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (!testLoopback) await resolveSafeTarget(u.href);
  return fetch(input, init);
}
function sealedSecret(svc: Services, tenantId: string, secret: string): string {
  return seal(svc.kms.tenantKey(tenantId), Buffer.from(secret), 'sso:client-secret').toString('base64');
}
function unsealedSecret(svc: Services, tenantId: string, encrypted: string): string {
  return open(svc.kms.tenantKey(tenantId), Buffer.from(encrypted, 'base64'), 'sso:client-secret').toString('utf8');
}
async function oidcConfig(svc: Services, issuer: string, clientId: string, clientSecret: string) {
  const server = safeIssuer(svc.cfg, issuer);
  const c = await discovery(server, clientId, { client_secret: clientSecret }, undefined, {
    [customFetch]: (input, init) => guardedFetch(svc.cfg, input, init as RequestInit),
    execute: server.protocol === 'http:' ? [allowInsecureRequests] : [],
  });
  if (server.protocol === 'http:') allowInsecureRequests(c);
  return c;
}
async function groupRoles(svc: Services, tenantId: string, groups: string[]): Promise<string[]> {
  if (!groups.length) return [];
  const rows = await svc.pools.auth.query<{ role: string }>('select role from kernel.sso_group_role where tenant_id = $1 and group_name = any($2::text[])', [tenantId, groups]);
  return [...new Set(rows.rows.map((x) => x.role))];
}
function claimString(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function sameIssuer(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  try { return new URL(a).href === new URL(b).href; } catch { return false; }
}
export function registerSsoRoutes(svc: Services): void {
  defineRoute(svc, { method: 'GET', path: '/api/v1/iam/sso', summary: 'Read tenant SSO settings', tag: 'Access', auth: 'session', perm: 'settings.manage', handler: async ({ db }) => {
    const r = await db.query('select issuer_url, client_id, allowed_email_domains, enabled, jit_provision, default_role, group_claim, idp_mfa_satisfies, updated_at from kernel.sso_config limit 1');
    return { config: r.rows[0] ?? null };
  }});
  defineRoute(svc, { method: 'PUT', path: '/api/v1/iam/sso', summary: 'Replace tenant OIDC SSO settings', tag: 'Access', auth: 'session', perm: 'settings.manage', stepUp: true, actors: ['iam'], body: configBody, idempotent: 'optional', handler: async ({ p, db, body, audit }) => {
    const issuer = safeIssuer(svc.cfg, body.issuerUrl);
    await oidcConfig(svc, issuer.href, body.clientId, body.clientSecret);
    await db.query(`insert into kernel.sso_config (tenant_id, issuer_url, client_id, client_secret_enc, allowed_email_domains, enabled, jit_provision, default_role, group_claim, idp_mfa_satisfies, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (tenant_id) do update set issuer_url=excluded.issuer_url, client_id=excluded.client_id, client_secret_enc=excluded.client_secret_enc, allowed_email_domains=excluded.allowed_email_domains, enabled=excluded.enabled, jit_provision=excluded.jit_provision, default_role=excluded.default_role, group_claim=excluded.group_claim, idp_mfa_satisfies=excluded.idp_mfa_satisfies, updated_by=excluded.updated_by, updated_at=now()`, [p.tenantId, issuer.href, body.clientId, sealedSecret(svc, p.tenantId!, body.clientSecret), body.allowedEmailDomains, body.enabled, body.jitProvision, body.defaultRole, body.groupClaim ?? null, body.idpMfaSatisfies, p.userId]);
    await audit('iam.sso_configured', 'tenant', p.tenantId, { issuer: issuer.origin, enabled: body.enabled, jitProvision: body.jitProvision });
    return { ok: true };
  }});
  defineRoute(svc, { method: 'DELETE', path: '/api/v1/iam/sso', summary: 'Disable tenant SSO settings', tag: 'Access', auth: 'session', perm: 'settings.manage', stepUp: true, actors: ['iam'], handler: async ({ p, db, audit }) => { await db.query('update kernel.sso_config set enabled = false, updated_by = $2, updated_at = now() where tenant_id = $1', [p.tenantId, p.userId]); await audit('iam.sso_disabled', 'tenant', p.tenantId, {}); return { ok: true }; }});
  defineRoute(svc, { method: 'PUT', path: '/api/v1/iam/sso/groups', summary: 'Replace OIDC group role mappings', tag: 'Access', auth: 'session', perm: 'settings.manage', stepUp: true, actors: ['iam'], body: groupBody, idempotent: 'optional', handler: async ({ p, db, body, audit }) => {
    await db.query('delete from kernel.sso_group_role where tenant_id = $1', [p.tenantId]);
    for (const m of body.mappings) await db.query('insert into kernel.sso_group_role (tenant_id, group_name, role) values ($1,$2,$3)', [p.tenantId, m.groupName, m.role]);
    await audit('iam.sso_groups_changed', 'tenant', p.tenantId, { count: body.mappings.length }); return { ok: true };
  }});
  defineRoute(svc, { method: 'GET', path: '/api/v1/auth/sso/:tenantSlug/start', summary: 'Start tenant OIDC sign-in', tag: 'Auth', auth: 'public', tx: false, query: z.object({ redirect: z.string().max(400).optional() }).strict(), handler: async ({ params, query, reply }) => {
    const slug = tenantSlug.parse(params.tenantSlug);
    const t = await svc.pools.auth.query<{ id: string; issuer_url: string; client_id: string; client_secret_enc: string; enabled: boolean }>('select t.id, c.issuer_url, c.client_id, c.client_secret_enc, c.enabled from kernel.tenant t join kernel.sso_config c on c.tenant_id = t.id where t.slug = $1 and t.status = \'active\'', [slug]);
    if (!t.rowCount || !t.rows[0]!.enabled) throw notFound('SSO is not enabled for that company');
    const config = t.rows[0]!; const clientSecret = unsealedSecret(svc, config.id, config.client_secret_enc); const oidc = await oidcConfig(svc, config.issuer_url, config.client_id, clientSecret);
    const state = randomState(); const nonce = randomNonce(); const verifier = randomPKCECodeVerifier(); const challenge = await calculatePKCECodeChallenge(verifier);
    const path = redirectPath(query.redirect); const sealedVerifier = seal(svc.kms.tenantKey(config.id), Buffer.from(verifier), 'sso:pkce').toString('base64');
    await svc.pools.auth.query('insert into kernel.sso_state (tenant_id, state_hash, nonce, pkce_verifier_enc, redirect_path, expires_at) values ($1,$2,$3,$4,$5,$6)', [config.id, sha256(state), nonce, sealedVerifier, path, new Date(Date.now() + 5 * 60_000)]);
    const url = buildAuthorizationUrl(oidc, { response_type: 'code', client_id: config.client_id, redirect_uri: svc.cfg.SSO_CALLBACK_URL, scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' });
    return { status: 302, headers: { location: url.href }, body: '' };
  }});
  defineRoute(svc, { method: 'GET', path: '/api/v1/auth/sso/callback', summary: 'Complete OIDC sign-in', tag: 'Auth', auth: 'public', tx: false, query: callbackQuery, handler: async ({ query, req, reply }) => {
    if (query.error || !query.code) throw unauthorized('The identity provider did not complete sign-in');
    const state = await svc.pools.auth.query<{ id: string; tenant_id: string; nonce: string; pkce_verifier_enc: string; redirect_path: string }>('update kernel.sso_state set used_at = now() where state_hash = $1 and used_at is null and expires_at > now() returning id, tenant_id, nonce, pkce_verifier_enc, redirect_path', [sha256(query.state)]);
    if (!state.rowCount) throw unauthorized('The SSO sign-in link is invalid or expired');
    const s = state.rows[0]!;
    const c = await svc.pools.auth.query<{ issuer_url: string; client_id: string; client_secret_enc: string; allowed_email_domains: string[]; jit_provision: boolean; default_role: string; group_claim: string | null; idp_mfa_satisfies: boolean }>('select issuer_url, client_id, client_secret_enc, allowed_email_domains, jit_provision, default_role, group_claim, idp_mfa_satisfies from kernel.sso_config where tenant_id = $1 and enabled = true', [s.tenant_id]);
    if (!c.rowCount) throw unauthorized('SSO is unavailable'); const cfg = c.rows[0]!;
    const oidc = await oidcConfig(svc, cfg.issuer_url, cfg.client_id, unsealedSecret(svc, s.tenant_id, cfg.client_secret_enc));
    const verifier = open(svc.kms.tenantKey(s.tenant_id), Buffer.from(s.pkce_verifier_enc, 'base64'), 'sso:pkce').toString('utf8');
    let tokens; try { tokens = await authorizationCodeGrant(oidc, new URL(svc.cfg.SSO_CALLBACK_URL + '?' + new URLSearchParams({ code: query.code, state: query.state }).toString()), { expectedState: query.state, expectedNonce: s.nonce, pkceCodeVerifier: verifier, idTokenExpected: true }); } catch { throw unauthorized('The identity provider response could not be verified'); }
    const idToken = (tokens as { id_token?: unknown }).id_token;
    let verifiedClaims: Record<string, unknown>;
    try {
      if (typeof idToken !== 'string') throw new Error('OIDC response did not contain an ID token');
      const jwksUri = oidc.serverMetadata().jwks_uri;
      if (!jwksUri) throw new Error('OIDC discovery did not provide JWKS');
      const jwksResponse = await guardedFetch(svc.cfg, new URL(jwksUri));
      if (!jwksResponse.ok) throw new Error('OIDC JWKS request failed');
      const jwks = await jwksResponse.json() as Parameters<typeof createLocalJWKSet>[0];
      const verified = await jwtVerify(idToken, createLocalJWKSet(jwks), { audience: cfg.client_id });
      verifiedClaims = verified.payload as Record<string, unknown>;
    } catch { throw unauthorized('The identity provider response could not be verified'); }
    const claims = verifiedClaims;
    const aud = claims?.aud;
    const audienceMatches = typeof aud === 'string' ? aud === cfg.client_id : Array.isArray(aud) && aud.includes(cfg.client_id);
    const expiresAt = typeof claims?.exp === 'number' ? claims.exp : 0;
    if (!claims || !sameIssuer(claims.iss, cfg.issuer_url) || !audienceMatches || expiresAt <= Math.floor(Date.now() / 1000)) throw unauthorized('The identity provider response could not be verified');
    const mail = claimString(claims.email)?.trim().toLowerCase();
    if (!mail || claims.email_verified !== true) throw unauthorized('A verified email is required');
    const domain = mail.split('@')[1] ?? ''; if (cfg.allowed_email_domains.length && !cfg.allowed_email_domains.includes(domain)) throw forbidden('That email domain is not allowed for this company');
    const groups = Array.isArray(claims[cfg.group_claim ?? 'groups']) ? (claims[cfg.group_claim ?? 'groups'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const amr = Array.isArray(claims.amr) ? claims.amr.filter((x): x is string => typeof x === 'string') : [];
    const idpMfa = cfg.idp_mfa_satisfies && amr.some((x) => ['mfa', 'otp', 'hwk', 'fido2'].includes(x.toLowerCase()));
    const mapped = await groupRoles(svc, s.tenant_id, groups); const existing = await svc.pools.auth.query<{ id: string; disabled: boolean; status: string; employee_id: string | null; display_name: string }>('select u.id, u.disabled, m.status, m.employee_id, u.display_name from kernel.user_account u join kernel.membership m on m.user_id = u.id where m.tenant_id = $1 and m.email = $2', [s.tenant_id, mail]);
    let userId: string; let employeeId: string | null;
    if (existing.rowCount) { const u = existing.rows[0]!; if (u.disabled || u.status !== 'active') throw forbidden('This account is suspended'); userId = u.id; employeeId = u.employee_id; }
    else { if (!cfg.jit_provision) throw forbidden('Your account is not provisioned for this company'); userId = (await svc.pools.auth.query<{ id: string }>('insert into kernel.user_account (email, password_hash, display_name, must_change_password) values ($1,$2,$3,false) returning id', [mail, await hashPassword(newToken(24)), claimString(claims.name) ?? mail])).rows[0]!.id; employeeId = null; await withTx(svc.pools.app, { tenantId: s.tenant_id, userId: null, employeeId: null }, async (db) => { await db.query('insert into kernel.membership (tenant_id, user_id, employee_id, email, display_name) values ($1,$2,$3,$4,$5)', [s.tenant_id, userId, null, mail, claimString(claims.name) ?? mail]); const selected = mapped.length ? mapped : [cfg.default_role]; for (const r of selected) if (r !== 'employee') { const a = await db.query<{ id: string }>('insert into kernel.role_assignment (tenant_id, user_id, role, granted_by) values ($1,$2,$3,null) returning id', [s.tenant_id, userId, r]); await db.query('insert into kernel.role_assignment_scope (tenant_id, assignment_id, scope_type) values ($1,$2,\'tenant\')', [s.tenant_id, a.rows[0]!.id]); } await db.query('select kernel.append_audit($1,null,$2,\'user\',$3,$4::jsonb,$5,$6)', [s.tenant_id, 'iam.sso_jit_provisioned', userId, JSON.stringify({ email: mail, groups }), req.ip, req.id]); }, ['iam']); }
    const session = await createPasskeySession(svc.pools, svc.cfg, userId, req.ip, req.headers['user-agent'], idpMfa); setPasskeyCookie(svc, req, reply, session.token, session.expiresAt);
    return { status: 302, headers: { location: s.redirect_path }, body: '' };
  }});
}
