import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, fmtDate } from '../api';
import { useSession } from '../session';
import { Avatar, Card, Empty, ErrorBox, Field, FormModal, Loading, PageHead, StatusChip, Table, useAsync, useToast } from '../ui';

export interface EmployeeRow {
  id: string; employee_no: string; first_name: string; last_name: string; work_email: string | null; org_unit_id: string | null; org_unit_name: string | null;
  manager_id: string | null; manager_name: string | null; job_title: string | null; status: string; employment_type: string; hire_date: string; termination_date: string | null;
  is_uae_national: boolean; nationality: string | null; version: number;
}

export default function People() {
  const { can } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useAsync(() => get<{ employees: EmployeeRow[]; total: number }>(`/people/employees?limit=100${q ? '&q=' + encodeURIComponent(q) : ''}${status ? '&status=' + status : ''}`), [q, status]);
  const units = useAsync(() => get<{ units: Array<{ id: string; name: string; code: string }> }>('/people/org'), []);
  const people = useAsync(() => get<{ employees: EmployeeRow[] }>('/people/employees?limit=200&status=active'), []);
  return (
    <>
      <PageHead title="Directory" sub={list.data ? `${list.data.total} ${list.data.total === 1 ? 'person' : 'people'}` : undefined}>
        <input className="input search" placeholder="Search name, number or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <select className="input" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option><option value="active">Active</option><option value="on_leave">On leave</option><option value="terminated">Terminated</option>
        </select>
        {can('people.write') && <button className="btn primary" onClick={() => setAdding(true)}>Add person</button>}
      </PageHead>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      <Card flush>
        {list.loading && !list.data ? <Loading /> : list.data && list.data.employees.length ? (
          <Table head={['Name', 'Title', 'Team', 'Manager', 'Joined', 'Status']}>
            {list.data.employees.map((e) => (
              <tr key={e.id} className="click" tabIndex={0} onClick={() => nav(`/people/${e.id}`)} onKeyDown={(k) => { if (k.key === 'Enter') nav(`/people/${e.id}`); }}>
                <td><div className="who"><Avatar name={`${e.first_name} ${e.last_name}`} /><div><div style={{ fontWeight: 550 }}>{e.first_name} {e.last_name}</div><div className="faint mono">{e.employee_no}</div></div></div></td>
                <td>{e.job_title ?? <span className="faint">—</span>}</td>
                <td>{e.org_unit_name ?? '—'}</td>
                <td>{e.manager_name ?? '—'}</td>
                <td className="nowrap">{fmtDate(e.hire_date)}</td>
                <td><StatusChip status={e.status} /></td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="Nobody found">Try a different search.</Empty>}
      </Card>
      {adding && <AddPerson units={units.data?.units ?? []} people={people.data?.employees ?? []} onClose={() => setAdding(false)} onDone={(id) => { toast('Person added'); nav(`/people/${id}`); }} />}
    </>
  );
}

function AddPerson({ units, people, onClose, onDone }: { units: Array<{ id: string; name: string }>; people: EmployeeRow[]; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ firstName: '', lastName: '', workEmail: '', jobTitle: '', hireDate: new Date().toISOString().slice(0, 10), orgUnitId: '', managerId: '', employmentType: 'full_time', isUaeNational: false });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  return (
    <FormModal title="Add a person" submit="Add person" wide onClose={onClose} onSubmit={async () => {
      const body: Record<string, unknown> = { firstName: f.firstName.trim(), lastName: f.lastName.trim(), hireDate: f.hireDate, employmentType: f.employmentType, isUaeNational: f.isUaeNational };
      if (f.workEmail) body.workEmail = f.workEmail.trim(); if (f.jobTitle) body.jobTitle = f.jobTitle.trim(); if (f.orgUnitId) body.orgUnitId = f.orgUnitId; if (f.managerId) body.managerId = f.managerId;
      const r = await post<{ id: string }>('/people/employees', body);
      onDone(r.id);
    }}>
      <div className="row"><Field label="First name"><input className="input" value={f.firstName} onChange={set('firstName')} required maxLength={80} /></Field><Field label="Last name"><input className="input" value={f.lastName} onChange={set('lastName')} required maxLength={80} /></Field></div>
      <div className="row"><Field label="Work email"><input className="input" type="email" value={f.workEmail} onChange={set('workEmail')} /></Field><Field label="Job title"><input className="input" value={f.jobTitle} onChange={set('jobTitle')} maxLength={120} /></Field></div>
      <div className="row">
        <Field label="Team"><select className="input" value={f.orgUnitId} onChange={set('orgUnitId')}><option value="">Company root</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Manager"><select className="input" value={f.managerId} onChange={set('managerId')}><option value="">None</option>{people.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}</select></Field>
      </div>
      <div className="row">
        <Field label="Start date"><input className="input" type="date" value={f.hireDate} onChange={set('hireDate')} required /></Field>
        <Field label="Type"><select className="input" value={f.employmentType} onChange={set('employmentType')}><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contractor">Contractor (not paid through payroll)</option></select></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.isUaeNational} onChange={set('isUaeNational')} /> UAE national (pension contributions apply)</label>
    </FormModal>
  );
}
