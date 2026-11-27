import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { boot, actor, type Booted } from './api-helpers.js';
import { payWorld } from './pay-fixtures.js';
import { as, cfg, mkTenant, type TestTenant } from './helpers.js';
import { withTx } from '../src/db/tx.js';
import type { PayWorld } from './pay-fixtures.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Phase 7 concurrency verification', () => {
  let b: Booted;

  beforeAll(async () => { b = await boot(); });
  afterAll(async () => { await b.close(); });

  it('delivers 200 outbox rows exactly once across workers, including lease expiry after a killed batch', async () => {
    const tenant = await mkTenant(b.pools, 'outbox-concurrency');
    const workerUrl = cfg().DATABASE_URL_WORKER;
    const workerA = new pg.Pool({ connectionString: workerUrl, max: 1 });
    const workerB = new pg.Pool({ connectionString: workerUrl, max: 1 });
    const workerC = new pg.Pool({ connectionString: workerUrl, max: 1 });
    const delivered = new Set<string>();
    const providerCalls: string[] = [];
    try {
      // kernel.claim_outbox is deliberately global (a worker serves every tenant), so rows left
      // over by earlier test files would be claimed here and skew the counts. The suite runs
      // files serially, so draining the queue first gives this test a known-empty outbox.
      for (;;) {
        const leftovers = (await workerA.query<{ id: string }>('select id from kernel.claim_outbox(100, 60)')).rows;
        if (!leftovers.length) break;
        for (const row of leftovers) await workerA.query('select kernel.finish_outbox($1, true, null, 0)', [row.id]);
      }
      await withTx(b.pools.app, { tenantId: tenant.tenantId, userId: tenant.userId, employeeId: tenant.employeeId }, async (db) => {
        for (let i = 0; i < 200; i++) {
          await db.query(
            `insert into kernel.outbox (tenant_id, topic, payload, dedupe_key) values ($1, 'phase7.test-mail', $2::jsonb, $3)`,
            [tenant.tenantId, JSON.stringify({ sequence: i }), `phase7-${i}`],
          );
        }
      });

      const claim = async (pool: pg.Pool, batch: number, leaseSeconds: number) =>
        (await pool.query<{ id: string }>('select id from kernel.claim_outbox($1, $2)', [batch, leaseSeconds])).rows;
      const finish = async (pool: pg.Pool, id: string) => { await pool.query('select kernel.finish_outbox($1, true, null, 0)', [id]); };
      const sendExactlyOnce = async (id: string) => {
        // This stand-in models the provider contract used by the outbox: the outbox id
        // is the provider idempotency key, so a retry after a worker crash is harmless.
        providerCalls.push(id);
        delivered.add(id);
      };

      const first = await claim(workerA, 100, 1);
      expect(first).toHaveLength(100);
      for (const [index, row] of first.entries()) {
        await sendExactlyOnce(row.id);
        if (index < 40) await finish(workerA, row.id);
        // The simulated worker is killed after 40 completed rows. The remaining 60
        // have an active lease and are intentionally left for the expiry/retry path.
      }
      await delay(1_150);

      const drain = async (pool: pg.Pool) => {
        for (;;) {
          const rows = await claim(pool, 25, 60);
          if (!rows.length) return;
          for (const row of rows) {
            await sendExactlyOnce(row.id);
            await finish(pool, row.id);
          }
        }
      };
      await Promise.all([drain(workerB), drain(workerC)]);

      const state = await as(b.pools, tenant, tenant, async (db) => ({
        remaining: (await db.query<{ id: string }>(`select id from kernel.outbox where tenant_id = $1 and processed_at is null`, [tenant.tenantId])).rows,
        processed: (await db.query<{ count: string }>(`select count(*)::text as count from kernel.outbox where tenant_id = $1 and topic = 'phase7.test-mail' and processed_at is not null`, [tenant.tenantId])).rows[0]!.count,
      }));
      expect(state.remaining).toHaveLength(0);
      expect(Number(state.processed)).toBe(200);
      expect(delivered).toHaveLength(200);
      // The retry path really ran: at least the 60 rows in the abandoned lease were
      // presented to the provider twice, while the provider accepted each key once.
      expect(providerCalls.length).toBeGreaterThan(200);
      expect(new Set(providerCalls).size).toBe(200);
    } finally {
      await Promise.all([workerA.end(), workerB.end(), workerC.end()]);
    }
  }, 30_000);

  it('creates exactly one active pay run for ten simultaneous starts', async () => {
    const world: PayWorld = await payWorld(b, 'pay-start-concurrency', 0);
    const body = { payGroupId: world.groupId, periodStart: '2026-02-01', periodEnd: '2026-02-28', mode: 'sandbox' as const };
    const responses = await Promise.all(Array.from({ length: 10 }, () => world.preparer.client.post('/api/v1/pay/runs', body)));
    const created = responses.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(9);
    expect(responses.every((r) => r.status !== 500)).toBe(true);
    const count = await as(b.pools, world.t, world.preparer, async (db) =>
      (await db.query<{ count: string }>(`select count(*)::text as count from pay.pay_run where pay_group_id = $1 and period_start = $2::date and period_end = $3::date and status not in ('cancelled', 'reversed')`, [world.groupId, body.periodStart, body.periodEnd])).rows[0]!.count,
    );
    expect(Number(count)).toBe(1);
  }, 30_000);

  it('applies one side effect for ten concurrent idempotent requests and rejects body reuse', async () => {
    const tenant: TestTenant = await mkTenant(b.pools, 'idempotency-concurrency');
    const hr = await actor(b, tenant, 'ConcurrentHr', [{ role: 'hr_admin' }]);
    const key = `phase7-idem-${Date.now()}`;
    const body = { firstName: 'Concurrent', lastName: 'Employee', hireDate: '2026-02-01' };
    const responses = await Promise.all(Array.from({ length: 10 }, () => hr.client.post('/api/v1/people/employees', body, { 'idempotency-key': key })));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(new Set(responses.map((r) => JSON.stringify(r.body))).size).toBe(1);
    const employeeId = responses[0]!.body.id as string;
    const count = await as(b.pools, tenant, hr, async (db) =>
      (await db.query<{ count: string }>('select count(*)::text as count from people.employee where id = $1', [employeeId])).rows[0]!.count,
    );
    expect(Number(count)).toBe(1);
    const changed = await hr.client.post('/api/v1/people/employees', { ...body, firstName: 'Changed' }, { 'idempotency-key': key });
    expect([409, 422]).toContain(changed.status);
    expect(changed.body.error.code).toBe('idempotency_key_reuse');
  }, 30_000);
});
