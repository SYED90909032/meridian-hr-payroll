import { useState } from 'react';
import { fmtDate, get, money } from '../api';
import { useMe } from '../session';
import { Banner, Card, Empty, ErrorBox, Loading, PageHead, Table, useAsync } from '../ui';

interface Row { id: string; pay_run_id: string; period: { start: string; end: string }; totals: { gross_minor: number; deductions_minor: number; net_minor: number }; currency: string; run: { type: string; mode: string }; published_at: string }
interface Slip { id: string; content_hash: string; published_at: string; content: { employee: { name: string; employee_no: string; job_title?: string }; period: { start: string; end: string; days_payable: number | null; days_in_period: number | null }; run: { type: string; mode: string }; currency: string; lines: Array<{ code: string; label: string; kind: string; amount_minor: number; explain: string }>; employer_contributions: Array<{ code: string; label: string; amount_minor: number }>; totals: { gross_minor: number; deductions_minor: number; net_minor: number }; provenance: { pack: string; result_hash: string } } }

export default function Payslips() {
  const me = useMe();
  const list = useAsync(() => get<{ payslips: Row[] }>('/me/payslips'), []);
  const [sel, setSel] = useState<string | null>(null);
  if (!me.user.employeeId) return <><PageHead title="Payslips" /><Banner tone="info">Your login is not linked to an employee record, so there are no payslips for you.</Banner></>;
  return (
    <>
      <PageHead title="My payslips" sub="Only payslips that payroll has published to you appear here." />
      {sel ? <Detail id={sel} back={() => setSel(null)} /> : (
        <Card flush>
          {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : list.loading && !list.data ? <Loading /> : list.data!.payslips.length ? (
            <Table head={['Period', 'Type', { label: 'Gross', num: true }, { label: 'Net pay', num: true }, '']}>
              {list.data!.payslips.map((p) => (
                <tr key={p.id} className="click" onClick={() => setSel(p.id)}><td><strong>{fmtDate(p.period.start)} – {fmtDate(p.period.end)}</strong></td><td>{p.run.type.replace('_', '-')}{p.run.mode !== 'live' ? ` (${p.run.mode})` : ''}</td>
                  <td className="num">{money(p.totals.gross_minor, p.currency)}</td><td className="num"><strong>{money(p.totals.net_minor, p.currency)}</strong></td><td className="right"><button className="btn sm ghost">View</button></td></tr>
              ))}
            </Table>
          ) : <Empty title="No payslips yet">When payroll publishes a run, your payslip appears here.</Empty>}
        </Card>
      )}
    </>
  );
}

function Detail({ id, back }: { id: string; back: () => void }) {
  const d = useAsync(() => get<Slip>(`/me/payslips/${id}`), [id]);
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data) return <Loading />;
  const c = d.data.content; const cur = c.currency;
  const earn = c.lines.filter((l) => l.kind === 'earning'); const ded = c.lines.filter((l) => l.kind === 'deduction');
  return (
    <div className="payslip">
      <div className="row no-print" style={{ marginBottom: 12 }}><button className="btn" onClick={back}>Back</button><button className="btn" onClick={() => window.print()}>Print</button></div>
      {c.run.mode !== 'live' && <Banner tone="warn">This is a {c.run.mode} run for rehearsal. It is not a real payment.</Banner>}
      <Card>
        <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div><h2 style={{ margin: 0 }}>{c.employee.name}</h2><div className="muted">{c.employee.employee_no}{c.employee.job_title ? ` · ${c.employee.job_title}` : ''}</div></div>
          <div className="right"><div><strong>{fmtDate(c.period.start)} – {fmtDate(c.period.end)}</strong></div>{c.period.days_payable != null && <div className="muted">{c.period.days_payable} of {c.period.days_in_period} days payable</div>}</div>
        </div>
      </Card>
      <div style={{ height: 12 }} />
      <Card title="Earnings" flush><Lines rows={earn} cur={cur} /></Card>
      <div style={{ height: 12 }} />
      <Card title="Deductions" flush>{ded.length ? <Lines rows={ded} cur={cur} neg /> : <div className="card-b faint">None.</div>}</Card>
      <div style={{ height: 12 }} />
      <Card>
        <dl className="kv"><dt>Gross</dt><dd>{money(c.totals.gross_minor, cur)}</dd><dt>Deductions</dt><dd>−{money(c.totals.deductions_minor, cur)}</dd><dt><strong>Net pay</strong></dt><dd style={{ fontSize: 20, fontWeight: 650 }}>{money(c.totals.net_minor, cur)}</dd></dl>
      </Card>
      {c.employer_contributions.length > 0 && <><div style={{ height: 12 }} /><Card title="Paid by your employer on top (not deducted from you)" flush><Table head={['Item', { label: 'Amount', num: true }]}>{c.employer_contributions.map((l) => <tr key={l.code}><td>{l.label}</td><td className="num">{money(l.amount_minor, cur)}</td></tr>)}</Table></Card></>}
      <p className="faint mono" style={{ marginTop: 12, fontSize: 11 }}>Rule pack {c.provenance.pack} · fingerprint {d.data.content_hash.slice(0, 20)}…</p>
    </div>
  );
}

function Lines({ rows, cur, neg }: { rows: Array<{ code: string; label: string; amount_minor: number; explain: string }>; cur: string; neg?: boolean }) {
  return (
    <Table head={['Item', { label: 'Amount', num: true }]}>
      {rows.map((l, i) => <tr key={l.code + i}><td><div style={{ fontWeight: 550 }}>{l.label}</div><div className="faint" style={{ fontSize: 12 }}>{l.explain}</div></td><td className="num">{neg ? '−' : ''}{money(l.amount_minor, cur)}</td></tr>)}
    </Table>
  );
}
