import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { ClientDetail, ClientPort, ClientSummary, ContactInput, ContactSummary } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

const PARTY_WITH_CLIENT_INCLUDE = {
  clientProfile: { include: { clientType: true } },
  state: true,
  district: true,
  city: true,
  contacts: { orderBy: { sortOrder: 'asc' as const } },
  _count: { select: { leads: true, projects: true } },
};

interface ContactRow {
  id: string;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
}

interface PartyWithClient {
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
  clientProfile: {
    id: string;
    department: string | null;
    gstin: string | null;
    clientTypeId: string | null;
    isActive: boolean;
    version: number;
    clientType: { name: string } | null;
  } | null;
  contacts: ContactRow[];
  _count: { leads: number; projects: number };
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}

function toContactSummary(row: ContactRow): ContactSummary {
  return { id: row.id, name: row.name, designation: row.designation, phone: row.phone, email: row.email };
}

function toClientSummary(row: PartyWithClient): ClientSummary {
  return {
    id: row.id,
    name: row.name,
    shortCode: row.shortCode,
    department: row.clientProfile!.department,
    clientTypeId: row.clientProfile!.clientTypeId,
    clientTypeName: row.clientProfile!.clientType?.name ?? null,
    stateId: row.stateId,
    stateName: row.state?.name ?? null,
    districtId: row.districtId,
    districtName: row.district?.name ?? null,
    cityId: row.cityId,
    cityName: row.city?.name ?? null,
    contactCount: row.contacts.length,
    leadCount: row._count.leads,
    projectCount: row._count.projects,
    isActive: row.clientProfile!.isActive && row.isActive,
    createdAt: row.createdAt.toISOString(),
    version: row.clientProfile!.version,
  };
}

function toClientDetail(row: PartyWithClient): ClientDetail {
  return {
    ...toClientSummary(row),
    pinCode: row.pinCode,
    officeAddress: row.officeAddress,
    internalNote: row.internalNote,
    gstin: row.clientProfile!.gstin,
    contacts: row.contacts.map(toContactSummary),
  };
}

@Injectable()
export class ClientsService implements ClientPort {
  constructor(private readonly prisma: PrismaService) {}

  private async assertGeographyHierarchy(input: {
    stateId: string | undefined;
    districtId: string | undefined;
    cityId: string | undefined;
  }): Promise<void> {
    if (input.districtId) {
      const district = await this.prisma.client.district.findFirst({ where: { id: input.districtId } });
      if (!district) throwAppError('VALIDATION_FAILED', 'The selected district does not exist.');
      if (input.stateId && district.stateId !== input.stateId) {
        throwAppError('VALIDATION_FAILED', 'The selected district does not belong to the selected state.');
      }
    }
    if (input.cityId) {
      const city = await this.prisma.client.city.findFirst({ where: { id: input.cityId } });
      if (!city) throwAppError('VALIDATION_FAILED', 'The selected city does not exist.');
      if (input.districtId && city.districtId !== input.districtId) {
        throwAppError('VALIDATION_FAILED', 'The selected city does not belong to the selected district.');
      }
    }
  }

  async list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<ClientSummary[]> {
    const rows = await this.prisma.client.party.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        // Selectable only when BOTH the party-level master switch and the
        // client role itself are active — a Party can independently also
        // be an active Vendor (Phase 6.1), so this can no longer just
        // check Party.isActive alone.
        ...(input.includeInactive
          ? { clientProfile: { isNot: null } }
          : { isActive: true, clientProfile: { is: { isActive: true } } }),
      },
      include: PARTY_WITH_CLIENT_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.filter((row) => row.clientProfile !== null).map((row) => toClientSummary(row as PartyWithClient));
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<ClientDetail> {
    const row = await this.prisma.client.party.findFirst({
      where: { id: input.id, organizationId: input.organizationId, deletedAt: null, clientProfile: { isNot: null } },
      include: PARTY_WITH_CLIENT_INCLUDE,
    });
    if (!row || !row.clientProfile) {
      throwAppError('NOT_FOUND', 'Client not found.');
    }
    return toClientDetail(row);
  }

  async create(input: {
    organizationId: string;
    name: string;
    shortCode: string | undefined;
    clientTypeId: string | undefined;
    department: string | undefined;
    stateId: string | undefined;
    districtId: string | undefined;
    cityId: string | undefined;
    pinCode: string | undefined;
    officeAddress: string | undefined;
    gstin: string | undefined;
    internalNote: string | undefined;
    contacts: ContactInput[];
    actorId: string;
    correlationId: string;
  }): Promise<ClientDetail> {
    await this.assertGeographyHierarchy(input);

    try {
      const partyId = await this.prisma.client.$transaction(async (tx) => {
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
        await tx.clientProfile.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            partyId: party.id,
            clientTypeId: input.clientTypeId ?? null,
            department: blankToNull(input.department),
            gstin: input.gstin ?? null,
            createdBy: input.actorId,
          },
        });
        for (const [index, contact] of input.contacts.entries()) {
          await tx.contact.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              partyId: party.id,
              name: contact.name,
              designation: contact.designation ?? null,
              phone: contact.phone ?? null,
              email: contact.email ?? null,
              sortOrder: index,
              createdBy: input.actorId,
            },
          });
        }
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'CLIENT',
          entityId: party.id,
          action: 'CLIENT_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { name: input.name, department: blankToNull(input.department), contactCount: input.contacts.length },
        });
        return party.id;
      });
      return this.getDetail({ organizationId: input.organizationId, id: partyId });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Could not save this client.');
      }
      throw error;
    }
  }

  async update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    shortCode: string | undefined;
    clientTypeId: string | undefined;
    department: string | undefined;
    stateId: string | undefined;
    districtId: string | undefined;
    cityId: string | undefined;
    pinCode: string | undefined;
    officeAddress: string | undefined;
    gstin: string | undefined;
    internalNote: string | undefined;
    contacts: ContactInput[] | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<ClientDetail> {
    await this.assertGeographyHierarchy(input);

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
    if (input.clientTypeId !== undefined) profileData.clientTypeId = input.clientTypeId;
    const department = input.department === undefined ? undefined : blankToNull(input.department);
    if (department !== undefined) profileData.department = department;
    if (input.gstin !== undefined) profileData.gstin = input.gstin;

    try {
      await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.party.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
          include: { clientProfile: true, contacts: true },
        });
        if (!before.clientProfile) {
          throwAppError('NOT_FOUND', 'Client not found.');
        }

        const { count } = await tx.clientProfile.updateMany({
          where: {
            partyId: input.id,
            organizationId: input.organizationId,
            version: input.expectedVersion,
          },
          data: profileData,
        });
        if (count === 0) {
          throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
        }
        await tx.party.update({ where: { id: input.id }, data: partyData });

        if (input.contacts !== undefined) {
          await tx.contact.deleteMany({ where: { partyId: input.id, organizationId: input.organizationId } });
          for (const [index, contact] of input.contacts.entries()) {
            await tx.contact.create({
              data: {
                id: contact.id ?? generateId(),
                organizationId: input.organizationId,
                partyId: input.id,
                name: contact.name,
                designation: contact.designation ?? null,
                phone: contact.phone ?? null,
                email: contact.email ?? null,
                sortOrder: index,
                createdBy: input.actorId,
              },
            });
          }
        }

        const oldValues: Record<string, unknown> = {};
        const newValues: Record<string, unknown> = {};
        const track = (key: string, beforeValue: unknown, afterValue: unknown, touched: boolean) => {
          if (touched && beforeValue !== afterValue) {
            oldValues[key] = beforeValue;
            newValues[key] = afterValue;
          }
        };
        track('name', before.name, input.name, input.name !== undefined);
        track('department', before.clientProfile.department, department, department !== undefined);
        track('gstin', before.clientProfile.gstin, input.gstin, input.gstin !== undefined);
        track('clientTypeId', before.clientProfile.clientTypeId, input.clientTypeId, input.clientTypeId !== undefined);
        if (input.contacts !== undefined) {
          oldValues.contactCount = before.contacts.length;
          newValues.contactCount = input.contacts.length;
        }

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'CLIENT',
          entityId: input.id,
          action: 'CLIENT_UPDATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          oldValues,
          newValues,
        });
      });
      return this.getDetail({ organizationId: input.organizationId, id: input.id });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Could not save this client.');
      }
      throw error;
    }
  }

  /** Flips ONLY ClientProfile.isActive — never Party.isActive, so a Party
   * that is also an active Vendor (Phase 6.1) is left untouched. See
   * VendorProfile's schema doc comment and VendorsService.setActive's
   * matching fix. */
  async setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.clientProfile.updateMany({
        where: { partyId: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'CLIENT',
        entityId: input.id,
        action: input.isActive ? 'CLIENT_ACTIVATED' : 'CLIENT_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }
}
