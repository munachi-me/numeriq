import {
  createChartSpec,
  createDashboardSpec,
  createDataset,
  createInsightSet,
  createMetricSet,
  createPipeline,
  createQuery,
  createReportSpec,
  loadCSV,
  loadMany,
  useSampleDataset
} from '../../src/index.js';

// Edit this file to experiment with Numeriq. `npm run dev` reruns it on save.
const sales = await loadCSV('sales.csv');
console.log('LOCAL 25-ROW SALES DATASET');
console.log(sales);
console.log('IMPORT REPORT:', sales.importReport);
console.log('COLUMN PROFILE:', sales.profile());

const sampleTSV = await useSampleDataset('tsv');
console.log('BUNDLED TSV SAMPLE SHAPE:', sampleTSV.shape);

const combined = await loadMany(['sales.csv', 'sales.csv'], { deduplicateBy: ['Transaction_ID'] });
console.log('MULTI-SOURCE IMPORT WITH DUPLICATE REMOVAL:', combined.importReport);

const pipeline = createPipeline([
  { op: 'extractDatePart', column: 'Date', part: 'monthName', options: { as: 'Month' } },
  { op: 'extractDatePart', column: 'Date', part: 'weekday', options: { as: 'Weekday', nameLength: 'short' } },
  { op: 'roundColumn', column: 'Total_Amount', precision: 2 },
  { op: 'flagOutliers', column: 'Total_Amount', options: { as: 'Amount_Outlier' } },
  { op: 'query', query: {
    where: { op: 'and', args: [
      { op: 'eq', column: 'Category', value: 'Electronics' },
      { op: 'gte', column: 'Total_Amount', value: 100 }
    ] },
    orderBy: [{ column: 'Date', direction: 'desc' }, { column: 'Total_Amount', direction: 'desc' }],
    select: ['Date', 'Weekday', 'Month', 'Product', 'Total_Amount', 'Amount_Outlier'],
    limit: 8
  } }
]);
const { dataset: preparedSales, summary } = pipeline.run(sales);
console.log('PIPELINE RESULT (FIRST 8 ROWS)');
console.log(preparedSales.head(8));
console.log('TRANSFORMATION SUMMARY:', summary);
console.log('SERIALIZED PIPELINE:', JSON.stringify(pipeline));

const lowValueQuery = createQuery({
  where: { op: 'lt', column: 'Total_Amount', value: 100 },
  orderBy: [{ column: 'Total_Amount', direction: 'asc' }],
  select: ['Product', 'Category', 'Total_Amount'],
  limit: 5
});
console.log('REUSABLE QUERY:', lowValueQuery.run(sales));

const amountSeries = sales.column('Total_Amount');
console.log('ADVANCED AMOUNT STATISTICS:', {
  q1: sales.quantile('Total_Amount', 0.25),
  p90: sales.percentile('Total_Amount', 90),
  quartiles: sales.quartiles('Total_Amount'),
  iqr: amountSeries.iqr(),
  mad: amountSeries.mad(),
  skewness: amountSeries.skewness(),
  excessKurtosis: amountSeries.kurtosis()
});
console.log('QUANTITY / AMOUNT PEARSON CORRELATION:', sales.correlation('Quantity', 'Total_Amount'));

const advancedByCategory = sales.groupBy('Category').agg([
  { op: 'quantile', column: 'Total_Amount', q: 0.9, as: 'p90 amount' },
  { op: 'iqr', column: 'Total_Amount' },
  { op: 'mad', column: 'Total_Amount' },
  { op: 'skewness', column: 'Total_Amount' },
  { op: 'kurtosis', column: 'Total_Amount' }
]);
console.log('ADVANCED GROUPED STATISTICS:');
console.log(advancedByCategory);

const scoredSales = sales.zScore('Total_Amount', { as: 'Amount_Zscore' })
  .flagOutliers('Total_Amount', { method: 'modifiedZScore', as: 'Robust_Amount_Outlier' });
console.log('STANDARDIZED AND ROBUST OUTLIER SAMPLE:');
console.log(scoredSales.select('Transaction_ID', 'Total_Amount', 'Amount_Zscore', 'Robust_Amount_Outlier').head(5));

const salesSummaryPipeline = createPipeline([
  { op: 'extractDatePart', column: 'Date', part: 'year', options: { as: 'Year' } },
  { op: 'extractDatePart', column: 'Date', part: 'month', options: { as: 'Month' } },
  { op: 'addCalculatedColumn', name: 'Unit_Price', expression: {
    op: 'divide', args: [{ column: 'Total_Amount' }, { column: 'Quantity' }]
  } },
  { op: 'addConditionalColumn', name: 'Order_Size',
    condition: { op: 'gte', column: 'Total_Amount', value: 300 },
    then: { literal: 'large' }, else: { literal: 'standard' } },
  { op: 'addCaseColumn', name: 'Price_Band', cases: [
    { when: { op: 'gte', column: 'Unit_Price', value: 200 }, then: { literal: 'premium' } },
    { when: { op: 'gte', column: 'Unit_Price', value: 50 }, then: { literal: 'mid-range' } }
  ], default: { literal: 'value' } },
  { op: 'zScore', column: 'Total_Amount', options: { as: 'Amount_Zscore' } },
  { op: 'groupBy', columns: ['Year', 'Month', 'Category'], aggregations: [
    { op: 'countRows' },
    { op: 'sum', column: 'Total_Amount', as: 'Revenue' },
    { op: 'mean', column: 'Total_Amount', name: 'Average Order Value' },
    { op: 'nunique', column: 'Product' }
  ] }
]);
const { dataset: monthlySales, summary: salesSummary } = salesSummaryPipeline.run(sales);
console.log('MONTHLY SALES BY CATEGORY (V0.5 GROUPING)');
console.log(monthlySales);
console.log('V0.5 COLUMN + AGGREGATION PIPELINE SUMMARY:', salesSummary);
console.log('SERIALIZED SALES SUMMARY PIPELINE:', JSON.stringify(salesSummaryPipeline));

const raw = createDataset([
  { customer: 'Ada', visits: '3', region: 'North' },
  { customer: 'Lin', visits: null, region: 'South' },
  { customer: 'Ada', visits: '3', region: 'North' },
  { customer: null, visits: 'invalid', region: 'West' }
], { normalization: { inferTypes: false } });
const cleaned = raw
  .dropMissing({ columns: ['customer'] })
  .fillMissing('visits', '0')
  .castColumn('visits', 'integer', { errors: 'coerce' })
  .dropDuplicates('customer');
console.log('PROFILE BEFORE CLEANING:', raw.profile());
console.log('CLEANED DATA');
console.log(cleaned);


// v0.7.0 KPI scorecard: compare the first and second parts of the bundled
// chronologically ordered sample as baseline and current-period cohorts.
const baselineSales = sales.head(12);
const currentSales = sales.tail(sales.length - baselineSales.length);
const salesKpis = createMetricSet([
  {
    id: 'revenue',
    label: 'Revenue',
    unit: 'USD',
    aggregation: { op: 'sum', column: 'Total_Amount' },
    target: { on: 'percentChange', op: 'gte', value: 0 }
  },
  {
    id: 'transactions',
    label: 'Transactions',
    aggregation: { op: 'countRows' },
    target: { op: 'gte', value: 8 }
  },
  {
    id: 'averageOrderValue',
    label: 'Average order value',
    unit: 'USD/order',
    formula: { op: 'divide', args: [{ metric: 'revenue' }, { metric: 'transactions' }] }
  }
]);
const salesScorecard = salesKpis.evaluate(currentSales, {
  baseline: baselineSales,
  groupBy: ['Category']
});
console.log('V0.7 KPI SCORECARD BY CATEGORY (WITH BASELINE COMPARISON)');
console.log(salesScorecard);
console.log('SERIALIZED METRIC DEFINITIONS:', JSON.stringify(salesKpis));


// v0.8.0 deterministic insights with user-configurable threshold bands.
const salesInsights = createInsightSet([
  {
    id: 'missed-transaction-goal',
    type: 'targetMissed',
    metricId: 'transactions',
    severity: 'warning'
  },
  {
    id: 'high-revenue-band',
    type: 'metricThreshold',
    metricId: 'revenue',
    thresholds: [
      { on: 'value', op: 'gte', value: 500, severity: 'warning' },
      { on: 'value', op: 'gte', value: 1400, severity: 'critical' }
    ]
  },
  {
    id: 'unusual-order-amount',
    type: 'outlier',
    column: 'Total_Amount',
    method: 'iqr',
    thresholds: [
      { op: 'gte', value: 1.5, severity: 'warning' },
      { op: 'gte', value: 3, severity: 'critical' }
    ]
  }
]);
const salesFindings = salesInsights.evaluate(currentSales, {
  metricSet: salesKpis,
  baseline: baselineSales,
  groupBy: ['Category']
});
console.log('V0.8 EXPLAINABLE SALES INSIGHTS');
console.log(salesFindings.head(10));
console.log('SERIALIZED INSIGHT RULES:', JSON.stringify(salesInsights));


// v0.9.0 renderer-neutral chart specs and chart-ready Dataset preparation.
const revenueChartSpec = createChartSpec({
  type: 'bar',
  x: 'Category',
  y: 'Total_Amount',
  series: 'Product',
  title: 'Revenue by category and product',
  xLabel: 'Category',
  yLabel: 'Revenue (USD)',
  aggregate: { op: 'sum' },
  sort: { by: 'y', direction: 'desc' },
  options: { legend: true, grid: true, stacked: true }
});
const revenueChartData = revenueChartSpec.prepare(sales);
console.log('V0.9 BAR CHART SPEC:', JSON.stringify(revenueChartSpec));
console.log('V0.9 CHART-READY REVENUE DATA:');
console.log(revenueChartData.head(8));

const quantityRevenueScatter = createChartSpec({
  type: 'scatter',
  x: 'Quantity',
  y: 'Total_Amount',
  series: 'Category',
  title: 'Order quantity vs. amount',
  options: { legend: true, pointSize: 3, grid: true }
});
console.log('V0.9 SCATTER CHART DATA:');
console.log(quantityRevenueScatter.prepare(sales).head(8));


// v0.10.0 composes existing scorecards, insights, and chart specs without a renderer.
const salesDashboardSpec = createDashboardSpec({
  title: 'Sales performance',
  description: 'Category KPIs and actionable findings',
  groupBy: ['Category'],
  metricSet: salesKpis,
  insightSet: salesInsights,
  layout: { columns: 12 },
  panels: [
    { id: 'revenue-kpi', type: 'metric', metricId: 'revenue', layout: { x: 0, y: 0, w: 3, h: 1 } },
    {
      id: 'kpi-chart', type: 'chart', source: 'metrics',
      chart: { type: 'bar', x: 'Category', y: 'value', series: 'metricId', title: 'Category KPIs' },
      layout: { x: 3, y: 0, w: 6, h: 4 }
    },
    { id: 'warnings', type: 'insights', severity: 'warning', limit: 10, layout: { x: 9, y: 0, w: 3, h: 4 } }
  ]
});
const salesDashboardData = salesDashboardSpec.prepare(currentSales, { baseline: baselineSales });
console.log('V0.10 DASHBOARD SPEC:', JSON.stringify(salesDashboardSpec));
console.log('V0.10 PREPARED DASHBOARD PANELS:', salesDashboardData.panels.map(panel => ({ id: panel.id, type: panel.type, rows: panel.data.length })));

const salesReportSpec = createReportSpec({
  title: 'Weekly sales report',
  description: 'KPI, insight, and source-data snapshot',
  groupBy: ['Category'],
  metricSet: salesKpis,
  insightSet: salesInsights,
  sections: [
    { id: 'summary', type: 'text', heading: 'Summary', text: 'Review category performance against the prior cohort.' },
    { id: 'kpis', type: 'metrics', metricIds: ['revenue', 'transactions'] },
    { id: 'warnings', type: 'insights', severity: 'warning', limit: 10 },
    {
      id: 'category-chart', type: 'chart', source: 'metrics',
      chart: { type: 'bar', x: 'Category', y: 'value', series: 'metricId', title: 'Category KPIs' }
    },
    { id: 'source-rows', type: 'table', source: 'dataset', columns: ['Category', 'Product', 'Total_Amount'], limit: 5 }
  ]
});
const salesReportSnapshot = salesReportSpec.prepare(currentSales, { baseline: baselineSales });
console.log('V0.10 REPORT SPEC:', JSON.stringify(salesReportSpec));
console.log('V0.10 JSON REPORT SNAPSHOT BYTES:', Buffer.byteLength(JSON.stringify(salesReportSnapshot), 'utf8'));

// V0.11: Analysis engine — fluent builder, aggregations, composable results
const monthlyAnalysis = currentSales.analyze()
  .groupBy('Category')
  .sum('Total_Amount', { as: 'totalRevenue' })
  .mean('Total_Amount', { as: 'averageOrder' })
  .countRows({ as: 'orders' })
  .orderBy('totalRevenue', 'desc')
  .execute();
console.log('V0.11 FLUENT ANALYSIS (AnalysisResult):');
console.log(monthlyAnalysis.table());

const bigOrders = currentSales.analyze()
  .where({ op: 'gte', column: 'Total_Amount', value: 100 })
  .groupBy('Category')
  .sum('Total_Amount', { as: 'bigRevenue', where: { op: 'gte', column: 'Total_Amount', value: 200 } })
  .having({ op: 'gt', column: 'bigRevenue', value: 0 })
  .execute();
console.log('V0.11 CONDITIONAL AGGREGATION:', bigOrders.rows);

console.log('V0.11 GLOBAL SUMMARY:', currentSales.analyze()
  .sum('Total_Amount', { as: 'grandTotal' })
  .countRows({ as: 'orders' })
  .execute().rows);

console.log('V0.11 LINEAGE:', JSON.stringify(monthlyAnalysis.lineage()));
console.log('V0.11 SCALAR PRESERVED: sum =', currentSales.sum('Total_Amount'), '| mean =', currentSales.mean('Total_Amount'));

// V0.12: Joins and relationships — combine datasets as naturally as SQL
const salesWithCustomer = currentSales.addColumn('customerId', row => (row.Transaction_ID % 3) + 1);
const customers = [
  { customerId: 1, name: 'Ada', tier: 'gold' },
  { customerId: 2, name: 'Bo', tier: 'silver' },
  { customerId: 3, name: 'Cy', tier: 'bronze' }
];
const enriched = salesWithCustomer.leftJoin(customers, { on: 'customerId', suffixes: ['_sales', '_cust'] });
console.log('V0.12 LEFT JOIN WITH SUFFIXES:');
console.log(enriched.table());

const lookup = createDataset([
  { tier: 'gold', perks: 'priority support' },
  { tier: 'silver', perks: 'email support' },
  { tier: 'bronze', perks: 'community support' }
]);
const withPerks = enriched.analyze()
  .where({ op: 'isNotNull', column: 'tier' })
  .groupBy('tier')
  .sum('Total_Amount', { as: 'revenue' })
  .execute()
  .innerJoin(lookup, { on: 'tier', validate: 'one-to-one' });
console.log('V0.12 COMPOSED JOIN + ANALYSIS CHAIN:', withPerks.rows);

console.log('V0.12 MANY-TO-ONE VALIDATION OK:', salesWithCustomer.join(
  createDataset(customers.map(c => ({ customerId: c.customerId, tier: c.tier }))),
  { on: 'customerId', how: 'inner', validate: 'many-to-one' }
).length, 'rows matched');
