import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { makeClaimApprover, removeClaimApprovers } from '../testing/claim-approver.test-util';
import { ProjectsService } from './projects.service';
import { ProjectFinancialsService } from './project-financials.service';
import { ClientsService } from '../clients/clients.service';
import { MilestonesService } from '../milestones/milestones.service';
import { PaymentAlertsService } from '../payment-alerts/payment-alerts.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { CreditDebitNotesService } from '../credit-debit-notes/credit-debit-notes.service';
import { VendorsService } from '../vendors/vendors.service';
import { InventoryLedgerService } from '../inventory/inventory-ledger.service';
import { VendorBillsService } from '../vendor-bills/vendor-bills.service';
import { EmployeeExpensesService } from '../employee-expenses/employee-expenses.service';
import { DirectExpensesService } from '../direct-expenses/direct-expenses.service';
import { uniqueGstin } from '../testing/gstin.test-util';
import { extendFinancialYearsThroughToday } from '../testing/financial-years.test-util';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const financials = new ProjectFinancialsService(prisma, projects, clients);
const paymentAlerts = new PaymentAlertsService(prisma, projects);
const milestones = new MilestonesService(prisma, projects, paymentAlerts);
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const receipts = new ReceiptsService(prisma, posting, projects);
const invoices = new InvoicesService(prisma, posting, projects, financialYears, receipts);
const creditDebitNotes = new CreditDebitNotesService(prisma, posting, projects);
const vendorsSvc = new VendorsService(prisma);
const vendorBills = new VendorBillsService(prisma, posting, projects, new InventoryLedgerService(prisma));
const employeeExpenses = new EmployeeExpensesService(prisma, posting);
const directExpenses = new DirectExpensesService(prisma, posting);

let organizationId: string;
let legalEntityId: string;
let projectId: string;
let otherProjectId: string;
let bankAccountId: string;
const actorId = generateId();

async function createOpenAlert(overrides: { sourceEventId?: string; sourceType: 'CAPEX_EVENT' }) {
  const existing = overrides.sourceEventId
    ? await prisma.client.paymentAlert.findFirst({ where: { sourceEventId: overrides.sourceEventId } })
    : null;
  if (existing) return existing;
  return prisma.client.paymentAlert.create({
    data: {
      id: generateId(),
      organizationId,
      projectId,
      sourceType: overrides.sourceType,
      sourceEventId: overrides.sourceEventId ?? null,
      sourceInstallmentId: null,
      status: 'OPEN',
    },
  });
}

describe('ProjectFinancialsService', () => {
  let hardwareCategoryId: string;
  let travelCategoryId: string;
  let vendorId: string;
  let gstRegistrationId: string;
  let reimbursableUserId: string;
  let penaltyCategoryId: string;
  let bankTransferModeId: string;
  let invoiceId: string;
  let invoiceTotal: string;
  let clientId: string;

  beforeAll(async () => {
    const organization = await prisma.client.organization.create({
      data: { id: generateId(), name: 'Project Financials Test Org', code: `PFIN-${generateId()}` },
    });
    organizationId = organization.id;

    const gujarat = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });

    const client = await clients.create({
      organizationId, name: 'PFIN Test Client', shortCode: undefined, clientTypeId: undefined, department: 'IT',
      stateId: gujarat.id, districtId: undefined, cityId: undefined, pinCode: undefined, officeAddress: 'Gandhinagar',
      gstin: '24PFINC0000C1Z5', internalNote: undefined, contacts: [], actorId, correlationId: generateId(),
    });
    clientId = client.id;

    const legalEntity = await prisma.client.legalEntity.create({
      data: { id: generateId(), organizationId, legalName: 'PFIN Test Legal Entity', panNumber: 'ABCPF1234P', registeredAddress: 'Ahmedabad, Gujarat' },
    });
    legalEntityId = legalEntity.id;

    const gstRegistration = await legalEntities.createGstRegistration({
      organizationId, legalEntityId, stateId: gujarat.id, gstin: uniqueGstin('24'), tradeName: undefined,
      actorId, correlationId: generateId(),
    });
    gstRegistrationId = gstRegistration.id;

    await financialYears.create({
      organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31',
      setCurrent: true, actorId, correlationId: generateId(),
    });
    // Credit/debit notes post on today's date (ADR-070), so a year must cover today too.
    await extendFinancialYearsThroughToday(financialYears, { organizationId, legalEntityId, lastEndDate: '2026-12-31', actorId });

    const project = await projects.create({
      organizationId, clientId: client.id, legalEntityId, leadId: undefined, tenderId: undefined,
      projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined, name: 'PFIN Test Project',
      description: undefined, value: '5000000', budget: undefined, gstApplicable: undefined, workOrderNumber: undefined,
      workOrderDate: undefined, actorId, correlationId: generateId(),
    });
    projectId = project.id;

    const otherProject = await projects.create({
      organizationId, clientId: client.id, legalEntityId, leadId: undefined, tenderId: undefined,
      projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined, name: 'PFIN Other Project',
      description: undefined, value: '1000000', budget: undefined, gstApplicable: undefined, workOrderNumber: undefined,
      workOrderDate: undefined, actorId, correlationId: generateId(),
    });
    otherProjectId = otherProject.id;

    // Ledger accounts covering invoice/receipt/deduction/release/CN-DN/vendor-bill/direct-expense posting.
    const assetGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'PFIN_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true } });
    const incomeGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'PFIN_INCOME', name: 'Income', accountType: 'INCOME', normalBalance: 'CREDIT', isSystemDefined: true } });
    const liabilityGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'PFIN_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true } });
    const expenseGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'PFIN_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true } });

    const ledgerCodes: { code: string; groupId: string; name: string }[] = [
      { code: 'ACCOUNTS_RECEIVABLE', groupId: assetGroup.id, name: 'Accounts Receivable' },
      { code: 'SOFTWARE_PROJECT_REVENUE', groupId: incomeGroup.id, name: 'Project Revenue' },
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
      { code: 'PFIN_OTHER_DEDUCTION_LEDGER', groupId: incomeGroup.id, name: 'Other Deduction Ledger' },
      { code: 'HDFC_CURRENT_ACCOUNT', groupId: assetGroup.id, name: 'HDFC Current Account' },
      { code: 'ACCOUNTS_PAYABLE_VENDOR', groupId: liabilityGroup.id, name: 'Accounts Payable — Vendor' },
      { code: 'INPUT_CGST_RECEIVABLE', groupId: assetGroup.id, name: 'Input CGST Receivable' },
      { code: 'INPUT_SGST_RECEIVABLE', groupId: assetGroup.id, name: 'Input SGST Receivable' },
      { code: 'INPUT_IGST_RECEIVABLE', groupId: assetGroup.id, name: 'Input IGST Receivable' },
      { code: 'PFIN_HARDWARE_EXPENSE', groupId: expenseGroup.id, name: 'Hardware Expense' },
      { code: 'OTHER_EXPENSES', groupId: expenseGroup.id, name: 'Other Expenses' },
      { code: 'PFIN_TRAVEL_EXPENSE', groupId: expenseGroup.id, name: 'Travel Expense' },
      { code: 'EMPLOYEE_ADVANCE_RECEIVABLE', groupId: assetGroup.id, name: 'Employee Advance Receivable' },
      { code: 'INPUT_GST_RECEIVABLE_EXPENSE', groupId: assetGroup.id, name: 'Input GST Receivable — Expense Claims' },
      { code: 'TDS_PAYABLE', groupId: liabilityGroup.id, name: 'TDS Payable' },
    ];
    const ledgerAccountIdByCode = new Map<string, string>();
    for (const l of ledgerCodes) {
      const row = await prisma.client.ledgerAccount.create({
        data: { id: generateId(), organizationId, accountGroupId: l.groupId, code: l.code, name: l.name, allowManualPosting: true, isActive: true },
      });
      ledgerAccountIdByCode.set(l.code, row.id);
    }

    const bankAccount = await legalEntities.createBankAccount({
      organizationId, legalEntityId, ledgerAccountId: ledgerAccountIdByCode.get('HDFC_CURRENT_ACCOUNT')!,
      accountName: 'PFIN Operating Account', bankName: 'HDFC Bank', maskedAccountNumber: '****7711',
      ifsc: 'HDFC0000789', actorId, correlationId: generateId(),
    });
    bankAccountId = bankAccount.id;

    const hardwareCategory = await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId, code: 'PFIN-HARDWARE', name: 'Hardware', ledgerAccountId: ledgerAccountIdByCode.get('PFIN_HARDWARE_EXPENSE')! } });
    hardwareCategoryId = hardwareCategory.id;
    const travelCategory = await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId, code: 'PFIN-TRAVEL', name: 'Travel', ledgerAccountId: ledgerAccountIdByCode.get('PFIN_TRAVEL_EXPENSE')! } });
    travelCategoryId = travelCategory.id;

    const qtyUnit = await prisma.client.unitOfMeasure.create({ data: { id: generateId(), organizationId, code: 'pfin-qty', name: 'Qty' } });

    const vendor = await vendorsSvc.create({
      organizationId, existingPartyId: undefined, name: 'PFIN Test Vendor', shortCode: undefined, gstin: undefined,
      panNumber: undefined, paymentTerms: undefined, stateId: gujarat.id, districtId: undefined, cityId: undefined,
      pinCode: undefined, officeAddress: undefined, internalNote: undefined, actorId, correlationId: generateId(),
    });
    vendorId = vendor.id;

    const employeeUser = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: `pfin-employee-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: 'PFIN Employee', status: 'ACTIVE' } });
    reimbursableUserId = employeeUser.id;
    await prisma.client.employee.create({
      data: { id: generateId(), organizationId, userId: reimbursableUserId, employeeCode: 'EMP-PFIN-1', fullName: 'F. Shah', joiningDate: new Date('2024-01-01'), isReimbursable: true },
    });

    const penaltyCategory = await prisma.client.penaltyCategory.create({
      data: { id: generateId(), organizationId, code: 'PFIN-LD', name: 'Liquidated Damages', createdBy: actorId },
    });
    penaltyCategoryId = penaltyCategory.id;

    bankTransferModeId = (await prisma.client.paymentMode.findFirstOrThrow({ where: { code: 'BANK_TRANSFER' } })).id;

    // --- Invoice 1: FINALIZED, taxable 1,000,000 @ 18% intrastate -> total 1,180,000.00 ---
    const capex = await milestones.createCapex({
      organizationId, projectId, name: 'PFIN Capex', approvedAmount: '1000000', referenceNumber: undefined,
      approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      events: [{ name: 'On Completion', amount: '1000000', dueDate: '2026-05-31' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventId = overview.capexEvents.find((e) => e.milestoneId === capex.id)!.id;
    const alert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: eventId });

    const draft = await invoices.createDraftFromAlert({
      organizationId, paymentAlertId: alert.id, gstRegistrationId, dueDate: '2026-05-15', paymentTermsDays: 30,
      narrative: undefined,
      lines: [{ description: 'Milestone billing', hsnSac: '998314', quantity: '1', unitPrice: '1000000', gstRatePercent: '9' }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    const finalized = await invoices.finalize({
      organizationId, id: draft.id, expectedVersion: draft.version, invoiceDate: '2026-04-20',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    invoiceId = finalized.id;
    invoiceTotal = finalized.totalAmount!;
    expect(invoiceTotal).toBe('1180000.00');

    // --- Debit note (taxable 50,000 @18% -> 59,000.00) and credit note (taxable 30,000 @18% -> 35,400.00) ---
    const debitDraft = await creditDebitNotes.createDraft({
      organizationId, invoiceId, type: 'DEBIT', reason: 'Additional scope',
      lines: [{ description: 'Extra work', hsnSac: undefined, quantity: '1', unitPrice: '50000', gstRatePercent: '9' }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    await creditDebitNotes.finalize({ organizationId, id: debitDraft.id, expectedVersion: debitDraft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    const creditDraft = await creditDebitNotes.createDraft({
      organizationId, invoiceId, type: 'CREDIT', reason: 'Quantity correction',
      lines: [{ description: 'Correction', hsnSac: undefined, quantity: '1', unitPrice: '30000', gstRatePercent: '9' }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    await creditDebitNotes.finalize({ organizationId, id: creditDraft.id, expectedVersion: creditDraft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    // --- Receipt: cash 500,000 + every deduction type, totalling 633,000.00 settled ---
    await receipts.postReceipt({
      organizationId, bankAccountId, paymentModeId: bankTransferModeId, receiptDate: '2026-05-03',
      utrReference: 'UTR-PFIN-1', actualAmount: '500000',
      allocations: [
        {
          invoiceId,
          cashAllocated: '500000',
          deductions: [
            { type: 'TDS', amount: '10000', ratePercent: '10', penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'CGST_TDS', amount: '2000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'SGST_TDS', amount: '2000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'IGST_TDS', amount: '1000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'HOLD', amount: '50000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'RETENTION', amount: '40000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: undefined, narrative: undefined },
            { type: 'ACCEPTED_PENALTY', amount: '15000', ratePercent: undefined, penaltyCategoryId, otherLedgerAccountId: undefined, narrative: 'Late delivery' },
            { type: 'DISPUTED_PENALTY', amount: '8000', ratePercent: undefined, penaltyCategoryId, otherLedgerAccountId: undefined, narrative: 'Disputed' },
            { type: 'OTHER', amount: '5000', ratePercent: undefined, penaltyCategoryId: undefined, otherLedgerAccountId: ledgerAccountIdByCode.get('PFIN_OTHER_DEDUCTION_LEDGER')!, narrative: 'Bank charges' },
          ],
        },
      ],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    const allocation = await prisma.client.receiptAllocation.findFirstOrThrow({ where: { invoiceId }, include: { deductions: true } });
    const holdDeduction = allocation.deductions.find((d) => d.type === 'HOLD')!;
    const retentionDeduction = allocation.deductions.find((d) => d.type === 'RETENTION')!;

    // Partial releases: HOLD 50,000 -> release 20,000 (30,000 unreleased); RETENTION 40,000 -> release 15,000 (25,000 unreleased).
    await receipts.releaseDeduction({
      organizationId, deductionId: holdDeduction.id, releasedAmount: '20000', releasedOn: '2026-06-01',
      bankAccountId, utrReference: 'REL-1', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    await receipts.releaseDeduction({
      organizationId, deductionId: retentionDeduction.id, releasedAmount: '15000', releasedOn: '2026-06-02',
      bankAccountId, utrReference: 'REL-2', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    // --- A second invoice + receipt, fully REVERSED — must be excluded entirely from settlement. ---
    const capex2 = await milestones.createCapex({
      organizationId, projectId, name: 'PFIN Capex Reversed', approvedAmount: '200000', referenceNumber: undefined,
      approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      events: [{ name: 'On Completion', amount: '200000', dueDate: '2026-06-30' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const overview2 = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventId2 = overview2.capexEvents.find((e) => e.milestoneId === capex2.id)!.id;
    const alert2 = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: eventId2 });
    const draft2 = await invoices.createDraftFromAlert({
      organizationId, paymentAlertId: alert2.id, gstRegistrationId, dueDate: '2026-07-15', paymentTermsDays: 30,
      narrative: undefined, lines: [{ description: 'Reversed-receipt invoice', hsnSac: '998314', quantity: '1', unitPrice: '200000', gstRatePercent: '9' }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    const finalized2 = await invoices.finalize({ organizationId, id: draft2.id, expectedVersion: draft2.version, invoiceDate: '2026-06-10', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    const reversedReceipt = await receipts.postReceipt({
      organizationId, bankAccountId, paymentModeId: bankTransferModeId, receiptDate: '2026-06-15', utrReference: 'UTR-PFIN-REV',
      actualAmount: '100000', allocations: [{ invoiceId: finalized2.id, cashAllocated: '100000', deductions: [] }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    await receipts.reverseReceipt({
      organizationId, id: reversedReceipt.id, expectedVersion: reversedReceipt.version, reason: 'Bounced cheque',
      accountingDate: '2026-06-16', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    // --- A third invoice left VOID — must be excluded from grossInvoiceValue. ---
    const capex3 = await milestones.createCapex({
      organizationId, projectId, name: 'PFIN Capex Void', approvedAmount: '90000', referenceNumber: undefined,
      approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      events: [{ name: 'On Completion', amount: '90000', dueDate: '2026-07-31' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const overview3 = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventId3 = overview3.capexEvents.find((e) => e.milestoneId === capex3.id)!.id;
    const alert3 = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: eventId3 });
    const draft3 = await invoices.createDraftFromAlert({
      organizationId, paymentAlertId: alert3.id, gstRegistrationId, dueDate: '2026-08-15', paymentTermsDays: 30,
      narrative: undefined, lines: [{ description: 'Voided invoice', hsnSac: '998314', quantity: '1', unitPrice: '90000', gstRatePercent: '9' }],
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    const finalized3 = await invoices.finalize({ organizationId, id: draft3.id, expectedVersion: draft3.version, invoiceDate: '2026-07-05', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    await invoices.void({ canReverseReceipts: true, organizationId, id: finalized3.id, expectedVersion: finalized3.version, reason: 'Raised in error', accountingDate: '2026-07-06', idempotencyKey: generateId(), actorId, correlationId: generateId() });

    // --- Purchase: one FINALIZED vendor bill, one line ITC-eligible (100,000@18%->118,000, recognized 100,000)
    //     and one line ITC-ineligible (50,000@18%->59,000, recognized 59,000 — ineligible GST stays in cost). ---
    const billDraft = await vendorBills.createDraft({
      organizationId, projectId, vendorId, priority: undefined, gstRegistrationId, vendorBillNumber: 'PFIN-BILL-1',
      vendorBillDate: '2026-03-10',
      lines: [
        { description: 'Eligible line', expenseCategoryId: hardwareCategoryId, inventoryItemId: undefined, unitOfMeasureId: qtyUnit.id, hsnSac: '8471', quantity: '1', unitPrice: '100000', gstRatePercent: '9', itcEligible: true },
        { description: 'Ineligible line', expenseCategoryId: hardwareCategoryId, inventoryItemId: undefined, unitOfMeasureId: qtyUnit.id, hsnSac: '8471', quantity: '1', unitPrice: '50000', gstRatePercent: '9', itcEligible: false },
      ],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const billSubmitted = await vendorBills.submit({ organizationId, id: billDraft.id, expectedVersion: billDraft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    await vendorBills.approve({ organizationId, id: billSubmitted.id, expectedVersion: billSubmitted.version, note: undefined, idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });

    // A second vendor bill left SUBMITTED (not FINALIZED) — must be excluded.
    const pendingBillDraft = await vendorBills.createDraft({
      organizationId, projectId, vendorId, priority: undefined, gstRegistrationId, vendorBillNumber: 'PFIN-BILL-2',
      vendorBillDate: '2026-03-12',
      lines: [{ description: 'Not yet finalized', expenseCategoryId: hardwareCategoryId, inventoryItemId: undefined, unitOfMeasureId: qtyUnit.id, hsnSac: '8471', quantity: '1', unitPrice: '9999', gstRatePercent: '9', itcEligible: true }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    await vendorBills.submit({ organizationId, id: pendingBillDraft.id, expectedVersion: pendingBillDraft.version, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });

    // --- Employee claims: one APPROVED with GST credit (20,000 - 3,000 = 17,000 recognized),
    //     one REIMBURSED with no GST (10,000 recognized), one left DRAFT (excluded). ---
    await makeClaimApprover(prisma, organizationId, actorId);
    const claim1Draft = await employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId, expenseCategoryId: travelCategoryId, title: 'Site visit',
      projectId, legalEntityId: undefined, amount: '20000', expenseDate: '2026-03-11', gstInvoiceAvailable: true,
      gstCreditAmount: '3000', note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });
    const claim1Submitted = await employeeExpenses.submitClaim({ organizationId, id: claim1Draft.id, expectedVersion: claim1Draft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
    await employeeExpenses.approveClaim({ organizationId, id: claim1Submitted.id, expectedVersion: claim1Submitted.version, note: undefined, idempotencyKey: generateId(), actorId, hasSelfApprovePermission: false, correlationId: generateId() });

    const claim2Draft = await employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId, expenseCategoryId: travelCategoryId, title: 'Client meeting travel',
      projectId, legalEntityId: undefined, amount: '10000', expenseDate: '2026-03-13', gstInvoiceAvailable: false,
      gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });
    const claim2Submitted = await employeeExpenses.submitClaim({ organizationId, id: claim2Draft.id, expectedVersion: claim2Draft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
    const claim2Approved = await employeeExpenses.approveClaim({ organizationId, id: claim2Submitted.id, expectedVersion: claim2Submitted.version, note: undefined, idempotencyKey: generateId(), actorId, hasSelfApprovePermission: false, correlationId: generateId() });
    await employeeExpenses.reimburseClaim({ organizationId, id: claim2Approved.id, expectedVersion: claim2Approved.version, bankAccountId, reimbursementDate: '2026-03-14', idempotencyKey: generateId(), actorId, correlationId: generateId() });

    await employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId, expenseCategoryId: travelCategoryId, title: 'Still a draft',
      projectId, legalEntityId: undefined, amount: '999', expenseDate: '2026-03-15', gstInvoiceAvailable: false,
      gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });

    // --- Direct Expense: one ITC-eligible (8,000@18%->9,440, recognized 8,000), one ITC-ineligible
    //     (4,000@18%->4,720, recognized 4,720), one company-overhead (no projectId, excluded), one DRAFT (excluded). ---
    const de1Draft = await directExpenses.createDraft({
      organizationId, expenseCategoryId: hardwareCategoryId, vendorId: undefined, title: 'Cables', projectId,
      legalEntityId: undefined, taxableAmount: '8000', expenseDate: '2026-03-16', gstInvoiceAvailable: true,
      gstRatePercent: '9', supplyType: 'INTRASTATE', itcEligible: true, tdsAmount: undefined, tdsRatePercent: undefined,
      paymentModeId: bankTransferModeId, bankAccountId, cardAccountId: undefined, transactionReference: undefined,
      purchasedByEmployeeId: undefined, note: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    await directExpenses.post({ organizationId, id: de1Draft.id, expectedVersion: de1Draft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    const de2Draft = await directExpenses.createDraft({
      organizationId, expenseCategoryId: hardwareCategoryId, vendorId: undefined, title: 'Ineligible hardware', projectId,
      legalEntityId: undefined, taxableAmount: '4000', expenseDate: '2026-03-17', gstInvoiceAvailable: true,
      gstRatePercent: '9', supplyType: 'INTRASTATE', itcEligible: false, tdsAmount: undefined, tdsRatePercent: undefined,
      paymentModeId: bankTransferModeId, bankAccountId, cardAccountId: undefined, transactionReference: undefined,
      purchasedByEmployeeId: undefined, note: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    await directExpenses.post({ organizationId, id: de2Draft.id, expectedVersion: de2Draft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    const overheadDraft = await directExpenses.createDraft({
      organizationId, expenseCategoryId: hardwareCategoryId, vendorId: undefined, title: 'Office overhead', projectId: undefined,
      legalEntityId, taxableAmount: '15000', expenseDate: '2026-03-18', gstInvoiceAvailable: false,
      gstRatePercent: undefined, supplyType: undefined, itcEligible: undefined, tdsAmount: undefined, tdsRatePercent: undefined,
      paymentModeId: bankTransferModeId, bankAccountId, cardAccountId: undefined, transactionReference: undefined,
      purchasedByEmployeeId: undefined, note: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    await directExpenses.post({ organizationId, id: overheadDraft.id, expectedVersion: overheadDraft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    await directExpenses.createDraft({
      organizationId, expenseCategoryId: hardwareCategoryId, vendorId: undefined, title: 'Still a draft direct expense', projectId,
      legalEntityId: undefined, taxableAmount: '444', expenseDate: '2026-03-19', gstInvoiceAvailable: false,
      gstRatePercent: undefined, supplyType: undefined, itcEligible: undefined, tdsAmount: undefined, tdsRatePercent: undefined,
      paymentModeId: bankTransferModeId, bankAccountId, cardAccountId: undefined, transactionReference: undefined,
      purchasedByEmployeeId: undefined, note: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    // --- Phase 7 cost streams (ADR-097), inserted directly: this is a read
    // test and neither consumption nor accrual carries an FK to JournalEntry.
    const unit = await prisma.client.unitOfMeasure.create({
      data: { id: generateId(), organizationId, code: 'nos', name: 'Nos' },
    });
    const item = await prisma.client.inventoryItem.create({
      data: { id: generateId(), organizationId, code: 'ITEM-PFIN-1', name: 'Cat6 Cable', unitOfMeasureId: unit.id },
    });
    const consumption = await prisma.client.inventoryConsumption.create({
      data: {
        id: generateId(), organizationId, legalEntityId, consumptionNumber: 'CONS-PFIN-1', projectId,
        consumedDate: new Date('2026-03-20T00:00:00.000Z'), status: 'POSTED',
        totalValueAmount: new Prisma.Decimal('7000'), journalEntryId: generateId(),
      },
    });
    await prisma.client.inventoryConsumptionLine.create({
      data: {
        id: generateId(), organizationId, inventoryConsumptionId: consumption.id, inventoryItemId: item.id,
        sequence: 1, quantity: new Prisma.Decimal(1), unitCostAmount: new Prisma.Decimal('7000'),
        lineValueAmount: new Prisma.Decimal('7000'),
      },
    });

    const introducer = await prisma.client.introducer.create({
      data: { id: generateId(), organizationId, name: 'PFin Introducer' },
    });
    const agreement = await prisma.client.introducerAgreement.create({
      data: {
        id: generateId(), organizationId, introducerId: introducer.id, projectId, legalEntityId,
        basisType: 'FIXED_AMOUNT', fixedAmount: new Prisma.Decimal('6000'),
        agreementDate: new Date('2026-03-01T00:00:00.000Z'),
      },
    });
    await prisma.client.introducerAccrual.create({
      data: {
        id: generateId(), organizationId, introducerAgreementId: agreement.id, accrualNumber: 'INTA-PFIN-1',
        accrualDate: new Date('2026-03-21T00:00:00.000Z'), amount: new Prisma.Decimal('4000'),
        status: 'POSTED', journalEntryId: generateId(),
      },
    });

    const pfinEmployee = await prisma.client.employee.create({
      data: {
        id: generateId(), organizationId, employeeCode: 'PFIN-001', fullName: 'PFin Employee',
        joiningDate: new Date('2025-01-01T00:00:00.000Z'),
      },
    });
    const batch = await prisma.client.salaryImport.create({
      data: {
        id: generateId(), organizationId, legalEntityId,
        salaryMonth: new Date('2026-03-01T00:00:00.000Z'), accountingDate: new Date('2026-03-31T00:00:00.000Z'),
        employeeCount: 1, totalGrossAmount: new Prisma.Decimal('80000'), status: 'POSTED', journalEntryId: generateId(),
      },
    });
    await prisma.client.salaryImportLine.create({
      data: {
        id: generateId(), organizationId, salaryImportId: batch.id, employeeId: pfinEmployee.id,
        employeeCodeRaw: 'PFIN-001', grossSalaryAmount: new Prisma.Decimal('80000'),
      },
    });
    const benchTarget = await prisma.client.allocationTarget.create({
      data: { id: generateId(), organizationId, code: 'bench', name: 'Bench' },
    });
    const monthlyAllocation = await prisma.client.employeeMonthlyAllocation.create({
      data: {
        id: generateId(), organizationId, employeeId: pfinEmployee.id,
        allocationMonth: new Date('2026-03-01T00:00:00.000Z'), status: 'SUBMITTED', submittedAt: new Date(),
      },
    });
    await prisma.client.employeeAllocationLine.createMany({
      data: [
        { id: generateId(), organizationId, employeeMonthlyAllocationId: monthlyAllocation.id, projectId, sequence: 1, percentage: new Prisma.Decimal('25') },
        { id: generateId(), organizationId, employeeMonthlyAllocationId: monthlyAllocation.id, allocationTargetId: benchTarget.id, sequence: 2, percentage: new Prisma.Decimal('75') },
      ],
    });
  });

  afterAll(async () => {
    await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
    await prisma.client.idempotencyKey.deleteMany({ where: { organizationId } });
    await prisma.client.inventoryConsumptionLine.deleteMany({ where: { organizationId } });
    await prisma.client.inventoryConsumption.deleteMany({ where: { organizationId } });
    await prisma.client.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.client.introducerAccrual.deleteMany({ where: { organizationId } });
    await prisma.client.introducerAgreement.deleteMany({ where: { organizationId } });
    await prisma.client.introducer.deleteMany({ where: { organizationId } });
    await prisma.client.employeeAllocationLine.deleteMany({ where: { organizationId } });
    await prisma.client.employeeMonthlyAllocation.deleteMany({ where: { organizationId } });
    await prisma.client.allocationTarget.deleteMany({ where: { organizationId } });
    await prisma.client.salaryImportLine.deleteMany({ where: { organizationId } });
    await prisma.client.salaryImport.deleteMany({ where: { organizationId } });
    await prisma.client.deductionRelease.deleteMany({ where: { deduction: { allocation: { receipt: { organizationId } } } } });
    await prisma.client.allocationDeduction.deleteMany({ where: { allocation: { receipt: { organizationId } } } });
    await prisma.client.receiptAllocation.deleteMany({ where: { receipt: { organizationId } } });
    await prisma.client.clientReceipt.deleteMany({ where: { organizationId } });
    await prisma.client.creditDebitNoteLine.deleteMany({ where: { creditDebitNote: { organizationId } } });
    await prisma.client.creditDebitNote.deleteMany({ where: { organizationId } });
    await prisma.client.employeeExpenseClaimDecision.deleteMany({ where: { organizationId } });
    await prisma.client.employeeExpenseClaim.deleteMany({ where: { organizationId } });
    await prisma.client.directExpense.deleteMany({ where: { organizationId } });
    await prisma.client.vendorBillDecision.deleteMany({ where: { organizationId } });
    await prisma.client.vendorBillLine.deleteMany({ where: { vendorBill: { organizationId } } });
    await prisma.client.vendorBill.deleteMany({ where: { organizationId } });
    await prisma.client.invoiceLine.deleteMany({ where: { invoice: { organizationId } } });
    await prisma.client.invoice.deleteMany({ where: { organizationId } });
    await prisma.client.paymentAlert.deleteMany({ where: { organizationId } });
    await prisma.client.milestoneEvent.deleteMany({ where: { milestone: { organizationId } } });
    await prisma.client.projectMilestone.deleteMany({ where: { organizationId } });
    await prisma.client.expenseCategory.deleteMany({ where: { organizationId } });
    await prisma.client.unitOfMeasure.deleteMany({ where: { organizationId } });
    await prisma.client.journalLine.deleteMany({ where: { organizationId } });
    await prisma.client.journalEntry.deleteMany({ where: { organizationId } });
    await prisma.client.bankAccount.deleteMany({ where: { organizationId } });
    await prisma.client.penaltyCategory.deleteMany({ where: { organizationId } });
    await prisma.client.ledgerAccount.deleteMany({ where: { organizationId } });
    await prisma.client.accountGroup.deleteMany({ where: { organizationId } });
    await prisma.client.employee.deleteMany({ where: { organizationId } });
    await removeClaimApprovers(prisma, [organizationId]);
    await prisma.client.user.deleteMany({ where: { organizationId } });
    await prisma.client.projectTeamMember.deleteMany({ where: { organizationId } });
    await prisma.client.project.deleteMany({ where: { organizationId } });
    await prisma.client.vendorProfile.deleteMany({ where: { organizationId } });
    await prisma.client.accountingPeriod.deleteMany({ where: { organizationId } });
    await prisma.client.financialYear.deleteMany({ where: { organizationId } });
    await prisma.client.gstRegistration.deleteMany({ where: { organizationId } });
    await prisma.client.contact.deleteMany({ where: { organizationId } });
    await prisma.client.clientProfile.deleteMany({ where: { organizationId } });
    await prisma.client.party.deleteMany({ where: { organizationId } });
    await prisma.client.legalEntity.deleteMany({ where: { organizationId } });
    await prisma.client.organization.deleteMany({ where: { id: organizationId } });
    await prisma.client.$disconnect();
  });

  it('computes every billing, collection, receivable and recognized-expense figure exactly', async () => {
    const summary = await financials.getFinancialSummary({ organizationId, projectId, actorId, canSeeAll: true });

    expect(summary.projectId).toBe(projectId);
    expect(summary.contractValueExclGst).toBe('5000000.00');

    // Billing: 1,180,000 (invoice 1) + 236,000 (invoice 2, reversed receipt but FINALIZED) + 106,200 (invoice 3, VOID excluded)
    // -> only invoice 1 and invoice 2 count (invoice 3 is VOID).
    expect(summary.grossInvoiceValue).toBe('1416000.00');
    expect(summary.debitNoteAdjustments).toBe('59000.00');
    expect(summary.creditNoteAdjustments).toBe('35400.00');
    expect(summary.netBilled).toBe('1439600.00'); // 1,416,000 + 59,000 - 35,400

    // Collections: only the non-reversed receipt on invoice 1 counts. The reversed receipt on invoice 2
    // (100,000 cash, no deductions) must be fully excluded.
    expect(summary.cashReceived).toBe('500000.00');
    expect(summary.tdsDeducted).toBe('10000.00');
    expect(summary.gstTdsDeducted).toBe('5000.00'); // 2,000 + 2,000 + 1,000
    expect(summary.retentionHeld).toBe('40000.00');
    expect(summary.otherHoldAmount).toBe('50000.00');
    expect(summary.penaltyOrWriteOff).toBe('23000.00'); // 15,000 + 8,000
    expect(summary.otherDeductions).toBe('5000.00');
    expect(summary.totalSettled).toBe('633000.00');

    // Receivable
    expect(summary.invoiceOutstanding).toBe('806600.00'); // 1,439,600 - 633,000
    expect(summary.unreleasedRetentionAndHold).toBe('55000.00'); // (50,000-20,000) + (40,000-15,000)
    expect(summary.clientReceivable).toBe('861600.00'); // 806,600 + 55,000

    // Recognized expense — excludes eligible Input GST, includes ineligible GST, ignores overhead/drafts.
    expect(summary.purchaseExpense).toBe('159000.00'); // (118,000-18,000) + (59,000-0)
    expect(summary.employeeClaimExpense).toBe('27000.00'); // (20,000-3,000) + (10,000-0)
    expect(summary.directExpense).toBe('12720.00'); // (9,440-1,440) + (4,720-0)
    // Phase 7 streams (ADR-097). All three enter at face value: material is
    // already net of recoverable ITC, manpower and commission carry no GST.
    expect(summary.materialExpense).toBe('7000.00');
    expect(summary.manpowerExpense).toBe('20000.00'); // 25% of an 80,000 gross
    expect(summary.introducerExpense).toBe('4000.00');
    expect(summary.recognizedProjectExpense).toBe('229720.00'); // 198,720 + 31,000
  });

  it('excludes a company-overhead direct expense (no projectId) and drafts from every figure', async () => {
    const summary = await financials.getFinancialSummary({ organizationId, projectId, actorId, canSeeAll: true });
    // 15,000 overhead direct expense and 444 draft direct expense are both excluded — already asserted via the
    // exact directExpense total above (12,720.00), which would be 27,720.00 or 13,164.00 if either leaked in.
    expect(summary.directExpense).toBe('12720.00');
  });

  it('returns a zeroed summary for a project with no financial activity at all', async () => {
    const summary = await financials.getFinancialSummary({ organizationId, projectId: otherProjectId, actorId, canSeeAll: true });
    expect(summary.contractValueExclGst).toBe('1000000.00');
    expect(summary.grossInvoiceValue).toBe('0.00');
    expect(summary.netBilled).toBe('0.00');
    expect(summary.totalSettled).toBe('0.00');
    expect(summary.invoiceOutstanding).toBe('0.00');
    expect(summary.clientReceivable).toBe('0.00');
    expect(summary.recognizedProjectExpense).toBe('0.00');
  });

  it('denies a single-project summary for an actor who cannot see the project at all', async () => {
    const outsiderActorId = generateId();
    await expect(
      financials.getFinancialSummary({ organizationId, projectId, actorId: outsiderActorId, canSeeAll: false }),
    ).rejects.toThrow('not found');
  });

  it('listFinancialSummaries returns one row per authorized project and silently drops unauthorized/nonexistent ids', async () => {
    const rows = await financials.listFinancialSummaries({
      organizationId, actorId, canSeeAll: true, projectIds: [projectId, otherProjectId, generateId()],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.projectId).sort()).toEqual([otherProjectId, projectId].sort());
  });

  it('scopes listFinancialSummaries to only the projects an unscoped-false actor is assigned to', async () => {
    const pmUser = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: `pfin-pm-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: 'PFIN PM', status: 'ACTIVE' } });
    const pmEmployee = await prisma.client.employee.create({
      data: { id: generateId(), organizationId, userId: pmUser.id, employeeCode: 'EMP-PFIN-PM', fullName: 'PM Person', joiningDate: new Date('2024-01-01'), isReimbursable: false },
    });
    await prisma.client.project.update({ where: { id: projectId }, data: { projectManagerId: pmEmployee.id } });

    const rows = await financials.listFinancialSummaries({
      organizationId, actorId: pmUser.id, canSeeAll: false, projectIds: [projectId, otherProjectId],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.projectId).toBe(projectId);

    // Revert so it doesn't affect any other test in this file.
    await prisma.client.project.update({ where: { id: projectId }, data: { projectManagerId: null } });
    await prisma.client.employee.delete({ where: { id: pmEmployee.id } });
    await prisma.client.user.delete({ where: { id: pmUser.id } });
  });

  it('returns nothing for listFinancialSummaries when the actor has no assigned projects and is not unscoped', async () => {
    const outsiderActorId = generateId();
    const rows = await financials.listFinancialSummaries({ organizationId, actorId: outsiderActorId, canSeeAll: false, projectIds: [projectId, otherProjectId] });
    expect(rows).toEqual([]);
  });

  it('getClientFinancialSummary sums to exactly the single non-zero project (the other project contributes zero)', async () => {
    const projectSummary = await financials.getFinancialSummary({ organizationId, projectId, actorId, canSeeAll: true });
    const clientSummary = await financials.getClientFinancialSummary({ organizationId, clientId, actorId, canSeeAll: true });

    expect(clientSummary.clientId).toBe(clientId);
    expect(clientSummary.projectCount).toBe(2);
    expect(clientSummary.totalContractValueExclGst).toBe('6000000.00'); // 5,000,000 (projectId) + 1,000,000 (otherProjectId)
    expect(clientSummary.grossInvoiceValue).toBe(projectSummary.grossInvoiceValue);
    expect(clientSummary.netBilled).toBe(projectSummary.netBilled);
    expect(clientSummary.totalSettled).toBe(projectSummary.totalSettled);
    expect(clientSummary.invoiceOutstanding).toBe(projectSummary.invoiceOutstanding);
    expect(clientSummary.clientReceivable).toBe(projectSummary.clientReceivable);
    expect(clientSummary.recognizedProjectExpense).toBe(projectSummary.recognizedProjectExpense);
  });

  it('excludes a project the actor cannot see from the client rollup entirely', async () => {
    const pmUser = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: `pfin-client-pm-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: 'PFIN Client PM', status: 'ACTIVE' } });
    const pmEmployee = await prisma.client.employee.create({
      data: { id: generateId(), organizationId, userId: pmUser.id, employeeCode: 'EMP-PFIN-CLIENT-PM', fullName: 'Client PM Person', joiningDate: new Date('2024-01-01'), isReimbursable: false },
    });
    // Assigned only to the zero-activity project — the rich, nonzero
    // `projectId` data must be fully excluded from this actor's view of
    // the client, even though the client itself has real financial
    // activity under `canSeeAll: true` (proven by the test above).
    await prisma.client.project.update({ where: { id: otherProjectId }, data: { projectManagerId: pmEmployee.id } });

    const clientSummary = await financials.getClientFinancialSummary({ organizationId, clientId, actorId: pmUser.id, canSeeAll: false });
    expect(clientSummary.projectCount).toBe(1);
    expect(clientSummary.grossInvoiceValue).toBe('0.00');
    expect(clientSummary.netBilled).toBe('0.00');
    expect(clientSummary.clientReceivable).toBe('0.00');
    expect(clientSummary.recognizedProjectExpense).toBe('0.00');

    await prisma.client.project.update({ where: { id: otherProjectId }, data: { projectManagerId: null } });
    await prisma.client.employee.delete({ where: { id: pmEmployee.id } });
    await prisma.client.user.delete({ where: { id: pmUser.id } });
  });

  it('returns an all-zero summary with projectCount 0 for a scoped actor assigned to none of the client\'s projects', async () => {
    const outsiderActorId = generateId();
    const clientSummary = await financials.getClientFinancialSummary({ organizationId, clientId, actorId: outsiderActorId, canSeeAll: false });
    expect(clientSummary.projectCount).toBe(0);
    expect(clientSummary.totalContractValueExclGst).toBe('0.00');
    expect(clientSummary.clientReceivable).toBe('0.00');
  });

  it('throws NOT_FOUND for a client belonging to a different organization', async () => {
    const otherOrg = await prisma.client.organization.create({
      data: { id: generateId(), name: 'PFIN Other Org', code: `PFIN-OTHER-${generateId()}` },
    });
    const otherOrgClient = await clients.create({
      organizationId: otherOrg.id, name: 'PFIN Other Org Client', shortCode: undefined, clientTypeId: undefined,
      department: 'IT', stateId: undefined, districtId: undefined, cityId: undefined, pinCode: undefined,
      officeAddress: undefined, gstin: undefined, internalNote: undefined, contacts: [], actorId, correlationId: generateId(),
    });

    await expect(
      financials.getClientFinancialSummary({ organizationId, clientId: otherOrgClient.id, actorId, canSeeAll: true }),
    ).rejects.toThrow('not found');

    await prisma.client.clientProfile.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.client.party.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.client.organization.delete({ where: { id: otherOrg.id } });
  });
});
