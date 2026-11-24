import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;

function scrypt(pw: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((res, rej) => scryptCb(pw.normalize('NFKC'), salt, KEYLEN, { N: n, r: R, p: P, maxmem: 128 * n * R * 2 }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(pw: string, n = N): Promise<string> {
  const salt = randomBytes(16);
  const k = await scrypt(pw, salt, n);
  return `scrypt$${n}$${salt.toString('base64')}$${k.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !salt || !hash) return false;
  const expect = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), Number(n));
  return got.length === expect.length && timingSafeEqual(got, expect);
}

// A dummy hash so unknown emails cost the same time as wrong passwords.
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> { return (dummy ??= hashPassword('not-a-real-password')); }

/** Length and a short list of obvious passwords. No composition rules (NIST 800-63B): length matters more. */
export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 128) return 'Use at most 128 characters.';
  const lower = pw.toLowerCase();
  const bad = ['password', 'qwerty', '123456789', 'letmein', 'welcome1', 'meridian'];
  if (bad.some((b) => lower.includes(b))) return 'That password is too easy to guess.';
  if (email && lower.includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4) return 'Do not include your email name in your password.';
  if (new Set(pw).size < 5) return 'Use more varied characters.';
  return null;
}
