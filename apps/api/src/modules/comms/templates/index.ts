export type TemplateName =
  | 'invitation.v1'
  | 'password-reset.v1'
  | 'password-changed.v1'
  | 'leave-requested.v1'
  | 'leave-decided.v1'
  | 'approval-pending.v1'
  | 'pay-run-ready.v1'
  | 'payslip-published.v1';

export interface TemplateInput {
  recipientName?: string;
  link: string;
  token?: string;
}
export interface RenderedTemplate { subject: string; text: string; html: string }

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}
function safeHeader(v: string): string { return v.replace(/[\r\n]/g, ' ').trim().slice(0, 160); }
function linkFor(i: TemplateInput): string {
  // Links are application paths, never provider-controlled URLs. Escaping is still required in both parts.
  return i.link.startsWith('/') ? i.link : '/';
}
function person(i: TemplateInput): string { return safeHeader(i.recipientName ?? 'there') || 'there'; }

export function renderTemplate(name: TemplateName, input: TemplateInput): RenderedTemplate {
  const n = esc(person(input));
  const link = esc(linkFor(input));
  const subjectByName: Record<TemplateName, string> = {
    'invitation.v1': 'You have been invited to Meridian',
    'password-reset.v1': 'Reset your Meridian password',
    'password-changed.v1': 'Your Meridian password was changed',
    'leave-requested.v1': 'A Meridian leave request needs your attention',
    'leave-decided.v1': 'Your Meridian leave request was updated',
    'approval-pending.v1': 'A Meridian approval needs your attention',
    'pay-run-ready.v1': 'A Meridian pay run is ready for review',
    'payslip-published.v1': 'Your Meridian payslip is ready',
  };
  const subject = subjectByName[name];
  const body: Record<TemplateName, { intro: string; action: string }> = {
    'invitation.v1': { intro: `Hello ${n}, you have been invited to join Meridian.`, action: 'Accept invitation' },
    'password-reset.v1': { intro: `Hello ${n}, someone requested a password reset for your Meridian account.`, action: 'Reset password' },
    'password-changed.v1': { intro: `Hello ${n}, your Meridian password was changed.`, action: 'Review account security' },
    'leave-requested.v1': { intro: `Hello ${n}, a leave request needs your attention in Meridian.`, action: 'Open Meridian' },
    'leave-decided.v1': { intro: `Hello ${n}, your leave request was updated in Meridian.`, action: 'Open Meridian' },
    'approval-pending.v1': { intro: `Hello ${n}, an approval needs your attention in Meridian.`, action: 'Review approval' },
    'pay-run-ready.v1': { intro: `Hello ${n}, a pay run is ready for review in Meridian.`, action: 'Review pay run' },
    'payslip-published.v1': { intro: `Hello ${n}, your payslip is available in Meridian.`, action: 'Open Meridian' },
  };
  const { intro, action } = body[name];
  const text = `${intro}\n\n${action}: ${link}\n\nSign in to Meridian to view details. If you did not expect this message, contact your company administrator.`;
  const html = `<p>${esc(intro)}</p><p><a href="${link}">${esc(action)}</a></p><p>Sign in to Meridian to view details. If you did not expect this message, contact your company administrator.</p>`;
  return { subject: safeHeader(subject), text, html };
}

export const TEMPLATE_NAMES: readonly TemplateName[] = [
  'invitation.v1', 'password-reset.v1', 'password-changed.v1', 'leave-requested.v1',
  'leave-decided.v1', 'approval-pending.v1', 'pay-run-ready.v1', 'payslip-published.v1',
];
