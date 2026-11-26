/**
 * Header: ported from Spike's layouts/full/vertical/header (Header, Search, Notifications, Profile).
 * Sticky floating card, 70px tall, 20px from the top. Contains:
 *  - hamburger (toggles the mini sidebar on lg+, opens the drawer below lg)
 *  - quick page search (jumps to any page the user can see, filtered from the nav model)
 *  - light/dark toggle, notifications dropdown (GET /flow/notifications, POST /flow/notifications/read)
 *  - profile dropdown (avatar, role, profile picture, security, sign out)
 */
import { useMemo, useState, type MouseEvent } from 'react';
import { Badge, Box, Button, Card, Divider, IconButton, InputBase, List, ListItemButton, Menu, Popover, Stack, Tooltip, Typography } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import { get, post, fmtDate } from '../api';
import { SolarIcon } from '../icons/SolarIcon';
import { useColorMode } from '../theme/ThemeRoot';
import { ThemeToggleIcon } from '../theme/ThemeToggleIcon';
import { LAYOUT } from '../theme/tokens';
import { Avatar, AvatarPicker, IconBox, Modal, useAsync } from '../ui';
import type { NavSection } from './navConfig';

interface Note { id: string; title: string; kind: string; body?: string | null; link: string | null; read_at: string | null; created_at: string }

const iconBtnSx = { width: 42, height: 42, color: 'text.secondary', '&:hover': { color: 'primary.main', bgcolor: 'primary.light' } } as const;

function QuickSearch({ sections }: { sections: NavSection[] }) {
  const nav = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState('');
  const all = useMemo(() => sections.flatMap((s) => s.items.map((i) => ({ ...i, caption: s.caption }))), [sections]);
  const hits = all.filter((i) => (i.label + ' ' + i.caption).toLowerCase().includes(q.trim().toLowerCase()));
  const go = (to: string) => { setAnchor(null); setQ(''); nav(to); };
  return (
    <>
      <Box component="button" type="button" onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)} aria-label="Search pages"
        sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 1.25, width: 200, height: 42, px: 2, borderRadius: 999, border: 1, borderColor: 'divider', bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer', fontSize: '0.875rem', '&:hover': { borderColor: 'primary.main', color: 'primary.main' } }}>
        <SolarIcon icon="solar:magnifier-linear" size={18} /> Search pages…
      </Box>
      <IconButton sx={{ ...iconBtnSx, display: { sm: 'none' } }} onClick={(e) => setAnchor(e.currentTarget)} aria-label="Search pages"><SolarIcon icon="solar:magnifier-linear" size={21} /></IconButton>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: -8, horizontal: 'left' }} slotProps={{ paper: { sx: { width: 340, p: 1.5 } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 44, borderRadius: '9px', border: 1, borderColor: 'divider', mb: 1 }}>
          <SolarIcon icon="solar:magnifier-linear" size={18} color="inherit" />
          <InputBase autoFocus fullWidth placeholder="Type a page name" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) go(hits[0].to); }} inputProps={{ 'aria-label': 'Page name' }} />
        </Box>
        <List dense sx={{ maxHeight: 320, overflow: 'auto', p: 0 }}>
          {hits.map((h) => (
            <ListItemButton key={h.to} onClick={() => go(h.to)} sx={{ borderRadius: '9px', gap: 1.5, py: 1 }}>
              <IconBox icon={h.icon} color={h.color} size={34} iconSize={18} radius={8} />
              <Box><Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }}>{h.label}</Typography><Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{h.caption}</Typography></Box>
            </ListItemButton>
          ))}
          {!hits.length && <Typography sx={{ p: 2, color: 'text.secondary', textAlign: 'center' }}>No page matches “{q}”.</Typography>}
        </List>
      </Popover>
    </>
  );
}

function Notifications() {
  const nav = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const notes = useAsync(() => get<{ notifications: Note[]; unread: number }>('/flow/notifications').catch(() => ({ notifications: [], unread: 0 })), []);
  const list = notes.data?.notifications ?? [];
  const unread = notes.data?.unread ?? 0;
  const markAll = async () => { try { await post('/flow/notifications/read', {}); } finally { notes.reload(); } };
  const open = async (n: Note) => {
    setAnchor(null);
    if (!n.read_at) { try { await post('/flow/notifications/read', { ids: [n.id] }); } catch { /* not critical */ } notes.reload(); }
    if (n.link) nav(n.link.replace(/^#/, ''));
  };
  return (
    <>
      <Tooltip title="Notifications">
        <IconButton sx={iconBtnSx} onClick={(e) => { setAnchor(e.currentTarget); notes.reload(); }} aria-label={`Notifications, ${unread} unread`}>
          <Badge color="success" variant="dot" invisible={!unread} overlap="circular"><SolarIcon icon="solar:bell-bing-line-duotone" size={23} /></Badge>
        </IconButton>
      </Tooltip>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { width: 360, mt: 1 } }, list: { sx: { p: 0 } } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 3, py: 2 }}>
          <Typography variant="h6">Notifications</Typography>
          {unread > 0 && <Box sx={{ px: 1.25, py: 0.25, borderRadius: 999, bgcolor: 'primary.main', color: '#fff', fontSize: '0.75rem', fontWeight: 600 }}>{unread} new</Box>}
        </Stack>
        <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
          {list.slice(0, 8).map((n) => (
            <ListItemButton key={n.id} onClick={() => open(n)} sx={{ px: 3, py: 1.5, gap: 1.75, alignItems: 'flex-start' }}>
              <IconBox icon={n.kind.includes('pay') ? 'solar:wallet-money-line-duotone' : n.kind.includes('leave') ? 'solar:calendar-line-duotone' : n.kind.includes('ticket') || n.kind.includes('case') ? 'solar:chat-round-dots-line-duotone' : n.kind.includes('approv') ? 'solar:checklist-minimalistic-line-duotone' : 'solar:bell-bing-line-duotone'}
                color={n.read_at ? 'secondary' : 'primary'} size={42} iconSize={21} radius={21} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: n.read_at ? 500 : 600, fontSize: '0.875rem', whiteSpace: 'normal' }}>{n.title}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{fmtDate(n.created_at)}</Typography>
              </Box>
              {!n.read_at && <Box sx={{ width: 8, height: 8, mt: 0.75, borderRadius: '50%', bgcolor: 'primary.main', flex: 'none' }} />}
            </ListItemButton>
          ))}
          {!list.length && <Box sx={{ px: 3, py: 4, textAlign: 'center', color: 'text.secondary' }}>You're all caught up.</Box>}
        </Box>
        <Box sx={{ p: 2, display: 'flex', gap: 1 }}>
          <Button fullWidth variant="outlined" onClick={() => { setAnchor(null); nav('/'); }}>See overview</Button>
          {unread > 0 && <Button fullWidth variant="contained" onClick={markAll}>Mark all read</Button>}
        </Box>
      </Menu>
    </>
  );
}

function Profile({ name, email, role, onSignOut }: { name: string; email: string; role: string; onSignOut: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [picker, setPicker] = useState(false);
  const links = [
    { to: '/settings/security', icon: 'solar:lock-keyhole-minimalistic-line-duotone', color: 'error', title: 'My security', sub: 'Password and two-step verification' },
    { to: '/payslips', icon: 'solar:document-text-line-duotone', color: 'primary', title: 'My payslips', sub: 'Download your payslips' },
    { to: '/leave', icon: 'solar:calendar-line-duotone', color: 'warning', title: 'My leave', sub: 'Balances and requests' },
  ] as const;
  return (
    <>
      <Box component="button" type="button" onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)} aria-label="Open profile menu"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, border: 0, bgcolor: 'transparent', cursor: 'pointer', p: 0.5, pr: { xs: 0.5, md: 1 }, borderRadius: 999, color: 'text.primary', '&:hover': { bgcolor: 'primary.light' } }}>
        <Avatar name={name} size={40} />
        <Box sx={{ display: { xs: 'none', md: 'block' }, textAlign: 'left', maxWidth: 160 }}>
          <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.3 }}>{name}</Typography>
          <Typography noWrap sx={{ fontSize: '0.75rem', color: 'text.secondary', textTransform: 'capitalize' }}>{role}</Typography>
        </Box>
      </Box>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { width: 360, mt: 1, p: 3 } }, list: { sx: { p: 0 } } }}>
        <Typography variant="h6" sx={{ mb: 2 }}>User profile</Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ position: 'relative' }}>
            <Avatar name={name} size={80} />
            <Tooltip title="Change picture"><IconButton size="small" onClick={() => { setAnchor(null); setPicker(true); }} aria-label="Change profile picture" sx={{ position: 'absolute', right: -4, bottom: -4, bgcolor: 'primary.main', color: '#fff', width: 30, height: 30, '&:hover': { bgcolor: 'primary.dark' } }}><SolarIcon icon="solar:pen-new-square-line-duotone" size={16} /></IconButton></Tooltip>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600 }} noWrap>{name}</Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', textTransform: 'capitalize' }} noWrap>{role}</Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }} noWrap><SolarIcon icon="solar:letter-line-duotone" size={15} />{email}</Typography>
          </Box>
        </Stack>
        <Divider sx={{ my: 2.5 }} />
        <Stack spacing={0.5}>
          {links.map((l) => (
            <Box key={l.to} component={Link} to={l.to} onClick={() => setAnchor(null)} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 1, borderRadius: '12px', textDecoration: 'none !important', color: 'text.primary', '&:hover': { bgcolor: 'action.hover', '& .t': { color: 'primary.main' } } }}>
              <IconBox icon={l.icon} color={l.color} size={46} iconSize={23} />
              <Box><Typography className="t" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>{l.title}</Typography><Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{l.sub}</Typography></Box>
            </Box>
          ))}
        </Stack>
        <Button fullWidth variant="outlined" sx={{ mt: 2.5 }} startIcon={<SolarIcon icon="solar:logout-line-duotone" size={18} />} onClick={() => { setAnchor(null); onSignOut(); }}>Sign out</Button>
      </Menu>
      {picker && (
        <Modal title="Profile picture" onClose={() => setPicker(false)} footer={<button className="btn primary" onClick={() => setPicker(false)}>Done</button>}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>Choose the picture people see next to your name. It is saved on this device.</Typography>
          <AvatarPicker name={name} />
        </Modal>
      )}
    </>
  );
}

interface HeaderProps { sections: NavSection[]; onMenu: () => void; name: string; email: string; role: string; onSignOut: () => void }
export function Header({ sections, onMenu, name, email, role, onSignOut }: HeaderProps) {
  const { mode, toggleMode } = useColorMode();
  return (
    <Box component="header" className="no-print" sx={{ position: 'sticky', top: { xs: 0, lg: LAYOUT.outerGap }, zIndex: 1050, pt: { xs: 1.5, lg: 0 }, mb: 3.75 }}>
      <Card sx={{ height: LAYOUT.headerHeight, px: { xs: 1.5, sm: 2.5 }, display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton sx={iconBtnSx} onClick={onMenu} aria-label="Toggle navigation"><SolarIcon icon="solar:list-line-duotone" size={23} /></IconButton>
        <QuickSearch sections={sections} />
        <Box sx={{ flex: 1 }} />
        <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
          <IconButton sx={iconBtnSx} onClick={toggleMode} role="switch" aria-checked={mode === 'dark'} aria-label="Dark mode"><ThemeToggleIcon dark={mode === 'dark'} /></IconButton>
        </Tooltip>
        <Notifications />
        <Box sx={{ width: 4 }} />
        <Profile name={name} email={email} role={role} onSignOut={onSignOut} />
      </Card>
    </Box>
  );
}
