import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv } from '@zitaware/config';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { DocumentPort, DocumentSummary, DocumentLinkSummary } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';
import { buildStorageKey } from './storage-key.util';

const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const DOWNLOAD_URL_EXPIRY_SECONDS = 5 * 60;

interface DocumentRow {
  id: string;
  documentCategoryId: string | null;
  documentGroupId: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: bigint;
  checksum: string;
  status: string;
  uploadedBy: string;
  uploadedAt: Date | null;
  isEncrypted: boolean;
  version: number;
}

interface DocumentLinkRow {
  id: string;
  documentId: string;
  entityType: string;
  entityId: string;
  linkType: string | null;
  createdAt: Date;
}

function toDocumentSummary(row: DocumentRow, uploadedByName: string | null = null): DocumentSummary {
  return {
    id: row.id,
    documentCategoryId: row.documentCategoryId,
    documentGroupId: row.documentGroupId,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes.toString(),
    checksum: row.checksum,
    status: row.status as DocumentSummary['status'],
    uploadedBy: row.uploadedBy,
    uploadedByName,
    uploadedAt: row.uploadedAt ? row.uploadedAt.toISOString() : null,
    isEncrypted: row.isEncrypted,
    version: row.version,
  };
}

function toDocumentLinkSummary(row: DocumentLinkRow): DocumentLinkSummary {
  return {
    id: row.id,
    documentId: row.documentId,
    entityType: row.entityType,
    entityId: row.entityId,
    linkType: row.linkType,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class DocumentsService implements DocumentPort {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly prefixFolder: string;

  constructor(private readonly prisma: PrismaService) {
    const env = loadEnv();
    this.bucket = env.S3_BUCKET;
    this.prefixFolder = env.S3_PREFIX_FOLDER;
    this.s3Client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      // Path-style addressing is only needed for non-AWS S3-compatible
      // endpoints (MinIO, etc.); real AWS S3 uses virtual-hosted-style.
      forcePathStyle: !!env.S3_ENDPOINT,
    });
  }

  async initiateUpload(input: {
    organizationId: string;
    documentCategoryId: string | undefined;
    originalFilename: string;
    contentType: string;
    sizeBytes: string;
    checksum: string;
    isEncrypted: boolean | undefined;
    encryptionSalt: string | undefined;
    encryptionIv: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<{ document: DocumentSummary; uploadUrl: string }> {
    if (input.isEncrypted && (!input.encryptionSalt || !input.encryptionIv)) {
      throwAppError('VALIDATION_FAILED', 'An encrypted document requires both encryptionSalt and encryptionIv.');
    }

    const documentId = generateId();
    const documentGroupId = generateId();
    const storageKey = buildStorageKey({
      prefixFolder: this.prefixFolder,
      organizationId: input.organizationId,
      documentGroupId,
      documentId,
      originalFilename: input.originalFilename,
    });

    let created;
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.document.create({
          data: {
            id: documentId,
            organizationId: input.organizationId,
            documentCategoryId: input.documentCategoryId ?? null,
            documentGroupId,
            storageKey,
            originalFilename: input.originalFilename,
            contentType: input.contentType,
            sizeBytes: BigInt(input.sizeBytes),
            checksum: input.checksum,
            uploadedBy: input.actorId,
            status: 'PENDING_UPLOAD',
            isEncrypted: input.isEncrypted ?? false,
            encryptionSalt: input.encryptionSalt ?? null,
            encryptionIv: input.encryptionIv ?? null,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'DOCUMENT',
          entityId: row.id,
          action: 'DOCUMENT_UPLOAD_INITIATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: {
            originalFilename: input.originalFilename,
            contentType: input.contentType,
            isEncrypted: input.isEncrypted ?? false,
          },
        });
        return row;
      });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Unknown document category for this organization.');
      }
      throw error;
    }

    const uploadUrl = await getSignedUrl(
      this.s3Client,
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, ContentType: input.contentType }),
      { expiresIn: UPLOAD_URL_EXPIRY_SECONDS },
    );

    return { document: toDocumentSummary(created), uploadUrl };
  }

  async confirmUpload(input: {
    organizationId: string;
    documentId: string;
    actorId: string;
    correlationId: string;
  }): Promise<DocumentSummary> {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const document = await tx.document.findFirst({
        where: { id: input.documentId, organizationId: input.organizationId },
      });
      if (!document) {
        throwAppError('NOT_FOUND', 'Document not found.');
      }
      if (document.status !== 'PENDING_UPLOAD') {
        throwAppError('INVALID_STATE_TRANSITION', `Cannot confirm a document in status ${document.status}.`);
      }

      const row = await tx.document.update({
        where: { id: input.documentId },
        data: { status: 'UPLOADED', uploadedAt: new Date(), version: { increment: 1 } },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DOCUMENT',
        entityId: row.id,
        action: 'DOCUMENT_UPLOAD_CONFIRMED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      return row;
    });
    return toDocumentSummary(updated);
  }

  async linkToEntity(input: {
    organizationId: string;
    documentId: string;
    entityType: string;
    entityId: string;
    linkType: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<DocumentLinkSummary> {
    const created = await this.prisma.client.$transaction(async (tx) => {
      const document = await tx.document.findFirst({
        where: { id: input.documentId, organizationId: input.organizationId },
      });
      if (!document) {
        throwAppError('NOT_FOUND', 'Document not found.');
      }
      if (document.status !== 'UPLOADED') {
        throwAppError('INVALID_STATE_TRANSITION', 'Only an UPLOADED document can be linked to an entity.');
      }

      if (document.documentCategoryId) {
        const allowedEntityTypes = await tx.documentCategoryEntityType.findMany({
          where: { documentCategoryId: document.documentCategoryId },
        });
        // No rows for this category means it applies to every entity type
        // (the established "absence = applies everywhere" semantics).
        if (
          allowedEntityTypes.length > 0 &&
          !allowedEntityTypes.some((link) => link.entityTypeCode === input.entityType)
        ) {
          throwAppError(
            'VALIDATION_FAILED',
            `This document's category does not permit linking to entity type ${input.entityType}.`,
          );
        }
      }

      const row = await tx.documentLink.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          documentId: input.documentId,
          entityType: input.entityType,
          entityId: input.entityId,
          linkType: input.linkType ?? null,
          createdBy: input.actorId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DOCUMENT_LINK',
        entityId: row.id,
        action: 'DOCUMENT_LINKED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { documentId: input.documentId, entityType: input.entityType, entityId: input.entityId },
      });
      return row;
    });
    return toDocumentLinkSummary(created);
  }

  async listLinksForEntity(input: {
    organizationId: string;
    entityType: string;
    entityId: string;
    linkType: string | null | undefined;
  }): Promise<Array<DocumentLinkSummary & { document: DocumentSummary }>> {
    const rows = await this.prisma.client.documentLink.findMany({
      where: {
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.linkType !== undefined ? { linkType: input.linkType } : {}),
      },
      include: { document: true },
      orderBy: { createdAt: 'desc' },
    });

    const uploaderIds = [...new Set(rows.map((row) => row.document.uploadedBy))];
    const uploaders = uploaderIds.length
      ? await this.prisma.client.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, displayName: true } })
      : [];
    const nameById = new Map(uploaders.map((u) => [u.id, u.displayName]));

    return rows.map((row) => ({
      ...toDocumentLinkSummary(row),
      document: toDocumentSummary(row.document, nameById.get(row.document.uploadedBy) ?? null),
    }));
  }

  async softDelete(input: {
    organizationId: string;
    documentId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const document = await tx.document.findFirst({
        where: { id: input.documentId, organizationId: input.organizationId },
      });
      if (!document) {
        throwAppError('NOT_FOUND', 'Document not found.');
      }

      await tx.document.update({
        where: { id: input.documentId },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          deletedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DOCUMENT',
        entityId: input.documentId,
        action: 'DOCUMENT_DELETED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async getDownloadUrl(input: {
    organizationId: string;
    documentId: string;
    actorId: string;
    correlationId: string;
  }): Promise<{
    downloadUrl: string;
    originalFilename: string;
    contentType: string;
    isEncrypted: boolean;
    encryptionSalt: string | null;
    encryptionIv: string | null;
  }> {
    const document = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.document.findFirst({
        where: { id: input.documentId, organizationId: input.organizationId },
      });
      if (!row) {
        throwAppError('NOT_FOUND', 'Document not found.');
      }
      if (row.status !== 'UPLOADED') {
        throwAppError('INVALID_STATE_TRANSITION', `Cannot download a document in status ${row.status}.`);
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DOCUMENT',
        entityId: row.id,
        action: 'DOCUMENT_DOWNLOADED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      return row;
    });

    const downloadUrl = await getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: this.bucket, Key: document.storageKey }),
      { expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS },
    );

    return {
      downloadUrl,
      originalFilename: document.originalFilename,
      contentType: document.contentType,
      isEncrypted: document.isEncrypted,
      encryptionSalt: document.encryptionSalt,
      encryptionIv: document.encryptionIv,
    };
  }
}
