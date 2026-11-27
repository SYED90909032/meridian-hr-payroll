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
  BANK_TRANSPORT: z.enum(['manual', 'sftp']).default('manual'),
  BANK_SFTP_HOST: z.string().optional(),
  BANK_SFTP_PORT: z.coerce.number().int().min(1).max(65535).default(22),
  BANK_SFTP_USERNAME: z.string().optional(),
  BANK_SFTP_PRIVATE_KEY: z.string().optional(),
  BANK_SFTP_HOST_KEY_SHA256: z.string().optional(),
  BANK_SFTP_REMOTE_DIR: z.string().default('/inbound'),
  BANK_SFTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  MAIL_PROVIDER: z.enum(['log', 'smtp', 'postmark']).default('log'),
  MAIL_FROM: z.string().email().default('Meridian <no-reply@localhost>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  POSTMARK_TOKEN: z.string().optional(),
  POSTMARK_API_BASE: z.string().url().default('https://api.postmarkapp.com'),
  SMS_PROVIDER: z.enum(['log', 'twilio']).default('log'),
  SMS_FROM: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_API_BASE: z.string().url().default('https://api.twilio.com'),
  HIBP_MODE: z.enum(['fail-open', 'fail-closed']).default('fail-open'),
  HIBP_API_BASE: z.string().url().default('https://api.pwnedpasswords.com'),
  CAPTCHA_PROVIDER: z.enum(['off', 'turnstile']).default('off'),
  TURNSTILE_SECRET: z.string().optional(),
  BOUNCE_WEBHOOK_SECRET: z.string().optional(),
  WEBAUTHN_RP_ID: z.string().min(1).default('localhost'),
  WEBAUTHN_ORIGIN: z.string().url().default('http://localhost:5173'),
  SSO_CALLBACK_URL: z.string().url().default('http://localhost:8080/api/v1/auth/sso/callback'),
  /** Document scanning is mandatory in production unless the operator makes the exception explicit. */
  SCANNER: z.enum(['clamd', 'none']).default('none'),
  CLAMD_HOST: z.string().default('127.0.0.1'),
  CLAMD_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  CLAMD_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(10000),
  SCANNER_MAX_RESPONSE_BYTES: z.coerce.number().int().min(64).max(65536).default(4096),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1).max(50 * 1024 * 1024).default(5 * 1024 * 1024),
  SCAN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  ALLOW_UNSCANNED_DOCUMENTS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
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
  if (prod && c.BANK_TRANSPORT === 'sftp' && (!c.BANK_SFTP_HOST || !c.BANK_SFTP_USERNAME || !c.BANK_SFTP_PRIVATE_KEY || !c.BANK_SFTP_HOST_KEY_SHA256)) {
    throw new Error('SFTP bank transport requires host, username, private key, and pinned host key in production');
  }
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
  if (prod && c.MAIL_PROVIDER === 'log') throw new Error('MAIL_PROVIDER must not be log in production');
  if (prod && c.SMS_PROVIDER === 'log') throw new Error('SMS_PROVIDER must not be log in production');
  if (c.MAIL_PROVIDER === 'smtp' && (!c.SMTP_HOST || !c.SMTP_USER || !c.SMTP_PASSWORD)) throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required for SMTP mail');
  if (c.MAIL_PROVIDER === 'postmark' && !c.POSTMARK_TOKEN) throw new Error('POSTMARK_TOKEN is required for Postmark mail');
  if (c.SMS_PROVIDER === 'twilio' && (!c.SMS_FROM || !c.TWILIO_ACCOUNT_SID || !c.TWILIO_AUTH_TOKEN)) throw new Error('Twilio sender configuration is incomplete');
  if (c.CAPTCHA_PROVIDER === 'turnstile' && !c.TURNSTILE_SECRET) throw new Error('TURNSTILE_SECRET is required for Turnstile');
  if (prod && c.BOUNCE_WEBHOOK_SECRET === undefined) throw new Error('BOUNCE_WEBHOOK_SECRET is required in production');
  return { ...c, masterKey, signingSeed };
}
