import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, createInsightSet, createMetricSet, InsightSet } from '../src/index.js';
import { ValidationError } from '../src/errors/index.js';

const baseline = createDataset([
  { Region: 'North', Sales: 100 },
  { Region: 'South', Sales: 100 }
]);
const current = createDataset([
  { Region: 'North', Sales: 85 },
  { Region: 'South', Sales: 110 }
]);
const salesMetrics = () => createMetricSet([
  { id: 'revenue', label: 'Revenue', aggregation: { op: 'sum', column: 'Sales' }, target: { op: 'gte', value: 90 } },
  { id: 'orders', aggregation: { op: 'countRows' } },
  { id: 'averageOrderValue', formula: { op: 'divide', args: [{ metric: 'revenue' }, { metric: 'orders' }] } }
]);

test('target-missed insights reuse MetricSet targets and return explainable Dataset findings', () => {
  const insights = createInsightSet([
    { id: 'missed-revenue', type: 'targetMissed', metricId: 'revenue', label: 'Revenue goal missed', severity: 'critical' }
  ]);
  const result = insights.evaluate(current, { metricSet: salesMetrics(), baseline, groupBy: ['Region'] });
  assert.equal(result.name, 'Insight findings');
  assert.deepEqual(result.columns, [
    'Region', 'insightId', 'type', 'severity', 'title', 'explanation', 'metricId', 'column',
    'rowIndex', 'value', 'baselineValue', 'change', 'percentChange', 'threshold', 'score'
  ]);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(
    [result.rows[0].Region, result.rows[0].severity, result.rows[0].value, result.rows[0].baselineValue, result.rows[0].change],
    ['North', 'critical', 85, 100, -15]
  );
  assert.match(result.rows[0].explanation, /Revenue was 85; its value target \(≥ 90\) was missed/);
  assert.deepEqual(result.rows[0].threshold, { on: 'value', op: 'gte', value: 90 });
});

test('user-defined metric threshold bands support value, signed change, and percent change with highest severity winning', () => {
  const insights = createInsightSet([
    {
      id: 'revenue-drop',
      type: 'metricThreshold',
      metricId: 'revenue',
      thresholds: [
        { on: 'percentChange', op: 'lte', value: -5, severity: 'warning' },
        { on: 'percentChange', op: 'lte', value: -15, severity: 'critical' },
        { on: 'change', op: 'lte', value: -10, severity: 'info' }
      ]
    }
  ]);
  const result = insights.evaluate(current, { metricSet: salesMetrics(), baseline, groupBy: ['Region'] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].Region, 'North');
  assert.equal(result.rows[0].severity, 'critical');
  assert.deepEqual(result.rows[0].threshold, { on: 'percentChange', op: 'lte', value: -15, severity: 'critical' });
  assert.match(result.rows[0].explanation, /percentChange was -15, crossing the configured critical threshold ≤ -15/);
});

test('custom metric value and inclusive range thresholds work without a baseline', () => {
  const data = createDataset([{ Sales: 120 }]);
  const metrics = createMetricSet([{ id: 'revenue', aggregation: { op: 'sum', column: 'Sales' } }]);
  const insights = createInsightSet([
    {
      id: 'high-revenue',
      type: 'metricThreshold',
      metricId: 'revenue',
      thresholds: [{ on: 'value', op: 'between', value: { min: 100, max: 130 }, severity: 'warning' }]
    }
  ]);
  const result = insights.evaluate(data, { metricSet: metrics });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].threshold, {
    on: 'value', op: 'between', value: { min: 100, max: 130 }, severity: 'warning'
  });
  assert.equal(result.rows[0].baselineValue, null);
  assert.equal(result.rows[0].change, null);
});

test('grouped outlier rules expose configurable IQR, Z-score, and modified-Z-score cutoffs', () => {
  const rows = [1, 2, 3, 4, 5, 100].map(value => ({ Region: 'A', Amount: value }));
  rows.push(...[1, 2, 3, 4, 5].map(value => ({ Region: 'B', Amount: value })));
  rows.push({ Region: 'A', Amount: null });
  const data = createDataset(rows);
  const insights = createInsightSet([
    {
      id: 'iqr-extreme', type: 'outlier', column: 'Amount', method: 'iqr',
      thresholds: [
        { op: 'gte', value: 1.5, severity: 'warning' },
        { op: 'gte', value: 10, severity: 'critical' }
      ]
    },
    {
      id: 'standard-score', type: 'outlier', column: 'Amount', method: 'zscore',
      thresholds: [
        { op: 'gte', value: 1.5, severity: 'warning' },
        { op: 'gte', value: 2.5, severity: 'critical' }
      ]
    },
    {
      id: 'robust-score', type: 'outlier', column: 'Amount', method: 'modifiedZScore',
      thresholds: [
        { op: 'gte', value: 3.5, severity: 'warning' },
        { op: 'gte', value: 30, severity: 'critical' }
      ]
    }
  ]);
  const result = insights.evaluate(data, { groupBy: ['Region'] });
  assert.deepEqual(result.rows.map(row => [row.insightId, row.Region, row.rowIndex, row.value, row.severity]), [
    ['iqr-extreme', 'A', 5, 100, 'critical'],
    ['standard-score', 'A', 5, 100, 'warning'],
    ['robust-score', 'A', 5, 100, 'critical']
  ]);
  assert.ok(result.rows.every(row => Number.isFinite(row.score)));
  assert.match(result.rows[0].explanation, /absolute iqr score/);
});

test('IQR outlier score uses the configured fence multiplier and ignores undefined spread', () => {
  const data = createDataset([
    { amount: 1 }, { amount: 2 }, { amount: 3 }, { amount: 4 }, { amount: 5 }, { amount: 100 },
    { amount: 8 }, { amount: 8 }, { amount: 8 }
  ]);
  const insights = createInsightSet([
    { id: 'outlier', type: 'outlier', column: 'amount', method: 'iqr', thresholds: [{ op: 'gte', value: 1.5, severity: 'warning' }] }
  ]);
  const result = insights.evaluate(data);
  assert.deepEqual(result.rows.map(row => row.rowIndex), [5]);
  assert.equal(insights.evaluate(createDataset([{ amount: 8 }, { amount: 8 }])).rows.length, 0);
});

test('Z-score outlier thresholds remain correct for very large finite values', () => {
  const data = createDataset([{ amount: 1e200 }, { amount: 2e200 }, { amount: 3e200 }]);
  const insights = createInsightSet([
    { id: 'large-value', type: 'outlier', column: 'amount', method: 'zscore', thresholds: [{ op: 'gte', value: 1.2, severity: 'warning' }] }
  ]);
  const result = insights.evaluate(data);
  assert.deepEqual(result.rows.map(row => row.rowIndex), [0, 2]);
  assert.ok(result.rows.every(row => Number.isFinite(row.score) && row.score >= 1.2));
});

test('missing baselines and unmatched baseline segments do not produce false change findings', () => {
  const data = createDataset([{ Region: 'New', Sales: 15 }]);
  const old = createDataset([{ Region: 'Old', Sales: 10 }]);
  const rule = createInsightSet([
    { id: 'decline', type: 'metricThreshold', metricId: 'revenue', thresholds: [{ on: 'percentChange', op: 'lte', value: -5, severity: 'warning' }] }
  ]);
  const metrics = createMetricSet([{ id: 'revenue', aggregation: { op: 'sum', column: 'Sales' } }]);
  assert.equal(rule.evaluate(data, { metricSet: metrics, groupBy: ['Region'] }).rows.length, 0);
  assert.equal(rule.evaluate(data, { metricSet: metrics, baseline: old, groupBy: ['Region'] }).rows.length, 0);
});

test('InsightSet rules serialize and restore without changing results', () => {
  const rules = createInsightSet([
    { id: 'target', type: 'targetMissed', metricId: 'revenue', severity: 'warning' },
    { id: 'drop', type: 'metricThreshold', metricId: 'revenue', thresholds: [{ on: 'percentChange', op: 'lte', value: -10, severity: 'critical' }] },
    { id: 'outlier', type: 'outlier', column: 'Sales', method: 'zscore', thresholds: [{ op: 'gte', value: 2.5, severity: 'warning' }] }
  ]);
  const document = JSON.parse(JSON.stringify(rules));
  assert.equal(document.version, 1);
  assert.equal(Object.hasOwn(document.rules[2].thresholds[0], 'on'), false);
  const restored = InsightSet.fromJSON(document);
  assert.deepEqual(restored.rules, rules.rules);
  assert.deepEqual(restored.evaluate(current, { metricSet: salesMetrics(), baseline, groupBy: ['Region'] }).rows,
    rules.evaluate(current, { metricSet: salesMetrics(), baseline, groupBy: ['Region'] }).rows);
});

test('InsightSet validates rules, thresholds, metric references, columns, and evaluation options', () => {
  assert.throws(() => createInsightSet([]), ValidationError);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'unknown' }]), /type must be/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'targetMissed', metricId: 'm', severity: 'urgent' }]), /severity must be/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'metricThreshold', metricId: 'm', thresholds: [] }]), /non-empty thresholds/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'metricThreshold', metricId: 'm', thresholds: [{ on: 'growth', op: 'gte', value: 1, severity: 'warning' }] }]), /on must be/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'metricThreshold', metricId: 'm', thresholds: [{ on: 'value', op: 'between', value: { min: 4, max: 2 }, severity: 'warning' }] }]), /min <= max/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'outlier', column: 'x', method: 'iqr', thresholds: [{ op: 'gte', value: -1, severity: 'warning' }] }]), /cannot be negative/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'targetMissed', metricId: 'm' }, { id: 'x', type: 'targetMissed', metricId: 'm' }]), /unique/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'metricThreshold', metricId: 'unknown', thresholds: [{ on: 'value', op: 'gte', value: 1, severity: 'warning' }] }]).evaluate(current, { metricSet: salesMetrics() }), /unknown metric/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'targetMissed', metricId: 'orders' }]).evaluate(current, { metricSet: salesMetrics() }), /define a target/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'outlier', column: 'Missing', method: 'iqr', thresholds: [{ op: 'gte', value: 1, severity: 'warning' }] }]).evaluate(current), /unknown column/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'targetMissed', metricId: 'revenue' }]).evaluate(current), /require a MetricSet/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'outlier', column: 'Sales', method: 'iqr', thresholds: [{ op: 'gte', value: 1, severity: 'warning' }] }]).evaluate(current, { groupBy: ['Missing'] }), /Unknown InsightSet groupBy/);
  assert.throws(() => createInsightSet([{ id: 'x', type: 'outlier', column: 'Sales', method: 'iqr', thresholds: [{ op: 'gte', value: 1, severity: 'warning' }] }]).evaluate(current, { unknown: true }), /unknown property/);
});
