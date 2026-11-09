import { z } from 'zod';
import { requirePermission, router } from '../trpc';
import { throwAppError } from '../errors';

const contactInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  designation: z.string().max(200).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
});

export const clientsRouter = router({
  list: requirePermission('client.read')
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.services.clients.list({
        organizationId: ctx.auth.user!.organizationId,
        includeInactive: input?.includeInactive,
      });
    }),

  getDetail: requirePermission('client.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.clients.getDetail({ organizationId: ctx.auth.user!.organizationId, id: input.id });
    }),

  create: requirePermission('client.create')
    .input(
      z.object({
        name: z.string().min(1).max(200),
        shortCode: z.string().max(50).optional(),
        clientTypeId: z.string().uuid().optional(),
        department: z.string().max(200).optional(),
        stateId: z.string().uuid().optional(),
        districtId: z.string().uuid().optional(),
        cityId: z.string().uuid().optional(),
        pinCode: z.string().max(10).optional(),
        officeAddress: z.string().max(2000).optional(),
        gstin: z.string().max(50).optional(),
        internalNote: z.string().max(2000).optional(),
        contacts: z.array(contactInputSchema).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.clients.create({
        organizationId: ctx.auth.user!.organizationId,
        name: input.name,
        shortCode: input.shortCode,
        clientTypeId: input.clientTypeId,
        department: input.department,
        stateId: input.stateId,
        districtId: input.districtId,
        cityId: input.cityId,
        pinCode: input.pinCode,
        officeAddress: input.officeAddress,
        gstin: input.gstin,
        internalNote: input.internalNote,
        contacts: input.contacts?.map((contact) => ({
          id: contact.id,
          name: contact.name,
          designation: contact.designation,
          phone: contact.phone,
          email: contact.email,
        })),
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('client.update')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        shortCode: z.string().max(50).optional(),
        clientTypeId: z.string().uuid().optional(),
        department: z.string().max(200).optional(),
        stateId: z.string().uuid().optional(),
        districtId: z.string().uuid().optional(),
        cityId: z.string().uuid().optional(),
        pinCode: z.string().max(10).optional(),
        officeAddress: z.string().max(2000).optional(),
        gstin: z.string().max(50).optional(),
        internalNote: z.string().max(2000).optional(),
        contacts: z.array(contactInputSchema).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.clients.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        shortCode: input.shortCode,
        clientTypeId: input.clientTypeId,
        department: input.department,
        stateId: input.stateId,
        districtId: input.districtId,
        cityId: input.cityId,
        pinCode: input.pinCode,
        officeAddress: input.officeAddress,
        gstin: input.gstin,
        internalNote: input.internalNote,
        contacts: input.contacts?.map((contact) => ({
          id: contact.id,
          name: contact.name,
          designation: contact.designation,
          phone: contact.phone,
          email: contact.email,
        })),
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  // ADR-090: gated by BOTH client.read and the existing project.read_financials
  // (reused, not a new permission) — a genuinely new two-permission pattern
  // for this codebase, inlined here since it's the first and only place two
  // independent permissions are both mandatory on one procedure.
  getFinancialSummary: requirePermission('client.read')
    .use(({ ctx, next }) => {
      if (!ctx.auth.permissions.has('project.read_financials')) {
        throwAppError('FORBIDDEN', 'Missing permission: project.read_financials');
      }
      return next({ ctx });
    })
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.projectFinancials.getClientFinancialSummary({
        organizationId: ctx.auth.user!.organizationId,
        clientId: input.id,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
      });
    }),

  setActive: requirePermission('client.update')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.clients.setActive({
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
