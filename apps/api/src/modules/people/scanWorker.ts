import type { Pools } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import type { Kms } from '../../crypto/kms.js';
import type { ObjectStore } from '../../storage/objectStore.js';
import type { Scanner } from '../../storage/scanner.js';
import { applyScanResult } from './documents.js';

export async function processDocumentScanJob(pools: Pools, kms: Kms, objects: ObjectStore, scanner: Scanner, payload: Record<string, unknown>, maxAttempts: number): Promise<void> {
  const tenantId = typeof payload.tenant_id === 'string' ? payload.tenant_id : '';
  const documentId = typeof payload.document_id === 'string' ? payload.document_id : '';
  const userId = typeof payload.user_id === 'string' ? payload.user_id : null;
  const employeeId = typeof payload.employee_id === 'string' ? payload.employee_id : null;
  if (!tenantId || !documentId) throw new Error('document scan job is missing its identifiers');
  const result = await withTx(pools.app, { tenantId, userId, employeeId }, async (db) => applyScanResult({ db, kms, objects, scanner, tenantId, documentId, maxAttempts }), ['hr']);
  if (result.status === 'error') throw new Error(result.message);
}
