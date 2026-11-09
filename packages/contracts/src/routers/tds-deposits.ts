import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be an amount with at most 2 decimals.');
const deductionType = z.enum(['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS']);
const sourceKind = z.enum(['VENDOR_PAYMENT_DEDUCTION', 'DIRECT_EXPENSE', 'INTRODUCER_PAYMENT', 'SALARY_PAYMENT_LINE']);

// Reading needs tds_deposit.read; posting and reversing move money and need tds_deposit.post (ADR-113).
export const tdsDepositsRouter = router({
  list: requirePermission('tds_deposit.read')
    .input(z.object({ status: z.enum(['POSTED', 'REVERSED']).optional(), deductionType: deductionType.optional() }))
    .query(async ({ ctx, input }) => ctx.services.tdsDeposits.list({ organizationId: ctx.auth.user!.organizationId, status: input.status, deductionType: input.deductionType })),

  getDetail: requirePermission('tds_deposit.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => ctx.services.tdsDeposits.getDetail({ organizationId: ctx.auth.user!.organizationId, id: input.id })),

  listOutstanding: requirePermission('tds_deposit.read')
    .input(z.object({ legalEntityId: z.string().uuid(), deductionType }))
    .query(async ({ ctx, input }) =>
      ctx.services.tdsDeposits.listOutstanding({ organizationId: ctx.auth.user!.organizationId, legalEntityId: input.legalEntityId, deductionType: input.deductionType }),
    ),

  post: requirePermission('tds_deposit.post')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        bankAccountId: z.string().uuid(),
        deductionType,
        challanNumber: z.string().trim().min(1).max(100),
        depositDate: dateString,
        remarks: z.string().max(1000).optional(),
        allocations: z.array(z.object({ sourceKind, sourceId: z.string().uuid(), amount: money })).min(1).max(500),
        idempotencyKey: z.string().min(8).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.services.tdsDeposits.post({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        bankAccountId: input.bankAccountId,
        deductionType: input.deductionType,
        challanNumber: input.challanNumber,
        depositDate: input.depositDate,
        remarks: input.remarks || undefined,
        allocations: input.allocations,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      }),
    ),

  reverse: requirePermission('tds_deposit.post')
    .input(z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000), accountingDate: dateString, expectedVersion: z.number().int(), idempotencyKey: z.string().min(8).max(100) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.tdsDeposits.reverse({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        reason: input.reason,
        accountingDate: input.accountingDate,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      }),
    ),
});
