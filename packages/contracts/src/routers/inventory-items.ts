import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');

export const inventoryItemsRouter = router({
  getCount: requirePermission('inventory_item.read').query(async ({ ctx }) => {
    return ctx.services.inventoryItems.getCount({ organizationId: ctx.auth.user!.organizationId });
  }),

  list: requirePermission('inventory_item.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        search: z.string().max(200).optional(),
        productCategoryId: z.string().uuid().optional(),
        isStockTracked: z.boolean().optional(),
        includeInactive: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.inventoryItems.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: {
          search: input.search,
          productCategoryId: input.productCategoryId,
          isStockTracked: input.isStockTracked,
          includeInactive: input.includeInactive,
        },
      });
    }),

  getDetail: requirePermission('inventory_item.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.inventoryItems.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
      });
    }),

  create: requirePermission('inventory_item.manage')
    .input(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        unitOfMeasureId: z.string().uuid(),
        productCategoryId: z.string().uuid().optional(),
        hsnSac: z.string().max(20).optional(),
        defaultRateAmount: decimalStringSchema.optional(),
        isStockTracked: z.boolean().default(true),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.inventoryItems.create({
        organizationId: ctx.auth.user!.organizationId,
        name: input.name,
        description: input.description,
        unitOfMeasureId: input.unitOfMeasureId,
        productCategoryId: input.productCategoryId,
        hsnSac: input.hsnSac,
        defaultRateAmount: input.defaultRateAmount,
        isStockTracked: input.isStockTracked,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('inventory_item.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).optional(),
        unitOfMeasureId: z.string().uuid().optional(),
        productCategoryId: z.string().uuid().optional(),
        hsnSac: z.string().max(20).optional(),
        defaultRateAmount: decimalStringSchema.optional(),
        isStockTracked: z.boolean().optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.inventoryItems.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        description: input.description,
        unitOfMeasureId: input.unitOfMeasureId,
        productCategoryId: input.productCategoryId,
        hsnSac: input.hsnSac,
        defaultRateAmount: input.defaultRateAmount,
        isStockTracked: input.isStockTracked,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setActive: requirePermission('inventory_item.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.inventoryItems.setActive({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),
});
