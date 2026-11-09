import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { VendorPort, VendorSummary, VendorDetail, VendorDuplicateMatch, VendorPaymentTerms } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

const PARTY_WITH_VENDOR_INCLUDE = {
  vendorProfile: true,
  state: true,
  district: true,
  city: true,
};

interface PartyWithVendor {
  id: string;
  name: string;
  shortCode: string | null;
  stateId: string | null;
  districtId: string | null;
  cityId: string | null;
  pinCode: string | null;
  officeAddress: string | null;
  internalNote: string | null;
  isActive: boolean;
  createdAt: Date;
  state: { name: string } | null;
  district: { name: string } | null;
  city: { name: string } | null;
  vendorProfile: {
    gstin: string | null;
    panNumber: string | null;
    paymentTerms: VendorPaymentTerms | null;
    isActive: boolean;
    version: number;
  } | null;
}

/** Trimmed and uppercased before every write/comparison — GSTIN/PAN
 * duplicate checks and format checks are meaningless against
 * differently-cased or whitespace-padded input. Empty string normalizes to
 * undefined (treated as "not provided"). */
function normalizeIdentifier(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toUpperCase();
  return trimmed || undefined;
}

function toVendorSummary(row: PartyWithVendor): VendorSummary {
  return {
    id: row.id,
    name: row.name,
    shortCode: row.shortCode,
    gstin: row.vendorProfile!.gstin,
    panNumber: row.vendorProfile!.panNumber,
    paymentTerms: row.vendorProfile!.paymentTerms,
    stateId: row.stateId,
    stateName: row.state?.name ?? null,
    districtId: row.districtId,
    districtName: row.district?.name ?? null,
    cityId: row.cityId,
    cityName: row.city?.name ?? null,
    // Selectable only when BOTH the party-level master switch and the
    // vendor role itself are active — see VendorProfile's schema doc
    // comment. Deactivating this vendor role never touches party.isActive,
    // so a Party that is also an active Client is left untouched.
    isActive: row.isActive && row.vendorProfile!.isActive,
    createdAt: row.createdAt.toISOString(),
    version: row.vendorProfile!.version,
  };
}

function toVendorDetail(row: PartyWithVendor): VendorDetail {
  return {
    ...toVendorSummary(row),
    pinCode: row.pinCode,
    officeAddress: row.officeAddress,
    internalNote: row.internalNote,
  };
}

@Injectable()
export class VendorsService implements VendorPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<VendorSummary[]> {
    const rows = await this.prisma.client.party.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        ...(input.includeInactive
          ? { vendorProfile: { isNot: null } }
          : { isActive: true, vendorProfile: { is: { isActive: true } } }),
      },
      include: PARTY_WITH_VENDOR_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.filter((row) => row.vendorProfile !== null).map((row) => toVendorSummary(row as PartyWithVendor));
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<VendorDetail> {
    const row = await this.prisma.client.party.findFirst({
      where: { id: input.id, organizationId: input.organizationId, deletedAt: null, vendorProfile: { isNot: null } },
      include: PARTY_WITH_VENDOR_INCLUDE,
    });
    if (!row || !row.vendorProfile) {
      throwAppError('NOT_FOUND', 'Vendor not found.');
    }
    return toVendorDetail(row);
  }

  async checkForDuplicates(input: {
    organizationId: string;
    name: string;
    gstin: string | undefined;
    panNumber: string | undefined;
    cityId: string | undefined;
  }): Promise<VendorDuplicateMatch[]> {
    const gstin = normalizeIdentifier(input.gstin);
    const panNumber = normalizeIdentifier(input.panNumber);
    const matches: VendorDuplicateMatch[] = [];
    const seenPartyIds = new Set<string>();

    // A matching GSTIN can appear on either an existing Vendor or an
    // existing Client (ClientProfile.gstin) — both count as "this identity
    // already exists in the system."
    if (gstin) {
      const rows = await this.prisma.client.party.findMany({
        where: {
          organizationId: input.organizationId,
          deletedAt: null,
          OR: [{ vendorProfile: { is: { gstin } } }, { clientProfile: { is: { gstin } } }],
        },
        include: { vendorProfile: true, city: true },
      });
      for (const row of rows) {
        seenPartyIds.add(row.id);
        matches.push({
          partyId: row.id,
          name: row.name,
          gstin: row.vendorProfile?.gstin ?? gstin,
          panNumber: row.vendorProfile?.panNumber ?? null,
          cityName: row.city?.name ?? null,
          matchType: 'EXACT_GSTIN',
          hasVendorProfile: row.vendorProfile !== null,
        });
      }
    }

    // PAN is only ever tracked on VendorProfile (Client has no PAN field).
    if (panNumber) {
      const rows = await this.prisma.client.party.findMany({
        where: {
          organizationId: input.organizationId,
          deletedAt: null,
          vendorProfile: { is: { panNumber } },
          id: { notIn: Array.from(seenPartyIds) },
        },
        include: { vendorProfile: true, city: true },
      });
      for (const row of rows) {
        seenPartyIds.add(row.id);
        matches.push({
          partyId: row.id,
          name: row.name,
          gstin: row.vendorProfile?.gstin ?? null,
          panNumber: row.vendorProfile?.panNumber ?? panNumber,
          cityName: row.city?.name ?? null,
          matchType: 'EXACT_PAN',
          hasVendorProfile: true,
        });
      }
    }

    // Soft warning: normalized (case-insensitive) exact name match,
    // optionally narrowed by city — not fuzzy-string-distance, by design.
    if (input.name.trim()) {
      const rows = await this.prisma.client.party.findMany({
        where: {
          organizationId: input.organizationId,
          deletedAt: null,
          name: { equals: input.name.trim(), mode: 'insensitive' },
          ...(input.cityId ? { cityId: input.cityId } : {}),
          id: { notIn: Array.from(seenPartyIds) },
        },
        include: { vendorProfile: true, city: true },
      });
      for (const row of rows) {
        matches.push({
          partyId: row.id,
          name: row.name,
          gstin: row.vendorProfile?.gstin ?? null,
          panNumber: row.vendorProfile?.panNumber ?? null,
          cityName: row.city?.name ?? null,
          matchType: 'NAME_CITY',
          hasVendorProfile: row.vendorProfile !== null,
        });
      }
    }

    return matches;
  }

  async create(input: {
    organizationId: string;
    existingPartyId: string | undefined;
    name: string;
    shortCode: string | undefined;
    gstin: string | undefined;
    panNumber: string | undefined;
    paymentTerms: VendorPaymentTerms | undefined;
    stateId: string | undefined;
    districtId: string | undefined;
    cityId: string | undefined;
    pinCode: string | undefined;
    officeAddress: string | undefined;
    internalNote: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<VendorDetail> {
    const gstin = normalizeIdentifier(input.gstin);
    const panNumber = normalizeIdentifier(input.panNumber);
    if (gstin && !GSTIN_REGEX.test(gstin)) throwAppError('VALIDATION_FAILED', 'GSTIN format is invalid.');
    if (panNumber && !PAN_REGEX.test(panNumber)) throwAppError('VALIDATION_FAILED', 'PAN format is invalid.');

    if (gstin) {
      const existing = await this.prisma.client.vendorProfile.findFirst({
        where: { organizationId: input.organizationId, gstin, deletedAt: null },
      });
      if (existing) throwAppError('VALIDATION_FAILED', 'This GSTIN is already registered to another vendor.');
    }

    try {
      const partyId = await this.prisma.client.$transaction(async (tx) => {
        let resolvedPartyId: string;
        if (input.existingPartyId) {
          const existingParty = await tx.party.findFirst({
            where: { id: input.existingPartyId, organizationId: input.organizationId, deletedAt: null },
            include: { vendorProfile: true },
          });
          if (!existingParty) throwAppError('NOT_FOUND', 'Party not found.');
          if (existingParty.vendorProfile) throwAppError('VALIDATION_FAILED', 'This party already has a vendor profile.');
          resolvedPartyId = existingParty.id;
        } else {
          const party = await tx.party.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              name: input.name,
              shortCode: input.shortCode ?? null,
              stateId: input.stateId ?? null,
              districtId: input.districtId ?? null,
              cityId: input.cityId ?? null,
              pinCode: input.pinCode ?? null,
              officeAddress: input.officeAddress ?? null,
              internalNote: input.internalNote ?? null,
              createdBy: input.actorId,
            },
          });
          resolvedPartyId = party.id;
        }

        await tx.vendorProfile.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            partyId: resolvedPartyId,
            gstin: gstin ?? null,
            panNumber: panNumber ?? null,
            paymentTerms: input.paymentTerms ?? null,
            createdBy: input.actorId,
          },
        });

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'VENDOR',
          entityId: resolvedPartyId,
          action: 'VENDOR_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { name: input.name, gstin: gstin ?? null, panNumber: panNumber ?? null, existingPartyId: input.existingPartyId ?? null },
        });

        return resolvedPartyId;
      });
      return this.getDetail({ organizationId: input.organizationId, id: partyId });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Invalid GSTIN/PAN format, or this GSTIN is already registered to another vendor.');
      }
      throw error;
    }
  }

  async update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    shortCode: string | undefined;
    gstin: string | undefined;
    panNumber: string | undefined;
    paymentTerms: VendorPaymentTerms | undefined;
    stateId: string | undefined;
    districtId: string | undefined;
    cityId: string | undefined;
    pinCode: string | undefined;
    officeAddress: string | undefined;
    internalNote: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<VendorDetail> {
    const gstin = input.gstin !== undefined ? normalizeIdentifier(input.gstin) : undefined;
    const panNumber = input.panNumber !== undefined ? normalizeIdentifier(input.panNumber) : undefined;
    if (input.gstin !== undefined && gstin && !GSTIN_REGEX.test(gstin)) throwAppError('VALIDATION_FAILED', 'GSTIN format is invalid.');
    if (input.panNumber !== undefined && panNumber && !PAN_REGEX.test(panNumber)) throwAppError('VALIDATION_FAILED', 'PAN format is invalid.');

    if (gstin) {
      const existing = await this.prisma.client.vendorProfile.findFirst({
        where: { organizationId: input.organizationId, gstin, deletedAt: null, partyId: { not: input.id } },
      });
      if (existing) throwAppError('VALIDATION_FAILED', 'This GSTIN is already registered to another vendor.');
    }

    const partyData: Record<string, unknown> = { updatedBy: input.actorId };
    if (input.name !== undefined) partyData.name = input.name;
    if (input.shortCode !== undefined) partyData.shortCode = input.shortCode;
    if (input.stateId !== undefined) partyData.stateId = input.stateId;
    if (input.districtId !== undefined) partyData.districtId = input.districtId;
    if (input.cityId !== undefined) partyData.cityId = input.cityId;
    if (input.pinCode !== undefined) partyData.pinCode = input.pinCode;
    if (input.officeAddress !== undefined) partyData.officeAddress = input.officeAddress;
    if (input.internalNote !== undefined) partyData.internalNote = input.internalNote;

    const profileData: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.gstin !== undefined) profileData.gstin = gstin ?? null;
    if (input.panNumber !== undefined) profileData.panNumber = panNumber ?? null;
    if (input.paymentTerms !== undefined) profileData.paymentTerms = input.paymentTerms;

    try {
      await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.party.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
          include: { vendorProfile: true },
        });
        if (!before.vendorProfile) throwAppError('NOT_FOUND', 'Vendor not found.');

        const { count } = await tx.vendorProfile.updateMany({
          where: { partyId: input.id, organizationId: input.organizationId, version: input.expectedVersion },
          data: profileData,
        });
        if (count === 0) throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
        await tx.party.update({ where: { id: input.id }, data: partyData });

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'VENDOR',
          entityId: input.id,
          action: 'VENDOR_UPDATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { name: input.name, gstin, panNumber, paymentTerms: input.paymentTerms },
        });
      });
      return this.getDetail({ organizationId: input.organizationId, id: input.id });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Invalid GSTIN/PAN format, or this GSTIN is already registered to another vendor.');
      }
      throw error;
    }
  }

  /** Flips ONLY VendorProfile.isActive — never Party.isActive, so a Party
   * that is also an active Client (or any other role) is left untouched
   * (Phase 6.1 fix; see VendorProfile's schema doc comment, and the
   * matching fix in ClientsService.setActive). */
  async setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.vendorProfile.updateMany({
        where: { partyId: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR',
        entityId: input.id,
        action: input.isActive ? 'VENDOR_ACTIVATED' : 'VENDOR_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }
}
