import { z } from 'zod';
import { requirePermission, requireAnyPermission, router } from '../trpc';
import { throwAppError } from '../errors';

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const amountSchema = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/, 'Must be an amount with at most two decimals.');
const stageSchema = z.enum(['DRAFT', 'WAITING_APPROVAL', 'TO_PAY', 'PART_PAID', 'PAID', 'CLOSED']);

const canSeeAll = (permissions: Set<string>) => permissions.has('project.read_all');
const choicesSchema = z.array(z.object({ rowNumber: z.number().int().min(2), gstSplit: z.enum(['CGST_SGST', 'IGST']) })).max(1000).default([]);

/** Purchases (ADR-176): vendor bills from entry to payment on one screen. */
export const purchasesRouter = router({
  list: requirePermission('vendor_bill.read')
    .input(
      z.object({
        stage: stageSchema.optional(),
        search: z.string().max(200).optional(),
        projectId: z.string().uuid().optional(),
        vendorId: z.string().uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) =>
      ctx.services.purchases.list({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        canSeeAll: canSeeAll(ctx.auth.permissions),
      }),
    ),

  pay: requirePermission('vendor_payment.post')
    .input(
      z.object({
        lines: z
          .array(z.object({ vendorBillId: z.string().uuid(), amount: amountSchema, tdsAmount: amountSchema.optional() }))
          .min(1)
          .max(100),
        bankAccountId: z.string().uuid().optional(),
        cardAccountId: z.string().uuid().optional(),
        paymentModeId: z.string().uuid(),
        paymentDate: dateStringSchema,
        utrReference: z.string().max(200).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }).refine((v) => !!v.bankAccountId !== !!v.cardAccountId, 'Pay from either a bank account or a credit card.'),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.services.purchases.pay({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        canSeeAll: canSeeAll(ctx.auth.permissions),
        correlationId: ctx.correlationId,
      }),
    ),

  // One bill as a register row (ADR-181): approved on entry, so it takes the approve permission; paying takes the payment one too.
  addEntry: requirePermission('vendor_bill.approve')
    .input(
      z.object({
        entry: z.object({
          date: dateStringSchema,
          details: z.string().trim().min(1, 'Details are required.').max(2000),
          vendorId: z.string().uuid(),
          legalEntityId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          expenseCategoryId: z.string().uuid().optional(),
          categoryName: z.string().trim().max(120).optional(),
          amount: amountSchema,
          otherCharges: amountSchema.optional(),
          totalAmount: amountSchema,
          gstSplit: z.enum(['CGST_SGST', 'IGST']).optional(),
          billNumber: z.string().trim().max(100).optional(),
          paidBy: z.string().trim().max(200).optional(),
          invoiceLink: z.string().trim().max(2000).optional(),
          paymentReceiptLink: z.string().trim().max(2000).optional(),
          paymentModeId: z.string().uuid().optional(),
          bankAccountId: z.string().uuid().optional(),
          cardAccountId: z.string().uuid().optional(),
        }),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.entry.paymentModeId && !ctx.auth.permissions.has('vendor_payment.post')) throwAppError('FORBIDDEN', 'Missing permission: vendor_payment.post');
      return ctx.services.purchases.addEntry({
        organizationId: ctx.auth.user!.organizationId,
        entry: input.entry,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: canSeeAll(ctx.auth.permissions),
        correlationId: ctx.correlationId,
      });
    }),

  importSample: requireAnyPermission('vendor_bill.approve', 'vendor_payment.post').query(async ({ ctx }) => ctx.services.purchases.downloadImportSample()),

  // Importing posts bills (and payments), so it takes the approve permission.
  previewImport: requirePermission('vendor_bill.approve')
    .input(z.object({ contentBase64: z.string().min(1).max(4_000_000), choices: choicesSchema }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.purchases.previewImport({
        organizationId: ctx.auth.user!.organizationId,
        contentBase64: input.contentBase64,
        choices: input.choices,
        actorId: ctx.auth.user!.id,
        canSeeAll: canSeeAll(ctx.auth.permissions),
      }),
    ),

  importRows: requirePermission('vendor_bill.approve')
    .input(z.object({ contentBase64: z.string().min(1).max(4_000_000), choices: choicesSchema, idempotencyKey: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.purchases.importRows({
        organizationId: ctx.auth.user!.organizationId,
        contentBase64: input.contentBase64,
        choices: input.choices,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: canSeeAll(ctx.auth.permissions),
        correlationId: ctx.correlationId,
      }),
    ),
});
