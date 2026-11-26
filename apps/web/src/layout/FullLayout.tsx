/**
 * FullLayout: Spike's layouts/full/FullLayout adapted to Meridian.
 * Replaces the old App.tsx Shell; behaviour is identical:
 *  - not signed in -> /login; must change password -> /account/password
 *  - approvals badge from /insight/overview
 *  - two-step verification reminder for sensitive roles (now an Alert under the header)
 * Responsive: floating sidebar and boxed 1200px container on lg+, drawer navigation below lg.
 */
import { Suspense, useEffect, useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { get } from '../api';
import { Loading, useAsync } from '../ui';
import { SolarIcon } from '../icons/SolarIcon';
import { LAYOUT } from '../theme/tokens';
import { buildNav } from './navConfig';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

const MINI_KEY = 'meridian:sidebar-mini';

export function FullLayout() {
  const { me, signOut, can } = useSession();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mini, setMini] = useState(() => { try { return localStorage.getItem(MINI_KEY) === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem(MINI_KEY, mini ? '1' : '0'); } catch { /* ignore */ } }, [mini]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  const counts = useAsync(() => get<{ my_pending_approvals: number; unread_notifications: number }>('/insight/overview').catch(() => ({ my_pending_approvals: 0, unread_notifications: 0 })), [me?.user.id]);

  if (!me) return <Navigate to="/login" replace />;
  if (me.user.mustChangePassword) return <Navigate to="/account/password" replace />;

  const sections = buildNav(can);
  const pending = counts.data?.my_pending_approvals ?? 0;
  const role = me.roles.length ? me.roles.map((r) => r.replace(/_/g, ' ')).join(', ') : 'Employee';
  const out = async () => { await signOut(); nav('/login'); };
  const needs2fa = !me.user.totpEnabled && (can('pay.approve') || can('roles.manage') || can('pay.prepare') || me.roles.includes('owner'));
  const onMenu = () => { if (window.matchMedia('(min-width: 1200px)').matches) setMini((m) => !m); else setMobileOpen(true); };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      <Sidebar sections={sections} pending={pending} collapsed={mini} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)}
        tenant={me.tenant?.name} user={{ name: me.user.displayName, role }} onSignOut={out} />
      <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ width: '100%', maxWidth: LAYOUT.containerMax + 2 * LAYOUT.containerPadding, mx: 'auto', px: { xs: 1.5, sm: 2.5, lg: `${LAYOUT.containerPadding}px` }, pt: { xs: 0, lg: `${LAYOUT.outerGap}px` }, pb: 6 }}>
          <Header sections={sections} onMenu={onMenu} name={me.user.displayName} email={me.user.email} role={role} onSignOut={out} />
          {needs2fa && (
            <Alert severity="warning" className="no-print" icon={<SolarIcon icon="solar:shield-warning-line-duotone" size={24} />}
              sx={{ mb: 3.75, bgcolor: 'warning.light', color: (t) => t.tokens.onTint.warning, '& .MuiAlert-icon': { color: 'warning.main' }, '& .MuiAlert-message': { flex: 1 } }}
              action={<Button component={Link} to="/settings/security" variant="contained" size="small" sx={{ bgcolor: (t) => t.tokens.onTint.warning, color: '#fff', whiteSpace: 'nowrap', '&:hover': { bgcolor: 'warning.dark' } }}>Set up now</Button>}>
              Your role handles sensitive data. Turn on two-step verification.
            </Alert>
          )}
          <Suspense fallback={<Loading />}><Outlet /></Suspense>
        </Box>
      </Box>
    </Box>
  );
}
