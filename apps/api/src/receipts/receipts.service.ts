import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  ReceiptPort,
  AllocationInput,
  ClientReceiptSummary,
  ClientReceiptDetail,
  AllocationSummary,
  DeductionSummary,
  ReceiptFilters,
  AllocationCandidates,
  ReceiptPreview,
  OutstandingDeduction,
  AllocationDeductionType,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { ProjectsService } from '../projects/projects.service';

const POST_COMMAND_TYPE = 'receipt.post';
const REVERSE_COMMAND_TYPE = 'receipt.reverse';
const RELEASE_COMMAND_TYPE = 'deduction.release';

const DEDUCTION_LEDGER_CODES: Record<
  Exclude<AllocationDeductionType, 'ACCEPTED_PENALTY' | 'DISPUTED_PENALTY' | 'OTHER'>,
  string
> = {
  TDS: 'TDS_RECEIVABLE',
  CGST_TDS: 'GST_TDS_RECEIVABLE_CGST',
  SGST_TDS: 'GST_TDS_RECEIVABLE_SGST',
  IGST_TDS: 'GST_TDS_RECEIVABLE_IGST',
  HOLD: 'HOLD_RECEIVABLE',
  RETENTION: 'RETENTION_RECEIVABLE',
};
const DEFAULT_ACCEPTED_PENALTY_CODE = 'PENALTY_REVENUE_DEDUCTION';
const DEFAULT_DISPUTED_PENALTY_CODE = 'DISPUTED_DEDUCTION_RECEIVABLE';
const ACCOUNTS_RECEIVABLE_CODE = 'ACCOUNTS_RECEIVABLE';

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

interface ResolvedDeduction {
  type: AllocationDeductionType;
  amount: Prisma.Decimal;
  ratePercent: Prisma.Decimal | null;
  penaltyCategoryId: string | null;
  otherLedgerAccountId: string | null;
  narrative: string | null;
  targetLedgerAccountId: string;
  targetLedgerAccountCode: string;
  targetLedgerAccountName: string;
}

interface ResolvedAllocation {
  invoiceId: string;
  invoiceNumber: string | null;
  sourceEventId: string | null;
  taxableSnapshot: Prisma.Decimal;
  cgstSnapshot: Prisma.Decimal;
  sgstSnapshot: Prisma.Decimal;
  igstSnapshot: Prisma.Decimal;
  totalSnapshot: Prisma.Decimal;
  cashAllocated: Prisma.Decimal;
  deductions: ResolvedDeduction[];
  deductionsTotal: Prisma.Decimal;
  settledAmount: Prisma.Decimal;
  outstandingBefore: Prisma.Decimal;
}

interface ReceiptPlan {
  bankAccountId: string;
  bankAccountLedgerAccountId: string;
  bankAccountLedgerAccountCode: string;
  legalEntityId: string;
  clientId: string;
  clientName: string;
  allocations: ResolvedAllocation[];
  /** Bank line first, then one line per deduction account per project (ADR-109). */
  debitLines: Array<{ ledgerAccountId: string; code: string; name: string; amount: Prisma.Decimal; projectId: string | undefined }>;
  creditTotal: Prisma.Decimal;
}

const summaryInclude = {
  legalEntity: true,
  bankAccount: true,
  paymentMode: true,
  allocations: {
    include: { invoice: { include: { project: { include: { client: true } } } } },
  },
} satisfies Prisma.ClientReceiptInclude;

const detailInclude = {
  ...summaryInclude,
  allocations: {
    include: {
      invoice: { include: { project: { include: { client: true } } } },
      sourceEvent: { select: { name: true } },
      deductions: { include: { penaltyCategory: true, otherLedgerAccount: true, releases: true } },
    },
  },
} satisfies Prisma.ClientReceiptInclude;

type SummaryRow = Prisma.ClientReceiptGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.ClientReceiptGetPayload<{ include: typeof detailInclude }>;

function toSummary(row: SummaryRow): ClientReceiptSummary {
  const projectIds = [...new Set(row.allocations.map((a) => a.invoice.project.id))];
  const projectNames = [...new Set(row.allocations.map((a) => a.invoice.project.name))];
  const invoiceNumbers = row.allocations.map((a) => a.invoice.invoiceNumber).filter((n): n is string => !!n);
  const clientName = row.allocations[0]?.invoice.project.client.name ?? '';
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount.accountName,
    paymentModeId: row.paymentModeId,
    paymentModeLabel: row.paymentMode.label,
    receiptDate: toDateStr(row.receiptDate),
    utrReference: row.utrReference,
    actualAmount: row.actualAmount.toFixed(2),
    status: row.status,
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    reversedBy: row.reversedBy,
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
    clientName,
    projectIds,
    projectNames,
    invoiceNumbers,
    version: row.version,
  };
}

/** Shared with the invoice detail's receipt list so both screens read a deduction the same way. */
export function toDeductionSummary(d: DetailRow['allocations'][number]['deductions'][number]): DeductionSummary {
  const released = d.releases.reduce((sum, r) => sum.plus(r.releasedAmount), new Prisma.Decimal(0));
  return {
    id: d.id,
    type: d.type,
    amount: d.amount.toFixed(2),
    ratePercent: d.ratePercent ? d.ratePercent.toFixed(2) : null,
    penaltyCategoryId: d.penaltyCategoryId,
    penaltyCategoryName: d.penaltyCategory?.name ?? null,
    otherLedgerAccountId: d.otherLedgerAccountId,
    otherLedgerAccountName: d.otherLedgerAccount?.name ?? null,
    narrative: d.narrative,
    releasedAmount: released.toFixed(2),
    outstandingAmount: d.amount.minus(released).toFixed(2),
  };
}

function toAllocationSummary(a: DetailRow['allocations'][number]): AllocationSummary {
  return {
    id: a.id,
    invoiceId: a.invoiceId,
    invoiceNumber: a.invoice.invoiceNumber,
    invoiceProjectId: a.invoice.projectId,
    sourceEventId: a.sourceEventId,
    sourceEventName: a.sourceEvent?.name ?? null,
    invoiceTaxableAmountSnapshot: a.invoiceTaxableAmountSnapshot.toFixed(2),
    invoiceCgstSnapshot: a.invoiceCgstSnapshot.toFixed(2),
    invoiceSgstSnapshot: a.invoiceSgstSnapshot.toFixed(2),
    invoiceIgstSnapshot: a.invoiceIgstSnapshot.toFixed(2),
    invoiceTotalSnapshot: a.invoiceTotalSnapshot.toFixed(2),
    cashAllocated: a.cashAllocated.toFixed(2),
    settledAmount: a.settledAmount.toFixed(2),
    deductions: a.deductions.map(toDeductionSummary),
  };
}

function toDetail(row: DetailRow): ClientReceiptDetail {
  return { ...toSummary(row), allocations: row.allocations.map(toAllocationSummary) };
}

@Injectable()
export class ReceiptsService implements ReceiptPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly projects: ProjectsService,
  ) { }

  private async computeReceiptPlan(
    organizationId: string,
    bankAccountId: string,
    actualAmount: Prisma.Decimal,
    allocationInputs: AllocationInput[],
  ): Promise<ReceiptPlan> {
    if (allocationInputs.length === 0) throwAppError('VALIDATION_FAILED', 'At least one invoice allocation is required.');

    const bankAccount = await this.prisma.client.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId },
      include: { ledgerAccount: true },
    });
    if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
    if (!bankAccount.isActive) throwAppError('VALIDATION_FAILED', 'This bank account is inactive.');

    const invoiceIds = allocationInputs.map((a) => a.invoiceId);
    const invoices = await this.prisma.client.invoice.findMany({
      where: { id: { in: invoiceIds }, organizationId },
      include: { project: true, lines: { where: { sourceEventId: { not: null } }, include: { sourceEvent: { select: { name: true } } } } },
    });
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));

    const settledByInvoice = await this.prisma.client.receiptAllocation.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: invoiceIds }, receipt: { organizationId, status: { not: 'REVERSED' } } },
      _sum: { settledAmount: true },
    });
    const settledByInvoiceMap = new Map(settledByInvoice.map((s) => [s.invoiceId, s._sum.settledAmount ?? new Prisma.Decimal(0)]));
    const settledByEventMap = await this.settledByEvent(organizationId, invoiceIds);
    // Earlier rows of this same receipt count against the same invoice and
    // event, so two rows cannot each settle the full outstanding amount.
    const settledHereByInvoice = new Map<string, Prisma.Decimal>();
    const settledHereByEvent = new Map<string, Prisma.Decimal>();

    let clientId: string | null = null;
    let clientName = '';
    const codesNeeded = new Set<string>([ACCOUNTS_RECEIVABLE_CODE]);
    for (const type of Object.values(DEDUCTION_LEDGER_CODES)) codesNeeded.add(type);
    codesNeeded.add(DEFAULT_ACCEPTED_PENALTY_CODE);
    codesNeeded.add(DEFAULT_DISPUTED_PENALTY_CODE);

    const ledgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId, code: { in: [...codesNeeded] } },
    });
    const ledgerByCode = new Map(ledgerAccounts.map((a) => [a.code, a]));

    const penaltyCategoryIds = [
      ...new Set(
        allocationInputs.flatMap((a) => a.deductions.map((d) => d.penaltyCategoryId).filter((id): id is string => !!id)),
      ),
    ];
    const penaltyCategories = await this.prisma.client.penaltyCategory.findMany({
      where: { id: { in: penaltyCategoryIds }, organizationId },
      include: { acceptedLedgerAccount: true, disputedLedgerAccount: true },
    });
    const penaltyCategoryById = new Map(penaltyCategories.map((p) => [p.id, p]));

    const otherLedgerAccountIds = [
      ...new Set(
        allocationInputs.flatMap((a) => a.deductions.map((d) => d.otherLedgerAccountId).filter((id): id is string => !!id)),
      ),
    ];
    const otherLedgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { id: { in: otherLedgerAccountIds }, organizationId },
    });
    const otherLedgerAccountById = new Map(otherLedgerAccounts.map((a) => [a.id, a]));

    const resolvedAllocations: ResolvedAllocation[] = [];
    // Keyed by account AND project (ADR-109): a receipt may settle invoices of
    // several projects, and a deduction such as an accepted penalty is that
    // project's revenue deduction — merging it across projects would leave the
    // project P&L unable to attribute it.
    const debitAccumulator = new Map<string, { ledgerAccountId: string; code: string; name: string; amount: Prisma.Decimal; projectId: string }>();
    let creditTotal = new Prisma.Decimal(0);
    let cashTotal = new Prisma.Decimal(0);

    for (const allocationInput of allocationInputs) {
      const invoice = invoiceById.get(allocationInput.invoiceId);
      if (!invoice) throwAppError('NOT_FOUND', `Invoice ${allocationInput.invoiceId} not found.`);
      if (invoice.status !== 'FINALIZED') throwAppError('VALIDATION_FAILED', `Invoice ${invoice.invoiceNumber ?? invoice.id} is not finalized.`);
      if (invoice.legalEntityId !== bankAccount.legalEntityId) {
        throwAppError('VALIDATION_FAILED', 'All allocated invoices and the receiving bank account must belong to the same legal entity.');
      }
      if (clientId === null) {
        clientId = invoice.project.clientId;
        clientName = invoice.project.name;
      } else if (clientId !== invoice.project.clientId) {
        throwAppError('VALIDATION_FAILED', 'All allocated invoices must belong to the same client.');
      }

      const cashAllocated = new Prisma.Decimal(allocationInput.cashAllocated);
      if (cashAllocated.isNegative()) throwAppError('VALIDATION_FAILED', 'Cash allocated must not be negative.');
      cashTotal = cashTotal.plus(cashAllocated);

      const resolvedDeductions: ResolvedDeduction[] = [];
      let deductionsTotal = new Prisma.Decimal(0);
      for (const d of allocationInput.deductions) {
        const amount = new Prisma.Decimal(d.amount);
        if (amount.isNegative() || amount.isZero()) throwAppError('VALIDATION_FAILED', 'Each deduction amount must be greater than zero.');
        deductionsTotal = deductionsTotal.plus(amount);

        let targetAccount: { id: string; code: string; name: string };
        if (d.type === 'ACCEPTED_PENALTY' || d.type === 'DISPUTED_PENALTY') {
          if (!d.penaltyCategoryId) throwAppError('VALIDATION_FAILED', 'A penalty category is required for accepted/disputed penalty deductions.');
          const category = penaltyCategoryById.get(d.penaltyCategoryId);
          if (!category) throwAppError('NOT_FOUND', 'Penalty category not found.');
          const override = d.type === 'ACCEPTED_PENALTY' ? category.acceptedLedgerAccount : category.disputedLedgerAccount;
          if (override) {
            targetAccount = override;
          } else {
            const fallback = ledgerByCode.get(d.type === 'ACCEPTED_PENALTY' ? DEFAULT_ACCEPTED_PENALTY_CODE : DEFAULT_DISPUTED_PENALTY_CODE);
            if (!fallback) throwAppError('VALIDATION_FAILED', 'No default ledger account is configured for this deduction type.');
            targetAccount = fallback;
          }
        } else if (d.type === 'OTHER') {
          if (!d.otherLedgerAccountId) throwAppError('VALIDATION_FAILED', 'A ledger account is required for "Other" deductions.');
          const account = otherLedgerAccountById.get(d.otherLedgerAccountId);
          if (!account) throwAppError('NOT_FOUND', 'Ledger account not found.');
          targetAccount = account;
        } else {
          const code = DEDUCTION_LEDGER_CODES[d.type];
          const account = ledgerByCode.get(code);
          if (!account) throwAppError('VALIDATION_FAILED', `Required ledger account (${code}) is not configured.`);
          targetAccount = account;
        }

        resolvedDeductions.push({
          type: d.type,
          amount,
          ratePercent: d.ratePercent ? new Prisma.Decimal(d.ratePercent) : null,
          penaltyCategoryId: d.penaltyCategoryId ?? null,
          otherLedgerAccountId: d.otherLedgerAccountId ?? null,
          narrative: d.narrative ?? null,
          targetLedgerAccountId: targetAccount.id,
          targetLedgerAccountCode: targetAccount.code,
          targetLedgerAccountName: targetAccount.name,
        });

        const accumulatorKey = `${targetAccount.id}|${invoice.projectId}`;
        const existing = debitAccumulator.get(accumulatorKey);
        if (existing) {
          existing.amount = existing.amount.plus(amount);
        } else {
          debitAccumulator.set(accumulatorKey, { ledgerAccountId: targetAccount.id, code: targetAccount.code, name: targetAccount.name, amount, projectId: invoice.projectId });
        }
      }

      const settledAmount = cashAllocated.plus(deductionsTotal);
      const zero = new Prisma.Decimal(0);
      const alreadySettled = (settledByInvoiceMap.get(invoice.id) ?? zero).plus(settledHereByInvoice.get(invoice.id) ?? zero);
      const invoiceOutstanding = invoice.totalAmount!.minus(alreadySettled);
      if (settledAmount.greaterThan(invoiceOutstanding)) {
        throwAppError(
          'VALIDATION_FAILED',
          `Allocation for invoice ${invoice.invoiceNumber ?? invoice.id} (${settledAmount.toFixed(2)}) exceeds its outstanding amount (${invoiceOutstanding.toFixed(2)}).`,
        );
      }
      settledHereByInvoice.set(invoice.id, (settledHereByInvoice.get(invoice.id) ?? zero).plus(settledAmount));

      let outstandingBefore = invoiceOutstanding;
      const sourceEventId = allocationInput.sourceEventId ?? null;
      if (sourceEventId) {
        const line = invoice.lines.find((l) => l.sourceEventId === sourceEventId);
        if (!line) throwAppError('VALIDATION_FAILED', `That CAPEX event is not billed on invoice ${invoice.invoiceNumber ?? invoice.id}.`);
        const eventSettled = (settledByEventMap.get(sourceEventId) ?? zero).plus(settledHereByEvent.get(sourceEventId) ?? zero);
        outstandingBefore = line.lineTotal.minus(eventSettled);
        if (settledAmount.greaterThan(outstandingBefore)) {
          throwAppError(
            'VALIDATION_FAILED',
            `Allocation for ${line.sourceEvent?.name ?? 'the CAPEX event'} on invoice ${invoice.invoiceNumber ?? invoice.id} (${settledAmount.toFixed(2)}) exceeds that event's outstanding amount (${outstandingBefore.toFixed(2)}).`,
          );
        }
        settledHereByEvent.set(sourceEventId, (settledHereByEvent.get(sourceEventId) ?? zero).plus(settledAmount));
      }

      creditTotal = creditTotal.plus(settledAmount);
      resolvedAllocations.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        sourceEventId,
        taxableSnapshot: invoice.taxableAmount!,
        cgstSnapshot: invoice.cgstAmount!,
        sgstSnapshot: invoice.sgstAmount!,
        igstSnapshot: invoice.igstAmount!,
        totalSnapshot: invoice.totalAmount!,
        cashAllocated,
        deductions: resolvedDeductions,
        deductionsTotal,
        settledAmount,
        outstandingBefore,
      });
    }

    if (!cashTotal.equals(actualAmount)) {
      throwAppError(
        'VALIDATION_FAILED',
        `Sum of cash allocated across invoices (${cashTotal.toFixed(2)}) must equal the actual amount received (${actualAmount.toFixed(2)}).`,
      );
    }

    const arAccount = ledgerByCode.get(ACCOUNTS_RECEIVABLE_CODE);
    if (!arAccount) throwAppError('VALIDATION_FAILED', 'Required ledger account (Accounts Receivable) is not configured.');

    const debitLines = [
      { ledgerAccountId: bankAccount.ledgerAccount.id, code: bankAccount.ledgerAccount.code, name: bankAccount.ledgerAccount.name, amount: actualAmount, projectId: undefined },
      ...[...debitAccumulator.values()],
    ];

    return {
      bankAccountId: bankAccount.id,
      bankAccountLedgerAccountId: bankAccount.ledgerAccount.id,
      bankAccountLedgerAccountCode: bankAccount.ledgerAccount.code,
      legalEntityId: bankAccount.legalEntityId,
      clientId: clientId!,
      clientName,
      allocations: resolvedAllocations,
      debitLines,
      creditTotal,
    };
  }

  async getAllocationCandidates(input: {
    organizationId: string;
    seedInvoiceId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<AllocationCandidates> {
    const seedInvoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.seedInvoiceId, organizationId: input.organizationId },
      include: { project: { include: { client: true } }, legalEntity: true },
    });
    if (!seedInvoice) throwAppError('NOT_FOUND', 'Invoice not found.');
    if (seedInvoice.status !== 'FINALIZED') throwAppError('VALIDATION_FAILED', 'Only a finalized invoice can receive a payment.');
    await this.projects.getDetail({ organizationId: input.organizationId, id: seedInvoice.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll });

    const candidateInvoices = await this.prisma.client.invoice.findMany({
      where: {
        organizationId: input.organizationId,
        status: 'FINALIZED',
        legalEntityId: seedInvoice.legalEntityId,
        project: { clientId: seedInvoice.project.clientId },
      },
      include: { project: true, lines: { where: { sourceEventId: { not: null } }, include: { sourceEvent: { select: { name: true } } }, orderBy: { sequence: 'asc' } } },
    });

    const settledByEventMap = await this.settledByEvent(input.organizationId, candidateInvoices.map((i) => i.id));
    const settled = await this.prisma.client.receiptAllocation.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: candidateInvoices.map((i) => i.id) }, receipt: { organizationId: input.organizationId, status: { not: 'REVERSED' } } },
      _sum: { settledAmount: true },
    });
    const settledMap = new Map(settled.map((s) => [s.invoiceId, s._sum.settledAmount ?? new Prisma.Decimal(0)]));

    const invoices = candidateInvoices
      .map((invoice) => {
        const outstanding = invoice.totalAmount!.minus(settledMap.get(invoice.id) ?? new Prisma.Decimal(0));
        return {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber!,
          projectId: invoice.projectId,
          projectName: invoice.project.name,
          taxableAmount: invoice.taxableAmount!.toFixed(2),
          cgstAmount: invoice.cgstAmount!.toFixed(2),
          sgstAmount: invoice.sgstAmount!.toFixed(2),
          igstAmount: invoice.igstAmount!.toFixed(2),
          totalAmount: invoice.totalAmount!.toFixed(2),
          outstandingAmount: outstanding.toFixed(2),
          capexEvents:
            invoice.lines.length < 2
              ? []
              : invoice.lines.map((line) => ({
                sourceEventId: line.sourceEventId!,
                name: line.sourceEvent?.name ?? line.description,
                taxableAmount: line.taxableAmount.toFixed(2),
                totalAmount: line.lineTotal.toFixed(2),
                outstandingAmount: line.lineTotal.minus(settledByEventMap.get(line.sourceEventId!) ?? new Prisma.Decimal(0)).toFixed(2),
              })),
        };
      })
      .filter((i) => Number(i.outstandingAmount) > 0);

    const bankAccounts = await this.prisma.client.bankAccount.findMany({
      where: { organizationId: input.organizationId, legalEntityId: seedInvoice.legalEntityId, isActive: true },
    });

    return {
      legalEntityId: seedInvoice.legalEntityId,
      legalEntityName: seedInvoice.legalEntity.legalName,
      clientId: seedInvoice.project.clientId,
      clientName: seedInvoice.project.client.name,
      bankAccountOptions: bankAccounts.map((b) => ({ id: b.id, accountName: b.accountName, bankName: b.bankName })),
      invoices,
    };
  }

  async calculatePreview(input: { organizationId: string; bankAccountId: string; allocations: AllocationInput[] }): Promise<ReceiptPreview> {
    const actualAmount = input.allocations.reduce((sum, a) => sum.plus(new Prisma.Decimal(a.cashAllocated)), new Prisma.Decimal(0));
    const plan = await this.computeReceiptPlan(input.organizationId, input.bankAccountId, actualAmount, input.allocations);
    const debitTotal = plan.debitLines.reduce((sum, l) => sum.plus(l.amount), new Prisma.Decimal(0));
    return {
      allocations: plan.allocations.map((a) => ({
        invoiceId: a.invoiceId,
        sourceEventId: a.sourceEventId,
        cashAllocated: a.cashAllocated.toFixed(2),
        deductionsTotal: a.deductionsTotal.toFixed(2),
        settledAmount: a.settledAmount.toFixed(2),
        outstandingBefore: a.outstandingBefore.toFixed(2),
        outstandingAfter: a.outstandingBefore.minus(a.settledAmount).toFixed(2),
      })),
      // The preview stays one line per account, as the receipt screen shows it.
      debitLines: [...plan.debitLines.reduce((byAccount, l) => {
        const existing = byAccount.get(l.ledgerAccountId);
        byAccount.set(l.ledgerAccountId, { ledgerAccountCode: l.code, ledgerAccountName: l.name, amount: (existing ? new Prisma.Decimal(existing.amount) : new Prisma.Decimal(0)).plus(l.amount).toFixed(2) });
        return byAccount;
      }, new Map<string, { ledgerAccountCode: string; ledgerAccountName: string; amount: string }>()).values()],
      creditTotal: plan.creditTotal.toFixed(2),
      balanced: debitTotal.equals(plan.creditTotal),
    };
  }

  async postReceipt(input: {
    organizationId: string;
    bankAccountId: string;
    paymentModeId: string;
    receiptDate: string;
    utrReference: string | undefined;
    actualAmount: string;
    allocations: AllocationInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<ClientReceiptDetail> {
    const requestHash = hashRequest({
      bankAccountId: input.bankAccountId,
      paymentModeId: input.paymentModeId,
      receiptDate: input.receiptDate,
      utrReference: input.utrReference,
      actualAmount: input.actualAmount,
      allocations: input.allocations,
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: POST_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as ClientReceiptDetail;
    }

    const actualAmount = new Prisma.Decimal(input.actualAmount);
    const plan = await this.computeReceiptPlan(input.organizationId, input.bankAccountId, actualAmount, input.allocations);

    const journalLines = plan.debitLines.map((l) => ({
      ledgerAccountId: l.ledgerAccountId,
      debit: l.amount.toFixed(2),
      credit: '0',
      projectId: l.projectId,
      partyId: l.ledgerAccountId === plan.bankAccountLedgerAccountId ? plan.clientId : undefined,
      employeeId: undefined,
      gstRegistrationId: undefined,
      taxCode: undefined,
      narrative: undefined,
    }));

    const arLedgerAccount = await this.resolveArAccount(input.organizationId);
    const receiptId = generateId();
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: plan.legalEntityId,
      accountingDate: input.receiptDate,
      sourceType: 'receipt_post',
      sourceId: receiptId,
      postingEvent: 'receipt.posted',
      description: `Client receipt against ${plan.allocations.map((a) => a.invoiceNumber).join(', ')}`,
      lines: [
        ...journalLines,
        {
          ledgerAccountId: arLedgerAccount.id,
          debit: '0',
          credit: plan.creditTotal.toFixed(2),
          projectId: undefined,
          partyId: plan.clientId,
          employeeId: undefined,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
      ],
      idempotencyKey: `${POST_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    const created = await this.prisma.client.$transaction(async (tx) => {
      await tx.clientReceipt.create({
        data: {
          id: receiptId,
          organizationId: input.organizationId,
          legalEntityId: plan.legalEntityId,
          bankAccountId: input.bankAccountId,
          paymentModeId: input.paymentModeId,
          receiptDate: toDate(input.receiptDate),
          utrReference: input.utrReference ?? null,
          actualAmount,
          status: 'POSTED',
          journalEntryId: journal.id,
          createdBy: input.actorId,
        },
      });

      for (const allocation of plan.allocations) {
        const allocationId = generateId();
        await tx.receiptAllocation.create({
          data: {
            id: allocationId,
            organizationId: input.organizationId,
            receiptId,
            invoiceId: allocation.invoiceId,
            invoiceTaxableAmountSnapshot: allocation.taxableSnapshot,
            invoiceCgstSnapshot: allocation.cgstSnapshot,
            invoiceSgstSnapshot: allocation.sgstSnapshot,
            invoiceIgstSnapshot: allocation.igstSnapshot,
            invoiceTotalSnapshot: allocation.totalSnapshot,
            cashAllocated: allocation.cashAllocated,
            settledAmount: allocation.settledAmount,
            sourceEventId: allocation.sourceEventId,
          },
        });
        if (allocation.deductions.length > 0) {
          await tx.allocationDeduction.createMany({
            data: allocation.deductions.map((d) => ({
              id: generateId(),
              organizationId: input.organizationId,
              allocationId,
              type: d.type,
              amount: d.amount,
              ratePercent: d.ratePercent,
              penaltyCategoryId: d.penaltyCategoryId,
              otherLedgerAccountId: d.otherLedgerAccountId,
              narrative: d.narrative,
            })),
          });
        }
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'RECEIPT',
        entityId: receiptId,
        action: 'RECEIPT_POSTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { actualAmount: actualAmount.toFixed(2), journalEntryId: journal.id, invoiceCount: plan.allocations.length },
      });

      const row = await tx.clientReceipt.findFirstOrThrow({ where: { id: receiptId }, include: detailInclude });
      const detail = toDetail(row);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: POST_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'RECEIPT',
          sourceRecordId: receiptId,
          resultReference: detail as unknown as Prisma.InputJsonValue,
        },
      });

      return detail;
    });

    return created;
  }

  /** Settled amount per CAPEX event across posted (not reversed) receipts. */
  private async settledByEvent(organizationId: string, invoiceIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.client.receiptAllocation.groupBy({
      by: ['sourceEventId'],
      where: { invoiceId: { in: invoiceIds }, sourceEventId: { not: null }, receipt: { organizationId, status: { not: 'REVERSED' } } },
      _sum: { settledAmount: true },
    });
    return new Map(rows.map((row) => [row.sourceEventId!, row._sum.settledAmount ?? new Prisma.Decimal(0)]));
  }

  private async resolveArAccount(organizationId: string) {
    const account = await this.prisma.client.ledgerAccount.findFirst({ where: { organizationId, code: ACCOUNTS_RECEIVABLE_CODE } });
    if (!account) throwAppError('VALIDATION_FAILED', 'Required ledger account (Accounts Receivable) is not configured.');
    return account;
  }

  async reverseReceipt(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<ClientReceiptDetail> {
    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: REVERSE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as ClientReceiptDetail;
    }

    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a receipt.');

    const receipt = await this.prisma.client.clientReceipt.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!receipt) throwAppError('NOT_FOUND', 'Receipt not found.');
    if (receipt.status === 'REVERSED') throwAppError('INVALID_STATE_TRANSITION', 'This receipt has already been reversed.');
    if (!receipt.journalEntryId) throwAppError('VALIDATION_FAILED', 'This receipt has no journal entry to reverse.');

    const reversal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: receipt.journalEntryId,
      accountingDate: input.accountingDate,
      reason,
      idempotencyKey: `${REVERSE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.clientReceipt.updateMany({
        where: { id: receipt.id, version: input.expectedVersion, status: 'POSTED' },
        data: { status: 'REVERSED', reversalJournalEntryId: reversal.id, reversalReason: reason, reversedBy: input.actorId, reversedAt: new Date(), version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This receipt was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'RECEIPT',
        entityId: receipt.id,
        action: 'RECEIPT_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { reversalReason: reason, reversalJournalEntryId: reversal.id },
      });

      const row = await tx.clientReceipt.findFirstOrThrow({ where: { id: receipt.id }, include: detailInclude });
      const detail = toDetail(row);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVERSE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'RECEIPT',
          sourceRecordId: receipt.id,
          resultReference: detail as unknown as Prisma.InputJsonValue,
        },
      });

      return detail;
    });
  }

  async releaseDeduction(input: {
    organizationId: string;
    deductionId: string;
    releasedAmount: string;
    releasedOn: string;
    bankAccountId: string;
    utrReference: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<OutstandingDeduction> {
    const requestHash = hashRequest({
      deductionId: input.deductionId,
      releasedAmount: input.releasedAmount,
      releasedOn: input.releasedOn,
      bankAccountId: input.bankAccountId,
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: RELEASE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as OutstandingDeduction;
    }

    const deduction = await this.prisma.client.allocationDeduction.findFirst({
      where: { id: input.deductionId, organizationId: input.organizationId },
      include: { releases: true, allocation: { include: { invoice: true, receipt: true } } },
    });
    if (!deduction) throwAppError('NOT_FOUND', 'Deduction not found.');
    if (deduction.type !== 'HOLD' && deduction.type !== 'RETENTION') {
      throwAppError('VALIDATION_FAILED', 'Only hold or retention deductions can be released.');
    }
    if (deduction.allocation.receipt.status === 'REVERSED') {
      throwAppError('INVALID_STATE_TRANSITION', 'The receipt this deduction belongs to has been reversed.');
    }

    const releasedAmount = new Prisma.Decimal(input.releasedAmount);
    if (releasedAmount.isNegative() || releasedAmount.isZero()) throwAppError('VALIDATION_FAILED', 'Released amount must be greater than zero.');
    const alreadyReleased = deduction.releases.reduce((sum, r) => sum.plus(r.releasedAmount), new Prisma.Decimal(0));
    const outstanding = deduction.amount.minus(alreadyReleased);
    if (releasedAmount.greaterThan(outstanding)) {
      throwAppError('VALIDATION_FAILED', `Released amount (${releasedAmount.toFixed(2)}) exceeds the outstanding balance (${outstanding.toFixed(2)}).`);
    }

    const bankAccount = await this.prisma.client.bankAccount.findFirst({
      where: { id: input.bankAccountId, organizationId: input.organizationId },
      include: { ledgerAccount: true },
    });
    if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
    if (bankAccount.legalEntityId !== deduction.allocation.receipt.legalEntityId) {
      throwAppError('VALIDATION_FAILED', 'The release bank account must belong to the same legal entity as the original receipt.');
    }

    const targetCode = deduction.type === 'HOLD' ? DEDUCTION_LEDGER_CODES.HOLD : DEDUCTION_LEDGER_CODES.RETENTION;
    const targetAccount = await this.prisma.client.ledgerAccount.findFirst({ where: { organizationId: input.organizationId, code: targetCode } });
    if (!targetAccount) throwAppError('VALIDATION_FAILED', `Required ledger account (${targetCode}) is not configured.`);

    const releaseId = generateId();
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: bankAccount.legalEntityId,
      accountingDate: input.releasedOn,
      sourceType: 'deduction_release',
      sourceId: releaseId,
      postingEvent: 'deduction.released',
      description: `${deduction.type === 'HOLD' ? 'Hold' : 'Retention'} release for invoice ${deduction.allocation.invoice.invoiceNumber ?? deduction.allocation.invoiceId}`,
      lines: [
        { ledgerAccountId: bankAccount.ledgerAccount.id, debit: releasedAmount.toFixed(2), credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        { ledgerAccountId: targetAccount.id, debit: '0', credit: releasedAmount.toFixed(2), projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
      ],
      idempotencyKey: `${RELEASE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      await tx.deductionRelease.create({
        data: {
          id: releaseId,
          organizationId: input.organizationId,
          deductionId: deduction.id,
          releasedAmount,
          releasedOn: toDate(input.releasedOn),
          bankAccountId: input.bankAccountId,
          utrReference: input.utrReference ?? null,
          journalEntryId: journal.id,
          actorId: input.actorId,
          correlationId: input.correlationId,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'RECEIPT',
        entityId: deduction.allocation.receiptId,
        action: 'DEDUCTION_RELEASED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { deductionId: deduction.id, releasedAmount: releasedAmount.toFixed(2), journalEntryId: journal.id },
      });

      const result: OutstandingDeduction = {
        id: deduction.id,
        type: deduction.type,
        amount: deduction.amount.toFixed(2),
        outstandingAmount: outstanding.minus(releasedAmount).toFixed(2),
        invoiceId: deduction.allocation.invoiceId,
        invoiceNumber: deduction.allocation.invoice.invoiceNumber,
        receiptId: deduction.allocation.receiptId,
      };

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: RELEASE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'DEDUCTION_RELEASE',
          sourceRecordId: releaseId,
          resultReference: result as unknown as Prisma.InputJsonValue,
        },
      });

      return result;
    });
  }

  async getOutstandingDeductions(input: {
    organizationId: string;
    projectId: string | undefined;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<OutstandingDeduction[]> {
    let projectIds: string[] | undefined;
    if (!input.canSeeAll) {
      const assigned = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      projectIds = assigned.map((p) => p.id);
    }

    const deductions = await this.prisma.client.allocationDeduction.findMany({
      where: {
        organizationId: input.organizationId,
        type: { in: ['HOLD', 'RETENTION'] },
        allocation: {
          receipt: { status: { not: 'REVERSED' } },
          invoice: {
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(projectIds ? { projectId: { in: projectIds } } : {}),
          },
        },
      },
      include: { releases: true, allocation: { include: { invoice: true } } },
    });

    return deductions
      .map((d) => {
        const released = d.releases.reduce((sum, r) => sum.plus(r.releasedAmount), new Prisma.Decimal(0));
        const outstanding = d.amount.minus(released);
        return {
          id: d.id,
          type: d.type,
          amount: d.amount.toFixed(2),
          outstandingAmount: outstanding.toFixed(2),
          invoiceId: d.allocation.invoiceId,
          invoiceNumber: d.allocation.invoice.invoiceNumber,
          receiptId: d.allocation.receiptId,
        };
      })
      .filter((d) => Number(d.outstandingAmount) > 0);
  }

  async list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: ReceiptFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: ClientReceiptSummary[]; total: number }> {
    const where: Prisma.ClientReceiptWhereInput = { organizationId: input.organizationId };
    if (input.filters.legalEntityId) where.legalEntityId = input.filters.legalEntityId;
    if (input.filters.status) where.status = input.filters.status;

    if (!input.canSeeAll) {
      const assigned = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      const assignedProjectIds = new Set(assigned.map((p) => p.id));
      const scopedProjectId = input.filters.projectId && assignedProjectIds.has(input.filters.projectId) ? input.filters.projectId : undefined;
      if (input.filters.projectId && !scopedProjectId) {
        where.allocations = { some: { invoice: { projectId: '__none__' } } };
      } else {
        where.allocations = { some: { invoice: { projectId: scopedProjectId ? scopedProjectId : { in: [...assignedProjectIds] } } } };
      }
    } else if (input.filters.projectId) {
      where.allocations = { some: { invoice: { projectId: input.filters.projectId } } };
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.clientReceipt.findMany({
        where,
        include: summaryInclude,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.clientReceipt.count({ where }),
    ]);

    return { rows: rows.map(toSummary), total };
  }

  async getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<ClientReceiptDetail> {
    const row = await this.prisma.client.clientReceipt.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: detailInclude });
    if (!row) throwAppError('NOT_FOUND', 'Receipt not found.');

    if (!input.canSeeAll) {
      const assigned = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      const projectIds = new Set(assigned.map((p) => p.id));
      const hasAccess = row.allocations.some((a) => projectIds.has(a.invoice.projectId));
      if (!hasAccess) throwAppError('NOT_FOUND', 'Receipt not found.');
    }

    return toDetail(row);
  }
}
