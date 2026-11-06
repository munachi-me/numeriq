import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, createPipeline, Series, statistics } from '../src/index.js';
import { ValidationError } from '../src/errors/index.js';

const closeTo = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);

test('quantile and percentile use linear interpolation by default and support named interpolation methods', () => {
  const values = [1, 2, 3, 4];
  assert.equal(statistics.quantile(values, 0.25), 1.75);
  assert.equal(statistics.quantile(values, 0.25, { method: 'lower' }), 1);
  assert.equal(statistics.quantile(values, 0.25, { method: 'higher' }), 2);
  assert.equal(statistics.quantile(values, 0.25, { method: 'midpoint' }), 1.5);
  assert.equal(statistics.quantile(values, 0.25, { method: 'nearest' }), 2);
  assert.equal(statistics.percentile(values, 90), 3.7);
  assert.equal(statistics.quantile([1, null, 3, 'not numeric'], 0.5), 2);
  assert.equal(statistics.quantile([null, 'x'], 0.5), null);
  assert.equal(statistics.percentile(values, 0), 1);
  assert.equal(statistics.percentile(values, 100), 4);
});

test('Dataset and Series expose quantiles, quartiles, IQR, and median absolute deviation', () => {
  const dataset = createDataset([{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: null }]);
  const series = dataset.column('x');
  assert.equal(dataset.quantile('x', 0.25), 1.75);
  assert.equal(dataset.percentile('x', 90), 3.7);
  assert.deepEqual(dataset.quartiles('x'), { q1: 1.75, median: 2.5, q3: 3.25 });
  assert.equal(dataset.iqr('x'), 1.5);
  assert.equal(dataset.mad('x'), 1);
  assert.equal(series.quantile(0.25), 1.75);
  assert.equal(series.percentile(90), 3.7);
  assert.deepEqual(series.quartiles(), { q1: 1.75, median: 2.5, q3: 3.25 });
  assert.equal(series.iqr(), 1.5);
  assert.equal(series.mad(), 1);
});

test('skewness and Fisher excess kurtosis use population moments and return null for insufficient or constant data', () => {
  assert.equal(statistics.skewness([1, 2, 3]), 0);
  closeTo(statistics.kurtosis([1, 2, 3, 4]), -1.36);
  assert.equal(statistics.skewness([1, 2]), null);
  assert.equal(statistics.kurtosis([1, 2, 3]), null);
  assert.equal(statistics.skewness([5, 5, 5]), null);
  assert.equal(statistics.kurtosis([5, 5, 5, 5]), null);
  assert.equal(statistics.skewness([1, 2, null, 'x', 3]), 0);
  assert.equal(statistics.kurtosis([1, 2, 3, 4, null]), statistics.kurtosis([1, 2, 3, 4]));
});

test('describe adds robust quantile and distribution-shape fields while keeping nonnumeric statistics null', () => {
  const dataset = createDataset([
    { amount: 1, label: 'a' }, { amount: 2, label: 'a' }, { amount: 3, label: 'b' }, { amount: 4, label: null }
  ]);
  const described = dataset.describe();
  assert.deepEqual(described.columns.slice(-6), ['q1', 'q3', 'iqr', 'mad', 'skewness', 'kurtosis']);
  const amount = described.rows.find(row => row.column === 'amount');
  assert.deepEqual([amount.q1, amount.q3, amount.iqr, amount.mad, amount.skewness, amount.kurtosis], [1.75, 3.25, 1.5, 1, 0, -1.36]);
  const label = described.rows.find(row => row.column === 'label');
  assert.deepEqual([label.q1, label.q3, label.iqr, label.mad, label.skewness, label.kurtosis], [null, null, null, null, null, null]);
  const oneColumn = dataset.describe('amount');
  assert.equal(oneColumn.iqr, 1.5);
});

test('describe computes numeric summaries from mixed numeric/text columns', () => {
  const dataset = createDataset([{ mixed: 1 }, { mixed: 2 }, { mixed: 'bad' }, { mixed: null }]);
  const summary = dataset.describe('mixed');
  assert.equal(summary.count, 3);
  assert.equal(summary.distinct, 3);
  assert.equal(summary.mean, 1.5);
  assert.equal(summary.variance, 0.25);
  assert.equal(summary.q1, 1.25);
  assert.equal(summary.q3, 1.75);
  assert.equal(summary.skewness, null);
  const categorical = createDataset([{ label: 'a' }, { label: 'b' }]).describe('label');
  assert.equal(categorical.mean, null);
  assert.equal(categorical.iqr, null);
});

test('covariance and Pearson correlation use pairwise-complete numeric observations and validate lengths', () => {
  const dataset = createDataset([
    { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }, { x: null, y: 8 }, { x: 4, y: null }
  ]);
  assert.equal(dataset.covariance('x', 'y'), 4 / 3);
  assert.equal(dataset.covariance('x', 'y', { ddof: 1 }), 2);
  assert.equal(dataset.correlation('x', 'y'), 1);
  assert.equal(statistics.covariance([1, 2, 3], [2, 4, 6], { ddof: 1 }), 2);
  assert.equal(statistics.correlation([1, 2, 3], [6, 4, 2]), -1);
  assert.equal(statistics.correlation([1, 1, 1], [2, 3, 4]), null);
  assert.equal(statistics.covariance([1, null, 3], [2, 4, 6]), 2);
});

test('Spearman correlation ranks ties by their average ranks', () => {
  const x = new Series('x', [1, 1, 2, 2]);
  const y = new Series('y', [10, 10, 20, 20]);
  assert.equal(x.correlation(y, { method: 'spearman' }), 1);
  assert.equal(x.covariance(y), 2.5);
  assert.equal(createDataset([{ x: 1, y: 10 }, { x: 1, y: 10 }, { x: 2, y: 20 }, { x: 2, y: 20 }]).correlation('x', 'y', { method: 'spearman' }), 1);
});

test('Dataset and Series Z-score transformations are immutable and null-safe', () => {
  const source = createDataset([{ x: 1 }, { x: 2 }, { x: 3 }, { x: null }]);
  const output = source.zScore('x', { as: 'standardized', ddof: 1 });
  assert.deepEqual(output.rows.map(row => row.standardized), [-1, 0, 1, null]);
  assert.deepEqual(source.columns, ['x']);
  const seriesScores = source.column('x').zScores({ as: 'z', ddof: 1 });
  assert.equal(seriesScores.name, 'z');
  assert.deepEqual(seriesScores.values, [-1, 0, 1, null]);

  const robustSource = createDataset([{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 100 }, { x: null }]);
  const robustScores = robustSource.modifiedZScore('x');
  assert.equal(robustScores.columns.at(-1), 'x_modified_zscore');
  closeTo(robustScores.rows[4].x_modified_zscore, 65.4255057690, 1e-8);
  assert.equal(robustSource.column('x').modifiedZScores().values[5], null);

  const constant = createDataset([{ x: 5 }, { x: 5 }, { x: null }]);
  assert.deepEqual(constant.zScore('x').rows.map(row => row.x_zscore), [null, null, null]);
  assert.deepEqual(constant.modifiedZScore('x').rows.map(row => row.x_modified_zscore), [null, null, null]);
  assert.throws(() => source.zScore('x', { as: 'x' }), /already exists/);
});

test('Z-score column operations serialize and replay in transformation pipelines', () => {
  const source = createDataset([{ value: 1 }, { value: 2 }, { value: 3 }]);
  const pipeline = createPipeline([
    { op: 'zScore', column: 'value', options: { as: 'standard_score', ddof: 1 } },
    { op: 'modifiedZScore', column: 'value', options: { as: 'robust_score' } }
  ]);
  const result = pipeline.run(source).dataset;
  assert.deepEqual(result.rows.map(row => [row.standard_score, row.robust_score]), [[-1, -0.6744897501960817], [0, 0], [1, 0.6744897501960817]]);
  const restored = createPipeline(JSON.parse(JSON.stringify(pipeline))).run(source).dataset;
  assert.deepEqual(restored.rows, result.rows);
});

test('IQR outlier behavior remains compatible and z-score methods are opt-in', () => {
  const source = createDataset([{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }, { x: 1000 }, { x: null }]);
  const iqrFlag = source.flagOutliers('x');
  assert.deepEqual(iqrFlag.rows.map(row => row.x_outlier), [false, false, false, false, false, true, null]);
  const zFlag = source.flagOutliers('x', { method: 'zscore', threshold: 1.5 });
  assert.deepEqual(zFlag.rows.map(row => row.x_outlier), [false, false, false, false, false, true, null]);
  const modifiedFlag = source.flagOutliers('x', { method: 'modifiedZScore' });
  assert.deepEqual(modifiedFlag.rows.map(row => row.x_outlier), [false, false, false, false, false, true, null]);
  const constant = createDataset([{ x: 2 }, { x: 2 }]).flagOutliers('x', { method: 'zscore' });
  assert.deepEqual(constant.rows.map(row => row.x_outlier), [false, false]);
  const zeroMad = createDataset([{ x: 1 }, { x: 1 }, { x: 1 }, { x: 1 }, { x: 100 }]);
  assert.deepEqual(zeroMad.column('x').modifiedZScores().values, [null, null, null, null, null]);
  assert.deepEqual(zeroMad.flagOutliers('x', { method: 'modifiedZScore' }).rows.map(row => row.x_outlier), [false, false, false, false, true]);
});

test('grouped advanced statistics support q, interpolation, and robust moment operations', () => {
  const grouped = createDataset([{ group: 'A', x: 1 }, { group: 'A', x: 2 }, { group: 'A', x: 3 }, { group: 'A', x: 4 }])
    .groupBy('group')
    .agg([
      { op: 'quantile', column: 'x', q: 0.9 },
      { op: 'quantile', column: 'x', q: 0.25, method: 'lower', as: 'q1 lower' },
      { op: 'iqr', column: 'x' }, { op: 'mad', column: 'x' },
      { op: 'skewness', column: 'x' }, { op: 'kurtosis', column: 'x' }
    ]);
  assert.deepEqual(grouped.columns, ['group', 'quantile 0.9 of x', 'q1 lower', 'iqr of x', 'mad of x', 'skewness of x', 'kurtosis of x']);
  closeTo(grouped.rows[0]['quantile 0.9 of x'], 3.7);
  assert.deepEqual(grouped.rows[0], {
    group: 'A', 'quantile 0.9 of x': 3.7, 'q1 lower': 1, 'iqr of x': 1.5,
    'mad of x': 1, 'skewness of x': 0, 'kurtosis of x': -1.36
  });
});

test('advanced statistics validate probabilities, methods, paired lengths, and ddof', () => {
  assert.throws(() => statistics.quantile([1, 2], -0.1), ValidationError);
  assert.throws(() => statistics.percentile([1, 2], 101), /between 0 and 100/);
  assert.throws(() => statistics.quantile([1, 2], 0.5, { method: 'cubic' }), /Unsupported quantile method/);
  assert.throws(() => statistics.quantile([1], 0.5, null), /options must be an object/);
  assert.throws(() => statistics.variance([1, 2], -1), /ddof/);
  assert.throws(() => statistics.covariance([1, 2], [1]), /equal length/);
  assert.throws(() => statistics.correlation([1], [1], { method: 'kendall' }), /pearson.*spearman/);
  assert.throws(() => statistics.zScores([1, 2], { ddof: 1, extras: true }), /does not support option/);
  assert.throws(() => new Series('x', [1, 2]).correlation([1]), /equal length/);
  assert.throws(() => createDataset([{ x: 1 }]).flagOutliers('x', { method: 'zscore', threshold: 0 }), /positive finite/);
  assert.throws(() => createDataset([{ x: 1 }]).flagOutliers('x', { method: 'iqr', threshold: 2 }), /only available/);
  assert.throws(() => createDataset([{ x: 1 }]).groupBy('x').agg([{ op: 'quantile', column: 'x' }]), /requires q/);
  assert.throws(() => createDataset([{ x: 1 }]).groupBy('x').agg([{ op: 'sum', column: 'x', q: 0.5 }]), /does not accept q/);
});
