import { z } from 'zod';
import { requirePermission, router } from '../trpc';
import { throwAppError } from '../errors';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const categorySchema = z.enum(['EMD', 'SD']);
const statusSchema = z.enum(['LODGED', 'RETURNED']);

/** lodge/recordReturn are each gated by two permission keys (docs/04 names
 * both security_instrument.create/.post for the add screen) — both
 * checked together on the one mutation, no separate maker-checker
 * draft/finalize step, matching how 4.4 built postJournal itself. */
const requireLodgePermissions = requirePermission('security_instrument.create').use(({ ctx, next }) => {
  if (!ctx.auth.permissions.has('security_instrument.post')) {
    throwAppError('FORBIDDEN', 'Missing permission: security_instrument.post');
  }
  return next({ ctx });
});

export const securityInstrumentsRouter = router({
  listPurposes: requirePermission('security_instrument.create').query(async ({ ctx }) => {
    return ctx.services.securityInstruments.listPurposes({ organizationId: ctx.auth.user!.organizationId });
  }),

  listTypes: requirePermission('security_instrument.create').query(async ({ ctx }) => {
    return ctx.services.securityInstruments.listTypes({ organizationId: ctx.auth.user!.organizationId });
  }),

  list: requirePermission('security_instrument.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: z.object({
          category: categorySchema.optional(),
          projectId: z.string().uuid().optional(),
          tenderId: z.string().uuid().optional(),
          status: statusSchema.optional(),
          returnDueFrom: dateStringSchema.optional(),
          returnDueTo: dateStringSchema.optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.securityInstruments.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
      });
    }),

  getDetail: requirePermission('security_instrument.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.securityInstruments.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
      });
    }),

  getTiles: requirePermission('security_instrument.read')
    .input(z.object({ projectId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.securityInstruments.getTiles({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
      });
    }),

  lodge: requireLodgePermissions
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        tenderId: z.string().uuid().optional(),
        purposeId: z.string().uuid(),
        typeId: z.string().uuid(),
        amount: decimalStringSchema,
        instrumentReferenceNo: z.string().max(200).optional(),
        issuingBank: z.string().max(200).optional(),
        lodgedWithAuthority: z.string().max(300).optional(),
        bankLedgerAccountId: z.string().uuid().optional(),
        submittedOn: dateStringSchema,
        returnDueOn: dateStringSchema,
        narrative: z.string().max(2000).optional(),
        fundedByLegalEntityId: z.string().uuid().optional(),
        fundedByPartyId: z.string().uuid().optional(),
        fundedByBankAccountDetails: z.string().max(300).optional(),
        fundedByTransferAmount: decimalStringSchema.optional(),
        fundedByTransferMode: z.string().max(100).optional(),
        fundedByNote: z.string().max(2000).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.securityInstruments.lodge({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        projectId: input.projectId,
        tenderId: input.tenderId,
        purposeId: input.purposeId,
        typeId: input.typeId,
        amount: input.amount,
        instrumentReferenceNo: input.instrumentReferenceNo,
        issuingBank: input.issuingBank,
        lodgedWithAuthority: input.lodgedWithAuthority,
        bankLedgerAccountId: input.bankLedgerAccountId,
        submittedOn: input.submittedOn,
        returnDueOn: input.returnDueOn,
        narrative: input.narrative,
        fundedByLegalEntityId: input.fundedByLegalEntityId,
        fundedByPartyId: input.fundedByPartyId,
        fundedByBankAccountDetails: input.fundedByBankAccountDetails,
        fundedByTransferAmount: input.fundedByTransferAmount,
        fundedByTransferMode: input.fundedByTransferMode,
        fundedByNote: input.fundedByNote,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  recordReturn: requireLodgePermissions
    .input(
      z.object({
        id: z.string().uuid(),
        returnedAmount: decimalStringSchema,
        returnedOn: dateStringSchema,
        returnedToLegalEntityId: z.string().uuid().optional(),
        returnedToPartyId: z.string().uuid().optional(),
        returnedToBankAccountDetails: z.string().max(300).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.securityInstruments.recordReturn({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        returnedAmount: input.returnedAmount,
        returnedOn: input.returnedOn,
        returnedToLegalEntityId: input.returnedToLegalEntityId,
        returnedToPartyId: input.returnedToPartyId,
        returnedToBankAccountDetails: input.returnedToBankAccountDetails,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),
});
