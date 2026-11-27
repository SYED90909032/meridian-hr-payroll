import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Bundles only the Solar icons referenced in src/ (see scripts/build-solar-subset.mjs).
import { solarSubsetPlugin } from './scripts/build-solar-subset.mjs';
const apiProxy = { '/api': { target: process.env.E2E_API_URL ?? 'http://localhost:8080', changeOrigin: false } };

export default defineConfig({
  plugins: [solarSubsetPlugin(), react()],
  server: { port: 5173, proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Keep long-lived vendor code in its own cacheable chunks so app
        // releases don't invalidate the (large, rarely changing) MUI bundle.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // @mui/x-charts is intentionally left alone: it stays inside the lazily
          // loaded Dashboard chunk instead of being preloaded on every page.
          if (id.includes('@mui/x-') || id.includes('d3-')) return undefined;
          if (id.includes('@mui') || id.includes('@emotion')) return 'vendor-mui';
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
});
