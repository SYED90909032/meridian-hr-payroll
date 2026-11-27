-- Pay-day watchdog state is tenant-scoped and append-only; the worker can invoke the
-- security-definer check but cannot read payroll tables or write notifications directly.
create table kernel.watchdog_alert (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kernel.tenant(id),
  kind text not null,
  entity_id text not null,
  threshold_minutes integer not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, kind, entity_id, threshold_minutes)
);
select app.rls_standard('kernel.watchdog_alert');
create policy watchdog_owner on kernel.watchdog_alert as permissive for all to meridian_owner using (true) with check (true);
revoke all on kernel.watchdog_alert from meridian_app, meridian_worker;

create or replace function kernel.run_watchdog(p_hours integer)
returns table(kind text, alert_count bigint)
language plpgsql security definer set search_path = pg_catalog, kernel, pay, flow, app
as $fn$
declare r record; alert_id uuid; n bigint := 0; threshold integer := greatest(1, p_hours) * 60;
begin
  for r in
    select pr.tenant_id, pr.id, pr.status, coalesce(max(re.at), pr.created_at) as waiting_since
      from pay.pay_run pr left join pay.run_event re on re.pay_run_id = pr.id
     where pr.status in ('in_review','approved')
     group by pr.tenant_id, pr.id, pr.status, pr.created_at
    having now() - coalesce(max(re.at), min(pr.created_at)) > make_interval(hours => greatest(1, p_hours))
  loop
    insert into kernel.watchdog_alert(tenant_id, kind, entity_id, threshold_minutes)
      values (r.tenant_id, 'pay_run_stuck', r.id::text, threshold)
      on conflict do nothing returning id into alert_id;
    if alert_id is not null then
      insert into flow.notification(tenant_id, user_id, kind, title, body, link)
        select distinct r.tenant_id, ra.user_id, 'watchdog.pay_run_stuck', 'Pay run needs attention',
               'A pay run has remained in ' || r.status || ' beyond the configured threshold.', '/payroll/' || r.id::text
          from kernel.role_assignment ra
         where ra.tenant_id = r.tenant_id and ra.role in ('owner','payroll_admin','payroll_approver') and ra.revoked_at is null;
      n := n + 1;
    end if;
  end loop;
  return query select 'pay_run_stuck'::text, n;
end;
$fn$;
revoke all on function kernel.run_watchdog(integer) from public;
grant execute on function kernel.run_watchdog(integer) to meridian_worker;
