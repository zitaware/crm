import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { makeClaimApprover, removeClaimApprovers } from '../testing/claim-approver.test-util';
import { ProjectsService } from './projects.service';
import { ClientsService } from '../clients/clients.service';
import { LeadsService } from '../leads/leads.service';
import { TendersService } from '../tenders/tenders.service';
import { VendorsService } from '../vendors/vendors.service';
import { InventoryLedgerService } from '../inventory/inventory-ledger.service';
import { VendorBillsService } from '../vendor-bills/vendor-bills.service';
import { EmployeeExpensesService } from '../employee-expenses/employee-expenses.service';
import { DirectExpensesService } from '../direct-expenses/direct-expenses.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const leads = new LeadsService(prisma);
const tenders = new TendersService(prisma);

let organizationId: string;
let otherOrganizationId: string;
let clientId: string;
let legalEntityId: string;
let leadId: string;
let tenderId: string;
let employeeId: string;
let salesEmployeeId: string;
let userId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Projects Test Org', code: `PROJECTTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Projects Test Other Org', code: `PROJECTTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const client = await clients.create({
    organizationId,
    name: 'Municipal Corporation',
    shortCode: undefined,
    clientTypeId: undefined,
    department: 'IT Department',
    stateId: undefined,
    districtId: undefined,
    cityId: undefined,
    pinCode: undefined,
    officeAddress: undefined,
    gstin: undefined,
    internalNote: undefined,
    contacts: [],
    actorId,
    correlationId: generateId(),
  });
  clientId = client.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: {
      id: generateId(),
      organizationId,
      legalName: 'Zitaware Projects Pvt Ltd',
      panNumber: 'ABCPM1234P',
      registeredAddress: 'Ahmedabad, Gujarat',
    },
  });
  legalEntityId = legalEntity.id;

  const leadType = await prisma.client.leadType.create({
    data: { id: generateId(), organizationId, code: 'government_tender', name: 'Government Tender' },
  });
  const leadSource = await prisma.client.leadSource.create({
    data: { id: generateId(), organizationId, code: 'referral', name: 'Referral' },
  });
  const lead = await leads.create({
    organizationId,
    clientId,
    leadTypeId: leadType.id,
    leadSourceId: leadSource.id,
    introducerId: undefined,
    title: 'Original Lead For Project Origin',
    description: undefined,
    stage: undefined,
    estimatedValue: undefined,
    leadDate: '2025-08-01',
    expectedCloseDate: undefined,
    expectedTenderDate: undefined,
    tenderNumber: undefined,
    tenderDate: undefined,
    submissionDeadline: undefined,
    reminderOffset: undefined,
    internalNote: undefined,
    actorId,
    correlationId: generateId(),
  });
  leadId = lead.id;

  const tender = await tenders.create({
    organizationId,
    clientId,
    leadId: undefined,
    tenderPortalId: undefined,
    tenderNumber: 'GJ/PROJ/2026/0001',
    title: 'Original Tender For Project Origin',
    description: undefined,
    submissionStatus: undefined,
    result: undefined,
    estimatedValue: undefined,
    tenderDate: '2025-08-01',
    submissionDeadline: undefined,
    submittedDate: undefined,
    resultDate: undefined,
    reminderOffset: undefined,
    internalNote: undefined,
    actorId,
    correlationId: generateId(),
  });
  tenderId = tender.id;

  const user = await prisma.client.user.create({
    data: {
      id: generateId(),
      organizationId,
      email: 'project-actor@zitaware.test',
      passwordHash: 'test-hash',
      displayName: 'Project Actor',
      status: 'ACTIVE',
    },
  });
  userId = user.id;

  // ADR-153: a project manager must be a Project Manager or Hardware Manager,
  // a sales manager a Business Development Manager or Marketing Manager.
  const pmDesignation = await prisma.client.designation.create({
    data: { id: generateId(), organizationId, code: 'project-manager', name: 'Project Manager' },
  });
  const salesDesignation = await prisma.client.designation.create({
    data: { id: generateId(), organizationId, code: 'BDM', name: 'Business Development Manager' },
  });
  const employee = await prisma.client.employee.create({
    data: {
      id: generateId(),
      organizationId,
      userId,
      employeeCode: 'EMP-PROJECT-1',
      fullName: 'Project Actor',
      legalEntityId,
      designationId: pmDesignation.id,
      joiningDate: new Date('2024-01-01'),
    },
  });
  employeeId = employee.id;
  const salesEmployee = await prisma.client.employee.create({
    data: {
      id: generateId(),
      organizationId,
      employeeCode: 'EMP-PROJECT-SALES',
      fullName: 'Sales Actor',
      legalEntityId,
      designationId: salesDesignation.id,
      joiningDate: new Date('2024-01-01'),
    },
  });
  salesEmployeeId = salesEmployee.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.projectProgress.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.projectTeamMember.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.tenderUpdate.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.tender.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.leadUpdate.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.lead.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.employee.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.designation.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.leadType.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.leadSource.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.$disconnect();
});

async function createProject(overrides: Partial<Parameters<typeof projects.create>[0]> = {}) {
  return projects.create({
    organizationId,
    clientId,
    legalEntityId,
    leadId: undefined,
    tenderId: undefined,
    projectManagerId: undefined,
    introducerId: undefined,
    projectTypeId: undefined,
    name: 'Test Project',
    description: undefined,
    value: undefined,
    budget: undefined,
    gstApplicable: undefined,
    workOrderNumber: undefined,
    workOrderDate: undefined,
    actorId,
    correlationId: generateId(),
    ...overrides,
  });
}

describe('ProjectsService', () => {
  it('creates a project defaulting to stage WORK_STARTED and status ACTIVE', async () => {
    const created = await createProject({ name: 'SBMU VTMS — Phase 2 Rollout', value: '18000000.00' });

    expect(created.name).toBe('SBMU VTMS — Phase 2 Rollout');
    expect(created.stage).toBe('WORK_STARTED');
    expect(created.operationalStatus).toBe('ACTIVE');
    expect(created.clientName).toBe('Municipal Corporation');
    expect(created.legalEntityName).toBe('Zitaware Projects Pvt Ltd');
    expect(created.gstApplicable).toBe(true);

    const listed = await projects.list({ organizationId, actorId, canSeeAll: true });
    expect(listed.some((row) => row.id === created.id)).toBe(true);
  });

  it('creates a project with an optional Lead and Tender origin', async () => {
    const created = await createProject({ name: 'Origin Project', leadId, tenderId });
    expect(created.leadId).toBe(leadId);
    expect(created.leadTitle).toBe('Original Lead For Project Origin');
    expect(created.tenderId).toBe(tenderId);
    expect(created.tenderTitle).toBe('Original Tender For Project Origin');
  });

  it('rejects a client that does not resolve to a real client (no clientProfile)', async () => {
    const bareParty = await prisma.client.party.create({
      data: { id: generateId(), organizationId, name: 'Bare Party, No Client Profile' },
    });
    await expect(createProject({ clientId: bareParty.id })).rejects.toThrow('client does not exist');
  });

  it('rejects a legal entity that does not exist', async () => {
    await expect(createProject({ legalEntityId: generateId() })).rejects.toThrow('legal entity does not exist');
  });

  it('updates a project (excluding stage/status), diffing the audit event, and rejects a stale-version update', async () => {
    const created = await createProject({ name: 'Land Records Digitization' });

    const updated = await projects.update({
      organizationId,
      id: created.id,
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: employeeId,
      introducerId: undefined,
      projectTypeId: undefined,
      name: undefined,
      description: undefined,
      value: undefined,
      budget: undefined,
      gstApplicable: undefined,
      workOrderNumber: undefined,
      workOrderDate: undefined,
      expectedVersion: created.version,
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    expect(updated.projectManagerId).toBe(employeeId);
    expect(updated.stage).toBe('WORK_STARTED'); // untouched by plain update

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: created.id, action: 'PROJECT_UPDATED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.newValues).toMatchObject({ projectManagerId: employeeId });

    await expect(
      projects.update({
        organizationId,
        id: created.id,
        leadId: undefined,
        tenderId: undefined,
        projectManagerId: undefined,
        introducerId: undefined,
        projectTypeId: undefined,
        name: 'New Name',
        description: undefined,
        value: undefined,
        budget: undefined,
        gstApplicable: undefined,
        workOrderNumber: undefined,
        workOrderDate: undefined,
        expectedVersion: created.version, // stale — already incremented above
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });

  it('records a sales manager separately from the project manager, and audits a change', async () => {
    const created = await createProject({ name: 'Sales Manager Project', salesManagerId: salesEmployeeId });
    expect(created.salesManagerId).toBe(salesEmployeeId);
    expect(created.salesManagerName).not.toBeNull();
    expect(created.projectManagerId).toBeNull();

    const updated = await projects.update({
      organizationId, id: created.id, leadId: undefined, tenderId: undefined, projectManagerId: employeeId,
      salesManagerId: undefined, introducerId: undefined, projectTypeId: undefined, name: undefined,
      description: undefined, value: undefined, budget: undefined, gstApplicable: undefined,
      workOrderNumber: undefined, workOrderDate: undefined, expectedVersion: created.version,
      actorId, canSeeAll: true, correlationId: generateId(),
    });
    // Leaving salesManagerId out keeps it.
    expect(updated).toMatchObject({ salesManagerId: salesEmployeeId, projectManagerId: employeeId });

    // null removes a manager, and the Projects list shows it straight away.
    const cleared = await projects.update({
      organizationId, id: created.id, leadId: undefined, tenderId: undefined, projectManagerId: null,
      salesManagerId: null, introducerId: undefined, projectTypeId: undefined, name: undefined,
      description: undefined, value: undefined, budget: undefined, gstApplicable: undefined,
      workOrderNumber: undefined, workOrderDate: null, expectedVersion: updated.version,
      actorId, canSeeAll: true, correlationId: generateId(),
    });
    expect(cleared).toMatchObject({ salesManagerId: null, salesManagerName: null, projectManagerId: null, workOrderDate: null });
    const listed = (await projects.list({ organizationId, actorId, canSeeAll: true })).find((p) => p.id === created.id)!;
    expect([listed.salesManagerId, listed.projectManagerId]).toEqual([null, null]);
    const audit = await prisma.client.auditEvent.findFirst({ where: { entityId: created.id, action: 'PROJECT_UPDATED' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.newValues).toMatchObject({ salesManagerId: null, projectManagerId: null });

    await expect(
      createProject({ name: 'Unknown Sales Manager Project', salesManagerId: generateId() }),
    ).rejects.toThrow('The selected sales manager does not exist.');
  });

  it('accepts only qualifying designations for each manager, and lists them', async () => {
    const candidates = await projects.listManagerCandidates({ organizationId, legalEntityId });
    expect(candidates.projectManagers.map((e) => e.id)).toEqual([employeeId]);
    expect(candidates.salesManagers.map((e) => e.id)).toEqual([salesEmployeeId]);

    await expect(createProject({ name: 'Wrong PM Project', projectManagerId: salesEmployeeId })).rejects.toThrow(
      'The project manager must be a Project Manager or Hardware Manager.',
    );
    await expect(createProject({ name: 'Wrong Sales Project', salesManagerId: employeeId })).rejects.toThrow(
      'The sales manager must be a Business Development Manager or Marketing Manager.',
    );

    // A manager saved before the rule does not block other edits.
    const older = await createProject({ name: 'Older Project' });
    await prisma.client.project.update({ where: { id: older.id }, data: { projectManagerId: salesEmployeeId } });
    const current = await projects.getDetail({ organizationId, id: older.id, actorId, canSeeAll: true });
    const renamed = await projects.update({
      organizationId, id: older.id, leadId: undefined, tenderId: undefined, projectManagerId: salesEmployeeId,
      salesManagerId: undefined, introducerId: undefined, projectTypeId: undefined, name: 'Older Project Renamed',
      description: undefined, value: undefined, budget: undefined, gstApplicable: undefined,
      workOrderNumber: undefined, workOrderDate: undefined, expectedVersion: current.version,
      actorId, canSeeAll: true, correlationId: generateId(),
    });
    expect(renamed.name).toBe('Older Project Renamed');
  });

  it("keeps managers and team members to the project's legal entity", async () => {
    const otherEntity = await prisma.client.legalEntity.create({
      data: { id: generateId(), organizationId, legalName: 'Other Entity Pvt Ltd', panNumber: 'ABCPO5678Q', registeredAddress: 'Surat, Gujarat' },
    });
    const project = await createProject({ name: 'Other Entity Project', legalEntityId: otherEntity.id });

    const candidates = await projects.listManagerCandidates({ organizationId, legalEntityId: otherEntity.id });
    expect(candidates).toEqual({ projectManagers: [], salesManagers: [] });
    await expect(
      createProject({ name: 'Cross Entity PM Project', legalEntityId: otherEntity.id, projectManagerId: employeeId }),
    ).rejects.toThrow("must be employees of the project's legal entity");
    await expect(
      projects.addTeamMember({ organizationId, projectId: project.id, employeeId, role: undefined, actorId, correlationId: generateId() }),
    ).rejects.toThrow('works for another legal entity');

    await prisma.client.project.delete({ where: { id: project.id } });
    await prisma.client.legalEntity.delete({ where: { id: otherEntity.id } });
  });

  it('never returns a project from a different organization', async () => {
    const otherClient = await clients.create({
      organizationId: otherOrganizationId,
      name: 'Other Org Client',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Other Department',
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      gstin: undefined,
      internalNote: undefined,
      contacts: [],
      actorId,
      correlationId: generateId(),
    });
    const otherLegalEntity = await prisma.client.legalEntity.create({
      data: {
        id: generateId(),
        organizationId: otherOrganizationId,
        legalName: 'Other Org Legal Entity',
        panNumber: 'OTHRP9999Q',
        registeredAddress: 'Elsewhere',
      },
    });

    const otherProject = await projects.create({
      organizationId: otherOrganizationId,
      clientId: otherClient.id,
      legalEntityId: otherLegalEntity.id,
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: undefined,
      introducerId: undefined,
      projectTypeId: undefined,
      name: 'Other Org Project',
      description: undefined,
      value: undefined,
      budget: undefined,
      gstApplicable: undefined,
      workOrderNumber: undefined,
      workOrderDate: undefined,
      actorId,
      correlationId: generateId(),
    });

    const listedInOrg = await projects.list({ organizationId, actorId, canSeeAll: true });
    expect(listedInOrg.some((row) => row.id === otherProject.id)).toBe(false);
    await expect(
      projects.getDetail({ organizationId, id: otherProject.id, actorId, canSeeAll: true }),
    ).rejects.toThrow();
  });

  describe('changeStage', () => {
    it('moves forward one stage at a time', async () => {
      const created = await createProject({ name: 'Stage Forward Project' });
      const moved = await projects.changeStage({
        organizationId,
        id: created.id,
        targetStage: 'WORK_DONE',
        reason: undefined,
        expectedVersion: created.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });
      expect(moved.stage).toBe('WORK_DONE');
    });

    it('moves forward to any later stage', async () => {
      const created = await createProject({ name: 'Stage Skip Project' });
      const moved = await projects.changeStage({
        organizationId,
        id: created.id,
        targetStage: 'SUCCESSFULLY_COMPLETED',
        reason: undefined,
        expectedVersion: created.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });
      expect(moved.stage).toBe('SUCCESSFULLY_COMPLETED');
    });

    it('requires and records a reason for backward movement', async () => {
      const created = await createProject({ name: 'Stage Backward Project' });
      const forward = await projects.changeStage({
        organizationId,
        id: created.id,
        targetStage: 'WORK_DONE',
        reason: undefined,
        expectedVersion: created.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });

      await expect(
        projects.changeStage({
          organizationId,
          id: created.id,
          targetStage: 'WON',
          reason: undefined,
          expectedVersion: forward.version,
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('A reason is required');

      const backward = await projects.changeStage({
        organizationId,
        id: created.id,
        targetStage: 'WON',
        reason: 'Work order was cancelled by the authority.',
        expectedVersion: forward.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });
      expect(backward.stage).toBe('WON');

      const events = await prisma.client.auditEvent.findMany({
        where: { organizationId, entityId: created.id, action: 'PROJECT_STAGE_CHANGED' },
      });
      const backwardEvent = events.find((e) => (e.newValues as Record<string, unknown>)?.stage === 'WON');
      expect(backwardEvent?.newValues).toMatchObject({ reason: 'Work order was cancelled by the authority.' });
    });

    it('rejects a version-conflicted stage change', async () => {
      const created = await createProject({ name: 'Stage Version Conflict Project' });
      await expect(
        projects.changeStage({
          organizationId,
          id: created.id,
          targetStage: 'WORK_DONE',
          reason: undefined,
          expectedVersion: created.version + 1,
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('changed by someone else');
    });
  });

  describe('changeStatus', () => {
    it('toggles freely between ACTIVE and ON_HOLD with no reason', async () => {
      const created = await createProject({ name: 'Status Toggle Project' });
      const held = await projects.changeStatus({
        organizationId,
        id: created.id,
        targetStatus: 'ON_HOLD',
        reason: undefined,
        expectedVersion: created.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });
      expect(held.operationalStatus).toBe('ON_HOLD');

      const resumed = await projects.changeStatus({
        organizationId,
        id: created.id,
        targetStatus: 'ACTIVE',
        reason: undefined,
        expectedVersion: held.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });
      expect(resumed.operationalStatus).toBe('ACTIVE');
    });

    it('requires a reason to cancel, from both ACTIVE and ON_HOLD', async () => {
      const created = await createProject({ name: 'Cancel Requires Reason Project' });
      await expect(
        projects.changeStatus({
          organizationId,
          id: created.id,
          targetStatus: 'CANCELLED',
          reason: undefined,
          expectedVersion: created.version,
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('A reason is required to cancel');

      const cancelled = await projects.changeStatus({
        organizationId,
        id: created.id,
        targetStatus: 'CANCELLED',
        reason: 'Client withdrew funding.',
        expectedVersion: created.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });
      expect(cancelled.operationalStatus).toBe('CANCELLED');
    });

    it('blocks any further stage/status change once cancelled or closed', async () => {
      const created = await createProject({ name: 'Terminal Project' });
      const cancelled = await projects.changeStatus({
        organizationId,
        id: created.id,
        targetStatus: 'CANCELLED',
        reason: 'Duplicate entry.',
        expectedVersion: created.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });

      await expect(
        projects.changeStatus({
          organizationId,
          id: created.id,
          targetStatus: 'ACTIVE',
          reason: undefined,
          expectedVersion: cancelled.version,
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('Cannot change the status of a cancelled or closed project');

      await expect(
        projects.changeStage({
          organizationId,
          id: created.id,
          targetStage: 'WORK_DONE',
          reason: undefined,
          expectedVersion: cancelled.version,
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('Cannot change the stage of a cancelled or closed project');
    });

    it('allows CLOSED from any stage', async () => {
      const created = await createProject({ name: 'Close From Any Stage Project' });
      const closed = await projects.changeStatus({
        organizationId,
        id: created.id,
        targetStatus: 'CLOSED',
        reason: undefined,
        expectedVersion: created.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });
      expect(closed.operationalStatus).toBe('CLOSED');
      expect(closed.stage).toBe('WORK_STARTED');
    });
  });

  describe('Project Manager scoping', () => {
    it('a scoped actor also sees projects where they are the sales manager', async () => {
      // The actor is a Project Manager by designation, so set the field directly.
      const sold = await createProject({ name: 'Sold By Actor Project' });
      await prisma.client.project.update({ where: { id: sold.id }, data: { salesManagerId: employeeId } });
      const listed = await projects.list({ organizationId, actorId: userId, canSeeAll: false });
      expect(listed.some((row) => row.id === sold.id)).toBe(true);
      const detail = await projects.getDetail({ organizationId, id: sold.id, actorId: userId, canSeeAll: false });
      expect(detail.salesManagerId).toBe(employeeId);
    });

    it('a scoped actor sees only projects where they are the projectManagerId', async () => {
      const assigned = await createProject({ name: 'Assigned To PM Project', projectManagerId: employeeId });
      const unassigned = await createProject({ name: 'Unassigned Project' });

      const listed = await projects.list({ organizationId, actorId: userId, canSeeAll: false });
      expect(listed.some((row) => row.id === assigned.id)).toBe(true);
      expect(listed.some((row) => row.id === unassigned.id)).toBe(false);

      const detail = await projects.getDetail({ organizationId, id: assigned.id, actorId: userId, canSeeAll: false });
      expect(detail.id).toBe(assigned.id);

      await expect(
        projects.getDetail({ organizationId, id: unassigned.id, actorId: userId, canSeeAll: false }),
      ).rejects.toThrow('not found');
    });

    it('a scoped actor sees a project where they are a ProjectTeamMember, without being projectManagerId', async () => {
      const project = await createProject({ name: 'Team Member Only Project' });
      await projects.addTeamMember({
        organizationId,
        projectId: project.id,
        employeeId,
        role: 'Site Engineer',
        actorId,
        correlationId: generateId(),
      });

      const listed = await projects.list({ organizationId, actorId: userId, canSeeAll: false });
      expect(listed.some((row) => row.id === project.id)).toBe(true);
    });

    it('an unscoped actor (canSeeAll) sees every project regardless of assignment', async () => {
      const unassigned = await createProject({ name: 'Unassigned Project For Unscoped Check' });
      const listed = await projects.list({ organizationId, actorId: userId, canSeeAll: true });
      expect(listed.some((row) => row.id === unassigned.id)).toBe(true);
    });

    it('an actor with no linked Employee sees an empty scoped list and NOT_FOUND on getDetail', async () => {
      const project = await createProject({ name: 'Project For No-Employee-Actor Check' });
      const noEmployeeActorId = generateId(); // no Employee row links to this User

      const listed = await projects.list({ organizationId, actorId: noEmployeeActorId, canSeeAll: false });
      expect(listed).toEqual([]);

      await expect(
        projects.getDetail({ organizationId, id: project.id, actorId: noEmployeeActorId, canSeeAll: false }),
      ).rejects.toThrow('not found');
    });

    it('rejects changeStage/changeStatus on an out-of-scope project, but allows it on an assigned one', async () => {
      const assigned = await createProject({ name: 'Scoped ChangeStage Project', projectManagerId: employeeId });
      const unassigned = await createProject({ name: 'Unscoped ChangeStage Project' });

      await expect(
        projects.changeStage({
          organizationId,
          id: unassigned.id,
          targetStage: 'WORK_DONE',
          reason: undefined,
          expectedVersion: unassigned.version,
          actorId: userId,
          canSeeAll: false,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('not found');

      const moved = await projects.changeStage({
        organizationId,
        id: assigned.id,
        targetStage: 'WORK_DONE',
        reason: undefined,
        expectedVersion: assigned.version,
        actorId: userId,
        canSeeAll: false,
        correlationId: generateId(),
      });
      expect(moved.stage).toBe('WORK_DONE');
    });
  });

  describe('team members', () => {
    it('adds and lists team members, and rejects a duplicate assignment', async () => {
      const project = await createProject({ name: 'Team CRUD Project' });
      const added = await projects.addTeamMember({
        organizationId,
        projectId: project.id,
        employeeId,
        role: 'QA Lead',
        actorId,
        correlationId: generateId(),
      });
      expect(added.employeeName).toBe('Project Actor');
      expect(added.role).toBe('QA Lead');

      const listed = await projects.listTeamMembers({
        organizationId,
        projectId: project.id,
        actorId,
        canSeeAll: true,
      });
      expect(listed.map((m) => m.id)).toContain(added.id);

      await expect(
        projects.addTeamMember({
          organizationId,
          projectId: project.id,
          employeeId,
          role: 'Duplicate',
          actorId,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('already assigned');
    });

    it('rejects adding an employee that does not exist in the organization', async () => {
      const project = await createProject({ name: 'Team CRUD Bad Employee Project' });
      await expect(
        projects.addTeamMember({
          organizationId,
          projectId: project.id,
          employeeId: generateId(),
          role: undefined,
          actorId,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('employee does not exist');
    });

    it('removes a team member, and rejects removing one that is not assigned', async () => {
      const project = await createProject({ name: 'Team Removal Project' });
      await projects.addTeamMember({
        organizationId,
        projectId: project.id,
        employeeId,
        role: undefined,
        actorId,
        correlationId: generateId(),
      });

      await projects.removeTeamMember({ organizationId, projectId: project.id, employeeId, actorId, correlationId: generateId() });
      const listed = await projects.listTeamMembers({ organizationId, projectId: project.id, actorId, canSeeAll: true });
      expect(listed).toHaveLength(0);

      await expect(
        projects.removeTeamMember({ organizationId, projectId: project.id, employeeId, actorId, correlationId: generateId() }),
      ).rejects.toThrow('not found');
    });

    it('blocks adding or removing team members once a project is cancelled', async () => {
      const project = await createProject({ name: 'Team Terminal Project' });
      await projects.addTeamMember({
        organizationId,
        projectId: project.id,
        employeeId,
        role: undefined,
        actorId,
        correlationId: generateId(),
      });
      await projects.changeStatus({
        organizationId,
        id: project.id,
        targetStatus: 'CANCELLED',
        reason: 'Testing terminal team guard.',
        expectedVersion: project.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });

      await expect(
        projects.addTeamMember({
          organizationId,
          projectId: project.id,
          employeeId,
          role: undefined,
          actorId,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('cancelled or closed');

      await expect(
        projects.removeTeamMember({ organizationId, projectId: project.id, employeeId, actorId, correlationId: generateId() }),
      ).rejects.toThrow('cancelled or closed');
    });
  });

  describe('physical progress', () => {
    it('adds progress entries with increasing percentages and lists newest-percentage-first', async () => {
      const project = await createProject({ name: 'Progress Timeline Project' });
      await projects.addProgress({
        organizationId,
        projectId: project.id,
        title: 'Design sign-off',
        percentage: 15,
        note: 'UI/UX approved.',
        actorId: userId,
        canSeeAll: true,
        correlationId: generateId(),
      });
      await projects.addProgress({
        organizationId,
        projectId: project.id,
        title: 'Backend scaffolded',
        percentage: 30,
        note: 'APIs and schema wired.',
        actorId: userId,
        canSeeAll: true,
        correlationId: generateId(),
      });

      const listed = await projects.listProgress({ organizationId, projectId: project.id, actorId, canSeeAll: true });
      expect(listed.map((row) => row.percentage)).toEqual([30, 15]);
      expect(listed[0]!.title).toBe('Backend scaffolded');
      expect(listed[0]!.createdByEmail).toBe('project-actor@zitaware.test');
    });

    it('rejects a percentage that does not increase over the current latest', async () => {
      const project = await createProject({ name: 'Progress Non-Increase Project' });
      await projects.addProgress({
        organizationId,
        projectId: project.id,
        title: 'First update',
        percentage: 40,
        note: 'Some note.',
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });

      await expect(
        projects.addProgress({
          organizationId,
          projectId: project.id,
          title: 'Same percentage',
          percentage: 40,
          note: 'Some note.',
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('can only increase');

      await expect(
        projects.addProgress({
          organizationId,
          projectId: project.id,
          title: 'Lower percentage',
          percentage: 20,
          note: 'Some note.',
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('can only increase');
    });

    it('rejects out-of-range or non-integer percentages', async () => {
      const project = await createProject({ name: 'Progress Range Project' });
      await expect(
        projects.addProgress({
          organizationId,
          projectId: project.id,
          title: 'Too high',
          percentage: 101,
          note: 'x',
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('between 0 and 100');

      await expect(
        projects.addProgress({
          organizationId,
          projectId: project.id,
          title: 'Negative',
          percentage: -5,
          note: 'x',
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('between 0 and 100');
    });

    it('rejects adding a progress update once the project is cancelled', async () => {
      const project = await createProject({ name: 'Progress Terminal Project' });
      await projects.changeStatus({
        organizationId,
        id: project.id,
        targetStatus: 'CANCELLED',
        reason: 'Testing terminal progress guard.',
        expectedVersion: project.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });

      await expect(
        projects.addProgress({
          organizationId,
          projectId: project.id,
          title: 'Should be rejected',
          percentage: 10,
          note: 'x',
          actorId,
          canSeeAll: true,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('cancelled or closed');
    });

    it('scopes progress add/list to Project-Manager assignment, and allows an unscoped actor everywhere', async () => {
      const assigned = await createProject({ name: 'Scoped Progress Project', projectManagerId: employeeId });
      const unassigned = await createProject({ name: 'Unscoped Progress Project' });

      const added = await projects.addProgress({
        organizationId,
        projectId: assigned.id,
        title: 'PM update',
        percentage: 25,
        note: 'x',
        actorId: userId,
        canSeeAll: false,
        correlationId: generateId(),
      });
      expect(added.percentage).toBe(25);

      await expect(
        projects.addProgress({
          organizationId,
          projectId: unassigned.id,
          title: 'Should be rejected',
          percentage: 25,
          note: 'x',
          actorId: userId,
          canSeeAll: false,
          correlationId: generateId(),
        }),
      ).rejects.toThrow('not found');

      await expect(
        projects.listProgress({ organizationId, projectId: unassigned.id, actorId: userId, canSeeAll: false }),
      ).rejects.toThrow('not found');

      const listedByUnscoped = await projects.listProgress({
        organizationId,
        projectId: assigned.id,
        actorId,
        canSeeAll: true,
      });
      expect(listedByUnscoped.some((row) => row.title === 'PM update')).toBe(true);
    });
  });
});

describe('ProjectsService — getExpenseLedger', () => {
  const vendorBillsProjects = new ProjectsService(prisma);
  const clientsSvc = new ClientsService(prisma);
  const vendorsSvc = new VendorsService(prisma);
  const financialYears = new FinancialYearService(prisma);
  const legalEntities = new LegalEntityService(prisma);
  const posting = new PostingService(prisma);
  const vendorBills = new VendorBillsService(prisma, posting, vendorBillsProjects, new InventoryLedgerService(prisma));
  const employeeExpenses = new EmployeeExpensesService(prisma, posting);
  const directExpenses = new DirectExpensesService(prisma, posting);

  let ledgerOrgId: string;
  let ledgerLegalEntityId: string;
  let ledgerProjectId: string;
  let ledgerActorId: string;
  let gstRegistrationId: string;
  let vendorId: string;
  let hardwareCategoryId: string;
  let travelCategoryId: string;
  let bankAccountId: string;
  let reimbursableUserId: string;
  let finalizedBillId: string;
  let finalizedBillAmount: string;
  let approvedClaimId: string;
  let approvedClaimAmount: string;
  let reimbursedClaimAmount: string;
  let directExpenseId: string;
  let directExpenseAmount: string;
  let consumptionId: string;
  let accrualId: string;
  let bankTransferModeId: string;

  beforeAll(async () => {
    const organization = await prisma.client.organization.create({
      data: { id: generateId(), name: 'Project Expense Ledger Test Org', code: `PEL-${generateId()}` },
    });
    ledgerOrgId = organization.id;
    ledgerActorId = generateId();

    const gujarat = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });

    const client = await clientsSvc.create({
      organizationId: ledgerOrgId, name: 'PEL Test Client', shortCode: undefined, clientTypeId: undefined, department: 'IT',
      stateId: undefined, districtId: undefined, cityId: undefined, pinCode: undefined, officeAddress: undefined, gstin: undefined,
      internalNote: undefined, contacts: [], actorId: ledgerActorId, correlationId: generateId(),
    });

    const legalEntity = await prisma.client.legalEntity.create({
      data: { id: generateId(), organizationId: ledgerOrgId, legalName: 'PEL Test Legal Entity', panNumber: 'ABCPE1234P', registeredAddress: 'Gandhinagar, Gujarat' },
    });
    ledgerLegalEntityId = legalEntity.id;

    const gstRegistration = await legalEntities.createGstRegistration({
      organizationId: ledgerOrgId, legalEntityId: ledgerLegalEntityId, stateId: gujarat.id, gstin: '24PELPE0000P1Z5', tradeName: undefined,
      actorId: ledgerActorId, correlationId: generateId(),
    });
    gstRegistrationId = gstRegistration.id;

    await financialYears.create({
      organizationId: ledgerOrgId, legalEntityId: ledgerLegalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31',
      setCurrent: true, actorId: ledgerActorId, correlationId: generateId(),
    });

    const project = await vendorBillsProjects.create({
      organizationId: ledgerOrgId, clientId: client.id, legalEntityId: ledgerLegalEntityId, leadId: undefined, tenderId: undefined,
      projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined, name: 'PEL Test Project', description: undefined,
      value: undefined, budget: undefined, gstApplicable: undefined, workOrderNumber: undefined, workOrderDate: undefined,
      actorId: ledgerActorId, correlationId: generateId(),
    });
    ledgerProjectId = project.id;

    const vendor = await vendorsSvc.create({
      organizationId: ledgerOrgId, existingPartyId: undefined, name: 'PEL Test Vendor', shortCode: undefined, gstin: undefined,
      panNumber: undefined, paymentTerms: undefined, stateId: gujarat.id, districtId: undefined, cityId: undefined, pinCode: undefined,
      officeAddress: undefined, internalNote: undefined, actorId: ledgerActorId, correlationId: generateId(),
    });
    vendorId = vendor.id;

    const assetGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId: ledgerOrgId, code: 'PEL_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true } });
    const liabilityGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId: ledgerOrgId, code: 'PEL_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true } });
    const expenseGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId: ledgerOrgId, code: 'PEL_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true } });

    await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: liabilityGroup.id, code: 'ACCOUNTS_PAYABLE_VENDOR', name: 'Accounts Payable — Vendor', allowManualPosting: true, isActive: true } });
    await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: assetGroup.id, code: 'INPUT_CGST_RECEIVABLE', name: 'Input CGST Receivable', allowManualPosting: true, isActive: true } });
    await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: assetGroup.id, code: 'INPUT_SGST_RECEIVABLE', name: 'Input SGST Receivable', allowManualPosting: true, isActive: true } });
    await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: assetGroup.id, code: 'INPUT_IGST_RECEIVABLE', name: 'Input IGST Receivable', allowManualPosting: true, isActive: true } });
    const hardwareAccount = await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: expenseGroup.id, code: 'HARDWARE_EXPENSE', name: 'Hardware Expense', allowManualPosting: true, isActive: true } });
    await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: expenseGroup.id, code: 'OTHER_EXPENSES', name: 'Other Expenses', allowManualPosting: true, isActive: true } });
    await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: assetGroup.id, code: 'EMPLOYEE_ADVANCE_RECEIVABLE', name: 'Employee Advance Receivable', allowManualPosting: true, isActive: true } });
    await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: assetGroup.id, code: 'INPUT_GST_RECEIVABLE_EXPENSE', name: 'Input GST Receivable — Expense Claims', allowManualPosting: true, isActive: true } });
    const travelAccount = await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: expenseGroup.id, code: 'PEL_TRAVEL_EXPENSE', name: 'Travel Expense', allowManualPosting: true, isActive: true } });
    const hdfcAccount = await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId: ledgerOrgId, accountGroupId: assetGroup.id, code: 'PEL_HDFC_CURRENT_ACCOUNT', name: 'HDFC Current Account', allowManualPosting: true, isActive: true } });

    const hardwareCategory = await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId: ledgerOrgId, code: 'PEL-HARDWARE', name: 'Hardware', ledgerAccountId: hardwareAccount.id } });
    hardwareCategoryId = hardwareCategory.id;
    const travelCategory = await prisma.client.expenseCategory.create({ data: { id: generateId(), organizationId: ledgerOrgId, code: 'PEL-TRAVEL', name: 'Travel', ledgerAccountId: travelAccount.id } });
    travelCategoryId = travelCategory.id;

    const qtyUnit = await prisma.client.unitOfMeasure.create({ data: { id: generateId(), organizationId: ledgerOrgId, code: 'pel-qty', name: 'Qty' } });

    const bankAccount = await legalEntities.createBankAccount({
      organizationId: ledgerOrgId, legalEntityId: ledgerLegalEntityId, ledgerAccountId: hdfcAccount.id, accountName: 'PEL Operating Account',
      bankName: 'HDFC Bank', maskedAccountNumber: '****9911', ifsc: 'HDFC0000456', actorId: ledgerActorId, correlationId: generateId(),
    });
    bankAccountId = bankAccount.id;

    const reimbursableUser = await prisma.client.user.create({ data: { id: generateId(), organizationId: ledgerOrgId, email: `pel-employee-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: 'PEL Employee', status: 'ACTIVE' } });
    reimbursableUserId = reimbursableUser.id;
    await prisma.client.employee.create({
      data: { id: generateId(), organizationId: ledgerOrgId, userId: reimbursableUserId, employeeCode: 'EMP-PEL-1', fullName: 'P. Patel', joiningDate: new Date('2024-01-01'), isReimbursable: true },
    });

    // Purchase: one FINALIZED vendor bill (real cost) + one left SUBMITTED (must be excluded).
    finalizedBillAmount = '118000.00';
    const finalizedDraft = await vendorBills.createDraft({
      organizationId: ledgerOrgId, projectId: ledgerProjectId, vendorId, priority: undefined, gstRegistrationId, vendorBillNumber: 'PEL-BILL-1',
      vendorBillDate: '2026-03-10',
      lines: [{ description: 'Server rack', expenseCategoryId: hardwareCategoryId, inventoryItemId: undefined, unitOfMeasureId: qtyUnit.id, hsnSac: '8471', quantity: '1', unitPrice: '100000', gstRatePercent: '9', itcEligible: true }],
      idempotencyKey: generateId(), actorId: ledgerActorId, canSeeAll: true, correlationId: generateId(),
    });
    const finalizedSubmitted = await vendorBills.submit({ organizationId: ledgerOrgId, id: finalizedDraft.id, expectedVersion: finalizedDraft.version, idempotencyKey: generateId(), actorId: ledgerActorId, canSeeAll: true, correlationId: generateId() });
    const finalizedBill = await vendorBills.approve({ organizationId: ledgerOrgId, id: finalizedSubmitted.id, expectedVersion: finalizedSubmitted.version, note: undefined, idempotencyKey: generateId(), actorId: generateId(), canSeeAll: true, hasSelfApprovePermission: false, correlationId: generateId() });
    finalizedBillId = finalizedBill.id;

    const pendingDraft = await vendorBills.createDraft({
      organizationId: ledgerOrgId, projectId: ledgerProjectId, vendorId, priority: undefined, gstRegistrationId, vendorBillNumber: 'PEL-BILL-2',
      vendorBillDate: '2026-03-12',
      lines: [{ description: 'Not yet finalized', expenseCategoryId: hardwareCategoryId, inventoryItemId: undefined, unitOfMeasureId: qtyUnit.id, hsnSac: '8471', quantity: '1', unitPrice: '5000', gstRatePercent: '9', itcEligible: true }],
      idempotencyKey: generateId(), actorId: ledgerActorId, canSeeAll: true, correlationId: generateId(),
    });
    await vendorBills.submit({ organizationId: ledgerOrgId, id: pendingDraft.id, expectedVersion: pendingDraft.version, idempotencyKey: generateId(), actorId: ledgerActorId, canSeeAll: true, correlationId: generateId() });

    // Reimbursement: one APPROVED (not yet reimbursed) claim, one REIMBURSED claim, one left DRAFT (must be excluded).
    approvedClaimAmount = '5000.00';
    await makeClaimApprover(prisma, ledgerOrgId, ledgerActorId);
    const approvedDraft = await employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId: ledgerOrgId, expenseCategoryId: travelCategoryId, title: 'Site visit',
      projectId: ledgerProjectId, legalEntityId: undefined, amount: '5000', expenseDate: '2026-03-11', gstInvoiceAvailable: false,
      gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });
    const approvedSubmitted = await employeeExpenses.submitClaim({ organizationId: ledgerOrgId, id: approvedDraft.id, expectedVersion: approvedDraft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
    const approvedClaim = await employeeExpenses.approveClaim({ organizationId: ledgerOrgId, id: approvedSubmitted.id, expectedVersion: approvedSubmitted.version, note: undefined, idempotencyKey: generateId(), actorId: ledgerActorId, hasSelfApprovePermission: false, correlationId: generateId() });
    approvedClaimId = approvedClaim.id;

    reimbursedClaimAmount = '3000.00';
    const reimbDraft = await employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId: ledgerOrgId, expenseCategoryId: travelCategoryId, title: 'Client meeting travel',
      projectId: ledgerProjectId, legalEntityId: undefined, amount: '3000', expenseDate: '2026-03-13', gstInvoiceAvailable: false,
      gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });
    const reimbSubmitted = await employeeExpenses.submitClaim({ organizationId: ledgerOrgId, id: reimbDraft.id, expectedVersion: reimbDraft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
    const reimbApproved = await employeeExpenses.approveClaim({ organizationId: ledgerOrgId, id: reimbSubmitted.id, expectedVersion: reimbSubmitted.version, note: undefined, idempotencyKey: generateId(), actorId: ledgerActorId, hasSelfApprovePermission: false, correlationId: generateId() });
    await employeeExpenses.reimburseClaim({ organizationId: ledgerOrgId, id: reimbApproved.id, expectedVersion: reimbApproved.version, bankAccountId, reimbursementDate: '2026-03-14', idempotencyKey: generateId(), actorId: ledgerActorId, correlationId: generateId() });

    await employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId: ledgerOrgId, expenseCategoryId: travelCategoryId, title: 'Still a draft',
      projectId: ledgerProjectId, legalEntityId: undefined, amount: '999', expenseDate: '2026-03-15', gstInvoiceAvailable: false,
      gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });

    // Direct Expense: one POSTED expense (real cost) + one left DRAFT (must be excluded).
    bankTransferModeId = (await prisma.client.paymentMode.findFirstOrThrow({ where: { code: 'BANK_TRANSFER' } })).id;
    directExpenseAmount = '2000.00';
    const directExpenseDraft = await directExpenses.createDraft({
      organizationId: ledgerOrgId, expenseCategoryId: hardwareCategoryId, vendorId: undefined, title: 'Cables and connectors',
      projectId: ledgerProjectId, legalEntityId: undefined, taxableAmount: '2000', expenseDate: '2026-03-16', gstInvoiceAvailable: false,
      gstRatePercent: undefined, supplyType: undefined, itcEligible: undefined, tdsAmount: undefined, tdsRatePercent: undefined,
      paymentModeId: bankTransferModeId, bankAccountId, cardAccountId: undefined, transactionReference: undefined, purchasedByEmployeeId: undefined,
      note: undefined, idempotencyKey: generateId(), actorId: ledgerActorId, correlationId: generateId(),
    });
    const directExpensePosted = await directExpenses.post({
      organizationId: ledgerOrgId, id: directExpenseDraft.id, expectedVersion: directExpenseDraft.version,
      idempotencyKey: generateId(), actorId: ledgerActorId, correlationId: generateId(),
    });
    directExpenseId = directExpensePosted.id;

    await directExpenses.createDraft({
      organizationId: ledgerOrgId, expenseCategoryId: hardwareCategoryId, vendorId: undefined, title: 'Still a draft direct expense',
      projectId: ledgerProjectId, legalEntityId: undefined, taxableAmount: '444', expenseDate: '2026-03-17', gstInvoiceAvailable: false,
      gstRatePercent: undefined, supplyType: undefined, itcEligible: undefined, tdsAmount: undefined, tdsRatePercent: undefined,
      paymentModeId: bankTransferModeId, bankAccountId, cardAccountId: undefined, transactionReference: undefined, purchasedByEmployeeId: undefined,
      note: undefined, idempotencyKey: generateId(), actorId: ledgerActorId, correlationId: generateId(),
    });

    // --- Phase 7 streams (ADR-097). Inserted directly rather than posted
    // through their services: this is a READ test, and the ledger cares only
    // about each row's shape and status. Neither InventoryConsumption nor
    // IntroducerAccrual carries an FK to JournalEntry, so a generated id is
    // a valid stand-in for the journal each would really have.

    // Material: one POSTED consumption (counts) + one REVERSED (must not).
    const unit = await prisma.client.unitOfMeasure.create({
      data: { id: generateId(), organizationId: ledgerOrgId, code: 'nos', name: 'Nos' },
    });
    const item = await prisma.client.inventoryItem.create({
      data: { id: generateId(), organizationId: ledgerOrgId, code: 'ITEM-000001', name: 'Cat6 Cable', unitOfMeasureId: unit.id },
    });
    const makeConsumption = async (number: string, amount: string, status: 'POSTED' | 'REVERSED') => {
      const row = await prisma.client.inventoryConsumption.create({
        data: {
          id: generateId(), organizationId: ledgerOrgId, legalEntityId: ledgerLegalEntityId,
          consumptionNumber: number, projectId: ledgerProjectId,
          consumedDate: new Date('2026-03-18T00:00:00.000Z'), status,
          totalValueAmount: new Prisma.Decimal(amount), journalEntryId: generateId(),
          ...(status === 'REVERSED' ? { reversalJournalEntryId: generateId(), reversedAt: new Date() } : {}),
        },
      });
      await prisma.client.inventoryConsumptionLine.create({
        data: {
          id: generateId(), organizationId: ledgerOrgId, inventoryConsumptionId: row.id, inventoryItemId: item.id,
          sequence: 1, quantity: new Prisma.Decimal(1), unitCostAmount: new Prisma.Decimal(amount),
          lineValueAmount: new Prisma.Decimal(amount),
        },
      });
      return row.id;
    };
    consumptionId = await makeConsumption('CONS-000001', '5000.00', 'POSTED');
    await makeConsumption('CONS-000002', '777.00', 'REVERSED');

    // Introducer: one POSTED accrual (counts) + one REVERSED (must not).
    const introducer = await prisma.client.introducer.create({
      data: { id: generateId(), organizationId: ledgerOrgId, name: 'Ledger Introducer' },
    });
    const agreement = await prisma.client.introducerAgreement.create({
      data: {
        id: generateId(), organizationId: ledgerOrgId, introducerId: introducer.id, projectId: ledgerProjectId,
        legalEntityId: ledgerLegalEntityId, basisType: 'FIXED_AMOUNT', fixedAmount: new Prisma.Decimal('9000'),
        agreementDate: new Date('2026-03-01T00:00:00.000Z'),
      },
    });
    const makeAccrual = async (number: string, amount: string, status: 'POSTED' | 'REVERSED') =>
      (await prisma.client.introducerAccrual.create({
        data: {
          id: generateId(), organizationId: ledgerOrgId, introducerAgreementId: agreement.id, accrualNumber: number,
          accrualDate: new Date('2026-03-19T00:00:00.000Z'), amount: new Prisma.Decimal(amount), status,
          journalEntryId: generateId(),
          ...(status === 'REVERSED' ? { reversalJournalEntryId: generateId(), reversedAt: new Date() } : {}),
        },
      })).id;
    accrualId = await makeAccrual('INTA-000001', '3000.00', 'POSTED');
    await makeAccrual('INTA-000002', '888.00', 'REVERSED');

    // Manpower: 60% of a 50,000 gross = 30,000 for a SUBMITTED month, plus a
    // DRAFT month that must contribute nothing.
    const employee = await prisma.client.employee.create({
      data: {
        id: generateId(), organizationId: ledgerOrgId, employeeCode: 'LEDG-001', fullName: 'Ledger Employee',
        joiningDate: new Date('2025-01-01T00:00:00.000Z'),
      },
    });
    const makeSalaryMonth = async (month: string, gross: string) => {
      const batch = await prisma.client.salaryImport.create({
        data: {
          id: generateId(), organizationId: ledgerOrgId, legalEntityId: ledgerLegalEntityId,
          salaryMonth: new Date(`${month}T00:00:00.000Z`), accountingDate: new Date(`${month}T00:00:00.000Z`),
          employeeCount: 1, totalGrossAmount: new Prisma.Decimal(gross), status: 'POSTED', journalEntryId: generateId(),
        },
      });
      await prisma.client.salaryImportLine.create({
        data: {
          id: generateId(), organizationId: ledgerOrgId, salaryImportId: batch.id, employeeId: employee.id,
          employeeCodeRaw: 'LEDG-001', grossSalaryAmount: new Prisma.Decimal(gross),
        },
      });
    };
    // The remaining share goes to a non-project target, so the test also
    // proves only project lines reach the project's ledger.
    const benchTarget = await prisma.client.allocationTarget.create({
      data: { id: generateId(), organizationId: ledgerOrgId, code: 'bench', name: 'Bench' },
    });
    const makeAllocation = async (month: string, status: 'DRAFT' | 'SUBMITTED', percent: string) => {
      const allocation = await prisma.client.employeeMonthlyAllocation.create({
        data: {
          id: generateId(), organizationId: ledgerOrgId, employeeId: employee.id,
          allocationMonth: new Date(`${month}T00:00:00.000Z`), status,
          ...(status === 'SUBMITTED' ? { submittedAt: new Date() } : {}),
        },
      });
      const remainder = new Prisma.Decimal(100).minus(percent);
      await prisma.client.employeeAllocationLine.createMany({
        data: [
          { id: generateId(), organizationId: ledgerOrgId, employeeMonthlyAllocationId: allocation.id, projectId: ledgerProjectId, sequence: 1, percentage: new Prisma.Decimal(percent) },
          // Only when there is something left — a zero-percent line is
          // refused by chk_employee_allocation_lines_percentage_range.
          ...(remainder.greaterThan(0)
            ? [{ id: generateId(), organizationId: ledgerOrgId, employeeMonthlyAllocationId: allocation.id, allocationTargetId: benchTarget.id, sequence: 2, percentage: remainder }]
            : []),
        ],
      });
    };
    await makeSalaryMonth('2026-03-01', '50000');
    await makeAllocation('2026-03-01', 'SUBMITTED', '60');
    await makeSalaryMonth('2026-04-01', '50000');
    await makeAllocation('2026-04-01', 'DRAFT', '100');
  });

  afterAll(async () => {
    await prisma.client.auditEvent.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.employeeExpenseClaimDecision.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.employeeExpenseClaim.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.vendorBillDecision.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.vendorBillLine.deleteMany({ where: { vendorBill: { organizationId: ledgerOrgId } } });
    await prisma.client.vendorBill.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.directExpense.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.expenseCategory.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.inventoryConsumptionLine.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.inventoryConsumption.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.inventoryItem.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.introducerAccrual.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.introducerAgreement.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.introducer.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.employeeAllocationLine.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.employeeMonthlyAllocation.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.allocationTarget.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.salaryImportLine.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.salaryImport.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.unitOfMeasure.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.journalLine.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.journalEntry.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.bankAccount.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.accountGroup.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.employee.deleteMany({ where: { organizationId: ledgerOrgId } });
    await removeClaimApprovers(prisma, [ledgerOrgId]);
    await prisma.client.user.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.projectTeamMember.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.project.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.vendorProfile.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.financialYear.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.gstRegistration.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.contact.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.clientProfile.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.party.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.legalEntity.deleteMany({ where: { organizationId: ledgerOrgId } });
    await prisma.client.organization.deleteMany({ where: { id: ledgerOrgId } });
  });

  it('rolls up FINALIZED vendor bills, APPROVED/REIMBURSED claims and POSTED direct expenses, excluding drafts/pending ones, with Decimal-safe totals', async () => {
    const ledger = await projects.getExpenseLedger({
      organizationId: ledgerOrgId, projectId: ledgerProjectId, actorId: ledgerActorId, canSeeAll: true,
      hasVendorBillReadPermission: true, hasEmployeeClaimReadPermission: true, hasDirectExpenseReadPermission: true,
      hasInventoryReadPermission: true, hasProjectCostReadPermission: true, hasIntroducerFeeReadPermission: true,
      category: undefined, dateFrom: undefined, dateTo: undefined,
    });

    // 4 original documents + 1 material + 1 introducer + 1 manpower month.
    expect(ledger.rows).toHaveLength(7);
    expect(ledger.rows.find((r) => r.linkId === finalizedBillId)?.amount).toBe(finalizedBillAmount);
    expect(ledger.rows.find((r) => r.linkId === approvedClaimId)?.amount).toBe(approvedClaimAmount);
    expect(ledger.rows.some((r) => r.amount === reimbursedClaimAmount)).toBe(true);
    expect(ledger.rows.find((r) => r.linkId === directExpenseId)?.amount).toBe(directExpenseAmount);
    expect(ledger.rows.find((r) => r.linkId === directExpenseId)?.linkType).toBe('DIRECT_EXPENSE');
    expect(ledger.rows.some((r) => r.amount === '999.00')).toBe(false);
    expect(ledger.rows.some((r) => r.amount === '444.00')).toBe(false);

    // 128,000 of documents + 5,000 material + 30,000 manpower + 3,000
    // introducer. The REVERSED consumption (777), REVERSED accrual (888) and
    // DRAFT allocation month are all excluded.
    expect(ledger.totalAmount).toBe('166000.00');
    expect(ledger.categoryTotals).toEqual(
      expect.arrayContaining([
        { category: 'PURCHASE', amount: '118000.00' },
        { category: 'REIMBURSEMENT', amount: '8000.00' },
        { category: 'DIRECT_EXPENSE', amount: '2000.00' },
        { category: 'MATERIAL', amount: '5000.00' },
        { category: 'MANPOWER', amount: '30000.00' },
        { category: 'INTRODUCER', amount: '3000.00' },
      ]),
    );
    expect(ledger.largestCategory).toBe('PURCHASE');
    expect(ledger.largestCategoryPercent).toBeGreaterThan(50);
  });

  it('includes the three Phase 7 streams with the right shape, and excludes reversed/draft ones', async () => {
    const ledger = await projects.getExpenseLedger({
      organizationId: ledgerOrgId, projectId: ledgerProjectId, actorId: ledgerActorId, canSeeAll: true,
      hasVendorBillReadPermission: true, hasEmployeeClaimReadPermission: true, hasDirectExpenseReadPermission: true,
      hasInventoryReadPermission: true, hasProjectCostReadPermission: true, hasIntroducerFeeReadPermission: true,
      category: undefined, dateFrom: undefined, dateTo: undefined,
    });

    const material = ledger.rows.find((r) => r.category === 'MATERIAL')!;
    expect(material.amount).toBe('5000.00');
    expect(material.linkType).toBe('INVENTORY_CONSUMPTION');
    expect(material.linkId).toBe(consumptionId);
    expect(material.title).toContain('CONS-000001');

    const introducer = ledger.rows.find((r) => r.category === 'INTRODUCER')!;
    expect(introducer.amount).toBe('3000.00');
    expect(introducer.linkType).toBe('INTRODUCER_ACCRUAL');
    expect(introducer.linkId).toBe(accrualId);
    expect(introducer.subtitle).toBe('Ledger Introducer');

    // 60% of a 50,000 gross. The other 40% went to a non-project target and
    // must not appear, and manpower carries no document to open.
    const manpower = ledger.rows.find((r) => r.category === 'MANPOWER')!;
    expect(manpower.amount).toBe('30000.00');
    expect(manpower.linkType).toBe('NONE');
    expect(manpower.linkId).toBeNull();
    expect(manpower.subtitle).toBe('1 employee allocated');

    // Exactly one row each — the reversed/draft twins contributed nothing.
    expect(ledger.rows.filter((r) => r.category === 'MATERIAL')).toHaveLength(1);
    expect(ledger.rows.filter((r) => r.category === 'INTRODUCER')).toHaveLength(1);
    expect(ledger.rows.filter((r) => r.category === 'MANPOWER')).toHaveLength(1);
    expect(ledger.rows.some((r) => r.amount === '777.00' || r.amount === '888.00')).toBe(false);
  });

  it('drops a Phase 7 category the actor cannot read from rows AND totals, not just the row list', async () => {
    const ledger = await projects.getExpenseLedger({
      organizationId: ledgerOrgId, projectId: ledgerProjectId, actorId: ledgerActorId, canSeeAll: true,
      hasVendorBillReadPermission: false, hasEmployeeClaimReadPermission: false, hasDirectExpenseReadPermission: false,
      hasInventoryReadPermission: true, hasProjectCostReadPermission: false, hasIntroducerFeeReadPermission: false,
      category: undefined, dateFrom: undefined, dateTo: undefined,
    });

    // Only Material is readable, so the total IS the material total — an
    // actor never sees an aggregate built partly from data they cannot break
    // down (ADR-086's rule, now applied to the new categories too).
    expect(ledger.totalAmount).toBe('5000.00');
    expect(ledger.categoryTotals).toEqual([{ category: 'MATERIAL', amount: '5000.00' }]);
    expect(ledger.largestCategory).toBe('MATERIAL');
    expect(ledger.rows.every((r) => r.category === 'MATERIAL')).toBe(true);
  });

  it('fully excludes a category the actor lacks read permission for, from rows and totals alike', async () => {
    const ledger = await projects.getExpenseLedger({
      organizationId: ledgerOrgId, projectId: ledgerProjectId, actorId: ledgerActorId, canSeeAll: true,
      hasVendorBillReadPermission: true, hasEmployeeClaimReadPermission: false, hasDirectExpenseReadPermission: false,
      hasInventoryReadPermission: false, hasProjectCostReadPermission: false, hasIntroducerFeeReadPermission: false,
      category: undefined, dateFrom: undefined, dateTo: undefined,
    });
    expect(ledger.rows.every((r) => r.category === 'PURCHASE')).toBe(true);
    expect(ledger.totalAmount).toBe(finalizedBillAmount);
    expect(ledger.categoryTotals).toEqual([{ category: 'PURCHASE', amount: finalizedBillAmount }]);
    expect(ledger.largestCategory).toBe('PURCHASE');
    expect(ledger.largestCategoryPercent).toBe(100);
  });

  it('narrows by an explicit category filter, including the Direct Expense category', async () => {
    const reimbursementLedger = await projects.getExpenseLedger({
      organizationId: ledgerOrgId, projectId: ledgerProjectId, actorId: ledgerActorId, canSeeAll: true,
      hasVendorBillReadPermission: true, hasEmployeeClaimReadPermission: true, hasDirectExpenseReadPermission: true,
      hasInventoryReadPermission: true, hasProjectCostReadPermission: true, hasIntroducerFeeReadPermission: true,
      category: 'REIMBURSEMENT', dateFrom: undefined, dateTo: undefined,
    });
    expect(reimbursementLedger.rows.every((r) => r.category === 'REIMBURSEMENT')).toBe(true);
    expect(reimbursementLedger.totalAmount).toBe('8000.00');

    const directExpenseLedger = await projects.getExpenseLedger({
      organizationId: ledgerOrgId, projectId: ledgerProjectId, actorId: ledgerActorId, canSeeAll: true,
      hasVendorBillReadPermission: true, hasEmployeeClaimReadPermission: true, hasDirectExpenseReadPermission: true,
      hasInventoryReadPermission: true, hasProjectCostReadPermission: true, hasIntroducerFeeReadPermission: true,
      category: 'DIRECT_EXPENSE', dateFrom: undefined, dateTo: undefined,
    });
    expect(directExpenseLedger.rows).toHaveLength(1);
    expect(directExpenseLedger.rows[0]?.linkId).toBe(directExpenseId);
    expect(directExpenseLedger.totalAmount).toBe(directExpenseAmount);
    expect(directExpenseLedger.largestCategory).toBe('DIRECT_EXPENSE');
    expect(directExpenseLedger.largestCategoryPercent).toBe(100);
  });

  it('narrows by date range', async () => {
    const ledger = await projects.getExpenseLedger({
      organizationId: ledgerOrgId, projectId: ledgerProjectId, actorId: ledgerActorId, canSeeAll: true,
      hasVendorBillReadPermission: true, hasEmployeeClaimReadPermission: true, hasDirectExpenseReadPermission: true,
      hasInventoryReadPermission: true, hasProjectCostReadPermission: true, hasIntroducerFeeReadPermission: true,
      category: undefined, dateFrom: '2026-03-13', dateTo: '2026-03-14',
    });
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.amount).toBe(reimbursedClaimAmount);
  });

  it('denies an actor who cannot see this project at all', async () => {
    const outsiderActorId = generateId();
    await expect(
      projects.getExpenseLedger({
        organizationId: ledgerOrgId, projectId: ledgerProjectId, actorId: outsiderActorId, canSeeAll: false,
        hasVendorBillReadPermission: true, hasEmployeeClaimReadPermission: true, hasDirectExpenseReadPermission: true,
      hasInventoryReadPermission: true, hasProjectCostReadPermission: true, hasIntroducerFeeReadPermission: true,
        category: undefined, dateFrom: undefined, dateTo: undefined,
      }),
    ).rejects.toThrow('not found');
  });
});
