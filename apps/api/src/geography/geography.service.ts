import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent, Prisma } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { GeographyPort } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

@Injectable()
export class GeographyService implements GeographyPort {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Reads ------------------------------------------------------------

  async getCounts() {
    const [states, districts, cities] = await Promise.all([
      this.prisma.client.state.count({ where: { deletedAt: null } }),
      this.prisma.client.district.count({ where: { deletedAt: null } }),
      this.prisma.client.city.count({ where: { deletedAt: null } }),
    ]);
    return { states, districts, cities };
  }

  async listStates(input?: { includeInactive?: boolean }) {
    const states = await this.prisma.client.state.findMany({
      where: { deletedAt: null, ...(input?.includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
    return states.map((state) => ({
      id: state.id,
      name: state.name,
      code: state.code,
      gstStateCode: state.gstStateCode,
      isActive: state.isActive,
      version: state.version,
    }));
  }

  async listDistricts(input: { stateId: string; includeInactive?: boolean }) {
    const districts = await this.prisma.client.district.findMany({
      where: { stateId: input.stateId, deletedAt: null, ...(input.includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
    return districts.map((district) => ({
      id: district.id,
      stateId: district.stateId,
      name: district.name,
      isActive: district.isActive,
      version: district.version,
    }));
  }

  async listCities(input: { districtId: string; includeInactive?: boolean }) {
    const cities = await this.prisma.client.city.findMany({
      where: { districtId: input.districtId, deletedAt: null, ...(input.includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
    return cities.map((city) => ({
      id: city.id,
      districtId: city.districtId,
      stateId: city.stateId,
      name: city.name,
      isActive: city.isActive,
      version: city.version,
    }));
  }

  // ---- States -----------------------------------------------------------

  async createState(input: {
    name: string;
    code: string;
    gstStateCode: string;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }) {
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const state = await tx.state.create({
          data: {
            id: generateId(),
            name: input.name,
            code: input.code,
            gstStateCode: input.gstStateCode,
            createdBy: input.actorId,
          },
        });
        await this.audit(tx, input.organizationId, 'STATE', state.id, 'MASTER_CREATED', input.actorId, input.correlationId, {
          name: input.name,
          code: input.code,
          gstStateCode: input.gstStateCode,
        });
        return state;
      });
      return this.toStateSummary(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A state with this name, code or GST state code already exists.');
      }
      throw error;
    }
  }

  async updateState(input: {
    id: string;
    name: string | undefined;
    code: string | undefined;
    gstStateCode: string | undefined;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }) {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.code !== undefined) data.code = input.code;
    if (input.gstStateCode !== undefined) data.gstStateCode = input.gstStateCode;

    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const { count } = await tx.state.updateMany({
          where: { id: input.id, version: input.expectedVersion },
          data,
        });
        if (count === 0) {
          throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
        }
        const state = await tx.state.findFirstOrThrow({ where: { id: input.id } });
        await this.audit(tx, input.organizationId, 'STATE', state.id, 'MASTER_UPDATED', input.actorId, input.correlationId, {
          name: input.name,
          code: input.code,
          gstStateCode: input.gstStateCode,
        });
        return state;
      });
      return this.toStateSummary(updated);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A state with this name, code or GST state code already exists.');
      }
      throw error;
    }
  }

  async setStateActive(input: {
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }) {
    await this.setActive(input, 'state', 'STATE');
  }

  // ---- Districts --------------------------------------------------------

  async createDistrict(input: {
    stateId: string;
    name: string;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }) {
    const state = await this.prisma.client.state.findFirst({
      where: { id: input.stateId, isActive: true, deletedAt: null },
    });
    if (!state) {
      throwAppError('VALIDATION_FAILED', 'The selected state does not exist or is inactive.');
    }

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const district = await tx.district.create({
          data: { id: generateId(), stateId: input.stateId, name: input.name, createdBy: input.actorId },
        });
        await this.audit(tx, input.organizationId, 'DISTRICT', district.id, 'MASTER_CREATED', input.actorId, input.correlationId, {
          name: input.name,
          stateId: input.stateId,
        });
        return district;
      });
      return this.toDistrictSummary(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A district with this name already exists in the selected state.');
      }
      throw error;
    }
  }

  async updateDistrict(input: {
    id: string;
    name: string | undefined;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }) {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;

    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const { count } = await tx.district.updateMany({ where: { id: input.id, version: input.expectedVersion }, data });
        if (count === 0) {
          throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
        }
        const district = await tx.district.findFirstOrThrow({ where: { id: input.id } });
        await this.audit(tx, input.organizationId, 'DISTRICT', district.id, 'MASTER_UPDATED', input.actorId, input.correlationId, {
          name: input.name,
        });
        return district;
      });
      return this.toDistrictSummary(updated);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A district with this name already exists in the selected state.');
      }
      throw error;
    }
  }

  async setDistrictActive(input: {
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }) {
    await this.setActive(input, 'district', 'DISTRICT');
  }

  // ---- Cities -----------------------------------------------------------

  async createCity(input: {
    districtId: string;
    name: string;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }) {
    const district = await this.prisma.client.district.findFirst({
      where: { id: input.districtId, isActive: true, deletedAt: null },
    });
    if (!district) {
      throwAppError('VALIDATION_FAILED', 'The selected district does not exist or is inactive.');
    }

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        // state_id is derived from the district so it can never disagree; the
        // cities(district_id, state_id) -> districts(id, state_id) composite
        // FK (ADR-036) enforces this at the database level too.
        const city = await tx.city.create({
          data: {
            id: generateId(),
            districtId: input.districtId,
            stateId: district.stateId,
            name: input.name,
            createdBy: input.actorId,
          },
        });
        await this.audit(tx, input.organizationId, 'CITY', city.id, 'MASTER_CREATED', input.actorId, input.correlationId, {
          name: input.name,
          districtId: input.districtId,
        });
        return city;
      });
      return this.toCitySummary(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A city with this name already exists in the selected district.');
      }
      throw error;
    }
  }

  async updateCity(input: {
    id: string;
    name: string | undefined;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }) {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;

    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const { count } = await tx.city.updateMany({ where: { id: input.id, version: input.expectedVersion }, data });
        if (count === 0) {
          throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
        }
        const city = await tx.city.findFirstOrThrow({ where: { id: input.id } });
        await this.audit(tx, input.organizationId, 'CITY', city.id, 'MASTER_UPDATED', input.actorId, input.correlationId, {
          name: input.name,
        });
        return city;
      });
      return this.toCitySummary(updated);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A city with this name already exists in the selected district.');
      }
      throw error;
    }
  }

  async setCityActive(input: {
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }) {
    await this.setActive(input, 'city', 'CITY');
  }

  // ---- Shared helpers ---------------------------------------------------

  private async setActive(
    input: {
      id: string;
      isActive: boolean;
      expectedVersion: number;
      actorId: string;
      organizationId: string;
      correlationId: string;
    },
    model: 'state' | 'district' | 'city',
    entityType: 'STATE' | 'DISTRICT' | 'CITY',
  ) {
    const data = { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } };
    await this.prisma.client.$transaction(async (tx) => {
      const delegate = tx[model] as unknown as {
        updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
      };
      const { count } = await delegate.updateMany({ where: { id: input.id, version: input.expectedVersion }, data });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await this.audit(
        tx,
        input.organizationId,
        entityType,
        input.id,
        input.isActive ? 'MASTER_ACTIVATED' : 'MASTER_DEACTIVATED',
        input.actorId,
        input.correlationId,
      );
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    organizationId: string,
    entityType: 'STATE' | 'DISTRICT' | 'CITY',
    entityId: string,
    action: string,
    actorId: string,
    correlationId: string,
    newValues?: Record<string, unknown>,
  ) {
    // Geography rows are global, but audit_events is org-scoped — attribute
    // the change to the acting admin's organization (ADR-044).
    await recordAuditEvent(tx, {
      organizationId,
      entityType,
      entityId,
      action,
      actorId,
      correlationId,
      ...(newValues ? { newValues } : {}),
    });
  }

  private toStateSummary(state: { id: string; name: string; code: string; gstStateCode: string; isActive: boolean; version: number }) {
    return {
      id: state.id,
      name: state.name,
      code: state.code,
      gstStateCode: state.gstStateCode,
      isActive: state.isActive,
      version: state.version,
    };
  }

  private toDistrictSummary(district: { id: string; stateId: string; name: string; isActive: boolean; version: number }) {
    return { id: district.id, stateId: district.stateId, name: district.name, isActive: district.isActive, version: district.version };
  }

  private toCitySummary(city: { id: string; districtId: string; stateId: string; name: string; isActive: boolean; version: number }) {
    return {
      id: city.id,
      districtId: city.districtId,
      stateId: city.stateId,
      name: city.name,
      isActive: city.isActive,
      version: city.version,
    };
  }
}
