import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const deductionTypeSchema = z.enum(['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS', 'HOLD', 'RETENTION', 'ACCEPTED_PENALTY', 'DISPUTED_PENALTY', 'OTHER']);
const statusSchema = z.enum(['POSTED', 'REVERSED']);

const deductionInputSchema = z.object({
  type: deductionTypeSchema,
  amount: decimalStringSchema,
  ratePercent: decimalStringSchema.optional(),
  penaltyCategoryId: z.string().uuid().optional(),
  otherLedgerAccountId: z.string().uuid().optional(),
  narrative: z.string().max(1000).optional(),
});

const allocationInputSchema = z.object({
  invoiceId: z.string().uuid(),
  sourceEventId: z.string().uuid().optional(),
  cashAllocated: decimalStringSchema,
  deductions: z.array(deductionInputSchema),
});

function toAllocationInputs(allocations: z.infer<typeof allocationInputSchema>[]) {
  return allocations.map((a) => ({
    invoiceId: a.invoiceId,
    sourceEventId: a.sourceEventId,
    cashAllocated: a.cashAllocated,
    deductions: a.deductions.map((d) => ({
      type: d.type,
      amount: d.amount,
      ratePercent: d.ratePercent,
      penaltyCategoryId: d.penaltyCategoryId,
      otherLedgerAccountId: d.otherLedgerAccountId,
      narrative: d.narrative,
    })),
  }));
}

function withCanSeeAll<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('project.read_all');
}

export const receiptsRouter = router({
  getAllocationCandidates: requirePermission('receipt.post')
    .input(z.object({ seedInvoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.receipts.getAllocationCandidates({
        organizationId: ctx.auth.user!.organizationId,
        seedInvoiceId: input.seedInvoiceId,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  calculatePreview: requirePermission('receipt.post')
    .input(z.object({ bankAccountId: z.string().uuid(), allocations: z.array(allocationInputSchema).min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.services.receipts.calculatePreview({
        organizationId: ctx.auth.user!.organizationId,
        bankAccountId: input.bankAccountId,
        allocations: toAllocationInputs(input.allocations),
      });
    }),

  postReceipt: requirePermission('receipt.post')
    .input(
      z.object({
        bankAccountId: z.string().uuid(),
        paymentModeId: z.string().uuid(),
        receiptDate: dateStringSchema,
        utrReference: z.string().max(200).optional(),
        actualAmount: decimalStringSchema,
        allocations: z.array(allocationInputSchema).min(1),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.receipts.postReceipt({
        organizationId: ctx.auth.user!.organizationId,
        bankAccountId: input.bankAccountId,
        paymentModeId: input.paymentModeId,
        receiptDate: input.receiptDate,
        utrReference: input.utrReference,
        actualAmount: input.actualAmount,
        allocations: toAllocationInputs(input.allocations),
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reverseReceipt: requirePermission('receipt.reverse')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        accountingDate: dateStringSchema,
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.receipts.reverseReceipt({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        accountingDate: input.accountingDate,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  releaseDeduction: requirePermission('deduction.release')
    .input(
      z.object({
        deductionId: z.string().uuid(),
        releasedAmount: decimalStringSchema,
        releasedOn: dateStringSchema,
        bankAccountId: z.string().uuid(),
        utrReference: z.string().max(200).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.receipts.releaseDeduction({
        organizationId: ctx.auth.user!.organizationId,
        deductionId: input.deductionId,
        releasedAmount: input.releasedAmount,
        releasedOn: input.releasedOn,
        bankAccountId: input.bankAccountId,
        utrReference: input.utrReference,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  getOutstandingDeductions: requirePermission('receipt.read')
    .input(z.object({ projectId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.receipts.getOutstandingDeductions({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  list: requirePermission('receipt.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          projectId: z.string().uuid().optional(),
          legalEntityId: z.string().uuid().optional(),
          status: statusSchema.optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.receipts.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getDetail: requirePermission('receipt.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.receipts.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),
});
