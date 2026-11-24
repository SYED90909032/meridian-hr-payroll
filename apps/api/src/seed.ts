/**
 * Demo data. Creates one company ("Al Noor Trading", fictional) through the same HTTP routes the web app uses, so every rule applies to seed data too.
 * All people, IDs, IBANs and phone numbers below are invented. Run with `pnpm db:seed`. Safe to run more than once (a new company each time).
 */
import { randomBytes } from 'node:crypto';
import { loadDotEnv } from './env.js';
loadDotEnv();
const { loadConfig } = await import('./config.js');
const { createPools } = await import('./db/pool.js');
const { buildApp } = await import('./app.js');
const { Client } = await import('./testing/client.js');

const cfg = loadConfig();
const pools = createPools(cfg);
const { app } = await buildApp(cfg, pools);
await app.ready();
const c = new Client(app);
const must = <T>(r: { status: number; body: T }, what: string): T => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body;
};

function iban(seed: number): string {
  const bban = '033' + String(1000000000000000 + seed).slice(0, 16);
  let rem = 0;
  for (const ch of bban + '1014' + '00') rem = (rem * 10 + Number(ch)) % 97;
  return `AE${String(98 - rem).padStart(2, '0')}${bban}`;
}

const tag = randomBytes(2).toString('hex');
const password = process.env.DEMO_PASSWORD ?? `Demo-${randomBytes(6).toString('base64url')}-9x`;
const email = `owner+${tag}@alnoor.example`;
must(await c.post('/api/v1/auth/register', { companyName: 'Al Noor Trading LLC', slug: `alnoor-${tag}`, country: 'AE', currency: 'AED', email, displayName: 'Layla Hassan', password }), 'register');
must(await c.stepUp(password), 'step-up');

const units: Record<string, string> = {};
for (const [code, name] of [['OPS', 'Operations'], ['FIN', 'Finance'], ['PPL', 'People'], ['SAL', 'Sales']] as const) {
  units[code] = must(await c.post('/api/v1/people/org', { code, name }), 'org').id;
}
must(await c.put('/api/v1/time/settings', { tz: 'Asia/Dubai', weekend: [6, 0] }), 'time settings');
const shift = must(await c.post('/api/v1/time/shifts', { name: 'Office 09:00-18:00', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10 }), 'shift').id;
for (const [date, name] of [['2026-12-02', 'UAE National Day'], ['2026-12-03', 'UAE National Day (2nd day)'], ['2027-01-01', "New Year's Day"]] as const) {
  await c.post('/api/v1/time/holidays', { date, name });
}
const group = must(await c.post('/api/v1/pay/groups', { name: 'Monthly staff', packId: 'ae-private-sector', employerId: 'EMP98765432101', employerRouting: '012345678' }), 'pay group').id;

const people: Array<{ first: string; last: string; unit: string; title: string; basic: number; national?: boolean; manager?: string }> = [
  { first: 'Omar', last: 'Farouk', unit: 'OPS', title: 'Operations Manager', basic: 1800000 },
  { first: 'Sara', last: 'Mansoor', unit: 'FIN', title: 'Finance Lead', basic: 1700000, national: true },
  { first: 'Yusuf', last: 'Karim', unit: 'PPL', title: 'HR Business Partner', basic: 1400000 },
  { first: 'Aisha', last: 'Rahman', unit: 'SAL', title: 'Sales Executive', basic: 1000000 },
  { first: 'Daniel', last: 'Okafor', unit: 'OPS', title: 'Logistics Coordinator', basic: 800000 },
  { first: 'Meera', last: 'Nair', unit: 'FIN', title: 'Accountant', basic: 900000 },
  { first: 'Hamdan', last: 'Al Suwaidi', unit: 'SAL', title: 'Account Manager', basic: 1200000, national: true },
];
let n = 0;
const ids: string[] = [];
for (const p of people) {
  n++;
  const e = must(await c.post('/api/v1/people/employees', { firstName: p.first, lastName: p.last, orgUnitId: units[p.unit], jobTitle: p.title, hireDate: '2025-02-01', isUaeNational: !!p.national, workEmail: `${p.first}.${p.last}`.toLowerCase().replace(/\s/g, '') + '@alnoor.example' }), 'employee');
  ids.push(e.id);
  must(await c.post(`/api/v1/people/employees/${e.id}/compensation`, { effectiveFrom: '2025-02-01', basic: p.basic, housing: Math.round(p.basic * 0.25), transport: 50000, other: 0, reason: 'Offer letter' }), 'compensation');
  must(await c.put(`/api/v1/people/employees/${e.id}/private`, { nationalId: `784${String(199000000000 + n * 1111).slice(0, 12)}`, wpsUid: `WPS${String(70000000 + n)}DEMO` }), 'private');
  must(await c.put(`/api/v1/people/employees/${e.id}/bank`, { bankName: 'Demo Bank PJSC', routingCode: '033000001', iban: iban(100 + n) }), 'bank');
  must(await c.post('/api/v1/time/shifts/assign', { employeeId: e.id, shiftId: shift, from: '2025-02-01' }), 'shift assign');
}
const run = must(await c.post('/api/v1/pay/runs', { payGroupId: group, periodStart: '2026-10-01', periodEnd: '2026-10-31', mode: 'sandbox' }), 'run').id;
for (const step of ['lock-inputs', 'calculate']) must(await c.post(`/api/v1/pay/runs/${run}/${step}`), step);

console.log('\nMeridian demo company created.\n');
console.log(`  Sign in at the web app with:`);
console.log(`    email:    ${email}`);
console.log(`    password: ${password}`);
console.log('\n  The owner has no two-step verification yet: enrol it under Settings > Security.');
console.log('  A sandbox pay run for October 2026 is calculated and waiting. To approve it you need a second person with the');
console.log('  payroll approver role and two-step verification (separation of duties). Add one under Settings > People and access.\n');
await app.close();
await pools.end();
