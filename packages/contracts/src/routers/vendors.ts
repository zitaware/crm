import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const paymentTermsSchema = z.enum(['ADVANCE', 'NET_15', 'NET_30', 'NET_45']);

export const vendorsRouter = router({
  list: requirePermission('vendor.read')
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.services.vendors.list({
        organizationId: ctx.auth.user!.organizationId,
        includeInactive: input?.includeInactive,
      });
    }),

  getDetail: requirePermission('vendor.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.vendors.getDetail({ organizationId: ctx.auth.user!.organizationId, id: input.id });
    }),

  checkForDuplicates: requirePermission('vendor.manage')
    .input(
      z.object({
        name: z.string().min(1).max(200),
        gstin: z.string().max(20).optional(),
        panNumber: z.string().max(15).optional(),
        cityId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.vendors.checkForDuplicates({
        organizationId: ctx.auth.user!.organizationId,
        name: input.name,
        gstin: input.gstin,
        panNumber: input.panNumber,
        cityId: input.cityId,
      });
    }),

  create: requirePermission('vendor.manage')
    .input(
      z.object({
        existingPartyId: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        shortCode: z.string().max(50).optional(),
        gstin: z.string().max(20).optional(),
        panNumber: z.string().max(15).optional(),
        paymentTerms: paymentTermsSchema.optional(),
        stateId: z.string().uuid().optional(),
        districtId: z.string().uuid().optional(),
        cityId: z.string().uuid().optional(),
        pinCode: z.string().max(10).optional(),
        officeAddress: z.string().max(2000).optional(),
        internalNote: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.vendors.create({
        organizationId: ctx.auth.user!.organizationId,
        existingPartyId: input.existingPartyId,
        name: input.name,
        shortCode: input.shortCode,
        gstin: input.gstin,
        panNumber: input.panNumber,
        paymentTerms: input.paymentTerms,
        stateId: input.stateId,
        districtId: input.districtId,
        cityId: input.cityId,
        pinCode: input.pinCode,
        officeAddress: input.officeAddress,
        internalNote: input.internalNote,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('vendor.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        shortCode: z.string().max(50).optional(),
        gstin: z.string().max(20).optional(),
        panNumber: z.string().max(15).optional(),
        paymentTerms: paymentTermsSchema.optional(),
        stateId: z.string().uuid().optional(),
        districtId: z.string().uuid().optional(),
        cityId: z.string().uuid().optional(),
        pinCode: z.string().max(10).optional(),
        officeAddress: z.string().max(2000).optional(),
        internalNote: z.string().max(2000).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.vendors.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        shortCode: input.shortCode,
        gstin: input.gstin,
        panNumber: input.panNumber,
        paymentTerms: input.paymentTerms,
        stateId: input.stateId,
        districtId: input.districtId,
        cityId: input.cityId,
        pinCode: input.pinCode,
        officeAddress: input.officeAddress,
        internalNote: input.internalNote,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setActive: requirePermission('vendor.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.vendors.setActive({
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
