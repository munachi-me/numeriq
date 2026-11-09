import { ValidationError } from '../errors/index.js';
import { Dataset } from './dataset.js';
import { MetricSet } from './metrics.js';
import { assertMetricScorecardContext } from './scorecard-provenance.js';
import * as stats from '../stats/descriptive.js';

const INSIGHT_SET_VERSION = 1;
const SEVERITIES = new Map([['info', 1], ['warning', 2], ['critical', 3]]);
const THRESHOLD_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte', 'eq', 'between']);
const METRIC_FIELDS = new Set(['value', 'change', 'percentChange']);
const RULE_TYPES = new Set(['targetMissed', 'metricThreshold', 'outlier']);
const METRIC_SCORECARD_COLUMNS = [
  'metricId', 'label', 'description', 'value', 'unit', 'targetOn', 'targetOp',
  'targetValue', 'baselineValue', 'change', 'percentChange', 'status'
];
const RESULT_COLUMNS = [
  'insightId', 'type', 'severity', 'title', 'explanation', 'metricId', 'column',
  'rowIndex', 'value', 'baselineValue', 'change', 'percentChange', 'threshold', 'score'
];

/** A versioned, JSON-safe collection of explainable insight rules. */
export class InsightSet {
  #rules;

  constructor(rulesOrDocument) {
    let document;
    if (Array.isArray(rulesOrDocument)) document = { version: INSIGHT_SET_VERSION, rules: rulesOrDocument };
    else {
      if (!isRecord(rulesOrDocument)) throw new ValidationError('InsightSet expects a rules array or a versioned insight-set document.');
      assertKnownKeys(rulesOrDocument, new Set(['version', 'rules']), 'InsightSet');
      document = rulesOrDocument;
    }
    const version = document.version ?? INSIGHT_SET_VERSION;
    if (version !== INSIGHT_SET_VERSION) throw new ValidationError(`Unsupported insight-set version: ${version}`);
    if (!Array.isArray(document.rules) || document.rules.length === 0) throw new ValidationError('InsightSet requires a non-empty rules array.');
    const rules = document.rules.map((rule, index) => normalizeRule(rule, index));
    if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new ValidationError('Insight rule IDs must be unique.');
    this.#rules = deepFreeze(rules);
    Object.freeze(this);
  }

  static fromJSON(document) { return new InsightSet(document); }
  get rules() { return this.#rules.map(rule => cloneJson(rule)); }
  toJSON() { return { version: INSIGHT_SET_VERSION, rules: this.rules }; }

  evaluate(dataset, options = {}) {
    if (!(dataset instanceof Dataset)) throw new ValidationError('InsightSet.evaluate expects a Dataset.');
    if (!isRecord(options)) throw new ValidationError('InsightSet evaluation options must be an object.');
    assertKnownKeys(options, new Set(['metricSet', 'scorecard', 'baseline', 'groupBy']), 'InsightSet evaluation options');
    const metricSet = options.metricSet;
    const scorecard = options.scorecard;
    const baseline = options.baseline;
    const groupBy = options.groupBy ?? [];
    if (metricSet !== undefined && !(metricSet instanceof MetricSet)) throw new ValidationError('InsightSet metricSet must be a MetricSet.');
    if (scorecard !== undefined && !(scorecard instanceof Dataset)) throw new ValidationError('InsightSet scorecard must be a Dataset.');
    if (scorecard !== undefined && !metricSet) throw new ValidationError('InsightSet scorecard requires a MetricSet.');
    if (baseline !== undefined && !(baseline instanceof Dataset)) throw new ValidationError('InsightSet baseline must be a Dataset.');
    if (!Array.isArray(groupBy) || groupBy.some(column => typeof column !== 'string' || !column.trim())) {
      throw new ValidationError('InsightSet groupBy must be an array of non-empty column names.');
    }
    if (new Set(groupBy).size !== groupBy.length) throw new ValidationError('InsightSet groupBy columns must be unique.');
    const collision = groupBy.find(column => RESULT_COLUMNS.includes(column));
    if (collision) throw new ValidationError(`InsightSet groupBy column conflicts with result column: ${collision}`);
    for (const column of groupBy) {
      if (!dataset.columns.includes(column)) throw new ValidationError(`Unknown InsightSet groupBy column: ${column}`);
    }

    const metricRules = this.#rules.filter(rule => rule.type !== 'outlier');
    const outlierRules = this.#rules.filter(rule => rule.type === 'outlier');
    if (metricRules.length && !metricSet) throw new ValidationError('InsightSet metric rules require a MetricSet evaluation option.');
    if (scorecard && !metricRules.length) throw new ValidationError('InsightSet scorecard requires at least one metric rule.');
    if (baseline && !metricRules.length) throw new ValidationError('InsightSet baseline requires at least one metric rule.');
    for (const rule of outlierRules) {
      if (!dataset.columns.includes(rule.column)) throw new ValidationError(`Insight rule "${rule.id}" references unknown column: ${rule.column}`);
    }
    if (baseline) {
      for (const column of groupBy) {
        if (!baseline.columns.includes(column)) throw new ValidationError(`InsightSet baseline is missing groupBy column: ${column}`);
      }
    }

    const metricRows = metricRules.length
      ? scorecard
        ? validatePrecomputedScorecard(scorecard, metricSet, dataset, baseline, groupBy)
        : metricSet.evaluate(dataset, { baseline, groupBy }).rows
      : [];
    if (metricRules.length) validateMetricReferences(metricRules, metricSet);

    const resultRows = [];
    for (const rule of this.#rules) {
      if (rule.type === 'targetMissed') {
        for (const row of metricRows) {
          if (row.metricId !== rule.metricId || row.status !== 'missed') continue;
          const threshold = { on: row.targetOn, op: row.targetOp, value: row.targetValue };
          const title = rule.label ?? `Target missed: ${row.label}`;
          resultRows.push(makeMetricFinding(rule, row, groupBy, {
            severity: rule.severity,
            title,
            threshold,
            explanation: `${row.label} was ${displayValue(row.value)}; its ${row.targetOn} target (${describeComparison(row.targetOp, row.targetValue)}) was missed.`
          }));
        }
      } else if (rule.type === 'metricThreshold') {
        for (const row of metricRows) {
          if (row.metricId !== rule.metricId) continue;
          const match = strongestMatch(rule.thresholds, threshold => row[threshold.on]);
          if (!match) continue;
          const observed = row[match.on];
          const title = rule.label ?? `Threshold crossed: ${row.label}`;
          resultRows.push(makeMetricFinding(rule, row, groupBy, {
            severity: match.severity,
            title,
            threshold: { on: match.on, op: match.op, value: match.value, severity: match.severity },
            explanation: `${row.label} ${match.on} was ${displayValue(observed)}, crossing the configured ${match.severity} threshold ${describeComparison(match.op, match.value)}.`
          }));
        }
      } else {
        resultRows.push(...evaluateOutlierRule(rule, dataset, groupBy));
      }
    }

    return new Dataset(resultRows, {
      columns: [...groupBy, ...RESULT_COLUMNS],
      name: 'Insight findings'
    });
  }
}

export function createInsightSet(rulesOrDocument) {
  return new InsightSet(rulesOrDocument);
}

function normalizeRule(rule, index) {
  const label = `Insight rule ${index + 1}`;
  if (!isRecord(rule)) throw new ValidationError(`${label} must be an object.`);
  if (typeof rule.id !== 'string' || !rule.id.trim()) throw new ValidationError(`${label} requires a non-empty id.`);
  if (!RULE_TYPES.has(rule.type)) throw new ValidationError(`${label} type must be targetMissed, metricThreshold, or outlier.`);
  if (rule.label !== undefined && rule.label !== null && (typeof rule.label !== 'string' || !rule.label.trim())) throw new ValidationError(`${label} label must be a non-empty string.`);
  const base = { id: rule.id.trim(), type: rule.type, label: rule.label?.trim() ?? null };

  if (rule.type === 'targetMissed') {
    assertKnownKeys(rule, new Set(['id', 'type', 'metricId', 'label', 'severity']), label);
    return {
      ...base,
      metricId: requiredId(rule.metricId, label),
      severity: normalizeSeverity(rule.severity ?? 'warning', label)
    };
  }
  if (rule.type === 'metricThreshold') {
    assertKnownKeys(rule, new Set(['id', 'type', 'metricId', 'label', 'thresholds']), label);
    return {
      ...base,
      metricId: requiredId(rule.metricId, label),
      thresholds: normalizeThresholds(rule.thresholds, label, 'metric')
    };
  }

  assertKnownKeys(rule, new Set(['id', 'type', 'column', 'label', 'method', 'thresholds']), label);
  if (typeof rule.column !== 'string' || !rule.column.trim()) throw new ValidationError(`${label} outlier rule requires a column.`);
  if (!['iqr', 'zscore', 'modifiedZScore'].includes(rule.method)) throw new ValidationError(`${label} outlier method must be iqr, zscore, or modifiedZScore.`);
  return {
    ...base,
    column: rule.column.trim(),
    method: rule.method,
    thresholds: normalizeThresholds(rule.thresholds, label, 'score')
  };
}

function normalizeThresholds(thresholds, label, mode) {
  if (!Array.isArray(thresholds) || thresholds.length === 0) throw new ValidationError(`${label} requires a non-empty thresholds array.`);
  const normalized = thresholds.map((threshold, index) => {
    const name = `${label} threshold ${index + 1}`;
    if (!isRecord(threshold)) throw new ValidationError(`${name} must be an object.`);
    const allowed = mode === 'metric' ? new Set(['severity', 'on', 'op', 'value']) : new Set(['severity', 'op', 'value']);
    assertKnownKeys(threshold, allowed, name);
    const severity = normalizeSeverity(threshold.severity, name);
    const on = mode === 'metric' ? threshold.on : 'score';
    if (mode === 'metric' && !METRIC_FIELDS.has(on)) throw new ValidationError(`${name} on must be value, change, or percentChange.`);
    const op = threshold.op;
    if (!THRESHOLD_OPERATORS.has(op)) throw new ValidationError(`${name} op must be gt, gte, lt, lte, eq, or between.`);
    if (!Object.hasOwn(threshold, 'value')) throw new ValidationError(`${name} requires value.`);
    let value;
    if (op === 'between') {
      if (!isRecord(threshold.value)) throw new ValidationError(`${name} between value must contain min and max.`);
      assertKnownKeys(threshold.value, new Set(['min', 'max']), `${name} range`);
      const { min, max } = threshold.value;
      if (!finite(min) || !finite(max) || min > max) throw new ValidationError(`${name} requires finite min <= max.`);
      value = { min, max };
    } else {
      if (!finite(threshold.value)) throw new ValidationError(`${name} value must be a finite number.`);
      if (mode === 'score' && threshold.value < 0) throw new ValidationError(`${name} score cutoff cannot be negative.`);
      value = threshold.value;
    }
    return mode === 'metric' ? { severity, on, op, value } : { severity, op, value };
  });
  return normalized;
}

function validateMetricReferences(rules, metricSet) {
  const ids = new Set(metricSet.metrics.map(metric => metric.id));
  for (const rule of rules) {
    if (!ids.has(rule.metricId)) throw new ValidationError(`Insight rule "${rule.id}" references unknown metric: ${rule.metricId}`);
    if (rule.type === 'targetMissed') {
      const metric = metricSet.metrics.find(item => item.id === rule.metricId);
      if (!metric.target) throw new ValidationError(`Insight rule "${rule.id}" requires metric "${rule.metricId}" to define a target.`);
    }
  }
}

function validatePrecomputedScorecard(scorecard, metricSet, dataset, baseline, groupBy) {
  assertMetricScorecardContext(scorecard, { metricSet, dataset, baseline, groupBy });
  const requiredColumns = [...groupBy, ...METRIC_SCORECARD_COLUMNS];
  const missing = requiredColumns.find(column => !scorecard.columns.includes(column));
  if (missing) throw new ValidationError(`InsightSet scorecard is missing column: ${missing}`);
  const metricIds = new Set(metricSet.metrics.map(metric => metric.id));
  const rows = scorecard.rows;
  for (const row of rows) {
    if (!metricIds.has(row.metricId)) throw new ValidationError(`InsightSet scorecard contains unknown metric: ${row.metricId}`);
  }
  return rows;
}

function makeMetricFinding(rule, row, groupBy, details) {
  return {
    ...Object.fromEntries(groupBy.map(column => [column, row[column] ?? null])),
    insightId: rule.id,
    type: rule.type,
    severity: details.severity,
    title: details.title,
    explanation: details.explanation,
    metricId: row.metricId,
    column: null,
    rowIndex: null,
    value: row.value,
    baselineValue: row.baselineValue,
    change: row.change,
    percentChange: row.percentChange,
    threshold: cloneJson(details.threshold),
    score: null
  };
}

function evaluateOutlierRule(rule, dataset, groupBy) {
  const groups = collectGroups(dataset, groupBy);
  const findings = [];
  for (const group of groups) {
    const values = group.entries.map(entry => entry.row[rule.column]);
    const scores = outlierScores(values, rule.method);
    for (let index = 0; index < group.entries.length; index++) {
      const score = scores[index];
      if (!finite(score)) continue;
      const match = strongestMatch(rule.thresholds, () => score);
      if (!match) continue;
      const entry = group.entries[index];
      const threshold = { op: match.op, value: match.value, severity: match.severity };
      const title = rule.label ?? `Outlier: ${rule.column}`;
      const explanation = `${rule.column} at row ${entry.index} had value ${displayValue(entry.row[rule.column])} with an absolute ${rule.method} score of ${displayValue(score)}, crossing the configured ${match.severity} threshold ${describeComparison(match.op, match.value)}.`;
      findings.push({
        ...Object.fromEntries(groupBy.map((column, keyIndex) => [column, group.key[keyIndex]])),
        insightId: rule.id,
        type: rule.type,
        severity: match.severity,
        title,
        explanation,
        metricId: null,
        column: rule.column,
        rowIndex: entry.index,
        value: entry.row[rule.column],
        baselineValue: null,
        change: null,
        percentChange: null,
        threshold,
        score
      });
    }
  }
  return findings;
}

function outlierScores(values, method) {
  if (method === 'zscore' || method === 'modifiedZScore') {
    const scaled = scaleFiniteValues(values);
    const scores = method === 'zscore' ? stats.zScores(scaled) : stats.modifiedZScores(scaled);
    return scores.map(score => finite(score) ? Math.abs(score) : null);
  }
  const { q1, q3 } = stats.quartiles(values);
  if (!finite(q1) || !finite(q3)) return values.map(() => null);
  const spread = q3 - q1;
  if (!finite(spread) || spread === 0) return values.map(() => null);
  return values.map(value => {
    if (!finite(value)) return null;
    if (value < q1) return (q1 - value) / spread;
    if (value > q3) return (value - q3) / spread;
    return 0;
  });
}

function scaleFiniteValues(values) {
  const scale = values.reduce((maximum, value) => finite(value) ? Math.max(maximum, Math.abs(value)) : maximum, 0);
  if (scale === 0) return values.map(() => null);
  return values.map(value => finite(value) ? value / scale : null);
}

function strongestMatch(thresholds, getObserved) {
  let best = null;
  for (const threshold of thresholds) {
    const observed = getObserved(threshold);
    if (!finite(observed) || !matches(observed, threshold)) continue;
    if (!best || SEVERITIES.get(threshold.severity) > SEVERITIES.get(best.severity)) best = threshold;
  }
  return best;
}

function matches(observed, threshold) {
  switch (threshold.op) {
    case 'gt': return observed > threshold.value;
    case 'gte': return observed >= threshold.value;
    case 'lt': return observed < threshold.value;
    case 'lte': return observed <= threshold.value;
    case 'eq': return observed === threshold.value;
    case 'between': return observed >= threshold.value.min && observed <= threshold.value.max;
  }
}

function collectGroups(dataset, groupBy) {
  const rows = dataset.rows;
  if (!groupBy.length) return [{ key: [], entries: rows.map((row, index) => ({ row, index })) }];
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = groupBy.map(column => row[column] ?? null);
    const signature = JSON.stringify(key.map(canonicalValue));
    if (!groups.has(signature)) groups.set(signature, { key, entries: [] });
    groups.get(signature).entries.push({ row, index });
  });
  return [...groups.values()];
}

function canonicalValue(value) {
  if (value instanceof Date) return { type: 'date', value: value.toISOString() };
  if (value === null) return { type: 'null' };
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { type: 'number', value: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
  }
  if (Array.isArray(value)) return { type: 'array', value: value.map(canonicalValue) };
  if (value && typeof value === 'object') {
    return { type: 'object', value: Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) };
  }
  return { type: typeof value, value };
}

function describeComparison(op, value) {
  if (op === 'between') return `between ${displayValue(value.min)} and ${displayValue(value.max)}`;
  const symbols = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };
  return `${symbols[op]} ${displayValue(value)}`;
}
function displayValue(value) { return typeof value === 'string' ? JSON.stringify(value) : String(value); }
function normalizeSeverity(severity, label) {
  if (!SEVERITIES.has(severity)) throw new ValidationError(`${label} severity must be info, warning, or critical.`);
  return severity;
}
function requiredId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${label} requires a non-empty metricId.`);
  return value.trim();
}
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function assertKnownKeys(object, allowed, label) {
  const unknown = Object.keys(object).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`${label} contains unknown property: ${unknown}`);
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }
function cloneJson(value, path = 'InsightSet', seen = new Set()) {
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
