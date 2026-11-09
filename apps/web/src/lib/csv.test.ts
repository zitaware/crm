import { describe, expect, it } from 'vitest';
import { readCsv } from './csv';

describe('readCsv', () => {
  it('splits rows and cells, honouring quotes, doubled quotes and embedded commas and line breaks', () => {
    const text = 'Date,Narration,Amount\r\n05/06/2026,"NEFT, AHMEDABAD ""NETWORKS""","1,04,400.00"\n06/06/2026,"TWO\nLINES",5\n';
    expect(readCsv(text)).toEqual([
      ['Date', 'Narration', 'Amount'],
      ['05/06/2026', 'NEFT, AHMEDABAD "NETWORKS"', '1,04,400.00'],
      ['06/06/2026', 'TWO\nLINES', '5'],
    ]);
  });

  it('keeps blank rows in the middle so row numbers match the file, and drops trailing blank lines', () => {
    expect(readCsv('a,b\n,\nc,d\n\n\n')).toEqual([['a', 'b'], ['', ''], ['c', 'd']]);
  });
});
