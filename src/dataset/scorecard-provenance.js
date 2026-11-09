import { ValidationError } from '../errors/index.js';

const SCORECARD_CONTEXT = new WeakMap();

export function registerMetricScorecard(scorecard, { metricSet, dataset, baseline, groupBy }) {
  SCORECARD_CONTEXT.set(scorecard, Object.freeze({
    metricSet,
    dataset,
    baseline: baseline ?? null,
    groupBy: Object.freeze([...groupBy])
  }));
  return scorecard;
}

export function assertMetricScorecardContext(scorecard, { metricSet, dataset, baseline, groupBy }) {
  const provenance = SCORECARD_CONTEXT.get(scorecard);
  const sameGrouping = provenance && provenance.groupBy.length === groupBy.length
    && provenance.groupBy.every((column, index) => column === groupBy[index]);
  if (!provenance
    || provenance.metricSet !== metricSet
    || provenance.dataset !== dataset
    || provenance.baseline !== (baseline ?? null)
    || !sameGrouping) {
    throw new ValidationError('InsightSet precomputed scorecard must come directly from the supplied MetricSet for the same Dataset, baseline, and groupBy.');
  }
}
