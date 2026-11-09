import { describe, expect, it } from 'vitest';
import { InMemoryBrandingImageStore, brandingImageKey } from './branding-image-store';

describe('brandingImageKey', () => {
  const base = { organizationId: 'org', legalEntityId: 'le', kind: 'logo' as const, contentType: 'image/png' as const, uniqueId: 'u1' };

  it('puts the image under the prefix folder, the organization and the legal entity', () => {
    expect(brandingImageKey({ ...base, prefixFolder: 'crm' })).toBe('crm/org/legal-entities/le/logo-u1.png');
  });

  it('uses .jpg for JPEG and ignores slashes around the prefix', () => {
    expect(brandingImageKey({ ...base, kind: 'authorized-sign', contentType: 'image/jpeg', prefixFolder: '/crm/' })).toBe(
      'crm/org/legal-entities/le/authorized-sign-u1.jpg',
    );
  });

  it('has no prefix when none is configured', () => {
    expect(brandingImageKey({ ...base, prefixFolder: '' })).toBe('org/legal-entities/le/logo-u1.png');
  });

  it('gives every upload its own key, so a replaced image never overwrites an older one', () => {
    const withoutId = { organizationId: 'org', legalEntityId: 'le', kind: 'logo' as const, contentType: 'image/png' as const, prefixFolder: 'crm' };
    expect(brandingImageKey(withoutId)).not.toBe(brandingImageKey(withoutId));
  });
});

describe('InMemoryBrandingImageStore', () => {
  it('returns what was stored and null for an unknown key', async () => {
    const store = new InMemoryBrandingImageStore();
    await store.put('k', Buffer.from('png-bytes'));
    expect((await store.get('k'))?.toString()).toBe('png-bytes');
    expect(await store.get('missing')).toBeNull();
  });
});
