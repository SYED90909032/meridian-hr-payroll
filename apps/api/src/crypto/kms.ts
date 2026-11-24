import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Local KMS adapter (ADR-011, still open). The master key comes from the environment. A real deployment replaces
 * this class with a cloud KMS or HSM client behind the same interface. Keys are derived per tenant with HKDF; a data key
 * per subject is derived from the tenant key, so destroying a subject means refusing to derive it again (see shred in people).
 */
export class Kms {
  constructor(private readonly master: Buffer) {
    if (master.length !== 32) throw new Error('master key must be 32 bytes');
  }

  tenantKey(tenantId: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.master, Buffer.from(tenantId), Buffer.from('meridian/tenant-key/v1'), 32));
  }

  /** Per subject data key. `salt` is the stored random wrapped_key material, so destroying it makes the key unrecoverable. */
  subjectKey(tenantId: string, subjectId: string, salt: Buffer): Buffer {
    return Buffer.from(hkdfSync('sha256', this.tenantKey(tenantId), salt, Buffer.from('meridian/subject/' + subjectId), 32));
  }

  /** Keyed hash for equality lookups (blind index). Not reversible, not shared across tenants. */
  blindIndex(tenantId: string, label: string, value: string): Buffer {
    const k = Buffer.from(hkdfSync('sha256', this.tenantKey(tenantId), Buffer.alloc(0), Buffer.from('meridian/bidx/' + label), 32));
    return createHmac('sha256', k).update(value.normalize('NFKC').trim().toUpperCase()).digest();
  }

  /** Key for short lived tokens, such as AI pseudonyms. */
  hmacKey(tenantId: string, label: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.tenantKey(tenantId), Buffer.alloc(0), Buffer.from('meridian/hmac/' + label), 32));
  }
}

/** AES-256-GCM. Layout: version(1) | iv(12) | tag(16) | ciphertext. The AAD binds a ciphertext to its row and column. */
export function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
}

export function open(key: Buffer, blob: Buffer, aad: string): Buffer {
  if (blob.length < 29 || blob[0] !== 1) throw new Error('unsupported ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(1, 13));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(13, 29));
  return Buffer.concat([d.update(blob.subarray(29)), d.final()]);
}
