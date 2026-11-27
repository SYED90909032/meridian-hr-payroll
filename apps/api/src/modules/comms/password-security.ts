import { createHash } from 'node:crypto';
import { passwordProblem } from '../../crypto/password.js';
import type { Config } from '../../config.js';

const COMMON = new Set(['password', 'password123', '123456789', 'qwerty123', 'letmein', 'welcome1', 'iloveyou', 'admin123', 'changeme', 'meridian']);
export interface BreachCheckOptions { fetcher?: typeof fetch; apiBase?: string; mode?: 'fail-open' | 'fail-closed'; timeoutMs?: number }
export class BreachLookupError extends Error {}
export async function breachedPassword(password: string, options: BreachCheckOptions = {}): Promise<boolean> {
  const local = password.toLowerCase();
  if (COMMON.has(local) || COMMON.has(local.replace(/[^a-z0-9]/g, ''))) return true;
  const digest = createHash('sha1').update(password.normalize('NFKC')).digest('hex').toUpperCase();
  const prefix = digest.slice(0, 5); const suffix = digest.slice(5);
  const fetcher = options.fetcher ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), options.timeoutMs ?? 2500);
  try {
    const res = await fetcher(`${options.apiBase ?? 'https://api.pwnedpasswords.com'}/range/${prefix}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'Meridian-Password-Safety/1' }, signal: ctl.signal });
    if (!res.ok) throw new BreachLookupError(`breach lookup HTTP ${res.status}`);
    const body = await res.text();
    return body.split(/\r?\n/).some((line) => line.split(':', 1)[0]?.trim().toUpperCase() === suffix);
  } catch (e) {
    if (e instanceof BreachLookupError) throw e;
    throw new BreachLookupError('breach lookup unavailable');
  } finally { clearTimeout(timer); }
}
export async function passwordProblemWithBreach(password: string, email: string | undefined, cfg: Pick<Config, 'HIBP_MODE' | 'HIBP_API_BASE'>, fetcher?: typeof fetch): Promise<string | null> {
  const local = passwordProblem(password, email);
  if (local) return local;
  try {
    if (await breachedPassword(password, { fetcher, apiBase: cfg.HIBP_API_BASE, mode: cfg.HIBP_MODE })) return 'Choose a password that has not appeared in a known breach.';
  } catch (e) {
    if (cfg.HIBP_MODE === 'fail-closed') throw new Error('Password safety check is temporarily unavailable');
    // Fail-open is deliberate: HIBP is a defence-in-depth signal, not an authentication dependency.
    console.warn('breached-password lookup unavailable; continuing with local password policy');
  }
  return null;
}

export interface CaptchaVerifier { verify(response: string, ip?: string): Promise<boolean> }
export class TurnstileVerifier implements CaptchaVerifier {
  constructor(private readonly secret: string, private readonly fetcher: typeof fetch = fetch) {}
  async verify(response: string, ip?: string): Promise<boolean> {
    const res = await this.fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: this.secret, response, remoteip: ip }) });
    if (!res.ok) return false;
    const data = await res.json() as { success?: boolean }; return data.success === true;
  }
}
