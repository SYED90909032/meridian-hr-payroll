import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { HttpError } from '../../errors.js';

/**
 * Outbound-request guard for webhooks.
 * Rules: https only, no credentials in the URL, standard port only, never an address in a private, loopback,
 * link-local, multicast, CGNAT, documentation or cloud-metadata range. The host is resolved here and the caller
 * connects to the resolved IP (with the original host name as SNI), so a DNS answer cannot change between check and use.
 */
function ipv4ToInt(ip: string): number { return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0; }
const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => { const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0; return (n & mask) === (ipv4ToInt(base) & mask); });
  }
  if (fam === 6) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (mapped) return isBlockedIp(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(l)) return true; // hex form of a mapped address: refuse outright
    if (/^fe[89ab]/.test(l)) return true; // link-local fe80::/10
    if (/^f[cd]/.test(l)) return true; // unique local fc00::/7
    if (/^ff/.test(l)) return true; // multicast
    if (/^2001:0?db8/.test(l)) return true; // documentation
    if (/^(64:ff9b|2002):/.test(l)) return true; // NAT64 and 6to4 can embed private IPv4
    return false;
  }
  return true; // not an IP at all: refuse
}
export interface SafeTarget { url: URL; address: string; family: 4 | 6 }
/** Static checks that need no network. Used when an endpoint is registered. */
export function checkWebhookUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(422, 'invalid_url', 'That is not a valid URL'); }
  if (u.protocol !== 'https:') throw new HttpError(422, 'invalid_url', 'Webhook URLs must use https');
  if (u.username || u.password) throw new HttpError(422, 'invalid_url', 'Credentials in the URL are not allowed');
  if (u.port && u.port !== '443') throw new HttpError(422, 'invalid_url', 'Only the standard https port is allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedIp(host)) throw new HttpError(422, 'invalid_url', 'That address is not allowed');
  if (!isIP(host) && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || !host.includes('.'))) {
    throw new HttpError(422, 'invalid_url', 'That host name is not allowed');
  }
  return u;
}
/** Resolves and validates at delivery time. Every resolved address must be public. */
export async function resolveSafeTarget(raw: string, lookup: (h: string) => Promise<Array<{ address: string; family: number }>> = (h) => dns.lookup(h, { all: true })): Promise<SafeTarget> {
  const url = checkWebhookUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host);
  if (!addrs.length) throw new Error('host did not resolve');
  for (const a of addrs) if (isBlockedIp(a.address)) throw new Error('host resolves to a blocked address');
  const first = addrs[0]!;
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}
