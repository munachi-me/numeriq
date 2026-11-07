import { ValidationError } from '../errors/index.js';
import { Dataset } from './dataset.js';
import { compileCondition } from './query.js';
import { evaluateExpression } from './expressions.js';
import * as stats from '../stats/descriptive.js';

const METRIC_SET_VERSION = 1;
const AGGREGATIONS = new Set([
  'countRows', 'count', 'nunique', 'sum', 'mean', 'median', 'min', 'max', 'range',
  'variance', 'std', 'quantile', 'iqr', 'mad', 'skewness', 'kurtosis'
]);
const TARGET_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte', 'eq', 'between']);
const RESULT_COLUMNS = [
  'metricId', 'label', 'description', 'value', 'unit', 'targetOn', 'targetOp',
  'targetValue', 'baselineValue', 'change', 'percentChange', 'status'
];
const AGGREGATE_COLUMN = '__numeriq_metric_value__';

/** A versioned, JSON-safe collection of metric definitions. */
export class MetricSet {
  #metrics;
  #evaluationOrder;

  constructor(metricsOrDocument) {
    let document;
    if (Array.isArray(metricsOrDocument)) document = { version: METRIC_SET_VERSION, metrics: metricsOrDocument };
    else {
      if (!isRecord(metricsOrDocument)) throw new ValidationError('MetricSet expects a metrics array or a versioned metric-set document.');
      assertKnownKeys(metricsOrDocument, new Set(['version', 'metrics']), 'MetricSet');
      document = metricsOrDocument;
    }
    const version = document.version ?? METRIC_SET_VERSION;
    if (version !== METRIC_SET_VERSION) throw new ValidationError(`Unsupported metric-set version: ${version}`);
    if (!Array.isArray(document.metrics) || document.metrics.length === 0) throw new ValidationError('MetricSet requires a non-empty metrics array.');

    const metrics = document.metrics.map((metric, index) => normalizeMetric(metric, index));
    if (new Set(metrics.map(metric => metric.id)).size !== metrics.length) throw new ValidationError('Metric IDs must be unique.');
    this.#metrics = deepFreeze(metrics);
    this.#evaluationOrder = Object.freeze(resolveEvaluationOrder(metrics));
    Object.freeze(this);
  }

  static fromJSON(document) { return new MetricSet(document); }
  get metrics() { return this.#metrics.map(({ references, ...metric }) => cloneJson(metric)); }
  toJSON() { return { version: METRIC_SET_VERSION, metrics: this.metrics }; }

  evaluate(dataset, options = {}) {
    if (!(dataset instanceof Dataset)) throw new ValidationError('MetricSet.evaluate expects a Dataset.');
    if (!isRecord(options)) throw new ValidationError('MetricSet evaluation options must be an object.');
    assertKnownKeys(options, new Set(['baseline', 'groupBy']), 'MetricSet evaluation options');
    const baseline = options.baseline;
    if (baseline !== undefined && !(baseline instanceof Dataset)) throw new ValidationError('MetricSet baseline must be a Dataset.');
    const groupBy = options.groupBy ?? [];
    if (!Array.isArray(groupBy) || groupBy.some(column => typeof column !== 'string' || !column.trim())) {
      throw new ValidationError('MetricSet groupBy must be an array of non-empty column names.');
    }
    if (new Set(groupBy).size !== groupBy.length) throw new ValidationError('MetricSet groupBy columns must be unique.');
    const reserved = new Set(RESULT_COLUMNS);
    const reservedKey = groupBy.find(column => reserved.has(column));
    if (reservedKey) throw new ValidationError(`MetricSet groupBy column conflicts with result column: ${reservedKey}`);

    validateDataset(dataset, groupBy, this.#metrics);
    if (baseline) validateDataset(baseline, groupBy, this.#metrics);
    const currentGroups = collectGroups(dataset, groupBy);
    const baselineGroups = baseline ? collectGroups(baseline, groupBy) : new Map();
    const currentValues = evaluateDataset(dataset, groupBy, currentGroups, this.#metrics, this.#evaluationOrder);
    const baselineValues = baseline
      ? evaluateDataset(baseline, groupBy, baselineGroups, this.#metrics, this.#evaluationOrder)
      : new Map();

    const rows = [];
    for (const group of currentGroups.values()) {
      const values = currentValues.get(group.signature) ?? new Map();
      const matchingBaseline = baselineGroups.get(group.signature);
      const priorValues = matchingBaseline ? baselineValues.get(group.signature) ?? new Map() : new Map();
      for (const metric of this.#metrics) {
        const value = values.get(metric.id) ?? null;
        const baselineValue = baseline && matchingBaseline ? priorValues.get(metric.id) ?? null : null;
        const rawChange = finite(value) && finite(baselineValue) ? value - baselineValue : null;
        const change = finite(rawChange) ? rawChange : null;
        const rawPercentChange = change !== null && baselineValue !== 0 ? change / baselineValue * 100 : null;
        const percentChange = finite(rawPercentChange) ? rawPercentChange : null;
        rows.push({
          ...Object.fromEntries(groupBy.map((column, index) => [column, group.key[index]])),
          metricId: metric.id,
          label: metric.label,
          description: metric.description,
          value,
          unit: metric.unit,
          targetOn: metric.target?.on ?? null,
          targetOp: metric.target?.op ?? null,
          targetValue: metric.target?.value ?? null,
          baselineValue,
          change,
          percentChange,
          status: evaluateTarget(metric.target, value, change, percentChange)
        });
      }
    }
    return new Dataset(rows, {
      columns: [...groupBy, ...RESULT_COLUMNS],
      name: 'Metric scorecard'
    });
  }
}

export function createMetricSet(metricsOrDocument) {
  return new MetricSet(metricsOrDocument);
}

function normalizeMetric(metric, index) {
  const label = `Metric ${index + 1}`;
  if (!isRecord(metric)) throw new ValidationError(`${label} must be an object.`);
  assertKnownKeys(metric, new Set(['id', 'label', 'description', 'unit', 'aggregation', 'formula', 'where', 'target']), label);
  if (typeof metric.id !== 'string' || !metric.id.trim()) throw new ValidationError(`${label} requires a non-empty id.`);
  const id = metric.id.trim();
  const hasAggregation = metric.aggregation !== undefined && metric.aggregation !== null;
  const hasFormula = metric.formula !== undefined && metric.formula !== null;
  if (hasAggregation === hasFormula) throw new ValidationError(`${label} must define exactly one of aggregation or formula.`);
  if (metric.label !== undefined && typeof metric.label !== 'string') throw new ValidationError(`${label} label must be a string.`);
  if (metric.description !== undefined && metric.description !== null && typeof metric.description !== 'string') throw new ValidationError(`${label} description must be a string.`);
  if (metric.unit !== undefined && metric.unit !== null && typeof metric.unit !== 'string') throw new ValidationError(`${label} unit must be a string.`);

  const normalized = {
    id,
    label: metric.label?.trim() || id,
    description: metric.description ?? null,
    unit: metric.unit ?? null,
    aggregation: hasAggregation ? normalizeAggregation(metric.aggregation, label) : null,
    formula: hasFormula ? cloneJson(metric.formula, `${label}.formula`) : null,
    where: metric.where === undefined ? null : cloneJson(metric.where, `${label}.where`),
    target: metric.target === undefined || metric.target === null ? null : normalizeTarget(metric.target, label)
  };
  if (hasFormula) {
    if (metric.where !== undefined && metric.where !== null) throw new ValidationError(`${label} where filters are only supported for aggregation metrics.`);
    const references = new Set();
    const sample = replaceMetricReferences(normalized.formula, {}, references, true);
    const result = evaluateExpression(sample, {});
    if (result !== null && (typeof result !== 'number' || !Number.isFinite(result))) {
      throw new ValidationError(`${label} formula must return a finite number or null.`);
    }
    normalized.references = [...references];
  } else {
    normalized.references = [];
    if (normalized.where !== null) compileCondition(normalized.where);
  }
  return normalized;
}

function normalizeAggregation(aggregation, label) {
  if (!isRecord(aggregation)) throw new ValidationError(`${label} aggregation must be an object.`);
  assertKnownKeys(aggregation, new Set(['op', 'column', 'q', 'method', 'ddof']), `${label} aggregation`);
  if (!AGGREGATIONS.has(aggregation.op)) throw new ValidationError(`${label} uses unsupported aggregation: ${String(aggregation.op)}.`);
  const normalized = { op: aggregation.op };
  if (aggregation.op === 'countRows') {
    if (aggregation.column !== undefined) throw new ValidationError(`${label} countRows aggregation does not take a column.`);
  } else {
    if (typeof aggregation.column !== 'string' || !aggregation.column.trim()) throw new ValidationError(`${label} aggregation ${aggregation.op} requires a column.`);
    normalized.column = aggregation.column.trim();
  }
  if (['variance', 'std'].includes(aggregation.op)) {
    if (aggregation.ddof !== undefined) stats.variance([], aggregation.ddof);
    if (aggregation.ddof !== undefined) normalized.ddof = aggregation.ddof;
  } else if (aggregation.ddof !== undefined) throw new ValidationError(`${label} aggregation ${aggregation.op} does not accept ddof.`);
  if (aggregation.op === 'quantile') {
    if (aggregation.q === undefined) throw new ValidationError(`${label} quantile aggregation requires q.`);
    stats.quantile([], aggregation.q, { method: aggregation.method });
    normalized.q = aggregation.q;
    if (aggregation.method !== undefined) normalized.method = aggregation.method;
  } else if (aggregation.q !== undefined || aggregation.method !== undefined) {
    throw new ValidationError(`${label} aggregation ${aggregation.op} does not accept q or method.`);
  }
  return normalized;
}

function normalizeTarget(target, label) {
  if (!isRecord(target)) throw new ValidationError(`${label} target must be an object.`);
  assertKnownKeys(target, new Set(['on', 'op', 'value']), `${label} target`);
  const on = target.on ?? 'value';
  const op = target.op;
  if (!['value', 'change', 'percentChange'].includes(on)) throw new ValidationError(`${label} target on must be 'value', 'change', or 'percentChange'.`);
  if (!TARGET_OPERATORS.has(op)) throw new ValidationError(`${label} target op must be gt, gte, lt, lte, eq, or between.`);
  if (!Object.hasOwn(target, 'value')) throw new ValidationError(`${label} target requires value.`);
  let value;
  if (op === 'between') {
    if (!isRecord(target.value)) throw new ValidationError(`${label} between target value must contain min and max.`);
    assertKnownKeys(target.value, new Set(['min', 'max']), `${label} target range`);
    const { min, max } = target.value;
    if (!finite(min) || !finite(max) || min > max) throw new ValidationError(`${label} target range requires finite min <= max.`);
    value = { min, max };
  } else {
    if (!finite(target.value)) throw new ValidationError(`${label} target value must be a finite number.`);
    value = target.value;
  }
  return { on, op, value };
}

function resolveEvaluationOrder(metrics) {
  const byId = new Map(metrics.map(metric => [metric.id, metric]));
  const states = new Map();
  const order = [];
  const visit = metric => {
    const state = states.get(metric.id);
    if (state === 1) throw new ValidationError(`Metric formulas contain a dependency cycle involving "${metric.id}".`);
    if (state === 2) return;
    states.set(metric.id, 1);
    for (const reference of metric.references) {
      const dependency = byId.get(reference);
      if (!dependency) throw new ValidationError(`Metric "${metric.id}" references unknown metric: ${reference}.`);
      visit(dependency);
    }
    states.set(metric.id, 2);
    order.push(metric);
  };
  metrics.forEach(visit);
  return order;
}

function validateDataset(dataset, groupBy, metrics) {
  const columns = new Set(dataset.columns);
  for (const column of groupBy) {
    if (!columns.has(column)) throw new ValidationError(`Unknown MetricSet groupBy column: ${column}`);
  }
  for (const metric of metrics) {
    if (metric.aggregation?.column && !columns.has(metric.aggregation.column)) {
      throw new ValidationError(`Metric "${metric.id}" references unknown column: ${metric.aggregation.column}`);
    }
    if (metric.where !== null) {
      const predicate = compileCondition(metric.where);
      for (const column of predicate.columns) {
        if (!columns.has(column)) throw new ValidationError(`Metric "${metric.id}" filter references unknown column: ${column}`);
      }
    }
  }
}

function collectGroups(dataset, groupBy) {
  const rows = dataset.rows;
  if (groupBy.length === 0) return new Map([['global', { signature: 'global', key: [], rows }]]);
  const groups = new Map();
  for (const row of rows) {
    const key = groupBy.map(column => row[column] ?? null);
    const signature = groupSignature(key);
    if (!groups.has(signature)) groups.set(signature, { signature, key, rows: [] });
    groups.get(signature).rows.push(row);
  }
  return groups;
}

function evaluateDataset(dataset, groupBy, groups, metrics, order) {
  const valuesByGroup = new Map();
  const compiledFilters = new Map(metrics.filter(metric => metric.where !== null).map(metric => [metric.id, compileCondition(metric.where)]));
  for (const group of groups.values()) {
    const values = new Map();
    for (const metric of order) {
      if (metric.aggregation) {
        const predicate = compiledFilters.get(metric.id);
        const selected = dataset.filter(row => groupBy.length === 0 || groupSignature(groupBy.map(column => row[column] ?? null)) === group.signature)
          .filter(row => !predicate || predicate(row));
        const descriptor = { ...metric.aggregation, name: AGGREGATE_COLUMN };
        const summary = selected.groupBy().agg([descriptor]);
        const result = summary.rows[0];
        const value = result && Object.hasOwn(result, AGGREGATE_COLUMN) ? result[AGGREGATE_COLUMN] : null;
        values.set(metric.id, finite(value) ? value : null);
      } else {
        const result = evaluateExpression(replaceMetricReferences(metric.formula, values, null, false), {});
        if (result !== null && (typeof result !== 'number' || !Number.isFinite(result))) {
          throw new ValidationError(`Metric "${metric.id}" formula did not evaluate to a finite number or null.`);
        }
        values.set(metric.id, result);
      }
    }
    valuesByGroup.set(group.signature, values);
  }
  return valuesByGroup;
}

function evaluateTarget(target, value, change, percentChange) {
  if (target === null) return 'noTarget';
  const observed = target.on === 'value' ? value : target.on === 'change' ? change : percentChange;
  if (!finite(observed)) return 'notEvaluable';
  let passed;
  switch (target.op) {
    case 'gt': passed = observed > target.value; break;
    case 'gte': passed = observed >= target.value; break;
    case 'lt': passed = observed < target.value; break;
    case 'lte': passed = observed <= target.value; break;
    case 'eq': passed = observed === target.value; break;
    case 'between': passed = observed >= target.value.min && observed <= target.value.max; break;
  }
  return passed ? 'met' : 'missed';
}

function replaceMetricReferences(expression, values, references, validation) {
  if (Array.isArray(expression)) return expression.map(item => replaceMetricReferences(item, values, references, validation));
  if (!isRecord(expression)) return expression;
  if (Object.hasOwn(expression, 'metric')) {
    assertKnownKeys(expression, new Set(['metric']), 'Metric reference');
    if (typeof expression.metric !== 'string' || !expression.metric.trim()) throw new ValidationError('Metric references require a non-empty metric id.');
    const id = expression.metric.trim();
    references?.add(id);
    if (validation) return { literal: 1 };
    if (!values.has(id)) throw new ValidationError(`Metric formula dependency is unavailable: ${id}`);
    return { literal: values.get(id) };
  }
  return Object.fromEntries(Object.entries(expression).map(([key, value]) => [key, replaceMetricReferences(value, values, references, validation)]));
}

function groupSignature(values) { return JSON.stringify(values.map(canonicalValue)); }
function canonicalValue(value) {
  if (value instanceof Date) return { type: 'date', value: value.toISOString() };
  if (value === null) return { type: 'null' };
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { type: 'number', value: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
  }
  if (Array.isArray(value)) return { type: 'array', value: value.map(canonicalValue) };
  if (value && typeof value === 'object') return { type: 'object', value: Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) };
  return { type: typeof value, value };
}
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function assertKnownKeys(object, allowed, label) {
  const unknown = Object.keys(object).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`${label} contains unknown property: ${unknown}`);
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }
function cloneJson(value, path = 'MetricSet', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError(`${path} must contain only finite numbers.`);
    return value;
  }
  if (typeof value !== 'object') throw new ValidationError(`${path} must contain JSON-safe values.`);
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) throw new ValidationError(`${path} cannot contain circular references.`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((item, index) => cloneJson(item, `${path}[${index}]`, seen));
  else if (isRecord(value)) result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item, `${path}.${key}`, seen)]));
  else throw new ValidationError(`${path} must use plain objects and arrays.`);
  seen.delete(value);
  return result;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
