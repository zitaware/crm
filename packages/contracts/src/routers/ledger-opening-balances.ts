import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^-?\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');

export const ledgerOpeningBalancesRouter = router({
  set: requirePermission('ledger_opening_balance.set')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        ledgerAccountId: z.string().uuid(),
        asOfDate: dateStringSchema,
        amount: decimalStringSchema,
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.ledgerOpeningBalances.set({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        ledgerAccountId: input.ledgerAccountId,
        asOfDate: input.asOfDate,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  void: requirePermission('ledger_opening_balance.set')
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().min(1).max(1000),
        accountingDate: dateStringSchema,
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.ledgerOpeningBalances.void({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        reason: input.reason,
        accountingDate: input.accountingDate,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  getForAccount: requirePermission('journal.read')
    .input(z.object({ legalEntityId: z.string().uuid(), ledgerAccountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.ledgerOpeningBalances.getForAccount({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        ledgerAccountId: input.ledgerAccountId,
      });
    }),
});
