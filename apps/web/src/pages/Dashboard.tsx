/**
 * Overview dashboard, redesigned after Spike's dashboards/Ecommerce (WelcomeCard, KPI cards,
 * chart cards). Data sources and figures are unchanged from the previous version:
 *   /insight/overview, /insight/headcount-trend, /leave/balances, /flow/notifications.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Box, Card as MuiCard, Stack, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { get, fmtDate, days } from '../api';
import { useSession } from '../session';
import { Card, Chip, Empty, ErrorBox, IconBox, Loading, Stat, StatusChip, Table, useAsync, useChartColors } from '../ui';
import { SolarIcon } from '../icons/SolarIcon';

interface Overview {
  headcount: Record<string, number>; by_unit: Array<{ unit: string; n: number }>; joiners_30d: number; on_leave_today: number; my_pending_approvals: number; unread_notifications: number;
  attendance_today: Record<string, number>; late_punch_reviews: number; open_tickets: number; recent_pay_runs: Array<{ id: string; period_start: string; period_end: string; status: string; mode: string; run_type: string }>;
}

/** "2026-11" -> "Nov 26" for chart axes. */
const monthLabel = (m: string) => { const [y, mo] = m.split('-'); return new Date(Date.UTC(Number(y), Number(mo) - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };

/** Spike WelcomeCard: greeting, two mini stats, actions, illustration on the right (md+). */
function Welcome({ greet, first, sub, joiners, pending }: { greet: string; first: string; sub: string; joiners?: number; pending?: number }) {
  return (
    <MuiCard sx={{ mb: '30px', bgcolor: 'primary.light', position: 'relative', overflow: 'hidden' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'flex-end' }} sx={{ minHeight: { md: 200 } }}>
        <Box sx={{ p: { xs: 3, md: 3.75 }, flex: 1, minWidth: 0, zIndex: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: 'primary.main', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}><SolarIcon icon="solar:user-rounded-line-duotone" size={22} /></Box>
            <Typography variant="h5" component="h1" sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>{greet}, {first}!</Typography>
          </Stack>
          <Typography color="text.secondary" sx={{ mb: 2.5 }}>{sub}</Typography>
          {(joiners !== undefined || pending !== undefined) && (
            <Stack direction="row" spacing={{ xs: 3, sm: 5 }} sx={{ mb: 2.5 }} divider={<Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider' }} />}>
              {joiners !== undefined && <Box><Typography variant="h3" component="div" sx={{ fontSize: '1.5rem' }}>{joiners}</Typography><Typography color="text.secondary" sx={{ fontSize: '0.8125rem' }}>Joined in 30 days</Typography></Box>}
              {pending !== undefined && <Box><Typography variant="h3" component="div" sx={{ fontSize: '1.5rem' }}>{pending}</Typography><Typography color="text.secondary" sx={{ fontSize: '0.8125rem' }}>Waiting on you</Typography></Box>}
            </Stack>
          )}
          <div className="actions">
            <Link className="btn primary" to="/leave">Request leave</Link>
            <Link className="btn" to="/helpdesk">Ask for help</Link>
          </div>
        </Box>
        <Box component="img" src="/images/dashboards/welcome-illustration.png" alt="" aria-hidden
          sx={{ display: { xs: 'none', md: 'block' }, width: 300, maxWidth: '38%', height: 'auto', alignSelf: 'flex-end', mr: 3.75, mt: 2 }} />
      </Stack>
    </MuiCard>
  );
}

export default function Dashboard() {
  const { me, can } = useSession();
  const theme = useTheme();
  const colors = useChartColors();
  const smDown = useMediaQuery(theme.breakpoints.down('sm'));
  const first = me!.user.displayName.split(' ')[0]!;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const sub = `${me!.tenant?.name} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  useEffect(() => { document.title = 'Overview · Meridian'; }, []);
  const ov = useAsync(() => (can('insight.read') ? get<Overview>('/insight/overview') : Promise.resolve(null)), [me?.user.id]);
  const trend = useAsync(() => (can('insight.read') ? get<{ months: Array<{ month: string; headcount: number }> }>('/insight/headcount-trend') : Promise.resolve(null)), [me?.user.id]);
  const bal = useAsync(() => (me!.user.employeeId ? get<{ balances: Array<{ name: string; special: boolean; balance_x1000: number; pending_x1000: number }> }>('/leave/balances') : Promise.resolve(null)), [me?.user.id]);
  const notes = useAsync(() => get<{ notifications: Array<{ id: string; title: string; kind: string; link: string | null; read_at: string | null; created_at: string }>; unread: number }>('/flow/notifications'), []);
  const o = ov.data;
  const months = trend.data?.months ?? [];
  const units = o?.by_unit ?? [];
  const unitTotal = units.reduce((a, u) => a + u.n, 0);
  const leave = bal.data?.balances.filter((b) => !b.special) ?? [];
  const tickText = { fill: theme.palette.text.secondary, fontSize: 12, fontFamily: theme.typography.fontFamily } as const;

  return (
    <>
      <Welcome greet={greet} first={first} sub={sub} joiners={o?.joiners_30d} pending={o?.my_pending_approvals} />
      {ov.error && <ErrorBox error={ov.error} retry={ov.reload} />}
      {can('insight.read') && (ov.loading ? <Loading /> : o && (
        <div className="grid g4" style={{ marginBottom: 30 }}>
          <Stat k="Active people" icon="solar:users-group-rounded-line-duotone" color="primary" v={o.headcount.active ?? 0} s={`${o.joiners_30d} joined in 30 days`} />
          <Stat k="On leave today" icon="solar:plane-line-duotone" color="warning" v={o.on_leave_today} s={Object.entries(o.attendance_today).map(([k, v]) => `${v} ${k}`).join(' · ') || 'No attendance computed yet'} />
          <Stat k="Waiting on you" icon="solar:checklist-minimalistic-line-duotone" color="success" v={<Link to="/approvals">{o.my_pending_approvals}</Link>} s="Approvals in your inbox" />
          <Stat k="Open tickets" icon="solar:ticket-line-duotone" color="error" v={o.open_tickets} s={o.late_punch_reviews ? `${o.late_punch_reviews} late punches to review` : 'Helpdesk queue'} />
        </div>
      ))}
      <div className="grid g-main">
        <div className="grid" style={{ alignContent: 'start' }}>
          {can('insight.read') && (
            <Card title="Headcount, last 12 months" actions={months.length ? <Chip tone="info">{months[months.length - 1]!.headcount} now</Chip> : undefined}>
              {trend.loading ? <Loading /> : months.length ? (
                <Box role="img" aria-label="Headcount by month" sx={{ mx: -1.5, mb: -1.5, minWidth: 160 /* keeps the plot area positive before the container is measured */ }}>
                  <BarChart height={smDown ? 220 : 280} hideLegend borderRadius={6} skipAnimation
                    margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
                    xAxis={[{ scaleType: 'band', data: months.map((m) => monthLabel(m.month)), categoryGapRatio: 0.45, disableLine: true, disableTicks: true, tickLabelStyle: tickText, tickLabelInterval: smDown ? (_v: string, i: number) => i % 3 === 0 : 'auto' }]}
                    yAxis={[{ disableLine: true, disableTicks: true, tickLabelStyle: tickText, tickMinStep: 1, width: 36 }]}
                    series={[{ data: months.map((m) => m.headcount), label: 'Headcount', color: theme.palette.primary.main }]}
                    grid={{ horizontal: true }}
                    sx={{ '& .MuiChartsGrid-line': { stroke: theme.palette.divider, strokeDasharray: '4 4' } }} />
                </Box>
              ) : <Empty title="No history yet" />}
            </Card>
          )}
          {can('pay.view') && o && (
            <Card title="Recent pay runs" actions={<Link to="/payroll" className="btn sm">All runs</Link>} flush>
              {o.recent_pay_runs.length ? (
                <Table head={['Period', 'Type', 'Mode', 'Status']}>
                  {o.recent_pay_runs.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap"><Link to={`/payroll/${r.id}`} className="who" style={{ color: 'inherit' }}><IconBox icon="solar:wallet-money-line-duotone" color="success" size={38} iconSize={20} radius={10} /><span style={{ fontWeight: 600 }}>{fmtDate(r.period_start)} to {fmtDate(r.period_end)}</span></Link></td>
                      <td style={{ textTransform: 'capitalize' }}>{r.run_type}</td><td><Chip tone={r.mode === 'live' ? 'warn' : ''}>{r.mode}</Chip></td><td><StatusChip status={r.status} /></td>
                    </tr>
                  ))}
                </Table>
              ) : <Empty title="No pay runs yet">Start one from Payroll.</Empty>}
            </Card>
          )}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          {units.length > 0 && (
            <Card title="People by team">
              <Box sx={{ position: 'relative', height: 200, mb: 2 }}>
                <PieChart height={200} hideLegend margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  series={[{ data: units.map((u, i) => ({ id: u.unit, value: u.n, label: u.unit, color: colors[i % colors.length] })), innerRadius: 64, outerRadius: 92, paddingAngle: 2, cornerRadius: 5, cx: '50%' }]} />
                <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
                  <Box><Typography variant="h3" component="div" sx={{ fontSize: '1.5rem' }}>{unitTotal}</Typography><Typography color="text.secondary" sx={{ fontSize: '0.75rem' }}>people</Typography></Box>
                </Box>
              </Box>
              <Stack spacing={1.25}>
                {units.map((u, i) => (
                  <Stack key={u.unit} direction="row" alignItems="center" spacing={1.25}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: colors[i % colors.length], flex: 'none' }} />
                    <Typography sx={{ flex: 1, minWidth: 0 }} noWrap>{u.unit}</Typography>
                    <Typography className="num" sx={{ fontWeight: 600 }}>{u.n}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Card>
          )}
          {bal.data && (
            <Card title="Your leave" actions={<Link className="btn sm" to="/leave">Open</Link>} flush>
              {leave.length ? (
                <ul className="list">{leave.map((b, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <IconBox icon={i % 3 === 0 ? 'solar:plane-line-duotone' : i % 3 === 1 ? 'solar:alarm-line-duotone' : 'solar:calendar-mark-line-duotone'} color={(['primary', 'error', 'warning'] as const)[i % 3]} size={40} iconSize={20} radius={10} />
                    <span style={{ flex: 1, minWidth: 0 }}>{b.name}</span><strong className="num">{days(b.balance_x1000)} days</strong>
                  </li>
                ))}</ul>
              ) : <Empty title="No balances yet" />}
            </Card>
          )}
          <Card title="Notifications" flush>
            {notes.loading ? <Loading /> : notes.data && notes.data.notifications.length ? (
              <ul className="list">{notes.data.notifications.slice(0, 8).map((n) => (
                <li key={n.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <Box sx={{ width: 8, height: 8, mt: 0.9, borderRadius: '50%', flex: 'none', bgcolor: n.read_at ? 'divider' : 'primary.main' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.link ? <Link to={n.link} style={{ color: 'inherit' }}>{n.title}</Link> : n.title}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{fmtDate(n.created_at)}</div>
                  </div>
                </li>
              ))}</ul>
            ) : <Empty title="All caught up" />}
          </Card>
        </div>
      </div>
    </>
  );
}
