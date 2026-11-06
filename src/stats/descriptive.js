import { ValidationError } from '../errors/index.js';

const numeric = values => values.filter(value => typeof value === 'number' && Number.isFinite(value));
const nonMissing = values => values.filter(value => value !== null && value !== undefined);
const QUANTILE_METHODS = new Set(['linear', 'lower', 'higher', 'midpoint', 'nearest']);
const MODIFIED_Z_SCALE = 0.6744897501960817;

const distinctKey = value => {
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (value && typeof value === 'object') return `object:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value)}`;
};

export function count(values) { return nonMissing(values).length; }
export function sum(values) { return numeric(values).reduce((total, value) => total + value, 0); }
export function mean(values) { const data = numeric(values); return data.length ? sum(data) / data.length : null; }
export function median(values) { return quantile(values, 0.5); }
export function min(values) {
  const data = numeric(values);
  return data.length ? data.reduce((minimum, value) => Math.min(minimum, value), Infinity) : null;
}
export function max(values) {
  const data = numeric(values);
  return data.length ? data.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : null;
}
export function range(values) { const low = min(values), high = max(values); return low === null ? null : high - low; }

export function variance(values, ddof = 0) {
  validateDdof(ddof);
  const data = numeric(values);
  if (data.length <= ddof) return null;
  const average = mean(data);
  return data.reduce((total, value) => total + (value - average) ** 2, 0) / (data.length - ddof);
}
export function std(values, ddof = 0) { const result = variance(values, ddof); return result === null ? null : Math.sqrt(result); }

export function quantile(values, q, options = {}) {
  validateOptions(options, ['method'], 'quantile');
  validateProbability(q, 'q');
  const method = options.method ?? 'linear';
  if (!QUANTILE_METHODS.has(method)) throw new ValidationError(`Unsupported quantile method: ${String(method)}.`);
  const data = numeric(values).sort((left, right) => left - right);
  if (!data.length) return null;
  const position = (data.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (method === 'lower') return data[lowerIndex];
  if (method === 'higher') return data[upperIndex];
  if (method === 'nearest') return data[Math.round(position)];
  if (method === 'midpoint') return (data[lowerIndex] + data[upperIndex]) / 2;
  if (lowerIndex === upperIndex) return data[lowerIndex];
  const fraction = position - lowerIndex;
  return data[lowerIndex] + (data[upperIndex] - data[lowerIndex]) * fraction;
}

export function percentile(values, percentileValue, options = {}) {
  validateOptions(options, ['method'], 'percentile');
  validateProbability(percentileValue, 'percentile', 100);
  return quantile(values, percentileValue / 100, options);
}

export function quartiles(values, options = {}) {
  return {
    q1: quantile(values, 0.25, options),
    median: quantile(values, 0.5, options),
    q3: quantile(values, 0.75, options)
  };
}

export function iqr(values, options = {}) {
  const { q1, q3 } = quartiles(values, options);
  return q1 === null || q3 === null ? null : q3 - q1;
}

export function mad(values) {
  const center = median(values);
  if (center === null) return null;
  return median(numeric(values).map(value => Math.abs(value - center)));
}

/** Population-moment skewness; requires at least 3 finite values and nonzero variance. */
export function skewness(values) {
  const data = numeric(values);
  if (data.length < 3) return null;
  const average = mean(data);
  const secondMoment = data.reduce((total, value) => total + (value - average) ** 2, 0) / data.length;
  if (secondMoment === 0) return null;
  const thirdMoment = data.reduce((total, value) => total + (value - average) ** 3, 0) / data.length;
  return thirdMoment / secondMoment ** 1.5;
}

/** Population-moment Fisher excess kurtosis; requires at least 4 finite values and nonzero variance. */
export function kurtosis(values) {
  const data = numeric(values);
  if (data.length < 4) return null;
  const average = mean(data);
  const secondMoment = data.reduce((total, value) => total + (value - average) ** 2, 0) / data.length;
  if (secondMoment === 0) return null;
  const fourthMoment = data.reduce((total, value) => total + (value - average) ** 4, 0) / data.length;
  return fourthMoment / secondMoment ** 2 - 3;
}

export function covariance(leftValues, rightValues, options = {}) {
  validateOptions(options, ['ddof'], 'covariance');
  const ddof = options.ddof ?? 0;
  validateDdof(ddof);
  const [left, right] = pairwiseNumeric(leftValues, rightValues);
  if (left.length <= ddof) return null;
  const leftMean = mean(left), rightMean = mean(right);
  const crossDeviation = left.reduce((total, value, index) => total + (value - leftMean) * (right[index] - rightMean), 0);
  return crossDeviation / (left.length - ddof);
}

export function correlation(leftValues, rightValues, options = {}) {
  validateOptions(options, ['method'], 'correlation');
  const method = options.method ?? 'pearson';
  if (!['pearson', 'spearman'].includes(method)) throw new ValidationError("correlation method must be 'pearson' or 'spearman'.");
  let [left, right] = pairwiseNumeric(leftValues, rightValues);
  if (left.length < 2) return null;
  if (method === 'spearman') [left, right] = [averageRanks(left), averageRanks(right)];
  const leftMean = mean(left), rightMean = mean(right);
  let numerator = 0, leftSquares = 0, rightSquares = 0;
  for (let index = 0; index < left.length; index++) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta ** 2;
    rightSquares += rightDelta ** 2;
  }
  if (leftSquares === 0 || rightSquares === 0) return null;
  return Math.max(-1, Math.min(1, numerator / Math.sqrt(leftSquares * rightSquares)));
}

export function zScores(values, options = {}) {
  validateOptions(options, ['ddof'], 'zScores');
  const ddof = options.ddof ?? 0;
  validateDdof(ddof);
  const data = numeric(values);
  const deviation = std(data, ddof);
  if (deviation === null || deviation === 0) return values.map(() => null);
  const average = mean(data);
  return values.map(value => typeof value === 'number' && Number.isFinite(value) ? (value - average) / deviation : null);
}

export function modifiedZScores(values) {
  const data = numeric(values);
  const center = median(data);
  const deviation = mad(data);
  if (center === null || deviation === null || deviation === 0) return values.map(() => null);
  return values.map(value => typeof value === 'number' && Number.isFinite(value) ? MODIFIED_Z_SCALE * (value - center) / deviation : null);
}

export function describe(values) {
  const present = nonMissing(values);
  const summary = {
    count: present.length,
    missing: values.length - present.length,
    distinct: new Set(present.map(distinctKey)).size,
    mean: null,
    median: null,
    min: null,
    max: null,
    range: null,
    variance: null,
    std: null,
    q1: null,
    q3: null,
    iqr: null,
    mad: null,
    skewness: null,
    kurtosis: null
  };
  const numericValues = numeric(present);
  if (!numericValues.length) return summary;
  const { q1, q3 } = quartiles(numericValues);
  return {
    ...summary,
    mean: mean(numericValues),
    median: median(numericValues),
    min: min(numericValues),
    max: max(numericValues),
    range: range(numericValues),
    variance: variance(numericValues),
    std: std(numericValues),
    q1,
    q3,
    iqr: iqr(numericValues),
    mad: mad(numericValues),
    skewness: skewness(numericValues),
    kurtosis: kurtosis(numericValues)
  };
}

function pairwiseNumeric(leftValues, rightValues) {
  if (!Array.isArray(leftValues) || !Array.isArray(rightValues)) throw new ValidationError('Paired statistics expect two arrays of values.');
  if (leftValues.length !== rightValues.length) throw new ValidationError('Paired statistics require arrays of equal length.');
  const left = [], right = [];
  for (let index = 0; index < leftValues.length; index++) {
    const x = leftValues[index], y = rightValues[index];
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      left.push(x);
      right.push(y);
    }
  }
  return [left, right];
}

function averageRanks(values) {
  const ordered = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = Array(values.length);
  let start = 0;
  while (start < ordered.length) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end++;
    const averageRank = ((start + 1) + end) / 2;
    for (let index = start; index < end; index++) ranks[ordered[index].index] = averageRank;
    start = end;
  }
  return ranks;
}

function validateDdof(ddof) {
  if (!Number.isInteger(ddof) || ddof < 0) throw new ValidationError('ddof must be a non-negative integer.');
}
function validateOptions(options, allowed, name) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new ValidationError(`${name} options must be an object.`);
  const unknown = Object.keys(options).find(key => !allowed.includes(key));
  if (unknown) throw new ValidationError(`${name} does not support option: ${unknown}.`);
}
function validateProbability(value, name, maximum = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new ValidationError(`${name} must be a finite number between 0 and ${maximum}.`);
  }
}
