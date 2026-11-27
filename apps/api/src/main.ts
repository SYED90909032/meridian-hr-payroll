import { loadDotEnv } from './env.js';
loadDotEnv();
const { loadConfig } = await import('./config.js');
const { createPools } = await import('./db/pool.js');
const { buildApp } = await import('./app.js');
const { startTracing, stopTracing } = await import('./observability.js');
const cfg = loadConfig();
startTracing(cfg);
const pools = createPools(cfg);
const { app } = await buildApp(cfg, pools);
const shutdown = async (sig: string): Promise<void> => {
  app.log.info({ sig }, 'shutting down');
  try { await app.close(); await pools.end(); await stopTracing(); } finally { process.exit(0); }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
