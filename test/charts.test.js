import test from 'node:test';
import assert from 'node:assert/strict';
import { ChartSpec, createChartSpec, createDataset, createMetricSet } from '../src/index.js';

const sales = createDataset([
  { Category: 'A', Region: 'North', Month: 2, Revenue: 10, Units: 1 },
  { Category: 'A', Region: 'South', Month: 1, Revenue: 30, Units: 2 },
  { Category: 'B', Region: 'North', Month: 1, Revenue: 15, Units: 1 },
  { Category: 'B', Region: 'South', Month: 2, Revenue: 5, Units: 3 }
]);

test('ChartSpec serializes renderer-neutral mappings, labels, options, and restores cleanly', () => {
  const chart = createChartSpec({
    type: 'bar', x: 'Category', y: 'Revenue', series: 'Region',
    title: 'Revenue by category', xLabel: 'Category', yLabel: 'USD',
    aggregate: { op: 'sum' },
    sort: { by: 'y', direction: 'desc' },
    options: { legend: true, grid: false, stacked: true, orientation: 'horizontal' }
  });
  const document = JSON.parse(JSON.stringify(chart));
  assert.equal(document.version, 1);
  assert.deepEqual(document.chart.options, { legend: true, grid: false, stacked: true, orientation: 'horizontal' });
  const restored = ChartSpec.fromJSON(document);
  assert.deepEqual(restored.chart, chart.chart);
  assert.deepEqual(createChartSpec(chart.chart).chart, chart.chart);
});

test('bar chart preparation aggregates across category and series, aliases y, and applies stable value sorting', () => {
  const chart = createChartSpec({
    type: 'bar', x: 'Category', y: 'Revenue', series: 'Region', aggregate: { op: 'sum' },
    sort: { by: 'y', direction: 'desc' }
  });
  const result = chart.prepare(sales);
  assert.deepEqual(result.columns, ['Category', 'Revenue', 'Region']);
  assert.deepEqual(result.rows.map(row => [row.Category, row.Revenue, row.Region]), [
    ['A', 30, 'South'],
    ['B', 15, 'North'],
    ['A', 10, 'North'],
    ['B', 5, 'South']
  ]);
  assert.equal(result.name, 'Chart data');
  assert.equal(sales.rows.length, 4);
});

test('line chart aggregation supports countRows aliases and retains first-seen group order by default', () => {
  const data = createDataset([
    { Month: 'Jan', Channel: 'Web' },
    { Month: 'Jan', Channel: 'Web' },
    { Month: 'Feb', Channel: 'Retail' },
    { Month: 'Jan', Channel: 'Retail' }
  ]);
  const chart = createChartSpec({
    type: 'line', x: 'Month', y: 'Transactions', series: 'Channel',
    aggregate: { op: 'countRows' }, options: { connectNulls: true }
  });
  const result = chart.prepare(data);
  assert.deepEqual(result.columns, ['Month', 'Transactions', 'Channel']);
  assert.deepEqual(result.rows.map(row => [row.Month, row.Transactions, row.Channel]), [
    ['Jan', 2, 'Web'],
    ['Feb', 1, 'Retail'],
    ['Jan', 1, 'Retail']
  ]);
});

test('line chart sorting is deterministic and stable for equal x values', () => {
  const chart = createChartSpec({ type: 'line', x: 'Month', y: 'Revenue', series: 'Region', sort: { by: 'x' } });
  const result = chart.prepare(sales);
  assert.deepEqual(result.rows.map(row => [row.Month, row.Region, row.Revenue]), [
    [1, 'South', 30],
    [1, 'North', 15],
    [2, 'North', 10],
    [2, 'South', 5]
  ]);
});

test('scatter chart preparation projects finite numeric axes and allows missing points', () => {
  const data = createDataset([
    { Spend: 10, Revenue: 20, Segment: 'A' },
    { Spend: null, Revenue: 40, Segment: 'B' },
    { Spend: 30, Revenue: 60, Segment: 'A' }
  ]);
  const chart = createChartSpec({
    type: 'scatter', x: 'Spend', y: 'Revenue', series: 'Segment',
    options: { pointSize: 4, legend: true }
  });
  const result = chart.prepare(data);
  assert.deepEqual(result.columns, ['Spend', 'Revenue', 'Segment']);
  assert.deepEqual(result.rows.map(row => [row.Spend, row.Revenue, row.Segment]), [
    [10, 20, 'A'], [null, 40, 'B'], [30, 60, 'A']
  ]);
});

test('chart-ready data can be prepared from a MetricSet scorecard Dataset', () => {
  const metrics = createMetricSet([
    { id: 'revenue', label: 'Revenue', aggregation: { op: 'sum', column: 'Revenue' } },
    { id: 'orders', aggregation: { op: 'countRows' } }
  ]);
  const scorecard = metrics.evaluate(sales, { groupBy: ['Category'] });
  const chart = createChartSpec({ type: 'bar', x: 'metricId', y: 'value', series: 'Category', sort: { by: 'y', direction: 'desc' } });
  const result = chart.prepare(scorecard);
  assert.deepEqual(result.columns, ['metricId', 'value', 'Category']);
  assert.equal(result.rows.length, scorecard.rows.length);
  assert.equal(result.rows[0].value, 40);
});

test('empty datasets preserve the chart-ready schema for raw and aggregated charts', () => {
  const empty = createDataset([], { columns: ['Category', 'Revenue'] });
  const raw = createChartSpec({ type: 'bar', x: 'Category', y: 'Revenue' }).prepare(empty);
  const aggregate = createChartSpec({ type: 'bar', x: 'Category', y: 'Revenue', aggregate: { op: 'sum' } }).prepare(empty);
  assert.deepEqual(raw.columns, ['Category', 'Revenue']);
  assert.deepEqual(aggregate.columns, ['Category', 'Revenue']);
  assert.equal(raw.length, 0);
  assert.equal(aggregate.length, 0);
});

test('ChartSpec preserves exact Dataset column names and requires an explicit document version', () => {
  const data = createDataset([{ ' x ': 10, ' y ': 20 }]);
  const chart = createChartSpec({ type: 'scatter', x: ' x ', y: ' y ' });
  assert.equal(chart.chart.x, ' x ');
  assert.deepEqual(chart.prepare(data).rows, [{ ' x ': 10, ' y ': 20 }]);
  assert.throws(() => ChartSpec.fromJSON({ chart: { type: 'bar', x: 'x', y: 'y' } }), /must include version and chart/);
  assert.throws(() => ChartSpec.fromJSON({ version: null, chart: { type: 'bar', x: 'x', y: 'y' } }), /Unsupported chart-spec version/);
});

test('ChartSpec validates types, mappings, aggregate options, sorting, data columns, and chart options', () => {
  assert.throws(() => createChartSpec({ type: 'pie', x: 'x', y: 'y' }), /type must be bar, line, or scatter/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'x' }), /Chart y mapping/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'same', y: 'same' }), /distinct columns/);
  assert.throws(() => createChartSpec({ type: 'scatter', x: 'x', y: 'y', aggregate: { op: 'sum' } }), /do not support aggregation/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'x', y: 'y', aggregate: { op: 'quantile' } }), /requires q/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'x', y: 'y', aggregate: { op: 'sum', q: 0.5 } }), /does not accept q/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'x', y: 'y', sort: { by: 'series' } }), /requires a series mapping/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'x', y: 'y', options: { stacked: true } }), /requires a series mapping/);
  assert.throws(() => createChartSpec({ type: 'line', x: 'x', y: 'y', options: { orientation: 'horizontal' } }), /unknown property/);
  assert.throws(() => createChartSpec({ type: 'scatter', x: 'x', y: 'y', options: { pointSize: 0 } }), /positive finite/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'x', y: 'y', unrecognized: true }), /unknown property/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'Missing', y: 'Revenue' }).prepare(sales), /unknown x column/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'Category', y: 'Region' }).prepare(sales), /finite numeric values/);
  assert.throws(() => createChartSpec({ type: 'scatter', x: 'Category', y: 'Revenue' }).prepare(sales), /x column.*finite numeric/);
  const counted = createChartSpec({ type: 'bar', x: 'Category', y: 'Count', aggregate: { op: 'countRows' } }).prepare(sales);
  assert.deepEqual(counted.rows, [{ Category: 'A', Count: 2 }, { Category: 'B', Count: 2 }]);
});
