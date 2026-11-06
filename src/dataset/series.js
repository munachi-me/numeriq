import { ValidationError } from '../errors/index.js';
import * as stats from '../stats/descriptive.js';
import { renderTable } from '../display/table.js';

export class Series {
  #values;
  constructor(name, values) {
    if (typeof name !== 'string' || !Array.isArray(values)) throw new ValidationError('Series requires a name and an array of values.');
    this.name = name;
    this.#values = [...values];
    Object.freeze(this);
  }
  get values() { return [...this.#values]; }
  get length() { return this.#values.length; }
  count() { return stats.count(this.#values); }
  sum() { return stats.sum(this.#values); }
  mean() { return stats.mean(this.#values); }
  median() { return stats.median(this.#values); }
  min() { return stats.min(this.#values); }
  max() { return stats.max(this.#values); }
  variance(ddof = 0) { return stats.variance(this.#values, ddof); }
  std(ddof = 0) { return stats.std(this.#values, ddof); }
  quantile(q, options = {}) { return stats.quantile(this.#values, q, options); }
  percentile(value, options = {}) { return stats.percentile(this.#values, value, options); }
  quartiles(options = {}) { return stats.quartiles(this.#values, options); }
  iqr(options = {}) { return stats.iqr(this.#values, options); }
  mad() { return stats.mad(this.#values); }
  skewness() { return stats.skewness(this.#values); }
  kurtosis() { return stats.kurtosis(this.#values); }
  covariance(other, options = {}) { return stats.covariance(this.#values, otherValues(other), options); }
  correlation(other, options = {}) { return stats.correlation(this.#values, otherValues(other), options); }
  zScores(options = {}) {
    const name = scoreName(options, `${this.name}_zscore`, ['as', 'ddof']);
    return new Series(name, stats.zScores(this.#values, { ddof: options.ddof ?? 0 }));
  }
  modifiedZScores(options = {}) {
    const name = scoreName(options, `${this.name}_modified_zscore`, ['as']);
    return new Series(name, stats.modifiedZScores(this.#values));
  }
  describe() { return stats.describe(this.#values); }
  toTable() { return renderTable(this.#values.map(value => ({ [this.name]: value })), [this.name]); }
  display() { console.log(this.toTable()); return this; }
}

function otherValues(other) {
  if (other instanceof Series) return other.values;
  if (Array.isArray(other)) return other;
  throw new ValidationError('Paired Series statistics expect another Series or an array of values.');
}
function scoreName(options, fallback, allowed) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new ValidationError('Score options must be an object.');
  const unknown = Object.keys(options).find(key => !allowed.includes(key));
  if (unknown) throw new ValidationError(`Score Series does not support option: ${unknown}.`);
  const name = options.as ?? fallback;
  if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Score Series names must be non-empty strings.');
  return name.trim();
}
