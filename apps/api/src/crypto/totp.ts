import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALPHA.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string { return base32Encode(randomBytes(20)); }

/** RFC 6238, SHA-1, 6 digits, 30 second step. */
export function totpAt(secret: string, timeMs: number, digits = 6, step = 30): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const code = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** Accepts the previous, current and next step. Returns the matched counter so callers can reject replays. */
export function verifyTotp(secret: string, code: string, nowMs = Date.now(), lastCounter = 0): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (const d of [-1, 0, 1]) {
    const t = nowMs + d * 30000;
    const counter = Math.floor(t / 1000 / 30);
    if (counter <= lastCounter) continue;
    const expect = Buffer.from(totpAt(secret, t));
    if (timingSafeEqual(expect, Buffer.from(code))) return counter;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = 'Meridian'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
