import { createHash } from 'node:crypto';
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';

export interface BankFile {
  content: string;
  hash: string;
  filename: string;
}

export interface BankReceipt {
  transport: 'sftp' | 'manual';
  receipt: string;
  submittedAt: string;
}

export interface BankAcknowledgement {
  receipt: string;
  content: string;
}

export interface BankTransport {
  submit(file: BankFile): Promise<BankReceipt>;
  fetchAcknowledgement(receipt: BankReceipt): Promise<BankAcknowledgement | null>;
}

/** A connector failure carries the retry decision without exposing file contents or credentials. */
export class BankTransportError extends Error {
  constructor(message: string, public readonly retryable: boolean, override readonly cause?: unknown) {
    super(message);
    this.name = 'BankTransportError';
  }
}

export class ManualDownloadTransport implements BankTransport {
  async submit(file: BankFile): Promise<BankReceipt> {
    // Manual delivery intentionally returns a non-secret reference; the operator attaches bank evidence later.
    return { transport: 'manual', receipt: `manual:${file.hash}`, submittedAt: new Date().toISOString() };
  }

  async fetchAcknowledgement(_receipt: BankReceipt): Promise<BankAcknowledgement | null> {
    return null;
  }
}

export interface SftpTransportOptions {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  hostKeySha256: string;
  remoteDir: string;
  connectTimeoutMs: number;
}

function sftpReady(client: Client, opts: ConnectConfig): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.once('ready', () => client.sftp((err, sftp) => err ? reject(err) : resolve(sftp)));
    client.once('error', reject);
    client.connect(opts);
  });
}

function close(client: Client): void { try { client.end(); } catch { /* connection may already be closed */ } }

function errorCode(err: unknown): string | number | undefined {
  return (err as { code?: string | number } | null)?.code;
}

function isMissing(err: unknown): boolean {
  return errorCode(err) === 2 || errorCode(err) === 'ENOENT' || /no such file/i.test(String((err as Error)?.message ?? err));
}

function isAlreadyExists(err: unknown): boolean {
  return errorCode(err) === 4 || errorCode(err) === 'EEXIST' || /already exists|failure/i.test(String((err as Error)?.message ?? err));
}

function isRetryableConnectionError(err: unknown): boolean {
  const code = errorCode(err);
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ECONNABORTED') return true;
  return /timed? ?out|timeout|connection refused|connection reset|host unreachable|network unreachable/i.test(String((err as Error)?.message ?? err));
}

function isAuthenticationError(err: unknown): boolean {
  return /authentication|auth method|publickey|permission denied|all configured authentication methods failed/i.test(String((err as Error)?.message ?? err));
}

function transportError(err: unknown, hostKeyRejected: boolean): BankTransportError {
  if (err instanceof BankTransportError) return err;
  // A pinned-key or client-key failure is a configuration/security failure, not a retryable outage.
  const retryable = !hostKeyRejected && !isAuthenticationError(err) && isRetryableConnectionError(err);
  const message = hostKeyRejected ? 'SFTP host key verification failed' : isAuthenticationError(err) ? 'SFTP authentication failed' : retryable ? 'SFTP connection failed; retryable' : 'SFTP transport failed';
  return new BankTransportError(message, retryable, err);
}

function stat(sftp: SFTPWrapper, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.stat(remote, (err) => err ? reject(err) : resolve());
  });
}

function putNew(sftp: SFTPWrapper, remote: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remote, { flags: 'wx', mode: 0o600 });
    stream.once('error', reject);
    stream.once('close', resolve);
    stream.end(content, 'utf8');
  });
}

function read(sftp: SFTPWrapper, remote: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = sftp.createReadStream(remote);
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function putIdempotently(sftp: SFTPWrapper, remote: string, file: BankFile): Promise<void> {
  const expectedHash = createHash('sha256').update(file.content, 'utf8').digest('hex');
  if (expectedHash !== file.hash) throw new BankTransportError('SFTP file hash does not match content', false);

  try {
    await stat(sftp, remote);
    const existing = await read(sftp, remote);
    if (existing !== file.content) throw new BankTransportError('SFTP remote file differs from requested file', false);
    return;
  } catch (err) {
    if (!isMissing(err)) throw err;
  }

  try {
    await putNew(sftp, remote, file.content);
  } catch (err) {
    // Another worker may have won the write-once race. Verify its contents before treating this as an
    // idempotent success; never overwrite a file already handed to the bank.
    if (!isAlreadyExists(err)) throw err;
    const existing = await read(sftp, remote);
    if (existing !== file.content) throw new BankTransportError('SFTP remote file differs from requested file', false, err);
  }
}

export class SftpBankTransport implements BankTransport {
  constructor(private readonly options: SftpTransportOptions) {}

  private connection(): { client: Client; config: ConnectConfig; hostKeyRejected: { value: boolean } } {
    const expected = this.options.hostKeySha256.replace(/^SHA256:/, '').replace(/=+$/, '');
    const hostKeyRejected = { value: false };
    const config: ConnectConfig = {
      host: this.options.host,
      port: this.options.port,
      username: this.options.username,
      privateKey: this.options.privateKey,
      readyTimeout: this.options.connectTimeoutMs,
      hostVerifier: (key: Buffer | string) => {
        const actual = createHash('sha256').update(typeof key === 'string' ? key : key).digest('base64').replace(/=+$/, '');
        const accepted = actual === expected;
        if (!accepted) hostKeyRejected.value = true;
        return accepted;
      },
    };
    return { client: new Client(), config, hostKeyRejected };
  }

  async submit(file: BankFile): Promise<BankReceipt> {
    const { client, config, hostKeyRejected } = this.connection();
    try {
      const sftp = await sftpReady(client, config);
      const remote = `${this.options.remoteDir.replace(/\/$/, '')}/${file.filename}`;
      await putIdempotently(sftp, remote, file);
      return { transport: 'sftp', receipt: remote, submittedAt: new Date().toISOString() };
    } catch (err) {
      throw transportError(err, hostKeyRejected.value);
    } finally { close(client); }
  }

  async fetchAcknowledgement(receipt: BankReceipt): Promise<BankAcknowledgement | null> {
    const { client, config, hostKeyRejected } = this.connection();
    try {
      const sftp = await sftpReady(client, config);
      try { return { receipt: receipt.receipt, content: await read(sftp, `${receipt.receipt}.ack`) }; }
      catch (err: unknown) {
        if (isMissing(err)) return null;
        throw err;
      }
    } catch (err) {
      throw transportError(err, hostKeyRejected.value);
    } finally { close(client); }
  }
}
