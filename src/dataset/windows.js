import { ValidationError } from '../errors/index.js';
import { cloneValue } from '../utils/values.js';
import { AnalysisResult } from './analysis-result.js';
import { groupKeyValue } from './aggregations.js';

const WINDOW_VERSION = 1;
const isMissing = value => value === null || value === undefined;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

function validName(name, label) {
  if (typeof name !== 'string' || !name.trim()) throw new ValidationError(`${label} must be a non-empty string.`);
  return name.trim();
}

function assertColumn(columns, name) {
  if (!columns.includes(name)) throw new ValidationError(`Unknown column: ${name}`);
}

function validOffset(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new ValidationError(`${label} must be a positive integer.`);
  return value;
}

/**
 * Window-function builder (v0.13.0). Calculations run across related rows
 * without collapsing them: every operation appends one column and the output
 * keeps the input's rows in the input's order. Partitioning and ordering
 * affect only the calculation sequence, never the output row order.
 *
 *   sales.window()
 *     .partitionBy('region')
 *     .orderBy('date')
 *     .sum('amount', { as: 'runningTotal' })
 *     .execute();
 */
export class WindowBuilder {
  #rows;
  #columns;
  #sourceName;
  #lineage;
  #partitionBy;
  #orderBy;
  #ops;

  constructor(rows, columns, sourceName = 'Analysis', lineage = null, seed = {}) {
    if (!Array.isArray(rows) || !Array.isArray(columns)) {
      throw new ValidationError('WindowBuilder requires source rows and columns.');
    }
    if (seed === null || typeof seed !== 'object' || Array.isArray(seed)) {
      throw new ValidationError('Window seed options must be an object.');
    }
    const allowed = new Set(['partitionBy', 'orderBy', 'functions', 'version']);
    const unknown = Object.keys(seed).find(key => !allowed.has(key));
    if (unknown) throw new ValidationError(`Window does not support option: ${unknown}`);
    if (seed.version !== undefined && seed.version !== WINDOW_VERSION) {
      throw new ValidationError(`Unsupported window document version: ${seed.version}`);
    }
    this.#rows = rows.map(row => ({ ...row }));
    this.#columns = [...columns];
    this.#sourceName = sourceName;
    this.#lineage = lineage;
    this.#partitionBy = [];
    this.#orderBy = [];
    this.#ops = [];
    if (seed.partitionBy !== undefined) this.partitionBy(...[].concat(seed.partitionBy));
    if (seed.orderBy !== undefined) {
      for (const item of [].concat(seed.orderBy)) {
        if (typeof item === 'string') this.orderBy(item);
        else if (isRecord(item)) this.orderBy(item.column, item.direction ?? 'asc');
        else throw new ValidationError('Window orderBy seed entries must be column names or { column, direction } objects.');
      }
    }
    if (seed.functions !== undefined) {
      if (!Array.isArray(seed.functions)) throw new ValidationError('Window functions seed must be an array.');
      for (const descriptor of seed.functions) this.#applyDescriptor(descriptor);
    }
  }

  partitionBy(...columns) {
    for (const column of columns.flat()) {
      validName(column, 'Partition column');
      assertColumn(this.#columns, column);
      if (!this.#partitionBy.includes(column)) this.#partitionBy.push(column);
    }
    return this;
  }

  orderBy(column, direction = 'asc') {
    validName(column, 'Order column');
    assertColumn(this.#columns, column);
    if (!['asc', 'desc'].includes(direction)) throw new ValidationError("direction must be 'asc' or 'desc'.");
    this.#orderBy.push({ column, direction });
    return this;
  }

  // Ranking --------------------------------------------------------------
  rowNumber(options = {}) { return this.#add({ kind: 'rowNumber', as: outputName(options, 'row_number') }); }
  rank(options = {}) { return this.#add({ kind: 'rank', as: outputName(options, 'rank') }); }
  denseRank(options = {}) { return this.#add({ kind: 'denseRank', as: outputName(options, 'dense_rank') }); }
  percentRank(options = {}) { return this.#add({ kind: 'percentRank', as: outputName(options, 'percent_rank') }); }
  cumeDist(options = {}) { return this.#add({ kind: 'cumeDist', as: outputName(options, 'cume_dist') }); }
  ntile(buckets, options = {}) {
    if (!Number.isInteger(buckets) || buckets < 1) throw new ValidationError('ntile requires a positive integer bucket count.');
    return this.#add({ kind: 'ntile', buckets, as: outputName(options, `ntile_${buckets}`) });
  }

  // Offset -----------------------------------------------------------------
  lag(column, options = {}) {
    assertColumn(this.#columns, column);
    const offset = options.offset ?? 1;
    validOffset(offset, 'lag offset');
    return this.#add({ kind: 'lag', column, offset, defaultValue: options.default ?? null, as: outputName(options, offset === 1 ? `lag of ${column}` : `lag ${offset} of ${column}`) });
  }
  lead(column, options = {}) {
    assertColumn(this.#columns, column);
    const offset = options.offset ?? 1;
    validOffset(offset, 'lead offset');
    return this.#add({ kind: 'lead', column, offset, defaultValue: options.default ?? null, as: outputName(options, offset === 1 ? `lead of ${column}` : `lead ${offset} of ${column}`) });
  }
  firstValue(column, options = {}) {
    assertColumn(this.#columns, column);
    return this.#add({ kind: 'firstValue', column, as: outputName(options, `first value of ${column}`) });
  }
  lastValue(column, options = {}) {
    assertColumn(this.#columns, column);
    return this.#add({ kind: 'lastValue', column, as: outputName(options, `last value of ${column}`) });
  }
  nthValue(column, options = {}) {
    assertColumn(this.#columns, column);
    const n = options.n;
    validOffset(n, 'nthValue n');
    return this.#add({ kind: 'nthValue', column, n, as: outputName(options, `nth value (${n}) of ${column}`) });
  }

  // Cumulative ---------------------------------------------------------------
  cumulativeSum(column, options = {}) {
    assertColumn(this.#columns, column);
    return this.#add({ kind: 'cumulative', stat: 'sum', column, as: outputName(options, `cumulative sum of ${column}`) });
  }
  cumulativeMean(column, options = {}) {
    assertColumn(this.#columns, column);
    return this.#add({ kind: 'cumulative', stat: 'mean', column, as: outputName(options, `cumulative mean of ${column}`) });
  }
  cumulativeMin(column, options = {}) {
    assertColumn(this.#columns, column);
    return this.#add({ kind: 'cumulative', stat: 'min', column, as: outputName(options, `cumulative min of ${column}`) });
  }
  cumulativeMax(column, options = {}) {
    assertColumn(this.#columns, column);
    return this.#add({ kind: 'cumulative', stat: 'max', column, as: outputName(options, `cumulative max of ${column}`) });
  }
  cumulativeCount(column, options = {}) {
    assertColumn(this.#columns, column);
    return this.#add({ kind: 'cumulative', stat: 'count', column, as: outputName(options, `cumulative count of ${column}`) });
  }

  // Rolling --------------------------------------------------------------------
  rollingMean(column, options = {}) { return this.#rolling('mean', column, options); }
  rollingSum(column, options = {}) { return this.#rolling('sum', column, options); }
  rollingMin(column, options = {}) { return this.#rolling('min', column, options); }
  rollingMax(column, options = {}) { return this.#rolling('max', column, options); }
  rollingStd(column, options = {}) { return this.#rolling('std', column, options); }
  #rolling(stat, column, options) {
    assertColumn(this.#columns, column);
    const window = options.window ?? 2;
    if (!Number.isInteger(window) || window < 1) throw new ValidationError('rolling window must be a positive integer.');
    const minPeriods = options.minPeriods ?? window;
    if (!Number.isInteger(minPeriods) || minPeriods < 1) throw new ValidationError('rolling minPeriods must be a positive integer.');
    return this.#add({ kind: 'rolling', stat, column, window, minPeriods, as: outputName(options, `rolling ${stat} of ${column}`) });
  }

  // Time-based --------------------------------------------------------------
  pctChange(column, options = {}) {
    assertColumn(this.#columns, column);
    const periods = options.periods ?? 1;
    validOffset(periods, 'pctChange periods');
    return this.#add({ kind: 'pctChange', column, periods, as: outputName(options, periods === 1 ? `pct change of ${column}` : `pct change (${periods}) of ${column}`) });
  }
  growthRate(column, options = {}) { return this.pctChange(column, options); }

  #add(op) {
    this.#ops.push(op);
    return this;
  }

  #applyDescriptor(descriptor) {
    if (!isRecord(descriptor) || typeof descriptor.kind !== 'string') {
      throw new ValidationError('Window function descriptors must be objects with a kind.');
    }
    const { kind } = descriptor;
    const rest = { ...descriptor };
    delete rest.kind;
    switch (kind) {
      case 'rowNumber': return this.rowNumber(rest);
      case 'rank': return this.rank(rest);
      case 'denseRank': return this.denseRank(rest);
      case 'percentRank': return this.percentRank(rest);
      case 'cumeDist': return this.cumeDist(rest);
      case 'ntile': return this.ntile(descriptor.buckets, rest);
      case 'lag': return this.lag(descriptor.column, rest);
      case 'lead': return this.lead(descriptor.column, rest);
      case 'firstValue': return this.firstValue(descriptor.column, rest);
      case 'lastValue': return this.lastValue(descriptor.column, rest);
      case 'nthValue': return this.nthValue(descriptor.column, rest);
      case 'cumulativeSum': return this.cumulativeSum(descriptor.column, rest);
      case 'cumulativeMean': return this.cumulativeMean(descriptor.column, rest);
      case 'cumulativeMin': return this.cumulativeMin(descriptor.column, rest);
      case 'cumulativeMax': return this.cumulativeMax(descriptor.column, rest);
      case 'cumulativeCount': return this.cumulativeCount(descriptor.column, rest);
      case 'rollingMean': return this.rollingMean(descriptor.column, rest);
      case 'rollingSum': return this.rollingSum(descriptor.column, rest);
      case 'rollingMin': return this.rollingMin(descriptor.column, rest);
      case 'rollingMax': return this.rollingMax(descriptor.column, rest);
      case 'rollingStd': return this.rollingStd(descriptor.column, rest);
      case 'pctChange': return this.pctChange(descriptor.column, rest);
      default: throw new ValidationError(`Unsupported window function: ${kind}`);
    }
  }

  /**
   * Runs every recorded window function and returns an AnalysisResult with
   * the same rows in the same order as the input, plus one column per
   * function. Source rows are never mutated.
   */
  execute() {
    const rows = this.#rows;
    const outputs = this.#ops.map(() => new Map());

    const partitions = new Map();
    rows.forEach((row, index) => {
      const key = JSON.stringify(this.#partitionBy.map(column => groupKeyValue(row[column] ?? null)));
      if (!partitions.has(key)) partitions.set(key, []);
      partitions.get(key).push(index);
    });

    for (const indices of partitions.values()) {
      const seq = this.#sortIndices(indices);
      this.#ops.forEach((op, opIndex) => {
        const values = computeOp(op, seq, rows, this.#orderBy);
        values.forEach((value, position) => outputs[opIndex].set(seq[position], value));
      });
    }

    const outputColumns = [...this.#columns, ...this.#ops.map(op => op.as)];
    if (new Set(outputColumns).size !== outputColumns.length) {
      throw new ValidationError('Window output column names must be unique; use the as option to rename.');
    }
    const resultRows = rows.map((row, index) => {
      const output = { ...row };
      this.#ops.forEach((op, opIndex) => { output[op.as] = cloneValue(outputs[opIndex].get(index) ?? null); });
      return output;
    });
    const lineage = {
      ...(this.#lineage ?? { source: this.#sourceName }),
      operation: 'window',
      version: WINDOW_VERSION,
      partitionBy: [...this.#partitionBy],
      orderBy: [...this.#orderBy],
      functions: this.#ops.map(op => serializeOp(op))
    };
    return new AnalysisResult(resultRows, outputColumns, { lineage });
  }

  /** Declarative configuration: serializes partitioning, ordering, and functions. */
  toJSON() {
    return {
      version: WINDOW_VERSION,
      partitionBy: [...this.#partitionBy],
      orderBy: [...this.#orderBy],
      functions: this.#ops.map(op => serializeOp(op))
    };
  }
  static fromJSON(document, rows, columns, sourceName = 'Analysis') {
    if (!isRecord(document) || document.version !== WINDOW_VERSION) {
      throw new ValidationError(`Unsupported window document version: ${document?.version}`);
    }
    return new WindowBuilder(rows, columns, sourceName, null, {
      partitionBy: document.partitionBy,
      orderBy: document.orderBy,
      functions: document.functions
    });
  }

  #sortIndices(indices) {
    if (this.#orderBy.length === 0) return [...indices];
    let seq = [...indices];
    for (const { column, direction } of [...this.#orderBy].reverse()) {
      seq = seq
        .map(index => ({ index, row: this.#rows[index] }))
        .sort((a, b) => compareCells(a.row[column], b.row[column], direction, a.index, b.index))
        .map(item => item.index);
    }
    return seq;
  }
}

function outputName(options, fallback) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ValidationError('Window function options must be an object.');
  }
  return options.as === undefined ? fallback : validName(options.as, 'Window output name');
}

function serializeOp(op) {
  const result = {};
  for (const [key, value] of Object.entries(op)) {
    if (value === undefined) continue;
    result[key] = key === 'as' ? value : cloneValue(value);
  }
  return result;
}

function compareCells(x, y, direction, aIndex, bIndex) {
  const factor = direction === 'asc' ? 1 : -1;
  if (isMissing(x) && isMissing(y)) return aIndex - bIndex;
  if (isMissing(x)) return 1;
  if (isMissing(y)) return -1;
  const tx = temporalTimestamp(x), ty = temporalTimestamp(y);
  if (tx !== null && ty !== null) return (tx < ty ? -1 : tx > ty ? 1 : 0) * factor || aIndex - bIndex;
  return (x > y ? 1 : x < y ? -1 : 0) * factor || aIndex - bIndex;
}

function temporalTimestamp(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const text = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function peerKey(row, orderBy) {
  return JSON.stringify(orderBy.map(({ column }) => groupKeyValue(row[column] ?? null)));
}

function computeOp(op, seq, rows, orderBy) {
  const values = seq.map(index => rows[index]);
  const columnValues = op.column ? values.map(row => row[op.column]) : null;

  switch (op.kind) {
    case 'rowNumber': return values.map((_, position) => position + 1);
    case 'rank':
    case 'denseRank':
    case 'percentRank':
    case 'cumeDist':
    case 'ntile':
      return computeRanking(op, values, orderBy);
    case 'lag': return values.map((_, position) => {
      const source = position - op.offset;
      if (source < 0) return op.defaultValue ?? null;
      const value = columnValues[source];
      return isMissing(value) ? (op.defaultValue ?? null) : cloneValue(value);
    });
    case 'lead': return values.map((_, position) => {
      const source = position + op.offset;
      if (source >= values.length) return op.defaultValue ?? null;
      const value = columnValues[source];
      return isMissing(value) ? (op.defaultValue ?? null) : cloneValue(value);
    });
    case 'firstValue': return values.map(() => values.length ? cloneValue(columnValues[0] ?? null) : null);
    case 'lastValue': return values.map(() => values.length ? cloneValue(columnValues[values.length - 1] ?? null) : null);
    case 'nthValue': return values.map((_, position) => {
      const source = op.n - 1;
      return position >= source ? cloneValue(columnValues[source] ?? null) : null;
    });
    case 'cumulative': {
      let running = op.stat === 'sum' ? 0 : op.stat === 'count' ? 0 : null;
      const collected = [];
      return values.map((_, position) => {
        const value = columnValues[position];
        if (op.stat === 'count') { if (!isMissing(value)) running += 1; return running; }
        if (op.stat === 'sum') { if (typeof value === 'number' && Number.isFinite(value)) running += value; return running; }
        if (!isMissing(value)) collected.push(value);
        if (!collected.length) return null;
        if (op.stat === 'mean') return collected.reduce((total, item) => total + item, 0) / collected.length;
        if (op.stat === 'min') return collected.reduce((minimum, item) => Math.min(minimum, item), Infinity);
        return collected.reduce((maximum, item) => Math.max(maximum, item), -Infinity);
      });
    }
    case 'rolling': {
      return values.map((_, position) => {
        if (position + 1 < op.minPeriods) return null;
        const frame = columnValues.slice(Math.max(0, position - op.window + 1), position + 1).filter(value => !isMissing(value));
        if (!frame.length) return null;
        switch (op.stat) {
          case 'sum': return frame.reduce((total, value) => total + value, 0);
          case 'mean': return frame.reduce((total, value) => total + value, 0) / frame.length;
          case 'min': return frame.reduce((minimum, value) => Math.min(minimum, value), Infinity);
          case 'max': return frame.reduce((maximum, value) => Math.max(maximum, value), -Infinity);
          case 'std': {
            if (frame.length < 2) return null;
            const mean = frame.reduce((total, value) => total + value, 0) / frame.length;
            return Math.sqrt(frame.reduce((total, value) => total + (value - mean) ** 2, 0) / frame.length);
          }
          default: throw new ValidationError(`Unsupported rolling statistic: ${op.stat}`);
        }
      });
    }
    case 'pctChange': {
      return values.map((_, position) => {
        const source = position - op.periods;
        if (source < 0) return null;
        const current = columnValues[position];
        const previous = columnValues[source];
        if (isMissing(current) || isMissing(previous) || previous === 0) return null;
        return (current - previous) / previous;
      });
    }
    default: throw new ValidationError(`Unsupported window function: ${op.kind}`);
  }
}

function computeRanking(op, values, orderBy) {
  const keys = values.map(row => peerKey(row, orderBy));
  const size = values.length;
  const output = new Array(size);
  let position = 0;
  let densePosition = 0;
  while (position < size) {
    let end = position + 1;
    while (end < size && keys[end] === keys[position]) end++;
    densePosition += 1;
    for (let index = position; index < end; index++) {
      if (op.kind === 'rank') output[index] = position + 1;
      else if (op.kind === 'denseRank') output[index] = densePosition;
      else if (op.kind === 'percentRank') output[index] = size > 1 ? position / (size - 1) : 0;
      else if (op.kind === 'cumeDist') output[index] = end / size;
      else if (op.kind === 'ntile') output[index] = Math.floor(index * op.buckets / size) + 1;
    }
    position = end;
  }
  return output;
}
