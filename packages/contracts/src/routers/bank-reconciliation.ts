import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const column = z.string().trim().max(200);
const signedMoney = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Must be an amount with at most 2 decimals.');
const optionalColumn = column.optional().transform((v) => v || undefined);
const csv = z.object({
  bankAccountId: z.string().uuid(),
  fileName: z.string().max(300),
  headers: z.array(z.string().max(500)).min(1).max(100),
  rows: z.array(z.array(z.string().max(2000)).max(100)).min(1).max(5000),
});

// Reading needs bank_reconciliation.read; importing, matching and marking
// exceptions need .manage; approving an exception needs .approve (ADR-114).
export const bankReconciliationRouter = router({
  getProfile: requirePermission('bank_reconciliation.read')
    .input(z.object({ bankAccountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => ctx.services.bankReconciliation.getProfile({ organizationId: ctx.auth.user!.organizationId, bankAccountId: input.bankAccountId })),

  saveProfile: requirePermission('bank_reconciliation.manage')
    .input(
      z.object({
        bankAccountId: z.string().uuid(),
        expectedVersion: z.number().int().optional(),
        dateColumn: column.min(1),
        dateFormat: z.enum(['YYYY_MM_DD', 'DD_MM_YYYY_SLASH', 'DD_MM_YYYY_DASH', 'DD_MMM_YYYY', 'MM_DD_YYYY_SLASH']),
        descriptionColumn: column.min(1),
        referenceColumn: optionalColumn,
        amountMode: z.enum(['DEBIT_CREDIT_COLUMNS', 'SIGNED_AMOUNT', 'AMOUNT_WITH_INDICATOR']),
        debitColumn: optionalColumn,
        creditColumn: optionalColumn,
        amountColumn: optionalColumn,
        indicatorColumn: optionalColumn,
        creditIndicator: optionalColumn,
        balanceColumn: optionalColumn,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.saveProfile({
        organizationId: ctx.auth.user!.organizationId,
        bankAccountId: input.bankAccountId,
        expectedVersion: input.expectedVersion,
        dateColumn: input.dateColumn,
        dateFormat: input.dateFormat,
        descriptionColumn: input.descriptionColumn,
        referenceColumn: input.referenceColumn,
        amountMode: input.amountMode,
        debitColumn: input.debitColumn,
        creditColumn: input.creditColumn,
        amountColumn: input.amountColumn,
        indicatorColumn: input.indicatorColumn,
        creditIndicator: input.creditIndicator,
        balanceColumn: input.balanceColumn,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      }),
    ),

  previewImport: requirePermission('bank_reconciliation.manage')
    .input(csv)
    .mutation(async ({ ctx, input }) => ctx.services.bankReconciliation.previewImport({ organizationId: ctx.auth.user!.organizationId, ...input })),

  importStatement: requirePermission('bank_reconciliation.manage')
    .input(csv)
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.importStatement({ organizationId: ctx.auth.user!.organizationId, ...input, actorId: ctx.auth.user!.id, correlationId: ctx.correlationId }),
    ),

  getWorkspace: requirePermission('bank_reconciliation.read')
    .input(z.object({ bankAccountId: z.string().uuid(), from: dateString, to: dateString }))
    .query(async ({ ctx, input }) => ctx.services.bankReconciliation.getWorkspace({ organizationId: ctx.auth.user!.organizationId, ...input })),

  matchSelected: requirePermission('bank_reconciliation.manage')
    .input(z.object({ bankAccountId: z.string().uuid(), statementLineIds: z.array(z.string().uuid()).min(1).max(200), journalLineIds: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.matchSelected({ organizationId: ctx.auth.user!.organizationId, ...input, actorId: ctx.auth.user!.id, correlationId: ctx.correlationId }),
    ),

  autoMatch: requirePermission('bank_reconciliation.manage')
    .input(z.object({ bankAccountId: z.string().uuid(), from: dateString, to: dateString }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.autoMatch({ organizationId: ctx.auth.user!.organizationId, ...input, actorId: ctx.auth.user!.id, correlationId: ctx.correlationId }),
    ),

  unmatchStatementLine: requirePermission('bank_reconciliation.manage')
    .input(z.object({ statementLineId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.unmatchStatementLine({ organizationId: ctx.auth.user!.organizationId, ...input, actorId: ctx.auth.user!.id, correlationId: ctx.correlationId }),
    ),

  markException: requirePermission('bank_reconciliation.manage')
    .input(z.object({ statementLineId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.markException({ organizationId: ctx.auth.user!.organizationId, ...input, actorId: ctx.auth.user!.id, correlationId: ctx.correlationId }),
    ),

  approveException: requirePermission('bank_reconciliation.approve')
    .input(z.object({ statementLineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.approveException({ organizationId: ctx.auth.user!.organizationId, ...input, actorId: ctx.auth.user!.id, correlationId: ctx.correlationId }),
    ),

  getStatement: requirePermission('bank_reconciliation.read')
    .input(z.object({ bankAccountId: z.string().uuid(), month: z.string().regex(/^\d{4}-\d{2}$/), statementOpeningBalance: signedMoney.optional(), statementClosingBalance: signedMoney.optional() }))
    .query(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.getStatement({
        organizationId: ctx.auth.user!.organizationId,
        bankAccountId: input.bankAccountId,
        month: input.month,
        statementOpeningBalance: input.statementOpeningBalance,
        statementClosingBalance: input.statementClosingBalance,
      }),
    ),

  listPeriods: requirePermission('bank_reconciliation.read')
    .input(z.object({ bankAccountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => ctx.services.bankReconciliation.listPeriods({ organizationId: ctx.auth.user!.organizationId, bankAccountId: input.bankAccountId })),

  markReconciled: requirePermission('bank_reconciliation.manage')
    .input(z.object({ bankAccountId: z.string().uuid(), month: z.string().regex(/^\d{4}-\d{2}$/), statementOpeningBalance: signedMoney.optional(), statementClosingBalance: signedMoney }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.markReconciled({
        organizationId: ctx.auth.user!.organizationId,
        bankAccountId: input.bankAccountId,
        month: input.month,
        statementOpeningBalance: input.statementOpeningBalance,
        statementClosingBalance: input.statementClosingBalance,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      }),
    ),

  // Locking is the final sign-off, so it needs the approve key, and the service refuses the person who reconciled the month.
  lockPeriod: requirePermission('bank_reconciliation.approve')
    .input(z.object({ bankAccountId: z.string().uuid(), month: z.string().regex(/^\d{4}-\d{2}$/), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.lockPeriod({ organizationId: ctx.auth.user!.organizationId, ...input, actorId: ctx.auth.user!.id, correlationId: ctx.correlationId }),
    ),

  clearException: requirePermission('bank_reconciliation.manage')
    .input(z.object({ statementLineId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.bankReconciliation.clearException({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
        // Clearing an approved exception undoes an approval, so it needs the approve key too.
        canApprove: ctx.auth.permissions.has('bank_reconciliation.approve'),
      }),
    ),
});
