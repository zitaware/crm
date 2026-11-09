import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requirePermission, router } from '../trpc';

export const usersRouter = router({
  list: requirePermission('user.read').query(async ({ ctx }) => {
    return ctx.services.users.list({ organizationId: ctx.auth.user!.organizationId });
  }),

  get: requirePermission('user.read')
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.users.get({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
      });
    }),

  getDetail: requirePermission('user.read')
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.users.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
      });
    }),

  invite: requirePermission('user.manage')
    .input(
      z.object({
        email: z.string().email(),
        displayName: z.string().min(1),
        roleIds: z.array(z.string().uuid()).min(1),
        employeeId: z.string().uuid().optional(),
        idempotencyKey: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.users.invite({
        organizationId: ctx.auth.user!.organizationId,
        email: input.email,
        displayName: input.displayName,
        roleIds: input.roleIds,
        employeeId: input.employeeId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
        idempotencyKey: input.idempotencyKey,
        requestHash: hashRequest(input),
      });
    }),

  reinvite: requirePermission('user.manage')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.users.reinvite({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  disable: requirePermission('user.manage')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.users.disable({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  enable: requirePermission('user.manage')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.users.enable({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  revokeSessions: requirePermission('user.manage')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.users.revokeSessions({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  linkEmployee: requirePermission('user.manage')
    .input(z.object({ userId: z.string().uuid(), employeeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.users.linkEmployee({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        employeeId: input.employeeId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  unlinkEmployee: requirePermission('user.manage')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.users.unlinkEmployee({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),
});

function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}
