import net from 'node:net';
/**
 * Integration tests that need real infrastructure (S3/KMS via moto, Redis, ClamAV, SMTP) call `reachable()`.
 * Locally an unreachable service skips the test; in CI `REQUIRE_INFRA=1` turns a missing service into a failure,
 * so a green pipeline can never mean "silently skipped".
 */
export const MOTO = process.env.MOTO_ENDPOINT ?? 'http://127.0.0.1:5000';
export const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
export async function reachable(hostPort: string): Promise<boolean> {
  const u = new URL(hostPort.includes('://') ? hostPort : 'tcp://' + hostPort);
  const ok = await new Promise<boolean>((res) => {
    const s = net.connect({ host: u.hostname, port: Number(u.port) });
    s.setTimeout(800); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); s.on('timeout', () => { s.destroy(); res(false); });
  });
  if (!ok && process.env.REQUIRE_INFRA === '1') throw new Error(`required test infrastructure is not reachable: ${hostPort}`);
  return ok;
}
