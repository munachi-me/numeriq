import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset } from '../src/dataset/dataset.js';
import { MetricSet, createMetricSet } from '../src/index.js';
import { ValidationError } from '../src/errors/index.js';

const current = createDataset([
  { Category: 'A', Status: 'closed', Amount: 120, Orders: 1 },
  { Category: 'A', Status: 'closed', Amount: 180, Orders: 1 },
  { Category: 'A', Status: 'open', Amount: 50, Orders: 1 },
  { Category: 'B', Status: 'closed', Amount: 50, Orders: 1 },
  { Category: 'B', Status: 'open', Amount: 70, Orders: 1 }
]);

const scorecard = () => createMetricSet([
  {
    id: 'averageOrderValue',
    label: 'Average order value',
    formula: { op: 'divide', args: [{ metric: 'revenue' }, { metric: 'orders' }] },
    unit: 'USD/order'
  },
  {
    id: 'revenue',
    label: 'Closed revenue',
    aggregation: { op: 'sum', column: 'Amount' },
    where: { op: 'eq', column: 'Status', value: 'closed' },
    unit: 'USD',
    target: { op: 'gte', value: 200 }
  },
  {
    id: 'orders',
    aggregation: { op: 'countRows' },
    where: { op: 'eq', column: 'Status', value: 'closed' },
    target: { op: 'between', value: { min: 1, max: 2 } }
  }
]);

test('MetricSet evaluates filtered aggregations and derived formulas independent of declaration order', () => {
  const result = scorecard().evaluate(current);
  assert.deepEqual(result.columns, [
    'metricId', 'label', 'description', 'value', 'unit', 'targetOn', 'targetOp',
    'targetValue', 'baselineValue', 'change', 'percentChange', 'status'
  ]);
  assert.deepEqual(result.rows.map(row => [row.metricId, row.value, row.status]), [
    ['averageOrderValue', 350 / 3, 'noTarget'],
    ['revenue', 350, 'met'],
    ['orders', 3, 'missed']
  ]);
  assert.equal(result.rows[0].unit, 'USD/order');
  assert.equal(result.rows[0].description, null);
});

test('value, absolute-change, percentage-change, and range targets evaluate correctly', () => {
  const baseline = createDataset([{ Amount: 100 }, { Amount: 100 }]);
  const now = createDataset([{ Amount: 120 }, { Amount: 130 }]);
  const metrics = createMetricSet([
    { id: 'revenue', aggregation: { op: 'sum', column: 'Amount' }, target: { on: 'value', op: 'between', value: { min: 240, max: 260 } } },
    { id: 'increase', aggregation: { op: 'sum', column: 'Amount' }, target: { on: 'change', op: 'gte', value: 50 } },
    { id: 'growth', aggregation: { op: 'sum', column: 'Amount' }, target: { on: 'percentChange', op: 'gte', value: 25 } },
    { id: 'exact', aggregation: { op: 'countRows' }, target: { op: 'eq', value: 2 } }
  ]);
  const rows = metrics.evaluate(now, { baseline }).rows;
  assert.deepEqual(rows.map(row => [row.value, row.baselineValue, row.change, row.percentChange, row.status]), [
    [250, 200, 50, 25, 'met'],
    [250, 200, 50, 25, 'met'],
    [250, 200, 50, 25, 'met'],
    [2, 2, 0, 0, 'met']
  ]);
});

test('change targets are not evaluable without a usable baseline, including a zero prior value', () => {
  const metrics = createMetricSet([
    { id: 'growth', aggregation: { op: 'sum', column: 'Amount' }, target: { on: 'percentChange', op: 'gte', value: 5 } },
    { id: 'change', aggregation: { op: 'sum', column: 'Amount' }, target: { on: 'change', op: 'gte', value: 1 } }
  ]);
  const now = createDataset([{ Amount: 5 }]);
  assert.deepEqual(metrics.evaluate(now).rows.map(row => row.status), ['notEvaluable', 'notEvaluable']);
  const zeroBaseline = createDataset([{ Amount: 0 }]);
  const comparison = metrics.evaluate(now, { baseline: zeroBaseline });
  assert.equal(comparison.rows[0].baselineValue, 0);
  assert.equal(comparison.rows[0].change, 5);
  assert.equal(comparison.rows[0].percentChange, null);
  assert.equal(comparison.rows[0].status, 'notEvaluable');
  assert.equal(comparison.rows[1].status, 'met');
});

test('grouped scorecards preserve current first-seen keys and match baseline groups by key', () => {
  const now = createDataset([
    { Category: 'B', Amount: 15 }, { Category: 'A', Amount: 30 }, { Category: null, Amount: 5 }
  ]);
  const baseline = createDataset([
    { Category: 'A', Amount: 20 }, { Category: null, Amount: 5 }, { Category: 'C', Amount: 8 }
  ]);
  const metrics = createMetricSet([
    { id: 'revenue', aggregation: { op: 'sum', column: 'Amount' }, target: { on: 'percentChange', op: 'gte', value: 25 } }
  ]);
  const result = metrics.evaluate(now, { baseline, groupBy: ['Category'] });
  assert.deepEqual(result.rows.map(row => [row.Category, row.value, row.baselineValue, row.percentChange, row.status]), [
    ['B', 15, null, null, 'notEvaluable'],
    ['A', 30, 20, 50, 'met'],
    [null, 5, 5, 0, 'missed']
  ]);
});

test('overflowed comparison fields are null and non-finite segment keys do not collide', () => {
  const largeCurrent = createDataset([{ Amount: 1e308 }]);
  const largeBaseline = createDataset([{ Amount: -1e308 }]);
  const metric = createMetricSet([
    { id: 'amount', aggregation: { op: 'sum', column: 'Amount' }, target: { on: 'change', op: 'gte', value: 1 } }
  ]);
  const comparison = metric.evaluate(largeCurrent, { baseline: largeBaseline }).rows[0];
  assert.equal(comparison.change, null);
  assert.equal(comparison.percentChange, null);
  assert.equal(comparison.status, 'notEvaluable');

  const currentGroups = createDataset([
    { Segment: NaN, Amount: 1 },
    { Segment: Infinity, Amount: 2 }
  ]);
  const grouped = createMetricSet([
    { id: 'amount', aggregation: { op: 'sum', column: 'Amount' } }
  ]).evaluate(currentGroups, { groupBy: ['Segment'] });
  assert.equal(grouped.rows.length, 2);
  assert.deepEqual(grouped.rows.map(row => row.value), [1, 2]);
});

test('MetricSet serializes and restores definitions without exposing internal dependency metadata', () => {
  const metrics = scorecard();
  const serialized = JSON.stringify(metrics);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.version, 1);
  assert.equal(Object.hasOwn(parsed.metrics[0], 'references'), false);
  const restored = MetricSet.fromJSON(parsed);
  assert.deepEqual(restored.evaluate(current).rows, metrics.evaluate(current).rows);
  assert.deepEqual(createMetricSet(metrics.metrics).metrics, metrics.metrics);
});

test('global metrics over empty data follow aggregate null/zero conventions and handle divide by zero', () => {
  const empty = createDataset([], { columns: ['Amount'] });
  const metrics = createMetricSet([
    { id: 'revenue', aggregation: { op: 'sum', column: 'Amount' } },
    { id: 'rows', aggregation: { op: 'countRows' } },
    { id: 'average', formula: { op: 'divide', args: [{ metric: 'revenue' }, { metric: 'rows' }] } }
  ]);
  assert.deepEqual(metrics.evaluate(empty).rows.map(row => row.value), [0, 0, null]);
});

test('MetricSet validates formulas, dependencies, targets, filters, schemas, and evaluation options', () => {
  assert.throws(() => createMetricSet([]), ValidationError);
  assert.throws(() => createMetricSet([{ id: 'x', aggregation: { op: 'sum', column: 'x' }, formula: 1 }]), /exactly one/);
  assert.throws(() => createMetricSet([{ id: 'x', aggregation: { op: 'sum', column: 'x' } }, { id: 'x', aggregation: { op: 'sum', column: 'x' } }]), /unique/);
  assert.throws(() => createMetricSet([{ id: 'x', aggregation: { op: 'sum', column: 'x' }, target: { on: 'percentGrowth', op: 'gte', value: 5 } }]), /target on/);
  assert.throws(() => createMetricSet([{ id: 'x', aggregation: { op: 'sum', column: 'x' }, target: { op: 'between', value: { min: 10, max: 2 } } }]), /min <= max/);
  assert.throws(() => createMetricSet([{ id: 'x', aggregation: { op: 'sum', column: 'x' } }, { id: 'y', formula: { metric: 'unknown' } }]), /unknown metric/);
  assert.throws(() => createMetricSet([{ id: 'x', formula: { metric: 'y' } }, { id: 'y', formula: { metric: 'x' } }]), /dependency cycle/);
  assert.throws(() => createMetricSet([{ id: 'x', formula: { column: 'raw' } }]), /Unknown column/);
  assert.throws(() => createMetricSet([{ id: 'x', aggregation: { op: 'sum', column: 'Amount' }, where: { op: 'eq', column: 'bad', value: 1 } }]).evaluate(current), /filter references unknown column/);
  assert.throws(() => scorecard().evaluate(current, { groupBy: ['Missing'] }), /Unknown MetricSet groupBy/);
  assert.throws(() => scorecard().evaluate(current, { groupBy: ['value'] }), /conflicts with result column/);
  assert.throws(() => scorecard().evaluate(current, { unknown: true }), /unknown property/);
});
