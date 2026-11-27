import { loadDotEnv } from './env.js';
loadDotEnv();
const { loadConfig } = await import('./config.js');
const { createPools } = await import('./db/pool.js');
const { createKms } = await import('./crypto/kms.js');
const { metrics } = await import('./observability.js');
const { createObjectStore } = await import('./storage/index.js');
const { createScanner } = await import('./storage/scannerFactory.js');
const { processDocumentScanJob } = await import('./modules/people/scanWorker.js');
const { deliverChannel } = await import('./modules/platform/delivery.js');
const { DeliveryError } = await import('./modules/comms/providers.js');
import type { OutboxRow } from './modules/platform/delivery.js';

/**
 * Outbox worker. Claims rows with the worker role (which can do nothing else on the outbox), then delivers webhooks
 * through the app role scoped to each row's tenant. A crashed worker's lease expires and the row is claimed again.
 */
const cfg = loadConfig();
const pools = createPools(cfg);
const kms = await createKms(cfg);
const objects = createObjectStore(cfg);
const scanner = createScanner(cfg);
let stopping = false;
let lastRetentionAt = 0;
const backoff = (attempts: number): number => Math.min(3600, 15 * 2 ** Math.min(attempts, 8));
export async function tick(): Promise<number> {
  if (Date.now() - lastRetentionAt >= 24 * 60 * 60_000) {
    await pools.worker.query('select plat.purge_webhook_deliveries($1)', [cfg.WEBHOOK_DELIVERY_RETENTION_DAYS]);
    lastRetentionAt = Date.now();
  }
  const started = process.hrtime.bigint();
  const r = await pools.worker.query<OutboxRow>('select * from kernel.claim_outbox($1, $2)', [25, 60]);
  for (const row of r.rows) {
    try {
      const providerId = row.topic === 'document.scan'
        ? (await processDocumentScanJob(pools, kms, objects, scanner, { ...(row.payload as Record<string, unknown>), tenant_id: row.tenant_id }, cfg.SCAN_MAX_ATTEMPTS), null)
        : await deliverChannel(pools, kms, cfg, row);
      if (providerId) await pools.worker.query('select kernel.record_outbox_provider($1, $2)', [row.id, providerId]);
      await pools.worker.query('select kernel.finish_outbox($1, true, null, 0)', [row.id]);
    } catch (e) {
      if (e instanceof DeliveryError && e.permanent) await pools.worker.query('select kernel.fail_outbox_permanent($1, $2, $3)', [row.id, e.message, e.kind]);
      else await pools.worker.query('select kernel.finish_outbox($1, false, $2, $3)', [row.id, (e as Error).message, backoff(row.attempts)]);
    }
  }
  try {
    const alerts = await pools.worker.query<{ kind: string; alert_count: string }>('select * from kernel.run_watchdog($1)', [cfg.PAYDAY_WATCHDOG_HOURS]);
    for (const alert of alerts.rows) if (Number(alert.alert_count) > 0) { metrics.watchdogAlerts.inc({ kind: alert.kind }, Number(alert.alert_count)); console.warn(JSON.stringify({ event: 'payday_watchdog_alert', kind: alert.kind, count: Number(alert.alert_count) })); }
  } catch (e) {
    console.warn(JSON.stringify({ event: 'payday_watchdog_failed', error: (e as Error).message }));
  }
  metrics.workerTick.observe(Number(process.hrtime.bigint() - started) / 1e9);
  return r.rows.length;
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
while (!stopping) {
  try { if ((await tick()) === 0) await sleep(2000); } catch (e) { console.error('worker tick failed:', (e as Error).message); await sleep(5000); }
}
await pools.end();
