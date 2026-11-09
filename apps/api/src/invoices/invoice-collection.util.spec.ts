import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  collectionBySource,
  invoiceAmounts,
  invoiceSourceShares,
  toCollection,
  type CollectionAllocation,
  type CollectionInvoice,
} from './invoice-collection.util';

const d = (v: string) => new Prisma.Decimal(v);

function invoice(overrides: Partial<CollectionInvoice>): CollectionInvoice {
  return {
    sourceEventId: null,
    sourceInstallmentId: null,
    taxableAmount: d('100'),
    totalAmount: d('118'),
    capexSources: [],
    lines: [],
    ...overrides,
  };
}

function allocation(cash: string, deductions: Array<[CollectionAllocation['deductions'][number]['type'], string, string[]?]> = [], sourceEventId: string | null = null): CollectionAllocation {
  return {
    sourceEventId,
    cashAllocated: d(cash),
    deductions: deductions.map(([type, amount, releases = []]) => ({
      type,
      amount: d(amount),
      releases: releases.map((r) => ({ releasedAmount: d(r) })),
    })),
  };
}

describe('toCollection / invoiceAmounts (ADR-155)', () => {
  it('splits a receipt into cash, each deduction kind, released and outstanding', () => {
    const amounts = invoiceAmounts(d('118000'), d('0'), [
      allocation('90000', [
        ['TDS', '2000'],
        ['CGST_TDS', '1000'],
        ['SGST_TDS', '1000'],
        ['HOLD', '5000', ['3000']],
        ['RETENTION', '4000'],
        ['ACCEPTED_PENALTY', '500'],
        ['DISPUTED_PENALTY', '500'],
        ['OTHER', '1000'],
      ]),
    ]);
    expect(toCollection(amounts)).toEqual({
      invoiceTotal: '118000.00',
      creditDebitNet: '0.00',
      received: '90000.00',
      tds: '2000.00',
      gstTds: '2000.00',
      hold: '5000.00',
      retention: '4000.00',
      penalty: '1000.00',
      otherDeductions: '1000.00',
      released: '3000.00',
      holdRetentionPending: '6000.00',
      outstanding: '13000.00',
    });
  });

  it('a credit note lowers the outstanding, a release does not', () => {
    const collection = toCollection(invoiceAmounts(d('118'), d('-18'), [allocation('50', [['HOLD', '10', ['10']]])]));
    expect(collection.outstanding).toBe('40.00');
    expect(collection.holdRetentionPending).toBe('0.00');
  });
});

describe('invoiceSourceShares (ADR-155)', () => {
  it('an OPEX invoice bills its installment in full', () => {
    expect(invoiceSourceShares(invoice({ sourceInstallmentId: 'i1' }))).toEqual([{ sourceId: 'i1', billedTaxable: d('100'), weight: d('118') }]);
  });

  it('a single-event invoice with untagged lines bills its header event in full', () => {
    const shares = invoiceSourceShares(invoice({ sourceEventId: 'e1', capexSources: [{ sourceEventId: 'e1', releasedAt: null }], lines: [{ sourceEventId: null, taxableAmount: d('70'), lineTotal: d('82.6') }] }));
    expect(shares.map((s) => [s.sourceId, s.billedTaxable.toFixed(2), s.weight.toFixed(2)])).toEqual([['e1', '100.00', '118.00']]);
  });

  it('a multi-event invoice bills each event its own lines', () => {
    const shares = invoiceSourceShares(
      invoice({
        sourceEventId: 'e1',
        taxableAmount: d('300'),
        totalAmount: d('354'),
        capexSources: [
          { sourceEventId: 'e1', releasedAt: null },
          { sourceEventId: 'e2', releasedAt: null },
        ],
        lines: [
          { sourceEventId: 'e1', taxableAmount: d('100'), lineTotal: d('118') },
          { sourceEventId: 'e2', taxableAmount: d('200'), lineTotal: d('236') },
        ],
      }),
    );
    expect(shares.map((s) => [s.sourceId, s.billedTaxable.toFixed(2), s.weight.toFixed(2)])).toEqual([
      ['e1', '100.00', '118.00'],
      ['e2', '200.00', '236.00'],
    ]);
  });

  it('an invoice with no billing source has no shares', () => {
    expect(invoiceSourceShares(invoice({}))).toEqual([]);
  });
});

describe('collectionBySource (ADR-155)', () => {
  const twoEvents = invoice({
    sourceEventId: 'e1',
    taxableAmount: d('300'),
    totalAmount: d('354'),
    capexSources: [
      { sourceEventId: 'e1', releasedAt: null },
      { sourceEventId: 'e2', releasedAt: null },
    ],
    lines: [
      { sourceEventId: 'e1', taxableAmount: d('100'), lineTotal: d('118') },
      { sourceEventId: 'e2', taxableAmount: d('200'), lineTotal: d('236') },
    ],
  });

  it('an allocation naming an event goes to that event alone', () => {
    const [e1, e2] = collectionBySource(twoEvents, d('0'), [allocation('100', [['HOLD', '18']], 'e1')]);
    expect(toCollection(e1!.amounts)).toMatchObject({ invoiceTotal: '118.00', received: '100.00', hold: '18.00', outstanding: '0.00' });
    expect(toCollection(e2!.amounts)).toMatchObject({ invoiceTotal: '236.00', received: '0.00', outstanding: '236.00' });
  });

  it('a whole-invoice allocation goes to what is still owed, not into an event already paid', () => {
    const shares = collectionBySource(twoEvents, d('0'), [allocation('118', [], 'e1'), allocation('200', [['RETENTION', '10']])]);
    const [e1, e2] = shares.map((s) => toCollection(s.amounts));
    expect(e1).toMatchObject({ received: '118.00', retention: '0.00', outstanding: '0.00' });
    expect(e2).toMatchObject({ received: '200.00', retention: '10.00', outstanding: '26.00' });
  });

  it('a whole-invoice allocation is split by line totals and the shares add back to the invoice', () => {
    const shares = collectionBySource(twoEvents, d('-35.40'), [allocation('100', [['RETENTION', '10']])]);
    const collections = shares.map((s) => toCollection(s.amounts));
    expect(collections.map((c) => c.received)).toEqual(['33.33', '66.67']);
    expect(collections.map((c) => c.retention)).toEqual(['3.33', '6.67']);
    expect(collections.map((c) => c.creditDebitNet)).toEqual(['-11.80', '-23.60']);
    const outstanding = collections.reduce((sum, c) => sum.plus(c.outstanding), d('0'));
    expect(outstanding.toFixed(2)).toBe(toCollection(invoiceAmounts(d('354'), d('-35.40'), [allocation('100', [['RETENTION', '10']])])).outstanding);
  });
});
