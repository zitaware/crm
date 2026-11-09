import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const accountingPeriodActionSchema = z.enum(['SOFT_CLOSE', 'LOCK', 'REOPEN']);

export const financialYearsRouter = router({
  list: requirePermission('financial_year.read')
    .input(z.object({ legalEntityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.financialYears.list({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
      });
    }),

  create: requirePermission('financial_year.manage')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        label: z.string().min(1).max(50),
        startDate: z.string().date(),
        endDate: z.string().date(),
        setCurrent: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.financialYears.create({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        label: input.label,
        startDate: input.startDate,
        endDate: input.endDate,
        setCurrent: input.setCurrent ?? false,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setCurrentFinancialYear: requirePermission('financial_year.manage')
    .input(z.object({ legalEntityId: z.string().uuid(), id: z.string().uuid(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.financialYears.setCurrentFinancialYear({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  listAccountingPeriods: requirePermission('financial_year.read')
    .input(z.object({ financialYearId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.financialYears.listAccountingPeriods({
        organizationId: ctx.auth.user!.organizationId,
        financialYearId: input.financialYearId,
      });
    }),

  transitionAccountingPeriod: requirePermission('accounting_period.lock')
    .input(
      z.object({
        accountingPeriodId: z.string().uuid(),
        action: accountingPeriodActionSchema,
        reason: z.string().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.financialYears.transitionAccountingPeriod({
        organizationId: ctx.auth.user!.organizationId,
        accountingPeriodId: input.accountingPeriodId,
        action: input.action,
        reason: input.reason,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  listAccountingPeriodTransitions: requirePermission('financial_year.read')
    .input(z.object({ accountingPeriodId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.financialYears.listAccountingPeriodTransitions({
        organizationId: ctx.auth.user!.organizationId,
        accountingPeriodId: input.accountingPeriodId,
      });
    }),
});
