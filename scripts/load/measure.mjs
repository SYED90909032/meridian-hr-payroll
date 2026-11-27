#!/usr/bin/env node
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const count = Number(process.env.REQUESTS ?? 200);
const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? 20));
const samples = [];
for (let offset = 0; offset < count; offset += concurrency) {
  const batch = Array.from({ length: Math.min(concurrency, count - offset) }, async () => {
    const start = performance.now();
    const response = await fetch(`${base}/api/v1/health`);
    const elapsed = performance.now() - start;
    if (!response.ok) throw new Error(`health failed: ${response.status}`);
    return elapsed;
  });
  samples.push(...await Promise.all(batch));
}
samples.sort((a, b) => a - b);
const percentile = (p) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))];
console.log(JSON.stringify({ base, requests: count, concurrency, endpoint: '/api/v1/health', p50_ms: percentile(0.5), p95_ms: percentile(0.95), max_ms: samples.at(-1), status: 'ok' }));
