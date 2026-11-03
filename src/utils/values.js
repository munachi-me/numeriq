import { ValidationError } from '../errors/index.js';
import { castTemporal, inferTemporalType, validateTemporalFormat } from './temporal.js';

const DEFAULT_MISSING_VALUES = ['null', 'undefined', 'n/a', 'na'];
const NUMERIC_PATTERN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

export function normalizeValue(value, options = {}) {
  const {
    trimStrings = true,
    emptyStringAsNull = true,
    inferTypes = true,
    missingValues = DEFAULT_MISSING_VALUES
  } = options;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const text = trimStrings ? value.trim() : value;
  if (emptyStringAsNull && text.trim() === '') return null;
  const missingMarkers = Array.isArray(missingValues) ? missingValues : [missingValues];
  if (missingMarkers.some(marker => String(marker).toLowerCase() === text.trim().toLowerCase())) return null;
  if (!inferTypes || text === '') return text;
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  // Keep leading-zero identifiers unchanged unless the caller explicitly casts them.
  if (!/^[-+]?0\d/.test(text) && NUMERIC_PATTERN.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) return number;
  }
  return text;
}

export function castValue(value, type, options = {}) {
  const target = normalizeTypeName(type);
  if (!target) throw new ValidationError(`Unsupported data type: ${type}`);
  if (['date', 'datetime', 'time'].includes(target) && options.format !== undefined) validateTemporalFormat(options.format, target);
  const normalized = normalizeValue(value, { ...(options.normalization ?? {}), ...options, inferTypes: false });
  if (normalized === null) return null;

  if (target === 'string') {
    if (normalized instanceof Date) return normalized.toISOString();
    if (typeof normalized === 'object') throw castError(value, type);
    return String(normalized);
  }
  if (target === 'number' || target === 'integer') {
    const number = typeof normalized === 'number'
      ? normalized
      : typeof normalized === 'string' && NUMERIC_PATTERN.test(normalized.trim())
        ? Number(normalized.trim())
        : Number.NaN;
    if (!Number.isFinite(number) || (target === 'integer' && !Number.isInteger(number))) throw castError(value, type);
    return number;
  }
  if (target === 'boolean') {
    if (typeof normalized === 'boolean') return normalized;
    if (normalized === 1 || normalized === '1' || (typeof normalized === 'string' && normalized.trim().toLowerCase() === 'true')) return true;
    if (normalized === 0 || normalized === '0' || (typeof normalized === 'string' && normalized.trim().toLowerCase() === 'false')) return false;
    throw castError(value, type);
  }
  if (['date', 'datetime', 'time'].includes(target)) {
    try { return castTemporal(normalized, target, options.format); }
    catch { throw castError(value, type); }
  }
  throw new ValidationError(`Unsupported data type: ${type}`);
}

export function inferType(values) {
  const present = values.filter(value => value !== null && value !== undefined);
  if (!present.length) return 'unknown';
  if (present.every(value => typeof value === 'boolean')) return 'boolean';
  if (present.every(value => typeof value === 'number' && Number.isFinite(value))) return present.every(Number.isInteger) ? 'integer' : 'number';
  if (present.every(value => value instanceof Date && !Number.isNaN(value.getTime()))) return 'date';
  const temporalType = inferTemporalType(present);
  if (temporalType) return temporalType;
  if (present.every(value => typeof value === 'string')) return 'string';
  return 'mixed';
}

export function cloneValue(value) {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  return value;
}

function normalizeTypeName(type) {
  const name = String(type ?? '').toLowerCase();
  if (['string', 'text'].includes(name)) return 'string';
  if (['number', 'float', 'decimal'].includes(name)) return 'number';
  if (['integer', 'int'].includes(name)) return 'integer';
  if (['boolean', 'bool'].includes(name)) return 'boolean';
  if (['date', 'datetime', 'time'].includes(name)) return name;
  return null;
}

function castError(value, type) {
  let rendered;
  try { rendered = JSON.stringify(value); }
  catch { rendered = String(value); }
  return new ValidationError(`Cannot cast ${rendered} to ${type}.`);
}
