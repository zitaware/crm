import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';

const formKeySchema = z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,199}$/, 'Invalid form key.');

export const formDraftsRouter = router({
  get: protectedProcedure.input(z.object({ formKey: formKeySchema })).query(async ({ ctx, input }) => {
    return ctx.services.formDrafts.get({
      organizationId: ctx.auth.user.organizationId,
      userId: ctx.auth.user.id,
      formKey: input.formKey,
    });
  }),

  save: protectedProcedure
    .input(z.object({ formKey: formKeySchema, payload: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.formDrafts.save({
        organizationId: ctx.auth.user.organizationId,
        userId: ctx.auth.user.id,
        formKey: input.formKey,
        payload: input.payload,
      });
    }),

  clear: protectedProcedure.input(z.object({ formKey: formKeySchema })).mutation(async ({ ctx, input }) => {
    await ctx.services.formDrafts.clear({
      organizationId: ctx.auth.user.organizationId,
      userId: ctx.auth.user.id,
      formKey: input.formKey,
    });
  }),
});
