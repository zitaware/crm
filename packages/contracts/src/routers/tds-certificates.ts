import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be an amount with at most 2 decimals.');
const source = z.enum(['CERTIFICATE', 'STATEMENT']);
const deductionType = z.enum(['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS']);
const importRow = z.object({
  source: z.string().max(40),
  deductionType: z.string().max(40),
  client: z.string().max(300),
  deductorTan: z.string().max(40),
  deductorGstin: z.string().max(40),
  referenceNumber: z.string().max(100),
  periodStart: z.string().max(20),
  periodEnd: z.string().max(20),
  creditDate: z.string().max(20),
  amount: z.string().max(40),
  remarks: z.string().max(1000),
});

// Reading needs tds_certificate.read; every change needs tds_certificate.manage (ADR-112).
export const tdsCertificatesRouter = router({
  list: requirePermission('tds_certificate.read')
    .input(z.object({ status: z.enum(['ACTIVE', 'CANCELLED']).optional(), partyId: z.string().uuid().optional(), source: source.optional() }))
    .query(async ({ ctx, input }) =>
      ctx.services.tdsCertificates.list({ organizationId: ctx.auth.user!.organizationId, status: input.status, partyId: input.partyId, source: input.source }),
    ),

  getDetail: requirePermission('tds_certificate.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => ctx.services.tdsCertificates.getDetail({ organizationId: ctx.auth.user!.organizationId, id: input.id })),

  record: requirePermission('tds_certificate.manage')
    .input(
      z.object({
        legalEntityId: z.string().uuid(),
        partyId: z.string().uuid(),
        source,
        deductionType,
        referenceNumber: z.string().trim().min(1).max(100),
        deductorTan: z.string().trim().max(20).optional(),
        deductorGstin: z.string().trim().max(20).optional(),
        periodStart: dateString,
        periodEnd: dateString,
        creditDate: dateString,
        amount: money,
        remarks: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.services.tdsCertificates.record({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        partyId: input.partyId,
        source: input.source,
        deductionType: input.deductionType,
        referenceNumber: input.referenceNumber,
        deductorTan: input.deductorTan || undefined,
        deductorGstin: input.deductorGstin || undefined,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        creditDate: input.creditDate,
        amount: input.amount,
        remarks: input.remarks || undefined,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      }),
    ),

  cancel: requirePermission('tds_certificate.manage')
    .input(z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.tdsCertificates.cancel({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        reason: input.reason,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      }),
    ),

  listMatchCandidates: requirePermission('tds_certificate.read')
    .input(z.object({ certificateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => ctx.services.tdsCertificates.listMatchCandidates({ organizationId: ctx.auth.user!.organizationId, certificateId: input.certificateId })),

  match: requirePermission('tds_certificate.manage')
    .input(z.object({ certificateId: z.string().uuid(), matches: z.array(z.object({ deductionId: z.string().uuid(), amount: money })).min(1).max(200) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.tdsCertificates.match({
        organizationId: ctx.auth.user!.organizationId,
        certificateId: input.certificateId,
        matches: input.matches,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      }),
    ),

  unmatch: requirePermission('tds_certificate.manage')
    .input(z.object({ matchId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.tdsCertificates.unmatch({
        organizationId: ctx.auth.user!.organizationId,
        matchId: input.matchId,
        reason: input.reason,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      }),
    ),

  previewImport: requirePermission('tds_certificate.manage')
    .input(z.object({ legalEntityId: z.string().uuid(), rows: z.array(importRow).min(1).max(1000) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.tdsCertificates.previewImport({ organizationId: ctx.auth.user!.organizationId, legalEntityId: input.legalEntityId, rows: input.rows }),
    ),

  importRows: requirePermission('tds_certificate.manage')
    .input(z.object({ legalEntityId: z.string().uuid(), rows: z.array(importRow).min(1).max(1000) }))
    .mutation(async ({ ctx, input }) =>
      ctx.services.tdsCertificates.importRows({
        organizationId: ctx.auth.user!.organizationId,
        legalEntityId: input.legalEntityId,
        rows: input.rows,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      }),
    ),
});
