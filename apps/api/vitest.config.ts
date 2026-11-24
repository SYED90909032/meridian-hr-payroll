import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Tests run against the meridian_test database. Credentials come from the repo-root .env (gitignored) or the environment (CI).
const env: Record<string, string> = {};
const f = resolve(__dirname, '../../.env');
if (existsSync(f)) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!;
  }
}
const swap = (u?: string) => (u ?? '').replace(/\/meridian(\?|$)/, '/meridian_test$1');
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL_OWNER: process.env.TEST_DATABASE_URL_OWNER ?? swap(env.DATABASE_URL_OWNER),
      DATABASE_URL_APP: process.env.TEST_DATABASE_URL_APP ?? swap(env.DATABASE_URL_APP),
      DATABASE_URL_AUTH: process.env.TEST_DATABASE_URL_AUTH ?? swap(env.DATABASE_URL_AUTH),
      DATABASE_URL_WORKER: process.env.TEST_DATABASE_URL_WORKER ?? swap(env.DATABASE_URL_WORKER),
    },
  },
});
