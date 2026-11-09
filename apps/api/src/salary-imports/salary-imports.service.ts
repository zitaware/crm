import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, generateId, recordAuditEvent, unscoped } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  SalaryImportDetail,
  SalaryImportPort,
  SalaryImportPreview,
  SalaryImportPreviewRow,
  SalaryImportRowInput,
  SalaryImportRowStatus,
  SalaryImportStatus,
  SalaryImportSummary,
  SalaryPaymentLineInput,
  SalaryPaymentSummary,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { EmployeeSalaryRevisionsService } from '../employees/employee-salary-revisions.service';

const COMMIT_COMMAND_TYPE = 'salary_import.commit';
const REVERSE_COMMAND_TYPE = 'salary_import.reverse';
const PAY_COMMAND_TYPE = 'salary_import.pay';
const REVERSE_PAYMENT_COMMAND_TYPE = 'salary_import.reverse_payment';

/** Retries on the generated payment number, which is derived from a count and
 * so can collide under concurrency; the unique index is the real guard. */
const MAX_NUMBER_ATTEMPTS = 5;

const LEDGER_CODES = {
  salariesWagesExpense: 'SALARIES_WAGES_EXPENSE',
  salaryPayable: 'SALARY_PAYABLE',
  tdsPayable: 'TDS_PAYABLE',
} as const;

const ZERO = () => new Prisma.Decimal(0);

function isConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function hashRequest(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/**
 * A month is the identity of a batch, so the client's date is normalised to
 * the first of that month rather than trusted. Without this, two uploads for
 * "March" dated the 1st and the 31st would look like different months and
 * the one-batch-per-month rule would silently not hold.
 */
function normalizeMonth(salaryMonth: string): Date {
  const d = toDate(salaryMonth);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Employee codes are matched case- and whitespace-insensitively: the sheet
 * is typed by a person, the master is not. */
function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

const importInclude = {
  legalEntity: true,
  lines: { orderBy: { employeeCodeRaw: 'asc' }, include: { employee: true } },
  // Every payment, not only the POSTED ones: the detail screen shows a
  // reversed payment as part of the month's history, and the outstanding
  // arithmetic below filters to POSTED itself.
  payments: {
    orderBy: { paymentDate: 'asc' },
    include: { legalEntity: true, bankAccount: true, salaryImport: true, lines: { include: { employee: true } } },
  },
} satisfies Prisma.SalaryImportInclude;

type ImportRow = Prisma.SalaryImportGetPayload<{ include: typeof importInclude }>;

function toSummary(row: ImportRow): SalaryImportSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    salaryMonth: toDateStr(row.salaryMonth),
    accountingDate: toDateStr(row.accountingDate),
    sourceFileName: row.sourceFileName,
    sourceChecksum: row.sourceChecksum,
    employeeCount: row.employeeCount,
    totalGrossAmount: row.totalGrossAmount.toFixed(2),
    status: row.status,
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    paidAmount: paidTotal(row.payments).toFixed(2),
    // A DRAFT owes nothing yet and a REVERSED month owes nothing any more —
    // only a POSTED batch carries a live liability, so only it can be
    // outstanding. Reporting the gross for the other two would invent a debt.
    outstandingAmount: (row.status === 'POSTED' ? row.totalGrossAmount.minus(paidTotal(row.payments)) : ZERO()).toFixed(2),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

/** What each employee has been paid across POSTED payments. Reversing a
 * payment removes its whole contribution without editing a row. */
function paidByEmployee(
  payments: Array<{ status: string; lines: Array<{ employeeId: string; paidAmount: Prisma.Decimal }> }>,
): Map<string, Prisma.Decimal> {
  const totals = new Map<string, Prisma.Decimal>();
  for (const payment of payments) {
    if (payment.status !== 'POSTED') continue;
    for (const line of payment.lines) {
      totals.set(line.employeeId, (totals.get(line.employeeId) ?? ZERO()).plus(line.paidAmount));
    }
  }
  return totals;
}

/** POSTED payments only, so reversing a payment restores the outstanding
 * balance without touching any row. */
function paidTotal(payments: Array<{ status: string; grossAmount: Prisma.Decimal }>): Prisma.Decimal {
  return payments.filter((p) => p.status === 'POSTED').reduce((sum, p) => sum.plus(p.grossAmount), ZERO());
}

const paymentInclude = {
  legalEntity: true,
  bankAccount: true,
  salaryImport: true,
  lines: { include: { employee: true } },
} satisfies Prisma.SalaryPaymentInclude;

type PaymentRow = Prisma.SalaryPaymentGetPayload<{ include: typeof paymentInclude }>;

function toPaymentSummary(row: PaymentRow): SalaryPaymentSummary {
  return {
    id: row.id,
    salaryImportId: row.salaryImportId,
    salaryMonth: toDateStr(row.salaryImport.salaryMonth),
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount.accountName,
    paymentNumber: row.paymentNumber,
    paymentDate: toDateStr(row.paymentDate),
    paymentModeId: row.paymentModeId,
    referenceNumber: row.referenceNumber,
    grossAmount: row.grossAmount.toFixed(2),
    tdsAmount: row.tdsAmount.toFixed(2),
    netAmount: row.netAmount.toFixed(2),
    narrative: row.narrative,
    status: row.status,
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    lines: row.lines.map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      employeeCode: l.employee.employeeCode,
      employeeName: l.employee.fullName,
      paidAmount: l.paidAmount.toFixed(2),
      tdsAmount: l.tdsAmount.toFixed(2),
      netAmount: l.paidAmount.minus(l.tdsAmount).toFixed(2),
      referenceNumber: l.referenceNumber,
    })),
  };
}

function toDetail(row: ImportRow): SalaryImportDetail {
  return {
    ...toSummary(row),
    payments: row.payments.map(toPaymentSummary),
    lines: row.lines.map((l) => {
      const paid = paidByEmployee(row.payments).get(l.employeeId) ?? ZERO();
      return {
        id: l.id,
        employeeId: l.employeeId,
        employeeCode: l.employee.employeeCode,
        employeeName: l.employee.fullName,
        employeeCodeRaw: l.employeeCodeRaw,
        employeeNameRaw: l.employeeNameRaw,
        grossSalaryAmount: l.grossSalaryAmount.toFixed(2),
        paidAmount: paid.toFixed(2),
        // Only a POSTED batch carries a live liability, so only it can leave
        // an individual outstanding.
        outstandingAmount: (row.status === 'POSTED' ? l.grossSalaryAmount.minus(paid) : ZERO()).toFixed(2),
      };
    }),
  };
}

/**
 * Monthly gross salary import (Phase 7.4, ADR-094).
 *
 * `preview` and `commit` run the SAME resolution — one `resolveRows` method
 * shared by both — so a preview that says "committable" and a commit that
 * refuses can never disagree. That is the whole point of docs/04 §13's
 * "preview before atomic commit": the preview is only trustworthy if it is
 * literally the commit's own validation, run without writing.
 */
@Injectable()
export class SalaryImportsService implements SalaryImportPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly salaryRevisions: EmployeeSalaryRevisionsService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: { legalEntityId: string | undefined; status: SalaryImportStatus | undefined };
  }): Promise<{ rows: SalaryImportSummary[]; total: number }> {
    const where: Prisma.SalaryImportWhereInput = {
      organizationId: input.organizationId,
      ...(input.filters.legalEntityId ? { legalEntityId: input.filters.legalEntityId } : {}),
      ...(input.filters.status ? { status: input.filters.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.salaryImport.findMany({
        where,
        include: importInclude,
        orderBy: [{ salaryMonth: 'desc' }, { createdAt: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.salaryImport.count({ where }),
    ]);
    return { rows: rows.map(toSummary), total };
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<SalaryImportDetail> {
    const row = await this.prisma.client.salaryImport.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: importInclude,
    });
    if (!row) throwAppError('NOT_FOUND', 'Salary import not found.');
    return toDetail(row);
  }

  // ----------------------------------------------------------- resolution

  /**
   * The single source of truth for whether an uploaded sheet may be
   * committed. Every problem docs/04 §13 names is decided here — month
   * uniqueness, duplicates, unmatched employees, and totals.
   *
   * Every row is classified rather than throwing on the first bad one, so
   * the accountant fixes the whole sheet in one pass instead of one
   * round-trip per error.
   */
  /**
   * Whose salary a legal entity's month covers (ADR-154): its own employees.
   * An employee whose legal entity is not set yet counts only when the
   * organization has a single legal entity, so a salary is never charged to
   * two entities and never silently dropped where there is no doubt.
   */
  private async payrollScope(organizationId: string, legalEntityId: string) {
    // The organization's legal entities, not only those the user sees (ADR-172).
    const entityCount = await unscoped(() => this.prisma.client.legalEntity.count({ where: { organizationId, deletedAt: null } }));
    const includesUnassigned = entityCount <= 1;
    const covers = (employee: { legalEntityId: string | null }) =>
      employee.legalEntityId === legalEntityId || (includesUnassigned && employee.legalEntityId === null);
    return { covers, includesUnassigned };
  }

  private async resolveRows(input: {
    organizationId: string;
    legalEntityId: string;
    month: Date;
    rows: SalaryImportRowInput[];
  }): Promise<{
    rows: SalaryImportPreviewRow[];
    totalGrossAmount: Prisma.Decimal;
    existingImportId: string | null;
    missingEmployeeNames: string[];
  }> {
    const employees = await this.prisma.client.employee.findMany({
      where: { organizationId: input.organizationId, deletedAt: null },
      select: { id: true, employeeCode: true, fullName: true, status: true, legalEntityId: true, displayedSalaryAmount: true },
    });
    const byCode = new Map(employees.map((e) => [normalizeCode(e.employeeCode), e]));
    const scope = await this.payrollScope(input.organizationId, input.legalEntityId);
    // A row may give only a name (ADR-170): it is found among this legal
    // entity's active employees, and the code comes from the match.
    const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byName = new Map<string, typeof employees>();
    for (const e of employees) {
      if (e.status !== 'ACTIVE' || !scope.covers(e)) continue;
      byName.set(nameKey(e.fullName), [...(byName.get(nameKey(e.fullName)) ?? []), e]);
    }

    const existing = await this.prisma.client.salaryImport.findFirst({
      where: {
        organizationId: input.organizationId,
        legalEntityId: input.legalEntityId,
        salaryMonth: input.month,
        status: 'POSTED',
      },
      select: { id: true },
    });

    const seenCodes = new Set<string>();
    const matchedEmployeeIds = new Set<string>();
    let totalGrossAmount = new Prisma.Decimal(0);

    const resolved: SalaryImportPreviewRow[] = input.rows.map((row, index) => {
      let amount: Prisma.Decimal | null = null;
      try {
        amount = new Prisma.Decimal(row.grossSalaryAmount);
      } catch {
        amount = null;
      }

      let rawCode = row.employeeCode ?? '';
      let candidates: SalaryImportPreviewRow['candidates'] = [];
      let suggestedEmployeeCode: string | null = null;
      const sheetName = row.employeeName?.trim() ?? '';
      if (!normalizeCode(rawCode) && sheetName) {
        const matches = byName.get(nameKey(sheetName)) ?? [];
        if (matches.length === 1) rawCode = matches[0]!.employeeCode;
        else if (matches.length > 1) {
          candidates = matches
            .map((e) => ({ employeeCode: e.employeeCode, fullName: e.fullName, currentSalary: e.displayedSalaryAmount ? e.displayedSalaryAmount.toFixed(2) : null }))
            .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
          const sameSalary = amount && amount.isFinite() ? candidates.filter((c) => c.currentSalary !== null && new Prisma.Decimal(c.currentSalary).equals(amount)) : [];
          suggestedEmployeeCode = sameSalary.length === 1 ? sameSalary[0]!.employeeCode : null;
        }
      }
      const code = normalizeCode(rawCode);
      const employee = byCode.get(code);

      let status: SalaryImportRowStatus = 'MATCHED';
      let message: string | null = null;

      if (candidates.length > 1) {
        status = 'AMBIGUOUS';
        message = `${candidates.length} active employees are named "${sheetName}". Choose which one by employee code.`;
      } else if (!code) {
        status = 'UNMATCHED';
        message = sheetName ? `No active employee named "${sheetName}" in this legal entity.` : 'No employee code or name in this row.';
      } else if (!employee) {
        status = 'UNMATCHED';
        message = `No employee with code "${rawCode.trim()}".`;
      } else if (!scope.covers(employee)) {
        status = 'UNMATCHED';
        message = employee.legalEntityId
          ? `${employee.fullName} works for another legal entity.`
          : `${employee.fullName} has no legal entity yet. Set it in Employees.`;
      } else if (seenCodes.has(code)) {
        status = 'DUPLICATE';
        message = `Employee code "${rawCode.trim()}" appears more than once in this file.`;
      } else if (employee.status !== 'ACTIVE') {
        status = 'INACTIVE';
        message = `${employee.fullName} is ${employee.status.toLowerCase()} and cannot be imported.`;
      } else if (amount === null || !amount.isFinite() || amount.isNegative()) {
        status = 'INVALID_AMOUNT';
        message = 'Gross salary must be a non-negative amount.';
      }

      if (code) seenCodes.add(code);
      if (status === 'MATCHED' && employee && amount) {
        matchedEmployeeIds.add(employee.id);
        totalGrossAmount = totalGrossAmount.plus(amount.toDecimalPlaces(2));
      }

      return {
        rowNumber: index + 1,
        employeeCode: rawCode.trim(),
        employeeName: row.employeeName?.trim() || null,
        grossSalaryAmount: amount && amount.isFinite() ? amount.toDecimalPlaces(2).toFixed(2) : row.grossSalaryAmount,
        status,
        employeeId: status === 'MATCHED' && employee ? employee.id : null,
        matchedEmployeeName: employee?.fullName ?? null,
        message,
        candidates,
        suggestedEmployeeCode,
      };
    });

    // Informational, never blocking: a mid-month joiner or leaver may
    // legitimately be absent from the sheet, but the accountant should see
    // who before posting a month of cost.
    const missingEmployeeNames = employees
      .filter((e) => e.status === 'ACTIVE' && scope.covers(e) && !matchedEmployeeIds.has(e.id))
      .map((e) => e.fullName)
      .sort();

    return { rows: resolved, totalGrossAmount, existingImportId: existing?.id ?? null, missingEmployeeNames };
  }

  async preview(input: {
    organizationId: string;
    legalEntityId: string;
    salaryMonth: string;
    rows: SalaryImportRowInput[];
  }): Promise<SalaryImportPreview> {
    const legalEntity = await this.prisma.client.legalEntity.findFirst({
      where: { id: input.legalEntityId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');

    const month = normalizeMonth(input.salaryMonth);
    const resolved = await this.resolveRows({ ...input, month });

    const problemCount = resolved.rows.filter((r) => r.status !== 'MATCHED').length;
    const matchedCount = resolved.rows.length - problemCount;

    return {
      salaryMonth: toDateStr(month),
      rows: resolved.rows,
      matchedCount,
      problemCount,
      totalGrossAmount: resolved.totalGrossAmount.toFixed(2),
      existingImportId: resolved.existingImportId,
      existingImportMessage: resolved.existingImportId
        ? 'This month has already been imported for this legal entity. Reverse that import before posting a corrected one.'
        : null,
      missingEmployeeNames: resolved.missingEmployeeNames,
      isCommittable: problemCount === 0 && matchedCount > 0 && !resolved.existingImportId,
    };
  }

  // -------------------------------------------------------------- commands

  /**
   * Creates this month's DRAFT batch from each employee's effective salary
   * revision (ADR-098).
   *
   * This is what replaced the mandatory monthly CSV: a salary is a durable
   * fact that changes occasionally, so the batch is *generated* from the
   * compensation history and the accountant only reviews it. The committed
   * batch is still the historical authority docs/16 §7.6 requires — it is
   * simply produced rather than typed.
   *
   * Idempotent by construction: if a draft already covers this month it is
   * returned untouched rather than regenerated, so a worker tick and a
   * human clicking Generate cannot produce two.
   */
  async generateDraft(input: {
    organizationId: string;
    legalEntityId: string;
    salaryMonth: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryImportSummary> {
    const legalEntity = await this.prisma.client.legalEntity.findFirst({
      where: { id: input.legalEntityId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');

    const month = normalizeMonth(input.salaryMonth);

    const existing = await this.prisma.client.salaryImport.findFirst({
      where: { organizationId: input.organizationId, legalEntityId: input.legalEntityId, salaryMonth: month, status: { in: ['DRAFT', 'POSTED'] } },
      include: importInclude,
    });
    if (existing) {
      if (existing.status === 'POSTED') {
        throwAppError('VALIDATION_FAILED', 'This month has already been posted for this legal entity. Reverse it before generating a new draft.');
      }
      return toSummary(existing);
    }

    const allActive = await this.prisma.client.employee.findMany({
      where: { organizationId: input.organizationId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, employeeCode: true, fullName: true, legalEntityId: true },
    });
    const scope = await this.payrollScope(input.organizationId, input.legalEntityId);
    const employees = allActive.filter(scope.covers);
    const grossByEmployee = await this.salaryRevisions.grossByEmployeeForMonth(input.organizationId, month);

    const rows = employees
      .filter((e) => grossByEmployee.has(e.id))
      .map((e) => ({ employee: e, gross: grossByEmployee.get(e.id)!.toDecimalPlaces(2) }));

    // An empty draft would violate chk_salary_imports_totals and, more to
    // the point, means nobody has a salary on record for this month — a
    // setup problem to report, not a document to create.
    if (rows.length === 0) {
      const unassigned = scope.includesUnassigned ? 0 : allActive.filter((e) => e.legalEntityId === null).length;
      throwAppError(
        'VALIDATION_FAILED',
        unassigned > 0
          ? `No active employee of this legal entity has a salary effective for this month. ${unassigned} active employee(s) have no legal entity yet; set it in Employees.`
          : 'No active employee of this legal entity has a salary effective for this month. Record salaries first.',
      );
    }

    const totalGrossAmount = rows.reduce((sum, r) => sum.plus(r.gross), new Prisma.Decimal(0));
    const importId = generateId();

    return await this.prisma.client.$transaction(async (tx) => {
      await tx.salaryImport.create({
        data: {
          id: importId,
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId,
          salaryMonth: month,
          // Month-end by default — the accountant sets the real one at commit.
          accountingDate: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)),
          sourceFileName: null,
          sourceChecksum: hashRequest(rows.map((r) => ({ code: r.employee.employeeCode, amount: r.gross.toFixed(2) }))),
          employeeCount: rows.length,
          totalGrossAmount,
          status: 'DRAFT',
          journalEntryId: null,
          createdBy: input.actorId,
        },
      });

      await tx.salaryImportLine.createMany({
        data: rows.map((r) => ({
          id: generateId(),
          organizationId: input.organizationId,
          salaryImportId: importId,
          employeeId: r.employee.id,
          employeeCodeRaw: r.employee.employeeCode,
          employeeNameRaw: r.employee.fullName,
          grossSalaryAmount: r.gross,
        })),
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: input.legalEntityId,
        entityType: 'SALARY_IMPORT',
        entityId: importId,
        action: 'SALARY_IMPORT_DRAFT_GENERATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { salaryMonth: toDateStr(month), employeeCount: rows.length, totalGrossAmount: totalGrossAmount.toFixed(2) },
      });

      const created = await tx.salaryImport.findFirstOrThrow({ where: { id: importId }, include: importInclude });
      return toSummary(created);
    });
  }

  /**
   * Replaces a draft's rows — the CSV path, and the way exceptions (a joiner,
   * unpaid leave, a bonus month) get applied before committing.
   *
   * Runs the same `resolveRows` validation the commit does, so a sheet that
   * this accepts is a sheet the commit will accept.
   */
  async replaceDraftRows(input: {
    organizationId: string;
    id: string;
    sourceFileName: string | undefined;
    rows: SalaryImportRowInput[];
    actorId: string;
    correlationId: string;
  }): Promise<SalaryImportSummary> {
    const batch = await this.prisma.client.salaryImport.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
    if (!batch) throwAppError('NOT_FOUND', 'Salary import not found.');
    if (batch.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft can be edited.');

    const resolved = await this.resolveRows({
      organizationId: input.organizationId,
      legalEntityId: batch.legalEntityId,
      month: batch.salaryMonth,
      rows: input.rows,
    });
    const problems = resolved.rows.filter((r) => r.status !== 'MATCHED');
    if (problems.length > 0) {
      throwAppError(
        'VALIDATION_FAILED',
        `${problems.length} row(s) cannot be imported — the whole month posts or none of it does. First problem: row ${problems[0]!.rowNumber}, ${problems[0]!.message}`,
      );
    }
    if (resolved.rows.length === 0) throwAppError('VALIDATION_FAILED', 'There is nothing to import.');

    return await this.prisma.client.$transaction(async (tx) => {
      // A draft's lines carry no identity of their own and nothing
      // references them, so they are replaced wholesale rather than diffed —
      // the same choice EmployeeAllocationsService makes for its draft lines.
      await tx.salaryImportLine.deleteMany({ where: { salaryImportId: batch.id } });
      await tx.salaryImportLine.createMany({
        data: resolved.rows.map((r) => ({
          id: generateId(),
          organizationId: input.organizationId,
          salaryImportId: batch.id,
          employeeId: r.employeeId!,
          employeeCodeRaw: r.employeeCode,
          employeeNameRaw: r.employeeName,
          grossSalaryAmount: new Prisma.Decimal(r.grossSalaryAmount),
        })),
      });
      await tx.salaryImport.update({
        where: { id: batch.id },
        data: {
          employeeCount: resolved.rows.length,
          totalGrossAmount: resolved.totalGrossAmount,
          sourceFileName: input.sourceFileName ?? null,
          sourceChecksum: hashRequest(resolved.rows.map((r) => ({ code: r.employeeCode, amount: r.grossSalaryAmount }))),
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: batch.legalEntityId,
        entityType: 'SALARY_IMPORT',
        entityId: batch.id,
        action: 'SALARY_IMPORT_DRAFT_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { employeeCount: resolved.rows.length, totalGrossAmount: resolved.totalGrossAmount.toFixed(2) },
      });

      const updated = await tx.salaryImport.findFirstOrThrow({ where: { id: batch.id }, include: importInclude });
      return toSummary(updated);
    });
  }

  /** Discards a draft. Safe by definition — nothing has been posted. */
  async discardDraft(input: { organizationId: string; id: string; actorId: string; correlationId: string }): Promise<void> {
    const batch = await this.prisma.client.salaryImport.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
    if (!batch) throwAppError('NOT_FOUND', 'Salary import not found.');
    if (batch.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft can be discarded. A posted month is reversed, not deleted.');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.salaryImportLine.deleteMany({ where: { salaryImportId: batch.id } });
      await tx.salaryImport.delete({ where: { id: batch.id } });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: batch.legalEntityId,
        entityType: 'SALARY_IMPORT',
        entityId: batch.id,
        action: 'SALARY_IMPORT_DRAFT_DISCARDED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { salaryMonth: toDateStr(batch.salaryMonth), totalGrossAmount: batch.totalGrossAmount.toFixed(2) },
      });
    });
  }

  /**
   * Promotes a DRAFT to POSTED, posting the gross salary journal.
   *
   * Everything the old create-and-post `commit` validated is validated here
   * against the persisted draft instead of transient input, so the reviewed
   * rows and the posted rows are by definition the same rows.
   */
  async commit(input: {
    organizationId: string;
    id: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryImportSummary> {
    const requestHash = hashRequest({ id: input.id, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: COMMIT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as SalaryImportSummary;
    }

    const batch = await this.prisma.client.salaryImport.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: importInclude,
    });
    if (!batch) throwAppError('NOT_FOUND', 'Salary import not found.');
    if (batch.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'This month has already been committed.');
    if (batch.lines.length === 0) throwAppError('VALIDATION_FAILED', 'There is nothing to import.');
    // ADR-154: a draft made before employees had a legal entity, or by an
    // older worker, may carry another entity's people. Never post them here.
    const scope = await this.payrollScope(input.organizationId, batch.legalEntityId);
    const lineEmployees = await this.prisma.client.employee.findMany({
      where: { id: { in: batch.lines.map((l) => l.employeeId) }, organizationId: input.organizationId },
      select: { fullName: true, legalEntityId: true },
    });
    const outside = lineEmployees.filter((e) => !scope.covers(e)).map((e) => e.fullName);
    if (outside.length > 0) {
      throwAppError(
        'VALIDATION_FAILED',
        `This draft includes ${outside.join(', ')}, who ${outside.length === 1 ? 'does' : 'do'} not work for this legal entity. Discard the draft and generate it again.`,
      );
    }
    if (!batch.totalGrossAmount.greaterThan(0)) {
      throwAppError('VALIDATION_FAILED', 'A salary import must carry a gross total greater than zero.');
    }

    const accountingDate = toDate(input.accountingDate);
    // The cost of a month cannot be recognised before that month begins.
    if (accountingDate < batch.salaryMonth) {
      throwAppError('VALIDATION_FAILED', 'The accounting date cannot fall before the month being imported.');
    }

    // Another batch for this month may have been posted since the draft was
    // generated; the partial unique index would catch it, but the caller
    // deserves a sentence.
    const alreadyPosted = await this.prisma.client.salaryImport.findFirst({
      where: {
        organizationId: input.organizationId,
        legalEntityId: batch.legalEntityId,
        salaryMonth: batch.salaryMonth,
        status: 'POSTED',
      },
      select: { id: true },
    });
    if (alreadyPosted) {
      throwAppError('VALIDATION_FAILED', 'This month has already been imported for this legal entity. Reverse that import before posting a corrected one.');
    }

    const ledgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, code: { in: Object.values(LEDGER_CODES) } },
    });
    const byCode = new Map(ledgerAccounts.map((a) => [a.code, a]));
    const expenseAccount = byCode.get(LEDGER_CODES.salariesWagesExpense);
    if (!expenseAccount) throwAppError('VALIDATION_FAILED', 'Salaries & Wages Expense ledger account is not configured.');
    const payableAccount = byCode.get(LEDGER_CODES.salaryPayable);
    if (!payableAccount) throwAppError('VALIDATION_FAILED', 'Salary Payable ledger account is not configured.');

    const monthLabel = toDateStr(batch.salaryMonth).slice(0, 7);

    // One debit and one credit line PER EMPLOYEE, both stamped with the
    // employee dimension docs/06 already names. A single summed pair would
    // balance just as well, but then "what is still owed to this employee"
    // would be unanswerable from the ledger, and the employee dimension on
    // JournalLine would exist with nothing ever populating it.
    const journalLines = batch.lines.flatMap((line) => {
      const amount = line.grossSalaryAmount.toFixed(2);
      const shared = {
        projectId: undefined,
        partyId: undefined,
        employeeId: line.employeeId,
        gstRegistrationId: undefined,
        taxCode: undefined,
        narrative: `${line.employee.fullName} — ${monthLabel}`,
      };
      return [
        { ledgerAccountId: expenseAccount.id, debit: amount, credit: '0', ...shared },
        { ledgerAccountId: payableAccount.id, debit: '0', credit: amount, ...shared },
      ];
    });

    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: batch.legalEntityId,
      accountingDate: input.accountingDate,
      sourceType: 'salary_import',
      sourceId: batch.id,
      postingEvent: 'salary_import.committed',
      description: `Gross salary — ${monthLabel}`,
      lines: journalLines,
      idempotencyKey: `${COMMIT_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.salaryImport.updateMany({
        where: { id: batch.id, organizationId: input.organizationId, status: 'DRAFT' },
        data: {
          status: 'POSTED',
          accountingDate,
          journalEntryId: journal.id,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This salary import was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: batch.legalEntityId,
        entityType: 'SALARY_IMPORT',
        entityId: batch.id,
        action: 'SALARY_IMPORT_COMMITTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: {
          salaryMonth: toDateStr(batch.salaryMonth),
          employeeCount: batch.lines.length,
          totalGrossAmount: batch.totalGrossAmount.toFixed(2),
          journalEntryId: journal.id,
        },
      });

      const committed = await tx.salaryImport.findFirstOrThrow({ where: { id: batch.id }, include: importInclude });
      const summary = toSummary(committed);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: COMMIT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'SALARY_IMPORT',
          sourceRecordId: batch.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }


  /**
   * Reverses a committed month: reverses its journal and frees the month for
   * a corrected re-import.
   *
   * The batch's own lines are never edited or deleted — they stay as the
   * permanent record of what was posted, exactly as a reversed journal keeps
   * its lines (ADR-067). Freeing the month works because the uniqueness rule
   * is a PARTIAL index over POSTED rows only.
   */
  async reverse(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryImportSummary> {
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a salary import.');

    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: REVERSE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as SalaryImportSummary;
    }

    const batch = await this.prisma.client.salaryImport.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: importInclude,
    });
    if (!batch) throwAppError('NOT_FOUND', 'Salary import not found.');
    if (batch.status !== 'POSTED')
      throwAppError(
        'INVALID_STATE_TRANSITION',
        batch.status === 'DRAFT' ? 'A draft has posted nothing to reverse — discard it instead.' : 'This salary import is already reversed.',
      );
    // Guaranteed non-null for a POSTED batch by chk_salary_imports_journal_by_status,
    // but the type is nullable now that a DRAFT may have none.
    if (!batch.journalEntryId) throwAppError('VALIDATION_FAILED', 'This salary import has no journal to reverse.');

    const reversalJournal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: batch.journalEntryId,
      accountingDate: input.accountingDate,
      reason: input.reason,
      idempotencyKey: `${REVERSE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.salaryImport.updateMany({
        where: { id: batch.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'POSTED' },
        data: {
          status: 'REVERSED',
          reversalJournalEntryId: reversalJournal.id,
          reversedAt: new Date(),
          reversedBy: input.actorId,
          reversalReason: input.reason,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This salary import was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: batch.legalEntityId,
        entityType: 'SALARY_IMPORT',
        entityId: batch.id,
        action: 'SALARY_IMPORT_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        newValues: { reversalJournalEntryId: reversalJournal.id },
      });

      const updated = await tx.salaryImport.findFirstOrThrow({ where: { id: batch.id }, include: importInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVERSE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'SALARY_IMPORT',
          sourceRecordId: batch.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  // ------------------------------------------------------------- payment

  /**
   * Settles part or all of a posted month (ADR-100).
   *
   * Dr Salary Payable (gross) / Cr TDS Payable (tds) / Cr Bank (net). TDS is
   * withheld rather than paid — it moves from one liability to another and
   * only the net actually leaves the bank, which is why gross is not simply
   * the cash figure.
   *
   * Per-month, not per-employee. The commit posts one payable line PER
   * employee, so the ledger can still answer "what is owed to this person";
   * settlement is per-month because salary leaves the bank as one transfer.
   */
  async pay(input: {
    organizationId: string;
    salaryImportId: string;
    bankAccountId: string;
    paymentDate: string;
    paymentModeId: string | undefined;
    referenceNumber: string | undefined;
    lines: SalaryPaymentLineInput[];
    narrative: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryPaymentSummary> {
    const requestHash = hashRequest({
      salaryImportId: input.salaryImportId,
      bankAccountId: input.bankAccountId,
      paymentDate: input.paymentDate,
      lines: input.lines.map((l) => ({ employeeId: l.employeeId, paidAmount: l.paidAmount, tdsAmount: l.tdsAmount })),
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: PAY_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as SalaryPaymentSummary;
    }

    if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one employee must be paid.');
    const employeeIds = new Set(input.lines.map((l) => l.employeeId));
    if (employeeIds.size !== input.lines.length) {
      throwAppError('VALIDATION_FAILED', 'The same employee appears twice — one person cannot be paid twice in one transfer.');
    }

    const batch = await this.prisma.client.salaryImport.findFirst({
      where: { id: input.salaryImportId, organizationId: input.organizationId },
      include: importInclude,
    });
    if (!batch) throwAppError('NOT_FOUND', 'Salary import not found.');
    // A DRAFT has recognised no liability, and a REVERSED month's liability
    // has already been unwound — paying either would debit a payable that
    // was never credited.
    if (batch.status !== 'POSTED') {
      throwAppError('INVALID_STATE_TRANSITION', 'Only a posted salary month can be paid. Commit it first.');
    }

    // Each employee's OWN outstanding is enforced, not merely the month's
    // total: overpaying one person while the month still has headroom
    // elsewhere would leave that person's payable negative.
    const alreadyPaid = paidByEmployee(batch.payments);
    const byEmployee = new Map(batch.lines.map((l) => [l.employeeId, l]));

    let grossAmount = ZERO();
    let tdsAmount = ZERO();
    const resolved: Array<{ employeeId: string; name: string; paid: Prisma.Decimal; tds: Prisma.Decimal; referenceNumber: string | null }> = [];

    for (const line of input.lines) {
      const importLine = byEmployee.get(line.employeeId);
      if (!importLine) throwAppError('VALIDATION_FAILED', 'An employee being paid is not part of this salary month.');

      const paid = new Prisma.Decimal(line.paidAmount).toDecimalPlaces(2);
      const tds = new Prisma.Decimal(line.tdsAmount).toDecimalPlaces(2);
      const name = importLine.employee.fullName;
      if (!paid.greaterThan(0)) throwAppError('VALIDATION_FAILED', `${name}: the amount paid must be greater than zero.`);
      if (tds.lessThan(0)) throwAppError('VALIDATION_FAILED', `${name}: TDS cannot be negative.`);
      // TDS is withheld FROM the amount settled, never added to it.
      if (tds.greaterThan(paid)) throwAppError('VALIDATION_FAILED', `${name}: TDS cannot exceed the amount being settled.`);

      const outstanding = importLine.grossSalaryAmount.minus(alreadyPaid.get(line.employeeId) ?? ZERO());
      if (paid.greaterThan(outstanding)) {
        throwAppError('VALIDATION_FAILED', `${name} is owed only ${outstanding.toFixed(2)} for this month — paying ${paid.toFixed(2)} would discharge more than was ever owed.`);
      }

      grossAmount = grossAmount.plus(paid);
      tdsAmount = tdsAmount.plus(tds);
      resolved.push({ employeeId: line.employeeId, name, paid, tds, referenceNumber: line.referenceNumber?.trim() || null });
    }
    const netAmount = grossAmount.minus(tdsAmount);

    // The cost was recognised in a legal entity; the cash must leave the same
    // one, or the payment would settle a liability the paying entity never
    // carried.
    const bankAccount = await this.prisma.client.bankAccount.findFirst({
      where: { id: input.bankAccountId, organizationId: input.organizationId },
    });
    if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
    if (bankAccount.legalEntityId !== batch.legalEntityId) {
      throwAppError('VALIDATION_FAILED', 'The bank account belongs to a different legal entity than the salary month.');
    }
    if (!bankAccount.isActive) throwAppError('VALIDATION_FAILED', 'That bank account is inactive.');

    if (toDate(input.paymentDate) < batch.salaryMonth) {
      throwAppError('VALIDATION_FAILED', 'A salary month cannot be paid before the month it covers begins.');
    }

    const ledgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, code: { in: [LEDGER_CODES.salaryPayable, LEDGER_CODES.tdsPayable] } },
    });
    const byCode = new Map(ledgerAccounts.map((a) => [a.code, a]));
    const payableAccount = byCode.get(LEDGER_CODES.salaryPayable);
    if (!payableAccount) throwAppError('VALIDATION_FAILED', 'Salary Payable ledger account is not configured.');
    const tdsAccount = byCode.get(LEDGER_CODES.tdsPayable);
    if (tdsAmount.greaterThan(0) && !tdsAccount) throwAppError('VALIDATION_FAILED', 'TDS Payable ledger account is not configured.');

    const monthLabel = toDateStr(batch.salaryMonth).slice(0, 7);
    const paymentId = generateId();

    // One debit and up to two credits PER EMPLOYEE, each carrying the
    // employee dimension — the mirror of the per-employee credit the import
    // posted (ADR-094), so the ledger alone can answer what is still owed to
    // one person. A zero leg is omitted; the posting engine rejects a line
    // that is neither a debit nor a credit.
    const journalLines = resolved.flatMap((r) => {
      const shared = {
        projectId: undefined,
        partyId: undefined,
        employeeId: r.employeeId,
        gstRegistrationId: undefined,
        taxCode: undefined,
        narrative: `${r.name} — ${monthLabel}${r.referenceNumber ? ` (${r.referenceNumber})` : ''}`,
      };
      const net = r.paid.minus(r.tds);
      return [
        { ledgerAccountId: payableAccount.id, debit: r.paid.toFixed(2), credit: '0', ...shared },
        ...(r.tds.greaterThan(0) ? [{ ledgerAccountId: tdsAccount!.id, debit: '0', credit: r.tds.toFixed(2), ...shared }] : []),
        ...(net.greaterThan(0) ? [{ ledgerAccountId: bankAccount.ledgerAccountId, debit: '0', credit: net.toFixed(2), ...shared }] : []),
      ];
    });

    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: batch.legalEntityId,
      accountingDate: input.paymentDate,
      sourceType: 'salary_payment',
      sourceId: paymentId,
      postingEvent: 'salary_payment.posted',
      description: `Salary payment — ${monthLabel}`,
      lines: journalLines,
      idempotencyKey: `${PAY_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          // Counted across the organization, every legal entity's included (ADR-172).
          const count = await unscoped(() => tx.salaryPayment.count({ where: { organizationId: input.organizationId } }));
          const paymentNumber = `SALP-${String(count + 1 + attempt).padStart(6, '0')}`;

          await tx.salaryPayment.create({
            data: {
              id: paymentId,
              organizationId: input.organizationId,
              legalEntityId: batch.legalEntityId,
              salaryImportId: batch.id,
              bankAccountId: input.bankAccountId,
              paymentNumber,
              paymentDate: toDate(input.paymentDate),
              paymentModeId: input.paymentModeId ?? null,
              referenceNumber: input.referenceNumber ?? null,
              grossAmount,
              tdsAmount,
              netAmount,
              narrative: input.narrative ?? null,
              status: 'POSTED',
              journalEntryId: journal.id,
              createdBy: input.actorId,
            },
          });

          await tx.salaryPaymentLine.createMany({
            data: resolved.map((r) => ({
              id: generateId(),
              organizationId: input.organizationId,
              salaryPaymentId: paymentId,
              employeeId: r.employeeId,
              paidAmount: r.paid,
              tdsAmount: r.tds,
              referenceNumber: r.referenceNumber,
            })),
          });

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            legalEntityId: batch.legalEntityId,
            entityType: 'SALARY_PAYMENT',
            entityId: paymentId,
            action: 'SALARY_PAYMENT_POSTED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: {
              paymentNumber,
              salaryMonth: toDateStr(batch.salaryMonth),
              employeeCount: resolved.length,
              grossAmount: grossAmount.toFixed(2),
              tdsAmount: tdsAmount.toFixed(2),
              netAmount: netAmount.toFixed(2),
              journalEntryId: journal.id,
            },
          });

          const created = await tx.salaryPayment.findFirstOrThrow({ where: { id: paymentId }, include: paymentInclude });
          const summary = toPaymentSummary(created);

          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: PAY_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              sourceRecordType: 'SALARY_PAYMENT',
              sourceRecordId: paymentId,
              resultReference: summary as unknown as Prisma.InputJsonValue,
            },
          });
          return summary;
        });
      } catch (error) {
        if (isConstraintViolation(error) && attempt < MAX_NUMBER_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return throwAppError('VALIDATION_FAILED', 'Could not post the payment due to a conflict. Please try again.');
  }

  /**
   * Reverses a payment: reverses its journal and, because outstanding is
   * computed from POSTED payments only, restores the month's balance without
   * editing a single figure.
   */
  async reversePayment(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryPaymentSummary> {
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a payment.');

    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: REVERSE_PAYMENT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as SalaryPaymentSummary;
    }

    const payment = await this.prisma.client.salaryPayment.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: paymentInclude,
    });
    if (!payment) throwAppError('NOT_FOUND', 'Salary payment not found.');
    if (payment.status !== 'POSTED') throwAppError('INVALID_STATE_TRANSITION', 'This payment is already reversed.');

    const reversalJournal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: payment.journalEntryId,
      accountingDate: input.accountingDate,
      reason: input.reason,
      idempotencyKey: `${REVERSE_PAYMENT_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.salaryPayment.updateMany({
        where: { id: payment.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'POSTED' },
        data: {
          status: 'REVERSED',
          reversalJournalEntryId: reversalJournal.id,
          reversedAt: new Date(),
          reversedBy: input.actorId,
          reversalReason: input.reason,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This payment was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: payment.legalEntityId,
        entityType: 'SALARY_PAYMENT',
        entityId: payment.id,
        action: 'SALARY_PAYMENT_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        newValues: { reversalJournalEntryId: reversalJournal.id },
      });

      const updated = await tx.salaryPayment.findFirstOrThrow({
        where: { id: payment.id },
        include: paymentInclude,
      });
      const summary = toPaymentSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVERSE_PAYMENT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'SALARY_PAYMENT',
          sourceRecordId: payment.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });
      return summary;
    });
  }

  async listPayments(input: { organizationId: string; salaryImportId: string | undefined }): Promise<SalaryPaymentSummary[]> {
    const rows = await this.prisma.client.salaryPayment.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.salaryImportId ? { salaryImportId: input.salaryImportId } : {}),
      },
      include: paymentInclude,
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toPaymentSummary);
  }
}
