import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const statusSchema = z.enum(['DRAFT', 'ISSUED', 'FINALIZED', 'VOID', 'CONVERTED']);
const kindSchema = z.enum(['REGULAR', 'PROFORMA']);

const lineInputSchema = z.object({
  description: z.string().min(1).max(500),
  hsnSac: z.string().max(20).optional(),
  quantity: decimalStringSchema,
  unitPrice: decimalStringSchema,
  gstRatePercent: decimalStringSchema,
  sourceEventId: z.string().uuid().optional(),
});

function toLineInputs(lines: z.infer<typeof lineInputSchema>[]) {
  return lines.map((line) => ({
    description: line.description,
    hsnSac: line.hsnSac,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    gstRatePercent: line.gstRatePercent,
    ...(line.sourceEventId !== undefined ? { sourceEventId: line.sourceEventId } : {}),
  }));
}

function withCanSeeAll<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('project.read_all');
}

export const invoicesRouter = router({
  getDraftDefaults: requirePermission('invoice.create')
    .input(z.object({ paymentAlertId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.invoices.getDraftDefaults({
        organizationId: ctx.auth.user!.organizationId,
        paymentAlertId: input.paymentAlertId,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  createDraftFromAlert: requirePermission('invoice.create')
    .input(
      z.object({
        paymentAlertId: z.string().uuid(),
        gstRegistrationId: z.string().uuid(),
        bankAccountId: z.string().uuid().optional(),
        dueDate: dateStringSchema,
        paymentTermsDays: z.number().int().min(0).optional(),
        narrative: z.string().max(2000).optional(),
        lines: z.array(lineInputSchema).min(1),
        additionalPaymentAlertIds: z.array(z.string().uuid()).max(50).optional(),
        kind: kindSchema.optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.invoices.createDraftFromAlert({
        organizationId: ctx.auth.user!.organizationId,
        paymentAlertId: input.paymentAlertId,
        gstRegistrationId: input.gstRegistrationId,
        ...(input.bankAccountId !== undefined ? { bankAccountId: input.bankAccountId } : {}),
        dueDate: input.dueDate,
        paymentTermsDays: input.paymentTermsDays,
        narrative: input.narrative,
        lines: toLineInputs(input.lines),
        ...(input.additionalPaymentAlertIds !== undefined ? { additionalPaymentAlertIds: input.additionalPaymentAlertIds } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  updateDraft: requirePermission('invoice.update')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        gstRegistrationId: z.string().uuid().optional(),
        dueDate: dateStringSchema.optional(),
        paymentTermsDays: z.number().int().min(0).optional(),
        narrative: z.string().max(2000).optional(),
        lines: z.array(lineInputSchema).min(1).optional(),
        kind: kindSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.invoices.updateDraft({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        gstRegistrationId: input.gstRegistrationId,
        dueDate: input.dueDate,
        paymentTermsDays: input.paymentTermsDays,
        narrative: input.narrative,
        lines: input.lines ? toLineInputs(input.lines) : undefined,
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  startConversion: requirePermission('invoice.finalize')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.invoices.startConversion({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  finalize: requirePermission('invoice.finalize')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        invoiceDate: dateStringSchema,
        invoiceNumber: z.string().trim().max(16).optional(),
        completesSource: z.boolean().optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.invoices.finalize({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        invoiceDate: input.invoiceDate,
        invoiceNumber: input.invoiceNumber,
        completesSource: input.completesSource,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setCompletesSource: requirePermission('invoice.finalize')
    .input(z.object({ id: z.string().uuid(), completesSource: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.invoices.setCompletesSource({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        completesSource: input.completesSource,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reusableNumbers: requirePermission('invoice.finalize')
    .input(z.object({ id: z.string().uuid(), invoiceDate: dateStringSchema }))
    .query(async ({ ctx, input }) => {
      return ctx.services.invoices.reusableNumbers({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        invoiceDate: input.invoiceDate,
      });
    }),

  void: requirePermission('invoice.void')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        accountingDate: dateStringSchema.optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.invoices.void({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        accountingDate: input.accountingDate,
        canReverseReceipts: ctx.auth.permissions.has('receipt.reverse'),
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  list: requirePermission('invoice.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          projectId: z.string().uuid().optional(),
          status: statusSchema.optional(),
          legalEntityId: z.string().uuid().optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.invoices.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getDetail: requirePermission('invoice.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.invoices.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  listBySource: requirePermission('invoice.read')
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.invoices.listBySource({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getPdf: requirePermission('invoice.export')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.invoices.getPdf({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),
});
