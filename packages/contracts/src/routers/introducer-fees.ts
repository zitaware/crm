import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const statusSchema = z.enum(['POSTED', 'REVERSED']);

export const introducerFeesRouter = router({
  listBalances: requirePermission('introducer_fee.read').query(async ({ ctx }) => {
    return ctx.services.introducerFees.listBalances({ organizationId: ctx.auth.user!.organizationId });
  }),

  listAgreements: requirePermission('introducer_fee.read')
    .input(
      z.object({
        introducerId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        includeInactive: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.introducerFees.listAgreements({
        organizationId: ctx.auth.user!.organizationId,
        filters: { introducerId: input.introducerId, projectId: input.projectId, includeInactive: input.includeInactive },
      });
    }),

  createAgreement: requirePermission('introducer_fee.create')
    .input(
      z
        .object({
          introducerId: z.string().uuid(),
          projectId: z.string().uuid(),
          basisType: z.enum(['PERCENT_OF_PROJECT_VALUE', 'FIXED_AMOUNT']),
          ratePercent: decimalStringSchema.optional(),
          fixedAmount: decimalStringSchema.optional(),
          agreementDate: dateStringSchema,
          remarks: z.string().max(1000).optional(),
          idempotencyKey: z.string().min(1).max(200),
        })
        // The basis and its figure must agree. Refused here as well as by the
        // service and a DB CHECK, so the mistake never reaches the network.
        .refine((v) => (v.basisType === 'PERCENT_OF_PROJECT_VALUE' ? Boolean(v.ratePercent) && !v.fixedAmount : Boolean(v.fixedAmount) && !v.ratePercent), {
          message: 'A percentage agreement needs a rate and no fixed amount; a fixed agreement needs an amount and no rate.',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.introducerFees.createAgreement({
        organizationId: ctx.auth.user!.organizationId,
        introducerId: input.introducerId,
        projectId: input.projectId,
        basisType: input.basisType,
        ratePercent: input.ratePercent,
        fixedAmount: input.fixedAmount,
        agreementDate: input.agreementDate,
        remarks: input.remarks,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  listAccruals: requirePermission('introducer_fee.read')
    .input(
      z.object({
        introducerId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        status: statusSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.introducerFees.listAccruals({
        organizationId: ctx.auth.user!.organizationId,
        filters: { introducerId: input.introducerId, projectId: input.projectId, status: input.status },
      });
    }),

  postAccrual: requirePermission('introducer_fee.create')
    .input(
      z.object({
        introducerAgreementId: z.string().uuid(),
        accrualDate: dateStringSchema,
        amount: decimalStringSchema,
        narrative: z.string().max(1000).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.introducerFees.postAccrual({
        organizationId: ctx.auth.user!.organizationId,
        introducerAgreementId: input.introducerAgreementId,
        accrualDate: input.accrualDate,
        amount: input.amount,
        narrative: input.narrative,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reverseAccrual: requirePermission('introducer_fee.create')
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
      return ctx.services.introducerFees.reverseAccrual({
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

  listPayments: requirePermission('introducer_fee.read')
    .input(z.object({ introducerId: z.string().uuid().optional(), status: statusSchema.optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.introducerFees.listPayments({
        organizationId: ctx.auth.user!.organizationId,
        filters: { introducerId: input.introducerId, status: input.status },
      });
    }),

  getPaymentDetail: requirePermission('introducer_fee.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.introducerFees.getPaymentDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
      });
    }),

  postPayment: requirePermission('introducer_fee.pay')
    .input(
      z.object({
        introducerId: z.string().uuid(),
        legalEntityId: z.string().uuid(),
        bankAccountId: z.string().uuid(),
        paymentDate: dateStringSchema,
        paymentModeId: z.string().uuid().optional(),
        referenceNumber: z.string().max(100).optional(),
        grossAmount: decimalStringSchema,
        tdsAmount: decimalStringSchema.default('0'),
        narrative: z.string().max(1000).optional(),
        allocations: z
          .array(z.object({ introducerAccrualId: z.string().uuid(), allocatedAmount: decimalStringSchema }))
          .max(100)
          .default([]),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.introducerFees.postPayment({
        organizationId: ctx.auth.user!.organizationId,
        introducerId: input.introducerId,
        legalEntityId: input.legalEntityId,
        bankAccountId: input.bankAccountId,
        paymentDate: input.paymentDate,
        paymentModeId: input.paymentModeId,
        referenceNumber: input.referenceNumber,
        grossAmount: input.grossAmount,
        tdsAmount: input.tdsAmount,
        narrative: input.narrative,
        allocations: input.allocations,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reversePayment: requirePermission('introducer_fee.pay')
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
      return ctx.services.introducerFees.reversePayment({
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
});
