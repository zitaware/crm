import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');

/** Money crosses the wire as a string and is parsed with Decimal, never
 * coerced through a JS number. */
const amountSchema = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be an amount with at most two decimals.');

/**
 * Rows come straight off the uploaded sheet, so the amount is accepted as a
 * loose string here and classified by the service rather than rejected by
 * the schema: a badly typed cell must surface as one flagged row the
 * accountant can see and fix, not as a 400 that hides every other row.
 */
const rowSchema = z.object({
  employeeCode: z.string().max(100),
  employeeName: z.string().max(300).optional(),
  grossSalaryAmount: z.string().max(40),
});

export const salaryImportsRouter = router({
  list: requirePermission('salary_import.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        legalEntityId: z.string().uuid().optional(),
        status: z.enum(['DRAFT', 'POSTED', 'REVERSED']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.salaryImports.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: { legalEntityId: input.legalEntityId, status: input.status },
      });
    }),

  getDetail: requirePermission('salary_import.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.salaryImports.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
      });
    }),

  /** Read-only dry run. A mutation in shape (it takes the whole sheet) but a
   * query in effect — it writes nothing, so it is declared as one. */
  preview: requirePermission('salary_import.create')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        salaryMonth: dateStringSchema,
        rows: z.array(rowSchema).max(2000),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.salaryImports.preview({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        salaryMonth: input.salaryMonth,
        rows: input.rows.map((r) => ({ ...r, employeeName: r.employeeName })),
      });
    }),

  /** Generate this month's draft from the salary revisions on record. */
  generateDraft: requirePermission('salary_import.create')
    .input(z.object({ legalEntityId: z.string().uuid(), salaryMonth: dateStringSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.salaryImports.generateDraft({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        salaryMonth: input.salaryMonth,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  /** Replace a draft's rows from an uploaded sheet or hand edits. */
  replaceDraftRows: requirePermission('salary_import.create')
    .input(
      z.object({
        id: z.string().uuid(),
        sourceFileName: z.string().max(300).optional(),
        rows: z.array(rowSchema).min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.salaryImports.replaceDraftRows({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        sourceFileName: input.sourceFileName,
        rows: input.rows.map((r) => ({ ...r, employeeName: r.employeeName })),
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  discardDraft: requirePermission('salary_import.create')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.salaryImports.discardDraft({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  commit: requirePermission('salary_import.commit')
    .input(
      z.object({
        id: z.string().uuid(),
        accountingDate: dateStringSchema,
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.salaryImports.commit({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        accountingDate: input.accountingDate,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  /**
   * Settle a posted month (ADR-100). `salary_import.pay` is separate from
   * `salary_import.commit`: committing recognises a cost, this moves money
   * out of a bank account.
   */
  pay: requirePermission('salary_import.pay')
    .input(
      z.object({
        salaryImportId: z.string().uuid(),
        bankAccountId: z.string().uuid(),
        paymentDate: dateStringSchema,
        paymentModeId: z.string().uuid().optional(),
        referenceNumber: z.string().max(200).optional(),
        // Money arrives as a string and is parsed with Decimal by the
        // service — never coerced through a JS number.
        // One entry per employee. Header totals are derived server-side from
        // these, so the client never sends a total that could disagree with
        // its own lines.
        lines: z
          .array(
            z.object({
              employeeId: z.string().uuid(),
              paidAmount: amountSchema,
              tdsAmount: amountSchema.default('0'),
              referenceNumber: z.string().max(200).optional(),
            }),
          )
          .min(1, 'At least one employee must be paid.')
          .max(2000),
        narrative: z.string().max(1000).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.salaryImports.pay({
        organizationId: ctx.auth.user!.organizationId,
        salaryImportId: input.salaryImportId,
        bankAccountId: input.bankAccountId,
        paymentDate: input.paymentDate,
        paymentModeId: input.paymentModeId,
        referenceNumber: input.referenceNumber,
        lines: input.lines.map((l) => ({ ...l, referenceNumber: l.referenceNumber })),
        narrative: input.narrative,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reversePayment: requirePermission('salary_import.pay')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        accountingDate: dateStringSchema,
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.salaryImports.reversePayment({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        accountingDate: input.accountingDate,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  listPayments: requirePermission('salary_import.read')
    .input(z.object({ salaryImportId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.salaryImports.listPayments({
        organizationId: ctx.auth.user!.organizationId,
        salaryImportId: input.salaryImportId,
      });
    }),

  reverse: requirePermission('salary_import.commit')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        accountingDate: dateStringSchema,
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.salaryImports.reverse({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        accountingDate: input.accountingDate,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),
});
