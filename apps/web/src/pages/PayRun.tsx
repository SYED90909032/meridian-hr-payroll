import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { download, fmtDate, fmtDateTime, get, money, post } from '../api';
import { useSession } from '../session';
import { Banner, Card, Chip, ConfirmModal, Drawer, Empty, ErrorBox, Field, FormModal, Loading, PageHead, Stat, StatusChip, Table, Tabs, useAsync, useToast } from '../ui';
import { MODE_TONE } from './Payroll';

interface Run { id: string; pay_group_name: string; period_start: string; period_end: string; run_type: string; mode: string; status: string; pack_id: string; pack_version: string; pack_hash: string; engine_hash: string | null; input_set_hash: string | null; result_set_hash: string | null; bank_file_hash: string | null; prepared_by: string; currency?: string }
interface Exc { id: string; employee_id: string | null; first_name: string | null; last_name: string | null; code: string; severity: 'blocking' | 'warning'; message: string; status: string; waived_reason: string | null }
interface Detail {
  run: Run; events: Array<{ from_status: string | null; to_status: string; reason: string | null; at: string }>; exceptions: Exc[];
  approvals: Array<{ id: string; kind: string; display_name: string | null; flagged_self_approval: boolean; release_not_before: string | null; voided_at: string | null; created_at: string }>;
  totals: { employees: number; excluded: number; gross_minor: number; net_minor: number; deductions_minor: number; employer_cost_minor: number };
  paymentFile: { hash: string; createdAt: string; employees: number } | null; packAssurance: string; livePaymentAllowed: boolean;
}
interface Line { code: string; label: string; kind: string; amount_minor: number; rule_id: string; explain: string; capped_from_minor?: number }
interface Result { employee_id: string; employee_no: string; first_name: string; last_name: string; status: string; gross_minor: number; net_minor: number; result_hash: string; result: { lines: Line[]; exceptions?: Array<{ code: string; severity: string; message: string }> } }

const STEPS = ['draft', 'inputs_locked', 'calculated', 'in_review', 'approved', 'finalised', 'payment_released', 'paid', 'published'];
const LABEL: Record<string, string> = { draft: 'Draft', inputs_locked: 'Inputs locked', calculated: 'Calculated', in_review: 'In review', approved: 'Approved', finalised: 'Finalised', payment_released: 'Payment released', paid: 'Paid', published: 'Published' };

type Action = 'lock-inputs' | 'unlock' | 'calculate' | 'reopen' | 'submit' | 'approve' | 'reject' | 'cancel' | 'finalise' | 'release' | 'mark-paid' | 'publish' | 'reverse';

export default function PayRun() {
  const { id } = useParams();
  const { can, currency } = useSession();
  const toast = useToast();
  const cur = currency;
  const d = useAsync(() => get<Detail>(`/pay/runs/${id}`), [id]);
  const [tab, setTab] = useState<'results' | 'exceptions' | 'approvals' | 'history'>('results');
  const results = useAsync(() => (d.data && ['calculated', 'in_review', 'approved', 'finalised', 'payment_released', 'paid', 'published', 'rejected', 'reversed'].includes(d.data.run.status) ? get<{ results: Result[] }>(`/pay/runs/${id}/results`) : Promise.resolve({ results: [] as Result[] })), [id, d.data?.run.status, d.data?.run.result_set_hash]);
  const [act, setAct] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [waive, setWaive] = useState<Exc | null>(null);
  const [view, setView] = useState<Result | null>(null);
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data) return <Loading />;
  const { run, totals, exceptions } = d.data;
  const prep = can('pay.prepare'); const appr = can('pay.approve'); const admin = can('pay.admin'); const rel = can('pay.release');
  const openBlocking = exceptions.filter((x) => x.severity === 'blocking' && x.status === 'open').length;
  const reload = () => { d.reload(); results.reload(); };
  const quick = async (a: Action, body: unknown = {}) => { setBusy(true); try { await post(`/pay/runs/${id}/${a}`, body); toast(({ 'lock-inputs': 'Inputs locked', calculate: 'Calculated', submit: 'Sent for approval', unlock: 'Back to draft', publish: 'Payslips published', finalise: 'Run finalised' } as Record<string, string>)[a] ?? 'Done'); reload(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };

  const s = run.status;
  const primary: Array<{ a: Action; label: string; show: boolean; kind?: string; run?: () => void }> = [
    { a: 'lock-inputs', label: 'Lock inputs', show: s === 'draft' && prep },
    { a: 'calculate', label: 'Calculate', show: s === 'inputs_locked' && prep },
    { a: 'submit', label: 'Send for approval', show: s === 'calculated' && prep },
    { a: 'approve', label: 'Review and approve', show: s === 'in_review' && appr, run: () => setAct('approve') },
    { a: 'finalise', label: 'Finalise', show: s === 'approved' && admin, run: () => quick('finalise') },
    { a: 'release', label: 'Release payment', show: s === 'finalised' && rel && run.mode === 'live', run: () => setAct('release') },
    { a: 'mark-paid', label: 'Confirm paid', show: s === 'payment_released' && rel, run: () => setAct('mark-paid') },
    { a: 'publish', label: 'Publish payslips', show: ((run.mode === 'live' && s === 'paid') || (run.mode !== 'live' && s === 'finalised')) && admin },
  ];
  const secondary: Array<{ a: Action; label: string; show: boolean; danger?: boolean }> = [
    { a: 'unlock', label: 'Back to draft', show: (s === 'inputs_locked' || s === 'rejected') && prep },
    { a: 'reopen', label: 'Reopen', show: ['calculated', 'in_review', 'approved', 'rejected'].includes(s) && prep },
    { a: 'reject', label: 'Send back', show: s === 'in_review' && appr, danger: true },
    { a: 'cancel', label: 'Cancel run', show: ['draft', 'inputs_locked', 'calculated', 'in_review', 'rejected'].includes(s) && prep, danger: true },
    { a: 'reverse', label: 'Reverse', show: ['finalised', 'payment_released', 'paid', 'published'].includes(s) && admin, danger: true },
  ];
  const idx = STEPS.indexOf(s);

  return (
    <>
      <PageHead title={`${fmtDate(run.period_start)} – ${fmtDate(run.period_end)}`} sub={<><Link to="/payroll">Payroll</Link> / {run.pay_group_name} · {run.run_type.replace('_', '-')} · <Chip tone={MODE_TONE[run.mode]}>{run.mode}</Chip> <StatusChip status={s} /></>}>
        {secondary.filter((x) => x.show).map((x) => <button key={x.a} className={'btn' + (x.danger ? ' danger-outline' : '')} onClick={() => setAct(x.a)}>{x.label}</button>)}
        {primary.filter((x) => x.show).map((x) => <button key={x.a} className="btn primary" disabled={busy || (x.a === 'submit' && openBlocking > 0 && false)} onClick={x.run ?? (() => quick(x.a))}>{busy ? 'Working…' : x.label}</button>)}
      </PageHead>

      {d.data.packAssurance !== 'L2' && d.data.packAssurance !== 'L3' && <Banner tone="warn">Rule pack <span className="mono">{run.pack_id}@{run.pack_version}</span> is unreviewed (assurance {d.data.packAssurance}). Treat these numbers as a rehearsal. {run.mode === 'live' && 'Live payment will be refused.'}</Banner>}
      {d.data.approvals.some((a) => a.flagged_self_approval && !a.voided_at) && <Banner tone="warn">Approved under the single-admin exception. Release is held until {fmtDateTime(d.data.approvals.find((a) => a.release_not_before)?.release_not_before)}.</Banner>}
      {s === 'rejected' && <Banner tone="bad">Sent back by the approver: {d.data.events.filter((e) => e.to_status === 'rejected').slice(-1)[0]?.reason}</Banner>}

      <div className="steps" aria-label="Progress">
        {STEPS.map((k, i) => (
          <div key={k} className={'step' + (i < idx ? ' done' : '') + (i === idx ? ' now' : '')}>{LABEL[k]}</div>
        ))}
      </div>

      {idx >= 2 && (
        <div className="grid g4" style={{ margin: '16px 0' }}>
          <Stat k="People paid" icon="solar:users-group-rounded-line-duotone" color="primary" v={totals.employees} s={totals.excluded ? `${totals.excluded} excluded` : undefined} />
          <Stat k="Gross" icon="solar:money-bag-line-duotone" color="info" v={money(totals.gross_minor, cur)} />
          <Stat k="Net pay" icon="solar:wallet-money-line-duotone" color="success" v={money(totals.net_minor, cur)} s={`Deductions ${money(totals.deductions_minor, cur)}`} />
          <Stat k="Employer cost" icon="solar:buildings-2-line-duotone" color="warning" v={money(totals.employer_cost_minor, cur)} />
        </div>
      )}

      <Tabs tabs={[['results', 'Results'], ['exceptions', `Exceptions${exceptions.filter((x) => x.status === 'open').length ? ` (${exceptions.filter((x) => x.status === 'open').length})` : ''}`], ['approvals', 'Approvals and files'], ['history', 'History']]} value={tab} onChange={setTab} />

      {tab === 'results' && (
        <Card flush>
          {results.loading && !results.data ? <Loading /> : results.data && results.data.results.length ? (
            <Table head={['Person', 'Status', { label: 'Gross', num: true }, { label: 'Net', num: true }, '']}>
              {results.data.results.map((r) => (
                <tr key={r.employee_id}><td><strong>{r.first_name} {r.last_name}</strong> <span className="faint">{r.employee_no}</span></td><td><StatusChip status={r.status} /></td>
                  <td className="num">{money(r.gross_minor, cur)}</td><td className="num">{money(r.net_minor, cur)}</td><td className="right"><button className="btn sm ghost" onClick={() => setView(r)}>Explain</button></td></tr>
              ))}
            </Table>
          ) : <Empty title="No results yet">{s === 'draft' ? 'Lock the inputs, then calculate.' : s === 'inputs_locked' ? 'Inputs are locked. Calculate to see results.' : 'Nothing to show.'}</Empty>}
        </Card>
      )}

      {tab === 'exceptions' && (
        <Card flush>
          {exceptions.length ? (
            <Table head={['Severity', 'Person', 'Issue', 'Status', '']}>
              {exceptions.map((x) => (
                <tr key={x.id}><td><Chip tone={x.severity === 'blocking' ? 'bad' : 'warn'}>{x.severity}</Chip></td><td>{x.first_name ? `${x.first_name} ${x.last_name}` : 'Run'}</td>
                  <td>{x.message}<div className="faint mono">{x.code}</div></td><td>{x.status === 'waived' ? <span title={x.waived_reason ?? ''}><StatusChip status="waived" /></span> : <StatusChip status={x.status} />}</td>
                  <td className="right">{x.status === 'open' && appr && ['calculated', 'in_review'].includes(s) && <button className="btn sm" onClick={() => setWaive(x)}>Accept…</button>}</td></tr>
              ))}
            </Table>
          ) : <Empty title="No exceptions">The calculation found nothing that needs attention.</Empty>}
          {openBlocking > 0 && <div className="card-b"><Banner tone="bad">{openBlocking} blocking exception(s) must be fixed (reopen and correct the data) or accepted with a reason before approval.</Banner></div>}
        </Card>
      )}

      {tab === 'approvals' && (
        <>
          <Card title="Approvals" flush>
            {d.data.approvals.length ? <Table head={['Who', 'When', 'Notes']}>{d.data.approvals.map((a) => <tr key={a.id}><td>{a.display_name ?? 'Unknown'}</td><td>{fmtDateTime(a.created_at)}</td><td>{a.voided_at ? <Chip tone="bad">voided</Chip> : a.flagged_self_approval ? <Chip tone="warn">self-approved (exception)</Chip> : <Chip tone="ok">valid</Chip>}</td></tr>)}</Table> : <div className="card-b faint">No approvals yet.</div>}
          </Card>
          <div style={{ height: 16 }} />
          <Card title="Fingerprints and payment file">
            <dl className="kv">
              <dt>Inputs</dt><dd className="mono">{run.input_set_hash ?? '—'}</dd>
              <dt>Results</dt><dd className="mono">{run.result_set_hash ?? '—'}</dd>
              <dt>Rule pack</dt><dd className="mono">{run.pack_id}@{run.pack_version} {run.pack_hash.slice(0, 16)}…</dd>
              <dt>Bank file</dt><dd className="mono">{d.data.paymentFile ? `${d.data.paymentFile.hash} (${d.data.paymentFile.employees} people)` : '—'}</dd>
            </dl>
            {d.data.paymentFile && can('pay.release') && (
              <div style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => download(`/pay/runs/${id}/payment-file`, `wps-${run.period_end}.sif`).catch((e) => toast(e.message, true))}>Download WPS file</button>
                <span className="faint" style={{ marginLeft: 10 }}>Unvalidated by any bank. Download is audited.</span>
              </div>
            )}
            {['finalised', 'payment_released', 'paid', 'published'].includes(s) && admin && <div style={{ marginTop: 12 }}><PayslipLink runId={run.id} /></div>}
          </Card>
        </>
      )}

      {tab === 'history' && (
        <Card flush>
          <Table head={['When', 'Change', 'Reason']}>{d.data.events.slice().reverse().map((e, i) => <tr key={i}><td className="nowrap">{fmtDateTime(e.at)}</td><td>{e.from_status ? `${e.from_status.replace(/_/g, ' ')} → ` : ''}{e.to_status.replace(/_/g, ' ')}</td><td>{e.reason ?? ''}</td></tr>)}</Table>
        </Card>
      )}

      {view && (
        <Drawer title={`${view.first_name} ${view.last_name}`} onClose={() => setView(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Every line shows the rule that produced it and why.</p>
          <Table head={['Line', { label: 'Amount', num: true }]}>
            {view.result.lines.map((l, i) => (
              <tr key={i}><td><div style={{ fontWeight: 550 }}>{l.label} <span className="faint">{l.kind}</span></div><div className="faint" style={{ fontSize: 12 }}>{l.explain}</div><div className="faint mono" style={{ fontSize: 11 }}>{l.rule_id}{l.capped_from_minor ? ` · capped from ${money(l.capped_from_minor, cur)}` : ''}</div></td>
                <td className={'num' + (l.kind === 'deduction' ? ' neg' : '')}>{l.kind === 'deduction' ? '−' : ''}{money(l.amount_minor, cur)}</td></tr>
            ))}
          </Table>
          <dl className="kv" style={{ marginTop: 16 }}><dt>Gross</dt><dd>{money(view.gross_minor, cur)}</dd><dt>Net</dt><dd><strong>{money(view.net_minor, cur)}</strong></dd><dt>Fingerprint</dt><dd className="mono">{view.result_hash.slice(0, 24)}…</dd></dl>
          {view.result.exceptions?.map((x, i) => <Banner key={i} tone={x.severity === 'blocking' ? 'bad' : 'warn'}>{x.message}</Banner>)}
        </Drawer>
      )}

      {waive && <ConfirmModal title="Accept this exception" confirm="Accept with reason" reasonLabel="Why is this acceptable?" body={<><strong>{waive.message}</strong><br />This is recorded with your name.</>} onClose={() => setWaive(null)} onConfirm={async (reason) => { await post(`/pay/runs/${id}/exceptions/${waive.id}/waive`, { reason }); toast('Accepted'); reload(); }} />}

      {act === 'approve' && (
        <ConfirmModal title="Approve this payroll" confirm="Approve" onClose={() => setAct(null)}
          body={<>You are approving <strong>{totals.employees} people</strong>, net <strong>{money(totals.net_minor, cur)}</strong>, for {fmtDate(run.period_start)} – {fmtDate(run.period_end)}. Approval is bound to fingerprint <span className="mono">{run.result_set_hash?.slice(0, 12)}…</span>. If anything changes you must review again. {openBlocking > 0 && <strong> {openBlocking} blocking exception(s) are still open.</strong>}</>}
          onConfirm={async () => { await post(`/pay/runs/${id}/approve`, { resultSetHash: run.result_set_hash }); toast('Approved'); reload(); }} />
      )}
      {act === 'release' && (
        <ConfirmModal title="Release payment" confirm="Release" danger onClose={() => setAct(null)} body={<>This instructs payment of the exact bank file <span className="mono">{run.bank_file_hash?.slice(0, 12)}…</span>. It cannot be recalled from this app.</>}
          onConfirm={async () => { await post(`/pay/runs/${id}/release`, { bankFileHash: run.bank_file_hash }); toast('Payment released'); reload(); }} />
      )}
      {act === 'mark-paid' && <MarkPaid onClose={() => setAct(null)} onDone={() => { toast('Marked paid'); reload(); }} id={run.id} />}
      {act && ['reject', 'reopen', 'cancel', 'reverse'].includes(act) && (
        <ConfirmModal title={({ reject: 'Send back to preparer', reopen: 'Reopen for changes', cancel: 'Cancel this run', reverse: 'Reverse this run' } as Record<string, string>)[act]} confirm="Confirm" danger={act !== 'reopen'} reasonLabel="Reason" minReason={act === 'reverse' ? 10 : 5}
          body={act === 'reopen' ? 'Any approval is voided and results must be recalculated.' : act === 'reverse' ? 'Payslips stay on record. Correct the amounts with a new run.' : undefined}
          onClose={() => setAct(null)} onConfirm={async (reason) => { await post(`/pay/runs/${id}/${act}`, { reason }); toast('Done'); reload(); }} />
      )}
      {act === 'unlock' && <ConfirmModal title="Back to draft" confirm="Go back" body="Inputs can be changed again. A new snapshot is taken when you lock." onClose={() => setAct(null)} onConfirm={async () => { await post(`/pay/runs/${id}/unlock`); toast('Back to draft'); reload(); }} />}
    </>
  );
}

function MarkPaid({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('bank_confirmation'); const [ev, setEv] = useState('');
  return (
    <FormModal title="Confirm the bank paid" submit="Confirm paid" onClose={onClose} onSubmit={async () => { await post(`/pay/runs/${id}/mark-paid`, { kind, evidence: ev }); onDone(); }}>
      <Field label="Evidence type"><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="bank_confirmation">Bank confirmation</option><option value="return_file">Bank return file</option><option value="manual">Manual check</option></select></Field>
      <Field label="Reference" hint="Bank reference or note, at least 5 characters."><textarea className="input" required minLength={5} maxLength={500} value={ev} onChange={(e) => setEv(e.target.value)} /></Field>
    </FormModal>
  );
}

function PayslipLink({ runId }: { runId: string }) {
  const p = useAsync(() => get<{ payslips: Array<{ id: string; employee_id: string; first_name?: string; last_name?: string; published_at: string | null }> }>(`/pay/runs/${runId}/payslips`), [runId]);
  if (!p.data) return null;
  return <div className="faint">{p.data.payslips.length} payslip(s) frozen{p.data.payslips.filter((x) => x.published_at).length ? `, ${p.data.payslips.filter((x) => x.published_at).length} published` : ', not yet published'}.</div>;
}
