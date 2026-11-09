import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { PROJECT_MANAGER_DESIGNATIONS, SALES_MANAGER_DESIGNATIONS, throwAppError } from '@zitaware/contracts';
import type {
  ProjectManagerCandidates,
  ProjectPort,
  ProjectProgressSummary,
  ProjectSummary,
  ProjectTeamMemberSummary,
  ProjectExpenseCategory,
  ProjectExpenseRow,
  ProjectExpenseLedger,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';
// The one shared allocation-splitting formula (ADR-095), reused here so the
// project's Spend ledger and the Manpower Cost report can never disagree.
import { allocateSalary } from '../employee-allocations/allocation-cost.util';

// docs/05-workflows-state-machines.md — a Project only ever exists after
// something was won, so WON is the first (not a "not started") stage.
const STAGES = [
  'WON',
  'WORK_ORDER_RECEIVED',
  'WAITING_FOR_PERMISSIONS',
  'WORK_STARTED',
  'WORK_DONE',
  'SUCCESSFULLY_COMPLETED',
];
const STATUSES = ['ACTIVE', 'ON_HOLD', 'CANCELLED', 'CLOSED'];
const TERMINAL_STATUSES = ['CANCELLED', 'CLOSED'];

// ADR-153: a designation qualifies by name or code, so "Project Manager"
// and a code of "project-manager" both match.
const designationKey = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '');
const PROJECT_MANAGER_KEYS = new Set<string>(PROJECT_MANAGER_DESIGNATIONS.map(designationKey));
const SALES_MANAGER_KEYS = new Set<string>(SALES_MANAGER_DESIGNATIONS.map(designationKey));
const holdsDesignation = (designation: { code: string; name: string } | null, keys: Set<string>) =>
  !!designation && (keys.has(designationKey(designation.name)) || keys.has(designationKey(designation.code)));

const PROJECT_INCLUDE = {
  client: true,
  legalEntity: true,
  lead: true,
  tender: true,
  projectManager: true,
  salesManager: true,
  introducer: true,
  projectType: true,
};

interface ProjectRow {
  id: string;
  clientId: string;
  legalEntityId: string;
  leadId: string | null;
  tenderId: string | null;
  projectManagerId: string | null;
  salesManagerId: string | null;
  introducerId: string | null;
  projectTypeId: string | null;
  name: string;
  description: string | null;
  stage: string;
  operationalStatus: string;
  value: { toString(): string } | null;
  budget: { toString(): string } | null;
  gstApplicable: boolean;
  workOrderNumber: string | null;
  workOrderDate: Date | null;
  createdAt: Date;
  version: number;
  client: { name: string };
  legalEntity: { legalName: string };
  lead: { title: string } | null;
  tender: { title: string } | null;
  projectManager: { fullName: string } | null;
  salesManager: { fullName: string } | null;
  introducer: { name: string } | null;
  projectType: { name: string } | null;
}

function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    leadId: row.leadId,
    leadTitle: row.lead?.title ?? null,
    tenderId: row.tenderId,
    tenderTitle: row.tender?.title ?? null,
    projectManagerId: row.projectManagerId,
    projectManagerName: row.projectManager?.fullName ?? null,
    salesManagerId: row.salesManagerId,
    salesManagerName: row.salesManager?.fullName ?? null,
    introducerId: row.introducerId,
    introducerName: row.introducer?.name ?? null,
    projectTypeId: row.projectTypeId,
    projectTypeName: row.projectType?.name ?? null,
    name: row.name,
    description: row.description,
    stage: row.stage,
    operationalStatus: row.operationalStatus,
    value: row.value?.toString() ?? null,
    budget: row.budget?.toString() ?? null,
    gstApplicable: row.gstApplicable,
    workOrderNumber: row.workOrderNumber,
    workOrderDate: toDateOnly(row.workOrderDate),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

@Injectable()
export class ProjectsService implements ProjectPort {
  constructor(private readonly prisma: PrismaService) {}

  /** "Assigned to a project" = projectManagerId or salesManagerId match OR a
   * ProjectTeamMember row — see ADR-058 and ADR-152. `null` means the actor has no linked Employee, so
   * they can't be assigned to anything. */
  private async resolveActorEmployeeId(organizationId: string, actorId: string): Promise<string | null> {
    const employee = await this.prisma.client.employee.findFirst({
      where: { organizationId, userId: actorId },
    });
    return employee?.id ?? null;
  }

  private buildScopeWhere(employeeId: string) {
    return {
      OR: [{ projectManagerId: employeeId }, { salesManagerId: employeeId }, { teamMembers: { some: { employeeId } } }],
    };
  }

  private async assertReferencesExist(input: {
    organizationId: string;
    leadId: string | null | undefined;
    tenderId: string | null | undefined;
    projectManagerId: string | null | undefined;
    salesManagerId?: string | null | undefined;
    introducerId: string | null | undefined;
    projectTypeId: string | null | undefined;
  }): Promise<void> {
    if (input.leadId) {
      const row = await this.prisma.client.lead.findFirst({
        where: { id: input.leadId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected lead does not exist.');
    }
    if (input.tenderId) {
      const row = await this.prisma.client.tender.findFirst({
        where: { id: input.tenderId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected tender does not exist.');
    }
    if (input.projectManagerId) {
      const row = await this.prisma.client.employee.findFirst({
        where: { id: input.projectManagerId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected project manager does not exist.');
    }
    if (input.salesManagerId) {
      const row = await this.prisma.client.employee.findFirst({
        where: { id: input.salesManagerId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected sales manager does not exist.');
    }
    if (input.introducerId) {
      const row = await this.prisma.client.introducer.findFirst({
        where: { id: input.introducerId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected introducer does not exist.');
    }
    if (input.projectTypeId) {
      const row = await this.prisma.client.projectType.findFirst({
        where: { id: input.projectTypeId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected project type does not exist.');
    }
  }

  /** Rejects a project or sales manager whose designation does not qualify
   * (ADR-153) or who works for another legal entity (ADR-154). Pass only the
   * managers being set or changed. */
  private async assertManagerDesignations(input: {
    organizationId: string;
    legalEntityId: string | undefined;
    projectManagerId: string | null | undefined;
    salesManagerId: string | null | undefined;
  }): Promise<void> {
    const checks = [
      { id: input.projectManagerId, keys: PROJECT_MANAGER_KEYS, message: `The project manager must be a ${PROJECT_MANAGER_DESIGNATIONS.join(' or ')}.` },
      { id: input.salesManagerId, keys: SALES_MANAGER_KEYS, message: `The sales manager must be a ${SALES_MANAGER_DESIGNATIONS.join(' or ')}.` },
    ];
    for (const check of checks) {
      if (!check.id) continue;
      const employee = await this.prisma.client.employee.findFirst({
        where: { id: check.id, organizationId: input.organizationId },
        select: { legalEntityId: true, designation: { select: { code: true, name: true } } },
      });
      if (!holdsDesignation(employee?.designation ?? null, check.keys)) throwAppError('VALIDATION_FAILED', check.message);
      if (employee?.legalEntityId !== input.legalEntityId) {
        throwAppError('VALIDATION_FAILED', "A project's managers must be employees of the project's legal entity.");
      }
    }
  }

  async listManagerCandidates(input: { organizationId: string; legalEntityId: string }): Promise<ProjectManagerCandidates> {
    const employees = await this.prisma.client.employee.findMany({
      where: {
        organizationId: input.organizationId,
        legalEntityId: input.legalEntityId,
        deletedAt: null,
        status: 'ACTIVE',
        designationId: { not: null },
      },
      select: { id: true, fullName: true, designation: { select: { code: true, name: true } } },
      orderBy: { fullName: 'asc' },
    });
    const pick = (keys: Set<string>) =>
      employees
        .filter((e) => holdsDesignation(e.designation, keys))
        .map((e) => ({ id: e.id, fullName: e.fullName, designationName: e.designation!.name }));
    return { projectManagers: pick(PROJECT_MANAGER_KEYS), salesManagers: pick(SALES_MANAGER_KEYS) };
  }

  async list(input: { organizationId: string; actorId: string; canSeeAll: boolean }): Promise<ProjectSummary[]> {
    let scopeWhere: object | undefined;
    if (!input.canSeeAll) {
      const employeeId = await this.resolveActorEmployeeId(input.organizationId, input.actorId);
      if (!employeeId) return [];
      scopeWhere = this.buildScopeWhere(employeeId);
    }
    const rows = await this.prisma.client.project.findMany({
      where: { organizationId: input.organizationId, ...scopeWhere },
      include: PROJECT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => toProjectSummary(row as ProjectRow));
  }

  async getDetail(input: {
    organizationId: string;
    id: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ProjectSummary> {
    let scopeWhere: object | undefined;
    if (!input.canSeeAll) {
      const employeeId = await this.resolveActorEmployeeId(input.organizationId, input.actorId);
      if (!employeeId) throwAppError('NOT_FOUND', 'Project not found.');
      scopeWhere = this.buildScopeWhere(employeeId);
    }
    const row = await this.prisma.client.project.findFirst({
      where: { id: input.id, organizationId: input.organizationId, ...scopeWhere },
      include: PROJECT_INCLUDE,
    });
    if (!row) throwAppError('NOT_FOUND', 'Project not found.');
    return toProjectSummary(row);
  }

  async create(input: {
    organizationId: string;
    clientId: string;
    legalEntityId: string;
    leadId: string | undefined;
    tenderId: string | undefined;
    projectManagerId: string | undefined;
    salesManagerId?: string | undefined;
    introducerId: string | undefined;
    projectTypeId: string | undefined;
    name: string;
    description: string | undefined;
    value: string | undefined;
    budget: string | undefined;
    gstApplicable: boolean | undefined;
    workOrderNumber: string | undefined;
    workOrderDate: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<ProjectSummary> {
    await this.assertReferencesExist(input);
    await this.assertManagerDesignations({
      organizationId: input.organizationId,
      legalEntityId: input.legalEntityId,
      projectManagerId: input.projectManagerId,
      salesManagerId: input.salesManagerId,
    });

    const client = await this.prisma.client.party.findFirst({
      where: { id: input.clientId, organizationId: input.organizationId, deletedAt: null, clientProfile: { isNot: null } },
    });
    if (!client) throwAppError('VALIDATION_FAILED', 'The selected client does not exist.');

    const legalEntity = await this.prisma.client.legalEntity.findFirst({
      where: { id: input.legalEntityId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!legalEntity) throwAppError('VALIDATION_FAILED', 'The selected legal entity does not exist.');

    try {
      const projectId = await this.prisma.client.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            clientId: input.clientId,
            legalEntityId: input.legalEntityId,
            leadId: input.leadId ?? null,
            tenderId: input.tenderId ?? null,
            projectManagerId: input.projectManagerId ?? null,
            salesManagerId: input.salesManagerId ?? null,
            introducerId: input.introducerId ?? null,
            projectTypeId: input.projectTypeId ?? null,
            name: input.name,
            description: input.description ?? null,
            value: input.value ?? null,
            budget: input.budget ?? null,
            gstApplicable: input.gstApplicable ?? true,
            workOrderNumber: input.workOrderNumber ?? null,
            workOrderDate: input.workOrderDate ? new Date(`${input.workOrderDate}T00:00:00.000Z`) : null,
            stage: 'WORK_STARTED',
            createdBy: input.actorId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'PROJECT',
          entityId: project.id,
          action: 'PROJECT_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { name: input.name, clientId: input.clientId, stage: project.stage },
        });
        return project.id;
      });
      return this.getDetail({ organizationId: input.organizationId, id: projectId, actorId: input.actorId, canSeeAll: true });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Invalid project data.');
      }
      throw error;
    }
  }

  async update(input: {
    organizationId: string;
    id: string;
    leadId: string | null | undefined;
    tenderId: string | undefined;
    projectManagerId: string | null | undefined;
    salesManagerId?: string | null | undefined;
    introducerId: string | null | undefined;
    projectTypeId: string | null | undefined;
    name: string | undefined;
    description: string | undefined;
    value: string | undefined;
    budget: string | undefined;
    gstApplicable: boolean | undefined;
    workOrderNumber: string | undefined;
    workOrderDate: string | null | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<ProjectSummary> {
    await this.assertReferencesExist(input);
    // Only a manager being changed must qualify, so a project saved before
    // ADR-153 with any employee as manager can still be edited.
    const saved = await this.prisma.client.project.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      select: { legalEntityId: true, projectManagerId: true, salesManagerId: true },
    });
    await this.assertManagerDesignations({
      organizationId: input.organizationId,
      legalEntityId: saved?.legalEntityId,
      projectManagerId: input.projectManagerId !== saved?.projectManagerId ? input.projectManagerId : undefined,
      salesManagerId: input.salesManagerId !== saved?.salesManagerId ? input.salesManagerId : undefined,
    });

    let scopeWhere: object | undefined;
    if (!input.canSeeAll) {
      const employeeId = await this.resolveActorEmployeeId(input.organizationId, input.actorId);
      if (!employeeId) throwAppError('NOT_FOUND', 'Project not found.');
      scopeWhere = this.buildScopeWhere(employeeId);
    }

    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.leadId !== undefined) data.leadId = input.leadId;
    if (input.tenderId !== undefined) data.tenderId = input.tenderId;
    if (input.projectManagerId !== undefined) data.projectManagerId = input.projectManagerId;
    if (input.salesManagerId !== undefined) data.salesManagerId = input.salesManagerId;
    if (input.introducerId !== undefined) data.introducerId = input.introducerId;
    if (input.projectTypeId !== undefined) data.projectTypeId = input.projectTypeId;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.value !== undefined) data.value = input.value;
    if (input.budget !== undefined) data.budget = input.budget;
    if (input.gstApplicable !== undefined) data.gstApplicable = input.gstApplicable;
    if (input.workOrderNumber !== undefined) data.workOrderNumber = input.workOrderNumber;
    if (input.workOrderDate !== undefined) {
      data.workOrderDate = input.workOrderDate ? new Date(`${input.workOrderDate}T00:00:00.000Z`) : null;
    }

    try {
      await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.project.findFirst({
          where: { id: input.id, organizationId: input.organizationId, ...scopeWhere },
        });
        if (!before) throwAppError('NOT_FOUND', 'Project not found.');

        const { count } = await tx.project.updateMany({
          where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
          data,
        });
        if (count === 0) {
          throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
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
        track('projectManagerId', before.projectManagerId, input.projectManagerId, input.projectManagerId !== undefined);
        track('salesManagerId', before.salesManagerId, input.salesManagerId, input.salesManagerId !== undefined);
        track('value', before.value?.toString(), input.value, input.value !== undefined);
        track('budget', before.budget?.toString(), input.budget, input.budget !== undefined);

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'PROJECT',
          entityId: input.id,
          action: 'PROJECT_UPDATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          oldValues,
          newValues,
        });
      });
      return this.getDetail({ organizationId: input.organizationId, id: input.id, actorId: input.actorId, canSeeAll: true });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Invalid project data.');
      }
      throw error;
    }
  }

  async changeStage(input: {
    organizationId: string;
    id: string;
    targetStage: string;
    reason: string | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<ProjectSummary> {
    const targetIndex = STAGES.indexOf(input.targetStage);
    if (targetIndex === -1) {
      throwAppError('VALIDATION_FAILED', `Invalid stage. Must be one of: ${STAGES.join(', ')}.`);
    }

    let scopeWhere: object | undefined;
    if (!input.canSeeAll) {
      const employeeId = await this.resolveActorEmployeeId(input.organizationId, input.actorId);
      if (!employeeId) throwAppError('NOT_FOUND', 'Project not found.');
      scopeWhere = this.buildScopeWhere(employeeId);
    }

    await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.project.findFirst({
        where: { id: input.id, organizationId: input.organizationId, ...scopeWhere },
      });
      if (!before) throwAppError('NOT_FOUND', 'Project not found.');
      if (TERMINAL_STATUSES.includes(before.operationalStatus)) {
        throwAppError('INVALID_STATE_TRANSITION', 'Cannot change the stage of a cancelled or closed project.');
      }

      const currentIndex = STAGES.indexOf(before.stage);
      if (targetIndex === currentIndex) {
        throwAppError('INVALID_STATE_TRANSITION', 'The project is already in this stage.');
      }
      const isBackward = targetIndex < currentIndex;
      if (isBackward && !input.reason?.trim()) {
        throwAppError('VALIDATION_FAILED', 'A reason is required to move a project backward in its stage.');
      }

      const { count } = await tx.project.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { stage: input.targetStage, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PROJECT',
        entityId: input.id,
        action: 'PROJECT_STAGE_CHANGED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { stage: before.stage },
        newValues: { stage: input.targetStage, reason: input.reason ?? null },
      });
    });
    return this.getDetail({ organizationId: input.organizationId, id: input.id, actorId: input.actorId, canSeeAll: true });
  }

  async changeStatus(input: {
    organizationId: string;
    id: string;
    targetStatus: string;
    reason: string | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<ProjectSummary> {
    if (!STATUSES.includes(input.targetStatus)) {
      throwAppError('VALIDATION_FAILED', `Invalid status. Must be one of: ${STATUSES.join(', ')}.`);
    }

    let scopeWhere: object | undefined;
    if (!input.canSeeAll) {
      const employeeId = await this.resolveActorEmployeeId(input.organizationId, input.actorId);
      if (!employeeId) throwAppError('NOT_FOUND', 'Project not found.');
      scopeWhere = this.buildScopeWhere(employeeId);
    }

    await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.project.findFirst({
        where: { id: input.id, organizationId: input.organizationId, ...scopeWhere },
      });
      if (!before) throwAppError('NOT_FOUND', 'Project not found.');
      if (TERMINAL_STATUSES.includes(before.operationalStatus)) {
        throwAppError('INVALID_STATE_TRANSITION', 'Cannot change the status of a cancelled or closed project.');
      }

      const from = before.operationalStatus;
      const to = input.targetStatus;
      const isActiveHoldToggle = (from === 'ACTIVE' && to === 'ON_HOLD') || (from === 'ON_HOLD' && to === 'ACTIVE');
      const isCancel = (from === 'ACTIVE' || from === 'ON_HOLD') && to === 'CANCELLED';
      const isClose = (from === 'ACTIVE' || from === 'ON_HOLD') && to === 'CLOSED';

      if (isCancel && !input.reason?.trim()) {
        throwAppError('VALIDATION_FAILED', 'A reason is required to cancel a project.');
      }
      if (!isActiveHoldToggle && !isCancel && !isClose) {
        throwAppError('INVALID_STATE_TRANSITION', `Cannot change status from ${from} to ${to}.`);
      }

      const { count } = await tx.project.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { operationalStatus: to, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PROJECT',
        entityId: input.id,
        action: 'PROJECT_STATUS_CHANGED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { operationalStatus: from },
        newValues: { operationalStatus: to, reason: input.reason ?? null },
      });
    });
    return this.getDetail({ organizationId: input.organizationId, id: input.id, actorId: input.actorId, canSeeAll: true });
  }

  async listTeamMembers(input: {
    organizationId: string;
    projectId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ProjectTeamMemberSummary[]> {
    // Reuses getDetail's own scope check — throws NOT_FOUND if the actor
    // can't see this project at all.
    await this.getDetail({
      organizationId: input.organizationId,
      id: input.projectId,
      actorId: input.actorId,
      canSeeAll: input.canSeeAll,
    });

    const rows = await this.prisma.client.projectTeamMember.findMany({
      where: { organizationId: input.organizationId, projectId: input.projectId },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      employeeName: row.employee.fullName,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async addTeamMember(input: {
    organizationId: string;
    projectId: string;
    employeeId: string;
    role: string | undefined;
    actorId: string;
    canSeeAll?: boolean;
    correlationId: string;
  }): Promise<ProjectTeamMemberSummary> {
    if (input.canSeeAll === false) {
      await this.getDetail({
        organizationId: input.organizationId,
        id: input.projectId,
        actorId: input.actorId,
        canSeeAll: false,
      });
    }
    const project = await this.prisma.client.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
    });
    if (!project) throwAppError('NOT_FOUND', 'Project not found.');
    if (TERMINAL_STATUSES.includes(project.operationalStatus)) {
      throwAppError('INVALID_STATE_TRANSITION', 'Cannot change the team of a cancelled or closed project.');
    }

    const employee = await this.prisma.client.employee.findFirst({
      where: { id: input.employeeId, organizationId: input.organizationId },
    });
    if (!employee) throwAppError('VALIDATION_FAILED', 'The selected employee does not exist.');
    // ADR-154: not someone from another legal entity. An employee whose
    // legal entity is not set yet is still accepted.
    if (employee.legalEntityId && employee.legalEntityId !== project.legalEntityId) {
      throwAppError('VALIDATION_FAILED', "This employee works for another legal entity than the project's.");
    }

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.projectTeamMember.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            projectId: input.projectId,
            employeeId: input.employeeId,
            role: input.role ?? null,
            createdBy: input.actorId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'PROJECT',
          entityId: input.projectId,
          action: 'PROJECT_TEAM_MEMBER_ADDED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { employeeId: input.employeeId, role: input.role ?? null },
        });
        return {
          id: row.id,
          employeeId: row.employeeId,
          employeeName: employee.fullName,
          role: row.role,
          createdAt: row.createdAt.toISOString(),
        };
      });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'This employee is already assigned to the project.');
      }
      throw error;
    }
  }

  async removeTeamMember(input: {
    organizationId: string;
    projectId: string;
    employeeId: string;
    actorId: string;
    canSeeAll?: boolean;
    correlationId: string;
  }): Promise<void> {
    if (input.canSeeAll === false) {
      await this.getDetail({
        organizationId: input.organizationId,
        id: input.projectId,
        actorId: input.actorId,
        canSeeAll: false,
      });
    }
    const project = await this.prisma.client.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
    });
    if (!project) throwAppError('NOT_FOUND', 'Project not found.');
    if (TERMINAL_STATUSES.includes(project.operationalStatus)) {
      throwAppError('INVALID_STATE_TRANSITION', 'Cannot change the team of a cancelled or closed project.');
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.projectTeamMember.deleteMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, employeeId: input.employeeId },
      });
      if (count === 0) throwAppError('NOT_FOUND', 'Team member not found.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PROJECT',
        entityId: input.projectId,
        action: 'PROJECT_TEAM_MEMBER_REMOVED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { employeeId: input.employeeId },
      });
    });
  }

  async listProgress(input: {
    organizationId: string;
    projectId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ProjectProgressSummary[]> {
    // Reuses getDetail's own scope check — throws NOT_FOUND if the actor
    // can't see this project at all.
    await this.getDetail({
      organizationId: input.organizationId,
      id: input.projectId,
      actorId: input.actorId,
      canSeeAll: input.canSeeAll,
    });

    const rows = await this.prisma.client.projectProgress.findMany({
      where: { organizationId: input.organizationId, projectId: input.projectId },
      orderBy: { percentage: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      percentage: row.percentage,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      createdByEmail: row.createdByEmail,
    }));
  }

  async addProgress(input: {
    organizationId: string;
    projectId: string;
    title: string;
    percentage: number;
    note: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<ProjectProgressSummary> {
    const project = await this.getDetail({
      organizationId: input.organizationId,
      id: input.projectId,
      actorId: input.actorId,
      canSeeAll: input.canSeeAll,
    });
    if (TERMINAL_STATUSES.includes(project.operationalStatus)) {
      throwAppError('INVALID_STATE_TRANSITION', 'Cannot add a progress update to a cancelled or closed project.');
    }
    if (!Number.isInteger(input.percentage) || input.percentage < 0 || input.percentage > 100) {
      throwAppError('VALIDATION_FAILED', 'Progress percentage must be a whole number between 0 and 100.');
    }

    const latest = await this.prisma.client.projectProgress.findFirst({
      where: { organizationId: input.organizationId, projectId: input.projectId },
      orderBy: { percentage: 'desc' },
    });
    const currentPercentage = latest?.percentage ?? 0;
    if (input.percentage <= currentPercentage) {
      throwAppError('VALIDATION_FAILED', `Progress can only increase — current progress is ${currentPercentage}%.`);
    }

    return this.prisma.client.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { email: true } });
      const row = await tx.projectProgress.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          projectId: input.projectId,
          title: input.title,
          percentage: input.percentage,
          note: input.note,
          createdBy: input.actorId,
          createdByEmail: actor?.email ?? null,
        },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PROJECT',
        entityId: input.projectId,
        action: 'PROJECT_PROGRESS_ADDED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { title: input.title, percentage: input.percentage },
      });
      return {
        id: row.id,
        title: row.title,
        percentage: row.percentage,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        createdByEmail: row.createdByEmail,
      };
    });
  }

  async getExpenseLedger(input: {
    organizationId: string;
    projectId: string;
    actorId: string;
    canSeeAll: boolean;
    hasVendorBillReadPermission: boolean;
    hasEmployeeClaimReadPermission: boolean;
    hasDirectExpenseReadPermission: boolean;
    hasInventoryReadPermission: boolean;
    hasProjectCostReadPermission: boolean;
    hasIntroducerFeeReadPermission: boolean;
    category: ProjectExpenseCategory | undefined;
    dateFrom: string | undefined;
    dateTo: string | undefined;
  }): Promise<ProjectExpenseLedger> {
    // Reuses getDetail's own scope check — throws NOT_FOUND if the actor
    // can't see this project at all.
    await this.getDetail({
      organizationId: input.organizationId,
      id: input.projectId,
      actorId: input.actorId,
      canSeeAll: input.canSeeAll,
    });

    const dateFrom = input.dateFrom ? new Date(`${input.dateFrom}T00:00:00.000Z`) : undefined;
    const dateTo = input.dateTo ? new Date(`${input.dateTo}T23:59:59.999Z`) : undefined;
    const dateRange = dateFrom || dateTo ? { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } : undefined;

    const includePurchase = input.hasVendorBillReadPermission && (!input.category || input.category === 'PURCHASE');
    const includeReimbursement = input.hasEmployeeClaimReadPermission && (!input.category || input.category === 'REIMBURSEMENT');
    const includeDirectExpense = input.hasDirectExpenseReadPermission && (!input.category || input.category === 'DIRECT_EXPENSE');
    const includeMaterial = input.hasInventoryReadPermission && (!input.category || input.category === 'MATERIAL');
    const includeManpower = input.hasProjectCostReadPermission && (!input.category || input.category === 'MANPOWER');
    const includeIntroducer = input.hasIntroducerFeeReadPermission && (!input.category || input.category === 'INTRODUCER');

    const rows: ProjectExpenseRow[] = [];
    let purchaseTotal = new Prisma.Decimal(0);
    let reimbursementTotal = new Prisma.Decimal(0);
    let directExpenseTotal = new Prisma.Decimal(0);
    let materialTotal = new Prisma.Decimal(0);
    let manpowerTotal = new Prisma.Decimal(0);
    let introducerTotal = new Prisma.Decimal(0);

    if (includePurchase) {
      const bills = await this.prisma.client.vendorBill.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          status: 'FINALIZED',
          ...(dateRange ? { vendorBillDate: dateRange } : {}),
        },
        include: { vendor: true, lines: { select: { lineTotal: true, inventoryItemId: true } } },
        orderBy: { vendorBillDate: 'desc' },
      });
      for (const bill of bills) {
        // Stock lines are left out (ADR-103): they became inventory, and reach
        // this ledger as MATERIAL when issued. A bill that was all stock has
        // no project cost of its own, so it gets no row.
        const expenseLines = bill.lines.filter((l) => l.inventoryItemId === null);
        if (expenseLines.length === 0) continue;
        const amount = expenseLines.reduce((sum, l) => sum.plus(l.lineTotal), new Prisma.Decimal(0));
        purchaseTotal = purchaseTotal.plus(amount);
        rows.push({
          id: `vendor-bill-${bill.id}`,
          category: 'PURCHASE',
          date: bill.vendorBillDate.toISOString().slice(0, 10),
          title: `Bill #${bill.vendorBillNumber}`,
          subtitle: `Vendor: ${bill.vendor.name}`,
          amount: amount.toFixed(2),
          linkType: 'VENDOR_BILL',
          linkId: bill.id,
        });
      }
    }

    if (includeReimbursement) {
      const claims = await this.prisma.client.employeeExpenseClaim.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          status: { in: ['APPROVED', 'REIMBURSED'] },
          ...(dateRange ? { expenseDate: dateRange } : {}),
        },
        include: { expenseCategory: true, employee: true },
        orderBy: { expenseDate: 'desc' },
      });
      for (const claim of claims) {
        reimbursementTotal = reimbursementTotal.plus(claim.amount);
        rows.push({
          id: `employee-claim-${claim.id}`,
          category: 'REIMBURSEMENT',
          date: claim.expenseDate.toISOString().slice(0, 10),
          title: claim.title,
          subtitle: `${claim.expenseCategory.name} · ${claim.employee.fullName}`,
          amount: claim.amount.toFixed(2),
          linkType: 'EMPLOYEE_EXPENSE_CLAIM',
          linkId: claim.id,
        });
      }
    }

    if (includeDirectExpense) {
      const expenses = await this.prisma.client.directExpense.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          status: 'POSTED',
          ...(dateRange ? { expenseDate: dateRange } : {}),
        },
        include: { expenseCategory: true },
        orderBy: { expenseDate: 'desc' },
      });
      for (const expense of expenses) {
        directExpenseTotal = directExpenseTotal.plus(expense.amount);
        rows.push({
          id: `direct-expense-${expense.id}`,
          category: 'DIRECT_EXPENSE',
          date: expense.expenseDate.toISOString().slice(0, 10),
          title: expense.title,
          subtitle: expense.expenseCategory.name,
          amount: expense.amount.toFixed(2),
          linkType: 'DIRECT_EXPENSE',
          linkId: expense.id,
        });
      }
    }

    // Material — stock issued to this project. Queried straight through
    // Prisma rather than by injecting InventoryService, following ADR-086's
    // own reasoning for VendorBill: services that already depend on
    // ProjectsService cannot be depended on back without a cycle.
    // REVERSED consumptions are excluded: their stock went back.
    if (includeMaterial) {
      const consumptions = await this.prisma.client.inventoryConsumption.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          status: 'POSTED',
          ...(dateRange ? { consumedDate: dateRange } : {}),
        },
        include: { lines: { include: { inventoryItem: true } } },
        orderBy: { consumedDate: 'desc' },
      });
      for (const consumption of consumptions) {
        materialTotal = materialTotal.plus(consumption.totalValueAmount);
        const itemNames = consumption.lines.map((l) => l.inventoryItem.name);
        rows.push({
          id: `inventory-consumption-${consumption.id}`,
          category: 'MATERIAL',
          date: consumption.consumedDate.toISOString().slice(0, 10),
          title: `Stock issue ${consumption.consumptionNumber}`,
          subtitle:
            itemNames.length <= 2
              ? itemNames.join(', ')
              : `${itemNames.slice(0, 2).join(', ')} +${itemNames.length - 2} more`,
          amount: consumption.totalValueAmount.toFixed(2),
          linkType: 'INVENTORY_CONSUMPTION',
          linkId: consumption.id,
        });
      }
    }

    // Manpower — imported gross salary x allocation percentage, for SUBMITTED
    // months only (a draft is not yet the employee's answer). One row per
    // month rather than per employee-month: the Spend table is unpaginated,
    // and per-employee rows would add hundreds of them. The per-employee
    // breakdown lives on the project's Manpower tab.
    //
    // The whole month is split by the shared `allocateSalary` util and only
    // the project's lines are kept, exactly as getProjectManpowerCost does —
    // splitting only the project lines would decide the rounding remainder
    // against a different denominator and the two figures would disagree.
    if (includeManpower) {
      const allocations = await this.prisma.client.employeeMonthlyAllocation.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'SUBMITTED',
          lines: { some: { projectId: input.projectId } },
          // allocationMonth is a month-start Date, so a month counts as in
          // range when the month itself falls in the window.
          ...(dateRange ? { allocationMonth: dateRange } : {}),
        },
        include: { employee: true, lines: true },
      });

      const salaryLines = allocations.length
        ? await this.prisma.client.salaryImportLine.findMany({
            where: {
              organizationId: input.organizationId,
              employeeId: { in: [...new Set(allocations.map((a) => a.employeeId))] },
              salaryImport: { status: 'POSTED' },
            },
            select: { employeeId: true, grossSalaryAmount: true, salaryImport: { select: { salaryMonth: true } } },
          })
        : [];
      const grossByKey = new Map(
        salaryLines.map((l) => [`${l.employeeId}|${l.salaryImport.salaryMonth.toISOString().slice(0, 10)}`, l.grossSalaryAmount]),
      );

      const byMonth = new Map<string, { amount: Prisma.Decimal; employeeIds: Set<string> }>();
      for (const allocation of allocations) {
        const monthStr = allocation.allocationMonth.toISOString().slice(0, 10);
        const gross = grossByKey.get(`${allocation.employeeId}|${monthStr}`);
        if (!gross) continue;
        const allocated = allocateSalary(
          gross,
          allocation.lines.map((l) => ({ key: l.id, sequence: l.sequence, percentage: l.percentage })),
        );
        const amountByLine = new Map(allocated.map((a) => [a.key, a.amount]));
        const bucket = byMonth.get(monthStr) ?? { amount: new Prisma.Decimal(0), employeeIds: new Set<string>() };
        for (const line of allocation.lines) {
          if (line.projectId !== input.projectId) continue;
          bucket.amount = bucket.amount.plus(amountByLine.get(line.id) ?? new Prisma.Decimal(0));
          bucket.employeeIds.add(allocation.employeeId);
        }
        byMonth.set(monthStr, bucket);
      }

      for (const [monthStr, bucket] of byMonth) {
        if (!bucket.amount.greaterThan(0)) continue;
        manpowerTotal = manpowerTotal.plus(bucket.amount);
        const label = new Date(`${monthStr}T00:00:00.000Z`).toLocaleDateString('en-IN', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        });
        rows.push({
          id: `manpower-${monthStr}`,
          category: 'MANPOWER',
          date: monthStr,
          title: `Manpower — ${label}`,
          subtitle: `${bucket.employeeIds.size} employee${bucket.employeeIds.size === 1 ? '' : 's'} allocated`,
          amount: bucket.amount.toFixed(2),
          // Allocation posts no journal and has no document to open.
          linkType: 'NONE',
          linkId: null,
        });
      }
    }

    // Introducer — commission accrued on this project. The accrual has no
    // projectId of its own; it reaches the project through its agreement.
    if (includeIntroducer) {
      const accruals = await this.prisma.client.introducerAccrual.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'POSTED',
          agreement: { projectId: input.projectId },
          ...(dateRange ? { accrualDate: dateRange } : {}),
        },
        include: { agreement: { include: { introducer: true } } },
        orderBy: { accrualDate: 'desc' },
      });
      for (const accrual of accruals) {
        introducerTotal = introducerTotal.plus(accrual.amount);
        rows.push({
          id: `introducer-accrual-${accrual.id}`,
          category: 'INTRODUCER',
          date: accrual.accrualDate.toISOString().slice(0, 10),
          title: `Commission ${accrual.accrualNumber}`,
          subtitle: accrual.agreement.introducer.name,
          amount: accrual.amount.toFixed(2),
          linkType: 'INTRODUCER_ACCRUAL',
          linkId: accrual.id,
        });
      }
    }

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const totalAmount = purchaseTotal
      .plus(reimbursementTotal)
      .plus(directExpenseTotal)
      .plus(materialTotal)
      .plus(manpowerTotal)
      .plus(introducerTotal);
    const categoryTotals = [
      ...(includePurchase ? [{ category: 'PURCHASE' as const, amount: purchaseTotal.toFixed(2) }] : []),
      ...(includeReimbursement ? [{ category: 'REIMBURSEMENT' as const, amount: reimbursementTotal.toFixed(2) }] : []),
      ...(includeDirectExpense ? [{ category: 'DIRECT_EXPENSE' as const, amount: directExpenseTotal.toFixed(2) }] : []),
      ...(includeMaterial ? [{ category: 'MATERIAL' as const, amount: materialTotal.toFixed(2) }] : []),
      ...(includeManpower ? [{ category: 'MANPOWER' as const, amount: manpowerTotal.toFixed(2) }] : []),
      ...(includeIntroducer ? [{ category: 'INTRODUCER' as const, amount: introducerTotal.toFixed(2) }] : []),
    ];

    let largestCategory: ProjectExpenseCategory | null = null;
    let largestCategoryPercent = 0;
    if (totalAmount.greaterThan(0)) {
      const candidates: { category: ProjectExpenseCategory; amount: Prisma.Decimal }[] = [
        { category: 'PURCHASE', amount: purchaseTotal },
        { category: 'REIMBURSEMENT', amount: reimbursementTotal },
        { category: 'DIRECT_EXPENSE', amount: directExpenseTotal },
        { category: 'MATERIAL', amount: materialTotal },
        { category: 'MANPOWER', amount: manpowerTotal },
        { category: 'INTRODUCER', amount: introducerTotal },
      ];
      const largest = candidates.reduce((best, candidate) => (candidate.amount.greaterThan(best.amount) ? candidate : best));
      if (largest.amount.greaterThan(0)) {
        largestCategory = largest.category;
        largestCategoryPercent = largest.amount.dividedBy(totalAmount).times(100).toDecimalPlaces(1).toNumber();
      }
    }

    return { rows, totalAmount: totalAmount.toFixed(2), categoryTotals, largestCategory, largestCategoryPercent };
  }
}
