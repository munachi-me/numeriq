import { ValidationError } from '../errors/index.js';
import { Dataset } from './dataset.js';
import * as stats from '../stats/descriptive.js';

const CHART_SPEC_VERSION = 1;
const CHART_TYPES = new Set(['bar', 'line', 'scatter']);
const AGGREGATIONS = new Set([
  'countRows', 'count', 'nunique', 'sum', 'mean', 'median', 'min', 'max', 'range',
  'variance', 'std', 'quantile', 'iqr', 'mad', 'skewness', 'kurtosis'
]);
const CHART_KEYS = new Set([
  'type', 'x', 'y', 'series', 'title', 'xLabel', 'yLabel', 'aggregate', 'sort', 'options'
]);

/** A versioned, JSON-safe chart description that prepares chart-ready Dataset data. */
export class ChartSpec {
  #chart;

  constructor(chartOrDocument) {
    let chart;
    if (isRecord(chartOrDocument) && (Object.hasOwn(chartOrDocument, 'version') || Object.hasOwn(chartOrDocument, 'chart'))) {
      assertKnownKeys(chartOrDocument, new Set(['version', 'chart']), 'ChartSpec document');
      if (!Object.hasOwn(chartOrDocument, 'version') || !Object.hasOwn(chartOrDocument, 'chart')) {
        throw new ValidationError('ChartSpec document must include version and chart.');
      }
      const version = chartOrDocument.version;
      if (version !== CHART_SPEC_VERSION) throw new ValidationError(`Unsupported chart-spec version: ${version}`);
      chart = chartOrDocument.chart;
    } else {
      chart = chartOrDocument;
    }
    this.#chart = deepFreeze(normalizeChart(chart));
    Object.freeze(this);
  }

  static fromJSON(document) { return new ChartSpec(document); }
  get chart() { return cloneJson(this.#chart); }
  toJSON() { return { version: CHART_SPEC_VERSION, chart: this.chart }; }

  prepare(dataset) {
    if (!(dataset instanceof Dataset)) throw new ValidationError('ChartSpec.prepare expects a Dataset.');
    const { type, x, y, series, aggregate, sort } = this.#chart;
    const columns = new Set(dataset.columns);
    if (!columns.has(x)) throw new ValidationError(`ChartSpec references unknown x column: ${x}`);
    if (series !== null && !columns.has(series)) throw new ValidationError(`ChartSpec references unknown series column: ${series}`);
    if (aggregate === null || aggregate.op !== 'countRows') {
      if (!columns.has(y)) throw new ValidationError(`ChartSpec references unknown y column: ${y}`);
    }

    if (aggregate === null) {
      validateNumericAxis(dataset, y, 'y');
      if (type === 'scatter') validateNumericAxis(dataset, x, 'x');
    }

    let prepared;
    if (aggregate !== null) {
      const groups = series === null ? [x] : [x, series];
      const descriptor = aggregate.op === 'countRows'
        ? { op: 'countRows', name: y }
        : { ...aggregate, column: y, name: y };
      prepared = dataset.groupBy(...groups).agg([descriptor]).reorderColumns(...chartColumns(this.#chart));
    } else {
      prepared = dataset.select(chartColumns(this.#chart));
    }
    if (sort !== null) prepared = prepared.sortBy(this.#chart[sort.by], sort.direction);
    return new Dataset(prepared.rows, { columns: chartColumns(this.#chart), name: 'Chart data' });
  }
}

export function createChartSpec(chartOrDocument) {
  return new ChartSpec(chartOrDocument);
}

function normalizeChart(chart) {
  if (!isRecord(chart)) throw new ValidationError('ChartSpec expects a chart definition or a versioned chart-spec document.');
  assertKnownKeys(chart, CHART_KEYS, 'Chart definition');
  if (!CHART_TYPES.has(chart.type)) throw new ValidationError('Chart type must be bar, line, or scatter.');
  const type = chart.type;
  const x = requiredName(chart.x, 'Chart x mapping');
  const y = requiredName(chart.y, 'Chart y mapping');
  const series = optionalName(chart.series, 'Chart series mapping');
  const mapped = [x, y, ...(series === null ? [] : [series])];
  if (new Set(mapped).size !== mapped.length) throw new ValidationError('Chart x, y, and series mappings must use distinct columns.');

  const title = optionalLabel(chart.title, 'Chart title');
  const xLabel = optionalLabel(chart.xLabel, 'Chart xLabel');
  const yLabel = optionalLabel(chart.yLabel, 'Chart yLabel');
  const aggregate = normalizeAggregate(chart.aggregate, type);
  const sort = normalizeSort(chart.sort, series);
  const options = normalizeOptions(chart.options, type, series);
  return { type, x, y, series, title, xLabel, yLabel, aggregate, sort, options };
}

function normalizeAggregate(aggregate, type) {
  if (aggregate === undefined || aggregate === null) return null;
  if (type === 'scatter') throw new ValidationError('Scatter charts do not support aggregation.');
  if (!isRecord(aggregate)) throw new ValidationError('Chart aggregate must be an object.');
  assertKnownKeys(aggregate, new Set(['op', 'q', 'method', 'ddof']), 'Chart aggregate');
  if (!AGGREGATIONS.has(aggregate.op)) throw new ValidationError(`Unsupported chart aggregation: ${String(aggregate.op)}.`);
  const normalized = { op: aggregate.op };
  if (aggregate.op === 'quantile') {
    if (aggregate.q === undefined) throw new ValidationError('Chart quantile aggregation requires q.');
    stats.quantile([], aggregate.q, { method: aggregate.method });
    normalized.q = aggregate.q;
    if (aggregate.method !== undefined) normalized.method = aggregate.method;
  } else if (aggregate.q !== undefined || aggregate.method !== undefined) {
    throw new ValidationError(`Chart ${aggregate.op} aggregation does not accept q or method.`);
  }
  if (['variance', 'std'].includes(aggregate.op)) {
    if (aggregate.ddof !== undefined) stats.variance([], aggregate.ddof);
    if (aggregate.ddof !== undefined) normalized.ddof = aggregate.ddof;
  } else if (aggregate.ddof !== undefined) {
    throw new ValidationError(`Chart ${aggregate.op} aggregation does not accept ddof.`);
  }
  return normalized;
}

function normalizeSort(sort, series) {
  if (sort === undefined || sort === null) return null;
  if (!isRecord(sort)) throw new ValidationError('Chart sort must be an object.');
  assertKnownKeys(sort, new Set(['by', 'direction']), 'Chart sort');
  if (!['x', 'y', 'series'].includes(sort.by)) throw new ValidationError("Chart sort by must be 'x', 'y', or 'series'.");
  if (sort.by === 'series' && series === null) throw new ValidationError('Chart sort by series requires a series mapping.');
  const direction = sort.direction ?? 'asc';
  if (!['asc', 'desc'].includes(direction)) throw new ValidationError("Chart sort direction must be 'asc' or 'desc'.");
  return { by: sort.by, direction };
}

function normalizeOptions(options, type, series) {
  if (options === undefined || options === null) options = {};
  if (!isRecord(options)) throw new ValidationError('Chart options must be an object.');
  const allowed = new Set(['legend', 'grid']);
  if (type === 'bar') ['stacked', 'orientation'].forEach(key => allowed.add(key));
  if (type === 'line') allowed.add('connectNulls');
  if (type === 'scatter') allowed.add('pointSize');
  assertKnownKeys(options, allowed, `${type} chart options`);
  const normalized = {};
  for (const key of ['legend', 'grid', 'stacked', 'connectNulls']) {
    if (!Object.hasOwn(options, key)) continue;
    if (typeof options[key] !== 'boolean') throw new ValidationError(`Chart option ${key} must be a boolean.`);
    normalized[key] = options[key];
  }
  if (options.stacked === true && series === null) throw new ValidationError('A stacked bar chart requires a series mapping.');
  if (options.orientation !== undefined) {
    if (!['vertical', 'horizontal'].includes(options.orientation)) throw new ValidationError("Bar chart orientation must be 'vertical' or 'horizontal'.");
    normalized.orientation = options.orientation;
  }
  if (options.pointSize !== undefined) {
    if (typeof options.pointSize !== 'number' || !Number.isFinite(options.pointSize) || options.pointSize <= 0) {
      throw new ValidationError('Scatter chart pointSize must be a positive finite number.');
    }
    normalized.pointSize = options.pointSize;
  }
  return normalized;
}

function validateNumericAxis(dataset, column, axis) {
  for (const [index, row] of dataset.rows.entries()) {
    const value = row[column];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new ValidationError(`Chart ${axis} column "${column}" must contain only finite numeric values or null (row ${index}).`);
    }
  }
}

function chartColumns(chart) {
  return [chart.x, chart.y, ...(chart.series === null ? [] : [chart.series])];
}
function requiredName(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${label} must be a non-empty string.`);
  return value;
}
function optionalName(value, label) {
  if (value === undefined || value === null) return null;
  return requiredName(value, label);
}
function optionalLabel(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${label} must be a non-empty string.`);
  return value.trim();
}
function assertKnownKeys(object, allowed, label) {
  const unknown = Object.keys(object).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`${label} contains unknown property: ${unknown}`);
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }
function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
