import { ValidationError } from '../errors/index.js';
import { normalizeRelationshipDefinition, checkRelationship } from './relationships.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/**
 * Lightweight DatasetCollection (v0.15.0): named datasets plus optional
 * relationship definitions. No persistence, no query engine — datasets keep
 * their full Dataset behavior, and relationships never gate joins.
 */
export class DatasetCollection {
  #datasets;
  #relationships;

  constructor(seed = {}) {
    if (seed === null || typeof seed !== 'object' || Array.isArray(seed)) {
      throw new ValidationError('DatasetCollection seed must be an object.');
    }
    const allowed = new Set(['name', 'datasets', 'relationships']);
    const unknown = Object.keys(seed).find(key => !allowed.has(key));
    if (unknown) throw new ValidationError(`DatasetCollection does not support option: ${unknown}`);
    this.#datasets = new Map();
    this.#relationships = new Map();
    this.name = seed.name ?? 'Collection';
    if (seed.datasets !== undefined) {
      if (!isRecord(seed.datasets)) throw new ValidationError('DatasetCollection datasets must be an object mapping names to datasets.');
      for (const [name, dataset] of Object.entries(seed.datasets)) this.add(name, dataset);
    }
    if (seed.relationships !== undefined) {
      if (!Array.isArray(seed.relationships)) throw new ValidationError('DatasetCollection relationships must be an array.');
      for (const definition of seed.relationships) this.defineRelationship(definition);
    }
    Object.freeze(this);
  }

  add(name, dataset) {
    if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Dataset names must be non-empty strings.');
    if (!dataset || typeof dataset !== 'object' || !Array.isArray(dataset.rows) || !Array.isArray(dataset.columns)) {
      throw new ValidationError(`Collection entry "${name}" must be a Dataset or AnalysisResult.`);
    }
    if (this.#datasets.has(name)) throw new ValidationError(`Collection already has a dataset named "${name}".`);
    this.#datasets.set(name, dataset);
    return this;
  }

  get(name) {
    if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Dataset names must be non-empty strings.');
    if (!this.#datasets.has(name)) throw new ValidationError(`Collection has no dataset named "${name}".`);
    return this.#datasets.get(name);
  }

  has(name) { return this.#datasets.has(name); }
  get names() { return [...this.#datasets.keys()]; }
  get size() { return this.#datasets.size; }

  defineRelationship(definition) {
    const normalized = normalizeRelationshipDefinition(definition);
    if (this.#relationships.has(normalized.name)) {
      throw new ValidationError(`Relationship "${normalized.name}" is already defined.`);
    }
    if (this.#datasets.size && (!this.#datasets.has(normalized.parent) || !this.#datasets.has(normalized.child))) {
      throw new ValidationError(`Relationship references unknown dataset(s); define both "${normalized.parent}" and "${normalized.child}" in the collection first.`);
    }
    this.#relationships.set(normalized.name, normalized);
    return this;
  }

  get relationships() { return [...this.#relationships.values()].map(relationship => ({ ...relationship })); }

  validateRelationships() {
    return [...this.#relationships.values()].map(relationship => checkRelationship(
      this.#rowsOf(relationship.parent), this.#rowsOf(relationship.child), relationship
    ));
  }

  validateRelationship(nameOrDefinition) {
    const definition = typeof nameOrDefinition === 'string'
      ? this.#relationships.get(nameOrDefinition)
      : normalizeRelationshipDefinition(nameOrDefinition);
    if (!definition) throw new ValidationError(`Relationship "${String(nameOrDefinition)}" is not defined.`);
    return checkRelationship(this.#rowsOf(definition.parent), this.#rowsOf(definition.child), definition);
  }

  #rowsOf(name) {
    const dataset = this.#datasets.get(name);
    if (!dataset) throw new ValidationError(`Collection has no dataset named "${name}".`);
    return dataset.rows;
  }
}

export function createCollection(seed) { return new DatasetCollection(seed); }
