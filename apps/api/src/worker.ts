import { loadDotEnv } from './env.js';
loadDotEnv();
const { loadConfig } = await import('./config.js');
const { createPools } = await import('./db/pool.js');
const { createKms } = await import('./crypto/kms.js');
const { deliverOutbox } = await import('./modules/platform/delivery.js');
import type { OutboxRow } from './modules/platform/delivery.js';

/**
 * Outbox worker. Claims rows with the worker role (which can do nothing else on the outbox), then delivers webhooks
 * through the app role scoped to each row's tenant. A crashed worker's lease expires and the row is claimed again.
 */
const cfg = loadConfig();
const pools = createPools(cfg);
const kms = await createKms(cfg);
let stopping = false;
let lastRetentionAt = 0;
const backoff = (attempts: number): number => Math.min(3600, 15 * 2 ** Math.min(attempts, 8));
export async function tick(): Promise<number> {
  if (Date.now() - lastRetentionAt >= 24 * 60 * 60_000) {
    await pools.worker.query('select plat.purge_webhook_deliveries($1)', [cfg.WEBHOOK_DELIVERY_RETENTION_DAYS]);
    lastRetentionAt = Date.now();
  }
  const r = await pools.worker.query<OutboxRow>('select * from kernel.claim_outbox($1, $2)', [25, 60]);
  for (const row of r.rows) {
    try {
      await deliverOutbox(pools, kms, row);
      await pools.worker.query('select kernel.finish_outbox($1, true, null, 0)', [row.id]);
    } catch (e) {
      await pools.worker.query('select kernel.finish_outbox($1, false, $2, $3)', [row.id, (e as Error).message, backoff(row.attempts)]);
    }
  }
  return r.rows.length;
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
while (!stopping) {
  try { if ((await tick()) === 0) await sleep(2000); } catch (e) { console.error('worker tick failed:', (e as Error).message); await sleep(5000); }
}
await pools.end();
