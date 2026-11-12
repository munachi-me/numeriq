import { Dataset, createDataset } from './dataset/dataset.js';
import { GroupedDataset } from './dataset/grouping.js';
import { AnalysisResult } from './dataset/analysis-result.js';
import { AnalysisBuilder } from './dataset/analysis.js';
import { MetricSet, createMetricSet } from './dataset/metrics.js';
import { InsightSet, createInsightSet } from './dataset/insights.js';
import { ChartSpec, createChartSpec } from './dataset/charts.js';
import { DashboardSpec, createDashboardSpec } from './dataset/dashboard.js';
import { ReportSpec, createReportSpec } from './dataset/report.js';
import { TransformationPipeline, createPipeline } from './dataset/pipeline.js';
import { Query, createQuery } from './dataset/query.js';
import { Series } from './dataset/series.js';
import {
  sum, mean, average, median, min, max, count, countRows, nunique, variance, std, stddev,
  range, quantile, percentile, quartiles, iqr, mad, skewness, kurtosis
} from './dataset/aggregation-helpers.js';
import { parseCSV, parseJSON } from './io/index.js';
import { loadCSV, loadJSON, loadData, loadMany, useSampleDataset } from './io/index.js';
import { renderTable } from './display/table.js';
import { NumeriqError, ValidationError } from './errors/index.js';
import * as statistics from './stats/descriptive.js';

export {
  Dataset, createDataset, GroupedDataset, AnalysisResult, AnalysisBuilder,
  MetricSet, createMetricSet, InsightSet, createInsightSet, ChartSpec, createChartSpec,
  DashboardSpec, createDashboardSpec, ReportSpec, createReportSpec,
  TransformationPipeline, createPipeline, Query, createQuery, Series,
  sum, mean, average, median, min, max, count, countRows, nunique, variance, std, stddev,
  range, quantile, percentile, quartiles, iqr, mad, skewness, kurtosis,
  parseCSV, parseJSON, loadCSV, loadJSON, loadData, loadMany, useSampleDataset,
  renderTable, NumeriqError, ValidationError, statistics
};

/** Default namespace: `import Numeriq from 'numeriq'` mirrors the named exports. */
const Numeriq = {
  Dataset, createDataset, GroupedDataset, AnalysisResult, AnalysisBuilder,
  MetricSet, createMetricSet, InsightSet, createInsightSet, ChartSpec, createChartSpec,
  DashboardSpec, createDashboardSpec, ReportSpec, createReportSpec,
  TransformationPipeline, createPipeline, Query, createQuery, Series,
  sum, mean, average, median, min, max, count, countRows, nunique, variance, std, stddev,
  range, quantile, percentile, quartiles, iqr, mad, skewness, kurtosis,
  parseCSV, parseJSON, loadCSV, loadJSON, loadData, loadMany, useSampleDataset,
  renderTable, NumeriqError, ValidationError, statistics
};

export default Numeriq;
