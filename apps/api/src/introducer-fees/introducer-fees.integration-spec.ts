import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { PostingService } from '../accounting/posting.service';
import { IntroducerFeesService } from './introducer-fees.service';

const prisma = new PrismaService();
const financialYears = new FinancialYearService(prisma);
const posting = new PostingService(prisma);
const introducerFees = new IntroducerFeesService(prisma, posting);

let organizationId: string;
let otherOrganizationId: string;
let legalEntityId: string;
let bankAccountId: string;
let introducerAId: string;
let introducerBId: string;
let inactiveIntroducerId: string;
let percentProjectId: string;
let fixedProjectId: string;
let valuelessProjectId: string;
let expenseAccountId: string;
let payableAccountId: string;
let advanceAccountId: string;
let tdsAccountId: string;
let bankLedgerAccountId: string;
const actorId = generateId();

async function balance(ledgerAccountId: string): Promise<Prisma.Decimal> {
  const lines = await prisma.client.journalLine.findMany({ where: { organizationId, ledgerAccountId } });
  return lines.reduce((s, l) => s.plus(l.debitAmount).minus(l.creditAmount), new Prisma.Decimal(0));
}

beforeAll(async () => {
  const org = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Introducer Test Org', code: `INTTEST-${generateId()}` },
  });
  organizationId = org.id;
  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Introducer Other Org', code: `INTOTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Int Test Legal Entity', panNumber: 'INTCD1234P', registeredAddress: 'Gandhinagar, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  await financialYears.create({
    organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31',
    setCurrent: true, actorId, correlationId: generateId(),
  });

  const assetGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INT_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const liabilityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INT_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  const expenseGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INT_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true },
  });

  const mk = async (groupId: string, code: string, name: string) =>
    (await prisma.client.ledgerAccount.create({
      data: { id: generateId(), organizationId, accountGroupId: groupId, code, name, allowManualPosting: true, isActive: true },
    })).id;

  expenseAccountId = await mk(expenseGroup.id, 'INTRODUCER_COMMISSION_EXPENSE', 'Introducer Commission Expense');
  payableAccountId = await mk(liabilityGroup.id, 'INTRODUCER_PAYABLE', 'Introducer Payable');
  advanceAccountId = await mk(assetGroup.id, 'INTRODUCER_ADVANCE_RECEIVABLE', 'Introducer Advance Receivable');
  tdsAccountId = await mk(liabilityGroup.id, 'TDS_PAYABLE', 'TDS Payable');
  bankLedgerAccountId = await mk(assetGroup.id, 'INT_BANK', 'Bank');

  const bankAccount = await prisma.client.bankAccount.create({
    data: { id: generateId(), organizationId, legalEntityId, ledgerAccountId: bankLedgerAccountId, accountName: 'Int Test Bank' },
  });
  bankAccountId = bankAccount.id;

  introducerAId = (await prisma.client.introducer.create({ data: { id: generateId(), organizationId, name: 'Mehul Introducer' } })).id;
  introducerBId = (await prisma.client.introducer.create({ data: { id: generateId(), organizationId, name: 'Priya Introducer' } })).id;
  inactiveIntroducerId = (await prisma.client.introducer.create({ data: { id: generateId(), organizationId, name: 'Retired Introducer', isActive: false } })).id;

  const client = await prisma.client.party.create({ data: { id: generateId(), organizationId, name: 'Int Test Client' } });
  percentProjectId = (await prisma.client.project.create({
    data: { id: generateId(), organizationId, clientId: client.id, legalEntityId, name: 'Percent Project', value: new Prisma.Decimal('1000000.00') },
  })).id;
  fixedProjectId = (await prisma.client.project.create({
    data: { id: generateId(), organizationId, clientId: client.id, legalEntityId, name: 'Fixed Project', value: new Prisma.Decimal('500000.00') },
  })).id;
  valuelessProjectId = (await prisma.client.project.create({
    data: { id: generateId(), organizationId, clientId: client.id, legalEntityId, name: 'Unvalued Project' },
  })).id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.introducerPaymentAllocation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.introducerPayment.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.introducerAccrual.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.introducerAgreement.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.introducer.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.bankAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

function agreementInput(overrides: Partial<Parameters<IntroducerFeesService['createAgreement']>[0]> = {}) {
  return {
    organizationId,
    introducerId: introducerAId,
    projectId: percentProjectId,
    basisType: 'PERCENT_OF_PROJECT_VALUE' as const,
    ratePercent: '2.5',
    fixedAmount: undefined,
    agreementDate: '2026-02-01',
    remarks: undefined,
    idempotencyKey: generateId(),
    actorId,
    correlationId: generateId(),
    ...overrides,
  };
}

describe('IntroducerFeesService — agreements', () => {
  it('derives the entitlement from the basis and refuses a second agreement for the same pair', async () => {
    const percent = await introducerFees.createAgreement(agreementInput());
    // 2.5% of 1,000,000.
    expect(percent.entitledAmount).toBe('25000.00');
    expect(percent.accruedAmount).toBe('0.00');
    expect(percent.remainingToAccrue).toBe('25000.00');

    const fixed = await introducerFees.createAgreement(
      agreementInput({ introducerId: introducerBId, projectId: fixedProjectId, basisType: 'FIXED_AMOUNT', ratePercent: undefined, fixedAmount: '40000' }),
    );
    expect(fixed.entitledAmount).toBe('40000.00');
    // Several introducers on one project is expected; the same one twice is not.
    await expect(introducerFees.createAgreement(agreementInput())).rejects.toThrow(/already has an agreement on this project/i);
    await introducerFees.createAgreement(agreementInput({ introducerId: introducerBId }));
  });

  it('leaves the entitlement unknown rather than zero when a percentage project carries no value', async () => {
    const agreement = await introducerFees.createAgreement(
      agreementInput({ introducerId: introducerAId, projectId: valuelessProjectId, ratePercent: '5' }),
    );
    // Returning 0.00 here would silently cap every accrual at nothing —
    // a validation that looks like a rule but is really a missing input.
    expect(agreement.entitledAmount).toBeNull();
    expect(agreement.remainingToAccrue).toBeNull();
  });

  it('refuses a basis that disagrees with its figure, an inactive introducer and a nonsense rate', async () => {
    await expect(
      introducerFees.createAgreement(agreementInput({ introducerId: introducerBId, projectId: valuelessProjectId, ratePercent: undefined })),
    ).rejects.toThrow(/needs a rate/i);

    await expect(
      introducerFees.createAgreement(agreementInput({ introducerId: introducerBId, projectId: valuelessProjectId, fixedAmount: '100' })),
    ).rejects.toThrow(/cannot also carry a fixed amount/i);

    await expect(
      introducerFees.createAgreement(
        agreementInput({ introducerId: introducerBId, projectId: valuelessProjectId, basisType: 'FIXED_AMOUNT', ratePercent: '1', fixedAmount: '100' }),
      ),
    ).rejects.toThrow(/cannot also carry a rate/i);

    await expect(
      introducerFees.createAgreement(agreementInput({ introducerId: inactiveIntroducerId, projectId: valuelessProjectId })),
    ).rejects.toThrow(/is inactive/i);

    await expect(
      introducerFees.createAgreement(agreementInput({ introducerId: introducerBId, projectId: valuelessProjectId, ratePercent: '150' })),
    ).rejects.toThrow(/between 0 and 100/i);
  });
});

describe('IntroducerFeesService — accrual', () => {
  it('posts Dr Commission Expense / Cr Introducer Payable with the project dimension', async () => {
    const agreements = await introducerFees.listAgreements({
      organizationId,
      filters: { introducerId: introducerAId, projectId: percentProjectId, includeInactive: false },
    });
    const agreement = agreements.rows[0]!;

    const accrual = await introducerFees.postAccrual({
      organizationId,
      introducerAgreementId: agreement.id,
      accrualDate: '2026-03-01',
      amount: '10000',
      narrative: 'Stage 1',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(accrual.accrualNumber).toMatch(/^INTA-\d{6}$/);
    expect(accrual.amount).toBe('10000.00');
    expect(accrual.outstandingAmount).toBe('10000.00');

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: accrual.journalEntryId } });
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => l.debitAmount.greaterThan(0))!;
    const credit = lines.find((l) => l.creditAmount.greaterThan(0))!;
    expect(debit.ledgerAccountId).toBe(expenseAccountId);
    expect(credit.ledgerAccountId).toBe(payableAccountId);
    // The commission is always earned on a project — the dimension is what
    // lets project cost read it straight off the journal.
    expect(debit.projectId).toBe(percentProjectId);
  });

  it('caps cumulative accrual at the entitlement, but leaves an unknown entitlement uncapped', async () => {
    const agreements = await introducerFees.listAgreements({
      organizationId,
      filters: { introducerId: introducerAId, projectId: percentProjectId, includeInactive: false },
    });
    const agreement = agreements.rows[0]!;
    // 10,000 already accrued of a 25,000 entitlement.
    await expect(
      introducerFees.postAccrual({
        organizationId, introducerAgreementId: agreement.id, accrualDate: '2026-03-02', amount: '20000',
        narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/would exceed it/i);

    // The rest is fine.
    const rest = await introducerFees.postAccrual({
      organizationId, introducerAgreementId: agreement.id, accrualDate: '2026-03-02', amount: '15000',
      narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(rest.amount).toBe('15000.00');

    // An unvalued percentage project has no derivable ceiling, so it is
    // deliberately uncapped rather than refused on a guess.
    const unvalued = (await introducerFees.listAgreements({
      organizationId, filters: { introducerId: introducerAId, projectId: valuelessProjectId, includeInactive: false },
    })).rows[0]!;
    expect(unvalued.entitledAmount).toBeNull();
    const big = await introducerFees.postAccrual({
      organizationId, introducerAgreementId: unvalued.id, accrualDate: '2026-03-03', amount: '999999',
      narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(big.amount).toBe('999999.00');
  });

  it('is idempotent on replay and rejects a reused key with a different request', async () => {
    const agreement = (await introducerFees.listAgreements({
      organizationId, filters: { introducerId: introducerBId, projectId: fixedProjectId, includeInactive: false },
    })).rows[0]!;
    const key = generateId();
    const first = await introducerFees.postAccrual({
      organizationId, introducerAgreementId: agreement.id, accrualDate: '2026-03-04', amount: '5000',
      narrative: undefined, idempotencyKey: key, actorId, correlationId: generateId(),
    });
    const replay = await introducerFees.postAccrual({
      organizationId, introducerAgreementId: agreement.id, accrualDate: '2026-03-04', amount: '5000',
      narrative: undefined, idempotencyKey: key, actorId, correlationId: generateId(),
    });
    expect(replay.id).toBe(first.id);

    await expect(
      introducerFees.postAccrual({
        organizationId, introducerAgreementId: agreement.id, accrualDate: '2026-03-04', amount: '6000',
        narrative: undefined, idempotencyKey: key, actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/different request/i);
  });
});

describe('IntroducerFeesService — payment, TDS and advance', () => {
  it('settles accruals with TDS, posting a balanced vendor-style journal', async () => {
    const accruals = await introducerFees.listAccruals({
      organizationId, filters: { introducerId: introducerAId, projectId: percentProjectId, status: 'POSTED' },
    });
    const toPay = accruals.rows.find((a) => a.amount === '10000.00')!;

    const payableBefore = await balance(payableAccountId);

    const payment = await introducerFees.postPayment({
      organizationId,
      introducerId: introducerAId,
      legalEntityId,
      bankAccountId,
      paymentDate: '2026-04-01',
      paymentModeId: undefined,
      referenceNumber: 'NEFT-1',
      grossAmount: '10000',
      tdsAmount: '500',
      narrative: undefined,
      allocations: [{ introducerAccrualId: toPay.id, allocatedAmount: '10000' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    expect(payment.paymentNumber).toMatch(/^INTP-\d{6}$/);
    expect(payment.grossAmount).toBe('10000.00');
    expect(payment.tdsAmount).toBe('500.00');
    expect(payment.netAmount).toBe('9500.00');
    expect(payment.advanceAmount).toBe('0.00');

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: payment.journalEntryId } });
    const byAccount = new Map(lines.map((l) => [l.ledgerAccountId, l]));
    expect(byAccount.get(payableAccountId)!.debitAmount.toFixed(2)).toBe('10000.00');
    expect(byAccount.get(tdsAccountId)!.creditAmount.toFixed(2)).toBe('500.00');
    expect(byAccount.get(bankLedgerAccountId)!.creditAmount.toFixed(2)).toBe('9500.00');
    // No advance leg at all when nothing is unallocated.
    expect(byAccount.has(advanceAccountId)).toBe(false);

    // The payable came down by exactly what was allocated.
    expect((await balance(payableAccountId)).toFixed(2)).toBe(payableBefore.plus(10000).toFixed(2));

    const settled = (await introducerFees.listAccruals({
      organizationId, filters: { introducerId: introducerAId, projectId: percentProjectId, status: 'POSTED' },
    })).rows.find((a) => a.id === toPay.id)!;
    expect(settled.allocatedAmount).toBe('10000.00');
    expect(settled.outstandingAmount).toBe('0.00');
  });

  it('posts an over-payment to Introducer Advance Receivable rather than driving the payable negative', async () => {
    const accruals = await introducerFees.listAccruals({
      organizationId, filters: { introducerId: introducerBId, projectId: fixedProjectId, status: 'POSTED' },
    });
    const accrual = accruals.rows[0]!;
    expect(accrual.outstandingAmount).toBe('5000.00');

    // Pay 8,000 against a 5,000 accrual — the 3,000 excess is a receivable.
    const payment = await introducerFees.postPayment({
      organizationId,
      introducerId: introducerBId,
      legalEntityId,
      bankAccountId,
      paymentDate: '2026-04-02',
      paymentModeId: undefined,
      referenceNumber: undefined,
      grossAmount: '8000',
      tdsAmount: '0',
      narrative: undefined,
      allocations: [{ introducerAccrualId: accrual.id, allocatedAmount: '5000' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(payment.advanceAmount).toBe('3000.00');

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: payment.journalEntryId } });
    const byAccount = new Map(lines.map((l) => [l.ledgerAccountId, l]));
    expect(byAccount.get(payableAccountId)!.debitAmount.toFixed(2)).toBe('5000.00');
    expect(byAccount.get(advanceAccountId)!.debitAmount.toFixed(2)).toBe('3000.00');
    expect(byAccount.get(bankLedgerAccountId)!.creditAmount.toFixed(2)).toBe('8000.00');
  });

  it('accepts a pure advance with no allocations at all', async () => {
    const payment = await introducerFees.postPayment({
      organizationId, introducerId: introducerBId, legalEntityId, bankAccountId,
      paymentDate: '2026-04-03', paymentModeId: undefined, referenceNumber: undefined,
      grossAmount: '2000', tdsAmount: '0', narrative: 'Advance against future work',
      allocations: [], idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(payment.advanceAmount).toBe('2000.00');

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: payment.journalEntryId } });
    // Two lines only — no payable leg, because nothing was owed yet.
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.ledgerAccountId === payableAccountId)).toBe(false);
  });

  it('refuses over-allocation, a foreign accrual, a duplicate allocation line, and TDS above gross', async () => {
    const accrual = (await introducerFees.listAccruals({
      organizationId, filters: { introducerId: introducerAId, projectId: percentProjectId, status: 'POSTED' },
    })).rows.find((a) => a.outstandingAmount !== '0.00')!;

    const base = {
      organizationId, introducerId: introducerAId, legalEntityId, bankAccountId,
      paymentDate: '2026-04-04', paymentModeId: undefined, referenceNumber: undefined,
      tdsAmount: '0', narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    };

    await expect(
      introducerFees.postPayment({ ...base, grossAmount: '99999', allocations: [{ introducerAccrualId: accrual.id, allocatedAmount: '99999' }] }),
    ).rejects.toThrow(/only .* outstanding/i);

    await expect(
      introducerFees.postPayment({ ...base, grossAmount: '100', allocations: [{ introducerAccrualId: accrual.id, allocatedAmount: '500' }] }),
    ).rejects.toThrow(/more than the .* being paid/i);

    await expect(
      introducerFees.postPayment({
        ...base, grossAmount: '200',
        allocations: [
          { introducerAccrualId: accrual.id, allocatedAmount: '100' },
          { introducerAccrualId: accrual.id, allocatedAmount: '100' },
        ],
      }),
    ).rejects.toThrow(/more than one allocation line/i);

    // An accrual belonging to a different introducer must never be settled
    // here — otherwise a payment could quietly clear someone else's liability.
    const foreign = (await introducerFees.listAccruals({
      organizationId, filters: { introducerId: introducerBId, projectId: fixedProjectId, status: 'POSTED' },
    })).rows[0]!;
    await expect(
      introducerFees.postPayment({ ...base, grossAmount: '100', allocations: [{ introducerAccrualId: foreign.id, allocatedAmount: '100' }] }),
    ).rejects.toThrow(/different introducer/i);

    await expect(
      introducerFees.postPayment({ ...base, grossAmount: '100', tdsAmount: '200', allocations: [] }),
    ).rejects.toThrow(/TDS cannot exceed/i);
  });

  it('reverses a payment, restoring the accrual without touching a single allocation row', async () => {
    const payment = (await introducerFees.listPayments({ organizationId, filters: { introducerId: introducerAId, status: 'POSTED' } })).rows[0]!;
    const detail = await introducerFees.getPaymentDetail({ organizationId, id: payment.id });
    expect(detail.allocations).toHaveLength(1);
    const accrualId = detail.allocations[0]!.introducerAccrualId;

    const reversed = await introducerFees.reversePayment({
      organizationId, id: payment.id, expectedVersion: payment.version,
      reason: 'Paid from the wrong account', accountingDate: '2026-04-10',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(reversed.status).toBe('REVERSED');

    // The allocation row is untouched; it simply no longer counts, because
    // allocations are read through their payment's status.
    const stillThere = await prisma.client.introducerPaymentAllocation.count({ where: { introducerPaymentId: payment.id } });
    expect(stillThere).toBe(1);

    const accrual = (await introducerFees.listAccruals({ organizationId, filters: { introducerId: introducerAId, projectId: undefined, status: 'POSTED' } }))
      .rows.find((a) => a.id === accrualId)!;
    expect(accrual.allocatedAmount).toBe('0.00');
    expect(accrual.outstandingAmount).toBe('10000.00');

    await expect(
      introducerFees.reversePayment({
        organizationId, id: payment.id, expectedVersion: reversed.version, reason: 'Again',
        accountingDate: '2026-04-11', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/already reversed/i);
  });

  it('refuses to reverse an accrual that has already been paid, and allows it once the payment is gone', async () => {
    const accrual = (await introducerFees.listAccruals({
      organizationId, filters: { introducerId: introducerBId, projectId: fixedProjectId, status: 'POSTED' },
    })).rows[0]!;
    expect(accrual.allocatedAmount).toBe('5000.00');

    await expect(
      introducerFees.reverseAccrual({
        organizationId, id: accrual.id, expectedVersion: accrual.version, reason: 'Mistake',
        accountingDate: '2026-04-12', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/already been paid against this accrual/i);

    // Reverse the payment that settled it, and the accrual becomes reversible.
    const payment = (await introducerFees.listPayments({ organizationId, filters: { introducerId: introducerBId, status: 'POSTED' } }))
      .rows.find((p) => p.advanceAmount === '3000.00')!;
    await introducerFees.reversePayment({
      organizationId, id: payment.id, expectedVersion: payment.version, reason: 'Unwinding',
      accountingDate: '2026-04-13', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    const reversible = (await introducerFees.listAccruals({
      organizationId, filters: { introducerId: introducerBId, projectId: fixedProjectId, status: 'POSTED' },
    })).rows[0]!;
    const reversedAccrual = await introducerFees.reverseAccrual({
      organizationId, id: reversible.id, expectedVersion: reversible.version, reason: 'Accrued too early',
      accountingDate: '2026-04-14', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(reversedAccrual.status).toBe('REVERSED');
    // A reversed accrual is no longer a liability, so it carries no outstanding.
    expect(reversedAccrual.outstandingAmount).toBe('0.00');
  });
});

describe('IntroducerFeesService — balances and isolation', () => {
  it('reports accrued, paid, TDS, advance and payable as five separate figures', async () => {
    const { rows, totals } = await introducerFees.listBalances({ organizationId });
    const a = rows.find((r) => r.introducerId === introducerAId)!;

    // Introducer A: 10,000 + 15,000 accrued on the percent project, 999,999
    // on the unvalued one; its only payment was reversed above.
    expect(a.accruedAmount).toBe('1024999.00');
    expect(a.allocatedAmount).toBe('0.00');
    expect(a.payableAmount).toBe('1024999.00');
    // A reversed payment contributes no TDS and no cash.
    expect(a.tdsAmount).toBe('0.00');
    expect(a.netPaidAmount).toBe('0.00');

    const b = rows.find((r) => r.introducerId === introducerBId)!;
    // B's accrual was reversed and both its payments were reversed except the
    // pure advance, which is still live.
    expect(b.accruedAmount).toBe('0.00');
    expect(b.advanceAmount).toBe('2000.00');
    expect(b.payableAmount).toBe('0.00');

    // The payable total is the accrued total minus what has been settled —
    // never a single blended figure that hides which way the money runs.
    expect(totals.payableAmount).toBe(
      rows.reduce((s, r) => s + Number(r.payableAmount), 0).toFixed(2),
    );
  });

  it('states the plain view: commission agreed, paid with TDS, last paid date and what is left', async () => {
    const { rows, totals } = await introducerFees.listBalances({ organizationId });
    const a = rows.find((r) => r.introducerId === introducerAId)!;
    // A has a percentage agreement on a project with no value, so part of its commission is unknown.
    expect(a.agreedComplete).toBe(false);
    expect([a.paidAmount, a.lastPaidOn, a.remainingAmount]).toEqual(['0.00', null, a.agreedAmount]);

    const b = rows.find((r) => r.introducerId === introducerBId)!;
    const posted = (await introducerFees.listPayments({ organizationId, filters: { introducerId: introducerBId, status: 'POSTED' } })).rows;
    expect(b.paidAmount).toBe(posted.reduce((s, p) => s + Number(p.grossAmount), 0).toFixed(2));
    expect(b.lastPaidOn).toBe(posted.map((p) => p.paymentDate).sort().at(-1) ?? null);
    expect(b.remainingAmount).toBe(Math.max(Number(b.agreedAmount) - Number(b.paidAmount), 0).toFixed(2));
    expect(totals.paidAmount).toBe(rows.reduce((s, r) => s + Number(r.paidAmount), 0).toFixed(2));
  });

  it('never returns another organization’s introducer data', async () => {
    const agreements = await introducerFees.listAgreements({
      organizationId: otherOrganizationId, filters: { introducerId: undefined, projectId: undefined, includeInactive: true },
    });
    expect(agreements.rows).toHaveLength(0);

    const balances = await introducerFees.listBalances({ organizationId: otherOrganizationId });
    expect(balances.rows).toHaveLength(0);

    const payment = (await introducerFees.listPayments({ organizationId, filters: { introducerId: undefined, status: undefined } })).rows[0]!;
    await expect(
      introducerFees.getPaymentDetail({ organizationId: otherOrganizationId, id: payment.id }),
    ).rejects.toThrow(/not found/i);
  });
});
