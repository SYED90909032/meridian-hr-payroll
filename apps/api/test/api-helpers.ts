import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/crypto/password.js';
import { Client } from '../src/testing/client.js';
import { randomUUID } from 'node:crypto';
import { withTx } from '../src/db/tx.js';
import { addUser, cfg, mkPools, mkTenant, type TestTenant } from './helpers.js';
import type { Pools } from '../src/db/pool.js';

export const PW = 'correct horse battery staple 42';
export interface Booted { app: FastifyInstance; pools: Pools; close(): Promise<void> }
export async function boot(): Promise<Booted> {
  const pools = mkPools();
  const { app } = await buildApp(cfg(), pools);
  await app.ready();
  return { app, pools, close: async () => { await app.close(); await pools.end(); } };
}
export interface Actor { client: Client; userId: string; employeeId: string; email: string }
type RoleSpec = { role: string; scope?: 'tenant' | 'reports' | 'org_unit'; orgUnitId?: string };
/** Creates a user with a real password, signs in over HTTP, and (optionally) enrols two-step verification. */
export async function actor(b: Booted, t: TestTenant, name: string, roles: RoleSpec[] = [], opts: { mfa?: boolean; managerId?: string } = {}): Promise<Actor> {
  const u = await addUser(b.pools, t, { name, roles, managerId: opts.managerId });
  const row = await b.pools.auth.query<{ email: string }>('select email::text as email from kernel.user_account where id = $1', [u.userId]);
  const email = row.rows[0]!.email;
  await b.pools.auth.query('update kernel.user_account set password_hash = $2 where id = $1', [u.userId, await hashPassword(PW)]);
  const client = new Client(b.app);
  const l = await client.login(email, PW);
  if (l.status !== 200) throw new Error('login failed: ' + JSON.stringify(l.body));
  if (opts.mfa) await client.enrolMfa(PW);
  return { client, userId: u.userId, employeeId: u.employeeId, email };
}
/** The owner created by registration, signed in. */
export async function ownerOf(b: Booted, t: TestTenant, mfa = true): Promise<Actor> {
  await b.pools.auth.query('update kernel.user_account set password_hash = $2 where id = $1', [t.userId, await hashPassword(PW)]);
  const client = new Client(b.app);
  const l = await client.login(t.email, PW);
  if (l.status !== 200) throw new Error('owner login failed: ' + JSON.stringify(l.body));
  if (mfa) await client.enrolMfa(PW);
  return { client, userId: t.userId, employeeId: t.employeeId!, email: t.email };
}
/** TOTP replay protection would block a second code in the same 30 second step. Tests that need more codes reset the counter. */
export async function freshTotp(b: Booted, a: Actor): Promise<string> {
  await b.pools.auth.query('update kernel.user_account set totp_last_counter = 0 where id = $1', [a.userId]);
  return a.client.code();
}
export async function stepUp(b: Booted, a: Actor, withTotp = true): Promise<void> {
  const r = await a.client.stepUp(PW, withTotp && a.client.totpSecret ? await freshTotp(b, a) : undefined);
  if (r.status !== 200) throw new Error('step-up failed: ' + JSON.stringify(r.body));
}
export { mkTenant };

/** Gives an existing employee record a login (no roles). */
export async function loginForEmployee(b: Booted, t: TestTenant, employeeId: string, name: string): Promise<Actor> {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`;
  const u = await b.pools.auth.query<{ id: string }>('insert into kernel.user_account (email, password_hash, display_name) values ($1, $2, $3) returning id', [email, await hashPassword(PW), name]);
  const userId = u.rows[0]!.id;
  await withTx(b.pools.app, { tenantId: t.tenantId, userId: t.userId, employeeId: t.employeeId }, async (db) => {
    await db.query('insert into kernel.membership (tenant_id, user_id, employee_id, email, display_name) values ($1, $2, $3, $4, $5)', [t.tenantId, userId, employeeId, email, name]);
  }, ['iam', 'hr']);
  const client = new Client(b.app);
  const l = await client.login(email, PW);
  if (l.status !== 200) throw new Error('login failed: ' + JSON.stringify(l.body));
  return { client, userId, employeeId, email };
}
