import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsService } from '../accounting/chart-of-accounts.service';
import { LegalEntityService } from './legal-entity.service';
import { FinancialYearService } from './financial-year.service';
import { useInMemoryBrandingImageStore } from './branding-image-store';

const prisma = new PrismaService();
const legalEntities = new LegalEntityService(prisma);
const financialYears = new FinancialYearService(prisma);
// Branding images go to object storage (ADR-193); keep them in memory here.
const imageStore = useInMemoryBrandingImageStore();

let organizationId: string;
let stateId: string;
let ledgerAccountId: string;
let otherLedgerAccountId: string;
const actorA = generateId();
const actorB = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Org Test Org', code: `ORGTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const state = await prisma.client.state.findFirstOrThrow({ where: { code: 'MH' } });
  stateId = state.id;

  const assetGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const ledgerAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'HDFC_CURRENT_ACCOUNT', name: 'HDFC Current Account', allowManualPosting: true, isActive: true },
  });
  ledgerAccountId = ledgerAccount.id;
  const otherLedgerAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'SBI_CURRENT_ACCOUNT', name: 'SBI Current Account', allowManualPosting: true, isActive: true },
  });
  otherLedgerAccountId = otherLedgerAccount.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.cardAccount.deleteMany({ where: { organizationId } });
  await prisma.client.bankAccount.deleteMany({ where: { organizationId } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId } });
  await prisma.client.accountingPeriodTransition.deleteMany({ where: { organizationId } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId } });
  await prisma.client.gstRegistration.deleteMany({ where: { organizationId } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('LegalEntityService + FinancialYearService', () => {
  it('creates a legal entity, rejects a duplicate PAN, and manages a GST registration', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'Acme Government Contracts Pvt Ltd',
      panNumber: 'AAACA1234A',
      registeredAddress: '1 Test Street',
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(entity.panNumber).toBe('AAACA1234A');

    await expect(
      legalEntities.create({
        organizationId,
        legalName: 'Duplicate PAN Entity',
        panNumber: 'AAACA1234A',
        registeredAddress: 'Other Street',
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already exists');

    const gst = await legalEntities.createGstRegistration({
      organizationId,
      legalEntityId: entity.id,
      stateId,
      gstin: '27AAACA1234A1Z5',
      tradeName: undefined,
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(gst.gstin).toBe('27AAACA1234A1Z5');

    await expect(
      legalEntities.createGstRegistration({
        organizationId,
        legalEntityId: entity.id,
        stateId,
        gstin: 'NOT-A-VALID-GSTIN',
        tradeName: undefined,
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow();
  });

  it('creates a financial year with exactly 12 sequential, gapless accounting periods', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'FY Test Entity',
      panNumber: 'BBBCB5678B',
      registeredAddress: '2 Test Street',
      actorId: actorA,
      correlationId: generateId(),
    });

    const fy = await financialYears.create({
      organizationId,
      legalEntityId: entity.id,
      label: 'FY2025-26',
      startDate: '2025-04-01',
      endDate: '2026-03-31',
      setCurrent: true,
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(fy.isCurrent).toBe(true);

    const periods = await financialYears.listAccountingPeriods({
      organizationId,
      financialYearId: fy.id,
    });
    expect(periods).toHaveLength(12);
    expect(periods[0]?.periodNumber).toBe(1);
    expect(periods[0]?.startDate).toBe('2025-04-01');
    expect(periods[11]?.periodNumber).toBe(12);
    expect(periods[11]?.endDate).toBe('2026-03-31');
    expect(periods.every((period) => period.status === 'OPEN')).toBe(true);

    // Consecutive, gapless: each period's start is the day after the
    // previous period's end.
    for (let i = 1; i < periods.length; i++) {
      const previousEnd = new Date(`${periods[i - 1]!.endDate}T00:00:00.000Z`);
      const currentStart = new Date(`${periods[i]!.startDate}T00:00:00.000Z`);
      const expectedStart = new Date(previousEnd);
      expectedStart.setUTCDate(expectedStart.getUTCDate() + 1);
      expect(currentStart.getTime()).toBe(expectedStart.getTime());
    }
  });

  it('enforces the maker-checker accounting-period lifecycle: rejects same-actor reopen, allows a different actor', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'Maker Checker Entity',
      panNumber: 'CCCCC9012C',
      registeredAddress: '3 Test Street',
      actorId: actorA,
      correlationId: generateId(),
    });

    const fy = await financialYears.create({
      organizationId,
      legalEntityId: entity.id,
      label: 'FY2024-25',
      startDate: '2024-04-01',
      endDate: '2025-03-31',
      setCurrent: false,
      actorId: actorA,
      correlationId: generateId(),
    });

    const [firstPeriod] = await financialYears.listAccountingPeriods({
      organizationId,
      financialYearId: fy.id,
    });
    const periodId = firstPeriod!.id;

    await expect(
      financialYears.transitionAccountingPeriod({
        organizationId,
        accountingPeriodId: periodId,
        action: 'LOCK',
        reason: 'Attempting to lock before soft-close',
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow();

    const softClosed = await financialYears.transitionAccountingPeriod({
      organizationId,
      accountingPeriodId: periodId,
      action: 'SOFT_CLOSE',
      reason: 'Month-end soft close',
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(softClosed.status).toBe('SOFT_CLOSED');

    const locked = await financialYears.transitionAccountingPeriod({
      organizationId,
      accountingPeriodId: periodId,
      action: 'LOCK',
      reason: 'Finalizing the period',
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(locked.status).toBe('LOCKED');
    expect(locked.lockedBy).toBe(actorA);

    await expect(
      financialYears.transitionAccountingPeriod({
        organizationId,
        accountingPeriodId: periodId,
        action: 'REOPEN',
        reason: 'Trying to reopen my own lock',
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('cannot reopen');

    const reopened = await financialYears.transitionAccountingPeriod({
      organizationId,
      accountingPeriodId: periodId,
      action: 'REOPEN',
      reason: 'Second reviewer authorizes reopening',
      actorId: actorB,
      correlationId: generateId(),
    });
    expect(reopened.status).toBe('OPEN');
    expect(reopened.reopenedBy).toBe(actorB);

    const transitions = await financialYears.listAccountingPeriodTransitions({
      organizationId,
      accountingPeriodId: periodId,
    });
    expect(transitions.map((t) => t.action)).toEqual(['SOFT_CLOSE', 'LOCK', 'REOPEN']);
    expect(transitions.every((t) => t.reason.length > 0)).toBe(true);
  });

  it('updates a legal entity and toggles its active status', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'Update Test Entity',
      panNumber: 'DDDDD3456D',
      registeredAddress: 'Old Address',
      actorId: actorA,
      correlationId: generateId(),
    });

    const updated = await legalEntities.update({
      organizationId,
      id: entity.id,
      legalName: 'Renamed Entity',
      registeredAddress: 'New Address',
      expectedVersion: entity.version,
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(updated.legalName).toBe('Renamed Entity');
    expect(updated.registeredAddress).toBe('New Address');
    expect(updated.panNumber).toBe('DDDDD3456D');

    await expect(
      legalEntities.update({
        organizationId,
        id: entity.id,
        legalName: 'Stale Update',
        registeredAddress: undefined,
        expectedVersion: entity.version,
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');

    await legalEntities.setActive({
      organizationId,
      id: entity.id,
      isActive: false,
      expectedVersion: updated.version,
      actorId: actorA,
      correlationId: generateId(),
    });
    const afterDeactivate = await legalEntities.list({ organizationId, includeInactive: true });
    expect(afterDeactivate.find((row) => row.id === entity.id)?.isActive).toBe(false);

    const defaultList = await legalEntities.list({ organizationId, includeInactive: undefined });
    expect(defaultList.some((row) => row.id === entity.id)).toBe(false);
  });

  it('updates a GST registration trade name and toggles its active status', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'GST Update Test Entity',
      panNumber: 'EEEEE7890E',
      registeredAddress: '4 Test Street',
      actorId: actorA,
      correlationId: generateId(),
    });
    const gst = await legalEntities.createGstRegistration({
      organizationId,
      legalEntityId: entity.id,
      stateId,
      gstin: '27EEEEE7890E1Z3',
      tradeName: 'Original Trade Name',
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(gst.tradeName).toBe('Original Trade Name');

    const updated = await legalEntities.updateGstRegistration({
      organizationId,
      id: gst.id,
      tradeName: 'Renamed Trade Name',
      expectedVersion: gst.version,
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(updated.tradeName).toBe('Renamed Trade Name');
    // Immutable fields untouched.
    expect(updated.gstin).toBe('27EEEEE7890E1Z3');
    expect(updated.stateId).toBe(stateId);

    await expect(
      legalEntities.updateGstRegistration({
        organizationId,
        id: gst.id,
        tradeName: 'Stale Rename',
        expectedVersion: gst.version,
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');

    await legalEntities.setGstRegistrationActive({
      organizationId,
      id: gst.id,
      isActive: false,
      expectedVersion: updated.version,
      actorId: actorA,
      correlationId: generateId(),
    });
    const registrations = await legalEntities.listGstRegistrations({ organizationId, legalEntityId: entity.id });
    expect(registrations.find((row) => row.id === gst.id)?.isActive).toBe(false);
  });

  it('deleting a GST registration frees its GSTIN for reuse on the same legal entity', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'Delete Reuse Test Entity',
      panNumber: 'FFFFF1111F',
      registeredAddress: '5 Test Street',
      actorId: actorA,
      correlationId: generateId(),
    });
    const gst = await legalEntities.createGstRegistration({
      organizationId,
      legalEntityId: entity.id,
      stateId,
      gstin: '27FFFFF1111F1Z9',
      tradeName: undefined,
      actorId: actorA,
      correlationId: generateId(),
    });

    await legalEntities.deleteGstRegistration({
      organizationId,
      id: gst.id,
      expectedVersion: gst.version,
      actorId: actorA,
      correlationId: generateId(),
    });

    // Same GSTIN, same legal entity — must succeed now that the old row is soft-deleted.
    const recreated = await legalEntities.createGstRegistration({
      organizationId,
      legalEntityId: entity.id,
      stateId,
      gstin: '27FFFFF1111F1Z9',
      tradeName: 'Corrected Registration',
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(recreated.gstin).toBe('27FFFFF1111F1Z9');
    expect(recreated.id).not.toBe(gst.id);

    // The deleted row no longer appears in the list.
    const registrations = await legalEntities.listGstRegistrations({ organizationId, legalEntityId: entity.id });
    expect(registrations.find((row) => row.id === gst.id)).toBeUndefined();
    expect(registrations.find((row) => row.id === recreated.id)).toBeDefined();

    await expect(
      legalEntities.deleteGstRegistration({
        organizationId,
        id: gst.id,
        expectedVersion: gst.version,
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });

  it('deleting a legal entity frees its PAN for reuse, but only once it has no GST registrations or financial years', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'Delete Legal Entity Test',
      panNumber: 'GGGGG2222G',
      registeredAddress: '6 Test Street',
      actorId: actorA,
      correlationId: generateId(),
    });
    const gst = await legalEntities.createGstRegistration({
      organizationId,
      legalEntityId: entity.id,
      stateId,
      gstin: '27GGGGG2222G1Z7',
      tradeName: undefined,
      actorId: actorA,
      correlationId: generateId(),
    });

    // Blocked — still has a GST registration.
    await expect(
      legalEntities.delete({
        organizationId,
        id: entity.id,
        expectedVersion: entity.version,
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('still has GST registrations. Remove those first');

    await legalEntities.deleteGstRegistration({
      organizationId,
      id: gst.id,
      expectedVersion: gst.version,
      actorId: actorA,
      correlationId: generateId(),
    });

    // Blocked — has a financial year (financial years have no delete path).
    const fy = await financialYears.create({
      organizationId,
      legalEntityId: entity.id,
      label: 'FY-Delete-Test',
      startDate: '2025-04-01',
      endDate: '2026-03-31',
      setCurrent: false,
      actorId: actorA,
      correlationId: generateId(),
    });
    await expect(
      legalEntities.delete({
        organizationId,
        id: entity.id,
        expectedVersion: entity.version,
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('financial year, which cannot be removed');
    expect(fy.legalEntityId).toBe(entity.id);

    // Blocked with the combined message when both GST registrations and a
    // financial year exist simultaneously.
    await legalEntities.createGstRegistration({
      organizationId,
      legalEntityId: entity.id,
      stateId,
      gstin: '27GGGGG2222G1Z8',
      tradeName: undefined,
      actorId: actorA,
      correlationId: generateId(),
    });
    await expect(
      legalEntities.delete({
        organizationId,
        id: entity.id,
        expectedVersion: entity.version,
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('still has GST registrations and financial years');

    // A second entity with no dependents can be deleted, freeing its PAN.
    const cleanEntity = await legalEntities.create({
      organizationId,
      legalName: 'Delete Legal Entity Test (clean)',
      panNumber: 'HHHHH3333H',
      registeredAddress: '7 Test Street',
      actorId: actorA,
      correlationId: generateId(),
    });
    await legalEntities.delete({
      organizationId,
      id: cleanEntity.id,
      expectedVersion: cleanEntity.version,
      actorId: actorA,
      correlationId: generateId(),
    });

    const recreated = await legalEntities.create({
      organizationId,
      legalName: 'Reused PAN Entity',
      panNumber: 'HHHHH3333H',
      registeredAddress: '8 Test Street',
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(recreated.panNumber).toBe('HHHHH3333H');
    expect(recreated.id).not.toBe(cleanEntity.id);

    const list = await legalEntities.list({ organizationId, includeInactive: undefined });
    expect(list.find((row) => row.id === cleanEntity.id)).toBeUndefined();
    expect(list.find((row) => row.id === recreated.id)).toBeDefined();
  });

  it('setCurrentFinancialYear moves the current flag between two financial years for the same legal entity', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'Set Current FY Test Entity',
      panNumber: 'IIIII4444I',
      registeredAddress: '10 Test Street',
      actorId: actorA,
      correlationId: generateId(),
    });

    const oldFy = await financialYears.create({
      organizationId,
      legalEntityId: entity.id,
      label: 'FY2024-25-SetCurrent',
      startDate: '2024-04-01',
      endDate: '2025-03-31',
      setCurrent: true,
      actorId: actorA,
      correlationId: generateId(),
    });
    const newFy = await financialYears.create({
      organizationId,
      legalEntityId: entity.id,
      label: 'FY2025-26-SetCurrent',
      startDate: '2025-04-01',
      endDate: '2026-03-31',
      setCurrent: true,
      actorId: actorA,
      correlationId: generateId(),
    });

    // create's own setCurrent side-effect already unset oldFy.
    let list = await financialYears.list({ organizationId, legalEntityId: entity.id });
    expect(list.find((fy) => fy.id === oldFy.id)?.isCurrent).toBe(false);
    expect(list.find((fy) => fy.id === newFy.id)?.isCurrent).toBe(true);

    // Revert to the older financial year as current.
    const reverted = await financialYears.setCurrentFinancialYear({
      organizationId,
      legalEntityId: entity.id,
      id: oldFy.id,
      expectedVersion: oldFy.version,
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(reverted.isCurrent).toBe(true);

    list = await financialYears.list({ organizationId, legalEntityId: entity.id });
    expect(list.find((fy) => fy.id === oldFy.id)?.isCurrent).toBe(true);
    expect(list.find((fy) => fy.id === newFy.id)?.isCurrent).toBe(false);

    await expect(
      financialYears.setCurrentFinancialYear({
        organizationId,
        legalEntityId: entity.id,
        id: oldFy.id,
        expectedVersion: oldFy.version,
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });
});

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('LegalEntityService — print images', () => {
  it('stores a logo, returns it from getBranding, and clears it without touching the other images', async () => {
    const created = await legalEntities.create({
      organizationId,
      legalName: 'Branding Image Legal Entity',
      panNumber: 'BRAND1111B',
      registeredAddress: '1 Image Lane',
      logo: { contentType: 'image/png', dataBase64: TINY_PNG },
      seal: { contentType: 'image/png', dataBase64: TINY_PNG },
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(created.hasLogo).toBe(true);
    expect(created.hasSeal).toBe(true);
    expect(created.hasAuthorizedSign).toBe(false);

    // The file is in object storage under the entity's folder; the row keeps only its key.
    const stored = await prisma.client.legalEntity.findUniqueOrThrow({
      where: { id: created.id },
      select: { logoBytes: true, logoStorageKey: true, sealBytes: true, sealStorageKey: true },
    });
    expect(stored.logoBytes).toBeNull();
    expect(stored.sealBytes).toBeNull();
    expect(stored.logoStorageKey).toMatch(new RegExp(`${organizationId}/legal-entities/${created.id}/logo-[0-9a-f-]+[.]png$`));
    expect(imageStore.objects.get(stored.logoStorageKey!)?.toString('base64')).toBe(TINY_PNG);

    const branding = await legalEntities.getBranding({ organizationId, id: created.id });
    expect(branding.logo?.dataBase64).toBe(TINY_PNG);
    expect(branding.seal?.contentType).toBe('image/png');
    expect(branding.authorizedSign).toBeNull();

    const cleared = await legalEntities.update({
      organizationId,
      id: created.id,
      legalName: undefined,
      registeredAddress: undefined,
      logo: null,
      expectedVersion: created.version,
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(cleared.hasLogo).toBe(false);
    expect(cleared.hasSeal).toBe(true);

    const after = await legalEntities.getBranding({ organizationId, id: created.id });
    expect(after.logo).toBeNull();
    expect(after.seal?.dataBase64).toBe(TINY_PNG);

    await expect(legalEntities.getBranding({ organizationId, id: generateId() })).rejects.toThrow('Legal entity not found');
    await expect(
      legalEntities.create({
        organizationId,
        legalName: 'Bad Image Legal Entity',
        panNumber: 'BRAND2222B',
        registeredAddress: '2 Image Lane',
        logo: { contentType: 'image/jpeg', dataBase64: TINY_PNG },
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/does not match/);
  });
});

describe('LegalEntityService — Bank Accounts (Phase 5.2)', () => {
  it('creates, lists, updates, and deactivates a bank account', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'Bank Account Test Entity',
      panNumber: 'BANKT1234P',
      registeredAddress: 'Test Address',
      actorId: actorA,
      correlationId: generateId(),
    });

    const created = await legalEntities.createBankAccount({
      organizationId,
      legalEntityId: entity.id,
      ledgerAccountId,
      accountName: 'HDFC Operating Account',
      bankName: 'HDFC Bank',
      maskedAccountNumber: '****4471',
      ifsc: 'HDFC0000123',
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(created.ledgerAccountCode).toBe('HDFC_CURRENT_ACCOUNT');
    expect(created.isActive).toBe(true);

    const list = await legalEntities.listBankAccounts({ organizationId, legalEntityId: entity.id, includeInactive: false });
    expect(list.find((b) => b.id === created.id)).toBeTruthy();

    const updated = await legalEntities.updateBankAccount({
      organizationId,
      id: created.id,
      accountName: 'HDFC Operating Account (Renamed)',
      bankName: undefined,
      maskedAccountNumber: undefined,
      ifsc: undefined,
      expectedVersion: created.version,
      actorId: actorA,
      correlationId: generateId(),
    });
    expect(updated.accountName).toBe('HDFC Operating Account (Renamed)');
    expect(updated.bankName).toBe('HDFC Bank');

    await legalEntities.setBankAccountActive({
      organizationId,
      id: created.id,
      isActive: false,
      expectedVersion: updated.version,
      actorId: actorA,
      correlationId: generateId(),
    });
    const afterDeactivate = await legalEntities.listBankAccounts({ organizationId, legalEntityId: entity.id, includeInactive: true });
    expect(afterDeactivate.find((b) => b.id === created.id)?.isActive).toBe(false);
    const activeOnly = await legalEntities.listBankAccounts({ organizationId, legalEntityId: entity.id, includeInactive: false });
    expect(activeOnly.find((b) => b.id === created.id)).toBeUndefined();
  });

  it('rejects creating a bank account against a ledger account from another organization', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'Bank Account Cross-Org Test Entity',
      panNumber: 'BANKT5678P',
      registeredAddress: 'Test Address',
      actorId: actorA,
      correlationId: generateId(),
    });

    await expect(
      legalEntities.createBankAccount({
        organizationId,
        legalEntityId: entity.id,
        ledgerAccountId: generateId(),
        accountName: 'Nonexistent Ledger Account',
        bankName: undefined,
        maskedAccountNumber: undefined,
        ifsc: undefined,
        actorId: actorA,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Ledger account not found');
  });

  it('allows two bank accounts under different ledger accounts for the same legal entity', async () => {
    const entity = await legalEntities.create({
      organizationId,
      legalName: 'Bank Account Multi Test Entity',
      panNumber: 'BANKT9012P',
      registeredAddress: 'Test Address',
      actorId: actorA,
      correlationId: generateId(),
    });

    await legalEntities.createBankAccount({
      organizationId,
      legalEntityId: entity.id,
      ledgerAccountId,
      accountName: 'Primary Account',
      bankName: undefined,
      maskedAccountNumber: undefined,
      ifsc: undefined,
      actorId: actorA,
      correlationId: generateId(),
    });
    await legalEntities.createBankAccount({
      organizationId,
      legalEntityId: entity.id,
      ledgerAccountId: otherLedgerAccountId,
      accountName: 'Secondary Account',
      bankName: undefined,
      maskedAccountNumber: undefined,
      ifsc: undefined,
      actorId: actorA,
      correlationId: generateId(),
    });

    const list = await legalEntities.listBankAccounts({ organizationId, legalEntityId: entity.id, includeInactive: false });
    expect(list).toHaveLength(2);
  });
});

describe('LegalEntityService — Card Accounts (Phase 6.8, ADR-088)', () => {
  it('creates a Debit Card linked to a bank account, lists, updates, and deactivates it', async () => {
    const entity = await legalEntities.create({
      organizationId, legalName: 'Card Account Debit Test Entity', panNumber: 'CARDT1234P', registeredAddress: 'Test Address', actorId: actorA, correlationId: generateId(),
    });
    const bankAccount = await legalEntities.createBankAccount({
      organizationId, legalEntityId: entity.id, ledgerAccountId, accountName: 'Card Test Bank Account', bankName: undefined, maskedAccountNumber: undefined, ifsc: undefined,
      actorId: actorA, correlationId: generateId(),
    });

    const created = await legalEntities.createCardAccount({
      organizationId, legalEntityId: entity.id, type: 'DEBIT_CARD', displayName: 'Corporate Debit Card', issuerName: 'HDFC Bank', maskedLastFour: '4521',
      cardholderEmployeeId: undefined, bankAccountId: bankAccount.id, ledgerAccountId: undefined, statementDay: undefined, paymentDueDay: undefined,
      actorId: actorA, correlationId: generateId(),
    });
    expect(created.type).toBe('DEBIT_CARD');
    expect(created.bankAccountId).toBe(bankAccount.id);
    expect(created.ledgerAccountId).toBeNull();
    expect(created.isActive).toBe(true);

    const list = await legalEntities.listCardAccounts({ organizationId, legalEntityId: entity.id, includeInactive: false });
    expect(list.find((c) => c.id === created.id)).toBeTruthy();

    const updated = await legalEntities.updateCardAccount({
      organizationId, id: created.id, displayName: 'Corporate Debit Card (Renamed)', issuerName: undefined, maskedLastFour: undefined, cardholderEmployeeId: undefined,
      statementDay: undefined, paymentDueDay: undefined, expectedVersion: created.version, actorId: actorA, correlationId: generateId(),
    });
    expect(updated.displayName).toBe('Corporate Debit Card (Renamed)');
    expect(updated.issuerName).toBe('HDFC Bank');

    await legalEntities.setCardAccountActive({ organizationId, id: created.id, isActive: false, expectedVersion: updated.version, actorId: actorA, correlationId: generateId() });
    const afterDeactivate = await legalEntities.listCardAccounts({ organizationId, legalEntityId: entity.id, includeInactive: true });
    expect(afterDeactivate.find((c) => c.id === created.id)?.isActive).toBe(false);
  });

  it('creates a Credit Card with its own payable ledger account, not a bank account', async () => {
    const entity = await legalEntities.create({
      organizationId, legalName: 'Card Account Credit Test Entity', panNumber: 'CARDT5678P', registeredAddress: 'Test Address', actorId: actorA, correlationId: generateId(),
    });

    const created = await legalEntities.createCardAccount({
      organizationId, legalEntityId: entity.id, type: 'CREDIT_CARD', displayName: 'Corporate Credit Card', issuerName: 'ICICI Bank', maskedLastFour: '9911',
      cardholderEmployeeId: undefined, bankAccountId: undefined, ledgerAccountId: otherLedgerAccountId, statementDay: 5, paymentDueDay: 20,
      actorId: actorA, correlationId: generateId(),
    });
    expect(created.type).toBe('CREDIT_CARD');
    expect(created.ledgerAccountId).toBe(otherLedgerAccountId);
    expect(created.bankAccountId).toBeNull();
    expect(created.statementDay).toBe(5);
    expect(created.paymentDueDay).toBe(20);
  });

  it('rejects a Debit Card without a bank account, and a Credit Card without a ledger account', async () => {
    const entity = await legalEntities.create({
      organizationId, legalName: 'Card Account Validation Test Entity', panNumber: 'CARDT9012P', registeredAddress: 'Test Address', actorId: actorA, correlationId: generateId(),
    });

    await expect(
      legalEntities.createCardAccount({
        organizationId, legalEntityId: entity.id, type: 'DEBIT_CARD', displayName: 'No Bank Card', issuerName: undefined, maskedLastFour: '1111',
        cardholderEmployeeId: undefined, bankAccountId: undefined, ledgerAccountId: undefined, statementDay: undefined, paymentDueDay: undefined,
        actorId: actorA, correlationId: generateId(),
      }),
    ).rejects.toThrow('requires a linked bank account');

    await expect(
      legalEntities.createCardAccount({
        organizationId, legalEntityId: entity.id, type: 'CREDIT_CARD', displayName: 'No Ledger Card', issuerName: undefined, maskedLastFour: '2222',
        cardholderEmployeeId: undefined, bankAccountId: undefined, ledgerAccountId: undefined, statementDay: undefined, paymentDueDay: undefined,
        actorId: actorA, correlationId: generateId(),
      }),
    // No ledger given and no Credit Card Payable group to create one in (ADR-160).
    ).rejects.toThrow('has no active "Credit Card Payable" group');
  });

  it('rejects a Debit Card carrying a ledger account, and a Credit Card carrying a bank account', async () => {
    const entity = await legalEntities.create({
      organizationId, legalName: 'Card Account Cross Field Test Entity', panNumber: 'CARDT3456P', registeredAddress: 'Test Address', actorId: actorA, correlationId: generateId(),
    });
    const bankAccount = await legalEntities.createBankAccount({
      organizationId, legalEntityId: entity.id, ledgerAccountId, accountName: 'Cross Field Bank Account', bankName: undefined, maskedAccountNumber: undefined, ifsc: undefined,
      actorId: actorA, correlationId: generateId(),
    });

    await expect(
      legalEntities.createCardAccount({
        organizationId, legalEntityId: entity.id, type: 'DEBIT_CARD', displayName: 'Overspecified Debit Card', issuerName: undefined, maskedLastFour: '3333',
        cardholderEmployeeId: undefined, bankAccountId: bankAccount.id, ledgerAccountId: otherLedgerAccountId, statementDay: undefined, paymentDueDay: undefined,
        actorId: actorA, correlationId: generateId(),
      }),
    ).rejects.toThrow('must not carry its own payable ledger');

    await expect(
      legalEntities.createCardAccount({
        organizationId, legalEntityId: entity.id, type: 'CREDIT_CARD', displayName: 'Overspecified Credit Card', issuerName: undefined, maskedLastFour: '4444',
        cardholderEmployeeId: undefined, bankAccountId: bankAccount.id, ledgerAccountId: otherLedgerAccountId, statementDay: undefined, paymentDueDay: undefined,
        actorId: actorA, correlationId: generateId(),
      }),
    ).rejects.toThrow('must not carry a directly-linked bank account');
  });

  it('rejects a bank account from another legal entity, and an invalid masked last four', async () => {
    const entity = await legalEntities.create({
      organizationId, legalName: 'Card Account Entity Mismatch Test', panNumber: 'CARDT7890P', registeredAddress: 'Test Address', actorId: actorA, correlationId: generateId(),
    });
    const otherEntity = await legalEntities.create({
      organizationId, legalName: 'Card Account Other Entity', panNumber: 'CARDT1122P', registeredAddress: 'Test Address', actorId: actorA, correlationId: generateId(),
    });
    const otherEntityBankAccount = await legalEntities.createBankAccount({
      organizationId, legalEntityId: otherEntity.id, ledgerAccountId, accountName: 'Other Entity Bank Account', bankName: undefined, maskedAccountNumber: undefined, ifsc: undefined,
      actorId: actorA, correlationId: generateId(),
    });

    await expect(
      legalEntities.createCardAccount({
        organizationId, legalEntityId: entity.id, type: 'DEBIT_CARD', displayName: 'Mismatched Entity Card', issuerName: undefined, maskedLastFour: '5555',
        cardholderEmployeeId: undefined, bankAccountId: otherEntityBankAccount.id, ledgerAccountId: undefined, statementDay: undefined, paymentDueDay: undefined,
        actorId: actorA, correlationId: generateId(),
      }),
    ).rejects.toThrow('same legal entity');

    await expect(
      legalEntities.createCardAccount({
        organizationId, legalEntityId: entity.id, type: 'DEBIT_CARD', displayName: 'Bad Masked Digits', issuerName: undefined, maskedLastFour: 'AB12',
        cardholderEmployeeId: undefined, bankAccountId: otherEntityBankAccount.id, ledgerAccountId: undefined, statementDay: undefined, paymentDueDay: undefined,
        actorId: actorA, correlationId: generateId(),
      }),
    ).rejects.toThrow('exactly 4 digits');
  });
});

describe('LegalEntityService — a ledger of its own for each bank account and credit card (ADR-160)', () => {
  it('creates the ledger under the right group, named after the account, with a unique code', async () => {
    const bankGroup = await prisma.client.accountGroup.create({
      data: { id: generateId(), organizationId, code: 'BANK_ACCOUNTS', name: 'Bank Accounts', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
    });
    const cardGroup = await prisma.client.accountGroup.create({
      data: { id: generateId(), organizationId, code: 'CREDIT_CARD_PAYABLE', name: 'Credit Card Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
    });
    const entity = await legalEntities.create({
      organizationId, legalName: 'Own Ledger Test Entity', panNumber: 'OWNLG1234P', registeredAddress: 'Test Address', actorId: actorA, correlationId: generateId(),
    });
    const bank = (accountName: string, maskedAccountNumber?: string) =>
      legalEntities.createBankAccount({
        organizationId, legalEntityId: entity.id, ledgerAccountId: undefined, accountName, bankName: 'HDFC Bank', maskedAccountNumber, ifsc: undefined,
        actorId: actorA, correlationId: generateId(),
      });

    const first = await bank('HDFC Operating Account');
    const firstLedger = await prisma.client.ledgerAccount.findUniqueOrThrow({ where: { id: first.ledgerAccountId } });
    expect([firstLedger.accountGroupId, firstLedger.name, firstLedger.code]).toEqual([bankGroup.id, 'HDFC Operating Account', 'BANK_HDFC_OPERATING_ACCOUNT']);

    // The same name again gets its own ledger, never a shared one.
    const second = await bank('HDFC Operating Account');
    const secondLedger = await prisma.client.ledgerAccount.findUniqueOrThrow({ where: { id: second.ledgerAccountId } });
    expect(secondLedger.id).not.toBe(firstLedger.id);
    expect([secondLedger.code, secondLedger.name]).toEqual(['BANK_HDFC_OPERATING_ACCOUNT_2', 'HDFC Operating Account 2']);

    // Two HDFC accounts with the same name: the account number tells their ledgers apart.
    const third = await bank('HDFC Operating Account', '****4471');
    const thirdLedger = await prisma.client.ledgerAccount.findUniqueOrThrow({ where: { id: third.ledgerAccountId } });
    expect([thirdLedger.code, thirdLedger.name]).toEqual(['BANK_HDFC_OPERATING_ACCOUNT_3', 'HDFC Operating Account ****4471']);

    const card = await legalEntities.createCardAccount({
      organizationId, legalEntityId: entity.id, type: 'CREDIT_CARD', displayName: 'Corporate Card', issuerName: 'ICICI', maskedLastFour: '9012',
      cardholderEmployeeId: undefined, bankAccountId: undefined, ledgerAccountId: undefined, statementDay: undefined, paymentDueDay: undefined,
      actorId: actorA, correlationId: generateId(),
    });
    const cardLedger = await prisma.client.ledgerAccount.findUniqueOrThrow({ where: { id: card.ledgerAccountId! } });
    expect([cardLedger.accountGroupId, cardLedger.name, cardLedger.code]).toEqual([cardGroup.id, 'Corporate Card ****9012', 'CARD_CORPORATE_CARD_9012']);

    // The masked number in lists comes from the full account number; editing the number re-derives it.
    const numbered = await legalEntities.createBankAccount({
      organizationId, legalEntityId: entity.id, ledgerAccountId: undefined, accountName: 'HDFC Payroll Account', bankName: 'HDFC Bank', maskedAccountNumber: undefined,
      invoiceAccountNumber: '50200012344471', ifsc: undefined, actorId: actorA, correlationId: generateId(),
    });
    expect(numbered.maskedAccountNumber).toBe('****4471');
    const renumbered = await legalEntities.updateBankAccount({
      organizationId, id: numbered.id, accountName: undefined, bankName: undefined, maskedAccountNumber: undefined, invoiceAccountNumber: '50200012349988',
      ifsc: undefined, expectedVersion: numbered.version, actorId: actorA, correlationId: generateId(),
    });
    expect([renumbered.maskedAccountNumber, renumbered.invoiceAccountNumber]).toEqual(['****9988', '50200012349988']);

    const audit = await prisma.client.auditEvent.count({ where: { organizationId, entityType: 'LEDGER_ACCOUNT', entityId: { in: [firstLedger.id, secondLedger.id, cardLedger.id] }, action: 'LEDGER_ACCOUNT_CREATED' } });
    expect(audit).toBe(3);
    expect(new Set([firstLedger.id, secondLedger.id, thirdLedger.id]).size).toBe(3);

    // The ledger shows which bank account or card posts to it, with its details.
    const ledgers = new Map((await new ChartOfAccountsService(prisma).listAccounts({ organizationId, accountGroupId: undefined, includeInactive: true })).map((l) => [l.id, l]));
    expect(ledgers.get(thirdLedger.id)!.linkedAccounts).toEqual([
      { kind: 'BANK_ACCOUNT', id: third.id, name: 'HDFC Operating Account', legalEntityName: 'Own Ledger Test Entity', bankName: 'HDFC Bank', number: '****4471', ifsc: null, isActive: true },
    ]);
    expect(ledgers.get(cardLedger.id)!.linkedAccounts).toEqual([
      { kind: 'CREDIT_CARD', id: card.id, name: 'Corporate Card', legalEntityName: 'Own Ledger Test Entity', bankName: 'ICICI', number: '****9012', ifsc: null, isActive: true },
    ]);
  });
});
