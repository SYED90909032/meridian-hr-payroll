import type { Config } from '../config.js';
import { LocalObjectStore } from './localStore.js';
import { S3ObjectStore } from './s3Store.js';
import type { ObjectStore } from './objectStore.js';
export * from './objectStore.js';
export { LocalObjectStore } from './localStore.js';
export { S3ObjectStore } from './s3Store.js';
/** Builds the configured store. Production must use a durable backend; `local` is refused there unless explicitly allowed. */
export function createObjectStore(cfg: Config): ObjectStore {
  if (cfg.OBJECT_STORE === 's3') {
    if (!cfg.S3_BUCKET) throw new Error('S3_BUCKET is required when OBJECT_STORE=s3');
    return new S3ObjectStore({ bucket: cfg.S3_BUCKET, region: cfg.S3_REGION, endpoint: cfg.S3_ENDPOINT, forcePathStyle: cfg.S3_FORCE_PATH_STYLE === 'true', keyPrefix: cfg.S3_KEY_PREFIX });
  }
  return new LocalObjectStore(cfg.OBJECT_STORE_DIR);
}
