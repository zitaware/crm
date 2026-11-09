import { z } from 'zod';
import { requirePermission, router } from '../trpc';

export const documentSupportRouter = router({
  listEntityTypes: requirePermission('master.read').query(async ({ ctx }) => {
    return ctx.services.documentSupport.listEntityTypes();
  }),

  listDocumentCategoryEntityTypes: requirePermission('master.read')
    .input(z.object({ documentCategoryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.documentSupport.listDocumentCategoryEntityTypes({
        documentCategoryId: input.documentCategoryId,
      });
    }),

  setDocumentCategoryEntityTypes: requirePermission('master.manage')
    .input(z.object({ documentCategoryId: z.string().uuid(), entityTypeCodes: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.documentSupport.setDocumentCategoryEntityTypes({
        organizationId: ctx.auth.user!.organizationId,
        documentCategoryId: input.documentCategoryId,
        entityTypeCodes: input.entityTypeCodes,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  listPenaltyCategories: requirePermission('master.read')
    .input(z.object({ includeInactive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.documentSupport.listPenaltyCategories({
        organizationId: ctx.auth.user!.organizationId,
        includeInactive: input.includeInactive,
      });
    }),

  createPenaltyCategory: requirePermission('master.manage')
    .input(
      z.object({
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        basisType: z.string().max(50).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.documentSupport.createPenaltyCategory({
        organizationId: ctx.auth.user!.organizationId,
        code: input.code,
        name: input.name,
        description: input.description,
        basisType: input.basisType,
        sortOrder: input.sortOrder,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  updatePenaltyCategory: requirePermission('master.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).optional(),
        basisType: z.string().max(50).optional(),
        sortOrder: z.number().int().optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.documentSupport.updatePenaltyCategory({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        description: input.description,
        basisType: input.basisType,
        sortOrder: input.sortOrder,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setPenaltyCategoryActive: requirePermission('master.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.documentSupport.setPenaltyCategoryActive({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  listPaymentModes: requirePermission('master.read')
    .input(z.object({ includeInactive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.documentSupport.listPaymentModes({ includeInactive: input.includeInactive });
    }),

  updatePaymentMode: requirePermission('master.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        label: z.string().min(1).max(100).optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.documentSupport.updatePaymentMode({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        label: input.label,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),
});
