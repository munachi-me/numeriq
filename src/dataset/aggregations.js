import { ValidationError } from '../errors/index.js';
import * as stats from '../stats/descriptive.js';
import { compileCondition } from './query.js';

/**
 * Shared aggregation engine used by GroupedDataset.agg() and the v0.11.0
 * AnalysisBuilder. Extends the v0.10.0 operation set with the aliases
 * 'average'/'stddev' plus 'percentile' and 'quartiles', and adds support for
 * conditional aggregations through a `where` condition.
 */
export const AGGREGATION_OPS = new Set([
  'countRows', 'count', 'nunique', 'sum', 'mean', 'average', 'median', 'min', 'max',
  'range', 'variance', 'std', 'stddev', 'quantile', 'percentile', 'quartiles',
  'iqr', 'mad', 'skewness', 'kurtosis'
]);

const CANONICAL_OP = { average: 'mean', stddev: 'std' };

export function normalizeAggregations(specification, columns) {
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
    const allowed = new Set(['op', 'column', 'name', 'as', 'alias', 'ddof', 'q', 'p', 'method', 'where']);
    const unknown = Object.keys(item).find(key => !allowed.has(key));
    if (unknown) throw new ValidationError(`Aggregation ${index + 1} contains unknown property: ${unknown}`);
    const { op, column } = item;
    if (!AGGREGATION_OPS.has(op)) throw new ValidationError(`Aggregation ${index + 1} uses unsupported operation: ${String(op)}`);
    const canonical = CANONICAL_OP[op] ?? op;
    const ddof = item.ddof ?? 0;
    if (!['variance', 'std'].includes(canonical) && item.ddof !== undefined) throw new ValidationError(`${op} does not accept ddof.`);
    if (!Number.isInteger(ddof) || ddof < 0) throw new ValidationError(`${op} ddof must be a non-negative integer.`);
    if (canonical === 'quantile') {
      if (item.q === undefined) throw new ValidationError('quantile aggregation requires q between 0 and 1.');
      stats.quantile([], item.q, { method: item.method });
    } else if (canonical === 'percentile') {
      if (item.p === undefined) throw new ValidationError('percentile aggregation requires p between 0 and 100.');
      stats.percentile([], item.p, { method: item.method });
    } else if (item.q !== undefined || item.p !== undefined || item.method !== undefined) {
      throw new ValidationError(`${op} does not accept q, p, or method.`);
    }
    if (canonical === 'countRows') {
      if (column !== undefined) throw new ValidationError('countRows does not take a source column.');
    } else {
      if (typeof column !== 'string' || !column.trim()) throw new ValidationError(`${op} requires a source column.`);
      if (!columns.includes(column)) throw new ValidationError(`Unknown aggregation column: ${column}`);
    }
    let predicate = null;
    if (item.where !== undefined) {
      const compiled = compileCondition(item.where);
      for (const referenced of compiled.columns) {
        if (!columns.includes(referenced)) throw new ValidationError(`Unknown conditional aggregation column: ${referenced}`);
      }
      predicate = compiled;
    }
    const name = validName(item.name ?? defaultName(op, column, item.q, item.p));
    return { op: canonical, displayOp: op, column, name, ddof, q: item.q, p: item.p, method: item.method, predicate };
  });
}

function defaultName(op, column, q, p) {
  if (op === 'countRows') return 'count of rows';
  if (op === 'nunique') return `distinct count of ${column}`;
  if (op === 'count') return `count of ${column}`;
  if (op === 'quantile') return `quantile ${q} of ${column}`;
  if (op === 'percentile') return `percentile ${p} of ${column}`;
  if (op === 'quartiles') return `quartiles of ${column}`;
  return `${op} of ${column}`;
}

export function computeAggregation(aggregation, rows) {
  const selected = aggregation.predicate ? rows.filter(row => aggregation.predicate(row)) : rows;
  const values = aggregation.column === undefined ? [] : selected.map(row => row[aggregation.column]);
  switch (aggregation.op) {
    case 'countRows': return selected.length;
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
    case 'percentile': return stats.percentile(values, aggregation.p, { method: aggregation.method });
    case 'quartiles': return stats.quartiles(values, { method: aggregation.method });
    case 'iqr': return stats.iqr(values);
    case 'mad': return stats.mad(values);
    case 'skewness': return stats.skewness(values);
    case 'kurtosis': return stats.kurtosis(values);
    default: throw new ValidationError(`Unsupported aggregation operation: ${aggregation.displayOp ?? aggregation.op}`);
  }
}

function distinctCount(values) {
  return new Set(values.filter(value => value !== null && value !== undefined).map(value => JSON.stringify(groupKeyValue(value)))).size;
}
export function groupKeyValue(value) {
  if (value instanceof Date) return { type: 'date', value: value.toISOString() };
  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };
  if (Array.isArray(value)) return { type: 'array', value: value.map(groupKeyValue) };
  if (value && typeof value === 'object') {
    return { type: 'object', value: Object.fromEntries(Object.keys(value).sort().map(key => [key, groupKeyValue(value[key])])) };
  }
  return { type: typeof value, value };
}
function validName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Aggregation output names must be non-empty strings.');
  return name.trim();
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }
