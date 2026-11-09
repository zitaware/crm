import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { PostingService } from '../accounting/posting.service';
import { LedgerOpeningBalancesService } from './ledger-opening-balances.service';

const prisma = new PrismaService();
const financialYears = new FinancialYearService(prisma);
const posting = new PostingService(prisma);
const openingBalances = new LedgerOpeningBalancesService(prisma, posting);

let organizationId: string;
let otherOrganizationId: string;
let legalEntityAId: string;
let legalEntityBId: string;
let bankAccountId: string; // DEBIT-normal (Asset)
let payableAccountId: string; // CREDIT-normal (Liability)
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Opening Balance Test Org', code: `OBTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Opening Balance Test Other Org', code: `OBTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  await prisma.client.user.create({
    data: { id: actorId, organizationId, email: 'opening-balance-actor@zitaware.test', passwordHash: 'test-hash', displayName: 'Opening Balance Actor', status: 'ACTIVE' },
  });

  const legalEntityA = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Opening Balance Legal Entity A', panNumber: 'ABCPO1111P', registeredAddress: 'Ahmedabad, Gujarat' },
  });
  legalEntityAId = legalEntityA.id;

  const legalEntityB = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Opening Balance Legal Entity B', panNumber: 'ABCPO2222P', registeredAddress: 'Surat, Gujarat' },
  });
  legalEntityBId = legalEntityB.id;

  await financialYears.create({
    organizationId,
    legalEntityId: legalEntityAId,
    label: 'FY2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    setCurrent: true,
    actorId,
    correlationId: generateId(),
  });
  await financialYears.create({
    organizationId,
    legalEntityId: legalEntityBId,
    label: 'FY2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    setCurrent: true,
    actorId,
    correlationId: generateId(),
  });

  const assetRoot = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const liabilityRoot = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  const equityRoot = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'EQUITY', name: 'Equity', accountType: 'EQUITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });

  const bankAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetRoot.id, code: 'OB_BANK', name: 'Bank', allowManualPosting: true, isActive: true },
  });
  bankAccountId = bankAccount.id;

  const payableAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: liabilityRoot.id, code: 'OB_PAYABLE', name: 'Accounts Payable', allowManualPosting: true, isActive: true },
  });
  payableAccountId = payableAccount.id;

  // Resolved by code inside LedgerOpeningBalancesService.set -- no id needed by this file's own tests.
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: equityRoot.id, code: 'OPENING_BALANCE_EQUITY', name: 'Opening Balance Equity', allowManualPosting: true, isActive: true },
  });
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerOpeningBalance.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('LedgerOpeningBalancesService', () => {
  it('set posts Dr account / Cr equity for a positive amount on a debit-normal account', async () => {
    const result = await openingBalances.set({
      organizationId,
      legalEntityId: legalEntityAId,
      ledgerAccountId: bankAccountId,
      asOfDate: '2026-01-01',
      amount: '50000',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.amount).toBe('50000.00');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: result.journalEntryId });
    const bankLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'OB_BANK')!;
    const equityLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'OPENING_BALANCE_EQUITY')!;
    expect(bankLine.debitAmount).toBe('50000.00');
    expect(bankLine.creditAmount).toBe('0.00');
    expect(equityLine.creditAmount).toBe('50000.00');
    expect(equityLine.debitAmount).toBe('0.00');
  });

  it('set posts Cr account / Dr equity for a positive amount on a credit-normal account', async () => {
    const result = await openingBalances.set({
      organizationId,
      legalEntityId: legalEntityAId,
      ledgerAccountId: payableAccountId,
      asOfDate: '2026-01-01',
      amount: '30000',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(result.status).toBe('ACTIVE');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: result.journalEntryId });
    const payableLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'OB_PAYABLE')!;
    const equityLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'OPENING_BALANCE_EQUITY')!;
    expect(payableLine.creditAmount).toBe('30000.00');
    expect(equityLine.debitAmount).toBe('30000.00');
  });

  it('a negative (abnormal-side) amount posts the flipped direction', async () => {
    // A negative opening balance on a debit-normal account means it's
    // sitting on its abnormal (credit) side -- e.g. an overdrawn bank
    // account. Use legal entity B so it doesn't collide with entity A's
    // already-active bank-account opening balance above.
    const result = await openingBalances.set({
      organizationId,
      legalEntityId: legalEntityBId,
      ledgerAccountId: bankAccountId,
      asOfDate: '2026-01-01',
      amount: '-5000',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(result.amount).toBe('-5000.00');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: result.journalEntryId });
    const bankLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'OB_BANK')!;
    const equityLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'OPENING_BALANCE_EQUITY')!;
    expect(bankLine.creditAmount).toBe('5000.00');
    expect(bankLine.debitAmount).toBe('0.00');
    expect(equityLine.debitAmount).toBe('5000.00');
  });

  it('rejects a second set while one is already ACTIVE for the same legal entity + account', async () => {
    // legalEntityA + bankAccountId already has an ACTIVE opening balance
    // from the first test above.
    await expect(
      openingBalances.set({
        organizationId,
        legalEntityId: legalEntityAId,
        ledgerAccountId: bankAccountId,
        asOfDate: '2026-01-01',
        amount: '1000',
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already active');
  });

  it('void reverses the journal and then permits a fresh set', async () => {
    // payableAccountId + legalEntityA already has an ACTIVE opening
    // balance from an earlier test -- void it, then prove a fresh set works.
    const existing = await openingBalances.getForAccount({ organizationId, legalEntityId: legalEntityAId, ledgerAccountId: payableAccountId });
    expect(existing).not.toBeNull();

    const voided = await openingBalances.void({
      organizationId,
      id: existing!.id,
      reason: 'Correcting the figure',
      accountingDate: '2026-01-02',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(voided.status).toBe('VOID');
    expect(voided.voidJournalEntryId).not.toBeNull();

    const reversalDetail = await posting.getEntryDetail({ organizationId, id: voided.voidJournalEntryId! });
    expect(reversalDetail.reversalOfJournalEntryId).toBe(voided.journalEntryId);

    const noLongerActive = await openingBalances.getForAccount({ organizationId, legalEntityId: legalEntityAId, ledgerAccountId: payableAccountId });
    expect(noLongerActive).toBeNull();

    const fresh = await openingBalances.set({
      organizationId,
      legalEntityId: legalEntityAId,
      ledgerAccountId: payableAccountId,
      asOfDate: '2026-01-01',
      amount: '35000',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(fresh.status).toBe('ACTIVE');
    expect(fresh.amount).toBe('35000.00');
  });

  it("getLedgerActivity's legalEntityId filter excludes another legal entity's opening balance from both the running balance and the prior-lines sum", async () => {
    // legalEntityA's bank account has +50000 (from the first test);
    // legalEntityB's bank account has -5000 (from the abnormal-side test).
    // Both share the same ledgerAccountId (bankAccountId) but must never
    // mix.
    const entityAActivity = await posting.getLedgerActivity({
      organizationId,
      ledgerAccountId: bankAccountId,
      legalEntityId: legalEntityAId,
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(entityAActivity.closingBalance).toBe('50000.00');

    const entityBActivity = await posting.getLedgerActivity({
      organizationId,
      ledgerAccountId: bankAccountId,
      legalEntityId: legalEntityBId,
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(entityBActivity.closingBalance).toBe('-5000.00');

    // The dateFrom-driven prior-lines-sum branch also respects the filter.
    const entityAOpeningAsOfLater = await posting.getLedgerActivity({
      organizationId,
      ledgerAccountId: bankAccountId,
      legalEntityId: legalEntityAId,
      dateFrom: '2026-06-01',
      dateTo: undefined,
    });
    expect(entityAOpeningAsOfLater.openingBalance).toBe('50000.00');

    // Omitting legalEntityId keeps today's original all-entities behavior
    // (both entities' bank-account activity summed together): 50000 + (-5000) = 45000.
    const allEntitiesActivity = await posting.getLedgerActivity({
      organizationId,
      ledgerAccountId: bankAccountId,
      legalEntityId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(allEntitiesActivity.closingBalance).toBe('45000.00');
  });

  it('rejects setting a zero amount', async () => {
    await expect(
      openingBalances.set({
        organizationId,
        legalEntityId: legalEntityBId,
        ledgerAccountId: payableAccountId,
        asOfDate: '2026-01-01',
        amount: '0',
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('must not be zero');
  });

  it('a duplicate idempotency-key set call returns the original record, not a second one', async () => {
    const key = generateId();
    const first = await openingBalances.set({
      organizationId,
      legalEntityId: legalEntityBId,
      ledgerAccountId: payableAccountId,
      asOfDate: '2026-01-01',
      amount: '9000',
      idempotencyKey: key,
      actorId,
      correlationId: generateId(),
    });
    const second = await openingBalances.set({
      organizationId,
      legalEntityId: legalEntityBId,
      ledgerAccountId: payableAccountId,
      asOfDate: '2026-01-01',
      amount: '9000',
      idempotencyKey: key,
      actorId,
      correlationId: generateId(),
    });
    expect(second.id).toBe(first.id);
  });

  it('does not leak opening balances across organizations', async () => {
    const result = await openingBalances.getForAccount({ organizationId: otherOrganizationId, legalEntityId: legalEntityAId, ledgerAccountId: bankAccountId });
    expect(result).toBeNull();
  });
});
