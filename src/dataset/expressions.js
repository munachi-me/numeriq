import { ValidationError } from '../errors/index.js';

const OPERATIONS = new Set([
  'add', 'subtract', 'multiply', 'divide', 'concat', 'coalesce',
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'and', 'or', 'not', 'if',
  'isNull', 'isNotNull', 'in', 'notIn', 'contains', 'startsWith', 'endsWith'
]);

/** Evaluate the restricted JSON-safe expression language used by calculated columns and pipelines. */
export function evaluateExpression(expression, row) {
  if (expression === null || typeof expression === 'string' || typeof expression === 'number' || typeof expression === 'boolean') return expression;
  if (!isRecord(expression)) throw new ValidationError('Expressions must be JSON values or expression objects.');
  if (Object.hasOwn(expression, 'column')) {
    assertKeys(expression, new Set(['column']));
    if (typeof expression.column !== 'string' || !Object.hasOwn(row, expression.column)) throw new ValidationError(`Unknown column referenced in expression: ${expression.column}`);
    return row[expression.column];
  }
  if (Object.hasOwn(expression, 'literal')) {
    assertKeys(expression, new Set(['literal']));
    return expression.literal;
  }
  const operation = expression.op;
  if (typeof operation !== 'string' || !OPERATIONS.has(operation)) throw new ValidationError(`Unsupported expression operation: ${String(operation)}`);
  const allowedKeys = new Set(['op', 'args']);
  if (operation === 'concat') { allowedKeys.add('separator'); allowedKeys.add('includeMissing'); }
  if (['contains', 'startsWith', 'endsWith'].includes(operation)) allowedKeys.add('caseSensitive');
  assertKeys(expression, allowedKeys);
  const args = expression.args;
  if (!Array.isArray(args)) throw new ValidationError(`${operation} expressions require an args array.`);
  const values = args.map(argument => evaluateExpression(argument, row));
  switch (operation) {
    case 'add': return arithmetic(values, (a, b) => a + b, operation);
    case 'subtract': return arithmetic(values, (a, b) => a - b, operation);
    case 'multiply': return arithmetic(values, (a, b) => a * b, operation);
    case 'divide': return arithmetic(values, (a, b) => b === 0 ? null : a / b, operation);
    case 'concat': {
      const separator = expression.separator ?? '';
      const includeMissing = expression.includeMissing ?? false;
      if (typeof separator !== 'string' || typeof includeMissing !== 'boolean') throw new ValidationError('concat separator must be a string and includeMissing must be boolean.');
      const pieces = values.filter(value => includeMissing || value !== null && value !== undefined).map(value => value == null ? '' : String(value));
      return pieces.length ? pieces.join(separator) : null;
    }
    case 'coalesce': return values.find(value => value !== null && value !== undefined) ?? null;
    case 'eq': return binary(values, (a, b) => equivalent(a, b), operation);
    case 'ne': return binary(values, (a, b) => !equivalent(a, b), operation);
    case 'gt': return binary(values, (a, b) => compare(a, b, (x, y) => x > y), operation);
    case 'gte': return binary(values, (a, b) => compare(a, b, (x, y) => x >= y), operation);
    case 'lt': return binary(values, (a, b) => compare(a, b, (x, y) => x < y), operation);
    case 'lte': return binary(values, (a, b) => compare(a, b, (x, y) => x <= y), operation);
    case 'and': return values.every(Boolean);
    case 'or': return values.some(Boolean);
    case 'not': if (values.length !== 1) throw new ValidationError('not expects exactly one argument.'); return !values[0];
    case 'if': if (values.length !== 3) throw new ValidationError('if expects condition, true value, and false value.'); return values[0] ? values[1] : values[2];
    case 'isNull': if (values.length !== 1) throw new ValidationError('isNull expects exactly one argument.'); return values[0] == null;
    case 'isNotNull': if (values.length !== 1) throw new ValidationError('isNotNull expects exactly one argument.'); return values[0] != null;
    case 'in': if (values.length !== 2 || !Array.isArray(values[1])) throw new ValidationError('in expects a value and an array.'); return values[1].some(value => equivalent(values[0], value));
    case 'notIn': if (values.length !== 2 || !Array.isArray(values[1])) throw new ValidationError('notIn expects a value and an array.'); return !values[1].some(value => equivalent(values[0], value));
    case 'contains': return stringPredicate(values, expression.caseSensitive, (text, search) => text.includes(search));
    case 'startsWith': return stringPredicate(values, expression.caseSensitive, (text, search) => text.startsWith(search));
    case 'endsWith': return stringPredicate(values, expression.caseSensitive, (text, search) => text.endsWith(search));
    default: throw new ValidationError(`Unsupported expression operation: ${operation}`);
  }
}

function arithmetic(values, operation, name) {
  if (values.length < 2 || values.some(value => value === null || value === undefined)) return null;
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new ValidationError(`${name} expressions require finite numeric arguments.`);
  let result = values[0];
  for (const value of values.slice(1)) result = operation(result, value);
  return Number.isFinite(result) ? result : null;
}
function binary(values, operation, name) {
  if (values.length !== 2) throw new ValidationError(`${name} expects exactly two arguments.`);
  return operation(values[0], values[1]);
}
function compare(left, right, operation) {
  if (left == null || right == null || typeof left !== typeof right || typeof left === 'object' || typeof left === 'boolean') return false;
  if (typeof left === 'number' && (!Number.isFinite(left) || !Number.isFinite(right))) return false;
  return operation(left, right);
}
function equivalent(left, right) {
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  return left === right;
}
function stringPredicate(values, caseSensitive = true, predicate) {
  if (values.length !== 2 || typeof values[0] !== 'string' || typeof values[1] !== 'string') return false;
  if (typeof caseSensitive !== 'boolean') throw new ValidationError('caseSensitive must be boolean.');
  const [text, search] = caseSensitive ? values : values.map(value => value.toLocaleLowerCase('en-US'));
  return predicate(text, search);
}
function assertKeys(object, allowed) {
  const unknown = Object.keys(object).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`Expression contains unknown property: ${unknown}`);
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }
