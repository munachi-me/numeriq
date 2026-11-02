const stringify = value => value === null || value === undefined ? 'NULL' : value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function renderTable(rows, columns, options = {}) {
  const { maxRows = 20, maxColumns = 20, maxCellWidth = 28, showIndex = true, rowCount = rows.length, columnCount = columns.length } = options;
  if (!Number.isInteger(maxColumns) || maxColumns < 1) throw new RangeError('maxColumns must be a positive integer.');
  const visibleColumns = columns.slice(0, maxColumns);
  const omittedColumns = Math.max(0, columns.length - visibleColumns.length);
  const headers = [...(showIndex ? ['idx'] : []), ...visibleColumns, ...(omittedColumns ? [`… ${omittedColumns} more`] : [])];
  const visible = rows.slice(0, maxRows).map((row, i) => [
    ...(showIndex ? [String(i)] : []),
    ...visibleColumns.map(c => stringify(row?.[c]).replace(/\s+/g, ' ')),
    ...(omittedColumns ? ['…'] : [])
  ]);
  const clipped = visible.map(row => row.map(v => v.length > maxCellWidth ? `${v.slice(0, Math.max(1, maxCellWidth - 1))}…` : v));
  const widths = headers.map((h, i) => Math.max(String(h).length, ...clipped.map(r => (r[i] ?? '').length), 1));
  const border = (left, mid, right) => left + widths.map(w => '─'.repeat(w + 2)).join(mid) + right;
  const line = values => '│' + values.map((v, i) => ` ${String(v ?? '').padEnd(widths[i])} `).join('│') + '│';
  const out = [border('┌', '┬', '┐'), line(headers), border('├', '┼', '┤'), ...clipped.map(line), border('└', '┴', '┘')];
  if (rowCount > maxRows) out.push(`… ${rowCount - maxRows} more rows`);
  out.push(`${rowCount} rows × ${columnCount} columns`);
  return out.join('\n');
}
