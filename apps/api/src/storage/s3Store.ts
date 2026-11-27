import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertValidKey, ObjectExistsError, type ObjectInfo, type ObjectStore, type PutOptions } from './objectStore.js';

export interface S3StoreConfig { bucket: string; region: string; endpoint?: string; forcePathStyle?: boolean; credentials?: { accessKeyId: string; secretAccessKey: string }; keyPrefix?: string }
const notFound = (e: unknown): boolean => { const x = e as { name?: string; $metadata?: { httpStatusCode?: number } }; return x.name === 'NotFound' || x.name === 'NoSuchKey' || x.$metadata?.httpStatusCode === 404; };

/** S3-compatible backend: AWS S3, Cloudflare R2, MinIO, moto. Credentials come from the standard provider chain unless given. */
export class S3ObjectStore implements ObjectStore {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  private readonly prefix: string;
  constructor(private readonly cfg: S3StoreConfig, client?: S3Client) {
    const c: S3ClientConfig = { region: cfg.region, forcePathStyle: cfg.forcePathStyle, ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}), ...(cfg.credentials ? { credentials: cfg.credentials } : {}) };
    this.client = client ?? new S3Client(c);
    this.prefix = cfg.keyPrefix ? cfg.keyPrefix.replace(/\/+$/, '') + '/' : '';
  }
  private k(key: string): string { assertValidKey(key); return this.prefix + key; }
  async put(key: string, body: Buffer, opts: PutOptions = {}): Promise<void> {
    const Key = this.k(key);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.cfg.bucket, Key, Body: body, ContentType: opts.contentType, Metadata: opts.metadata,
        // Conditional write: the service itself refuses to replace an existing object, so write-once cannot race.
        ...(opts.overwrite === false ? { IfNoneMatch: '*' } : {}),
      }));
    } catch (e) {
      const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (x.$metadata?.httpStatusCode === 412 || x.name === 'PreconditionFailed') throw new ObjectExistsError(key);
      throw e;
    }
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (e) { if (notFound(e)) return null; throw e; }
  }
  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) }));
      return { key, size: r.ContentLength ?? 0, contentType: r.ContentType, metadata: r.Metadata, lastModified: r.LastModified };
    } catch (e) { if (notFound(e)) return null; throw e; }
  }
  async delete(key: string): Promise<void> { await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) })); }
  async list(prefix: string): Promise<ObjectInfo[]> {
    const out: ObjectInfo[] = []; let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: this.prefix + prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) out.push({ key: o.Key!.slice(this.prefix.length), size: o.Size ?? 0, lastModified: o.LastModified });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async presignGet(key: string, ttlSeconds: number): Promise<string | null> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) }), { expiresIn: Math.min(Math.max(ttlSeconds, 1), 3600) });
  }
}
