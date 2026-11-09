import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');

const filtersSchema = z.object({
  legalEntityId: z.string().uuid().optional(),
  sourceType: z.string().max(100).optional(),
  dateFrom: dateStringSchema.optional(),
  dateTo: dateStringSchema.optional(),
});

// No postJournal procedure — posting occurs only at approved business
// events (docs/06), called by other backend services directly, never by
// an end user. reverseJournal (ADR-067) is the one deliberate exception:
// unlike ordinary posting, a reversal IS a direct, human-triggered
// correction action (docs/04: "Correction actions must request a
// reason") — every other procedure here stays read-only.
export const journalRouter = router({
  listEntries: requirePermission('journal.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: filtersSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.journal.listEntries({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
      });
    }),

  getEntryDetail: requirePermission('journal.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.journal.getEntryDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
      });
    }),

  getLedgerActivity: requirePermission('journal.read')
    .input(
      z.object({
        ledgerAccountId: z.string().uuid(),
        legalEntityId: z.string().uuid().optional(),
        dateFrom: dateStringSchema.optional(),
        dateTo: dateStringSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.journal.getLedgerActivity({
        organizationId: ctx.auth.user!.organizationId,
        ledgerAccountId: input.ledgerAccountId,
        legalEntityId: input.legalEntityId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      });
    }),

  reverseJournal: requirePermission('journal.reverse')
    .input(
      z.object({
        id: z.string().uuid(),
        accountingDate: dateStringSchema,
        reason: z.string().min(1).max(2000),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.journal.reverseJournal({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        accountingDate: input.accountingDate,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),
});
