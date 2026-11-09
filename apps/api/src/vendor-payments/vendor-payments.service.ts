import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  VendorPaymentPort,
  VendorPaymentAllocationInput,
  VendorPaymentSummary,
  VendorPaymentDetail,
  VendorPaymentAllocationSummary,
  VendorPaymentDeductionSummary,
  VendorPaymentFilters,
  EligiblePaymentRequestLines,
  EligiblePaymentRequestLine,
  VendorPaymentPreview,
  VendorPaymentDeductionType,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { ProjectsService } from '../projects/projects.service';

const POST_COMMAND_TYPE = 'vendor_payment.post';
const REVERSE_COMMAND_TYPE = 'vendor_payment.reverse';

const DEDUCTION_LEDGER_CODES: Record<VendorPaymentDeductionType, string> = {
  TDS: 'TDS_PAYABLE',
  CGST_TDS: 'GST_TDS_PAYABLE_CGST',
  SGST_TDS: 'GST_TDS_PAYABLE_SGST',
  IGST_TDS: 'GST_TDS_PAYABLE_IGST',
};
const ACCOUNTS_PAYABLE_VENDOR_CODE = 'ACCOUNTS_PAYABLE_VENDOR';
const APPROVED_REQUEST_STATUS = 'APPROVED';

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

function formatCardAccountLabel(card: { displayName: string; maskedLastFour: string; cardNumber?: string | null }): string {
  const number = card.cardNumber ? card.cardNumber.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ') : `•••• ${card.maskedLastFour}`;
  return `${number} · ${card.displayName.trim()}`;
}

interface ResolvedDeduction {
  type: VendorPaymentDeductionType;
  amount: Prisma.Decimal;
  ratePercent: Prisma.Decimal | null;
  narrative: string | null;
  targetLedgerAccountId: string;
  targetLedgerAccountCode: string;
  targetLedgerAccountName: string;
}

interface ResolvedAllocation {
  paymentRequestLineId: string;
  paymentRequestId: string;
  vendorBillId: string;
  vendorBillNumber: string;
  vendorBillTaxableSnapshot: Prisma.Decimal;
  requestedAmountSnapshot: Prisma.Decimal;
  cashPaid: Prisma.Decimal;
  deductions: ResolvedDeduction[];
  deductionsTotal: Prisma.Decimal;
  settledAmount: Prisma.Decimal;
  availableBefore: Prisma.Decimal;
}

interface VendorPaymentPlan {
  /** The ledger the money leaves from: the bank's, or a credit card's payable (ADR-179). */
  sourceLedgerAccountId: string;
  legalEntityId: string;
  vendorId: string;
  vendorName: string;
  apLedgerAccountId: string;
  allocations: ResolvedAllocation[];
  creditLines: Array<{ ledgerAccountId: string; code: string; name: string; amount: Prisma.Decimal }>;
  debitTotal: Prisma.Decimal;
}

const summaryInclude = {
  legalEntity: true,
  bankAccount: true,
  cardAccount: true,
  paymentMode: true,
  allocations: {
    include: {
      paymentRequestLine: {
        include: {
          paymentRequest: { include: { vendor: true } },
          vendorBill: { include: { project: true } },
        },
      },
    },
  },
} satisfies Prisma.VendorPaymentInclude;

const detailInclude = {
  ...summaryInclude,
  allocations: {
    include: {
      paymentRequestLine: {
        include: {
          paymentRequest: { include: { vendor: true } },
          vendorBill: { include: { project: true } },
        },
      },
      deductions: true,
    },
  },
} satisfies Prisma.VendorPaymentInclude;

type SummaryRow = Prisma.VendorPaymentGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.VendorPaymentGetPayload<{ include: typeof detailInclude }>;

function toSummary(row: SummaryRow): VendorPaymentSummary {
  const projectIds = [...new Set(row.allocations.flatMap((a) => (a.paymentRequestLine.vendorBill.project ? [a.paymentRequestLine.vendorBill.project.id] : [])))];
  const projectNames = [...new Set(row.allocations.flatMap((a) => (a.paymentRequestLine.vendorBill.project ? [a.paymentRequestLine.vendorBill.project.name] : [])))];
  const vendorBillNumbers = row.allocations.map((a) => a.paymentRequestLine.vendorBill.vendorBillNumber);
  const vendorName = row.allocations[0]?.paymentRequestLine.paymentRequest.vendor.name ?? '';
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount?.accountName ?? null,
    cardAccountId: row.cardAccountId,
    cardAccountLabel: row.cardAccount ? formatCardAccountLabel(row.cardAccount) : null,
    paymentModeId: row.paymentModeId,
    paymentModeLabel: row.paymentMode.label,
    paymentDate: toDateStr(row.paymentDate),
    utrReference: row.utrReference,
    actualAmount: row.actualAmount.toFixed(2),
    status: row.status,
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    reversedBy: row.reversedBy,
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
    vendorName,
    projectIds,
    projectNames,
    vendorBillNumbers,
    version: row.version,
  };
}

function toDeductionSummary(d: DetailRow['allocations'][number]['deductions'][number]): VendorPaymentDeductionSummary {
  return {
    id: d.id,
    type: d.type,
    amount: d.amount.toFixed(2),
    ratePercent: d.ratePercent ? d.ratePercent.toFixed(2) : null,
    narrative: d.narrative,
  };
}

function toAllocationSummary(a: DetailRow['allocations'][number]): VendorPaymentAllocationSummary {
  return {
    id: a.id,
    paymentRequestLineId: a.paymentRequestLineId,
    paymentRequestId: a.paymentRequestLine.paymentRequestId,
    requestNumber: a.paymentRequestLine.paymentRequest.requestNumber,
    vendorBillId: a.paymentRequestLine.vendorBillId,
    vendorBillNumber: a.paymentRequestLine.vendorBill.vendorBillNumber,
    vendorBillTaxableAmountSnapshot: a.vendorBillTaxableAmountSnapshot.toFixed(2),
    requestedAmountSnapshot: a.requestedAmountSnapshot.toFixed(2),
    cashPaid: a.cashPaid.toFixed(2),
    settledAmount: a.settledAmount.toFixed(2),
    deductions: a.deductions.map(toDeductionSummary),
  };
}

function toDetail(row: DetailRow): VendorPaymentDetail {
  return { ...toSummary(row), allocations: row.allocations.map(toAllocationSummary) };
}

@Injectable()
export class VendorPaymentsService implements VendorPaymentPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly projects: ProjectsService,
  ) {}

  private async buildProjectScopeWhereForBills(organizationId: string, actorId: string): Promise<Prisma.VendorBillWhereInput> {
    const assignedProjects = await this.projects.list({ organizationId, actorId, canSeeAll: false });
    const assignedProjectIds = assignedProjects.map((p) => p.id);
    return { projectId: { in: assignedProjectIds.length > 0 ? assignedProjectIds : ['__none__'] } };
  }

  /** "No inaccessible line exists" — a scoped actor may see/act on a
   * vendor payment only if EVERY allocated payment request line's vendor
   * bill project is one of their assigned projects, mirroring
   * PaymentRequestsService.assertBillsProjectAccessible. Throws NOT_FOUND,
   * never FORBIDDEN. */
  private async assertLinesProjectAccessible(
    organizationId: string,
    paymentRequestLineIds: string[],
    actorId: string,
    canSeeAll: boolean,
  ): Promise<void> {
    if (canSeeAll || paymentRequestLineIds.length === 0) return;
    const assignedProjects = await this.projects.list({ organizationId, actorId, canSeeAll: false });
    const assignedProjectIds = new Set(assignedProjects.map((p) => p.id));
    const lines = await this.prisma.client.paymentRequestLine.findMany({
      where: { id: { in: paymentRequestLineIds }, organizationId },
      include: { vendorBill: { select: { projectId: true, createdBy: true } } },
    });
    // A company-overhead bill (ADR-177) is open to whoever entered it.
    if (lines.length !== new Set(paymentRequestLineIds).size || lines.some((l) => (l.vendorBill.projectId ? !assignedProjectIds.has(l.vendorBill.projectId) : l.vendorBill.createdBy !== actorId))) {
      throwAppError('NOT_FOUND', 'One or more referenced payment request lines are not accessible.');
    }
  }

  /** The single shared "available to pay" calculation — reused by
   * getEligiblePaymentRequestLines, getPaymentRequestAvailability, and
   * computeVendorPaymentPlan alike. Symmetric to PaymentRequestsService's
   * own getAvailableForRequest: available = line.requestedAmount minus the
   * sum of settledAmount across every VendorPaymentAllocation on that line
   * whose parent VendorPayment is still POSTED. */
  private async getAvailableToPay(organizationId: string, paymentRequestLineIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (paymentRequestLineIds.length === 0) return new Map();
    const uniqueIds = Array.from(new Set(paymentRequestLineIds));
    const [lines, settled] = await Promise.all([
      this.prisma.client.paymentRequestLine.findMany({ where: { id: { in: uniqueIds }, organizationId }, select: { id: true, requestedAmount: true } }),
      this.prisma.client.vendorPaymentAllocation.groupBy({
        by: ['paymentRequestLineId'],
        where: { paymentRequestLineId: { in: uniqueIds }, payment: { organizationId, status: 'POSTED' } },
        _sum: { settledAmount: true },
      }),
    ]);
    const settledMap = new Map(settled.map((s) => [s.paymentRequestLineId, s._sum?.settledAmount ?? new Prisma.Decimal(0)]));
    return new Map(lines.map((l) => [l.id, l.requestedAmount.minus(settledMap.get(l.id) ?? new Prisma.Decimal(0))]));
  }

  /** Where the money leaves from: a bank account, or (ADR-179) a credit card, whose payable takes the debt until the card bill is settled. */
  private async resolvePaymentSource(organizationId: string, source: { bankAccountId?: string | undefined; cardAccountId?: string | undefined }) {
    if (!!source.bankAccountId === !!source.cardAccountId) throwAppError('VALIDATION_FAILED', 'Pay from either a bank account or a credit card.');
    if (source.bankAccountId) {
      const bankAccount = await this.prisma.client.bankAccount.findFirst({ where: { id: source.bankAccountId, organizationId }, include: { ledgerAccount: true } });
      if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
      if (!bankAccount.isActive) throwAppError('VALIDATION_FAILED', 'This bank account is inactive.');
      return { legalEntityId: bankAccount.legalEntityId, ledgerAccount: bankAccount.ledgerAccount };
    }
    const card = await this.prisma.client.cardAccount.findFirst({ where: { id: source.cardAccountId!, organizationId }, include: { ledgerAccount: true } });
    if (!card) throwAppError('NOT_FOUND', 'Card not found.');
    if (!card.isActive) throwAppError('VALIDATION_FAILED', 'This card is inactive.');
    if (card.type !== 'CREDIT_CARD' || !card.ledgerAccount) throwAppError('VALIDATION_FAILED', 'Only a credit card is paid by card here; a debit card pays from its bank account.');
    return { legalEntityId: card.legalEntityId, ledgerAccount: card.ledgerAccount };
  }

  private async computeVendorPaymentPlan(
    organizationId: string,
    source: { bankAccountId?: string | undefined; cardAccountId?: string | undefined },
    actualAmount: Prisma.Decimal,
    allocationInputs: VendorPaymentAllocationInput[],
  ): Promise<VendorPaymentPlan> {
    if (allocationInputs.length === 0) throwAppError('VALIDATION_FAILED', 'At least one payment request line allocation is required.');

    const paidFrom = await this.resolvePaymentSource(organizationId, source);

    const lineIds = allocationInputs.map((a) => a.paymentRequestLineId);
    const lines = await this.prisma.client.paymentRequestLine.findMany({
      where: { id: { in: lineIds }, organizationId },
      include: { paymentRequest: { include: { vendor: true } }, vendorBill: true },
    });
    const lineById = new Map(lines.map((l) => [l.id, l]));

    const availability = await this.getAvailableToPay(organizationId, lineIds);

    const codesNeeded = new Set<string>([ACCOUNTS_PAYABLE_VENDOR_CODE, ...Object.values(DEDUCTION_LEDGER_CODES)]);
    const ledgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId, code: { in: [...codesNeeded] } },
    });
    const ledgerByCode = new Map(ledgerAccounts.map((a) => [a.code, a]));

    let vendorId: string | null = null;
    let vendorName = '';
    const resolvedAllocations: ResolvedAllocation[] = [];
    const creditAccumulator = new Map<string, { code: string; name: string; amount: Prisma.Decimal }>();
    let debitTotal = new Prisma.Decimal(0);
    let cashTotal = new Prisma.Decimal(0);

    for (const allocationInput of allocationInputs) {
      const line = lineById.get(allocationInput.paymentRequestLineId);
      if (!line) throwAppError('NOT_FOUND', `Payment request line ${allocationInput.paymentRequestLineId} not found.`);
      if (line.paymentRequest.status !== APPROVED_REQUEST_STATUS) {
        throwAppError('VALIDATION_FAILED', `Payment request ${line.paymentRequest.requestNumber ?? line.paymentRequestId} is not approved.`);
      }
      if (line.paymentRequest.legalEntityId !== paidFrom.legalEntityId) {
        throwAppError('VALIDATION_FAILED', 'All allocated payment request lines and the paying bank account or card must belong to the same legal entity.');
      }
      if (vendorId === null) {
        vendorId = line.paymentRequest.vendorId;
        vendorName = line.paymentRequest.vendor.name;
      } else if (vendorId !== line.paymentRequest.vendorId) {
        throwAppError('VALIDATION_FAILED', 'All allocated payment request lines must belong to the same vendor.');
      }

      const cashPaid = new Prisma.Decimal(allocationInput.cashPaid);
      if (cashPaid.isNegative()) throwAppError('VALIDATION_FAILED', 'Cash paid must not be negative.');
      cashTotal = cashTotal.plus(cashPaid);

      const resolvedDeductions: ResolvedDeduction[] = [];
      let deductionsTotal = new Prisma.Decimal(0);
      for (const d of allocationInput.deductions) {
        const amount = new Prisma.Decimal(d.amount);
        if (amount.isNegative() || amount.isZero()) throwAppError('VALIDATION_FAILED', 'Each deduction amount must be greater than zero.');
        deductionsTotal = deductionsTotal.plus(amount);

        const code = DEDUCTION_LEDGER_CODES[d.type];
        const targetAccount = ledgerByCode.get(code);
        if (!targetAccount) throwAppError('VALIDATION_FAILED', `Required ledger account (${code}) is not configured.`);

        resolvedDeductions.push({
          type: d.type,
          amount,
          ratePercent: d.ratePercent ? new Prisma.Decimal(d.ratePercent) : null,
          narrative: d.narrative ?? null,
          targetLedgerAccountId: targetAccount.id,
          targetLedgerAccountCode: targetAccount.code,
          targetLedgerAccountName: targetAccount.name,
        });

        const existing = creditAccumulator.get(targetAccount.id);
        if (existing) {
          existing.amount = existing.amount.plus(amount);
        } else {
          creditAccumulator.set(targetAccount.id, { code: targetAccount.code, name: targetAccount.name, amount });
        }
      }

      const settledAmount = cashPaid.plus(deductionsTotal);
      const availableBefore = availability.get(line.id) ?? new Prisma.Decimal(0);
      if (settledAmount.greaterThan(availableBefore)) {
        throwAppError(
          'VALIDATION_FAILED',
          `Allocation for ${line.vendorBill.vendorBillNumber} (${settledAmount.toFixed(2)}) exceeds its available balance (${availableBefore.toFixed(2)}).`,
        );
      }

      debitTotal = debitTotal.plus(settledAmount);
      resolvedAllocations.push({
        paymentRequestLineId: line.id,
        paymentRequestId: line.paymentRequestId,
        vendorBillId: line.vendorBillId,
        vendorBillNumber: line.vendorBill.vendorBillNumber,
        vendorBillTaxableSnapshot: line.vendorBill.taxableAmount ?? new Prisma.Decimal(0),
        requestedAmountSnapshot: line.requestedAmount,
        cashPaid,
        deductions: resolvedDeductions,
        deductionsTotal,
        settledAmount,
        availableBefore,
      });
    }

    if (!cashTotal.equals(actualAmount)) {
      throwAppError(
        'VALIDATION_FAILED',
        `Sum of cash paid across allocations (${cashTotal.toFixed(2)}) must equal the actual amount paid (${actualAmount.toFixed(2)}).`,
      );
    }

    const apAccount = ledgerByCode.get(ACCOUNTS_PAYABLE_VENDOR_CODE);
    if (!apAccount) throwAppError('VALIDATION_FAILED', 'Required ledger account (Accounts Payable — Vendor) is not configured.');

    const creditLines = [
      { ledgerAccountId: paidFrom.ledgerAccount.id, code: paidFrom.ledgerAccount.code, name: paidFrom.ledgerAccount.name, amount: actualAmount },
      ...[...creditAccumulator.entries()].map(([id, v]) => ({ ledgerAccountId: id, code: v.code, name: v.name, amount: v.amount })),
    ];

    return {
      sourceLedgerAccountId: paidFrom.ledgerAccount.id,
      legalEntityId: paidFrom.legalEntityId,
      vendorId: vendorId!,
      vendorName,
      apLedgerAccountId: apAccount.id,
      allocations: resolvedAllocations,
      creditLines,
      debitTotal,
    };
  }

  async getEligiblePaymentRequestLines(input: {
    organizationId: string;
    vendorId: string | undefined;
    legalEntityId: string | undefined;
    seedPaymentRequestId: string | undefined;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<EligiblePaymentRequestLines> {
    let vendorId = input.vendorId;
    let legalEntityId = input.legalEntityId;

    if (input.seedPaymentRequestId) {
      const seedRequest = await this.prisma.client.paymentRequest.findFirst({
        where: { id: input.seedPaymentRequestId, organizationId: input.organizationId },
      });
      if (!seedRequest) throwAppError('NOT_FOUND', 'Payment request not found.');
      if (seedRequest.status !== APPROVED_REQUEST_STATUS) throwAppError('VALIDATION_FAILED', 'Only an approved payment request can seed a vendor payment.');
      vendorId = seedRequest.vendorId;
      legalEntityId = seedRequest.legalEntityId;
    }

    if (!vendorId || !legalEntityId) throwAppError('VALIDATION_FAILED', 'Vendor and Legal Entity are required.');

    const [vendor, legalEntity] = await Promise.all([
      this.prisma.client.party.findFirst({ where: { id: vendorId, organizationId: input.organizationId } }),
      this.prisma.client.legalEntity.findFirst({ where: { id: legalEntityId, organizationId: input.organizationId } }),
    ]);
    if (!vendor) throwAppError('NOT_FOUND', 'Vendor not found.');
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');

    const scopeWhere = input.canSeeAll ? {} : await this.buildProjectScopeWhereForBills(input.organizationId, input.actorId);

    const lines = await this.prisma.client.paymentRequestLine.findMany({
      where: {
        organizationId: input.organizationId,
        paymentRequest: { organizationId: input.organizationId, vendorId, legalEntityId, status: APPROVED_REQUEST_STATUS },
        vendorBill: { ...scopeWhere },
      },
      include: { paymentRequest: true, vendorBill: { include: { project: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const availability = await this.getAvailableToPay(input.organizationId, lines.map((l) => l.id));

    const eligible: EligiblePaymentRequestLine[] = lines
      .map((line) => {
        const available = availability.get(line.id) ?? new Prisma.Decimal(0);
        return {
          id: line.id,
          paymentRequestId: line.paymentRequestId,
          requestNumber: line.paymentRequest.requestNumber,
          vendorBillId: line.vendorBillId,
          vendorBillNumber: line.vendorBill.vendorBillNumber,
          projectId: line.vendorBill.projectId,
          projectName: line.vendorBill.project?.name ?? null,
          vendorBillTaxableAmount: (line.vendorBill.taxableAmount ?? new Prisma.Decimal(0)).toFixed(2),
          requestedAmount: line.requestedAmount.toFixed(2),
          availableToPay: available.toFixed(2),
        };
      })
      .filter((l) => Number(l.availableToPay) > 0);

    const bankAccounts = await this.prisma.client.bankAccount.findMany({
      where: { organizationId: input.organizationId, legalEntityId, isActive: true },
    });

    return {
      vendorId,
      vendorName: vendor.name,
      legalEntityId,
      legalEntityName: legalEntity.legalName,
      bankAccountOptions: bankAccounts.map((b) => ({ id: b.id, accountName: b.accountName, bankName: b.bankName })),
      lines: eligible,
    };
  }

  async getPaymentRequestAvailability(input: { organizationId: string; paymentRequestId: string }): Promise<{ available: string }> {
    const request = await this.prisma.client.paymentRequest.findFirst({
      where: { id: input.paymentRequestId, organizationId: input.organizationId },
      include: { lines: true },
    });
    if (!request) throwAppError('NOT_FOUND', 'Payment request not found.');
    if (request.status !== APPROVED_REQUEST_STATUS) return { available: '0.00' };

    const availability = await this.getAvailableToPay(input.organizationId, request.lines.map((l) => l.id));
    const total = request.lines.reduce((sum, l) => sum.plus(availability.get(l.id) ?? new Prisma.Decimal(0)), new Prisma.Decimal(0));
    return { available: total.toFixed(2) };
  }

  async calculatePreview(input: { organizationId: string; bankAccountId: string; allocations: VendorPaymentAllocationInput[] }): Promise<VendorPaymentPreview> {
    const actualAmount = input.allocations.reduce((sum, a) => sum.plus(new Prisma.Decimal(a.cashPaid)), new Prisma.Decimal(0));
    const plan = await this.computeVendorPaymentPlan(input.organizationId, { bankAccountId: input.bankAccountId }, actualAmount, input.allocations);
    const creditTotal = plan.creditLines.reduce((sum, l) => sum.plus(l.amount), new Prisma.Decimal(0));
    return {
      allocations: plan.allocations.map((a) => ({
        paymentRequestLineId: a.paymentRequestLineId,
        cashPaid: a.cashPaid.toFixed(2),
        deductionsTotal: a.deductionsTotal.toFixed(2),
        settledAmount: a.settledAmount.toFixed(2),
        availableBefore: a.availableBefore.toFixed(2),
        availableAfter: a.availableBefore.minus(a.settledAmount).toFixed(2),
      })),
      creditLines: plan.creditLines.map((l) => ({ ledgerAccountCode: l.code, ledgerAccountName: l.name, amount: l.amount.toFixed(2) })),
      debitTotal: plan.debitTotal.toFixed(2),
      balanced: creditTotal.equals(plan.debitTotal),
    };
  }

  async postVendorPayment(input: {
    organizationId: string;
    /** Exactly one of the two (ADR-179). */
    bankAccountId: string | undefined;
    cardAccountId?: string | undefined;
    paymentModeId: string;
    paymentDate: string;
    utrReference: string | undefined;
    actualAmount: string;
    allocations: VendorPaymentAllocationInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<VendorPaymentDetail> {
    const requestHash = hashRequest({
      bankAccountId: input.bankAccountId,
      cardAccountId: input.cardAccountId,
      paymentModeId: input.paymentModeId,
      paymentDate: input.paymentDate,
      utrReference: input.utrReference,
      actualAmount: input.actualAmount,
      allocations: input.allocations,
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: POST_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as VendorPaymentDetail;
    }

    const actualAmount = new Prisma.Decimal(input.actualAmount);
    const plan = await this.computeVendorPaymentPlan(input.organizationId, { bankAccountId: input.bankAccountId, cardAccountId: input.cardAccountId }, actualAmount, input.allocations);

    const paymentId = generateId();
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: plan.legalEntityId,
      accountingDate: input.paymentDate,
      sourceType: 'vendor_payment_post',
      sourceId: paymentId,
      postingEvent: 'vendor_payment.posted',
      description: `Vendor payment to ${plan.vendorName} against ${plan.allocations.map((a) => a.vendorBillNumber).join(', ')}`,
      lines: [
        {
          ledgerAccountId: plan.apLedgerAccountId,
          debit: plan.debitTotal.toFixed(2),
          credit: '0',
          projectId: undefined,
          partyId: plan.vendorId,
          employeeId: undefined,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
        ...plan.creditLines.map((l) => ({
          ledgerAccountId: l.ledgerAccountId,
          debit: '0',
          credit: l.amount.toFixed(2),
          projectId: undefined,
          partyId: l.ledgerAccountId === plan.sourceLedgerAccountId ? plan.vendorId : undefined,
          employeeId: undefined,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        })),
      ],
      idempotencyKey: `${POST_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    const created = await this.prisma.client.$transaction(async (tx) => {
      await tx.vendorPayment.create({
        data: {
          id: paymentId,
          organizationId: input.organizationId,
          legalEntityId: plan.legalEntityId,
          bankAccountId: input.bankAccountId ?? null,
          cardAccountId: input.cardAccountId ?? null,
          paymentModeId: input.paymentModeId,
          paymentDate: toDate(input.paymentDate),
          utrReference: input.utrReference ?? null,
          actualAmount,
          status: 'POSTED',
          journalEntryId: journal.id,
          createdBy: input.actorId,
        },
      });

      for (const allocation of plan.allocations) {
        const allocationId = generateId();
        await tx.vendorPaymentAllocation.create({
          data: {
            id: allocationId,
            organizationId: input.organizationId,
            paymentId,
            paymentRequestLineId: allocation.paymentRequestLineId,
            vendorBillTaxableAmountSnapshot: allocation.vendorBillTaxableSnapshot,
            requestedAmountSnapshot: allocation.requestedAmountSnapshot,
            cashPaid: allocation.cashPaid,
            settledAmount: allocation.settledAmount,
          },
        });
        if (allocation.deductions.length > 0) {
          await tx.vendorPaymentDeduction.createMany({
            data: allocation.deductions.map((d) => ({
              id: generateId(),
              organizationId: input.organizationId,
              allocationId,
              type: d.type,
              amount: d.amount,
              ratePercent: d.ratePercent,
              narrative: d.narrative,
            })),
          });
        }
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR_PAYMENT',
        entityId: paymentId,
        action: 'VENDOR_PAYMENT_POSTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { actualAmount: actualAmount.toFixed(2), journalEntryId: journal.id, lineCount: plan.allocations.length },
      });

      const row = await tx.vendorPayment.findFirstOrThrow({ where: { id: paymentId }, include: detailInclude });
      const detail = toDetail(row);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: POST_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'VENDOR_PAYMENT',
          sourceRecordId: paymentId,
          resultReference: detail as unknown as Prisma.InputJsonValue,
        },
      });

      return detail;
    });

    return created;
  }

  async reverseVendorPayment(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<VendorPaymentDetail> {
    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: REVERSE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as VendorPaymentDetail;
    }

    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a vendor payment.');

    const payment = await this.prisma.client.vendorPayment.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!payment) throwAppError('NOT_FOUND', 'Vendor payment not found.');
    if (payment.status === 'REVERSED') throwAppError('INVALID_STATE_TRANSITION', 'This vendor payment has already been reversed.');
    if (!payment.journalEntryId) throwAppError('VALIDATION_FAILED', 'This vendor payment has no journal entry to reverse.');

    const reversal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: payment.journalEntryId,
      accountingDate: input.accountingDate,
      reason,
      idempotencyKey: `${REVERSE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.vendorPayment.updateMany({
        where: { id: payment.id, version: input.expectedVersion, status: 'POSTED' },
        data: { status: 'REVERSED', reversalJournalEntryId: reversal.id, reversalReason: reason, reversedBy: input.actorId, reversedAt: new Date(), version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This vendor payment was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR_PAYMENT',
        entityId: payment.id,
        action: 'VENDOR_PAYMENT_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { reversalReason: reason, reversalJournalEntryId: reversal.id },
      });

      const row = await tx.vendorPayment.findFirstOrThrow({ where: { id: payment.id }, include: detailInclude });
      const detail = toDetail(row);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVERSE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'VENDOR_PAYMENT',
          sourceRecordId: payment.id,
          resultReference: detail as unknown as Prisma.InputJsonValue,
        },
      });

      return detail;
    });
  }

  async list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: VendorPaymentFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: VendorPaymentSummary[]; total: number }> {
    const where: Prisma.VendorPaymentWhereInput = { organizationId: input.organizationId };
    if (input.filters.legalEntityId) where.legalEntityId = input.filters.legalEntityId;
    if (input.filters.status) where.status = input.filters.status;

    const andConditions: Prisma.VendorPaymentWhereInput[] = [];
    if (input.filters.paymentRequestId) {
      andConditions.push({ allocations: { some: { paymentRequestLine: { paymentRequestId: input.filters.paymentRequestId } } } });
    }
    if (input.filters.projectId) {
      andConditions.push({ allocations: { some: { paymentRequestLine: { vendorBill: { projectId: input.filters.projectId } } } } });
    }

    if (!input.canSeeAll) {
      const assignedProjects = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      const assignedProjectIds = assignedProjects.map((p) => p.id);
      // "No inaccessible line exists" — a payment is visible only when
      // there is NOT an allocation whose line's bill project falls outside
      // the actor's assigned set. Never "at least one accessible line".
      andConditions.push({
        NOT: {
          allocations: {
            some: { paymentRequestLine: { vendorBill: { projectId: { notIn: assignedProjectIds.length > 0 ? assignedProjectIds : ['__none__'] } } } },
          },
        },
      });
    }

    if (andConditions.length > 0) where.AND = andConditions;

    const [rows, total] = await Promise.all([
      this.prisma.client.vendorPayment.findMany({
        where,
        include: summaryInclude,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.vendorPayment.count({ where }),
    ]);

    return { rows: rows.map(toSummary), total };
  }

  async getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<VendorPaymentDetail> {
    const row = await this.prisma.client.vendorPayment.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: detailInclude });
    if (!row) throwAppError('NOT_FOUND', 'Vendor payment not found.');

    await this.assertLinesProjectAccessible(input.organizationId, row.allocations.map((a) => a.paymentRequestLineId), input.actorId, input.canSeeAll);

    return toDetail(row);
  }
}
