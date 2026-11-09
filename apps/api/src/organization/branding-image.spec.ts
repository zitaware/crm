import { describe, expect, it } from 'vitest';
import { decodeBrandingImage, MAX_BRANDING_IMAGE_BYTES } from './branding-image';

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('decodeBrandingImage', () => {
  it('accepts a PNG whose bytes match the declared type', () => {
    const decoded = decodeBrandingImage({ contentType: 'image/png', dataBase64: TINY_PNG });
    expect(decoded.contentType).toBe('image/png');
    expect(decoded.bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('rejects a file whose bytes do not match the declared type', () => {
    expect(() => decodeBrandingImage({ contentType: 'image/jpeg', dataBase64: TINY_PNG })).toThrow(/does not match/);
  });

  it('rejects a payload over 5 MB', () => {
    const tooBig = Buffer.alloc(MAX_BRANDING_IMAGE_BYTES + 1, 0xff);
    tooBig[0] = 0xff;
    tooBig[1] = 0xd8;
    tooBig[2] = 0xff;
    expect(() => decodeBrandingImage({ contentType: 'image/jpeg', dataBase64: tooBig.toString('base64') })).toThrow(/5 MB/);
  });

  it('rejects a value that is not base64', () => {
    expect(() => decodeBrandingImage({ contentType: 'image/png', dataBase64: 'not an image' })).toThrow(/not a valid file/);
  });
});
