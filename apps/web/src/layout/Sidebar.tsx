/**
 * Sidebar: ported from Spike's layouts/full/vertical/sidebar (Sidebar, NavItems, NavGroup, SidebarProfile).
 *  - lg and up: floating card, 270px wide, 20px from the viewport edges; collapses to an 87px icon rail.
 *  - below lg: temporary MUI Drawer opened by the header hamburger.
 *  - nav pills: 50px tall, rounded on the right only, `<color>.light` background when active.
 */
import { Badge, Box, Card, Drawer, IconButton, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Link, useLocation } from 'react-router-dom';
import { SolarIcon } from '../icons/SolarIcon';
import { Avatar } from '../ui';
import { LAYOUT } from '../theme/tokens';
import { Logo, LogoMark } from './Logo';
import { isActivePath, type NavSection } from './navConfig';

interface Props {
  sections: NavSection[];
  pending: number;
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
  tenant?: string;
  user: { name: string; role: string };
  onSignOut: () => void;
}

function NavList({ sections, pending, collapsed, onNavigate }: { sections: NavSection[]; pending: number; collapsed: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  return (
    <Box component="nav" aria-label="Main" sx={{ pr: collapsed ? 0 : 3, pb: 2 }}>
      {sections.filter((s) => s.items.length).map((s) => (
        <Box key={s.caption} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {collapsed
            ? <Box component="li" aria-hidden sx={{ height: 1, mx: 3, my: 1.5, bgcolor: 'divider' }} />
            : <Box component="li" sx={{ pl: '30px', pt: 2, pb: 0.75, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: (t) => t.tokens.navCaption }}>{s.caption}</Box>}
          {s.items.map((it) => {
            const active = isActivePath(pathname, it.to);
            const badge = it.badge === 'approvals' ? pending : 0;
            const pill = (
              <Box component={Link} to={it.to} onClick={onNavigate} aria-current={active ? 'page' : undefined}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.75, height: LAYOUT.navItemHeight, mb: 0.5, textDecoration: 'none !important',
                  pl: collapsed ? 0 : '30px', justifyContent: collapsed ? 'center' : 'flex-start', mx: collapsed ? 1.5 : 0,
                  borderRadius: collapsed ? '12px' : '0 999px 999px 0', fontSize: '0.9375rem',
                  color: (t) => (active ? t.tokens.onTint[it.color] : t.palette.text.secondary), bgcolor: active ? `${it.color}.light` : 'transparent', fontWeight: active ? 600 : 500,
                  transition: 'background-color .15s, color .15s',
                  '&:hover': { bgcolor: `${it.color}.light`, color: (t) => t.tokens.onTint[it.color] },
                }}>
                <Badge color="error" variant="dot" invisible={!collapsed || !badge}><SolarIcon icon={it.icon} size={21} /></Badge>
                {!collapsed && <Box component="span" sx={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</Box>}
                {!collapsed && !!badge && <Box component="span" sx={{ mr: 2, minWidth: 22, height: 22, px: 0.75, borderRadius: 999, bgcolor: `${it.color}.main`, color: '#fff', fontSize: '0.6875rem', fontWeight: 700, display: 'grid', placeItems: 'center' }}>{badge}</Box>}
              </Box>
            );
            return <Box component="li" key={it.to}>{collapsed ? <Tooltip title={it.label} placement="right">{pill}</Tooltip> : pill}</Box>;
          })}
        </Box>
      ))}
    </Box>
  );
}

/** Spike's SidebarProfile: tinted card with avatar, name, role and a logout button. */
function ProfileCard({ user, onSignOut }: { user: Props['user']; onSignOut: () => void }) {
  return (
    <Box sx={{ mx: 3, mb: 3, mt: 1, px: 2, py: 1.75, borderRadius: '12px', bgcolor: 'primary.light', display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Avatar name={user.name} size={40} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.875rem', color: 'text.primary' }}>{user.name}</Typography>
        <Typography noWrap sx={{ fontSize: '0.75rem', color: 'text.secondary', textTransform: 'capitalize' }}>{user.role}</Typography>
      </Box>
      <Tooltip title="Sign out"><IconButton size="small" onClick={onSignOut} aria-label="Sign out" sx={{ color: 'primary.main' }}><SolarIcon icon="solar:logout-line-duotone" size={22} /></IconButton></Tooltip>
    </Box>
  );
}

export function Sidebar({ sections, pending, collapsed, mobileOpen, onMobileClose, tenant, user, onSignOut }: Props) {
  const theme = useTheme();
  const lgUp = useMediaQuery(theme.breakpoints.up('lg'));
  const body = (mini: boolean, close?: () => void) => (
    <Stack sx={{ height: '100%' }}>
      <Box sx={{ height: LAYOUT.headerHeight, flex: 'none', display: 'flex', alignItems: 'center', px: mini ? 0 : 3.75, justifyContent: mini ? 'center' : 'flex-start' }}>
        {mini ? <LogoMark /> : <Logo sub={tenant} />}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', maskImage: 'linear-gradient(to bottom, #000 calc(100% - 24px), transparent)' }}><NavList sections={sections} pending={pending} collapsed={mini} onNavigate={close} /></Box>
      {!mini && <ProfileCard user={user} onSignOut={onSignOut} />}
    </Stack>
  );
  if (!lgUp) {
    return (
      <Drawer open={mobileOpen} onClose={onMobileClose} slotProps={{ paper: { sx: { width: LAYOUT.sidebarWidth, borderRadius: '0 18px 18px 0' } } }}>
        {body(false, onMobileClose)}
      </Drawer>
    );
  }
  const width = collapsed ? LAYOUT.miniSidebarWidth : LAYOUT.sidebarWidth;
  return (
    <Box component="aside" sx={{ width: width + LAYOUT.outerGap, flex: 'none', transition: 'width .2s ease' }}>
      <Card sx={{ position: 'fixed', top: LAYOUT.outerGap, bottom: LAYOUT.outerGap, left: LAYOUT.outerGap, width, transition: 'width .2s ease', overflow: 'hidden', zIndex: 1100 }}>
        {body(collapsed)}
      </Card>
    </Box>
  );
}
