/**
 * Splits CSV text into rows of cells, honouring double-quoted cells (with
 * embedded commas, doubled quotes and line breaks). It only reads: every
 * judgement about what the cells mean is the server's.
 */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  // Drop a trailing empty line; keep blank rows in the middle so row numbers match the file.
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
  return rows;
}
