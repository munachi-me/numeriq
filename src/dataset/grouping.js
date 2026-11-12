import { ValidationError } from '../errors/index.js';
import { cloneValue } from '../utils/values.js';
import { normalizeAggregations, computeAggregation, groupKeyValue } from './aggregations.js';

/** A grouped view created by Dataset.groupBy() or AnalysisResult.groupBy(). Use agg() or aggregate() to materialize it. */
export class GroupedDataset {
  #rows;
  #columns;
  #keys;
  #name;
  #createResult;

  constructor(rows, columns, keys, name, createResult) {
    if (!Array.isArray(rows) || !Array.isArray(columns) || !Array.isArray(keys) || typeof createResult !== 'function') {
      throw new ValidationError('GroupedDataset must be created from dataset rows, columns, keys, and a result factory.');
    }
    this.#rows = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cloneValue(value)])));
    this.#columns = [...columns];
    this.#keys = [...keys];
    this.#name = name;
    this.#createResult = createResult;
    Object.freeze(this);
  }

  get keys() { return [...this.#keys]; }

  agg(specification) {
    const aggregations = normalizeAggregations(specification, this.#columns);
    const outputColumns = [...this.#keys, ...aggregations.map(aggregation => aggregation.name)];
    if (new Set(outputColumns).size !== outputColumns.length) throw new ValidationError('Grouping and aggregation output column names must be unique.');

    const groups = new Map();
    if (this.#keys.length === 0) groups.set('global', { key: [], rows: [] });
    for (const row of this.#rows) {
      const keyValues = this.#keys.map(column => row[column] ?? null);
      const key = this.#keys.length === 0 ? 'global' : JSON.stringify(keyValues.map(groupKeyValue));
      if (!groups.has(key)) groups.set(key, { key: keyValues, rows: [] });
      groups.get(key).rows.push(row);
    }

    const resultRows = [...groups.values()].map(group => {
      const output = Object.fromEntries(this.#keys.map((column, index) => [column, group.key[index]]));
      for (const aggregation of aggregations) output[aggregation.name] = computeAggregation(aggregation, group.rows);
      return output;
    });
    return this.#createResult(resultRows, outputColumns, `${this.#name} grouped`);
  }

  aggregate(specification) { return this.agg(specification); }
}
