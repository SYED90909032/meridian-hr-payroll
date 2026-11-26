import { useState } from 'react';
import { get, post, put } from '../api';
import { Banner, Card, Chip, ConfirmModal, Empty, ErrorBox, Field, FormModal, Loading, Modal, PageHead, Table, useAsync, useToast } from '../ui';

/* ----------------------------------------------------------------- access */
interface Member { user_id: string; email: string; display_name: string; status: string; employee_id: string | null; roles: Array<{ role: string; scope: string }> }
const ROLES: Array<[string, string]> = [['owner', 'Owner: everything, including erasure and settings'], ['hr_admin', 'HR admin: people, org, documents, leave and time'], ['payroll_admin', 'Payroll admin: prepare and finalise payroll'], ['payroll_approver', 'Payroll approver: approve pay runs'], ['manager', 'Manager: team leave, time and approvals'], ['auditor', 'Auditor: read-only audit and reports'], ['helpdesk_agent', 'Helpdesk agent: tickets']];

export default function Access() {
  const toast = useToast();
  const m = useAsync(() => get<{ members: Member[] }>('/iam/members'), []);
  const emps = useAsync(() => get<{ employees: Array<{ id: string; first_name: string; last_name: string; employee_no: string }> }>('/people/employees?limit=200'), []);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  const [susp, setSusp] = useState<Member | null>(null);
  const [temp, setTemp] = useState<{ email: string; pw: string } | null>(null);
  const [f, setF] = useState({ email: '', displayName: '', employeeId: '', roles: [] as string[] });
  const [rolesDraft, setRolesDraft] = useState<string[]>([]);
  const nameOf = (id: string | null) => { const e = emps.data?.employees.find((x) => x.id === id); return e ? `${e.first_name} ${e.last_name}` : null; };
  const RoleBoxes = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <div className="roles">{ROLES.map(([r, d]) => <label key={r} className="check"><input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} /> <span><strong>{r.replace('_', ' ')}</strong><span className="faint"> {d.split(': ')[1]}</span></span></label>)}</div>
  );
  return (
    <>
      <PageHead title="Access" sub="Who can sign in, and what they can do. Changes need a recent password check.">
        <button className="btn primary" onClick={() => setAdd(true)}>Add person</button>
      </PageHead>
      <Card flush>
        {m.error ? <ErrorBox error={m.error} retry={m.reload} /> : m.loading && !m.data ? <Loading /> : m.data!.members.length ? (
          <Table head={['Person', 'Roles', 'Linked employee', 'Status', '']}>
            {m.data!.members.map((x) => (
              <tr key={x.user_id}><td><strong>{x.display_name}</strong><div className="faint">{x.email}</div></td>
                <td className="chips-cell">{x.roles.length ? x.roles.map((r) => <Chip key={r.role + r.scope}>{r.role.replace('_', ' ')}{r.scope !== 'tenant' ? ` · ${r.scope}` : ''}</Chip>) : <span className="faint">employee self-service</span>}</td>
                <td>{nameOf(x.employee_id) ?? <span className="faint">—</span>}</td><td><Chip tone={x.status === 'active' ? 'ok' : 'bad'}>{x.status}</Chip></td>
                <td className="right nowrap"><button className="btn sm ghost" onClick={() => { setEdit(x); setRolesDraft(Array.from(new Set(x.roles.map((r) => r.role)))); }}>Roles</button><button className="btn sm ghost" onClick={() => setSusp(x)}>{x.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td></tr>
            ))}
          </Table>
        ) : <Empty title="No members" />}
      </Card>
      {add && (
        <FormModal title="Add a person" submit="Create login" onClose={() => setAdd(false)} wide onSubmit={async () => {
          const r = await post<{ userId: string; temporaryPassword: string }>('/iam/members', { email: f.email, displayName: f.displayName, ...(f.employeeId ? { employeeId: f.employeeId } : {}), roles: f.roles.map((role) => ({ role, scope: role === 'manager' ? 'reports' : 'tenant' })) });
          setTemp({ email: f.email, pw: r.temporaryPassword }); m.reload();
        }}>
          <div className="grid g2">
            <Field label="Name"><input className="input" required minLength={2} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
            <Field label="Work email"><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          </div>
          <Field label="Link to employee record" hint="Needed for self-service: payslips, leave, and manager scope."><select className="input" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">None</option>{emps.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_no})</option>)}</select></Field>
          <Field label="Roles"><RoleBoxes value={f.roles} onChange={(roles) => setF({ ...f, roles })} /></Field>
          <div className="faint">Managers are scoped to their direct reports. Everyone can use self-service.</div>
        </FormModal>
      )}
      {temp && <Modal title="Temporary password" onClose={() => setTemp(null)} footer={<button className="btn primary" onClick={() => setTemp(null)}>Done</button>}>
        <Banner tone="warn">Give this to {temp.email} through a safe channel. It is shown once, and they must change it at first sign-in. No email is sent by this build.</Banner>
        <div className="secret mono">{temp.pw}</div>
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(temp.pw).then(() => toast('Copied'))}>Copy</button>
      </Modal>}
      {edit && (
        <FormModal title={`Roles for ${edit.display_name}`} onClose={() => setEdit(null)} wide onSubmit={async () => { await fetchPut(edit.user_id, rolesDraft); toast('Roles updated'); m.reload(); }}>
          <RoleBoxes value={rolesDraft} onChange={setRolesDraft} />
          <div className="faint" style={{ marginTop: 10 }}>The last owner cannot be removed.</div>
        </FormModal>
      )}
      {susp && <ConfirmModal title={susp.status === 'active' ? 'Suspend access' : 'Reactivate access'} confirm={susp.status === 'active' ? 'Suspend' : 'Reactivate'} danger={susp.status === 'active'} body={susp.status === 'active' ? `${susp.display_name} is signed out immediately and cannot sign in.` : `${susp.display_name} can sign in again.`} onClose={() => setSusp(null)} onConfirm={async () => { await post(`/iam/members/${susp.user_id}/status`, { status: susp.status === 'active' ? 'suspended' : 'active' }); toast('Updated'); m.reload(); }} />}
    </>
  );
}
async function fetchPut(userId: string, roles: string[]) {
  return put(`/iam/members/${userId}/roles`, { roles: roles.map((role) => ({ role, scope: role === 'manager' ? 'reports' : 'tenant' })) });
}
