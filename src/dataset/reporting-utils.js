import { ValidationError } from '../errors/index.js';
import { Dataset } from './dataset.js';
import { MetricSet } from './metrics.js';
import { InsightSet } from './insights.js';

const SEVERITIES = new Set(['info', 'warning', 'critical']);

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

export function assertKnownKeys(object, allowed, label) {
  const unknown = Object.keys(object).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`${label} contains unknown property: ${unknown}`);
}

export function unwrapVersionedDefinition(input, key, label, version) {
  if (!isRecord(input)) throw new ValidationError(`${label} expects a definition or versioned document.`);
  if (!Object.hasOwn(input, 'version') && !Object.hasOwn(input, key)) return input;
  assertKnownKeys(input, new Set(['version', key]), `${label} document`);
  if (!Object.hasOwn(input, 'version') || !Object.hasOwn(input, key)) {
    throw new ValidationError(`${label} document must include version and ${key}.`);
  }
  if (input.version !== version) throw new ValidationError(`Unsupported ${label.toLowerCase()} version: ${input.version}`);
  if (!isRecord(input[key])) throw new ValidationError(`${label} document ${key} must be an object.`);
  return input[key];
}

export function assertVersionedDocument(input, key, label, version) {
  if (!isRecord(input) || input.version !== version || !Object.hasOwn(input, key)) {
    throw new ValidationError(`${label}.fromJSON expects a version ${version} document with ${key}.`);
  }
}

export function normalizeEmbeddedSet(value, Type, label) {
  if (value === undefined || value === null) return { instance: null, document: null };
  let instance;
  try {
    instance = value instanceof Type ? value : new Type(value);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`${label} could not be constructed: ${error.message}`);
  }
  return { instance, document: cloneJson(instance.toJSON()) };
}

export function normalizeId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${label} must be a non-empty string.`);
  return value.trim();
}

export function normalizeText(value, label, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw new ValidationError(`${label} must be a non-empty string.`);
  }
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${label} must be a non-empty string.`);
  return value.trim();
}

export function normalizeBody(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${label} must be a non-empty string.`);
  return value;
}

export function normalizeGroupBy(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(column => typeof column !== 'string' || !column.trim())) {
    throw new ValidationError(`${label} must be an array of non-empty column names.`);
  }
  if (new Set(value).size !== value.length) throw new ValidationError(`${label} column names must be unique.`);
  return [...value];
}

export function normalizeLimit(value, label, defaultValue = null) {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isInteger(value) || value < 0) throw new ValidationError(`${label} must be a non-negative integer.`);
  return value;
}

export function normalizeSource(value, label) {
  const source = value ?? 'dataset';
  if (!['dataset', 'metrics', 'insights'].includes(source)) {
    throw new ValidationError(`${label} must be dataset, metrics, or insights.`);
  }
  return source;
}

export function normalizeSeverity(value, label) {
  if (value === undefined || value === null) return null;
  if (!SEVERITIES.has(value)) throw new ValidationError(`${label} must be info, warning, or critical.`);
  return value;
}

export function normalizePrepareOptions(dataset, definition, options, label, allowGeneratedAt = false) {
  if (!(dataset instanceof Dataset)) throw new ValidationError(`${label}.prepare expects a Dataset.`);
  if (!isRecord(options)) throw new ValidationError(`${label} preparation options must be an object.`);
  const allowed = new Set(['baseline', 'groupBy']);
  if (allowGeneratedAt) allowed.add('generatedAt');
  assertKnownKeys(options, allowed, `${label} preparation options`);
  const baseline = options.baseline;
  if (baseline !== undefined && !(baseline instanceof Dataset)) {
    throw new ValidationError(`${label} baseline must be a Dataset.`);
  }
  const groupBy = normalizeGroupBy(options.groupBy ?? definition.groupBy, `${label} groupBy`);
  for (const column of groupBy) {
    if (!dataset.columns.includes(column)) throw new ValidationError(`${label} references unknown groupBy column: ${column}`);
    if (baseline && !baseline.columns.includes(column)) throw new ValidationError(`${label} baseline is missing groupBy column: ${column}`);
  }
  let generatedAt;
  if (allowGeneratedAt && options.generatedAt !== undefined) {
    const value = options.generatedAt;
    const date = value instanceof Date ? new Date(value.getTime()) : typeof value === 'string' ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) throw new ValidationError(`${label} generatedAt must be a valid Date or date string.`);
    generatedAt = date.toISOString();
  }
  return { baseline, groupBy, ...(generatedAt === undefined ? {} : { generatedAt }) };
}

export function evaluateAnalysisContext({ dataset, metricSet, insightSet, baseline, groupBy, needScorecard, needFindings }) {
  const metricInsightRules = Boolean(insightSet?.rules.some(rule => rule.type !== 'outlier'));
  const scorecardNeeded = Boolean(needScorecard || (needFindings && metricInsightRules));
  if (scorecardNeeded && !metricSet) throw new ValidationError('Dashboard/report metric data requires a MetricSet.');
  if (needFindings && !insightSet) throw new ValidationError('Dashboard/report insight data requires an InsightSet.');
  if (baseline && !scorecardNeeded) throw new ValidationError('A baseline requires metric evaluation in this dashboard/report.');

  const scorecard = scorecardNeeded
    ? metricSet.evaluate(dataset, { ...(baseline ? { baseline } : {}), groupBy })
    : null;
  let findings = null;
  if (needFindings) {
    const options = { groupBy };
    if (metricInsightRules) {
      options.metricSet = metricSet;
      options.scorecard = scorecard;
      if (baseline) options.baseline = baseline;
    }
    findings = insightSet.evaluate(dataset, options);
  }
  return { scorecard, findings };
}

export function getSourceDataset(source, dataset, context, label) {
  if (source === 'dataset') return dataset;
  if (source === 'metrics') {
    if (!context.scorecard) throw new ValidationError(`${label} requires metric data.`);
    return context.scorecard;
  }
  if (source === 'insights') {
    if (!context.findings) throw new ValidationError(`${label} requires insight data.`);
    return context.findings;
  }
  throw new ValidationError(`${label} has an unsupported data source.`);
}

export function filterFindings(dataset, severity, limit) {
  let result = severity === null ? dataset : dataset.filter(row => row.severity === severity);
  if (limit !== null) result = result.head(limit);
  return result;
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
