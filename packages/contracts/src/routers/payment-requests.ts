import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date (YYYY-MM-DD).');
const prioritySchema = z.enum(['NORMAL', 'URGENT', 'LOW']);
const statusSchema = z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED']);

const lineInputSchema = z.object({
  vendorBillId: z.string().uuid(),
  requestedAmount: decimalStringSchema,
});

function toLineInputs(lines: z.infer<typeof lineInputSchema>[]) {
  return lines.map((line) => ({ vendorBillId: line.vendorBillId, requestedAmount: line.requestedAmount }));
}

function withCanSeeAll<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('project.read_all');
}

function withSelfApprove<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('payment_request.self_approve');
}

export const paymentRequestsRouter = router({
  list: requirePermission('payment_request.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          vendorId: z.string().uuid().optional(),
          legalEntityId: z.string().uuid().optional(),
          status: statusSchema.optional(),
          vendorBillId: z.string().uuid().optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getDetail: requirePermission('payment_request.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getEligibleBills: requirePermission('payment_request.create')
    .input(
      z.object({
        vendorId: z.string().uuid().optional(),
        legalEntityId: z.string().uuid().optional(),
        seedVendorBillId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.getEligibleBills({
        organizationId: ctx.auth.user!.organizationId,
        vendorId: input.vendorId,
        legalEntityId: input.legalEntityId,
        seedVendorBillId: input.seedVendorBillId,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getBillAvailability: requirePermission('payment_request.read')
    .input(z.object({ vendorBillId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.getBillAvailability({
        organizationId: ctx.auth.user!.organizationId,
        vendorBillId: input.vendorBillId,
      });
    }),

  calculatePreview: requirePermission('payment_request.create')
    .input(
      z.object({
        vendorId: z.string().uuid(),
        legalEntityId: z.string().uuid(),
        lines: z.array(lineInputSchema),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.calculatePreview({
        organizationId: ctx.auth.user!.organizationId,
        vendorId: input.vendorId,
        legalEntityId: input.legalEntityId,
        lines: toLineInputs(input.lines),
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  createDraft: requirePermission('payment_request.create')
    .input(
      z.object({
        vendorId: z.string().uuid(),
        legalEntityId: z.string().uuid(),
        requestedPaymentDate: dateStringSchema,
        priority: prioritySchema.optional(),
        remarks: z.string().max(2000).optional(),
        lines: z.array(lineInputSchema).min(1),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.createDraft({
        organizationId: ctx.auth.user!.organizationId,
        vendorId: input.vendorId,
        legalEntityId: input.legalEntityId,
        requestedPaymentDate: input.requestedPaymentDate,
        priority: input.priority,
        remarks: input.remarks,
        lines: toLineInputs(input.lines),
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  updateDraft: requirePermission('payment_request.create')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        requestedPaymentDate: dateStringSchema.optional(),
        priority: prioritySchema.optional(),
        remarks: z.string().max(2000).optional(),
        lines: z.array(lineInputSchema).min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.updateDraft({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        requestedPaymentDate: input.requestedPaymentDate,
        priority: input.priority,
        remarks: input.remarks,
        lines: input.lines ? toLineInputs(input.lines) : undefined,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  submit: requirePermission('payment_request.create')
    .input(z.object({ id: z.string().uuid(), expectedVersion: z.number().int(), idempotencyKey: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.submit({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  approve: requirePermission('payment_request.approve')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        note: z.string().max(1000).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.approve({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        hasSelfApprovePermission: withSelfApprove(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  reject: requirePermission('payment_request.approve')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.reject({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  cancel: requirePermission('payment_request.create')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.cancel({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  revoke: requirePermission('payment_request.revoke')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.paymentRequests.revoke({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),
});
