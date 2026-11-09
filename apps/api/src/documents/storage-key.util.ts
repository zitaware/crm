/**
 * Builds the S3 object key for a new document. The optional prefix folder
 * (S3_PREFIX_FOLDER) lets several apps share one bucket. The full key is
 * stored on the document row, so documents uploaded before a prefix was set
 * keep resolving to their original key (ADR-190).
 */
export function buildStorageKey(input: {
  prefixFolder: string;
  organizationId: string;
  documentGroupId: string;
  documentId: string;
  originalFilename: string;
}): string {
  const key = `${input.organizationId}/${input.documentGroupId}/${input.documentId}-${input.originalFilename}`;
  const prefix = input.prefixFolder.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${key}` : key;
}
