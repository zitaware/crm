import { describe, expect, it } from 'vitest';
import { currentEntityScope, entityFilter, unscoped, withEntityFilter, withEntityScope } from '@zitaware/database';

describe('entity-wise data (ADR-172)', () => {
  const ids = ['le-1'];

  it('narrows a model to the legal entities, directly or through its parents', () => {
    expect(entityFilter('Invoice', ids)).toEqual({ legalEntityId: { in: ids } });
    expect(entityFilter('LegalEntity', ids)).toEqual({ id: { in: ids } });
    expect(entityFilter('Employee', ids)).toEqual({ OR: [{ legalEntityId: { in: ids } }, { legalEntityId: null }] });
    expect(entityFilter('JournalLine', ids)).toEqual({ journalEntry: { legalEntityId: { in: ids } } });
    expect(entityFilter('MilestoneInstallment', ids)).toEqual({ milestone: { project: { legalEntityId: { in: ids } } } });
    expect(entityFilter('EmployeeSalaryRevision', ids)).toEqual({ employee: { OR: [{ legalEntityId: { in: ids } }, { legalEntityId: null }] } });
  });

  it('leaves shared records (clients, vendors, leads, masters) alone', () => {
    for (const model of ['Party', 'Lead', 'Tender', 'LedgerAccount', 'ExpenseCategory', 'User', 'Role']) expect(entityFilter(model, ids)).toBeNull();
  });

  it('adds the filter alongside the caller\'s own conditions', () => {
    const filter = { legalEntityId: { in: ids } };
    expect(withEntityFilter(undefined, filter)).toEqual(filter);
    expect(withEntityFilter({ id: 'x' }, filter)).toEqual({ id: 'x', AND: [filter] });
    expect(withEntityFilter({ id: 'x', AND: { status: 'POSTED' } }, filter)).toEqual({ id: 'x', AND: [{ status: 'POSTED' }, filter] });
  });

  it('holds the scope for the request and lets a number count step outside it', async () => {
    expect(currentEntityScope()).toBeNull();
    await withEntityScope({ legalEntityIds: ids }, async () => {
      await Promise.resolve();
      expect(currentEntityScope()).toEqual({ legalEntityIds: ids });
      expect(unscoped(() => currentEntityScope())).toBeNull();
    });
  });
});
