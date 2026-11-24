import { createHash, randomBytes } from 'node:crypto';

export const newToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer): Buffer => createHash('sha256').update(s).digest();
export const sha256hex = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
