/**
 * Type declarations for Numeriq v0.11.0 — public API surface.
 * The runtime remains plain JavaScript; these declarations are for editor
 * and TypeScript consumer support only.
 */

export interface ColumnSchema {
  name: string;
  type: 'integer' | 'number' | 'string' | 'boolean' | 'date' | 'datetime' | 'time' | 'mixed' | 'unknown';
  nullable: boolean;
}

export type Row = Record<string, unknown>;

export type ConditionOperator =
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'notIn' | 'contains' | 'startsWith' | 'endsWith'
  | 'isNull' | 'isNotNull' | 'and' | 'or' | 'not';

export interface Condition {
  op: ConditionOperator;
  column?: string;
  value?: unknown;
  args?: Condition[];
  caseSensitive?: boolean;
}

export interface AggregationDescriptor {
  op:
    | 'countRows' | 'count' | 'nunique' | 'sum' | 'mean' | 'average' | 'median'
    | 'min' | 'max' | 'range' | 'variance' | 'std' | 'stddev'
    | 'quantile' | 'percentile' | 'quartiles' | 'iqr' | 'mad' | 'skewness' | 'kurtosis';
  column?: string;
  as?: string;
  name?: string;
  alias?: string;
  ddof?: number;
  q?: number;
  p?: number;
  method?: 'linear' | 'lower' | 'higher' | 'midpoint' | 'nearest';
  where?: Condition;
}

export type AggregationSpecification =
  | AggregationDescriptor[]
  | Record<string, AggregationDescriptor>;

export interface AnalysisDocumentStep {
  kind: 'select' | 'where' | 'having' | 'group' | 'aggregation' | 'orderBy' | 'distinct' | 'limit' | 'offset';
  [key: string]: unknown;
}

export interface AnalysisDocument {
  version: number;
  source?: string;
  steps: AnalysisDocumentStep[];
}

export interface Lineage {
  source: string;
  sourceId?: string;
  createdAt?: string;
  operation: string;
  version?: number;
  steps?: unknown[];
}

export class AnalysisResult {
  static create(rows: Row[], columns?: string[], options?: { lineage?: Lineage }): AnalysisResult;
  get rows(): Row[];
  get columns(): string[];
  get shape(): [number, number];
  get ndim(): 2;
  get length(): number;
  get size(): number;
  get empty(): boolean;
  get index(): number[];
  get dtypes(): Record<string, ColumnSchema['type']>;
  get schema(): Record<string, ColumnSchema>;
  head(n?: number): AnalysisResult;
  tail(n?: number): AnalysisResult;
  select(...columns: string[]): AnalysisResult;
  filter(predicate: ((row: Row, index: number) => boolean) | Condition): AnalysisResult;
  sort(column: string, direction?: 'asc' | 'desc'): AnalysisResult;
  sortBy(column: string, direction?: 'asc' | 'desc'): AnalysisResult;
  limit(count: number): AnalysisResult;
  distinct(...columns: string[]): AnalysisResult;
  count(column?: string): number;
  groupBy(...columns: string[]): GroupedDataset;
  agg(specification: AggregationSpecification): AnalysisResult;
  aggregate(specification: AggregationSpecification): AnalysisResult;
  analyze(): AnalysisBuilder;
  lineage(): Lineage | null;
  history(): Lineage | null;
  toJSON(): { columns: string[]; shape: [number, number]; rows: Row[] };
  toArray(): Row[];
  table(options?: TableOptions): string;
  toTable(options?: TableOptions): string;
  display(options?: TableOptions): this;
  print(options?: TableOptions): this;
}

export class AnalysisBuilder {
  select(...columns: string[]): this;
  where(condition: Condition | ((row: Row, index: number) => boolean)): this;
  filter(condition: Condition | ((row: Row, index: number) => boolean)): this;
  groupBy(...columns: string[]): this;
  having(condition: Condition | ((row: Row) => boolean)): this;
  orderBy(column: string, direction?: 'asc' | 'desc'): this;
  sort(column: string, direction?: 'asc' | 'desc'): this;
  sortBy(column: string, direction?: 'asc' | 'desc'): this;
  limit(count: number): this;
  offset(count: number): this;
  distinct(...columns: string[]): this;
  sum(column: string, options?: AggregationOptions): this;
  mean(column: string, options?: AggregationOptions): this;
  average(column: string, options?: AggregationOptions): this;
  median(column: string, options?: AggregationOptions): this;
  min(column: string, options?: AggregationOptions): this;
  max(column: string, options?: AggregationOptions): this;
  count(column?: string, options?: AggregationOptions): this;
  countRows(options?: AggregationOptions): this;
  nunique(column: string, options?: AggregationOptions): this;
  variance(column: string, options?: AggregationOptions): this;
  std(column: string, options?: AggregationOptions): this;
  stddev(column: string, options?: AggregationOptions): this;
  range(column: string, options?: AggregationOptions): this;
  quantile(column: string, q: number, options?: AggregationOptions): this;
  percentile(column: string, p: number, options?: AggregationOptions): this;
  quartiles(column: string, options?: AggregationOptions): this;
  iqr(column: string, options?: AggregationOptions): this;
  mad(column: string, options?: AggregationOptions): this;
  skewness(column: string, options?: AggregationOptions): this;
  kurtosis(column: string, options?: AggregationOptions): this;
  agg(specification: AggregationSpecification): this;
  aggregate(specification: AggregationSpecification): this;
  execute(): AnalysisResult;
  toJSON(): AnalysisDocument;
  static fromJSON(document: AnalysisDocument, rows: Row[], columns: string[]): AnalysisBuilder;
}

export interface AggregationOptions {
  as?: string;
  ddof?: number;
  q?: number;
  p?: number;
  method?: 'linear' | 'lower' | 'higher' | 'midpoint' | 'nearest';
  where?: Condition;
}

export class Dataset {
  constructor(rows: Row[], options?: DatasetOptions);
  get length(): number;
  get columns(): string[];
  get rows(): Row[];
  get shape(): [number, number];
  get ndim(): 2;
  get size(): number;
  get empty(): boolean;
  get index(): number[];
  get dtypes(): Record<string, ColumnSchema['type']>;
  get schema(): Record<string, ColumnSchema>;
  id: string;
  name: string;
  metadata: Readonly<Record<string, unknown>>;
  importReport: Readonly<Record<string, unknown>> | null;
  createdAt: Date;
  head(n?: number): Dataset;
  tail(n?: number): Dataset;
  preview(n?: number): Dataset;
  info(): Record<string, unknown>;
  describe(column?: string): Record<string, unknown> | Dataset;
  profile(options?: { topValues?: number }): Record<string, unknown>;
  column(name: string): Series;
  select(...columns: string[]): Dataset;
  dropColumns(...columns: string[]): Dataset;
  reorderColumns(...columns: string[]): Dataset;
  renameColumn(oldName: string, newName: string): Dataset;
  renameColumns(mapping: Record<string, string>): Dataset;
  filter(predicate: (row: Row, index: number) => boolean): Dataset;
  sortBy(column: string, direction?: 'asc' | 'desc'): Dataset;
  limit(count: number): Dataset;
  groupBy(...columns: string[]): GroupedDataset;
  analyze(): AnalysisBuilder;
  query(document: QueryDocument): AnalysisResult;
  toAnalysisResult(): AnalysisResult;
  addColumn(name: string, valueOrFunction: unknown): Dataset;
  addCalculatedColumn(name: string, expression: unknown): Dataset;
  addConditionalColumn(name: string, condition: Condition, thenValue: unknown, elseValue: unknown): Dataset;
  addCaseColumn(name: string, cases: Array<{ when: Condition; then: unknown }>, defaultValue?: unknown): Dataset;
  mapRows(mapper: (row: Row, index: number) => Row): Dataset;
  dropDuplicates(...columns: string[]): Dataset;
  dropMissing(options?: { columns?: string[] | string; how?: 'any' | 'all' }): Dataset;
  fillMissing(column: string, valueOrFunction: unknown): Dataset;
  splitColumn(column: string, options?: SplitColumnOptions): Dataset;
  combineColumns(name: string, columns: string[] | string, options?: CombineColumnsOptions): Dataset;
  replaceText(column: string, search: string, replacement: string, options?: ReplaceTextOptions): Dataset;
  trimColumn(column: string, options?: { side?: 'both' | 'start' | 'end' }): Dataset;
  changeCase(column: string, mode?: 'lower' | 'upper' | 'title'): Dataset;
  updateColumnWhere(column: string, predicate: (row: Row, index: number) => boolean, valueOrFunction: unknown): Dataset;
  roundColumn(column: string, precision?: number): Dataset;
  flagOutliers(column: string, options?: FlagOutliersOptions): Dataset;
  extractDatePart(column: string, part: 'day' | 'weekday' | 'week' | 'month' | 'monthName' | 'quarter' | 'year', options?: { as?: string }): Dataset;
  castColumn(column: string, type: string, options?: { errors?: 'throw' | 'coerce'; format?: string }): Dataset;
  unique(column: string): unknown[];
  nunique(column: string): number;
  clone(): Dataset;
  count(column?: string): number;
  sum(column: string): number | null;
  mean(column: string): number | null;
  median(column: string): number | null;
  min(column: string): number | null;
  max(column: string): number | null;
  range(column: string): number | null;
  variance(column: string, ddof?: number): number | null;
  std(column: string, ddof?: number): number | null;
  quantile(column: string, q: number, options?: QuantileOptions): number | null;
  percentile(column: string, p: number, options?: QuantileOptions): number | null;
  quartiles(column: string, options?: QuantileOptions): { q1: number | null; median: number | null; q3: number | null };
  iqr(column: string, options?: QuantileOptions): number | null;
  mad(column: string): number | null;
  skewness(column: string): number | null;
  kurtosis(column: string): number | null;
  covariance(leftColumn: string, rightColumn: string, options?: { ddof?: number }): number | null;
  correlation(leftColumn: string, rightColumn: string, options?: { method?: 'pearson' | 'spearman' }): number | null;
  zScore(column: string, options?: { as?: string; ddof?: number }): Dataset;
  modifiedZScore(column: string, options?: { as?: string }): Dataset;
  toJSON(): Record<string, unknown>;
  toTable(options?: TableOptions): string;
  display(options?: TableOptions): this;
  print(options?: TableOptions): this;
}

export interface DatasetOptions {
  columns?: string[];
  name?: string;
  id?: string;
  metadata?: Record<string, unknown>;
  importReport?: Record<string, unknown> | null;
  normalization?: NormalizationOptions;
}

export interface NormalizationOptions {
  trimStrings?: boolean;
  emptyStringAsNull?: boolean;
  inferTypes?: boolean;
  missingValues?: string[] | string;
}

export interface SplitColumnOptions {
  delimiter?: string;
  into?: string[];
  dropOriginal?: boolean;
  trim?: boolean;
}
export interface CombineColumnsOptions {
  separator?: string;
  skipMissing?: boolean;
  dropSource?: boolean;
}
export interface ReplaceTextOptions {
  caseSensitive?: boolean;
  all?: boolean;
}
export interface FlagOutliersOptions {
  method?: 'iqr' | 'zscore' | 'modifiedZScore';
  factor?: number;
  threshold?: number;
  ddof?: number;
  as?: string;
}
export interface QuantileOptions {
  method?: 'linear' | 'lower' | 'higher' | 'midpoint' | 'nearest';
}
export interface TableOptions {
  maxRows?: number;
  maxColumns?: number;
  maxCellWidth?: number;
  showIndex?: boolean;
}

export class GroupedDataset {
  get keys(): string[];
  agg(specification: AggregationSpecification): Dataset | AnalysisResult;
  aggregate(specification: AggregationSpecification): Dataset | AnalysisResult;
}

export class Series {
  constructor(name: string, values: unknown[]);
  get name(): string;
  get values(): unknown[];
  get length(): number;
  count(): number;
  sum(): number | null;
  mean(): number | null;
  median(): number | null;
  min(): number | null;
  max(): number | null;
  variance(ddof?: number): number | null;
  std(ddof?: number): number | null;
  quantile(q: number, options?: QuantileOptions): number | null;
  percentile(value: number, options?: QuantileOptions): number | null;
  quartiles(options?: QuantileOptions): { q1: number | null; median: number | null; q3: number | null };
  iqr(options?: QuantileOptions): number | null;
  mad(): number | null;
  skewness(): number | null;
  kurtosis(): number | null;
  covariance(other: Series | unknown[], options?: { ddof?: number }): number | null;
  correlation(other: Series | unknown[], options?: { method?: 'pearson' | 'spearman' }): number | null;
  zScores(options?: { as?: string; ddof?: number }): Series;
  modifiedZScores(options?: { as?: string }): Series;
  describe(): Record<string, unknown>;
  toTable(): string;
  display(): this;
}

export class Query {
  constructor(document?: QueryDocument);
  get document(): QueryDocument;
  toJSON(): QueryDocument;
  static fromJSON(document: QueryDocument): Query;
  run(dataset: Dataset): Dataset;
}

export interface QueryDocument {
  version?: number;
  where?: Condition;
  select?: string[];
  orderBy?: Array<{ column: string; direction?: 'asc' | 'desc' }>;
  offset?: number;
  limit?: number;
}

export function createDataset(data: Row[] | Record<string, unknown[]> | Dataset, options?: DatasetOptions): Dataset;
export function createQuery(document?: QueryDocument): Query;

export function sum(column: string, options?: AggregationOptions): AggregationDescriptor;
export function mean(column: string, options?: AggregationOptions): AggregationDescriptor;
export function average(column: string, options?: AggregationOptions): AggregationDescriptor;
export function median(column: string, options?: AggregationOptions): AggregationDescriptor;
export function min(column: string, options?: AggregationOptions): AggregationDescriptor;
export function max(column: string, options?: AggregationOptions): AggregationDescriptor;
export function count(column?: string, options?: AggregationOptions): AggregationDescriptor;
export function countRows(options?: AggregationOptions): AggregationDescriptor;
export function nunique(column: string, options?: AggregationOptions): AggregationDescriptor;
export function variance(column: string, options?: AggregationOptions): AggregationDescriptor;
export function std(column: string, options?: AggregationOptions): AggregationDescriptor;
export function stddev(column: string, options?: AggregationOptions): AggregationDescriptor;
export function range(column: string, options?: AggregationOptions): AggregationDescriptor;
export function quantile(column: string, q: number, options?: AggregationOptions): AggregationDescriptor;
export function percentile(column: string, p: number, options?: AggregationOptions): AggregationDescriptor;
export function quartiles(column: string, options?: AggregationOptions): AggregationDescriptor;
export function iqr(column: string, options?: AggregationOptions): AggregationDescriptor;
export function mad(column: string, options?: AggregationOptions): AggregationDescriptor;
export function skewness(column: string, options?: AggregationOptions): AggregationDescriptor;
export function kurtosis(column: string, options?: AggregationOptions): AggregationDescriptor;

export class NumeriqError extends Error {
  code: string;
  constructor(message: string, code?: string);
}
export class ValidationError extends NumeriqError {
  constructor(message: string);
}

export function renderTable(rows: Row[], columns: string[], options?: TableOptions): string;

export function parseCSV(text: string, options?: Record<string, unknown>): Promise<Dataset>;
export function parseJSON(text: string, options?: Record<string, unknown>): Promise<Dataset>;
export function loadCSV(path: string, options?: Record<string, unknown>): Promise<Dataset>;
export function loadJSON(path: string, options?: Record<string, unknown>): Promise<Dataset>;
export function loadData(path: string, options?: Record<string, unknown>): Promise<Dataset>;
export function loadMany(paths: string[], options?: Record<string, unknown>): Promise<Dataset[]>;
export function useSampleDataset(name?: string, options?: Record<string, unknown>): Promise<Dataset>;

export { MetricSet, createMetricSet, InsightSet, createInsightSet, ChartSpec, createChartSpec,
         DashboardSpec, createDashboardSpec, ReportSpec, createReportSpec,
         TransformationPipeline, createPipeline } from './src/index.js';

declare const Numeriq: {
  Dataset: typeof Dataset;
  createDataset: typeof createDataset;
  GroupedDataset: typeof GroupedDataset;
  AnalysisResult: typeof AnalysisResult;
  AnalysisBuilder: typeof AnalysisBuilder;
  Query: typeof Query;
  createQuery: typeof createQuery;
  Series: typeof Series;
  sum: typeof sum; mean: typeof mean; average: typeof average; median: typeof median;
  min: typeof min; max: typeof max; count: typeof count; countRows: typeof countRows;
  nunique: typeof nunique; variance: typeof variance; std: typeof std; stddev: typeof stddev;
  range: typeof range; quantile: typeof quantile; percentile: typeof percentile;
  quartiles: typeof quartiles; iqr: typeof iqr; mad: typeof mad;
  skewness: typeof skewness; kurtosis: typeof kurtosis;
  parseCSV: typeof parseCSV; parseJSON: typeof parseJSON;
  loadCSV: typeof loadCSV; loadJSON: typeof loadJSON; loadData: typeof loadData;
  loadMany: typeof loadMany; useSampleDataset: typeof useSampleDataset;
  renderTable: typeof renderTable;
  NumeriqError: typeof NumeriqError;
  ValidationError: typeof ValidationError;
  statistics: Record<string, (...args: unknown[]) => unknown>;
};
export default Numeriq;
