import { ValidationError } from '../errors/index.js';
import * as stats from '../stats/descriptive.js';
import { cloneValue } from '../utils/values.js';

const AGGREGATIONS = new Set(['countRows', 'count', 'nunique', 'sum', 'mean', 'median', 'min', 'max', 'range', 'variance', 'std', 'quantile', 'iqr', 'mad', 'skewness', 'kurtosis']);

/** A grouped view created by Dataset.groupBy(). Use agg() or aggregate() to materialize it. */
export class GroupedDataset {
  #rows;
  #columns;
  #keys;
  #name;
  #createResult;

  constructor(rows, columns, keys, name, createResult) {
    if (!Array.isArray(rows) || !Array.isArray(columns) || !Array.isArray(keys) || typeof createResult !== 'function') {
      throw new ValidationError('GroupedDataset must be created from dataset rows, columns, keys, and a result factory.');
    }
    this.#rows = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cloneValue(value)])));
    this.#columns = [...columns];
    this.#keys = [...keys];
    this.#name = name;
    this.#createResult = createResult;
    Object.freeze(this);
  }

  get keys() { return [...this.#keys]; }

  agg(specification) {
    const aggregations = normalizeAggregations(specification, this.#columns);
    const outputColumns = [...this.#keys, ...aggregations.map(aggregation => aggregation.name)];
    if (new Set(outputColumns).size !== outputColumns.length) throw new ValidationError('Grouping and aggregation output column names must be unique.');

    const groups = new Map();
    if (this.#keys.length === 0) groups.set('global', { key: [], rows: [] });
    for (const row of this.#rows) {
      const keyValues = this.#keys.map(column => row[column] ?? null);
      const key = this.#keys.length === 0 ? 'global' : JSON.stringify(keyValues.map(groupKey));
      if (!groups.has(key)) groups.set(key, { key: keyValues, rows: [] });
      groups.get(key).rows.push(row);
    }

    const resultRows = [...groups.values()].map(group => {
      const output = Object.fromEntries(this.#keys.map((column, index) => [column, group.key[index]]));
      for (const aggregation of aggregations) output[aggregation.name] = compute(aggregation, group.rows);
      return output;
    });
    return this.#createResult(resultRows, outputColumns, `${this.#name} grouped`);
  }

  aggregate(specification) { return this.agg(specification); }
}

function normalizeAggregations(specification, columns) {
  let items;
  if (Array.isArray(specification)) {
    items = specification.map((item, index) => {
      if (!isRecord(item)) throw new ValidationError(`Aggregation ${index + 1} must be an object.`);
      return { ...item, name: item.name ?? item.as ?? item.alias };
    });
  } else if (isRecord(specification)) {
    items = Object.entries(specification).map(([name, item]) => {
      if (!isRecord(item)) throw new ValidationError(`Aggregation "${name}" must be an object descriptor.`);
      return { ...item, name };
    });
  } else {
    throw new ValidationError('agg expects an array of descriptors or an object mapping output names to descriptors.');
  }
  if (!items.length) throw new ValidationError('agg requires at least one aggregation.');
  return items.map((item, index) => {
    const allowed = new Set(['op', 'column', 'name', 'as', 'alias', 'ddof', 'q', 'method']);
    const unknown = Object.keys(item).find(key => !allowed.has(key));
    if (unknown) throw new ValidationError(`Aggregation ${index + 1} contains unknown property: ${unknown}`);
    const { op, column } = item;
    if (!AGGREGATIONS.has(op)) throw new ValidationError(`Aggregation ${index + 1} uses unsupported operation: ${String(op)}`);
    const ddof = item.ddof ?? 0;
    if (!['variance', 'std'].includes(op) && item.ddof !== undefined) throw new ValidationError(`${op} does not accept ddof.`);
    if (!Number.isInteger(ddof) || ddof < 0) throw new ValidationError(`${op} ddof must be a non-negative integer.`);
    if (op === 'quantile') {
      if (item.q === undefined) throw new ValidationError('quantile aggregation requires q between 0 and 1.');
      stats.quantile([], item.q, { method: item.method });
    } else if (item.q !== undefined || item.method !== undefined) {
      throw new ValidationError(`${op} does not accept q or method.`);
    }
    if (op === 'countRows') {
      if (column !== undefined) throw new ValidationError('countRows does not take a source column.');
    } else {
      if (typeof column !== 'string' || !column.trim()) throw new ValidationError(`${op} requires a source column.`);
      if (!columns.includes(column)) throw new ValidationError(`Unknown aggregation column: ${column}`);
    }
    const name = validName(item.name ?? defaultName(op, column, item.q));
    return { op, column, name, ddof, q: item.q, method: item.method };
  });
}

function defaultName(op, column, q) {
  if (op === 'countRows') return 'count of rows';
  if (op === 'nunique') return `distinct count of ${column}`;
  if (op === 'count') return `count of ${column}`;
  if (op === 'quantile') return `quantile ${q} of ${column}`;
  return `${op} of ${column}`;
}

function compute(aggregation, rows) {
  const values = aggregation.column === undefined ? [] : rows.map(row => row[aggregation.column]);
  switch (aggregation.op) {
    case 'countRows': return rows.length;
    case 'count': return stats.count(values);
    case 'nunique': return distinctCount(values);
    case 'sum': return stats.sum(values);
    case 'mean': return stats.mean(values);
    case 'median': return stats.median(values);
    case 'min': return stats.min(values);
    case 'max': return stats.max(values);
    case 'range': return stats.range(values);
    case 'variance': return stats.variance(values, aggregation.ddof);
    case 'std': return stats.std(values, aggregation.ddof);
    case 'quantile': return stats.quantile(values, aggregation.q, { method: aggregation.method });
    case 'iqr': return stats.iqr(values);
    case 'mad': return stats.mad(values);
    case 'skewness': return stats.skewness(values);
    case 'kurtosis': return stats.kurtosis(values);
    default: throw new ValidationError(`Unsupported aggregation operation: ${aggregation.op}`);
  }
}

function distinctCount(values) {
  return new Set(values.filter(value => value !== null && value !== undefined).map(value => JSON.stringify(groupKey(value)))).size;
}
function groupKey(value) {
  if (value instanceof Date) return { type: 'date', value: value.toISOString() };
  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };
  if (Array.isArray(value)) return { type: 'array', value: value.map(groupKey) };
  if (value && typeof value === 'object') {
    return { type: 'object', value: Object.fromEntries(Object.keys(value).sort().map(key => [key, groupKey(value[key])])) };
  }
  return { type: typeof value, value };
}
function validName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Aggregation output names must be non-empty strings.');
  return name.trim();
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }
