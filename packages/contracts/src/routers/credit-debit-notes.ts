import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const typeSchema = z.enum(['CREDIT', 'DEBIT']);
const statusSchema = z.enum(['DRAFT', 'FINALIZED', 'VOID']);

const lineInputSchema = z.object({
  description: z.string().min(1).max(500),
  hsnSac: z.string().max(20).optional(),
  quantity: decimalStringSchema,
  unitPrice: decimalStringSchema,
  gstRatePercent: decimalStringSchema,
});

function toLineInputs(lines: z.infer<typeof lineInputSchema>[]) {
  return lines.map((line) => ({
    description: line.description,
    hsnSac: line.hsnSac,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    gstRatePercent: line.gstRatePercent,
  }));
}

function withCanSeeAll<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('project.read_all');
}

export const creditDebitNotesRouter = router({
  createDraft: requirePermission('credit_debit_note.create')
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        type: typeSchema,
        reason: z.string().min(1).max(1000),
        lines: z.array(lineInputSchema).min(1),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.creditDebitNotes.createDraft({
        organizationId: ctx.auth.user!.organizationId,
        invoiceId: input.invoiceId,
        type: input.type,
        reason: input.reason,
        lines: toLineInputs(input.lines),
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  updateDraft: requirePermission('credit_debit_note.update')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000).optional(),
        lines: z.array(lineInputSchema).min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.creditDebitNotes.updateDraft({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        lines: input.lines ? toLineInputs(input.lines) : undefined,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  finalize: requirePermission('credit_debit_note.finalize')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.creditDebitNotes.finalize({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  void: requirePermission('credit_debit_note.void')
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
      return ctx.services.creditDebitNotes.void({
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

  list: requirePermission('credit_debit_note.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          invoiceId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          type: typeSchema.optional(),
          status: statusSchema.optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.creditDebitNotes.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getDetail: requirePermission('credit_debit_note.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.creditDebitNotes.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),
});
