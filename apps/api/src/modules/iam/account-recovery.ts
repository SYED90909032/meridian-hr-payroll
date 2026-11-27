import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Db } from '../../db/tx.js';
import { newToken, sha256 } from '../../crypto/tokens.js';
import { sealDeliveryToken } from '../platform/delivery.js';
import type { Kms } from '../../crypto/kms.js';

export type AccountTokenPurpose = 'invitation' | 'password_reset';
export interface IssuedAccountToken { id: string; raw: string; hash: Buffer; expiresAt: Date }
export interface AccountTokenRecord { id: string; userId: string; tenantId: string | null }
export async function issueAccountToken(auth: Pool, userId: string, tenantId: string | null, purpose: AccountTokenPurpose, ttlMs: number): Promise<IssuedAccountToken> {
  await auth.query('update kernel.account_token set used_at = now() where user_id = $1 and purpose = $2 and used_at is null', [userId, purpose]);
  const raw = newToken(); const hash = sha256(raw); const expiresAt = new Date(Date.now() + ttlMs);
  const r = await auth.query<{ id: string }>('insert into kernel.account_token (tenant_id, user_id, purpose, token_hash, expires_at) values ($1, $2, $3, $4, $5) returning id', [tenantId, userId, purpose, hash, expiresAt]);
  return { id: r.rows[0]!.id, raw, hash, expiresAt };
}
/** Look up a live token without consuming it so password validation cannot be used to burn it. */
export async function findAccountToken(auth: Pool, raw: string, purpose: AccountTokenPurpose): Promise<AccountTokenRecord | null> {
  const r = await auth.query<{ id: string; user_id: string; tenant_id: string | null }>(
    'select id, user_id, tenant_id from kernel.account_token where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()', [sha256(raw), purpose]);
  const row = r.rows[0];
  return row ? { id: row.id, userId: row.user_id, tenantId: row.tenant_id } : null;
}
/** Atomically marks a live token used; concurrent requests can only win once. */
export async function consumeAccountToken(auth: Pool, raw: string, purpose: AccountTokenPurpose): Promise<AccountTokenRecord> {
  const r = await auth.query<{ id: string; user_id: string; tenant_id: string | null }>(
    `update kernel.account_token set used_at = now() where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now() returning id, user_id, tenant_id`, [sha256(raw), purpose]);
  if (!r.rowCount) throw new Error('token_invalid');
  return { id: r.rows[0]!.id, userId: r.rows[0]!.user_id, tenantId: r.rows[0]!.tenant_id };
}
export async function enqueueAccountEmail(db: Db, kms: Kms, tenantId: string, outboxKey: string, to: string, recipientName: string, template: string, link: string, rawToken?: string): Promise<void> {
  const tokenEnc = rawToken ? sealDeliveryToken(kms, tenantId, rawToken) : undefined;
  const payload = { to, recipientName, template, link, ...(tokenEnc ? { tokenEnc } : {}) };
  await db.query('insert into kernel.outbox (tenant_id, topic, payload, dedupe_key) values ($1, $2, $3::jsonb, $4) on conflict do nothing', [tenantId, 'email.send', JSON.stringify(payload), outboxKey]);
}
export function accountDeepLink(kind: 'invite' | 'reset'): string { return kind === 'invite' ? '/accept-invitation?token={token}' : '/reset-password?token={token}'; }
export function randomDisabledHash(): string { return `disabled$${randomUUID()}`; }
