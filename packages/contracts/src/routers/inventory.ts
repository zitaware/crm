import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const receiptTypeSchema = z.enum(['OPENING', 'DIRECT']);

export const inventoryRouter = router({
  listStock: requirePermission('inventory.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        search: z.string().max(200).optional(),
        productCategoryId: z.string().uuid().optional(),
        inStockOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.inventory.listStock({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: { search: input.search, productCategoryId: input.productCategoryId, inStockOnly: input.inStockOnly },
      });
    }),

  getItemLedger: requirePermission('inventory.read')
    .input(
      z.object({
        inventoryItemId: z.string().uuid(),
        fromDate: dateStringSchema.optional(),
        toDate: dateStringSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.inventory.getItemLedger({
        organizationId: ctx.auth.user!.organizationId,
        inventoryItemId: input.inventoryItemId,
        fromDate: input.fromDate,
        toDate: input.toDate,
      });
    }),

  listReceipts: requirePermission('inventory.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        receiptType: receiptTypeSchema.optional(),
        status: z.enum(['POSTED', 'REVERSED']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.inventory.listReceipts({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: { receiptType: input.receiptType, status: input.status },
      });
    }),

  getReceiptDetail: requirePermission('inventory.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.inventory.getReceiptDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
      });
    }),

  recordReceipt: requirePermission('inventory.receive')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        receiptType: receiptTypeSchema,
        partyId: z.string().uuid().optional(),
        receivedDate: dateStringSchema,
        invoiceChallanNumber: z.string().max(100).optional(),
        note: z.string().max(1000).optional(),
        lines: z
          .array(
            z.object({
              inventoryItemId: z.string().uuid(),
              quantity: decimalStringSchema,
              unitCostAmount: decimalStringSchema,
            }),
          )
          .min(1),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.inventory.recordReceipt({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        receiptType: input.receiptType,
        partyId: input.partyId,
        receivedDate: input.receivedDate,
        invoiceChallanNumber: input.invoiceChallanNumber,
        note: input.note,
        lines: input.lines,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reverseReceipt: requirePermission('inventory.receive')
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
      return ctx.services.inventory.reverseReceipt({
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

  // -------------------------------------------------- consumption (7.3)

  listConsumptions: requirePermission('inventory.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        projectId: z.string().uuid().optional(),
        status: z.enum(['POSTED', 'REVERSED']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.inventory.listConsumptions({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: { projectId: input.projectId, status: input.status },
      });
    }),

  getConsumptionDetail: requirePermission('inventory.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.inventory.getConsumptionDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
      });
    }),

  /** Server-computed quote for the entry screen — never a reservation, and
   * never re-derived in the browser (CLAUDE.md's no-client-side-accounting
   * rule applied to the weighted average). Gated on `inventory.consume`
   * rather than `inventory.read`: it is part of composing the document. */
  previewConsumption: requirePermission('inventory.consume')
    .input(
      z.object({
        lines: z
          .array(z.object({ inventoryItemId: z.string().uuid(), quantity: decimalStringSchema }))
          .max(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.inventory.previewConsumption({
        organizationId: ctx.auth.user!.organizationId,
        lines: input.lines,
      });
    }),

  recordConsumption: requirePermission('inventory.consume')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        projectId: z.string().uuid(),
        consumedDate: dateStringSchema,
        note: z.string().max(1000).optional(),
        lines: z
          .array(z.object({ inventoryItemId: z.string().uuid(), quantity: decimalStringSchema }))
          .min(1),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.inventory.recordConsumption({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        projectId: input.projectId,
        consumedDate: input.consumedDate,
        note: input.note,
        lines: input.lines,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reverseConsumption: requirePermission('inventory.consume')
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
      return ctx.services.inventory.reverseConsumption({
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
