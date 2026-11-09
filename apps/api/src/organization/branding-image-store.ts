import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadEnv } from '@zitaware/config';
import { generateId } from '@zitaware/database';
import type { BrandingImageContentType } from '@zitaware/contracts';

export type BrandingImageKind = 'logo' | 'seal' | 'authorized-sign';

/**
 * Where a legal entity's logo, seal and authorized signature live (ADR-193):
 * the same S3 bucket and S3_PREFIX_FOLDER as documents. Integration tests
 * swap in the in-memory store so they never touch the real bucket.
 */
export interface BrandingImageStore {
  put(key: string, bytes: Buffer, contentType: BrandingImageContentType): Promise<void>;
  /** Null when the object is missing, so a lost file prints nothing rather than failing the page. */
  get(key: string): Promise<Buffer | null>;
}

/** `crm/<org>/legal-entities/<entity>/logo-<id>.png` — a fresh key per upload, so a replaced image never overwrites one an old invoice used. */
export function brandingImageKey(input: {
  prefixFolder: string;
  organizationId: string;
  legalEntityId: string;
  kind: BrandingImageKind;
  contentType: BrandingImageContentType;
  uniqueId?: string;
}): string {
  const extension = input.contentType === 'image/png' ? 'png' : 'jpg';
  const key = `${input.organizationId}/legal-entities/${input.legalEntityId}/${input.kind}-${input.uniqueId ?? generateId()}.${extension}`;
  const prefix = input.prefixFolder.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${key}` : key;
}

class S3BrandingImageStore implements BrandingImageStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const env = loadEnv();
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      forcePathStyle: !!env.S3_ENDPOINT,
    });
  }

  async put(key: string, bytes: Buffer, contentType: BrandingImageContentType): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!object.Body) return null;
      return Buffer.from(await object.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound')) return null;
      throw error;
    }
  }
}

export class InMemoryBrandingImageStore implements BrandingImageStore {
  readonly objects = new Map<string, Buffer>();

  put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
}

let current: BrandingImageStore | null = null;

export function brandingImageStore(): BrandingImageStore {
  current ??= new S3BrandingImageStore();
  return current;
}

/** Tests only: keep branding images in memory instead of the S3 bucket. */
export function useInMemoryBrandingImageStore(): InMemoryBrandingImageStore {
  const store = new InMemoryBrandingImageStore();
  current = store;
  return store;
}

export function brandingImagePrefixFolder(): string {
  return loadEnv().S3_PREFIX_FOLDER;
}

/**
 * The image to show or print: from object storage when it has a key, else
 * the bytes a row saved before ADR-193 still holds.
 */
export async function loadBrandingImage(
  contentType: string | null,
  storageKey: string | null,
  bytes: Uint8Array | null,
): Promise<{ contentType: BrandingImageContentType; bytes: Buffer } | null> {
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') return null;
  if (storageKey) {
    const stored = await brandingImageStore().get(storageKey);
    return stored && stored.length > 0 ? { contentType, bytes: stored } : null;
  }
  if (!bytes || bytes.byteLength === 0) return null;
  return { contentType, bytes: Buffer.from(bytes) };
}
