'use client';

import { useState } from 'react';
import { App, Button, Checkbox, Input, Modal, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { decryptToBlob, encryptFile, fromBase64, toBase64 } from '@/lib/document-crypto';
import { formatDateTime } from '@/lib/format';
import { sha256Hex } from '@/lib/upload-document';


/**
 * A synthetic `<a>` click, not `window.open()` — window.open() called after
 * async work (fetch/decrypt) is no longer tied closely enough to the
 * original user gesture and gets silently popup-blocked by Chromium.
 * Anchor-element clicks reliably open a new tab even after an await.
 */
function openOrDownloadBlob(blob: Blob, filename: string, mode: 'view' | 'download') {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  if (mode === 'view') {
    link.target = '_blank';
  } else {
    link.download = filename;
  }
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function openUrlInNewTab(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.click();
}

/**
 * Reused verbatim across every entity that attaches documents (Lead,
 * Project, invoices…) — the underlying documents router is already
 * entity-agnostic (`entityType`/`entityId`), so this component just needs
 * those two values, not one per entity. `linkType` narrows both the list
 * and the upload to one tagged sub-category (e.g. an invoice's "inward
 * copy") — omitted, it behaves exactly as the generic, untagged tab.
 */
export function DocumentsTab({
  entityType,
  entityId,
  linkType,
  uploadCardTitle = 'Add Document',
  listCardTitle,
  emptyText = 'No documents yet.',
}: {
  entityType:
    | 'LEAD'
    | 'PROJECT'
    | 'INVOICE'
    | 'RECEIPT'
    | 'SECURITY_INSTRUMENT'
    | 'VENDOR_BILL'
    | 'PAYMENT_REQUEST'
    | 'EMPLOYEE_EXPENSE_CLAIM'
    | 'DIRECT_EXPENSE'
    | 'SUBSCRIPTION'
    | 'SERVER';
  entityId: string;
  linkType?: string;
  uploadCardTitle?: string;
  listCardTitle?: string;
  emptyText?: string;
}) {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canUpload = (me.data?.permissions ?? []).includes('document.upload');
  const canManage = (me.data?.permissions ?? []).includes('document.manage');
  const canDownload = (me.data?.permissions ?? []).includes('document.download');

  const utils = trpc.useUtils();
  // A generic (untagged) tab must only show untagged links — omitting the
  // filter entirely would also surface another tagged section's documents
  // (e.g. an invoice's Inward Copy) in the plain "Documents" list.
  const listFilter = linkType ?? null;
  const links = trpc.documents.listLinksForEntity.useQuery({ entityType, entityId, linkType: listFilter });

  const [file, setFile] = useState<File | null>(null);
  const [passwordProtect, setPasswordProtect] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [uploading, setUploading] = useState(false);

  const initiateUpload = trpc.documents.initiateUpload.useMutation();
  const confirmUpload = trpc.documents.confirmUpload.useMutation();
  const linkToEntity = trpc.documents.linkToEntity.useMutation();
  const getDownloadUrl = trpc.documents.getDownloadUrl.useMutation();

  // Password prompt for opening an encrypted document (view or download).
  const [passwordPromptFor, setPasswordPromptFor] = useState<{ documentId: string; mode: 'view' | 'download' } | null>(
    null,
  );
  const [openPassword, setOpenPassword] = useState('');
  const [opening, setOpening] = useState(false);

  const uploadProps: UploadProps = {
    multiple: false,
    beforeUpload: (candidate) => {
      setFile(candidate);
      return false;
    },
    onRemove: () => setFile(null),
    fileList: file ? [{ uid: '-1', name: file.name, size: file.size }] : [],
  };

  const handleAddDocument = async () => {
    if (!file) {
      message.error('Choose a file to upload.');
      return;
    }
    if (passwordProtect) {
      if (password.length < 8) {
        message.error('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        message.error('Passwords do not match.');
        return;
      }
    }
    setUploading(true);
    try {
      let bytesToUpload: Blob | File = file;
      let isEncrypted = false;
      let encryptionSalt: string | undefined;
      let encryptionIv: string | undefined;

      if (passwordProtect) {
        const { ciphertext, salt, iv } = await encryptFile(file, password);
        bytesToUpload = new Blob([ciphertext]);
        isEncrypted = true;
        encryptionSalt = toBase64(salt);
        encryptionIv = toBase64(iv);
      }

      const checksum = await sha256Hex(bytesToUpload);
      const { document: doc, uploadUrl } = await initiateUpload.mutateAsync({
        documentCategoryId: undefined,
        originalFilename: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: String(bytesToUpload.size),
        checksum,
        isEncrypted,
        encryptionSalt,
        encryptionIv,
      });
      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: bytesToUpload,
      });
      if (!putResponse.ok) throw new Error('Upload to storage failed.');
      await confirmUpload.mutateAsync({ documentId: doc.id });
      await linkToEntity.mutateAsync({ documentId: doc.id, entityType, entityId, linkType });
      message.success('Document added.');
      setFile(null);
      setPasswordProtect(false);
      setPassword('');
      setConfirmPassword('');
      await utils.documents.listLinksForEntity.invalidate({ entityType, entityId, linkType: listFilter });
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to add document.');
    } finally {
      setUploading(false);
    }
  };

  const openDocument = async (documentId: string, originalFilename: string, mode: 'view' | 'download') => {
    setOpening(true);
    try {
      const result = await getDownloadUrl.mutateAsync({ documentId });
      if (!result.isEncrypted) {
        if (mode === 'view') {
          // No decryption needed, so no blob is needed either — opening the
          // presigned S3 URL directly avoids blob: URLs in new tabs, which
          // Chromium can leave blank when the tab lands in another process.
          openUrlInNewTab(result.downloadUrl);
        } else {
          const blob = await (await fetch(result.downloadUrl)).blob();
          openOrDownloadBlob(blob, originalFilename, mode);
        }
        return;
      }
      setPasswordPromptFor({ documentId, mode });
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to open document.');
    } finally {
      setOpening(false);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!passwordPromptFor) return;
    setOpening(true);
    try {
      const result = await getDownloadUrl.mutateAsync({ documentId: passwordPromptFor.documentId });
      if (!result.isEncrypted || !result.encryptionSalt || !result.encryptionIv) {
        throw new Error('This document is not encrypted.');
      }
      const ciphertext = await (await fetch(result.downloadUrl)).arrayBuffer();
      const blob = await decryptToBlob(
        ciphertext,
        openPassword,
        fromBase64(result.encryptionSalt),
        fromBase64(result.encryptionIv),
        result.contentType,
      );
      openOrDownloadBlob(blob, result.originalFilename, passwordPromptFor.mode);
      setPasswordPromptFor(null);
      setOpenPassword('');
    } catch {
      message.error('Incorrect password.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[360px_1fr]">
      {canUpload && canManage ? (
        <UiCard title={uploadCardTitle}>
          <div className="flex flex-col gap-3">
            <Upload.Dragger {...uploadProps}>
              <p>Click to upload or drag &amp; drop</p>
            </Upload.Dragger>
            <Checkbox checked={passwordProtect} onChange={(e) => setPasswordProtect(e.target.checked)}>
              Password-protect this document
            </Checkbox>
            {passwordProtect ? (
              <>
                <Input.Password
                  placeholder="Password (min. 8 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Input.Password
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <p className="text-[12px] text-negative">
                  There is no way to recover this document if the password is lost — not even by an administrator.
                </p>
              </>
            ) : null}
            <Button type="primary" loading={uploading} onClick={handleAddDocument}>
              Add Document
            </Button>
            <p className="text-[12px] text-muted">Each upload is logged as a dated entry below.</p>
          </div>
        </UiCard>
      ) : null}

      <UiCard title={listCardTitle ?? `Documents (${links.data?.length ?? 0})`} className="min-w-0">
        {links.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : links.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-negative">Could not load documents. Please retry.</p>
            <Button size="small" onClick={() => links.refetch()}>
              Retry
            </Button>
          </div>
        ) : (links.data ?? []).length === 0 ? (
          <p className="text-muted">{emptyText}</p>
        ) : (
          <div className="flex flex-col divide-y divide-ui">
            {(links.data ?? []).map((link) => (
              <div key={link.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-2">
                <div className="min-w-0 flex-1 basis-40">
                  <div className="truncate font-medium text-ink" title={link.document.originalFilename}>
                    {link.document.isEncrypted ? '🔒 ' : ''}
                    {link.document.originalFilename}
                  </div>
                  <div className="text-[12px] text-muted">
                    Uploaded by {link.document.uploadedByName ?? 'Unknown'} · {formatDateTime(link.document.uploadedAt ?? link.createdAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[12px] text-muted">{link.document.status}</span>
                  {canDownload && link.document.status === 'UPLOADED' ? (
                    <>
                      <Button
                        size="small"
                        loading={opening}
                        onClick={() => openDocument(link.document.id, link.document.originalFilename, 'view')}
                      >
                        View
                      </Button>
                      <Button
                        size="small"
                        loading={opening}
                        onClick={() => openDocument(link.document.id, link.document.originalFilename, 'download')}
                      >
                        Download
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </UiCard>

      <Modal
        title="Enter password"
        open={!!passwordPromptFor}
        onCancel={() => {
          setPasswordPromptFor(null);
          setOpenPassword('');
        }}
        onOk={handlePasswordSubmit}
        confirmLoading={opening}
        okText={passwordPromptFor?.mode === 'view' ? 'View' : 'Download'}
      >
        <p className="mb-2 text-muted">This document is password-protected. Enter the password to continue.</p>
        <Input.Password
          placeholder="Password"
          value={openPassword}
          onChange={(e) => setOpenPassword(e.target.value)}
          onPressEnter={handlePasswordSubmit}
          autoFocus
        />
      </Modal>
    </div>
  );
}
