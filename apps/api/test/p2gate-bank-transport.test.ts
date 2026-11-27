import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import net from 'node:net';
import { Server, utils } from 'ssh2';
import { boot, type Booted } from './api-helpers.js';
import { payWorld, runTo, type PayWorld } from './pay-fixtures.js';
import { withTx } from '../src/db/tx.js';
import { queueBankSubmission } from '../src/modules/pay/bank/service.js';
import { parseAcknowledgement, reconcileAcknowledgement } from '../src/modules/pay/bank/reconciler.js';
import { BankTransportError, SftpBankTransport, type BankFile } from '../src/modules/pay/bank/transport.js';

const OPEN_MODE = { READ: 0x00000001, WRITE: 0x00000002, APPEND: 0x00000004, CREAT: 0x00000008, TRUNC: 0x00000010, EXCL: 0x00000020 } as const;
const STATUS_CODE = { OK: 0, EOF: 1, NO_SUCH_FILE: 2, FAILURE: 4 } as const;

const USERNAME = 'bank-connector';
const REMOTE_DIR = '/inbound';
const CONTENT = 'SIF|PAYMENT|2028-01|one\n';
const FILE: BankFile = { content: CONTENT, hash: createHash('sha256').update(CONTENT).digest('hex'), filename: 'payment-2028-01.sif' };

type KeyPair = ReturnType<typeof utils.generateKeyPairSync>;
interface TestSftpServer {
  root: string;
  port: number;
  hostKey: KeyPair;
  clientKey: KeyPair;
  server: Server;
  uploadCount: number;
  stop(): Promise<void>;
}

function keyBlob(key: KeyPair): Buffer {
  const parsed = utils.parseKey(key.private);
  const publicKey = Array.isArray(parsed) ? parsed[0]! : parsed;
  return publicKey.getPublicSSH();
}

function fingerprint(key: KeyPair): string {
  return `SHA256:${createHash('sha256').update(keyBlob(key)).digest('base64').replace(/=+$/, '')}`;
}

function pathFor(root: string, remote: string): string {
  const candidate = resolve(root, remote.replace(/^\/+/, ''));
  if (candidate !== root && !candidate.startsWith(root + sep)) throw new Error('test server path escape');
  return candidate;
}

function nodeFlags(pflags: number): string {
  if (pflags & OPEN_MODE.WRITE) {
    if (pflags & OPEN_MODE.EXCL) return 'wx';
    if (pflags & OPEN_MODE.APPEND) return 'a';
    if (pflags & OPEN_MODE.TRUNC) return 'w';
    return 'r+';
  }
  return 'r';
}

async function makeServer(): Promise<TestSftpServer> {
  const root = await fs.mkdtemp(join(tmpdir(), 'meridian-sftp-'));
  await fs.mkdir(join(root, 'inbound'));
  const hostKey = utils.generateKeyPairSync('rsa', { bits: 2048 });
  const clientKey = utils.generateKeyPairSync('ed25519');
  const server = new Server({ hostKeys: [hostKey.private] });
  let uploadCount = 0;
  server.on('error', () => undefined);

  server.on('connection', (connection) => {
    connection.on('error', () => undefined);
    connection.on('authentication', (ctx) => {
      if (ctx.username !== USERNAME || ctx.method !== 'publickey') return ctx.reject();
      const allowed = keyBlob(clientKey);
      if (!ctx.key.data.equals(allowed)) return ctx.reject();
      if (ctx.signature && ctx.blob) {
        const parsed = utils.parseKey(clientKey.private);
        const key = Array.isArray(parsed) ? parsed[0]! : parsed;
        if (key.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true) return ctx.reject();
      }
      return ctx.accept();
    });
    connection.on('ready', () => {
      connection.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (sftpAccept) => {
          const channel = sftpAccept();
          const handles = new Map<number, Awaited<ReturnType<typeof fs.open>>>();
          let nextHandle = 1;
          channel.on('OPEN', (requestId: number, remote: string, pflags: number) => {
            const local = pathFor(root, remote);
            if (pflags & OPEN_MODE.WRITE) uploadCount++;
            void fs.open(local, nodeFlags(pflags), 0o600).then((handle) => {
              const id = nextHandle++;
              handles.set(id, handle);
              const opaque = Buffer.alloc(4);
              opaque.writeUInt32BE(id, 0);
              channel.handle(requestId, opaque);
            }).catch((err: { code?: string }) => {
              channel.status(requestId, err.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE);
            });
          });
          channel.on('WRITE', (requestId: number, opaque: Buffer, offset: number, data: Buffer) => {
            const handle = handles.get(opaque.readUInt32BE(0));
            if (!handle) return channel.status(requestId, STATUS_CODE.FAILURE);
            void handle.write(data, 0, data.length, offset).then(() => channel.status(requestId, STATUS_CODE.OK))
              .catch(() => channel.status(requestId, STATUS_CODE.FAILURE));
          });
          channel.on('READ', (requestId: number, opaque: Buffer, offset: number, length: number) => {
            const handle = handles.get(opaque.readUInt32BE(0));
            if (!handle) return channel.status(requestId, STATUS_CODE.FAILURE);
            const buffer = Buffer.alloc(length);
            void handle.read(buffer, 0, length, offset).then(({ bytesRead }) => {
              if (bytesRead === 0) channel.status(requestId, STATUS_CODE.EOF);
              else channel.data(requestId, buffer.subarray(0, bytesRead));
            }).catch(() => channel.status(requestId, STATUS_CODE.FAILURE));
          });
          channel.on('CLOSE', (requestId: number, opaque: Buffer) => {
            const id = opaque.readUInt32BE(0);
            const handle = handles.get(id);
            if (!handle) return channel.status(requestId, STATUS_CODE.FAILURE);
            handles.delete(id);
            void handle.close().then(() => channel.status(requestId, STATUS_CODE.OK))
              .catch(() => channel.status(requestId, STATUS_CODE.FAILURE));
          });
          const stat = (requestId: number, remote: string) => {
            void fs.stat(pathFor(root, remote)).then((attrs) => channel.attrs(requestId, {
              mode: attrs.mode,
              size: attrs.size,
              uid: attrs.uid,
              gid: attrs.gid,
              atime: attrs.atimeMs,
              mtime: attrs.mtimeMs,
            })).catch((err: { code?: string }) => {
              channel.status(requestId, err.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE);
            });
          };
          channel.on('STAT', stat);
          channel.on('LSTAT', stat);
        });
      });
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SFTP test server did not expose a port');
  return {
    root,
    port: address.port,
    hostKey,
    clientKey,
    server,
    get uploadCount() { return uploadCount; },
    stop: async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function unusedPort(): Promise<number> {
  const listener = net.createServer();
  await new Promise<void>((resolveListen, reject) => listener.listen(0, '127.0.0.1', () => resolveListen()).once('error', reject));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('no ephemeral port');
  const port = address.port;
  await new Promise<void>((resolveClose) => listener.close(() => resolveClose()));
  return port;
}

let b: Booted;
let world: PayWorld;
let server: TestSftpServer;
let calculatedRunId: string;

async function insertSubmission(status: 'submitted' | 'acknowledged' | 'rejected' = 'submitted', fileHash = FILE.hash): Promise<string> {
  return withTx(b.pools.app, { tenantId: world.t.tenantId, userId: world.preparer.userId, employeeId: world.preparer.employeeId }, async (db) => {
    const r = await db.query<{ id: string }>(`insert into pay.bank_submission (tenant_id, pay_run_id, transport, file_hash, receipt, status, submitted_by)
      values ($1, $2, 'sftp', $3, $4, $5, $6) returning id`, [world.t.tenantId, calculatedRunId, fileHash, '/inbound/payment-2028-01.sif', status, world.preparer.userId]);
    return r.rows[0]!.id;
  }, ['payroll']);
}

beforeAll(async () => {
  b = await boot();
  world = await payWorld(b, 'bank-transport', 1);
  calculatedRunId = await runTo(b, world, { mode: 'sandbox', until: 'calculated', period: ['2028-01-01', '2028-01-31'] });
  server = await makeServer();
});

afterAll(async () => {
  await server.stop();
  await b.close();
});

function transport(overrides: Partial<ConstructorParameters<typeof SftpBankTransport>[0]> = {}): SftpBankTransport {
  return new SftpBankTransport({
    host: '127.0.0.1', port: server.port, username: USERNAME, privateKey: server.clientKey.private,
    hostKeySha256: fingerprint(server.hostKey), remoteDir: REMOTE_DIR, connectTimeoutMs: 1000, ...overrides,
  });
}

describe('SFTP bank transport', () => {
  it('uploads a payment file, picks up an acknowledgement, and reconciles employee instructions', async () => {
    const receipt = await transport().submit(FILE);
    expect(receipt.transport).toBe('sftp');
    expect(await fs.readFile(join(server.root, 'inbound', FILE.filename), 'utf8')).toBe(FILE.content);
    const employeeNo = (await withTx(b.pools.app, { tenantId: world.t.tenantId, userId: world.preparer.userId, employeeId: world.preparer.employeeId }, async (db) => (await db.query<{ employee_no: string }>('select employee_no from people.employee where id = $1', [world.employees[0]!.id])).rows[0]!.employee_no, ['payroll']));
    await fs.writeFile(join(server.root, 'inbound', `${FILE.filename}.ack`), `ACK,${employeeNo},ACCEPTED,processed\n`);
    const acknowledgement = await transport().fetchAcknowledgement(receipt);
    expect(acknowledgement?.content).toContain(`ACK,${employeeNo},ACCEPTED`);
    const submissionId = await insertSubmission();
    const result = await withTx(b.pools.app, { tenantId: world.t.tenantId, userId: world.preparer.userId, employeeId: world.preparer.employeeId }, (db) => reconcileAcknowledgement(db, submissionId, acknowledgement!.content), ['payroll']);
    expect(result).toEqual({ accepted: 1, rejected: 0 });
    const row = await withTx(b.pools.app, { tenantId: world.t.tenantId, userId: world.preparer.userId, employeeId: world.preparer.employeeId }, async (db) => (await db.query<{ status: string; acknowledgement_status: string }>(`select s.status, a.status as acknowledgement_status from pay.bank_submission s join pay.bank_acknowledgement a on a.bank_submission_id = s.id where s.id = $1`, [submissionId])).rows[0], ['payroll']);
    expect(row).toEqual({ status: 'acknowledged', acknowledgement_status: 'accepted' });
    expect(parseAcknowledgement(acknowledgement!.content)[0]!.status).toBe('accepted');
  });

  it('refuses a wrong pinned host key before any upload', async () => {
    const wrong = `SHA256:${'x'.repeat(43)}`;
    await expect(transport({ hostKeySha256: wrong }).submit({ ...FILE, filename: 'wrong-host.sif' })).rejects.toMatchObject({ retryable: false, message: 'SFTP host key verification failed' });
    expect(server.uploadCount).toBe(1);
    await expect(fs.access(join(server.root, 'inbound', 'wrong-host.sif'))).rejects.toThrow();
  });

  it('refuses a wrong client key', async () => {
    const wrongClient = utils.generateKeyPairSync('ed25519');
    await expect(transport({ privateKey: wrongClient.private }).submit({ ...FILE, filename: 'wrong-client.sif' })).rejects.toMatchObject({ retryable: false });
    await expect(fs.access(join(server.root, 'inbound', 'wrong-client.sif'))).rejects.toThrow();
  });

  it('marks an unreachable server failure retryable and leaves the submission state unchanged', async () => {
    const submissionId = await insertSubmission('submitted', 'c'.repeat(64));
    const port = await unusedPort();
    const failure = await transport({ port, connectTimeoutMs: 1000 }).submit({ ...FILE, filename: 'unreachable.sif' }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(BankTransportError);
    expect((failure as BankTransportError).retryable).toBe(true);
    const row = await withTx(b.pools.app, { tenantId: world.t.tenantId, userId: world.preparer.userId, employeeId: world.preparer.employeeId }, async (db) => (await db.query<{ status: string; acknowledged_at: string | null }>('select status, acknowledged_at from pay.bank_submission where id = $1', [submissionId])).rows[0], ['payroll']);
    expect(row).toEqual({ status: 'submitted', acknowledged_at: null });
  });

  it('refuses submission unless the run is payment_released', async () => {
    const before = await withTx(b.pools.app, { tenantId: world.t.tenantId, userId: world.preparer.userId, employeeId: world.preparer.employeeId }, async (db) => (await db.query<{ count: string }>('select count(*) from pay.bank_submission where pay_run_id = $1', [calculatedRunId])).rows[0]!.count, ['payroll']);
    await expect(withTx(b.pools.app, { tenantId: world.t.tenantId, userId: world.preparer.userId, employeeId: world.preparer.employeeId }, (db) => queueBankSubmission(db, world.t.tenantId, world.preparer.userId, calculatedRunId), ['payroll'])).rejects.toMatchObject({ code: 'bank_submission_not_ready' });
    const count = await withTx(b.pools.app, { tenantId: world.t.tenantId, userId: world.preparer.userId, employeeId: world.preparer.employeeId }, async (db) => (await db.query<{ count: string }>('select count(*) from pay.bank_submission where pay_run_id = $1', [calculatedRunId])).rows[0]!.count, ['payroll']);
    expect(count).toBe(before);
  });

  it('is idempotent: resubmitting the same file does not upload twice', async () => {
    const before = server.uploadCount;
    const first = await transport().submit({ ...FILE, filename: 'idempotent.sif' });
    const second = await transport().submit({ ...FILE, filename: 'idempotent.sif' });
    expect(second.receipt).toBe(first.receipt);
    expect(server.uploadCount).toBe(before + 1);
    expect(await fs.readFile(join(server.root, 'inbound', 'idempotent.sif'), 'utf8')).toBe(FILE.content);
  });
});
