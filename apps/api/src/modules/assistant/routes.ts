import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import type { Db } from '../../db/tx.js';
import type { Principal } from '../../http/principal.js';
import { notFound, HttpError } from '../../errors.js';
import { pid } from '../../http/schemas.js';
import { LlmGateway, DlpRefusal } from './gateway.js';

/**
 * Assistant with a data firewall.
 *  1. Tools are a fixed allow-list chosen by deterministic rules from the user's message. A language model never picks or runs a tool.
 *  2. Every tool query runs as the caller under row level security, so the assistant can never see more than the caller can.
 *  3. Tools return no money, bank, ID or reason fields at all.
 *  4. People are replaced by per-conversation pseudonym tokens (P-XXXXXXXX) before any text reaches a model. Names are put back
 *     only when a message is displayed, and only for people the reader may still see (erased or hidden people show as [hidden]).
 *  5. Without a model configured the answer is built from the tool result directly. A model only rephrases.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const newToken = (): string => 'P-' + Array.from(randomBytes(8), (b) => B32[b % 32]).join('');
const TOKEN_RE = /P-[A-Z2-7]{8}/g;

async function pseudonym(db: Db, tenantId: string, convId: string, subjectId: string): Promise<string> {
  const ex = await db.query('select token from ai.pseudonym where conversation_id = $1 and subject_id = $2', [convId, subjectId]);
  if (ex.rows[0]) return ex.rows[0].token as string;
  for (let i = 0; i < 5; i++) {
    const t = newToken();
    const r = await db.query('insert into ai.pseudonym (tenant_id, conversation_id, token, subject_id) values ($1, $2, $3, $4) on conflict do nothing returning token', [tenantId, convId, t, subjectId]);
    if (r.rows[0]) return t;
    const again = await db.query('select token from ai.pseudonym where conversation_id = $1 and subject_id = $2', [convId, subjectId]);
    if (again.rows[0]) return again.rows[0].token as string;
  }
  throw new Error('could not allocate pseudonym');
}
export async function detokenise(db: Db, convId: string, text: string): Promise<string> {
  const tokens = [...new Set(text.match(TOKEN_RE) ?? [])];
  if (!tokens.length) return text;
  const r = await db.query(
    `select ps.token, e.first_name, e.last_name from ai.pseudonym ps left join people.employee e on e.id = ps.subject_id where ps.conversation_id = $1 and ps.token = any($2::text[])`, [convId, tokens]);
  const map = new Map<string, string>(r.rows.map((x) => [x.token as string, x.first_name ? `${x.first_name} ${x.last_name}` : '[hidden]']));
  return text.replace(TOKEN_RE, (t) => map.get(t) ?? t);
}
interface ToolResult { tool: string; summary: string; data: unknown }
type Tool = { name: string; match: RegExp; allowed: (p: Principal) => boolean; run: (db: Db, p: Principal, tenantId: string, conv: string) => Promise<ToolResult> };
const fmtDays = (x: number): string => (x / 1000).toFixed(x % 1000 === 0 ? 0 : 1);
const TOOLS: Tool[] = [
  {
    name: 'my_leave_balance', match: /(leave|vacation|holiday).*(balance|left|remaining|have)|how (many|much).*(leave|days)|balance/i, allowed: (p) => !!p.employeeId,
    run: async (db, p) => {
      const r = await db.query(`select lt.name, coalesce(sum(l.delta_x1000), 0)::int as bal from tm.leave_type lt left join tm.leave_ledger l on l.leave_type_id = lt.id and l.employee_id = $1 where not lt.special group by lt.id order by lt.name`, [p.employeeId]);
      return { tool: 'my_leave_balance', summary: r.rows.length ? 'Your leave balances: ' + r.rows.map((x) => `${x.name} ${fmtDays(x.bal)} days`).join('; ') + '.' : 'No leave balances are set up yet.', data: r.rows };
    },
  },
  {
    name: 'who_is_on_leave', match: /who.*(on|is|are).*(leave|off|away|out)|(leave|off).*today/i, allowed: (p) => p.perms.has('leave.read') || p.roles.includes('manager'),
    run: async (db, _p, tenantId, conv) => {
      const r = await db.query(`select distinct e.id, lr.start_date, lr.end_date from tm.leave_request lr join people.employee e on e.id = lr.employee_id where lr.status = 'approved' and current_date between lr.start_date and lr.end_date order by lr.end_date limit 50`);
      const rows = [];
      for (const x of r.rows) rows.push({ who: await pseudonym(db, tenantId, conv, x.id), until: x.end_date });
      return { tool: 'who_is_on_leave', summary: rows.length ? 'On approved leave today: ' + rows.map((x) => `${x.who} (back after ${x.until})`).join('; ') + '.' : 'Nobody you can see is on approved leave today.', data: rows };
    },
  },
  {
    name: 'headcount', match: /head ?count|how many (people|employees|staff)|team size/i, allowed: () => true,
    run: async (db) => {
      const r = await db.query(`select status, count(*)::int as n from people.employee group by status order by status`);
      return { tool: 'headcount', summary: r.rows.length ? 'Headcount you can see: ' + r.rows.map((x) => `${x.n} ${String(x.status).replace('_', ' ')}`).join(', ') + '.' : 'No employees visible.', data: r.rows };
    },
  },
  {
    name: 'my_pending_approvals', match: /approv|waiting for me|inbox|to review/i, allowed: () => true,
    run: async (db, p) => {
      const r = await db.query(`select rq.kind, rq.title, rq.created_at from flow.approval_step st join flow.approval_request rq on rq.id = st.request_id where st.approver_user_id = $1 and st.status = 'pending' and rq.status = 'pending' order by rq.created_at limit 20`, [p.userId]);
      return { tool: 'my_pending_approvals', summary: r.rows.length ? `You have ${r.rows.length} pending approval(s): ` + r.rows.map((x) => x.title).join('; ') + '.' : 'You have no pending approvals.', data: r.rows.map((x) => ({ kind: x.kind, created_at: x.created_at })) };
    },
  },
  {
    name: 'upcoming_holidays', match: /public holiday|holidays?\b.*(next|upcoming|coming)|next holiday|upcoming holiday/i, allowed: () => true,
    run: async (db) => {
      const r = await db.query(`select holiday_date, name from tm.public_holiday where holiday_date >= current_date order by holiday_date limit 5`);
      return { tool: 'upcoming_holidays', summary: r.rows.length ? 'Upcoming public holidays: ' + r.rows.map((x) => `${x.name} on ${x.holiday_date}`).join('; ') + '.' : 'No upcoming public holidays are set.', data: r.rows };
    },
  },
  {
    name: 'attendance_today', match: /attendance|who.*(present|absent|late)|clocked in/i, allowed: (p) => p.perms.has('time.read'),
    run: async (db) => {
      const r = await db.query(`select status, count(*)::int as n from tm.attendance_day where work_date = current_date group by status order by status`);
      return { tool: 'attendance_today', summary: r.rows.length ? 'Attendance today: ' + r.rows.map((x) => `${x.n} ${x.status}`).join(', ') + '.' : 'No attendance has been computed for today yet.', data: r.rows };
    },
  },
  {
    name: 'open_tickets', match: /ticket|helpdesk|support request/i, allowed: (p) => p.perms.has('helpdesk.agent'),
    run: async (db) => {
      const r = await db.query(`select category, count(*)::int as n from svc.ticket where status in ('open', 'in_progress') and not confidential group by category order by n desc`);
      return { tool: 'open_tickets', summary: r.rows.length ? 'Open non-confidential tickets: ' + r.rows.map((x) => `${x.n} ${x.category}`).join(', ') + '.' : 'No open tickets.', data: r.rows };
    },
  },
];
const HELP = 'I can help with: your leave balance, who is on leave today, headcount, your pending approvals, upcoming public holidays, and (for managers and staff with access) attendance today and open tickets. I cannot see or discuss pay, bank, ID or confidential information.';
export function pickTool(msg: string, p: Principal): Tool | null {
  return TOOLS.find((t) => t.match.test(msg) && t.allowed(p)) ?? null;
}
export function registerAssistantRoutes(svc: Services): void {
  const gateway = new LlmGateway(svc.cfg);
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/assistant/settings', summary: 'Read assistant model consent setting', tag: 'Assistant', auth: 'session', perm: 'settings.manage',
    handler: async ({ db, p }) => {
      if (!p.roles.includes('owner')) throw new HttpError(403, 'owner_required', 'Only the tenant owner may change assistant consent');
      const r = await db.query('select llm_enabled, consent_text_version, consented_at, updated_at from ai.tenant_setting');
      return { setting: r.rows[0] ?? { llm_enabled: false, consent_text_version: null, consented_at: null, updated_at: null } };
    },
  });
  defineRoute(svc, {
    method: 'PUT', path: '/api/v1/assistant/settings', summary: 'Change assistant model consent', tag: 'Assistant', auth: 'session', perm: 'settings.manage', stepUp: true,
    body: z.object({ llm_enabled: z.boolean(), consent_text_version: z.string().trim().min(1).max(100).nullable() }).strict(),
    handler: async ({ db, ctx, p, body, audit }) => {
      if (!p.roles.includes('owner')) throw new HttpError(403, 'owner_required', 'Only the tenant owner may change assistant consent');
      if (body.llm_enabled && !body.consent_text_version) throw new HttpError(422, 'consent_required', 'A consent text version is required to enable model calls');
      await db.query(`insert into ai.tenant_setting (tenant_id, llm_enabled, consent_text_version, consented_by, consented_at)
        values ($1, $2, $3, $4, case when $2 then now() else null end)
        on conflict (tenant_id) do update set llm_enabled = excluded.llm_enabled, consent_text_version = excluded.consent_text_version,
          consented_by = excluded.consented_by, consented_at = excluded.consented_at, updated_at = now()`,
        [ctx.tenantId, body.llm_enabled, body.consent_text_version, body.llm_enabled ? ctx.userId : null]);
      await audit('assistant.consent_changed', 'tenant', ctx.tenantId, { llm_enabled: body.llm_enabled, consent_text_version: body.consent_text_version });
      return { llm_enabled: body.llm_enabled, consent_text_version: body.consent_text_version };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/assistant/conversations', summary: 'Start a private conversation', tag: 'Assistant', auth: 'session',
    handler: async ({ db, ctx }) => {
      const r = await db.query('insert into ai.conversation (tenant_id, user_id) values ($1, $2) returning id', [ctx.tenantId, ctx.userId]);
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/assistant/conversations/:id', summary: 'Messages in your conversation', tag: 'Assistant', auth: 'session',
    handler: async ({ db, params }) => {
      const id = pid(params.id);
      const c = await db.query('select id from ai.conversation where id = $1', [id]);
      if (!c.rows[0]) throw notFound('Conversation not found');
      const m = await db.query('select role, content, created_at from ai.message where conversation_id = $1 order by created_at, id', [id]);
      const out = [];
      for (const x of m.rows) out.push({ role: x.role, content: await detokenise(db, id, x.content), created_at: x.created_at });
      return { messages: out };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/assistant/conversations/:id/messages', summary: 'Ask the assistant', tag: 'Assistant', auth: 'session',
    body: z.object({ content: z.string().trim().min(1).max(1000) }).strict(),
    rateLimit: { max: 20, timeWindow: '1 minute' },
    handler: async ({ db, ctx, p, params, body, audit }) => {
      const id = pid(params.id);
      const c = await db.query('select id from ai.conversation where id = $1', [id]);
      if (!c.rows[0]) throw notFound('Conversation not found');
      const count = await db.query('select count(*)::int as n from ai.message where conversation_id = $1', [id]);
      if (count.rows[0].n >= 200) throw new HttpError(409, 'conversation_full', 'Start a new conversation');
      await db.query(`insert into ai.message (tenant_id, conversation_id, role, content) values ($1, $2, 'user', $3)`, [ctx.tenantId, id, body.content]);
      const tool = pickTool(body.content, p);
      let answer = HELP; let used: string | null = null; let sourceCount = 0;
      if (tool) {
        const result = await tool.run(db, p, ctx.tenantId, id);
        used = result.tool;
        sourceCount = Array.isArray(result.data) ? result.data.length : 0;
        try { answer = (await gateway.rephrase(db, ctx.tenantId, body.content, result.tool, result.summary)) ?? result.summary; } catch (e) {
          if (!(e instanceof DlpRefusal)) throw e;
          answer = 'I cannot safely send that request to the configured assistant.';
        }
        await db.query(`insert into ai.message (tenant_id, conversation_id, role, content) values ($1, $2, 'tool', $3)`, [ctx.tenantId, id, `${result.tool}: ${result.summary}`]);
      }
      await db.query(`insert into ai.message (tenant_id, conversation_id, role, content) values ($1, $2, 'assistant', $3)`, [ctx.tenantId, id, answer]);
      await audit('assistant.query', 'ai_conversation', id, { tool: used }); // the question text is not logged
      return { answer: await detokenise(db, id, answer), tool: used, sources: used ? [{ tool: used, record_count: sourceCount }] : [] };
    },
  });
}
