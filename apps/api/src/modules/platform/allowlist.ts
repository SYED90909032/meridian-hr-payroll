export interface WebhookAllowRule { host: string; path_prefix: string }
export function urlMatchesAllowlist(url: URL, rules: WebhookAllowRule[]): boolean {
  if (!rules.length) return true;
  const host = url.hostname.toLowerCase();
  return rules.some((r) => host === r.host && url.pathname.startsWith(r.path_prefix));
}
