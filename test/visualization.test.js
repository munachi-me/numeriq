import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, createChartSpec, ChartSpec, recommendChart, createDashboardSpec, createMetricSet } from '../src/index.js';

function monthly() {
  return createDataset([
    { month: '2026-01', revenue: 100, units: 5 },
    { month: '2026-02', revenue: 200, units: 3 },
    { month: '2026-03', revenue: 150, units: 4 }
  ]);
}
function categorical() {
  return createDataset([
    { region: 'north', amount: 10 },
    { region: 'north', amount: 20 },
    { region: 'south', amount: 30 },
    { region: 'east', amount: 40 },
    { region: 'west', amount: 50 }
  ]);
}
function scattered() {
  return createDataset([
    { spend: 10, revenue: 20, size: 1 },
    { spend: 20, revenue: 35, size: 2 },
    { spend: 30, revenue: 30, size: 3 }
  ]);
}

test('area chart prepares like a line chart with area-specific options', () => {
  const chart = createChartSpec({
    type: 'area', x: 'month', y: 'revenue',
    aggregate: { op: 'sum' }, options: { connectNulls: true, stacked: false }
  });
  const result = chart.prepare(monthly());
  assert.deepEqual(result.columns, ['month', 'revenue']);
  assert.deepEqual(result.rows, [
    { month: '2026-01', revenue: 100 },
    { month: '2026-02', revenue: 200 },
    { month: '2026-03', revenue: 150 }
  ]);
  assert.throws(() => createChartSpec({ type: 'area', x: 'month', y: 'revenue', options: { stacked: true } }), /requires a series mapping/);
});

test('pie and donut charts prepare single-measure category data', () => {
  for (const type of ['pie', 'donut']) {
    const chart = createChartSpec({ type, x: 'region', y: 'amount', aggregate: { op: 'sum' } });
    const result = chart.prepare(categorical());
    assert.deepEqual(result.columns, ['region', 'amount']);
    assert.deepEqual(result.rows, [
      { region: 'north', amount: 30 },
      { region: 'south', amount: 30 },
      { region: 'east', amount: 40 },
      { region: 'west', amount: 50 }
    ]);
    assert.throws(() => createChartSpec({ type, x: 'region', y: 'amount', series: 'region' }), /do not support a series mapping/);
  }
});

test('bubble chart requires x, y, and size numeric mappings', () => {
  const chart = createChartSpec({ type: 'bubble', x: 'spend', y: 'revenue', size: 'size', options: { pointSize: 6 } });
  const result = chart.prepare(scattered());
  assert.deepEqual(result.columns, ['spend', 'revenue', 'size']);
  assert.deepEqual(result.rows, [
    { spend: 10, revenue: 20, size: 1 },
    { spend: 20, revenue: 35, size: 2 },
    { spend: 30, revenue: 30, size: 3 }
  ]);
  assert.throws(() => createChartSpec({ type: 'bubble', x: 'spend', y: 'revenue' }), /require a size mapping/);
  assert.throws(() => createChartSpec({ type: 'bubble', x: 'spend', y: 'revenue', size: 'size', aggregate: { op: 'sum' } }), /do not support aggregation/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'a', y: 'b', size: 'c' }), /only supported for bubble/);
  assert.throws(() => createChartSpec({ type: 'bubble', x: 'month', y: 'revenue', size: 'units' }).prepare(monthly()), /x column.*finite numeric/);
});

test('histogram bins a numeric column with configurable bin count', () => {
  const d = createDataset([{ v: 0 }, { v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 10 }]);
  const chart = createChartSpec({ type: 'histogram', x: 'v', options: { bins: 2 } });
  const result = chart.prepare(d);
  assert.deepEqual(result.columns, ['bin', 'start', 'end', 'count']);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].count, 5);
  assert.equal(result.rows[1].count, 1);
  const defaultBins = createChartSpec({ type: 'histogram', x: 'v' }).prepare(d);
  assert.equal(defaultBins.rows.length, 10);
  assert.equal(defaultBins.rows.reduce((total, row) => total + row.count, 0), 6);
  assert.throws(() => createChartSpec({ type: 'histogram', x: 'v', y: 'other' }), /do not use a y mapping/);
  assert.throws(() => createChartSpec({ type: 'histogram', x: 'v', aggregate: { op: 'sum' } }), /do not support aggregation/);
  assert.throws(() => createChartSpec({ type: 'histogram', x: 'v', options: { bins: 0 } }), /positive integer/);
  const empty = createChartSpec({ type: 'histogram', x: 'v' }).prepare(createDataset([], { columns: ['v'] }));
  assert.deepEqual(empty.columns, ['bin', 'start', 'end', 'count']);
  assert.deepEqual(empty.rows, []);
});

test('boxplot computes five-number summaries per category', () => {
  const d = createDataset([
    { group: 'a', v: 1 }, { group: 'a', v: 2 }, { group: 'a', v: 3 }, { group: 'a', v: 4 },
    { group: 'b', v: 10 }, { group: 'b', v: null }
  ]);
  const result = createChartSpec({ type: 'boxplot', x: 'group', y: 'v' }).prepare(d);
  assert.deepEqual(result.columns, ['group', 'min', 'q1', 'median', 'q3', 'max']);
  const a = result.rows.find(row => row.group === 'a');
  assert.deepEqual([a.min, a.q1, a.median, a.q3, a.max], [1, 1.75, 2.5, 3.25, 4]);
  const b = result.rows.find(row => row.group === 'b');
  assert.deepEqual([b.min, b.max], [10, 10]);
  assert.throws(() => createChartSpec({ type: 'boxplot', x: 'group', y: 'v', series: 'group' }), /do not support a series mapping/);
  assert.throws(() => createChartSpec({ type: 'boxplot', x: 'group', y: 'v', aggregate: { op: 'sum' } }), /do not support aggregation/);
  assert.throws(() => createChartSpec({ type: 'boxplot', x: 'group', y: 'v', sort: { by: 'x' } }), /not supported for boxplot/);
});

test('heatmap prepares co-occurrence counts with countRows', () => {
  const d = createDataset([
    { region: 'north', product: 'A' },
    { region: 'north', product: 'A' },
    { region: 'south', product: 'B' }
  ]);
  const chart = createChartSpec({ type: 'heatmap', x: 'region', y: 'product', aggregate: { op: 'countRows' } });
  const result = chart.prepare(d);
  assert.deepEqual(result.columns, ['region', 'product', 'value']);
  assert.deepEqual(result.rows, [
    { region: 'north', product: 'A', value: 2 },
    { region: 'south', product: 'B', value: 1 }
  ]);
  assert.throws(() => createChartSpec({ type: 'heatmap', x: 'region', y: 'product' }), /require an aggregate/);
  assert.throws(() => createChartSpec({ type: 'heatmap', x: 'region', y: 'product', aggregate: { op: 'sum' } }).prepare(d), /countRows/);
});

test('funnel charts are accepted and prepare sorted stage data', () => {
  const chart = createChartSpec({ type: 'funnel', x: 'stage', y: 'count', aggregate: { op: 'sum' } });
  const result = chart.prepare(createDataset([
    { stage: 'visit', count: 100 }, { stage: 'signup', count: 50 }, { stage: 'purchase', count: 20 }
  ]));
  assert.deepEqual(result.columns, ['stage', 'count']);
  assert.equal(result.rows.length, 3);
});

test('configuration: subtitle, colors, dataLabels, tooltips, numberFormat, dateFormat serialize and validate', () => {
  const chart = createChartSpec({
    version: 2, chart: {
      type: 'bar', x: 'month', y: 'revenue',
      title: 'Monthly Revenue', subtitle: 'FY2026',
      xLabel: 'Month', yLabel: 'USD',
      colors: ['#4e79a7', '#f28e2b'],
      dataLabels: true, tooltips: false,
      numberFormat: '$0,0.00', dateFormat: 'MMM YYYY'
    }
  });
  assert.equal(chart.version, 2);
  const doc = chart.toJSON();
  assert.equal(doc.version, 2);
  assert.equal(doc.chart.subtitle, 'FY2026');
  assert.deepEqual(doc.chart.colors, ['#4e79a7', '#f28e2b']);
  assert.equal(doc.chart.dataLabels, true);
  assert.equal(doc.chart.tooltips, false);
  assert.equal(doc.chart.numberFormat, '$0,0.00');
  assert.equal(doc.chart.dateFormat, 'MMM YYYY');
  const restored = ChartSpec.fromJSON(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored.chart, chart.chart);

  assert.throws(() => createChartSpec({ type: 'bar', x: 'a', y: 'b', colors: [] }), /non-empty array of non-empty strings/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'a', y: 'b', colors: [42] }), /non-empty array of non-empty strings/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'a', y: 'b', dataLabels: 'yes' }), /must be a boolean/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'a', y: 'b', tooltips: 1 }), /must be a boolean/);
  assert.throws(() => createChartSpec({ type: 'bar', x: 'a', y: 'b', numberFormat: 5 }), /non-empty string/);
  assert.equal(createChartSpec({ type: 'bar', x: 'a', y: 'b' }).chart.colors, null, 'colors default to null');
});

test('v1 chart documents from v0.9.0 restore and serialize unchanged', () => {
  const v1 = { version: 1, chart: { type: 'bar', x: 'Category', y: 'Revenue', title: 'Revenue' } };
  const chart = ChartSpec.fromJSON(v1);
  assert.equal(chart.version, 1);
  // Normalization fills v0.16.0 fields with nulls but preserves the v1 definition core.
  assert.equal(chart.toJSON().version, 1);
  assert.equal(chart.chart.type, 'bar');
  assert.equal(chart.chart.x, 'Category');
  assert.equal(chart.chart.title, 'Revenue');
  assert.equal(chart.chart.subtitle, null);
  assert.equal(chart.chart.colors, null);
});

test('chart() convenience method on Dataset and AnalysisResult returns a ChartSpec', () => {
  const chart = monthly().chart({ type: 'bar', x: 'month', y: 'revenue', aggregate: { op: 'sum' } });
  assert.equal(chart instanceof ChartSpec, true);
  assert.deepEqual(chart.prepare(monthly()).rows.length, 3);
  const derived = monthly().analyze().groupBy('month').sum('revenue', { as: 'revenue' }).execute();
  const derivedChart = derived.chart({ type: 'line', x: 'month', y: 'revenue' });
  assert.equal(derivedChart instanceof ChartSpec, true);
});

test('recommendChart suggests types from column shape with an explicit disclaimer', () => {
  const categorical = recommendChart({ name: 'region', type: 'string', cardinality: 3 }, { name: 'amount', type: 'number' });
  assert.equal(categorical.recommendation.type, 'pie');
  assert.match(categorical.disclaimer, /not a statistical conclusion/);
  assert.equal(categorical.basedOn.x.name, 'region');

  const manyCategories = recommendChart({ name: 'region', type: 'string', cardinality: 12 }, { name: 'amount', type: 'number' });
  assert.equal(manyCategories.recommendation.type, 'bar');

  const temporal = recommendChart({ name: 'date', type: 'date' }, { name: 'revenue', type: 'number' });
  assert.equal(temporal.recommendation.type, 'line');

  const numericPair = recommendChart({ name: 'spend', type: 'number' }, { name: 'revenue', type: 'number' });
  assert.equal(numericPair.recommendation.type, 'scatter');

  const singleNumeric = recommendChart({ name: 'amount', type: 'number', cardinality: 20 });
  assert.equal(singleNumeric.recommendation.type, 'histogram');

  const twoCategorical = recommendChart({ name: 'region', type: 'string' }, { name: 'product', type: 'string' });
  assert.equal(twoCategorical.recommendation.type, 'heatmap');
});

test('extended charts work as reusable dashboard chart panels', () => {
  const sales = createDataset([
    { Category: 'A', Tier: 'gold', Revenue: 10 },
    { Category: 'A', Tier: 'silver', Revenue: 20 },
    { Category: 'B', Tier: 'gold', Revenue: 30 }
  ]);
  const metrics = createMetricSet([
    { id: 'revenue', label: 'Revenue', aggregation: { op: 'sum', column: 'Revenue' } }
  ]);
  const dashboard = createDashboardSpec({
    title: 'Shop',
    metricSet: metrics,
    panels: [
      { id: 'kpi', type: 'metric', metricId: 'revenue', layout: { x: 0, y: 0, w: 4, h: 1 } },
      { id: 'pie', type: 'chart', source: 'dataset', chart: { type: 'pie', x: 'Category', y: 'Revenue', aggregate: { op: 'sum' }, colors: ['#333', '#777'] }, layout: { x: 4, y: 0, w: 4, h: 2 } },
      { id: 'hist', type: 'chart', source: 'dataset', chart: { type: 'histogram', x: 'Revenue', options: { bins: 3 } }, layout: { x: 8, y: 0, w: 4, h: 2 } }
    ]
  });
  const prepared = dashboard.prepare(sales);
  assert.equal(prepared.panels.length, 3);
  const piePanel = prepared.panels.find(panel => panel.id === 'pie');
  assert.deepEqual(piePanel.data.columns, ['Category', 'Revenue']);
  assert.deepEqual(piePanel.data.rows, [{ Category: 'A', Revenue: 30 }, { Category: 'B', Revenue: 30 }]);
  const histPanel = prepared.panels.find(panel => panel.id === 'hist');
  assert.equal(histPanel.data.rows.reduce((total, row) => total + row.count, 0), 3);
  // Reusable spec: the same chart definition prepares a different dataset.
  const reusable = createChartSpec({ type: 'pie', x: 'Category', y: 'Revenue', aggregate: { op: 'sum' } });
  assert.equal(reusable.prepare(sales).rows.length, 2);
  assert.deepEqual(reusable.prepare(createDataset([{ Category: 'Z', Revenue: 1 }])).rows, [{ Category: 'Z', Revenue: 1 }]);
});
