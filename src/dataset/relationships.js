import { ValidationError } from '../errors/index.js';

const CARDINALITIES = new Set(['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']);
const isMissing = value => value === null || value === undefined;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/**
 * Normalized relationship definition (v0.15.0): a parent dataset's primary
 * key, a child dataset's foreign key, and the cardinality. Defining
 * relationships is always optional; joins work without them.
 */
export function normalizeRelationshipDefinition(definition) {
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new ValidationError('Relationship definition must be an object.');
  }
  const allowed = new Set(['name', 'parent', 'child', 'parentKey', 'childKey', 'cardinality']);
  const unknown = Object.keys(definition).find(key => !allowed.has(key));
  if (unknown) throw new ValidationError(`Relationship definition does not support property: ${unknown}`);
  for (const key of ['parent', 'child']) {
    if (typeof definition[key] !== 'string' || !definition[key].trim()) {
      throw new ValidationError(`Relationship ${key} must be a non-empty dataset name.`);
    }
  }
  for (const key of ['parentKey', 'childKey']) {
    if (typeof definition[key] !== 'string' || !definition[key].trim()) {
      throw new ValidationError(`Relationship ${key} must be a non-empty column name.`);
    }
  }
  const cardinality = definition.cardinality ?? 'many-to-one';
  if (!CARDINALITIES.has(cardinality)) {
    throw new ValidationError(`Unsupported relationship cardinality: ${String(cardinality)}. Use one-to-one, one-to-many, many-to-one, or many-to-many.`);
  }
  const name = definition.name ?? `${definition.parent}->${definition.child}`;
  if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Relationship name must be a non-empty string.');
  return Object.freeze({ name: name.trim(), parent: definition.parent, child: definition.child, parentKey: definition.parentKey, childKey: definition.childKey, cardinality });
}

function keyOf(value) {
  return JSON.stringify(value instanceof Date ? { d: value.toISOString() } : isRecord(value) || Array.isArray(value) ? { o: JSON.stringify(value) } : value);
}

/**
 * Checks actual parent/child rows against a relationship definition and
 * returns a report (never throws): duplicate primary/foreign keys per
 * cardinality, orphaned foreign keys, and missing key columns.
 */
export function checkRelationship(parentRows, childRows, definition) {
  const normalized = normalizeRelationshipDefinition(definition);
  const violations = [];
  const hasColumn = (rows, column) => rows.some(row => row !== null && typeof row === 'object' && column in row);
  if (parentRows.length && !hasColumn(parentRows, normalized.parentKey)) {
    violations.push({ code: 'MISSING_COLUMN', side: 'parent', column: normalized.parentKey, message: `Parent dataset "${normalized.parent}" has no column "${normalized.parentKey}".` });
  }
  if (childRows.length && !hasColumn(childRows, normalized.childKey)) {
    violations.push({ code: 'MISSING_COLUMN', side: 'child', column: normalized.childKey, message: `Child dataset "${normalized.child}" has no column "${normalized.childKey}".` });
  }
  const uniqueRequired = (side, rows, column, code, label) => {
    const seen = new Set();
    for (let index = 0; index < rows.length; index++) {
      const value = rows[index][column];
      if (isMissing(value)) continue;
      const key = keyOf(value);
      if (seen.has(key)) {
        violations.push({ code, side, column, row: index, message: `Duplicate ${label} key in "${normalized.parent}.${column}" at row ${index}.` });
      }
      seen.add(key);
    }
  };
  if (normalized.cardinality === 'one-to-one' || normalized.cardinality === 'one-to-many') {
    uniqueRequired('parent', parentRows, normalized.parentKey, 'DUPLICATE_PARENT_KEY', 'primary');
  }
  if (normalized.cardinality === 'one-to-one' || normalized.cardinality === 'many-to-one') {
    uniqueRequired('child', childRows, normalized.childKey, 'DUPLICATE_CHILD_KEY', 'foreign');
  }
  if (parentRows.length && childRows.length && violations.every(v => v.code !== 'MISSING_COLUMN')) {
    const parentKeys = new Set(parentRows.map(row => row[normalized.parentKey]).filter(value => !isMissing(value)).map(keyOf));
    for (let index = 0; index < childRows.length; index++) {
      const value = childRows[index][normalized.childKey];
      if (isMissing(value)) continue;
      if (!parentKeys.has(keyOf(value))) {
        violations.push({ code: 'ORPHAN_CHILD_KEY', side: 'child', column: normalized.childKey, row: index, message: `Foreign key value at row ${index} of "${normalized.child}" has no match in "${normalized.parent}.${normalized.parentKey}".` });
      }
    }
  }
  return { relationship: normalized.name, cardinality: normalized.cardinality, parent: normalized.parent, child: normalized.child, valid: violations.length === 0, violations };
}
