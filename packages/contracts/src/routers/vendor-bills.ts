import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const prioritySchema = z.enum(['NORMAL', 'URGENT', 'LOW']);
const statusSchema = z.enum(['DRAFT', 'SUBMITTED', 'FINALIZED', 'REJECTED', 'CANCELLED', 'VOID']);

// A line is either an expense line or a stock line (Phase 7.2, ADR-092).
// The exactly-one rule is refined here so the client gets a field-level
// message, and re-checked in the service (which also verifies the item is
// active and stock-tracked) — the router never carries business logic alone.
const lineInputSchema = z
  .object({
    description: z.string().min(1).max(500),
    expenseCategoryId: z.string().uuid().optional(),
    inventoryItemId: z.string().uuid().optional(),
    unitOfMeasureId: z.string().uuid(),
    hsnSac: z.string().max(20).optional(),
    quantity: decimalStringSchema,
    unitPrice: decimalStringSchema,
    gstRatePercent: decimalStringSchema,
    itcEligible: z.boolean(),
  })
  .refine((line) => (line.expenseCategoryId === undefined) !== (line.inventoryItemId === undefined), {
    message: 'Choose either an expense category or a stock item for this line, not both.',
    path: ['expenseCategoryId'],
  });

function toLineInputs(lines: z.infer<typeof lineInputSchema>[]) {
  return lines.map((line) => ({
    description: line.description,
    expenseCategoryId: line.expenseCategoryId,
    inventoryItemId: line.inventoryItemId,
    unitOfMeasureId: line.unitOfMeasureId,
    hsnSac: line.hsnSac,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    gstRatePercent: line.gstRatePercent,
    itcEligible: line.itcEligible,
  }));
}

function withCanSeeAll<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('project.read_all');
}

function withSelfApprove<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('vendor_bill.self_approve');
}

export const vendorBillsRouter = router({
  calculatePreview: requirePermission('vendor_bill.create')
    .input(
      z.object({
        vendorId: z.string().uuid(),
        gstRegistrationId: z.string().uuid(),
        lines: z.array(lineInputSchema),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.vendorBills.calculatePreview({
        organizationId: ctx.auth.user!.organizationId,
        vendorId: input.vendorId,
        gstRegistrationId: input.gstRegistrationId,
        lines: toLineInputs(input.lines),
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  createDraft: requirePermission('vendor_bill.create')
    .input(
      z.object({
        // Optional (ADR-177): without a project, the legal entity is named.
        projectId: z.string().uuid().optional(),
        legalEntityId: z.string().uuid().optional(),
        vendorId: z.string().uuid(),
        priority: prioritySchema.optional(),
        gstRegistrationId: z.string().uuid(),
        vendorBillNumber: z.string().min(1).max(100),
        vendorBillDate: dateStringSchema,
        lines: z.array(lineInputSchema).min(1),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.vendorBills.createDraft({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        legalEntityId: input.legalEntityId,
        vendorId: input.vendorId,
        priority: input.priority,
        gstRegistrationId: input.gstRegistrationId,
        vendorBillNumber: input.vendorBillNumber,
        vendorBillDate: input.vendorBillDate,
        lines: toLineInputs(input.lines),
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  updateDraft: requirePermission('vendor_bill.create')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        projectId: z.string().uuid().nullable().optional(),
        legalEntityId: z.string().uuid().optional(),
        vendorId: z.string().uuid().optional(),
        priority: prioritySchema.optional(),
        gstRegistrationId: z.string().uuid().optional(),
        vendorBillNumber: z.string().min(1).max(100).optional(),
        vendorBillDate: dateStringSchema.optional(),
        lines: z.array(lineInputSchema).min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.vendorBills.updateDraft({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        projectId: input.projectId,
        legalEntityId: input.legalEntityId,
        vendorId: input.vendorId,
        priority: input.priority,
        gstRegistrationId: input.gstRegistrationId,
        vendorBillNumber: input.vendorBillNumber,
        vendorBillDate: input.vendorBillDate,
        lines: input.lines ? toLineInputs(input.lines) : undefined,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  submit: requirePermission('vendor_bill.create')
    .input(z.object({ id: z.string().uuid(), expectedVersion: z.number().int(), idempotencyKey: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.vendorBills.submit({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  approve: requirePermission('vendor_bill.approve')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        note: z.string().max(1000).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.vendorBills.approve({
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

  reject: requirePermission('vendor_bill.approve')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.vendorBills.reject({
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

  cancel: requirePermission('vendor_bill.create')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.vendorBills.cancel({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  void: requirePermission('vendor_bill.void')
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
      return ctx.services.vendorBills.void({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        accountingDate: input.accountingDate,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  list: requirePermission('vendor_bill.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          projectId: z.string().uuid().optional(),
          vendorId: z.string().uuid().optional(),
          status: statusSchema.optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.vendorBills.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getDetail: requirePermission('vendor_bill.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.vendorBills.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),
});
