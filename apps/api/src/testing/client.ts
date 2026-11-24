import type { FastifyInstance } from 'fastify';
import { totpAt } from '../crypto/totp.js';

export interface Res<T = any> { status: number; body: T; headers: Record<string, unknown> }
/** In-process HTTP client with a cookie jar. Sends the same header the web app sends, so cookie-authenticated mutations are accepted. */
export class Client {
  cookie: string | null = null;
  totpSecret: string | null = null;
  constructor(private readonly app: FastifyInstance, private readonly opts: { web?: boolean; origin?: string } = {}) {}
  async req<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (this.opts.web !== false && !h['x-api-key'] && !h['x-device-key']) h['x-meridian-client'] = 'web';
    if (this.opts.origin) h.origin = this.opts.origin;
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await this.app.inject({ method: method as 'GET', url, headers: h, payload: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers['set-cookie'];
    const first = Array.isArray(sc) ? sc[0] : sc;
    if (first) { const pair = first.split(';')[0]!; this.cookie = pair.endsWith('=') ? null : pair; }
    let parsed: any = null;
    try { parsed = r.body ? JSON.parse(r.body) : null; } catch { parsed = r.body; }
    return { status: r.statusCode, body: parsed, headers: r.headers as Record<string, unknown> };
  }
  get = <T = any>(url: string, headers?: Record<string, string>) => this.req<T>('GET', url, undefined, headers);
  post = <T = any>(url: string, body?: unknown, headers?: Record<string, string>) => this.req<T>('POST', url, body ?? {}, headers);
  put = <T = any>(url: string, body?: unknown, headers?: Record<string, string>) => this.req<T>('PUT', url, body ?? {}, headers);
  patch = <T = any>(url: string, body?: unknown, headers?: Record<string, string>) => this.req<T>('PATCH', url, body ?? {}, headers);
  del = <T = any>(url: string, headers?: Record<string, string>) => this.req<T>('DELETE', url, undefined, headers);
  /** A current TOTP code for the secret this client enrolled. */
  code(offsetSteps = 0): string { return totpAt(this.totpSecret!, Date.now() + offsetSteps * 30000); }
  async login(email: string, password: string, totp?: string): Promise<Res> {
    return this.post('/api/v1/auth/login', { email, password, ...(totp ? { totp } : {}) });
  }
  async stepUp(password: string, totp?: string): Promise<Res> {
    return this.post('/api/v1/auth/step-up', { password, ...(totp ? { totp } : {}) });
  }
  /** Enrols two-step verification for the signed-in user. Needs a fresh step-up first (done here). */
  async enrolMfa(password: string): Promise<string[]> {
    const s = await this.stepUp(password);
    if (s.status !== 200) throw new Error('step-up failed: ' + JSON.stringify(s.body));
    const b = await this.post('/api/v1/auth/mfa/begin');
    if (b.status !== 200) throw new Error('mfa begin failed: ' + JSON.stringify(b.body));
    this.totpSecret = b.body.secret;
    const c = await this.post('/api/v1/auth/mfa/confirm', { code: this.code() });
    if (c.status !== 200) throw new Error('mfa confirm failed: ' + JSON.stringify(c.body));
    return c.body.recoveryCodes;
  }
}
