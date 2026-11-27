import type { Readable } from 'node:stream';

/**
 * Staged external-document port. Providers are intentionally not implemented until the
 * product owner resolves D-1 (Google/Drive decision). Implementations must use a tenant-
 * owned OAuth service account, restricted file-only scopes, explicit folder allow-lists,
 * short-lived credentials, and never copy provider plaintext into application logs.
 */
export interface DocumentConnector {
  readonly provider: 'google_drive' | 'sharepoint';
  list(input: { tenantId: string; employeeId: string; cursor?: string }): Promise<{ items: Array<{ id: string; name: string; mime: string; modifiedAt: string }>; nextCursor?: string }>;
  download(input: { tenantId: string; employeeId: string; externalId: string }): Promise<{ name: string; mime: string; body: Readable }>;
  revoke(input: { tenantId: string }): Promise<void>;
}

export const DOCUMENT_CONNECTORS_STATUS = 'Blocked: owner decision D-1 is open; Google Drive and SharePoint providers are not implemented.';
