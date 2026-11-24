import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';

/**
 * Dashboard figures. Every query runs as the caller under row level security, so a manager's headcount is their own team
 * and a figure the caller may not see is simply absent. Nothing here reads pay amounts for anyone without pay access.
 */
export function registerInsightRoutes(svc: Services): void {
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/insight/overview', summary: 'Dashboard overview scoped to what you may see', tag: 'Insight', auth: 'session',
    handler: async ({ db, p }) => {
      const out: Record<string, unknown> = {};
      const hc = await db.query(`select status, count(*)::int as n from people.employee group by status`);
      out.headcount = Object.fromEntries(hc.rows.map((r) => [r.status, r.n]));
      const byUnit = await db.query(`select coalesce(o.name, 'Unassigned') as unit, count(*)::int as n from people.employee e left join people.org_unit o on o.id = e.org_unit_id where e.status <> 'terminated' group by 1 order by 2 desc limit 12`);
      out.by_unit = byUnit.rows;
      const joiners = await db.query(`select count(*)::int as n from people.employee where hire_date >= current_date - 30 and status <> 'terminated'`);
      out.joiners_30d = joiners.rows[0].n;
      const onLeave = await db.query(
        `select count(distinct employee_id)::int as n from tm.leave_request where status = 'approved' and current_date between start_date and end_date`);
      out.on_leave_today = onLeave.rows[0].n;
      const pend = await db.query(`select count(*)::int as n from flow.approval_step st join flow.approval_request rq on rq.id = st.request_id where st.approver_user_id = $1 and st.status = 'pending' and rq.status = 'pending'`, [p.userId]);
      out.my_pending_approvals = pend.rows[0].n;
      const unread = await db.query(`select count(*)::int as n from flow.notification where user_id = $1 and read_at is null`, [p.userId]);
      out.unread_notifications = unread.rows[0].n;
      if (p.perms.has('time.read')) {
        const att = await db.query(`select status, count(*)::int as n from tm.attendance_day where work_date = current_date group by status`);
        out.attendance_today = Object.fromEntries(att.rows.map((r) => [r.status, r.n]));
        const lr = await db.query(`select count(*)::int as n from tm.late_punch_review where status = 'open'`);
        out.late_punch_reviews = lr.rows[0].n;
      }
      if (p.perms.has('helpdesk.agent')) {
        const t = await db.query(`select count(*)::int as n from svc.ticket where status in ('open', 'in_progress')`);
        out.open_tickets = t.rows[0].n;
      }
      if (p.perms.has('pay.view')) {
        const run = await db.query(`select id, period_start, period_end, status, mode, run_type from pay.pay_run order by created_at desc limit 5`);
        out.recent_pay_runs = run.rows;
      }
      return out;
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/insight/headcount-trend', summary: 'Monthly headcount over the last 12 months', tag: 'Insight', auth: 'any', perm: 'insight.read',
    query: z.object({ months: z.coerce.number().int().min(3).max(36).default(12) }),
    handler: async ({ db, query }) => {
      const r = await db.query(
        `select to_char(m, 'YYYY-MM') as month,
                (select count(*)::int from people.employee e where e.hire_date <= (m + interval '1 month - 1 day')::date and (e.termination_date is null or e.termination_date > (m + interval '1 month - 1 day')::date)) as headcount
           from generate_series(date_trunc('month', current_date) - make_interval(months => $1 - 1), date_trunc('month', current_date), interval '1 month') m order by m`, [query.months]);
      return { months: r.rows };
    },
  });
}
