import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { VendorsService } from '../vendors/vendors.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { InventoryLedgerService } from '../inventory/inventory-ledger.service';
import { VendorBillsService } from '../vendor-bills/vendor-bills.service';
import { PaymentRequestsService } from '../payment-requests/payment-requests.service';
import { VendorPaymentsService } from '../vendor-payments/vendor-payments.service';
import { MastersService } from '../masters/masters.service';
import { PurchasesService } from './purchases.service';
import { uniqueGstin } from '../testing/gstin.test-util';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const vendors = new VendorsService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const vendorBills = new VendorBillsService(prisma, posting, projects, new InventoryLedgerService(prisma));
const purchases = new PurchasesService(
  prisma,
  projects,
  vendorBills,
  new PaymentRequestsService(prisma, projects),
  new VendorPaymentsService(prisma, posting, projects),
  vendors,
  new MastersService(prisma),
);

let organizationId: string;
let legalEntityId: string;
let vendorId: string;
let bankAccountId: string;
let bankTransferId: string;
let ledgerIds: Map<string, string>;
const actorId = generateId();
const base = () => ({ organizationId, actorId, canSeeAll: true, correlationId: generateId() });

async function stageOf(vendorBillId: string) {
  const list = await purchases.list({ organizationId, actorId, canSeeAll: true, page: 1, pageSize: 100 });
  return list.rows.find((r) => r.vendorBillId === vendorBillId);
}

beforeAll(async () => {
  organizationId = (await prisma.client.organization.create({ data: { id: generateId(), name: 'Purchases Test Org', code: `PURTEST-${generateId()}` } })).id;
  const gujarat = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });
  legalEntityId = (
    await prisma.client.legalEntity.create({ data: { id: generateId(), organizationId, legalName: 'Purchases Test Pvt Ltd', panNumber: 'ABCPU1234P', registeredAddress: 'Ahmedabad, Gujarat' } })
  ).id;
  await legalEntities.createGstRegistration({ organizationId, legalEntityId, stateId: gujarat.id, gstin: uniqueGstin('24'), tradeName: undefined, actorId, correlationId: generateId() });
  await new FinancialYearService(prisma).create({ organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31', setCurrent: true, actorId, correlationId: generateId() });

  vendorId = (
    await vendors.create({
      organizationId, existingPartyId: undefined, name: 'WELL CONTACTS CO', shortCode: undefined, gstin: undefined, panNumber: undefined, paymentTerms: undefined,
      stateId: gujarat.id, districtId: undefined, cityId: undefined, pinCode: undefined, officeAddress: undefined, internalNote: undefined, actorId, correlationId: generateId(),
    })
  ).id;

  const group = async (code: string, accountType: 'ASSET' | 'LIABILITY' | 'EXPENSE') =>
    (await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code, name: code, accountType, normalBalance: accountType === 'LIABILITY' ? 'CREDIT' : 'DEBIT', isSystemDefined: true } })).id;
  const assets = await group('PU_ASSETS', 'ASSET');
  const liabilities = await group('PU_LIABILITIES', 'LIABILITY');
  const expenses = await group('PU_EXPENSES', 'EXPENSE');
  ledgerIds = new Map();
  for (const [code, groupId] of [
    ['ACCOUNTS_PAYABLE_VENDOR', liabilities], ['TDS_PAYABLE', liabilities], ['INPUT_CGST_RECEIVABLE', assets], ['INPUT_SGST_RECEIVABLE', assets], ['INPUT_IGST_RECEIVABLE', assets],
    ['OTHER_EXPENSES', expenses], ['OFFICE_ADMINISTRATIVE_EXPENSE', expenses], ['HDFC_CURRENT_ACCOUNT', assets], ['CREDIT_CARD_PAYABLE', liabilities],
  ] as const) {
    ledgerIds.set(code, (await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: groupId, code, name: code, allowManualPosting: true, isActive: true } })).id);
  }
  await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId, code: 'office_administrative', name: 'Office / Administrative', ledgerAccountId: ledgerIds.get('OFFICE_ADMINISTRATIVE_EXPENSE')! } });
  await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId, code: 'porter_courier', name: 'Porter/Courier' } });
  await prisma.client.unitOfMeasure.create({ data: { id: generateId(), organizationId, code: 'qty', name: 'Qty' } });

  bankAccountId = (
    await legalEntities.createBankAccount({
      organizationId, legalEntityId, ledgerAccountId: ledgerIds.get('HDFC_CURRENT_ACCOUNT')!, accountName: 'HDFC Current', bankName: 'HDFC Bank',
      maskedAccountNumber: '****8436', ifsc: 'HDFC0000123', actorId, correlationId: generateId(),
    })
  ).id;
  await prisma.client.cardAccount.create({
    data: { id: generateId(), organizationId, legalEntityId, type: 'CREDIT_CARD', displayName: 'HDFC Credit Card', maskedLastFour: '5555', ledgerAccountId: ledgerIds.get('CREDIT_CARD_PAYABLE')!, isActive: true },
  });
  bankTransferId = (await prisma.client.paymentMode.findFirstOrThrow({ where: { code: 'BANK_TRANSFER' } })).id;
});

afterAll(async () => {
  const where = { where: { organizationId } };
  await prisma.client.auditEvent.deleteMany(where);
  await prisma.client.idempotencyKey.deleteMany(where);
  await prisma.client.vendorPaymentDeduction.deleteMany(where);
  await prisma.client.vendorPaymentAllocation.deleteMany(where);
  await prisma.client.vendorPayment.deleteMany(where);
  await prisma.client.paymentRequestDecision.deleteMany(where);
  await prisma.client.paymentRequestLine.deleteMany(where);
  await prisma.client.paymentRequest.deleteMany(where);
  await prisma.client.vendorBillDecision.deleteMany(where);
  await prisma.client.vendorBillLine.deleteMany(where);
  await prisma.client.vendorBill.deleteMany(where);
  await prisma.client.expenseCategory.deleteMany(where);
  await prisma.client.unitOfMeasure.deleteMany(where);
  await prisma.client.journalLine.deleteMany(where);
  await prisma.client.journalEntry.deleteMany(where);
  await prisma.client.cardAccount.deleteMany(where);
  await prisma.client.bankAccount.deleteMany(where);
  await prisma.client.ledgerAccount.deleteMany(where);
  await prisma.client.accountGroup.deleteMany(where);
  await prisma.client.accountingPeriod.deleteMany(where);
  await prisma.client.financialYear.deleteMany(where);
  await prisma.client.gstRegistration.deleteMany(where);
  await prisma.client.vendorProfile.deleteMany(where);
  await prisma.client.party.deleteMany(where);
  await prisma.client.legalEntity.deleteMany(where);
  await prisma.client.organization.deleteMany({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('Purchases: one bill entered as a register row (ADR-181)', () => {
  it('posts a paid bill from the form, adding a category typed in another case only once, and repeats nothing on retry', async () => {
    const entry = {
      date: '2026-10-23', details: 'MS Brackets with Screw', vendorId, legalEntityId, categoryName: '  porter/COURIER ', amount: '1575', otherCharges: '350', totalAmount: '2272',
      paidBy: 'Hemdeep', invoiceLink: 'https://drive.google.com/x', paymentModeId: bankTransferId, bankAccountId,
    };
    const key = generateId();
    const saved = await purchases.addEntry({ ...base(), entry, idempotencyKey: key });
    expect(saved).toMatchObject({ paid: true, categoryCreated: false });

    const bill = await prisma.client.vendorBill.findUniqueOrThrow({ where: { id: saved.vendorBillId }, include: { lines: { include: { expenseCategory: true } } } });
    expect([bill.status, bill.totalAmount?.toFixed(2), bill.taxableAmount?.toFixed(2), bill.billUrl, bill.lines[0]!.expenseCategory?.name, bill.lines[0]!.description]).toEqual([
      'FINALIZED', '2272.00', '1925.00', 'https://drive.google.com/x', 'Porter/Courier', 'MS Brackets with Screw. Paid by Hemdeep.',
    ]);
    expect(await stageOf(saved.vendorBillId)).toMatchObject({ stage: 'PAID', paidAmount: '2272.00', dueAmount: '0.00' });

    const again = await purchases.addEntry({ ...base(), entry, idempotencyKey: key });
    expect(again.vendorBillId).toBe(saved.vendorBillId);
    expect(await prisma.client.vendorPayment.count({ where: { organizationId } })).toBe(1);
  });

  it('adds a category not in Masters, and leaves a bill with no payment mode in To pay', async () => {
    const saved = await purchases.addEntry({
      ...base(),
      entry: { date: '2026-10-24', details: 'Cable ties', vendorId, legalEntityId, categoryName: 'Electrical  Consumables', amount: '100', totalAmount: '118' },
      idempotencyKey: generateId(),
    });
    expect(saved).toMatchObject({ paid: false, categoryCreated: true });
    const category = await prisma.client.expenseCategory.findFirstOrThrow({ where: { organizationId, name: 'Electrical Consumables' } });
    expect(category.isActive).toBe(true);
    expect(await stageOf(saved.vendorBillId)).toMatchObject({ stage: 'TO_PAY', dueAmount: '118.00' });
  });

  it('refuses a total below Amount + Other Charges', async () => {
    await expect(
      purchases.addEntry({ ...base(), entry: { date: '2026-10-24', details: 'Wrong', vendorId, legalEntityId, amount: '100', otherCharges: '10', totalAmount: '100' }, idempotencyKey: generateId() }),
    ).rejects.toThrow(/less than Amount \+ Other Charges/);
  });
});

describe('Purchases: register import (ADR-178, ADR-180)', () => {
  it('adds a missing category once for rows that differ only in case, and reads a card number with spaces', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['No', 'Date', 'Details', 'Supplier', 'Company', 'Invoice Link', 'Category', 'Other Charges', 'Amount', 'Amount With GST', 'Project', 'Paid by', 'Payment Receipt', 'Payment Mode', 'Card/Account no']);
    ws.addRow([1, '25-Oct-26', 'Toner', 'New Stationers', 'PURCHASES TEST PRIVATE LIMITED', '', 'Printer Supplies', '-', '500', '590', '', '', '', 'Credit Card', '1234 55555 5555 555']);
    ws.addRow([2, '25-Oct-26', 'Paper', 'New Stationers', 'Purchases Test Pvt Ltd', '', ' printer  supplies ', '-', '200', '236', '', '', '', 'Bank Transfer', '8436']);
    const contentBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');

    const preview = await purchases.previewImport({ organizationId, contentBase64, actorId, canSeeAll: true });
    expect(preview.rows.map((r) => [r.errors, r.categoryIsNew, r.paymentSourceLabel])).toEqual([
      [[], true, 'HDFC Credit Card •••• 5555'],
      [[], true, 'HDFC Current'],
    ]);
    expect([preview.newCategoryCount, preview.newVendorCount]).toEqual([1, 1]);

    const result = await purchases.importRows({ organizationId, contentBase64, idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId() });
    expect(result).toEqual({ bills: 2, vendorsCreated: 1, categoriesCreated: 1 });
    expect(await prisma.client.expenseCategory.count({ where: { organizationId, name: { equals: 'printer supplies', mode: 'insensitive' } } })).toBe(1);
    const byCard = await prisma.client.vendorPayment.findFirstOrThrow({ where: { organizationId, cardAccountId: { not: null } } });
    expect(byCard.cardAccountId).not.toBeNull();
  });
});
