import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChartSpec,
  DashboardSpec,
  ReportSpec,
  createChartSpec,
  createDashboardSpec,
  createDataset,
  createInsightSet,
  createMetricSet,
  createReportSpec
} from '../src/index.js';

const current = createDataset([
  { Region: 'North', Category: 'Hardware', Product: 'Desk', Revenue: 120, Units: 2 },
  { Region: 'South', Category: 'Software', Product: 'Plan A', Revenue: 80, Units: 1 },
  { Region: 'North', Category: 'Software', Product: 'Plan B', Revenue: 50, Units: 3 }
]);
const baseline = createDataset([
  { Region: 'North', Category: 'Hardware', Product: 'Desk', Revenue: 100, Units: 2 },
  { Region: 'South', Category: 'Software', Product: 'Plan A', Revenue: 90, Units: 1 }
]);
const metricSet = () => createMetricSet([
  { id: 'revenue', label: 'Revenue', unit: 'USD', aggregation: { op: 'sum', column: 'Revenue' }, target: { op: 'gte', value: 100 } },
  { id: 'orders', label: 'Orders', aggregation: { op: 'countRows' } }
]);
const insightSet = () => createInsightSet([
  { id: 'revenue-below-threshold', type: 'metricThreshold', metricId: 'revenue', thresholds: [{ on: 'value', op: 'lt', value: 100, severity: 'warning' }] },
  { id: 'unusual-revenue', type: 'outlier', column: 'Revenue', method: 'iqr', thresholds: [{ op: 'gte', value: 1.5, severity: 'critical' }] }
]);

test('DashboardSpec prepares metric, chart, and insight panels on one shared evaluation context', () => {
  const dashboard = createDashboardSpec({
    title: 'Regional sales',
    description: 'Sales overview',
    groupBy: ['Region'],
    metricSet: metricSet(),
    insightSet: insightSet(),
    layout: { columns: 12 },
    panels: [
      { id: 'revenue-kpi', type: 'metric', metricId: 'revenue', layout: { x: 0, y: 0, w: 3, h: 1 } },
      {
        id: 'revenue-chart', type: 'chart', source: 'metrics',
        chart: { type: 'bar', x: 'Region', y: 'value', series: 'metricId', sort: { by: 'y', direction: 'desc' } },
        layout: { x: 3, y: 0, w: 6, h: 3 }
      },
      { id: 'warnings', type: 'insights', severity: 'warning', limit: 10, layout: { x: 9, y: 0, w: 3, h: 3 } }
    ]
  });
  const result = dashboard.prepare(current, { baseline });
  assert.equal(result.kind, 'dashboardData');
  assert.equal(result.title, 'Regional sales');
  assert.deepEqual(result.groupBy, ['Region']);
  assert.deepEqual(result.panels.map(panel => panel.type), ['metric', 'chart', 'insights']);
  assert.deepEqual(result.panels[0].data.rows.map(row => [row.Region, row.value, row.baselineValue]), [
    ['North', 170, 100], ['South', 80, 90]
  ]);
  assert.deepEqual(result.panels[1].data.rows.map(row => [row.Region, row.value]), [['North', 170], ['South', 80], ['North', 2], ['South', 1]]);
  assert.deepEqual(result.panels[2].data.rows.map(row => [row.Region, row.severity]), [['South', 'warning']]);
});

test('DashboardSpec definitions serialize and restore with embedded MetricSet, InsightSet, and ChartSpec documents', () => {
  const dashboard = createDashboardSpec({
    title: 'Overview', groupBy: ['Region'], metricSet: metricSet(), insightSet: insightSet(),
    panels: [
      { id: 'kpi', type: 'metric', metricId: 'revenue', layout: { x: 0, y: 0, w: 3, h: 1 } },
      { id: 'chart', type: 'chart', source: 'metrics', chart: createChartSpec({ type: 'bar', x: 'Region', y: 'value' }), layout: { x: 3, y: 0, w: 9, h: 2 } },
      { id: 'findings', type: 'insights', layout: { x: 0, y: 2, w: 12, h: 2 } }
    ]
  });
  const document = JSON.parse(JSON.stringify(dashboard));
  assert.equal(document.version, 1);
  assert.equal(document.dashboard.metricSet.version, 1);
  assert.equal(document.dashboard.insightSet.version, 1);
  assert.equal(document.dashboard.panels[1].chart.version, 1);
  const restored = DashboardSpec.fromJSON(document);
  assert.deepEqual(restored.definition, dashboard.definition);
  assert.deepEqual(JSON.stringify(restored.prepare(current)), JSON.stringify(dashboard.prepare(current)));
});

test('ReportSpec creates ordered JSON-serializable snapshots from text, metrics, insights, chart, and table sections', () => {
  const report = createReportSpec({
    title: 'Regional sales report',
    description: 'Weekly summary',
    groupBy: ['Region'],
    metricSet: metricSet(),
    insightSet: insightSet(),
    sections: [
      { id: 'intro', type: 'text', heading: 'Summary', text: 'Performance compared with the prior period.' },
      { id: 'kpis', type: 'metrics', metricIds: ['revenue'] },
      { id: 'findings', type: 'insights', severity: 'warning', limit: 5 },
      { id: 'chart', type: 'chart', source: 'metrics', chart: { type: 'bar', x: 'Region', y: 'value', series: 'metricId' } },
      { id: 'source-table', type: 'table', source: 'dataset', columns: ['Region', 'Revenue'], limit: 2 }
    ]
  });
  const snapshot = report.prepare(current, { baseline, generatedAt: '2026-11-09T10:00:00Z' });
  assert.equal(snapshot.kind, 'reportSnapshot');
  assert.equal(snapshot.generatedAt, '2026-11-09T10:00:00.000Z');
  assert.deepEqual(snapshot.sections.map(section => section.type), ['text', 'metrics', 'insights', 'chart', 'table']);
  assert.equal(snapshot.sections[1].data.rows.length, 2);
  assert.deepEqual(snapshot.sections[1].data.rows.map(row => row.metricId), ['revenue', 'revenue']);
  assert.equal(snapshot.sections[2].data.rows.length, 1);
  assert.equal(snapshot.sections[3].data.rows.length, 4);
  assert.deepEqual(snapshot.sections[4].data.columns, ['Region', 'Revenue']);
  assert.equal(snapshot.sections[4].data.length, 2);
  const serialized = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(serialized.sections[4].data.shape, [2, 2]);
  assert.equal(serialized.sections[4].data.rows[0].Region, 'North');
});

test('ReportSpec definitions round-trip and preserve caller-supplied deterministic generation time', () => {
  const report = createReportSpec({
    title: 'Compact report',
    metricSet: metricSet(),
    sections: [
      { id: 'kpis', type: 'metrics', metricIds: ['revenue'] },
      { id: 'table', type: 'table', columns: ['Region', 'Revenue'] }
    ]
  });
  const document = JSON.parse(JSON.stringify(report));
  const restored = ReportSpec.fromJSON(document);
  assert.deepEqual(restored.definition, report.definition);
  assert.deepEqual(
    JSON.stringify(restored.prepare(current, { generatedAt: new Date('2026-11-09T10:00:00Z') })),
    JSON.stringify(report.prepare(current, { generatedAt: '2026-11-09T10:00:00Z' }))
  );
});

test('ReportSpec table sections default to 100 rows and can read prepared insight data', () => {
  const manyRows = createDataset(Array.from({ length: 105 }, (_, index) => ({
    value: index + 1,
    amount: index === 104 ? 1000 : 1
  })));
  const report = createReportSpec({
    title: 'Outlier report',
    insightSet: createInsightSet([
      { id: 'large-amount', type: 'outlier', column: 'amount', method: 'zscore', thresholds: [{ op: 'gte', value: 3, severity: 'warning' }] }
    ]),
    sections: [
      { id: 'all-values', type: 'table', columns: ['value'] },
      { id: 'findings', type: 'table', source: 'insights' }
    ]
  });
  const result = report.prepare(manyRows);
  assert.equal(result.sections[0].data.length, 100);
  assert.equal(result.sections[1].data.length, 1);
  assert.deepEqual(result.sections[1].data.columns.includes('insightId'), true);
});

test('dashboard and report definitions validate references, dependencies, grids, section types, and options', () => {
  assert.throws(() => createDashboardSpec({ title: 'Empty', panels: [] }), /non-empty panels/);
  assert.throws(() => createDashboardSpec({ title: 'Bad', panels: [{ id: 'x', type: 'chart', chart: { type: 'bar', x: 'a', y: 'b' }, layout: { x: 0, y: 0, w: 3, h: 1 } }], layout: { columns: 2 } }), /exceeds/);
  assert.throws(() => createDashboardSpec({
    title: 'Overlap', panels: [
      { id: 'a', type: 'chart', chart: { type: 'bar', x: 'a', y: 'b' }, layout: { x: 0, y: 0, w: 3, h: 2 } },
      { id: 'b', type: 'chart', chart: { type: 'bar', x: 'a', y: 'b' }, layout: { x: 2, y: 1, w: 3, h: 2 } }
    ]
  }), /overlap/);
  assert.throws(() => createDashboardSpec({
    title: 'Unknown KPI', metricSet: metricSet(),
    panels: [{ id: 'kpi', type: 'metric', metricId: 'missing', layout: { x: 0, y: 0, w: 3, h: 1 } }]
  }), /unknown metric/);
  assert.throws(() => createDashboardSpec({
    title: 'No insights', panels: [{ id: 'i', type: 'insights', layout: { x: 0, y: 0, w: 3, h: 1 } }]
  }), /requires an InsightSet/);
  assert.throws(() => DashboardSpec.fromJSON({ dashboard: { title: 'x', panels: [{ id: 'x', type: 'chart', chart: { type: 'bar', x: 'a', y: 'b' }, layout: { x: 0, y: 0, w: 1, h: 1 } }] } }), /version 1 document/);

  assert.throws(() => createReportSpec({ title: 'Empty', sections: [] }), /non-empty sections/);
  assert.throws(() => createReportSpec({ title: 'Unknown metric', metricSet: metricSet(), sections: [{ id: 'metrics', type: 'metrics', metricIds: ['missing'] }] }), /unknown metric/);
  assert.throws(() => createReportSpec({ title: 'Unknown section', sections: [{ id: 'bad', type: 'image' }] }), /type must be/);
  assert.throws(() => createReportSpec({ title: 'Bad table', sections: [{ id: 'table', type: 'table', columns: [] }] }), /must not be empty/);
  assert.throws(() => createReportSpec({ title: 'Bad generatedAt', sections: [{ id: 'text', type: 'text', text: 'hello' }] }).prepare(current, { generatedAt: 'not-a-date' }), /valid Date or date string/);
  assert.throws(() => ReportSpec.fromJSON({ report: { title: 'x', sections: [{ id: 'text', type: 'text', text: 'y' }] } }), /version 1 document/);
  assert.equal(createReportSpec({ title: 'Chart source', sections: [{ id: 'chart', type: 'chart', chart: createChartSpec({ type: 'scatter', x: 'x', y: 'y' }) }] }).sections[0].chart.version, 1);
  assert.equal(ChartSpec.fromJSON(createChartSpec({ type: 'scatter', x: 'x', y: 'y' }).toJSON()).chart.type, 'scatter');
});
