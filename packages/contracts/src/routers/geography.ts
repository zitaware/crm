import { z } from 'zod';
import { protectedProcedure, requirePermission, router } from '../trpc';

export const geographyRouter = router({
  getCounts: requirePermission('master.read').query(async ({ ctx }) => {
    return ctx.services.geography.getCounts();
  }),

  // Deliberately protectedProcedure, not requirePermission('master.read') —
  // any authenticated org user needs these to fill out State/District/City
  // fields on any form they're otherwise permitted to submit (Client, Lead,
  // etc.). master.read still gates getCounts and the Masters admin screen
  // itself; master.manage still gates every mutation below. See
  // docs/12-decisions-log.md ADR-059.
  listStates: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.services.geography.listStates(input);
    }),

  listDistricts: protectedProcedure
    .input(z.object({ stateId: z.string().uuid(), includeInactive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.geography.listDistricts(input);
    }),

  listCities: protectedProcedure
    .input(z.object({ districtId: z.string().uuid(), includeInactive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.geography.listCities(input);
    }),

  createState: requirePermission('master.manage')
    .input(
      z.object({
        name: z.string().min(1).max(200),
        code: z.string().min(1).max(20),
        gstStateCode: z.string().min(1).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.geography.createState({
        name: input.name,
        code: input.code,
        gstStateCode: input.gstStateCode,
        actorId: ctx.auth.user!.id,
        organizationId: ctx.auth.user!.organizationId,
        correlationId: ctx.correlationId,
      });
    }),

  updateState: requirePermission('master.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        code: z.string().min(1).max(20).optional(),
        gstStateCode: z.string().min(1).max(10).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.geography.updateState({
        id: input.id,
        name: input.name,
        code: input.code,
        gstStateCode: input.gstStateCode,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        organizationId: ctx.auth.user!.organizationId,
        correlationId: ctx.correlationId,
      });
    }),

  setStateActive: requirePermission('master.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.geography.setStateActive({
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        organizationId: ctx.auth.user!.organizationId,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  createDistrict: requirePermission('master.manage')
    .input(z.object({ stateId: z.string().uuid(), name: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.geography.createDistrict({
        stateId: input.stateId,
        name: input.name,
        actorId: ctx.auth.user!.id,
        organizationId: ctx.auth.user!.organizationId,
        correlationId: ctx.correlationId,
      });
    }),

  updateDistrict: requirePermission('master.manage')
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(200).optional(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.geography.updateDistrict({
        id: input.id,
        name: input.name,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        organizationId: ctx.auth.user!.organizationId,
        correlationId: ctx.correlationId,
      });
    }),

  setDistrictActive: requirePermission('master.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.geography.setDistrictActive({
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        organizationId: ctx.auth.user!.organizationId,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  createCity: requirePermission('master.manage')
    .input(z.object({ districtId: z.string().uuid(), name: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.geography.createCity({
        districtId: input.districtId,
        name: input.name,
        actorId: ctx.auth.user!.id,
        organizationId: ctx.auth.user!.organizationId,
        correlationId: ctx.correlationId,
      });
    }),

  updateCity: requirePermission('master.manage')
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(200).optional(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.geography.updateCity({
        id: input.id,
        name: input.name,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        organizationId: ctx.auth.user!.organizationId,
        correlationId: ctx.correlationId,
      });
    }),

  setCityActive: requirePermission('master.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.geography.setCityActive({
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        organizationId: ctx.auth.user!.organizationId,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),
});
