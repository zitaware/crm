import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { MilestonesService } from '../milestones/milestones.service';
import { PaymentAlertsService } from '../payment-alerts/payment-alerts.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CreditDebitNotesService } from '../credit-debit-notes/credit-debit-notes.service';
import { ReceiptsService } from './receipts.service';
import { extendFinancialYearsThroughToday } from '../testing/financial-years.test-util';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const paymentAlerts = new PaymentAlertsService(prisma, projects);
const milestones = new MilestonesService(prisma, projects, paymentAlerts);
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const receipts = new ReceiptsService(prisma, posting, projects);
const invoices = new InvoicesService(prisma, posting, projects, financialYears, receipts);
const creditDebitNotes = new CreditDebitNotesService(prisma, posting, projects);

let organizationId: string;
let otherOrganizationId: string;
let clientId: string;
let legalEntityId: string;
let projectId: string;
let gujaratStateId: string;
let gstRegistrationId: string;
let bankAccountId: string;
let otherBankAccountId: string;
let penaltyCategoryId: string;
let penaltyCategoryWithOverrideId: string;
let overrideLedgerAccountId: string;
const actorId = generateId();

async function finalizeInvoice(taxableAmount: string, milestoneName: string): Promise<{ id: string; invoiceNumber: string | null; totalAmount: string | null }> {
  const capex = await milestones.createCapex({
    organizationId,
    projectId,
    name: milestoneName,
    approvedAmount: '50000000',
    referenceNumber: undefined,
    approvalDate: undefined,
    description: undefined,
    alertRecipient: undefined,
    reminderOffsetDays: undefined,
    events: [{ name: 'On Completion', amount: '50000000', dueDate: '2026-05-31' }],
    idempotencyKey: generateId(),
    actorId,
    canSeeAll: true,
    correlationId: generateId(),
  });
  const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
  const eventId = overview.capexEvents.find((e) => e.milestoneId === capex.id)!.id;
  const alert =
    (await prisma.client.paymentAlert.findFirst({ where: { sourceEventId: eventId } })) ??
    (await prisma.client.paymentAlert.create({
      data: { id: generateId(), organizationId, projectId, sourceType: 'CAPEX_EVENT', sourceEventId: eventId, status: 'OPEN' },
    }));

  const draft = await invoices.createDraftFromAlert({
    organizationId,
    paymentAlertId: alert.id,
    gstRegistrationId,
    bankAccountId,
    dueDate: '2026-05-15',
    paymentTermsDays: undefined,
    narrative: undefined,
    lines: [{ description: milestoneName, hsnSac: '998314', quantity: '1', unitPrice: taxableAmount, gstRatePercent: '9' }],
    idempotencyKey: generateId(),
    actorId,
    correlationId: generateId(),
  });

  return invoices.finalize({
    organizationId,
    id: draft.id,
    expectedVersion: draft.version,
    invoiceDate: '2026-04-20',
    idempotencyKey: generateId(),
    actorId,
    correlationId: generateId(),
  });
}

/** One invoice billing two CAPEX events: Design 3,00,000 and Build 5,00,000 taxable, 9% + 9% GST. */
async function finalizeCombinedInvoice(milestoneName: string) {
  const capex = await milestones.createCapex({
    organizationId, projectId, name: milestoneName, approvedAmount: '800000', referenceNumber: undefined,
    approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
    events: [
      { name: 'Design', amount: '300000', dueDate: '2026-05-31' },
      { name: 'Build', amount: '500000', dueDate: '2026-05-31' },
    ],
    idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
  });
  const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
  const events = overview.capexEvents.filter((event) => event.milestoneId === capex.id);
  const design = events.find((event) => event.name === 'Design')!;
  const build = events.find((event) => event.name === 'Build')!;
  const alertFor = async (eventId: string) =>
    (await prisma.client.paymentAlert.findFirst({ where: { sourceEventId: eventId } })) ??
    (await prisma.client.paymentAlert.create({
      data: { id: generateId(), organizationId, projectId, sourceType: 'CAPEX_EVENT', sourceEventId: eventId, status: 'OPEN' },
    }));
  const designAlert = await alertFor(design.id);
  const buildAlert = await alertFor(build.id);
  const draft = await invoices.createDraftFromAlert({
    organizationId, paymentAlertId: designAlert.id, additionalPaymentAlertIds: [buildAlert.id], gstRegistrationId, bankAccountId,
    dueDate: '2026-05-15', paymentTermsDays: undefined, narrative: undefined,
    lines: [
      { description: 'Design', hsnSac: '998314', quantity: '1', unitPrice: '300000', gstRatePercent: '9', sourceEventId: design.id },
      { description: 'Build', hsnSac: '998314', quantity: '1', unitPrice: '500000', gstRatePercent: '9', sourceEventId: build.id },
    ],
    idempotencyKey: generateId(), actorId, correlationId: generateId(),
  });
  const invoice = await invoices.finalize({
    organizationId, id: draft.id, expectedVersion: draft.version, invoiceDate: '2026-04-20',
    idempotencyKey: generateId(), actorId, correlationId: generateId(),
  });
  return { invoice, designId: design.id, buildId: build.id };
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Receipts Test Org', code: `RECTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Receipts Test Other Org', code: `RECTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const gujarat = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });
  gujaratStateId = gujarat.id;

  const client = await clients.create({
    organizationId,
    name: 'Receipt Test Client',
    shortCode: undefined,
    clientTypeId: undefined,
    department: 'IT Department',
    stateId: gujaratStateId,
    districtId: undefined,
    cityId: undefined,
    pinCode: undefined,
    officeAddress: 'Gandhinagar, Gujarat',
    gstin: '24CCCCC2222C1Z5',
    internalNote: undefined,
    contacts: [],
    actorId,
    correlationId: generateId(),
  });
  clientId = client.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Receipt Test Legal Entity', panNumber: 'ABCPR3456P', registeredAddress: 'Ahmedabad, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  const gstRegistration = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId,
    stateId: gujaratStateId,
    gstin: '24AAAAA0000A1Z6',
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  gstRegistrationId = gstRegistration.id;

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
  // Credit/debit notes post on today's date (ADR-070), so a year must cover today too.
  await extendFinancialYearsThroughToday(financialYears, { organizationId, legalEntityId, lastEndDate: '2026-12-31', actorId });

  const project = await projects.create({
    organizationId,
    clientId,
    legalEntityId,
    leadId: undefined,
    tenderId: undefined,
    projectManagerId: undefined,
    introducerId: undefined,
    projectTypeId: undefined,
    name: 'Receipt Test Project',
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

  const assetGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const incomeGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INCOME', name: 'Income', accountType: 'INCOME', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  const liabilityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });

  const ledgerCodes: Array<{ code: string; groupId: string; name: string }> = [
    { code: 'ACCOUNTS_RECEIVABLE', groupId: assetGroup.id, name: 'Accounts Receivable' },
    { code: 'SOFTWARE_PROJECT_REVENUE', groupId: incomeGroup.id, name: 'Software Project Revenue' },
    { code: 'OUTPUT_CGST_PAYABLE', groupId: liabilityGroup.id, name: 'Output CGST Payable' },
    { code: 'OUTPUT_SGST_PAYABLE', groupId: liabilityGroup.id, name: 'Output SGST Payable' },
    { code: 'OUTPUT_IGST_PAYABLE', groupId: liabilityGroup.id, name: 'Output IGST Payable' },
    { code: 'TDS_RECEIVABLE', groupId: assetGroup.id, name: 'TDS Receivable' },
    { code: 'GST_TDS_RECEIVABLE_CGST', groupId: assetGroup.id, name: 'GST-TDS Receivable — CGST' },
    { code: 'GST_TDS_RECEIVABLE_SGST', groupId: assetGroup.id, name: 'GST-TDS Receivable — SGST' },
    { code: 'GST_TDS_RECEIVABLE_IGST', groupId: assetGroup.id, name: 'GST-TDS Receivable — IGST' },
    { code: 'HOLD_RECEIVABLE', groupId: assetGroup.id, name: 'Hold Receivable' },
    { code: 'RETENTION_RECEIVABLE', groupId: assetGroup.id, name: 'Retention Receivable' },
    { code: 'DISPUTED_DEDUCTION_RECEIVABLE', groupId: assetGroup.id, name: 'Disputed Deduction Receivable' },
    { code: 'PENALTY_REVENUE_DEDUCTION', groupId: incomeGroup.id, name: 'Penalty Revenue Deduction' },
    { code: 'HDFC_CURRENT_ACCOUNT', groupId: assetGroup.id, name: 'HDFC Current Account' },
    { code: 'SBI_CURRENT_ACCOUNT', groupId: assetGroup.id, name: 'SBI Current Account' },
    { code: 'PENALTY_OVERRIDE_ACCOUNT', groupId: incomeGroup.id, name: 'Penalty Override Account' },
  ];
  const createdLedgerAccounts = new Map<string, string>();
  for (const l of ledgerCodes) {
    const row = await prisma.client.ledgerAccount.create({
      data: { id: generateId(), organizationId, accountGroupId: l.groupId, code: l.code, name: l.name, allowManualPosting: true, isActive: true },
    });
    createdLedgerAccounts.set(l.code, row.id);
  }
  overrideLedgerAccountId = createdLedgerAccounts.get('PENALTY_OVERRIDE_ACCOUNT')!;

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

  const otherBankAccount = await legalEntities.createBankAccount({
    organizationId,
    legalEntityId,
    ledgerAccountId: createdLedgerAccounts.get('SBI_CURRENT_ACCOUNT')!,
    accountName: 'SBI Operating Account',
    bankName: 'SBI',
    maskedAccountNumber: '****9920',
    ifsc: undefined,
    actorId,
    correlationId: generateId(),
  });
  otherBankAccountId = otherBankAccount.id;

  const penaltyCategory = await prisma.client.penaltyCategory.create({
    data: { id: generateId(), organizationId, code: 'LD', name: 'Liquidated Damages', createdBy: actorId },
  });
  penaltyCategoryId = penaltyCategory.id;

  const penaltyCategoryWithOverride = await prisma.client.penaltyCategory.create({
    data: {
      id: generateId(),
      organizationId,
      code: 'SLA',
      name: 'SLA Breach',
      acceptedLedgerAccountId: overrideLedgerAccountId,
      createdBy: actorId,
    },
  });
  penaltyCategoryWithOverrideId = penaltyCategoryWithOverride.id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.deductionRelease.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.allocationDeduction.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.receiptAllocation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.clientReceipt.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.creditDebitNoteLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.creditDebitNote.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.invoiceLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.paymentAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.milestoneCreationRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.milestoneInstallment.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.milestoneEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.projectMilestone.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.bankAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.penaltyCategory.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.projectTeamMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.gstRegistration.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('ReceiptsService', () => {
  it('posts a single-invoice receipt with a TDS deduction and computes the exact docs/06 journal', async () => {
    const invoice = await finalizeInvoice('1000000', 'Simple Receipt Test');
    // 1000000 taxable + 18% GST = 1180000 total. TDS 10% on base = 100000.
    // cashAllocated + TDS = settledAmount, must not exceed outstanding (1180000).
    const receipt = await receipts.postReceipt({
      organizationId,
      bankAccountId,
      paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
      receiptDate: '2026-05-01',
      utrReference: 'UTR12345',
      actualAmount: '1080000',
      allocations: [
        {
          invoiceId: invoice.id,
          cashAllocated: '1080000',
          deductions: [{ type: 'TDS', amount: '100000', ratePercent: '10', penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined }],
        },
      ],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    expect(receipt.status).toBe('POSTED');
    expect(receipt.actualAmount).toBe('1080000.00');
    expect(receipt.allocations).toHaveLength(1);
    expect(receipt.allocations[0]!.settledAmount).toBe('1180000.00');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: receipt.journalEntryId! });
    const debitLines = journalDetail.lines.filter((l) => Number(l.debitAmount) > 0);
    const creditLines = journalDetail.lines.filter((l) => Number(l.creditAmount) > 0);
    expect(debitLines.map((l) => l.ledgerAccountCode).sort()).toEqual(['HDFC_CURRENT_ACCOUNT', 'TDS_RECEIVABLE'].sort());
    expect(creditLines.map((l) => l.ledgerAccountCode)).toEqual(['ACCOUNTS_RECEIVABLE']);
    expect(creditLines[0]!.creditAmount).toBe('1180000.00');

    const auditEvent = await prisma.client.auditEvent.findFirst({ where: { entityType: 'RECEIPT', entityId: receipt.id, action: 'RECEIPT_POSTED' } });
    expect(auditEvent).not.toBeNull();
  });

  it('posts a multi-invoice allocation and sums deductions per ledger account across allocations', async () => {
    const invoiceA = await finalizeInvoice('500000', 'Multi Alloc A');
    const invoiceB = await finalizeInvoice('500000', 'Multi Alloc B');

    const receipt = await receipts.postReceipt({
      organizationId,
      bankAccountId,
      paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
      receiptDate: '2026-05-02',
      utrReference: undefined,
      actualAmount: '1100000',
      allocations: [
        {
          invoiceId: invoiceA.id,
          cashAllocated: '550000',
          deductions: [{ type: 'TDS', amount: '30000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined }],
        },
        {
          invoiceId: invoiceB.id,
          cashAllocated: '550000',
          deductions: [{ type: 'TDS', amount: '30000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined }],
        },
      ],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    expect(receipt.allocations).toHaveLength(2);
    const journalDetail = await posting.getEntryDetail({ organizationId, id: receipt.journalEntryId! });
    const tdsLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'TDS_RECEIVABLE')!;
    expect(tdsLine.debitAmount).toBe('60000.00');
    const bankLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'HDFC_CURRENT_ACCOUNT')!;
    expect(bankLine.debitAmount).toBe('1100000.00');
  });

  it('resolves GST-TDS, hold, retention, and penalty deductions to their correct ledger accounts, including a penalty-category override', async () => {
    const invoice = await finalizeInvoice('2000000', 'All Deductions Test');
    const receipt = await receipts.postReceipt({
      organizationId,
      bankAccountId,
      paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
      receiptDate: '2026-05-03',
      utrReference: undefined,
      actualAmount: '1500000',
      allocations: [
        {
          invoiceId: invoice.id,
          cashAllocated: '1500000',
          deductions: [
            { type: 'CGST_TDS', amount: '5000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'SGST_TDS', amount: '5000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'HOLD', amount: '100000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'RETENTION', amount: '50000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'ACCEPTED_PENALTY', amount: '20000', ratePercent: undefined, penaltyCategoryId, otherLedgerAccountId: undefined, narrative: 'Late delivery' },
            { type: 'ACCEPTED_PENALTY', amount: '10000', ratePercent: undefined, penaltyCategoryId: penaltyCategoryWithOverrideId, otherLedgerAccountId: undefined, narrative: 'SLA breach' },
            { type: 'DISPUTED_PENALTY', amount: '5000', ratePercent: undefined, penaltyCategoryId, otherLedgerAccountId: undefined, narrative: 'Disputed' },
          ],
        },
      ],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    const journalDetail = await posting.getEntryDetail({ organizationId, id: receipt.journalEntryId! });
    const byCode = new Map(journalDetail.lines.map((l) => [l.ledgerAccountCode, l.debitAmount]));
    expect(byCode.get('GST_TDS_RECEIVABLE_CGST')).toBe('5000.00');
    expect(byCode.get('GST_TDS_RECEIVABLE_SGST')).toBe('5000.00');
    expect(byCode.get('HOLD_RECEIVABLE')).toBe('100000.00');
    expect(byCode.get('RETENTION_RECEIVABLE')).toBe('50000.00');
    expect(byCode.get('PENALTY_REVENUE_DEDUCTION')).toBe('20000.00');
    expect(byCode.get('PENALTY_OVERRIDE_ACCOUNT')).toBe('10000.00');
    expect(byCode.get('DISPUTED_DEDUCTION_RECEIVABLE')).toBe('5000.00');
  });

  it('rejects an allocation that exceeds the invoice outstanding amount', async () => {
    const invoice = await finalizeInvoice('100000', 'Overallocation Test');
    await expect(
      receipts.postReceipt({
        organizationId,
        bankAccountId,
        paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
        receiptDate: '2026-05-04',
        utrReference: undefined,
        actualAmount: '200000',
        allocations: [{ invoiceId: invoice.id, cashAllocated: '200000', deductions: [] }],
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('exceeds its outstanding amount');
  });

  it('rejects when sum(cashAllocated) does not equal actualAmount', async () => {
    const invoice = await finalizeInvoice('100000', 'Mismatch Test');
    await expect(
      receipts.postReceipt({
        organizationId,
        bankAccountId,
        paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
        receiptDate: '2026-05-05',
        utrReference: undefined,
        actualAmount: '50000',
        allocations: [{ invoiceId: invoice.id, cashAllocated: '80000', deductions: [] }],
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('must equal the actual amount received');
  });

  it('rejects allocating against a non-finalized invoice', async () => {
    const capex = await milestones.createCapex({
      organizationId,
      projectId,
      name: 'Draft Guard Test',
      approvedAmount: '100000',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      events: [{ name: 'Event', amount: '100000', dueDate: '2026-05-31' }],
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventId = overview.capexEvents.find((e) => e.milestoneId === capex.id)!.id;
    const alert =
      (await prisma.client.paymentAlert.findFirst({ where: { sourceEventId: eventId } })) ??
      (await prisma.client.paymentAlert.create({
        data: { id: generateId(), organizationId, projectId, sourceType: 'CAPEX_EVENT', sourceEventId: eventId, status: 'OPEN' },
      }));
    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId,
      bankAccountId,
      dueDate: '2026-05-15',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: [{ description: 'Draft Guard', hsnSac: '998314', quantity: '1', unitPrice: '100000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    await expect(
      receipts.postReceipt({
        organizationId,
        bankAccountId,
        paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
        receiptDate: '2026-05-06',
        utrReference: undefined,
        actualAmount: '10000',
        allocations: [{ invoiceId: draft.id, cashAllocated: '10000', deductions: [] }],
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('is not finalized');
  });

  it('reverses a receipt, and its allocations no longer count toward outstanding', async () => {
    const invoice = await finalizeInvoice('300000', 'Reversal Test');
    const receipt = await receipts.postReceipt({
      organizationId,
      bankAccountId,
      paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
      receiptDate: '2026-05-07',
      utrReference: undefined,
      actualAmount: '354000',
      allocations: [{ invoiceId: invoice.id, cashAllocated: '354000', deductions: [] }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    const reversed = await receipts.reverseReceipt({
      organizationId,
      id: receipt.id,
      expectedVersion: receipt.version,
      reason: 'Bounced cheque',
      accountingDate: '2026-05-08',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(reversed.status).toBe('REVERSED');

    const reversalDetail = await posting.getEntryDetail({ organizationId, id: reversed.reversalJournalEntryId! });
    expect(reversalDetail.reversalOfJournalEntryId).toBe(receipt.journalEntryId);

    // A second receipt can now be posted for the same, still-outstanding invoice.
    const secondReceipt = await receipts.postReceipt({
      organizationId,
      bankAccountId,
      paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
      receiptDate: '2026-05-09',
      utrReference: undefined,
      actualAmount: '354000',
      allocations: [{ invoiceId: invoice.id, cashAllocated: '354000', deductions: [] }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(secondReceipt.status).toBe('POSTED');
  });

  it('voiding a finalized invoice reverses its receipts, and refuses when a receipt also pays another invoice (ADR-164)', async () => {
    const paymentModeId = (await prisma.client.paymentMode.findFirstOrThrow()).id;
    const pay = (allocations: Array<{ invoiceId: string; cashAllocated: string }>, amount: string) =>
      receipts.postReceipt({
        organizationId, bankAccountId, paymentModeId, receiptDate: '2026-05-11', utrReference: undefined, actualAmount: amount,
        allocations: allocations.map((a) => ({ ...a, deductions: [] })), idempotencyKey: generateId(), actorId, correlationId: generateId(),
      });
    const voidInvoice = async (id: string, canReverseReceipts: boolean) => {
      const { version } = await prisma.client.invoice.findUniqueOrThrow({ where: { id }, select: { version: true } });
      return invoices.void({
        organizationId, id, expectedVersion: version, reason: 'Wrong amount', accountingDate: '2026-05-12', canReverseReceipts,
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      });
    };

    const invoice = await finalizeInvoice('100000', 'Void Reverses Receipt');
    const first = await pay([{ invoiceId: invoice.id, cashAllocated: '50000' }], '50000');
    const second = await pay([{ invoiceId: invoice.id, cashAllocated: '68000' }], '68000');

    await expect(voidInvoice(invoice.id, false)).rejects.toThrow('permission to reverse receipts');
    expect((await prisma.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('FINALIZED');

    const voided = await voidInvoice(invoice.id, true);
    expect(voided.status).toBe('VOID');
    for (const r of [first, second]) {
      const stored = await prisma.client.clientReceipt.findUniqueOrThrow({ where: { id: r.id } });
      expect(stored.status).toBe('REVERSED');
      expect(stored.reversalReason).toBe(`Invoice ${invoice.invoiceNumber} voided: Wrong amount`);
      const reversal = await posting.getEntryDetail({ organizationId, id: stored.reversalJournalEntryId! });
      expect([reversal.reversalOfJournalEntryId, reversal.accountingDate]).toEqual([r.journalEntryId, '2026-05-12']);
    }

    // A receipt that also pays another invoice is left to the user.
    const shared = await finalizeInvoice('100000', 'Void Shared Receipt A');
    const other = await finalizeInvoice('100000', 'Void Shared Receipt B');
    const both = await pay([{ invoiceId: shared.id, cashAllocated: '10000' }, { invoiceId: other.id, cashAllocated: '10000' }], '20000');
    await expect(voidInvoice(shared.id, true)).rejects.toThrow(`also pays invoice ${other.invoiceNumber}`);
    expect((await prisma.client.clientReceipt.findUniqueOrThrow({ where: { id: both.id } })).status).toBe('POSTED');
    expect((await prisma.client.invoice.findUniqueOrThrow({ where: { id: shared.id } })).status).toBe('FINALIZED');
  }, 30_000);

  it('InvoicesService.list reports outstandingAmount live, net of settled receipts and excluding reversed ones', async () => {
    const invoice = await finalizeInvoice('200000', 'Outstanding List Test');
    // 200000 taxable + 18% GST = 236000 total.
    const readRow = async () => (await invoices.list({ organizationId, page: 1, pageSize: 50, filters: {}, actorId, canSeeAll: true })).rows.find((r) => r.id === invoice.id)!;

    expect((await readRow()).outstandingAmount).toBe('236000.00');

    const partial = await receipts.postReceipt({
      organizationId,
      bankAccountId,
      paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
      receiptDate: '2026-05-10',
      utrReference: undefined,
      actualAmount: '100000',
      allocations: [{ invoiceId: invoice.id, cashAllocated: '100000', deductions: [] }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect((await readRow()).outstandingAmount).toBe('136000.00');

    // A reversed receipt's settled amount no longer counts against outstanding.
    await receipts.reverseReceipt({
      organizationId,
      id: partial.id,
      expectedVersion: partial.version,
      reason: 'Test reversal',
      accountingDate: '2026-05-11',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect((await readRow()).outstandingAmount).toBe('236000.00');

    await receipts.postReceipt({
      organizationId,
      bankAccountId,
      paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
      receiptDate: '2026-05-12',
      utrReference: undefined,
      actualAmount: '236000',
      allocations: [{ invoiceId: invoice.id, cashAllocated: '236000', deductions: [] }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect((await readRow()).outstandingAmount).toBe('0.00');
  });

  it('InvoicesService.list().outstandingAmount nets out a finalized Credit Note', async () => {
    const invoice = await finalizeInvoice('100000', 'Outstanding Credit Note Test');
    // 100000 taxable + 18% GST = 118000 total.
    const readRow = async () => (await invoices.list({ organizationId, page: 1, pageSize: 50, filters: {}, actorId, canSeeAll: true })).rows.find((r) => r.id === invoice.id)!;

    expect((await readRow()).outstandingAmount).toBe('118000.00');

    const draft = await creditDebitNotes.createDraft({
      organizationId,
      invoiceId: invoice.id,
      type: 'CREDIT',
      reason: 'Quantity correction',
      lines: [{ description: 'Correction', hsnSac: undefined, quantity: '1', unitPrice: '10000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    // Still 118000 -- a draft note has no accounting effect yet.
    expect((await readRow()).outstandingAmount).toBe('118000.00');

    await creditDebitNotes.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });
    // 10000 taxable credited + 18% GST = 11800 -- outstanding drops by that amount.
    expect((await readRow()).outstandingAmount).toBe('106200.00');
  });

  it('releases a hold deduction, posts the mirror journal, and rejects an over-release', async () => {
    const invoice = await finalizeInvoice('500000', 'Hold Release Test');
    const receipt = await receipts.postReceipt({
      organizationId,
      bankAccountId,
      paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
      receiptDate: '2026-05-10',
      utrReference: undefined,
      actualAmount: '490000',
      allocations: [
        {
          invoiceId: invoice.id,
          cashAllocated: '490000',
          deductions: [{ type: 'HOLD', amount: '90000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined }],
        },
      ],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const holdDeductionId = receipt.allocations[0]!.deductions[0]!.id;

    const release = await receipts.releaseDeduction({
      organizationId,
      deductionId: holdDeductionId,
      releasedAmount: '40000',
      releasedOn: '2026-06-01',
      bankAccountId: otherBankAccountId,
      utrReference: 'REL-1',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(release.outstandingAmount).toBe('50000.00');

    const releaseJournal = await prisma.client.deductionRelease.findFirst({ where: { deductionId: holdDeductionId } });
    const journalDetail = await posting.getEntryDetail({ organizationId, id: releaseJournal!.journalEntryId! });
    const debitLine = journalDetail.lines.find((l) => Number(l.debitAmount) > 0)!;
    expect(debitLine.ledgerAccountCode).toBe('SBI_CURRENT_ACCOUNT');
    const creditLine = journalDetail.lines.find((l) => Number(l.creditAmount) > 0)!;
    expect(creditLine.ledgerAccountCode).toBe('HOLD_RECEIVABLE');

    await expect(
      receipts.releaseDeduction({
        organizationId,
        deductionId: holdDeductionId,
        releasedAmount: '60000',
        releasedOn: '2026-06-02',
        bankAccountId: otherBankAccountId,
        utrReference: undefined,
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('exceeds the outstanding balance');
  });

  it('a duplicate idempotency-key postReceipt call returns the original record, not a second one', async () => {
    const invoice = await finalizeInvoice('120000', 'Idempotency Test');
    const key = generateId();
    const input = {
      organizationId,
      bankAccountId,
      paymentModeId: (await prisma.client.paymentMode.findFirstOrThrow()).id,
      receiptDate: '2026-05-11',
      utrReference: undefined,
      actualAmount: '141600',
      allocations: [{ invoiceId: invoice.id, cashAllocated: '141600', deductions: [] }],
      idempotencyKey: key,
      actorId,
      correlationId: generateId(),
    };
    const first = await receipts.postReceipt(input);
    const second = await receipts.postReceipt({ ...input, correlationId: generateId() });
    expect(second.id).toBe(first.id);
  });

  it('pays each CAPEX event of a combined invoice on its own, with TDS on that event', async () => {
    const { invoice, designId, buildId } = await finalizeCombinedInvoice('Per Event Receipt Test');
    const paymentModeId = (await prisma.client.paymentMode.findFirstOrThrow()).id;
    const base = { organizationId, bankAccountId, paymentModeId, receiptDate: '2026-05-05', utrReference: undefined, actorId };
    const tds = (amount: string, ratePercent: string) => ({ type: 'TDS' as const, amount, ratePercent, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined });

    const before = await receipts.getAllocationCandidates({ organizationId, seedInvoiceId: invoice.id, actorId, canSeeAll: true });
    const events = before.invoices.find((row) => row.id === invoice.id)!.capexEvents;
    expect(events.map((event) => [event.name, event.taxableAmount, event.totalAmount, event.outstandingAmount])).toEqual([
      ['Design', '300000.00', '354000.00', '354000.00'],
      ['Build', '500000.00', '590000.00', '590000.00'],
    ]);

    // Two rows for Build in one receipt count together: 3,00,000 + 3,00,000 > 5,90,000,
    // although the invoice still has 9,44,000 outstanding.
    await expect(
      receipts.postReceipt({
        ...base, actualAmount: '600000',
        allocations: [
          { invoiceId: invoice.id, sourceEventId: buildId, cashAllocated: '300000', deductions: [] },
          { invoiceId: invoice.id, sourceEventId: buildId, cashAllocated: '300000', deductions: [] },
        ],
        idempotencyKey: generateId(), correlationId: generateId(),
      }),
    ).rejects.toThrow("exceeds that event's outstanding amount");

    // Design only: 2% TDS on its own 3,00,000, not on the invoice's 8,00,000.
    const design = await receipts.postReceipt({
      ...base, actualAmount: '348000',
      allocations: [{ invoiceId: invoice.id, sourceEventId: designId, cashAllocated: '348000', deductions: [tds('6000', '2')] }],
      idempotencyKey: generateId(), correlationId: generateId(),
    });
    expect(design.allocations[0]).toMatchObject({ sourceEventId: designId, sourceEventName: 'Design', settledAmount: '354000.00' });

    await expect(
      receipts.postReceipt({
        ...base, actualAmount: '1',
        allocations: [{ invoiceId: invoice.id, sourceEventId: designId, cashAllocated: '1', deductions: [] }],
        idempotencyKey: generateId(), correlationId: generateId(),
      }),
    ).rejects.toThrow("exceeds that event's outstanding amount");


    const after = await receipts.getAllocationCandidates({ organizationId, seedInvoiceId: invoice.id, actorId, canSeeAll: true });
    const remaining = after.invoices.find((row) => row.id === invoice.id)!;
    expect(remaining.outstandingAmount).toBe('590000.00');
    expect(remaining.capexEvents.map((event) => event.outstandingAmount)).toEqual(['0.00', '590000.00']);

    const build = await receipts.postReceipt({
      ...base, actualAmount: '580000',
      allocations: [{ invoiceId: invoice.id, sourceEventId: buildId, cashAllocated: '580000', deductions: [tds('10000', '2')] }],
      idempotencyKey: generateId(), correlationId: generateId(),
    });
    expect(build.allocations[0]).toMatchObject({ sourceEventName: 'Build', settledAmount: '590000.00' });
  });

  it('shows what was billed and collected on the invoice, on each event and on the milestone (ADR-155)', async () => {
    const { invoice, designId, buildId } = await finalizeCombinedInvoice('Collection Read Model Test');
    const paymentModeId = (await prisma.client.paymentMode.findFirstOrThrow()).id;
    const base = { organizationId, bankAccountId, paymentModeId, utrReference: undefined, actorId };
    const deduction = (type: 'TDS' | 'HOLD' | 'RETENTION', amount: string) => ({ type, amount, ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined });

    // Design paid in full on its own: 3,42,000 cash + 6,000 TDS + 6,000 hold = 3,54,000.
    const design = await receipts.postReceipt({
      ...base, receiptDate: '2026-05-05', actualAmount: '342000',
      allocations: [{ invoiceId: invoice.id, sourceEventId: designId, cashAllocated: '342000', deductions: [deduction('TDS', '6000'), deduction('HOLD', '6000')] }],
      idempotencyKey: generateId(), correlationId: generateId(),
    });
    await receipts.releaseDeduction({
      organizationId, deductionId: design.allocations[0]!.deductions.find((d) => d.type === 'HOLD')!.id,
      releasedAmount: '2500', releasedOn: '2026-06-01', bankAccountId, utrReference: undefined,
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    // Then 4,00,000 + 20,000 retention against the whole invoice.
    await receipts.postReceipt({
      ...base, receiptDate: '2026-05-20', actualAmount: '400000',
      allocations: [{ invoiceId: invoice.id, cashAllocated: '400000', deductions: [deduction('RETENTION', '20000')] }],
      idempotencyKey: generateId(), correlationId: generateId(),
    });

    const detail = await invoices.getDetail({ organizationId, id: invoice.id, actorId, canSeeAll: true });
    expect(detail.collection).toEqual({
      invoiceTotal: '944000.00', creditDebitNet: '0.00', received: '742000.00', tds: '6000.00', gstTds: '0.00',
      hold: '6000.00', retention: '20000.00', penalty: '0.00', otherDeductions: '0.00',
      released: '2500.00', holdRetentionPending: '23500.00', outstanding: '170000.00',
    });
    expect(detail.outstandingAmount).toBe('170000.00');
    expect(detail.receipts.map((r) => [r.receiptDate, r.sourceEventName, r.cashAllocated])).toEqual([
      ['2026-05-20', null, '400000.00'],
      ['2026-05-05', 'Design', '342000.00'],
    ]);
    const listed = await invoices.list({ organizationId, page: 1, pageSize: 100, filters: { projectId }, actorId, canSeeAll: true });
    expect(listed.rows.find((row) => row.id === invoice.id)!.collection).toEqual(detail.collection);

    // The whole-invoice receipt goes to Build, which still owed; Design was already paid.
    const bySource = new Map((await invoices.listBySource({ organizationId, projectId, actorId, canSeeAll: true })).map((s) => [s.sourceId, s]));
    expect(bySource.get(designId)).toMatchObject({
      billedTaxable: '300000.00',
      collection: { invoiceTotal: '354000.00', received: '342000.00', tds: '6000.00', hold: '6000.00', released: '2500.00', retention: '0.00', outstanding: '0.00' },
    });
    expect(bySource.get(buildId)).toMatchObject({
      billedTaxable: '500000.00',
      collection: { invoiceTotal: '590000.00', received: '400000.00', retention: '20000.00', outstanding: '170000.00' },
    });
    expect(bySource.get(buildId)!.invoices.map((i) => i.invoiceNumber)).toEqual([invoice.invoiceNumber]);

    // Build sits on Design's invoice through invoice_capex_sources; it counts as invoiced too.
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const events = new Map(overview.capexEvents.map((e) => [e.id, e]));
    expect(events.get(designId)).toMatchObject({ billingStatus: 'FULLY_INVOICED', invoicedAmount: '300000.00', remainingAmount: '0.00', invoiceNumber: invoice.invoiceNumber });
    expect(events.get(buildId)).toMatchObject({ billingStatus: 'FULLY_INVOICED', invoicedAmount: '500000.00', remainingAmount: '0.00', invoiceNumber: invoice.invoiceNumber });
  });

  it('rejects a CAPEX event that the invoice does not bill', async () => {
    const invoice = await finalizeInvoice('100000', 'Wrong Event Test');
    await expect(
      receipts.calculatePreview({
        organizationId, bankAccountId,
        allocations: [{ invoiceId: invoice.id, sourceEventId: generateId(), cashAllocated: '1000', deductions: [] }],
      }),
    ).rejects.toThrow('is not billed on invoice');
  });

  it('counts two whole-invoice rows of one receipt together against the outstanding amount', async () => {
    const invoice = await finalizeInvoice('100000', 'Two Rows Test');
    await expect(
      receipts.calculatePreview({
        organizationId, bankAccountId,
        allocations: [
          { invoiceId: invoice.id, cashAllocated: '100000', deductions: [] },
          { invoiceId: invoice.id, cashAllocated: '100000', deductions: [] },
        ],
      }),
    ).rejects.toThrow('exceeds its outstanding amount');
  });

  it('does not leak receipts across organizations', async () => {
    const { rows } = await receipts.list({ organizationId: otherOrganizationId, page: 1, pageSize: 25, filters: {}, actorId, canSeeAll: true });
    expect(rows).toHaveLength(0);
  });
});
