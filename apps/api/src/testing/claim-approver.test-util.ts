import { generateId } from '@zitaware/database';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Makes `userId` a user who approves every legal entity's expense claims, as
 * Admin does: employee_claim.approve and legal_entity.access_all. Only such a
 * user, or an approver of the claim's own legal entity, may approve (ADR-182).
 */
export async function makeClaimApprover(prisma: PrismaService, organizationId: string, userId: string): Promise<void> {
  await prisma.client.user.create({ data: { id: userId, organizationId, email: `approver-${userId}@zitaware.test`, passwordHash: 'test-hash', displayName: 'Test Approver', status: 'ACTIVE' } });
  const role = await prisma.client.role.create({ data: { id: generateId(), organizationId, name: `Claim Approver ${generateId().slice(-6)}`, isSystem: false } });
  const permissions = await prisma.client.permission.findMany({ where: { key: { in: ['employee_claim.approve', 'legal_entity.access_all'] } } });
  for (const permission of permissions) await prisma.client.rolePermission.create({ data: { id: generateId(), roleId: role.id, permissionId: permission.id } });
  await prisma.client.userRole.create({ data: { id: generateId(), organizationId, userId, roleId: role.id } });
}

/** Removes what makeClaimApprover added, before the organization's users are deleted. */
export async function removeClaimApprovers(prisma: PrismaService, organizationIds: string[]): Promise<void> {
  await prisma.client.userRole.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.client.rolePermission.deleteMany({ where: { role: { organizationId: { in: organizationIds } } } });
  await prisma.client.role.deleteMany({ where: { organizationId: { in: organizationIds } } });
}
