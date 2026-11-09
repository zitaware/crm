import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { DirectExpensesService } from './direct-expenses.service';
import { ServerSubscriptionImportService } from './server-subscription-import.service';
import { SERVER_SUBSCRIPTION_HEADERS } from './server-subscription-import';

const prisma = new PrismaService();
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const directExpenses = new DirectExpensesService(prisma, posting);
const imports = new ServerSubscriptionImportService(prisma, directExpenses);

let organizationId: string;
let rushikId: string;
let jayOneId: string;
let jayTwoId: string;
const actorId = generateId();
const ENTITY = 'SSI Solutions Private Limited';

type Cell = string | number | Date | null;

/** A sheet laid out like the one the accounts team keeps. */
async function sheet(rows: Cell[][], headers: readonly string[] = SERVER_SUBSCRIPTION_HEADERS): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Sheet1');
  ws.addRow([...headers]);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

// Sr, Employee, Name, Basic, GST, Total, Date, Project, Type, Mode, Card/Account, Legal Entity
const rupeeRow = (overrides: Partial<Record<number, Cell>> = {}): Cell[] => {
  const row: Cell[] = [1, 'Rushik Shah', 'Signature certificate renewal', '₹3,500.00', 630, '₹4,130.00', '29/10/2026', '', 'Subscription', 'Credit Card', '4421 4500 0109 7823', ENTITY];
  for (const [i, v] of Object.entries(overrides)) row[Number(i)] = v ?? null;
  return row;
};
const planRow = (overrides: Partial<Record<number, Cell>> = {}): Cell[] => {
  const row: Cell[] = [2, 'Rushik Shah', 'Code editor plan', '1,900', 0, 1900, '27/10/2026', '', 'Subscription', 'Credit Card', '4421 4500 0109 7823', ENTITY];
  for (const [i, v] of Object.entries(overrides)) row[Number(i)] = v ?? null;
  return row;
};

beforeAll(async () => {
  organizationId = (await prisma.client.organization.create({ data: { id: generateId(), name: 'SSI Test Org', code: `SSITEST-${generateId()}` } })).id;
  const legalEntity = await prisma.client.legalEntity.create({ data: { id: generateId(), organizationId, legalName: ENTITY, panNumber: 'SSIPL1234Q', registeredAddress: 'Ahmedabad, Gujarat' } });
  await financialYears.create({ organizationId, legalEntityId: legalEntity.id, label: 'FY2026', startDate: '2026-04-01', endDate: '2027-03-31', setCurrent: true, actorId, correlationId: generateId() });

  const group = async (code: string, accountType: 'ASSET' | 'LIABILITY' | 'EXPENSE', normalBalance: 'DEBIT' | 'CREDIT') =>
    (await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code, name: code, accountType, normalBalance, isSystemDefined: true } })).id;
  const assets = await group('SSI_ASSETS', 'ASSET', 'DEBIT');
  const liabilities = await group('SSI_LIABILITIES', 'LIABILITY', 'CREDIT');
  const expenses = await group('SSI_EXPENSES', 'EXPENSE', 'DEBIT');
  const ledger = async (code: string, accountGroupId: string) =>
    (await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId, code, name: code, allowManualPosting: true, isActive: true } })).id;
  for (const code of ['INPUT_CGST_RECEIVABLE', 'INPUT_SGST_RECEIVABLE', 'INPUT_IGST_RECEIVABLE']) await ledger(code, assets);
  await ledger('TDS_PAYABLE', liabilities);
  await ledger('OTHER_EXPENSES', expenses);
  const bankLedger = await ledger('SSI_HDFC', assets);
  const cardLedger = await ledger('SSI_CARD_PAYABLE', liabilities);
  await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId, code: 'software_licenses', name: 'Software Licenses', ledgerAccountId: await ledger('SOFTWARE', expenses) } });
  await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId, code: 'hosting_cloud_infra', name: 'Hosting / Cloud / Infra', ledgerAccountId: await ledger('HOSTING', expenses) } });

  const bank = await legalEntities.createBankAccount({
    organizationId, legalEntityId: legalEntity.id, ledgerAccountId: bankLedger, accountName: 'SSI Operating Account', bankName: 'HDFC Bank', maskedAccountNumber: '99999825500595', ifsc: 'HDFC0000001',
    actorId, correlationId: generateId(),
  });
  await legalEntities.createCardAccount({
    organizationId, legalEntityId: legalEntity.id, type: 'CREDIT_CARD', displayName: 'SSI Corporate Card', issuerName: 'HDFC Bank', maskedLastFour: '7823',
    cardholderEmployeeId: undefined, bankAccountId: undefined, ledgerAccountId: cardLedger, statementDay: undefined, paymentDueDay: undefined, actorId, correlationId: generateId(),
  });
  void bank;

  const employee = async (employeeCode: string, fullName: string, status = 'ACTIVE') =>
    (await prisma.client.employee.create({ data: { id: generateId(), organizationId, employeeCode, fullName, joiningDate: new Date('2026-01-01'), status } })).id;
  rushikId = await employee('SSI-001', 'Rushik Shah');
  jayOneId = await employee('SSI-002', 'Jay Bhavsar');
  jayTwoId = await employee('SSI-003', 'Jay Bhavsar');
  await employee('SSI-004', 'Left Person', 'INACTIVE');
});

afterAll(async () => {
  const where = { organizationId };
  await prisma.client.auditEvent.deleteMany({ where });
  await prisma.client.documentLink.deleteMany({ where });
  await prisma.client.idempotencyKey.deleteMany({ where });
  await prisma.client.directExpense.deleteMany({ where });
  await prisma.client.journalLine.deleteMany({ where });
  await prisma.client.journalEntry.deleteMany({ where });
  await prisma.client.expenseCategory.deleteMany({ where });
  await prisma.client.cardAccount.deleteMany({ where });
  await prisma.client.bankAccount.deleteMany({ where });
  await prisma.client.ledgerAccount.deleteMany({ where });
  await prisma.client.accountGroup.deleteMany({ where });
  await prisma.client.employee.deleteMany({ where });
  await prisma.client.accountingPeriod.deleteMany({ where });
  await prisma.client.financialYear.deleteMany({ where });
  await prisma.client.legalEntity.deleteMany({ where });
  await prisma.client.organization.deleteMany({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('Server & Subscription import (ADR-169)', () => {
  it('reads amounts as rupees, ignoring ₹ signs and commas, and matches the card by its last four digits', async () => {
    const preview = await imports.preview({ organizationId, contentBase64: await sheet([rupeeRow(), planRow()]), choices: [] });
    expect(preview.errorCount).toBe(0);
    const [rupee, plan] = preview.rows;
    expect([rupee!.taxableAmount, rupee!.gstAmount, rupee!.amount, rupee!.supplyType]).toEqual(['3500.00', '630.00', '4130.00', 'INTERSTATE']);
    expect([plan!.taxableAmount, plan!.gstAmount, plan!.amount, plan!.supplyType]).toEqual(['1900.00', '0.00', '1900.00', null]);
    expect([rupee!.employeeId, rupee!.paymentSourceLabel, rupee!.expenseCategoryName, rupee!.expenseDate]).toEqual([rushikId, 'SSI Corporate Card •••• 7823', 'Software Licenses', '2026-10-29']);
    expect(preview.totalAmount).toBe('6030.00');
  });

  it('gives each row its own error when a value is not in the masters, with a hint for a typo', async () => {
    const preview = await imports.preview({
      organizationId,
      contentBase64: await sheet([
        rupeeRow({ 11: 'SSI Solutions Privtae Limited' }),
        rupeeRow({ 2: 'A', 10: '4421 4500 0109 1111' }),
        rupeeRow({ 2: 'B', 10: '' }),
        rupeeRow({ 2: 'C', 1: 'Nobody Here' }),
        rupeeRow({ 2: 'D', 7: 'Unknown Project' }),
        rupeeRow({ 2: 'E', 9: 'Barter' }),
        rupeeRow({ 2: 'F', 5: 4000 }),
        rupeeRow({ 2: 'G', 8: 'Hardware' }),
        rupeeRow({ 2: 'H', 1: 'Left Person' }),
      ]),
      choices: [],
    });
    const errors = preview.rows.map((r) => r.errors.join(' '));
    expect(errors[0]).toContain('Legal Entity "SSI Solutions Privtae Limited" is not in Legal Entities. Did you mean "SSI Solutions Private Limited"?');
    expect(errors[1]).toContain('No credit card ending 1111');
    expect(errors[2]).toContain('Card/Account no is required for Credit Card.');
    expect(errors[3]).toContain('Employee "Nobody Here" is not in Employees.');
    expect(errors[4]).toContain('Project "Unknown Project" is not in Projects.');
    expect(errors[5]).toContain('Payment Mode "Barter" is not one of');
    expect(errors[6]).toContain('Total Paid 4000.00 is not Basic + GST (4130.00).');
    expect(errors[7]).toContain('must be Server or Subscription');
    expect(errors[8]).toContain('is not active');
    expect([preview.errorCount, preview.validCount]).toEqual([9, 0]);
  });

  it('reads NEFT and RTGS as Bank Transfer and matches the bank account by its last four digits', async () => {
    const preview = await imports.preview({ organizationId, contentBase64: await sheet([rupeeRow({ 8: 'Server', 9: 'NEFT', 10: 'A/c 0595' })]), choices: [] });
    expect(preview.rows[0]!.errors).toEqual([]);
    expect([preview.rows[0]!.paymentModeLabel, preview.rows[0]!.paymentSourceLabel, preview.rows[0]!.expenseCategoryName]).toEqual(['Bank Transfer', 'SSI Operating Account', 'Hosting / Cloud / Infra']);
  });

  it('asks which employee by code when two share the name, and imports nothing until chosen', async () => {
    const content = await sheet([rupeeRow({ 1: 'Jay Bhavsar', 2: 'Shared name bill' })]);
    const first = await imports.preview({ organizationId, contentBase64: content, choices: [] });
    expect([first.needsChoiceCount, first.rows[0]!.employeeId, first.rows[0]!.employeeChoices.map((e) => e.employeeCode)]).toEqual([1, null, ['SSI-002', 'SSI-003']]);
    await expect(imports.importRows({ organizationId, contentBase64: content, choices: [], idempotencyKey: generateId(), actorId, correlationId: generateId() })).rejects.toThrow(/choose which "Jay Bhavsar"/);

    const chosen = await imports.preview({ organizationId, contentBase64: content, choices: [{ rowNumber: 2, employeeId: jayTwoId }] });
    expect([chosen.needsChoiceCount, chosen.rows[0]!.employeeId]).toEqual([0, jayTwoId]);
    expect(jayOneId).not.toBe(jayTwoId);
  });

  it('posts every row as a tagged direct expense, splits GST as chosen, and will not post the same bill twice', async () => {
    const content = await sheet([rupeeRow({ 2: 'Posting test bill' }), planRow({ 2: 'Posting test plan', 8: 'Server' })]);
    const key = generateId();
    const result = await imports.importRows({ organizationId, contentBase64: content, choices: [{ rowNumber: 2, supplyType: 'INTRASTATE' }], idempotencyKey: key, actorId, correlationId: generateId() });
    expect(result).toEqual({ created: 2, totalAmount: '6030.00' });

    const posted = await prisma.client.directExpense.findMany({ where: { organizationId, title: { startsWith: 'Posting test' } }, orderBy: { title: 'asc' } });
    expect(posted.map((e) => [e.title, e.status, e.spendType, e.amount.toFixed(2), e.cgstAmount.toFixed(2), e.sgstAmount.toFixed(2), e.purchasedByEmployeeId])).toEqual([
      ['Posting test bill', 'POSTED', 'SUBSCRIPTION', '4130.00', '315.00', '315.00', rushikId],
      ['Posting test plan', 'POSTED', 'SERVER', '1900.00', '0.00', '0.00', rushikId],
    ]);

    // The same import retried returns what it posted; a new upload of the same sheet is caught.
    await expect(imports.importRows({ organizationId, contentBase64: content, choices: [{ rowNumber: 2, supplyType: 'INTRASTATE' }], idempotencyKey: key, actorId, correlationId: generateId() })).resolves.toEqual({ created: 2, totalAmount: '6030.00' });
    const again = await imports.preview({ organizationId, contentBase64: content, choices: [] });
    expect(again.rows.every((r) => r.errors.some((e) => e.includes('already recorded')))).toBe(true);
    expect(await prisma.client.directExpense.count({ where: { organizationId, title: { startsWith: 'Posting test' } } })).toBe(2);

    const listed = await directExpenses.list({ organizationId, page: 1, pageSize: 25, filters: { spendType: 'SERVER' } });
    expect(listed.rows.map((r) => [r.title, r.amount])).toEqual([['Posting test plan', '1900.00']]);
  });

  it('adds one bill by hand, then corrects it by reversing it and posting the corrected bill, keeping its files', async () => {
    const legalEntityId = (await prisma.client.legalEntity.findFirstOrThrow({ where: { organizationId } })).id;
    const card = await prisma.client.cardAccount.findFirstOrThrow({ where: { organizationId } });
    const creditCardModeId = (await prisma.client.paymentMode.findFirstOrThrow({ where: { code: 'CREDIT_CARD' } })).id;
    const entry = {
      spendType: 'SERVER' as const, title: 'Hand entry hosting', employeeId: jayOneId, legalEntityId, expenseDate: '2026-10-20',
      basicAmount: '9000', gstAmount: '1620', supplyType: 'INTERSTATE' as const, paymentModeId: creditCardModeId, cardAccountId: card.id,
      billUrl: 'https://portal.example.com/bill/1',
    };
    const added = await imports.createEntry({ organizationId, entry, idempotencyKey: generateId(), actorId, correlationId: generateId() });
    expect([added.status, added.spendType, added.taxableAmount, added.gstAmount, added.amount, added.billUrl]).toEqual(['POSTED', 'SERVER', '9000.00', '1620.00', '10620.00', 'https://portal.example.com/bill/1']);
    await expect(imports.createEntry({ organizationId, entry, idempotencyKey: generateId(), actorId, correlationId: generateId() })).rejects.toThrow(/already recorded/);

    // A file on the bill follows it to the corrected bill.
    const doc = await prisma.client.document.findFirst({ where: { organizationId } });
    if (doc) await prisma.client.documentLink.create({ data: { id: generateId(), organizationId, documentId: doc.id, entityType: 'DIRECT_EXPENSE', entityId: added.id } });

    const key = generateId();
    const correct = () => imports.correctEntry({ organizationId, id: added.id, expectedVersion: added.version, reason: 'Wrong amount', reversalDate: '2026-10-20', entry: { ...entry, basicAmount: '8800', gstAmount: '1584' }, idempotencyKey: key, actorId, correlationId: generateId() });
    const corrected = await correct();
    expect([corrected.status, corrected.amount, corrected.title]).toEqual(['POSTED', '10384.00', 'Hand entry hosting']);
    const old = await prisma.client.directExpense.findUniqueOrThrow({ where: { id: added.id } });
    expect([old.status, old.reversalReason]).toEqual(['REVERSED', 'Corrected: Wrong amount']);
    // A retry of the same correction posts nothing more.
    await expect(correct()).resolves.toMatchObject({ id: corrected.id });
    expect(await prisma.client.directExpense.count({ where: { organizationId, title: 'Hand entry hosting', status: 'POSTED' } })).toBe(1);
    if (doc) expect(await prisma.client.documentLink.count({ where: { entityType: 'DIRECT_EXPENSE', entityId: corrected.id, documentId: doc.id } })).toBe(1);

    // A bill already reversed some other way is not corrected: it is added again.
    await expect(imports.correctEntry({ organizationId, id: added.id, expectedVersion: old.version, reason: 'Again', reversalDate: '2026-10-20', entry, idempotencyKey: generateId(), actorId, correlationId: generateId() })).rejects.toThrow(/already reversed/);
  });

  it('reads headers as the team types them', async () => {
    const headers = ['Sr.no', 'Employe Name', 'Subscibtion Name', 'Basic Amount', 'GST Amount', 'Total Paid', 'Date', 'Project Name', 'Server /Subscriptio', 'Payment Mode', 'Card/Account no', 'Legal Entity'];
    const preview = await imports.preview({ organizationId, contentBase64: await sheet([rupeeRow({ 2: 'Header test' })], headers), choices: [] });
    expect([preview.rows.length, preview.rows[0]!.title, preview.rows[0]!.errors]).toEqual([1, 'Header test', []]);
  });
});
