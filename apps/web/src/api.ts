/** Thin fetch wrapper. Cookie session (httpOnly, set by the server) plus the client header the server requires on mutations. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, public details?: Array<{ path: string; message: string }>) { super(message); }
}

type Hook = () => Promise<boolean>;
let stepUpHook: Hook | null = null;
let unauthHook: (() => void) | null = null;
export const setStepUpHook = (h: Hook | null): void => { stepUpHook = h; };
export const setUnauthHook = (h: (() => void) | null): void => { unauthHook = h; };

async function raw(method: string, path: string, body?: unknown, extra?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Meridian-Client': 'web' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method === 'POST' && !extra?.headers) headers['Idempotency-Key'] = crypto.randomUUID();
  return fetch('/api/v1' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', ...extra });
}

async function toError(res: Response): Promise<ApiError> {
  let j: any = null;
  try { j = await res.json(); } catch { /* not json */ }
  const e = j?.error ?? {};
  return new ApiError(res.status, e.code ?? 'error', e.message ?? `Request failed (${res.status})`, e.request_id, e.details);
}

export async function api<T = any>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const res = await raw(method, path, body);
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') ?? '';
    return (ct.includes('json') ? await res.json() : await res.text()) as T;
  }
  const err = await toError(res);
  if (err.status === 401 && err.code === 'step_up_required' && !retried && stepUpHook) {
    if (await stepUpHook()) return api<T>(method, path, body, true);
  }
  if (err.status === 401 && err.code !== 'step_up_required' && err.code !== 'mfa_required' && !path.startsWith('/auth/login') && !path.startsWith('/auth/step-up')) unauthHook?.();
  throw err;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown = {}) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

/** Downloads a file through the API (cookie auth) and hands it to the browser. */
export async function download(path: string, filename: string, retried = false): Promise<void> {
  const res = await raw('GET', path, undefined, { headers: { 'X-Meridian-Client': 'web' } });
  if (!res.ok) {
    const err = await toError(res);
    if (err.status === 401 && err.code === 'step_up_required' && !retried && stepUpHook && (await stepUpHook())) return download(path, filename, true);
    throw err;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const errMsg = (e: unknown): string => (e instanceof ApiError ? (e.details?.length ? `${e.message}: ${e.details.map((d) => `${d.path} ${d.message}`).join('; ')}` : e.message) : e instanceof Error ? e.message : 'Something went wrong');

/** Money arrives as integer minor units (fils). Never use floats for arithmetic; this is display only. */
export function money(minor: number | null | undefined, currency = 'AED'): string {
  if (minor === null || minor === undefined) return '—';
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency, minimumFractionDigits: 2 }).format(minor / 100);
}
export const fmtDate = (d?: string | null): string => (d ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: d.length === 10 ? 'UTC' : undefined }) : '—');
export const fmtDateTime = (d?: string | null): string => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const days = (x1000: number): string => (x1000 / 1000).toFixed(x1000 % 1000 === 0 ? 0 : 1);
/** "1,234.50" -> 123450. Rejects anything that is not a plain amount. */
export function toMinor(v: string): number | null {
  const t = v.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
export const fromMinor = (m: number): string => (m / 100).toFixed(2);
