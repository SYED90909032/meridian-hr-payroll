import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { addUser, as, mkPools, mkTenant, type TestTenant } from './helpers.js';
import type { Pools } from '../src/db/pool.js';
import { audit } from '../src/db/tx.js';

let pools: Pools;
let owner: pg.Pool;
let A: TestTenant, B: TestTenant;

beforeAll(async () => {
  pools = mkPools();
  owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER });
  A = await mkTenant(pools, 'a');
  B = await mkTenant(pools, 'b');
});
afterAll(async () => { await pools.end(); await owner.end(); });

const rejects = async (p: Promise<unknown>, re?: RegExp) => {
  let err: Error | undefined;
  try { await p; } catch (e) { err = e as Error; }
  expect(err, 'expected the statement to be rejected').toBeDefined();
  if (re) expect(err!.message).toMatch(re);
};

describe('catalog: every tenant table is walled', () => {
  it('has RLS enabled, a tenant_wall policy, and forced RLS (except the audit tables)', async () => {
    const r = await owner.query(`
      select c.oid::regclass::text as tbl, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
        exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'tenant_wall') as has_wall
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where c.relkind in ('r', 'p') and not c.relispartition
        and (has_table_privilege('meridian_app', c.oid, 'select') or has_table_privilege('meridian_app', c.oid, 'insert'))
        and n.nspname in ('kernel','people','flow','tm','pay','svc','plat','ai')`);
    expect(r.rows.length).toBeGreaterThan(40);
    const auditTables = new Set(['kernel.audit_event', 'kernel.audit_block', 'kernel.audit_head']);
    const problems = r.rows.filter((x) => {
      if (auditTables.has(x.tbl)) return !x.enabled;
      return !x.enabled || !x.forced || !x.has_wall;
    });
    // kernel.tenant has no tenant_id column (its id is the tenant) and is covered by its own policies.
    expect(problems.map((p) => p.tbl)).toEqual([]);
  });

  it('the app role has no BYPASSRLS and cannot own or create objects', async () => {
    const r = await owner.query(`select rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname like 'meridian_%'`);
    for (const row of r.rows) {
      expect(row.rolsuper, row.rolname).toBe(false);
      if (row.rolname !== 'meridian_owner') { expect(row.rolbypassrls, row.rolname).toBe(false); expect(row.rolcreatedb).toBe(false); expect(row.rolcreaterole).toBe(false); }
    }
    await rejects(pools.app.query('create table public.x (a int)'), /permission denied/);
    await rejects(pools.app.query('create table people.x (a int)'), /permission denied/);
  });
});

describe('tenant isolation', () => {
  it('sees nothing without a tenant context', async () => {
    const r = await pools.app.query('select count(*)::int as n from people.employee');
    expect(r.rows[0].n).toBe(0);
  });

  it('tenant A cannot read tenant B rows, and a guessed id returns nothing', async () => {
    const mine = await as(pools, A, { userId: A.userId, employeeId: A.employeeId }, (db) => db.query('select id, tenant_id from people.employee'));
    expect(mine.rows.every((x) => x.tenant_id === A.tenantId)).toBe(true);
    const peek = await as(pools, A, { userId: A.userId, employeeId: A.employeeId }, (db) => db.query('select id from people.employee where id = $1', [B.employeeId]));
    expect(peek.rowCount).toBe(0);
  });

  it('tenant A cannot write into tenant B, even naming B explicitly', async () => {
    await rejects(as(pools, A, { userId: A.userId, employeeId: A.employeeId }, (db) =>
      db.query(`insert into people.org_unit (tenant_id, code, name) values ($1, 'EVIL', 'x')`, [B.tenantId])), /row-level security/);
    const upd = await as(pools, A, { userId: A.userId, employeeId: A.employeeId }, (db) =>
      db.query(`update people.employee set job_title = 'pwned' where id = $1`, [B.employeeId]), ['hr']);
    expect(upd.rowCount).toBe(0);
  });

  it('context does not leak across pooled connections', async () => {
    await as(pools, A, { userId: A.userId, employeeId: A.employeeId }, (db) => db.query('select 1'));
    const c = await pools.app.connect();
    try {
      const r = await c.query(`select current_setting('app.tenant_id', true) as t, current_setting('app.system_actor', true) as s`);
      expect(r.rows[0].t ?? '').toBe('');
      expect(r.rows[0].s ?? '').toBe('');
    } finally { c.release(); }
  });

  it('role and membership writes need the iam system actor', async () => {
    await rejects(as(pools, A, { userId: A.userId, employeeId: A.employeeId }, (db) =>
      db.query(`insert into kernel.role_assignment (tenant_id, user_id, role) values ($1, $2, 'owner')`, [A.tenantId, A.userId])), /row-level security/);
    await rejects(as(pools, A, { userId: A.userId, employeeId: A.employeeId }, (db) =>
      db.query(`insert into kernel.tenant (id, name, slug, country, currency) values ($1, 'x', 'sneaky-tenant', 'AE', 'AED')`, [A.tenantId])), /row-level security|duplicate/);
  });

  it('the app role cannot read identity tables', async () => {
    await rejects(pools.app.query('select * from kernel.user_account'), /permission denied/);
    await rejects(pools.app.query('select * from kernel.session'), /permission denied/);
  });
});

describe('restricted data classes', () => {
  let hr: { userId: string; employeeId: string }, payroll: { userId: string; employeeId: string };
  let mgr: { userId: string; employeeId: string }, rep: { userId: string; employeeId: string }, other: { userId: string; employeeId: string };

  beforeAll(async () => {
    hr = await addUser(pools, A, { name: 'Hana', roles: [{ role: 'hr_admin' }] });
    payroll = await addUser(pools, A, { name: 'Pia', roles: [{ role: 'payroll_admin' }] });
    mgr = await addUser(pools, A, { name: 'Max', roles: [{ role: 'manager', scope: 'reports' }] });
    rep = await addUser(pools, A, { name: 'Rita', managerId: mgr.employeeId });
    other = await addUser(pools, A, { name: 'Omar' });
    for (const e of [rep, other]) {
      await as(pools, A, { userId: hr.userId, employeeId: hr.employeeId }, async (db) => {
        await db.query(`insert into people.compensation (tenant_id, employee_id, valid_during, basic_minor, currency) values ($1, $2, daterange('2026-01-01', null), 1000000, 'AED')`, [A.tenantId, e.employeeId]);
      });
      await as(pools, A, { userId: payroll.userId, employeeId: payroll.employeeId }, async (db) => {
        await db.query(`insert into people.employee_bank (tenant_id, employee_id, bank_name, routing_code, iban_enc, iban_bidx, iban_last4) values ($1, $2, 'Bank', '123456789', '\\x01', $3, '1234')`, [A.tenantId, e.employeeId, Buffer.from(randomUUID())]);
      });
    }
  });

  const count = (who: { userId: string; employeeId: string }, sql: string) =>
    as(pools, A, who, async (db) => (await db.query(sql)).rowCount);

  it('an employee reads their own compensation and bank, never a colleague\'s', async () => {
    expect(await count(rep, `select * from people.compensation where employee_id = '${rep.employeeId}'`)).toBe(1);
    expect(await count(rep, `select * from people.employee_bank where employee_id = '${rep.employeeId}'`)).toBe(1);
    expect(await count(rep, `select * from people.compensation where employee_id = '${other.employeeId}'`)).toBe(0);
    expect(await count(rep, `select * from people.employee_bank where employee_id = '${other.employeeId}'`)).toBe(0);
    expect(await count(other, `select * from people.compensation`)).toBe(1);
  });

  it('a manager sees direct reports\' team data but not their pay or bank', async () => {
    expect(await count(mgr, `select * from people.compensation`)).toBe(0);
    expect(await count(mgr, `select * from people.employee_bank`)).toBe(0);
    expect(await count(mgr, `select * from people.employee_private`)).toBe(0);
  });

  it('hr_admin reads compensation but not bank details', async () => {
    expect(await count(hr, `select * from people.compensation`)).toBe(2);
    expect(await count(hr, `select * from people.employee_bank`)).toBe(0);
  });

  it('payroll_admin reads bank and compensation', async () => {
    expect(await count(payroll, `select * from people.employee_bank`)).toBe(2);
    expect(await count(payroll, `select * from people.compensation`)).toBe(2);
  });

  it('an employee cannot raise their own pay, nor delete history', async () => {
    await rejects(as(pools, A, rep, (db) => db.query(`insert into people.compensation (tenant_id, employee_id, valid_during, basic_minor, currency) values ($1, $2, daterange('2027-01-01', null), 99999999, 'AED')`, [A.tenantId, rep.employeeId])), /row-level security/);
    const upd = await as(pools, A, rep, (db) => db.query(`update people.compensation set basic_minor = 99999999 where employee_id = $1`, [rep.employeeId]));
    expect(upd.rowCount).toBe(0);
    await rejects(as(pools, A, hr, (db) => db.query('delete from people.compensation')), /permission denied/);
  });

  it('overlapping active compensation periods are refused', async () => {
    await rejects(as(pools, A, hr, (db) => db.query(`insert into people.compensation (tenant_id, employee_id, valid_during, basic_minor, currency) values ($1, $2, daterange('2026-06-01', '2026-09-01'), 5, 'AED')`, [A.tenantId, rep.employeeId])), /exclusion|conflicting/);
  });

  it('only one active bank record per employee', async () => {
    await rejects(as(pools, A, payroll, (db) => db.query(`insert into people.employee_bank (tenant_id, employee_id, bank_name, routing_code, iban_enc, iban_bidx, iban_last4) values ($1, $2, 'B2', '123456789', '\\x01', $3, '9999')`, [A.tenantId, rep.employeeId, Buffer.from(randomUUID())])), /duplicate key/);
  });

  it('manager and org cycles are refused', async () => {
    await rejects(as(pools, A, hr, (db) => db.query('update people.employee set manager_id = $1 where id = $2', [rep.employeeId, mgr.employeeId]), ['hr']), /cycle/);
  });
});

describe('audit chain', () => {
  it('appends in order, verifies, and detects tampering and truncation', async () => {
    const T = await mkTenant(pools, 'aud');
    const ctx = { tenantId: T.tenantId, userId: T.userId, employeeId: T.employeeId };
    await as(pools, T, T, async (db) => {
      await audit(db, ctx, 'test.one', 'x', '1', { a: 1 });
      await audit(db, ctx, 'test.two', 'x', '2', { b: 2 });
      await audit(db, ctx, 'test.three', 'x', '3', { c: 3 });
    });
    const v = await as(pools, T, T, (db) => db.query('select kernel.verify_audit($1) as broken', [T.tenantId]));
    expect(v.rows[0].broken).toBeNull();

    // The app role cannot change or delete audit rows.
    await rejects(as(pools, T, T, (db) => db.query('update kernel.audit_event set action = $1', ['x'])), /permission denied/);
    await rejects(as(pools, T, T, (db) => db.query('delete from kernel.audit_event')), /permission denied/);
    // Even the table owner is stopped by triggers, unless someone deliberately disables them.
    await rejects(owner.query(`update kernel.audit_event set action = 'forged' where tenant_id = $1`, [T.tenantId]), /append-only/);

    // Deliberate tampering by a privileged actor is detected.
    const c = await owner.connect();
    try {
      await c.query('alter table kernel.audit_event disable trigger audit_event_no_update');
      await c.query(`update kernel.audit_event set data = '{"a": 999}' where tenant_id = $1 and action = 'test.two'`, [T.tenantId]);
      await c.query('alter table kernel.audit_event enable trigger audit_event_no_update');
    } finally { c.release(); }
    const v2 = await as(pools, T, T, (db) => db.query('select kernel.verify_audit($1) as broken', [T.tenantId]));
    expect(Number(v2.rows[0].broken)).toBeGreaterThan(0);
  });

  it('cannot write or verify another tenant\'s chain', async () => {
    await rejects(as(pools, A, A, (db) => db.query(`select kernel.append_audit($1, null, 'x', null, null, '{}'::jsonb, null, null)`, [B.tenantId])), /does not match/);
    await rejects(as(pools, A, A, (db) => db.query(`select kernel.verify_audit($1)`, [B.tenantId])), /mismatch/);
  });

  it('only roles with the audit class can read the log', async () => {
    const emp = await addUser(pools, A, { name: 'Eve' });
    const aud = await addUser(pools, A, { name: 'Ada', roles: [{ role: 'auditor' }] });
    expect((await as(pools, A, emp, (db) => db.query('select * from kernel.audit_event'))).rowCount).toBe(0);
    expect((await as(pools, A, aud, (db) => db.query('select * from kernel.audit_event'))).rowCount).toBeGreaterThan(0);
  });
});

describe('pay run state machine', () => {
  let prep: { userId: string; employeeId: string }, appr: { userId: string; employeeId: string };
  const packId = 'test-pack-' + randomUUID().slice(0, 6);
  const run = async (mode: 'sandbox' | 'live', tweak?: (db: pg.PoolClient, runId: string) => Promise<void>) => {
    const T = A;
    const id = randomUUID();
    const who = prep;
    await as(pools, T, who, async (db) => {
      const g = await db.query<{ id: string }>(`insert into pay.pay_group (tenant_id, name, country, currency, pack_id) values ($1, 'G', 'AE', 'AED', $2) returning id`, [T.tenantId, packId]);
      await db.query(`insert into pay.pay_run (id, tenant_id, pay_group_id, period_start, period_end, mode, pack_id, pack_version, pack_hash, prepared_by)
        values ($1, $2, $3, '2026-10-01', '2026-10-31', $4, $5, '1', 'hash1', $6)`, [id, T.tenantId, g.rows[0]!.id, mode, packId, who.userId]);
      if (tweak) await tweak(db, id);
    });
    return id;
  };
  const move = (runId: string, to: string, who = prep, extra = '') =>
    as(pools, A, who, (db) => db.query(`update pay.pay_run set status = $2 ${extra} where id = $1`, [runId, to]), ['payroll']);

  beforeAll(async () => {
    prep = await addUser(pools, A, { name: 'Preparer', roles: [{ role: 'payroll_admin' }] });
    appr = await addUser(pools, A, { name: 'Approver', roles: [{ role: 'payroll_approver' }] });
  });

  it('refuses skipped and backwards transitions', async () => {
    const id = await run('sandbox');
    await rejects(move(id, 'approved'), /cannot move from draft to approved/);
    await rejects(move(id, 'finalised'), /cannot move/);
    await move(id, 'inputs_locked');
    await rejects(move(id, 'paid'), /cannot move/);
  });

  it('allows one active run per group, period and scope but not a duplicate', async () => {
    const id = await run('sandbox');
    await rejects(as(pools, A, prep, async (db) => {
      const g = await db.query(`select pay_group_id from pay.pay_run where id = $1`, [id]);
      await db.query(`insert into pay.pay_run (tenant_id, pay_group_id, period_start, period_end, mode, pack_id, pack_version, prepared_by) values ($1, $2, '2026-10-01', '2026-10-31', 'sandbox', $3, '1', $4)`, [A.tenantId, g.rows[0].pay_group_id, packId, prep.userId]);
    }), /duplicate key|unique/);
  });

  it('approval must match the result hash and come from someone other than the preparer', async () => {
    const id = await run('sandbox');
    await move(id, 'inputs_locked'); await move(id, 'calculated', prep, `, result_set_hash = 'rs1'`); await move(id, 'in_review');
    await rejects(move(id, 'approved'), /approval bound to the current result set/);
    // preparer approving their own run
    await rejects(as(pools, A, prep, (db) => db.query(`insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, step_up_at) values ($1, $2, 'approve', $3, 'rs1', now())`, [A.tenantId, id, prep.userId]), ['payroll']), /differ from the preparer/);
    // stale step-up
    await rejects(as(pools, A, appr, (db) => db.query(`insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, step_up_at) values ($1, $2, 'approve', $3, 'rs1', now() - interval '1 hour')`, [A.tenantId, id, appr.userId]), ['payroll']), /step-up/);
    // approval for a different hash does not count
    await as(pools, A, appr, (db) => db.query(`insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, step_up_at) values ($1, $2, 'approve', $3, 'WRONG', now())`, [A.tenantId, id, appr.userId]), ['payroll']);
    await rejects(move(id, 'approved'), /approval bound/);
    await as(pools, A, appr, (db) => db.query(`insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, step_up_at) values ($1, $2, 'approve', $3, 'rs1', now())`, [A.tenantId, id, appr.userId]), ['payroll']);
    await move(id, 'approved'); await move(id, 'finalised');
    // sandbox runs can be published but never released for payment
    await rejects(move(id, 'payment_released'), /only live pay runs/);
    await move(id, 'published');
  });

  it('reopening voids approvals; a finalised run and its results are immutable', async () => {
    const id = await run('sandbox');
    await move(id, 'inputs_locked'); await move(id, 'calculated', prep, `, result_set_hash = 'rs2'`); await move(id, 'in_review');
    await as(pools, A, appr, (db) => db.query(`insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, step_up_at) values ($1, $2, 'approve', $3, 'rs2', now())`, [A.tenantId, id, appr.userId]), ['payroll']);
    await move(id, 'inputs_locked');
    const v = await as(pools, A, prep, (db) => db.query(`select count(*)::int n from pay.pay_run_approval where pay_run_id = $1 and voided_at is null`, [id]), ['payroll']);
    expect(v.rows[0].n).toBe(0);
    await rejects(move(id, 'approved'), /cannot move/);
  });

  it('live payment is blocked below assurance L2 and above needs a matching bank file and release approval', async () => {
    const id = await run('live');
    await move(id, 'inputs_locked'); await move(id, 'calculated', prep, `, result_set_hash = 'rs3'`); await move(id, 'in_review');
    await as(pools, A, appr, (db) => db.query(`insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, step_up_at) values ($1, $2, 'approve', $3, 'rs3', now())`, [A.tenantId, id, appr.userId]), ['payroll']);
    await move(id, 'approved'); await move(id, 'finalised');
    await rejects(move(id, 'published'), /only after payment/);
    await rejects(move(id, 'payment_released', prep, `, bank_file_hash = 'bf1'`), /assurance L2 or L3 \(found none\)/);
    await owner.query(`insert into pay.pack_registry (pack_id, version, pack_hash, assurance) values ($1, '1', 'hash1', 'L0')`, [packId]);
    await rejects(move(id, 'payment_released', prep, `, bank_file_hash = 'bf1'`), /found L0/);
    await rejects(owner.query(`update pay.pack_registry set assurance = 'L2' where pack_id = $1`, [packId]), /named reviewer/);
    await owner.query(`update pay.pack_registry set assurance = 'L2', reviewer = 'Test Reviewer', reviewed_at = now() where pack_id = $1`, [packId]);
    await rejects(move(id, 'payment_released', prep, `, bank_file_hash = 'bf1'`), /bank file hash does not match/);
    await as(pools, A, prep, (db) => db.query(`insert into pay.payment_file (tenant_id, pay_run_id, format, content, content_hash) values ($1, $2, 'wps_sif', 'x', 'bf1')`, [A.tenantId, id]), ['payroll']);
    await rejects(move(id, 'payment_released', prep, `, bank_file_hash = 'bf1'`), /release approval/);
    await as(pools, A, appr, (db) => db.query(`insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, bank_file_hash, step_up_at) values ($1, $2, 'release', $3, 'rs3', 'bf1', now())`, [A.tenantId, id, appr.userId]), ['payroll']);
    await move(id, 'payment_released', prep, `, bank_file_hash = 'bf1'`);
    await rejects(as(pools, A, prep, (db) => db.query(`update pay.payment_file set content = 'y' where pay_run_id = $1`, [id]), ['payroll']), /immutable/);
    await rejects(as(pools, A, prep, (db) => db.query(`update pay.pay_run set result_set_hash = 'tamper' where id = $1`, [id]), ['payroll']), /immutable/);
  });

  it('single-admin exception allows self-approval but flags it and imposes a 24 hour delay', async () => {
    const solo = await mkTenant(pools, 'solo');
    const who = { userId: solo.userId, employeeId: solo.employeeId };
    const sid = randomUUID();
    await as(pools, solo, who, async (db) => {
      await db.query(`insert into pay.payroll_policy_exception (tenant_id, kind, second_contact_email, created_by) values ($1, 'single_admin', 'x@example.test', $2)`, [solo.tenantId, solo.userId]);
      const g = await db.query<{ id: string }>(`insert into pay.pay_group (tenant_id, name, country, currency, pack_id) values ($1, 'G', 'AE', 'AED', 'p') returning id`, [solo.tenantId]);
      await db.query(`insert into pay.pay_run (id, tenant_id, pay_group_id, period_start, period_end, mode, pack_id, pack_version, pack_hash, prepared_by) values ($1, $2, $3, '2026-10-01', '2026-10-31', 'live', 'p', '1', 'h', $4)`, [sid, solo.tenantId, g.rows[0]!.id, solo.userId]);
      await db.query(`insert into pay.pay_run_approval (tenant_id, pay_run_id, kind, approver_id, result_set_hash, step_up_at) values ($1, $2, 'approve', $3, 'r', now())`, [solo.tenantId, sid, solo.userId]);
    }, ['payroll']);
    const r = await as(pools, solo, who, (db) => db.query('select flagged_self_approval, release_not_before from pay.pay_run_approval where pay_run_id = $1', [sid]), ['payroll']);
    expect(r.rows[0].flagged_self_approval).toBe(true);
    expect(new Date(r.rows[0].release_not_before).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
  });
});

describe('worker role', () => {
  it('can claim and finish outbox rows through functions only', async () => {
    await pools.app.query('select 1');
    await as(pools, A, A, (db) => db.query(`insert into kernel.outbox (tenant_id, topic, payload) values ($1, 'test.topic', '{}')`, [A.tenantId]));
    await rejects(pools.worker.query('select * from kernel.outbox'), /permission denied/);
    const c = await pools.worker.query('select * from kernel.claim_outbox(10, 30)');
    expect(c.rows.length).toBeGreaterThan(0);
    for (const row of c.rows) await pools.worker.query('select kernel.finish_outbox($1, true, null, 0)', [row.id]);
    const again = await pools.worker.query('select * from kernel.claim_outbox(10, 30)');
    expect(again.rows.filter((r) => r.topic === 'test.topic' && r.tenant_id === A.tenantId).length).toBe(0);
  });
});
