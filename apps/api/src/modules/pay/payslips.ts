import { z } from 'zod';
import { defineRoute, type Services } from '../../http/route.js';
import { HttpError, forbidden, notFound } from '../../errors.js';
import { pid } from '../../http/schemas.js';
import { verifyPayslipArchive } from './archive.js';

export function registerPayslipRoutes(svc: Services): void {
  const { kms, objects } = svc;
  // ---------------------------------------------------------------- employee self service
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/me/payslips', summary: 'Your published payslips', tag: 'Payslips', auth: 'session',
    handler: async ({ db, p }) => {
      if (!p.employeeId) return { payslips: [] };
      const r = await db.query(
        `select id, pay_run_id, content->'period' as period, content->'totals' as totals, content->>'currency' as currency, content->'run' as run, published_at
           from pay.payslip where employee_id = $1 and published_at is not null order by published_at desc limit 60`, [p.employeeId]);
      return { payslips: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/me/payslips/:id', summary: 'One of your payslips', tag: 'Payslips', auth: 'session',
    handler: async ({ db, p, ctx, params, audit }) => {
      const id = pid(params.id);
      const r = await db.query('select id, employee_id, content, content_hash, object_key, published_at from pay.payslip where id = $1 and employee_id = $2 and published_at is not null', [id, p.employeeId]);
      if (!r.rows[0]) throw notFound('Payslip not found');
      if (r.rows[0].object_key) await verifyPayslipArchive(db, kms, objects, ctx.tenantId, r.rows[0].employee_id, id, r.rows[0].object_key, r.rows[0].content_hash);
      await audit('payslip.viewed', 'payslip', id, { by: 'employee' });
      const { object_key: _objectKey, employee_id: _employeeId, ...source } = r.rows[0];
      return source;
    },
  });

  // ---------------------------------------------------------------- payroll staff
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/runs/:id/payslips', summary: 'Payslips of a run', tag: 'Payroll', auth: 'session', perm: 'pay.view',
    handler: async ({ db, params }) => {
      const r = await db.query(
        `select s.id, s.employee_id, e.employee_no, e.first_name, e.last_name, (s.content->'totals'->>'net_minor')::float8 as net_minor, s.published_at, s.content_hash
           from pay.payslip s join people.employee e on e.id = s.employee_id where s.pay_run_id = $1 order by e.employee_no`, [pid(params.id)]);
      return { payslips: r.rows };
    },
  });
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/payslips/:id', summary: 'Read one payslip (audited)', tag: 'Payroll', auth: 'session', perm: 'pay.view',
    handler: async ({ db, ctx, params, audit }) => {
      const id = pid(params.id);
      const r = await db.query('select id, employee_id, content, content_hash, object_key, published_at from pay.payslip where id = $1', [id]);
      if (!r.rows[0]) throw notFound('Payslip not found');
      if (r.rows[0].object_key) await verifyPayslipArchive(db, kms, objects, ctx.tenantId, r.rows[0].employee_id, id, r.rows[0].object_key, r.rows[0].content_hash);
      await audit('payslip.viewed', 'payslip', id, { by: 'staff', employee_id: r.rows[0].employee_id });
      const { object_key: _objectKey, ...source } = r.rows[0];
      return source;
    },
  });

  // The file holds bank account numbers. It needs a recent step-up and is audited on every download.
  defineRoute(svc, {
    method: 'GET', path: '/api/v1/pay/runs/:id/payment-file', summary: 'Download the WPS payment file (SIF). Unvalidated by any bank.', tag: 'Payroll', auth: 'session', perm: 'pay.view', stepUp: true,
    handler: async ({ db, p, params, audit }) => {
      if (!p.perms.has('pay.admin') && !p.perms.has('pay.release')) throw forbidden();
      const id = pid(params.id);
      const r = await db.query('select f.content, f.content_hash, r.mode, r.pack_id, r.pack_version, r.pack_hash from pay.payment_file f join pay.pay_run r on r.id = f.pay_run_id where f.pay_run_id = $1', [id]);
      if (!r.rows[0]) throw new HttpError(404, 'not_found', 'No payment file has been built for this run');
      await audit('payment_file.downloaded', 'pay_run', id, { content_hash: r.rows[0].content_hash });
      return { status: 200, body: r.rows[0].content, headers: {
        'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="sif-${id.slice(0, 8)}.csv"`, 'x-content-type-options': 'nosniff', 'x-file-sha256': r.rows[0].content_hash,
      } };
    },
  });
  void z;
}
