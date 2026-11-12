import { ValidationError } from '../errors/index.js';
import { cloneValue } from '../utils/values.js';

const JOIN_TYPES = new Set(['inner', 'left', 'right', 'full', 'cross']);
const RELATIONSHIPS = new Set(['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
const isMissing = value => value === null || value === undefined;

/** Accepts Dataset, AnalysisResult (rows+columns), or a plain array of row objects. */
export function toJoinContext(side, label) {
  if (side && typeof side === 'object' && !Array.isArray(side) && Array.isArray(side.rows) && Array.isArray(side.columns)) {
    return { rows: side.rows, columns: [...side.columns], name: side.name ?? side.label ?? label };
  }
  if (Array.isArray(side)) {
    if (side.some(row => !isRecord(row))) throw new ValidationError(`${label} rows must all be objects.`);
    const columns = [...new Set(side.flatMap(row => Object.keys(row)))];
    return { rows: side, columns, name: label };
  }
  throw new ValidationError(`${label} must be a Dataset, an AnalysisResult, or an array of row objects.`);
}

function asKeyArray(value, label) {
  const keys = Array.isArray(value) ? value : [value];
  keys.forEach(key => {
    if (typeof key !== 'string' || !key.trim()) throw new ValidationError(`Join ${label} keys must be non-empty strings.`);
  });
  if (new Set(keys).size !== keys.length) throw new ValidationError(`Join ${label} keys must be unique within a side.`);
  return [...keys];
}

function normalizeKeys(options) {
  const hasOn = options.on !== undefined;
  const hasLeftOn = options.leftOn !== undefined;
  const hasRightOn = options.rightOn !== undefined;
  if (hasOn && (hasLeftOn || hasRightOn)) throw new ValidationError('Use either on or leftOn/rightOn, not both.');
  if (hasLeftOn !== hasRightOn) throw new ValidationError('leftOn and rightOn must be provided together.');
  if (hasOn) {
    const keys = asKeyArray(options.on, 'on');
    return { leftKeys: keys, rightKeys: [...keys] };
  }
  if (hasLeftOn) {
    const leftKeys = asKeyArray(options.leftOn, 'leftOn');
    const rightKeys = asKeyArray(options.rightOn, 'rightOn');
    if (leftKeys.length !== rightKeys.length) throw new ValidationError('leftOn and rightOn must have the same number of keys.');
    return { leftKeys, rightKeys };
  }
  throw new ValidationError('Join requires on (shared key columns) or leftOn/rightOn (differently named keys).');
}

export function normalizeJoinOptions(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ValidationError('Join options must be an object.');
  }
  const allowed = new Set(['on', 'leftOn', 'rightOn', 'how', 'suffixes', 'validate']);
  const unknown = Object.keys(options).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`Join does not support option: ${unknown}`);
  const how = options.how ?? 'inner';
  if (!JOIN_TYPES.has(how)) throw new ValidationError(`Unsupported join type: ${String(how)}. Use inner, left, right, full, or cross.`);
  const { leftKeys, rightKeys } = how === 'cross'
    ? (() => {
      if (options.on !== undefined || options.leftOn !== undefined || options.rightOn !== undefined) {
        throw new ValidationError('cross join does not use join keys; it pairs every left row with every right row.');
      }
      return { leftKeys: [], rightKeys: [] };
    })()
    : normalizeKeys(options);
  let suffixes = options.suffixes ?? ['_left', '_right'];
  if (!Array.isArray(suffixes) || suffixes.length !== 2 || suffixes.some(s => typeof s !== 'string' || !s.trim())) {
    throw new ValidationError('suffixes must be an array of two non-empty strings, e.g. ["_sales", "_customers"].');
  }
  suffixes = [...suffixes];
  if (options.validate !== undefined && !RELATIONSHIPS.has(options.validate)) {
    throw new ValidationError(`Unsupported relationship validation: ${String(options.validate)}. Use one-to-one, one-to-many, many-to-one, or many-to-many.`);
  }
  return { how, leftKeys, rightKeys, suffixes, validate: options.validate ?? null };
}

/**
 * Column resolution for a join:
 * - shared key columns (same name both sides) appear once, from the left;
 * - right-only key columns (differently named keys) are dropped in favor of
 *   the left key columns;
 * - colliding non-key columns get the configured suffixes.
 */
export function resolveJoinColumns(leftColumns, rightColumns, leftKeys, rightKeys, suffixes) {
  const rightKeySet = new Set(rightKeys);
  const leftKeySet = new Set(leftKeys);
  const sharedRightKeys = new Set(rightKeys.filter(key => leftKeySet.has(key)));
  const droppedRightKeys = new Set(rightKeys.filter(key => !sharedRightKeys.has(key)));

  const used = new Set();
  const collisionLeft = new Map();
  const collisionRight = new Map();
  const leftOut = [];
  for (const column of leftColumns) {
    if (rightColumns.includes(column) && !sharedRightKeys.has(column)) {
      const target = `${column}${suffixes[0]}`;
      if (used.has(target)) throw new ValidationError(`Suffixed column name already exists: ${target}`);
      collisionLeft.set(column, target);
      leftOut.push(target);
    } else {
      if (used.has(column)) throw new ValidationError(`Join output column name already exists: ${column}; adjust suffixes to avoid collisions.`);
      leftOut.push(column);
    }
    used.add(leftOut[leftOut.length - 1]);
  }
  const rightOut = [];
  for (const column of rightColumns) {
    if (droppedRightKeys.has(column) || sharedRightKeys.has(column)) continue;
    if (leftColumns.includes(column)) {
      const target = `${column}${suffixes[1]}`;
      if (used.has(target)) throw new ValidationError(`Suffixed column name already exists: ${target}`);
      collisionRight.set(column, target);
      rightOut.push(target);
    } else {
      rightOut.push(column);
    }
    used.add(rightOut[rightOut.length - 1]);
  }
  const outputColumns = [...leftOut, ...rightOut];
  if (new Set(outputColumns).size !== outputColumns.length) {
    throw new ValidationError('Join output columns must be unique; adjust suffixes to avoid collisions.');
  }
  return { outputColumns, collisionLeft, collisionRight, sharedRightKeys, droppedRightKeys };
}

function hasNullKey(row, keys) {
  return keys.some(key => isMissing(row[key]));
}

function joinKey(values) {
  return JSON.stringify(values.map(value => {
    if (value instanceof Date) return { t: 'date', v: value.toISOString() };
    if (isRecord(value)) return { t: 'object', v: JSON.stringify(value, Object.keys(value).sort()) };
    return { t: typeof value, v: isMissing(value) ? null : value };
  }));
}

function validateRelationship(leftRows, rightRows, leftKeys, rightKeys, relationship) {
  if (relationship === 'many-to-many') return;
  const checkSide = (rows, keys, label) => {
    const seen = new Set();
    for (const row of rows) {
      if (hasNullKey(row, keys)) continue;
      const key = joinKey(keys.map(k => row[k]));
      if (seen.has(key)) throw new ValidationError(`${relationship} validation failed: duplicate ${label} join key ${key.slice(0, 80)}.`);
      seen.add(key);
    }
  };
  if (relationship === 'one-to-one') { checkSide(leftRows, leftKeys, 'left'); checkSide(rightRows, rightKeys, 'right'); }
  else if (relationship === 'one-to-many') checkSide(leftRows, leftKeys, 'left');
  else if (relationship === 'many-to-one') checkSide(rightRows, rightKeys, 'right');
}

function buildIndex(rows, keys) {
  const index = new Map();
  for (const row of rows) {
    if (hasNullKey(row, keys)) continue;
    const key = joinKey(keys.map(k => row[k]));
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

/**
 * Hash-based join core (no nested loops).
 * Ordering: matched output preserves left row order (inner/left/full);
 * right join preserves right row order; full/right unmatched rows are
 * appended in source order after the matched section.
 */
export function executeJoin(leftCtx, rightCtx, options) {
  const { how, leftKeys, rightKeys, suffixes, validate } = normalizeJoinOptions(options);
  for (const key of leftKeys) {
    if (!leftCtx.columns.includes(key)) throw new ValidationError(`Unknown join column in left input: ${key}`);
  }
  for (const key of rightKeys) {
    if (!rightCtx.columns.includes(key)) throw new ValidationError(`Unknown join column in right input: ${key}`);
  }
  if (validate) validateRelationship(leftCtx.rows, rightCtx.rows, leftKeys, rightKeys, validate);

  const { outputColumns, collisionLeft, collisionRight, sharedRightKeys } =
    resolveJoinColumns(leftCtx.columns, rightCtx.columns, leftKeys, rightKeys, suffixes);
  const leftKeySet = new Set(leftKeys);

  const buildRow = (side, leftRow, rightRow) => {
    const output = {};
    for (const column of outputColumns) output[column] = null;
    if (side === 'left' || side === 'both') {
      for (const column of leftCtx.columns) {
        const target = sharedRightKeys.has(column) || leftKeySet.has(column) ? column : (collisionLeft.get(column) ?? column);
        output[target] = cloneValue(leftRow?.[column] ?? null);
      }
    }
    if (side === 'right' || side === 'both') {
      for (const column of rightCtx.columns) {
        if (sharedRightKeys.has(column)) {
          if (side === 'right' && leftRow && !isMissing(leftRow[column])) continue;
          output[column] = cloneValue(rightRow?.[column] ?? null);
          continue;
        }
        const target = collisionRight.get(column) ?? column;
        output[target] = cloneValue(rightRow?.[column] ?? null);
      }
    }
    return output;
  };

  const rows = [];
  if (how === 'cross') {
    for (const leftRow of leftCtx.rows) {
      for (const rightRow of rightCtx.rows) rows.push(buildRow('both', leftRow, rightRow));
    }
    return { rows, columns: outputColumns };
  }
  if (how === 'inner' || how === 'left') {
    const index = buildIndex(rightCtx.rows, rightKeys);
    for (const leftRow of leftCtx.rows) {
      const matches = hasNullKey(leftRow, leftKeys) ? [] : index.get(joinKey(leftKeys.map(k => leftRow[k]))) ?? [];
      if (matches.length === 0) {
        if (how === 'left') rows.push(buildRow('left', leftRow, null));
        continue;
      }
      for (const rightRow of matches) rows.push(buildRow('both', leftRow, rightRow));
    }
    return { rows, columns: outputColumns };
  }
  if (how === 'right') {
    const index = buildIndex(leftCtx.rows, leftKeys);
    for (const rightRow of rightCtx.rows) {
      const matches = hasNullKey(rightRow, rightKeys) ? [] : index.get(joinKey(rightKeys.map(k => rightRow[k]))) ?? [];
      if (matches.length === 0) {
        rows.push(buildRow('right', null, rightRow));
        continue;
      }
      for (const leftRow of matches) rows.push(buildRow('both', leftRow, rightRow));
    }
    return { rows, columns: outputColumns };
  }
  // full
  const index = buildIndex(rightCtx.rows, rightKeys);
  const matchedRight = new Set();
  for (const leftRow of leftCtx.rows) {
    const matches = hasNullKey(leftRow, leftKeys) ? [] : index.get(joinKey(leftKeys.map(k => leftRow[k]))) ?? [];
    if (matches.length === 0) {
      rows.push(buildRow('left', leftRow, null));
      continue;
    }
    for (const rightRow of matches) {
      matchedRight.add(rightRow);
      rows.push(buildRow('both', leftRow, rightRow));
    }
  }
  for (const rightRow of rightCtx.rows) {
    if (matchedRight.has(rightRow)) continue;
    rows.push(buildRow('right', null, rightRow));
  }
  return { rows, columns: outputColumns };
}
