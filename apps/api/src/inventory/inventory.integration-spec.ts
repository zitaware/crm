import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { PostingService } from '../accounting/posting.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryService } from './inventory.service';

const prisma = new PrismaService();
const financialYears = new FinancialYearService(prisma);
const posting = new PostingService(prisma);
const ledger = new InventoryLedgerService(prisma);
const inventory = new InventoryService(prisma, posting, ledger);

let organizationId: string;
let otherOrganizationId: string;
let legalEntityId: string;
let unitId: string;
let itemAId: string;
let itemBId: string;
let nonStockItemId: string;
let inactiveItemId: string;
let vendorPartyId: string;
let inventoryAccountId: string;
let materialCostAccountId: string;
let projectId: string;
let closedProjectId: string;
const actorId = generateId();

async function makeItem(code: string, name: string, opts: { isStockTracked?: boolean; isActive?: boolean } = {}): Promise<string> {
  const row = await prisma.client.inventoryItem.create({
    data: {
      id: generateId(),
      organizationId,
      code,
      name,
      unitOfMeasureId: unitId,
      isStockTracked: opts.isStockTracked ?? true,
      isActive: opts.isActive ?? true,
    },
  });
  return row.id;
}

function receiptInput(overrides: Partial<Parameters<InventoryService['recordReceipt']>[0]> = {}) {
  return {
    organizationId,
    legalEntityId,
    receiptType: 'DIRECT' as const,
    partyId: vendorPartyId,
    receivedDate: '2026-03-10',
    invoiceChallanNumber: 'CH-001',
    note: undefined,
    lines: [{ inventoryItemId: itemAId, quantity: '10', unitCostAmount: '100.00' }],
    idempotencyKey: generateId(),
    actorId,
    correlationId: generateId(),
    ...overrides,
  };
}

/** Sums every journal line against the INVENTORY account — the figure
 * Phase 7's exit criterion requires stock value to match.
 *
 * Deliberately NOT filtered to status POSTED: a reversed entry's lines
 * still exist and are still part of the balance, with the reversal entry's
 * opposite lines offsetting them. That is exactly how the app's own
 * `getLedgerActivity` computes a balance (posting.service.ts) — filtering
 * to POSTED here would drop the original of every reversed pair and leave
 * the reversal uncancelled. */
async function inventoryAccountBalance(): Promise<Prisma.Decimal> {
  const lines = await prisma.client.journalLine.findMany({
    where: { organizationId, ledgerAccountId: inventoryAccountId },
  });
  return lines.reduce((sum, l) => sum.plus(l.debitAmount).minus(l.creditAmount), new Prisma.Decimal(0));
}

/** Sums every item's latest movement snapshot — the ledger's own view. */
async function totalStockValue(): Promise<Prisma.Decimal> {
  const items = await prisma.client.inventoryItem.findMany({ where: { organizationId } });
  let total = new Prisma.Decimal(0);
  for (const item of items) {
    const balance = await ledger.getBalance(organizationId, item.id);
    total = total.plus(balance.valueAmount);
  }
  return total;
}

beforeAll(async () => {
  const org = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Inventory Test Org', code: `INVTEST-${generateId()}` },
  });
  organizationId = org.id;
  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Inventory Other Org', code: `INVOTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Inv Test Legal Entity', panNumber: 'INVCD1234P', registeredAddress: 'Gandhinagar, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  await financialYears.create({
    organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31',
    setCurrent: true, actorId, correlationId: generateId(),
  });

  const assetGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INV_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const liabilityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INV_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  const equityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INV_EQUITY', name: 'Equity', accountType: 'EQUITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });

  const inventoryAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'INVENTORY', name: 'Inventory', allowManualPosting: true, isActive: true },
  });
  inventoryAccountId = inventoryAccount.id;
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: liabilityGroup.id, code: 'ACCOUNTS_PAYABLE_VENDOR', name: 'Accounts Payable — Vendor', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: equityGroup.id, code: 'OPENING_BALANCE_EQUITY', name: 'Opening Balance Equity', allowManualPosting: true, isActive: true },
  });

  const expenseGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INV_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const materialCostAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: expenseGroup.id, code: 'PROJECT_MATERIAL_COST', name: 'Project Material Cost', allowManualPosting: true, isActive: true },
  });
  materialCostAccountId = materialCostAccount.id;

  const unit = await prisma.client.unitOfMeasure.create({ data: { id: generateId(), organizationId, code: 'qty', name: 'Qty' } });
  unitId = unit.id;

  itemAId = await makeItem('ITEM-000001', 'Cat6 Cable Box');
  itemBId = await makeItem('ITEM-000002', 'RJ45 Connector');
  nonStockItemId = await makeItem('ITEM-000003', 'AMC Service', { isStockTracked: false });
  inactiveItemId = await makeItem('ITEM-000004', 'Retired Switch', { isActive: false });

  const vendor = await prisma.client.party.create({
    data: { id: generateId(), organizationId, name: 'Inv Test Vendor' },
  });
  vendorPartyId = vendor.id;

  const client = await prisma.client.party.create({
    data: { id: generateId(), organizationId, name: 'Inv Test Client' },
  });
  const project = await prisma.client.project.create({
    data: { id: generateId(), organizationId, clientId: client.id, legalEntityId, name: 'Inv Test Project' },
  });
  projectId = project.id;
  const closedProject = await prisma.client.project.create({
    data: { id: generateId(), organizationId, clientId: client.id, legalEntityId, name: 'Inv Closed Project', operationalStatus: 'CLOSED' },
  });
  closedProjectId = closedProject.id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.inventoryMovement.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.inventoryReceiptLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.inventoryReceipt.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.inventoryConsumptionLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.inventoryConsumption.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.inventoryItem.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.unitOfMeasure.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('InventoryService — recordReceipt (DIRECT)', () => {
  it('posts Dr Inventory / Cr Accounts Payable and creates one movement per line', async () => {
    const receipt = await inventory.recordReceipt(
      receiptInput({ lines: [{ inventoryItemId: itemAId, quantity: '10', unitCostAmount: '100.00' }] }),
    );

    expect(receipt.receiptNumber).toMatch(/^STK-\d{6}$/);
    expect(receipt.status).toBe('POSTED');
    expect(receipt.totalValueAmount).toBe('1000.00');

    const journal = await prisma.client.journalEntry.findFirstOrThrow({
      where: { id: receipt.journalEntryId },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(journal.lines).toHaveLength(2);
    const debit = journal.lines.find((l) => l.debitAmount.greaterThan(0))!;
    const credit = journal.lines.find((l) => l.creditAmount.greaterThan(0))!;
    expect(debit.ledgerAccount.code).toBe('INVENTORY');
    expect(debit.debitAmount.toFixed(2)).toBe('1000.00');
    expect(credit.ledgerAccount.code).toBe('ACCOUNTS_PAYABLE_VENDOR');
    expect(credit.creditAmount.toFixed(2)).toBe('1000.00');

    const balance = await ledger.getBalance(organizationId, itemAId);
    expect(balance.quantity.toFixed(4)).toBe('10.0000');
    expect(balance.valueAmount.toFixed(2)).toBe('1000.00');
    expect(balance.weightedAverageRate.toFixed(4)).toBe('100.0000');
  });

  it('blends a second receipt at a different cost into the weighted average', async () => {
    await inventory.recordReceipt(
      receiptInput({ lines: [{ inventoryItemId: itemBId, quantity: '10', unitCostAmount: '100.00' }] }),
    );
    await inventory.recordReceipt(
      receiptInput({ receivedDate: '2026-03-12', lines: [{ inventoryItemId: itemBId, quantity: '30', unitCostAmount: '200.00' }] }),
    );

    const balance = await ledger.getBalance(organizationId, itemBId);
    expect(balance.quantity.toFixed(4)).toBe('40.0000');
    expect(balance.valueAmount.toFixed(2)).toBe('7000.00');
    expect(balance.weightedAverageRate.toFixed(4)).toBe('175.0000');
  });

  it('posts an OPENING receipt against Opening Balance Equity and takes no vendor', async () => {
    const itemId = await makeItem(`ITEM-OPEN-${generateId().slice(0, 6)}`, 'Opening Stock Item');
    const receipt = await inventory.recordReceipt(
      receiptInput({
        receiptType: 'OPENING',
        partyId: undefined,
        lines: [{ inventoryItemId: itemId, quantity: '5', unitCostAmount: '40.00' }],
      }),
    );

    const journal = await prisma.client.journalEntry.findFirstOrThrow({
      where: { id: receipt.journalEntryId },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    const credit = journal.lines.find((l) => l.creditAmount.greaterThan(0))!;
    expect(credit.ledgerAccount.code).toBe('OPENING_BALANCE_EQUITY');

    const movement = await prisma.client.inventoryMovement.findFirstOrThrow({ where: { inventoryItemId: itemId } });
    expect(movement.movementType).toBe('OPENING');
  });

  it('requires a vendor on DIRECT and forbids one on OPENING', async () => {
    await expect(inventory.recordReceipt(receiptInput({ partyId: undefined }))).rejects.toThrow(/must name the supplying vendor/i);
    await expect(
      inventory.recordReceipt(receiptInput({ receiptType: 'OPENING', partyId: vendorPartyId })),
    ).rejects.toThrow(/has no vendor/i);
  });

  it('rejects a non-stock-tracked item, an inactive item, and a non-positive quantity', async () => {
    await expect(
      inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: nonStockItemId, quantity: '1', unitCostAmount: '10' }] })),
    ).rejects.toThrow(/not a stock-tracked item/i);
    await expect(
      inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: inactiveItemId, quantity: '1', unitCostAmount: '10' }] })),
    ).rejects.toThrow(/inactive/i);
    await expect(
      inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemAId, quantity: '0', unitCostAmount: '10' }] })),
    ).rejects.toThrow(/greater than zero/i);
  });

  it('refuses a movement dated before the item’s last movement, rather than silently invalidating later rates', async () => {
    const itemId = await makeItem(`ITEM-BACK-${generateId().slice(0, 6)}`, 'Backdate Item');
    await inventory.recordReceipt(receiptInput({ receivedDate: '2026-04-10', lines: [{ inventoryItemId: itemId, quantity: '1', unitCostAmount: '10' }] }));
    await expect(
      inventory.recordReceipt(receiptInput({ receivedDate: '2026-04-01', lines: [{ inventoryItemId: itemId, quantity: '1', unitCostAmount: '10' }] })),
    ).rejects.toThrow(/cannot be backdated/i);
  });

  it('replays an identical request and rejects a reused key with a different payload', async () => {
    const key = generateId();
    const itemId = await makeItem(`ITEM-IDEM-${generateId().slice(0, 6)}`, 'Idempotent Item');
    const input = receiptInput({ idempotencyKey: key, lines: [{ inventoryItemId: itemId, quantity: '2', unitCostAmount: '50' }] });

    const first = await inventory.recordReceipt(input);
    const replay = await inventory.recordReceipt(input);
    expect(replay.id).toBe(first.id);

    // A replay must not double the stock.
    const balance = await ledger.getBalance(organizationId, itemId);
    expect(balance.quantity.toFixed(4)).toBe('2.0000');

    await expect(
      inventory.recordReceipt(receiptInput({ idempotencyKey: key, lines: [{ inventoryItemId: itemId, quantity: '9', unitCostAmount: '50' }] })),
    ).rejects.toThrow(/different request/i);
  });
});

describe('InventoryService — reverseReceipt', () => {
  it('reverses the journal, issues the stock back out, and flips the status', async () => {
    const itemId = await makeItem(`ITEM-REV-${generateId().slice(0, 6)}`, 'Reversible Item');
    const receipt = await inventory.recordReceipt(
      receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '4', unitCostAmount: '25.00' }] }),
    );

    const reversed = await inventory.reverseReceipt({
      organizationId,
      id: receipt.id,
      expectedVersion: receipt.version,
      reason: 'Wrong vendor',
      accountingDate: '2026-03-20',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    expect(reversed.status).toBe('REVERSED');
    expect(reversed.reversalJournalEntryId).not.toBeNull();
    expect(reversed.reversalReason).toBe('Wrong vendor');

    const original = await prisma.client.journalEntry.findFirstOrThrow({ where: { id: receipt.journalEntryId } });
    expect(original.status).toBe('REVERSED');

    const balance = await ledger.getBalance(organizationId, itemId);
    expect(balance.quantity.toFixed(4)).toBe('0.0000');
    expect(balance.valueAmount.toFixed(2)).toBe('0.00');
  });

  it('refuses to reverse once the stock has been partly consumed', async () => {
    const itemId = await makeItem(`ITEM-CONS-${generateId().slice(0, 6)}`, 'Consumed Item');
    const receipt = await inventory.recordReceipt(
      receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '10', unitCostAmount: '10.00' }] }),
    );

    // Issue some stock directly through the ledger (Slice 7.3 gives this a
    // real document; the guard being tested here is independent of that).
    await prisma.client.$transaction(async (tx) => {
      await ledger.recordMovement(tx, {
        organizationId,
        inventoryItemId: itemId,
        movementType: 'CONSUMPTION',
        movementDate: new Date('2026-03-15T00:00:00.000Z'),
        quantityOut: new Prisma.Decimal(3),
        actorId,
      });
    });

    await expect(
      inventory.reverseReceipt({
        organizationId,
        id: receipt.id,
        expectedVersion: receipt.version,
        reason: 'Too late',
        accountingDate: '2026-03-20',
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/only 7\.0000 on hand/i);
  });

  it('requires a reason and refuses to reverse twice', async () => {
    const itemId = await makeItem(`ITEM-TWICE-${generateId().slice(0, 6)}`, 'Twice Item');
    const receipt = await inventory.recordReceipt(
      receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '1', unitCostAmount: '5.00' }] }),
    );

    await expect(
      inventory.reverseReceipt({
        organizationId, id: receipt.id, expectedVersion: receipt.version, reason: '   ',
        accountingDate: '2026-03-20', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/reason is required/i);

    const reversed = await inventory.reverseReceipt({
      organizationId, id: receipt.id, expectedVersion: receipt.version, reason: 'First',
      accountingDate: '2026-03-20', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    await expect(
      inventory.reverseReceipt({
        organizationId, id: receipt.id, expectedVersion: reversed.version, reason: 'Second',
        accountingDate: '2026-03-21', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/already reversed/i);
  });
});

describe('InventoryService — project consumption (Slice 7.3)', () => {
  function consumptionInput(overrides: Partial<Parameters<InventoryService['recordConsumption']>[0]> = {}) {
    return {
      organizationId,
      legalEntityId,
      projectId,
      consumedDate: '2026-04-10',
      note: undefined,
      lines: [{ inventoryItemId: itemAId, quantity: '1' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
      ...overrides,
    };
  }

  /** Dr / Cr totals for one journal entry, by ledger account. */
  async function journalByAccount(journalEntryId: string) {
    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId } });
    return new Map(lines.map((l) => [l.ledgerAccountId, { debit: l.debitAmount, credit: l.creditAmount, projectId: l.projectId }]));
  }

  it('issues at the ruling weighted average and posts Dr Project Material Cost / Cr Inventory', async () => {
    const itemId = await makeItem(`ITEM-C1-${generateId().slice(0, 6)}`, 'WA Item');
    // 10 @ 100 then 10 @ 250 -> weighted average 175, NOT the 250 of the
    // latest purchase and not the 175 a naive mean would coincidentally give
    // here; the value proven below is quantity x the blended rate.
    await inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '10', unitCostAmount: '100.00' }] }));
    await inventory.recordReceipt(
      receiptInput({ receivedDate: '2026-03-12', lines: [{ inventoryItemId: itemId, quantity: '10', unitCostAmount: '250.00' }] }),
    );

    const consumption = await inventory.recordConsumption(
      consumptionInput({ lines: [{ inventoryItemId: itemId, quantity: '4' }] }),
    );

    expect(consumption.consumptionNumber).toMatch(/^CONS-\d{6}$/);
    expect(consumption.status).toBe('POSTED');
    expect(consumption.projectId).toBe(projectId);
    expect(consumption.totalValueAmount).toBe('700.00');

    const detail = await inventory.getConsumptionDetail({ organizationId, id: consumption.id });
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]!.unitCostAmount).toBe('175.0000');
    expect(detail.lines[0]!.lineValueAmount).toBe('700.00');

    const byAccount = await journalByAccount(consumption.journalEntryId);
    expect(byAccount.get(materialCostAccountId)!.debit.toFixed(2)).toBe('700.00');
    expect(byAccount.get(inventoryAccountId)!.credit.toFixed(2)).toBe('700.00');
    // Both legs carry the project dimension — this is what lets project
    // cost reporting read material spend straight off the journal.
    expect(byAccount.get(materialCostAccountId)!.projectId).toBe(projectId);
    expect(byAccount.get(inventoryAccountId)!.projectId).toBe(projectId);

    const balance = await ledger.getBalance(organizationId, itemId);
    expect(balance.quantity.toFixed(4)).toBe('16.0000');
    expect(balance.valueAmount.toFixed(2)).toBe('2800.00');
    // Issuing never moves the average; only a receipt does.
    expect(balance.weightedAverageRate.toFixed(4)).toBe('175.0000');
  });

  it('carries out the entire residual value on full depletion rather than stranding paise', async () => {
    const itemId = await makeItem(`ITEM-C2-${generateId().slice(0, 6)}`, 'Depleting Item');
    // 1000.00 across 3 units gives an unrepresentable 333.3333 rate.
    await inventory.recordReceipt(
      receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '3', unitCostAmount: '333.3333' }] }),
    );
    const received = await ledger.getBalance(organizationId, itemId);

    const first = await inventory.recordConsumption(consumptionInput({ lines: [{ inventoryItemId: itemId, quantity: '1' }] }));
    const second = await inventory.recordConsumption(
      consumptionInput({ consumedDate: '2026-04-11', lines: [{ inventoryItemId: itemId, quantity: '2' }] }),
    );

    const issued = new Prisma.Decimal(first.totalValueAmount).plus(second.totalValueAmount);
    expect(issued.toFixed(2)).toBe(received.valueAmount.toFixed(2));

    const balance = await ledger.getBalance(organizationId, itemId);
    expect(balance.quantity.toFixed(4)).toBe('0.0000');
    expect(balance.valueAmount.toFixed(2)).toBe('0.00');
  });

  it('collapses two lines naming the same item into one running balance', async () => {
    const itemId = await makeItem(`ITEM-C3-${generateId().slice(0, 6)}`, 'Repeated Item');
    await inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '5', unitCostAmount: '20.00' }] }));

    // 3 + 2 fully depletes 5. Valued independently against the opening
    // balance both lines would "succeed" and the item would go negative;
    // chained, the second is the depleting one.
    const consumption = await inventory.recordConsumption(
      consumptionInput({
        lines: [
          { inventoryItemId: itemId, quantity: '3' },
          { inventoryItemId: itemId, quantity: '2' },
        ],
      }),
    );
    expect(consumption.totalValueAmount).toBe('100.00');

    const balance = await ledger.getBalance(organizationId, itemId);
    expect(balance.quantity.toFixed(4)).toBe('0.0000');

    await expect(
      inventory.recordConsumption(
        consumptionInput({
          consumedDate: '2026-04-12',
          lines: [
            { inventoryItemId: itemId, quantity: '1' },
            { inventoryItemId: itemId, quantity: '1' },
          ],
        }),
      ),
    ).rejects.toThrow(/only 0\.0000 in stock/i);
  });

  it('refuses to issue more than is on hand, naming both figures', async () => {
    const itemId = await makeItem(`ITEM-C4-${generateId().slice(0, 6)}`, 'Scarce Item');
    await inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '2', unitCostAmount: '50.00' }] }));

    await expect(
      inventory.recordConsumption(consumptionInput({ lines: [{ inventoryItemId: itemId, quantity: '3' }] })),
    ).rejects.toThrow(/only 2\.0000 in stock/i);

    // Nothing partial was written — no document, and the stock is untouched.
    const balance = await ledger.getBalance(organizationId, itemId);
    expect(balance.quantity.toFixed(4)).toBe('2.0000');
    const docs = await prisma.client.inventoryConsumption.count({ where: { organizationId, consumedDate: new Date('2026-04-10T00:00:00.000Z'), lines: { some: { inventoryItemId: itemId } } } });
    expect(docs).toBe(0);
  });

  it('rejects a closed project, a mismatched legal entity, a non-stock item, an inactive item and a backdated date', async () => {
    const itemId = await makeItem(`ITEM-C5-${generateId().slice(0, 6)}`, 'Guarded Item');
    await inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '5', unitCostAmount: '10.00' }] }));

    await expect(
      inventory.recordConsumption(consumptionInput({ projectId: closedProjectId, lines: [{ inventoryItemId: itemId, quantity: '1' }] })),
    ).rejects.toThrow(/closed and can no longer be charged/i);

    const otherEntity = await prisma.client.legalEntity.create({
      data: { id: generateId(), organizationId, legalName: 'Other Entity', panNumber: 'OTHCD1234P', registeredAddress: 'Ahmedabad, Gujarat' },
    });
    await expect(
      inventory.recordConsumption(
        consumptionInput({ legalEntityId: otherEntity.id, lines: [{ inventoryItemId: itemId, quantity: '1' }] }),
      ),
    ).rejects.toThrow(/project's own legal entity/i);

    await expect(
      inventory.recordConsumption(consumptionInput({ lines: [{ inventoryItemId: nonStockItemId, quantity: '1' }] })),
    ).rejects.toThrow(/not a stock-tracked item/i);

    await expect(
      inventory.recordConsumption(consumptionInput({ lines: [{ inventoryItemId: inactiveItemId, quantity: '1' }] })),
    ).rejects.toThrow(/is inactive/i);

    await expect(
      inventory.recordConsumption(
        consumptionInput({ consumedDate: '2026-01-05', lines: [{ inventoryItemId: itemId, quantity: '1' }] }),
      ),
    ).rejects.toThrow(/cannot be backdated/i);

    await expect(
      inventory.recordConsumption(consumptionInput({ lines: [{ inventoryItemId: itemId, quantity: '0' }] })),
    ).rejects.toThrow(/greater than zero/i);
  });

  it('is idempotent on replay and rejects a reused key carrying a different request', async () => {
    const itemId = await makeItem(`ITEM-C6-${generateId().slice(0, 6)}`, 'Idempotent Item');
    await inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '10', unitCostAmount: '10.00' }] }));

    const key = generateId();
    const first = await inventory.recordConsumption(
      consumptionInput({ idempotencyKey: key, lines: [{ inventoryItemId: itemId, quantity: '2' }] }),
    );
    const replay = await inventory.recordConsumption(
      consumptionInput({ idempotencyKey: key, lines: [{ inventoryItemId: itemId, quantity: '2' }] }),
    );
    expect(replay.id).toBe(first.id);

    // The replay must not have issued the stock a second time.
    const balance = await ledger.getBalance(organizationId, itemId);
    expect(balance.quantity.toFixed(4)).toBe('8.0000');

    await expect(
      inventory.recordConsumption(
        consumptionInput({ idempotencyKey: key, lines: [{ inventoryItemId: itemId, quantity: '3' }] }),
      ),
    ).rejects.toThrow(/different request/i);
  });

  it('reverses by returning the stock at the cost it left at, and refuses a second reversal', async () => {
    const itemId = await makeItem(`ITEM-C7-${generateId().slice(0, 6)}`, 'Reversible Item');
    await inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '10', unitCostAmount: '40.00' }] }));

    const consumption = await inventory.recordConsumption(
      consumptionInput({ lines: [{ inventoryItemId: itemId, quantity: '4' }] }),
    );
    expect(consumption.totalValueAmount).toBe('160.00');

    // A later receipt at a different cost moves the average BEFORE the
    // reversal — the returned units must still come back at 40, the cost
    // they actually left at, or stock value stops reconciling.
    await inventory.recordReceipt(
      receiptInput({ receivedDate: '2026-04-11', lines: [{ inventoryItemId: itemId, quantity: '6', unitCostAmount: '90.00' }] }),
    );

    const reversed = await inventory.reverseConsumption({
      organizationId,
      id: consumption.id,
      expectedVersion: consumption.version,
      reason: 'Issued against the wrong project',
      accountingDate: '2026-04-12',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.reversalJournalEntryId).not.toBeNull();

    const original = await prisma.client.journalEntry.findFirstOrThrow({ where: { id: consumption.journalEntryId } });
    expect(original.status).toBe('REVERSED');

    const returnMovement = await prisma.client.inventoryMovement.findFirstOrThrow({
      where: { organizationId, inventoryItemId: itemId, movementType: 'REVERSAL' },
      orderBy: { sequenceNumber: 'desc' },
    });
    expect(returnMovement.unitCostAmount.toFixed(4)).toBe('40.0000');
    expect(returnMovement.movementValueAmount.toFixed(2)).toBe('160.00');

    await expect(
      inventory.reverseConsumption({
        organizationId, id: consumption.id, expectedVersion: reversed.version, reason: 'Again',
        accountingDate: '2026-04-13', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/already reversed/i);

    await expect(
      inventory.reverseConsumption({
        organizationId, id: consumption.id, expectedVersion: consumption.version, reason: '  ',
        accountingDate: '2026-04-13', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/reason is required/i);
  });

  it('previews the same figures it would post, and flags a shortfall without throwing', async () => {
    const itemId = await makeItem(`ITEM-C8-${generateId().slice(0, 6)}`, 'Preview Item');
    await inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '8', unitCostAmount: '12.50' }] }));

    const preview = await inventory.previewConsumption({
      organizationId,
      lines: [{ inventoryItemId: itemId, quantity: '3' }],
    });
    expect(preview.isPostable).toBe(true);
    expect(preview.lines[0]!.weightedAverageRate).toBe('12.5000');
    expect(preview.lines[0]!.quantityOnHand).toBe('8.0000');
    expect(preview.totalValueAmount).toBe('37.50');

    const posted = await inventory.recordConsumption(
      consumptionInput({ lines: [{ inventoryItemId: itemId, quantity: '3' }] }),
    );
    // The quote and the posted figure come from the same code path.
    expect(posted.totalValueAmount).toBe(preview.totalValueAmount);

    const short = await inventory.previewConsumption({
      organizationId,
      lines: [{ inventoryItemId: itemId, quantity: '99' }],
    });
    expect(short.isPostable).toBe(false);
    expect(short.lines[0]!.shortfallMessage).toMatch(/only 5\.0000 in stock/i);
  });

  it('names the consumption and its project on the item ledger, and lists by project', async () => {
    const itemId = await makeItem(`ITEM-C9-${generateId().slice(0, 6)}`, 'Traceable Item');
    await inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '4', unitCostAmount: '15.00' }] }));
    const consumption = await inventory.recordConsumption(
      consumptionInput({ lines: [{ inventoryItemId: itemId, quantity: '1' }] }),
    );

    const itemLedger = await inventory.getItemLedger({ organizationId, inventoryItemId: itemId, fromDate: undefined, toDate: undefined });
    const outRow = itemLedger.movements.find((m) => m.movementType === 'CONSUMPTION')!;
    expect(outRow.inventoryConsumptionId).toBe(consumption.id);
    expect(outRow.inventoryConsumptionNumber).toBe(consumption.consumptionNumber);
    expect(outRow.projectId).toBe(projectId);
    expect(outRow.sourceLabel).toContain(consumption.consumptionNumber);
    expect(outRow.sourceLabel).toContain('Inv Test Project');

    const listed = await inventory.listConsumptions({
      organizationId, page: 1, pageSize: 100, filters: { projectId, status: 'POSTED' },
    });
    expect(listed.rows.some((r) => r.id === consumption.id)).toBe(true);

    const otherProjectOnly = await inventory.listConsumptions({
      organizationId, page: 1, pageSize: 100, filters: { projectId: closedProjectId, status: undefined },
    });
    expect(otherProjectOnly.rows.some((r) => r.id === consumption.id)).toBe(false);
  });

  it('never returns another organization’s consumption', async () => {
    const itemId = await makeItem(`ITEM-C10-${generateId().slice(0, 6)}`, 'Isolated Item');
    await inventory.recordReceipt(receiptInput({ lines: [{ inventoryItemId: itemId, quantity: '2', unitCostAmount: '5.00' }] }));
    const consumption = await inventory.recordConsumption(
      consumptionInput({ lines: [{ inventoryItemId: itemId, quantity: '1' }] }),
    );

    await expect(
      inventory.getConsumptionDetail({ organizationId: otherOrganizationId, id: consumption.id }),
    ).rejects.toThrow(/not found/i);

    const listed = await inventory.listConsumptions({
      organizationId: otherOrganizationId, page: 1, pageSize: 100, filters: { projectId: undefined, status: undefined },
    });
    expect(listed.rows).toHaveLength(0);
  });
});

describe('InventoryService — stock value reconciles to the Inventory ledger account', () => {
  it('keeps the INVENTORY account balance equal to the sum of every item’s movement snapshot', async () => {
    // Phase 7's own exit criterion, asserted over everything this suite has
    // posted so far — receipts at several costs, an opening receipt, a
    // reversal, and a consumption.
    const accountBalance = await inventoryAccountBalance();
    const stockValue = await totalStockValue();

    // The one deliberate difference: this suite writes a couple of raw
    // CONSUMPTION movements straight through the ledger service, with no
    // document and therefore no journal, to exercise guards that are
    // independent of the consumption document. Those reduce stock value
    // without reducing the account. Real consumptions (inventoryConsumptionId
    // set) post their own Cr Inventory and must NOT be excluded — they are
    // precisely what the exit criterion is about.
    const consumptionMovements = await prisma.client.inventoryMovement.findMany({
      where: { organizationId, movementType: 'CONSUMPTION', inventoryConsumptionId: null },
    });
    const unpostedConsumption = consumptionMovements.reduce(
      (sum, m) => sum.plus(m.movementValueAmount),
      new Prisma.Decimal(0),
    );

    expect(stockValue.plus(unpostedConsumption).toFixed(2)).toBe(accountBalance.toFixed(2));
  });
});

describe('InventoryService — reads and cross-org isolation', () => {
  it('reports total in/out, on-hand and stock value per item', async () => {
    const result = await inventory.listStock({
      organizationId,
      page: 1,
      pageSize: 100,
      filters: { search: 'RJ45', productCategoryId: undefined, inStockOnly: undefined },
    });
    const row = result.rows.find((r) => r.inventoryItemId === itemBId)!;
    expect(row.totalQuantityIn).toBe('40.0000');
    expect(row.totalQuantityOut).toBe('0.0000');
    expect(row.quantityOnHand).toBe('40.0000');
    expect(row.stockValueAmount).toBe('7000.00');
    expect(row.weightedAverageRate).toBe('175.0000');
  });

  it('excludes non-stock-tracked items from the stock list entirely', async () => {
    const result = await inventory.listStock({
      organizationId, page: 1, pageSize: 100,
      filters: { search: undefined, productCategoryId: undefined, inStockOnly: undefined },
    });
    expect(result.rows.some((r) => r.inventoryItemId === nonStockItemId)).toBe(false);
  });

  it('returns the item ledger with a running balance, and a date filter never changes the reported on-hand figure', async () => {
    const full = await inventory.getItemLedger({ organizationId, inventoryItemId: itemBId, fromDate: undefined, toDate: undefined });
    expect(full.movements).toHaveLength(2);
    expect(full.movements[0]!.balanceQuantity).toBe('10.0000');
    expect(full.movements[1]!.balanceQuantity).toBe('40.0000');
    expect(full.movements[0]!.sourceLabel).toMatch(/^Stock Receipt STK-/);

    // docs/04:463 — filters must not recompute opening/closing values.
    const filtered = await inventory.getItemLedger({ organizationId, inventoryItemId: itemBId, fromDate: '2026-03-12', toDate: undefined });
    expect(filtered.movements).toHaveLength(1);
    expect(filtered.quantityOnHand).toBe(full.quantityOnHand);
    expect(filtered.stockValueAmount).toBe(full.stockValueAmount);
  });

  it("never returns another organization's receipt or item ledger", async () => {
    const mine = await inventory.recordReceipt(
      receiptInput({ lines: [{ inventoryItemId: itemAId, quantity: '1', unitCostAmount: '1.00' }] }),
    );
    await expect(inventory.getReceiptDetail({ organizationId: otherOrganizationId, id: mine.id })).rejects.toThrow(/not found/i);
    await expect(
      inventory.getItemLedger({ organizationId: otherOrganizationId, inventoryItemId: itemAId, fromDate: undefined, toDate: undefined }),
    ).rejects.toThrow(/not found/i);

    const theirs = await inventory.listReceipts({
      organizationId: otherOrganizationId, page: 1, pageSize: 100,
      filters: { receiptType: undefined, status: undefined },
    });
    expect(theirs.total).toBe(0);
  });
});
