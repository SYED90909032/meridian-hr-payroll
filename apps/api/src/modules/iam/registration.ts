import { randomUUID } from 'node:crypto';
import type { Pools } from '../../db/pool.js';
import { audit, withTx } from '../../db/tx.js';
import { hashPassword, passwordProblem } from '../../crypto/password.js';
import { badRequest, conflict } from '../../errors.js';

export interface RegisterInput {
  companyName: string; slug: string; country: string; currency: string;
  email: string; displayName: string; password: string;
}
export interface Registered { tenantId: string; userId: string; employeeId: string }

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;

/**
 * Creates a user (auth pool), then the tenant and its first owner (app pool, inside the new tenant's context).
 * If the second step fails the user is removed again, so a half-created account never remains.
 */
export async function registerTenant(pools: Pools, input: RegisterInput, meta: { ip?: string; requestId?: string } = {}): Promise<Registered> {
  const email = input.email.trim().toLowerCase();
  if (!SLUG.test(input.slug)) throw badRequest('Company URL name may use lowercase letters, digits and hyphens only');
  const problem = passwordProblem(input.password, email);
  if (problem) throw badRequest(problem);

  const exists = await pools.auth.query('select 1 from kernel.user_account where email = $1', [email]);
  if (exists.rowCount) throw conflict('An account with this email already exists', 'email_taken');
  const slugTaken = await pools.auth.query('select 1 from kernel.tenant where slug = $1', [input.slug]);
  if (slugTaken.rowCount) throw conflict('That company URL name is taken', 'slug_taken');

  const hash = await hashPassword(input.password);
  const userRow = await pools.auth.query<{ id: string }>(
    'insert into kernel.user_account (email, password_hash, display_name) values ($1, $2, $3) returning id', [email, hash, input.displayName.trim()]);
  const userId = userRow.rows[0]!.id;
  const tenantId = randomUUID();
  const employeeId = randomUUID();
  const ctx = { tenantId, userId, employeeId, ip: meta.ip, requestId: meta.requestId };

  try {
    await withTx(pools.app, ctx, async (db) => {
      await db.query('insert into kernel.tenant (id, name, slug, country, currency) values ($1, $2, $3, $4, $5)',
        [tenantId, input.companyName.trim(), input.slug, input.country.toUpperCase(), input.currency.toUpperCase()]);
      const org = await db.query<{ id: string }>(`insert into people.org_unit (tenant_id, code, name) values ($1, 'ROOT', $2) returning id`, [tenantId, input.companyName.trim()]);
      const [first, ...rest] = input.displayName.trim().split(/\s+/);
      await db.query(
        `insert into people.employee (id, tenant_id, employee_no, first_name, last_name, work_email, org_unit_id, job_title, hire_date)
         values ($1, $2, 'E0001', $3, $4, $5, $6, 'Owner', current_date)`,
        [employeeId, tenantId, first ?? 'Owner', rest.join(' ') || '-', email, org.rows[0]!.id]);
      await db.query('insert into kernel.membership (tenant_id, user_id, employee_id, email, display_name) values ($1, $2, $3, $4, $5)',
        [tenantId, userId, employeeId, email, input.displayName.trim()]);
      const ra = await db.query<{ id: string }>(`insert into kernel.role_assignment (tenant_id, user_id, role, granted_by) values ($1, $2, 'owner', $2) returning id`, [tenantId, userId]);
      await db.query(`insert into kernel.role_assignment_scope (tenant_id, assignment_id, scope_type, is_primary) values ($1, $2, 'tenant', true)`, [tenantId, ra.rows[0]!.id]);
      // Default leave types.
      await db.query(
        `insert into tm.leave_type (tenant_id, code, name, paid, annual_days_x1000, special) values
           ($1, 'ANNUAL', 'Annual leave', true, 30000, false),
           ($1, 'SICK', 'Sick leave', true, 90000, false),
           ($1, 'UNPAID', 'Unpaid leave', false, 0, false),
           ($1, 'COMPASSIONATE', 'Compassionate leave', true, 5000, true)`, [tenantId]);
      await audit(db, ctx, 'tenant.registered', 'tenant', tenantId, { slug: input.slug });
    }, ['register', 'iam', 'hr']);
  } catch (e) {
    await pools.auth.query('delete from kernel.user_account where id = $1', [userId]).catch(() => undefined);
    throw e;
  }
  return { tenantId, userId, employeeId };
}
