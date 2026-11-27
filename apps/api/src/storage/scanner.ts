import net from 'node:net';
import { Readable } from 'node:stream';

export type ScanResult = { status: 'clean' } | { status: 'infected'; signature: string } | { status: 'error'; message: string };
export type ScanInput = Buffer | Readable | AsyncIterable<Buffer>;

export interface Scanner {
  scan(input: ScanInput): Promise<ScanResult>;
}

/** Deliberately explicit: local development may opt out, but production must not silently do so. */
export class NoneScanner implements Scanner {
  async scan(_input: ScanInput): Promise<ScanResult> { return { status: 'clean' }; }
}

export interface ClamdScannerOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  chunkBytes?: number;
}

/**
 * ClamAV's INSTREAM protocol is small enough to implement with Node's TCP client:
 * send the command, length-prefix bounded chunks, terminate with a zero length, then
 * accept only the single bounded result line. No shell or temporary file is involved.
 */
export class ClamdScanner implements Scanner {
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly chunkBytes: number;
  constructor(private readonly options: ClamdScannerOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 4096;
    this.chunkBytes = Math.min(Math.max(options.chunkBytes ?? 1024 * 1024, 1024), 4 * 1024 * 1024);
  }

  async scan(input: ScanInput): Promise<ScanResult> {
    try {
      return await this.run(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'scanner connection failed';
      return { status: 'error', message: message.slice(0, 300) };
    }
  }

  private async run(input: ScanInput): Promise<ScanResult> {
    const socket = net.createConnection({ host: this.options.host, port: this.options.port });
    socket.setTimeout(this.timeoutMs);
    let response: Uint8Array = new Uint8Array(0);
    const responseDone = new Promise<Buffer>((resolve, reject) => {
      socket.once('connect', () => resolve(Buffer.alloc(0)));
      socket.once('error', reject);
      socket.once('timeout', () => reject(new Error('scanner timed out')));
    });
    try {
      await responseDone;
      await this.write(socket, Buffer.from('zINSTREAM\0'));
      for await (const chunk of chunks(input, this.chunkBytes)) {
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        await this.write(socket, header);
        await this.write(socket, chunk);
      }
      const end = Buffer.alloc(4);
      await this.write(socket, end);
      response = await this.readResponse(socket);
    } finally {
      socket.destroy();
    }
    const line = Buffer.from(response).toString('utf8').replace(/\0/g, '').trim();
    if (!line) throw new Error('scanner returned an empty response');
    const found = /^stream:\s+(.+?)\s+FOUND$/i.exec(line);
    if (found) return { status: 'infected', signature: found[1]!.slice(0, 200) };
    if (/^stream:\s+OK$/i.test(line)) return { status: 'clean' };
    throw new Error('scanner returned an invalid response');
  }

  private write(socket: net.Socket, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (e: Error) => { socket.off('error', onError); reject(e); };
      socket.once('error', onError);
      socket.write(data, () => { socket.off('error', onError); resolve(); });
    });
  }

  private readResponse(socket: net.Socket): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let data = Buffer.alloc(0);
      const timer = setTimeout(() => { cleanup(); reject(new Error('scanner timed out')); }, this.timeoutMs);
      const onData = (chunk: Buffer) => {
        data = Buffer.concat([data, chunk]);
        if (data.length > this.maxResponseBytes) {
          cleanup(); reject(new Error('scanner response exceeded the configured limit')); return;
        }
        if (data.includes(10)) { cleanup(); resolve(data); }
      };
      const onError = (e: Error) => { cleanup(); reject(e); };
      const onClose = () => { cleanup(); if (data.length) resolve(data); else reject(new Error('scanner closed without a response')); };
      const cleanup = () => { clearTimeout(timer); socket.off('data', onData); socket.off('error', onError); socket.off('close', onClose); };
      socket.on('data', onData); socket.once('error', onError); socket.once('close', onClose);
    });
  }
}

async function* chunks(input: ScanInput, max: number): AsyncGenerator<Buffer> {
  if (Buffer.isBuffer(input)) {
    for (let offset = 0; offset < input.length; offset += max) yield input.subarray(offset, Math.min(offset + max, input.length));
    return;
  }
  for await (const part of input) {
    const buf = Buffer.isBuffer(part) ? part : Buffer.from(part);
    for (let offset = 0; offset < buf.length; offset += max) yield buf.subarray(offset, Math.min(offset + max, buf.length));
  }
}
