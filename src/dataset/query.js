import { ValidationError } from '../errors/index.js';
import { Dataset } from './dataset.js';

const QUERY_VERSION = 1;
const ROOT_KEYS = new Set(['version', 'where', 'select', 'orderBy', 'offset', 'limit']);
const COMPOUND = new Set(['and', 'or', 'not']);
const COMPARISONS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']);
const SET_OPERATORS = new Set(['in', 'notIn']);
const STRING_OPERATORS = new Set(['contains', 'startsWith', 'endsWith']);
const LEAF_OPERATORS = new Set([...COMPARISONS, ...SET_OPERATORS, ...STRING_OPERATORS, 'isNull', 'isNotNull']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;

export class Query {
  #document;

  constructor(document = {}) {
    if (!isRecord(document)) throw new ValidationError('A query must be a plain object.');
    assertKnownKeys(document, ROOT_KEYS, 'Query');
    const version = document.version ?? QUERY_VERSION;
    if (version !== QUERY_VERSION) throw new ValidationError(`Unsupported query version: ${version}`);
    const normalized = { version: QUERY_VERSION };
    if (Object.hasOwn(document, 'where')) normalized.where = normalizeCondition(document.where, 'where');
    if (Object.hasOwn(document, 'select')) {
      if (!Array.isArray(document.select) || document.select.some(column => typeof column !== 'string' || !column.trim())) {
        throw new ValidationError('Query select must be an array of non-empty column names.');
      }
      if (new Set(document.select).size !== document.select.length) throw new ValidationError('Query select column names must be unique.');
      normalized.select = [...document.select];
    }
    if (Object.hasOwn(document, 'orderBy')) {
      if (!Array.isArray(document.orderBy)) throw new ValidationError('Query orderBy must be an array.');
      normalized.orderBy = document.orderBy.map((item, index) => normalizeOrder(item, index));
      if (new Set(normalized.orderBy.map(item => item.column)).size !== normalized.orderBy.length) throw new ValidationError('Query orderBy column names must be unique.');
    }
    normalized.offset = document.offset ?? 0;
    if (!Number.isSafeInteger(normalized.offset) || normalized.offset < 0) throw new ValidationError('Query offset must be a non-negative safe integer.');
    if (Object.hasOwn(document, 'limit')) {
      if (!Number.isSafeInteger(document.limit) || document.limit < 0) throw new ValidationError('Query limit must be a non-negative safe integer.');
      normalized.limit = document.limit;
    }
    this.#document = deepFreeze(normalized);
    Object.freeze(this);
  }

  get document() { return cloneJson(this.#document); }
  toJSON() { return this.document; }
  static fromJSON(document) { return new Query(document); }

  run(dataset) {
    if (!(dataset instanceof Dataset)) throw new ValidationError('Query.run expects a Dataset.');
    for (const column of referencedColumns(this.#document)) {
      if (!dataset.columns.includes(column)) throw new ValidationError(`Unknown column: ${column}`);
    }
    let result = dataset;
    if (this.#document.where) result = result.filter(row => evaluate(this.#document.where, row));
    for (const order of [...(this.#document.orderBy ?? [])].reverse()) {
      result = result.sortBy(order.column, order.direction);
    }
    if (this.#document.offset) result = result.tail(Math.max(0, result.length - this.#document.offset));
    if (this.#document.limit !== undefined) result = result.limit(this.#document.limit);
    if (this.#document.select !== undefined) result = result.select(this.#document.select);
    return result;
  }
}

export function createQuery(document = {}) { return new Query(document); }

function normalizeCondition(condition, path) {
  if (!isRecord(condition) || typeof condition.op !== 'string') throw new ValidationError(`${path} must be a condition object with an op.`);
  if (COMPOUND.has(condition.op)) {
    const allowed = condition.op === 'not' ? new Set(['op', 'args', 'condition']) : new Set(['op', 'args']);
    assertKnownKeys(condition, allowed, path);
    if (condition.op === 'not') {
      const args = condition.args ?? (Object.hasOwn(condition, 'condition') ? [condition.condition] : null);
      if (!Array.isArray(args) || args.length !== 1) throw new ValidationError(`${path} not requires exactly one nested condition.`);
      return { op: 'not', args: [normalizeCondition(args[0], `${path}.not`)] };
    }
    if (!Array.isArray(condition.args) || condition.args.length < 1) throw new ValidationError(`${path} ${condition.op} requires a non-empty args array.`);
    return { op: condition.op, args: condition.args.map((item, index) => normalizeCondition(item, `${path}.args[${index}]`)) };
  }
  if (!LEAF_OPERATORS.has(condition.op)) throw new ValidationError(`${path} uses unsupported operator: ${condition.op}`);
  const allowed = new Set(['column', 'op']);
  if (COMPARISONS.has(condition.op) || SET_OPERATORS.has(condition.op) || STRING_OPERATORS.has(condition.op)) allowed.add('value');
  if (STRING_OPERATORS.has(condition.op)) allowed.add('caseSensitive');
  assertKnownKeys(condition, allowed, path);
  if (typeof condition.column !== 'string' || !condition.column.trim()) throw new ValidationError(`${path} requires a non-empty column name.`);
  const result = { column: condition.column, op: condition.op };
  if (COMPARISONS.has(condition.op)) {
    if (!Object.hasOwn(condition, 'value')) throw new ValidationError(`${path} ${condition.op} requires value.`);
    if (condition.value === null) throw new ValidationError(`${path} comparisons against null are not supported; use isNull or isNotNull.`);
    result.value = cloneJson(condition.value, `${path}.value`);
  } else if (SET_OPERATORS.has(condition.op)) {
    if (!Array.isArray(condition.value)) throw new ValidationError(`${path} ${condition.op} requires an array value.`);
    if (condition.value.some(value => value === null || value === undefined)) throw new ValidationError(`${path} membership values cannot include null; use isNull explicitly.`);
    result.value = cloneJson(condition.value, `${path}.value`);
  } else if (STRING_OPERATORS.has(condition.op)) {
    if (typeof condition.value !== 'string') throw new ValidationError(`${path} ${condition.op} requires a string value.`);
    const caseSensitive = condition.caseSensitive ?? true;
    if (typeof caseSensitive !== 'boolean') throw new ValidationError(`${path} caseSensitive must be boolean.`);
    result.value = condition.value;
    result.caseSensitive = caseSensitive;
  }
  return result;
}

function normalizeOrder(item, index) {
  if (!isRecord(item)) throw new ValidationError(`Query orderBy[${index}] must be an object.`);
  assertKnownKeys(item, new Set(['column', 'direction']), `Query orderBy[${index}]`);
  if (typeof item.column !== 'string' || !item.column.trim()) throw new ValidationError(`Query orderBy[${index}] requires a non-empty column.`);
  const direction = item.direction ?? 'asc';
  if (!['asc', 'desc'].includes(direction)) throw new ValidationError(`Query orderBy[${index}] direction must be 'asc' or 'desc'.`);
  return { column: item.column, direction };
}

function referencedColumns(document) {
  const columns = new Set([...(document.select ?? []), ...(document.orderBy ?? []).map(item => item.column)]);
  function visit(condition) {
    if (!condition) return;
    if (COMPOUND.has(condition.op)) condition.args.forEach(visit);
    else columns.add(condition.column);
  }
  visit(document.where);
  return columns;
}

function evaluate(condition, row) {
  if (condition.op === 'and') return condition.args.every(item => evaluate(item, row));
  if (condition.op === 'or') return condition.args.some(item => evaluate(item, row));
  if (condition.op === 'not') return !evaluate(condition.args[0], row);
  if (!Object.hasOwn(row, condition.column)) throw new ValidationError(`Query references unknown column: ${condition.column}`);
  const actual = row[condition.column];
  if (condition.op === 'isNull') return actual === null || actual === undefined;
  if (condition.op === 'isNotNull') return actual !== null && actual !== undefined;
  if (actual === null || actual === undefined) return false;
  switch (condition.op) {
    case 'eq': return equivalent(actual, condition.value);
    case 'ne': return !equivalent(actual, condition.value);
    case 'gt': return compareValues(actual, condition.value, (a, b) => a > b);
    case 'gte': return compareValues(actual, condition.value, (a, b) => a >= b);
    case 'lt': return compareValues(actual, condition.value, (a, b) => a < b);
    case 'lte': return compareValues(actual, condition.value, (a, b) => a <= b);
    case 'in': return condition.value.some(value => equivalent(actual, value));
    case 'notIn': return !condition.value.some(value => equivalent(actual, value));
    case 'contains': return matchString(actual, condition.value, condition.caseSensitive, (value, search) => value.includes(search));
    case 'startsWith': return matchString(actual, condition.value, condition.caseSensitive, (value, search) => value.startsWith(search));
    case 'endsWith': return matchString(actual, condition.value, condition.caseSensitive, (value, search) => value.endsWith(search));
    default: throw new ValidationError(`Unsupported query operator: ${condition.op}`);
  }
}

function matchString(actual, search, caseSensitive, matcher) {
  if (typeof actual !== 'string') return false;
  return matcher(caseSensitive ? actual : actual.toLocaleLowerCase('en-US'), caseSensitive ? search : search.toLocaleLowerCase('en-US'));
}
function compareValues(actual, expected, comparator) {
  const leftTemporal = temporalValue(actual);
  const rightTemporal = temporalValue(expected);
  if (leftTemporal !== null || rightTemporal !== null) {
    if (leftTemporal === null || rightTemporal === null) return false;
    return comparator(leftTemporal, rightTemporal);
  }
  if (typeof actual !== typeof expected) return false;
  if (typeof actual === 'number' && (!Number.isFinite(actual) || !Number.isFinite(expected))) return false;
  if (typeof actual === 'boolean' || actual !== null && typeof actual === 'object') return false;
  return comparator(actual, expected);
}
function equivalent(left, right) {
  const leftTemporal = temporalValue(left);
  const rightTemporal = temporalValue(right);
  if (leftTemporal !== null || rightTemporal !== null) return leftTemporal !== null && rightTemporal !== null && leftTemporal === rightTemporal;
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  return left === right;
}
function temporalValue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string' || (!ISO_DATE.test(value) && !ISO_DATETIME.test(value))) return null;
  const parsed = Date.parse(ISO_DATE.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed) ? null : parsed;
}
function assertKnownKeys(object, allowed, label) {
  const unknown = Object.keys(object).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`${label} contains unknown property: ${unknown}`);
}
function cloneJson(value, path, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError(`${path} must contain only finite numbers.`);
    return value;
  }
  if (typeof value !== 'object') throw new ValidationError(`${path} must contain JSON-safe values.`);
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) throw new ValidationError(`${path} cannot contain circular references.`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((item, index) => cloneJson(item, `${path}[${index}]`, seen));
  else if (isRecord(value)) result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item, `${path}.${key}`, seen)]));
  else throw new ValidationError(`${path} must contain plain objects and arrays.`);
  seen.delete(value);
  return result;
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
