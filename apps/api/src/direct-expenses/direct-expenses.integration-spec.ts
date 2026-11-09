import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { DirectExpensesService } from './direct-expenses.service';

const prisma = new PrismaService();
const clients = new ClientsService(prisma);
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const directExpenses = new DirectExpensesService(prisma, posting);

let organizationId: string;
let otherOrganizationId: string;
let legalEntityId: string;
let expenseCategoryId: string;
let inactiveCategoryId: string;
let bankAccountId: string;
let inactiveBankAccountId: string;
let vendorId: string;
let inactiveVendorId: string;
let employeeId: string;
let inactiveEmployeeId: string;
let bankTransferModeId: string;
let debitCardModeId: string;
let creditCardModeId: string;
let debitCardAccountId: string;
let creditCardAccountId: string;
let inactiveCardAccountId: string;
const creatorActorId = generateId();
const otherActorId = generateId();

function basicInput(overrides: {
  title?: string;
  taxableAmount?: string;
  expenseDate?: string;
  gstInvoiceAvailable?: boolean;
  gstRatePercent?: string;
  supplyType?: 'INTRASTATE' | 'INTERSTATE';
  itcEligible?: boolean;
  tdsAmount?: string;
  tdsRatePercent?: string;
  expenseCategoryId?: string;
  vendorId?: string;
  bankAccountId?: string;
  cardAccountId?: string | undefined;
  paymentModeId?: string;
  purchasedByEmployeeId?: string;
  actorId?: string;
} = {}) {
  const usingCard = !!overrides.cardAccountId;
  return {
    organizationId,
    expenseCategoryId: overrides.expenseCategoryId ?? expenseCategoryId,
    vendorId: overrides.vendorId,
    title: overrides.title ?? 'Fuel and toll charges',
    projectId: undefined,
    legalEntityId,
    taxableAmount: overrides.taxableAmount ?? '2000',
    expenseDate: overrides.expenseDate ?? '2026-06-01',
    gstInvoiceAvailable: overrides.gstInvoiceAvailable ?? false,
    gstRatePercent: overrides.gstRatePercent,
    supplyType: overrides.supplyType,
    itcEligible: overrides.itcEligible,
    tdsAmount: overrides.tdsAmount,
    tdsRatePercent: overrides.tdsRatePercent,
    paymentModeId: overrides.paymentModeId ?? bankTransferModeId,
    bankAccountId: usingCard ? undefined : (overrides.bankAccountId ?? bankAccountId),
    cardAccountId: overrides.cardAccountId,
    transactionReference: undefined,
    purchasedByEmployeeId: overrides.purchasedByEmployeeId,
    note: undefined,
    idempotencyKey: generateId(),
    actorId: overrides.actorId ?? creatorActorId,
    correlationId: generateId(),
  };
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({ data: { id: generateId(), name: 'Direct Expenses Test Org', code: `DETEST-${generateId()}` } });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({ data: { id: generateId(), name: 'Direct Expenses Test Other Org', code: `DETEST-OTHER-${generateId()}` } });
  otherOrganizationId = otherOrg.id;

  const client = await clients.create({
    organizationId, name: 'DE Test Client', shortCode: undefined, clientTypeId: undefined, department: 'IT', stateId: undefined, districtId: undefined, cityId: undefined,
    pinCode: undefined, officeAddress: undefined, gstin: undefined, internalNote: undefined, contacts: [], actorId: creatorActorId, correlationId: generateId(),
  });
  void client;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'DE Test Legal Entity', panNumber: 'ABCDE1234P', registeredAddress: 'Gandhinagar, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  await financialYears.create({ organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31', setCurrent: true, actorId: creatorActorId, correlationId: generateId() });

  const assetGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'DE_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true } });
  const expenseGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'DE_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true } });
  const liabilityGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'DE_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true } });

  const ledgerCodes: Array<{ code: string; groupId: string; name: string }> = [
    { code: 'INPUT_CGST_RECEIVABLE', groupId: assetGroup.id, name: 'Input CGST Receivable' },
    { code: 'INPUT_SGST_RECEIVABLE', groupId: assetGroup.id, name: 'Input SGST Receivable' },
    { code: 'INPUT_IGST_RECEIVABLE', groupId: assetGroup.id, name: 'Input IGST Receivable' },
    { code: 'TDS_PAYABLE', groupId: liabilityGroup.id, name: 'TDS Payable' },
    { code: 'TRAVEL_EXPENSE', groupId: expenseGroup.id, name: 'Travel Expense' },
    { code: 'OTHER_EXPENSES', groupId: expenseGroup.id, name: 'Other Expenses' },
    { code: 'HDFC_CURRENT_ACCOUNT', groupId: assetGroup.id, name: 'HDFC Current Account' },
    { code: 'ICICI_CURRENT_ACCOUNT', groupId: assetGroup.id, name: 'ICICI Current Account (other legal entity)' },
    { code: 'CREDIT_CARD_PAYABLE', groupId: liabilityGroup.id, name: 'Credit Card Payable' },
  ];
  const createdLedgerAccounts = new Map<string, string>();
  for (const l of ledgerCodes) {
    const row = await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: l.groupId, code: l.code, name: l.name, allowManualPosting: true, isActive: true } });
    createdLedgerAccounts.set(l.code, row.id);
  }

  const expenseCategory = await prisma.client.expenseCategory.create({
    data: { id: generateId(), organizationId, code: 'DE-TRAVEL', name: 'Travel', ledgerAccountId: createdLedgerAccounts.get('TRAVEL_EXPENSE')! },
  });
  expenseCategoryId = expenseCategory.id;

  const inactiveCategory = await prisma.client.expenseCategory.create({
    data: { id: generateId(), organizationId, code: 'DE-INACTIVE', name: 'Inactive Category', isActive: false },
  });
  inactiveCategoryId = inactiveCategory.id;

  const bankAccount = await legalEntities.createBankAccount({
    organizationId, legalEntityId, ledgerAccountId: createdLedgerAccounts.get('HDFC_CURRENT_ACCOUNT')!,
    accountName: 'DE HDFC Operating Account', bankName: 'HDFC Bank', maskedAccountNumber: '****5511', ifsc: 'HDFC0000789',
    actorId: creatorActorId, correlationId: generateId(),
  });
  bankAccountId = bankAccount.id;

  const inactiveBankAccount = await legalEntities.createBankAccount({
    organizationId, legalEntityId, ledgerAccountId: createdLedgerAccounts.get('ICICI_CURRENT_ACCOUNT')!,
    accountName: 'DE Inactive Account', bankName: 'ICICI Bank', maskedAccountNumber: '****7722', ifsc: 'ICIC0000456',
    actorId: creatorActorId, correlationId: generateId(),
  });
  inactiveBankAccountId = inactiveBankAccount.id;
  await legalEntities.setBankAccountActive({ organizationId, id: inactiveBankAccountId, isActive: false, expectedVersion: inactiveBankAccount.version, actorId: creatorActorId, correlationId: generateId() });

  const debitCard = await legalEntities.createCardAccount({
    organizationId, legalEntityId, type: 'DEBIT_CARD', displayName: 'DE Debit Card', issuerName: 'HDFC Bank', maskedLastFour: '4521',
    cardholderEmployeeId: undefined, bankAccountId, ledgerAccountId: undefined, statementDay: undefined, paymentDueDay: undefined,
    actorId: creatorActorId, correlationId: generateId(),
  });
  debitCardAccountId = debitCard.id;

  const creditCard = await legalEntities.createCardAccount({
    organizationId, legalEntityId, type: 'CREDIT_CARD', displayName: 'DE Credit Card', issuerName: 'ICICI Bank', maskedLastFour: '9911',
    cardholderEmployeeId: undefined, bankAccountId: undefined, ledgerAccountId: createdLedgerAccounts.get('CREDIT_CARD_PAYABLE')!, statementDay: 5, paymentDueDay: 20,
    actorId: creatorActorId, correlationId: generateId(),
  });
  creditCardAccountId = creditCard.id;

  const inactiveCard = await legalEntities.createCardAccount({
    organizationId, legalEntityId, type: 'DEBIT_CARD', displayName: 'DE Inactive Card', issuerName: undefined, maskedLastFour: '0000',
    cardholderEmployeeId: undefined, bankAccountId, ledgerAccountId: undefined, statementDay: undefined, paymentDueDay: undefined,
    actorId: creatorActorId, correlationId: generateId(),
  });
  inactiveCardAccountId = inactiveCard.id;
  await legalEntities.setCardAccountActive({ organizationId, id: inactiveCardAccountId, isActive: false, expectedVersion: inactiveCard.version, actorId: creatorActorId, correlationId: generateId() });

  const vendorParty = await prisma.client.party.create({ data: { id: generateId(), organizationId, name: 'DE Test Vendor' } });
  await prisma.client.vendorProfile.create({ data: { id: generateId(), organizationId, partyId: vendorParty.id } });
  vendorId = vendorParty.id;

  const inactiveVendorParty = await prisma.client.party.create({ data: { id: generateId(), organizationId, name: 'DE Inactive Vendor', isActive: false } });
  await prisma.client.vendorProfile.create({ data: { id: generateId(), organizationId, partyId: inactiveVendorParty.id } });
  inactiveVendorId = inactiveVendorParty.id;

  const employee = await prisma.client.employee.create({
    data: { id: generateId(), organizationId, employeeCode: 'DE-EMP-1', fullName: 'DE Test Employee', joiningDate: new Date('2026-01-01') },
  });
  employeeId = employee.id;

  const inactiveEmployee = await prisma.client.employee.create({
    data: { id: generateId(), organizationId, employeeCode: 'DE-EMP-2', fullName: 'DE Inactive Employee', joiningDate: new Date('2026-01-01'), status: 'INACTIVE' },
  });
  inactiveEmployeeId = inactiveEmployee.id;

  bankTransferModeId = (await prisma.client.paymentMode.findFirstOrThrow({ where: { code: 'BANK_TRANSFER' } })).id;
  debitCardModeId = (await prisma.client.paymentMode.findFirstOrThrow({ where: { code: 'DEBIT_CARD' } })).id;
  creditCardModeId = (await prisma.client.paymentMode.findFirstOrThrow({ where: { code: 'CREDIT_CARD' } })).id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.directExpense.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.expenseCategory.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.cardAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.bankAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.projectTeamMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employee.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.vendorProfile.deleteMany({ where: { party: { organizationId: { in: orgIds } } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('DirectExpensesService — draft lifecycle', () => {
  it('creates a draft, updates it, and cancels it with a mandatory reason', async () => {
    const draft = await directExpenses.createDraft(basicInput({ title: 'Site visit fuel' }));
    expect(draft.status).toBe('DRAFT');
    expect(draft.title).toBe('Site visit fuel');
    expect(draft.amount).toBe('2000.00');

    const updated = await directExpenses.updateDraft({
      organizationId, id: draft.id, expectedVersion: draft.version, title: 'Site visit fuel — updated', taxableAmount: '2500', actorId: creatorActorId, correlationId: generateId(),
    });
    expect(updated.title).toBe('Site visit fuel — updated');
    expect(updated.amount).toBe('2500.00');

    await expect(
      directExpenses.cancelDraft({ organizationId, id: updated.id, expectedVersion: updated.version, reason: '  ', idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() }),
    ).rejects.toThrow('reason is required');

    const cancelled = await directExpenses.cancelDraft({ organizationId, id: updated.id, expectedVersion: updated.version, reason: 'No longer needed', idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('rejects a non-creator from updating or cancelling someone else\'s draft', async () => {
    const draft = await directExpenses.createDraft(basicInput({ title: 'Ownership test' }));

    await expect(
      directExpenses.updateDraft({ organizationId, id: draft.id, expectedVersion: draft.version, title: 'Hijacked', actorId: otherActorId, correlationId: generateId() }),
    ).rejects.toThrow('you created yourself');

    await expect(
      directExpenses.cancelDraft({ organizationId, id: draft.id, expectedVersion: draft.version, reason: 'Not mine', idempotencyKey: generateId(), actorId: otherActorId, correlationId: generateId() }),
    ).rejects.toThrow('you created yourself');
  });

  it('rejects invalid GST combinations', async () => {
    await expect(directExpenses.createDraft(basicInput({ taxableAmount: '1000', gstInvoiceAvailable: true }))).rejects.toThrow('GST rate is required');
    await expect(directExpenses.createDraft(basicInput({ taxableAmount: '1000', gstInvoiceAvailable: true, gstRatePercent: '9' }))).rejects.toThrow('Supply type is required');
    await expect(directExpenses.createDraft(basicInput({ taxableAmount: '1000', gstInvoiceAvailable: false, gstRatePercent: '9', supplyType: 'INTRASTATE' }))).rejects.toThrow('must not be set without a GST invoice');
  });

  it('rejects invalid TDS amounts', async () => {
    await expect(directExpenses.createDraft(basicInput({ taxableAmount: '1000', tdsAmount: '-10' }))).rejects.toThrow('must not be negative');
    await expect(directExpenses.createDraft(basicInput({ taxableAmount: '1000', tdsAmount: '5000' }))).rejects.toThrow('cannot exceed the expense amount');
  });

  it('rejects an inactive expense category and an inactive bank account', async () => {
    await expect(directExpenses.createDraft(basicInput({ expenseCategoryId: inactiveCategoryId }))).rejects.toThrow('is inactive');
    await expect(directExpenses.createDraft(basicInput({ bankAccountId: inactiveBankAccountId }))).rejects.toThrow('is inactive');
  });

  it('accepts an optional vendor link, and rejects an inactive vendor', async () => {
    const draft = await directExpenses.createDraft(basicInput({ vendorId }));
    expect(draft.vendorId).toBe(vendorId);

    await expect(directExpenses.createDraft(basicInput({ vendorId: inactiveVendorId }))).rejects.toThrow('is inactive');
  });

  it('accepts an optional purchaser link, and rejects an inactive employee', async () => {
    const draft = await directExpenses.createDraft(basicInput({ purchasedByEmployeeId: employeeId }));
    expect(draft.purchasedByEmployeeId).toBe(employeeId);

    await expect(directExpenses.createDraft(basicInput({ purchasedByEmployeeId: inactiveEmployeeId }))).rejects.toThrow('is not active');
  });

  it('rejects a card attached to a payment mode that does not require one, and a missing card when one is required', async () => {
    await expect(directExpenses.createDraft(basicInput({ paymentModeId: bankTransferModeId, cardAccountId: debitCardAccountId }))).rejects.toThrow('cannot be attached');
    await expect(directExpenses.createDraft(basicInput({ paymentModeId: debitCardModeId, cardAccountId: undefined }))).rejects.toThrow('A card is required');
    await expect(directExpenses.createDraft(basicInput({ paymentModeId: debitCardModeId, cardAccountId: creditCardAccountId }))).rejects.toThrow('does not match the selected payment mode');
  });

  it('rejects an inactive card account', async () => {
    await expect(directExpenses.createDraft(basicInput({ paymentModeId: debitCardModeId, cardAccountId: inactiveCardAccountId }))).rejects.toThrow('is inactive');
  });
});

describe('DirectExpensesService — post (journal shape)', () => {
  it('posts Dr expense category account / Cr bank account for a plain expense with no GST', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '3000' }));
    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });
    expect(posted.status).toBe('POSTED');
    expect(posted.journalEntryId).not.toBeNull();

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! }, include: { ledgerAccount: true } });
    expect(lines).toHaveLength(2);
    const expenseLine = lines.find((l) => l.ledgerAccount.code === 'TRAVEL_EXPENSE');
    const bankLine = lines.find((l) => l.ledgerAccount.code === 'HDFC_CURRENT_ACCOUNT');
    expect(expenseLine?.debitAmount.toFixed(2)).toBe('3000.00');
    expect(bankLine?.creditAmount.toFixed(2)).toBe('3000.00');
  });

  it('splits intrastate GST into CGST + SGST lines', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '1000', gstInvoiceAvailable: true, gstRatePercent: '9', supplyType: 'INTRASTATE' }));
    expect(draft.cgstAmount).toBe('90.00');
    expect(draft.sgstAmount).toBe('90.00');
    expect(draft.igstAmount).toBe('0.00');
    expect(draft.amount).toBe('1180.00');

    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });
    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! }, include: { ledgerAccount: true } });
    expect(lines).toHaveLength(4);
    const expenseLine = lines.find((l) => l.ledgerAccount.code === 'TRAVEL_EXPENSE');
    const cgstLine = lines.find((l) => l.ledgerAccount.code === 'INPUT_CGST_RECEIVABLE');
    const sgstLine = lines.find((l) => l.ledgerAccount.code === 'INPUT_SGST_RECEIVABLE');
    const bankLine = lines.find((l) => l.ledgerAccount.code === 'HDFC_CURRENT_ACCOUNT');
    expect(expenseLine?.debitAmount.toFixed(2)).toBe('1000.00');
    expect(cgstLine?.debitAmount.toFixed(2)).toBe('90.00');
    expect(sgstLine?.debitAmount.toFixed(2)).toBe('90.00');
    expect(bankLine?.creditAmount.toFixed(2)).toBe('1180.00');
  });

  it('posts interstate GST to a single IGST line', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '1000', gstInvoiceAvailable: true, gstRatePercent: '9', supplyType: 'INTERSTATE' }));
    expect(draft.igstAmount).toBe('180.00');
    expect(draft.cgstAmount).toBe('0.00');

    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });
    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! }, include: { ledgerAccount: true } });
    expect(lines).toHaveLength(3);
    const igstLine = lines.find((l) => l.ledgerAccount.code === 'INPUT_IGST_RECEIVABLE');
    expect(igstLine?.debitAmount.toFixed(2)).toBe('180.00');
  });

  it('folds ITC-ineligible GST into the expense debit instead of an Input GST line', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '1000', gstInvoiceAvailable: true, gstRatePercent: '9', supplyType: 'INTRASTATE', itcEligible: false }));
    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! }, include: { ledgerAccount: true } });
    expect(lines).toHaveLength(2);
    const expenseLine = lines.find((l) => l.ledgerAccount.code === 'TRAVEL_EXPENSE');
    const bankLine = lines.find((l) => l.ledgerAccount.code === 'HDFC_CURRENT_ACCOUNT');
    expect(expenseLine?.debitAmount.toFixed(2)).toBe('1180.00');
    expect(bankLine?.creditAmount.toFixed(2)).toBe('1180.00');
  });

  it('posts TDS to a separate credit line and reduces the bank credit by the same amount', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '1000', tdsAmount: '100', tdsRatePercent: '10' }));
    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! }, include: { ledgerAccount: true } });
    expect(lines).toHaveLength(3);
    const expenseLine = lines.find((l) => l.ledgerAccount.code === 'TRAVEL_EXPENSE');
    const tdsLine = lines.find((l) => l.ledgerAccount.code === 'TDS_PAYABLE');
    const bankLine = lines.find((l) => l.ledgerAccount.code === 'HDFC_CURRENT_ACCOUNT');
    expect(expenseLine?.debitAmount.toFixed(2)).toBe('1000.00');
    expect(tdsLine?.creditAmount.toFixed(2)).toBe('100.00');
    expect(bankLine?.creditAmount.toFixed(2)).toBe('900.00');
  });

  it('posts a Debit Card payment to its linked bank account', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '500', paymentModeId: debitCardModeId, cardAccountId: debitCardAccountId }));
    expect(draft.bankAccountId).toBe(bankAccountId);
    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! }, include: { ledgerAccount: true } });
    const bankLine = lines.find((l) => l.ledgerAccount.code === 'HDFC_CURRENT_ACCOUNT');
    expect(bankLine?.creditAmount.toFixed(2)).toBe('500.00');
  });

  it('posts a Credit Card payment to its own payable ledger, not a bank account', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '700', paymentModeId: creditCardModeId, cardAccountId: creditCardAccountId }));
    expect(draft.bankAccountId).toBeNull();
    expect(draft.cardAccountId).toBe(creditCardAccountId);
    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! }, include: { ledgerAccount: true } });
    expect(lines).toHaveLength(2);
    const payableLine = lines.find((l) => l.ledgerAccount.code === 'CREDIT_CARD_PAYABLE');
    const bankLine = lines.find((l) => l.ledgerAccount.code === 'HDFC_CURRENT_ACCOUNT');
    expect(payableLine?.creditAmount.toFixed(2)).toBe('700.00');
    expect(bankLine).toBeUndefined();
  });

  it('is not creator-restricted — a different actor may post someone else\'s draft', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '500' }));
    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: otherActorId, correlationId: generateId() });
    expect(posted.status).toBe('POSTED');
    expect(posted.postedBy).toBe(otherActorId);
  });

  it('is idempotent on replay with the same key, and rejects a reused key with a different request', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '750' }));
    const key = generateId();
    const first = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: key, actorId: creatorActorId, correlationId: generateId() });
    const second = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: key, actorId: creatorActorId, correlationId: generateId() });
    expect(second).toEqual(first);

    const otherDraft = await directExpenses.createDraft(basicInput({ taxableAmount: '900' }));
    await expect(
      directExpenses.post({ organizationId, id: otherDraft.id, expectedVersion: otherDraft.version, idempotencyKey: key, actorId: creatorActorId, correlationId: generateId() }),
    ).rejects.toThrow('different request');
  });

  it('rejects posting a non-draft direct expense', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '400' }));
    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });
    await expect(
      directExpenses.post({ organizationId, id: posted.id, expectedVersion: posted.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() }),
    ).rejects.toThrow('Only a draft');
  });
});

describe('DirectExpensesService — createAndPostDraft (one-hop, used by the Server & Subscription import)', () => {
  it('creates and posts in one call, producing the same journal shape as a manual create+post', async () => {
    const result = await directExpenses.createAndPostDraft(basicInput({ taxableAmount: '1000', gstInvoiceAvailable: true, gstRatePercent: '9', supplyType: 'INTRASTATE', idempotencyKey: generateId() } as never));
    expect(result.status).toBe('POSTED');
    expect(result.journalEntryId).not.toBeNull();

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: result.journalEntryId! }, include: { ledgerAccount: true } });
    expect(lines).toHaveLength(4);
    const bankLine = lines.find((l) => l.ledgerAccount.code === 'HDFC_CURRENT_ACCOUNT');
    expect(bankLine?.creditAmount.toFixed(2)).toBe('1180.00');
  });

  it('is idempotent on replay with the same key', async () => {
    const key = generateId();
    const input = { ...basicInput({ taxableAmount: '250' }), idempotencyKey: key };
    const first = await directExpenses.createAndPostDraft(input);
    const second = await directExpenses.createAndPostDraft(input);
    expect(second).toEqual(first);
  });
});

describe('DirectExpensesService — reverse', () => {
  it('reverses the journal and flips status back to REVERSED, and rejects a stale version', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '1200' }));
    const posted = await directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });

    const reversed = await directExpenses.reverse({
      organizationId, id: posted.id, expectedVersion: posted.version, reason: 'Wrong bank account selected', accountingDate: '2026-06-02',
      idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId(),
    });
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.reversalJournalEntryId).not.toBeNull();

    const reversalLines = await prisma.client.journalLine.findMany({ where: { journalEntryId: reversed.reversalJournalEntryId! }, include: { ledgerAccount: true } });
    const bankLine = reversalLines.find((l) => l.ledgerAccount.code === 'HDFC_CURRENT_ACCOUNT');
    expect(bankLine?.debitAmount.toFixed(2)).toBe('1200.00');

    const draft2 = await directExpenses.createDraft(basicInput({ taxableAmount: '600' }));
    const posted2 = await directExpenses.post({ organizationId, id: draft2.id, expectedVersion: draft2.version, idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() });
    await expect(
      directExpenses.reverse({ organizationId, id: posted2.id, expectedVersion: posted2.version + 1, reason: 'Stale', accountingDate: '2026-06-02', idempotencyKey: generateId(), actorId: creatorActorId, correlationId: generateId() }),
    ).rejects.toThrow('changed by someone else');
  });
});

describe('DirectExpensesService — list/getDetail and cross-org isolation', () => {
  it('filters by status and category, and does not leak across organizations', async () => {
    const draft = await directExpenses.createDraft(basicInput({ taxableAmount: '333' }));

    const byStatus = await directExpenses.list({ organizationId, page: 1, pageSize: 25, filters: { status: 'DRAFT' } });
    expect(byStatus.rows.some((r) => r.id === draft.id)).toBe(true);

    const byCategory = await directExpenses.list({ organizationId, page: 1, pageSize: 25, filters: { expenseCategoryId } });
    expect(byCategory.rows.some((r) => r.id === draft.id)).toBe(true);

    const detail = await directExpenses.getDetail({ organizationId, id: draft.id });
    expect(detail.id).toBe(draft.id);

    await expect(directExpenses.getDetail({ organizationId: otherOrganizationId, id: draft.id })).rejects.toThrow('not found');

    const { rows } = await directExpenses.list({ organizationId: otherOrganizationId, page: 1, pageSize: 25, filters: {} });
    expect(rows).toHaveLength(0);
  });
});
