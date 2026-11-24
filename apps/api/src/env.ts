import { existsSync } from 'node:fs';
import { join } from 'node:path';
/** Loads the nearest .env (cwd, then two levels up) without overriding real environment variables. Production sets real variables. */
export function loadDotEnv(): void {
  for (const f of [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')]) {
    if (existsSync(f)) { try { process.loadEnvFile(f); } catch { /* ignore a malformed file; config validation reports what is missing */ } return; }
  }
}
