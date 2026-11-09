import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import type { VendorBillLineInput, PaymentRequestDetail } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { VendorsService } from '../vendors/vendors.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { InventoryLedgerService } from '../inventory/inventory-ledger.service';
import { VendorBillsService } from '../vendor-bills/vendor-bills.service';
import { PaymentRequestsService } from '../payment-requests/payment-requests.service';
import { VendorPaymentsService } from './vendor-payments.service';
import { uniqueGstin } from '../testing/gstin.test-util';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const vendors = new VendorsService(prisma);
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const vendorBills = new VendorBillsService(prisma, posting, projects, new InventoryLedgerService(prisma));
const paymentRequests = new PaymentRequestsService(prisma, projects);
const vendorPayments = new VendorPaymentsService(prisma, posting, projects);

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
let bankAccountId: string;
let paymentModeId: string;
let scopedUserId: string;
let scopedEmployeeId: string;
const actorId = generateId();

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
  const finalized = await vendorBills.approve({ organizationId, id: submittedBill.id, expectedVersion: submittedBill.version, note: undefined, idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });
  return { id: finalized.id, totalAmount: finalized.totalAmount! };
}

/** DRAFT -> SUBMITTED -> APPROVED (a distinct, throwaway approver) in one
 * call, returning the full detail (with line ids) a vendor payment
 * allocation needs. */
async function createApprovedPaymentRequest(input: { vendorId: string; legalEntityId: string; bills: Array<{ id: string; totalAmount: string }> }): Promise<PaymentRequestDetail> {
  const draft = await paymentRequests.createDraft({
    organizationId,
    vendorId: input.vendorId,
    legalEntityId: input.legalEntityId,
    requestedPaymentDate: '2026-08-15',
    priority: undefined,
    remarks: undefined,
    lines: input.bills.map((b) => ({ vendorBillId: b.id, requestedAmount: b.totalAmount })),
    idempotencyKey: generateId(),
    actorId,
    canSeeAll: true,
    correlationId: generateId(),
  });
  const submitted = await paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
  const approved = await paymentRequests.approve({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });
  return paymentRequests.getDetail({ organizationId, id: approved.id, actorId, canSeeAll: true });
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Vendor Payments Test Org', code: `VPTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Vendor Payments Test Other Org', code: `VPTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const gujarat = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });
  gujaratStateId = gujarat.id;

  const client = await clients.create({
    organizationId,
    name: 'VP Test Client',
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
    data: { id: generateId(), organizationId, legalName: 'VP Test Legal Entity', panNumber: 'ABCVP1234P', registeredAddress: 'Gandhinagar, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  const otherLegalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'VP Test Other Legal Entity', panNumber: 'ABCVP5678P', registeredAddress: 'Ahmedabad, Gujarat' },
  });
  otherLegalEntityId = otherLegalEntity.id;

  const gujaratGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId,
    stateId: gujaratStateId,
    gstin: uniqueGstin('24'),
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  gujaratGstRegistrationId = gujaratGst.id;

  const otherLegalEntityGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId: otherLegalEntityId,
    stateId: gujaratStateId,
    gstin: uniqueGstin('24'),
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  otherLegalEntityGstRegistrationId = otherLegalEntityGst.id;

  await financialYears.create({ organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31', setCurrent: true, actorId, correlationId: generateId() });
  await financialYears.create({ organizationId, legalEntityId: otherLegalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31', setCurrent: true, actorId, correlationId: generateId() });

  const project = await projects.create({
    organizationId, clientId, legalEntityId, leadId: undefined, tenderId: undefined, projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined,
    name: 'VP Test Project', description: undefined, value: undefined, budget: undefined, gstApplicable: undefined, workOrderNumber: undefined, workOrderDate: undefined,
    actorId, correlationId: generateId(),
  });
  projectId = project.id;

  const unassignedProject = await projects.create({
    organizationId, clientId, legalEntityId, leadId: undefined, tenderId: undefined, projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined,
    name: 'VP Unassigned Project', description: undefined, value: undefined, budget: undefined, gstApplicable: undefined, workOrderNumber: undefined, workOrderDate: undefined,
    actorId, correlationId: generateId(),
  });
  unassignedProjectId = unassignedProject.id;

  const otherLegalEntityProject = await projects.create({
    organizationId, clientId, legalEntityId: otherLegalEntityId, leadId: undefined, tenderId: undefined, projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined,
    name: 'VP Other Legal Entity Project', description: undefined, value: undefined, budget: undefined, gstApplicable: undefined, workOrderNumber: undefined, workOrderDate: undefined,
    actorId, correlationId: generateId(),
  });
  otherLegalEntityProjectId = otherLegalEntityProject.id;

  const vendor = await vendors.create({
    organizationId, existingPartyId: undefined, name: 'VP Test Vendor', shortCode: undefined, gstin: undefined, panNumber: undefined, paymentTerms: 'NET_30',
    stateId: gujaratStateId, districtId: undefined, cityId: undefined, pinCode: undefined, officeAddress: 'Ahmedabad, Gujarat', internalNote: undefined,
    actorId, correlationId: generateId(),
  });
  vendorId = vendor.id;

  const otherVendor = await vendors.create({
    organizationId, existingPartyId: undefined, name: 'VP Test Other Vendor', shortCode: undefined, gstin: undefined, panNumber: undefined, paymentTerms: undefined,
    stateId: gujaratStateId, districtId: undefined, cityId: undefined, pinCode: undefined, officeAddress: 'Surat, Gujarat', internalNote: undefined,
    actorId, correlationId: generateId(),
  });
  otherVendorId = otherVendor.id;

  const assetGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'VP_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const liabilityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'VP_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  const expenseGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'VP_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true },
  });

  const ledgerCodes: Array<{ code: string; groupId: string; name: string }> = [
    { code: 'ACCOUNTS_PAYABLE_VENDOR', groupId: liabilityGroup.id, name: 'Accounts Payable — Vendor' },
    { code: 'TDS_PAYABLE', groupId: liabilityGroup.id, name: 'TDS Payable' },
    { code: 'GST_TDS_PAYABLE_CGST', groupId: liabilityGroup.id, name: 'GST-TDS Payable — CGST' },
    { code: 'GST_TDS_PAYABLE_SGST', groupId: liabilityGroup.id, name: 'GST-TDS Payable — SGST' },
    { code: 'GST_TDS_PAYABLE_IGST', groupId: liabilityGroup.id, name: 'GST-TDS Payable — IGST' },
    { code: 'INPUT_CGST_RECEIVABLE', groupId: assetGroup.id, name: 'Input CGST Receivable' },
    { code: 'INPUT_SGST_RECEIVABLE', groupId: assetGroup.id, name: 'Input SGST Receivable' },
    { code: 'INPUT_IGST_RECEIVABLE', groupId: assetGroup.id, name: 'Input IGST Receivable' },
    { code: 'HARDWARE_EXPENSE', groupId: expenseGroup.id, name: 'Hardware Expense' },
    { code: 'OTHER_EXPENSES', groupId: expenseGroup.id, name: 'Other Expenses' },
    { code: 'HDFC_CURRENT_ACCOUNT', groupId: assetGroup.id, name: 'HDFC Current Account' },
  ];
  const createdLedgerAccounts = new Map<string, string>();
  for (const l of ledgerCodes) {
    const row = await prisma.client.ledgerAccount.create({
      data: { id: generateId(), organizationId, accountGroupId: l.groupId, code: l.code, name: l.name, allowManualPosting: true, isActive: true },
    });
    createdLedgerAccounts.set(l.code, row.id);
  }

  const hardwareCategory = await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId, code: 'VP-HARDWARE', name: 'Hardware', ledgerAccountId: createdLedgerAccounts.get('HARDWARE_EXPENSE')! } });
  hardwareCategoryId = hardwareCategory.id;

  const qtyUnit = await prisma.client.unitOfMeasure.create({ data: { id: generateId(), organizationId, code: 'vp-qty', name: 'Qty' } });
  qtyUnitId = qtyUnit.id;

  const bankAccount = await legalEntities.createBankAccount({
    organizationId,
    legalEntityId,
    ledgerAccountId: createdLedgerAccounts.get('HDFC_CURRENT_ACCOUNT')!,
    accountName: 'HDFC Operating Account',
    bankName: 'HDFC Bank',
    maskedAccountNumber: '****4471',
    ifsc: 'HDFC0000123',
    actorId,
    correlationId: generateId(),
  });
  bankAccountId = bankAccount.id;

  paymentModeId = (await prisma.client.paymentMode.findFirstOrThrow()).id;

  const user = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: 'vp-scoped-actor@zitaware.test', passwordHash: 'test-hash', displayName: 'VP Scoped Actor', status: 'ACTIVE' } });
  scopedUserId = user.id;
  const employee = await prisma.client.employee.create({ data: { id: generateId(), organizationId, userId: scopedUserId, employeeCode: 'EMP-VP-1', fullName: 'VP Scoped Actor', joiningDate: new Date('2024-01-01') } });
  scopedEmployeeId = employee.id;
  await projects.addTeamMember({ organizationId, projectId, employeeId: scopedEmployeeId, role: 'Requester', actorId, correlationId: generateId() });
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.vendorPaymentDeduction.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.vendorPaymentAllocation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.vendorPayment.deleteMany({ where: { organizationId: { in: orgIds } } });
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
  await prisma.client.bankAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
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

describe('VendorPaymentsService — postVendorPayment (journal shape)', () => {
  it('posts a single-line vendor payment with a plain TDS deduction and computes the exact flipped docs/06 journal', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '1000000', vendorBillNumber: `VP-VB-TDS-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });
    const line = request.lines[0]!;

    const payment = await vendorPayments.postVendorPayment({
      organizationId,
      bankAccountId,
      paymentModeId,
      paymentDate: '2026-08-20',
      utrReference: 'UTR-VP-1',
      actualAmount: '1080000',
      allocations: [{ paymentRequestLineId: line.id, cashPaid: '1080000', deductions: [{ type: 'TDS', amount: '100000', ratePercent: '10', narrative: undefined }] }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    expect(payment.status).toBe('POSTED');
    expect(payment.actualAmount).toBe('1080000.00');
    expect(payment.allocations).toHaveLength(1);
    expect(payment.allocations[0]!.settledAmount).toBe('1180000.00');
    expect(payment.allocations[0]!.deductions[0]!.type).toBe('TDS');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: payment.journalEntryId! });
    const debitLines = journalDetail.lines.filter((l) => Number(l.debitAmount) > 0);
    const creditLines = journalDetail.lines.filter((l) => Number(l.creditAmount) > 0);
    expect(debitLines.map((l) => l.ledgerAccountCode)).toEqual(['ACCOUNTS_PAYABLE_VENDOR']);
    expect(debitLines[0]!.debitAmount).toBe('1180000.00');
    expect(creditLines.map((l) => l.ledgerAccountCode).sort()).toEqual(['HDFC_CURRENT_ACCOUNT', 'TDS_PAYABLE'].sort());
    expect(creditLines.find((l) => l.ledgerAccountCode === 'HDFC_CURRENT_ACCOUNT')!.creditAmount).toBe('1080000.00');
    expect(creditLines.find((l) => l.ledgerAccountCode === 'TDS_PAYABLE')!.creditAmount).toBe('100000.00');

    const auditEvent = await prisma.client.auditEvent.findFirst({ where: { entityType: 'VENDOR_PAYMENT', entityId: payment.id, action: 'VENDOR_PAYMENT_POSTED' } });
    expect(auditEvent).not.toBeNull();
  });

  it('resolves CGST/SGST/IGST-TDS deductions to their correct payable ledger accounts, summed if repeated', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '2000000', vendorBillNumber: `VP-VB-GSTTDS-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });
    const line = request.lines[0]!;

    const payment = await vendorPayments.postVendorPayment({
      organizationId,
      bankAccountId,
      paymentModeId,
      paymentDate: '2026-08-21',
      utrReference: undefined,
      actualAmount: '2345000',
      allocations: [
        {
          paymentRequestLineId: line.id,
          cashPaid: '2345000',
          deductions: [
            { type: 'CGST_TDS', amount: '5000', ratePercent: undefined, narrative: undefined },
            { type: 'SGST_TDS', amount: '5000', ratePercent: undefined, narrative: undefined },
            { type: 'IGST_TDS', amount: '5000', ratePercent: undefined, narrative: undefined },
          ],
        },
      ],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    const journalDetail = await posting.getEntryDetail({ organizationId, id: payment.journalEntryId! });
    const byCode = new Map(journalDetail.lines.map((l) => [l.ledgerAccountCode, l.creditAmount]));
    expect(byCode.get('GST_TDS_PAYABLE_CGST')).toBe('5000.00');
    expect(byCode.get('GST_TDS_PAYABLE_SGST')).toBe('5000.00');
    expect(byCode.get('GST_TDS_PAYABLE_IGST')).toBe('5000.00');
    expect(byCode.get('HDFC_CURRENT_ACCOUNT')).toBe('2345000.00');
  });

  it('rejects when sum(cashPaid) does not equal actualAmount', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '10000', vendorBillNumber: `VP-VB-MISMATCH-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });
    await expect(
      vendorPayments.postVendorPayment({
        organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-21', utrReference: undefined,
        actualAmount: '10000',
        allocations: [{ paymentRequestLineId: request.lines[0]!.id, cashPaid: '9000', deductions: [] }],
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('must equal the actual amount paid');
  });
});

describe('VendorPaymentsService — batching and cross-vendor/legal-entity rejection', () => {
  it('batches lines from two separate approved payment requests for the same vendor + legal entity', async () => {
    const billX = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '100000', vendorBillNumber: `VP-BATCH-X-${generateId().slice(0, 8)}` });
    const billY = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '50000', vendorBillNumber: `VP-BATCH-Y-${generateId().slice(0, 8)}` });
    const requestX = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [billX] });
    const requestY = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [billY] });
    const lineX = requestX.lines[0]!;
    const lineY = requestY.lines[0]!;

    const actualAmount = (Number(lineX.requestedAmount) + Number(lineY.requestedAmount)).toFixed(2);
    const payment = await vendorPayments.postVendorPayment({
      organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-22', utrReference: undefined,
      actualAmount,
      allocations: [
        { paymentRequestLineId: lineX.id, cashPaid: lineX.requestedAmount, deductions: [] },
        { paymentRequestLineId: lineY.id, cashPaid: lineY.requestedAmount, deductions: [] },
      ],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(payment.allocations).toHaveLength(2);
    expect(payment.actualAmount).toBe(actualAmount);
  });

  it('rejects a batch mixing lines from two different vendors', async () => {
    const billA = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '10000', vendorBillNumber: `VP-XV-A-${generateId().slice(0, 8)}` });
    const billOther = await createFinalizedBill({ projectId, vendorId: otherVendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '10000', vendorBillNumber: `VP-XV-O-${generateId().slice(0, 8)}` });
    const requestA = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [billA] });
    const requestOther = await createApprovedPaymentRequest({ vendorId: otherVendorId, legalEntityId, bills: [billOther] });

    await expect(
      vendorPayments.postVendorPayment({
        organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-22', utrReference: undefined,
        actualAmount: '20000',
        allocations: [
          { paymentRequestLineId: requestA.lines[0]!.id, cashPaid: '10000', deductions: [] },
          { paymentRequestLineId: requestOther.lines[0]!.id, cashPaid: '10000', deductions: [] },
        ],
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('same vendor');
  });

  it("rejects a batch whose payment request's legal entity differs from the paying bank account's legal entity", async () => {
    const billOLE = await createFinalizedBill({ projectId: otherLegalEntityProjectId, vendorId, gstRegistrationId: otherLegalEntityGstRegistrationId, unitPrice: '10000', vendorBillNumber: `VP-OLE-${generateId().slice(0, 8)}` });
    const requestOLE = await createApprovedPaymentRequest({ vendorId, legalEntityId: otherLegalEntityId, bills: [billOLE] });

    await expect(
      vendorPayments.postVendorPayment({
        organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-22', utrReference: undefined,
        actualAmount: '11800',
        allocations: [{ paymentRequestLineId: requestOLE.lines[0]!.id, cashPaid: '11800', deductions: [] }],
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('same legal entity');
  });

  it('rejects a line whose parent payment request is not APPROVED', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '10000', vendorBillNumber: `VP-NOTAPPR-${generateId().slice(0, 8)}` });
    const draft = await paymentRequests.createDraft({
      organizationId, vendorId, legalEntityId, requestedPaymentDate: '2026-08-15', priority: undefined, remarks: undefined,
      lines: [{ vendorBillId: bill.id, requestedAmount: bill.totalAmount }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const submitted = await paymentRequests.submit({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    const detail = await paymentRequests.getDetail({ organizationId, id: submitted.id, actorId, canSeeAll: true });

    await expect(
      vendorPayments.postVendorPayment({
        organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-22', utrReference: undefined,
        actualAmount: bill.totalAmount,
        allocations: [{ paymentRequestLineId: detail.lines[0]!.id, cashPaid: bill.totalAmount, deductions: [] }],
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('is not approved');
  });
});

describe('VendorPaymentsService — partial payment sequence and available-to-pay', () => {
  it('supports a genuine partial payment sequence, rejects an over-allocation, and pays off the remainder exactly', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '100000', vendorBillNumber: `VP-PARTIAL-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });
    const line = request.lines[0]!;

    const eligibleBefore = await vendorPayments.getEligiblePaymentRequestLines({ organizationId, vendorId: undefined, legalEntityId: undefined, seedPaymentRequestId: request.id, actorId, canSeeAll: true });
    expect(eligibleBefore.lines.find((l) => l.id === line.id)!.availableToPay).toBe('118000.00');

    const firstPayment = await vendorPayments.postVendorPayment({
      organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-22', utrReference: undefined,
      actualAmount: '70000',
      allocations: [{ paymentRequestLineId: line.id, cashPaid: '70000', deductions: [] }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(firstPayment.allocations[0]!.settledAmount).toBe('70000.00');

    const eligibleAfter = await vendorPayments.getEligiblePaymentRequestLines({ organizationId, vendorId: undefined, legalEntityId: undefined, seedPaymentRequestId: request.id, actorId, canSeeAll: true });
    expect(eligibleAfter.lines.find((l) => l.id === line.id)!.availableToPay).toBe('48000.00');

    await expect(
      vendorPayments.postVendorPayment({
        organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-23', utrReference: undefined,
        actualAmount: '50000',
        allocations: [{ paymentRequestLineId: line.id, cashPaid: '50000', deductions: [] }],
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('exceeds its available balance');

    const secondPayment = await vendorPayments.postVendorPayment({
      organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-23', utrReference: undefined,
      actualAmount: '48000',
      allocations: [{ paymentRequestLineId: line.id, cashPaid: '48000', deductions: [] }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(secondPayment.allocations[0]!.settledAmount).toBe('48000.00');

    const eligibleFinal = await vendorPayments.getEligiblePaymentRequestLines({ organizationId, vendorId: undefined, legalEntityId: undefined, seedPaymentRequestId: request.id, actorId, canSeeAll: true });
    expect(eligibleFinal.lines.find((l) => l.id === line.id)).toBeUndefined();

    const availability = await vendorPayments.getPaymentRequestAvailability({ organizationId, paymentRequestId: request.id });
    expect(availability.available).toBe('0.00');
  });
});

describe('VendorPaymentsService — reverseVendorPayment', () => {
  it('reverses the journal, flips status, restores availability, and leaves allocation/deduction rows untouched', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '50000', vendorBillNumber: `VP-REV-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });
    const line = request.lines[0]!;

    const payment = await vendorPayments.postVendorPayment({
      organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-24', utrReference: undefined,
      actualAmount: '54000',
      allocations: [{ paymentRequestLineId: line.id, cashPaid: '54000', deductions: [{ type: 'TDS', amount: '5000', ratePercent: undefined, narrative: undefined }] }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    const reversed = await vendorPayments.reverseVendorPayment({
      organizationId, id: payment.id, expectedVersion: payment.version, reason: 'Wrong amount recorded', accountingDate: '2026-08-25', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.allocations).toHaveLength(1);
    expect(reversed.allocations[0]!.settledAmount).toBe('59000.00');
    expect(reversed.allocations[0]!.deductions).toHaveLength(1);
    expect(reversed.allocations[0]!.deductions[0]!.amount).toBe('5000.00');

    const reversalDetail = await posting.getEntryDetail({ organizationId, id: reversed.reversalJournalEntryId! });
    expect(reversalDetail.reversalOfJournalEntryId).toBe(payment.journalEntryId);

    const availability = await vendorPayments.getPaymentRequestAvailability({ organizationId, paymentRequestId: request.id });
    expect(availability.available).toBe('59000.00');
  });

  it('rejects a stale expectedVersion on reverse', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '20000', vendorBillNumber: `VP-VER-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });
    const payment = await vendorPayments.postVendorPayment({
      organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-24', utrReference: undefined,
      actualAmount: bill.totalAmount,
      allocations: [{ paymentRequestLineId: request.lines[0]!.id, cashPaid: bill.totalAmount, deductions: [] }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    await expect(
      vendorPayments.reverseVendorPayment({
        organizationId, id: payment.id, expectedVersion: payment.version + 1, reason: 'Stale', accountingDate: '2026-08-25', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });
});

describe('VendorPaymentsService — idempotency, project scoping, cross-org isolation', () => {
  it('a duplicate idempotency-key postVendorPayment call returns the original record, not a second one', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '12000', vendorBillNumber: `VP-IDEMP-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });
    const key = generateId();
    const input = {
      organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-24', utrReference: undefined,
      actualAmount: bill.totalAmount,
      allocations: [{ paymentRequestLineId: request.lines[0]!.id, cashPaid: bill.totalAmount, deductions: [] }],
      idempotencyKey: key, actorId, correlationId: generateId(),
    };
    const first = await vendorPayments.postVendorPayment(input);
    const second = await vendorPayments.postVendorPayment({ ...input, correlationId: generateId() });
    expect(second.id).toBe(first.id);
  });

  it('a vendor payment whose lines touch an out-of-scope project is invisible via getDetail (NOT_FOUND) and excluded from list', async () => {
    const bill = await createFinalizedBill({ projectId: unassignedProjectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '15000', vendorBillNumber: `VP-SCOPE-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });
    const payment = await vendorPayments.postVendorPayment({
      organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-24', utrReference: undefined,
      actualAmount: bill.totalAmount,
      allocations: [{ paymentRequestLineId: request.lines[0]!.id, cashPaid: bill.totalAmount, deductions: [] }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    try {
      await vendorPayments.getDetail({ organizationId, id: payment.id, actorId: scopedUserId, canSeeAll: false });
      expect.unreachable('expected getDetail to throw');
    } catch (error) {
      expect((error as { cause?: { appErrorCode?: string } }).cause?.appErrorCode).toBe('NOT_FOUND');
    }

    const { rows } = await vendorPayments.list({ organizationId, page: 1, pageSize: 100, filters: {}, actorId: scopedUserId, canSeeAll: false });
    expect(rows.some((r) => r.id === payment.id)).toBe(false);
  });

  it('a scoped actor sees a vendor payment whose lines are entirely within their assigned project', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '9000', vendorBillNumber: `VP-INSCOPE-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });
    const payment = await vendorPayments.postVendorPayment({
      organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-24', utrReference: undefined,
      actualAmount: bill.totalAmount,
      allocations: [{ paymentRequestLineId: request.lines[0]!.id, cashPaid: bill.totalAmount, deductions: [] }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    const detail = await vendorPayments.getDetail({ organizationId, id: payment.id, actorId: scopedUserId, canSeeAll: false });
    expect(detail.id).toBe(payment.id);
  });

  it('does not leak vendor payments across organizations', async () => {
    const { rows } = await vendorPayments.list({ organizationId: otherOrganizationId, page: 1, pageSize: 25, filters: {}, actorId, canSeeAll: true });
    expect(rows).toHaveLength(0);
  });
});

describe('PaymentRequestsService — revoke() rejects once a VendorPaymentAllocation exists', () => {
  it('rejects revoke once any vendor payment has been recorded against one of the request\'s lines', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '30000', vendorBillNumber: `VP-REVOKE-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });

    await vendorPayments.postVendorPayment({
      organizationId, bankAccountId, paymentModeId, paymentDate: '2026-08-24', utrReference: undefined,
      actualAmount: '10000',
      allocations: [{ paymentRequestLineId: request.lines[0]!.id, cashPaid: '10000', deductions: [] }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    await expect(
      paymentRequests.revoke({ organizationId, id: request.id, expectedVersion: request.version, reason: 'Changed my mind', idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('vendor payment has already been recorded');
  });

  it('still allows revoke for an approved request with no vendor payment recorded against it', async () => {
    const bill = await createFinalizedBill({ projectId, vendorId, gstRegistrationId: gujaratGstRegistrationId, unitPrice: '11000', vendorBillNumber: `VP-REVOKE-OK-${generateId().slice(0, 8)}` });
    const request = await createApprovedPaymentRequest({ vendorId, legalEntityId, bills: [bill] });

    const revoked = await paymentRequests.revoke({ organizationId, id: request.id, expectedVersion: request.version, reason: 'Changed my mind', idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    expect(revoked.status).toBe('REVOKED');
  });
});
