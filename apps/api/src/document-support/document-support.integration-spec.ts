import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentSupportService } from './document-support.service';

const prisma = new PrismaService();
const documentSupport = new DocumentSupportService(prisma);

let organizationId: string;
let documentCategoryId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Doc Support Test Org', code: `DOCSUPTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const category = await prisma.client.documentCategory.create({
    data: { id: generateId(), organizationId, code: 'TENDER_DOC', name: 'Tender Documents' },
  });
  documentCategoryId = category.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.documentCategoryEntityType.deleteMany({ where: { documentCategoryId } });
  await prisma.client.penaltyCategory.deleteMany({ where: { organizationId } });
  await prisma.client.documentCategory.deleteMany({ where: { organizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('DocumentSupportService', () => {
  it('lists the seeded global entity types', async () => {
    const entityTypes = await documentSupport.listEntityTypes();
    expect(entityTypes.map((et) => et.code)).toEqual(
      expect.arrayContaining(['LEAD', 'TENDER', 'PROJECT', 'EMPLOYEE', 'LEGAL_ENTITY']),
    );
  });

  it('sets and reads back document-category entity-type applicability', async () => {
    let links = await documentSupport.listDocumentCategoryEntityTypes({ documentCategoryId });
    expect(links).toEqual([]);

    await documentSupport.setDocumentCategoryEntityTypes({
      organizationId,
      documentCategoryId,
      entityTypeCodes: ['TENDER', 'PROJECT'],
      actorId,
      correlationId: generateId(),
    });

    links = await documentSupport.listDocumentCategoryEntityTypes({ documentCategoryId });
    expect(links.sort()).toEqual(['PROJECT', 'TENDER']);

    // Replacing with a smaller set removes the old links entirely.
    await documentSupport.setDocumentCategoryEntityTypes({
      organizationId,
      documentCategoryId,
      entityTypeCodes: ['LEAD'],
      actorId,
      correlationId: generateId(),
    });
    links = await documentSupport.listDocumentCategoryEntityTypes({ documentCategoryId });
    expect(links).toEqual(['LEAD']);
  });

  it('creates a penalty category with a basisType field and manages its lifecycle', async () => {
    const created = await documentSupport.createPenaltyCategory({
      organizationId,
      code: 'LATE_DELIVERY',
      name: 'Late Delivery Penalty',
      description: undefined,
      basisType: 'PERCENTAGE_OF_CONTRACT_VALUE',
      sortOrder: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(created.basisType).toBe('PERCENTAGE_OF_CONTRACT_VALUE');

    const updated = await documentSupport.updatePenaltyCategory({
      organizationId,
      id: created.id,
      name: undefined,
      description: 'Updated description',
      basisType: 'FIXED_AMOUNT',
      sortOrder: undefined,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });
    expect(updated.basisType).toBe('FIXED_AMOUNT');
    expect(updated.description).toBe('Updated description');

    await documentSupport.setPenaltyCategoryActive({
      organizationId,
      id: created.id,
      isActive: false,
      expectedVersion: updated.version,
      actorId,
      correlationId: generateId(),
    });

    const activeList = await documentSupport.listPenaltyCategories({
      organizationId,
      includeInactive: false,
    });
    expect(activeList.some((row) => row.id === created.id)).toBe(false);
  });

  it('lists seeded global payment modes and updates label/sortOrder/isActive only', async () => {
    const modes = await documentSupport.listPaymentModes({ includeInactive: false });
    const cash = modes.find((mode) => mode.code === 'CASH');
    expect(cash).toBeTruthy();
    expect(cash?.isCashLike).toBe(true);

    const updated = await documentSupport.updatePaymentMode({
      organizationId,
      id: cash!.id,
      label: 'Cash Payment',
      sortOrder: undefined,
      isActive: undefined,
      expectedVersion: cash!.version,
      actorId,
      correlationId: generateId(),
    });
    expect(updated.label).toBe('Cash Payment');
    expect(updated.code).toBe('CASH');

    // Revert so re-running this test suite stays idempotent for other tests.
    await documentSupport.updatePaymentMode({
      organizationId,
      id: cash!.id,
      label: 'Cash',
      sortOrder: undefined,
      isActive: undefined,
      expectedVersion: updated.version,
      actorId,
      correlationId: generateId(),
    });
  });
});
