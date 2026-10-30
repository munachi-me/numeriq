import * as stats from '../stats/descriptive.js';
import { renderTable } from '../display/table.js';
export class Series {
  #values;
  constructor(name, values) { this.name = name; this.#values = [...values]; Object.freeze(this); }
  get values() { return [...this.#values]; }
  get length() { return this.#values.length; }
  count() { return stats.count(this.#values); }
  sum() { return stats.sum(this.#values); }
  mean() { return stats.mean(this.#values); }
  median() { return stats.median(this.#values); }
  min() { return stats.min(this.#values); }
  max() { return stats.max(this.#values); }
  variance(ddof=0) { return stats.variance(this.#values, ddof); }
  std(ddof=0) { return stats.std(this.#values, ddof); }
  describe() { return stats.describe(this.#values); }
  toTable() { return renderTable(this.#values.map((value)=>({[this.name]:value})), [this.name]); }
  display() { console.log(this.toTable()); return this; }
}
