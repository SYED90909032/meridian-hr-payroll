import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL_OWNER;
if (!url) { console.error('DATABASE_URL_OWNER is not set'); process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [join(here, '../../migrations'), join(here, '../migrations'), join(process.cwd(), 'migrations')];
const dir = candidates.find((d) => existsSync(d));
if (!dir) { console.error('migrations directory not found'); process.exit(1); }
migrate(url, dir).then((r) => { console.log('applied:', r.applied.join(', ') || 'none'); console.log('already applied:', r.skipped.join(', ') || 'none'); })
  .catch((e) => { console.error(e.message); process.exit(1); });
