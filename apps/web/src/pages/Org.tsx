import { useState } from 'react';
import { get, patch, post } from '../api';
import { useSession } from '../session';
import { Card, ErrorBox, Field, FormModal, Loading, PageHead, Table, useAsync, useToast } from '../ui';

interface Unit { id: string; parent_id: string | null; code: string; name: string; headcount: number }

export default function Org() {
  const { can } = useSession();
  const toast = useToast();
  const u = useAsync(() => get<{ units: Unit[] }>('/people/org'), []);
  const [modal, setModal] = useState<null | { mode: 'add'; parent?: string } | { mode: 'rename'; unit: Unit }>(null);
  if (u.loading && !u.data) return <Loading />;
  if (u.error) return <ErrorBox error={u.error} retry={u.reload} />;
  const units = u.data!.units;
  const kids = (id: string | null) => units.filter((x) => x.parent_id === id);
  const total = (id: string): number => units.find((x) => x.id === id)!.headcount + kids(id).reduce((n, k) => n + total(k.id), 0);
  const Node = ({ unit, depth }: { unit: Unit; depth: number }) => (
    <>
      <tr>
        <td style={{ paddingLeft: 18 + depth * 24 }}><strong>{unit.name}</strong> <span className="faint mono">{unit.code}</span></td>
        <td className="num">{unit.headcount}</td><td className="num">{total(unit.id)}</td>
        <td className="right">{can('org.write') && <><button className="btn sm ghost" onClick={() => setModal({ mode: 'add', parent: unit.id })}>Add sub-team</button><button className="btn sm ghost" onClick={() => setModal({ mode: 'rename', unit })}>Rename</button></>}</td>
      </tr>
      {kids(unit.id).map((k) => <Node key={k.id} unit={k} depth={depth + 1} />)}
    </>
  );
  const roots = units.filter((x) => !x.parent_id || !units.some((y) => y.id === x.parent_id));
  return (
    <>
      <PageHead title="Organisation" sub="Teams and where people sit. Access scopes follow this tree.">
        {can('org.write') && <button className="btn primary" onClick={() => setModal({ mode: 'add' })}>Add team</button>}
      </PageHead>
      <Card flush>
        <Table head={['Team', { label: 'Direct', num: true }, { label: 'Including sub-teams', num: true }, '']}>
          {roots.map((r) => <Node key={r.id} unit={r} depth={0} />)}
        </Table>
      </Card>
      {modal?.mode === 'add' && <AddUnit parent={modal.parent} onClose={() => setModal(null)} onDone={() => { toast('Team added'); u.reload(); }} />}
      {modal?.mode === 'rename' && (
        <FormModal title="Rename team" onClose={() => setModal(null)} onSubmit={async () => { const el = document.getElementById('rn') as HTMLInputElement; await patch(`/people/org/${modal.unit.id}`, { name: el.value.trim() }); toast('Renamed'); u.reload(); }}>
          <Field label="Name"><input id="rn" className="input" defaultValue={modal.unit.name} maxLength={120} required /></Field>
        </FormModal>
      )}
    </>
  );
}
function AddUnit({ parent, onClose, onDone }: { parent?: string; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(''); const [name, setName] = useState('');
  return (
    <FormModal title="Add a team" onClose={onClose} onSubmit={async () => { await post('/people/org', { code: code.trim().toUpperCase(), name: name.trim(), ...(parent ? { parentId: parent } : {}) }); onDone(); }}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => { setName(e.target.value); if (!code) setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()); }} required maxLength={120} /></Field>
      <Field label="Code" hint="Letters, numbers, dash or underscore. Unique."><input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} required pattern="[A-Za-z0-9_\-]{1,32}" /></Field>
    </FormModal>
  );
}

