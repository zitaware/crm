import { z } from 'zod';
import { requireAnyPermission, requirePermission, router } from '../trpc';

const brandingImageSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg']),
  dataBase64: z.string().min(1).max(560_000),
});

const invoicePrintSchema = {
  placeOfSupply: z.string().max(120).optional(),
  jurisdiction: z.string().max(120).optional(),
  stateCode: z.string().max(10).optional(),
};

export const legalEntitiesRouter = router({
  // Also open to `employee_claim.create` holders — filing a company-overhead
  // expense claim (no project) requires picking a legal entity, so a
  // create-only actor (e.g. Employee) genuinely needs this list, not just
  // legal_entity.read holders. PAN is the one sensitive field on this
  // record (bank/card accounts have their own, still-gated endpoints), so
  // it's redacted rather than widening full legal_entity.read exposure.
  list: requireAnyPermission('legal_entity.read', 'employee_claim.create')
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.services.legalEntities.list({
        organizationId: ctx.auth.user!.organizationId,
        includeInactive: input?.includeInactive,
      });
      if (ctx.auth.permissions.has('legal_entity.read')) return rows;
      return rows.map((row) => ({ ...row, panNumber: '' }));
    }),

  getBranding: requirePermission('legal_entity.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.legalEntities.getBranding({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
      });
    }),

  create: requirePermission('legal_entity.manage')
    .input(
      z.object({
        legalName: z.string().min(1).max(200),
        panNumber: z.string().length(10),
        registeredAddress: z.string().min(1).max(2000),
        logo: brandingImageSchema.optional(),
        seal: brandingImageSchema.optional(),
        authorizedSign: brandingImageSchema.optional(),
        ...invoicePrintSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.legalEntities.create({
        organizationId: ctx.auth.user!.organizationId,
        legalName: input.legalName,
        panNumber: input.panNumber,
        registeredAddress: input.registeredAddress,
        logo: input.logo,
        seal: input.seal,
        authorizedSign: input.authorizedSign,
        placeOfSupply: input.placeOfSupply,
        jurisdiction: input.jurisdiction,
        stateCode: input.stateCode,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('legal_entity.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        legalName: z.string().min(1).max(200).optional(),
        registeredAddress: z.string().min(1).max(2000).optional(),
        logo: brandingImageSchema.nullable().optional(),
        seal: brandingImageSchema.nullable().optional(),
        authorizedSign: brandingImageSchema.nullable().optional(),
        ...invoicePrintSchema,
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.legalEntities.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        legalName: input.legalName,
        registeredAddress: input.registeredAddress,
        logo: input.logo,
        seal: input.seal,
        authorizedSign: input.authorizedSign,
        placeOfSupply: input.placeOfSupply,
        jurisdiction: input.jurisdiction,
        stateCode: input.stateCode,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setActive: requirePermission('legal_entity.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.legalEntities.setActive({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  delete: requirePermission('legal_entity.manage')
    .input(z.object({ id: z.string().uuid(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.legalEntities.delete({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  // GSTIN/trade name is low-sensitivity (printed on every invoice), unlike
  // the rest of Legal Entity data (PAN, bank/card accounts) — so this
  // lookup is also open to whoever can create/read a vendor bill, not
  // gated behind full `legal_entity.read`. See the vendor-bills/new GST
  // dropdown fix in docs/12-decisions-log.md.
  listGstRegistrations: requireAnyPermission('legal_entity.read', 'vendor_bill.create', 'vendor_bill.read')
    .input(z.object({ legalEntityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.legalEntities.listGstRegistrations({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
      });
    }),

  createGstRegistration: requirePermission('legal_entity.manage')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        stateId: z.string().uuid(),
        gstin: z.string().length(15),
        tradeName: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.legalEntities.createGstRegistration({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        stateId: input.stateId,
        gstin: input.gstin,
        tradeName: input.tradeName,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  updateGstRegistration: requirePermission('legal_entity.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        tradeName: z.string().max(200).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.legalEntities.updateGstRegistration({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        tradeName: input.tradeName,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setGstRegistrationActive: requirePermission('legal_entity.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.legalEntities.setGstRegistrationActive({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  deleteGstRegistration: requirePermission('legal_entity.manage')
    .input(z.object({ id: z.string().uuid(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.legalEntities.deleteGstRegistration({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  listBankAccounts: requirePermission('legal_entity.read')
    .input(z.object({ legalEntityId: z.string().uuid().optional(), includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.services.legalEntities.listBankAccounts({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input?.legalEntityId,
        includeInactive: input?.includeInactive,
      });
    }),

  createBankAccount: requirePermission('legal_entity.manage')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        /** Omitted: a ledger of its own is created under Bank Accounts (ADR-160). */
        ledgerAccountId: z.string().uuid().optional(),
        accountName: z.string().min(1).max(200),
        bankName: z.string().max(200).optional(),
        maskedAccountNumber: z.string().max(50).optional(),
        invoiceAccountNumber: z.string().max(40).optional(),
        ifsc: z.string().max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.legalEntities.createBankAccount({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        ledgerAccountId: input.ledgerAccountId,
        accountName: input.accountName,
        bankName: input.bankName,
        maskedAccountNumber: input.maskedAccountNumber,
        ...(input.invoiceAccountNumber !== undefined ? { invoiceAccountNumber: input.invoiceAccountNumber } : {}),
        ifsc: input.ifsc,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  updateBankAccount: requirePermission('legal_entity.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        accountName: z.string().min(1).max(200).optional(),
        bankName: z.string().max(200).nullish(),
        maskedAccountNumber: z.string().max(50).nullish(),
        invoiceAccountNumber: z.string().max(40).nullish(),
        ifsc: z.string().max(20).nullish(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.legalEntities.updateBankAccount({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        accountName: input.accountName,
        bankName: input.bankName ?? undefined,
        maskedAccountNumber: input.maskedAccountNumber ?? undefined,
        ...(input.invoiceAccountNumber !== undefined ? { invoiceAccountNumber: input.invoiceAccountNumber } : {}),
        ifsc: input.ifsc ?? undefined,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setBankAccountActive: requirePermission('legal_entity.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.legalEntities.setBankAccountActive({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  listCardAccounts: requirePermission('legal_entity.read')
    .input(z.object({ legalEntityId: z.string().uuid().optional(), includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.services.legalEntities.listCardAccounts({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input?.legalEntityId,
        includeInactive: input?.includeInactive,
      });
    }),

  createCardAccount: requirePermission('legal_entity.manage')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        type: z.enum(['DEBIT_CARD', 'CREDIT_CARD']),
        displayName: z.string().min(1).max(200),
        issuerName: z.string().max(200).optional(),
        maskedLastFour: z.string().length(4).regex(/^\d{4}$/),
        cardNumber: z.string().max(30).optional(),
        cardholderEmployeeId: z.string().uuid().optional(),
        bankAccountId: z.string().uuid().optional(),
        ledgerAccountId: z.string().uuid().optional(),
        statementDay: z.number().int().min(1).max(31).optional(),
        paymentDueDay: z.number().int().min(1).max(31).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.legalEntities.createCardAccount({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        type: input.type,
        displayName: input.displayName,
        issuerName: input.issuerName,
        maskedLastFour: input.maskedLastFour,
        cardNumber: input.cardNumber,
        cardholderEmployeeId: input.cardholderEmployeeId,
        bankAccountId: input.bankAccountId,
        ledgerAccountId: input.ledgerAccountId,
        statementDay: input.statementDay,
        paymentDueDay: input.paymentDueDay,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  updateCardAccount: requirePermission('legal_entity.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        displayName: z.string().min(1).max(200).optional(),
        issuerName: z.string().max(200).nullish(),
        maskedLastFour: z.string().length(4).regex(/^\d{4}$/).optional(),
        cardNumber: z.string().max(30).nullish(),
        cardholderEmployeeId: z.string().uuid().nullish(),
        statementDay: z.number().int().min(1).max(31).nullish(),
        paymentDueDay: z.number().int().min(1).max(31).nullish(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.legalEntities.updateCardAccount({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        displayName: input.displayName,
        issuerName: input.issuerName ?? undefined,
        maskedLastFour: input.maskedLastFour,
        cardNumber: input.cardNumber ?? undefined,
        cardholderEmployeeId: input.cardholderEmployeeId ?? undefined,
        statementDay: input.statementDay ?? undefined,
        paymentDueDay: input.paymentDueDay ?? undefined,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setCardAccountActive: requirePermission('legal_entity.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.legalEntities.setCardAccountActive({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),
});
