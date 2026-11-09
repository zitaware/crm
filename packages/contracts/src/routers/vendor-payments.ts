import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const deductionTypeSchema = z.enum(['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS']);
const statusSchema = z.enum(['POSTED', 'REVERSED']);

const deductionInputSchema = z.object({
  type: deductionTypeSchema,
  amount: decimalStringSchema,
  ratePercent: decimalStringSchema.optional(),
  narrative: z.string().max(1000).optional(),
});

const allocationInputSchema = z.object({
  paymentRequestLineId: z.string().uuid(),
  cashPaid: decimalStringSchema,
  deductions: z.array(deductionInputSchema),
});

function toAllocationInputs(allocations: z.infer<typeof allocationInputSchema>[]) {
  return allocations.map((a) => ({
    paymentRequestLineId: a.paymentRequestLineId,
    cashPaid: a.cashPaid,
    deductions: a.deductions.map((d) => ({
      type: d.type,
      amount: d.amount,
      ratePercent: d.ratePercent,
      narrative: d.narrative,
    })),
  }));
}

function withCanSeeAll<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('project.read_all');
}

export const vendorPaymentsRouter = router({
  getEligiblePaymentRequestLines: requirePermission('vendor_payment.post')
    .input(
      z.object({
        vendorId: z.string().uuid().optional(),
        legalEntityId: z.string().uuid().optional(),
        seedPaymentRequestId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.vendorPayments.getEligiblePaymentRequestLines({
        organizationId: ctx.auth.user!.organizationId,
        vendorId: input.vendorId,
        legalEntityId: input.legalEntityId,
        seedPaymentRequestId: input.seedPaymentRequestId,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getPaymentRequestAvailability: requirePermission('vendor_payment.read')
    .input(z.object({ paymentRequestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.vendorPayments.getPaymentRequestAvailability({
        organizationId: ctx.auth.user!.organizationId,
        paymentRequestId: input.paymentRequestId,
      });
    }),

  calculatePreview: requirePermission('vendor_payment.post')
    .input(z.object({ bankAccountId: z.string().uuid(), allocations: z.array(allocationInputSchema).min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.services.vendorPayments.calculatePreview({
        organizationId: ctx.auth.user!.organizationId,
        bankAccountId: input.bankAccountId,
        allocations: toAllocationInputs(input.allocations),
      });
    }),

  postVendorPayment: requirePermission('vendor_payment.post')
    .input(
      z.object({
        bankAccountId: z.string().uuid(),
        paymentModeId: z.string().uuid(),
        paymentDate: dateStringSchema,
        utrReference: z.string().max(200).optional(),
        actualAmount: decimalStringSchema,
        allocations: z.array(allocationInputSchema).min(1),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.vendorPayments.postVendorPayment({
        organizationId: ctx.auth.user!.organizationId,
        bankAccountId: input.bankAccountId,
        paymentModeId: input.paymentModeId,
        paymentDate: input.paymentDate,
        utrReference: input.utrReference,
        actualAmount: input.actualAmount,
        allocations: toAllocationInputs(input.allocations),
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reverseVendorPayment: requirePermission('vendor_payment.reverse')
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
      return ctx.services.vendorPayments.reverseVendorPayment({
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

  list: requirePermission('vendor_payment.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          projectId: z.string().uuid().optional(),
          legalEntityId: z.string().uuid().optional(),
          status: statusSchema.optional(),
          paymentRequestId: z.string().uuid().optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.vendorPayments.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getDetail: requirePermission('vendor_payment.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.vendorPayments.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),
});
