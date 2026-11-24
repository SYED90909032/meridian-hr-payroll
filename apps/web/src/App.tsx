import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { SessionProvider, useSession } from './session';
import { ToastHost, Loading, useAsync, Avatar } from './ui';
import { get } from './api';
import { Login, Register, ChangePassword } from './pages/Auth';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const People = lazy(() => import('./pages/People'));
const Employee = lazy(() => import('./pages/Employee'));
const Org = lazy(() => import('./pages/Org'));
const Time = lazy(() => import('./pages/Time'));
const Leave = lazy(() => import('./pages/Leave'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Payroll = lazy(() => import('./pages/Payroll'));
const PayRun = lazy(() => import('./pages/PayRun'));
const Payslips = lazy(() => import('./pages/Payslips'));
const Helpdesk = lazy(() => import('./pages/Helpdesk'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Audit = lazy(() => import('./pages/Audit'));
const Security = lazy(() => import('./pages/Security'));
const Access = lazy(() => import('./pages/Access'));
const Integrations = lazy(() => import('./pages/Integrations'));

const ICONS: Record<string, string> = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  people: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 3.6-6 8-6s8 2 8 6',
  org: 'M12 3v6M5 21v-6h14v6M12 9v6M3 21h18',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  cal: 'M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  check: 'M5 12l5 5 9-10',
  money: 'M3 7h18v10H3zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 10v4M17 10v4',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 2.7-5 6-5M17 12a2.5 2.5 0 1 0 0-5M21 20c0-2.5-1.7-4.3-4-4.8',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
};
const Icon = ({ n }: { n: keyof typeof ICONS }) => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[n]} /></svg>;

function Shell() {
  const { me, signOut, can } = useSession();
  const nav = useNavigate();
  const counts = useAsync(() => get<{ my_pending_approvals: number; unread_notifications: number }>('/insight/overview').catch(() => ({ my_pending_approvals: 0, unread_notifications: 0 })), [me?.user.id]);
  if (!me) return <Navigate to="/login" replace />;
  if (me.user.mustChangePassword) return <Navigate to="/account/password" replace />;
  const pending = counts.data?.my_pending_approvals ?? 0;
  const L = ({ to, icon, children, badge }: { to: string; icon: keyof typeof ICONS; children: ReactNode; badge?: number }) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><Icon n={icon} />{children}{!!badge && <span className="badge">{badge}</span>}</NavLink>
  );
  const isPayStaff = can('pay.view');
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M8 23V9l8 9 8-9v14" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span>Meridian<small>{me.tenant?.name}</small></span>
        </div>
        <nav className="nav" aria-label="Main">
          <L to="/" icon="home">Overview</L>
          <L to="/approvals" icon="check" badge={pending}>Approvals</L>
          <div className="nav-group">People</div>
          <L to="/people" icon="people">Directory</L>
          <L to="/org" icon="org">Organisation</L>
          <L to="/time" icon="clock">Time</L>
          <L to="/leave" icon="cal">Leave</L>
          <div className="nav-group">Pay</div>
          {isPayStaff && <L to="/payroll" icon="money">Payroll</L>}
          <L to="/payslips" icon="doc">My payslips</L>
          <div className="nav-group">Support</div>
          <L to="/helpdesk" icon="help">Helpdesk</L>
          <L to="/assistant" icon="spark">Assistant</L>
          {(can('audit.read') || can('roles.view') || can('apikey.manage')) && <div className="nav-group">Control</div>}
          {can('audit.read') && <L to="/audit" icon="shield">Audit log</L>}
          {can('roles.view') && <L to="/settings/access" icon="users">Access and roles</L>}
          {(can('apikey.manage') || can('webhook.manage')) && <L to="/settings/integrations" icon="plug">Integrations</L>}
          <L to="/settings/security" icon="lock">My security</L>
        </nav>
        <div className="side-foot">
          <div className="who" style={{ padding: '4px 8px' }}>
            <Avatar name={me.user.displayName} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.user.displayName}</div>
              <div className="faint" style={{ fontSize: 12 }}>{me.roles.length ? me.roles.map((r) => r.replace(/_/g, ' ')).join(', ') : 'Employee'}</div>
            </div>
          </div>
          <button className="btn ghost sm" style={{ marginTop: 8, width: '100%' }} onClick={async () => { await signOut(); nav('/login'); }}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        {!me.user.totpEnabled && (can('pay.approve') || can('roles.manage') || can('pay.prepare') || me.roles.includes('owner')) && (
          <div className="topbar" style={{ background: '#fff4de', borderColor: '#f6dba5' }}>
            <span style={{ color: '#5f3a00' }}>Your role handles sensitive data. Turn on two-step verification.</span>
            <NavLink className="btn sm" to="/settings/security">Set up now</NavLink>
          </div>
        )}
        <div className="content"><Suspense fallback={<Loading />}><Outlet /></Suspense></div>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastHost>
        <SessionProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/account/password" element={<ChangePassword />} />
            <Route element={<Shell />}>
              <Route index element={<Dashboard />} />
              <Route path="people" element={<People />} />
              <Route path="people/:id" element={<Employee />} />
              <Route path="org" element={<Org />} />
              <Route path="time" element={<Time />} />
              <Route path="leave" element={<Leave />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="payroll" element={<Payroll />} />
              <Route path="payroll/:id" element={<PayRun />} />
              <Route path="payslips" element={<Payslips />} />
              <Route path="helpdesk" element={<Helpdesk />} />
              <Route path="helpdesk/:id" element={<Helpdesk />} />
              <Route path="assistant" element={<Assistant />} />
              <Route path="audit" element={<Audit />} />
              <Route path="settings/security" element={<Security />} />
              <Route path="settings/access" element={<Access />} />
              <Route path="settings/integrations" element={<Integrations />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </SessionProvider>
      </ToastHost>
    </BrowserRouter>
  );
}
