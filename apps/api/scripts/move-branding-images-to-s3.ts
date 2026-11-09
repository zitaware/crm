/**
 * One-time move of legal entity logo/seal/signature bytes into object
 * storage (ADR-193). New uploads already go to S3; this empties the old
 * *_bytes columns so no file is kept in the database. Safe to re-run: a row
 * whose image already has a storage key is skipped.
 *
 *   set -a; source .env; set +a
 *   npx tsx apps/api/scripts/move-branding-images-to-s3.ts
 */
import { PrismaClient } from '@prisma/client';
import { brandingImageKey, brandingImagePrefixFolder, brandingImageStore, type BrandingImageKind } from '../src/organization/branding-image-store';

const prisma = new PrismaClient();

const FIELDS: Array<{ field: 'logo' | 'seal' | 'authorizedSign'; kind: BrandingImageKind }> = [
  { field: 'logo', kind: 'logo' },
  { field: 'seal', kind: 'seal' },
  { field: 'authorizedSign', kind: 'authorized-sign' },
];

async function main() {
  const rows = await prisma.legalEntity.findMany({
    where: { OR: [{ logoBytes: { not: null } }, { sealBytes: { not: null } }, { authorizedSignBytes: { not: null } }] },
    select: {
      id: true,
      organizationId: true,
      legalName: true,
      logoContentType: true,
      logoBytes: true,
      logoStorageKey: true,
      sealContentType: true,
      sealBytes: true,
      sealStorageKey: true,
      authorizedSignContentType: true,
      authorizedSignBytes: true,
      authorizedSignStorageKey: true,
    },
  });

  let moved = 0;
  for (const row of rows) {
    const data: Record<string, unknown> = {};
    for (const { field, kind } of FIELDS) {
      const contentType = row[`${field}ContentType`];
      const bytes = row[`${field}Bytes`];
      if (!bytes) continue;
      if (row[`${field}StorageKey`] || (contentType !== 'image/png' && contentType !== 'image/jpeg')) {
        // Already in storage, or not a printable image: only clear the bytes.
        data[`${field}Bytes`] = null;
        continue;
      }
      const key = brandingImageKey({
        prefixFolder: brandingImagePrefixFolder(),
        organizationId: row.organizationId,
        legalEntityId: row.id,
        kind,
        contentType,
      });
      await brandingImageStore().put(key, Buffer.from(bytes), contentType);
      data[`${field}StorageKey`] = key;
      data[`${field}Bytes`] = null;
      moved += 1;
    }
    // Uploads finish before the row changes, so the row never points at a missing object.
    await prisma.legalEntity.update({ where: { id: row.id }, data });
    console.log(JSON.stringify({ event: 'branding_images.moved', legalEntity: row.legalName, fields: Object.keys(data) }));
  }
  console.log(JSON.stringify({ event: 'branding_images.done', legalEntities: rows.length, imagesMoved: moved }));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
