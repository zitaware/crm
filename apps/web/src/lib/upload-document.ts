'use client';

import { trpc } from '@/server/trpc';

export async function sha256Hex(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Uploads one file and links it to a record, the steps the Documents tab
 * takes (no password protection): reserve, send to storage, confirm, link.
 */
export function useUploadAndLink() {
  const initiateUpload = trpc.documents.initiateUpload.useMutation();
  const confirmUpload = trpc.documents.confirmUpload.useMutation();
  const linkToEntity = trpc.documents.linkToEntity.useMutation();

  return async (file: File, entityType: 'DIRECT_EXPENSE' | 'VENDOR_BILL', entityId: string) => {
    const contentType = file.type || 'application/octet-stream';
    const { document: doc, uploadUrl } = await initiateUpload.mutateAsync({
      documentCategoryId: undefined,
      originalFilename: file.name,
      contentType,
      sizeBytes: String(file.size),
      checksum: await sha256Hex(file),
      isEncrypted: false,
      encryptionSalt: undefined,
      encryptionIv: undefined,
    });
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
    if (!put.ok) throw new Error('Upload to storage failed.');
    await confirmUpload.mutateAsync({ documentId: doc.id });
    await linkToEntity.mutateAsync({ documentId: doc.id, entityType, entityId, linkType: undefined });
  };
}
