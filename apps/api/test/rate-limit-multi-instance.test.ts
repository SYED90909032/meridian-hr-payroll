import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import { describe, expect, it, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { REDIS_URL, reachable } from './infra.js';

async function instance(redis: Redis | undefined, namespace: string) {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { global: false, redis, nameSpace: namespace, max: 2, timeWindow: '1 minute', skipOnError: Boolean(redis) });
  app.get('/limited', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('rate limiter topology', () => {
  const close: Array<() => Promise<void>> = [];
  afterEach(async () => { while (close.length) await close.pop()!(); });
  it('shares a Redis route budget across two real Fastify instances, unlike memory', async () => {
    if (!(await reachable(REDIS_URL))) return;
    const namespace = `meridian:test:${randomUUID()}:`;
    const redis = new Redis(REDIS_URL);
    const a = await instance(redis, namespace); const b = await instance(redis, namespace);
    close.push(async () => { await a.close(); await b.close(); await redis.quit(); });
    expect((await a.inject('/limited')).statusCode).toBe(200);
    expect((await b.inject('/limited')).statusCode).toBe(200);
    expect((await a.inject('/limited')).statusCode).toBe(429);
    const m1 = await instance(undefined, namespace + 'm1:'); const m2 = await instance(undefined, namespace + 'm2:');
    close.push(async () => { await m1.close(); await m2.close(); });
    expect((await m1.inject('/limited')).statusCode).toBe(200);
    expect((await m2.inject('/limited')).statusCode).toBe(200);
    expect((await m1.inject('/limited')).statusCode).toBe(200);
    expect((await m2.inject('/limited')).statusCode).toBe(200);
  });
});
