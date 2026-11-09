import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from './documents.service';

const prisma = new PrismaService();
const documents = new DocumentsService(prisma);

let organizationId: string;
const actorId = generateId();
const entityId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Documents Test Org', code: `DOCTEST-${generateId()}` },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.documentLink.deleteMany({ where: { organizationId } });
  await prisma.client.document.deleteMany({ where: { organizationId } });
  await prisma.client.documentCategoryEntityType.deleteMany({
    where: { documentCategory: { organizationId } },
  });
  await prisma.client.documentCategory.deleteMany({ where: { organizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('DocumentsService', () => {
  it('initiates an upload with a presigned URL, confirms it, and rejects a second confirm', async () => {
    const { document, uploadUrl } = await documents.initiateUpload({
      organizationId,
      documentCategoryId: undefined,
      originalFilename: 'client-brief.pdf',
      contentType: 'application/pdf',
      sizeBytes: '204800',
      checksum: 'deadbeef',
      isEncrypted: undefined,
      encryptionSalt: undefined,
      encryptionIv: undefined,
      actorId,
      correlationId: generateId(),
    });

    expect(document.status).toBe('PENDING_UPLOAD');
    expect(document.sizeBytes).toBe('204800');
    expect(uploadUrl).toMatch(/^https?:\/\//);
    expect(uploadUrl).toContain(document.documentGroupId);

    const confirmed = await documents.confirmUpload({
      organizationId,
      documentId: document.id,
      actorId,
      correlationId: generateId(),
    });
    expect(confirmed.status).toBe('UPLOADED');
    expect(confirmed.uploadedAt).not.toBeNull();

    await expect(
      documents.confirmUpload({
        organizationId,
        documentId: document.id,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow();
  });

  it('links an UPLOADED document to an entity and lists it back, but rejects linking a PENDING_UPLOAD document', async () => {
    const { document } = await documents.initiateUpload({
      organizationId,
      documentCategoryId: undefined,
      originalFilename: 'contract.pdf',
      contentType: 'application/pdf',
      sizeBytes: '1024',
      checksum: 'cafebabe',
      isEncrypted: undefined,
      encryptionSalt: undefined,
      encryptionIv: undefined,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      documents.linkToEntity({
        organizationId,
        documentId: document.id,
        entityType: 'LEAD',
        entityId,
        linkType: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow();

    await documents.confirmUpload({
      organizationId,
      documentId: document.id,
      actorId,
      correlationId: generateId(),
    });

    const link = await documents.linkToEntity({
      organizationId,
      documentId: document.id,
      entityType: 'LEAD',
      entityId,
      linkType: 'PRIMARY',
      actorId,
      correlationId: generateId(),
    });
    expect(link.entityType).toBe('LEAD');

    const links = await documents.listLinksForEntity({ organizationId, entityType: 'LEAD', entityId, linkType: undefined });
    expect(links).toHaveLength(1);
    expect(links[0]?.document.id).toBe(document.id);
  });

  it('listLinksForEntity resolves the uploader\'s display name, and falls back to null for an unresolvable uploader', async () => {
    const uploader = await prisma.client.user.create({
      data: { id: generateId(), organizationId, email: `doc-uploader-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: 'D. Shah', status: 'ACTIVE' },
    });
    const uploaderEntityId = generateId();

    const { document } = await documents.initiateUpload({
      organizationId, documentCategoryId: undefined, originalFilename: 'named-uploader.pdf', contentType: 'application/pdf',
      sizeBytes: '512', checksum: 'named-uploader', isEncrypted: undefined, encryptionSalt: undefined, encryptionIv: undefined,
      actorId: uploader.id, correlationId: generateId(),
    });
    await documents.confirmUpload({ organizationId, documentId: document.id, actorId: uploader.id, correlationId: generateId() });
    await documents.linkToEntity({ organizationId, documentId: document.id, entityType: 'LEAD', entityId: uploaderEntityId, linkType: undefined, actorId: uploader.id, correlationId: generateId() });

    const links = await documents.listLinksForEntity({ organizationId, entityType: 'LEAD', entityId: uploaderEntityId, linkType: undefined });
    expect(links[0]?.document.uploadedByName).toBe('D. Shah');
    expect(links[0]?.document.uploadedAt).not.toBeNull();

    // The other tests in this file upload as `actorId = generateId()`, a
    // random id with no backing User row — confirms that case degrades to
    // null rather than throwing.
    const unresolvedLinks = await documents.listLinksForEntity({ organizationId, entityType: 'LEAD', entityId, linkType: undefined });
    expect(unresolvedLinks[0]?.document.uploadedByName).toBeNull();

    await prisma.client.user.delete({ where: { id: uploader.id } });
  });

  it('listLinksForEntity distinguishes undefined (everything), null (untagged only), and a specific linkType', async () => {
    const invoiceEntityId = generateId();

    async function uploadAndLink(filename: string, linkType: string | undefined) {
      const { document } = await documents.initiateUpload({
        organizationId,
        documentCategoryId: undefined,
        originalFilename: filename,
        contentType: 'application/pdf',
        sizeBytes: '1024',
        checksum: `checksum-${filename}`,
        isEncrypted: undefined,
        encryptionSalt: undefined,
        encryptionIv: undefined,
        actorId,
        correlationId: generateId(),
      });
      await documents.confirmUpload({ organizationId, documentId: document.id, actorId, correlationId: generateId() });
      return documents.linkToEntity({
        organizationId,
        documentId: document.id,
        entityType: 'INVOICE',
        entityId: invoiceEntityId,
        linkType,
        actorId,
        correlationId: generateId(),
      });
    }

    const inwardCopy = await uploadAndLink('inward-copy.pdf', 'INWARD_COPY');
    const supporting = await uploadAndLink('supporting-doc.pdf', 'SUPPORTING');
    const untagged = await uploadAndLink('plain-doc.pdf', undefined);

    const inwardCopyOnly = await documents.listLinksForEntity({
      organizationId,
      entityType: 'INVOICE',
      entityId: invoiceEntityId,
      linkType: 'INWARD_COPY',
    });
    expect(inwardCopyOnly).toHaveLength(1);
    expect(inwardCopyOnly[0]?.id).toBe(inwardCopy.id);

    // A generic (untagged) documents section must see only the untagged
    // link, not the INWARD_COPY/SUPPORTING-tagged ones -- this is the exact
    // bug reported live (a tagged upload also showing up in the generic
    // "Documents" list).
    const untaggedOnly = await documents.listLinksForEntity({
      organizationId,
      entityType: 'INVOICE',
      entityId: invoiceEntityId,
      linkType: null,
    });
    expect(untaggedOnly).toHaveLength(1);
    expect(untaggedOnly[0]?.id).toBe(untagged.id);

    const everything = await documents.listLinksForEntity({
      organizationId,
      entityType: 'INVOICE',
      entityId: invoiceEntityId,
      linkType: undefined,
    });
    expect(everything.map((l) => l.id).sort()).toEqual([inwardCopy.id, supporting.id, untagged.id].sort());
  });

  it('soft-deletes a document, marking it DELETED', async () => {
    const { document } = await documents.initiateUpload({
      organizationId,
      documentCategoryId: undefined,
      originalFilename: 'temp.pdf',
      contentType: 'application/pdf',
      sizeBytes: '512',
      checksum: 'feedface',
      isEncrypted: undefined,
      encryptionSalt: undefined,
      encryptionIv: undefined,
      actorId,
      correlationId: generateId(),
    });

    await documents.softDelete({
      organizationId,
      documentId: document.id,
      actorId,
      correlationId: generateId(),
    });

    const row = await prisma.client.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(row.status).toBe('DELETED');
    expect(row.deletedAt).not.toBeNull();
  });

  it('rejects linking to an entity type not permitted by the document category, but allows an unrestricted category', async () => {
    const restrictedCategory = await prisma.client.documentCategory.create({
      data: { id: generateId(), organizationId, code: 'LEAD_ONLY', name: 'Lead-Only Category' },
    });
    await prisma.client.documentCategoryEntityType.create({
      data: { documentCategoryId: restrictedCategory.id, entityTypeCode: 'LEAD' },
    });

    const { document: restrictedDocument } = await documents.initiateUpload({
      organizationId,
      documentCategoryId: restrictedCategory.id,
      originalFilename: 'restricted.pdf',
      contentType: 'application/pdf',
      sizeBytes: '256',
      checksum: 'abc123',
      isEncrypted: undefined,
      encryptionSalt: undefined,
      encryptionIv: undefined,
      actorId,
      correlationId: generateId(),
    });
    await documents.confirmUpload({
      organizationId,
      documentId: restrictedDocument.id,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      documents.linkToEntity({
        organizationId,
        documentId: restrictedDocument.id,
        entityType: 'PROJECT',
        entityId,
        linkType: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow();

    // The permitted entity type for this category succeeds.
    const link = await documents.linkToEntity({
      organizationId,
      documentId: restrictedDocument.id,
      entityType: 'LEAD',
      entityId,
      linkType: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(link.entityType).toBe('LEAD');

    // A category with no document_category_entity_types rows applies to
    // every entity type.
    const unrestrictedCategory = await prisma.client.documentCategory.create({
      data: { id: generateId(), organizationId, code: 'UNRESTRICTED', name: 'Unrestricted Category' },
    });
    const { document: unrestrictedDocument } = await documents.initiateUpload({
      organizationId,
      documentCategoryId: unrestrictedCategory.id,
      originalFilename: 'unrestricted.pdf',
      contentType: 'application/pdf',
      sizeBytes: '256',
      checksum: 'def456',
      isEncrypted: undefined,
      encryptionSalt: undefined,
      encryptionIv: undefined,
      actorId,
      correlationId: generateId(),
    });
    await documents.confirmUpload({
      organizationId,
      documentId: unrestrictedDocument.id,
      actorId,
      correlationId: generateId(),
    });

    const unrestrictedLink = await documents.linkToEntity({
      organizationId,
      documentId: unrestrictedDocument.id,
      entityType: 'PROJECT',
      entityId,
      linkType: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(unrestrictedLink.entityType).toBe('PROJECT');
  });

  it('rejects a document category from a different organization (composite FK)', async () => {
    const otherOrg = await prisma.client.organization.create({
      data: { id: generateId(), name: 'Other Org', code: `OTHERORG-${generateId()}` },
    });
    const otherOrgCategory = await prisma.client.documentCategory.create({
      data: { id: generateId(), organizationId: otherOrg.id, code: 'FOREIGN', name: 'Foreign Category' },
    });

    await expect(
      documents.initiateUpload({
        organizationId,
        documentCategoryId: otherOrgCategory.id,
        originalFilename: 'cross-org.pdf',
        contentType: 'application/pdf',
        sizeBytes: '128',
        checksum: 'ghi789',
        isEncrypted: undefined,
        encryptionSalt: undefined,
        encryptionIv: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow();

    await prisma.client.documentCategory.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.client.organization.delete({ where: { id: otherOrg.id } });
  });

  it('persists isEncrypted/encryptionSalt/encryptionIv for a password-protected upload', async () => {
    const { document } = await documents.initiateUpload({
      organizationId,
      documentCategoryId: undefined,
      originalFilename: 'confidential.pdf',
      contentType: 'application/octet-stream',
      sizeBytes: '512',
      checksum: 'encrypted-checksum',
      isEncrypted: true,
      encryptionSalt: 'c29tZS1zYWx0',
      encryptionIv: 'c29tZS1pdg==',
      actorId,
      correlationId: generateId(),
    });
    expect(document.isEncrypted).toBe(true);
  });

  it('rejects isEncrypted: true with a missing salt or IV', async () => {
    await expect(
      documents.initiateUpload({
        organizationId,
        documentCategoryId: undefined,
        originalFilename: 'bad-encrypted.pdf',
        contentType: 'application/octet-stream',
        sizeBytes: '512',
        checksum: 'x',
        isEncrypted: true,
        encryptionSalt: undefined,
        encryptionIv: 'c29tZS1pdg==',
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('encryptionSalt and encryptionIv');

    await expect(
      documents.initiateUpload({
        organizationId,
        documentCategoryId: undefined,
        originalFilename: 'bad-encrypted-2.pdf',
        contentType: 'application/octet-stream',
        sizeBytes: '512',
        checksum: 'x',
        isEncrypted: true,
        encryptionSalt: 'c29tZS1zYWx0',
        encryptionIv: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('encryptionSalt and encryptionIv');
  });

  it('getDownloadUrl returns a presigned URL and encryption fields for an UPLOADED document, and audits DOCUMENT_DOWNLOADED', async () => {
    const { document } = await documents.initiateUpload({
      organizationId,
      documentCategoryId: undefined,
      originalFilename: 'downloadable.pdf',
      contentType: 'application/pdf',
      sizeBytes: '256',
      checksum: 'dl-checksum',
      isEncrypted: undefined,
      encryptionSalt: undefined,
      encryptionIv: undefined,
      actorId,
      correlationId: generateId(),
    });
    await documents.confirmUpload({ organizationId, documentId: document.id, actorId, correlationId: generateId() });

    const result = await documents.getDownloadUrl({
      organizationId,
      documentId: document.id,
      actorId,
      correlationId: generateId(),
    });
    expect(result.downloadUrl).toMatch(/^https?:\/\//);
    expect(result.originalFilename).toBe('downloadable.pdf');
    expect(result.isEncrypted).toBe(false);
    expect(result.encryptionSalt).toBeNull();

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: document.id, action: 'DOCUMENT_DOWNLOADED' },
    });
    expect(events).toHaveLength(1);
  });

  it('rejects getDownloadUrl for a PENDING_UPLOAD document', async () => {
    const { document } = await documents.initiateUpload({
      organizationId,
      documentCategoryId: undefined,
      originalFilename: 'not-yet-uploaded.pdf',
      contentType: 'application/pdf',
      sizeBytes: '256',
      checksum: 'pending-checksum',
      isEncrypted: undefined,
      encryptionSalt: undefined,
      encryptionIv: undefined,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      documents.getDownloadUrl({ organizationId, documentId: document.id, actorId, correlationId: generateId() }),
    ).rejects.toThrow();
  });

  it('rejects getDownloadUrl for a DELETED document', async () => {
    const { document } = await documents.initiateUpload({
      organizationId,
      documentCategoryId: undefined,
      originalFilename: 'to-be-deleted.pdf',
      contentType: 'application/pdf',
      sizeBytes: '256',
      checksum: 'deleted-checksum',
      isEncrypted: undefined,
      encryptionSalt: undefined,
      encryptionIv: undefined,
      actorId,
      correlationId: generateId(),
    });
    await documents.confirmUpload({ organizationId, documentId: document.id, actorId, correlationId: generateId() });
    await documents.softDelete({ organizationId, documentId: document.id, actorId, correlationId: generateId() });

    await expect(
      documents.getDownloadUrl({ organizationId, documentId: document.id, actorId, correlationId: generateId() }),
    ).rejects.toThrow();
  });

  it('rejects getDownloadUrl for a document from a different organization', async () => {
    const otherOrg = await prisma.client.organization.create({
      data: { id: generateId(), name: 'Download Cross-Org Test', code: `DLORG-${generateId()}` },
    });
    const { document } = await documents.initiateUpload({
      organizationId: otherOrg.id,
      documentCategoryId: undefined,
      originalFilename: 'other-org.pdf',
      contentType: 'application/pdf',
      sizeBytes: '256',
      checksum: 'other-org-checksum',
      isEncrypted: undefined,
      encryptionSalt: undefined,
      encryptionIv: undefined,
      actorId,
      correlationId: generateId(),
    });
    await documents.confirmUpload({ organizationId: otherOrg.id, documentId: document.id, actorId, correlationId: generateId() });

    await expect(
      documents.getDownloadUrl({ organizationId, documentId: document.id, actorId, correlationId: generateId() }),
    ).rejects.toThrow();

    await prisma.client.auditEvent.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.client.document.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.client.organization.delete({ where: { id: otherOrg.id } });
  });
});
