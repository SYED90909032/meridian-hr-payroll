import { loadDotEnv } from '../../env.js';
loadDotEnv();
import pg from 'pg';
import { loadConfig } from '../../config.js';
import { createObjectStore } from '../../storage/index.js';
import { createScanner } from '../../storage/scannerFactory.js';
import { open, seal } from '../../crypto/kms.js';
import { Kms } from '../../crypto/kms.js';
import { sha256hex } from '../../crypto/tokens.js';
import { subjectKey } from './lib.js';
import type { Db } from '../../db/tx.js';
import { documentAad, documentObjectKey } from './documents.js';

const cfg = loadConfig();
const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error('DATABASE_URL_OWNER is not set');
const dryRun = process.argv.includes('--dry-run') || process.env.DOCS_DRY_RUN === 'true';
const db = new pg.Client({ connectionString: url });
const kms = new Kms(cfg.masterKey);
const objects = createObjectStore(cfg);
const scanner = createScanner(cfg);
const counts = { scanned: 0, migrated: 0, already_done: 0, quarantined: 0, pending_scan: 0, failed: 0, skipped: 0 };

await db.connect();
try {
  const rows = (await db.query<{ id: string; tenant_id: string; employee_id: string; sha256: string; content_enc: Buffer | null; object_key: string | null; status: string }>(
    "select id, tenant_id, employee_id, sha256, content_enc, object_key, status from people.document where object_key is null and status <> 'quarantined' order by created_at, id")).rows;
  for (const row of rows) {
    if (row.object_key || row.status === 'available' && !row.content_enc) { counts.already_done++; continue; }
    if (!row.content_enc) { counts.skipped++; continue; }
    counts.scanned++;
    const key = await subjectKey(db as unknown as Db, kms, row.tenant_id, row.employee_id, false);
    if (!key) { counts.failed++; continue; }
    let plaintext: Buffer;
    try { plaintext = open(key, row.content_enc, `${row.employee_id}:doc:${row.id}`); } catch { counts.failed++; continue; }
    if (sha256hex(plaintext) !== row.sha256) { counts.failed++; continue; }
    const scan = await scanner.scan(plaintext);
    if (scan.status === 'infected') {
      counts.quarantined++;
      if (!dryRun) await db.query("update people.document set content_enc = null, status = 'quarantined', scan_signature = $2, scanned_at = now() where id = $1", [row.id, scan.signature]);
      continue;
    }
    if (scan.status === 'error') {
      counts.pending_scan++;
      if (!dryRun) await db.query("update people.document set status = 'pending_scan', scan_error = $2, scan_attempts = scan_attempts + 1 where id = $1", [row.id, scan.message]);
      continue;
    }
    const objectKey = documentObjectKey(row.tenant_id, row.employee_id, row.id);
    if (!dryRun) {
      await objects.put(objectKey, seal(key, plaintext, documentAad(row.employee_id, row.id)), { contentType: 'application/octet-stream', metadata: { sha256: row.sha256, version: '1' }, overwrite: false });
      const stored = await objects.get(objectKey);
      if (!stored) throw new Error(`read-back missing for ${row.id}`);
      const checked = open(key, stored, documentAad(row.employee_id, row.id));
      if (sha256hex(checked) !== row.sha256) throw new Error(`read-back hash mismatch for ${row.id}`);
      await db.query("update people.document set content_enc = null, object_key = $2, status = 'available', scan_error = null, scanned_at = now() where id = $1", [row.id, objectKey]);
    }
    counts.migrated++;
  }
} finally {
  await db.end();
}
console.log(JSON.stringify({ dry_run: dryRun, ...counts }));
