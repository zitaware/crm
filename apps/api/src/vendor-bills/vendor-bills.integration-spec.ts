import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import type { VendorBillLineInput } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { VendorsService } from '../vendors/vendors.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { InventoryLedgerService } from '../inventory/inventory-ledger.service';
import { VendorBillsService } from './vendor-bills.service';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const vendors = new VendorsService(prisma);
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const vendorBills = new VendorBillsService(prisma, posting, projects, new InventoryLedgerService(prisma));

let organizationId: string;
let otherOrganizationId: string;
let clientId: string;
let legalEntityId: string;
let projectId: string;
let unassignedProjectId: string;
let gujaratStateId: string;
let maharashtraStateId: string;
let gujaratGstRegistrationId: string;
let maharashtraGstRegistrationId: string;
let vendorId: string;
let inactiveVendorId: string;
let hardwareCategoryId: string;
let unmappedCategoryId: string;
let inactiveCategoryId: string;
let qtyUnitId: string;
let inactiveUnitId: string;
let scopedUserId: string;
let scopedEmployeeId: string;
// The bill creator throughout — distinct from `approverId` so ordinary
// approve()/reject() tests never trip the self-approval branch by accident;
// self-approval has its own dedicated test using `actorId` on both sides.
const actorId = generateId();
const approverId = generateId();

function basicLines(overrides: { [K in keyof VendorBillLineInput]?: VendorBillLineInput[K] | undefined } = {}): VendorBillLineInput[] {
  return [
    {
      description: 'Server rack',
      expenseCategoryId: overrides.expenseCategoryId ?? hardwareCategoryId,
      inventoryItemId: undefined,
      unitOfMeasureId: overrides.unitOfMeasureId ?? qtyUnitId,
      hsnSac: '8471',
      quantity: '1',
      unitPrice: overrides.unitPrice ?? '100000',
      gstRatePercent: overrides.gstRatePercent ?? '9',
      itcEligible: overrides.itcEligible ?? true,
    },
  ];
}

async function createDraftBill(overrides: {
  orgId?: string | undefined;
  projectId?: string | undefined;
  vendorId?: string | undefined;
  gstRegistrationId?: string | undefined;
  vendorBillNumber: string;
  vendorBillDate?: string | undefined;
  unitPrice?: string | undefined;
  expenseCategoryId?: string | undefined;
  unitOfMeasureId?: string | undefined;
  creatorActorId?: string | undefined;
  canSeeAllOverride?: boolean | undefined;
}) {
  return vendorBills.createDraft({
    organizationId: overrides.orgId ?? organizationId,
    projectId: overrides.projectId ?? projectId,
    vendorId: overrides.vendorId ?? vendorId,
    priority: undefined,
    gstRegistrationId: overrides.gstRegistrationId ?? gujaratGstRegistrationId,
    vendorBillNumber: overrides.vendorBillNumber,
    vendorBillDate: overrides.vendorBillDate ?? '2026-04-05',
    lines: basicLines({ unitPrice: overrides.unitPrice, expenseCategoryId: overrides.expenseCategoryId, inventoryItemId: undefined, unitOfMeasureId: overrides.unitOfMeasureId }),
    idempotencyKey: generateId(),
    actorId: overrides.creatorActorId ?? actorId,
    canSeeAll: overrides.canSeeAllOverride ?? true,
    correlationId: generateId(),
  });
}

async function submitBill(draft: { id: string; version: number }, opts: { orgId?: string | undefined; actorIdOverride?: string | undefined } = {}) {
  return vendorBills.submit({
    organizationId: opts.orgId ?? organizationId,
    id: draft.id,
    expectedVersion: draft.version,
    idempotencyKey: generateId(),
    actorId: opts.actorIdOverride ?? actorId,
    canSeeAll: true,
    correlationId: generateId(),
  });
}

async function approveBill(
  submitted: { id: string; version: number },
  opts: { orgId?: string | undefined; actorIdOverride?: string | undefined; note?: string | undefined; hasSelfApprovePermission?: boolean | undefined } = {},
) {
  return vendorBills.approve({
    organizationId: opts.orgId ?? organizationId,
    id: submitted.id,
    expectedVersion: submitted.version,
    note: opts.note,
    idempotencyKey: generateId(),
    actorId: opts.actorIdOverride ?? approverId,
    canSeeAll: true,
    hasSelfApprovePermission: opts.hasSelfApprovePermission ?? false,
    correlationId: generateId(),
  });
}

async function createFinalizedBill(overrides: Parameters<typeof createDraftBill>[0]) {
  const draft = await createDraftBill(overrides);
  const submitted = await submitBill(draft, { orgId: overrides.orgId, actorIdOverride: overrides.creatorActorId });
  return approveBill(submitted, { orgId: overrides.orgId });
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Vendor Bills Test Org', code: `VBTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Vendor Bills Test Other Org', code: `VBTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const gujarat = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });
  gujaratStateId = gujarat.id;
  const maharashtra = await prisma.client.state.findFirstOrThrow({ where: { code: 'MH' } });
  maharashtraStateId = maharashtra.id;

  const client = await clients.create({
    organizationId,
    name: 'Vendor Bill Test Client',
    shortCode: undefined,
    clientTypeId: undefined,
    department: 'IT',
    stateId: undefined,
    districtId: undefined,
    cityId: undefined,
    pinCode: undefined,
    officeAddress: undefined,
    gstin: undefined,
    internalNote: undefined,
    contacts: [],
    actorId,
    correlationId: generateId(),
  });
  clientId = client.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Vendor Bill Test Legal Entity', panNumber: 'ABCVB1234P', registeredAddress: 'Gandhinagar, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  const gujaratGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId,
    stateId: gujaratStateId,
    gstin: '24CCCCC0000C1Z5',
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  gujaratGstRegistrationId = gujaratGst.id;

  const maharashtraGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId,
    stateId: maharashtraStateId,
    gstin: '27CCCCC0000C1Z5',
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  maharashtraGstRegistrationId = maharashtraGst.id;

  await financialYears.create({
    organizationId,
    legalEntityId,
    label: 'FY2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    setCurrent: true,
    actorId,
    correlationId: generateId(),
  });

  const project = await projects.create({
    organizationId,
    clientId,
    legalEntityId,
    leadId: undefined,
    tenderId: undefined,
    projectManagerId: undefined,
    introducerId: undefined,
    projectTypeId: undefined,
    name: 'Vendor Bill Test Project',
    description: undefined,
    value: undefined,
    budget: undefined,
    gstApplicable: undefined,
    workOrderNumber: undefined,
    workOrderDate: undefined,
    actorId,
    correlationId: generateId(),
  });
  projectId = project.id;

  const unassignedProject = await projects.create({
    organizationId,
    clientId,
    legalEntityId,
    leadId: undefined,
    tenderId: undefined,
    projectManagerId: undefined,
    introducerId: undefined,
    projectTypeId: undefined,
    name: 'Vendor Bill Unassigned Project',
    description: undefined,
    value: undefined,
    budget: undefined,
    gstApplicable: undefined,
    workOrderNumber: undefined,
    workOrderDate: undefined,
    actorId,
    correlationId: generateId(),
  });
  unassignedProjectId = unassignedProject.id;

  const vendor = await vendors.create({
    organizationId,
    existingPartyId: undefined,
    name: 'Vendor Bill Test Vendor',
    shortCode: undefined,
    gstin: undefined,
    panNumber: undefined,
    paymentTerms: undefined,
    stateId: gujaratStateId,
    districtId: undefined,
    cityId: undefined,
    pinCode: undefined,
    officeAddress: 'Ahmedabad, Gujarat',
    internalNote: undefined,
    actorId,
    correlationId: generateId(),
  });
  vendorId = vendor.id;

  const inactiveVendor = await vendors.create({
    organizationId,
    existingPartyId: undefined,
    name: 'Vendor Bill Inactive Vendor',
    shortCode: undefined,
    gstin: undefined,
    panNumber: undefined,
    paymentTerms: undefined,
    stateId: gujaratStateId,
    districtId: undefined,
    cityId: undefined,
    pinCode: undefined,
    officeAddress: undefined,
    internalNote: undefined,
    actorId,
    correlationId: generateId(),
  });
  inactiveVendorId = inactiveVendor.id;
  await vendors.setActive({ organizationId, id: inactiveVendorId, isActive: false, expectedVersion: inactiveVendor.version, actorId, correlationId: generateId() });

  const assetGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'VB_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const liabilityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'VB_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  const expenseGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'VB_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true },
  });

  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: liabilityGroup.id, code: 'ACCOUNTS_PAYABLE_VENDOR', name: 'Accounts Payable — Vendor', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'INPUT_CGST_RECEIVABLE', name: 'Input CGST Receivable', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'INPUT_SGST_RECEIVABLE', name: 'Input SGST Receivable', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'INPUT_IGST_RECEIVABLE', name: 'Input IGST Receivable', allowManualPosting: true, isActive: true },
  });
  const hardwareAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: expenseGroup.id, code: 'HARDWARE_EXPENSE', name: 'Hardware Expense', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: expenseGroup.id, code: 'OTHER_EXPENSES', name: 'Other Expenses', allowManualPosting: true, isActive: true },
  });

  const hardwareCategory = await prisma.client.expenseCategory.create({
    data: { id: generateId(), organizationId, code: 'HARDWARE', name: 'Hardware', ledgerAccountId: hardwareAccount.id },
  });
  hardwareCategoryId = hardwareCategory.id;

  const unmappedCategory = await prisma.client.expenseCategory.create({
    data: { id: generateId(), organizationId, code: 'UNMAPPED', name: 'Unmapped Category' },
  });
  unmappedCategoryId = unmappedCategory.id;

  const inactiveCategory = await prisma.client.expenseCategory.create({
    data: { id: generateId(), organizationId, code: 'INACTIVE-VB-CAT', name: 'Inactive Category', isActive: false },
  });
  inactiveCategoryId = inactiveCategory.id;

  const qtyUnit = await prisma.client.unitOfMeasure.create({
    data: { id: generateId(), organizationId, code: 'qty', name: 'Qty' },
  });
  qtyUnitId = qtyUnit.id;

  const inactiveUnit = await prisma.client.unitOfMeasure.create({
    data: { id: generateId(), organizationId, code: 'inactive-vb-unit', name: 'Inactive Unit', isActive: false },
  });
  inactiveUnitId = inactiveUnit.id;

  const user = await prisma.client.user.create({
    data: { id: generateId(), organizationId, email: 'vb-scoped-actor@zitaware.test', passwordHash: 'test-hash', displayName: 'VB Scoped Actor', status: 'ACTIVE' },
  });
  scopedUserId = user.id;

  const employee = await prisma.client.employee.create({
    data: { id: generateId(), organizationId, userId: scopedUserId, employeeCode: 'EMP-VB-1', fullName: 'VB Scoped Actor', joiningDate: new Date('2024-01-01') },
  });
  scopedEmployeeId = employee.id;

  await projects.addTeamMember({ organizationId, projectId, employeeId: scopedEmployeeId, role: 'Requester', actorId, correlationId: generateId() });
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.vendorBillDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.vendorBillLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.vendorBill.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.expenseCategory.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.unitOfMeasure.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.projectTeamMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employee.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.gstRegistration.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.vendorProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('VendorBillsService — createDraft', () => {
  it('creates a draft directly from vendor/project/priority, deriving the legal entity from the project', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-1001', unitPrice: '900000' });
    expect(draft.status).toBe('DRAFT');
    expect(draft.vendorId).toBe(vendorId);
    expect(draft.projectId).toBe(projectId);
    expect(draft.legalEntityId).toBe(legalEntityId);
    expect(draft.priority).toBe('NORMAL');
  });

  it('rejects a duplicate vendor bill number for the same vendor while active, but allows reuse once cancelled or voided', async () => {
    const first = await createDraftBill({ vendorBillNumber: 'VB-DUP-1' });
    await expect(createDraftBill({ vendorBillNumber: 'VB-DUP-1' })).rejects.toThrow('already exists for this vendor');

    const cancelled = await vendorBills.cancel({ organizationId, id: first.id, expectedVersion: first.version, reason: 'Entered in error', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    expect(cancelled.status).toBe('CANCELLED');

    const reusedAfterCancel = await createDraftBill({ vendorBillNumber: 'VB-DUP-1' });
    expect(reusedAfterCancel.status).toBe('DRAFT');

    const finalized = await createFinalizedBill({ vendorBillNumber: 'VB-DUP-2' });
    await expect(createDraftBill({ vendorBillNumber: 'VB-DUP-2' })).rejects.toThrow('already exists for this vendor');
    const voided = await vendorBills.void({ organizationId, id: finalized.id, expectedVersion: finalized.version, reason: 'Wrong entry', accountingDate: '2026-04-12', idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    expect(voided.status).toBe('VOID');
    const reusedAfterVoid = await createDraftBill({ vendorBillNumber: 'VB-DUP-2' });
    expect(reusedAfterVoid.status).toBe('DRAFT');
  });

  it('rejects an inactive expense category on a line', async () => {
    await expect(createDraftBill({ vendorBillNumber: 'VB-INACTIVE-CAT', expenseCategoryId: inactiveCategoryId })).rejects.toThrow('is inactive');
  });

  it('rejects an inactive unit of measure on a line', async () => {
    await expect(createDraftBill({ vendorBillNumber: 'VB-INACTIVE-UNIT', unitOfMeasureId: inactiveUnitId })).rejects.toThrow('is inactive');
  });

  it('rejects an inactive vendor', async () => {
    await expect(createDraftBill({ vendorBillNumber: 'VB-INACTIVE-VENDOR', vendorId: inactiveVendorId })).rejects.toThrow('is inactive');
  });

  it('rejects raising a bill against a cancelled project', async () => {
    const cancellableProject = await projects.create({
      organizationId,
      clientId,
      legalEntityId,
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: undefined,
      introducerId: undefined,
      projectTypeId: undefined,
      name: 'Vendor Bill Cancellable Project',
      description: undefined,
      value: undefined,
      budget: undefined,
      gstApplicable: undefined,
      workOrderNumber: undefined,
      workOrderDate: undefined,
      actorId,
      correlationId: generateId(),
    });
    await projects.changeStatus({ organizationId, id: cancellableProject.id, targetStatus: 'CANCELLED', reason: 'No longer proceeding.', expectedVersion: cancellableProject.version, actorId, canSeeAll: true, correlationId: generateId() });

    await expect(createDraftBill({ vendorBillNumber: 'VB-CANCELLED-PROJECT', projectId: cancellableProject.id })).rejects.toThrow('cancelled or closed');
  });

  it('idempotent repeat of createDraft with the same key returns the original result; a different body with the same key conflicts', async () => {
    const key = generateId();
    const body = {
      organizationId,
      projectId,
      vendorId,
      priority: undefined,
      gstRegistrationId: gujaratGstRegistrationId,
      vendorBillNumber: 'VB-IDEMPOTENT',
      vendorBillDate: '2026-04-05',
      lines: basicLines(),
      idempotencyKey: key,
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    } as const;

    const first = await vendorBills.createDraft(body);
    const second = await vendorBills.createDraft(body);
    expect(second.id).toBe(first.id);

    await expect(vendorBills.createDraft({ ...body, vendorBillNumber: 'VB-DIFFERENT', idempotencyKey: key })).rejects.toThrow('Idempotency key reused');
  });
});

describe('VendorBillsService — updateDraft', () => {
  it('can change vendor/project/priority/GST registration on a draft (regression: composite-FK relations sit behind updateMany()\'s own scalar/connect exclusion)', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-UPDATE-ALL' });
    expect(draft.gstRegistrationId).toBe(gujaratGstRegistrationId);

    const updated = await vendorBills.updateDraft({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      projectId: undefined,
      vendorId: undefined,
      priority: 'URGENT',
      gstRegistrationId: maharashtraGstRegistrationId,
      vendorBillNumber: undefined,
      vendorBillDate: undefined,
      lines: undefined,
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    expect(updated.gstRegistrationId).toBe(maharashtraGstRegistrationId);
    expect(updated.gstRegistrationGstin).toBe('27CCCCC0000C1Z5');
    expect(updated.priority).toBe('URGENT');
    expect(updated.version).toBe(draft.version + 1);

    const detail = await vendorBills.getDetail({ organizationId, id: draft.id, actorId, canSeeAll: true });
    expect(detail.gstRegistrationId).toBe(maharashtraGstRegistrationId);
  });

  it('changing the GST registration alone (lines untouched) still lets approve compute against the new registration', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-UPDATE-GST-REG-APPROVE' });

    // Switch to interstate and re-save the lines too, exactly like the
    // frontend's own draft editor always does (both fields are submitted
    // together on every Save Draft click).
    const updated = await vendorBills.updateDraft({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      projectId: undefined,
      vendorId: undefined,
      priority: undefined,
      gstRegistrationId: maharashtraGstRegistrationId,
      vendorBillNumber: undefined,
      vendorBillDate: undefined,
      lines: basicLines(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });

    const submitted = await submitBill(updated);
    const approved = await approveBill(submitted);
    expect(approved.cgstAmount).toBe('0.00');
    expect(approved.sgstAmount).toBe('0.00');
    expect(Number(approved.igstAmount)).toBeGreaterThan(0);
  });

  it('is only reachable while status is DRAFT', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-UPDATE-AFTER-SUBMIT' });
    const submitted = await submitBill(draft);
    await expect(
      vendorBills.updateDraft({
        organizationId,
        id: submitted.id,
        expectedVersion: submitted.version,
        projectId: undefined,
        vendorId: undefined,
        priority: undefined,
        gstRegistrationId: undefined,
        vendorBillNumber: undefined,
        vendorBillDate: undefined,
        lines: undefined,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Only a draft vendor bill can be updated.');
  });
});

describe('VendorBillsService — submit', () => {
  it('flips DRAFT to SUBMITTED and sets submittedAt', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-SUBMIT-1' });
    expect(draft.submittedAt).toBeNull();
    const submitted = await submitBill(draft);
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.submittedAt).not.toBeNull();
  });

  it('rejects submit on a non-draft bill', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-SUBMIT-TWICE' });
    const submitted = await submitBill(draft);
    await expect(submitBill(submitted)).rejects.toThrow('Only a draft vendor bill can be submitted.');
  });

  it('rejects submit against a since-cancelled project', async () => {
    const cancellableProject = await projects.create({
      organizationId,
      clientId,
      legalEntityId,
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: undefined,
      introducerId: undefined,
      projectTypeId: undefined,
      name: 'Vendor Bill Submit Cancellable Project',
      description: undefined,
      value: undefined,
      budget: undefined,
      gstApplicable: undefined,
      workOrderNumber: undefined,
      workOrderDate: undefined,
      actorId,
      correlationId: generateId(),
    });
    const draft = await createDraftBill({ vendorBillNumber: 'VB-SUBMIT-CANCELLED-PROJECT', projectId: cancellableProject.id });
    await projects.changeStatus({ organizationId, id: cancellableProject.id, targetStatus: 'CANCELLED', reason: 'Halted.', expectedVersion: cancellableProject.version, actorId, canSeeAll: true, correlationId: generateId() });

    await expect(submitBill(draft)).rejects.toThrow('cancelled or closed');
  });

  it('rejects a stale expectedVersion on submit', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-SUBMIT-VERSION-CONFLICT' });
    await expect(submitBill({ id: draft.id, version: draft.version + 99 })).rejects.toThrow('changed by someone else');
  });

  it('idempotent repeat of submit with the same key returns the original result; the same key against a different bill conflicts', async () => {
    const draftA = await createDraftBill({ vendorBillNumber: 'VB-SUBMIT-IDEMPOTENT-A' });
    const draftB = await createDraftBill({ vendorBillNumber: 'VB-SUBMIT-IDEMPOTENT-B' });
    const key = generateId();

    const first = await vendorBills.submit({ organizationId, id: draftA.id, expectedVersion: draftA.version, idempotencyKey: key, actorId, canSeeAll: true, correlationId: generateId() });
    const second = await vendorBills.submit({ organizationId, id: draftA.id, expectedVersion: draftA.version, idempotencyKey: key, actorId, canSeeAll: true, correlationId: generateId() });
    expect(second.id).toBe(first.id);

    await expect(
      vendorBills.submit({ organizationId, id: draftB.id, expectedVersion: draftB.version, idempotencyKey: key, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('Idempotency key reused');
  });
});

describe('VendorBillsService — approve (maker-checker + ledger posting)', () => {
  it('computes intra-state CGST+SGST, splits ITC-eligible vs ineligible GST, groups same-category lines into one journal debit, and records an APPROVED decision', async () => {
    const draft = await vendorBills.createDraft({
      organizationId,
      projectId,
      vendorId,
      priority: undefined,
      gstRegistrationId: gujaratGstRegistrationId,
      vendorBillNumber: 'VB-FIN-1',
      vendorBillDate: '2026-04-10',
      lines: [
        { description: 'Server A (ITC eligible)', expenseCategoryId: hardwareCategoryId, inventoryItemId: undefined, unitOfMeasureId: qtyUnitId, hsnSac: '8471', quantity: '1', unitPrice: '100000', gstRatePercent: '9', itcEligible: true },
        { description: 'Server B (ITC ineligible)', expenseCategoryId: hardwareCategoryId, inventoryItemId: undefined, unitOfMeasureId: qtyUnitId, hsnSac: '8471', quantity: '1', unitPrice: '50000', gstRatePercent: '9', itcEligible: false },
      ],
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const submitted = await submitBill(draft);
    const approved = await approveBill(submitted, { note: 'Looks correct.' });
    expect(approved.status).toBe('FINALIZED');
    expect(approved.taxableAmount).toBe('150000.00');
    expect(approved.cgstAmount).toBe('13500.00');
    expect(approved.sgstAmount).toBe('13500.00');
    expect(approved.igstAmount).toBe('0.00');
    expect(approved.totalAmount).toBe('177000.00');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: approved.journalEntryId! });

    // Server A (eligible): cost debit = 100000 taxable only.
    // Server B (ineligible): cost debit = 50000 + 4500 + 4500 = 59000.
    // Same expense category on both lines ⇒ one grouped HARDWARE_EXPENSE debit of 159000.
    const hardwareDebit = journalDetail.lines.find((l) => l.ledgerAccountCode === 'HARDWARE_EXPENSE');
    expect(hardwareDebit?.debitAmount).toBe('159000.00');

    // Only the eligible line's GST reaches Input CGST/SGST Receivable.
    const inputCgst = journalDetail.lines.find((l) => l.ledgerAccountCode === 'INPUT_CGST_RECEIVABLE');
    expect(inputCgst?.debitAmount).toBe('9000.00');
    const inputSgst = journalDetail.lines.find((l) => l.ledgerAccountCode === 'INPUT_SGST_RECEIVABLE');
    expect(inputSgst?.debitAmount).toBe('9000.00');

    const apLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'ACCOUNTS_PAYABLE_VENDOR');
    expect(apLine?.creditAmount).toBe('177000.00');
    expect(apLine?.partyId).toBe(vendorId);

    const auditEvent = await prisma.client.auditEvent.findFirst({ where: { entityType: 'VENDOR_BILL', entityId: approved.id, action: 'VENDOR_BILL_APPROVED' } });
    expect(auditEvent).not.toBeNull();

    const detail = await vendorBills.getDetail({ organizationId, id: approved.id, actorId, canSeeAll: true });
    expect(detail.decisions).toHaveLength(1);
    expect(detail.decisions[0]?.decision).toBe('APPROVED');
    expect(detail.decisions[0]?.actorId).toBe(approverId);
    expect(detail.decisions[0]?.note).toBe('Looks correct.');
    expect(detail.decisions[0]?.isSelfApproval).toBe(false);
  });

  it('computes inter-state IGST when the selected GST registration state differs from the vendor state', async () => {
    const approved = await createFinalizedBill({ vendorBillNumber: 'VB-FIN-IGST', gstRegistrationId: maharashtraGstRegistrationId, unitPrice: '200000' });
    expect(approved.cgstAmount).toBe('0.00');
    expect(approved.sgstAmount).toBe('0.00');
    expect(approved.igstAmount).toBe('36000.00');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: approved.journalEntryId! });
    const inputIgst = journalDetail.lines.find((l) => l.ledgerAccountCode === 'INPUT_IGST_RECEIVABLE');
    expect(inputIgst?.debitAmount).toBe('36000.00');
  });

  it('falls back to the default Other Expenses ledger account when a line category has no ledgerAccountId configured', async () => {
    const approved = await createFinalizedBill({ vendorBillNumber: 'VB-FALLBACK', expenseCategoryId: unmappedCategoryId, unitPrice: '20000' });
    const journalDetail = await posting.getEntryDetail({ organizationId, id: approved.journalEntryId! });
    const otherExpensesDebit = journalDetail.lines.find((l) => l.ledgerAccountCode === 'OTHER_EXPENSES');
    expect(otherExpensesDebit?.debitAmount).toBe('20000.00');
  });

  it('is idempotent — a repeated approve with the same key returns the original result without posting a second journal or decision row', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-IDEMPOTENT-APPROVE' });
    const submitted = await submitBill(draft);
    const key = generateId();
    const first = await vendorBills.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: key, actorId: approverId, canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });
    const second = await vendorBills.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: key, actorId: approverId, canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });
    expect(second.journalEntryId).toBe(first.journalEntryId);

    const journalCount = await prisma.client.journalEntry.count({ where: { sourceType: 'vendor_bill_approve', sourceId: draft.id } });
    expect(journalCount).toBe(1);
    const decisionCount = await prisma.client.vendorBillDecision.count({ where: { vendorBillId: draft.id } });
    expect(decisionCount).toBe(1);
  });

  it('rejects approve on a bill that is not SUBMITTED', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-APPROVE-NOT-SUBMITTED' });
    await expect(approveBill(draft)).rejects.toThrow('Only a submitted vendor bill can be approved.');
  });

  it('blocks the creator from approving their own bill unless they hold self_approve, and requires a mandatory justification note when they do', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-SELF-APPROVE' });
    const submitted = await submitBill(draft);

    await expect(approveBill(submitted, { actorIdOverride: actorId, hasSelfApprovePermission: false })).rejects.toThrow('You cannot approve your own vendor bill.');
    await expect(approveBill(submitted, { actorIdOverride: actorId, hasSelfApprovePermission: true, note: undefined })).rejects.toThrow('A justification note is required');

    const approved = await approveBill(submitted, { actorIdOverride: actorId, hasSelfApprovePermission: true, note: 'I am also the approver for this small purchase.' });
    expect(approved.status).toBe('FINALIZED');

    const detail = await vendorBills.getDetail({ organizationId, id: approved.id, actorId, canSeeAll: true });
    expect(detail.decisions[0]?.isSelfApproval).toBe(true);
    expect(detail.decisions[0]?.note).toBe('I am also the approver for this small purchase.');
  });

  it('does not retroactively block approval once the project has since been cancelled (only new creation/submission is blocked)', async () => {
    const cancellableProject = await projects.create({
      organizationId,
      clientId,
      legalEntityId,
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: undefined,
      introducerId: undefined,
      projectTypeId: undefined,
      name: 'Vendor Bill Approve-After-Cancel Project',
      description: undefined,
      value: undefined,
      budget: undefined,
      gstApplicable: undefined,
      workOrderNumber: undefined,
      workOrderDate: undefined,
      actorId,
      correlationId: generateId(),
    });
    const draft = await createDraftBill({ vendorBillNumber: 'VB-APPROVE-AFTER-CANCEL', projectId: cancellableProject.id });
    const submitted = await submitBill(draft);
    const cancelledProject = await projects.changeStatus({ organizationId, id: cancellableProject.id, targetStatus: 'CANCELLED', reason: 'Halted after submission.', expectedVersion: cancellableProject.version, actorId, canSeeAll: true, correlationId: generateId() });
    expect(cancelledProject.operationalStatus).toBe('CANCELLED');

    const approved = await approveBill(submitted);
    expect(approved.status).toBe('FINALIZED');
  });

  it('rejects a stale expectedVersion on approve', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-APPROVE-VERSION-CONFLICT' });
    const submitted = await submitBill(draft);
    await expect(approveBill({ id: submitted.id, version: submitted.version + 99 })).rejects.toThrow('changed by someone else');
  });
});

describe('VendorBillsService — reject', () => {
  it('rejects a submitted bill with a mandatory reason, is terminal, and records a REJECTED decision', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-REJECT-1' });
    const submitted = await submitBill(draft);

    await expect(
      vendorBills.reject({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: '   ', idempotencyKey: generateId(), actorId: approverId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('A reason is required');

    const rejected = await vendorBills.reject({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: 'Amount looks wrong.', idempotencyKey: generateId(), actorId: approverId, canSeeAll: true, correlationId: generateId() });
    expect(rejected.status).toBe('REJECTED');

    const detail = await vendorBills.getDetail({ organizationId, id: rejected.id, actorId, canSeeAll: true });
    expect(detail.decisions).toHaveLength(1);
    expect(detail.decisions[0]?.decision).toBe('REJECTED');
    expect(detail.decisions[0]?.note).toBe('Amount looks wrong.');

    await expect(
      vendorBills.reject({ organizationId, id: rejected.id, expectedVersion: rejected.version, reason: 'Again', idempotencyKey: generateId(), actorId: approverId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('Only a submitted vendor bill can be rejected.');
  });

  it('is idempotent — a repeated reject with the same key returns the original result without a second decision row', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-REJECT-IDEMPOTENT' });
    const submitted = await submitBill(draft);
    const key = generateId();
    const first = await vendorBills.reject({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: 'Not this time.', idempotencyKey: key, actorId: approverId, canSeeAll: true, correlationId: generateId() });
    const second = await vendorBills.reject({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: 'Not this time.', idempotencyKey: key, actorId: approverId, canSeeAll: true, correlationId: generateId() });
    expect(second.id).toBe(first.id);

    const decisionCount = await prisma.client.vendorBillDecision.count({ where: { vendorBillId: draft.id } });
    expect(decisionCount).toBe(1);
  });
});

describe('VendorBillsService — cancel', () => {
  it('is a creator-only withdrawal from DRAFT, with a mandatory reason', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-CANCEL-DRAFT' });

    await expect(
      vendorBills.cancel({ organizationId, id: draft.id, expectedVersion: draft.version, reason: 'Not mine', idempotencyKey: generateId(), actorId: approverId, correlationId: generateId() }),
    ).rejects.toThrow('Only the creator can cancel this vendor bill.');

    await expect(
      vendorBills.cancel({ organizationId, id: draft.id, expectedVersion: draft.version, reason: '   ', idempotencyKey: generateId(), actorId, correlationId: generateId() }),
    ).rejects.toThrow('A reason is required');

    const cancelled = await vendorBills.cancel({ organizationId, id: draft.id, expectedVersion: draft.version, reason: 'No longer needed.', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledBy).toBe(actorId);
    expect(cancelled.cancelledReason).toBe('No longer needed.');
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it('is also reachable from SUBMITTED by the creator', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-CANCEL-SUBMITTED' });
    const submitted = await submitBill(draft);
    const cancelled = await vendorBills.cancel({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: 'Vendor withdrew the invoice.', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('rejects cancel on a FINALIZED bill', async () => {
    const approved = await createFinalizedBill({ vendorBillNumber: 'VB-CANCEL-FINALIZED' });
    await expect(
      vendorBills.cancel({ organizationId, id: approved.id, expectedVersion: approved.version, reason: 'Too late', idempotencyKey: generateId(), actorId, correlationId: generateId() }),
    ).rejects.toThrow('Only a draft or submitted vendor bill can be cancelled.');
  });

  it('is idempotent — a repeated cancel with the same key returns the original result', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-CANCEL-IDEMPOTENT' });
    const key = generateId();
    const first = await vendorBills.cancel({ organizationId, id: draft.id, expectedVersion: draft.version, reason: 'Duplicate entry.', idempotencyKey: key, actorId, correlationId: generateId() });
    const second = await vendorBills.cancel({ organizationId, id: draft.id, expectedVersion: draft.version, reason: 'Duplicate entry.', idempotencyKey: key, actorId, correlationId: generateId() });
    expect(second.id).toBe(first.id);
  });
});

describe('VendorBillsService — void', () => {
  it('void of a finalized bill reverses the journal entry', async () => {
    const approved = await createFinalizedBill({ vendorBillNumber: 'VB-VOID-FIN' });

    const voided = await vendorBills.void({
      organizationId,
      id: approved.id,
      expectedVersion: approved.version,
      reason: 'Duplicate entry',
      accountingDate: '2026-04-15',
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    expect(voided.status).toBe('VOID');
    expect(voided.voidJournalEntryId).not.toBeNull();

    const reversalDetail = await posting.getEntryDetail({ organizationId, id: voided.voidJournalEntryId! });
    expect(reversalDetail.reversalOfJournalEntryId).toBe(approved.journalEntryId);
  });

  it('requires a non-empty reason', async () => {
    const approved = await createFinalizedBill({ vendorBillNumber: 'VB-VOID-VALIDATION' });
    await expect(
      vendorBills.void({ organizationId, id: approved.id, expectedVersion: approved.version, reason: '   ', accountingDate: '2026-04-16', idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('A reason is required');
  });

  it('rejects void on a bill that is not FINALIZED (a draft/submitted bill is withdrawn via cancel instead)', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-VOID-NOT-FINALIZED' });
    await expect(
      vendorBills.void({ organizationId, id: draft.id, expectedVersion: draft.version, reason: 'Trying anyway', accountingDate: '2026-04-16', idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('Only a finalized vendor bill can be voided.');
  });

  it('is idempotent — a repeated void with the same key returns the original result without a second reversal journal', async () => {
    const approved = await createFinalizedBill({ vendorBillNumber: 'VB-VOID-IDEMPOTENT' });
    const key = generateId();
    const first = await vendorBills.void({ organizationId, id: approved.id, expectedVersion: approved.version, reason: 'Duplicate.', accountingDate: '2026-04-17', idempotencyKey: key, actorId, canSeeAll: true, correlationId: generateId() });
    const second = await vendorBills.void({ organizationId, id: approved.id, expectedVersion: approved.version, reason: 'Duplicate.', accountingDate: '2026-04-17', idempotencyKey: key, actorId, canSeeAll: true, correlationId: generateId() });
    expect(second.voidJournalEntryId).toBe(first.voidJournalEntryId);
  });
});

describe('VendorBillsService — calculatePreview', () => {
  it('matches exactly what createDraft/approve actually persist, intrastate and interstate', async () => {
    const lines = basicLines({ unitPrice: '200000', gstRatePercent: '9' });

    const intrastatePreview = await vendorBills.calculatePreview({ organizationId, vendorId, gstRegistrationId: gujaratGstRegistrationId, lines, actorId, canSeeAll: true });
    expect(intrastatePreview.taxableAmount).toBe('200000.00');
    expect(intrastatePreview.cgstAmount).toBe('18000.00');
    expect(intrastatePreview.sgstAmount).toBe('18000.00');
    expect(intrastatePreview.igstAmount).toBe('0.00');
    expect(intrastatePreview.totalAmount).toBe('236000.00');
    expect(intrastatePreview.lines[0]?.expenseCategoryName).toBe('Hardware');
    expect(intrastatePreview.lines[0]?.unitOfMeasureName).toBe('Qty');

    const draft = await vendorBills.createDraft({
      organizationId,
      projectId,
      vendorId,
      priority: undefined,
      gstRegistrationId: gujaratGstRegistrationId,
      vendorBillNumber: 'VB-PREVIEW-MATCH-INTRA',
      vendorBillDate: '2026-04-10',
      lines,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const submitted = await submitBill(draft);
    const approved = await approveBill(submitted);
    expect(approved.taxableAmount).toBe(intrastatePreview.taxableAmount);
    expect(approved.cgstAmount).toBe(intrastatePreview.cgstAmount);
    expect(approved.sgstAmount).toBe(intrastatePreview.sgstAmount);
    expect(approved.totalAmount).toBe(intrastatePreview.totalAmount);

    const interstatePreview = await vendorBills.calculatePreview({ organizationId, vendorId, gstRegistrationId: maharashtraGstRegistrationId, lines, actorId, canSeeAll: true });
    expect(interstatePreview.cgstAmount).toBe('0.00');
    expect(interstatePreview.sgstAmount).toBe('0.00');
    expect(interstatePreview.igstAmount).toBe('36000.00');
  });

  it('returns an empty preview for no lines, and rejects an unknown vendor', async () => {
    const empty = await vendorBills.calculatePreview({ organizationId, vendorId, gstRegistrationId: gujaratGstRegistrationId, lines: [], actorId, canSeeAll: true });
    expect(empty.lines).toHaveLength(0);
    expect(empty.totalAmount).toBe('0.00');

    await expect(
      vendorBills.calculatePreview({ organizationId, vendorId: generateId(), gstRegistrationId: gujaratGstRegistrationId, lines: basicLines(), actorId, canSeeAll: true }),
    ).rejects.toThrow('Vendor not found.');
  });
});

describe('VendorBillsService — scoping, version conflict, cross-org isolation', () => {
  it('a scoped actor can create/list/get vendor bills only for their assigned project', async () => {
    const scopedDraft = await createDraftBill({ vendorBillNumber: 'VB-SCOPED-1', creatorActorId: scopedUserId, canSeeAllOverride: false });
    expect(scopedDraft.status).toBe('DRAFT');

    const scopedList = await vendorBills.list({ organizationId, page: 1, pageSize: 50, filters: {}, actorId: scopedUserId, canSeeAll: false });
    expect(scopedList.rows.some((r) => r.id === scopedDraft.id)).toBe(true);

    await expect(
      createDraftBill({ vendorBillNumber: 'VB-OUT-OF-SCOPE', projectId: unassignedProjectId, creatorActorId: scopedUserId, canSeeAllOverride: false }),
    ).rejects.toThrow('not found');
  });

  it('rejects a stale expectedVersion on updateDraft', async () => {
    const draft = await createDraftBill({ vendorBillNumber: 'VB-VERSION-CONFLICT' });
    await expect(
      vendorBills.updateDraft({
        organizationId,
        id: draft.id,
        expectedVersion: draft.version + 99,
        projectId: undefined,
        vendorId: undefined,
        priority: undefined,
        gstRegistrationId: undefined,
        vendorBillNumber: undefined,
        vendorBillDate: undefined,
        lines: undefined,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });

  it('never returns a vendor bill from a different organization', async () => {
    const otherClient = await clients.create({
      organizationId: otherOrganizationId,
      name: 'Other Org VB Client',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Ops',
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      gstin: undefined,
      internalNote: undefined,
      contacts: [],
      actorId,
      correlationId: generateId(),
    });
    const otherLegalEntity = await prisma.client.legalEntity.create({
      data: { id: generateId(), organizationId: otherOrganizationId, legalName: 'Other Org VB Legal Entity', panNumber: 'ZZZVB1234P', registeredAddress: 'Other' },
    });
    const otherGst = await legalEntities.createGstRegistration({
      organizationId: otherOrganizationId,
      legalEntityId: otherLegalEntity.id,
      stateId: gujaratStateId,
      gstin: '24EEEEE0000E1Z5',
      tradeName: undefined,
      actorId,
      correlationId: generateId(),
    });
    const otherProject = await projects.create({
      organizationId: otherOrganizationId,
      clientId: otherClient.id,
      legalEntityId: otherLegalEntity.id,
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: undefined,
      introducerId: undefined,
      projectTypeId: undefined,
      name: 'Other Org VB Project',
      description: undefined,
      value: undefined,
      budget: undefined,
      gstApplicable: undefined,
      workOrderNumber: undefined,
      workOrderDate: undefined,
      actorId,
      correlationId: generateId(),
    });
    const otherVendor = await vendors.create({
      organizationId: otherOrganizationId,
      existingPartyId: undefined,
      name: 'Other Org VB Vendor',
      shortCode: undefined,
      gstin: undefined,
      panNumber: undefined,
      paymentTerms: undefined,
      stateId: gujaratStateId,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });
    const otherCategory = await prisma.client.expenseCategory.create({
      data: { id: generateId(), organizationId: otherOrganizationId, code: 'OTHER-VB-CAT', name: 'Other Category' },
    });
    const otherUnit = await prisma.client.unitOfMeasure.create({
      data: { id: generateId(), organizationId: otherOrganizationId, code: 'other-vb-unit', name: 'Other Unit' },
    });

    const otherVendorBill = await vendorBills.createDraft({
      organizationId: otherOrganizationId,
      projectId: otherProject.id,
      vendorId: otherVendor.id,
      priority: undefined,
      gstRegistrationId: otherGst.id,
      vendorBillNumber: 'VB-OTHER-ORG',
      vendorBillDate: '2026-04-10',
      lines: basicLines({ expenseCategoryId: otherCategory.id, inventoryItemId: undefined, unitOfMeasureId: otherUnit.id }),
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });

    const listedInOrg = await vendorBills.list({ organizationId, page: 1, pageSize: 50, filters: {}, actorId, canSeeAll: true });
    expect(listedInOrg.rows.some((r) => r.id === otherVendorBill.id)).toBe(false);
    await expect(vendorBills.getDetail({ organizationId, id: otherVendorBill.id, actorId, canSeeAll: true })).rejects.toThrow();
  });
});
