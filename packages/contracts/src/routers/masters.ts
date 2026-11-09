import { z } from 'zod';
import { protectedProcedure, requirePermission, router } from '../trpc';

const masterTypeSchema = z.enum([
  'internal_departments',
  'designations',
  'employment_types',
  'government_body_types',
  'client_types',
  'lead_types',
  'lead_sources',
  'tender_portals',
  'project_types',
  'security_instrument_purposes',
  'security_instrument_types',
  'document_categories',
  'expense_categories',
  'units_of_measure',
  'product_categories',
  'allocation_targets',
]);

export const mastersRouter = router({
  getCatalog: requirePermission('master.read').query(async ({ ctx }) => {
    return ctx.services.masters.getCatalog({
      organizationId: ctx.auth.user!.organizationId,
    });
  }),

  // Deliberately protectedProcedure, not requirePermission('master.read') —
  // any authenticated org user needs these to fill out Lead Type/Client
  // Type/Tender Portal/etc. dropdowns on any form they're otherwise
  // permitted to submit. master.read still gates getCatalog and the
  // Masters admin screen itself; master.manage still gates every mutation
  // below. See docs/12-decisions-log.md ADR-059.
  list: protectedProcedure
    .input(z.object({ type: masterTypeSchema, includeInactive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.masters.list({
        organizationId: ctx.auth.user!.organizationId,
        type: input.type,
        includeInactive: input.includeInactive,
      });
    }),

  create: requirePermission('master.manage')
    .input(
      z.object({
        type: masterTypeSchema,
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.masters.create({
        organizationId: ctx.auth.user!.organizationId,
        type: input.type,
        code: input.code,
        name: input.name,
        description: input.description,
        sortOrder: input.sortOrder,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('master.manage')
    .input(
      z.object({
        type: masterTypeSchema,
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).optional(),
        sortOrder: z.number().int().optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.masters.update({
        organizationId: ctx.auth.user!.organizationId,
        type: input.type,
        id: input.id,
        name: input.name,
        description: input.description,
        sortOrder: input.sortOrder,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setActive: requirePermission('master.manage')
    .input(
      z.object({
        type: masterTypeSchema,
        id: z.string().uuid(),
        isActive: z.boolean(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.services.masters.setActive({
        organizationId: ctx.auth.user!.organizationId,
        type: input.type,
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),
});
