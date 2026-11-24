import { randomUUID } from 'node:crypto';
import { createPools, type Pools } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { registerTenant, type Registered } from '../src/modules/iam/registration.js';
import { withTx, type Db } from '../src/db/tx.js';

export const cfg = () => loadConfig(process.env);
export const mkPools = (): Pools => createPools(cfg());

export interface TestTenant extends Registered { slug: string; email: string }

export async function mkTenant(pools: Pools, label = 't'): Promise<TestTenant> {
  const id = randomUUID().slice(0, 8);
  const slug = `${label}-${id}`;
  const email = `owner-${id}@example.test`;
  const r = await registerTenant(pools, { companyName: `Co ${id}`, slug, country: 'AE', currency: 'AED', email, displayName: `Owner ${id}`, password: 'correct horse battery staple 42' });
  return { ...r, slug, email };
}

/** Adds a user with a membership, optional employee, and roles. Uses the same system actors the IAM service does. */
export async function addUser(pools: Pools, t: TestTenant, opts: { name: string; roles?: Array<{ role: string; scope?: 'tenant' | 'reports' | 'org_unit'; orgUnitId?: string }>; managerId?: string; orgUnitId?: string }): Promise<{ userId: string; employeeId: string }> {
  const id = randomUUID().slice(0, 8);
  const email = `${opts.name.toLowerCase()}-${id}@example.test`;
  const u = await pools.auth.query<{ id: string }>('insert into kernel.user_account (email, password_hash, display_name) values ($1, $2, $3) returning id', [email, 'x', opts.name]);
  const userId = u.rows[0]!.id;
  const employeeId = randomUUID();
  await withTx(pools.app, { tenantId: t.tenantId, userId: t.userId, employeeId: t.employeeId }, async (db) => {
    const org = opts.orgUnitId ?? (await db.query<{ id: string }>(`select id from people.org_unit where code = 'ROOT'`)).rows[0]!.id;
    await db.query(`insert into people.employee (id, tenant_id, employee_no, first_name, last_name, work_email, org_unit_id, manager_id, hire_date)
      values ($1, $2, $3, $4, 'Test', $5, $6, $7, current_date)`, [employeeId, t.tenantId, 'N' + id, opts.name, email, org, opts.managerId ?? null]);
    await db.query('insert into kernel.membership (tenant_id, user_id, employee_id, email, display_name) values ($1, $2, $3, $4, $5)', [t.tenantId, userId, employeeId, email, opts.name]);
    for (const r of opts.roles ?? []) {
      const ra = await db.query<{ id: string }>('insert into kernel.role_assignment (tenant_id, user_id, role, granted_by) values ($1, $2, $3, $4) returning id', [t.tenantId, userId, r.role, t.userId]);
      await db.query('insert into kernel.role_assignment_scope (tenant_id, assignment_id, scope_type, org_unit_id) values ($1, $2, $3, $4)', [t.tenantId, ra.rows[0]!.id, r.scope ?? 'tenant', r.scope === 'org_unit' ? r.orgUnitId : null]);
    }
  }, ['iam', 'hr']);
  return { userId, employeeId };
}

export const as = <T>(pools: Pools, t: { tenantId: string }, who: { userId: string; employeeId: string | null }, fn: (db: Db) => Promise<T>, actors: Parameters<typeof withTx>[3] = []) =>
  withTx(pools.app, { tenantId: t.tenantId, userId: who.userId, employeeId: who.employeeId }, fn, actors);
