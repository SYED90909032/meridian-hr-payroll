import type { Db } from '../../db/tx.js';
import type { Kms } from '../../crypto/kms.js';
import type { ObjectStore } from '../../storage/objectStore.js';
import { open, seal } from '../../crypto/kms.js';
import { hashOf } from '@meridian/engine';
import { subjectKey } from '../people/lib.js';
import { HttpError } from '../../errors.js';

export const payslipAad = (employeeId: string, payslipId: string): string => `${employeeId}:payslip:${payslipId}:v1`;
export const payslipObjectKey = (tenantId: string, employeeId: string, payslipId: string): string => `payslips/${tenantId}/${employeeId}/${payslipId}.bin`;

export async function archivePayslip(db: Db, kms: Kms, objects: ObjectStore, tenantId: string, employeeId: string, payslipId: string, content: Record<string, unknown>, contentHash: string): Promise<string> {
  const key = await subjectKey(db, kms, tenantId, employeeId, true);
  if (!key) throw new HttpError(410, 'erased', 'This payslip has been erased');
  const objectKey = payslipObjectKey(tenantId, employeeId, payslipId);
  const plaintext = Buffer.from(JSON.stringify(content), 'utf8');
  await objects.put(objectKey, seal(key, plaintext, payslipAad(employeeId, payslipId)), { contentType: 'application/octet-stream', metadata: { sha256: contentHash, type: 'payslip.v1' }, overwrite: false });
  const readBack = await objects.get(objectKey);
  if (!readBack) throw new Error('payslip archive read-back failed');
  try {
    const checked = open(key, readBack, payslipAad(employeeId, payslipId));
    if (hashOf(JSON.parse(checked.toString('utf8'))) !== contentHash) throw new Error('hash mismatch');
  } catch { await objects.delete(objectKey); throw new HttpError(422, 'integrity_error', 'The payslip archive failed its integrity check'); }
  return objectKey;
}

export async function verifyPayslipArchive(db: Db, kms: Kms, objects: ObjectStore, tenantId: string, employeeId: string, payslipId: string, objectKey: string, contentHash: string): Promise<void> {
  const key = await subjectKey(db, kms, tenantId, employeeId, false);
  if (!key) throw new HttpError(410, 'erased', 'This payslip has been erased');
  const encrypted = await objects.get(objectKey);
  if (!encrypted) throw new HttpError(422, 'integrity_error', 'The payslip archive is unavailable or incomplete');
  try {
    const plaintext = open(key, encrypted, payslipAad(employeeId, payslipId));
    if (hashOf(JSON.parse(plaintext.toString('utf8'))) !== contentHash) throw new Error('hash mismatch');
  } catch { throw new HttpError(422, 'integrity_error', 'The payslip archive failed its integrity check'); }
}
