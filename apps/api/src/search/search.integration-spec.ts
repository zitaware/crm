import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import type { GlobalSearchKind } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { SearchService } from './search.service';

const prisma = new PrismaService();
const search = new SearchService(prisma, new ProjectsService(prisma));

const ALL: GlobalSearchKind[] = ['PROJECT', 'CLIENT', 'LEAD', 'INVOICE', 'VENDOR_BILL', 'VENDOR', 'EMPLOYEE'];

let organizationId: string;
let userId: string;
let alphaId: string;
let betaId: string;

const find = (input: { query: string; kinds?: GlobalSearchKind[]; actorId?: string; canSeeAllProjects?: boolean }) =>
  search.search({ organizationId, actorId: input.actorId ?? generateId(), query: input.query, kinds: input.kinds ?? ALL, canSeeAllProjects: input.canSeeAllProjects ?? true });

beforeAll(async () => {
  const db = prisma.client;
  organizationId = (await db.organization.create({ data: { id: generateId(), name: 'Search Test Org', code: `SRCH-${generateId()}` } })).id;
  const legalEntityId = (await db.legalEntity.create({ data: { id: generateId(), organizationId, legalName: 'Searchco Holdings', panNumber: 'SRCHP1234Q', registeredAddress: 'Ahmedabad' } })).id;

  const party = async (name: string, profile: 'client' | 'vendor' | null) => {
    const row = await db.party.create({ data: { id: generateId(), organizationId, name } });
    if (profile === 'client') await db.clientProfile.create({ data: { id: generateId(), organizationId, partyId: row.id } });
    if (profile === 'vendor') await db.vendorProfile.create({ data: { id: generateId(), organizationId, partyId: row.id } });
    return row.id;
  };
  const clientId = await party('Searchco Client', 'client');
  const vendorId = await party('Searchco Supplies', 'vendor');
  await party('Searchco Loose Party', null);

  userId = (await db.user.create({ data: { id: generateId(), organizationId, email: `search-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: 'Search Actor', status: 'ACTIVE' } })).id;
  const employeeId = (
    await db.employee.create({ data: { id: generateId(), organizationId, legalEntityId, userId, employeeCode: 'SC-EMP-1', fullName: 'Searchco Person', joiningDate: new Date('2026-01-01') } })
  ).id;

  alphaId = (await db.project.create({ data: { id: generateId(), organizationId, clientId, legalEntityId, name: 'Searchco Alpha', projectManagerId: employeeId } })).id;
  betaId = (await db.project.create({ data: { id: generateId(), organizationId, clientId, legalEntityId, name: 'Searchco Beta' } })).id;

  await db.tender.create({ data: { id: generateId(), organizationId, clientId, tenderNumber: 'TN-SC-1', title: 'Searchco bridge works', tenderDate: new Date('2026-02-01') } });

  const state = await db.state.findFirstOrThrow({ where: { code: 'GJ' } });
  const gstRegistrationId = (await db.gstRegistration.create({ data: { id: generateId(), organizationId, legalEntityId, stateId: state.id, gstin: '24SRCHP1234Q1Z5' } })).id;
  const bill = (number: string, projectId: string | null, createdBy: string | null) =>
    db.vendorBill.create({
      data: { id: generateId(), organizationId, vendorId, legalEntityId, gstRegistrationId, vendorBillNumber: number, vendorBillDate: new Date('2026-03-01'), projectId, createdBy },
    });
  await bill('SC-BILL-7', betaId, null);
  await bill('SC-BILL-8', null, userId);
});

afterAll(async () => {
  const db = prisma.client;
  const where = { organizationId };
  await db.vendorBill.deleteMany({ where });
  await db.gstRegistration.deleteMany({ where });
  await db.tender.deleteMany({ where });
  await db.project.deleteMany({ where });
  await db.employee.deleteMany({ where });
  await db.user.deleteMany({ where });
  await db.clientProfile.deleteMany({ where });
  await db.vendorProfile.deleteMany({ where });
  await db.party.deleteMany({ where });
  await db.legalEntity.deleteMany({ where });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('Global search', () => {
  it('finds projects, clients and vendors by name, and only parties that are clients or vendors', async () => {
    const hits = await find({ query: 'searchco' });
    const titles = (kind: GlobalSearchKind) => hits.filter((h) => h.kind === kind).map((h) => h.title).sort();
    expect(titles('PROJECT')).toEqual(['Searchco Alpha', 'Searchco Beta']);
    expect(titles('CLIENT')).toEqual(['Searchco Client']);
    expect(titles('VENDOR')).toEqual(['Searchco Supplies']);
    expect(hits.some((h) => h.title === 'Searchco Loose Party')).toBe(false);
    expect(hits.find((h) => h.kind === 'PROJECT' && h.id === alphaId)?.href).toBe(`/projects/${alphaId}`);
    expect(hits.find((h) => h.kind === 'VENDOR')?.href).toBe('/vendors?search=Searchco%20Supplies');
  });

  it('matches numbers too: vendor bill number, employee code — but never a tender (ADR-192)', async () => {
    expect(await find({ query: 'tn-sc' })).toEqual([]);
    expect((await find({ query: 'SC-BILL' })).map((h) => h.title).sort()).toEqual(['SC-BILL-7', 'SC-BILL-8']);
    const [employee] = await find({ query: 'sc-emp' });
    expect([employee?.kind, employee?.title, employee?.href]).toEqual(['EMPLOYEE', 'Searchco Person', '/employees?search=SC-EMP-1']);
  });

  it('shows a user without project.read_all only their projects, and only the vendor bills their lists show', async () => {
    const hits = await find({ query: 'searchco', actorId: userId, canSeeAllProjects: false });
    expect(hits.filter((h) => h.kind === 'PROJECT').map((h) => h.id)).toEqual([alphaId]);
    expect(hits.some((h) => h.id === betaId)).toBe(false);
    // SC-BILL-7 is on Beta, not theirs; SC-BILL-8 has no project and they entered it.
    const bills = await find({ query: 'SC-BILL', actorId: userId, canSeeAllProjects: false });
    expect(bills.map((h) => h.title)).toEqual(['SC-BILL-8']);
  });

  it('searches only the kinds asked for, and nothing for fewer than two characters', async () => {
    const hits = await find({ query: 'searchco', kinds: ['CLIENT'] });
    expect(hits.map((h) => h.kind)).toEqual(['CLIENT']);
    expect(await find({ query: 's' })).toEqual([]);
    expect(await find({ query: 'searchco', kinds: [] })).toEqual([]);
  });
});
