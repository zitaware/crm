import { z } from 'zod';
import { requirePermission, router } from '../trpc';
import { throwAppError } from '../errors';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const rateStringSchema = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Must be a valid percentage.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const statusSchema = z.enum(['DRAFT', 'POSTED', 'CANCELLED', 'REVERSED']);
const supplyTypeSchema = z.enum(['INTRASTATE', 'INTERSTATE']);
const spendTypeSchema = z.enum(['SERVER', 'SUBSCRIPTION']);
const billUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .regex(/^https?:\/\/\S+$/i, 'Bill link must be a web address starting with https://.');

const writeFieldsSchema = z.object({
  expenseCategoryId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  title: z.string().min(1).max(300).optional(),
  projectId: z.string().uuid().optional(),
  legalEntityId: z.string().uuid().optional(),
  taxableAmount: decimalStringSchema.optional(),
  expenseDate: dateStringSchema.optional(),
  gstInvoiceAvailable: z.boolean().optional(),
  gstRatePercent: rateStringSchema.optional(),
  supplyType: supplyTypeSchema.optional(),
  itcEligible: z.boolean().optional(),
  tdsAmount: decimalStringSchema.optional(),
  tdsRatePercent: rateStringSchema.optional(),
  paymentModeId: z.string().uuid().optional(),
  bankAccountId: z.string().uuid().optional(),
  cardAccountId: z.string().uuid().optional(),
  transactionReference: z.string().max(200).optional(),
  purchasedByEmployeeId: z.string().uuid().optional(),
  note: z.string().max(1000).optional(),
  spendType: spendTypeSchema.nullable().optional(),
  billUrl: billUrlSchema.nullable().optional(),
});

// createDraft/createAndPostDraft require the fields updateDraft treats as
// optional overrides -- re-declared (not `.required()`'d from
// writeFieldsSchema) so each field keeps its own specific validator.
const createFieldsSchema = z.object({
  expenseCategoryId: z.string().uuid(),
  vendorId: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  projectId: z.string().uuid().optional(),
  legalEntityId: z.string().uuid().optional(),
  taxableAmount: decimalStringSchema,
  expenseDate: dateStringSchema,
  gstInvoiceAvailable: z.boolean(),
  gstRatePercent: rateStringSchema.optional(),
  supplyType: supplyTypeSchema.optional(),
  itcEligible: z.boolean().optional(),
  tdsAmount: decimalStringSchema.optional(),
  tdsRatePercent: rateStringSchema.optional(),
  paymentModeId: z.string().uuid(),
  bankAccountId: z.string().uuid().optional(),
  cardAccountId: z.string().uuid().optional(),
  transactionReference: z.string().max(200).optional(),
  purchasedByEmployeeId: z.string().uuid().optional(),
  note: z.string().max(1000).optional(),
  spendType: spendTypeSchema.optional(),
  billUrl: billUrlSchema.optional(),
});

const importChoiceSchema = z.object({
  rowNumber: z.number().int().min(2),
  employeeId: z.string().uuid().optional(),
  supplyType: supplyTypeSchema.optional(),
});

const entrySchema = z.object({
  spendType: spendTypeSchema,
  title: z.string().trim().min(1).max(300),
  employeeId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  expenseCategoryId: z.string().uuid().optional(),
  expenseDate: dateStringSchema,
  basicAmount: decimalStringSchema,
  gstAmount: decimalStringSchema.optional(),
  supplyType: supplyTypeSchema.optional(),
  paymentModeId: z.string().uuid(),
  cardAccountId: z.string().uuid().optional(),
  bankAccountId: z.string().uuid().optional(),
  transactionReference: z.string().max(200).optional(),
  note: z.string().max(1000).optional(),
  billUrl: billUrlSchema.optional(),
});

export const directExpensesRouter = router({
  createDraft: requirePermission('direct_expense.create')
    .input(createFieldsSchema.extend({ idempotencyKey: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.directExpenses.createDraft({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  updateDraft: requirePermission('direct_expense.create')
    .input(writeFieldsSchema.extend({ id: z.string().uuid(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.directExpenses.updateDraft({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  cancelDraft: requirePermission('direct_expense.create')
    .input(z.object({ id: z.string().uuid(), expectedVersion: z.number().int(), reason: z.string().min(1).max(1000), idempotencyKey: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.directExpenses.cancelDraft({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  post: requirePermission('direct_expense.post')
    .input(z.object({ id: z.string().uuid(), expectedVersion: z.number().int(), idempotencyKey: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.directExpenses.post({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reverse: requirePermission('direct_expense.reverse')
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
      return ctx.services.directExpenses.reverse({
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

  list: requirePermission('direct_expense.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          expenseCategoryId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          status: statusSchema.optional(),
          expenseDateFrom: dateStringSchema.optional(),
          expenseDateTo: dateStringSchema.optional(),
          spendType: z.union([spendTypeSchema, z.literal('ANY')]).optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.directExpenses.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
      });
    }),

  // Server & Subscription Excel import (ADR-169). Each row posts, so it
  // takes the post permission.
  importSample: requirePermission('direct_expense.post').query(async ({ ctx }) => ctx.services.serverSubscriptionImports.downloadSample()),

  previewImport: requirePermission('direct_expense.post')
    .input(z.object({ contentBase64: z.string().min(1).max(4_000_000), choices: z.array(importChoiceSchema).max(500).default([]) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.serverSubscriptionImports.preview({
        organizationId: ctx.auth.user!.organizationId,
        contentBase64: input.contentBase64,
        choices: input.choices,
      });
    }),

  importRows: requirePermission('direct_expense.post')
    .input(
      z.object({
        contentBase64: z.string().min(1).max(4_000_000),
        choices: z.array(importChoiceSchema).max(500).default([]),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.serverSubscriptionImports.importRows({
        organizationId: ctx.auth.user!.organizationId,
        contentBase64: input.contentBase64,
        choices: input.choices,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  createEntry: requirePermission('direct_expense.post')
    .input(z.object({ entry: entrySchema, idempotencyKey: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.serverSubscriptionImports.createEntry({
        organizationId: ctx.auth.user!.organizationId,
        entry: input.entry,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  // A correction reverses and posts, so it needs both permissions.
  correctEntry: requirePermission('direct_expense.reverse')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().trim().min(1).max(1000),
        reversalDate: dateStringSchema,
        entry: entrySchema,
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.auth.permissions.has('direct_expense.post')) throwAppError('FORBIDDEN', 'Missing permission: direct_expense.post');
      return ctx.services.serverSubscriptionImports.correctEntry({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  getDetail: requirePermission('direct_expense.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.directExpenses.getDetail({ organizationId: ctx.auth.user!.organizationId, id: input.id });
    }),
});
