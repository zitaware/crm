import { describe, expect, it } from 'vitest';
import { buildStorageKey } from './storage-key.util';

const ids = { organizationId: 'org', documentGroupId: 'grp', documentId: 'doc', originalFilename: 'po.pdf' };

describe('buildStorageKey', () => {
  it('places the key under the prefix folder', () => {
    expect(buildStorageKey({ ...ids, prefixFolder: 'crm' })).toBe('crm/org/grp/doc-po.pdf');
  });

  it('ignores slashes around the prefix folder', () => {
    expect(buildStorageKey({ ...ids, prefixFolder: '/crm/uploads/' })).toBe('crm/uploads/org/grp/doc-po.pdf');
  });

  it('keeps the unprefixed key when no prefix folder is set', () => {
    expect(buildStorageKey({ ...ids, prefixFolder: '' })).toBe('org/grp/doc-po.pdf');
  });
});
