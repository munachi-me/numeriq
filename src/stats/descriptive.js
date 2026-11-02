import { inferType } from '../utils/values.js';

const numeric = values => values.filter(v => typeof v === 'number' && Number.isFinite(v));
const nonMissing = values => values.filter(v => v !== null && v !== undefined);
const distinctKey = value => {
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (value && typeof value === 'object') return `object:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value)}`;
};

export function count(values) { return nonMissing(values).length; }
export function sum(values) { return numeric(values).reduce((a, b) => a + b, 0); }
export function mean(values) { const a = numeric(values); return a.length ? sum(a) / a.length : null; }
export function median(values) { const a = numeric(values).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
export function min(values) { const a = numeric(values); return a.length ? Math.min(...a) : null; }
export function max(values) { const a = numeric(values); return a.length ? Math.max(...a) : null; }
export function range(values) { const lo = min(values), hi = max(values); return lo === null ? null : hi - lo; }
export function variance(values, ddof = 0) { const a = numeric(values); if (a.length <= ddof) return null; const avg = mean(a); return a.reduce((s, v) => s + (v - avg) ** 2, 0) / (a.length - ddof); }
export function std(values, ddof = 0) { const v = variance(values, ddof); return v === null ? null : Math.sqrt(v); }

export function describe(values) {
  const present = nonMissing(values);
  const summary = {
    count: present.length,
    missing: values.length - present.length,
    distinct: new Set(present.map(distinctKey)).size,
    mean: null,
    median: null,
    min: null,
    max: null,
    range: null,
    variance: null,
    std: null
  };
  const type = inferType(present);
  if (!['integer', 'number'].includes(type)) return summary;
  return {
    ...summary,
    mean: mean(present),
    median: median(present),
    min: min(present),
    max: max(present),
    range: range(present),
    variance: variance(present),
    std: std(present)
  };
}
