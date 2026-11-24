import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { HttpError, badRequest, forbidden, notFound } from '../../errors.js';
import { pid, short, uuid } from '../../http/schemas.js';
import { notifyRoles, notifyUser } from '../flow/notify.js';

const CATEGORIES = ['payroll', 'leave', 'benefits', 'it', 'policy', 'grievance', 'other'] as const;

export function registerServiceRoutes(svc: Services): void {
  // ---------------------------------------------------------------- tickets
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/svc/tickets', summary: 'Tickets (yours, or the queue you may see)', tag: 'Helpdesk', auth: 'session',
    query: z.object({ scope: z.enum(['mine', 'queue']).default('mine'), status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional() }),
    handler: async ({ db, p, query }) => {
      if (query.scope === 'queue' && !p.perms.has('helpdesk.agent')) throw forbidden();
      const args: unknown[] = []; const where: string[] = [];
      if (query.scope === 'mine') { args.push(p.employeeId); where.push(`t.requester_employee_id = $${args.length}`); }
      if (query.status) { args.push(query.status); where.push(`t.status = $${args.length}`); }
      const r = await db.query(
        `select t.id, t.category, t.subject, t.confidential, t.status, t.assignee_user_id, t.created_at, t.updated_at, e.first_name, e.last_name
           from svc.ticket t join people.employee e on e.id = t.requester_employee_id ${where.length ? 'where ' + where.join(' and ') : ''} order by t.updated_at desc limit 200`, args);
      return { tickets: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/svc/tickets', summary: 'Raise a ticket', tag: 'Helpdesk', auth: 'session', idempotent: 'optional',
    body: z.object({ category: z.enum(CATEGORIES), subject: short(200), body: z.string().trim().min(1).max(10000), confidential: z.boolean().default(false) }).strict(),
    handler: async ({ db, ctx, p, body, audit }) => {
      if (!p.employeeId) throw new HttpError(409, 'no_employee', 'Your account is not linked to an employee record');
      // Grievances are confidential by default. A person can always choose confidential; they cannot make it less so for grievances.
      const confidential = body.confidential || body.category === 'grievance';
      const r = await db.query('insert into svc.ticket (tenant_id, requester_employee_id, category, subject, body, confidential) values ($1, $2, $3, $4, $5, $6) returning id', [ctx.tenantId, p.employeeId, body.category, body.subject, body.body, confidential]);
      // The notification never carries the subject of a confidential ticket.
      await notifyRoles(db, ctx.tenantId, confidential ? ['hr_admin', 'owner'] : ['helpdesk_agent', 'hr_admin'], { kind: 'ticket.new', title: confidential ? 'New confidential ticket' : `New ticket: ${body.subject}`, link: `/helpdesk/${r.rows[0].id}` }, ctx.userId);
      await audit('ticket.created', 'ticket', r.rows[0].id, { category: body.category, confidential });
      return { status: 201, body: { id: r.rows[0].id, confidential } };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/svc/tickets/:id', summary: 'One ticket with its conversation', tag: 'Helpdesk', auth: 'session',
    handler: async ({ db, params, audit, p }) => {
      const id = pid(params.id);
      const t = await db.query(
        `select t.id, t.category, t.subject, t.body, t.confidential, t.status, t.assignee_user_id, t.requester_employee_id, t.created_at, t.updated_at, e.first_name, e.last_name
           from svc.ticket t join people.employee e on e.id = t.requester_employee_id where t.id = $1`, [id]);
      if (!t.rows[0]) throw notFound('Ticket not found');
      const c = await db.query(`select c.id, c.author_user_id, u.display_name as author, c.body, c.internal, c.created_at from svc.ticket_comment c left join kernel.user_account u on u.id = c.author_user_id where c.ticket_id = $1 order by c.created_at`, [id]);
      if (t.rows[0].confidential && t.rows[0].requester_employee_id !== p.employeeId) await audit('ticket.confidential_read', 'ticket', id, {});
      return { ticket: t.rows[0], comments: c.rows };
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/svc/tickets/:id/comments', summary: 'Reply on a ticket', tag: 'Helpdesk', auth: 'session',
    body: z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().default(false) }).strict(),
    handler: async ({ db, ctx, p, params, body, audit }) => {
      const id = pid(params.id);
      const t = (await db.query('select requester_employee_id, status, subject, confidential, assignee_user_id from svc.ticket where id = $1', [id])).rows[0];
      if (!t) throw notFound('Ticket not found');
      const mine = t.requester_employee_id === p.employeeId;
      if (body.internal && (mine || !p.perms.has('helpdesk.agent'))) throw forbidden('Only helpdesk staff can add internal notes');
      if (t.status === 'closed') throw new HttpError(409, 'closed', 'This ticket is closed');
      await db.query('insert into svc.ticket_comment (tenant_id, ticket_id, author_user_id, body, internal) values ($1, $2, $3, $4, $5)', [ctx.tenantId, id, ctx.userId, body.body, body.internal]);
      await db.query(`update svc.ticket set updated_at = now(), status = case when status = 'resolved' and $2 then 'open' else status end where id = $1`, [id, mine]);
      if (!body.internal) {
        if (mine && t.assignee_user_id) await notifyUser(db, ctx.tenantId, t.assignee_user_id, { kind: 'ticket.reply', title: 'Reply on your ticket', link: `/helpdesk/${id}` });
        if (!mine) {
          const req = await db.query('select user_id from kernel.membership where tenant_id = $1 and employee_id = $2 and status = $3', [ctx.tenantId, t.requester_employee_id, 'active']);
          for (const row of req.rows) await notifyUser(db, ctx.tenantId, row.user_id, { kind: 'ticket.reply', title: 'There is a reply on your ticket', link: `/helpdesk/${id}` });
        }
      }
      await audit('ticket.commented', 'ticket', id, { internal: body.internal });
      return { status: 201, body: { ok: true } };
    },
  });
  defineRoute(svc, {
    method: 'PATCH', path: '/api/v1/svc/tickets/:id', summary: 'Update status or assignee', tag: 'Helpdesk', auth: 'session',
    body: z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(), assigneeUserId: uuid.nullable().optional() }).strict(),
    handler: async ({ db, p, params, body, audit }) => {
      const id = pid(params.id);
      const t = (await db.query('select requester_employee_id, status from svc.ticket where id = $1', [id])).rows[0];
      if (!t) throw notFound('Ticket not found');
      const mine = t.requester_employee_id === p.employeeId;
      const staff = p.perms.has('helpdesk.agent');
      if (!staff && !(mine && body.status === 'closed' && body.assigneeUserId === undefined)) throw forbidden();
      if (body.assigneeUserId) {
        const ok = await db.query(`select 1 from kernel.role_assignment where user_id = $1 and role in ('helpdesk_agent','hr_admin','owner') and revoked_at is null limit 1`, [body.assigneeUserId]);
        if (!ok.rowCount) throw badRequest('That person is not helpdesk staff');
      }
      const r = await db.query(
        `update svc.ticket set status = coalesce($2, status), assignee_user_id = case when $4 then $3 else assignee_user_id end, updated_at = now() where id = $1 returning id`,
        [id, body.status ?? null, body.assigneeUserId ?? null, body.assigneeUserId !== undefined]);
      if (!r.rowCount) throw forbidden('You cannot change this ticket');
      await audit('ticket.updated', 'ticket', id, { status: body.status, assignee: body.assigneeUserId });
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- announcements
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/svc/announcements', summary: 'Announcements', tag: 'Helpdesk', auth: 'session',
    handler: async ({ db }) => ({ announcements: (await db.query('select a.id, a.title, a.body, a.published_at, u.display_name as author from svc.announcement a left join kernel.user_account u on u.id = a.author_user_id order by a.published_at desc limit 50')).rows }),
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/svc/announcements', summary: 'Post an announcement', tag: 'Helpdesk', auth: 'session', perm: 'content.write',
    body: z.object({ title: short(200), body: z.string().trim().min(1).max(10000) }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const r = await db.query('insert into svc.announcement (tenant_id, title, body, author_user_id) values ($1, $2, $3, $4) returning id', [ctx.tenantId, body.title, body.body, ctx.userId]);
      const all = await db.query(`select user_id from kernel.membership where tenant_id = $1 and status = 'active' and user_id <> $2`, [ctx.tenantId, ctx.userId]);
      for (const m of all.rows.slice(0, 2000)) await notifyUser(db, ctx.tenantId, m.user_id, { kind: 'announcement', title: body.title, link: '/' });
      await audit('announcement.posted', 'announcement', r.rows[0].id, {});
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });
  defineRoute(svc, {
    method: 'DELETE', path: '/api/v1/svc/announcements/:id', summary: 'Remove an announcement', tag: 'Helpdesk', auth: 'session', perm: 'content.write',
    handler: async ({ db, params, audit }) => {
      const r = await db.query('delete from svc.announcement where id = $1 returning id', [pid(params.id)]);
      if (!r.rowCount) throw notFound('Announcement not found');
      await audit('announcement.removed', 'announcement', params.id!, {});
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------- knowledge base
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/svc/kb', summary: 'Knowledge base articles', tag: 'Helpdesk', auth: 'session',
    query: z.object({ q: z.string().trim().max(100).optional() }),
    handler: async ({ db, p, query }) => {
      const args: unknown[] = []; const where: string[] = [];
      if (!p.perms.has('content.write')) where.push(`status = 'published'`);
      if (query.q) { args.push(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`); where.push(`(title ilike $${args.length} or body ilike $${args.length})`); }
      return { articles: (await db.query(`select id, title, left(body, 240) as excerpt, status, version, updated_at from svc.kb_article ${where.length ? 'where ' + where.join(' and ') : ''} order by updated_at desc limit 100`, args)).rows };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/svc/kb/:id', summary: 'One article', tag: 'Helpdesk', auth: 'session',
    handler: async ({ db, p, params }) => {
      const r = (await db.query('select id, title, body, status, version, updated_at from svc.kb_article where id = $1', [pid(params.id)])).rows[0];
      if (!r || (r.status !== 'published' && !p.perms.has('content.write'))) throw notFound('Article not found');
      return r;
    },
  });
  defineRoute(svc, {
    method: 'POST', path: '/api/v1/svc/kb', summary: 'Create an article', tag: 'Helpdesk', auth: 'session', perm: 'content.write',
    body: z.object({ title: short(200), body: z.string().trim().min(1).max(20000), status: z.enum(['draft', 'published']).default('draft') }).strict(),
    handler: async ({ db, ctx, body, audit }) => {
      const r = await db.query('insert into svc.kb_article (tenant_id, title, body, status, created_by) values ($1, $2, $3, $4, $5) returning id', [ctx.tenantId, body.title, body.body, body.status, ctx.userId]);
      await audit('kb.created', 'kb_article', r.rows[0].id, { status: body.status });
      return { status: 201, body: { id: r.rows[0].id } };
    },
  });
  defineRoute(svc, {
    method: 'PATCH', path: '/api/v1/svc/kb/:id', summary: 'Edit an article', tag: 'Helpdesk', auth: 'session', perm: 'content.write',
    body: z.object({ title: short(200).optional(), body: z.string().trim().min(1).max(20000).optional(), status: z.enum(['draft', 'published']).optional(), version: z.number().int().min(1) }).strict(),
    handler: async ({ db, params, body, audit }) => {
      const r = await db.query('update svc.kb_article set title = coalesce($2, title), body = coalesce($3, body), status = coalesce($4, status), version = version + 1, updated_at = now() where id = $1 and version = $5 returning id',
        [pid(params.id), body.title ?? null, body.body ?? null, body.status ?? null, body.version]);
      if (!r.rowCount) throw new HttpError(409, 'version_conflict', 'Someone else changed this article. Reload and try again.');
      await audit('kb.updated', 'kb_article', params.id!, {});
      return { ok: true };
    },
  });
}
