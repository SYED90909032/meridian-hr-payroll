import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/main.ts', 'src/worker.ts', 'src/db/migrate-cli.ts'],
  format: ['esm'],
  target: 'node22',
  noExternal: ['@meridian/engine'],
  clean: true,
  sourcemap: true,
});
