import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { DirectExpensesService } from '../direct-expenses/direct-expenses.service';
import { CardSettlementsService } from './card-settlements.service';

const prisma = new PrismaService();
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const directExpenses = new DirectExpensesService(prisma, posting);
const cardSettlements = new CardSettlementsService(prisma, posting);

let organizationId: string;
let otherOrganizationId: string;
let legalEntityId: string;
let expenseCategoryId: string;
let bankAccountId: string;
let creditCardAccountId: string;
let debitCardAccountId: string;
let creditCardModeId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({ data: { id: generateId(), name: 'Card Settlements Test Org', code: `CSTEST-${generateId()}` } });
  organizationId = organization.id;
  const otherOrg = await prisma.client.organization.create({ data: { id: generateId(), name: 'Card Settlements Other Org', code: `CSTEST-OTHER-${generateId()}` } });
  otherOrganizationId = otherOrg.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'CS Test Legal Entity', panNumber: 'CSABC1234P', registeredAddress: 'Ahmedabad, Gujarat' },
  });
  legalEntityId = legalEntity.id;
  await financialYears.create({ organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31', setCurrent: true, actorId, correlationId: generateId() });

  const assetGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'CS_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true } });
  const expenseGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'CS_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true } });
  const liabilityGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'CS_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true } });

  const ledgerCodes: Array<{ code: string; groupId: string; name: string }> = [
    { code: 'CS_OTHER_EXPENSES', groupId: expenseGroup.id, name: 'Other Expenses' },
    { code: 'CS_HDFC_CURRENT_ACCOUNT', groupId: assetGroup.id, name: 'HDFC Current Account' },
    { code: 'CS_CREDIT_CARD_PAYABLE', groupId: liabilityGroup.id, name: 'Credit Card Payable' },
  ];
  const createdLedgerAccounts = new Map<string, string>();
  for (const l of ledgerCodes) {
    const row = await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: l.groupId, code: l.code, name: l.name, allowManualPosting: true, isActive: true } });
    createdLedgerAccounts.set(l.code, row.id);
  }

  const expenseCategory = await prisma.client.expenseCategory.create({
    data: { id: generateId(), organizationId, code: 'CS-MISC', name: 'Misc', ledgerAccountId: createdLedgerAccounts.get('CS_OTHER_EXPENSES')! },
  });
  expenseCategoryId = expenseCategory.id;

  const bankAccount = await legalEntities.createBankAccount({
    organizationId, legalEntityId, ledgerAccountId: createdLedgerAccounts.get('CS_HDFC_CURRENT_ACCOUNT')!,
    accountName: 'CS HDFC Operating Account', bankName: 'HDFC Bank', maskedAccountNumber: '****3344', ifsc: 'HDFC0001122',
    actorId, correlationId: generateId(),
  });
  bankAccountId = bankAccount.id;

  const creditCard = await legalEntities.createCardAccount({
    organizationId, legalEntityId, type: 'CREDIT_CARD', displayName: 'CS Credit Card', issuerName: 'Axis Bank', maskedLastFour: '7788',
    cardholderEmployeeId: undefined, bankAccountId: undefined, ledgerAccountId: createdLedgerAccounts.get('CS_CREDIT_CARD_PAYABLE')!, statementDay: undefined, paymentDueDay: undefined,
    actorId, correlationId: generateId(),
  });
  creditCardAccountId = creditCard.id;

  const debitCard = await legalEntities.createCardAccount({
    organizationId, legalEntityId, type: 'DEBIT_CARD', displayName: 'CS Debit Card', issuerName: 'HDFC Bank', maskedLastFour: '1234',
    cardholderEmployeeId: undefined, bankAccountId, ledgerAccountId: undefined, statementDay: undefined, paymentDueDay: undefined,
    actorId, correlationId: generateId(),
  });
  debitCardAccountId = debitCard.id;

  creditCardModeId = (await prisma.client.paymentMode.findFirstOrThrow({ where: { code: 'CREDIT_CARD' } })).id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.cardSettlement.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.directExpense.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.expenseCategory.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.cardAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.bankAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

async function chargeCreditCard(amount: string) {
  const draft = await directExpenses.createDraft({
    organizationId, expenseCategoryId, vendorId: undefined, title: 'Card purchase', projectId: undefined, legalEntityId, taxableAmount: amount, expenseDate: '2026-06-01',
    gstInvoiceAvailable: false, gstRatePercent: undefined, supplyType: undefined, itcEligible: undefined, tdsAmount: undefined, tdsRatePercent: undefined,
    paymentModeId: creditCardModeId, bankAccountId: undefined, cardAccountId: creditCardAccountId, transactionReference: undefined, purchasedByEmployeeId: undefined, note: undefined,
    idempotencyKey: generateId(), actorId, correlationId: generateId(),
  });
  return directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });
}

describe('CardSettlementsService', () => {
  it('computes zero outstanding balance for a freshly created credit card', async () => {
    const balance = await cardSettlements.getOutstandingBalance({ organizationId, cardAccountId: creditCardAccountId });
    expect(balance).toBe('0.00');
  });

  it('rejects computing an outstanding balance for a debit card', async () => {
    await expect(cardSettlements.getOutstandingBalance({ organizationId, cardAccountId: debitCardAccountId })).rejects.toThrow('Only a credit card');
  });

  it('increases outstanding balance as Direct Expense purchases post to the card, and settles it down', async () => {
    await chargeCreditCard('1000');
    await chargeCreditCard('500');
    const balanceAfterPurchases = await cardSettlements.getOutstandingBalance({ organizationId, cardAccountId: creditCardAccountId });
    expect(balanceAfterPurchases).toBe('1500.00');

    const settlement = await cardSettlements.settleCreditCard({
      organizationId, cardAccountId: creditCardAccountId, amount: '600', settlementDate: '2026-06-15', bankAccountId, transactionReference: 'UTR123',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(settlement.amount).toBe('600.00');
    expect(settlement.journalEntryId).toBeTruthy();

    const balanceAfterSettlement = await cardSettlements.getOutstandingBalance({ organizationId, cardAccountId: creditCardAccountId });
    expect(balanceAfterSettlement).toBe('900.00');

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: settlement.journalEntryId }, include: { ledgerAccount: true } });
    expect(lines).toHaveLength(2);
    const payableLine = lines.find((l) => l.ledgerAccount.code === 'CS_CREDIT_CARD_PAYABLE');
    const bankLine = lines.find((l) => l.ledgerAccount.code === 'CS_HDFC_CURRENT_ACCOUNT');
    expect(payableLine?.debitAmount.toFixed(2)).toBe('600.00');
    expect(bankLine?.creditAmount.toFixed(2)).toBe('600.00');
  });

  it('supports full settlement of the remaining balance, bringing it to zero', async () => {
    const remaining = await cardSettlements.getOutstandingBalance({ organizationId, cardAccountId: creditCardAccountId });
    await cardSettlements.settleCreditCard({
      organizationId, cardAccountId: creditCardAccountId, amount: remaining, settlementDate: '2026-06-20', bankAccountId, transactionReference: undefined,
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    const balance = await cardSettlements.getOutstandingBalance({ organizationId, cardAccountId: creditCardAccountId });
    expect(balance).toBe('0.00');
  });

  it('rejects a settlement amount exceeding the outstanding balance', async () => {
    await chargeCreditCard('200');
    await expect(
      cardSettlements.settleCreditCard({
        organizationId, cardAccountId: creditCardAccountId, amount: '999999', settlementDate: '2026-06-21', bankAccountId, transactionReference: undefined,
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('cannot exceed the outstanding balance');
  });

  it('rejects settling a debit card', async () => {
    await expect(
      cardSettlements.settleCreditCard({
        organizationId, cardAccountId: debitCardAccountId, amount: '10', settlementDate: '2026-06-21', bankAccountId, transactionReference: undefined,
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('Only a credit card can be settled');
  });

  it('is idempotent on replay with the same key', async () => {
    const key = generateId();
    const input = {
      organizationId, cardAccountId: creditCardAccountId, amount: '50', settlementDate: '2026-06-22', bankAccountId, transactionReference: undefined,
      idempotencyKey: key, actorId, correlationId: generateId(),
    };
    const first = await cardSettlements.settleCreditCard(input);
    const second = await cardSettlements.settleCreditCard(input);
    expect(second).toEqual(first);
  });

  it('lists settlements for a card in descending date order', async () => {
    const rows = await cardSettlements.listByCardAccount({ organizationId, cardAccountId: creditCardAccountId });
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.settlementDate >= rows[i]!.settlementDate).toBe(true);
    }
  });

  it('does not leak card accounts or settlements across organizations', async () => {
    await expect(cardSettlements.getOutstandingBalance({ organizationId: otherOrganizationId, cardAccountId: creditCardAccountId })).rejects.toThrow('not found');
    const rows = await cardSettlements.listByCardAccount({ organizationId: otherOrganizationId, cardAccountId: creditCardAccountId });
    expect(rows).toHaveLength(0);
  });
});
