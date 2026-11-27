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

function put(sftp: SFTPWrapper, remote: string, content: string): Promise<void> {
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

export class SftpBankTransport implements BankTransport {
  constructor(private readonly options: SftpTransportOptions) {}

  private connection(): { client: Client; config: ConnectConfig } {
    const expected = this.options.hostKeySha256.replace(/^SHA256:/, '');
    const config: ConnectConfig = {
      host: this.options.host,
      port: this.options.port,
      username: this.options.username,
      privateKey: this.options.privateKey,
      readyTimeout: this.options.connectTimeoutMs,
      hostVerifier: (key: Buffer | string) => {
        const actual = createHash('sha256').update(typeof key === 'string' ? key : key).digest('base64').replace(/=+$/, '');
        return actual === expected;
      },
    };
    return { client: new Client(), config };
  }

  async submit(file: BankFile): Promise<BankReceipt> {
    const { client, config } = this.connection();
    try {
      const sftp = await sftpReady(client, config);
      const remote = `${this.options.remoteDir.replace(/\/$/, '')}/${file.filename}`;
      await put(sftp, remote, file.content);
      return { transport: 'sftp', receipt: remote, submittedAt: new Date().toISOString() };
    } finally { close(client); }
  }

  async fetchAcknowledgement(receipt: BankReceipt): Promise<BankAcknowledgement | null> {
    const { client, config } = this.connection();
    try {
      const sftp = await sftpReady(client, config);
      try { return { receipt: receipt.receipt, content: await read(sftp, `${receipt.receipt}.ack`) }; }
      catch (err: unknown) {
        const code = (err as { code?: number }).code;
        if (code === 2) return null;
        throw err;
      }
    } finally { close(client); }
  }
}
