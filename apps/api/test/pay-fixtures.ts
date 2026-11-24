import { actor, mkTenant, ownerOf, stepUp, type Actor, type Booted } from './api-helpers.js';
import type { TestTenant } from './helpers.js';

/** A valid UAE IBAN: AE + 2 check digits + 3-digit bank + 16-digit account (mod-97). */
export function uaeIban(seed: number): string {
  const bban = '033' + String(1000000000000000 + seed).slice(0, 16);
  const rearr = bban + '1014' + '00'; // A=10 E=14 then 00
  let rem = 0;
  for (const ch of rearr) rem = (rem * 10 + Number(ch)) % 97;
  const check = String(98 - rem).padStart(2, '0');
  return `AE${check}${bban}`;
}
export interface PayWorld {
  t: TestTenant; owner: Actor; preparer: Actor; approver: Actor; hr: Actor; groupId: string;
  employees: Array<{ id: string; name: string; basic: number; actor?: Actor }>;
}
/** Lays out a company with a preparer, a separate approver (two-step verification on), an HR admin, a pay group and paid employees. */
export async function payWorld(b: Booted, label = 'pay', n = 3): Promise<PayWorld> {
  const t = await mkTenant(b.pools, label);
  const owner = await ownerOf(b, t, true);
  const preparer = await actor(b, t, 'Preparer', [{ role: 'payroll_admin' }], { mfa: true });
  const approver = await actor(b, t, 'Approver', [{ role: 'payroll_approver' }], { mfa: true });
  const hr = await actor(b, t, 'Hrbp', [{ role: 'hr_admin' }], { mfa: true });
  await stepUp(b, owner);
  const g = await preparer.client.post('/api/v1/pay/groups', { name: 'Monthly', packId: 'ae-private-sector', employerId: 'EMP12345678901', employerRouting: '012345678' });
  if (g.status !== 201 && g.status !== 200) throw new Error('group failed ' + JSON.stringify(g.body));
  const employees: PayWorld['employees'] = [];
  for (let i = 0; i < n; i++) {
    const basic = 800000 + i * 100000; // AED 8,000.00 and up, in fils
    const c = await hr.client.post('/api/v1/people/employees', { firstName: `Emp${i}`, lastName: 'Staff', hireDate: '2025-01-01', isUaeNational: i === 2 });
    if (c.status !== 201) throw new Error('employee failed ' + JSON.stringify(c.body));
    const id = c.body.id as string;
    await stepUp(b, hr);
    const comp = await hr.client.post(`/api/v1/people/employees/${id}/compensation`, { effectiveFrom: '2025-01-01', basic, housing: 200000, transport: 50000, other: 0, reason: 'Initial' });
    if (comp.status !== 201 && comp.status !== 200) throw new Error('comp failed ' + JSON.stringify(comp.body));
    const priv = await hr.client.put(`/api/v1/people/employees/${id}/private`, { nationalId: `784${String(100000000000 + i).slice(0, 12)}`, wpsUid: `WPSUID${String(10000000 + i)}ABCD` });
    if (priv.status !== 200) throw new Error('private failed ' + JSON.stringify(priv.body));
    await stepUp(b, preparer);
    const bank = await preparer.client.put(`/api/v1/people/employees/${id}/bank`, { bankName: 'Test Bank', routingCode: '033000001', iban: uaeIban(i + 1) });
    if (bank.status !== 200) throw new Error('bank failed ' + JSON.stringify(bank.body));
    employees.push({ id, name: `Emp${i} Staff`, basic });
  }
  return { t, owner, preparer, approver, hr, groupId: g.body.id, employees };
}
export async function runTo(b: Booted, w: PayWorld, opts: { period?: [string, string]; mode?: 'sandbox' | 'parallel' | 'live'; until?: 'draft' | 'locked' | 'calculated' | 'in_review' }): Promise<string> {
  const [s, e] = opts.period ?? ['2025-10-01', '2025-10-31'];
  const r = await w.preparer.client.post('/api/v1/pay/runs', { payGroupId: w.groupId, periodStart: s, periodEnd: e, mode: opts.mode ?? 'sandbox' });
  if (r.status !== 201) throw new Error('run failed ' + JSON.stringify(r.body));
  const id = r.body.id as string;
  const until = opts.until ?? 'in_review';
  if (until === 'draft') return id;
  const steps: Array<[string, string]> = [['lock-inputs', 'locked'], ['calculate', 'calculated'], ['submit', 'in_review']];
  for (const [step, name] of steps) {
    const x = await w.preparer.client.post(`/api/v1/pay/runs/${id}/${step}`);
    if (x.status !== 200) throw new Error(`${step} failed ` + JSON.stringify(x.body));
    if (until === name) break;
  }
  return id;
}
