import { ValidationError } from '../errors/index.js';
import { AnalysisResult } from './analysis-result.js';
import { normalizeAggregations, computeAggregation, groupKeyValue } from './aggregations.js';
import { compileCondition } from './query.js';
import {
  sum, mean, average, median, min, max, count, countRows, nunique, variance, std, stddev,
  range, quantile, percentile, quartiles, iqr, mad, skewness, kurtosis
} from './aggregation-helpers.js';

const AGGREGATION_VERSION = 1;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/**
 * Fluent analysis builder (v0.11.0).
 *
 *   const result = sales
 *     .analyze()
 *     .groupBy('month')
 *     .sum('amount', { as: 'totalSales' })
 *     .mean('amount', { as: 'averageSales' })
 *     .count()
 *     .execute();
 *
 * Steps recorded before the first aggregation apply to the source rows
 * (select, where, distinct, orderBy, offset, limit). Steps recorded after
 * the first aggregation apply to the aggregated output (having-style
 * filtering, ordering, paging, projection). Global aggregation without
 * groupBy() produces a single summary row. execute() returns an
 * AnalysisResult; the source is never mutated.
 */
export class AnalysisBuilder {
  #source;
  #columns;
  #sourceName;
  #lineage;
  #steps;

  constructor(rows, columns, sourceName = 'Analysis', lineage = null) {
    if (!Array.isArray(rows) || !Array.isArray(columns)) {
      throw new ValidationError('AnalysisBuilder requires source rows and columns.');
    }
    this.#source = rows.map(row => ({ ...row }));
    this.#columns = [...columns];
    this.#sourceName = sourceName;
    this.#lineage = lineage;
    this.#steps = [];
    Object.freeze(this);
  }

  select(...columns) {
    const cols = columns.flat();
    cols.forEach(column => this.#assertColumn(column));
    this.#steps.push({ kind: 'select', columns: [...cols] });
    return this;
  }

  where(condition) { return this.#filter(condition, 'where'); }
  filter(condition) { return this.#filter(condition, 'where'); }
  #filter(condition, kind) {
    if (typeof condition === 'function') {
      this.#steps.push({ kind, predicate: condition });
      return this;
    }
    const compiled = compileCondition(condition);
    for (const column of compiled.columns) this.#assertColumn(column);
    this.#steps.push({ kind, condition });
    return this;
  }

  groupBy(...columns) {
    const keys = columns.flat();
    if (new Set(keys).size !== keys.length) throw new ValidationError('groupBy key columns must be unique.');
    if (this.#steps.some(step => step.kind === 'group' || step.kind === 'aggregation')) {
      throw new ValidationError('groupBy can only be called once per analysis and must come before aggregations.');
    }
    keys.forEach(column => this.#assertColumn(column));
    this.#steps.push({ kind: 'group', keys: [...keys] });
    return this;
  }

  having(condition) {
    if (typeof condition === 'function') {
      this.#steps.push({ kind: 'having', predicate: condition });
      return this;
    }
    this.#steps.push({ kind: 'having', condition });
    return this;
  }

  orderBy(column, direction = 'asc') {
    this.#steps.push({ kind: 'orderBy', column, direction });
    return this;
  }
  sort(column, direction = 'asc') { return this.orderBy(column, direction); }
  sortBy(column, direction = 'asc') { return this.orderBy(column, direction); }

  limit(countValue) {
    this.#steps.push({ kind: 'limit', count: countValue });
    return this;
  }
  offset(countValue) {
    this.#steps.push({ kind: 'offset', count: countValue });
    return this;
  }
  distinct(...columns) {
    this.#steps.push({ kind: 'distinct', columns: columns.flat() });
    return this;
  }

  sum(column, options = {}) { return this.#agg(sum(column, options)); }
  mean(column, options = {}) { return this.#agg(mean(column, options)); }
  average(column, options = {}) { return this.#agg(average(column, options)); }
  median(column, options = {}) { return this.#agg(median(column, options)); }
  min(column, options = {}) { return this.#agg(min(column, options)); }
  max(column, options = {}) { return this.#agg(max(column, options)); }
  count(column, options = {}) { return this.#agg(count(column, options)); }
  countRows(options = {}) { return this.#agg(countRows(options)); }
  nunique(column, options = {}) { return this.#agg(nunique(column, options)); }
  variance(column, options = {}) { return this.#agg(variance(column, options)); }
  std(column, options = {}) { return this.#agg(std(column, options)); }
  stddev(column, options = {}) { return this.#agg(stddev(column, options)); }
  range(column, options = {}) { return this.#agg(range(column, options)); }
  quantile(column, q, options = {}) { return this.#agg(quantile(column, q, options)); }
  percentile(column, p, options = {}) { return this.#agg(percentile(column, p, options)); }
  quartiles(column, options = {}) { return this.#agg(quartiles(column, options)); }
  iqr(column, options = {}) { return this.#agg(iqr(column, options)); }
  mad(column, options = {}) { return this.#agg(mad(column, options)); }
  skewness(column, options = {}) { return this.#agg(skewness(column, options)); }
  kurtosis(column, options = {}) { return this.#agg(kurtosis(column, options)); }

  agg(specification) { return this.#agg(specification); }
  aggregate(specification) { return this.#agg(specification); }
  #agg(specification) {
    const spec = isRecord(specification) && typeof specification.op === 'string' ? [specification] : specification;
    const aggregations = normalizeAggregations(spec, this.#outputColumns());
    for (const aggregation of aggregations) this.#steps.push({ kind: 'aggregation', aggregation });
    return this;
  }

  /** Runs the recorded steps and returns a composable AnalysisResult. */
  execute() {
    let rows = this.#source.map(row => ({ ...row }));
    let columns = [...this.#columns];

    const firstAggregationIndex = this.#steps.findIndex(step => step.kind === 'aggregation');
    const preSteps = firstAggregationIndex === -1
      ? this.#steps.filter(step => step.kind !== 'group')
      : this.#steps.slice(0, firstAggregationIndex).filter(step => step.kind !== 'group');
    const aggregationSteps = this.#steps.filter(step => step.kind === 'aggregation');
    const postSteps = firstAggregationIndex === -1 ? []
      : this.#steps.slice(firstAggregationIndex).filter(step => step.kind !== 'aggregation' && step.kind !== 'group');

    for (const step of preSteps) ({ rows, columns } = applyPreStep(step, rows, columns));

    if (aggregationSteps.length) {
      const groupStep = this.#steps.find(step => step.kind === 'group');
      const keys = groupStep ? groupStep.keys : [];
      for (const key of keys) {
        if (!columns.includes(key)) throw new ValidationError(`Unknown groupBy column: ${key}`);
      }
      const aggregations = aggregationSteps.map(step => step.aggregation);
      const outputColumns = [...keys, ...aggregations.map(aggregation => aggregation.name)];
      if (new Set(outputColumns).size !== outputColumns.length) {
        throw new ValidationError('Grouping and aggregation output column names must be unique.');
      }
      rows = aggregateRows(rows, keys, aggregations);
      columns = outputColumns;
    }

    for (const step of postSteps) ({ rows, columns } = applyPostStep(step, rows, columns));

    const lineage = {
      source: this.#sourceName,
      operation: 'analyze',
      version: AGGREGATION_VERSION,
      createdAt: new Date().toISOString(),
      steps: this.#steps.map(serializeStep)
    };
    return new AnalysisResult(rows, columns, { lineage });
  }

  /**
   * Declarative query document for the recorded steps. Supports a future
   * SQL-string interface by providing a serializable, versioned plan.
   */
  toJSON() {
    if (this.#steps.some(step => step.predicate)) {
      throw new ValidationError('AnalysisBuilder.toJSON cannot serialize function predicates; use condition objects.');
    }
    return { version: AGGREGATION_VERSION, source: this.#sourceName, steps: this.#steps.map(serializeStep) };
  }
  static fromJSON(document, rows, columns) {
    if (!isRecord(document) || document.version !== AGGREGATION_VERSION) {
      throw new ValidationError(`Unsupported analysis document version: ${document?.version}`);
    }
    const builder = new AnalysisBuilder(rows, columns, document.source ?? 'Analysis');
    for (const step of document.steps ?? []) {
      applyDocumentStep(builder, step);
    }
    return builder;
  }

  #outputColumns() {
    return this.#columns;
  }
  #assertColumn(name) {
    if (!this.#columns.includes(name)) throw new ValidationError(`Unknown column: ${name}`);
  }
}

function applyPreStep(step, rows, columns) {
  switch (step.kind) {
    case 'select': {
      const selected = step.columns;
      const unique = new Set(selected);
      if (unique.size !== selected.length) throw new ValidationError('Selected column names must be unique.');
      for (const column of selected) {
        if (!columns.includes(column)) throw new ValidationError(`Unknown column: ${column}`);
      }
      return { rows: rows.map(row => Object.fromEntries(selected.map(column => [column, row[column]]))), columns: [...selected] };
    }
    case 'where':
    case 'having': return { rows: filterRows(step, rows), columns };
    case 'distinct': {
      const keyColumns = step.columns.length ? step.columns : columns;
      for (const column of keyColumns) {
        if (!columns.includes(column)) throw new ValidationError(`Unknown column: ${column}`);
      }
      const seen = new Set();
      const result = [];
      for (const row of rows) {
        const key = JSON.stringify(keyColumns.map(column => distinctKey(row[column])));
        if (!seen.has(key)) { seen.add(key); result.push(row); }
      }
      return { rows: result, columns: step.columns.length ? [...step.columns] : columns };
    }
    case 'orderBy': {
      if (!columns.includes(step.column)) throw new ValidationError(`Unknown column: ${step.column}`);
      return { rows: sortRows(rows, step.column, step.direction), columns };
    }
    case 'offset': return { rows: rows.slice(validCount(step.count, 'offset')), columns };
    case 'limit': return { rows: rows.slice(0, validCount(step.count, 'limit')), columns };
    default: throw new ValidationError(`Unsupported pre-aggregation step: ${step.kind}`);
  }
}

function applyPostStep(step, rows, columns) {
  switch (step.kind) {
    case 'where':
    case 'having': return { rows: filterRows(step, rows, columns), columns };
    case 'orderBy': {
      if (!columns.includes(step.column)) throw new ValidationError(`Unknown column: ${step.column}`);
      return { rows: sortRows(rows, step.column, step.direction), columns };
    }
    case 'distinct': {
      const keyColumns = step.columns.length ? step.columns : columns;
      for (const column of keyColumns) {
        if (!columns.includes(column)) throw new ValidationError(`Unknown column: ${column}`);
      }
      const seen = new Set();
      const result = [];
      for (const row of rows) {
        const key = JSON.stringify(keyColumns.map(column => distinctKey(row[column])));
        if (!seen.has(key)) { seen.add(key); result.push(row); }
      }
      return { rows: result, columns: step.columns.length ? [...step.columns] : columns };
    }
    case 'select': {
      const selected = step.columns;
      const unique = new Set(selected);
      if (unique.size !== selected.length) throw new ValidationError('Selected column names must be unique.');
      for (const column of selected) {
        if (!columns.includes(column)) throw new ValidationError(`Unknown column: ${column}`);
      }
      return { rows: rows.map(row => Object.fromEntries(selected.map(column => [column, row[column]]))), columns: [...selected] };
    }
    case 'offset': return { rows: rows.slice(validCount(step.count, 'offset')), columns };
    case 'limit': return { rows: rows.slice(0, validCount(step.count, 'limit')), columns };
    default: throw new ValidationError(`Unsupported post-aggregation step: ${step.kind}`);
  }
}

function filterRows(step, rows, columns = null) {
  if (step.predicate) return rows.filter((row, index) => step.predicate({ ...row }, index));
  const compiled = compileCondition(step.condition);
  if (columns) {
    for (const column of compiled.columns) {
      if (!columns.includes(column)) throw new ValidationError(`Unknown column: ${column}`);
    }
  }
  return rows.filter(row => compiled(row));
}

function aggregateRows(rows, keys, aggregations) {
  const groups = new Map();
  if (keys.length === 0) groups.set('global', { key: [], rows: [] });
  for (const row of rows) {
    const keyValues = keys.map(column => row[column] ?? null);
    const key = keys.length === 0 ? 'global' : JSON.stringify(keyValues.map(groupKeyValue));
    if (!groups.has(key)) groups.set(key, { key: keyValues, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(group => {
    const output = Object.fromEntries(keys.map((column, index) => [column, group.key[index]]));
    for (const aggregation of aggregations) output[aggregation.name] = computeAggregation(aggregation, group.rows);
    return output;
  });
}

function applyDocumentStep(builder, step) {
  if (!isRecord(step) || typeof step.kind !== 'string') throw new ValidationError('Analysis document steps must be objects with a kind.');
  switch (step.kind) {
    case 'select': return builder.select(...step.columns);
    case 'where': return builder.where(step.condition);
    case 'having': return builder.having(step.condition);
    case 'group': return builder.groupBy(...(step.keys ?? []));
    case 'aggregation': return builder.agg(step.aggregation);
    case 'orderBy': return builder.orderBy(step.column, step.direction);
    case 'distinct': return builder.distinct(...(step.columns ?? []));
    case 'limit': return builder.limit(step.count);
    case 'offset': return builder.offset(step.count);
    default: throw new ValidationError(`Unsupported analysis document step: ${step.kind}`);
  }
}

function serializeStep(step) {
  if (step.kind === 'aggregation') {
    const a = step.aggregation;
    const doc = { op: a.displayOp ?? a.op };
    if (a.column !== undefined) doc.column = a.column;
    if (a.name !== undefined) doc.as = a.name;
    if (a.ddof !== undefined && a.ddof !== 0) doc.ddof = a.ddof;
    if (a.q !== undefined) doc.q = a.q;
    if (a.p !== undefined) doc.p = a.p;
    if (a.method !== undefined) doc.method = a.method;
    return { kind: 'aggregation', aggregation: doc };
  }
  return { ...step };
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

function validCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError(`${label} must be a non-negative safe integer.`);
  return value;
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
