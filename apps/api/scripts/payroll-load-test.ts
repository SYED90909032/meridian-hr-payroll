import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { loadDotEnv } from '../src/env.js';
import type { Booted } from '../test/api-helpers.js';

loadDotEnv();
// The repository's testenv intentionally uses TEST_DATABASE_URL_* names. Map only
// those names for this explicit load-test process; never fall back to meridian.
for (const kind of ['OWNER', 'APP', 'AUTH', 'WORKER'] as const) {
  const key = `DATABASE_URL_${kind}` as keyof NodeJS.ProcessEnv;
  const testKey = `TEST_DATABASE_URL_${kind}` as keyof NodeJS.ProcessEnv;
  if (process.env[testKey]) process.env[key] = process.env[testKey];
}
process.env.NODE_ENV = 'test';
process.env.PORT = '49001';
process.env.OBJECT_STORE = 'local';
const objectDir = await mkdtemp(join(tmpdir(), 'meridian-payroll-load-'));
process.env.OBJECT_STORE_DIR = objectDir;

const { loadConfig } = await import('../src/config.js');
const { createPools } = await import('../src/db/pool.js');
const { buildApp } = await import('../src/app.js');
const { registerTenant } = await import('../src/modules/iam/registration.js');
const { actor, stepUp } = await import('../test/api-helpers.js');
const { as } = await import('../test/helpers.js');

const cfg = loadConfig(process.env);
const pools = createPools(cfg);
const { app } = await buildApp(cfg, pools);
await app.ready();
const runtime: Booted = { app, pools, close: async () => { await app.close(); await pools.end(); } };
const password = 'load test passphrase with enough length 42';
const label = `load-${Date.now()}-${randomUUID().slice(0, 8)}`;
const tenant = { ...await registerTenant(pools, {
  companyName: `Payroll load ${label}`,
  slug: label.slice(0, 40),
  country: 'AE', currency: 'AED',
  email: `${label}@example.test`, displayName: 'Load Owner', password,
}), slug: label.slice(0, 40), email: `${label}@example.test` };
const hr = await actor(runtime, tenant, 'LoadHr', [{ role: 'hr_admin' }]);
const preparer = await actor(runtime, tenant, 'LoadPreparer', [{ role: 'payroll_admin' }]);
const approver = await actor(runtime, tenant, 'LoadApprover', [{ role: 'payroll_approver' }], { mfa: true });

const seedStart = performance.now();
const seed = await as(pools, tenant, hr, async (db) => {
  await db.query(`update people.employee set hire_date = '2025-01-01' where tenant_id = $1`, [tenant.tenantId]);
  await db.query(`update people.employee set status = 'terminated', termination_date = '2025-01-31' where id = $1`, [approver.employeeId]);
  await db.query(`
    insert into people.employee (id, tenant_id, employee_no, first_name, last_name, work_email, org_unit_id, job_title, hire_date)
    select gen_random_uuid(), $1, 'L' || lpad(g.i::text, 4, '0'), 'Synthetic', 'Employee ' || g.i,
           'load-' || g.i || '@example.test', ou.id, 'Synthetic', '2025-01-01'
      from generate_series(1, greatest(0, 1001 - (select count(*) from people.employee where tenant_id = $1))::int) g(i)
      cross join lateral (select id from people.org_unit where tenant_id = $1 and code = 'ROOT' limit 1) ou`, [tenant.tenantId]);
  await db.query(`
    insert into people.compensation (tenant_id, employee_id, valid_during, basic_minor, housing_minor, transport_minor, other_minor, currency, reason, recorded_by)
    select $1, e.id, daterange('2025-01-01', null, '[)'), 800000, 200000, 50000, 0, 'AED', 'Phase 7 synthetic load seed', $2
      from people.employee e
     where e.tenant_id = $1 and not exists (select 1 from people.compensation c where c.employee_id = e.id and c.superseded_at is null)`, [tenant.tenantId, hr.userId]);
  return (await db.query<{ count: string }>(`select count(*)::text as count from people.employee where tenant_id = $1 and status = 'active'`, [tenant.tenantId])).rows[0]!.count;
}, ['hr']);
const seedMs = performance.now() - seedStart;
if (Number(seed) !== 1000) throw new Error(`load seed created ${seed} employees, expected 1000`);

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const cpuStart = process.cpuUsage();
const wallStart = performance.now();
const stages: Record<string, { wall_ms: number; status: number }> = {};
const stage = async <T extends { status: number }>(name: string, fn: () => Promise<T>): Promise<T> => {
  const started = performance.now();
  const result = await fn();
  stages[name] = { wall_ms: Math.round((performance.now() - started) * 100) / 100, status: result.status };
  if (result.status >= 300) throw new Error(`${name} failed: ${result.status} ${JSON.stringify(result.body)}`);
  return result;
};

const group = await stage('start_group', () => preparer.client.post('/api/v1/pay/groups', {
  name: 'Synthetic monthly', packId: 'ae-private-sector', employerId: 'EMP12345678901', employerRouting: '012345678',
}));
const groupId = group.body.id as string;
const run = await stage('start', () => preparer.client.post('/api/v1/pay/runs', {
  payGroupId: groupId, periodStart: '2026-10-01', periodEnd: '2026-10-31', mode: 'sandbox',
}));
const runId = run.body.id as string;
await stage('lock_inputs', () => preparer.client.post(`/api/v1/pay/runs/${runId}/lock-inputs`));
const calculated = await stage('calculate', () => preparer.client.post(`/api/v1/pay/runs/${runId}/calculate`));
await stage('review_submit', () => preparer.client.post(`/api/v1/pay/runs/${runId}/submit`));
await stepUp(runtime, approver, true);
await stage('approve', () => approver.client.post(`/api/v1/pay/runs/${runId}/approve`, { resultSetHash: calculated.body.resultSetHash }));
await stepUp(runtime, preparer, false);
const finalised = await stage('finalise_outputs', () => preparer.client.post(`/api/v1/pay/runs/${runId}/finalise`));
await stage('publish', () => preparer.client.post(`/api/v1/pay/runs/${runId}/publish`));

const cpu = process.cpuUsage(cpuStart);
loop.disable();
const detail = await preparer.client.get(`/api/v1/pay/runs/${runId}`);
const totalMs = Math.round((performance.now() - wallStart) * 100) / 100;
const result = {
  generated_at: new Date().toISOString(),
  machine: { class: 'shared sandbox VM', hostname: os.hostname(), cpu_count: os.cpus().length, total_memory_gb: Math.round(os.totalmem() / 1024 ** 3), node: process.version },
  database: 'dedicated TEST_DATABASE_URL_* database only',
  tenant: { employees: Number(seed), run_id: runId },
  stages: { seed: { wall_ms: Math.round(seedMs * 100) / 100 }, ...stages },
  total_wall_ms: totalMs,
  cpu: { user_ms: Math.round(cpu.user / 1000 * 100) / 100, system_ms: Math.round(cpu.system / 1000 * 100) / 100 },
  event_loop_delay_ms: { mean: Number.isFinite(loop.mean) ? Math.round(loop.mean / 1e6 * 100) / 100 : null, max: Math.round(loop.max / 1e6 * 100) / 100, p50: Math.round(loop.percentile(50) / 1e6 * 100) / 100, p95: Math.round(loop.percentile(95) / 1e6 * 100) / 100 },
  peak_rss_mb: Math.round(process.memoryUsage().rss / 1024 ** 2 * 100) / 100,
  output: { lock: calculated.body, finalise: finalised.body, final_status: detail.body.run.status, exceptions: detail.body.exceptions.length, payment_file: detail.body.paymentFile },
  limits: ['Sandbox mode only; no live payment or bank transport.', 'No bank/WPS seed was used, so SIF rows are expected to be zero; payslip archive outputs were finalised and published.', 'One run is a benchmark sample; p50/p95 are reported only for event-loop delay, not as multi-run latency percentiles.'],
};
console.log(JSON.stringify(result, null, 2));
await runtime.close();
await rm(objectDir, { recursive: true, force: true });
