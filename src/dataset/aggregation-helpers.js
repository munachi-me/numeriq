import { ValidationError } from '../errors/index.js';

/**
 * Aggregation helper functions for readable agg() specifications and the
 * fluent analysis builder:
 *
 *   sales.groupBy('month').agg({
 *     totalSales: sum('amount'),
 *     averageSales: mean('amount'),
 *     transactions: count()
 *   });
 *
 * Each helper returns a plain aggregation descriptor understood by
 * GroupedDataset.agg(), AnalysisBuilder.agg(), and AnalysisBuilder helpers.
 */
function descriptor(op, column, options = {}, extra = {}) {
  if (column !== undefined && (typeof column !== 'string' || !column.trim())) {
    throw new ValidationError(`${op} aggregation helper requires a column name.`);
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ValidationError(`${op} aggregation options must be an object.`);
  }
  const spec = { op, ...(column !== undefined ? { column } : {}), ...extra };
  for (const key of ['as', 'ddof', 'q', 'p', 'method', 'where']) {
    if (options[key] !== undefined) spec[key] = options[key];
  }
  return spec;
}

export const sum = (column, options = {}) => descriptor('sum', column, options);
export const mean = (column, options = {}) => descriptor('mean', column, options);
export const average = (column, options = {}) => descriptor('average', column, options);
export const median = (column, options = {}) => descriptor('median', column, options);
export const min = (column, options = {}) => descriptor('min', column, options);
export const max = (column, options = {}) => descriptor('max', column, options);
export const nunique = (column, options = {}) => descriptor('nunique', column, options);
export const variance = (column, options = {}) => descriptor('variance', column, options);
export const std = (column, options = {}) => descriptor('std', column, options);
export const stddev = (column, options = {}) => descriptor('stddev', column, options);
export const range = (column, options = {}) => descriptor('range', column, options);
export const iqr = (column, options = {}) => descriptor('iqr', column, options);
export const mad = (column, options = {}) => descriptor('mad', column, options);
export const skewness = (column, options = {}) => descriptor('skewness', column, options);
export const kurtosis = (column, options = {}) => descriptor('kurtosis', column, options);
export const quartiles = (column, options = {}) => descriptor('quartiles', column, options);
export const quantile = (column, q, options = {}) => {
  if (q === undefined) throw new ValidationError('quantile aggregation helper requires q between 0 and 1.');
  return descriptor('quantile', column, options, { q });
};
export const percentile = (column, p, options = {}) => {
  if (p === undefined) throw new ValidationError('percentile aggregation helper requires p between 0 and 100.');
  return descriptor('percentile', column, options, { p });
};
export const count = (column, options = {}) => column === undefined
  ? descriptor('countRows', undefined, options)
  : descriptor('count', column, options);
export const countRows = (options = {}) => descriptor('countRows', undefined, options);
