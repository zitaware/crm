import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';

const prisma = new PrismaService();
const identity = new IdentityService(prisma);

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let organizationId: string;
let withLogoUserId: string;
let noLogoUserId: string;
let noEmployeeUserId: string;

beforeAll(async () => {
  const db = prisma.client;
  organizationId = (await db.organization.create({ data: { id: generateId(), name: 'Brand Org', code: `BRAND-${generateId()}` } })).id;
  const entity = (legalName: string, withLogo: boolean) =>
    db.legalEntity.create({
      data: {
        id: generateId(),
        organizationId,
        legalName,
        panNumber: `BRND${String(Math.floor(Math.random() * 9000) + 1000)}Q`,
        registeredAddress: 'Ahmedabad',
        ...(withLogo ? { logoContentType: 'image/png', logoBytes: PNG } : {}),
      },
    });
  const concentric = await entity('Concentric Brand Pvt Ltd', true);
  const ninja = await entity('Ninja Brand', false);

  const user = async (withEmployeeIn: string | null) => {
    const id = (await db.user.create({ data: { id: generateId(), organizationId, email: `brand-${generateId()}@zitaware.test`, passwordHash: 'x', displayName: 'Brand User', status: 'ACTIVE' } })).id;
    if (withEmployeeIn) {
      await db.employee.create({ data: { id: generateId(), organizationId, legalEntityId: withEmployeeIn, userId: id, employeeCode: `B-${generateId().slice(-8)}`, fullName: 'Brand Person', joiningDate: new Date('2026-01-01') } });
    }
    return id;
  };
  withLogoUserId = await user(concentric.id);
  noLogoUserId = await user(ninja.id);
  noEmployeeUserId = await user(null);
});

afterAll(async () => {
  const where = { organizationId };
  await prisma.client.employee.deleteMany({ where });
  await prisma.client.user.deleteMany({ where });
  await prisma.client.legalEntity.deleteMany({ where });
  await prisma.client.organization.deleteMany({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('White-label brand in the shell', () => {
  it('is the legal entity of the user’s own employee record, with its logo', async () => {
    expect(await identity.getProfile(withLogoUserId, organizationId)).toMatchObject({ organizationName: 'Brand Org', brandName: 'Concentric Brand Pvt Ltd', brandHasLogo: true });
    expect(await identity.getBrandLogo(withLogoUserId, organizationId)).toEqual({ contentType: 'image/png', dataBase64: PNG.toString('base64') });
  });

  it('has a name but no logo when the legal entity has none', async () => {
    expect(await identity.getProfile(noLogoUserId, organizationId)).toMatchObject({ brandName: 'Ninja Brand', brandHasLogo: false });
    expect(await identity.getBrandLogo(noLogoUserId, organizationId)).toBeNull();
  });

  it('is absent for a user with no employee record, so the shell shows the organization', async () => {
    expect(await identity.getProfile(noEmployeeUserId, organizationId)).toMatchObject({ brandName: null, brandHasLogo: false });
    expect(await identity.getBrandLogo(noEmployeeUserId, organizationId)).toBeNull();
  });
});
