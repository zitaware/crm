import { Injectable } from '@nestjs/common';
import { throwAppError } from '@zitaware/contracts';
import type { ReportReadInput, ReportScope } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

export interface ScopedProject {
  id: string;
  name: string;
  clientId: string;
  clientName: string | null;
  legalEntityId: string;
  value: string | null;
  budget: string | null;
  stage: string;
  operationalStatus: string;
}

export interface ResolvedScope {
  scope: ReportScope;
  /** The visible projects the filters select, by name. */
  projects: ScopedProject[];
}

/**
 * The filters → scope step every project-grouped report shares (ADR-109,
 * ADR-110): the actor's visible projects narrowed by legal entity, client and
 * project, and whether that view is restricted — a restricted view is never
 * compared with the whole ledger.
 */
@Injectable()
export class ReportScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async resolve(input: ReportReadInput): Promise<ResolvedScope> {
    const { organizationId, filters } = input;
    const db = this.prisma.client;
    if (filters.dateFrom && filters.dateFrom > filters.asOfDate) throwAppError('VALIDATION_FAILED', 'The period cannot start after it ends.');

    const visible = await this.projects.list({ organizationId, actorId: input.actorId, canSeeAll: input.canSeeAllProjects });
    if (filters.projectId && !visible.some((p) => p.id === filters.projectId)) throwAppError('NOT_FOUND', 'Project not found.');
    const selected = visible.filter(
      (p) =>
        (!filters.legalEntityId || p.legalEntityId === filters.legalEntityId) &&
        (!filters.clientId || p.clientId === filters.clientId) &&
        (!filters.projectId || p.id === filters.projectId),
    );

    const [legalEntity, client] = await Promise.all([
      filters.legalEntityId ? db.legalEntity.findFirst({ where: { id: filters.legalEntityId, organizationId }, select: { legalName: true } }) : null,
      filters.clientId ? db.party.findFirst({ where: { id: filters.clientId, organizationId }, select: { name: true } }) : null,
    ]);
    if (filters.legalEntityId && !legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');
    if (filters.clientId && !client) throwAppError('NOT_FOUND', 'Client not found.');

    const scope: ReportScope = {
      dateFrom: filters.dateFrom ?? null,
      asOfDate: filters.asOfDate,
      legalEntityId: filters.legalEntityId ?? null,
      legalEntityName: legalEntity?.legalName ?? null,
      clientId: filters.clientId ?? null,
      clientName: client?.name ?? null,
      projectId: filters.projectId ?? null,
      projectName: filters.projectId ? (visible.find((p) => p.id === filters.projectId)?.name ?? null) : null,
      currency: 'INR',
      restricted: !input.canSeeAllProjects || Boolean(filters.clientId) || Boolean(filters.projectId),
    };
    const projects = selected
      .map((p) => ({
        id: p.id,
        name: p.name,
        clientId: p.clientId,
        clientName: p.clientName,
        legalEntityId: p.legalEntityId,
        value: p.value,
        budget: p.budget,
        stage: p.stage,
        operationalStatus: p.operationalStatus,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { scope, projects };
  }
}
