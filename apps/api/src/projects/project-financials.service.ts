import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ClientFinancialSummary, ProjectFinancialsPort, ProjectFinancialSummary } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';
import { ClientsService } from '../clients/clients.service';
import { recognizedExpenseAmount } from './project-financials.util';
// The one shared allocation-splitting formula (ADR-095) — reused so this
// figure, the Spend ledger's Manpower rows and the Manpower Cost report are
// always the same arithmetic.
import { allocateSalary } from '../employee-allocations/allocation-cost.util';

const ZERO = new Prisma.Decimal(0);

interface FinancialAccumulator {
  contractValueExclGst: Prisma.Decimal | null;
  grossInvoiceValue: Prisma.Decimal;
  debitNoteAdjustments: Prisma.Decimal;
  creditNoteAdjustments: Prisma.Decimal;
  cashReceived: Prisma.Decimal;
  tdsDeducted: Prisma.Decimal;
  gstTdsDeducted: Prisma.Decimal;
  retentionHeld: Prisma.Decimal;
  otherHoldAmount: Prisma.Decimal;
  penaltyOrWriteOff: Prisma.Decimal;
  otherDeductions: Prisma.Decimal;
  unreleasedRetentionAndHold: Prisma.Decimal;
  purchaseExpense: Prisma.Decimal;
  employeeClaimExpense: Prisma.Decimal;
  directExpense: Prisma.Decimal;
  materialExpense: Prisma.Decimal;
  manpowerExpense: Prisma.Decimal;
  introducerExpense: Prisma.Decimal;
  billedTaxable: Prisma.Decimal;
  serverExpense: Prisma.Decimal;
  subscriptionExpense: Prisma.Decimal;
  emdLodged: Prisma.Decimal;
  sdLodged: Prisma.Decimal;
}

function emptyAccumulator(contractValueExclGst: Prisma.Decimal | null): FinancialAccumulator {
  return {
    contractValueExclGst,
    grossInvoiceValue: ZERO,
    debitNoteAdjustments: ZERO,
    creditNoteAdjustments: ZERO,
    cashReceived: ZERO,
    tdsDeducted: ZERO,
    gstTdsDeducted: ZERO,
    retentionHeld: ZERO,
    otherHoldAmount: ZERO,
    penaltyOrWriteOff: ZERO,
    otherDeductions: ZERO,
    unreleasedRetentionAndHold: ZERO,
    purchaseExpense: ZERO,
    employeeClaimExpense: ZERO,
    directExpense: ZERO,
    materialExpense: ZERO,
    manpowerExpense: ZERO,
    introducerExpense: ZERO,
    billedTaxable: ZERO,
    serverExpense: ZERO,
    subscriptionExpense: ZERO,
    emdLodged: ZERO,
    sdLodged: ZERO,
  };
}

const percent = (part: Prisma.Decimal, whole: Prisma.Decimal | null): string | null =>
  whole && whole.greaterThan(0) ? part.dividedBy(whole).times(100).toFixed(1) : null;

/**
 * Bounded, project-scoped financial aggregation (ADR-089/ADR-090). Deliberately
 * its own service, not a method folded into `ProjectsService` and exposed to
 * unrelated modules — depends on `ProjectsService`/`ClientsService` only to
 * reuse their already-tested access authorization (`getDetail`/`list`), one
 * direction only (neither depends back on this service). The client-wide
 * rollup (`getClientFinancialSummary`, ADR-090) sums this service's own
 * per-project output rather than reimplementing any of the underlying
 * queries.
 */
@Injectable()
export class ProjectFinancialsService implements ProjectFinancialsPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly clients: ClientsService,
  ) {}

  /**
   * One bulk pass over every source table, no N+1 regardless of how many
   * `projectIds` are requested. Only pre-populates a row for a `projectId`
   * that's confirmed to actually exist in this organization (via the first
   * query below) — a requested id that doesn't resolve to a real project
   * here produces no row at all, not a synthesized all-zero one, so this
   * can't be used as an existence oracle for ids outside the org.
   */
  private async computeFinancialSummaries(organizationId: string, projectIds: string[]): Promise<Map<string, ProjectFinancialSummary>> {
    if (projectIds.length === 0) return new Map();

    const acc = new Map<string, FinancialAccumulator>();

    const projectRows = await this.prisma.client.project.findMany({
      where: { organizationId, id: { in: projectIds } },
      select: { id: true, value: true, tenderId: true },
    });
    for (const p of projectRows) acc.set(p.id, emptyAccumulator(p.value));
    if (acc.size === 0) return new Map();
    const existingIds = [...acc.keys()];

    // Billing: gross invoices (FINALIZED only — DRAFT/VOID excluded)
    const invoices = await this.prisma.client.invoice.findMany({
      where: { organizationId, projectId: { in: existingIds }, status: 'FINALIZED' },
      select: { id: true, projectId: true, totalAmount: true, taxableAmount: true },
    });
    const invoiceProjectById = new Map(invoices.map((i) => [i.id, i.projectId]));
    for (const inv of invoices) {
      const entry = acc.get(inv.projectId)!;
      entry.grossInvoiceValue = entry.grossInvoiceValue.plus(inv.totalAmount ?? ZERO);
      entry.billedTaxable = entry.billedTaxable.plus(inv.taxableAmount ?? ZERO);
    }

    // Billing: debit/credit notes — CreditDebitNote carries its own
    // projectId directly, no join through invoiceId needed.
    const notes = await this.prisma.client.creditDebitNote.groupBy({
      by: ['projectId', 'type'],
      where: { organizationId, projectId: { in: existingIds }, status: 'FINALIZED' },
      _sum: { totalAmount: true, taxableAmount: true },
    });
    for (const n of notes) {
      const entry = acc.get(n.projectId)!;
      const amount = n._sum.totalAmount ?? ZERO;
      const taxable = n._sum.taxableAmount ?? ZERO;
      if (n.type === 'DEBIT') {
        entry.debitNoteAdjustments = entry.debitNoteAdjustments.plus(amount);
        entry.billedTaxable = entry.billedTaxable.plus(taxable);
      } else {
        entry.creditNoteAdjustments = entry.creditNoteAdjustments.plus(amount);
        entry.billedTaxable = entry.billedTaxable.minus(taxable);
      }
    }

    // Collections and deductions — routed invoiceId -> projectId via the
    // map built above (ReceiptAllocation/AllocationDeduction have no
    // projectId of their own).
    const invoiceIds = invoices.map((i) => i.id);
    if (invoiceIds.length > 0) {
      const allocations = await this.prisma.client.receiptAllocation.findMany({
        where: { invoiceId: { in: invoiceIds }, receipt: { organizationId, status: { not: 'REVERSED' } } },
        select: { id: true, invoiceId: true, cashAllocated: true },
      });
      const allocationInvoiceById = new Map(allocations.map((a) => [a.id, a.invoiceId]));
      for (const a of allocations) {
        const projectId = invoiceProjectById.get(a.invoiceId);
        if (!projectId) continue;
        const entry = acc.get(projectId)!;
        entry.cashReceived = entry.cashReceived.plus(a.cashAllocated);
      }

      const allocationIds = allocations.map((a) => a.id);
      if (allocationIds.length > 0) {
        const deductionTotals = await this.prisma.client.allocationDeduction.groupBy({
          by: ['allocationId', 'type'],
          where: { allocationId: { in: allocationIds } },
          _sum: { amount: true },
        });
        for (const d of deductionTotals) {
          const invoiceId = allocationInvoiceById.get(d.allocationId);
          const projectId = invoiceId ? invoiceProjectById.get(invoiceId) : undefined;
          if (!projectId) continue;
          const entry = acc.get(projectId)!;
          const amount = d._sum.amount ?? ZERO;
          switch (d.type) {
            case 'TDS':
              entry.tdsDeducted = entry.tdsDeducted.plus(amount);
              break;
            case 'CGST_TDS':
            case 'SGST_TDS':
            case 'IGST_TDS':
              entry.gstTdsDeducted = entry.gstTdsDeducted.plus(amount);
              break;
            case 'RETENTION':
              entry.retentionHeld = entry.retentionHeld.plus(amount);
              break;
            case 'HOLD':
              entry.otherHoldAmount = entry.otherHoldAmount.plus(amount);
              break;
            case 'ACCEPTED_PENALTY':
            case 'DISPUTED_PENALTY':
              entry.penaltyOrWriteOff = entry.penaltyOrWriteOff.plus(amount);
              break;
            case 'OTHER':
              entry.otherDeductions = entry.otherDeductions.plus(amount);
              break;
          }
        }

        // Unreleased hold/retention — same live formula as
        // ReceiptsService's own single-deduction release check
        // (amount - sum(releasedAmount)), applied in bulk.
        const holdRetentionDeductions = await this.prisma.client.allocationDeduction.findMany({
          where: { allocationId: { in: allocationIds }, type: { in: ['HOLD', 'RETENTION'] } },
          select: { allocationId: true, amount: true, releases: { select: { releasedAmount: true } } },
        });
        for (const d of holdRetentionDeductions) {
          const invoiceId = allocationInvoiceById.get(d.allocationId);
          const projectId = invoiceId ? invoiceProjectById.get(invoiceId) : undefined;
          if (!projectId) continue;
          const released = d.releases.reduce((sum, r) => sum.plus(r.releasedAmount), ZERO);
          const entry = acc.get(projectId)!;
          entry.unreleasedRetentionAndHold = entry.unreleasedRetentionAndHold.plus(d.amount.minus(released));
        }
      }
    }

    // Recognized expense: Purchase (VendorBillLine, per line, excluding
    // eligible Input GST).
    //
    // Stock lines are skipped (ADR-103). Approval debits them to INVENTORY —
    // an asset, not a cost (docs/06 "Finalize vendor bill for inventory") —
    // and they reach the project only when issued, as MATERIAL below.
    // Counting them here too charged the same stock twice.
    const vendorBills = await this.prisma.client.vendorBill.findMany({
      where: { organizationId, projectId: { in: existingIds }, status: 'FINALIZED' },
      select: {
        projectId: true,
        lines: { select: { lineTotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true, itcEligible: true, inventoryItemId: true } },
      },
    });
    for (const bill of vendorBills) {
      if (!bill.projectId) continue;
      const entry = acc.get(bill.projectId)!;
      for (const line of bill.lines) {
        if (line.inventoryItemId !== null) continue;
        const eligibleGst = line.itcEligible ? line.cgstAmount.plus(line.sgstAmount).plus(line.igstAmount) : ZERO;
        entry.purchaseExpense = entry.purchaseExpense.plus(recognizedExpenseAmount(line.lineTotal, eligibleGst));
      }
    }

    // Recognized expense: Employee Claims (flat amount/gstCreditAmount —
    // gstCreditAmount already IS the eligible-credit portion, no gate).
    const claims = await this.prisma.client.employeeExpenseClaim.findMany({
      where: { organizationId, projectId: { in: existingIds }, status: { in: ['APPROVED', 'REIMBURSED'] } },
      select: { projectId: true, amount: true, gstCreditAmount: true },
    });
    for (const claim of claims) {
      if (!claim.projectId) continue;
      const entry = acc.get(claim.projectId)!;
      entry.employeeClaimExpense = entry.employeeClaimExpense.plus(recognizedExpenseAmount(claim.amount, claim.gstCreditAmount));
    }

    // Recognized expense: Direct Expense (flat taxable+GST+itcEligible,
    // same shape as VendorBillLine).
    const directExpenses = await this.prisma.client.directExpense.findMany({
      where: { organizationId, projectId: { in: existingIds }, status: 'POSTED' },
      select: { id: true, projectId: true, amount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, itcEligible: true, spendType: true },
    });
    // Server and subscription bills are direct expenses tagged with their
    // spend type (ADR-169), so they can be shown apart.
    for (const expense of directExpenses) {
      if (!expense.projectId) continue;
      const entry = acc.get(expense.projectId)!;
      const eligibleGst = expense.itcEligible ? expense.cgstAmount.plus(expense.sgstAmount).plus(expense.igstAmount) : ZERO;
      const recognized = recognizedExpenseAmount(expense.amount, eligibleGst);
      entry.directExpense = entry.directExpense.plus(recognized);
      const source = expense.spendType;
      if (source === 'SERVER') entry.serverExpense = entry.serverExpense.plus(recognized);
      else if (source === 'SUBSCRIPTION') entry.subscriptionExpense = entry.subscriptionExpense.plus(recognized);
    }

    // EMD and SD still lodged: against the project, or against the tender
    // it was won from (an EMD is usually lodged before the project exists).
    const projectsByTender = new Map<string, string[]>();
    for (const p of projectRows) if (p.tenderId) projectsByTender.set(p.tenderId, [...(projectsByTender.get(p.tenderId) ?? []), p.id]);
    const instruments = await this.prisma.client.securityInstrument.findMany({
      where: {
        organizationId,
        status: 'LODGED',
        OR: [{ projectId: { in: existingIds } }, ...(projectsByTender.size ? [{ projectId: null, tenderId: { in: [...projectsByTender.keys()] } }] : [])],
      },
      select: { projectId: true, tenderId: true, amount: true, purpose: { select: { category: true } } },
    });
    for (const i of instruments) {
      const targets = i.projectId ? [i.projectId] : (projectsByTender.get(i.tenderId ?? '') ?? []);
      for (const projectId of targets) {
        const entry = acc.get(projectId);
        if (!entry) continue;
        if (i.purpose.category === 'EMD') entry.emdLodged = entry.emdLodged.plus(i.amount);
        else if (i.purpose.category === 'SD') entry.sdLodged = entry.sdLodged.plus(i.amount);
      }
    }

    // Recognized expense: the three Phase 7 streams (ADR-097).
    //
    // All three pass ZERO as the eligible-GST credit rather than bypassing
    // `recognizedExpenseAmount`, so the "one shared formula" invariant that
    // util's doc comment asserts still holds. Each is genuinely zero, for a
    // different reason:
    //   * Material  — the consumption value is a weighted average of what was
    //     debited to INVENTORY, which was taxable value plus INELIGIBLE tax
    //     only; recoverable ITC was split out to Input GST Receivable back at
    //     vendor-bill approval, so it was never in this figure to remove.
    //   * Manpower  — salary carries no GST at all.
    //   * Introducer — docs/06 gives introducer commission no tax treatment,
    //     and ADR-096 deliberately modelled none.
    const consumptions = await this.prisma.client.inventoryConsumption.findMany({
      where: { organizationId, projectId: { in: existingIds }, status: 'POSTED' },
      select: { projectId: true, totalValueAmount: true },
    });
    for (const consumption of consumptions) {
      const entry = acc.get(consumption.projectId)!;
      entry.materialExpense = entry.materialExpense.plus(recognizedExpenseAmount(consumption.totalValueAmount, ZERO));
    }

    const accruals = await this.prisma.client.introducerAccrual.findMany({
      where: { organizationId, status: 'POSTED', agreement: { projectId: { in: existingIds } } },
      select: { amount: true, agreement: { select: { projectId: true } } },
    });
    for (const accrual of accruals) {
      const entry = acc.get(accrual.agreement.projectId);
      if (!entry) continue;
      entry.introducerExpense = entry.introducerExpense.plus(recognizedExpenseAmount(accrual.amount, ZERO));
    }

    // Manpower is derived, not posted: imported gross salary x allocation
    // percentage, for SUBMITTED months only. The whole month is split through
    // the shared `allocateSalary` util and only the requested projects' lines
    // are kept — splitting just those lines would decide the rounding
    // remainder against a different denominator, and this figure would then
    // disagree with the Manpower Cost report and the Spend ledger.
    const allocations = await this.prisma.client.employeeMonthlyAllocation.findMany({
      where: {
        organizationId,
        status: 'SUBMITTED',
        lines: { some: { projectId: { in: existingIds } } },
      },
      select: {
        employeeId: true,
        allocationMonth: true,
        lines: { select: { id: true, sequence: true, percentage: true, projectId: true } },
      },
    });
    if (allocations.length > 0) {
      const salaryLines = await this.prisma.client.salaryImportLine.findMany({
        where: {
          organizationId,
          employeeId: { in: [...new Set(allocations.map((a) => a.employeeId))] },
          salaryImport: { status: 'POSTED' },
        },
        select: { employeeId: true, grossSalaryAmount: true, salaryImport: { select: { salaryMonth: true } } },
      });
      const grossByKey = new Map(
        salaryLines.map((l) => [
          `${l.employeeId}|${l.salaryImport.salaryMonth.toISOString().slice(0, 10)}`,
          l.grossSalaryAmount,
        ]),
      );
      for (const allocation of allocations) {
        const gross = grossByKey.get(
          `${allocation.employeeId}|${allocation.allocationMonth.toISOString().slice(0, 10)}`,
        );
        if (!gross) continue;
        const allocated = allocateSalary(
          gross,
          allocation.lines.map((l) => ({ key: l.id, sequence: l.sequence, percentage: l.percentage })),
        );
        const amountByLine = new Map(allocated.map((a) => [a.key, a.amount]));
        for (const line of allocation.lines) {
          if (!line.projectId) continue;
          const entry = acc.get(line.projectId);
          if (!entry) continue;
          entry.manpowerExpense = entry.manpowerExpense.plus(
            recognizedExpenseAmount(amountByLine.get(line.id) ?? ZERO, ZERO),
          );
        }
      }
    }

    const result = new Map<string, ProjectFinancialSummary>();
    for (const [projectId, entry] of acc) {
      const netBilled = entry.grossInvoiceValue.plus(entry.debitNoteAdjustments).minus(entry.creditNoteAdjustments);
      const totalSettled = entry.cashReceived
        .plus(entry.tdsDeducted)
        .plus(entry.gstTdsDeducted)
        .plus(entry.retentionHeld)
        .plus(entry.otherHoldAmount)
        .plus(entry.penaltyOrWriteOff)
        .plus(entry.otherDeductions);
      // Unclamped by design (ADR-089) — a negative value is a genuine
      // credit balance, never floored to zero.
      const invoiceOutstanding = netBilled.minus(totalSettled);
      const clientReceivable = invoiceOutstanding.plus(entry.unreleasedRetentionAndHold);
      const recognizedProjectExpense = entry.purchaseExpense
        .plus(entry.employeeClaimExpense)
        .plus(entry.directExpense)
        .plus(entry.materialExpense)
        .plus(entry.manpowerExpense)
        .plus(entry.introducerExpense);
      const profit = entry.billedTaxable.minus(recognizedProjectExpense);

      result.set(projectId, {
        projectId,
        contractValueExclGst: entry.contractValueExclGst ? entry.contractValueExclGst.toFixed(2) : null,
        grossInvoiceValue: entry.grossInvoiceValue.toFixed(2),
        debitNoteAdjustments: entry.debitNoteAdjustments.toFixed(2),
        creditNoteAdjustments: entry.creditNoteAdjustments.toFixed(2),
        netBilled: netBilled.toFixed(2),
        cashReceived: entry.cashReceived.toFixed(2),
        tdsDeducted: entry.tdsDeducted.toFixed(2),
        gstTdsDeducted: entry.gstTdsDeducted.toFixed(2),
        retentionHeld: entry.retentionHeld.toFixed(2),
        otherHoldAmount: entry.otherHoldAmount.toFixed(2),
        penaltyOrWriteOff: entry.penaltyOrWriteOff.toFixed(2),
        otherDeductions: entry.otherDeductions.toFixed(2),
        totalSettled: totalSettled.toFixed(2),
        invoiceOutstanding: invoiceOutstanding.toFixed(2),
        unreleasedRetentionAndHold: entry.unreleasedRetentionAndHold.toFixed(2),
        clientReceivable: clientReceivable.toFixed(2),
        purchaseExpense: entry.purchaseExpense.toFixed(2),
        employeeClaimExpense: entry.employeeClaimExpense.toFixed(2),
        directExpense: entry.directExpense.toFixed(2),
        materialExpense: entry.materialExpense.toFixed(2),
        manpowerExpense: entry.manpowerExpense.toFixed(2),
        introducerExpense: entry.introducerExpense.toFixed(2),
        recognizedProjectExpense: recognizedProjectExpense.toFixed(2),
        billedExclGst: entry.billedTaxable.toFixed(2),
        billedPercent: percent(entry.billedTaxable, entry.contractValueExclGst),
        billedOverContract:
          entry.contractValueExclGst && entry.billedTaxable.greaterThan(entry.contractValueExclGst)
            ? entry.billedTaxable.minus(entry.contractValueExclGst).toFixed(2)
            : null,
        serverExpense: entry.serverExpense.toFixed(2),
        subscriptionExpense: entry.subscriptionExpense.toFixed(2),
        otherDirectExpense: entry.directExpense.minus(entry.serverExpense).minus(entry.subscriptionExpense).toFixed(2),
        profit: profit.toFixed(2),
        profitMarginPercent: percent(profit, entry.billedTaxable),
        emdLodged: entry.emdLodged.toFixed(2),
        sdLodged: entry.sdLodged.toFixed(2),
      });
    }
    return result;
  }

  async getFinancialSummary(input: {
    organizationId: string;
    projectId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ProjectFinancialSummary> {
    // Reuses getDetail's own project-access scope check — throws NOT_FOUND
    // for a PM not assigned to this project, same as every other
    // project-scoped read in this codebase.
    await this.projects.getDetail({
      organizationId: input.organizationId,
      id: input.projectId,
      actorId: input.actorId,
      canSeeAll: input.canSeeAll,
    });
    const summaries = await this.computeFinancialSummaries(input.organizationId, [input.projectId]);
    return summaries.get(input.projectId)!;
  }

  async listFinancialSummaries(input: {
    organizationId: string;
    actorId: string;
    canSeeAll: boolean;
    projectIds: string[];
  }): Promise<ProjectFinancialSummary[]> {
    // The caller's requested ids are never trusted directly — when the
    // actor isn't unscoped, re-derive their full permitted project set and
    // intersect, silently dropping anything outside it. When canSeeAll is
    // true, computeFinancialSummaries' own organizationId filter is
    // sufficient (any id outside the org simply won't resolve to a row).
    let authorizedIds = input.projectIds;
    if (!input.canSeeAll) {
      const permitted = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      const permittedIds = new Set(permitted.map((p) => p.id));
      authorizedIds = input.projectIds.filter((id) => permittedIds.has(id));
    }
    if (authorizedIds.length === 0) return [];
    const summaries = await this.computeFinancialSummaries(input.organizationId, authorizedIds);
    return authorizedIds.filter((id) => summaries.has(id)).map((id) => summaries.get(id)!);
  }

  async getClientFinancialSummary(input: {
    organizationId: string;
    clientId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ClientFinancialSummary> {
    // Client access: an org-scoped existence check only — client.read has
    // no further per-actor scoping in this codebase (unlike Project's own
    // PM-assignment scoping), so this is the whole "Client access" check.
    // Throws NOT_FOUND for a cross-org or nonexistent client.
    await this.clients.getDetail({ organizationId: input.organizationId, id: input.clientId });

    // Reuses ProjectsService.list's own existing scope verbatim, exactly
    // like listFinancialSummaries — only projects this actor can actually
    // see are ever summed, never a separate org-wide query. A scoped actor
    // who can see none of this client's projects gets an all-zero summary
    // below (projectCount: 0), not an error — the client itself is
    // genuinely accessible, only its financial data happens to be empty
    // for this actor.
    const permitted = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: input.canSeeAll });
    const clientProjectIds = permitted.filter((p) => p.clientId === input.clientId).map((p) => p.id);

    const perProject = await this.computeFinancialSummaries(input.organizationId, clientProjectIds);

    // Every field below is a linear combination of the others (sums,
    // differences) with no multiplication/division — summing each field
    // independently across projects is mathematically exact and commutes
    // with the per-project derived formulas (netBilled, totalSettled,
    // invoiceOutstanding, clientReceivable, recognizedProjectExpense),
    // so there's no need to recompute any of them from the summed parts.
    let totalContractValueExclGst = ZERO;
    let grossInvoiceValue = ZERO;
    let debitNoteAdjustments = ZERO;
    let creditNoteAdjustments = ZERO;
    let netBilled = ZERO;
    let cashReceived = ZERO;
    let tdsDeducted = ZERO;
    let gstTdsDeducted = ZERO;
    let retentionHeld = ZERO;
    let otherHoldAmount = ZERO;
    let penaltyOrWriteOff = ZERO;
    let otherDeductions = ZERO;
    let totalSettled = ZERO;
    let invoiceOutstanding = ZERO;
    let unreleasedRetentionAndHold = ZERO;
    let clientReceivable = ZERO;
    let purchaseExpense = ZERO;
    let employeeClaimExpense = ZERO;
    let directExpense = ZERO;
    let materialExpense = ZERO;
    let manpowerExpense = ZERO;
    let introducerExpense = ZERO;
    let recognizedProjectExpense = ZERO;

    for (const p of perProject.values()) {
      totalContractValueExclGst = totalContractValueExclGst.plus(p.contractValueExclGst ?? '0');
      grossInvoiceValue = grossInvoiceValue.plus(p.grossInvoiceValue);
      debitNoteAdjustments = debitNoteAdjustments.plus(p.debitNoteAdjustments);
      creditNoteAdjustments = creditNoteAdjustments.plus(p.creditNoteAdjustments);
      netBilled = netBilled.plus(p.netBilled);
      cashReceived = cashReceived.plus(p.cashReceived);
      tdsDeducted = tdsDeducted.plus(p.tdsDeducted);
      gstTdsDeducted = gstTdsDeducted.plus(p.gstTdsDeducted);
      retentionHeld = retentionHeld.plus(p.retentionHeld);
      otherHoldAmount = otherHoldAmount.plus(p.otherHoldAmount);
      penaltyOrWriteOff = penaltyOrWriteOff.plus(p.penaltyOrWriteOff);
      otherDeductions = otherDeductions.plus(p.otherDeductions);
      totalSettled = totalSettled.plus(p.totalSettled);
      invoiceOutstanding = invoiceOutstanding.plus(p.invoiceOutstanding);
      unreleasedRetentionAndHold = unreleasedRetentionAndHold.plus(p.unreleasedRetentionAndHold);
      clientReceivable = clientReceivable.plus(p.clientReceivable);
      purchaseExpense = purchaseExpense.plus(p.purchaseExpense);
      employeeClaimExpense = employeeClaimExpense.plus(p.employeeClaimExpense);
      directExpense = directExpense.plus(p.directExpense);
      materialExpense = materialExpense.plus(p.materialExpense);
      manpowerExpense = manpowerExpense.plus(p.manpowerExpense);
      introducerExpense = introducerExpense.plus(p.introducerExpense);
      recognizedProjectExpense = recognizedProjectExpense.plus(p.recognizedProjectExpense);
    }

    return {
      clientId: input.clientId,
      projectCount: clientProjectIds.length,
      totalContractValueExclGst: totalContractValueExclGst.toFixed(2),
      grossInvoiceValue: grossInvoiceValue.toFixed(2),
      debitNoteAdjustments: debitNoteAdjustments.toFixed(2),
      creditNoteAdjustments: creditNoteAdjustments.toFixed(2),
      netBilled: netBilled.toFixed(2),
      cashReceived: cashReceived.toFixed(2),
      tdsDeducted: tdsDeducted.toFixed(2),
      gstTdsDeducted: gstTdsDeducted.toFixed(2),
      retentionHeld: retentionHeld.toFixed(2),
      otherHoldAmount: otherHoldAmount.toFixed(2),
      penaltyOrWriteOff: penaltyOrWriteOff.toFixed(2),
      otherDeductions: otherDeductions.toFixed(2),
      totalSettled: totalSettled.toFixed(2),
      invoiceOutstanding: invoiceOutstanding.toFixed(2),
      unreleasedRetentionAndHold: unreleasedRetentionAndHold.toFixed(2),
      clientReceivable: clientReceivable.toFixed(2),
      purchaseExpense: purchaseExpense.toFixed(2),
      employeeClaimExpense: employeeClaimExpense.toFixed(2),
      directExpense: directExpense.toFixed(2),
      materialExpense: materialExpense.toFixed(2),
      manpowerExpense: manpowerExpense.toFixed(2),
      introducerExpense: introducerExpense.toFixed(2),
      recognizedProjectExpense: recognizedProjectExpense.toFixed(2),
    };
  }
}
