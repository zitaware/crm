import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { PostingService } from '../accounting/posting.service';
import { EmployeeSalaryRevisionsService } from '../employees/employee-salary-revisions.service';
import { SalaryImportsService } from './salary-imports.service';

const prisma = new PrismaService();
const financialYears = new FinancialYearService(prisma);
const posting = new PostingService(prisma);
const salaryRevisions = new EmployeeSalaryRevisionsService(prisma);
const salaryImports = new SalaryImportsService(prisma, posting, salaryRevisions);

let organizationId: string;
let otherOrganizationId: string;
let legalEntityId: string;
let expenseAccountId: string;
let payableAccountId: string;
let employeeAId: string;
let employeeBId: string;
let tdsAccountId: string;
let bankLedgerAccountId: string;
let bankAccountId: string;
let otherEntityBankAccountId: string;
const actorId = generateId();

async function makeEmployee(code: string, name: string, status = 'ACTIVE'): Promise<string> {
  const row = await prisma.client.employee.create({
    data: {
      id: generateId(),
      organizationId,
      legalEntityId,
      employeeCode: code,
      fullName: name,
      joiningDate: new Date('2025-01-01T00:00:00.000Z'),
      status,
    },
  });
  return row.id;
}


async function accountBalance(ledgerAccountId: string): Promise<Prisma.Decimal> {
  const lines = await prisma.client.journalLine.findMany({ where: { organizationId, ledgerAccountId } });
  return lines.reduce((sum, l) => sum.plus(l.debitAmount).minus(l.creditAmount), new Prisma.Decimal(0));
}

beforeAll(async () => {
  const org = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Salary Test Org', code: `SALTEST-${generateId()}` },
  });
  organizationId = org.id;
  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Salary Other Org', code: `SALOTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Sal Test Legal Entity', panNumber: 'SALCD1234P', registeredAddress: 'Gandhinagar, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  await financialYears.create({
    organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31',
    setCurrent: true, actorId, correlationId: generateId(),
  });

  // Payment tests settle months in 2027, which needs its own year: a posting
  // resolves an accounting period, and there is no period outside a
  // financial year.
  await financialYears.create({
    organizationId, legalEntityId, label: 'FY2027', startDate: '2027-01-01', endDate: '2027-12-31',
    setCurrent: false, actorId, correlationId: generateId(),
  });

  const expenseGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'SAL_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const liabilityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'SAL_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  const expenseAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: expenseGroup.id, code: 'SALARIES_WAGES_EXPENSE', name: 'Salaries & Wages Expense', allowManualPosting: true, isActive: true },
  });
  expenseAccountId = expenseAccount.id;
  const payableAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: liabilityGroup.id, code: 'SALARY_PAYABLE', name: 'Salary Payable', allowManualPosting: true, isActive: true },
  });
  payableAccountId = payableAccount.id;

  const assetGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'SAL_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const tdsAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: liabilityGroup.id, code: 'TDS_PAYABLE', name: 'TDS Payable', allowManualPosting: true, isActive: true },
  });
  tdsAccountId = tdsAccount.id;
  const bankLedger = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'SAL_BANK', name: 'Bank', allowManualPosting: true, isActive: true },
  });
  bankLedgerAccountId = bankLedger.id;
  const bankAccount = await prisma.client.bankAccount.create({
    data: { id: generateId(), organizationId, legalEntityId, ledgerAccountId: bankLedger.id, accountName: 'Salary Current A/c' },
  });
  bankAccountId = bankAccount.id;

  // A second legal entity's bank account, to prove a month cannot be settled
  // out of an entity that never carried the liability.
  const otherEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Sal Other Legal Entity', panNumber: 'SALCD9999P', registeredAddress: 'Surat, Gujarat' },
  });
  const otherBank = await prisma.client.bankAccount.create({
    data: { id: generateId(), organizationId, legalEntityId: otherEntity.id, ledgerAccountId: bankLedger.id, accountName: 'Other Entity A/c' },
  });
  otherEntityBankAccountId = otherBank.id;

  employeeAId = await makeEmployee('EMP-001', 'Asha Patel');
  employeeBId = await makeEmployee('EMP-002', 'Ravi Shah');
  const inactiveId = await makeEmployee('EMP-003', 'Former Person', 'INACTIVE');

  // Salary on record is what a generated draft reads (ADR-098). The inactive
  // employee gets one too, to prove generation filters on status rather than
  // on the mere absence of a salary.
  for (const [employeeId, gross] of [
    [employeeAId, '60000.00'],
    [employeeBId, '45000.50'],
    [inactiveId, '30000.00'],
  ] as const) {
    await salaryRevisions.revise({
      organizationId, employeeId, grossAmount: gross, effectiveFrom: '2025-01-01',
      reason: 'Opening salary', actorId, correlationId: generateId(),
    });
  }
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.salaryPayment.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.salaryImportLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.salaryImport.deleteMany({ where: { organizationId: { in: orgIds } } });
  // Journal lines reference employees with ON DELETE RESTRICT, so the ledger
  // must be cleared before the employee master.
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employeeSalaryRevision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employee.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.bankAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('SalaryImportsService — preview', () => {
  it('matches by employee code case- and whitespace-insensitively, and totals only matched rows', async () => {
    const preview = await salaryImports.preview({
      organizationId,
      legalEntityId,
      salaryMonth: '2026-01-01',
      rows: [
        { employeeCode: '  emp-001 ', employeeName: 'Asha P', grossSalaryAmount: '60000' },
        { employeeCode: 'EMP-002', employeeName: undefined, grossSalaryAmount: '45000.50' },
      ],
    });

    expect(preview.matchedCount).toBe(2);
    expect(preview.problemCount).toBe(0);
    expect(preview.totalGrossAmount).toBe('105000.50');
    expect(preview.rows[0]!.employeeId).toBe(employeeAId);
    // The system's own name is returned alongside the sheet's, so a mismatch
    // is visible before committing.
    expect(preview.rows[0]!.employeeName).toBe('Asha P');
    expect(preview.rows[0]!.matchedEmployeeName).toBe('Asha Patel');
    expect(preview.isCommittable).toBe(true);
  });

  it('finds the code from the name, and asks which one when two share it, suggesting the one on the same salary (ADR-170)', async () => {
    const twinA = await makeEmployee('EMP-T1', 'Jay Bhavsar');
    const twinB = await makeEmployee('EMP-T2', 'Jay Bhavsar');
    try {
      await prisma.client.employee.update({ where: { id: twinB }, data: { displayedSalaryAmount: '52000' } });
      const preview = await salaryImports.preview({
        organizationId,
        legalEntityId,
        salaryMonth: '2026-01-01',
        rows: [
          { employeeCode: '', employeeName: 'ravi  shah', grossSalaryAmount: '45000' },
          { employeeCode: '', employeeName: 'Jay Bhavsar', grossSalaryAmount: '52000' },
          { employeeCode: '', employeeName: 'Nobody Here', grossSalaryAmount: '1000' },
        ],
      });
      expect(preview.rows.map((r) => [r.status, r.employeeCode, r.employeeId, r.suggestedEmployeeCode, r.candidates.map((c) => c.employeeCode)])).toEqual([
        ['MATCHED', 'EMP-002', employeeBId, null, []],
        ['AMBIGUOUS', '', null, 'EMP-T2', ['EMP-T1', 'EMP-T2']],
        ['UNMATCHED', '', null, null, []],
      ]);
      expect(preview.rows[2]!.message).toBe('No active employee named "Nobody Here" in this legal entity.');
      expect(preview.isCommittable).toBe(false);
      void twinA;
    } finally {
      await prisma.client.employee.deleteMany({ where: { id: { in: [twinA, twinB] } } });
    }
  });

  it('normalizes any day of the month to the first, so one month is one batch', async () => {
    const preview = await salaryImports.preview({
      organizationId,
      legalEntityId,
      salaryMonth: '2026-01-27',
      rows: [{ employeeCode: 'EMP-001', employeeName: undefined, grossSalaryAmount: '1' }],
    });
    expect(preview.salaryMonth).toBe('2026-01-01');
  });

  it('flags unmatched, duplicate, inactive and unparseable rows all at once rather than failing on the first', async () => {
    const preview = await salaryImports.preview({
      organizationId,
      legalEntityId,
      salaryMonth: '2026-01-01',
      rows: [
        { employeeCode: 'EMP-001', employeeName: undefined, grossSalaryAmount: '60000' },
        { employeeCode: 'EMP-001', employeeName: undefined, grossSalaryAmount: '60000' },
        { employeeCode: 'NOPE-999', employeeName: undefined, grossSalaryAmount: '1000' },
        { employeeCode: 'EMP-003', employeeName: undefined, grossSalaryAmount: '1000' },
        { employeeCode: 'EMP-002', employeeName: undefined, grossSalaryAmount: 'not-a-number' },
        { employeeCode: '', employeeName: undefined, grossSalaryAmount: '500' },
      ],
    });

    expect(preview.rows.map((r) => r.status)).toEqual(['MATCHED', 'DUPLICATE', 'UNMATCHED', 'INACTIVE', 'INVALID_AMOUNT', 'UNMATCHED']);
    expect(preview.problemCount).toBe(5);
    expect(preview.isCommittable).toBe(false);
    // Only the one good row counts toward the total.
    expect(preview.totalGrossAmount).toBe('60000.00');
    expect(preview.rows[1]!.message).toMatch(/more than once/i);
    expect(preview.rows[3]!.message).toMatch(/inactive/i);
    // An unusable row never resolves an employee id, so it can never be committed by accident.
    expect(preview.rows.filter((r) => r.status !== 'MATCHED').every((r) => r.employeeId === null)).toBe(true);
  });

  it('names active employees missing from the sheet without blocking the import', async () => {
    const preview = await salaryImports.preview({
      organizationId,
      legalEntityId,
      salaryMonth: '2026-01-01',
      rows: [{ employeeCode: 'EMP-001', employeeName: undefined, grossSalaryAmount: '60000' }],
    });
    expect(preview.missingEmployeeNames).toContain('Ravi Shah');
    // An inactive employee is not "missing" — they are simply not expected.
    expect(preview.missingEmployeeNames).not.toContain('Former Person');
    expect(preview.isCommittable).toBe(true);
  });
});

describe('SalaryImportsService — generate, edit, commit', () => {
  async function freshDraft(month: string) {
    return salaryImports.generateDraft({
      organizationId, legalEntityId, salaryMonth: month, actorId, correlationId: generateId(),
    });
  }

  it('generates a draft from the salary revisions on record, and is idempotent', async () => {
    const draft = await freshDraft('2026-03-01');

    expect(draft.status).toBe('DRAFT');
    // A draft has posted nothing, so it has no journal.
    expect(draft.journalEntryId).toBeNull();
    expect(draft.salaryMonth).toBe('2026-03-01');
    // Only the two ACTIVE employees with a revision; the inactive one is out.
    expect(draft.employeeCount).toBe(2);
    expect(draft.totalGrossAmount).toBe('105000.50');

    const detail = await salaryImports.getDetail({ organizationId, id: draft.id });
    expect(detail.lines.find((l) => l.employeeId === employeeAId)!.grossSalaryAmount).toBe('60000.00');
    expect(detail.lines.find((l) => l.employeeId === employeeBId)!.grossSalaryAmount).toBe('45000.50');

    // Generating again returns the SAME draft rather than a second one —
    // this is what makes a worker tick and a human click safe together.
    const again = await freshDraft('2026-03-15');
    expect(again.id).toBe(draft.id);
    const count = await prisma.client.salaryImport.count({
      where: { organizationId, salaryMonth: new Date('2026-03-01T00:00:00.000Z') },
    });
    expect(count).toBe(1);
  });

  it('applies a corrected sheet to the draft, and refuses one with an unusable row', async () => {
    const draft = await freshDraft('2026-03-01');

    // A bonus month for Asha, entered as an exception over the generated row.
    const edited = await salaryImports.replaceDraftRows({
      organizationId, id: draft.id, sourceFileName: 'march-corrections.csv',
      rows: [
        { employeeCode: 'EMP-001', employeeName: undefined, grossSalaryAmount: '70000' },
        { employeeCode: 'EMP-002', employeeName: undefined, grossSalaryAmount: '45000.50' },
      ],
      actorId, correlationId: generateId(),
    });
    expect(edited.totalGrossAmount).toBe('115000.50');
    expect(edited.sourceFileName).toBe('march-corrections.csv');
    expect(edited.status).toBe('DRAFT');

    await expect(
      salaryImports.replaceDraftRows({
        organizationId, id: draft.id, sourceFileName: undefined,
        rows: [{ employeeCode: 'NOPE-999', employeeName: undefined, grossSalaryAmount: '1' }],
        actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/cannot be imported/i);

    // The refused sheet left the draft exactly as it was.
    const stillThere = await salaryImports.getDetail({ organizationId, id: draft.id });
    expect(stillThere.totalGrossAmount).toBe('115000.50');
  });

  it('commits a draft: posts one debit/credit pair per employee, stamped with the employee dimension', async () => {
    // Its own month: the test above deliberately edits March's draft, and
    // generateDraft returns the existing one rather than a pristine copy.
    const draft = await freshDraft('2026-04-01');
    const batch = await salaryImports.commit({
      organizationId, id: draft.id, accountingDate: '2026-04-30',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    expect(batch.status).toBe('POSTED');
    expect(batch.journalEntryId).not.toBeNull();
    expect(batch.totalGrossAmount).toBe('105000.50');

    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: batch.journalEntryId! } });
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l.debitAmount.greaterThan(0)).every((l) => l.ledgerAccountId === expenseAccountId)).toBe(true);
    expect(lines.filter((l) => l.creditAmount.greaterThan(0)).every((l) => l.ledgerAccountId === payableAccountId)).toBe(true);
    // Every line carries the employee it belongs to — otherwise "what is
    // still owed to this person" would be unanswerable from the ledger.
    expect(new Set(lines.map((l) => l.employeeId))).toEqual(new Set([employeeAId, employeeBId]));

    expect((await accountBalance(expenseAccountId)).toFixed(2)).toBe('105000.50');
    expect((await accountBalance(payableAccountId)).toFixed(2)).toBe('-105000.50');

    // Committing again is refused, and a second draft cannot be generated
    // for a month that is already posted.
    await expect(
      salaryImports.commit({
        organizationId, id: draft.id, accountingDate: '2026-04-30',
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/already been committed/i);
    await expect(freshDraft('2026-04-01')).rejects.toThrow(/already been posted/i);
  });

  it('is idempotent on commit replay and rejects a reused key with a different request', async () => {
    const draft = await freshDraft('2026-06-01');
    const key = generateId();
    const first = await salaryImports.commit({
      organizationId, id: draft.id, accountingDate: '2026-06-30',
      idempotencyKey: key, actorId, correlationId: generateId(),
    });
    const replay = await salaryImports.commit({
      organizationId, id: draft.id, accountingDate: '2026-06-30',
      idempotencyKey: key, actorId, correlationId: generateId(),
    });
    expect(replay.id).toBe(first.id);

    // The replay must not have posted a second month of cost.
    const journals = await prisma.client.journalEntry.count({
      where: { organizationId, sourceType: 'salary_import', sourceId: draft.id },
    });
    expect(journals).toBe(1);

    await expect(
      salaryImports.commit({
        organizationId, id: draft.id, accountingDate: '2026-06-15',
        idempotencyKey: key, actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/different request/i);
  });

  it('rejects an accounting date before the month, and discards a draft cleanly', async () => {
    const draft = await freshDraft('2026-05-01');
    await expect(
      salaryImports.commit({
        organizationId, id: draft.id, accountingDate: '2026-04-15',
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/cannot fall before the month/i);

    // A draft posted nothing, so it is discarded rather than reversed.
    await expect(
      salaryImports.reverse({
        organizationId, id: draft.id, expectedVersion: draft.version, reason: 'x',
        accountingDate: '2026-05-31', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/posted nothing to reverse/i);

    await salaryImports.discardDraft({ organizationId, id: draft.id, actorId, correlationId: generateId() });
    await expect(salaryImports.getDetail({ organizationId, id: draft.id })).rejects.toThrow(/not found/i);
  });
});

describe('SalaryImportsService — reversal', () => {
  it('reverses a posted month, keeps its lines, and frees the month for a fresh draft', async () => {
    const draft = await salaryImports.generateDraft({
      organizationId, legalEntityId, salaryMonth: '2026-07-01', actorId, correlationId: generateId(),
    });
    const batch = await salaryImports.commit({
      organizationId, id: draft.id, accountingDate: '2026-07-31',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    const reversed = await salaryImports.reverse({
      organizationId, id: batch.id, expectedVersion: batch.version, reason: 'Wrong figures',
      accountingDate: '2026-08-01', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.reversalJournalEntryId).not.toBeNull();

    const original = await prisma.client.journalEntry.findFirstOrThrow({ where: { id: batch.journalEntryId! } });
    expect(original.status).toBe('REVERSED');

    // The batch's own lines survive — the record of what was posted is never
    // edited away, exactly as a reversed journal keeps its lines.
    const detail = await salaryImports.getDetail({ organizationId, id: batch.id });
    expect(detail.lines).toHaveLength(2);

    // And the month is free again — this is why the uniqueness rules are
    // PARTIAL indexes over POSTED / DRAFT rather than plain composite uniques.
    const corrected = await salaryImports.generateDraft({
      organizationId, legalEntityId, salaryMonth: '2026-07-01', actorId, correlationId: generateId(),
    });
    expect(corrected.id).not.toBe(batch.id);
    expect(corrected.status).toBe('DRAFT');
  });

  it('requires a reason and refuses to reverse twice', async () => {
    const draft = await salaryImports.generateDraft({
      organizationId, legalEntityId, salaryMonth: '2026-09-01', actorId, correlationId: generateId(),
    });
    const batch = await salaryImports.commit({
      organizationId, id: draft.id, accountingDate: '2026-09-30',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    await expect(
      salaryImports.reverse({
        organizationId, id: batch.id, expectedVersion: batch.version, reason: '   ',
        accountingDate: '2026-09-30', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/reason is required/i);

    const reversed = await salaryImports.reverse({
      organizationId, id: batch.id, expectedVersion: batch.version, reason: 'First',
      accountingDate: '2026-09-30', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    await expect(
      salaryImports.reverse({
        organizationId, id: batch.id, expectedVersion: reversed.version, reason: 'Second',
        accountingDate: '2026-09-30', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/already reversed/i);
  });
});

describe('SalaryImportsService — paying the payable, employee by employee (ADR-100, ADR-101)', () => {
  /** A committed month: A on 60000.00, B on 45000.50, total 105000.50. */
  async function postedMonth(month: string, accountingDate: string) {
    const draft = await salaryImports.generateDraft({
      organizationId, legalEntityId, salaryMonth: month, actorId, correlationId: generateId(),
    });
    return await salaryImports.commit({
      organizationId, id: draft.id, accountingDate,
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
  }

  const line = (employeeId: string, paidAmount: string, tdsAmount = '0', referenceNumber?: string) => ({
    employeeId, paidAmount, tdsAmount, referenceNumber,
  });

  it('posts a debit, a TDS credit and a bank credit PER EMPLOYEE, each carrying that employee', async () => {
    const batch = await postedMonth('2027-01-01', '2027-01-31');
    expect(batch.totalGrossAmount).toBe('105000.50');
    expect(batch.outstandingAmount).toBe('105000.50');

    const payment = await salaryImports.pay({
      organizationId, salaryImportId: batch.id, bankAccountId,
      paymentDate: '2027-02-05', paymentModeId: undefined, referenceNumber: 'BULK-FILE-1',
      lines: [line(employeeAId, '60000.00', '5000.00', 'UTR-A-1'), line(employeeBId, '45000.50', '0.50', 'UTR-B-1')],
      narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(payment.grossAmount).toBe('105000.50');
    expect(payment.tdsAmount).toBe('5000.50');
    expect(payment.netAmount).toBe('100000.00');
    expect(payment.lines).toHaveLength(2);

    // Each person's own reference survives onto their own line.
    const byEmployee = new Map(payment.lines.map((l) => [l.employeeId, l]));
    expect(byEmployee.get(employeeAId)!.referenceNumber).toBe('UTR-A-1');
    expect(byEmployee.get(employeeAId)!.netAmount).toBe('55000.00');
    expect(byEmployee.get(employeeBId)!.referenceNumber).toBe('UTR-B-1');
    expect(byEmployee.get(employeeBId)!.netAmount).toBe('45000.00');

    const journalLines = await prisma.client.journalLine.findMany({
      where: { organizationId, journalEntryId: payment.journalEntryId },
    });
    // Three legs each, and every one stamped with its employee — the mirror
    // of the per-employee credit the import posted.
    expect(journalLines).toHaveLength(6);
    expect(journalLines.every((l) => l.employeeId !== null)).toBe(true);

    const aLines = journalLines.filter((l) => l.employeeId === employeeAId);
    const aPayable = aLines.find((l) => l.ledgerAccountId === payableAccountId)!;
    const aTds = aLines.find((l) => l.ledgerAccountId === tdsAccountId)!;
    const aBank = aLines.find((l) => l.ledgerAccountId === bankLedgerAccountId)!;
    expect(aPayable.debitAmount.toFixed(2)).toBe('60000.00');
    expect(aTds.creditAmount.toFixed(2)).toBe('5000.00');
    expect(aBank.creditAmount.toFixed(2)).toBe('55000.00');

    const settled = await salaryImports.getDetail({ organizationId, id: batch.id });
    expect(settled.outstandingAmount).toBe('0.00');
    // And per person, which is the whole point of the line table.
    for (const l of settled.lines) {
      expect(l.paidAmount).toBe(l.grossSalaryAmount);
      expect(l.outstandingAmount).toBe('0.00');
    }
  });

  it('enforces each employee’s OWN outstanding, not merely the month total', async () => {
    const batch = await postedMonth('2027-02-01', '2027-02-28');

    // Pay only employee A, in part.
    await salaryImports.pay({
      organizationId, salaryImportId: batch.id, bankAccountId,
      paymentDate: '2027-03-05', paymentModeId: undefined, referenceNumber: undefined,
      lines: [line(employeeAId, '20000.00')],
      narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    const partly = await salaryImports.getDetail({ organizationId, id: batch.id });
    expect(partly.paidAmount).toBe('20000.00');
    expect(partly.outstandingAmount).toBe('85000.50');
    const aRow = partly.lines.find((l) => l.employeeId === employeeAId)!;
    const bRow = partly.lines.find((l) => l.employeeId === employeeBId)!;
    expect(aRow.outstandingAmount).toBe('40000.00');
    expect(bRow.outstandingAmount).toBe('45000.50');

    // The month still has 85000.50 of headroom, but A personally has only
    // 40000.00 left — paying A more must be refused even though the month
    // could absorb it. That is the case a month-level cap would have missed.
    await expect(
      salaryImports.pay({
        organizationId, salaryImportId: batch.id, bankAccountId,
        paymentDate: '2027-03-06', paymentModeId: undefined, referenceNumber: undefined,
        lines: [line(employeeAId, '40000.01')],
        narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/owed only 40000.00/i);

    // The exact remainder for both, in one transfer, is accepted.
    await salaryImports.pay({
      organizationId, salaryImportId: batch.id, bankAccountId,
      paymentDate: '2027-03-06', paymentModeId: undefined, referenceNumber: undefined,
      lines: [line(employeeAId, '40000.00'), line(employeeBId, '45000.50')],
      narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    const fully = await salaryImports.getDetail({ organizationId, id: batch.id });
    expect(fully.outstandingAmount).toBe('0.00');
    expect(fully.payments).toHaveLength(2);
  });

  it('omits a zero TDS leg rather than posting an empty line', async () => {
    const batch = await postedMonth('2027-03-01', '2027-03-31');
    const payment = await salaryImports.pay({
      organizationId, salaryImportId: batch.id, bankAccountId,
      paymentDate: '2027-04-05', paymentModeId: undefined, referenceNumber: undefined,
      lines: [line(employeeAId, '1000.00')],
      narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    const journalLines = await prisma.client.journalLine.findMany({
      where: { organizationId, journalEntryId: payment.journalEntryId },
    });
    expect(journalLines).toHaveLength(2);
    expect(journalLines.some((l) => l.ledgerAccountId === tdsAccountId)).toBe(false);
  });

  it('replays an idempotent request without paying twice, and rejects a reused key', async () => {
    const batch = await postedMonth('2027-04-01', '2027-04-30');
    const key = generateId();
    const args = {
      organizationId, salaryImportId: batch.id, bankAccountId,
      paymentDate: '2027-05-05', paymentModeId: undefined, referenceNumber: undefined,
      lines: [line(employeeAId, '2000.00')],
      narrative: undefined, actorId,
    };
    const first = await salaryImports.pay({ ...args, idempotencyKey: key, correlationId: generateId() });
    const replay = await salaryImports.pay({ ...args, idempotencyKey: key, correlationId: generateId() });
    expect(replay.id).toBe(first.id);
    expect((await salaryImports.getDetail({ organizationId, id: batch.id })).paidAmount).toBe('2000.00');

    await expect(
      salaryImports.pay({ ...args, lines: [line(employeeAId, '3000.00')], idempotencyKey: key, correlationId: generateId() }),
    ).rejects.toThrow(/different request/i);
  });

  it('reverses a payment and restores both the month and each employee', async () => {
    const batch = await postedMonth('2027-05-01', '2027-05-31');
    const payment = await salaryImports.pay({
      organizationId, salaryImportId: batch.id, bankAccountId,
      paymentDate: '2027-06-05', paymentModeId: undefined, referenceNumber: undefined,
      lines: [line(employeeAId, '60000.00', '500.00'), line(employeeBId, '45000.50', '0.50')],
      narrative: undefined, idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect((await salaryImports.getDetail({ organizationId, id: batch.id })).outstandingAmount).toBe('0.00');

    const reversed = await salaryImports.reversePayment({
      organizationId, id: payment.id, expectedVersion: payment.version, reason: 'Paid from the wrong account',
      accountingDate: '2027-06-06', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(reversed.status).toBe('REVERSED');
    // The lines are kept — the record of who was paid is never edited away.
    expect(reversed.lines).toHaveLength(2);

    const after = await salaryImports.getDetail({ organizationId, id: batch.id });
    expect(after.paidAmount).toBe('0.00');
    expect(after.outstandingAmount).toBe('105000.50');
    for (const l of after.lines) {
      expect(l.paidAmount).toBe('0.00');
      expect(l.outstandingAmount).toBe(l.grossSalaryAmount);
    }

    const pair = await prisma.client.journalLine.findMany({
      where: {
        organizationId,
        ledgerAccountId: bankLedgerAccountId,
        journalEntryId: { in: [payment.journalEntryId, reversed.reversalJournalEntryId!] },
      },
    });
    expect(pair.reduce((sum, l) => sum.plus(l.debitAmount).minus(l.creditAmount), new Prisma.Decimal(0)).toFixed(2)).toBe('0.00');

    await expect(
      salaryImports.reversePayment({
        organizationId, id: payment.id, expectedVersion: reversed.version, reason: 'Again',
        accountingDate: '2027-06-07', idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/already reversed/i);
  });

  it('refuses a DRAFT, a reversed month, a foreign employee, a duplicate row, a wrong-entity bank account and a date before the month', async () => {
    const draft = await salaryImports.generateDraft({
      organizationId, legalEntityId, salaryMonth: '2027-06-01', actorId, correlationId: generateId(),
    });
    const base = {
      organizationId, bankAccountId, paymentDate: '2027-07-05', paymentModeId: undefined,
      referenceNumber: undefined, narrative: undefined, actorId,
    };

    await expect(
      salaryImports.pay({ ...base, salaryImportId: draft.id, lines: [line(employeeAId, '1000.00')], idempotencyKey: generateId(), correlationId: generateId() }),
    ).rejects.toThrow(/only a posted salary month can be paid/i);

    const batch = await salaryImports.commit({
      organizationId, id: draft.id, accountingDate: '2027-06-30',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    // An employee who is not in this month has no payable to relieve.
    const stranger = await makeEmployee(`EMP-STRANGER-${generateId().slice(-6)}`, 'Not In This Month');
    await expect(
      salaryImports.pay({ ...base, salaryImportId: batch.id, lines: [line(stranger, '1000.00')], idempotencyKey: generateId(), correlationId: generateId() }),
    ).rejects.toThrow(/not part of this salary month/i);

    await expect(
      salaryImports.pay({
        ...base, salaryImportId: batch.id,
        lines: [line(employeeAId, '1000.00'), line(employeeAId, '2000.00')],
        idempotencyKey: generateId(), correlationId: generateId(),
      }),
    ).rejects.toThrow(/same employee appears twice/i);

    await expect(
      salaryImports.pay({
        ...base, salaryImportId: batch.id, bankAccountId: otherEntityBankAccountId,
        lines: [line(employeeAId, '1000.00')], idempotencyKey: generateId(), correlationId: generateId(),
      }),
    ).rejects.toThrow(/different legal entity/i);

    await expect(
      salaryImports.pay({
        ...base, salaryImportId: batch.id, paymentDate: '2027-05-31',
        lines: [line(employeeAId, '1000.00')], idempotencyKey: generateId(), correlationId: generateId(),
      }),
    ).rejects.toThrow(/before the month it covers/i);

    await expect(
      salaryImports.pay({
        ...base, salaryImportId: batch.id,
        lines: [line(employeeAId, '1000.00', '1500.00')], idempotencyKey: generateId(), correlationId: generateId(),
      }),
    ).rejects.toThrow(/TDS cannot exceed/i);

    const reversedBatch = await salaryImports.reverse({
      organizationId, id: batch.id, expectedVersion: batch.version, reason: 'Corrected elsewhere',
      accountingDate: '2027-06-30', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(reversedBatch.outstandingAmount).toBe('0.00');
    await expect(
      salaryImports.pay({ ...base, salaryImportId: batch.id, lines: [line(employeeAId, '1000.00')], idempotencyKey: generateId(), correlationId: generateId() }),
    ).rejects.toThrow(/only a posted salary month can be paid/i);
  });
});

describe('SalaryImportsService — one legal entity per draft', () => {
  it("generates a legal entity's draft from its own employees only", async () => {
    const otherEntity = await prisma.client.legalEntity.findFirstOrThrow({ where: { organizationId, legalName: 'Sal Other Legal Entity' } });
    const otherEmployee = await prisma.client.employee.create({
      data: { id: generateId(), organizationId, legalEntityId: otherEntity.id, employeeCode: 'EMP-OTHER', fullName: 'Other Company Person', joiningDate: new Date('2025-01-01T00:00:00.000Z') },
    });
    await salaryRevisions.revise({
      organizationId, employeeId: otherEmployee.id, grossAmount: '99000.00', effectiveFrom: '2025-01-01',
      reason: 'Opening salary', actorId, correlationId: generateId(),
    });

    const draft = await salaryImports.generateDraft({ organizationId, legalEntityId, salaryMonth: '2025-06-01', actorId, correlationId: generateId() });
    const detail = await salaryImports.getDetail({ organizationId, id: draft.id });
    expect(detail.lines.map((l) => l.employeeId).sort()).toEqual([employeeAId, employeeBId].sort());

    const preview = await salaryImports.preview({
      organizationId, legalEntityId, salaryMonth: '2025-07-01',
      rows: [{ employeeCode: 'EMP-OTHER', employeeName: undefined, grossSalaryAmount: '99000' }],
    });
    expect(preview.rows[0]).toMatchObject({ status: 'UNMATCHED', message: 'Other Company Person works for another legal entity.' });
    expect(preview.missingEmployeeNames).not.toContain('Other Company Person');

    await salaryImports.discardDraft({ organizationId, id: draft.id, actorId, correlationId: generateId() });
  });

  it("refuses to commit a draft that carries another legal entity's employee", async () => {
    const draft = await salaryImports.generateDraft({ organizationId, legalEntityId, salaryMonth: '2025-08-01', actorId, correlationId: generateId() });
    // As an older worker would have drafted it, before employees had a legal entity.
    const other = await prisma.client.employee.findFirstOrThrow({ where: { organizationId, employeeCode: 'EMP-OTHER' } });
    await prisma.client.salaryImportLine.create({
      data: { id: generateId(), organizationId, salaryImportId: draft.id, employeeId: other.id, employeeCodeRaw: 'EMP-OTHER', employeeNameRaw: other.fullName, grossSalaryAmount: '99000.00' },
    });

    await expect(
      salaryImports.commit({ organizationId, id: draft.id, accountingDate: '2025-08-31', idempotencyKey: generateId(), actorId, correlationId: generateId() }),
    ).rejects.toThrow('Other Company Person, who does not work for this legal entity');

    await salaryImports.discardDraft({ organizationId, id: draft.id, actorId, correlationId: generateId() });
  });
});

describe('SalaryImportsService — cross-organization isolation', () => {
  it('never returns or generates against another organization’s data', async () => {
    const draft = await salaryImports.generateDraft({
      organizationId, legalEntityId, salaryMonth: '2026-10-01', actorId, correlationId: generateId(),
    });

    await expect(
      salaryImports.getDetail({ organizationId: otherOrganizationId, id: draft.id }),
    ).rejects.toThrow(/not found/i);

    const listed = await salaryImports.list({
      organizationId: otherOrganizationId, page: 1, pageSize: 100, filters: { legalEntityId: undefined, status: undefined },
    });
    expect(listed.rows).toHaveLength(0);

    // The legal entity belongs to another organization, so generating
    // against it must not resolve.
    await expect(
      salaryImports.generateDraft({
        organizationId: otherOrganizationId, legalEntityId, salaryMonth: '2026-11-01', actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/not found/i);
  });
});
