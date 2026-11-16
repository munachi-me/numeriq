import { ValidationError } from '../errors/index.js';
import { cloneValue } from '../utils/values.js';
import { normalizeAggregations, computeAggregation, AGGREGATION_OPS } from './aggregations.js';

const isMissing = value => value === null || value === undefined;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

function assertColumns(columns, names, label) {
  for (const name of names) {
    if (!columns.includes(name)) throw new ValidationError(`Unknown ${label} column: ${name}`);
  }
}

function cellName(value) {
  if (isMissing(value)) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * Pivot long-form data into wide form (v0.14.0). One output row per distinct
 * combination of index columns (first-seen order); one output column per
 * distinct value of the `columns` field (first-seen order). Multiple records
 * mapping to the same cell are combined with `agg`. Missing combinations get
 * `fillValue` (default null). Returns AnalysisResult-shaped output.
 */
export function pivot(context, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ValidationError('Pivot options must be an object.');
  }
  const allowed = new Set(['index', 'columns', 'values', 'agg', 'fillValue', 'q', 'p', 'ddof', 'method']);
  const unknown = Object.keys(options).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`Pivot does not support option: ${unknown}`);
  const indexColumns = (Array.isArray(options.index) ? options.index : [options.index]).map(name => {
    if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Pivot index columns must be non-empty strings.');
    return name;
  });
  assertColumns(context.columns, indexColumns, 'index');
  if (typeof options.columns !== 'string' || !options.columns.trim()) throw new ValidationError('Pivot requires a columns field.');
  if (typeof options.values !== 'string' || !options.values.trim()) throw new ValidationError('Pivot requires a values field.');
  assertColumns(context.columns, [options.columns, options.values], 'pivot');
  if (indexColumns.includes(options.columns)) throw new ValidationError('Pivot index and columns fields must differ.');
  const agg = options.agg ?? 'sum';
  if (!AGGREGATION_OPS.has(agg)) throw new ValidationError(`Unsupported pivot aggregation: ${String(agg)}`);
  const descriptor = normalizeAggregations([{
    op: agg,
    column: options.values,
    as: 'cell',
    ...(options.ddof !== undefined ? { ddof: options.ddof } : {}),
    ...(options.q !== undefined ? { q: options.q } : {}),
    ...(options.p !== undefined ? { p: options.p } : {}),
    ...(options.method !== undefined ? { method: options.method } : {})
  }], context.columns)[0];
  const fillValue = options.fillValue === undefined ? null : cloneValue(options.fillValue);

  const indexOrder = [];
  const indexSeen = new Set();
  const columnOrder = [];
  const columnSeen = new Set();
  const groups = new Map();
  for (const row of context.rows) {
    const keyValues = indexColumns.map(column => row[column] ?? null);
    const indexKey = JSON.stringify(keyValues.map(value => isRecord(value) || Array.isArray(value) ? JSON.stringify(value) : value));
    if (!indexSeen.has(indexKey)) { indexSeen.add(indexKey); indexOrder.push(indexKey); groups.set(indexKey, { keyValues, cells: new Map() }); }
    const group = groups.get(indexKey);
    const pivotValue = row[options.columns];
    const pivotKey = JSON.stringify(pivotValue === undefined ? null : isRecord(pivotValue) || Array.isArray(pivotValue) || pivotValue instanceof Date ? { v: cellName(pivotValue) } : pivotValue);
    if (!columnSeen.has(pivotKey)) { columnSeen.add(pivotKey); columnOrder.push({ pivotKey, name: cellName(pivotValue) }); }
    if (!group.cells.has(pivotKey)) group.cells.set(pivotKey, []);
    group.cells.get(pivotKey).push(row);
  }

  const outputColumns = [...indexColumns, ...columnOrder.map(entry => entry.name)];
  if (new Set(outputColumns).size !== outputColumns.length) {
    throw new ValidationError('Pivot output column names must be unique; the columns field values collide with index column names.');
  }
  const rows = indexOrder.map(indexKey => {
    const group = groups.get(indexKey);
    const output = Object.fromEntries(indexColumns.map((column, position) => [column, cloneValue(group.keyValues[position])]));
    for (const entry of columnOrder) {
      const cellRows = group.cells.get(entry.pivotKey);
      output[entry.name] = cellRows ? computeAggregation(descriptor, cellRows) : cloneValue(fillValue);
    }
    return output;
  });
  return { rows, columns: outputColumns };
}

/**
 * Melt wide-form data into long form (v0.14.0). One output row per
 * (source row, value variable); null and missing values are preserved as
 * null in the value column. Row order: source row order, then value
 * variable order.
 */
export function melt(context, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ValidationError('Melt options must be an object.');
  }
  const allowed = new Set(['idVars', 'valueVars', 'varName', 'valueName']);
  const unknown = Object.keys(options).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`Melt does not support option: ${unknown}`);
  const valueVars = options.valueVars === undefined
    ? null
    : (Array.isArray(options.valueVars) ? options.valueVars : [options.valueVars]).map(name => {
      if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Melt valueVars must be non-empty strings.');
      return name;
    });
  const idVars = options.idVars === undefined
    ? context.columns.filter(column => !valueVars.includes(column))
    : (Array.isArray(options.idVars) ? options.idVars : [options.idVars]).map(name => {
      if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Melt idVars must be non-empty strings.');
      return name;
    });
  assertColumns(context.columns, idVars, 'idVars');
  const valueColumns = valueVars ?? context.columns.filter(column => !idVars.includes(column));
  assertColumns(context.columns, valueColumns, 'valueVars');
  if (valueColumns.length === 0) throw new ValidationError('Melt requires at least one value variable.');
  const overlap = idVars.filter(column => valueColumns.includes(column));
  if (overlap.length) throw new ValidationError(`Melt idVars and valueVars must not overlap: ${overlap.join(', ')}`);
  const varName = options.varName ?? 'variable';
  const valueName = options.valueName ?? 'value';
  if (typeof varName !== 'string' || !varName.trim() || typeof valueName !== 'string' || !valueName.trim()) {
    throw new ValidationError('Melt varName and valueName must be non-empty strings.');
  }
  if (idVars.includes(varName) || idVars.includes(valueName) || valueColumns.includes(varName) && varName !== 'variable' && context.columns.includes(varName) && !valueColumns.includes(varName) && !idVars.includes(varName)) {
    // Covered by the explicit uniqueness check below.
  }
  const outputColumns = [...idVars, varName, valueName];
  if (new Set(outputColumns).size !== outputColumns.length) {
    throw new ValidationError('Melt output column names must be unique; adjust varName/valueName or id variables.');
  }
  const rows = [];
  for (const row of context.rows) {
    for (const column of valueColumns) {
      const output = Object.fromEntries(idVars.map(id => [id, cloneValue(row[id])]));
      output[varName] = column;
      output[valueName] = cloneValue(row[column] ?? null);
      rows.push(output);
    }
  }
  return { rows, columns: outputColumns };
}

/**
 * Cross-tabulation (v0.14.0). Counts rows per (rowCol, colCol) combination,
 * or aggregates a values column. Supports percentages (percentBy:
 * 'row' | 'column' | 'total') and row/column totals. Output columns follow
 * first-seen order of the column field; an optional totals row/column named
 * via totalName (default 'All') is appended last.
 */
export function crosstab(context, rowColumn, columnColumn, options = {}) {
  if (typeof rowColumn !== 'string' || !rowColumn.trim() || typeof columnColumn !== 'string' || !columnColumn.trim()) {
    throw new ValidationError('crosstab requires row and column field names.');
  }
  assertColumns(context.columns, [rowColumn, columnColumn], 'crosstab');
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ValidationError('crosstab options must be an object.');
  }
  const allowed = new Set(['values', 'agg', 'percentBy', 'totals', 'totalName']);
  const unknown = Object.keys(options).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`crosstab does not support option: ${unknown}`);
  if (options.values !== undefined) {
    if (typeof options.values !== 'string' || !context.columns.includes(options.values)) {
      throw new ValidationError(`Unknown crosstab values column: ${String(options.values)}`);
    }
  }
  const agg = options.agg ?? 'count';
  if (!AGGREGATION_OPS.has(agg)) throw new ValidationError(`Unsupported crosstab aggregation: ${String(agg)}`);
  const percentBy = options.percentBy ?? 'none';
  if (!['none', 'row', 'column', 'total'].includes(percentBy)) {
    throw new ValidationError("crosstab percentBy must be 'none', 'row', 'column', or 'total'.");
  }
  if (percentBy !== 'none' && options.values !== undefined && agg === 'count') {
    // allowed: percentages of counts are fine
  }
  if (percentBy !== 'none' && options.values !== undefined && !['sum', 'count', 'countRows'].includes(agg)) {
    throw new ValidationError('crosstab percentages require count-style or sum aggregations.');
  }
  const totals = options.totals ?? true;
  if (typeof totals !== 'boolean') throw new ValidationError('crosstab totals must be a boolean.');
  const totalName = options.totalName ?? 'All';
  if (typeof totalName !== 'string' || !totalName.trim()) throw new ValidationError('crosstab totalName must be a non-empty string.');

  const valuesColumn = options.values;
  const descriptor = valuesColumn
    ? normalizeAggregations([{ op: agg, column: valuesColumn, as: 'cell' }], context.columns)[0]
    : null;

  const rowOrder = [];
  const rowSeen = new Set();
  const colOrder = [];
  const colSeen = new Set();
  const cells = new Map();
  for (const row of context.rows) {
    const rowKey = JSON.stringify(row[rowColumn] ?? null);
    const colKey = JSON.stringify(row[columnColumn] ?? null);
    if (!rowSeen.has(rowKey)) { rowSeen.add(rowKey); rowOrder.push({ key: rowKey, name: cellName(row[rowColumn]) }); }
    if (!colSeen.has(colKey)) { colSeen.add(colKey); colOrder.push({ key: colKey, name: cellName(row[columnColumn]) }); }
    const cellKey = `${rowKey}|${colKey}`;
    if (!cells.has(cellKey)) cells.set(cellKey, []);
    cells.get(cellKey).push(row);
  }

  const label = rowColumn;
  const outputColumns = [label, ...colOrder.map(entry => entry.name), ...(totals ? [totalName] : [])];
  const grandTotal = context.rows.length;
  const rowTotals = new Map();
  const colTotals = new Map();
  const computeCell = cellRows => descriptor
    ? computeAggregation(descriptor, cellRows)
    : cellRows.length;

  const resultRows = rowOrder.map(entry => {
    const output = { [label]: entry.name };
    let rowTotal = 0;
    for (const colEntry of colOrder) {
      const cellRows = cells.get(`${entry.key}|${colEntry.key}`);
      let value = cellRows ? computeCell(cellRows) : 0;
      rowTotal += typeof value === 'number' ? value : 0;
      output[colEntry.name] = value;
    }
    rowTotals.set(entry.key, rowTotal);
    return output;
  });

  if (percentBy === 'row') {
    for (const row of resultRows) {
      const total = rowTotals.get(JSON.stringify(row[label] === 'null' ? null : row[label])) || 0;
      for (const colEntry of colOrder) {
        row[colEntry.name] = total ? row[colEntry.name] / total : null;
      }
    }
  } else if (percentBy === 'column' || percentBy === 'total') {
    // colTotals are captured from the raw counts before normalization, so the
    // totals row can report real column totals even after percent conversion.
    for (const colEntry of colOrder) {
      let columnTotal = 0;
      for (const row of resultRows) columnTotal += typeof row[colEntry.name] === 'number' ? row[colEntry.name] : 0;
      colTotals.set(colEntry.key, columnTotal);
      const divisor = percentBy === 'column' ? columnTotal : grandTotal;
      for (const row of resultRows) {
        row[colEntry.name] = divisor ? row[colEntry.name] / divisor : null;
      }
    }
  }

  if (totals) {
    // Percent-of-total rows keep raw counts in row[totalName] via rowTotals
    // (captured before normalization); recompute from the counts map.
    for (const row of resultRows) {
      row[totalName] = percentBy === 'row'
        ? rowTotals.get(JSON.stringify(row[label] === 'null' ? null : row[label])) ?? 0
        : percentBy === 'total'
          ? rowTotals.get(JSON.stringify(row[label] === 'null' ? null : row[label])) / grandTotal
          : colOrder.reduce((total, colEntry) => {
            const value = row[colEntry.name];
            return total + (typeof value === 'number' ? value : 0);
          }, 0);
    }
    const totalsRow = { [label]: totalName };
    for (const colEntry of colOrder) {
      const columnTotal = colTotals.get(colEntry.key)
        ?? resultRows.reduce((total, row) => {
          const value = row[colEntry.name];
          return total + (percentBy === 'none' && typeof value === 'number' ? value : 0);
        }, 0);
      totalsRow[colEntry.name] = percentBy === 'column' ? 1
        : percentBy === 'total' ? (grandTotal ? columnTotal / grandTotal : null)
        : columnTotal;
    }
    totalsRow[totalName] = percentBy === 'total' ? 1
      : percentBy === 'none' ? grandTotal
        : resultRows.reduce((total, row) => total + (row[totalName] ?? 0), 0);
    resultRows.push(totalsRow);
  }

  return { rows: resultRows, columns: outputColumns };
}

/**
 * Transpose rows and columns (v0.14.0). Each output row represents one
 * original column; the label column holds the original column name and one
 * column per row index (stringified) holds the values.
 */
export function transpose(context, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ValidationError('transpose options must be an object.');
  }
  const allowed = new Set(['labelColumn']);
  const unknown = Object.keys(options).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`transpose does not support option: ${unknown}`);
  const labelColumn = options.labelColumn ?? 'field';
  if (typeof labelColumn !== 'string' || !labelColumn.trim()) throw new ValidationError('transpose labelColumn must be a non-empty string.');
  const rowNames = context.rows.map((_, index) => String(index));
  const outputColumns = [labelColumn, ...rowNames];
  if (new Set(outputColumns).size !== outputColumns.length) {
    throw new ValidationError('transpose output column names must be unique.');
  }
  const rows = context.columns.map(column => {
    const output = { [labelColumn]: column };
    context.rows.forEach((row, index) => { output[String(index)] = cloneValue(row[column] ?? null); });
    return output;
  });
  return { rows, columns: outputColumns };
}

/**
 * Explode list-valued rows into one row per element (v0.14.0). Array values
 * produce one row per element; null, missing, and non-array values produce a
 * single row with the value unchanged. Element order and row order follow
 * the source.
 */
export function explode(context, column) {
  if (typeof column !== 'string' || !column.trim()) throw new ValidationError('explode requires a column name.');
  assertColumns(context.columns, [column], 'explode');
  const rows = [];
  for (const row of context.rows) {
    const value = row[column];
    if (Array.isArray(value)) {
      if (value.length === 0) { rows.push({ ...row, [column]: null }); continue; }
      for (const element of value) rows.push({ ...row, [column]: cloneValue(element ?? null) });
    } else {
      rows.push({ ...row, [column]: cloneValue(value ?? null) });
    }
  }
  return { rows, columns: [...context.columns] };
}
