import { ValidationError } from '../errors/index.js';
import { inferType, cloneValue } from '../utils/values.js';
import { renderTable } from '../display/table.js';
import { normalizeAggregations, computeAggregation } from './aggregations.js';
import { compileCondition } from './query.js';
import { GroupedDataset } from './grouping.js';

const INSPECT = Symbol.for('nodejs.util.inspect.custom');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/**
 * Lightweight tabular result produced by an analytical operation (v0.11.0).
 *
 * AnalysisResult exposes only the tabular functionality needed to inspect,
 * transform, and analyze derived data. It intentionally does not expose
 * Dataset-specific capabilities such as profile(), importReport, or original
 * dataset identity. Every tabular operation returns a new AnalysisResult and
 * never mutates its source.
 */
export class AnalysisResult {
  #rows;
  #columns;
  #lineage;

  constructor(rows, columns = null, options = {}) {
    if (!Array.isArray(rows)) throw new ValidationError('AnalysisResult rows must be an array.');
    if (rows.some(row => !isRecord(row))) throw new ValidationError('Each AnalysisResult row must be an object.');
    if (options !== null && typeof options !== 'object' || Array.isArray(options)) {
      throw new ValidationError('AnalysisResult options must be an object.');
    }
    const derived = columns
      ? [...columns]
      : [...new Set(rows.flatMap(row => Object.keys(row)))];
    this.#columns = derived;
    this.#rows = rows.map(row => {
      const source = isRecord(row) ? row : {};
      return Object.fromEntries(derived.map(column => [column, cloneValue(source[column] ?? null)]));
    });
    this.#lineage = options.lineage ? deepFreeze(cloneValue(options.lineage)) : null;
    Object.freeze(this);
  }

  static create(rows, columns, options = {}) { return new AnalysisResult(rows, columns, options); }

  get rows() { return this.#rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cloneValue(value)]))); }
  get columns() { return [...this.#columns]; }
  get shape() { return [this.#rows.length, this.#columns.length]; }
  get ndim() { return 2; }
  get length() { return this.#rows.length; }
  get size() { return this.#rows.length * this.#columns.length; }
  get empty() { return this.#rows.length === 0 || this.#columns.length === 0; }
  get index() { return Array.from({ length: this.#rows.length }, (_, i) => i); }
  get dtypes() { return Object.fromEntries(this.#columns.map(c => [c, inferType(this.#rows.map(r => r[c]))])); }
  get schema() {
    return Object.fromEntries(this.#columns.map(c => [
      c, { name: c, type: inferType(this.#rows.map(r => r[c])), nullable: this.#rows.some(r => r[c] == null) }
    ]));
  }

  head(n = 5) { return this.#new(this.#rows.slice(0, validCount(n))); }
  tail(n = 5) { const count = validCount(n); return this.#new(count === 0 ? [] : this.#rows.slice(-count)); }

  select(...columns) {
    const cols = columns.flat();
    if (new Set(cols).size !== cols.length) throw new ValidationError('Selected column names must be unique.');
    cols.forEach(column => this.#assertColumn(column));
    return this.#new(this.#rows.map(row => Object.fromEntries(cols.map(c => [c, row[c]]))), cols);
  }

  filter(predicate) {
    if (typeof predicate === 'function') {
      return this.#new(this.#rows.filter((row, index) => predicate(cloneValue(row), index)));
    }
    const compiled = compileCondition(predicate);
    for (const column of compiled.columns) this.#assertColumn(column);
    return this.#new(this.#rows.filter(row => compiled(row)));
  }

  sort(column, direction = 'asc') { return this.#sorted(column, direction); }
  sortBy(column, direction = 'asc') { return this.#sorted(column, direction); }
  #sorted(column, direction) {
    this.#assertColumn(column);
    if (!['asc', 'desc'].includes(direction)) throw new ValidationError("direction must be 'asc' or 'desc'.");
    return this.#new(sortRows(this.#rows, column, direction));
  }

  limit(count) { return this.head(validCount(count)); }

  distinct(...columns) {
    const keys = columns.flat();
    keys.forEach(column => this.#assertColumn(column));
    const keyColumns = keys.length ? keys : this.#columns;
    const seen = new Set();
    const rows = [];
    for (const row of this.#rows) {
      const key = JSON.stringify(keyColumns.map(column => distinctKey(row[column])));
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return this.#new(rows, keys.length ? keys : this.#columns);
  }

  count(column) {
    if (column === undefined) return this.#rows.length;
    this.#assertColumn(column);
    return this.#rows.filter(row => row[column] !== null && row[column] !== undefined).length;
  }

  groupBy(...columns) {
    const keys = columns.flat();
    if (new Set(keys).size !== keys.length) throw new ValidationError('groupBy key columns must be unique.');
    keys.forEach(column => this.#assertColumn(column));
    const lineage = { ...(this.#lineage ?? { source: 'AnalysisResult' }), operation: 'groupBy + agg' };
    return new GroupedDataset(this.rows, this.#columns, keys, this.name ?? 'AnalysisResult',
      (rows, resultColumns, name) => new AnalysisResult(rows, resultColumns, { lineage }));
  }

  agg(specification) { return this.groupBy().agg(specification); }
  aggregate(specification) { return this.agg(specification); }

  analyze() { return new AnalysisBuilder(this.rows, this.#columns, this.name ?? 'AnalysisResult', this.#lineageValue()); }

  lineage() { return this.#lineage ? cloneValue(this.#lineage) : null; }
  history() { return this.lineage(); }

  toJSON() { return { columns: this.columns, shape: this.shape, rows: this.rows }; }
  toArray() { return this.rows; }

  table(options = {}) { return this.toTable(options); }
  toTable(options = {}) {
    return renderTable(this.#rows, this.#columns, { ...options, rowCount: this.#rows.length, columnCount: this.#columns.length });
  }
  display(options = {}) { console.log(this.toTable(options)); return this; }
  print(options = {}) { return this.display(options); }
  [INSPECT]() { return this.toTable(); }

  #new(rows, columns = this.#columns) {
    return new AnalysisResult(rows, columns, { lineage: this.#lineageValue() });
  }
  #lineageValue() { return this.#lineage ? cloneValue(this.#lineage) : null; }
  #assertColumn(name) { if (!this.#columns.includes(name)) throw new ValidationError(`Unknown column: ${name}`); }
}

export function sortRows(rows, column, direction = 'asc') {
  const factor = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = a.row[column], y = b.row[column];
      if (x == null && y == null) return a.index - b.index;
      if (x == null) return 1;
      if (y == null) return -1;
      const tx = temporalTimestamp(x), ty = temporalTimestamp(y);
      if (tx !== null && ty !== null) return (tx < ty ? -1 : tx > ty ? 1 : 0) * factor || a.index - b.index;
      return (x > y ? 1 : x < y ? -1 : 0) * factor || a.index - b.index;
    })
    .map(item => item.row);
}

function validCount(n) {
  if (!Number.isInteger(n) || n < 0) throw new ValidationError('Row count must be a non-negative integer.');
  return n;
}
function distinctKey(value) {
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (value && typeof value === 'object') return `object:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value)}`;
}
function temporalTimestamp(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const text = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : timestamp;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
