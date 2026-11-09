import { z } from 'zod';
import { requirePermission, router } from '../trpc';

export const chartOfAccountsRouter = router({
  listGroups: requirePermission('chart_of_account.read')
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.services.chartOfAccounts.listGroups({
        organizationId: ctx.auth.user!.organizationId,
        includeInactive: input?.includeInactive,
      });
    }),

  createGroup: requirePermission('chart_of_account.manage')
    .input(
      z.object({
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        parentGroupId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.chartOfAccounts.createGroup({
        organizationId: ctx.auth.user!.organizationId,
        code: input.code,
        name: input.name,
        description: input.description,
        parentGroupId: input.parentGroupId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  updateGroup: requirePermission('chart_of_account.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        parentGroupId: z.string().uuid().optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.chartOfAccounts.updateGroup({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        description: input.description,
        parentGroupId: input.parentGroupId,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setGroupActive: requirePermission('chart_of_account.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.chartOfAccounts.setGroupActive({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  listAccounts: requirePermission('chart_of_account.read')
    .input(z.object({ accountGroupId: z.string().uuid().optional(), includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.services.chartOfAccounts.listAccounts({
        organizationId: ctx.auth.user!.organizationId,
        accountGroupId: input?.accountGroupId,
        includeInactive: input?.includeInactive,
      });
    }),

  createAccount: requirePermission('chart_of_account.manage')
    .input(
      z.object({
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        accountGroupId: z.string().uuid(),
        allowManualPosting: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.chartOfAccounts.createAccount({
        organizationId: ctx.auth.user!.organizationId,
        code: input.code,
        name: input.name,
        description: input.description,
        accountGroupId: input.accountGroupId,
        allowManualPosting: input.allowManualPosting,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  updateAccount: requirePermission('chart_of_account.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        accountGroupId: z.string().uuid().optional(),
        allowManualPosting: z.boolean().optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.chartOfAccounts.updateAccount({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        description: input.description,
        accountGroupId: input.accountGroupId,
        allowManualPosting: input.allowManualPosting,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setAccountActive: requirePermission('chart_of_account.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.chartOfAccounts.setAccountActive({
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
