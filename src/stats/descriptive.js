const numeric = values => values.filter(v => typeof v === 'number' && Number.isFinite(v));
export function count(values) { return values.filter(v => v !== null && v !== undefined).length; }
export function sum(values) { return numeric(values).reduce((a, b) => a + b, 0); }
export function mean(values) { const a = numeric(values); return a.length ? sum(a) / a.length : null; }
export function median(values) { const a = numeric(values).sort((x,y)=>x-y); if (!a.length) return null; const m = Math.floor(a.length/2); return a.length % 2 ? a[m] : (a[m-1]+a[m])/2; }
export function min(values) { const a = numeric(values); return a.length ? Math.min(...a) : null; }
export function max(values) { const a = numeric(values); return a.length ? Math.max(...a) : null; }
export function range(values) { const lo=min(values), hi=max(values); return lo === null ? null : hi-lo; }
export function variance(values, ddof = 0) { const a=numeric(values); if (a.length <= ddof) return null; const avg=mean(a); return a.reduce((s,v)=>s+(v-avg)**2,0)/(a.length-ddof); }
export function std(values, ddof = 0) { const v=variance(values,ddof); return v === null ? null : Math.sqrt(v); }
export function describe(values) { return { count: count(values), missing: values.length-count(values), mean: mean(values), median: median(values), min: min(values), max: max(values), range: range(values), variance: variance(values), std: std(values) }; }
