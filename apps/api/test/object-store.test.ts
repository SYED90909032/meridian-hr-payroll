import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { InvalidObjectKeyError, LocalObjectStore, ObjectExistsError, S3ObjectStore, type ObjectStore } from '../src/storage/index.js';
import { MOTO, reachable } from './infra.js';

function contract(name: string, make: () => Promise<ObjectStore>) {
  describe(`ObjectStore contract: ${name}`, () => {
    let store: ObjectStore;
    beforeAll(async () => { store = await make(); });
    it('stores, reads back and describes an object', async () => {
      await store.put('docs/a.bin', Buffer.from('hello'), { contentType: 'application/octet-stream', metadata: { sha: 'abc' } });
      expect((await store.get('docs/a.bin'))!.toString()).toBe('hello');
      const h = await store.head('docs/a.bin');
      expect(h?.size).toBe(5); expect(h?.contentType).toBe('application/octet-stream'); expect(h?.metadata?.sha).toBe('abc');
    });
    it('returns null for a missing object and deletes idempotently', async () => {
      expect(await store.get('nope/x')).toBeNull(); expect(await store.head('nope/x')).toBeNull();
      await store.put('tmp/del', Buffer.from('x')); await store.delete('tmp/del'); await store.delete('tmp/del');
      expect(await store.get('tmp/del')).toBeNull();
    });
    it('write-once: refuses to replace when overwrite is false, keeps the original', async () => {
      await store.put('seal/1', Buffer.from('first'), { overwrite: false });
      await expect(store.put('seal/1', Buffer.from('second'), { overwrite: false })).rejects.toBeInstanceOf(ObjectExistsError);
      expect((await store.get('seal/1'))!.toString()).toBe('first');
    });
    it('overwrites by default', async () => {
      await store.put('ow/1', Buffer.from('a')); await store.put('ow/1', Buffer.from('b'));
      expect((await store.get('ow/1'))!.toString()).toBe('b');
    });
    it('lists by prefix in key order', async () => {
      for (const k of ['ls/b', 'ls/a', 'ls/c/d', 'other/z']) await store.put(k, Buffer.from(k));
      expect((await store.list('ls/')).map((o) => o.key)).toEqual(['ls/a', 'ls/b', 'ls/c/d']);
    });
    it('rejects keys that could escape the root or are malformed', async () => {
      for (const k of ['../etc/passwd', '/abs', 'a//b', 'a/../b', '', 'a/', 'sp ace', 'a\\b']) {
        await expect(store.put(k, Buffer.from('x'))).rejects.toBeInstanceOf(InvalidObjectKeyError);
      }
    });
  });
}
const dir = mkdtempSync(join(tmpdir(), 'meridian-objs-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
contract('local filesystem', async () => new LocalObjectStore(dir));
it('local store has no presigned URLs', async () => { expect(await new LocalObjectStore(dir).presignGet()).toBeNull(); });

const s3up = await reachable(MOTO);
describe.skipIf(!s3up)('ObjectStore: S3 (moto)', () => {
  const cfg = { bucket: 'meridian-test-' + Date.now(), region: 'us-east-1', endpoint: MOTO, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } };
  contract('s3', async () => {
    await new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: true, credentials: cfg.credentials }).send(new CreateBucketCommand({ Bucket: cfg.bucket }));
    return new S3ObjectStore(cfg);
  });
  it('presigns a time-limited download URL that actually downloads', async () => {
    const s = new S3ObjectStore(cfg); await s.put('pre/1', Buffer.from('signed'));
    const url = await s.presignGet('pre/1', 60);
    expect(url).toMatch(/X-Amz-Signature=/);
    expect(await (await fetch(url!)).text()).toBe('signed');
  });
  it('honours a key prefix so one bucket can hold several environments', async () => {
    const a = new S3ObjectStore({ ...cfg, keyPrefix: 'env-a' }); const b = new S3ObjectStore({ ...cfg, keyPrefix: 'env-b' });
    await a.put('k', Buffer.from('A')); expect(await b.get('k')).toBeNull(); expect((await a.get('k'))!.toString()).toBe('A');
    expect((await a.list('')).map((o) => o.key)).toEqual(['k']);
  });
});
