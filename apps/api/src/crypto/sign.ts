import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
export interface Signer { keyId: string; publicKeyPem: string; sign(msg: string): string; verify(msg: string, sigB64: string): boolean }
export function makeSigner(seed: Buffer): Signer {
  const priv: KeyObject = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(priv);
  const der = pub.export({ format: 'der', type: 'spki' });
  return {
    keyId: createHash('sha256').update(der).digest('hex').slice(0, 16),
    publicKeyPem: pub.export({ format: 'pem', type: 'spki' }).toString(),
    sign: (msg) => sign(null, Buffer.from(msg), priv).toString('base64'),
    verify: (msg, sig) => { try { return verify(null, Buffer.from(msg), pub, Buffer.from(sig, 'base64')); } catch { return false; } },
  };
}
const h = (a: string, b: string): string => createHash('sha256').update(Buffer.from('01' + a + b, 'hex')).digest('hex');
const leaf = (hex: string): string => createHash('sha256').update(Buffer.from('00' + hex, 'hex')).digest('hex');
/** Binary Merkle root over event hashes (hex). Domain-separated leaves and nodes; an odd node is promoted unchanged. */
export function merkleRoot(hashes: string[]): string {
  if (!hashes.length) throw new Error('empty block');
  let level = hashes.map(leaf);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? h(level[i]!, level[i + 1]!) : level[i]!);
    level = next;
  }
  return level[0]!;
}
export const blockMessage = (tenantId: string, from: number | string, to: number | string, root: string): string => `meridian-audit-block|${tenantId}|${from}|${to}|${root}`;
