import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, download, errMsg, fmtDate, fmtDateTime, fromMinor, get, money, patch, post, put, toMinor } from '../api';
import { useSession } from '../session';
import { Avatar, AvatarPicker, Banner, Card, ConfirmModal, Chip, Empty, ErrorBox, Field, FormModal, Loading, PageHead, StatusChip, Table, Tabs, useAsync, useToast } from '../ui';
import type { EmployeeRow } from './People';

type Tab = 'overview' | 'pay' | 'identity' | 'documents' | 'history';
interface Detail { employee: EmployeeRow; events: Array<{ kind: string; effective_date: string | null; detail: Record<string, unknown>; created_at: string }>; directReports: Array<{ id: string; first_name: string; last_name: string; job_title: string | null }> }

export default function Employee() {
  const { id } = useParams();
  const { can, me, currency } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [modal, setModal] = useState<null | 'edit' | 'terminate' | 'erase' | 'picture'>(null);
  const d = useAsync(() => get<Detail>(`/people/employees/${id}`), [id]);
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const e = d.data!.employee;
  const self = me!.user.employeeId === e.id;
  const full = `${e.first_name} ${e.last_name}`;
  const tabs: Array<[Tab, string]> = [['overview', 'Overview']];
  if (self || can('comp.read')) tabs.push(['pay', 'Pay']);
  tabs.push(['identity', 'Identity and bank']);
  if (self || can('docs.read')) tabs.push(['documents', 'Documents']);
  if (d.data!.events.length) tabs.push(['history', 'History']);
  return (
    <>
      <PageHead title={full} avatar={
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <Avatar name={full} size={64} />
          {(self || can('people.write')) && <button type="button" className="btn primary sm no-print" aria-label="Change profile picture" title="Change picture" onClick={() => setModal('picture')} style={{ position: 'absolute', right: -6, bottom: -6, width: 28, height: 28, padding: 0, fontSize: 13 }}>✎</button>}
        </span>
      } sub={<span><span className="mono">{e.employee_no}</span> · {e.job_title ?? 'No title'} · <StatusChip status={e.status} /></span>}>
        <Link className="btn" to="/people">Back</Link>
        {can('people.write') && e.status !== 'terminated' && <button className="btn" onClick={() => setModal('edit')}>Edit</button>}
        {can('people.write') && e.status !== 'terminated' && !self && <button className="btn danger" onClick={() => setModal('terminate')}>Terminate</button>}
        {can('settings.manage') && e.status === 'terminated' && <button className="btn danger" onClick={() => setModal('erase')}>Erase personal data</button>}
      </PageHead>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {modal === 'picture' && (
        <FormModal title="Profile picture" submit="Done" onClose={() => setModal(null)} onSubmit={async () => {}}>
          <p className="muted" style={{ marginBottom: 16 }}>Choose the picture shown next to {full}. It is saved on this device.</p>
          <AvatarPicker name={full} />
        </FormModal>
      )}
      {tab === 'overview' && (
        <div className="grid g-main">
          <Card title="Details">
            <dl className="kv">
              <dt>Work email</dt><dd>{e.work_email ?? '—'}</dd>
              <dt>Team</dt><dd>{e.org_unit_name ?? '—'}</dd>
              <dt>Manager</dt><dd>{e.manager_id ? <Link to={`/people/${e.manager_id}`}>{e.manager_name}</Link> : '—'}</dd>
              <dt>Type</dt><dd>{e.employment_type.replace('_', ' ')}</dd>
              <dt>Joined</dt><dd>{fmtDate(e.hire_date)}</dd>
              {e.termination_date && <><dt>Left</dt><dd>{fmtDate(e.termination_date)}</dd></>}
              <dt>Nationality</dt><dd>{e.nationality ?? '—'} {e.is_uae_national && <Chip tone="info">UAE national</Chip>}</dd>
            </dl>
          </Card>
          <Card title="Direct reports" flush>
            {d.data!.directReports.length ? <ul className="list">{d.data!.directReports.map((r) => <li key={r.id}><div className="who"><Avatar name={`${r.first_name} ${r.last_name}`} /><Link to={`/people/${r.id}`}>{r.first_name} {r.last_name}</Link><span className="faint">{r.job_title}</span></div></li>)}</ul> : <Empty title="None" />}
          </Card>
        </div>
      )}
      {tab === 'pay' && <PayTab id={e.id} currency={currency} canWrite={can('comp.write') && e.status !== 'terminated'} />}
      {tab === 'identity' && <IdentityTab id={e.id} self={self} canWrite={can('people.write')} canBank={can('bank.write')} canReveal={can('pii.reveal')} />}
      {tab === 'documents' && <DocsTab id={e.id} canWrite={can('docs.write')} />}
      {tab === 'history' && (
        <Card flush><Table head={['When', 'Event', 'Detail']}>
          {d.data!.events.map((x, i) => <tr key={i}><td className="nowrap">{fmtDateTime(x.created_at)}</td><td>{x.kind.replace(/_/g, ' ')}</td><td className="faint mono" style={{ wordBreak: 'break-word' }}>{JSON.stringify(x.detail)}</td></tr>)}
        </Table></Card>
      )}
      {modal === 'edit' && <EditModal e={e} onClose={() => setModal(null)} onDone={() => { toast('Saved'); d.reload(); }} />}
      {modal === 'terminate' && <TerminateModal id={e.id} onClose={() => setModal(null)} onDone={() => { toast('Employee terminated'); d.reload(); }} />}
      {modal === 'erase' && <ConfirmModal title="Erase personal data" danger confirm="Erase permanently" onClose={() => setModal(null)}
        body={<>This destroys the encryption key for this person's identity data and documents. It cannot be undone. Payroll records are kept as the law requires. A legal hold blocks this.</>}
        onConfirm={async () => { await post(`/people/employees/${e.id}/erase-personal-data`, { confirm: 'ERASE' }); toast('Personal data erased'); nav('/people'); }} />}
    </>
  );
}

function EditModal({ e, onClose, onDone }: { e: EmployeeRow; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ jobTitle: e.job_title ?? '', workEmail: e.work_email ?? '' });
  return (
    <FormModal title="Edit details" onClose={onClose} onSubmit={async () => {
      await api_patch(e.id, { version: e.version, jobTitle: f.jobTitle.trim() || undefined, workEmail: f.workEmail.trim() || undefined });
      onDone();
    }}>
      <Field label="Job title"><input className="input" value={f.jobTitle} onChange={(x) => setF({ ...f, jobTitle: x.target.value })} maxLength={120} /></Field>
      <Field label="Work email"><input className="input" type="email" value={f.workEmail} onChange={(x) => setF({ ...f, workEmail: x.target.value })} /></Field>
    </FormModal>
  );
}
async function api_patch(id: string, body: Record<string, unknown>) {
  try { return await patch(`/people/employees/${id}`, body); } catch (x) { if (x instanceof ApiError && x.status === 409) throw new Error('Someone else changed this record. Reload and try again.'); throw x; }
}
function TerminateModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  return (
    <FormModal title="Terminate employment" submit="Terminate" danger onClose={onClose} onSubmit={async () => { await post(`/people/employees/${id}/terminate`, { terminationDate: date, reason: reason.trim() }); onDone(); }}>
      <Banner tone="warn">Their access ends immediately. Final pay is prepared as a separate final run; notice pay is entered as an adjustment.</Banner>
      <Field label="Last day"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
      <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} /></Field>
    </FormModal>
  );
}

function PayTab({ id, currency, canWrite }: { id: string; currency: string; canWrite: boolean }) {
  const h = useAsync(() => get<{ history: Array<{ id: string; valid_from: string; valid_to: string | null; basic_minor: number; housing_minor: number; transport_minor: number; other_minor: number; reason: string; superseded_at: string | null }> }>(`/people/employees/${id}/compensation`), [id]);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <Card title="Compensation" actions={canWrite && <button className="btn sm primary" onClick={() => setOpen(true)}>Set new pay</button>} flush>
      {h.loading ? <Loading /> : h.error ? <ErrorBox error={h.error} /> : h.data && h.data.history.length ? (
        <Table head={['From', 'Basic', 'Housing', 'Transport', 'Other', 'Reason']}>
          {h.data.history.filter((x) => !x.superseded_at).map((x) => (
            <tr key={x.id}><td className="nowrap">{fmtDate(x.valid_from)}{!x.valid_to && <> <Chip tone="ok">current</Chip></>}</td><td className="num">{money(x.basic_minor, currency)}</td><td className="num">{money(x.housing_minor, currency)}</td><td className="num">{money(x.transport_minor, currency)}</td><td className="num">{money(x.other_minor, currency)}</td><td>{x.reason}</td></tr>
          ))}
        </Table>
      ) : <Empty title="No compensation on file">You can only see pay you are allowed to see.</Empty>}
      {open && <CompModal id={id} onClose={() => setOpen(false)} onDone={() => { toast('Pay updated. History is kept.'); h.reload(); }} />}
    </Card>
  );
}
function CompModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ effectiveFrom: new Date().toISOString().slice(0, 10), basic: '', housing: '0', transport: '0', other: '0', reason: '' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title="Set pay from a date" onClose={onClose} onSubmit={async () => {
      const m = { basic: toMinor(f.basic), housing: toMinor(f.housing), transport: toMinor(f.transport), other: toMinor(f.other) };
      if (Object.values(m).some((v) => v === null) || !m.basic) throw new Error('Enter amounts like 8500 or 8500.50');
      await post(`/people/employees/${id}/compensation`, { effectiveFrom: f.effectiveFrom, ...m, reason: f.reason.trim() });
      onDone();
    }}>
      <Banner tone="info">Amounts are monthly. A pay change takes effect on the date you choose; it cannot split a pay period that has already been locked.</Banner>
      <Field label="Effective from"><input className="input" type="date" value={f.effectiveFrom} onChange={set('effectiveFrom')} required /></Field>
      <div className="row"><Field label="Basic"><input className="input" inputMode="decimal" value={f.basic} onChange={set('basic')} required /></Field><Field label="Housing"><input className="input" inputMode="decimal" value={f.housing} onChange={set('housing')} /></Field></div>
      <div className="row"><Field label="Transport"><input className="input" inputMode="decimal" value={f.transport} onChange={set('transport')} /></Field><Field label="Other"><input className="input" inputMode="decimal" value={f.other} onChange={set('other')} /></Field></div>
      <Field label="Reason"><input className="input" value={f.reason} onChange={set('reason')} required maxLength={300} placeholder="Annual review, promotion, correction…" /></Field>
    </FormModal>
  );
}

function IdentityTab({ id, self, canWrite, canBank, canReveal }: { id: string; self: boolean; canWrite: boolean; canBank: boolean; canReveal: boolean }) {
  const [reveal, setReveal] = useState(false);
  const p = useAsync(() => get<{ private: null | { nationalId: string | null; wpsUid: string | null; dob: string | null; phone: string | null; address: string | null; erased: boolean } }>(`/people/employees/${id}/private${reveal ? '?reveal=1' : ''}`), [id, reveal]);
  const b = useAsync(() => get<{ bank: null | { bank_name: string; routing_code: string; iban_last4: string; created_at: string } }>(`/people/employees/${id}/bank`), [id]);
  const [edit, setEdit] = useState<null | 'id' | 'bank'>(null);
  const toast = useToast();
  const pr = p.data?.private;
  return (
    <div className="grid g2">
      <Card title="Identity" actions={<>{(canReveal || self) && pr && !pr.erased && <button className="btn sm" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Reveal'}</button>}{canWrite && <button className="btn sm" onClick={() => setEdit('id')}>Edit</button>}</>}>
        {p.loading ? <Loading /> : pr ? (
          pr.erased ? <Banner tone="info">Personal data for this person has been erased.</Banner> : (
            <dl className="kv"><dt>Emirates ID</dt><dd className="mono">{pr.nationalId ?? '—'}</dd><dt>WPS person code</dt><dd className="mono">{pr.wpsUid ?? '—'}</dd><dt>Date of birth</dt><dd>{fmtDate(pr.dob)}</dd><dt>Phone</dt><dd>{pr.phone ?? '—'}</dd><dt>Address</dt><dd>{pr.address ?? '—'}</dd></dl>
          )
        ) : <Empty title="Nothing on file or not visible to you" />}
        {reveal && <p className="faint" style={{ marginTop: 10, fontSize: 12 }}>Viewing full identifiers is recorded in the audit log.</p>}
      </Card>
      <Card title="Bank account" actions={canBank && <button className="btn sm" onClick={() => setEdit('bank')}>Change</button>}>
        {b.loading ? <Loading /> : b.data?.bank ? (
          <dl className="kv"><dt>Bank</dt><dd>{b.data.bank.bank_name}</dd><dt>Routing code</dt><dd className="mono">{b.data.bank.routing_code}</dd><dt>IBAN</dt><dd className="mono">•••• {b.data.bank.iban_last4}</dd><dt>Updated</dt><dd>{fmtDateTime(b.data.bank.created_at)}</dd></dl>
        ) : <Empty title="No bank details">Pay runs flag people without bank details.</Empty>}
        <p className="faint" style={{ marginTop: 10, fontSize: 12 }}>Changing bank details needs a fresh confirmation and tells the employee.</p>
      </Card>
      {edit === 'id' && <IdModal id={id} onClose={() => setEdit(null)} onDone={() => { toast('Saved'); p.reload(); }} />}
      {edit === 'bank' && <BankModal id={id} onClose={() => setEdit(null)} onDone={() => { toast('Bank details changed. The employee has been notified.'); b.reload(); }} />}
    </div>
  );
}
function IdModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ nationalId: '', wpsUid: '', dob: '', phone: '', address: '' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title="Identity details" onClose={onClose} onSubmit={async () => {
      const body: Record<string, string> = {};
      for (const [k, v] of Object.entries(f)) if (v.trim()) body[k] = v.trim();
      if (!Object.keys(body).length) throw new Error('Enter at least one field');
      await put(`/people/employees/${id}/private`, body); onDone();
    }}>
      <p className="muted" style={{ marginBottom: 12 }}>Only fields you fill in are changed. Values are encrypted with this person's own key.</p>
      <Field label="Emirates ID" hint="15 digits, starts with 784"><input className="input mono" value={f.nationalId} onChange={set('nationalId')} inputMode="numeric" /></Field>
      <Field label="WPS person code" hint="14 to 35 letters or digits (from MOHRE)"><input className="input mono" value={f.wpsUid} onChange={set('wpsUid')} /></Field>
      <div className="row"><Field label="Date of birth"><input className="input" type="date" value={f.dob} onChange={set('dob')} /></Field><Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field></div>
      <Field label="Address"><input className="input" value={f.address} onChange={set('address')} maxLength={300} /></Field>
    </FormModal>
  );
}
function BankModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ bankName: '', routingCode: '', iban: '' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title="Bank account" onClose={onClose} onSubmit={async () => { await put(`/people/employees/${id}/bank`, { bankName: f.bankName.trim(), routingCode: f.routingCode.trim(), iban: f.iban.replace(/\s/g, '').toUpperCase() }); onDone(); }}>
      <Field label="Bank name"><input className="input" value={f.bankName} onChange={set('bankName')} required /></Field>
      <Field label="Routing code" hint="9 digits"><input className="input mono" value={f.routingCode} onChange={set('routingCode')} required pattern="\d{9}" inputMode="numeric" /></Field>
      <Field label="IBAN" hint="The check digits are verified."><input className="input mono" value={f.iban} onChange={set('iban')} required /></Field>
    </FormModal>
  );
}

function DocsTab({ id, canWrite }: { id: string; canWrite: boolean }) {
  const l = useAsync(() => get<{ documents: Array<{ id: string; kind: string; name: string; mime: string; size_bytes: number; created_at: string }> }>(`/people/employees/${id}/documents`), [id]);
  const file = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('contract');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const upload = async (f: File) => {
    setBusy(true);
    try {
      if (f.size > 5 * 1024 * 1024) throw new Error('Files can be up to 5 MB');
      const mime = f.type;
      if (!['application/pdf', 'image/png', 'image/jpeg', 'text/plain'].includes(mime)) throw new Error('Use a PDF, PNG, JPEG or plain text file');
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      await post(`/people/employees/${id}/documents`, { kind, name: f.name.replace(/[\\/\x00-\x1f]/g, '_'), mime, contentBase64: btoa(bin) });
      toast('Document uploaded and encrypted'); l.reload();
    } catch (x) { toast(errMsg(x), true); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  return (
    <Card title="Documents" actions={canWrite && <>
      <select className="input" style={{ width: 130, height: 28 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type"><option value="contract">Contract</option><option value="id_copy">ID copy</option><option value="certificate">Certificate</option><option value="letter">Letter</option><option value="other">Other</option></select>
      <button className="btn sm primary" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Uploading…' : 'Upload'}</button>
      <input ref={file} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
    </>} flush>
      {l.loading ? <Loading /> : l.data && l.data.documents.length ? (
        <Table head={['Name', 'Type', 'Size', 'Added', '']}>
          {l.data.documents.map((d) => (
            <tr key={d.id}><td>{d.name}</td><td>{d.kind.replace('_', ' ')}</td><td>{(d.size_bytes / 1024).toFixed(0)} KB</td><td>{fmtDate(d.created_at)}</td>
              <td className="right"><button className="btn sm" onClick={() => download(`/people/documents/${d.id}`, d.name).catch((x) => toast(errMsg(x), true))}>Download</button></td></tr>
          ))}
        </Table>
      ) : <Empty title="No documents">Files are checked against their type, encrypted, and every download is audited.</Empty>}
    </Card>
  );
}
