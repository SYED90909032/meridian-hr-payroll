import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadDotEnv } from '../env.js';
import { loadConfig } from '../config.js';
import { AwsKmsKeyProvider, createKms, LocalKeyProvider } from '../crypto/kms.js';
import { rotateTenantKey, upgradeLegacySubjectKeys } from '../crypto/key-rotation.js';

loadDotEnv();
const command = process.argv[2];
const cfg = command === 'init' ? null : loadConfig();

async function init(): Promise<void> {
  const dataKey = randomBytes(32);
  if (process.env.KEY_PROVIDER === 'aws-kms') {
    if (!process.env.KMS_KEY_ID) throw new Error('KMS_KEY_ID is required');
    const provider = new AwsKmsKeyProvider(process.env.KMS_KEY_ID, Buffer.alloc(0), process.env.KMS_REGION ?? 'us-east-1', process.env.KMS_ENDPOINT, process.env.MERIDIAN_DEPLOYMENT ?? 'default');
    const wrapped = await provider.wrapMasterKey(dataKey);
    console.log(`MERIDIAN_WRAPPED_MASTER_KEY=${wrapped.toString('base64')}`);
  } else {
    // Local mode is intentionally explicit: this command prints a bootstrap secret only for a local operator.
    console.log(`MERIDIAN_MASTER_KEY=${dataKey.toString('base64')}`);
  }
  dataKey.fill(0);
}
async function withOwner(fn: (db: pg.Client) => Promise<void>): Promise<void> {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error('DATABASE_URL_OWNER is required');
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try { await fn(db); } finally { await db.end(); }
}
async function upgrade(): Promise<void> {
  const kms = await createKms(cfg!);
  await withOwner(async (db) => console.log(JSON.stringify(await upgradeLegacySubjectKeys(db, kms, process.argv[3]))));
  kms.destroy();
}
async function tenantRotate(): Promise<void> {
  const tenantId = process.argv[3];
  if (!tenantId) throw new Error('tenant id is required');
  const kms = await createKms(cfg!);
  await withOwner(async (db) => console.log(JSON.stringify(await rotateTenantKey(db, kms, tenantId))));
  kms.destroy();
}
if (command === 'init') await init();
else if (command === 'upgrade') await upgrade();
else if (command === 'rotate-tenant') await tenantRotate();
else throw new Error('usage: keys:init | keys:upgrade [tenant-id] | keys:rotate-tenant <tenant-id>');
