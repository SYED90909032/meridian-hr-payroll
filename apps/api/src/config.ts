import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL_APP: z.string().url(),
  DATABASE_URL_AUTH: z.string().url(),
  DATABASE_URL_WORKER: z.string().url(),
  /** 32 bytes, base64. Dev only fallback is derived below; production must set it. */
  MERIDIAN_MASTER_KEY: z.string().optional(),
  /** Ed25519 seed for audit block signing, 32 bytes base64. */
  MERIDIAN_SIGNING_KEY: z.string().optional(),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  WEB_DIST: z.string().optional(),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(480).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_API_BASE: z.string().optional(),
  ASSISTANT_MODEL: z.string().optional(),
  ASSISTANT_ALLOWED_MODELS: z.string().default(''),
  ASSISTANT_REQUEST_MAX_CHARS: z.coerce.number().int().min(100).max(20000).default(4000),
  ASSISTANT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  API_KEY_MAX_LIFETIME_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  API_KEY_EXPIRY_WARNING_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** Object storage (ADR-025). `local` is for development and tests; production should use `s3`. */
  OBJECT_STORE: z.enum(['local', 's3']).default('local'),
  OBJECT_STORE_DIR: z.string().default('.data/objects'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  S3_KEY_PREFIX: z.string().optional(),
});

export type Config = z.infer<typeof schema> & { masterKey: Buffer; signingSeed: Buffer };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error('Invalid configuration: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const c = parsed.data;
  const prod = c.NODE_ENV === 'production';
  let masterKey: Buffer;
  if (c.MERIDIAN_MASTER_KEY) {
    masterKey = Buffer.from(c.MERIDIAN_MASTER_KEY, 'base64');
    if (masterKey.length !== 32) throw new Error('MERIDIAN_MASTER_KEY must decode to exactly 32 bytes');
  } else if (prod) {
    throw new Error('MERIDIAN_MASTER_KEY is required in production');
  } else {
    // Development and tests only. Never reused in production: the check above refuses to start.
    masterKey = Buffer.alloc(32, 7);
  }
  let signingSeed: Buffer;
  if (c.MERIDIAN_SIGNING_KEY) {
    signingSeed = Buffer.from(c.MERIDIAN_SIGNING_KEY, 'base64');
    if (signingSeed.length !== 32) throw new Error('MERIDIAN_SIGNING_KEY must decode to exactly 32 bytes');
  } else if (prod) {
    throw new Error('MERIDIAN_SIGNING_KEY is required in production');
  } else {
    signingSeed = Buffer.alloc(32, 9);
  }
  return { ...c, masterKey, signingSeed };
}
