import { z } from 'zod';
import { protectedProcedure, requireAnyPermission, requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const monthStringSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Must be a month in YYYY-MM format.');
const advanceStatusSchema = z.enum(['POSTED', 'REVERSED']);
const claimStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'REIMBURSED']);

function withSelfApprove<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('employee_claim.self_approve');
}
function withClaimReadPermission<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('employee_claim.read');
}
function withClaimApprovePermission<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('employee_claim.approve');
}

export const employeeExpensesRouter = router({
  getMyEmployeeStatus: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.employeeExpenses.getMyEmployeeStatus({
      organizationId: ctx.auth.user!.organizationId,
      actorId: ctx.auth.user!.id,
    });
  }),

  getMyWalletStatement: protectedProcedure
    .input(z.object({ month: monthStringSchema }))
    .query(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.getMyWalletStatement({
        organizationId: ctx.auth.user!.organizationId,
        actorId: ctx.auth.user!.id,
        month: input.month,
      });
    }),

  getMyClaims: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.employeeExpenses.getMyClaims({
      organizationId: ctx.auth.user!.organizationId,
      actorId: ctx.auth.user!.id,
    });
  }),

  calculateAdvanceWalletImpact: requirePermission('employee_advance.create')
    .input(z.object({ employeeId: z.string().uuid(), amount: decimalStringSchema }))
    .query(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.calculateAdvanceWalletImpact({
        organizationId: ctx.auth.user!.organizationId,
        employeeId: input.employeeId,
        amount: input.amount,
      });
    }),

  issueAdvance: requirePermission('employee_advance.create')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        legalEntityId: z.string().uuid().optional(),
        amount: decimalStringSchema,
        advanceDate: dateStringSchema,
        paymentModeId: z.string().uuid(),
        bankAccountId: z.string().uuid(),
        utrReference: z.string().max(200).optional(),
        purpose: z.string().max(200).optional(),
        note: z.string().max(1000).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.issueAdvance({
        organizationId: ctx.auth.user!.organizationId,
        employeeId: input.employeeId,
        projectId: input.projectId,
        legalEntityId: input.legalEntityId,
        amount: input.amount,
        advanceDate: input.advanceDate,
        paymentModeId: input.paymentModeId,
        bankAccountId: input.bankAccountId,
        utrReference: input.utrReference,
        purpose: input.purpose,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reverseAdvance: requirePermission('employee_advance.reverse')
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
      return ctx.services.employeeExpenses.reverseAdvance({
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

  listAdvances: requirePermission('employee_advance.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          employeeId: z.string().uuid().optional(),
          legalEntityId: z.string().uuid().optional(),
          status: advanceStatusSchema.optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.listAdvances({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
      });
    }),

  getAdvanceDetail: requirePermission('employee_advance.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.getAdvanceDetail({ organizationId: ctx.auth.user!.organizationId, id: input.id });
    }),

  createClaimDraft: requirePermission('employee_claim.create')
    .input(
      z.object({
        employeeId: z.string().uuid().optional(),
        expenseCategoryId: z.string().uuid(),
        title: z.string().min(1).max(300),
        projectId: z.string().uuid().optional(),
        legalEntityId: z.string().uuid().optional(),
        amount: decimalStringSchema,
        expenseDate: dateStringSchema,
        gstInvoiceAvailable: z.boolean(),
        gstCreditAmount: decimalStringSchema.optional(),
        note: z.string().max(1000).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.createClaimDraft({
        organizationId: ctx.auth.user!.organizationId,
        employeeId: input.employeeId,
        expenseCategoryId: input.expenseCategoryId,
        title: input.title,
        projectId: input.projectId,
        legalEntityId: input.legalEntityId,
        amount: input.amount,
        expenseDate: input.expenseDate,
        gstInvoiceAvailable: input.gstInvoiceAvailable,
        gstCreditAmount: input.gstCreditAmount,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        hasApprovePermission: withClaimApprovePermission(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  updateClaimDraft: requirePermission('employee_claim.create')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        expenseCategoryId: z.string().uuid().optional(),
        title: z.string().min(1).max(300).optional(),
        projectId: z.string().uuid().optional(),
        legalEntityId: z.string().uuid().optional(),
        amount: decimalStringSchema.optional(),
        expenseDate: dateStringSchema.optional(),
        gstInvoiceAvailable: z.boolean().optional(),
        gstCreditAmount: decimalStringSchema.optional(),
        note: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.updateClaimDraft({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        expenseCategoryId: input.expenseCategoryId,
        title: input.title,
        projectId: input.projectId,
        legalEntityId: input.legalEntityId,
        amount: input.amount,
        expenseDate: input.expenseDate,
        gstInvoiceAvailable: input.gstInvoiceAvailable,
        gstCreditAmount: input.gstCreditAmount,
        note: input.note,
        actorId: ctx.auth.user!.id,
        hasApprovePermission: withClaimApprovePermission(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  submitClaim: requirePermission('employee_claim.create')
    .input(z.object({ id: z.string().uuid(), expectedVersion: z.number().int(), idempotencyKey: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.submitClaim({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        hasApprovePermission: withClaimApprovePermission(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  // ADR-171: who approves each legal entity's claims.
  listClaimApprovers: requireAnyPermission('employee_claim.read', 'legal_entity.read').query(async ({ ctx }) => {
    return ctx.services.employeeExpenses.listClaimApprovers({ organizationId: ctx.auth.user!.organizationId });
  }),

  approveClaim: requirePermission('employee_claim.approve')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        note: z.string().max(1000).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.approveClaim({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        hasSelfApprovePermission: withSelfApprove(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  rejectClaim: requirePermission('employee_claim.approve')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.rejectClaim({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  cancelClaim: requirePermission('employee_claim.create')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.cancelClaim({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        hasApprovePermission: withClaimApprovePermission(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  reimburseClaim: requirePermission('employee_claim.reimburse')
    .input(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int(),
        bankAccountId: z.string().uuid(),
        reimbursementDate: dateStringSchema,
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.reimburseClaim({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        bankAccountId: input.bankAccountId,
        reimbursementDate: input.reimbursementDate,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  reverseReimbursement: requirePermission('employee_claim.reverse')
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
      return ctx.services.employeeExpenses.reverseReimbursement({
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

  listClaims: requirePermission('employee_claim.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          employeeId: z.string().uuid().optional(),
          expenseCategoryId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          status: claimStatusSchema.optional(),
          expenseDateFrom: dateStringSchema.optional(),
          expenseDateTo: dateStringSchema.optional(),
          approvedDateFrom: dateStringSchema.optional(),
          approvedDateTo: dateStringSchema.optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.listClaims({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
      });
    }),

  getClaimStats: requirePermission('employee_claim.read')
    .input(
      z.object({
        filters: z.object({
          employeeId: z.string().uuid().optional(),
          expenseCategoryId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          expenseDateFrom: dateStringSchema.optional(),
          expenseDateTo: dateStringSchema.optional(),
          approvedDateFrom: dateStringSchema.optional(),
          approvedDateTo: dateStringSchema.optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.getClaimStats({
        organizationId: ctx.auth.user!.organizationId,
        filters: input.filters,
      });
    }),

  getClaimDetail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.employeeExpenses.getClaimDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        hasReadPermission: withClaimReadPermission(ctx.auth),
      });
    }),
});
