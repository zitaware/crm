import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');

export const cardSettlementsRouter = router({
  settleCreditCard: requirePermission('card_account.settle')
    .input(
      z.object({
        cardAccountId: z.string().uuid(),
        amount: decimalStringSchema,
        settlementDate: dateStringSchema,
        bankAccountId: z.string().uuid(),
        transactionReference: z.string().max(200).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.cardSettlements.settleCreditCard({
        organizationId: ctx.auth.user!.organizationId,
        cardAccountId: input.cardAccountId,
        amount: input.amount,
        settlementDate: input.settlementDate,
        bankAccountId: input.bankAccountId,
        transactionReference: input.transactionReference,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  listByCardAccount: requirePermission('legal_entity.read')
    .input(z.object({ cardAccountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.cardSettlements.listByCardAccount({
        organizationId: ctx.auth.user!.organizationId,
        cardAccountId: input.cardAccountId,
      });
    }),

  getOutstandingBalance: requirePermission('legal_entity.read')
    .input(z.object({ cardAccountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const outstandingBalance = await ctx.services.cardSettlements.getOutstandingBalance({
        organizationId: ctx.auth.user!.organizationId,
        cardAccountId: input.cardAccountId,
      });
      return { outstandingBalance };
    }),
});
