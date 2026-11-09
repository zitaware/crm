import { throwAppError } from '@zitaware/contracts';
import type { BrandingImageContentType, BrandingImageInput } from '@zitaware/contracts';

// 5 MB per image (ADR-193): images live in object storage, not in the row.
export const MAX_BRANDING_IMAGE_BYTES = 5 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodeBrandingImage(input: BrandingImageInput): { contentType: BrandingImageContentType; bytes: Buffer } {
  const normalized = input.dataBase64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throwAppError('VALIDATION_FAILED', 'The image is not a valid file. Use a PNG or JPEG.');
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BRANDING_IMAGE_BYTES) {
    throwAppError('VALIDATION_FAILED', 'Each image must be a PNG or JPEG under 5 MB.');
  }
  if (!magicMatches(bytes, input.contentType)) {
    throwAppError('VALIDATION_FAILED', 'The image file does not match its type. Use a PNG or JPEG.');
  }
  return { contentType: input.contentType, bytes };
}

function magicMatches(bytes: Buffer, contentType: BrandingImageContentType): boolean {
  if (contentType === 'image/png') return bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
