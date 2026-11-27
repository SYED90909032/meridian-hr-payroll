/**
 * Object storage port (blueprint 6.3 item 3, ADR-025).
 *
 * Meridian never talks to a storage vendor directly. Callers depend on `ObjectStore`; the deployment picks a backend:
 *  - `local`  a directory on disk, for development and tests;
 *  - `s3`     any S3-compatible service (AWS S3, Cloudflare R2, GCS interoperability, MinIO, moto).
 *
 * Keys are slash-separated, lower-risk strings. Backends reject keys that could escape their root.
 */
export interface PutOptions {
  contentType?: string;
  /** Small string metadata stored with the object. */
  metadata?: Record<string, string>;
  /**
   * When false the write fails with `ObjectExistsError` if the key already exists (write-once). Used for off-box audit
   * seals, which must never be silently replaced. Default true.
   */
  overwrite?: boolean;
}
export interface ObjectInfo { key: string; size: number; contentType?: string; metadata?: Record<string, string>; lastModified?: Date }
export interface ObjectStore {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, opts?: PutOptions): Promise<void>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  head(key: string): Promise<ObjectInfo | null>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
  /** Lists keys under a prefix, in key order. */
  list(prefix: string): Promise<ObjectInfo[]>;
  /** A time-limited download URL, or null when the backend cannot presign (local). */
  presignGet(key: string, ttlSeconds: number): Promise<string | null>;
}
export class ObjectExistsError extends Error { constructor(key: string) { super(`object already exists: ${key}`); this.name = 'ObjectExistsError'; } }
export class InvalidObjectKeyError extends Error { constructor(key: string) { super(`invalid object key: ${key}`); this.name = 'InvalidObjectKeyError'; } }

/** Keys are 1-1024 chars of a conservative alphabet; no `..`, no leading slash, no empty segments. */
export function assertValidKey(key: string): void {
  if (!/^[A-Za-z0-9._=@+\-/]{1,1024}$/.test(key) || key.startsWith('/') || key.endsWith('/') || key.split('/').some((s) => s === '' || s === '.' || s === '..')) throw new InvalidObjectKeyError(key);
}
