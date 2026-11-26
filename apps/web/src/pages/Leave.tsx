import { useState } from 'react';
import { days, fmtDate, get, post } from '../api';
import { useMe, useSession } from '../session';
import { Banner, Card, ConfirmModal, Empty, ErrorBox, Field, FormModal, Loading, PageHead, Stat, StatusChip, Table, Tabs, useAsync, useToast } from '../ui';
import { DateInput } from '../DateInput';

interface LType { id: string; code: string; name: string; paid: boolean; special: boolean; allow_negative: boolean; annual_days_x1000: number }
interface Bal { leave_type_id: string; code: string; name: string; paid: boolean; special: boolean; balance_x1000: number; pending_x1000: number }
interface Req { id: string; employee_id: string; first_name: string; last_name: string; type_name: string; special: boolean; start_date: string; end_date: string; days_x1000: number; status: string; half?: string | null }

export default function Leave() {
  const { can } = useSession(); const me = useMe();
  const toast = useToast();
  const hasEmp = !!me.user.employeeId;
  const [tab, setTab] = useState<'mine' | 'team' | 'calendar' | 'types'>('mine');
  const [req, setReq] = useState(false);
  const bal = useAsync(() => (hasEmp ? get<{ balances: Bal[] }>('/leave/balances') : Promise.resolve({ balances: [] as Bal[] })), []);
  const types = useAsync(() => get<{ types: LType[] }>('/leave/types'), []);
  const reload = () => { bal.reload(); };
  const tabs: Array<['mine' | 'team' | 'calendar' | 'types', string]> = [['mine', 'My requests'], ['team', 'Team requests'], ['calendar', 'Calendar']];
  if (can('leave.admin')) tabs.push(['types', 'Leave types']);
  return (
    <>
      <PageHead title="Leave" sub="Working days are counted for you, excluding weekends and public holidays.">
        {hasEmp && <button className="btn primary" onClick={() => setReq(true)}>Request leave</button>}
      </PageHead>
      {!hasEmp && <Banner tone="info">Your login is not linked to an employee record, so you cannot request leave. You can still review team requests and the calendar.</Banner>}
      {bal.data && bal.data.balances.length > 0 && (
        <div className="grid g4" style={{ marginBottom: 16 }}>
          {bal.data.balances.map((b) => <Stat key={b.leave_type_id} k={b.name} icon="solar:calendar-line-duotone" color={b.paid ? 'primary' : 'secondary'} v={<>{days(b.balance_x1000)} <span className="faint" style={{ fontSize: 13 }}>days</span></>} s={b.pending_x1000 ? `${days(b.pending_x1000)} pending approval` : b.paid ? 'Paid' : 'Unpaid'} />)}
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'mine' && <Requests scope="mine" onChange={reload} />}
      {tab === 'team' && <Requests scope="team" onChange={reload} />}
      {tab === 'calendar' && <CalendarView />}
      {tab === 'types' && <TypesAdmin types={types.data?.types ?? []} reload={types.reload} />}
      {req && <RequestForm types={types.data?.types ?? []} balances={bal.data?.balances ?? []} onClose={() => setReq(false)} onDone={(m) => { toast(m); reload(); setTab('mine'); }} />}
    </>
  );
}

function RequestForm({ types, balances, onClose, onDone }: { types: LType[]; balances: Bal[]; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ leaveTypeId: '', startDate: '', endDate: '', half: false, reason: '' });
  const bal = balances.find((b) => b.leave_type_id === f.leaveTypeId);
  return (
    <FormModal title="Request leave" submit="Submit request" onClose={onClose} onSubmit={async () => {
      const r = await post<{ days: number; status: string }>('/leave/requests', { leaveTypeId: f.leaveTypeId, startDate: f.startDate, endDate: f.endDate || f.startDate, half: f.half && (f.endDate || f.startDate) === f.startDate, ...(f.reason ? { reason: f.reason } : {}) });
      onDone(`Request sent for approval (${r.days} working day${r.days === 1 ? '' : 's'})`);
    }}>
      <Field label="Type"><select className="input" required value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}><option value="">Choose…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.paid ? '' : ' (unpaid)'}</option>)}</select></Field>
      {bal && <div className="faint" style={{ margin: '-6px 0 10px' }}>Balance {days(bal.balance_x1000)} days{bal.pending_x1000 ? `, ${days(bal.pending_x1000)} already pending` : ''}</div>}
      <div className="grid g2">
        <Field label="From"><DateInput type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} /></Field>
        <Field label="To"><DateInput type="date" required min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
      </div>
      <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" disabled={!!f.endDate && f.endDate !== f.startDate} checked={f.half} onChange={(e) => setF({ ...f, half: e.target.checked })} /> Half day (single date only)</label>
      <Field label="Reason (optional)" hint="Private. Your manager sees it only when deciding; HR admins do not by default."><textarea className="input" maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </FormModal>
  );
}

function Requests({ scope, onChange }: { scope: 'mine' | 'team'; onChange: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const r = useAsync(() => get<{ requests: Req[] }>(`/leave/requests?scope=${scope}${status ? `&status=${status}` : ''}`), [scope, status]);
  const [cancel, setCancel] = useState<Req | null>(null);
  const [reason, setReason] = useState<{ id: string; text: string | null } | null>(null);
  return (
    <>
      <Card title={scope === 'mine' ? 'My requests' : 'Requests from your team'} actions={<select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option>{['pending', 'approved', 'rejected', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</select>} flush>
        {r.error ? <ErrorBox error={r.error} retry={r.reload} /> : r.loading && !r.data ? <Loading /> : r.data!.requests.length ? (
          <Table head={[...(scope === 'team' ? ['Person'] : []), 'Type', 'Dates', { label: 'Days', num: true }, 'Status', '']}>
            {r.data!.requests.map((x) => (
              <tr key={x.id}>
                {scope === 'team' && <td>{x.first_name} {x.last_name}</td>}
                <td>{x.type_name}</td><td className="nowrap">{fmtDate(x.start_date)}{x.end_date !== x.start_date && ` – ${fmtDate(x.end_date)}`}</td>
                <td className="num">{days(x.days_x1000)}</td><td><StatusChip status={x.status} /></td>
                <td className="right nowrap">
                  {scope === 'team' && <button className="btn sm ghost" onClick={async () => { try { const d = await get<{ reason: string | null }>(`/leave/requests/${x.id}/reason`); setReason({ id: x.id, text: d.reason }); } catch (e: any) { toast(e.message, true); } }}>View reason</button>}
                  {scope === 'mine' && (x.status === 'pending' || x.status === 'approved') && new Date(x.start_date + 'T00:00:00Z') > new Date(Date.now() - 864e5) && <button className="btn sm ghost" onClick={() => setCancel(x)}>Cancel</button>}
                </td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="Nothing here" />}
      </Card>
      {cancel && <ConfirmModal title="Cancel this request" confirm="Cancel request" danger body={`${cancel.type_name}, ${fmtDate(cancel.start_date)} – ${fmtDate(cancel.end_date)}`} onClose={() => setCancel(null)} onConfirm={async () => { await post(`/leave/requests/${cancel.id}/cancel`); toast('Cancelled'); r.reload(); onChange(); }} />}
      {reason && <FormModal title="Reason" submit="Close" onClose={() => setReason(null)} onSubmit={async () => undefined}><p>{reason.text ?? 'No reason was given.'}</p><div className="faint">Viewing this is audited.</div></FormModal>}
    </>
  );
}

function CalendarView() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const first = month + '-01';
  const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  const c = useAsync(() => get<{ leave: Array<{ employee_id: string; first_name?: string; last_name?: string; start_date: string; end_date: string; type_name?: string; special?: boolean }> }>(`/leave/calendar?from=${first}&to=${last}`), [month]);
  return (
    <Card title="Who is away" actions={<DateInput type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />} flush>
      {c.error ? <ErrorBox error={c.error} retry={c.reload} /> : c.loading && !c.data ? <Loading /> : c.data!.leave.length ? (
        <Table head={['Person', 'Dates', 'Type']}>
          {c.data!.leave.map((x, i) => <tr key={i}><td>{x.first_name ? `${x.first_name} ${x.last_name}` : 'Colleague'}</td><td>{fmtDate(x.start_date)}{x.end_date !== x.start_date && ` – ${fmtDate(x.end_date)}`}</td><td>{x.type_name ?? 'Away'}</td></tr>)}
        </Table>
      ) : <Empty title="Nobody is away this month" />}
    </Card>
  );
}

function TypesAdmin({ types, reload }: { types: LType[]; reload: () => void }) {
  const toast = useToast();
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ code: '', name: '', paid: true, annualDays: 0, allowNegative: false, special: false });
  return (
    <>
      <Card title="Leave types" actions={<button className="btn primary" onClick={() => setAdd(true)}>New type</button>} flush>
        <Table head={['Name', 'Code', 'Paid', { label: 'Annual days', num: true }, 'Notes']}>
          {types.map((t) => <tr key={t.id}><td><strong>{t.name}</strong></td><td className="mono">{t.code}</td><td>{t.paid ? 'Yes' : 'No'}</td><td className="num">{days(t.annual_days_x1000)}</td><td className="faint">{[t.special && 'special (private)', t.allow_negative && 'can go negative'].filter(Boolean).join(', ')}</td></tr>)}
        </Table>
      </Card>
      <Banner tone="info">Entitlements are applied as set, without proration for part-year joiners. This is a known limitation.</Banner>
      {add && <FormModal title="New leave type" onClose={() => setAdd(false)} onSubmit={async () => { await post('/leave/types', { ...f, code: f.code.toUpperCase(), annualDays: +f.annualDays }); toast('Created'); reload(); }}>
        <div className="grid g2">
          <Field label="Name"><input className="input" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Code" hint="A–Z and underscore"><input className="input mono" required pattern="[A-Za-z_]{2,20}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        </div>
        <Field label="Annual entitlement (days)"><input className="input" type="number" min={0} max={365} step="0.5" value={f.annualDays} onChange={(e) => setF({ ...f, annualDays: +e.target.value })} /></Field>
        <div className="inline">
          <label className="check"><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> Paid</label>
          <label className="check"><input type="checkbox" checked={f.special} onChange={(e) => setF({ ...f, special: e.target.checked })} /> Special (reason is private)</label>
          <label className="check"><input type="checkbox" checked={f.allowNegative} onChange={(e) => setF({ ...f, allowNegative: e.target.checked })} /> Allow negative balance</label>
        </div>
      </FormModal>}
    </>
  );
}
