/**
 * Action permissions (what a role may attempt). Data access is a second, independent wall: row level security in the
 * database decides which rows and fields the caller may touch (see migrations 002 and 006). Both must allow.
 */
export const ROLES = ['owner', 'hr_admin', 'payroll_admin', 'payroll_approver', 'manager', 'auditor', 'helpdesk_agent'] as const;
export type Role = (typeof ROLES)[number];

export const PERMS = [
  'people.read', 'people.write', 'org.write', 'comp.read', 'comp.write', 'bank.read', 'bank.write', 'pii.reveal', 'docs.read', 'docs.write',
  'roles.view', 'roles.manage', 'time.admin', 'time.read', 'leave.admin', 'leave.read',
  'pay.view', 'pay.prepare', 'pay.approve', 'pay.release', 'pay.admin', 'pay.pack',
  'audit.read', 'audit.seal', 'helpdesk.agent', 'helpdesk.confidential', 'content.write',
  'apikey.manage', 'webhook.manage', 'settings.manage', 'insight.read',
] as const;
export type Perm = (typeof PERMS)[number];

const ALL = new Set<Perm>(PERMS);
const set = (...p: Perm[]) => new Set<Perm>(p);

export const ROLE_PERMS: Record<Role, Set<Perm>> = {
  owner: ALL,
  hr_admin: set('people.read', 'people.write', 'org.write', 'comp.read', 'comp.write', 'pii.reveal', 'docs.read', 'docs.write', 'roles.view', 'roles.manage',
    'time.admin', 'time.read', 'leave.admin', 'leave.read', 'helpdesk.agent', 'helpdesk.confidential', 'content.write', 'insight.read'),
  payroll_admin: set('people.read', 'comp.read', 'bank.read', 'bank.write', 'time.read', 'leave.read', 'pay.view', 'pay.prepare', 'pay.admin', 'insight.read'),
  payroll_approver: set('people.read', 'comp.read', 'pay.view', 'pay.approve', 'pay.release', 'insight.read'),
  manager: set('people.read', 'time.read', 'leave.read', 'insight.read'),
  auditor: set('people.read', 'audit.read', 'insight.read'),
  helpdesk_agent: set('people.read', 'helpdesk.agent'),
};

export function permsFor(roles: string[]): Set<Perm> {
  const out = new Set<Perm>();
  for (const r of roles) ROLE_PERMS[r as Role]?.forEach((p) => out.add(p));
  return out;
}

/** API-key scopes. Write scopes are separately gated by allow_write and never include payroll, approvals, audit, access, key, or webhook actions. */
export const API_KEY_SCOPES = ['people.read', 'time.read', 'leave.read', 'audit.read', 'insight.read', 'people.write', 'leave.admin'] as const satisfies readonly Perm[];
export const API_KEY_WRITE_SCOPES = new Set<Perm>(['people.write', 'leave.admin']);
