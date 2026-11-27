import { loadDotEnv } from './env.js';
loadDotEnv();
const { loadConfig } = await import('./config.js');
const { createPools } = await import('./db/pool.js');
const { Kms } = await import('./crypto/kms.js');
const { createObjectStore } = await import('./storage/index.js');
const { createScanner } = await import('./storage/scannerFactory.js');
const { processDocumentScanJob } = await import('./modules/people/scanWorker.js');
const { deliverOutbox } = await import('./modules/platform/delivery.js');
import type { OutboxRow } from './modules/platform/delivery.js';

/**
 * Outbox worker. Claims rows with the worker role (which can do nothing else on the outbox), then delivers webhooks
 * through the app role scoped to each row's tenant. A crashed worker's lease expires and the row is claimed again.
 */
const cfg = loadConfig();
const pools = createPools(cfg);
const kms = new Kms(cfg.masterKey);
const objects = createObjectStore(cfg);
const scanner = createScanner(cfg);
let stopping = false;
const backoff = (attempts: number): number => Math.min(3600, 15 * 2 ** Math.min(attempts, 8));
export async function tick(): Promise<number> {
  const r = await pools.worker.query<OutboxRow>('select * from kernel.claim_outbox($1, $2)', [25, 60]);
  for (const row of r.rows) {
    try {
      if (row.topic === 'document.scan') await processDocumentScanJob(pools, kms, objects, scanner, { ...(row.payload as Record<string, unknown>), tenant_id: row.tenant_id }, cfg.SCAN_MAX_ATTEMPTS);
      else await deliverOutbox(pools, kms, row);
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
