import { z } from 'zod';
import { requirePermission, router } from '../trpc';

export const rolesRouter = router({
  list: requirePermission('role.read').query(async ({ ctx }) => {
    return ctx.services.roles.list({ organizationId: ctx.auth.user!.organizationId });
  }),

  getDetail: requirePermission('role.read')
    .input(z.object({ roleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.roles.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        roleId: input.roleId,
      });
    }),

  getPermissions: requirePermission('role.read')
    .input(z.object({ roleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.roles.getPermissions({
        organizationId: ctx.auth.user!.organizationId,
        roleId: input.roleId,
      });
    }),

  listPermissionCatalog: requirePermission('role.read').query(async ({ ctx }) => {
    return ctx.services.roles.listPermissionCatalog();
  }),

  create: requirePermission('user.manage')
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(1000).optional(),
        permissionKeys: z.array(z.string().min(1)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.roles.create({
        organizationId: ctx.auth.user!.organizationId,
        name: input.name,
        description: input.description,
        permissionKeys: input.permissionKeys,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('user.manage')
    .input(
      z.object({
        roleId: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(1000).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.roles.update({
        organizationId: ctx.auth.user!.organizationId,
        roleId: input.roleId,
        name: input.name,
        description: input.description,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setPermissions: requirePermission('user.manage')
    .input(z.object({ roleId: z.string().uuid(), permissionKeys: z.array(z.string().min(1)) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.roles.setPermissions({
        organizationId: ctx.auth.user!.organizationId,
        roleId: input.roleId,
        permissionKeys: input.permissionKeys,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  delete: requirePermission('user.manage')
    .input(z.object({ roleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.roles.delete({
        organizationId: ctx.auth.user!.organizationId,
        roleId: input.roleId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  assignRole: requirePermission('user.manage')
    .input(z.object({ userId: z.string().uuid(), roleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.roles.assignRole({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        roleId: input.roleId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  removeRole: requirePermission('user.manage')
    .input(z.object({ userId: z.string().uuid(), roleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.roles.removeRole({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        roleId: input.roleId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  setPermissionOverride: requirePermission('user.manage')
    .input(
      z.object({
        userId: z.string().uuid(),
        permissionKey: z.string().min(1),
        effect: z.enum(['GRANT', 'REVOKE']),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.services.roles.setPermissionOverride({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        permissionKey: input.permissionKey,
        effect: input.effect,
        reason: input.reason,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  clearPermissionOverride: requirePermission('user.manage')
    .input(z.object({ userId: z.string().uuid(), permissionKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.roles.clearPermissionOverride({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        permissionKey: input.permissionKey,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),
});
