import { ValidationError } from '../errors/index.js';
import { Dataset } from './dataset.js';
import * as stats from '../stats/descriptive.js';

const LEGACY_SPEC_VERSION = 1;
const CURRENT_SPEC_VERSION = 2;
const BASE_TYPES = new Set(['bar', 'line', 'scatter']);
const EXTENDED_TYPES = new Set(['area', 'pie', 'donut', 'bubble', 'histogram', 'heatmap', 'boxplot', 'funnel']);
const CHART_TYPES = new Set([...BASE_TYPES, ...EXTENDED_TYPES]);
const AGGREGATIONS = new Set([
  'countRows', 'count', 'nunique', 'sum', 'mean', 'median', 'min', 'max', 'range',
  'variance', 'std', 'quantile', 'iqr', 'mad', 'skewness', 'kurtosis'
]);
const BASE_KEYS = new Set([
  'type', 'x', 'y', 'series', 'title', 'xLabel', 'yLabel', 'aggregate', 'sort', 'options'
]);
const V2_KEYS = new Set(['subtitle', 'colors', 'dataLabels', 'tooltips', 'numberFormat', 'dateFormat', 'size']);

/** A versioned, JSON-safe chart description that prepares chart-ready Dataset data. */
export class ChartSpec {
  #chart;
  #version;

  constructor(chartOrDocument) {
    let chart;
    if (isRecord(chartOrDocument) && (Object.hasOwn(chartOrDocument, 'version') || Object.hasOwn(chartOrDocument, 'chart'))) {
      assertKnownKeys(chartOrDocument, new Set(['version', 'chart']), 'ChartSpec document');
      if (!Object.hasOwn(chartOrDocument, 'version') || !Object.hasOwn(chartOrDocument, 'chart')) {
        throw new ValidationError('ChartSpec document must include version and chart.');
      }
      const version = chartOrDocument.version;
      if (version !== LEGACY_SPEC_VERSION && version !== CURRENT_SPEC_VERSION) {
        throw new ValidationError(`Unsupported chart-spec version: ${version}`);
      }
      chart = chartOrDocument.chart;
    } else {
      chart = chartOrDocument;
    }
    this.#chart = deepFreeze(normalizeChart(chart));
    this.#version = usesCurrentVersion(this.#chart) ? CURRENT_SPEC_VERSION : LEGACY_SPEC_VERSION;
    Object.freeze(this);
  }

  static fromJSON(document) { return new ChartSpec(document); }
  get chart() { return cloneJson(this.#chart); }
  get version() { return this.#version; }
  toJSON() { return { version: this.#version, chart: this.chart }; }

  prepare(dataset) {
    if (!(dataset instanceof Dataset)) throw new ValidationError('ChartSpec.prepare expects a Dataset.');
    const { type, x, y, series, size, aggregate, sort } = this.#chart;
    const columns = new Set(dataset.columns);
    if (!columns.has(x)) throw new ValidationError(`ChartSpec references unknown x column: ${x}`);
    if (series !== null && !columns.has(series)) throw new ValidationError(`ChartSpec references unknown series column: ${series}`);
    if (type === 'bubble' && !columns.has(size)) throw new ValidationError(`ChartSpec references unknown size column: ${size}`);
    if ((aggregate === null || aggregate.op !== 'countRows') && type !== 'histogram') {
      if (!columns.has(y)) throw new ValidationError(`ChartSpec references unknown y column: ${y}`);
    }

    if (type === 'bubble') {
      validateNumericAxis(dataset, x, 'x');
      validateNumericAxis(dataset, y, 'y');
      validateNumericAxis(dataset, size, 'size');
      return this.#finish(dataset.select([x, y, size, ...(series === null ? [] : [series])]), true);
    }
    if (type === 'histogram') return this.#finish(prepareHistogram(dataset, x, this.#chart.options.bins ?? 10), true);
    if (type === 'boxplot') return this.#finish(prepareBoxplot(dataset, x, y), true);
    if (type === 'heatmap') {
      if (aggregate.op !== 'countRows') {
        throw new ValidationError('Heatmap charts support { op: "countRows" } aggregation over the (x, y) pair.');
      }
      const groups = new Map();
      for (const row of dataset.rows) {
        const key = `${JSON.stringify(cellKey(row[x]))}|${JSON.stringify(cellKey(row[y]))}`;
        if (!groups.has(key)) groups.set(key, { x: row[x], y: row[y], count: 0 });
        groups.get(key).count += 1;
      }
      return this.#finish({ rows: [...groups.values()].map(g => ({ [x]: g.x, [y]: g.y, value: g.count })), columns: [x, y, 'value'] }, true);
    }

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
    return this.#finish(prepared);
  }

  #finish(prepared, customColumns = false) {
    return new Dataset(prepared.rows, {
      columns: customColumns ? prepared.columns : chartColumns(this.#chart),
      name: 'Chart data'
    });
  }
}

export function createChartSpec(chartOrDocument) {
  return new ChartSpec(chartOrDocument);
}

function usesCurrentVersion(chart) {
  return EXTENDED_TYPES.has(chart.type)
    || chart.size !== null
    || chart.subtitle !== null
    || chart.colors !== null
    || chart.dataLabels !== null
    || chart.tooltips !== null
    || chart.numberFormat !== null
    || chart.dateFormat !== null;
}

function prepareHistogram(dataset, column, bins) {
  const values = dataset.rows.map(row => row[column]).filter(value => value !== null && (typeof value === 'number' && Number.isFinite(value)));
  const rows = [];
  if (values.length) {
    const low = Math.min(...values);
    const high = Math.max(...values);
    const width = high === low ? 1 : (high - low) / bins;
    for (let index = 0; index < bins; index++) {
      const start = low + index * width;
      const end = index === bins - 1 ? high : start + width;
      const count = values.filter(value => index === bins - 1 ? value >= start && value <= end : value >= start && value < end).length;
      rows.push({ bin: `[${formatNumber(start)}, ${formatNumber(end)})`, start, end, count });
    }
  }
  return { rows, columns: ['bin', 'start', 'end', 'count'] };
}

function prepareBoxplot(dataset, xColumn, yColumn) {
  const groups = new Map();
  for (const row of dataset.rows) {
    const value = row[yColumn];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new ValidationError(`Box plot y column "${yColumn}" must contain only finite numeric values or null.`);
    }
    const key = JSON.stringify(cellKey(row[xColumn]));
    if (!groups.has(key)) groups.set(key, { name: row[xColumn], values: [] });
    if (value !== null) groups.get(key).values.push(value);
  }
  const rows = [...groups.values()].map(group => {
    const sorted = [...group.values].sort((a, b) => a - b);
    return {
      [xColumn]: group.name,
      min: sorted.length ? sorted[0] : null,
      q1: sorted.length ? stats.quantile(sorted, 0.25) : null,
      median: sorted.length ? stats.quantile(sorted, 0.5) : null,
      q3: sorted.length ? stats.quantile(sorted, 0.75) : null,
      max: sorted.length ? sorted[sorted.length - 1] : null
    };
  });
  return { rows, columns: [xColumn, 'min', 'q1', 'median', 'q3', 'max'] };
}

function cellKey(value) {
  if (value instanceof Date) return { d: value.toISOString() };
  if (value !== null && typeof value === 'object') return { o: JSON.stringify(value) };
  return value === undefined ? null : value;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function normalizeChart(chart) {
  if (!isRecord(chart)) throw new ValidationError('ChartSpec expects a chart definition or a versioned chart-spec document.');
  assertKnownKeys(chart, new Set([...BASE_KEYS, ...V2_KEYS]), 'Chart definition');
  if (!CHART_TYPES.has(chart.type)) {
    throw new ValidationError(`Chart type must be one of: ${[...CHART_TYPES].join(', ')}.`);
  }
  const type = chart.type;
  if (chart.size !== undefined && chart.size !== null && type !== 'bubble') {
    throw new ValidationError('Chart size mapping is only supported for bubble charts.');
  }
  const x = requiredName(chart.x, 'Chart x mapping');
  const y = optionalName(chart.y, 'Chart y mapping');
  const series = optionalName(chart.series, 'Chart series mapping');
  const size = optionalName(chart.size, 'Chart size mapping');
  if (type === 'histogram') {
    if (y !== null) throw new ValidationError('Histogram charts bin a single numeric x column; they do not use a y mapping.');
    if (series !== null) throw new ValidationError('Histogram charts do not support a series mapping.');
    if (chart.aggregate !== undefined && chart.aggregate !== null) throw new ValidationError('Histogram charts do not support aggregation.');
  } else if (type === 'bubble') {
    if (y === null) throw new ValidationError('Chart y mapping is required for bubble charts.');
    if (size === null) throw new ValidationError('Bubble charts require a size mapping.');
    if (chart.aggregate !== undefined && chart.aggregate !== null) throw new ValidationError('Bubble charts do not support aggregation.');
  } else if (type === 'heatmap') {
    if (y === null) throw new ValidationError('Chart y mapping is required for heatmap charts.');
  } else if (y === null) {
    throw new ValidationError('Chart y mapping is required.');
  }
  if ((type === 'pie' || type === 'donut' || type === 'boxplot' || type === 'funnel') && series !== null) {
    throw new ValidationError(`${type} charts do not support a series mapping.`);
  }
  const mapped = [x, ...(y === null ? [] : [y]), ...(series === null ? [] : [series]), ...(size === null ? [] : [size])];
  if (new Set(mapped).size !== mapped.length) throw new ValidationError('Chart x, y, size, and series mappings must use distinct columns.');

  const title = optionalLabel(chart.title, 'Chart title');
  const subtitle = optionalLabel(chart.subtitle, 'Chart subtitle');
  const xLabel = optionalLabel(chart.xLabel, 'Chart xLabel');
  const yLabel = optionalLabel(chart.yLabel, 'Chart yLabel');
  const aggregate = normalizeAggregate(chart.aggregate, type);
  const sort = normalizeSort(chart.sort, type, series);
  const options = normalizeOptions(chart.options, type, series);
  const colors = normalizeColors(chart.colors);
  const dataLabels = normalizeBooleanOption(chart.dataLabels, 'dataLabels');
  const tooltips = normalizeBooleanOption(chart.tooltips, 'tooltips');
  const numberFormat = optionalLabel(chart.numberFormat, 'Chart numberFormat');
  const dateFormat = optionalLabel(chart.dateFormat, 'Chart dateFormat');
  return { type, x, y, series, size: size ?? null, title, subtitle, xLabel, yLabel, aggregate, sort, options, colors, dataLabels, tooltips, numberFormat, dateFormat };
}

function normalizeAggregate(aggregate, type) {
  if (aggregate === undefined || aggregate === null) {
    if (type === 'heatmap') throw new ValidationError('Heatmap charts require an aggregate (or { op: "countRows" }).');
    return null;
  }
  if (type === 'scatter' || type === 'bubble' || type === 'boxplot') {
    throw new ValidationError(`${type} charts do not support aggregation.`);
  }
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

function normalizeSort(sort, type, series) {
  if (sort === undefined || sort === null) return null;
  if (type === 'histogram' || type === 'boxplot') {
    throw new ValidationError(`Chart sort is not supported for ${type} charts.`);
  }
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
  const allowed = new Set(['legend', 'grid', 'dataLabels', 'tooltips', 'numberFormat', 'dateFormat']);
  if (type === 'bar' || type === 'area') { allowed.add('stacked'); allowed.add('orientation'); }
  if (type === 'line' || type === 'area') allowed.add('connectNulls');
  if (type === 'scatter' || type === 'bubble') allowed.add('pointSize');
  if (type === 'histogram') allowed.add('bins');
  assertKnownKeys(options, allowed, `${type} chart options`);
  const normalized = {};
  for (const key of ['legend', 'grid', 'stacked', 'connectNulls', 'dataLabels', 'tooltips']) {
    if (!Object.hasOwn(options, key)) continue;
    if (typeof options[key] !== 'boolean') throw new ValidationError(`Chart option ${key} must be a boolean.`);
    normalized[key] = options[key];
  }
  if (options.stacked === true && series === null) throw new ValidationError('A stacked chart requires a series mapping.');
  if (options.orientation !== undefined) {
    if (type !== 'bar') throw new ValidationError(`Chart option orientation is not supported for ${type} charts.`);
    if (!['vertical', 'horizontal'].includes(options.orientation)) throw new ValidationError("Bar chart orientation must be 'vertical' or 'horizontal'.");
    normalized.orientation = options.orientation;
  }
  if (options.pointSize !== undefined) {
    if (typeof options.pointSize !== 'number' || !Number.isFinite(options.pointSize) || options.pointSize <= 0) {
      throw new ValidationError('Chart pointSize must be a positive finite number.');
    }
    normalized.pointSize = options.pointSize;
  }
  if (options.bins !== undefined) {
    if (type !== 'histogram') throw new ValidationError(`Chart option bins is not supported for ${type} charts.`);
    if (!Number.isInteger(options.bins) || options.bins < 1) throw new ValidationError('Histogram bins must be a positive integer.');
    normalized.bins = options.bins;
  }
  if (options.numberFormat !== undefined) normalized.numberFormat = optionalLabel(options.numberFormat, 'Chart numberFormat');
  if (options.dateFormat !== undefined) normalized.dateFormat = optionalLabel(options.dateFormat, 'Chart dateFormat');
  return normalized;
}

function normalizeColors(colors) {
  if (colors === undefined || colors === null) return null;
  if (!Array.isArray(colors) || colors.length === 0 || colors.some(color => typeof color !== 'string' || !color.trim())) {
    throw new ValidationError('Chart colors must be a non-empty array of non-empty strings.');
  }
  return [...colors];
}

function normalizeBooleanOption(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') throw new ValidationError(`Chart ${label} must be a boolean.`);
  return value;
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

/**
 * Heuristic chart-type recommendation based on column types and data shape
 * (v0.16.0). Suggestions are not statistical conclusions — the disclaimer
 * field says so explicitly.
 */
export function recommendChart(xInfo, yInfo = null) {
  const { name: xName, type: xType, cardinality } = xInfo;
  const basedOn = { x: { ...xInfo }, y: yInfo ? { ...yInfo } : null };
  const disclaimer = 'Heuristic suggestion based on column types and data shape; not a statistical conclusion.';
  if (!yInfo) {
    if (['number', 'integer'].includes(xType)) {
      return {
        recommendation: { type: 'histogram', why: `Numeric column "${xName}" bins naturally into a histogram.` },
        alternatives: [{ type: 'bar', why: 'Category counts as a bar chart if the column is treated as categorical.' }],
        basedOn, disclaimer
      };
    }
    return {
      recommendation: { type: 'bar', why: `Categorical column "${xName}" counts naturally as a bar chart.` },
      alternatives: [{ type: 'pie', why: 'Category shares as a pie chart when there are few categories.' }],
      basedOn, disclaimer
    };
  }
  const { name: yName, type: yType } = yInfo;
  if (['date', 'datetime'].includes(xType) && ['number', 'integer'].includes(yType)) {
    return {
      recommendation: { type: 'line', why: `Temporal "${xName}" against numeric "${yName}" reads as a time series.` },
      alternatives: [{ type: 'area', why: 'Area emphasizes cumulative magnitude over time.' }, { type: 'bar', why: 'Bars compare discrete periods.' }],
      basedOn, disclaimer
    };
  }
  if (['number', 'integer'].includes(xType) && ['number', 'integer'].includes(yType)) {
    return {
      recommendation: { type: 'scatter', why: `Two numeric columns (${xName}, ${yName}) show correlation as a scatter plot.` },
      alternatives: [{ type: 'heatmap', why: 'A heatmap of binned pairs works when point density is high.' }],
      basedOn, disclaimer
    };
  }
  if (['string', 'boolean'].includes(xType) && ['number', 'integer'].includes(yType)) {
    if (cardinality <= 4) {
      return {
        recommendation: { type: 'pie', why: `Only ${cardinality} categories in "${xName}"; shares of a whole read well as a pie.` },
        alternatives: [
          { type: 'donut', why: 'Same as pie with space for a center label.' },
          { type: 'bar', why: 'Bars compare category values precisely.' }
        ],
        basedOn, disclaimer
      };
    }
    return {
      recommendation: { type: 'bar', why: `${cardinality} categories in "${xName}" compare best as bars.` },
      alternatives: [
        { type: 'bar', why: 'Horizontal orientation helps with long category names.', },
        { type: 'line', why: 'A line works if category order is meaningful.' }
      ],
      basedOn, disclaimer
    };
  }
  if (['string', 'boolean'].includes(xType) && ['string', 'boolean'].includes(yType)) {
    return {
      recommendation: { type: 'heatmap', why: `Two categorical columns (${xName}, ${yName}) map to a co-occurrence heatmap with countRows aggregation.` },
      alternatives: [],
      basedOn, disclaimer
    };
  }
  return {
    recommendation: { type: 'bar', why: 'A bar chart is the safest default for unfamiliar column shapes.' },
    alternatives: [],
    basedOn, disclaimer
  };
}
