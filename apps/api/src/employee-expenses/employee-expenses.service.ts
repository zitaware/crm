import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  ClaimApproverUser,
  LegalEntityClaimApprovers,
  EmployeeExpensePort,
  EmployeeAdvanceSummary,
  EmployeeExpenseClaimSummary,
  EmployeeExpenseClaimDetail,
  EmployeeAdvanceFilters,
  EmployeeExpenseClaimFilters,
  EmployeeExpenseClaimStatsFilters,
  EmployeeExpenseClaimStats,
  EmployeeWalletStatement,
  EmployeeWalletEntryType,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';

const ADVANCE_ISSUE_COMMAND_TYPE = 'employee_advance.issue';
const ADVANCE_REVERSE_COMMAND_TYPE = 'employee_advance.reverse';
const CLAIM_CREATE_DRAFT_COMMAND_TYPE = 'employee_expense_claim.create_draft';
const CLAIM_SUBMIT_COMMAND_TYPE = 'employee_expense_claim.submit';
const CLAIM_APPROVE_COMMAND_TYPE = 'employee_expense_claim.approve';
const CLAIM_REJECT_COMMAND_TYPE = 'employee_expense_claim.reject';
const CLAIM_CANCEL_COMMAND_TYPE = 'employee_expense_claim.cancel';
const CLAIM_REIMBURSE_COMMAND_TYPE = 'employee_expense_claim.reimburse';
const CLAIM_REIMBURSE_REVERSE_COMMAND_TYPE = 'employee_expense_claim.reverse_reimbursement';
const OPEN_CLAIM_STATUSES = new Set(['DRAFT', 'SUBMITTED']);

const EMPLOYEE_ADVANCE_RECEIVABLE_CODE = 'EMPLOYEE_ADVANCE_RECEIVABLE';
const INPUT_GST_RECEIVABLE_EXPENSE_CODE = 'INPUT_GST_RECEIVABLE_EXPENSE';
const DEFAULT_EXPENSE_CODE = 'OTHER_EXPENSES';

function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const advanceInclude = {
  legalEntity: true,
  employee: true,
  project: true,
  paymentMode: true,
  bankAccount: true,
} satisfies Prisma.EmployeeAdvanceInclude;

type AdvanceRow = Prisma.EmployeeAdvanceGetPayload<{ include: typeof advanceInclude }>;

function toAdvanceSummary(row: AdvanceRow): EmployeeAdvanceSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    employeeId: row.employeeId,
    employeeName: row.employee.fullName,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    amount: row.amount.toFixed(2),
    advanceDate: toDateStr(row.advanceDate),
    paymentModeId: row.paymentModeId,
    paymentModeLabel: row.paymentMode.label,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount.accountName,
    utrReference: row.utrReference,
    purpose: row.purpose,
    note: row.note,
    status: row.status,
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    reversedBy: row.reversedBy,
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

const claimSummaryInclude = {
  legalEntity: true,
  employee: true,
  expenseCategory: true,
  project: true,
  decisions: { orderBy: { decidedAt: 'desc' }, take: 1 },
} satisfies Prisma.EmployeeExpenseClaimInclude;

const claimDetailInclude = {
  ...claimSummaryInclude,
  decisions: { orderBy: { decidedAt: 'desc' } },
} satisfies Prisma.EmployeeExpenseClaimInclude;

/**
 * Names a claim shows (ADR-171): who approves it, who decided, who
 * reimbursed. A command's reply goes without them (approval null); the
 * lists and the detail fill them in.
 */
interface ClaimNames {
  /** Each legal entity's own approvers (ADR-182). */
  approversByEntity: Map<string, ClaimApproverUser[]>;
  users: Map<string, string>;
}

type ClaimSummaryRow = Prisma.EmployeeExpenseClaimGetPayload<{ include: typeof claimSummaryInclude }>;
type ClaimDetailRow = Prisma.EmployeeExpenseClaimGetPayload<{ include: typeof claimDetailInclude }>;

function toClaimSummary(row: ClaimSummaryRow, names: ClaimNames | null = null): EmployeeExpenseClaimSummary {
  const listed = names?.approversByEntity.get(row.legalEntityId);
  const latest = row.decisions[0];
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    employeeId: row.employeeId,
    employeeName: row.employee.fullName,
    expenseCategoryId: row.expenseCategoryId,
    expenseCategoryName: row.expenseCategory.name,
    title: row.title,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    amount: row.amount.toFixed(2),
    expenseDate: toDateStr(row.expenseDate),
    gstInvoiceAvailable: row.gstInvoiceAvailable,
    gstCreditAmount: row.gstCreditAmount.toFixed(2),
    note: row.note,
    status: row.status,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledBy: row.cancelledBy,
    cancelledReason: row.cancelledReason,
    journalEntryId: row.journalEntryId,
    reimbursementJournalEntryId: row.reimbursementJournalEntryId,
    reimbursementReversalJournalEntryId: row.reimbursementReversalJournalEntryId,
    reimbursementReversalReason: row.reimbursementReversalReason,
    reimbursedAt: row.reimbursedAt ? row.reimbursedAt.toISOString() : null,
    reimbursedBy: row.reimbursedBy,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    approval: names ? { rule: 'LISTED', approverNames: (listed ?? []).map((u) => u.name), approverUserIds: (listed ?? []).map((u) => u.userId) } : null,
    lastDecision: latest ? { decision: latest.decision, byName: names?.users.get(latest.actorId) ?? null, at: latest.decidedAt.toISOString() } : null,
    reimbursedByName: row.reimbursedBy ? (names?.users.get(row.reimbursedBy) ?? null) : null,
  };
}

function toClaimDetail(row: ClaimDetailRow, names: ClaimNames | null = null): EmployeeExpenseClaimDetail {
  return {
    ...toClaimSummary(row, names),
    decisions: row.decisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      actorId: d.actorId,
      decidedAt: d.decidedAt.toISOString(),
      note: d.note,
      isSelfApproval: d.isSelfApproval,
      actorName: names?.users.get(d.actorId) ?? null,
    })),
  };
}

@Injectable()
export class EmployeeExpensesService implements EmployeeExpensePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  private async resolveOwnEmployee(organizationId: string, actorId: string) {
    return this.prisma.client.employee.findFirst({ where: { organizationId, userId: actorId, deletedAt: null } });
  }

  private async assertEmployeeReimbursable(organizationId: string, employeeId: string) {
    const employee = await this.prisma.client.employee.findFirst({ where: { id: employeeId, organizationId, deletedAt: null } });
    if (!employee) throwAppError('NOT_FOUND', 'Employee not found.');
    if (employee.status !== 'ACTIVE') throwAppError('VALIDATION_FAILED', 'This employee is not active.');
    if (!employee.isReimbursable) throwAppError('VALIDATION_FAILED', 'This employee is not marked as reimbursement-eligible.');
    return employee;
  }

  /** legalEntityId derives from projectId when given (mirrors Vendor
   * Bill); when projectId is absent ("company overhead"), legalEntityId
   * must be supplied directly (mirrors Payment Request's own Legal
   * Entity selection workflow). */
  private async resolveLegalEntityId(
    organizationId: string,
    projectId: string | undefined,
    legalEntityId: string | undefined,
  ): Promise<{ legalEntityId: string; projectId: string | null }> {
    if (projectId) {
      const project = await this.prisma.client.project.findFirst({ where: { id: projectId, organizationId } });
      if (!project) throwAppError('NOT_FOUND', 'Project not found.');
      if (legalEntityId && legalEntityId !== project.legalEntityId) throwAppError('VALIDATION_FAILED', `Project "${project.name}" belongs to another legal entity.`);
      return { legalEntityId: project.legalEntityId, projectId: project.id };
    }
    if (!legalEntityId) throwAppError('VALIDATION_FAILED', 'Legal entity is required when no project is selected.');
    const legalEntity = await this.prisma.client.legalEntity.findFirst({ where: { id: legalEntityId, organizationId, deletedAt: null } });
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');
    if (!legalEntity.isActive) throwAppError('VALIDATION_FAILED', 'This legal entity is inactive.');
    return { legalEntityId: legalEntity.id, projectId: null };
  }

  private async resolveLedgerAccount(organizationId: string, code: string, label: string) {
    const account = await this.prisma.client.ledgerAccount.findFirst({ where: { organizationId, code } });
    if (!account) throwAppError('VALIDATION_FAILED', `Required ledger account (${label}) is not configured.`);
    return account;
  }

  /** The single bidirectional control-account balance for one employee —
   * sum(debit) - sum(credit) across every JournalLine ever posted to
   * EMPLOYEE_ADVANCE_RECEIVABLE with this employeeId dimension. A
   * reversal's own journal lines carry the identical employeeId dimension
   * with debit/credit flipped (PostingService.reverseJournal), so
   * summing unconditionally — never filtering by journalEntry status —
   * already nets a reversed original against its own reversal correctly. */
  private async getEmployeeWalletBalance(organizationId: string, employeeId: string, beforeDate?: Date): Promise<Prisma.Decimal> {
    const ledgerAccount = await this.prisma.client.ledgerAccount.findFirst({ where: { organizationId, code: EMPLOYEE_ADVANCE_RECEIVABLE_CODE } });
    if (!ledgerAccount) return new Prisma.Decimal(0);
    const lines = await this.prisma.client.journalLine.findMany({
      where: {
        organizationId,
        employeeId,
        ledgerAccountId: ledgerAccount.id,
        ...(beforeDate ? { journalEntry: { accountingDate: { lt: beforeDate } } } : {}),
      },
      select: { debitAmount: true, creditAmount: true },
    });
    return lines.reduce((sum, l) => sum.plus(l.debitAmount).minus(l.creditAmount), new Prisma.Decimal(0));
  }

  async getMyEmployeeStatus(input: { organizationId: string; actorId: string }): Promise<{ hasEmployee: boolean; isReimbursable: boolean; employeeName: string | null }> {
    const employee = await this.resolveOwnEmployee(input.organizationId, input.actorId);
    if (!employee) return { hasEmployee: false, isReimbursable: false, employeeName: null };
    return { hasEmployee: true, isReimbursable: employee.isReimbursable && employee.status === 'ACTIVE', employeeName: employee.fullName };
  }

  async getMyClaims(input: { organizationId: string; actorId: string }): Promise<EmployeeExpenseClaimSummary[]> {
    const employee = await this.resolveOwnEmployee(input.organizationId, input.actorId);
    if (!employee) return [];
    const rows = await this.prisma.client.employeeExpenseClaim.findMany({
      where: { organizationId: input.organizationId, employeeId: employee.id },
      include: claimSummaryInclude,
      orderBy: { createdAt: 'desc' },
    });
    const names = await this.claimNames(input.organizationId, rows);
    return rows.map((row) => toClaimSummary(row, names));
  }

  private async buildWalletStatement(organizationId: string, employee: { id: string; fullName: string }, month: string): Promise<EmployeeWalletStatement> {
    const [yearStr, monthStr] = month.split('-');
    const monthStart = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
    const monthEndExclusive = new Date(Date.UTC(Number(yearStr), Number(monthStr), 1));

    const ledgerAccount = await this.resolveLedgerAccount(organizationId, EMPLOYEE_ADVANCE_RECEIVABLE_CODE, 'Employee Advance Receivable');

    const [openingBalance, monthLinesRaw] = await Promise.all([
      this.getEmployeeWalletBalance(organizationId, employee.id, monthStart),
      this.prisma.client.journalLine.findMany({
        where: { organizationId, employeeId: employee.id, ledgerAccountId: ledgerAccount.id, journalEntry: { accountingDate: { gte: monthStart, lt: monthEndExclusive } } },
        include: { journalEntry: true },
      }),
    ]);

    const monthLines = [...monthLinesRaw].sort(
      (a, b) => a.journalEntry.accountingDate.getTime() - b.journalEntry.accountingDate.getTime() || a.journalEntry.createdAt.getTime() - b.journalEntry.createdAt.getTime(),
    );

    const journalEntryIds = monthLines.map((l) => l.journalEntryId);
    const [advancesByJournal, advancesByReversal, claimsByJournal, claimsByReimbursement, claimsByReimbursementReversal] = await Promise.all([
      this.prisma.client.employeeAdvance.findMany({ where: { organizationId, journalEntryId: { in: journalEntryIds } } }),
      this.prisma.client.employeeAdvance.findMany({ where: { organizationId, reversalJournalEntryId: { in: journalEntryIds } } }),
      this.prisma.client.employeeExpenseClaim.findMany({ where: { organizationId, journalEntryId: { in: journalEntryIds } } }),
      this.prisma.client.employeeExpenseClaim.findMany({ where: { organizationId, reimbursementJournalEntryId: { in: journalEntryIds } } }),
      this.prisma.client.employeeExpenseClaim.findMany({ where: { organizationId, reimbursementReversalJournalEntryId: { in: journalEntryIds } } }),
    ]);

    const eventByJournalEntryId = new Map<string, { type: EmployeeWalletEntryType; particulars: string; sourceId: string }>();
    for (const a of advancesByJournal) eventByJournalEntryId.set(a.journalEntryId!, { type: 'ADVANCE', particulars: `Advance given${a.purpose ? ` — ${a.purpose}` : ''}`, sourceId: a.id });
    for (const a of advancesByReversal) eventByJournalEntryId.set(a.reversalJournalEntryId!, { type: 'ADVANCE_REVERSAL', particulars: `Advance reversed — ${a.reversalReason ?? ''}`, sourceId: a.id });
    for (const c of claimsByJournal) eventByJournalEntryId.set(c.journalEntryId!, { type: 'CLAIM', particulars: c.title, sourceId: c.id });
    for (const c of claimsByReimbursement) eventByJournalEntryId.set(c.reimbursementJournalEntryId!, { type: 'REIMBURSEMENT', particulars: `Reimbursed — ${c.title}`, sourceId: c.id });
    for (const c of claimsByReimbursementReversal)
      eventByJournalEntryId.set(c.reimbursementReversalJournalEntryId!, { type: 'REIMBURSEMENT_REVERSAL', particulars: `Reimbursement reversed — ${c.title}`, sourceId: c.id });

    let running = openingBalance;
    let totalAdvances = new Prisma.Decimal(0);
    let totalClaims = new Prisma.Decimal(0);
    let totalReimbursed = new Prisma.Decimal(0);
    const entries = monthLines.map((line) => {
      const event = eventByJournalEntryId.get(line.journalEntryId) ?? { type: 'ADVANCE' as const, particulars: line.journalEntry.description ?? '—', sourceId: line.journalEntryId };
      running = running.plus(line.debitAmount).minus(line.creditAmount);
      if (event.type === 'ADVANCE') totalAdvances = totalAdvances.plus(line.debitAmount);
      if (event.type === 'CLAIM') totalClaims = totalClaims.plus(line.creditAmount);
      if (event.type === 'REIMBURSEMENT') totalReimbursed = totalReimbursed.plus(line.debitAmount);
      return {
        date: toDateStr(line.journalEntry.accountingDate),
        type: event.type,
        particulars: event.particulars,
        sourceId: event.sourceId,
        debit: line.debitAmount.toFixed(2),
        credit: line.creditAmount.toFixed(2),
        runningBalance: running.toFixed(2),
      };
    });

    return {
      employeeId: employee.id,
      employeeName: employee.fullName,
      month,
      openingBalance: openingBalance.toFixed(2),
      entries,
      closingBalance: running.toFixed(2),
      totalAdvances: totalAdvances.toFixed(2),
      totalClaims: totalClaims.toFixed(2),
      totalReimbursed: totalReimbursed.toFixed(2),
    };
  }

  async getMyWalletStatement(input: { organizationId: string; actorId: string; month: string }): Promise<EmployeeWalletStatement> {
    const employee = await this.resolveOwnEmployee(input.organizationId, input.actorId);
    if (!employee) throwAppError('NOT_FOUND', 'No employee record is linked to your account.');
    return this.buildWalletStatement(input.organizationId, employee, input.month);
  }

  async calculateAdvanceWalletImpact(input: { organizationId: string; employeeId: string; amount: string }): Promise<{ currentBalance: string; newBalance: string }> {
    const currentBalance = await this.getEmployeeWalletBalance(input.organizationId, input.employeeId);
    const amount = input.amount ? new Prisma.Decimal(input.amount) : new Prisma.Decimal(0);
    return { currentBalance: currentBalance.toFixed(2), newBalance: currentBalance.plus(amount).toFixed(2) };
  }

  async issueAdvance(input: {
    organizationId: string;
    employeeId: string;
    projectId: string | undefined;
    legalEntityId: string | undefined;
    amount: string;
    advanceDate: string;
    paymentModeId: string;
    bankAccountId: string;
    utrReference: string | undefined;
    purpose: string | undefined;
    note: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAdvanceSummary> {
    const requestHash = hashRequest({
      employeeId: input.employeeId,
      projectId: input.projectId,
      legalEntityId: input.legalEntityId,
      amount: input.amount,
      advanceDate: input.advanceDate,
      paymentModeId: input.paymentModeId,
      bankAccountId: input.bankAccountId,
      utrReference: input.utrReference,
      purpose: input.purpose,
      note: input.note,
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: ADVANCE_ISSUE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as EmployeeAdvanceSummary;
    }

    const employee = await this.assertEmployeeReimbursable(input.organizationId, input.employeeId);
    const { legalEntityId, projectId } = await this.resolveLegalEntityId(input.organizationId, input.projectId, input.legalEntityId);
    if (employee.legalEntityId && employee.legalEntityId !== legalEntityId) throwAppError('VALIDATION_FAILED', `${employee.fullName} belongs to another legal entity; give the advance from their own company.`);

    const bankAccount = await this.prisma.client.bankAccount.findFirst({ where: { id: input.bankAccountId, organizationId: input.organizationId }, include: { ledgerAccount: true } });
    if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
    if (!bankAccount.isActive) throwAppError('VALIDATION_FAILED', 'This bank account is inactive.');
    if (bankAccount.legalEntityId !== legalEntityId) throwAppError('VALIDATION_FAILED', 'The bank account must belong to the same legal entity.');

    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Advance amount must be greater than zero.');

    const controlAccount = await this.resolveLedgerAccount(input.organizationId, EMPLOYEE_ADVANCE_RECEIVABLE_CODE, 'Employee Advance Receivable');

    const advanceId = generateId();
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId,
      accountingDate: input.advanceDate,
      sourceType: ADVANCE_ISSUE_COMMAND_TYPE,
      sourceId: advanceId,
      postingEvent: 'employee_advance.issued',
      description: `Advance given to ${employee.fullName}`,
      lines: [
        {
          ledgerAccountId: controlAccount.id,
          debit: amount.toFixed(2),
          credit: '0',
          projectId: projectId ?? undefined,
          partyId: undefined,
          employeeId: input.employeeId,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
        {
          ledgerAccountId: bankAccount.ledgerAccount.id,
          debit: '0',
          credit: amount.toFixed(2),
          projectId: projectId ?? undefined,
          partyId: undefined,
          employeeId: input.employeeId,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
      ],
      idempotencyKey: `${ADVANCE_ISSUE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      await tx.employeeAdvance.create({
        data: {
          id: advanceId,
          organizationId: input.organizationId,
          legalEntityId,
          employeeId: input.employeeId,
          projectId,
          amount,
          advanceDate: toDate(input.advanceDate),
          paymentModeId: input.paymentModeId,
          bankAccountId: input.bankAccountId,
          utrReference: input.utrReference ?? null,
          purpose: input.purpose ?? null,
          note: input.note ?? null,
          status: 'POSTED',
          journalEntryId: journal.id,
          createdBy: input.actorId,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_ADVANCE',
        entityId: advanceId,
        action: 'EMPLOYEE_ADVANCE_ISSUED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { employeeId: input.employeeId, amount: amount.toFixed(2), journalEntryId: journal.id },
      });

      const created = await tx.employeeAdvance.findFirstOrThrow({ where: { id: advanceId }, include: advanceInclude });
      const summary = toAdvanceSummary(created);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: ADVANCE_ISSUE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'EMPLOYEE_ADVANCE',
          sourceRecordId: advanceId,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async reverseAdvance(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAdvanceSummary> {
    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: ADVANCE_REVERSE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as EmployeeAdvanceSummary;
    }

    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse an advance.');

    const advance = await this.prisma.client.employeeAdvance.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!advance) throwAppError('NOT_FOUND', 'Advance not found.');
    if (advance.status === 'REVERSED') throwAppError('INVALID_STATE_TRANSITION', 'This advance has already been reversed.');
    if (!advance.journalEntryId) throwAppError('VALIDATION_FAILED', 'This advance has no journal entry to reverse.');

    const reversal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: advance.journalEntryId,
      accountingDate: input.accountingDate,
      reason,
      idempotencyKey: `${ADVANCE_REVERSE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeAdvance.updateMany({
        where: { id: advance.id, version: input.expectedVersion, status: 'POSTED' },
        data: { status: 'REVERSED', reversalJournalEntryId: reversal.id, reversalReason: reason, reversedBy: input.actorId, reversedAt: new Date(), version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This advance was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_ADVANCE',
        entityId: advance.id,
        action: 'EMPLOYEE_ADVANCE_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { reversalReason: reason, reversalJournalEntryId: reversal.id },
      });

      const row = await tx.employeeAdvance.findFirstOrThrow({ where: { id: advance.id }, include: advanceInclude });
      const summary = toAdvanceSummary(row);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: ADVANCE_REVERSE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'EMPLOYEE_ADVANCE',
          sourceRecordId: advance.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async listAdvances(input: { organizationId: string; page: number; pageSize: number; filters: EmployeeAdvanceFilters }): Promise<{ rows: EmployeeAdvanceSummary[]; total: number }> {
    const where: Prisma.EmployeeAdvanceWhereInput = { organizationId: input.organizationId };
    if (input.filters.employeeId) where.employeeId = input.filters.employeeId;
    if (input.filters.legalEntityId) where.legalEntityId = input.filters.legalEntityId;
    if (input.filters.status) where.status = input.filters.status;

    const [rows, total] = await Promise.all([
      this.prisma.client.employeeAdvance.findMany({ where, include: advanceInclude, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      this.prisma.client.employeeAdvance.count({ where }),
    ]);
    return { rows: rows.map(toAdvanceSummary), total };
  }

  async getAdvanceDetail(input: { organizationId: string; id: string }): Promise<EmployeeAdvanceSummary> {
    const row = await this.prisma.client.employeeAdvance.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: advanceInclude });
    if (!row) throwAppError('NOT_FOUND', 'Advance not found.');
    return toAdvanceSummary(row);
  }

  async createClaimDraft(input: {
    organizationId: string;
    employeeId: string | undefined;
    expenseCategoryId: string;
    title: string;
    projectId: string | undefined;
    legalEntityId: string | undefined;
    amount: string;
    expenseDate: string;
    gstInvoiceAvailable: boolean;
    gstCreditAmount: string | undefined;
    note: string | undefined;
    idempotencyKey: string;
    actorId: string;
    hasApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary> {
    const requestHash = hashRequest({
      employeeId: input.employeeId,
      expenseCategoryId: input.expenseCategoryId,
      title: input.title,
      projectId: input.projectId,
      legalEntityId: input.legalEntityId,
      amount: input.amount,
      expenseDate: input.expenseDate,
      gstInvoiceAvailable: input.gstInvoiceAvailable,
      gstCreditAmount: input.gstCreditAmount,
      note: input.note,
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CLAIM_CREATE_DRAFT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as EmployeeExpenseClaimSummary;
    }

    let employee;
    if (input.employeeId) {
      if (!input.hasApprovePermission) throwAppError('FORBIDDEN', 'You do not have permission to create an expense claim on behalf of another employee.');
      employee = await this.assertEmployeeReimbursable(input.organizationId, input.employeeId);
    } else {
      employee = await this.resolveOwnEmployee(input.organizationId, input.actorId);
      if (!employee) throwAppError('VALIDATION_FAILED', 'No employee record is linked to your account.');
      if (employee.status !== 'ACTIVE') throwAppError('VALIDATION_FAILED', 'This employee is not active.');
      if (!employee.isReimbursable) throwAppError('VALIDATION_FAILED', 'You are not marked as reimbursement-eligible — contact an administrator.');
    }

    const { legalEntityId, projectId } = await this.resolveLegalEntityId(input.organizationId, input.projectId, input.legalEntityId);
    // On someone's behalf, the claim is the employee's own company's (ADR-183).
    if (input.employeeId && employee.legalEntityId && employee.legalEntityId !== legalEntityId) {
      throwAppError('VALIDATION_FAILED', `${employee.fullName} belongs to another legal entity; choose a project or legal entity of their own company.`);
    }

    const category = await this.prisma.client.expenseCategory.findFirst({ where: { id: input.expenseCategoryId, organizationId: input.organizationId, deletedAt: null } });
    if (!category) throwAppError('NOT_FOUND', 'Expense category not found.');
    if (!category.isActive) throwAppError('VALIDATION_FAILED', `Expense category "${category.name}" is inactive.`);

    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Amount must be greater than zero.');
    const gstCreditAmount = input.gstCreditAmount ? new Prisma.Decimal(input.gstCreditAmount) : new Prisma.Decimal(0);
    if (gstCreditAmount.isNegative()) throwAppError('VALIDATION_FAILED', 'GST credit amount must not be negative.');
    if (gstCreditAmount.greaterThan(amount)) throwAppError('VALIDATION_FAILED', 'GST credit cannot exceed the claim amount.');
    if (gstCreditAmount.greaterThan(0) && !input.gstInvoiceAvailable) throwAppError('VALIDATION_FAILED', 'A GST invoice must be available to claim GST credit.');

    const claimId = generateId();
    return await this.prisma.client.$transaction(async (tx) => {
      await tx.employeeExpenseClaim.create({
        data: {
          id: claimId,
          organizationId: input.organizationId,
          legalEntityId,
          employeeId: employee.id,
          expenseCategoryId: input.expenseCategoryId,
          title: input.title,
          projectId,
          amount,
          expenseDate: toDate(input.expenseDate),
          gstInvoiceAvailable: input.gstInvoiceAvailable,
          gstCreditAmount,
          note: input.note ?? null,
          status: 'DRAFT',
          createdBy: input.actorId,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_EXPENSE_CLAIM',
        entityId: claimId,
        action: 'EMPLOYEE_EXPENSE_CLAIM_DRAFT_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { title: input.title, amount: amount.toFixed(2) },
      });

      const created = await tx.employeeExpenseClaim.findFirstOrThrow({ where: { id: claimId }, include: claimSummaryInclude });
      const summary = toClaimSummary(created);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CLAIM_CREATE_DRAFT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'EMPLOYEE_EXPENSE_CLAIM',
          sourceRecordId: claimId,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async updateClaimDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    expenseCategoryId: string | undefined;
    title: string | undefined;
    projectId: string | undefined;
    legalEntityId: string | undefined;
    amount: string | undefined;
    expenseDate: string | undefined;
    gstInvoiceAvailable: boolean | undefined;
    gstCreditAmount: string | undefined;
    note: string | undefined;
    actorId: string;
    hasApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary> {
    const existing = await this.prisma.client.employeeExpenseClaim.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Expense claim not found.');
    if (!input.hasApprovePermission) {
      const ownEmployee = await this.resolveOwnEmployee(input.organizationId, input.actorId);
      if (!ownEmployee || existing.employeeId !== ownEmployee.id) throwAppError('FORBIDDEN', 'You can only edit your own expense claim.');
    }
    if (existing.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft expense claim can be updated.');

    let legalEntityId = existing.legalEntityId;
    let projectId = existing.projectId;
    if (input.projectId !== undefined || input.legalEntityId !== undefined) {
      const resolved = await this.resolveLegalEntityId(
        input.organizationId,
        input.projectId !== undefined ? input.projectId : (existing.projectId ?? undefined),
        input.legalEntityId !== undefined ? input.legalEntityId : (existing.projectId ? undefined : existing.legalEntityId),
      );
      legalEntityId = resolved.legalEntityId;
      projectId = resolved.projectId;
    }

    const expenseCategoryId = input.expenseCategoryId ?? existing.expenseCategoryId;
    if (input.expenseCategoryId) {
      const category = await this.prisma.client.expenseCategory.findFirst({ where: { id: expenseCategoryId, organizationId: input.organizationId, deletedAt: null } });
      if (!category) throwAppError('NOT_FOUND', 'Expense category not found.');
      if (!category.isActive) throwAppError('VALIDATION_FAILED', `Expense category "${category.name}" is inactive.`);
    }

    const amount = input.amount !== undefined ? new Prisma.Decimal(input.amount) : existing.amount;
    if (amount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Amount must be greater than zero.');
    const gstInvoiceAvailable = input.gstInvoiceAvailable ?? existing.gstInvoiceAvailable;
    const gstCreditAmount = input.gstCreditAmount !== undefined ? new Prisma.Decimal(input.gstCreditAmount) : existing.gstCreditAmount;
    if (gstCreditAmount.isNegative()) throwAppError('VALIDATION_FAILED', 'GST credit amount must not be negative.');
    if (gstCreditAmount.greaterThan(amount)) throwAppError('VALIDATION_FAILED', 'GST credit cannot exceed the claim amount.');
    if (gstCreditAmount.greaterThan(0) && !gstInvoiceAvailable) throwAppError('VALIDATION_FAILED', 'A GST invoice must be available to claim GST credit.');

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeExpenseClaim.updateMany({
        where: { id: existing.id, version: input.expectedVersion, status: 'DRAFT' },
        data: {
          legalEntityId,
          projectId,
          expenseCategoryId,
          title: input.title ?? existing.title,
          amount,
          expenseDate: input.expenseDate ? toDate(input.expenseDate) : existing.expenseDate,
          gstInvoiceAvailable,
          gstCreditAmount,
          note: input.note !== undefined ? input.note : existing.note,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This expense claim was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_EXPENSE_CLAIM',
        entityId: existing.id,
        action: 'EMPLOYEE_EXPENSE_CLAIM_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { title: input.title ?? existing.title, amount: amount.toFixed(2) },
      });

      const updated = await tx.employeeExpenseClaim.findFirstOrThrow({ where: { id: existing.id }, include: claimSummaryInclude });
      return toClaimSummary(updated);
    });
  }

  async submitClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    hasApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary> {
    const requestHash = hashRequest({ id: input.id });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CLAIM_SUBMIT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as EmployeeExpenseClaimSummary;
    }

    const existing = await this.prisma.client.employeeExpenseClaim.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Expense claim not found.');
    if (!input.hasApprovePermission) {
      const ownEmployee = await this.resolveOwnEmployee(input.organizationId, input.actorId);
      if (!ownEmployee || existing.employeeId !== ownEmployee.id) throwAppError('FORBIDDEN', 'You can only submit your own expense claim.');
    }
    if (existing.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft expense claim can be submitted.');

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeExpenseClaim.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'DRAFT' },
        data: { status: 'SUBMITTED', submittedAt: new Date(), updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This expense claim was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_EXPENSE_CLAIM',
        entityId: input.id,
        action: 'EMPLOYEE_EXPENSE_CLAIM_SUBMITTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { title: existing.title },
      });

      const updated = await tx.employeeExpenseClaim.findFirstOrThrow({ where: { id: input.id }, include: claimSummaryInclude });
      const summary = toClaimSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CLAIM_SUBMIT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'EMPLOYEE_EXPENSE_CLAIM',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async approveClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    note: string | undefined;
    idempotencyKey: string;
    actorId: string;
    hasSelfApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary> {
    const requestHash = hashRequest({ id: input.id, note: input.note });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CLAIM_APPROVE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as EmployeeExpenseClaimSummary;
    }

    const claim = await this.prisma.client.employeeExpenseClaim.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: { expenseCategory: true } });
    if (!claim) throwAppError('NOT_FOUND', 'Expense claim not found.');
    if (claim.status !== 'SUBMITTED') throwAppError('INVALID_STATE_TRANSITION', 'Only a submitted expense claim can be approved.');
    await this.assertMayDecide(input.organizationId, claim.legalEntityId, input.actorId);

    const isSelfApproval = claim.createdBy === input.actorId;
    if (isSelfApproval) {
      if (!input.hasSelfApprovePermission) throwAppError('FORBIDDEN', 'You cannot approve your own expense claim.');
      if (!input.note?.trim()) throwAppError('VALIDATION_FAILED', 'A justification note is required to approve your own expense claim.');
    }

    const expenseLedgerAccountId = claim.expenseCategory.ledgerAccountId ?? (await this.resolveLedgerAccount(input.organizationId, DEFAULT_EXPENSE_CODE, 'Other Expenses')).id;
    const controlAccount = await this.resolveLedgerAccount(input.organizationId, EMPLOYEE_ADVANCE_RECEIVABLE_CODE, 'Employee Advance Receivable');
    const gstCreditAmount = claim.gstCreditAmount;
    const expenseDebit = claim.amount.minus(gstCreditAmount);

    const journalLines = [
      {
        ledgerAccountId: expenseLedgerAccountId,
        debit: expenseDebit.toFixed(2),
        credit: '0',
        projectId: claim.projectId ?? undefined,
        partyId: undefined,
        employeeId: claim.employeeId,
        gstRegistrationId: undefined,
        taxCode: undefined,
        narrative: undefined,
      },
      ...(gstCreditAmount.greaterThan(0)
        ? [
            {
              ledgerAccountId: (await this.resolveLedgerAccount(input.organizationId, INPUT_GST_RECEIVABLE_EXPENSE_CODE, 'Input GST Receivable — Expense Claims')).id,
              debit: gstCreditAmount.toFixed(2),
              credit: '0',
              projectId: claim.projectId ?? undefined,
              partyId: undefined,
              employeeId: claim.employeeId,
              gstRegistrationId: undefined,
              taxCode: undefined,
              narrative: undefined,
            },
          ]
        : []),
      {
        ledgerAccountId: controlAccount.id,
        debit: '0',
        credit: claim.amount.toFixed(2),
        projectId: claim.projectId ?? undefined,
        partyId: undefined,
        employeeId: claim.employeeId,
        gstRegistrationId: undefined,
        taxCode: undefined,
        narrative: undefined,
      },
    ];

    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: claim.legalEntityId,
      accountingDate: toDateStr(claim.expenseDate),
      sourceType: CLAIM_APPROVE_COMMAND_TYPE,
      sourceId: claim.id,
      postingEvent: 'employee_expense_claim.approved',
      description: `Expense claim approved — ${claim.title}`,
      lines: journalLines,
      idempotencyKey: `${CLAIM_APPROVE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeExpenseClaim.updateMany({
        where: { id: claim.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'SUBMITTED' },
        data: { status: 'APPROVED', journalEntryId: journal.id, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This expense claim was changed by someone else. Reload and try again.');

      await tx.employeeExpenseClaimDecision.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          claimId: claim.id,
          decision: 'APPROVED',
          actorId: input.actorId,
          note: input.note?.trim() || null,
          isSelfApproval,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_EXPENSE_CLAIM',
        entityId: claim.id,
        action: 'EMPLOYEE_EXPENSE_CLAIM_APPROVED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { amount: claim.amount.toFixed(2), journalEntryId: journal.id, isSelfApproval },
      });

      const updated = await tx.employeeExpenseClaim.findFirstOrThrow({ where: { id: claim.id }, include: claimSummaryInclude });
      const summary = toClaimSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CLAIM_APPROVE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'EMPLOYEE_EXPENSE_CLAIM',
          sourceRecordId: claim.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async rejectClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary> {
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to reject an expense claim.');

    const requestHash = hashRequest({ id: input.id, reason });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CLAIM_REJECT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as EmployeeExpenseClaimSummary;
    }

    const existing = await this.prisma.client.employeeExpenseClaim.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Expense claim not found.');
    if (existing.status !== 'SUBMITTED') throwAppError('INVALID_STATE_TRANSITION', 'Only a submitted expense claim can be rejected.');
    await this.assertMayDecide(input.organizationId, existing.legalEntityId, input.actorId);

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeExpenseClaim.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'SUBMITTED' },
        data: { status: 'REJECTED', updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This expense claim was changed by someone else. Reload and try again.');

      await tx.employeeExpenseClaimDecision.create({
        data: { id: generateId(), organizationId: input.organizationId, claimId: input.id, decision: 'REJECTED', actorId: input.actorId, note: reason, isSelfApproval: false },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_EXPENSE_CLAIM',
        entityId: input.id,
        action: 'EMPLOYEE_EXPENSE_CLAIM_REJECTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { reason },
      });

      const updated = await tx.employeeExpenseClaim.findFirstOrThrow({ where: { id: input.id }, include: claimSummaryInclude });
      const summary = toClaimSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CLAIM_REJECT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'EMPLOYEE_EXPENSE_CLAIM',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async cancelClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    hasApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary> {
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to cancel an expense claim.');

    const requestHash = hashRequest({ id: input.id, reason });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CLAIM_CANCEL_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as EmployeeExpenseClaimSummary;
    }

    const existing = await this.prisma.client.employeeExpenseClaim.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Expense claim not found.');
    if (!input.hasApprovePermission) {
      const ownEmployee = await this.resolveOwnEmployee(input.organizationId, input.actorId);
      if (!ownEmployee || existing.employeeId !== ownEmployee.id) throwAppError('FORBIDDEN', 'You can only cancel your own expense claim.');
    }
    if (!OPEN_CLAIM_STATUSES.has(existing.status)) throwAppError('INVALID_STATE_TRANSITION', 'Only a draft or submitted expense claim can be cancelled.');

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeExpenseClaim.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: input.actorId, cancelledReason: reason, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This expense claim was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_EXPENSE_CLAIM',
        entityId: input.id,
        action: 'EMPLOYEE_EXPENSE_CLAIM_CANCELLED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { reason },
      });

      const updated = await tx.employeeExpenseClaim.findFirstOrThrow({ where: { id: input.id }, include: claimSummaryInclude });
      const summary = toClaimSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CLAIM_CANCEL_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'EMPLOYEE_EXPENSE_CLAIM',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async reimburseClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    bankAccountId: string;
    reimbursementDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary> {
    const requestHash = hashRequest({ id: input.id, bankAccountId: input.bankAccountId, reimbursementDate: input.reimbursementDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CLAIM_REIMBURSE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as EmployeeExpenseClaimSummary;
    }

    const claim = await this.prisma.client.employeeExpenseClaim.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!claim) throwAppError('NOT_FOUND', 'Expense claim not found.');
    if (claim.status !== 'APPROVED') throwAppError('INVALID_STATE_TRANSITION', 'Only an approved expense claim can be reimbursed.');

    const bankAccount = await this.prisma.client.bankAccount.findFirst({ where: { id: input.bankAccountId, organizationId: input.organizationId }, include: { ledgerAccount: true } });
    if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
    if (!bankAccount.isActive) throwAppError('VALIDATION_FAILED', 'This bank account is inactive.');
    if (bankAccount.legalEntityId !== claim.legalEntityId) throwAppError('VALIDATION_FAILED', 'The bank account must belong to the same legal entity as the claim.');

    const controlAccount = await this.resolveLedgerAccount(input.organizationId, EMPLOYEE_ADVANCE_RECEIVABLE_CODE, 'Employee Advance Receivable');

    // Unlike approveClaim (a claim can only ever be approved once — REJECTED/
    // CANCELLED are terminal, so claim.id is a safe, unique-for-life
    // sourceId), a claim CAN be reimbursed more than once over its lifetime
    // (reimburse -> reverseReimbursement -> reimburse again) — reusing
    // claim.id as sourceId on a second attempt would collide with the first
    // attempt's own row under JournalEntry's
    // uq_journal_entries_org_source constraint. A fresh id per attempt
    // avoids that.
    const reimbursementAttemptId = generateId();
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: claim.legalEntityId,
      accountingDate: input.reimbursementDate,
      sourceType: CLAIM_REIMBURSE_COMMAND_TYPE,
      sourceId: reimbursementAttemptId,
      postingEvent: 'employee_expense_claim.reimbursed',
      description: `Expense claim reimbursed — ${claim.title}`,
      lines: [
        {
          ledgerAccountId: controlAccount.id,
          debit: claim.amount.toFixed(2),
          credit: '0',
          projectId: claim.projectId ?? undefined,
          partyId: undefined,
          employeeId: claim.employeeId,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
        {
          ledgerAccountId: bankAccount.ledgerAccount.id,
          debit: '0',
          credit: claim.amount.toFixed(2),
          projectId: claim.projectId ?? undefined,
          partyId: undefined,
          employeeId: claim.employeeId,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
      ],
      idempotencyKey: `${CLAIM_REIMBURSE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeExpenseClaim.updateMany({
        where: { id: claim.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'APPROVED' },
        data: { status: 'REIMBURSED', reimbursementJournalEntryId: journal.id, reimbursedAt: new Date(), reimbursedBy: input.actorId, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This expense claim was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_EXPENSE_CLAIM',
        entityId: claim.id,
        action: 'EMPLOYEE_EXPENSE_CLAIM_REIMBURSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { amount: claim.amount.toFixed(2), journalEntryId: journal.id },
      });

      const updated = await tx.employeeExpenseClaim.findFirstOrThrow({ where: { id: claim.id }, include: claimSummaryInclude });
      const summary = toClaimSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CLAIM_REIMBURSE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'EMPLOYEE_EXPENSE_CLAIM',
          sourceRecordId: claim.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  /** Reverses REIMBURSED -> back to APPROVED (not a new terminal state) —
   * lets the accountant simply re-run reimburseClaim after correcting a
   * mistaken payment. reimbursementJournalEntryId/reimbursedAt/
   * reimbursedBy stay set as a permanent historical record (mirrors
   * VendorBill's own journalEntryId/voidJournalEntryId both staying set
   * forever), alongside the new reimbursementReversalJournalEntryId. */
  async reverseReimbursement(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary> {
    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CLAIM_REIMBURSE_REVERSE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as EmployeeExpenseClaimSummary;
    }

    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a reimbursement.');

    const claim = await this.prisma.client.employeeExpenseClaim.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!claim) throwAppError('NOT_FOUND', 'Expense claim not found.');
    if (claim.status !== 'REIMBURSED') throwAppError('INVALID_STATE_TRANSITION', 'Only a reimbursed expense claim can have its reimbursement reversed.');
    if (!claim.reimbursementJournalEntryId) throwAppError('VALIDATION_FAILED', 'This expense claim has no reimbursement journal entry to reverse.');

    const reversal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: claim.reimbursementJournalEntryId,
      accountingDate: input.accountingDate,
      reason,
      idempotencyKey: `${CLAIM_REIMBURSE_REVERSE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeExpenseClaim.updateMany({
        where: { id: claim.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'REIMBURSED' },
        data: { status: 'APPROVED', reimbursementReversalJournalEntryId: reversal.id, reimbursementReversalReason: reason, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This expense claim was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_EXPENSE_CLAIM',
        entityId: claim.id,
        action: 'EMPLOYEE_EXPENSE_CLAIM_REIMBURSEMENT_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { reason, reversalJournalEntryId: reversal.id },
      });

      const updated = await tx.employeeExpenseClaim.findFirstOrThrow({ where: { id: claim.id }, include: claimSummaryInclude });
      const summary = toClaimSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CLAIM_REIMBURSE_REVERSE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'EMPLOYEE_EXPENSE_CLAIM',
          sourceRecordId: claim.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async listClaims(input: { organizationId: string; page: number; pageSize: number; filters: EmployeeExpenseClaimFilters }): Promise<{ rows: EmployeeExpenseClaimSummary[]; total: number }> {
    const where: Prisma.EmployeeExpenseClaimWhereInput = { organizationId: input.organizationId };
    if (input.filters.employeeId) where.employeeId = input.filters.employeeId;
    if (input.filters.expenseCategoryId) where.expenseCategoryId = input.filters.expenseCategoryId;
    if (input.filters.projectId) where.projectId = input.filters.projectId;
    if (input.filters.status) where.status = input.filters.status;
    if (input.filters.expenseDateFrom || input.filters.expenseDateTo) {
      where.expenseDate = {
        ...(input.filters.expenseDateFrom ? { gte: toDate(input.filters.expenseDateFrom) } : {}),
        ...(input.filters.expenseDateTo ? { lte: toDate(input.filters.expenseDateTo) } : {}),
      };
    }
    if (input.filters.approvedDateFrom || input.filters.approvedDateTo) {
      where.decisions = {
        some: {
          decision: 'APPROVED',
          decidedAt: {
            ...(input.filters.approvedDateFrom ? { gte: new Date(`${input.filters.approvedDateFrom}T00:00:00.000Z`) } : {}),
            ...(input.filters.approvedDateTo ? { lte: new Date(`${input.filters.approvedDateTo}T23:59:59.999Z`) } : {}),
          },
        },
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.employeeExpenseClaim.findMany({ where, include: claimSummaryInclude, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      this.prisma.client.employeeExpenseClaim.count({ where }),
    ]);
    const names = await this.claimNames(input.organizationId, rows);
    return { rows: rows.map((row) => toClaimSummary(row, names)), total };
  }

  async getClaimStats(input: { organizationId: string; filters: EmployeeExpenseClaimStatsFilters }): Promise<EmployeeExpenseClaimStats> {
    const baseWhere: Prisma.EmployeeExpenseClaimWhereInput = { organizationId: input.organizationId };
    if (input.filters.employeeId) baseWhere.employeeId = input.filters.employeeId;
    if (input.filters.expenseCategoryId) baseWhere.expenseCategoryId = input.filters.expenseCategoryId;
    if (input.filters.projectId) baseWhere.projectId = input.filters.projectId;

    const hasExpenseDateFilter = !!(input.filters.expenseDateFrom || input.filters.expenseDateTo);
    const expenseDateFilter: Prisma.EmployeeExpenseClaimWhereInput = hasExpenseDateFilter
      ? {
          expenseDate: {
            ...(input.filters.expenseDateFrom ? { gte: toDate(input.filters.expenseDateFrom) } : {}),
            ...(input.filters.expenseDateTo ? { lte: toDate(input.filters.expenseDateTo) } : {}),
          },
        }
      : {};

    const hasApprovedDateFilter = !!(input.filters.approvedDateFrom || input.filters.approvedDateTo);
    const approvedDecisionFilter: Prisma.EmployeeExpenseClaimWhereInput = hasApprovedDateFilter
      ? {
          decisions: {
            some: {
              decision: 'APPROVED',
              decidedAt: {
                ...(input.filters.approvedDateFrom ? { gte: new Date(`${input.filters.approvedDateFrom}T00:00:00.000Z`) } : {}),
                ...(input.filters.approvedDateTo ? { lte: new Date(`${input.filters.approvedDateTo}T23:59:59.999Z`) } : {}),
              },
            },
          },
        }
      : {};

    const isCurrentFinancialYear = !hasExpenseDateFilter && !hasApprovedDateFilter;
    let reimbursedWhere: Prisma.EmployeeExpenseClaimWhereInput = { ...baseWhere, status: 'REIMBURSED' };
    if (isCurrentFinancialYear) {
      // No date filter supplied — default the Reimbursed tile to the
      // org's current financial year, matching its own "(FY)" label. An
      // org with multiple legal entities may have more than one
      // isCurrent row (the flag is per legal entity, not per org); this
      // takes the widest bounding range across all of them rather than
      // picking one arbitrarily, a disclosed approximation for that edge
      // case, not a bug for the common single-legal-entity org.
      const currentFinancialYears = await this.prisma.client.financialYear.findMany({ where: { organizationId: input.organizationId, isCurrent: true } });
      if (currentFinancialYears.length > 0) {
        const start = currentFinancialYears.reduce((min, fy) => (fy.startDate < min ? fy.startDate : min), currentFinancialYears[0]!.startDate);
        const end = currentFinancialYears.reduce((max, fy) => (fy.endDate > max ? fy.endDate : max), currentFinancialYears[0]!.endDate);
        reimbursedWhere = { ...reimbursedWhere, reimbursedAt: { gte: start, lte: end } };
      }
    } else {
      reimbursedWhere = { ...reimbursedWhere, ...expenseDateFilter, ...approvedDecisionFilter };
    }

    const [pendingAgg, approvedAgg, reimbursedAgg] = await Promise.all([
      this.prisma.client.employeeExpenseClaim.aggregate({ where: { ...baseWhere, status: 'SUBMITTED', ...expenseDateFilter }, _sum: { amount: true }, _count: true }),
      this.prisma.client.employeeExpenseClaim.aggregate({ where: { ...baseWhere, status: 'APPROVED', ...expenseDateFilter, ...approvedDecisionFilter }, _sum: { amount: true }, _count: true }),
      this.prisma.client.employeeExpenseClaim.aggregate({ where: reimbursedWhere, _sum: { amount: true }, _count: true }),
    ]);

    const ledgerAccount = await this.prisma.client.ledgerAccount.findFirst({ where: { organizationId: input.organizationId, code: EMPLOYEE_ADVANCE_RECEIVABLE_CODE } });
    let advanceOutstandingAmount = new Prisma.Decimal(0);
    let advanceOutstandingEmployeeCount = 0;
    if (ledgerAccount) {
      const lines = await this.prisma.client.journalLine.findMany({
        where: {
          organizationId: input.organizationId,
          ledgerAccountId: ledgerAccount.id,
          employeeId: input.filters.employeeId ?? { not: null },
          ...(input.filters.projectId ? { projectId: input.filters.projectId } : {}),
        },
        select: { employeeId: true, debitAmount: true, creditAmount: true },
      });
      const balanceByEmployee = new Map<string, Prisma.Decimal>();
      for (const line of lines) {
        const key = line.employeeId!;
        const running = balanceByEmployee.get(key) ?? new Prisma.Decimal(0);
        balanceByEmployee.set(key, running.plus(line.debitAmount).minus(line.creditAmount));
      }
      for (const balance of balanceByEmployee.values()) {
        if (balance.greaterThan(0)) {
          advanceOutstandingAmount = advanceOutstandingAmount.plus(balance);
          advanceOutstandingEmployeeCount += 1;
        }
      }
    }

    return {
      pendingApproval: { amount: (pendingAgg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), count: pendingAgg._count },
      approvedToPay: { amount: (approvedAgg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), count: approvedAgg._count },
      reimbursed: { amount: (reimbursedAgg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), count: reimbursedAgg._count, isCurrentFinancialYear },
      advanceOutstanding: { amount: advanceOutstandingAmount.toFixed(2), employeeCount: advanceOutstandingEmployeeCount },
    };
  }

  async getClaimDetail(input: { organizationId: string; id: string; actorId: string; hasReadPermission: boolean }): Promise<EmployeeExpenseClaimDetail> {
    const row = await this.prisma.client.employeeExpenseClaim.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: claimDetailInclude });
    if (!row) throwAppError('NOT_FOUND', 'Expense claim not found.');

    if (!input.hasReadPermission) {
      const ownEmployee = await this.resolveOwnEmployee(input.organizationId, input.actorId);
      if (!ownEmployee || row.employeeId !== ownEmployee.id) throwAppError('NOT_FOUND', 'Expense claim not found.');
    }

    return toClaimDetail(row, await this.claimNames(input.organizationId, [row]));
  }

  // ------------------------------------------------- approvers (ADR-171)

  /**
   * Active users holding employee_claim.approve (a role grant or a user
   * grant, less a user revoke), with the legal entity of their own employee
   * record, if any, and whether they see every legal entity (ADR-172).
   */
  private async claimApproverPool(organizationId: string): Promise<Array<ClaimApproverUser & { legalEntityId: string | null; seesAll: boolean }>> {
    const key = 'employee_claim.approve';
    const users = await this.prisma.client.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        OR: [
          { userRoles: { some: { role: { rolePermissions: { some: { permission: { key } } } } } } },
          { userPermissionOverrides: { some: { permission: { key }, effect: 'GRANT', scopeType: null } } },
        ],
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        employees: { where: { deletedAt: null }, select: { legalEntityId: true }, take: 1 },
        userRoles: { select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } } },
        userPermissionOverrides: { select: { effect: true, scopeType: true, permission: { select: { key: true } } } },
      },
      orderBy: { displayName: 'asc' },
    });
    const holds = (u: (typeof users)[number], permission: string) => {
      const overrides = u.userPermissionOverrides.filter((o) => o.scopeType === null && o.permission.key === permission);
      const granted = u.userRoles.some((ur) => ur.role.rolePermissions.some((rp) => rp.permission.key === permission)) || overrides.some((o) => o.effect === 'GRANT');
      return granted && !overrides.some((o) => o.effect === 'REVOKE');
    };
    return users
      .filter((u) => holds(u, key))
      .map((u) => ({ userId: u.id, name: u.displayName, email: u.email, legalEntityId: u.employees[0]?.legalEntityId ?? null, seesAll: holds(u, 'legal_entity.access_all') }));
  }

  /**
   * Who approves a legal entity's claims, worked out, never set by hand, on
   * the same rule as who sees its data (ADR-172): an approver whose own
   * employee record is in that legal entity, or one who sees every legal
   * entity (Admin). Nobody from another legal entity; when none is left the
   * claim waits until someone is given the permission (ADR-182).
   */
  private approversFor(pool: Array<ClaimApproverUser & { legalEntityId: string | null; seesAll: boolean }>, legalEntityId: string): { rule: 'LISTED'; users: ClaimApproverUser[] } {
    const own = pool.filter((u) => u.seesAll || u.legalEntityId === legalEntityId);
    return { rule: 'LISTED', users: own.map(({ userId, name, email }) => ({ userId, name, email })) };
  }

  private async claimNames(organizationId: string, rows: Array<{ legalEntityId: string; reimbursedBy: string | null; decisions: Array<{ actorId: string }> }>): Promise<ClaimNames> {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.reimbursedBy) ids.add(row.reimbursedBy);
      for (const d of row.decisions) ids.add(d.actorId);
    }
    const [users, pool] = await Promise.all([
      ids.size ? this.prisma.client.user.findMany({ where: { organizationId, id: { in: [...ids] } }, select: { id: true, displayName: true } }) : Promise.resolve([]),
      this.claimApproverPool(organizationId),
    ]);
    const approversByEntity = new Map<string, ClaimApproverUser[]>();
    for (const legalEntityId of new Set(rows.map((r) => r.legalEntityId))) approversByEntity.set(legalEntityId, this.approversFor(pool, legalEntityId).users);
    return { approversByEntity, users: new Map(users.map((u) => [u.id, u.displayName])) };
  }

  /** Only the legal entity's approvers approve or reject its claims. */
  private async assertMayDecide(organizationId: string, legalEntityId: string, actorId: string): Promise<void> {
    const pool = await this.claimApproverPool(organizationId);
    const found = this.approversFor(pool, legalEntityId);
    if (!found.users.some((u) => u.userId === actorId)) {
      const entity = await this.prisma.client.legalEntity.findFirst({ where: { id: legalEntityId, organizationId }, select: { legalName: true } });
      const name = entity?.legalName ?? 'this legal entity';
      throwAppError(
        'FORBIDDEN',
        found.users.length
          ? `Only ${found.users.map((u) => u.name).join(', ')} approve expense claims for ${name}.`
          : `Only an approver of ${name} (or an Admin) approves its expense claims.`,
      );
    }
  }

  async listClaimApprovers(input: { organizationId: string }): Promise<{ entities: LegalEntityClaimApprovers[] }> {
    const [entities, pool] = await Promise.all([
      this.prisma.client.legalEntity.findMany({ where: { organizationId: input.organizationId, deletedAt: null }, select: { id: true, legalName: true }, orderBy: { legalName: 'asc' } }),
      this.claimApproverPool(input.organizationId),
    ]);
    return {
      entities: entities.map((e) => {
        const found = this.approversFor(pool, e.id);
        return { legalEntityId: e.id, legalEntityName: e.legalName, rule: found.rule, approvers: found.users };
      }),
    };
  }
}
