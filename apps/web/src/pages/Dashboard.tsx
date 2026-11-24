import { Link } from 'react-router-dom';
import { get, fmtDate, days } from '../api';
import { useSession } from '../session';
import { Card, Chip, Empty, ErrorBox, Loading, PageHead, Stat, StatusChip, Table, useAsync } from '../ui';

interface Overview {
  headcount: Record<string, number>; by_unit: Array<{ unit: string; n: number }>; joiners_30d: number; on_leave_today: number; my_pending_approvals: number; unread_notifications: number;
  attendance_today: Record<string, number>; late_punch_reviews: number; open_tickets: number; recent_pay_runs: Array<{ id: string; period_start: string; period_end: string; status: string; mode: string; run_type: string }>;
}

export default function Dashboard() {
  const { me, can } = useSession();
  const first = me!.user.displayName.split(' ')[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const ov = useAsync(() => (can('insight.read') ? get<Overview>('/insight/overview') : Promise.resolve(null)), [me?.user.id]);
  const trend = useAsync(() => (can('insight.read') ? get<{ months: Array<{ month: string; headcount: number }> }>('/insight/headcount-trend') : Promise.resolve(null)), [me?.user.id]);
  const bal = useAsync(() => (me!.user.employeeId ? get<{ balances: Array<{ name: string; special: boolean; balance_x1000: number; pending_x1000: number }> }>('/leave/balances') : Promise.resolve(null)), [me?.user.id]);
  const notes = useAsync(() => get<{ notifications: Array<{ id: string; title: string; kind: string; link: string | null; read_at: string | null; created_at: string }>; unread: number }>('/flow/notifications'), []);
  const o = ov.data;
  const maxHc = Math.max(1, ...(trend.data?.months.map((m) => m.headcount) ?? [1]));
  return (
    <>
      <PageHead title={`${greet}, ${first}`} sub={`${me!.tenant?.name} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`}>
        <Link className="btn" to="/leave">Request leave</Link>
        <Link className="btn primary" to="/helpdesk">Ask for help</Link>
      </PageHead>
      {ov.error && <ErrorBox error={ov.error} retry={ov.reload} />}
      {can('insight.read') && (ov.loading ? <Loading /> : o && (
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Stat k="Active people" v={o.headcount.active ?? 0} s={`${o.joiners_30d} joined in 30 days`} />
          <Stat k="On leave today" v={o.on_leave_today} s={Object.entries(o.attendance_today).map(([k, v]) => `${v} ${k}`).join(' · ') || 'No attendance computed yet'} />
          <Stat k="Waiting on you" v={<Link to="/approvals" style={{ color: 'inherit' }}>{o.my_pending_approvals}</Link>} s="Approvals in your inbox" />
          <Stat k="Open tickets" v={o.open_tickets} s={o.late_punch_reviews ? `${o.late_punch_reviews} late punches to review` : 'Helpdesk queue'} />
        </div>
      ))}
      <div className="grid g-main">
        <div className="grid" style={{ alignContent: 'start' }}>
          {can('insight.read') && (
            <Card title="Headcount, last 12 months">
              {trend.loading ? <Loading /> : trend.data && trend.data.months.length ? (
                <>
                  <div className="bars" role="img" aria-label="Headcount by month">
                    {trend.data.months.map((m) => <div key={m.month} className="bar" style={{ height: `${Math.max(4, (m.headcount / maxHc) * 100)}%` }} title={`${m.month}: ${m.headcount}`} />)}
                  </div>
                  <div className="row faint" style={{ fontSize: 12, marginTop: 6 }}><span>{trend.data.months[0]!.month}</span><span className="right">{trend.data.months[trend.data.months.length - 1]!.month}</span></div>
                </>
              ) : <Empty title="No history yet" />}
            </Card>
          )}
          {can('pay.view') && o && (
            <Card title="Recent pay runs" actions={<Link to="/payroll" className="btn sm">All runs</Link>} flush>
              {o.recent_pay_runs.length ? (
                <Table head={['Period', 'Type', 'Mode', 'Status']}>
                  {o.recent_pay_runs.map((r) => (
                    <tr key={r.id}><td><Link to={`/payroll/${r.id}`}>{fmtDate(r.period_start)} to {fmtDate(r.period_end)}</Link></td><td>{r.run_type}</td><td><Chip tone={r.mode === 'live' ? 'warn' : ''}>{r.mode}</Chip></td><td><StatusChip status={r.status} /></td></tr>
                  ))}
                </Table>
              ) : <Empty title="No pay runs yet">Start one from Payroll.</Empty>}
            </Card>
          )}
          {o && o.by_unit.length > 0 && (
            <Card title="People by team" flush>
              <Table head={['Team', { label: 'People', num: true }]}>
                {o.by_unit.map((u) => <tr key={u.unit}><td>{u.unit}</td><td className="num">{u.n}</td></tr>)}
              </Table>
            </Card>
          )}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          {bal.data && (
            <Card title="Your leave" actions={<Link className="btn sm" to="/leave">Open</Link>} flush>
              {bal.data.balances.filter((b) => !b.special).length ? (
                <ul className="list">{bal.data.balances.filter((b) => !b.special).map((b, i) => <li key={i} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{b.name}</span><strong>{days(b.balance_x1000)} days</strong></li>)}</ul>
              ) : <Empty title="No balances yet" />}
            </Card>
          )}
          <Card title="Notifications" flush>
            {notes.loading ? <Loading /> : notes.data && notes.data.notifications.length ? (
              <ul className="list">{notes.data.notifications.slice(0, 8).map((n) => (
                <li key={n.id}><div style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.link ? <Link to={n.link} style={{ color: 'inherit' }}>{n.title}</Link> : n.title}</div><div className="faint" style={{ fontSize: 12 }}>{fmtDate(n.created_at)}</div></li>
              ))}</ul>
            ) : <Empty title="All caught up" />}
          </Card>
        </div>
      </div>
    </>
  );
}
