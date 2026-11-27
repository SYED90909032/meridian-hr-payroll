import { openApiOperations, openApiPaths, type OpenApiOperation, type OpenApiPath } from './generated.js';
export { openApiOperations, openApiPaths };
export type { OpenApiOperation, OpenApiPath };
export interface ApiErrorShape { error: { code: string; message: string; details?: unknown; request_id?: string } }
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly shape: ApiErrorShape) { super(shape.error.message); this.name = 'ApiError'; }
}
export interface ApiClientOptions { baseUrl: string; apiKey?: string; fetch?: typeof globalThis.fetch }
export class ApiClient {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: ApiClientOptions) { this.fetcher = options.fetch ?? globalThis.fetch; }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (this.options.apiKey) headers.set('X-Api-Key', this.options.apiKey);
    const response = await this.fetcher(new URL(path.replace(/^\//, ''), this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`), { ...init, headers });
    const text = await response.text();
    const value = text ? JSON.parse(text) as unknown : undefined;
    if (!response.ok) throw new ApiError(response.status, value as ApiErrorShape);
    return value as T;
  }
  get<T>(path: string, init?: RequestInit) { return this.request<T>(path, { ...init, method: 'GET' }); }
  post<T>(path: string, body: unknown, idempotencyKey?: string) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body), headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined }); }
}
