import { useState } from 'react';
import { del, fmtDate, fmtDateTime, get, post, put } from '../api';
import { useSession } from '../session';
import { Banner, Card, Chip, ConfirmModal, Empty, ErrorBox, Field, FormModal, Loading, PageHead, StatusChip, Table, Tabs, useAsync, useToast } from '../ui';
import { DateInput } from '../DateInput';

interface Day { employee_id: string; first_name: string; last_name: string; employee_no: string; work_date: string; first_in: string | null; last_out: string | null; worked_minutes: number; late_minutes: number; overtime_minutes: number; overtime_special_minutes: number; status: string }
interface Emp { id: string; first_name: string; last_name: string; employee_no: string }
const iso = (d: Date) => d.toISOString().slice(0, 10);
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function useEmployees() {
  return useAsync(() => get<{ employees: Emp[] }>('/people/employees?limit=200&status=active'), []);
}

export default function Time() {
  const { can } = useSession();
  const admin = can('time.admin');
  const [tab, setTab] = useState<'attendance' | 'punches' | 'shifts' | 'holidays' | 'devices' | 'settings'>('attendance');
  const tabs: Array<['attendance' | 'punches' | 'shifts' | 'holidays' | 'devices' | 'settings', string]> = [['attendance', 'Attendance'], ['punches', 'Punches']];
  if (admin) tabs.push(['shifts', 'Shifts'], ['holidays', 'Holidays'], ['devices', 'Devices'], ['settings', 'Settings']);
  return (
    <>
      <PageHead title="Time and attendance" sub="Punches come from devices or manual corrections, and become daily attendance." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'attendance' && <Attendance admin={admin} />}
      {tab === 'punches' && <Punches admin={admin} />}
      {tab === 'shifts' && <Shifts />}
      {tab === 'holidays' && <Holidays />}
      {tab === 'devices' && <Devices />}
      {tab === 'settings' && <TimeSettings />}
    </>
  );
}

function Attendance({ admin }: { admin: boolean }) {
  const toast = useToast();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 13 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const a = useAsync(() => get<{ days: Day[] }>(`/time/attendance?from=${from}&to=${to}&limit=500`), [from, to]);
  const [busy, setBusy] = useState(false);
  const recompute = async () => {
    setBusy(true);
    try { await post('/time/attendance/recompute', { from, to }); toast('Attendance recomputed'); a.reload(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <Card title="Daily attendance" actions={<div className="inline">
      <DateInput type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
      <DateInput type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
      {admin && <button className="btn" onClick={recompute} disabled={busy}>{busy ? 'Working…' : 'Recompute'}</button>}
    </div>} flush>
      {a.error ? <ErrorBox error={a.error} retry={a.reload} /> : a.loading && !a.data ? <Loading /> : a.data!.days.length ? (
        <Table head={['Date', 'Person', 'In', 'Out', { label: 'Worked', num: true }, { label: 'Late', num: true }, { label: 'Overtime', num: true }, 'Status']}>
          {a.data!.days.map((d) => (
            <tr key={d.employee_id + d.work_date}>
              <td className="nowrap">{fmtDate(d.work_date)}</td><td>{d.first_name} {d.last_name}</td>
              <td>{d.first_in ? new Date(d.first_in).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
              <td>{d.last_out ? new Date(d.last_out).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
              <td className="num">{hm(d.worked_minutes)}</td><td className="num">{d.late_minutes ? `${d.late_minutes}m` : '—'}</td>
              <td className="num">{d.overtime_minutes + d.overtime_special_minutes ? hm(d.overtime_minutes + d.overtime_special_minutes) : '—'}</td>
              <td><StatusChip status={d.status} /></td>
            </tr>
          ))}
        </Table>
      ) : <Empty title="No attendance in this range">Attendance appears once punches exist and are recomputed.</Empty>}
    </Card>
  );
}

function Punches({ admin }: { admin: boolean }) {
  const toast = useToast();
  const p = useAsync(() => get<{ punches: Array<{ id: string; employee_id: string; event_time: string; direction: string; source: string; confidence: string }> }>('/time/punches?limit=100'), []);
  const emps = useEmployees();
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ employeeId: '', eventTime: '', direction: 'in', reason: '' });
  const nameOf = (id: string) => { const e = emps.data?.employees.find((x) => x.id === id); return e ? `${e.first_name} ${e.last_name}` : id.slice(0, 8); };
  return (
    <>
      <Card title="Recent punches" actions={admin && <button className="btn primary" onClick={() => setAdd(true)}>Manual punch</button>} flush>
        {p.error ? <ErrorBox error={p.error} retry={p.reload} /> : p.loading && !p.data ? <Loading /> : p.data!.punches.length ? (
          <Table head={['Time', 'Person', 'Direction', 'Source', 'Confidence']}>
            {p.data!.punches.map((x) => <tr key={x.id}><td className="nowrap">{fmtDateTime(x.event_time)}</td><td>{admin ? nameOf(x.employee_id) : 'You'}</td><td><Chip tone={x.direction === 'in' ? 'ok' : 'info'}>{x.direction}</Chip></td><td>{x.source}</td><td>{x.confidence}</td></tr>)}
          </Table>
        ) : <Empty title="No punches" />}
      </Card>
      {add && (
        <FormModal title="Add a manual punch" submit="Add punch" onClose={() => setAdd(false)} onSubmit={async () => { await post('/time/punches/manual', { ...f, eventTime: new Date(f.eventTime).toISOString() }); toast('Punch added and audited'); p.reload(); }}>
          <Field label="Person"><select className="input" required value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Choose…</option>{emps.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_no})</option>)}</select></Field>
          <div className="grid g2">
            <Field label="Date and time"><DateInput type="datetime-local" required value={f.eventTime} onChange={(e) => setF({ ...f, eventTime: e.target.value })} /></Field>
            <Field label="Direction"><select className="input" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="in">In</option><option value="out">Out</option></select></Field>
          </div>
          <Field label="Reason" hint="Recorded in the audit log."><input className="input" required minLength={5} maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </FormModal>
      )}
    </>
  );
}

function Shifts() {
  const toast = useToast();
  const s = useAsync(() => get<{ shifts: Array<{ id: string; name: string; start_time: string; end_time: string; break_minutes: number; grace_minutes: number; overnight: boolean }> }>('/time/shifts'), []);
  const emps = useEmployees();
  const [modal, setModal] = useState<'new' | 'assign' | null>(null);
  const [n, setN] = useState({ name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, overnight: false });
  const [a, setA] = useState({ employeeId: '', shiftId: '', from: iso(new Date()), to: '' });
  return (
    <>
      <Card title="Shifts" actions={<div className="inline"><button className="btn" onClick={() => setModal('assign')}>Assign to a person</button><button className="btn primary" onClick={() => setModal('new')}>New shift</button></div>} flush>
        {s.error ? <ErrorBox error={s.error} retry={s.reload} /> : s.loading && !s.data ? <Loading /> : s.data!.shifts.length ? (
          <Table head={['Name', 'Hours', { label: 'Break', num: true }, { label: 'Grace', num: true }, '']}>
            {s.data!.shifts.map((x) => <tr key={x.id}><td><strong>{x.name}</strong></td><td>{x.start_time.slice(0, 5)} – {x.end_time.slice(0, 5)}</td><td className="num">{x.break_minutes}m</td><td className="num">{x.grace_minutes}m</td><td>{x.overnight && <Chip tone="warn">overnight (staged)</Chip>}</td></tr>)}
          </Table>
        ) : <Empty title="No shifts yet" />}
      </Card>
      {modal === 'new' && (
        <FormModal title="New shift" onClose={() => setModal(null)} onSubmit={async () => { await post('/time/shifts', { ...n, breakMinutes: +n.breakMinutes, graceMinutes: +n.graceMinutes }); toast('Shift created'); s.reload(); }}>
          <Field label="Name"><input className="input" required maxLength={100} value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
          <div className="grid g2">
            <Field label="Starts"><input className="input" type="time" required value={n.startTime} onChange={(e) => setN({ ...n, startTime: e.target.value })} /></Field>
            <Field label="Ends"><input className="input" type="time" required value={n.endTime} onChange={(e) => setN({ ...n, endTime: e.target.value })} /></Field>
            <Field label="Unpaid break (min)"><input className="input" type="number" min={0} max={240} value={n.breakMinutes} onChange={(e) => setN({ ...n, breakMinutes: +e.target.value })} /></Field>
            <Field label="Late grace (min)"><input className="input" type="number" min={0} max={120} value={n.graceMinutes} onChange={(e) => setN({ ...n, graceMinutes: +e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={n.overnight} onChange={(e) => setN({ ...n, overnight: e.target.checked })} /> Crosses midnight</label>
        </FormModal>
      )}
      {modal === 'assign' && (
        <FormModal title="Assign a shift" submit="Assign" onClose={() => setModal(null)} onSubmit={async () => { await post('/time/shifts/assign', { employeeId: a.employeeId, shiftId: a.shiftId, from: a.from, ...(a.to ? { to: a.to } : {}) }); toast('Shift assigned'); }}>
          <Field label="Person"><select className="input" required value={a.employeeId} onChange={(e) => setA({ ...a, employeeId: e.target.value })}><option value="">Choose…</option>{emps.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select></Field>
          <Field label="Shift"><select className="input" required value={a.shiftId} onChange={(e) => setA({ ...a, shiftId: e.target.value })}><option value="">Choose…</option>{s.data?.shifts.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
          <div className="grid g2">
            <Field label="From"><DateInput type="date" required value={a.from} onChange={(e) => setA({ ...a, from: e.target.value })} /></Field>
            <Field label="Until (optional)"><DateInput type="date" min={a.from} value={a.to} onChange={(e) => setA({ ...a, to: e.target.value })} /></Field>
          </div>
        </FormModal>
      )}
    </>
  );
}

function Holidays() {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const h = useAsync(() => get<{ holidays: Array<{ date: string; name: string }> }>(`/time/holidays?year=${year}`), [year]);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ date: '', name: '' });
  const [rm, setRm] = useState<string | null>(null);
  return (
    <>
      <Card title="Public holidays" actions={<div className="inline"><select className="input" value={year} onChange={(e) => setYear(+e.target.value)} aria-label="Year">{[-1, 0, 1].map((o) => <option key={o}>{new Date().getFullYear() + o}</option>)}</select><button className="btn primary" onClick={() => setAdd(true)}>Add holiday</button></div>} flush>
        {h.error ? <ErrorBox error={h.error} retry={h.reload} /> : h.loading && !h.data ? <Loading /> : h.data!.holidays.length ? (
          <Table head={['Date', 'Name', '']}>{h.data!.holidays.map((x) => <tr key={x.date}><td>{fmtDate(x.date)}</td><td>{x.name}</td><td className="right"><button className="btn sm ghost" onClick={() => setRm(x.date)}>Remove</button></td></tr>)}</Table>
        ) : <Empty title={`No holidays for ${year}`} />}
      </Card>
      {add && <FormModal title="Add a holiday" onClose={() => setAdd(false)} onSubmit={async () => { await post('/time/holidays', f); toast('Holiday added'); h.reload(); }}>
        <Field label="Date"><DateInput type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Name"><input className="input" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      </FormModal>}
      {rm && <ConfirmModal title="Remove holiday" confirm="Remove" danger body={`Remove ${fmtDate(rm)}? Attendance and overtime for that day will change when recomputed.`} onClose={() => setRm(null)} onConfirm={async () => { await del(`/time/holidays/${rm}`); toast('Removed'); h.reload(); }} />}
    </>
  );
}

function Devices() {
  const toast = useToast();
  const d = useAsync(() => get<{ devices: Array<{ id: string; name: string; kind: string; key_prefix: string; revoked_at: string | null; last_seen_at: string | null }> }>('/time/devices'), []);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'kiosk' });
  const [shown, setShown] = useState<string | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  return (
    <>
      <Card title="Punch devices" actions={<button className="btn primary" onClick={() => setAdd(true)}>Register device</button>} flush>
        {d.error ? <ErrorBox error={d.error} retry={d.reload} /> : d.loading && !d.data ? <Loading /> : d.data!.devices.length ? (
          <Table head={['Name', 'Type', 'Key', 'Last seen', 'Status', '']}>
            {d.data!.devices.map((x) => <tr key={x.id}><td><strong>{x.name}</strong></td><td>{x.kind}</td><td className="mono">{x.key_prefix}…</td><td>{fmtDateTime(x.last_seen_at)}</td><td>{x.revoked_at ? <Chip tone="bad">revoked</Chip> : <Chip tone="ok">active</Chip>}</td><td className="right">{!x.revoked_at && <button className="btn sm ghost" onClick={() => setRev(x.id)}>Revoke</button>}</td></tr>)}
          </Table>
        ) : <Empty title="No devices">Register a kiosk or biometric terminal. Its key is shown once.</Empty>}
      </Card>
      {add && <FormModal title="Register a device" submit="Register" onClose={() => setAdd(false)} onSubmit={async () => { const r = await post<{ key: string }>('/time/devices', f); setShown(r.key); d.reload(); }}>
        <Field label="Name"><input className="input" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Type"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['biometric', 'kiosk', 'mobile', 'api'].map((k) => <option key={k}>{k}</option>)}</select></Field>
      </FormModal>}
      {shown && <SecretModal title="Device key" secret={shown} note="Copy this key now. It is stored only as a hash and cannot be shown again." onClose={() => setShown(null)} />}
      {rev && <ConfirmModal title="Revoke device" confirm="Revoke" danger body="The device stops being able to submit punches immediately." onClose={() => setRev(null)} onConfirm={async () => { await post(`/time/devices/${rev}/revoke`); toast('Device revoked'); d.reload(); }} />}
    </>
  );
}

export function SecretModal({ title, secret, note, onClose }: { title: string; secret: string; note: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <FormModal title={title} submit="I have saved it" onClose={onClose} onSubmit={async () => undefined}>
      <Banner tone="warn">{note}</Banner>
      <div className="secret mono">{secret}</div>
      <button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(secret).then(() => toast('Copied'))}>Copy</button>
    </FormModal>
  );
}

function TimeSettings() {
  const toast = useToast();
  const s = useAsync(() => get<{ tz: string; weekend: number[] }>('/time/settings'), []);
  const [tz, setTz] = useState<string | null>(null);
  const [wk, setWk] = useState<number[] | null>(null);
  if (s.error) return <ErrorBox error={s.error} retry={s.reload} />;
  if (!s.data) return <Loading />;
  const curTz = tz ?? s.data.tz; const curWk = wk ?? s.data.weekend;
  return (
    <Card title="Calendar settings">
      <form onSubmit={async (e) => { e.preventDefault(); try { await put('/time/settings', { tz: curTz, weekend: curWk }); toast('Saved'); s.reload(); } catch (x: any) { toast(x.message, true); } }}>
        <Field label="Time zone" hint="IANA name, for example Asia/Dubai."><input className="input" value={curTz} onChange={(e) => setTz(e.target.value)} required /></Field>
        <Field label="Weekend days"><div className="inline">{DAYS.map((n, i) => <label key={n} className="check"><input type="checkbox" checked={curWk.includes(i)} onChange={(e) => setWk(e.target.checked ? [...curWk, i] : curWk.filter((x) => x !== i))} /> {n}</label>)}</div></Field>
        <button className="btn primary" disabled={!curWk.length || curWk.length > 3}>Save</button>
      </form>
    </Card>
  );
}
