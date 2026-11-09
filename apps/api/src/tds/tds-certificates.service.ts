import { Injectable } from '@nestjs/common';
import { Prisma, generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  TaxDeductionType,
  TdsCertificateDetail,
  TdsCertificateImportPreview,
  TdsCertificateImportRow,
  TdsCertificateInput,
  TdsCertificateMatchRow,
  TdsCertificatePort,
  TdsCertificateSource,
  TdsCertificateStatus,
  TdsCertificateSummary,
  TdsMatchCandidate,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { parseAmount, parseDate, parseDeductionType, parseSource } from './tds-import.util';

const ZERO = new Prisma.Decimal(0);
const ENTITY_TYPE = 'TDS_CERTIFICATE';
const TAX_TYPES = ['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS'] as const;

const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

const certificateInclude = {
  legalEntity: { select: { legalName: true } },
  party: { select: { name: true } },
  matches: { where: { unmatchedAt: null }, select: { amount: true } },
} satisfies Prisma.TdsCertificateInclude;
type CertificateRow = Prisma.TdsCertificateGetPayload<{ include: typeof certificateInclude }>;

/** The receipt, invoice and project behind a deduction — what matching checks and what the screens show. */
const deductionSelect = {
  id: true,
  type: true,
  amount: true,
  allocation: {
    select: {
      invoice: { select: { id: true, invoiceNumber: true, project: { select: { id: true, name: true, clientId: true } } } },
      receipt: { select: { id: true, receiptDate: true, legalEntityId: true, status: true } },
    },
  },
} satisfies Prisma.AllocationDeductionSelect;
type DeductionRow = Prisma.AllocationDeductionGetPayload<{ select: typeof deductionSelect }>;

function toSummary(row: CertificateRow): TdsCertificateSummary {
  const matched = row.matches.reduce((s, m) => s.plus(m.amount), ZERO);
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    partyId: row.partyId,
    partyName: row.party.name,
    source: row.source,
    deductionType: row.deductionType,
    referenceNumber: row.referenceNumber,
    deductorTan: row.deductorTan,
    deductorGstin: row.deductorGstin,
    periodStart: dateOf(row.periodStart),
    periodEnd: dateOf(row.periodEnd),
    creditDate: dateOf(row.creditDate),
    amount: row.amount.toFixed(2),
    matchedAmount: matched.toFixed(2),
    unmatchedAmount: row.amount.minus(matched).toFixed(2),
    remarks: row.remarks,
    status: row.status,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * TDS and GST-TDS certificates and statement credits, and their matches to
 * the deductions clients made from our receipts (Phase 8.5a, ADR-112).
 *
 * A deduction may be matched once over to certificates and once over to
 * statement credits — the two are independent evidence of the same tax — so
 * "remaining" is always per source. Matching never posts: the receivable
 * stays on the ledger until whatever claims the credit clears it.
 */
@Injectable()
export class TdsCertificatesService implements TdsCertificatePort {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: { organizationId: string; status: TdsCertificateStatus | undefined; partyId: string | undefined; source: TdsCertificateSource | undefined }): Promise<TdsCertificateSummary[]> {
    const rows = await this.prisma.client.tdsCertificate.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.partyId ? { partyId: input.partyId } : {}),
        ...(input.source ? { source: input.source } : {}),
      },
      include: certificateInclude,
      orderBy: [{ creditDate: 'desc' }, { referenceNumber: 'asc' }],
    });
    return rows.map(toSummary);
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<TdsCertificateDetail> {
    const db = this.prisma.client;
    const row = await db.tdsCertificate.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: certificateInclude });
    if (!row) throwAppError('NOT_FOUND', 'TDS certificate not found.');
    const matches = await db.tdsCertificateMatch.findMany({
      where: { certificateId: row.id },
      select: { id: true, amount: true, createdAt: true, unmatchedAt: true, unmatchReason: true, deduction: { select: deductionSelect } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...toSummary(row),
      matches: matches.map(
        (m): TdsCertificateMatchRow => ({
          id: m.id,
          certificateId: row.id,
          deductionId: m.deduction.id,
          deductionType: m.deduction.type as TaxDeductionType,
          receiptId: m.deduction.allocation.receipt.id,
          receiptDate: dateOf(m.deduction.allocation.receipt.receiptDate),
          invoiceId: m.deduction.allocation.invoice.id,
          invoiceNumber: m.deduction.allocation.invoice.invoiceNumber,
          projectId: m.deduction.allocation.invoice.project.id,
          projectName: m.deduction.allocation.invoice.project.name,
          amount: m.amount.toFixed(2),
          createdAt: m.createdAt.toISOString(),
          unmatchedAt: m.unmatchedAt?.toISOString() ?? null,
          unmatchReason: m.unmatchReason,
        }),
      ),
    };
  }

  async record(input: TdsCertificateInput & { organizationId: string; actorId: string; correlationId: string }): Promise<TdsCertificateSummary> {
    const errors = await this.validate(input.organizationId, input);
    if (errors.length) throwAppError('VALIDATION_FAILED', errors.join(' '));
    const id = generateId();
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.tdsCertificate.create({ data: this.createData(input.organizationId, id, input, input.actorId) });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId,
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'TDS_CERTIFICATE_RECORDED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { ...input, amount: new Prisma.Decimal(input.amount).toFixed(2) },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throwAppError('VALIDATION_FAILED', 'This reference is already recorded for this client, source and type.');
      throw error;
    }
    return (await this.list({ organizationId: input.organizationId, status: undefined, partyId: input.partyId, source: input.source })).find((c) => c.id === id)!;
  }

  async cancel(input: { organizationId: string; id: string; reason: string; expectedVersion: number; actorId: string; correlationId: string }): Promise<TdsCertificateSummary> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tds_certificates WHERE id::text = ${input.id} FOR UPDATE`;
      const row = await tx.tdsCertificate.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: { matches: { where: { unmatchedAt: null }, select: { id: true } } } });
      if (!row) throwAppError('NOT_FOUND', 'TDS certificate not found.');
      if (row.version !== input.expectedVersion) throwAppError('VERSION_CONFLICT', 'This certificate was changed by someone else. Reload and try again.');
      if (row.status !== 'ACTIVE') throwAppError('INVALID_STATE_TRANSITION', 'This certificate is already cancelled.');
      if (row.matches.length) throwAppError('INVALID_STATE_TRANSITION', 'Unmatch this certificate from its deductions before cancelling it.');
      await tx.tdsCertificate.update({
        where: { id: row.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: input.actorId, cancelReason: input.reason, updatedAt: new Date(), updatedBy: input.actorId, version: { increment: 1 } },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: row.legalEntityId,
        entityType: ENTITY_TYPE,
        entityId: row.id,
        action: 'TDS_CERTIFICATE_CANCELLED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { status: 'ACTIVE' },
        newValues: { status: 'CANCELLED' },
        reason: input.reason,
      });
    });
    const row = await this.prisma.client.tdsCertificate.findFirstOrThrow({ where: { id: input.id }, include: certificateInclude });
    return toSummary(row);
  }

  async listMatchCandidates(input: { organizationId: string; certificateId: string }): Promise<TdsMatchCandidate[]> {
    const db = this.prisma.client;
    const certificate = await db.tdsCertificate.findFirst({ where: { id: input.certificateId, organizationId: input.organizationId } });
    if (!certificate) throwAppError('NOT_FOUND', 'TDS certificate not found.');
    const deductions = await db.allocationDeduction.findMany({
      where: {
        organizationId: input.organizationId,
        type: certificate.deductionType,
        allocation: {
          receipt: { legalEntityId: certificate.legalEntityId, status: 'POSTED' },
          invoice: { project: { clientId: certificate.partyId } },
        },
      },
      select: deductionSelect,
    });
    const matched = await this.matchedBySource(deductions.map((d) => d.id), certificate.source);
    const start = dateOf(certificate.periodStart);
    const end = dateOf(certificate.periodEnd);
    return deductions
      .map((d): TdsMatchCandidate => {
        const already = matched.get(d.id) ?? ZERO;
        const receiptDate = dateOf(d.allocation.receipt.receiptDate);
        return {
          deductionId: d.id,
          deductionType: d.type as TaxDeductionType,
          receiptId: d.allocation.receipt.id,
          receiptDate,
          invoiceId: d.allocation.invoice.id,
          invoiceNumber: d.allocation.invoice.invoiceNumber,
          projectId: d.allocation.invoice.project.id,
          projectName: d.allocation.invoice.project.name,
          amount: d.amount.toFixed(2),
          matchedFromSource: already.toFixed(2),
          remaining: d.amount.minus(already).toFixed(2),
          inPeriod: receiptDate >= start && receiptDate <= end,
        };
      })
      .filter((c) => new Prisma.Decimal(c.remaining).greaterThan(0))
      .sort((a, b) => Number(b.inPeriod) - Number(a.inPeriod) || a.receiptDate.localeCompare(b.receiptDate) || (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? ''));
  }

  async match(input: { organizationId: string; certificateId: string; matches: Array<{ deductionId: string; amount: string }>; actorId: string; correlationId: string }): Promise<TdsCertificateDetail> {
    const ids = input.matches.map((m) => m.deductionId);
    if (new Set(ids).size !== ids.length) throwAppError('VALIDATION_FAILED', 'A deduction appears more than once.');

    await this.prisma.client.$transaction(async (tx) => {
      // Lock the certificate, then the deductions in id order, so two people
      // matching overlapping amounts serialise instead of both over-matching.
      await tx.$queryRaw`SELECT id FROM tds_certificates WHERE id::text = ${input.certificateId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM allocation_deductions WHERE id::text IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`;

      const certificate = await tx.tdsCertificate.findFirst({ where: { id: input.certificateId, organizationId: input.organizationId }, include: { matches: { where: { unmatchedAt: null }, select: { amount: true } } } });
      if (!certificate) throwAppError('NOT_FOUND', 'TDS certificate not found.');
      if (certificate.status !== 'ACTIVE') throwAppError('INVALID_STATE_TRANSITION', 'A cancelled certificate cannot be matched.');

      const deductions = await tx.allocationDeduction.findMany({ where: { id: { in: ids }, organizationId: input.organizationId }, select: deductionSelect });
      const byId = new Map(deductions.map((d) => [d.id, d]));
      const matchedRows = await tx.tdsCertificateMatch.findMany({
        where: { allocationDeductionId: { in: ids }, unmatchedAt: null, certificate: { source: certificate.source } },
        select: { allocationDeductionId: true, amount: true },
      });
      const already = new Map<string, Prisma.Decimal>();
      for (const m of matchedRows) already.set(m.allocationDeductionId, (already.get(m.allocationDeductionId) ?? ZERO).plus(m.amount));

      let total = ZERO;
      for (const m of input.matches) {
        const d = byId.get(m.deductionId);
        if (!d) throwAppError('NOT_FOUND', 'Deduction not found.');
        this.assertMatchable(certificate, d);
        const amount = new Prisma.Decimal(m.amount);
        if (!amount.greaterThan(0)) throwAppError('VALIDATION_FAILED', 'A matched amount must be more than zero.');
        const remaining = d.amount.minus(already.get(d.id) ?? ZERO);
        if (amount.greaterThan(remaining)) {
          throwAppError('VALIDATION_FAILED', `Only ${remaining.toFixed(2)} of this deduction is still unmatched to ${certificate.source === 'CERTIFICATE' ? 'certificates' : 'statement credits'}.`);
        }
        total = total.plus(amount);
      }
      const unmatched = certificate.amount.minus(certificate.matches.reduce((s, m) => s.plus(m.amount), ZERO));
      if (total.greaterThan(unmatched)) throwAppError('VALIDATION_FAILED', `The matches total ${total.toFixed(2)}, but only ${unmatched.toFixed(2)} of this certificate is unmatched.`);

      await tx.tdsCertificateMatch.createMany({
        data: input.matches.map((m) => ({ id: generateId(), organizationId: input.organizationId, certificateId: certificate.id, allocationDeductionId: m.deductionId, amount: new Prisma.Decimal(m.amount), createdBy: input.actorId })),
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: certificate.legalEntityId,
        entityType: ENTITY_TYPE,
        entityId: certificate.id,
        action: 'TDS_CERTIFICATE_MATCHED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { matches: input.matches.map((m) => ({ deductionId: m.deductionId, amount: new Prisma.Decimal(m.amount).toFixed(2) })) },
      });
    });
    return this.getDetail({ organizationId: input.organizationId, id: input.certificateId });
  }

  async unmatch(input: { organizationId: string; matchId: string; reason: string; actorId: string; correlationId: string }): Promise<TdsCertificateDetail> {
    const certificateId = await this.prisma.client.$transaction(async (tx) => {
      const found = await tx.tdsCertificateMatch.findFirst({ where: { id: input.matchId, organizationId: input.organizationId }, select: { certificateId: true } });
      if (!found) throwAppError('NOT_FOUND', 'Match not found.');
      await tx.$queryRaw`SELECT id FROM tds_certificates WHERE id::text = ${found.certificateId} FOR UPDATE`;
      const match = await tx.tdsCertificateMatch.findFirstOrThrow({ where: { id: input.matchId }, include: { certificate: { select: { legalEntityId: true } } } });
      if (match.unmatchedAt) throwAppError('INVALID_STATE_TRANSITION', 'This match was already undone.');
      await tx.tdsCertificateMatch.update({ where: { id: match.id }, data: { unmatchedAt: new Date(), unmatchedBy: input.actorId, unmatchReason: input.reason } });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: match.certificate.legalEntityId,
        entityType: ENTITY_TYPE,
        entityId: match.certificateId,
        action: 'TDS_CERTIFICATE_UNMATCHED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { matchId: match.id, deductionId: match.allocationDeductionId, amount: match.amount.toFixed(2) },
        reason: input.reason,
      });
      return match.certificateId;
    });
    return this.getDetail({ organizationId: input.organizationId, id: certificateId });
  }

  async previewImport(input: { organizationId: string; legalEntityId: string; rows: TdsCertificateImportRow[] }): Promise<TdsCertificateImportPreview> {
    const { parsed } = await this.parseImport(input);
    const rows = parsed.map((p) => ({ rowNumber: p.rowNumber, clientName: p.clientName, errors: p.errors }));
    const errorCount = rows.filter((r) => r.errors.length).length;
    return { rows, validCount: rows.length - errorCount, errorCount };
  }

  /** All or nothing: a file with any bad row creates nothing. */
  async importRows(input: { organizationId: string; legalEntityId: string; rows: TdsCertificateImportRow[]; actorId: string; correlationId: string }): Promise<{ created: number }> {
    const { parsed } = await this.parseImport(input);
    const bad = parsed.filter((p) => p.errors.length);
    if (bad.length) throwAppError('VALIDATION_FAILED', `${bad.length} row(s) have errors — nothing was imported. First: row ${bad[0]!.rowNumber}: ${bad[0]!.errors[0]}`);
    try {
      await this.prisma.client.$transaction(async (tx) => {
        for (const p of parsed) {
          const id = generateId();
          await tx.tdsCertificate.create({ data: this.createData(input.organizationId, id, p.input!, input.actorId) });
          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId,
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'TDS_CERTIFICATE_RECORDED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: { ...p.input!, importedFromRow: p.rowNumber },
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throwAppError('VALIDATION_FAILED', 'A reference in this file was recorded by someone else meanwhile. Preview again.');
      throw error;
    }
    return { created: parsed.length };
  }

  // ---------------------------------------------------------------- private

  private createData(organizationId: string, id: string, input: TdsCertificateInput, actorId: string): Prisma.TdsCertificateUncheckedCreateInput {
    return {
      id,
      organizationId,
      legalEntityId: input.legalEntityId,
      partyId: input.partyId,
      source: input.source,
      deductionType: input.deductionType,
      referenceNumber: input.referenceNumber.trim(),
      deductorTan: input.deductorTan?.trim().toUpperCase() || null,
      deductorGstin: input.deductorGstin?.trim().toUpperCase() || null,
      periodStart: asDate(input.periodStart),
      periodEnd: asDate(input.periodEnd),
      creditDate: asDate(input.creditDate),
      amount: new Prisma.Decimal(input.amount),
      remarks: input.remarks ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    };
  }

  private async validate(organizationId: string, input: TdsCertificateInput): Promise<string[]> {
    const errors: string[] = [];
    if (input.periodStart > input.periodEnd) errors.push('The period cannot start after it ends.');
    if (!new Prisma.Decimal(input.amount).greaterThan(0)) errors.push('The amount must be more than zero.');
    if (!input.referenceNumber.trim()) errors.push('A reference number is required.');
    const [legalEntity, client] = await Promise.all([
      this.prisma.client.legalEntity.findFirst({ where: { id: input.legalEntityId, organizationId }, select: { id: true } }),
      this.prisma.client.party.findFirst({ where: { id: input.partyId, organizationId, clientProfile: { isNot: null } }, select: { id: true } }),
    ]);
    if (!legalEntity) errors.push('Legal entity not found.');
    if (!client) errors.push('Client not found.');
    return errors;
  }

  private assertMatchable(certificate: { deductionType: TaxDeductionType; legalEntityId: string; partyId: string }, d: DeductionRow): void {
    if (!(TAX_TYPES as readonly string[]).includes(d.type) || d.type !== certificate.deductionType) {
      throwAppError('VALIDATION_FAILED', `A ${certificate.deductionType.replace('_', '-')} certificate can only match ${certificate.deductionType.replace('_', '-')} deductions.`);
    }
    if (d.allocation.receipt.status !== 'POSTED') throwAppError('VALIDATION_FAILED', 'This deduction belongs to a reversed receipt.');
    if (d.allocation.receipt.legalEntityId !== certificate.legalEntityId) throwAppError('VALIDATION_FAILED', 'The deduction belongs to a different legal entity.');
    if (d.allocation.invoice.project.clientId !== certificate.partyId) throwAppError('VALIDATION_FAILED', 'The deduction was made by a different client.');
  }

  /** Active matched amount per deduction, from credits of one source. */
  private async matchedBySource(deductionIds: string[], source: TdsCertificateSource): Promise<Map<string, Prisma.Decimal>> {
    if (!deductionIds.length) return new Map();
    const rows = await this.prisma.client.tdsCertificateMatch.groupBy({
      by: ['allocationDeductionId'],
      where: { allocationDeductionId: { in: deductionIds }, unmatchedAt: null, certificate: { source } },
      _sum: { amount: true },
    });
    return new Map(rows.map((r) => [r.allocationDeductionId, r._sum.amount ?? ZERO]));
  }

  private async parseImport(input: { organizationId: string; legalEntityId: string; rows: TdsCertificateImportRow[] }) {
    const db = this.prisma.client;
    const legalEntity = await db.legalEntity.findFirst({ where: { id: input.legalEntityId, organizationId: input.organizationId }, select: { id: true } });
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');
    const clients = await db.party.findMany({
      where: { organizationId: input.organizationId, clientProfile: { isNot: null } },
      select: { id: true, name: true, clientProfile: { select: { gstin: true } } },
    });
    const byGstin = new Map(clients.filter((c) => c.clientProfile?.gstin).map((c) => [c.clientProfile!.gstin!.toUpperCase(), c]));
    const byName = new Map<string, typeof clients>();
    for (const c of clients) byName.set(c.name.trim().toLowerCase(), [...(byName.get(c.name.trim().toLowerCase()) ?? []), c]);

    const seen = new Set<string>();
    const parsed = input.rows.map((row, index) => {
      const errors: string[] = [];
      const source = parseSource(row.source);
      const deductionType = parseDeductionType(row.deductionType);
      const periodStart = parseDate(row.periodStart);
      const periodEnd = parseDate(row.periodEnd);
      const creditDate = parseDate(row.creditDate);
      const amount = parseAmount(row.amount);
      const reference = row.referenceNumber.trim();
      if (!source) errors.push(`Source "${row.source}" is not CERTIFICATE or STATEMENT.`);
      if (!deductionType) errors.push(`Type "${row.deductionType}" is not TDS, CGST_TDS, SGST_TDS or IGST_TDS.`);
      if (!periodStart) errors.push('Period start is not a date.');
      if (!periodEnd) errors.push('Period end is not a date.');
      if (periodStart && periodEnd && periodStart > periodEnd) errors.push('The period cannot start after it ends.');
      if (!creditDate) errors.push('Credit date is not a date.');
      if (!amount) errors.push('Amount must be a positive number with at most 2 decimals.');
      if (!reference) errors.push('A reference number is required.');

      const clientKey = row.client.trim();
      const client = byGstin.get(clientKey.toUpperCase()) ?? (byName.get(clientKey.toLowerCase())?.length === 1 ? byName.get(clientKey.toLowerCase())![0] : undefined);
      if (!client) errors.push((byName.get(clientKey.toLowerCase())?.length ?? 0) > 1 ? `More than one client is named "${clientKey}" — use the GSTIN.` : `No client matches "${clientKey}".`);

      const key = client && source && deductionType ? `${client.id}|${source}|${deductionType}|${reference}` : null;
      if (key && seen.has(key)) errors.push('The same reference appears twice in this file.');
      if (key) seen.add(key);

      const recordInput: TdsCertificateInput | null =
        client && source && deductionType && periodStart && periodEnd && creditDate && amount && reference
          ? {
              legalEntityId: input.legalEntityId,
              partyId: client.id,
              source,
              deductionType,
              referenceNumber: reference,
              deductorTan: row.deductorTan.trim() || undefined,
              deductorGstin: row.deductorGstin.trim() || undefined,
              periodStart,
              periodEnd,
              creditDate,
              amount,
              remarks: row.remarks.trim() || undefined,
            }
          : null;
      return { rowNumber: index + 1, clientName: client?.name ?? null, errors, input: recordInput };
    });

    // Already recorded — checked in one query for the whole file.
    const candidates = parsed.filter((p) => p.input && !p.errors.length);
    if (candidates.length) {
      const existing = await db.tdsCertificate.findMany({
        where: {
          organizationId: input.organizationId,
          OR: candidates.map((p) => ({ partyId: p.input!.partyId, source: p.input!.source, deductionType: p.input!.deductionType, referenceNumber: p.input!.referenceNumber })),
        },
        select: { partyId: true, source: true, deductionType: true, referenceNumber: true },
      });
      const taken = new Set(existing.map((e) => `${e.partyId}|${e.source}|${e.deductionType}|${e.referenceNumber}`));
      for (const p of candidates) {
        if (taken.has(`${p.input!.partyId}|${p.input!.source}|${p.input!.deductionType}|${p.input!.referenceNumber}`)) p.errors.push('This reference is already recorded.');
      }
    }
    return { parsed };
  }
}
