import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { del, fmtDate, get, money, post, put, toMinor } from '../api';
import { useSession } from '../session';
import { Banner, Card, Chip, ConfirmModal, Empty, ErrorBox, Field, FormModal, Loading, PageHead, StatusChip, Table, Tabs, useAsync, useToast } from '../ui';
import { DateInput } from '../DateInput';

export interface RunRow { id: string; pay_group_name: string; period_start: string; period_end: string; run_type: string; mode: string; status: string; pack_id: string; pack_version: string }
interface Group { id: string; name: string; pack_id: string; pay_day: number; employer_id?: string | null }
interface Pack { pack_id: string; version: string; assurance: string; reviewer: string | null; notes: string | null }

export const MODE_TONE: Record<string, 'info' | 'warn' | 'ok'> = { sandbox: 'info', parallel: 'warn', live: 'ok' };

export default function Payroll() {
  const { can } = useSession();
  const [tab, setTab] = useState<'runs' | 'groups' | 'adjust' | 'policy'>('runs');
  const packs = useAsync(() => get<{ packs: Pack[]; note: string }>('/pay/packs'), []);
  const tabs: Array<['runs' | 'groups' | 'adjust' | 'policy', string]> = [['runs', 'Pay runs'], ['groups', 'Pay groups'], ['adjust', 'One-off items'], ['policy', 'Controls']];
  const worst = packs.data?.packs.every((p) => p.assurance === 'L0' || p.assurance === 'none');
  return (
    <>
      <PageHead title="Payroll" sub="Every run is reproducible: inputs are locked, calculated by a versioned rule pack, approved by hash, then frozen." />
      {worst && (
        <Banner tone="warn">
          <div><strong>Rule pack not yet reviewed.</strong> The UAE pack is installed at assurance L0 (unreviewed). You can prepare sandbox and parallel runs, but live payment is blocked until a qualified reviewer signs the pack off. Do not pay anyone from these numbers.</div>
        </Banner>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'runs' && <Runs canPrepare={can('pay.prepare')} />}
      {tab === 'groups' && <Groups canAdmin={can('pay.admin')} packs={packs.data?.packs ?? []} />}
      {tab === 'adjust' && <Adjustments canPrepare={can('pay.prepare')} />}
      {tab === 'policy' && <Policy canManage={can('settings.manage') || can('pay.admin')} packs={packs.data?.packs ?? []} />}
    </>
  );
}

function Runs({ canPrepare }: { canPrepare: boolean }) {
  const nav = useNavigate();
  const toast = useToast();
  const runs = useAsync(() => get<{ runs: RunRow[] }>('/pay/runs'), []);
  const groups = useAsync(() => get<{ groups: Group[] }>('/pay/groups'), []);
  const [add, setAdd] = useState(false);
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const [f, setF] = useState({ payGroupId: '', periodStart: first, periodEnd: last, runType: 'regular', mode: 'sandbox' });
  return (
    <>
      <Card title="Pay runs" actions={canPrepare && <button className="btn primary" onClick={() => setAdd(true)} disabled={!groups.data?.groups.length}>New pay run</button>} flush>
        {runs.error ? <ErrorBox error={runs.error} retry={runs.reload} /> : runs.loading && !runs.data ? <Loading /> : runs.data!.runs.length ? (
          <Table head={['Period', 'Group', 'Type', 'Mode', 'Status', '']}>
            {runs.data!.runs.map((r) => (
              <tr key={r.id}>
                <td className="nowrap"><Link to={`/payroll/${r.id}`}><strong>{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</strong></Link></td>
                <td>{r.pay_group_name}</td><td>{r.run_type.replace('_', '-')}</td>
                <td><Chip tone={MODE_TONE[r.mode]}>{r.mode}</Chip></td><td><StatusChip status={r.status} /></td>
                <td className="right"><Link className="btn sm ghost" to={`/payroll/${r.id}`}>Open</Link></td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="No pay runs yet">{groups.data && !groups.data.groups.length ? 'Create a pay group first, then start a run.' : 'Start a sandbox run to see how it works. Nothing is paid.'}</Empty>}
      </Card>
      {add && (
        <FormModal title="Start a pay run" submit="Create run" onClose={() => setAdd(false)} onSubmit={async () => {
          const r = await post<{ id: string }>('/pay/runs', f); toast('Run created'); nav(`/payroll/${r.id}`);
        }}>
          <Field label="Pay group"><select className="input" required value={f.payGroupId} onChange={(e) => setF({ ...f, payGroupId: e.target.value })}><option value="">Choose…</option>{groups.data?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          <div className="grid g2">
            <Field label="Period start"><DateInput type="date" required value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Field>
            <Field label="Period end"><DateInput type="date" required min={f.periodStart} value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
            <Field label="Type"><select className="input" value={f.runType} onChange={(e) => setF({ ...f, runType: e.target.value })}><option value="regular">Regular</option><option value="off_cycle">Off-cycle</option><option value="final">Final settlement</option></select></Field>
            <Field label="Mode" hint="Sandbox never pays. Live needs a reviewed rule pack."><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="sandbox">Sandbox</option><option value="parallel">Parallel</option><option value="live">Live</option></select></Field>
          </div>
        </FormModal>
      )}
    </>
  );
}

function Groups({ canAdmin, packs }: { canAdmin: boolean; packs: Pack[] }) {
  const toast = useToast();
  const g = useAsync(() => get<{ groups: Group[] }>('/pay/groups'), []);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ name: '', packId: '', employerId: '', employerRouting: '', payDay: 28 });
  const ids = Array.from(new Set(packs.map((p) => p.pack_id)));
  return (
    <>
      <Card title="Pay groups" actions={canAdmin && <button className="btn primary" onClick={() => setAdd(true)}>New pay group</button>} flush>
        {g.error ? <ErrorBox error={g.error} retry={g.reload} /> : g.loading && !g.data ? <Loading /> : g.data!.groups.length ? (
          <Table head={['Name', 'Rule pack', { label: 'Pay day', num: true }, 'Employer ID']}>
            {g.data!.groups.map((x) => <tr key={x.id}><td><strong>{x.name}</strong></td><td className="mono">{x.pack_id}</td><td className="num">{x.pay_day}</td><td className="mono">{x.employer_id ?? <span className="faint">not set</span>}</td></tr>)}
          </Table>
        ) : <Empty title="No pay groups">A pay group ties people to a rule pack and a pay day.</Empty>}
      </Card>
      {add && (
        <FormModal title="New pay group" onClose={() => setAdd(false)} onSubmit={async () => {
          await post('/pay/groups', { name: f.name, packId: f.packId, payDay: +f.payDay, ...(f.employerId ? { employerId: f.employerId } : {}), ...(f.employerRouting ? { employerRouting: f.employerRouting } : {}) }); toast('Pay group created'); g.reload();
        }}>
          <Field label="Name"><input className="input" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Rule pack"><select className="input" required value={f.packId} onChange={(e) => setF({ ...f, packId: e.target.value })}><option value="">Choose…</option>{ids.map((i) => <option key={i}>{i}</option>)}</select></Field>
          <Field label="Pay day of month"><input className="input" type="number" min={1} max={31} value={f.payDay} onChange={(e) => setF({ ...f, payDay: +e.target.value })} /></Field>
          <div className="grid g2">
            <Field label="WPS employer ID" hint="13–35 letters or digits. Needed for the payment file."><input className="input mono" pattern="[A-Za-z0-9]{13,35}" value={f.employerId} onChange={(e) => setF({ ...f, employerId: e.target.value })} /></Field>
            <Field label="Employer bank routing" hint="9 digits."><input className="input mono" pattern="\d{9}" value={f.employerRouting} onChange={(e) => setF({ ...f, employerRouting: e.target.value })} /></Field>
          </div>
        </FormModal>
      )}
    </>
  );
}

function Adjustments({ canPrepare }: { canPrepare: boolean }) {
  const toast = useToast();
  const { currency } = useSession();
  const a = useAsync(() => get<{ adjustments: any[] }>('/pay/adjustments'), []);
  const emps = useAsync(() => get<{ employees: Array<{ id: string; first_name: string; last_name: string }> }>('/people/employees?limit=200&status=active'), []);
  const [add, setAdd] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [f, setF] = useState({ employeeId: '', effectiveDate: new Date().toISOString().slice(0, 10), code: '', label: '', kind: 'earning', amount: '' });
  const nm = (id: string) => { const e = emps.data?.employees.find((x) => x.id === id); return e ? `${e.first_name} ${e.last_name}` : id.slice(0, 8); };
  return (
    <>
      <Card title="One-off earnings and deductions" actions={canPrepare && <button className="btn primary" onClick={() => setAdd(true)}>Add item</button>} flush>
        {a.error ? <ErrorBox error={a.error} retry={a.reload} /> : a.loading && !a.data ? <Loading /> : a.data!.adjustments.length ? (
          <Table head={['Person', 'Date', 'Item', 'Kind', { label: 'Amount', num: true }, '']}>
            {a.data!.adjustments.map((x) => (
              <tr key={x.id}><td>{nm(x.employee_id)}</td><td>{fmtDate(x.effective_date)}</td><td>{x.label} <span className="faint mono">{x.code}</span></td><td>{x.kind}</td>
                <td className="num">{money(Number(x.amount_minor), currency)}</td>
                <td className="right">{x.voided_at ? <Chip>voided</Chip> : canPrepare && <button className="btn sm ghost" onClick={() => setVoidId(x.id)}>Void</button>}</td></tr>
            ))}
          </Table>
        ) : <Empty title="No one-off items">Bonuses, advances or deductions go here. They apply in the next locked run that covers their date.</Empty>}
      </Card>
      {add && (
        <FormModal title="Add a one-off item" onClose={() => setAdd(false)} onSubmit={async () => {
          const m = toMinor(f.amount); if (!m || m < 1) throw new Error('Enter a valid amount');
          await post('/pay/adjustments', { employeeId: f.employeeId, effectiveDate: f.effectiveDate, code: f.code.toUpperCase(), label: f.label, kind: f.kind, amountMinor: m }); toast('Item added'); a.reload();
        }}>
          <Field label="Person"><select className="input" required value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Choose…</option>{emps.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select></Field>
          <div className="grid g2">
            <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="earning">Earning</option><option value="deduction">Deduction</option></select></Field>
            <Field label="Effective date"><DateInput type="date" required value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></Field>
            <Field label="Label"><input className="input" required maxLength={80} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
            <Field label="Code" hint="Capitals, digits, underscore"><input className="input mono" required pattern="[A-Za-z][A-Za-z0-9_]{1,31}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          </div>
          <Field label={`Amount (${currency})`}><input className="input" inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        </FormModal>
      )}
      {voidId && <ConfirmModal title="Void this item" confirm="Void" danger body="It will no longer apply from the next locked run. Already-locked runs are unaffected." onClose={() => setVoidId(null)} onConfirm={async () => { await post(`/pay/adjustments/${voidId}/void`); toast('Voided'); a.reload(); }} />}
    </>
  );
}

function Policy({ canManage, packs }: { canManage: boolean; packs: Pack[] }) {
  const toast = useToast();
  const p = useAsync(() => get<{ exceptions: Array<{ id: string; kind: string; active: boolean; second_contact_email: string; created_at: string }> }>('/pay/policy'), []);
  const [on, setOn] = useState(false);
  const [email, setEmail] = useState('');
  const [ack, setAck] = useState(false);
  const [off, setOff] = useState(false);
  const single = p.data?.exceptions.find((e) => e.kind === 'single_admin' && e.active);
  const settings = useAsync(() => get<{ contractorPayrollEnabled: boolean; leaveEncashmentEnabled: boolean }>('/pay/settings'), []);
  const [contractors, setContractors] = useState<boolean | null>(null);
  const [leaveEncashment, setLeaveEncashment] = useState<boolean | null>(null);
  const contractorValue = contractors ?? settings.data?.contractorPayrollEnabled ?? false;
  const leaveValue = leaveEncashment ?? settings.data?.leaveEncashmentEnabled ?? false;
  return (
    <>
      <Card title="Segregation of duties">
        <p className="muted" style={{ marginTop: 0 }}>Normally the person who prepares a pay run cannot approve it. Small companies with one payroll person can switch on a flagged exception: the self-approval is recorded as such and payment release is delayed by 24 hours so a second person can intervene.</p>
        {p.error ? <ErrorBox error={p.error} retry={p.reload} /> : single ? (
          <>
            <Banner tone="warn">Single-admin exception is on. Second contact: <strong>{single.second_contact_email}</strong>. Since {fmtDate(single.created_at)}.</Banner>
            {canManage && <button className="btn" onClick={() => setOff(true)}>Switch off</button>}
          </>
        ) : canManage ? <button className="btn" onClick={() => setOn(true)}>Allow one person to prepare and approve</button> : <Chip tone="ok">Two people required</Chip>}
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Phase 4 controls">
        <p className="muted" style={{ marginTop: 0 }}>These settings are off by default because contractor treatment and leave encashment remain unreviewed L0 questions.</p>
        {settings.error ? <ErrorBox error={settings.error} retry={settings.reload} /> : !settings.data ? <Loading /> : <>
          <label className="check"><input type="checkbox" checked={contractorValue} disabled={!canManage} onChange={(e) => setContractors(e.target.checked)} /> Enable contractor payments (no statutory deductions or gratuity)</label>
          <label className="check"><input type="checkbox" checked={leaveValue} disabled={!canManage} onChange={(e) => setLeaveEncashment(e.target.checked)} /> Enable leave encashment in final settlements</label>
          {canManage && <button className="btn primary" style={{ marginTop: 14 }} onClick={async () => { await put('/pay/settings', { contractorPayrollEnabled: contractorValue, leaveEncashmentEnabled: leaveValue }); toast('Payroll settings saved'); settings.reload(); }}>Save Phase 4 settings</button>}
        </>}
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Rule packs" flush>
        <Table head={['Pack', 'Version', 'Assurance', 'Reviewer']}>
          {packs.map((x) => <tr key={x.pack_id + x.version}><td className="mono">{x.pack_id}</td><td>{x.version}</td><td><Chip tone={x.assurance === 'L2' || x.assurance === 'L3' ? 'ok' : 'warn'}>{x.assurance}</Chip></td><td>{x.reviewer ?? <span className="faint">none</span>}</td></tr>)}
        </Table>
        <div className="card-b faint">L0 means unreviewed. Live payment needs L2 or L3 with a named reviewer, set by a human process outside this app.</div>
      </Card>
      {on && (
        <FormModal title="Allow single-admin payroll" submit="Switch on" danger onClose={() => setOn(false)} onSubmit={async () => { await post('/pay/policy/single-admin', { secondContactEmail: email, acknowledge: true }); toast('Exception on'); p.reload(); }}>
          <Banner tone="warn">This weakens a core control. Use it only if you truly have one payroll person.</Banner>
          <Field label="Second contact email" hint="Someone who is told about every release."><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} required /> I understand and accept the risk.</label>
        </FormModal>
      )}
      {off && <ConfirmModal title="Switch off" confirm="Switch off" body="Preparer and approver must be different people again." onClose={() => setOff(false)} onConfirm={async () => { await del('/pay/policy/single-admin'); toast('Switched off'); p.reload(); }} />}
    </>
  );
}
