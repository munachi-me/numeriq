import { castValue, normalizeValue } from '../utils/values.js';
import { ValidationError } from '../errors/index.js';

const DEFAULT_MISSING_VALUES = ['null', 'undefined', 'n/a', 'na'];

export function importerNormalization(options = {}) {
  const normalization = { ...(options.normalization ?? {}) };
  for (const key of ['trimStrings', 'emptyStringAsNull', 'inferTypes']) {
    if (options[key] !== undefined) normalization[key] = options[key];
  }
  const customMissing = options.nullValues ?? options.missingValues;
  if (customMissing !== undefined) {
    const additional = Array.isArray(customMissing) ? customMissing : [customMissing];
    const configured = normalization.missingValues ?? DEFAULT_MISSING_VALUES;
    const baseline = Array.isArray(configured) ? configured : [configured];
    normalization.missingValues = [...new Set([...baseline, ...additional].map(String))];
  }
  return normalization;
}

export function normalizeImportRecords(records, columns, options, warnings, format) {
  const schema = options.schema ?? {};
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new ValidationError('schema must map column names to types or { type, format } descriptors.');
  const unknownSchemaColumns = Object.keys(schema).filter(column => !columns.includes(column));
  if (unknownSchemaColumns.length) throw new ValidationError(`Schema references unknown column(s): ${unknownSchemaColumns.join(', ')}.`);
  const normalization = importerNormalization(options);
  const onInvalid = options.onInvalid ?? 'error';
  if (!['error', 'null'].includes(onInvalid)) throw new ValidationError("onInvalid must be 'error' or 'null'.");
  const descriptors = Object.fromEntries(Object.entries(schema).map(([column, value]) => [column, normalizeSchemaEntry(value, column)]));
  for (const descriptor of Object.values(descriptors)) castValue(null, descriptor.type, { normalization, format: descriptor.format });

  return records.map((record, rowIndex) => {
    const output = {};
    for (const column of columns) {
      const input = record[column] ?? null;
      if (input === null || input === undefined) {
        output[column] = null;
        continue;
      }
      if (descriptors[column] === undefined) {
        output[column] = normalizeValue(input, normalization);
        continue;
      }
      const descriptor = descriptors[column];
      try {
        output[column] = castValue(input, descriptor.type, { normalization, format: descriptor.format });
      } catch (error) {
        if (onInvalid === 'error') {
          throw new ValidationError(`${format} row ${rowIndex + 1}, column "${column}": ${error.message}`);
        }
        output[column] = null;
        warnings.push(`${format} row ${rowIndex + 1}, column "${column}" was set to null because it could not be cast to ${descriptor.type}.`);
      }
    }
    return output;
  });
}

function normalizeSchemaEntry(value, column) {
  if (typeof value === 'string') return { type: value };
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string') {
    throw new ValidationError(`Schema entry for "${column}" must be a type string or an object with a type string.`);
  }
  const unknown = Object.keys(value).filter(key => !['type', 'format'].includes(key));
  if (unknown.length) throw new ValidationError(`Unsupported schema option(s) for "${column}": ${unknown.join(', ')}.`);
  return { type: value.type, ...(value.format === undefined ? {} : { format: value.format }) };
}

export function missingCounts(records, columns) {
  return Object.fromEntries(columns.map(column => [column, records.filter(record => record[column] === null || record[column] === undefined).length]));
}

export function validateSkipRows(value) {
  const skipRows = value ?? 0;
  if (!Number.isInteger(skipRows) || skipRows < 0) throw new ValidationError('skipRows must be a non-negative integer.');
  return skipRows;
}
