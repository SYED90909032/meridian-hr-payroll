import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL_APP: z.string().url(),
  DATABASE_URL_AUTH: z.string().url(),
  DATABASE_URL_WORKER: z.string().url(),
  /** 32 bytes, base64. Dev only fallback is derived below; production must set it. */
  MERIDIAN_MASTER_KEY: z.string().optional(),
  /** `local` is development/test only; production uses AWS KMS with a wrapped data key. */
  KEY_PROVIDER: z.enum(['local', 'aws-kms']).default('local'),
  MERIDIAN_WRAPPED_MASTER_KEY: z.string().optional(),
  KMS_KEY_ID: z.string().optional(),
  KMS_REGION: z.string().default('us-east-1'),
  KMS_ENDPOINT: z.string().url().optional(),
  MERIDIAN_DEPLOYMENT: z.string().min(1).default('default'),
  REQUIRE_SECRET_MANAGER: z.enum(['true', 'false']).default('false'),
  SECRETS_PROVIDER: z.enum(['env', 'aws-secrets-manager']).default('env'),
  AWS_SECRETS_MANAGER_SECRET_ID: z.string().optional(),
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
  if (prod && c.KEY_PROVIDER === 'local') throw new Error('KEY_PROVIDER=local is not allowed in production; configure AWS KMS or another managed provider');
  if (c.KEY_PROVIDER === 'aws-kms' && (!c.KMS_KEY_ID || !c.MERIDIAN_WRAPPED_MASTER_KEY)) throw new Error('KMS_KEY_ID and MERIDIAN_WRAPPED_MASTER_KEY are required when KEY_PROVIDER=aws-kms');
  if (prod && c.REQUIRE_SECRET_MANAGER === 'true' && c.SECRETS_PROVIDER !== 'aws-secrets-manager') throw new Error('SECRETS_PROVIDER=aws-secrets-manager is required by REQUIRE_SECRET_MANAGER');
  if (prod && c.SECRETS_PROVIDER === 'aws-secrets-manager' && !c.AWS_SECRETS_MANAGER_SECRET_ID) throw new Error('AWS_SECRETS_MANAGER_SECRET_ID is required when using Secrets Manager');
  if (prod && c.SECRETS_PROVIDER !== 'aws-secrets-manager' && c.REQUIRE_SECRET_MANAGER !== 'true') console.warn('Meridian warning: production is using environment-backed long-lived secrets; set REQUIRE_SECRET_MANAGER=true after configuring a secret manager');
  let masterKey: Buffer;
  if (c.MERIDIAN_MASTER_KEY) {
    masterKey = Buffer.from(c.MERIDIAN_MASTER_KEY, 'base64');
    if (masterKey.length !== 32) throw new Error('MERIDIAN_MASTER_KEY must decode to exactly 32 bytes');
  } else if (prod && c.KEY_PROVIDER === 'local') {
    throw new Error('MERIDIAN_MASTER_KEY is required when using the local provider');
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
