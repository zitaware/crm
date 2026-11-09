import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { PostingService } from './posting.service';

const prisma = new PrismaService();
const financialYears = new FinancialYearService(prisma);
const posting = new PostingService(prisma);

let organizationId: string;
let otherOrganizationId: string;
let legalEntityId: string;
let bankAccountId: string;
let revenueAccountId: string;
let inactiveAccountId: string;
let nonPostableAccountId: string;
let lockedPeriodStart: string;
const actorId = generateId();

async function post(overrides: Partial<Parameters<typeof posting.postJournal>[0]> = {}) {
  return posting.postJournal({
    organizationId,
    legalEntityId,
    accountingDate: '2026-01-15',
    sourceType: 'TEST_EVENT',
    sourceId: generateId(),
    postingEvent: 'Test posting',
    description: undefined,
    lines: [
      { ledgerAccountId: bankAccountId, debit: '1000', credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
      { ledgerAccountId: revenueAccountId, debit: '0', credit: '1000', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
    ],
    idempotencyKey: generateId(),
    actorId,
    correlationId: generateId(),
    ...overrides,
  });
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Posting Test Org', code: `POSTTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Posting Test Other Org', code: `POSTTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  await prisma.client.user.create({
    data: { id: actorId, organizationId, email: 'posting-actor@zitaware.test', passwordHash: 'test-hash', displayName: 'Posting Actor', status: 'ACTIVE' },
  });

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Posting Legal Entity', panNumber: 'ABCPP5678P', registeredAddress: 'Ahmedabad, Gujarat' },
  });
  legalEntityId = legalEntity.id;

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

  const assetRoot = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const incomeRoot = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INCOME', name: 'Income', accountType: 'INCOME', normalBalance: 'CREDIT', isSystemDefined: true },
  });

  const bankAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetRoot.id, code: 'BANK', name: 'Bank', allowManualPosting: true, isActive: true },
  });
  bankAccountId = bankAccount.id;

  const revenueAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: incomeRoot.id, code: 'REVENUE', name: 'Revenue', allowManualPosting: true, isActive: true },
  });
  revenueAccountId = revenueAccount.id;

  const inactiveAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetRoot.id, code: 'INACTIVE_ACCT', name: 'Inactive Account', allowManualPosting: true, isActive: false },
  });
  inactiveAccountId = inactiveAccount.id;

  const nonPostableAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetRoot.id, code: 'CONTROL_ACCT', name: 'Control Account', allowManualPosting: false, isActive: true },
  });
  nonPostableAccountId = nonPostableAccount.id;

  // Lock the February period (2026-02) for the period-lock rejection test.
  const periods = await prisma.client.accountingPeriod.findMany({
    where: { organizationId, financialYear: { legalEntityId } },
    orderBy: { periodNumber: 'asc' },
  });
  const febPeriod = periods[1]!;
  lockedPeriodStart = febPeriod.startDate.toISOString().slice(0, 10);
  await financialYears.transitionAccountingPeriod({ organizationId, accountingPeriodId: febPeriod.id, action: 'SOFT_CLOSE', reason: 'Test lock setup', actorId, correlationId: generateId() });
  await financialYears.transitionAccountingPeriod({ organizationId, accountingPeriodId: febPeriod.id, action: 'LOCK', reason: 'Test lock setup', actorId, correlationId: generateId() });
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.accountingPeriodTransition.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.$disconnect();
});

describe('PostingService.postJournal', () => {
  it('posts a balanced multi-line journal and it is retrievable via listEntries/getEntryDetail', async () => {
    const sourceId = generateId();
    const result = await post({ sourceId, description: 'A balanced test posting' });
    expect(result.status).toBe('POSTED');
    expect(result.totalAmount).toBe('1000.00');

    const { rows, total } = await posting.listEntries({ organizationId, page: 1, pageSize: 25, filters: {} });
    expect(total).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.id === result.id)).toBe(true);

    const detail = await posting.getEntryDetail({ organizationId, id: result.id });
    expect(detail.lines).toHaveLength(2);
    const debitLine = detail.lines.find((l) => Number(l.debitAmount) > 0)!;
    expect(debitLine.ledgerAccountCode).toBe('BANK');

    const auditEvent = await prisma.client.auditEvent.findFirst({ where: { entityType: 'JOURNAL_ENTRY', entityId: result.id, action: 'JOURNAL_POSTED' } });
    expect(auditEvent).not.toBeNull();
    expect((auditEvent?.newValues as { totalAmount: string }).totalAmount).toBe('1000.00');
  });

  it('rejects a journal with zero lines', async () => {
    await expect(post({ lines: [] })).rejects.toThrow('at least one line');
  });

  it('rejects a negative debit or credit amount', async () => {
    await expect(
      post({
        lines: [
          { ledgerAccountId: bankAccountId, debit: '-100', credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
          { ledgerAccountId: revenueAccountId, debit: '0', credit: '100', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        ],
      }),
    ).rejects.toThrow('must not be negative');
  });

  it('rejects a line with both debit and credit set', async () => {
    await expect(
      post({
        lines: [
          { ledgerAccountId: bankAccountId, debit: '100', credit: '100', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        ],
      }),
    ).rejects.toThrow('exactly one of debit or credit');
  });

  it('rejects a line with neither debit nor credit set', async () => {
    await expect(
      post({
        lines: [
          { ledgerAccountId: bankAccountId, debit: '0', credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        ],
      }),
    ).rejects.toThrow('exactly one of debit or credit');
  });

  it('rejects an unbalanced journal', async () => {
    await expect(
      post({
        lines: [
          { ledgerAccountId: bankAccountId, debit: '1000', credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
          { ledgerAccountId: revenueAccountId, debit: '0', credit: '900', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        ],
      }),
    ).rejects.toThrow('unbalanced');
  });

  it('rejects posting into a LOCKED accounting period', async () => {
    await expect(post({ accountingDate: `${lockedPeriodStart.slice(0, 8)}15` })).rejects.toThrow('locked');
  });

  it('accepts posting into a SOFT_CLOSED period (confirmed with the user — decision 4)', async () => {
    const janPeriod = await prisma.client.accountingPeriod.findFirst({ where: { organizationId, financialYear: { legalEntityId }, periodNumber: 1 } });
    await financialYears.transitionAccountingPeriod({ organizationId, accountingPeriodId: janPeriod!.id, action: 'SOFT_CLOSE', reason: 'Soft-close test', actorId, correlationId: generateId() });

    const result = await post({ accountingDate: '2026-01-20', sourceId: generateId() });
    expect(result.status).toBe('POSTED');
  });

  it('rejects posting with no accounting period covering the date', async () => {
    await expect(post({ accountingDate: '2030-01-01' })).rejects.toThrow('No accounting period covers');
  });

  it('rejects posting to an inactive ledger account', async () => {
    await expect(
      post({
        lines: [
          { ledgerAccountId: inactiveAccountId, debit: '100', credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
          { ledgerAccountId: revenueAccountId, debit: '0', credit: '100', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        ],
      }),
    ).rejects.toThrow('inactive');
  });

  it('rejects posting to a ledger account with allowManualPosting=false', async () => {
    await expect(
      post({
        lines: [
          { ledgerAccountId: nonPostableAccountId, debit: '100', credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
          { ledgerAccountId: revenueAccountId, debit: '0', credit: '100', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        ],
      }),
    ).rejects.toThrow('does not allow postings');
  });

  it('a repeat call with the same idempotency key and identical request returns the original entry, not a second one', async () => {
    const idempotencyKey = generateId();
    const sourceId = generateId();
    const first = await post({ idempotencyKey, sourceId });
    const second = await post({ idempotencyKey, sourceId });
    expect(second.id).toBe(first.id);

    const count = await prisma.client.journalEntry.count({ where: { organizationId, sourceId } });
    expect(count).toBe(1);
  });

  it('a repeat call with the same idempotency key but a different request throws IDEMPOTENCY_CONFLICT', async () => {
    const idempotencyKey = generateId();
    await post({ idempotencyKey, sourceId: generateId(), postingEvent: 'First version' });
    await expect(post({ idempotencyKey, sourceId: generateId(), postingEvent: 'Different version' })).rejects.toThrow('different request');
  });

  it('rejects a duplicate (organizationId, sourceType, sourceId) even with a different idempotency key', async () => {
    const sourceId = generateId();
    await post({ sourceId });
    await expect(post({ sourceId, idempotencyKey: generateId() })).rejects.toThrow('already exists for this source event');
  });

  it('never posts against a different organization\'s legal entity', async () => {
    await expect(post({ organizationId: otherOrganizationId })).rejects.toThrow();
  });
});

describe('PostingService.getLedgerActivity', () => {
  it('computes a correct running balance across a sequence of debits and credits', async () => {
    const freshAssetGroup = await prisma.client.accountGroup.create({
      data: { id: generateId(), organizationId, code: `ASSET_LEDGER_TEST_${generateId()}`, name: 'Ledger Test Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: false },
    });
    const account = await prisma.client.ledgerAccount.create({
      data: { id: generateId(), organizationId, accountGroupId: freshAssetGroup.id, code: `LEDGER_TEST_${generateId()}`, name: 'Ledger Test Account', allowManualPosting: true, isActive: true },
    });

    await post({
      sourceId: generateId(),
      lines: [
        { ledgerAccountId: account.id, debit: '500', credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        { ledgerAccountId: revenueAccountId, debit: '0', credit: '500', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
      ],
    });
    await post({
      sourceId: generateId(),
      lines: [
        { ledgerAccountId: bankAccountId, debit: '200', credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        { ledgerAccountId: account.id, debit: '0', credit: '200', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
      ],
    });

    const activity = await posting.getLedgerActivity({ organizationId, ledgerAccountId: account.id, legalEntityId: undefined, dateFrom: undefined, dateTo: undefined });
    expect(activity.rows).toHaveLength(2);
    expect(activity.rows[0]!.runningBalance).toBe('500.00');
    expect(activity.rows[1]!.runningBalance).toBe('300.00');
    expect(activity.closingBalance).toBe('300.00');
  });
});

describe('PostingService.reverseJournal', () => {
  async function reverse(overrides: Partial<Parameters<typeof posting.reverseJournal>[0]> = {}) {
    return posting.reverseJournal({
      organizationId,
      id: '',
      accountingDate: '2026-04-15',
      reason: 'Test reversal',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
      ...overrides,
    });
  }

  it('reverses a POSTED entry: creates a correctly opposite-signed new entry referencing the original, flips the original to REVERSED with reason/actor/timestamp, and records a full audit trail on both', async () => {
    const original = await post({ sourceId: generateId(), description: 'Original entry to reverse' });

    const reversal = await reverse({ id: original.id, reason: 'Wrong account selected' });
    expect(reversal.status).toBe('POSTED');
    expect(reversal.reversalOfJournalEntryId).toBe(original.id);
    expect(reversal.sourceType).toBe('journal_entry_reversal');
    expect(reversal.sourceId).toBe(original.id);
    expect(reversal.totalAmount).toBe(original.totalAmount);

    const reversalDetail = await posting.getEntryDetail({ organizationId, id: reversal.id });
    const originalDetail = await posting.getEntryDetail({ organizationId, id: original.id });
    expect(originalDetail.status).toBe('REVERSED');
    expect(originalDetail.reversalReason).toBe('Wrong account selected');
    expect(originalDetail.reversedBy).toBe(actorId);
    expect(originalDetail.reversedAt).not.toBeNull();
    expect(originalDetail.reversedByJournalEntryId).toBe(reversal.id);

    // Every original line's debit/credit is exchanged on the reversal.
    for (const originalLine of originalDetail.lines) {
      const mirror = reversalDetail.lines.find((l) => l.ledgerAccountId === originalLine.ledgerAccountId)!;
      expect(mirror.debitAmount).toBe(originalLine.creditAmount);
      expect(mirror.creditAmount).toBe(originalLine.debitAmount);
    }

    const reversalAudit = await prisma.client.auditEvent.findFirst({ where: { entityType: 'JOURNAL_ENTRY', entityId: reversal.id, action: 'JOURNAL_POSTED' } });
    expect(reversalAudit).not.toBeNull();
    const originalAudit = await prisma.client.auditEvent.findFirst({ where: { entityType: 'JOURNAL_ENTRY', entityId: original.id, action: 'JOURNAL_REVERSED' } });
    expect(originalAudit).not.toBeNull();
  });

  it('rejects reversing an already-REVERSED entry', async () => {
    const original = await post({ sourceId: generateId() });
    await reverse({ id: original.id });
    await expect(reverse({ id: original.id, idempotencyKey: generateId() })).rejects.toThrow('Only a posted journal entry can be reversed');
  });

  it('rejects an empty/whitespace-only reason', async () => {
    const original = await post({ sourceId: generateId() });
    await expect(reverse({ id: original.id, reason: '   ' })).rejects.toThrow('A reason is required');
  });

  it('rejects reversing into a LOCKED period (for the reversal\'s own accounting date)', async () => {
    const original = await post({ sourceId: generateId() });
    await expect(reverse({ id: original.id, accountingDate: `${lockedPeriodStart.slice(0, 8)}15` })).rejects.toThrow('locked');
  });

  it('a duplicate idempotency-key reversal returns the original result, not a second one', async () => {
    const original = await post({ sourceId: generateId() });
    const idempotencyKey = generateId();
    const first = await reverse({ id: original.id, idempotencyKey });
    const second = await reverse({ id: original.id, idempotencyKey });
    expect(second.id).toBe(first.id);

    const count = await prisma.client.journalEntry.count({ where: { organizationId, sourceType: 'journal_entry_reversal', sourceId: original.id } });
    expect(count).toBe(1);
  });

  it('the same idempotency key with a different request throws IDEMPOTENCY_CONFLICT', async () => {
    const original = await post({ sourceId: generateId() });
    const idempotencyKey = generateId();
    await reverse({ id: original.id, idempotencyKey, reason: 'First reason' });
    await expect(reverse({ id: original.id, idempotencyKey, reason: 'Different reason' })).rejects.toThrow('different request');
  });

  it("still succeeds when the original entry's own period has since been LOCKED — only the reversal's own date's period matters", async () => {
    const marchPeriod = await prisma.client.accountingPeriod.findFirst({ where: { organizationId, financialYear: { legalEntityId }, periodNumber: 3 } });
    const original = await post({ sourceId: generateId(), accountingDate: '2026-03-10' });

    await financialYears.transitionAccountingPeriod({ organizationId, accountingPeriodId: marchPeriod!.id, action: 'SOFT_CLOSE', reason: 'Lock for reversal test', actorId, correlationId: generateId() });
    await financialYears.transitionAccountingPeriod({ organizationId, accountingPeriodId: marchPeriod!.id, action: 'LOCK', reason: 'Lock for reversal test', actorId, correlationId: generateId() });

    const reversal = await reverse({ id: original.id, accountingDate: '2026-04-20' });
    expect(reversal.status).toBe('POSTED');
  });

  it('post → reverse round-trip: getLedgerActivity nets every affected ledger account back to its pre-posting balance', async () => {
    const before = await posting.getLedgerActivity({ organizationId, ledgerAccountId: bankAccountId, legalEntityId: undefined, dateFrom: undefined, dateTo: undefined });

    const original = await post({ sourceId: generateId() });
    await reverse({ id: original.id });

    const after = await posting.getLedgerActivity({ organizationId, ledgerAccountId: bankAccountId, legalEntityId: undefined, dateFrom: undefined, dateTo: undefined });
    expect(after.closingBalance).toBe(before.closingBalance);
  });

  it('reversing a reversal is itself accepted, creating a second, valid reversal entry', async () => {
    const original = await post({ sourceId: generateId() });
    const reversal = await reverse({ id: original.id });

    const reReversal = await reverse({ id: reversal.id, idempotencyKey: generateId() });
    expect(reReversal.status).toBe('POSTED');
    expect(reReversal.reversalOfJournalEntryId).toBe(reversal.id);

    const reversalDetail = await posting.getEntryDetail({ organizationId, id: reversal.id });
    expect(reversalDetail.status).toBe('REVERSED');
  });
});
