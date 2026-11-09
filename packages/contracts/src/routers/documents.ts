import { z } from 'zod';
import { requirePermission, router } from '../trpc';

export const documentsRouter = router({
  initiateUpload: requirePermission('document.upload')
    .input(
      z.object({
        documentCategoryId: z.string().uuid().optional(),
        originalFilename: z.string().min(1).max(255),
        contentType: z.string().min(1).max(200),
        sizeBytes: z.string().regex(/^\d+$/, 'Must be a non-negative integer.'),
        checksum: z.string().min(1).max(200),
        isEncrypted: z.boolean().optional(),
        encryptionSalt: z.string().max(200).optional(),
        encryptionIv: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.documents.initiateUpload({
        organizationId: ctx.auth.user!.organizationId,
        documentCategoryId: input.documentCategoryId,
        originalFilename: input.originalFilename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        checksum: input.checksum,
        isEncrypted: input.isEncrypted,
        encryptionSalt: input.encryptionSalt,
        encryptionIv: input.encryptionIv,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  confirmUpload: requirePermission('document.upload')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.documents.confirmUpload({
        organizationId: ctx.auth.user!.organizationId,
        documentId: input.documentId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  linkToEntity: requirePermission('document.manage')
    .input(
      z.object({
        documentId: z.string().uuid(),
        entityType: z.string().min(1),
        entityId: z.string().uuid(),
        linkType: z.string().max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Project is the only entity type with row-level (Project-Manager)
      // scoping — getDetail throws NOT_FOUND for an out-of-scope actor,
      // reused here so a scoped actor can't attach documents to a project
      // outside their assignment. See ADR-061.
      if (input.entityType === 'PROJECT') {
        await ctx.services.projects.getDetail({
          organizationId: ctx.auth.user!.organizationId,
          id: input.entityId,
          actorId: ctx.auth.user!.id,
          canSeeAll: ctx.auth.permissions.has('project.read_all'),
        });
      }
      return ctx.services.documents.linkToEntity({
        organizationId: ctx.auth.user!.organizationId,
        documentId: input.documentId,
        entityType: input.entityType,
        entityId: input.entityId,
        linkType: input.linkType,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  listLinksForEntity: requirePermission('document.read')
    .input(z.object({ entityType: z.string().min(1), entityId: z.string().uuid(), linkType: z.string().max(50).nullable().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.entityType === 'PROJECT') {
        await ctx.services.projects.getDetail({
          organizationId: ctx.auth.user!.organizationId,
          id: input.entityId,
          actorId: ctx.auth.user!.id,
          canSeeAll: ctx.auth.permissions.has('project.read_all'),
        });
      }
      return ctx.services.documents.listLinksForEntity({
        organizationId: ctx.auth.user!.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        linkType: input.linkType,
      });
    }),

  softDelete: requirePermission('document.manage')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.documents.softDelete({
        organizationId: ctx.auth.user!.organizationId,
        documentId: input.documentId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  getDownloadUrl: requirePermission('document.download')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.documents.getDownloadUrl({
        organizationId: ctx.auth.user!.organizationId,
        documentId: input.documentId,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),
});
