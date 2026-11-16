import { ValidationError } from '../errors/index.js';
import { castValue, inferType } from '../utils/values.js';

const TYPE_NAMES = new Set(['string', 'number', 'integer', 'boolean', 'date', 'datetime', 'time']);
const CONSTRAINT_NAMES = new Set(['required', 'nullable', 'min', 'max', 'minLength', 'maxLength', 'pattern', 'enum', 'unique', 'custom']);

const isMissing = value => value === null || value === undefined;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/**
 * Normalized schema definition (v0.15.0): column names, expected types,
 * nullability, required flags, and per-column constraints. Validation never
 * mutates data and never copies datasets.
 */
export class SchemaDefinition {
  #name;
  #columns;

  constructor(definition = {}) {
    if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new ValidationError('Schema definition must be an object.');
    }
    const allowed = new Set(['name', 'columns']);
    const unknown = Object.keys(definition).find(key => !allowed.has(key));
    if (unknown) throw new ValidationError(`Schema definition does not support property: ${unknown}`);
    this.#name = definition.name ?? null;
    const raw = definition.columns;
    if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ValidationError('Schema definition requires a columns object mapping column names to rules.');
    }
    this.#columns = new Map();
    for (const [column, rule] of Object.entries(raw)) {
      this.#columns.set(column, normalizeColumnRule(column, rule));
    }
    Object.freeze(this);
  }

  get name() { return this.#name; }
  get columnNames() { return [...this.#columns.keys()]; }
  getColumn(column) {
    const rule = this.#columns.get(column);
    return rule ? cloneRule(rule) : null;
  }
  get columns() { return Object.fromEntries([...this.#columns].map(([name, rule]) => [name, cloneRule(rule)])); }

  validate(rows, datasetColumns = null) {
    const errors = [];
    const warnings = [];
    const checked = [...this.#columns.keys()];
    for (const [column, rule] of this.#columns) {
      if (datasetColumns && !datasetColumns.includes(column)) {
        const problem = { code: 'MISSING_COLUMN', column, message: `Column "${column}" is not present in the dataset.` };
        if (rule.required) errors.push(problem); else warnings.push(problem);
        continue;
      }
      if (rule.unique) {
        const seen = new Set();
        for (let index = 0; index < rows.length; index++) {
          const value = rows[index][column];
          if (isMissing(value)) continue;
          const key = JSON.stringify(value instanceof Date ? { d: value.toISOString() } : value);
          if (seen.has(key)) {
            errors.push({ code: 'NOT_UNIQUE', column, row: index, message: `Duplicate value in unique column "${column}" at row ${index}.` });
          }
          seen.add(key);
        }
      }
      for (let index = 0; index < rows.length; index++) {
        const value = rows[index][column];
        if (isMissing(value)) {
          if (!rule.nullable) {
            errors.push({ code: 'NULL_NOT_ALLOWED', column, row: index, message: `Null value in non-nullable column "${column}" at row ${index}.` });
          }
          continue;
        }
        if (rule.type) {
          try { castValue(value, rule.type); }
          catch {
            errors.push({ code: 'TYPE_MISMATCH', column, row: index, message: `Value at row ${index} does not match type "${rule.type}" in column "${column}".` });
            continue;
          }
        }
        errors.push(...checkConstraints(rule, value, rows[index], column, index));
      }
    }
    return {
      schema: this.#name,
      valid: errors.length === 0,
      rowCount: rows.length,
      checkedColumns: checked,
      errors,
      warnings
    };
  }

  toJSON() {
    const columns = {};
    for (const [name, rule] of this.#columns) {
      const clone = cloneRule(rule);
      delete clone.column; // internal bookkeeping, not part of the public document
      columns[name] = clone;
    }
    return { name: this.#name, columns };
  }
}

function normalizeColumnRule(column, rule) {
  if (rule === null || rule === undefined) return { column, type: null, nullable: true, required: false };
  if (typeof rule === 'string') rule = { type: rule };
  if (!isRecord(rule)) throw new ValidationError(`Schema rule for column "${column}" must be an object or a type string.`);
  const unknown = Object.keys(rule).find(key => !CONSTRAINT_NAMES.has(key) && key !== 'type');
  if (unknown) throw new ValidationError(`Schema rule for column "${column}" does not support property: ${unknown}`);
  const normalized = { column, type: null, nullable: true, required: false };
  if (rule.type !== undefined && rule.type !== null) {
    const type = String(rule.type).toLowerCase();
    if (!TYPE_NAMES.has(type)) throw new ValidationError(`Unsupported schema type "${rule.type}" for column "${column}".`);
    normalized.type = type;
  }
  if (rule.nullable !== undefined) {
    if (typeof rule.nullable !== 'boolean') throw new ValidationError(`nullable for column "${column}" must be a boolean.`);
    normalized.nullable = rule.nullable;
  }
  if (rule.required !== undefined) {
    if (typeof rule.required !== 'boolean') throw new ValidationError(`required for column "${column}" must be a boolean.`);
    normalized.required = rule.required;
  }
  for (const key of ['min', 'max']) {
    if (rule[key] === undefined) continue;
    if (typeof rule[key] !== 'number' || !Number.isFinite(rule[key])) throw new ValidationError(`${key} for column "${column}" must be a finite number.`);
    normalized[key] = rule[key];
  }
  for (const key of ['minLength', 'maxLength']) {
    if (rule[key] === undefined) continue;
    if (!Number.isInteger(rule[key]) || rule[key] < 0) throw new ValidationError(`${key} for column "${column}" must be a non-negative integer.`);
    normalized[key] = rule[key];
  }
  if (rule.pattern !== undefined) {
    if (rule.pattern instanceof RegExp) normalized.pattern = rule.pattern;
    else if (typeof rule.pattern === 'string') normalized.pattern = new RegExp(rule.pattern);
    else throw new ValidationError(`pattern for column "${column}" must be a RegExp or a string.`);
  }
  if (rule.enum !== undefined) {
    if (!Array.isArray(rule.enum) || rule.enum.length === 0) throw new ValidationError(`enum for column "${column}" must be a non-empty array.`);
    normalized.enum = [...rule.enum];
  }
  if (rule.unique !== undefined) {
    if (typeof rule.unique !== 'boolean') throw new ValidationError(`unique for column "${column}" must be a boolean.`);
    normalized.unique = rule.unique;
  }
  if (rule.custom !== undefined) {
    if (typeof rule.custom !== 'function') throw new ValidationError(`custom for column "${column}" must be a function.`);
    normalized.custom = rule.custom;
  }
  return normalized;
}

function cloneRule(rule) {
  const clone = { ...rule };
  if (clone.pattern instanceof RegExp) clone.pattern = clone.pattern.source;
  return clone;
}

function checkConstraints(rule, value, row, column, index) {
  const errors = [];
  const fail = message => errors.push({ code: 'CONSTRAINT_VIOLATION', column, row: index, message });
  if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
    fail(`Value ${value} in column "${column}" at row ${index} is below min ${rule.min}.`);
  }
  if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
    fail(`Value ${value} in column "${column}" at row ${index} is above max ${rule.max}.`);
  }
  if ((rule.minLength !== undefined || rule.maxLength !== undefined) && typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) {
      fail(`String in column "${column}" at row ${index} is shorter than minLength ${rule.minLength}.`);
    }
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      fail(`String in column "${column}" at row ${index} is longer than maxLength ${rule.maxLength}.`);
    }
  }
  if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
    fail(`Value in column "${column}" at row ${index} does not match the required pattern.`);
  }
  if (rule.enum && !rule.enum.some(option => option === value)) {
    fail(`Value in column "${column}" at row ${index} is not in the allowed enum.`);
  }
  if (rule.custom) {
    let ok = false;
    try { ok = Boolean(rule.custom(cloneValueForCheck(value), row)); }
    catch { ok = false; }
    if (!ok) fail(`Value in column "${column}" at row ${index} failed the custom constraint.`);
  }
  return errors;
}

function cloneValueForCheck(value) {
  if (value instanceof Date) return new Date(value);
  return value;
}

export function createSchema(definition) { return new SchemaDefinition(definition); }

export function validateRowsAgainstSchema(rows, datasetColumns, definition) {
  const schema = definition instanceof SchemaDefinition ? definition : new SchemaDefinition(definition);
  return schema.validate(rows, datasetColumns);
}

/** Column-level statistics report; merges schema errors when a definition is provided. */
export function buildValidationReport(rows, datasetColumns, definition = null) {
  const schema = definition === null || definition === undefined
    ? null
    : (definition instanceof SchemaDefinition ? definition : new SchemaDefinition(definition));
  const base = schema ? schema.validate(rows, datasetColumns) : { valid: true, errors: [], warnings: [] };
  const errorCountByColumn = new Map();
  for (const error of base.errors) {
    errorCountByColumn.set(error.column, (errorCountByColumn.get(error.column) ?? 0) + 1);
  }
  const columns = datasetColumns.map(name => {
    const values = rows.map(row => row[name]);
    const nullCount = values.filter(isMissing).length;
    const rule = schema?.getColumn(name) ?? null;
    return {
      name,
      inferredType: inferType(values),
      expectedType: rule?.type ?? null,
      nullable: rule ? rule.nullable : null,
      required: rule ? rule.required : null,
      nullCount,
      nullPercent: rows.length ? Number((nullCount / rows.length * 100).toFixed(2)) : 0,
      errorCount: errorCountByColumn.get(name) ?? 0
    };
  });
  return {
    rowCount: rows.length,
    columnCount: datasetColumns.length,
    valid: base.valid,
    errors: base.errors,
    warnings: base.warnings,
    columns
  };
}
