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
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new ValidationError('schema must be an object mapping column names to types.');
  const unknownSchemaColumns = Object.keys(schema).filter(column => !columns.includes(column));
  if (unknownSchemaColumns.length) throw new ValidationError(`Schema references unknown column(s): ${unknownSchemaColumns.join(', ')}.`);
  const normalization = importerNormalization(options);
  const onInvalid = options.onInvalid ?? 'error';
  if (!['error', 'null'].includes(onInvalid)) throw new ValidationError("onInvalid must be 'error' or 'null'.");
  for (const type of Object.values(schema)) castValue(null, type, { normalization });

  return records.map((record, rowIndex) => {
    const output = {};
    for (const column of columns) {
      const input = record[column] ?? null;
      if (input === null || input === undefined) {
        output[column] = null;
        continue;
      }
      if (schema[column] === undefined) {
        output[column] = normalizeValue(input, normalization);
        continue;
      }
      try {
        output[column] = castValue(input, schema[column], { normalization });
      } catch (error) {
        if (onInvalid === 'error') {
          throw new ValidationError(`${format} row ${rowIndex + 1}, column "${column}": ${error.message}`);
        }
        output[column] = null;
        warnings.push(`${format} row ${rowIndex + 1}, column "${column}" was set to null because it could not be cast to ${schema[column]}.`);
      }
    }
    return output;
  });
}

export function missingCounts(records, columns) {
  return Object.fromEntries(columns.map(column => [column, records.filter(record => record[column] === null || record[column] === undefined).length]));
}

export function validateSkipRows(value) {
  const skipRows = value ?? 0;
  if (!Number.isInteger(skipRows) || skipRows < 0) throw new ValidationError('skipRows must be a non-negative integer.');
  return skipRows;
}
