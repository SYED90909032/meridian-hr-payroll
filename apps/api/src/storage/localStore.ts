import { mkdir, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { assertValidKey, ObjectExistsError, type ObjectInfo, type ObjectStore, type PutOptions } from './objectStore.js';

/** Filesystem backend. Metadata and content type live in a `.meta.json` sidecar. Development and tests only. */
export class LocalObjectStore implements ObjectStore {
  readonly kind = 'local' as const;
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private path(key: string): string {
    assertValidKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('key escapes the store root');
    return p;
  }
  async put(key: string, body: Buffer, opts: PutOptions = {}): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    // `wx` makes the existence check and the write one atomic step, so write-once cannot race.
    try { await writeFile(p, body, { flag: opts.overwrite === false ? 'wx' : 'w' }); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ObjectExistsError(key);
      throw e;
    }
    await writeFile(p + '.meta.json', JSON.stringify({ contentType: opts.contentType, metadata: opts.metadata }));
  }
  async get(key: string): Promise<Buffer | null> {
    try { return await readFile(this.path(key)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const p = this.path(key);
    try {
      const s = await stat(p);
      let meta: { contentType?: string; metadata?: Record<string, string> } = {};
      try { meta = JSON.parse(await readFile(p + '.meta.json', 'utf8')); } catch { /* no sidecar */ }
      return { key, size: s.size, lastModified: s.mtime, ...meta };
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async delete(key: string): Promise<void> {
    const p = this.path(key);
    await rm(p, { force: true }); await rm(p + '.meta.json', { force: true });
  }
  async list(prefix: string): Promise<ObjectInfo[]> {
    const out: ObjectInfo[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.endsWith('.meta.json')) continue;
        const k = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(join(dir, e.name), k);
        else if (k.startsWith(prefix)) { const h = await this.head(k); if (h) out.push(h); }
      }
    };
    await walk(this.root, '');
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async presignGet(): Promise<string | null> { return null; }
}
