/**
 * Sidebar navigation model. Same routes and permission checks as the previous Shell
 * (App.tsx before the Spike redesign); each item now carries a Solar icon and a Spike tint colour
 * (the active pill uses `<color>.light` / `<color>.main`, as in Spike's NavItem).
 */
import type { SolarName } from '../icons/SolarIcon';
import type { PaletteKey } from '../ui';

export interface NavLinkItem { to: string; label: string; icon: SolarName; color: PaletteKey; badge?: 'approvals' }
export interface NavSection { caption: string; items: NavLinkItem[] }
type Can = (...perms: string[]) => boolean;

export function buildNav(can: Can): NavSection[] {
  const control: NavLinkItem[] = [];
  if (can('audit.read')) control.push({ to: '/audit', label: 'Audit log', icon: 'solar:shield-check-line-duotone', color: 'secondary' });
  if (can('roles.view')) control.push({ to: '/settings/access', label: 'Access and roles', icon: 'solar:user-id-line-duotone', color: 'primary' });
  if (can('apikey.manage') || can('webhook.manage')) control.push({ to: '/settings/integrations', label: 'Integrations', icon: 'solar:plug-circle-line-duotone', color: 'info' });
  control.push({ to: '/settings/security', label: 'My security', icon: 'solar:lock-keyhole-minimalistic-line-duotone', color: 'error' });

  return [
    { caption: 'Home', items: [
      { to: '/', label: 'Overview', icon: 'solar:screencast-2-line-duotone', color: 'primary' },
      { to: '/approvals', label: 'Approvals', icon: 'solar:checklist-minimalistic-line-duotone', color: 'warning', badge: 'approvals' },
    ] },
    { caption: 'People', items: [
      { to: '/people', label: 'Directory', icon: 'solar:users-group-rounded-line-duotone', color: 'primary' },
      { to: '/org', label: 'Organisation', icon: 'solar:structure-line-duotone', color: 'info' },
      { to: '/time', label: 'Time', icon: 'solar:clock-circle-line-duotone', color: 'success' },
      { to: '/leave', label: 'Leave', icon: 'solar:calendar-line-duotone', color: 'warning' },
    ] },
    { caption: 'Pay', items: [
      ...(can('pay.view') ? [{ to: '/payroll', label: 'Payroll', icon: 'solar:wallet-money-line-duotone', color: 'success' } as NavLinkItem] : []),
      { to: '/payslips', label: 'My payslips', icon: 'solar:document-text-line-duotone', color: 'primary' },
    ] },
    { caption: 'Support', items: [
      { to: '/helpdesk', label: 'Helpdesk', icon: 'solar:chat-round-dots-line-duotone', color: 'error' },
      { to: '/assistant', label: 'Assistant', icon: 'solar:magic-stick-3-line-duotone', color: 'info' },
    ] },
    { caption: 'Control', items: control },
  ];
}

/** Active-route test matching NavLink's behaviour (`end` only for "/"). */
export const isActivePath = (pathname: string, to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/'));
