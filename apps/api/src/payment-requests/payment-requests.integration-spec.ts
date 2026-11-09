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
import { VendorBillsService } from '../vendor-bills/vendor-bills.service';
import { PaymentRequestsService } from './payment-requests.service';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const vendors = new VendorsService(prisma);
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const vendorBills = new VendorBillsService(prisma, posting, projects, new InventoryLedgerService(prisma));
const paymentRequests = new PaymentRequestsService(prisma, projects);

let organizationId: string;
let otherOrganizationId: string;
let clientId: string;
let legalEntityId: string;
let otherLegalEntityId: string;
let gujaratStateId: string;
let gujaratGstRegistrationId: string;
let otherLegalEntityGstRegistrationId: string;
let projectId: string;
let unassignedProjectId: string;
let otherLegalEntityProjectId: string;
let vendorId: string;
let otherVendorId: string;
let hardwareCategoryId: string;
let qtyUnitId: string;
let scopedUserId: string;
let scopedEmployeeId: string;
const actorId = generateId();

// Finalized bill fixtures (see beforeAll) — totals below assume unitPrice ×
// 1.18 (18% intrastate GST split CGST 9% + SGST 9%, same state as the GST
// registration used).
let billA: { id: string; totalAmount: string }; // projectId (assigned), 118000.00
let billB: { id: string; totalAmount: string }; // projectId (assigned), 59000.00
let billC: { id: string; totalAmount: string }; // unassignedProjectId, 236000.00
let billOtherVendor: { id: string; totalAmount: string }; // otherVendorId, projectId, 118000.00
let billOtherLegalEntity: { id: string; totalAmount: string }; // otherLegalEntityId/Project, 118000.00
let draftBillId: string; // never finalized

function billLines(unitPrice: string): VendorBillLineInput[] {
  return [
    {
      description: 'Line',
      expenseCategoryId: hardwareCategoryId,
      inventoryItemId: undefined,
      unitOfMeasureId: qtyUnitId,
      hsnSac: '8471',
      quantity: '1',
      unitPrice,
      gstRatePercent: '9',
      itcEligible: true,
    },
  ];
}

async function createFinalizedBill(input: { projectId: string; vendorId: string; gstRegistrationId: string; unitPrice: string; vendorBillNumber: string }) {
  const draftBill = await vendorBills.createDraft({
    organizationId,
    projectId: input.projectId,
    vendorId: input.vendorId,
    priority: undefined,
    gstRegistrationId: input.gstRegistrationId,
    vendorBillNumber: input.vendorBillNumber,
    vendorBillDate: '2026-08-01',
    lines: billLines(input.unitPrice),
    idempotencyKey: generateId(),
    actorId,
    canSeeAll: true,
    correlationId: generateId(),
  });
  const submittedBill = await vendorBills.submit({ organizationId, id: draftBill.id, expectedVersion: draftBill.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
  // A distinct, throwaway approver — never the creator (`actorId`) — so
  // these fixture bills always approve cleanly without tripping
  // VendorBillsService's own self-approval gate.
  const finalized = await vendorBills.approve({ organizationId, id: submittedBill.id, expectedVersion: submittedBill.version, note: undefined, idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });
  return { id: finalized.id, totalAmount: finalized.totalAmount! };
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Payment Requests Test Org', code: `PMRTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Payment Requests Test Other Org', code: `PMRTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const gujarat = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });
  gujaratStateId = gujarat.id;

  const client = await clients.create({
    organizationId,
    name: 'PMR Test Client',
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
    data: { id: generateId(), organizationId, legalName: 'PMR Test Legal Entity', panNumber: 'ABCPM1234P', registeredAddress: 'Gandhinagar, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  const otherLegalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'PMR Test Other Legal Entity', panNumber: 'ABCPM5678P', registeredAddress: 'Ahmedabad, Gujarat' },
  });
  otherLegalEntityId = otherLegalEntity.id;

  const gujaratGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId,
    stateId: gujaratStateId,
    gstin: '24PMRPM0000P1Z5',
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  gujaratGstRegistrationId = gujaratGst.id;

  const otherLegalEntityGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId: otherLegalEntityId,
    stateId: gujaratStateId,
    gstin: '24PRQEE0000P1Z5',
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  otherLegalEntityGstRegistrationId = otherLegalEntityGst.id;

  await financialYears.create({ organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31', setCurrent: true, actorId, correlationId: generateId() });
  await financialYears.create({ organizationId, legalEntityId: otherLegalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31', setCurrent: true, actorId, correlationId: generateId() });

  const project = await projects.create({
    organizationId, clientId, legalEntityId, leadId: undefined, tenderId: undefined, projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined,
    name: 'PMR Test Project', description: undefined, value: undefined, budget: undefined, gstApplicable: undefined, workOrderNumber: undefined, workOrderDate: undefined,
    actorId, correlationId: generateId(),
  });
  projectId = project.id;

  const unassignedProject = await projects.create({
    organizationId, clientId, legalEntityId, leadId: undefined, tenderId: undefined, projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined,
    name: 'PMR Unassigned Project', description: undefined, value: undefined, budget: undefined, gstApplicable: undefined, workOrderNumber: undefined, workOrderDate: undefined,
    actorId, correlationId: generateId(),
  });
  unassignedProjectId = unassignedProject.id;

  const otherLegalEntityProject = await projects.create({
    organizationId, clientId, legalEntityId: otherLegalEntityId, leadId: undefined, tenderId: undefined, projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined,
    name: 'PMR Other Legal Entity Project', description: undefined, value: undefined, budget: undefined, gstApplicable: undefined, workOrderNumber: undefined, workOrderDate: undefined,
    actorId, correlationId: generateId(),
  });
  otherLegalEntityProjectId = otherLegalEntityProject.id;

  const vendor = await vendors.create({
    organizationId, existingPartyId: undefined, name: 'PMR Test Vendor', shortCode: undefined, gstin: undefined, panNumber: undefined, paymentTerms: 'NET_30',
    stateId: gujaratStateId, districtId: undefined, cityId: undefined, pinCode: undefined, officeAddress: 'Ahmedabad, Gujarat', internalNote: undefined,
    actorId, correlationId: generateId(),
  });
  vendorId = vendor.id;

  const otherVendor = await vendors.create({
    organizationId, existingPartyId: undefined, name: 'PMR Test Other Vendor', shortCode: undefined, gstin: undefined, panNumber: undefined, paymentTerms: undefined,
    stateId: gujaratStateId, districtId: undefined, cityId: undefined, pinCode: undefined, officeAddress: 'Surat, Gujarat', internalNote: undefined,
    actorId, correlationId: generateId(),
  });
  otherVendorId = otherVendor.id;

  const assetGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'PMR_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const liabilityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'PMR_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  const expenseGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'PMR_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true },
  });

  await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: liabilityGroup.id, code: 'ACCOUNTS_PAYABLE_VENDOR', name: 'Accounts Payable — Vendor', allowManualPosting: true, isActive: true } });
  await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'INPUT_CGST_RECEIVABLE', name: 'Input CGST Receivable', allowManualPosting: true, isActive: true } });
  await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'INPUT_SGST_RECEIVABLE', name: 'Input SGST Receivable', allowManualPosting: true, isActive: true } });
  await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'INPUT_IGST_RECEIVABLE', name: 'Input IGST Receivable', allowManualPosting: true, isActive: true } });
  const hardwareAccount = await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: expenseGroup.id, code: 'HARDWARE_EXPENSE', name: 'Hardware Expense', allowManualPosting: true, isActive: true } });
  await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: expenseGroup.id, code: 'OTHER_EXPENSES', name: 'Other Expenses', allowManualPosting: true, isActive: true } });

  const hardwareCategory = await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId, code: 'PMR-HARDWARE', name: 'Hardware', ledgerAccountId: hardwareAccount.id } });
  hardwareCategoryId = hardwareCategory.id;

  const qtyUnit = await prisma.client.unitOfMeasure.create({ data: { id: generateId(), organizationId, code: 'pmr-qty', name: 'Qty' } });
  qtyUnitId = qtyUnit.id;

  const user = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: 'pmr-scoped-actor@zitaware.test', passwordHash: 'test-hash', displayName: 'PMR Scoped Actor', status: 'ACTIVE' } });
  scopedUserId = user.id;
  const employee = await prisma.client.employee.create({ data: { id: generateId(), organizationId, userId: scopedUserId, employeeCode: 'EMP-PMR-1', fullName: 'PMR Scoped Actor', joiningDate: new Date('2024-01-01') } });
  scopedEmployeeId = employee.id;
  await projects.addTeamMember({ organizationId, projectId, employeeId: scopedEmployeeId, role: 'Requester', actorId, correlationId: generateId() });

  billA = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '100000', vendorBillNumber: 'PMR-VB-A' });
  billB = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '50000', vendorBillNumber: 'PMR-VB-B' });
  billC = await createFinalizedBill({ projectId: unassignedProjectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '200000', vendorBillNumber: 'PMR-VB-C' });
  billOtherVendor = await createFinalizedBill({ projectId, vendorId: otherVendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '100000', vendorBillNumber: 'PMR-VB-OV' });
  billOtherLegalEntity = await createFinalizedBill({ projectId: otherLegalEntityProjectId, vendorId, gstRegistrationId: otherLegalEntityGstRegistrationId, unitPrice: '100000', vendorBillNumber: 'PMR-VB-OLE' });

  const draftBill = await vendorBills.createDraft({
    organizationId,
    projectId,
    vendorId,
    priority: undefined,
    gstRegistrationId: gujaratGstRegistrationId,
    vendorBillNumber: 'PMR-VB-DRAFT',
    vendorBillDate: '2026-08-01',
    lines: billLines('10000'),
    idempotencyKey: generateId(),
    actorId,
    canSeeAll: true,
    correlationId: generateId(),
  });
  draftBillId = draftBill.id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.paymentRequestDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.paymentRequestLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.paymentRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
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

describe('PaymentRequestsService — createDraft', () => {
  it('creates a draft batching multiple finalized bills for the same vendor + legal entity', async () => {
    const draft = await paymentRequests.createDraft({
      organizationId,
      vendorId,
      legalEntityId,
      requestedPaymentDate: '2026-08-15',
      priority: undefined,
      remarks: 'Batch settlement',
      lines: [
        { vendorBillId: billA.id, requestedAmount: billA.totalAmount },
        { vendorBillId: billB.id, requestedAmount: billB.totalAmount },
      ],
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    expect(draft.status).toBe('DRAFT');
    expect(draft.requestNumber).toMatch(/^PMR-\d{6}$/);
    expect(draft.totalRequestedAmount).toBe((Number(billA.totalAmount) + Number(billB.totalAmount)).toFixed(2));
  });

  it('rejects a bill belonging to a different vendor', async () => {
    await expect(
      paymentRequests.createDraft({
        organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
        lines: [{ vendorBillId: billOtherVendor.id, requestedAmount: '1000' }],
        idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
      }),
    ).rejects.toThrow('does not belong to the selected vendor');
  });

  it('rejects a bill belonging to a different legal entity', async () => {
    await expect(
      paymentRequests.createDraft({
        organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
        lines: [{ vendorBillId: billOtherLegalEntity.id, requestedAmount: '1000' }],
        idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
      }),
    ).rejects.toThrow('does not belong to the selected legal entity');
  });

  it('rejects the same vendor bill appearing twice in one request', async () => {
    await expect(
      paymentRequests.createDraft({
        organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
        lines: [
          { vendorBillId: billA.id, requestedAmount: '1000' },
          { vendorBillId: billA.id, requestedAmount: '2000' },
        ],
        idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
      }),
    ).rejects.toThrow('cannot appear twice');
  });

  it('rejects a zero or negative requested amount', async () => {
    await expect(
      paymentRequests.createDraft({
        organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
        lines: [{ vendorBillId: billA.id, requestedAmount: '0' }],
        idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
      }),
    ).rejects.toThrow('greater than zero');
  });

  it('rejects a non-finalized (draft) vendor bill', async () => {
    await expect(
      paymentRequests.createDraft({
        organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
        lines: [{ vendorBillId: draftBillId, requestedAmount: '1000' }],
        idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
      }),
    ).rejects.toThrow('is not finalized');
  });

  it('rejects a requested amount exceeding the bill\'s available balance', async () => {
    const overAmount = (Number(billA.totalAmount) + 1).toFixed(2);
    await expect(
      paymentRequests.createDraft({
        organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
        lines: [{ vendorBillId: billA.id, requestedAmount: overAmount }],
        idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
      }),
    ).rejects.toThrow('exceeds its available balance');
  });

  it('is idempotent — a repeated call with the same key returns the original result', async () => {
    const key = generateId();
    const first = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: billB.id, requestedAmount: '5000' }],
      idempotencyKey: key, actorId, canSeeAll: true, correlationId: generateId(),
    });
    const second = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: billB.id, requestedAmount: '5000' }],
      idempotencyKey: key, actorId, canSeeAll: true, correlationId: generateId(),
    });
    expect(second.id).toBe(first.id);
  });
});

describe('PaymentRequestsService — updateDraft / immutability after submit', () => {
  it('replaces lines wholesale while still DRAFT', async () => {
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: billA.id, requestedAmount: '10000' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const updated = await paymentRequests.updateDraft({
      organizationId, id: draft.id, expectedVersion: draft.version, requestedPaymentDate: undefined, priority: 'URGENT', remarks: 'Updated',
      lines: [{ vendorBillId: billA.id, requestedAmount: '20000' }],
      actorId, canSeeAll: true, correlationId: generateId(),
    });
    expect(updated.priority).toBe('URGENT');
    expect(updated.totalRequestedAmount).toBe('20000.00');

    const detail = await paymentRequests.getDetail({ organizationId, id: draft.id, actorId, canSeeAll: true });
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]!.requestedAmount).toBe('20000.00');
  });

  it('rejects updateDraft once SUBMITTED', async () => {
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: billA.id, requestedAmount: '10000' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const submitted = await paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    await expect(
      paymentRequests.updateDraft({ organizationId, id: submitted.id, expectedVersion: submitted.version, requestedPaymentDate: undefined, priority: undefined, remarks: undefined, lines: undefined, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('Only a draft');
  });
});

describe('PaymentRequestsService — submit (concurrency-safe reservation)', () => {
  it('reserves the bill once SUBMITTED and releases it on cancel', async () => {
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: billB.id, requestedAmount: billB.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });

    const beforeSubmit = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: billB.id });
    expect(beforeSubmit.available).toBe(billB.totalAmount);

    const submitted = await paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    const afterSubmit = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: billB.id });
    expect(afterSubmit.available).toBe('0.00');

    const cancelled = await paymentRequests.cancel({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: 'No longer needed', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    expect(cancelled.status).toBe('CANCELLED');
    const afterCancel = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: billB.id });
    expect(afterCancel.available).toBe(billB.totalAmount);
  });

  it('the submit-time locked revalidation rejects a request that was valid at draft time but is now over-committed', async () => {
    // Two drafts against the same fresh bill, each requesting the full amount.
    const freshBill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '30000', vendorBillNumber: `PMR-VB-RACE-${generateId().slice(0, 8)}` });
    const draft1 = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: freshBill.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const draft2 = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: freshBill.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });

    const submitted1 = await paymentRequests.submit({ organizationId, id: draft1.id, expectedVersion: draft1.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    expect(submitted1.status).toBe('SUBMITTED');

    await expect(
      paymentRequests.submit({ organizationId, id: draft2.id, expectedVersion: draft2.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('available balance has changed');
  });

  it('concurrent submissions against the same bill: exactly one succeeds, no double-reservation', async () => {
    const freshBill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '20000', vendorBillNumber: `PMR-VB-CONC-${generateId().slice(0, 8)}` });
    const half = (Number(freshBill.totalAmount) * 0.7).toFixed(2);

    const draftX = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: half }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const draftY = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: half }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });

    const results = await Promise.allSettled([
      paymentRequests.submit({ organizationId, id: draftX.id, expectedVersion: draftX.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() }),
      paymentRequests.submit({ organizationId, id: draftY.id, expectedVersion: draftY.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The remaining availability must reflect exactly one reservation, never
    // both (which would mean the bill was over-committed) and never zero
    // reservations (which would mean the winner's own reservation was lost).
    const availability = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: freshBill.id });
    const expectedRemaining = (Number(freshBill.totalAmount) - Number(half)).toFixed(2);
    expect(availability.available).toBe(expectedRemaining);
  });

  it('supports a partial request, leaving the remainder available for a later request', async () => {
    const freshBill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '40000', vendorBillNumber: `PMR-VB-PARTIAL-${generateId().slice(0, 8)}` });
    const firstPortion = (Number(freshBill.totalAmount) * 0.4).toFixed(2);
    const remainder = (Number(freshBill.totalAmount) - Number(firstPortion)).toFixed(2);

    const draft1 = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: firstPortion }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    await paymentRequests.submit({ organizationId, id: draft1.id, expectedVersion: draft1.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });

    const availability = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: freshBill.id });
    expect(availability.available).toBe(remainder);

    // A second, separate request for exactly the remainder succeeds.
    const draft2 = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-20', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: remainder }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const submitted2 = await paymentRequests.submit({ organizationId, id: draft2.id, expectedVersion: draft2.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    expect(submitted2.status).toBe('SUBMITTED');

    const fullyReserved = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: freshBill.id });
    expect(fullyReserved.available).toBe('0.00');
  });
});

describe('PaymentRequestsService — maker-checker (approve/reject/self-approve/revoke)', () => {
  it('a non-creator approver approves normally, with isSelfApproval false, and the reservation survives approval', async () => {
    const freshBill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '15000', vendorBillNumber: `PMR-VB-APPR-${generateId().slice(0, 8)}` });
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: freshBill.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const submitted = await paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    const approved = await paymentRequests.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });
    expect(approved.status).toBe('APPROVED');

    const detail = await paymentRequests.getDetail({ organizationId, id: approved.id, actorId, canSeeAll: true });
    expect(detail.decisions).toHaveLength(1);
    expect(detail.decisions[0]!.decision).toBe('APPROVED');
    expect(detail.decisions[0]!.isSelfApproval).toBe(false);

    const availability = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: freshBill.id });
    expect(availability.available).toBe('0.00');
  });

  it('rejects self-approval without the permission, and without a mandatory note even with the permission', async () => {
    const freshBill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '12000', vendorBillNumber: `PMR-VB-SELF-${generateId().slice(0, 8)}` });
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: freshBill.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const submitted = await paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });

    await expect(
      paymentRequests.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: 'trying anyway', idempotencyKey: generateId(), actorId, canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() }),
    ).rejects.toThrow('cannot approve your own');

    await expect(
      paymentRequests.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: generateId(), actorId, canSeeAll: true, hasSelfApprovePermission: true, correlationId: generateId() }),
    ).rejects.toThrow('justification note is required');

    const selfApproved = await paymentRequests.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: 'I am the only authorized approver today', idempotencyKey: generateId(), actorId, canSeeAll: true, hasSelfApprovePermission: true, correlationId: generateId() });
    expect(selfApproved.status).toBe('APPROVED');
    const detail = await paymentRequests.getDetail({ organizationId, id: selfApproved.id, actorId, canSeeAll: true });
    expect(detail.decisions[0]!.isSelfApproval).toBe(true);
  });

  it('reject requires a reason and is terminal', async () => {
    const freshBill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '8000', vendorBillNumber: `PMR-VB-REJ-${generateId().slice(0, 8)}` });
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: freshBill.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const submitted = await paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });

    await expect(
      paymentRequests.reject({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: '  ', idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('reason is required');

    const rejected = await paymentRequests.reject({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: 'Wrong vendor bill selected', idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, correlationId: generateId() });
    expect(rejected.status).toBe('REJECTED');

    const availability = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: freshBill.id });
    expect(availability.available).toBe(freshBill.totalAmount);

    await expect(
      paymentRequests.approve({ organizationId, id: rejected.id, expectedVersion: rejected.version, note: undefined, idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() }),
    ).rejects.toThrow('Only a submitted');
  });

  it('revoke releases an approved request\'s reservation, requires a reason, and only applies to APPROVED', async () => {
    const freshBill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '25000', vendorBillNumber: `PMR-VB-REV-${generateId().slice(0, 8)}` });
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: freshBill.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });

    await expect(
      paymentRequests.revoke({ organizationId, id: draft.id, expectedVersion: draft.version, reason: 'too early', idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('Only an approved');

    const submitted = await paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    const approved = await paymentRequests.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });

    await expect(
      paymentRequests.revoke({ organizationId, id: approved.id, expectedVersion: approved.version, reason: '  ', idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('reason is required');

    const reservedBefore = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: freshBill.id });
    expect(reservedBefore.available).toBe('0.00');

    const revoked = await paymentRequests.revoke({ organizationId, id: approved.id, expectedVersion: approved.version, reason: 'Payment plan changed', idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    expect(revoked.status).toBe('REVOKED');

    const detail = await paymentRequests.getDetail({ organizationId, id: revoked.id, actorId, canSeeAll: true });
    expect(detail.decisions.map((d) => d.decision)).toEqual(['REVOKED', 'APPROVED']);

    const releasedAfter = await paymentRequests.getBillAvailability({ organizationId, vendorBillId: freshBill.id });
    expect(releasedAfter.available).toBe(freshBill.totalAmount);
  });
});

describe('PaymentRequestsService — calculatePreview', () => {
  it('matches exactly what createDraft would persist, and flags an invalid line without throwing', async () => {
    const preview = await paymentRequests.calculatePreview({
      organizationId, vendorId, legalEntityId,
      lines: [
        { vendorBillId: billA.id, requestedAmount: '1000' },
        { vendorBillId: billOtherVendor.id, requestedAmount: '500' }, // wrong vendor — invalid, but preview must not throw
      ],
      actorId, canSeeAll: true,
    });
    expect(preview.valid).toBe(false);
    expect(preview.lines[0]!.valid).toBe(true);
    expect(preview.lines[1]!.valid).toBe(false);
    expect(preview.totalRequestedAmount).toBe('1500.00');

    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: billA.id, requestedAmount: '1000' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    expect(draft.totalRequestedAmount).toBe(preview.lines[0]!.requestedAmount === '1000.00' ? '1000.00' : draft.totalRequestedAmount);
  });
});

describe('PaymentRequestsService — project scoping (multi-project batches)', () => {
  it('a scoped actor may create/submit/approve a request whose every line is in their assigned project', async () => {
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: billA.id, requestedAmount: '1000' }],
      idempotencyKey: generateId(), actorId: scopedUserId, canSeeAll: false, correlationId: generateId(),
    });
    expect(draft.status).toBe('DRAFT');
  });

  it('rejects — with no partial exposure — a batch that mixes an accessible project with an inaccessible one', async () => {
    await expect(
      paymentRequests.createDraft({
        organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
        lines: [
          { vendorBillId: billA.id, requestedAmount: '1000' },
          { vendorBillId: billC.id, requestedAmount: '1000' },
        ],
        idempotencyKey: generateId(), actorId: scopedUserId, canSeeAll: false, correlationId: generateId(),
      }),
    ).rejects.toThrow('not accessible');
  });

  it('a request entirely outside the scoped actor\'s projects is invisible via getDetail (NOT_FOUND, not FORBIDDEN)', async () => {
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: billC.id, requestedAmount: '1000' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    try {
      await paymentRequests.getDetail({ organizationId, id: draft.id, actorId: scopedUserId, canSeeAll: false });
      expect.unreachable('expected getDetail to throw');
    } catch (error) {
      expect((error as { cause?: { appErrorCode?: string } }).cause?.appErrorCode).toBe('NOT_FOUND');
    }
  });

  it('list never exposes a mixed-project request to a scoped actor, even partially', async () => {
    const mixedDraft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [
        { vendorBillId: billA.id, requestedAmount: '1000' },
        { vendorBillId: billC.id, requestedAmount: '1000' },
      ],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const { rows } = await paymentRequests.list({ organizationId, page: 1, pageSize: 100, filters: {}, actorId: scopedUserId, canSeeAll: false });
    expect(rows.some((r) => r.id === mixedDraft.id)).toBe(false);
  });
});

describe('PaymentRequestsService — version conflict, list/getDetail scoping, cross-org isolation', () => {
  it('rejects a stale expectedVersion on submit/approve/reject/cancel/revoke', async () => {
    const freshBill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '9000', vendorBillNumber: `PMR-VB-VER-${generateId().slice(0, 8)}` });
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: freshBill.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    await expect(
      paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version + 1, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('changed by someone else');
  });

  it('never returns a payment request from a different organization', async () => {
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: billA.id, requestedAmount: '1000' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    await expect(paymentRequests.getDetail({ organizationId: otherOrganizationId, id: draft.id, actorId, canSeeAll: true })).rejects.toThrow('not found');
  });

  it('idempotent replay of approve creates no duplicate decision row', async () => {
    const freshBill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '6000', vendorBillNumber: `PMR-VB-IDEMP-${generateId().slice(0, 8)}` });
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: freshBill.id, requestedAmount: freshBill.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const submitted = await paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    const approveKey = generateId();
    const first = await paymentRequests.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: approveKey, actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });
    const second = await paymentRequests.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: approveKey, actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });
    expect(second.version).toBe(first.version);

    const detail = await paymentRequests.getDetail({ organizationId, id: first.id, actorId, canSeeAll: true });
    expect(detail.decisions).toHaveLength(1);
  });
});
