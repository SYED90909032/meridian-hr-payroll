import { randomUUID } from 'node:crypto';
import type { ObjectStore } from '../../storage/objectStore.js';
import type { Scanner, ScanResult } from '../../storage/scanner.js';
import type { Db } from '../../db/tx.js';
import type { Kms } from '../../crypto/kms.js';
import { open, seal } from '../../crypto/kms.js';
import { sha256hex } from '../../crypto/tokens.js';
import { HttpError, notFound } from '../../errors.js';
import { notifyEmployee, notifyRoles } from '../flow/notify.js';
import { subjectKey } from './lib.js';

export const DOCUMENT_STATUSES = ['pending_scan', 'available', 'quarantined', 'scan_failed'] as const;
export type DocumentStatus = typeof DOCUMENT_STATUSES[number];
export const documentAad = (employeeId: string, documentId: string, version = 1): string => `${employeeId}:doc:${documentId}:v${version}`;
export const documentObjectKey = (tenantId: string, employeeId: string, documentId: string, area: 'documents' | 'pending' | 'quarantine' = 'documents'): string => `${area}/${tenantId}/${employeeId}/${documentId}.bin`;
export const safeDownloadName = (name: string): string => name.replace(/[\/"\\\r\n]/g, '_').replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 200) || 'document';

export async function encryptDocument(kms: Kms, db: Db, objects: ObjectStore, tenantId: string, employeeId: string, documentId: string, plaintext: Buffer, area: 'documents' | 'pending' = 'documents'): Promise<string> {
  const key = await subjectKey(db, kms, tenantId, employeeId, true);
  if (!key) throw new HttpError(410, 'erased', 'This document has been erased');
  const objectKey = documentObjectKey(tenantId, employeeId, documentId, area);
  await objects.put(objectKey, seal(key, plaintext, documentAad(employeeId, documentId)), { contentType: 'application/octet-stream', metadata: { sha256: sha256hex(plaintext), version: '1' }, overwrite: false });
  return objectKey;
}

export async function decryptDocument(kms: Kms, db: Db, objects: ObjectStore, tenantId: string, employeeId: string, documentId: string, objectKey: string, expectedHash: string): Promise<Buffer> {
  const key = await subjectKey(db, kms, tenantId, employeeId, false);
  if (!key) throw new HttpError(410, 'erased', 'This document has been erased');
  const encrypted = await objects.get(objectKey);
  if (!encrypted) throw new HttpError(422, 'integrity_error', 'The document archive is unavailable or incomplete');
  let plaintext: Buffer;
  try { plaintext = open(key, encrypted, documentAad(employeeId, documentId)); } catch { throw new HttpError(422, 'integrity_error', 'The document archive failed its integrity check'); }
  if (sha256hex(plaintext) !== expectedHash) throw new HttpError(422, 'integrity_error', 'The document archive failed its integrity check');
  return plaintext;
}

export async function applyScanResult(args: {
  db: Db; kms: Kms; objects: ObjectStore; scanner: Scanner; tenantId: string; documentId: string; maxAttempts: number;
}): Promise<ScanResult> {
  const { db, kms, objects, scanner, tenantId, documentId, maxAttempts } = args;
  const r = await db.query<{ id: string; employee_id: string; created_by: string | null; object_key: string | null; sha256: string; status: DocumentStatus; scan_attempts: number }>(
    'select id, employee_id, created_by, object_key, sha256, status, scan_attempts from people.document where id = $1 for update', [documentId]);
  const doc = r.rows[0];
  if (!doc) throw notFound('Document not found');
  if (doc.status !== 'pending_scan' || !doc.object_key) return { status: doc.status === 'available' ? 'clean' : doc.status === 'quarantined' ? 'infected' : 'error', ...(doc.status === 'quarantined' ? { signature: 'quarantined' } : {}) } as ScanResult;
  const encrypted = await objects.get(doc.object_key);
  if (!encrypted) {
    await db.query("update people.document set status = 'scan_failed', scan_error = 'pending object is missing', scan_attempts = scan_attempts + 1 where id = $1", [documentId]);
    return { status: 'error', message: 'pending object is missing' };
  }
  const key = await subjectKey(db, kms, tenantId, doc.employee_id, false);
  if (!key) {
    await db.query("update people.document set status = 'scan_failed', scan_error = 'employee key was destroyed', scan_attempts = scan_attempts + 1 where id = $1", [documentId]);
    await objects.delete(doc.object_key);
    return { status: 'error', message: 'employee key was destroyed' };
  }
  let plaintext: Buffer;
  try { plaintext = open(key, encrypted, documentAad(doc.employee_id, doc.id)); } catch {
    await db.query("update people.document set status = 'scan_failed', scan_error = 'pending object integrity failure', scan_attempts = scan_attempts + 1 where id = $1", [documentId]);
    return { status: 'error', message: 'pending object integrity failure' };
  }
  const result = await scanner.scan(plaintext);
  if (result.status === 'clean') {
    const normalKey = documentObjectKey(tenantId, doc.employee_id, doc.id, 'documents');
    await objects.put(normalKey, encrypted, { contentType: 'application/octet-stream', metadata: { sha256: doc.sha256, version: '1' }, overwrite: false });
    await objects.delete(doc.object_key);
    await db.query("update people.document set object_key = $2, status = 'available', scan_error = null, scan_signature = null, scanned_at = now() where id = $1", [documentId, normalKey]);
    return result;
  }
  if (result.status === 'infected') {
    await objects.delete(doc.object_key);
    await db.query("update people.document set object_key = null, status = 'quarantined', scan_signature = $2, scan_error = null, scanned_at = now() where id = $1", [documentId, result.signature]);
    await notifyRoles(db, tenantId, ['hr_admin', 'owner'], { kind: 'document.quarantined', title: 'A document was quarantined', body: 'A document upload was blocked by the malware scanner.', link: `/people/${doc.employee_id}` }, doc.created_by);
    await notifyEmployee(db, tenantId, doc.employee_id, { kind: 'document.quarantined', title: 'A document upload was blocked', body: 'The uploaded document was quarantined by the malware scanner.' });
    return result;
  }
  const attempts = doc.scan_attempts + 1;
  if (attempts >= maxAttempts) {
    await objects.delete(doc.object_key);
    await db.query("update people.document set object_key = null, status = 'scan_failed', scan_error = $2, scan_attempts = $3, scanned_at = now() where id = $1", [documentId, result.message, attempts]);
  } else {
    await db.query("update people.document set scan_error = $2, scan_attempts = $3 where id = $1", [documentId, result.message, attempts]);
  }
  return result;
}

export async function deleteEmployeeObjects(db: Db, objects: ObjectStore, employeeId: string): Promise<number> {
  const docs = await db.query<{ object_key: string | null }>('select object_key from people.document where employee_id = $1', [employeeId]);
  const slips = await db.query<{ object_key: string | null }>('select object_key from pay.payslip where employee_id = $1', [employeeId]);
  for (const row of [...docs.rows, ...slips.rows]) if (row.object_key) await objects.delete(row.object_key);
  // Prefix deletion is defense in depth for orphaned pending/quarantine objects after a crashed request.
  const prefixes = await objects.list('');
  for (const row of prefixes) if (row.key.includes(`/${employeeId}/`)) await objects.delete(row.key);
  await db.query("update people.document set object_key = null, content_enc = null, status = 'scan_failed', scan_error = 'erased' where employee_id = $1", [employeeId]);
  await db.query('update pay.payslip set object_key = null where employee_id = $1', [employeeId]);
  return (docs.rowCount ?? 0) + (slips.rowCount ?? 0);
}

export function newDocumentId(): string { return randomUUID(); }
