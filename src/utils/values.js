export function normalizeValue(value, options = {}) {
  const { trimStrings = true, emptyStringAsNull = true, inferTypes = true, missingValues = ['null', 'undefined', 'n/a', 'na'] } = options;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const text = trimStrings ? value.trim() : value;
  if (emptyStringAsNull && text === '') return null;
  if (missingValues.some(v => String(v).toLowerCase() === text.toLowerCase())) return null;
  if (!inferTypes || text === '') return text;
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  // Do not coerce strings with leading zeroes: they may be identifiers.
  if (!/^[-+]?0\d/.test(text) && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text)) {
    const n = Number(text); if (Number.isFinite(n)) return n;
  }
  return text;
}

export function inferType(values) {
  const present = values.filter(v => v !== null && v !== undefined);
  if (!present.length) return 'unknown';
  if (present.every(v => typeof v === 'boolean')) return 'boolean';
  if (present.every(v => typeof v === 'number' && Number.isFinite(v))) return present.every(Number.isInteger) ? 'integer' : 'number';
  if (present.every(v => v instanceof Date && !Number.isNaN(v.getTime()))) return 'date';
  if (present.every(v => typeof v === 'string')) return 'string';
  return 'mixed';
}

export function cloneValue(value) {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneValue(v)]));
  return value;
}
