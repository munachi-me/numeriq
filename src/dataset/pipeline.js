import { ValidationError } from '../errors/index.js';
import { Dataset } from './dataset.js';

const PIPELINE_VERSION = 1;
const SUPPORTED_OPERATIONS = new Set([
  'select', 'reorderColumns', 'dropColumns', 'renameColumn', 'renameColumns', 'splitColumn', 'combineColumns',
  'replaceText', 'trimColumn', 'changeCase', 'updateColumnWhere', 'addColumn', 'roundColumn', 'extractDatePart',
  'flagOutliers', 'dropMissing', 'fillMissing', 'castColumn', 'dropDuplicates'
]);

export class TransformationPipeline {
  #steps;
  #lastSummary = null;

  constructor(stepsOrDocument = []) {
    const steps = Array.isArray(stepsOrDocument) ? stepsOrDocument : stepsOrDocument?.steps;
    const version = Array.isArray(stepsOrDocument) ? PIPELINE_VERSION : stepsOrDocument?.version ?? PIPELINE_VERSION;
    if (version !== PIPELINE_VERSION) throw new ValidationError(`Unsupported pipeline version: ${version}`);
    if (!Array.isArray(steps)) throw new ValidationError('A transformation pipeline requires a steps array.');
    this.#steps = steps.map((step, index) => validateStep(step, index));
    Object.freeze(this);
  }

  static fromJSON(document) { return new TransformationPipeline(document); }
  get steps() { return cloneJson(this.#steps); }
  get summary() { return this.#lastSummary ? cloneJson(this.#lastSummary) : null; }

  toJSON() { return { version: PIPELINE_VERSION, steps: cloneJson(this.#steps) }; }

  run(dataset) {
    if (!(dataset instanceof Dataset)) throw new ValidationError('TransformationPipeline.run expects a Dataset.');
    const initialShape = dataset.shape;
    const executions = [];
    let current = dataset;
    for (let index = 0; index < this.#steps.length; index += 1) {
      const step = this.#steps[index];
      const beforeShape = current.shape;
      const beforeColumns = current.columns;
      try {
        current = applyStep(current, step);
      } catch (error) {
        throw new ValidationError(`Pipeline step ${index + 1} (${step.op}) failed: ${error.message}`);
      }
      const afterColumns = current.columns;
      const beforeSet = new Set(beforeColumns);
      const afterSet = new Set(afterColumns);
      executions.push({
        index: index + 1,
        operation: step.op,
        target: step.column ?? step.name ?? step.from ?? null,
        shapeBefore: beforeShape,
        shapeAfter: current.shape,
        rowsAdded: Math.max(0, current.length - beforeShape[0]),
        rowsRemoved: Math.max(0, beforeShape[0] - current.length),
        columnsAdded: afterColumns.filter(column => !beforeSet.has(column)),
        columnsRemoved: beforeColumns.filter(column => !afterSet.has(column))
      });
    }
    const summary = deepFreeze({
      pipelineVersion: PIPELINE_VERSION,
      stepCount: executions.length,
      initialShape,
      finalShape: current.shape,
      steps: executions
    });
    this.#lastSummary = summary;
    return Object.freeze({ dataset: current, summary: cloneJson(summary) });
  }
}

export function createPipeline(stepsOrDocument = []) {
  return new TransformationPipeline(stepsOrDocument);
}

function validateStep(step, index) {
  if (!isRecord(step) || typeof step.op !== 'string') throw new ValidationError(`Pipeline step ${index + 1} must be an object with an op string.`);
  if (!SUPPORTED_OPERATIONS.has(step.op)) throw new ValidationError(`Unsupported pipeline operation at step ${index + 1}: ${step.op}`);
  return cloneJson(step);
}

function applyStep(dataset, step) {
  switch (step.op) {
    case 'select': return dataset.select(...requireColumns(step.columns, step.op));
    case 'reorderColumns': return dataset.reorderColumns(...requireColumns(step.columns, step.op));
    case 'dropColumns': return dataset.dropColumns(...requireColumns(step.columns, step.op));
    case 'renameColumn': return dataset.renameColumn(step.from, step.to);
    case 'renameColumns': return dataset.renameColumns(step.mapping);
    case 'splitColumn': return dataset.splitColumn(step.column, step.options);
    case 'combineColumns': return dataset.combineColumns(step.name, requireColumns(step.columns, step.op), step.options);
    case 'replaceText': return dataset.replaceText(step.column, step.search, step.replacement, step.options);
    case 'trimColumn': return dataset.trimColumn(step.column, step.options);
    case 'changeCase': return dataset.changeCase(step.column, step.mode);
    case 'updateColumnWhere': {
      if (!Object.hasOwn(step, 'value') && !Object.hasOwn(step, 'valueExpression')) throw new ValidationError('updateColumnWhere requires value or valueExpression.');
      const replacement = Object.hasOwn(step, 'valueExpression')
        ? row => evaluateExpression(step.valueExpression, row)
        : step.value;
      return dataset.updateColumnWhere(step.column, row => Boolean(evaluateExpression(step.where, row)), replacement);
    }
    case 'addColumn': {
      if (Object.hasOwn(step, 'expression')) return dataset.addColumn(step.name, row => evaluateExpression(step.expression, row));
      if (Object.hasOwn(step, 'value')) return dataset.addColumn(step.name, step.value);
      throw new ValidationError('addColumn requires a JSON-safe value or expression.');
    }
    case 'roundColumn': return dataset.roundColumn(step.column, step.precision ?? 0);
    case 'extractDatePart': return dataset.extractDatePart(step.column, step.part, step.options);
    case 'flagOutliers': return dataset.flagOutliers(step.column, step.options);
    case 'dropMissing': return dataset.dropMissing(step.options);
    case 'fillMissing': {
      if (!Object.hasOwn(step, 'value') && !Object.hasOwn(step, 'valueExpression')) throw new ValidationError('fillMissing requires value or valueExpression.');
      const replacement = Object.hasOwn(step, 'valueExpression')
        ? row => evaluateExpression(step.valueExpression, row)
        : step.value;
      return dataset.fillMissing(step.column, replacement);
    }
    case 'castColumn': return dataset.castColumn(step.column, step.type, step.options);
    case 'dropDuplicates': return dataset.dropDuplicates(...(step.columns === undefined ? [] : requireColumns(step.columns, step.op)));
    default: throw new ValidationError(`Unsupported pipeline operation: ${step.op}`);
  }
}

function evaluateExpression(expression, row) {
  if (expression === null || typeof expression === 'string' || typeof expression === 'number' || typeof expression === 'boolean') return expression;
  if (!isRecord(expression)) throw new ValidationError('Pipeline expressions must be JSON values or expression objects.');
  if (Object.hasOwn(expression, 'column')) {
    if (typeof expression.column !== 'string' || !Object.hasOwn(row, expression.column)) throw new ValidationError(`Expression references unknown column: ${expression.column}`);
    return row[expression.column];
  }
  if (Object.hasOwn(expression, 'literal')) return expression.literal;
  const operation = expression.op;
  const args = expression.args;
  if (typeof operation !== 'string' || !Array.isArray(args)) throw new ValidationError('Expression objects require op and args fields.');
  const values = args.map(argument => evaluateExpression(argument, row));
  switch (operation) {
    case 'add': return arithmetic(values, (a, b) => a + b, operation);
    case 'subtract': return arithmetic(values, (a, b) => a - b, operation);
    case 'multiply': return arithmetic(values, (a, b) => a * b, operation);
    case 'divide': return arithmetic(values, (a, b) => b === 0 ? null : a / b, operation);
    case 'concat': {
      const separator = expression.separator ?? '';
      if (typeof separator !== 'string') throw new ValidationError('concat separator must be a string.');
      const includeMissing = expression.includeMissing ?? false;
      const pieces = values.filter(value => includeMissing || value !== null && value !== undefined).map(value => value == null ? '' : String(value));
      return pieces.length ? pieces.join(separator) : null;
    }
    case 'coalesce': return values.find(value => value !== null && value !== undefined) ?? null;
    case 'eq': return values.length === 2 && values[0] === values[1];
    case 'ne': return values.length === 2 && values[0] !== values[1];
    case 'gt': return compare(values, (a, b) => a > b);
    case 'gte': return compare(values, (a, b) => a >= b);
    case 'lt': return compare(values, (a, b) => a < b);
    case 'lte': return compare(values, (a, b) => a <= b);
    case 'and': return values.every(Boolean);
    case 'or': return values.some(Boolean);
    case 'not': if (values.length !== 1) throw new ValidationError('not expects exactly one argument.'); return !values[0];
    case 'if': if (values.length !== 3) throw new ValidationError('if expects condition, true value, and false value.'); return values[0] ? values[1] : values[2];
    default: throw new ValidationError(`Unsupported pipeline expression operation: ${operation}`);
  }
}

function arithmetic(values, operation, name) {
  if (values.length < 2 || values.some(value => value === null || value === undefined)) return null;
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new ValidationError(`${name} expressions require finite numeric arguments.`);
  let result = values[0];
  for (const value of values.slice(1)) result = operation(result, value);
  return Number.isFinite(result) ? result : null;
}
function compare(values, operation) {
  if (values.length !== 2) throw new ValidationError('Comparison expressions require exactly two arguments.');
  if (values[0] === null || values[0] === undefined || values[1] === null || values[1] === undefined) return false;
  return operation(values[0], values[1]);
}
function requireColumns(columns, operation) {
  if (!Array.isArray(columns) || columns.length === 0) throw new ValidationError(`${operation} requires a non-empty columns array.`);
  return columns;
}
function cloneJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError('Pipeline values must use finite numbers.');
    return value;
  }
  if (typeof value !== 'object') throw new ValidationError('Pipeline steps must contain only JSON-serializable values; callbacks are not supported.');
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) throw new ValidationError('Pipeline steps cannot contain circular references.');
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map(item => cloneJson(item, seen));
  else if (isRecord(value)) result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item, seen)]));
  else throw new ValidationError('Pipeline steps must use plain objects and arrays.');
  seen.delete(value);
  return result;
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
