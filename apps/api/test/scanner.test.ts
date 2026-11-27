import net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { ClamdScanner, NoneScanner } from '../src/storage/scanner.js';
import { reachable } from './infra.js';

const clamdUp = await reachable('127.0.0.1:3310');
const eicar = () => Buffer.from(['X5O!P%@AP[4', String.fromCharCode(92), 'PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));

describe.skipIf(!clamdUp)('real ClamAV scanner', () => {
  it('returns clean for ordinary bytes and infected with the signature for EICAR', async () => {
    const s = new ClamdScanner({ host: '127.0.0.1', port: 3310, timeoutMs: 3000 });
    expect(await s.scan(Buffer.from('plain harmless test bytes'))).toEqual({ status: 'clean' });
    expect(await s.scan(eicar())).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
  });
});

describe('scanner failure behavior', () => {
  const servers: net.Server[] = [];
  afterAll(async () => { await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve())))); });
  async function server(handler: (socket: net.Socket) => void): Promise<number> {
    const s = net.createServer((socket) => { socket.setTimeout(500); socket.on('timeout', () => socket.destroy()); handler(socket); }); servers.push(s);
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
    return (s.address() as net.AddressInfo).port;
  }
  it('maps connection errors to an unavailable result', async () => {
    const s = new ClamdScanner({ host: '127.0.0.1', port: 1, timeoutMs: 100 });
    expect((await s.scan(Buffer.from('x'))).status).toBe('error');
  });
  it('times out a hanging daemon and rejects oversized responses', async () => {
    const hanging = await server(() => undefined);
    expect((await new ClamdScanner({ host: '127.0.0.1', port: hanging, timeoutMs: 50 }).scan(Buffer.from('x'))).status).toBe('error');
    const huge = await server((socket) => { socket.on('data', () => socket.write(Buffer.alloc(5000, 65))); });
    expect((await new ClamdScanner({ host: '127.0.0.1', port: huge, timeoutMs: 500, maxResponseBytes: 64 }).scan(Buffer.from('x'))).status).toBe('error');
  });
  it('makes the explicit development no-op behavior visible as clean', async () => {
    expect(await new NoneScanner().scan(Buffer.from('not scanned'))).toEqual({ status: 'clean' });
  });
});
