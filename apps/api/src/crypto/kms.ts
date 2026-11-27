import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { DecryptCommand, EncryptCommand, KMSClient, type KMSClientConfig } from '@aws-sdk/client-kms';
import type { Config } from '../config.js';

export interface KeyProvider {
  readonly kind: 'local' | 'aws-kms';
  unwrapMasterKey(): Promise<Buffer>;
  wrapMasterKey(dataKey: Buffer): Promise<Buffer>;
}
const contextFor = (deployment: string): Record<string, string> => ({ 'meridian-deployment': deployment });

/** Development/test provider. Production config refuses this provider so a local master cannot be deployed accidentally. */
export class LocalKeyProvider implements KeyProvider {
  readonly kind = 'local' as const;
  constructor(private readonly wrappingKey: Buffer, private readonly deployment = 'local') {
    if (wrappingKey.length !== 32) throw new Error('local wrapping key must be 32 bytes');
  }
  async unwrapMasterKey(): Promise<Buffer> { return Buffer.from(this.wrappingKey); }
  async wrapMasterKey(dataKey: Buffer): Promise<Buffer> {
    if (dataKey.length !== 32) throw new Error('master data key must be 32 bytes');
    return seal(this.wrappingKey, dataKey, `master:${this.deployment}`);
  }
}

/** AWS KMS adapter. KMS sees only the encrypted data key; plaintext is held in memory during boot/use only. */
export class AwsKmsKeyProvider implements KeyProvider {
  readonly kind = 'aws-kms' as const;
  private readonly client: KMSClient;
  constructor(private readonly keyId: string, private readonly wrappedMaster: Buffer, region: string, endpoint?: string, private readonly deployment = 'production') {
    if (!keyId) throw new Error('KMS_KEY_ID is required');
    const cfg: KMSClientConfig = { region, ...(endpoint ? { endpoint } : {}) };
    this.client = new KMSClient(cfg);
  }
  async unwrapMasterKey(): Promise<Buffer> {
    if (!this.wrappedMaster.length) throw new Error('MERIDIAN_WRAPPED_MASTER_KEY is required for KMS boot');
    const r = await this.client.send(new DecryptCommand({ CiphertextBlob: this.wrappedMaster, KeyId: this.keyId, EncryptionContext: contextFor(this.deployment) }));
    const out = Buffer.from(r.Plaintext ?? []);
    if (out.length !== 32) { out.fill(0); throw new Error('KMS returned an invalid master key'); }
    return out;
  }
  async wrapMasterKey(dataKey: Buffer): Promise<Buffer> {
    if (dataKey.length !== 32) throw new Error('master data key must be 32 bytes');
    const r = await this.client.send(new EncryptCommand({ KeyId: this.keyId, Plaintext: dataKey, EncryptionContext: contextFor(this.deployment) }));
    return Buffer.from(r.CiphertextBlob ?? []);
  }
}

/** Envelope crypto. New rows use random DEKs wrapped by a random tenant key; v0 methods keep old ciphertexts readable. */
export class Kms {
  constructor(private readonly master: Buffer) {
    if (master.length !== 32) throw new Error('master key must be 32 bytes');
  }
  tenantKey(tenantId: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.master, Buffer.from(tenantId), Buffer.from('meridian/tenant-key/v1'), 32));
  }
  subjectKey(tenantId: string, subjectId: string, salt: Buffer): Buffer {
    return Buffer.from(hkdfSync('sha256', this.tenantKey(tenantId), salt, Buffer.from('meridian/subject/' + subjectId), 32));
  }
  blindIndex(tenantId: string, label: string, value: string): Buffer {
    const k = Buffer.from(hkdfSync('sha256', this.tenantKey(tenantId), Buffer.alloc(0), Buffer.from('meridian/bidx/' + label), 32));
    return createHmac('sha256', k).update(value.normalize('NFKC').trim().toUpperCase()).digest();
  }
  hmacKey(tenantId: string, label: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.tenantKey(tenantId), Buffer.alloc(0), Buffer.from('meridian/hmac/' + label), 32));
  }
  wrapTenantKey(tenantId: string, version: number, key: Buffer): Buffer { return seal(this.master, key, `tenant-key:${tenantId}:${version}`); }
  unwrapTenantKey(tenantId: string, version: number, wrapped: Buffer): Buffer { return open(this.master, wrapped, `tenant-key:${tenantId}:${version}`); }
  wrapSubjectKey(tenantId: string, subjectId: string, tenantVersion: number, tenantKey: Buffer, dataKey: Buffer): Buffer {
    return seal(tenantKey, dataKey, `subject-key:${tenantId}:${subjectId}:${tenantVersion}`);
  }
  unwrapSubjectKey(tenantId: string, subjectId: string, tenantVersion: number, tenantKey: Buffer, wrapped: Buffer): Buffer {
    return open(tenantKey, wrapped, `subject-key:${tenantId}:${subjectId}:${tenantVersion}`);
  }
  wrapWithMaster(data: Buffer, aad: string): Buffer { return seal(this.master, data, aad); }
  unwrapWithMaster(blob: Buffer, aad: string): Buffer { return open(this.master, blob, aad); }
  destroy(): void { this.master.fill(0); }
}

export async function createKms(cfg: Config): Promise<Kms> {
  const provider: KeyProvider = cfg.KEY_PROVIDER === 'aws-kms'
    ? new AwsKmsKeyProvider(cfg.KMS_KEY_ID!, Buffer.from(cfg.MERIDIAN_WRAPPED_MASTER_KEY!, 'base64'), cfg.KMS_REGION, cfg.KMS_ENDPOINT, cfg.MERIDIAN_DEPLOYMENT)
    : new LocalKeyProvider(cfg.masterKey, cfg.MERIDIAN_DEPLOYMENT);
  const master = await provider.unwrapMasterKey();
  return new Kms(master);
}
export function randomDataKey(): Buffer { return randomBytes(32); }
export function wipe(...buffers: Array<Buffer | null | undefined>): void { for (const b of buffers) b?.fill(0); }

/** AES-256-GCM. Layout: version(1) | iv(12) | tag(16) | ciphertext. AAD binds ciphertext to its row/column. */
export function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
}
export function open(key: Buffer, blob: Buffer, aad: string): Buffer {
  if (key.length !== 32 || blob.length < 29 || blob[0] !== 1) throw new Error('unsupported ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(1, 13));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(13, 29));
  return Buffer.concat([d.update(blob.subarray(29)), d.final()]);
}
