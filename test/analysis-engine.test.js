import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, AnalysisResult, AnalysisBuilder, Dataset } from '../src/index.js';
import {
  sum, mean, average, median, min, max, count, countRows, nunique,
  variance, std, stddev, range, quantile, percentile, quartiles, iqr, mad, skewness, kurtosis
} from '../src/index.js';
import Numeriq from '../src/index.js';

function salesData() {
  return [
    { month: 'Jan', region: 'north', amount: 100, qty: 2 },
    { month: 'Jan', region: 'south', amount: 200, qty: 1 },
    { month: 'Feb', region: 'north', amount: 300, qty: 4 },
    { month: 'Feb', region: 'south', amount: 50, qty: 3 }
  ];
}

test('fluent analysis builder produces grouped aggregations as an AnalysisResult', () => {
  const sales = createDataset(salesData());
  const result = sales.analyze()
    .groupBy('month')
    .sum('amount', { as: 'totalSales' })
    .mean('amount', { as: 'averageSales' })
    .count()
    .execute();
  assert.equal(result instanceof AnalysisResult, true);
  assert.deepEqual(result.columns, ['month', 'totalSales', 'averageSales', 'count of rows']);
  assert.deepEqual(result.rows, [
    { month: 'Jan', totalSales: 300, averageSales: 150, 'count of rows': 2 },
    { month: 'Feb', totalSales: 350, averageSales: 175, 'count of rows': 2 }
  ]);
});

test('direct chaining with agg helpers works on Dataset and AnalysisResult', () => {
  const sales = createDataset(salesData());
  const fromDataset = sales.groupBy('region').agg({
    totalSales: sum('amount'),
    averageSales: mean('amount'),
    transactions: count()
  });
  assert.equal(fromDataset instanceof Dataset, true);
  assert.deepEqual(fromDataset.columns, ['region', 'totalSales', 'averageSales', 'transactions']);
  assert.equal(fromDataset.rows[0].transactions, 2);

  const derived = fromDataset.filter(row => row.totalSales > 0).toAnalysisResult();
  const fromResult = derived.groupBy('region').agg({ n: countRows() });
  assert.equal(fromResult instanceof AnalysisResult, true);
  assert.deepEqual(fromResult.rows, [{ region: 'north', n: 1 }, { region: 'south', n: 1 }]);
});

test('global aggregation without groupBy returns a single summary row', () => {
  const sales = createDataset(salesData());
  const result = sales.analyze()
    .sum('amount', { as: 'grandTotal' })
    .countRows({ as: 'n' })
    .nunique('region', { as: 'regions' })
    .execute();
  assert.deepEqual(result.rows, [{ grandTotal: 650, n: 4, regions: 2 }]);
  assert.deepEqual(result.shape, [1, 3]);
});

test('query operations: where/select/order/limit/offset/distinct/having compose', () => {
  const sales = createDataset(salesData());
  const result = sales.analyze()
    .where({ op: 'in', column: 'region', value: ['north', 'south'] })
    .groupBy('month')
    .sum('amount', { as: 'total' })
    .having({ op: 'gte', column: 'total', value: 300 })
    .orderBy('total', 'desc')
    .limit(1)
    .execute();
  assert.deepEqual(result.rows, [{ month: 'Feb', total: 350 }]);

  const paged = sales.analyze().where({ op: 'gte', column: 'amount', value: 100 })
    .orderBy('amount', 'desc').offset(1).limit(1).execute();
  assert.deepEqual(paged.rows.map(r => r.amount), [200]);

  const unique = sales.analyze().distinct('month').execute();
  assert.deepEqual(unique.rows, [{ month: 'Jan' }, { month: 'Feb' }]);

  const projected = sales.analyze().select('region', 'amount').execute();
  assert.deepEqual(projected.columns, ['region', 'amount']);
});

test('conditional aggregations with where filters contributing rows', () => {
  const sales = createDataset(salesData());
  const result = sales.analyze().groupBy('region')
    .sum('amount', { as: 'bigSales', where: { op: 'gte', column: 'amount', value: 100 } })
    .execute();
  assert.deepEqual(result.rows, [
    { region: 'north', bigSales: 400 },
    { region: 'south', bigSales: 200 }
  ]);
});

test('full aggregation function catalog with aliases and custom output names', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ v: i + 1 })); // 1..10
  const d = createDataset(rows);
  const result = d.analyze()
    .sum('v', { as: 's' })
    .mean('v', { as: 'm' })
    .average('v', { as: 'm2' })
    .median('v', { as: 'med' })
    .min('v', { as: 'lo' })
    .max('v', { as: 'hi' })
    .count()
    .countRows({ as: 'rows' })
    .nunique('v', { as: 'uniq' })
    .variance('v', { as: 'popVar' })
    .variance('v', { ddof: 1, as: 'sampleVar' })
    .std('v', { as: 'popStd' })
    .stddev('v', { ddof: 1, as: 'sampleStd' })
    .range('v', { as: 'rng' })
    .quantile('v', 0.25, { as: 'q25' })
    .percentile('v', 25, { as: 'p25' })
    .iqr('v', { as: 'iqrV' })
    .mad('v', { as: 'madV' })
    .skewness('v', { as: 'skewV' })
    .kurtosis('v', { as: 'kurtV' })
    .execute();
  const row = result.rows[0];
  assert.equal(row.s, 55);
  assert.equal(row.m, 5.5);
  assert.equal(row.m2, 5.5);
  assert.equal(row.med, 5.5);
  assert.equal(row.lo, 1);
  assert.equal(row.hi, 10);
  assert.equal(row['count of rows'], 10);
  assert.equal(row.rows, 10);
  assert.equal(row.uniq, 10);
  assert.equal(row.popVar, 8.25);
  assert.equal(row.sampleVar, 9.166666666666666);
  assert.equal(row.popStd, Math.sqrt(8.25));
  assert.equal(row.sampleStd, 3.0276503540974917);
  assert.equal(row.rng, 9);
  assert.equal(row.q25, 3.25);
  assert.equal(row.p25, 3.25);
  assert.equal(row.iqrV, 4.5);
  assert.equal(row.madV, 2.5);
  assert.equal(row.skewV, 0);
  assert.equal(row.kurtV, -1.2242424242424244);

  const quartileRow = d.analyze().quartiles('v', { as: 'qs' }).execute().rows[0];
  assert.deepEqual(quartileRow.qs, { q1: 3.25, median: 5.5, q3: 7.75 });
});

test('scalar Dataset methods keep their scalar return types', () => {
  const sales = createDataset(salesData());
  assert.equal(sales.sum('amount'), 650);
  assert.equal(sales.mean('amount'), 162.5);
  assert.equal(sales.min('amount'), 50);
  assert.equal(sales.max('amount'), 300);
  assert.equal(typeof sales.sum('amount'), 'number');
});

test('AnalysisResult does not expose Dataset-specific capabilities', () => {
  const result = createDataset(salesData()).analyze().groupBy('month').sum('amount').execute();
  assert.equal(result.profile, undefined);
  assert.equal(result.importReport, undefined);
  assert.equal(result.describe, undefined);
  assert.equal(result.info, undefined);
  assert.equal(result.metadata, undefined);
  assert.equal(result.name, undefined);
});

test('AnalysisResult exposes the required tabular surface', () => {
  const result = createDataset([{ a: 1, b: 'x' }, { a: 2, b: null }]).toAnalysisResult();
  assert.deepEqual(result.shape, [2, 2]);
  assert.equal(result.ndim, 2);
  assert.equal(result.size, 4);
  assert.equal(result.length, 2);
  assert.equal(result.empty, false);
  assert.deepEqual(result.index, [0, 1]);
  assert.deepEqual(result.columns, ['a', 'b']);
  assert.deepEqual(result.dtypes.a, 'integer');
  assert.deepEqual(result.schema.b.nullable, true);
  assert.deepEqual(result.head(1).rows, [{ a: 1, b: 'x' }]);
  assert.deepEqual(result.tail(1).rows, [{ a: 2, b: null }]);
  assert.deepEqual(result.select('a').columns, ['a']);
  assert.deepEqual(result.filter({ op: 'gt', column: 'a', value: 1 }).rows, [{ a: 2, b: null }]);
  assert.deepEqual(result.filter(row => row.a === 1).rows, [{ a: 1, b: 'x' }]);
  assert.deepEqual(result.sort('a', 'desc').rows.map(r => r.a), [2, 1]);
  assert.deepEqual(result.sortBy('a', 'desc').rows.map(r => r.a), [2, 1]);
  assert.deepEqual(result.limit(1).rows, [{ a: 1, b: 'x' }]);
  assert.deepEqual(result.distinct('a').length, 2);
  assert.equal(result.count(), 2);
  assert.equal(result.count('b'), 1);
  assert.deepEqual(result.toJSON(), { columns: ['a', 'b'], shape: [2, 2], rows: [{ a: 1, b: 'x' }, { a: 2, b: null }] });
  assert.deepEqual(result.toArray(), result.rows);
  assert.match(result.table(), /Showing 2 of 2 rows/);
});

test('AnalysisResult.operations are immutable and composable', () => {
  const source = createDataset(salesData());
  const first = source.analyze().groupBy('month').sum('amount', { as: 'total' }).execute();
  const before = JSON.stringify(first.rows);
  const second = first.filter({ op: 'gte', column: 'total', value: 350 });
  assert.equal(JSON.stringify(first.rows), before);
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  assert.deepEqual(second.rows, [{ month: 'Feb', total: 350 }]);
  assert.deepEqual(source.rows, salesData());
});

test('empty datasets and null values behave consistently', () => {
  const empty = createDataset([], { columns: ['a', 'b'] });
  const result = empty.analyze().groupBy('a').sum('a', { as: 's' }).execute();
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.shape, [0, 2]);
  assert.equal(result.empty, true);

  const globalEmpty = empty.analyze().sum('a', { as: 's' }).countRows({ as: 'n' }).execute();
  assert.deepEqual(globalEmpty.rows, [{ s: 0, n: 0 }]);

  const withNulls = createDataset([{ g: 'x', v: null }, { g: 'x', v: 5 }, { g: 'x', v: null }]);
  const nullResult = withNulls.analyze().groupBy('g')
    .sum('v', { as: 's' })
    .mean('v', { as: 'm' })
    .count('v', { as: 'c' })
    .countRows({ as: 'n' })
    .execute();
  assert.deepEqual(nullResult.rows, [{ g: 'x', s: 5, m: 5, c: 1, n: 3 }]);
});

test('table output defaults to 1000 rows with footer and validates maxRows', () => {
  const many = createDataset(Array.from({ length: 1200 }, (_, i) => ({ v: i }))).toAnalysisResult();
  assert.match(many.table(), /Showing 1000 of 1200 rows/);
  assert.match(many.table({ maxRows: 5 }), /Showing 5 of 1200 rows/);
  assert.match(many.table({ maxRows: Infinity }), /Showing 1200 of 1200 rows/);
  const tiny = createDataset([{ v: 1 }]).toAnalysisResult();
  assert.match(tiny.table(), /Showing 1 of 1 rows/);
  const empty = createDataset([], { columns: ['v'] }).toAnalysisResult();
  assert.match(empty.table(), /Showing 0 of 0 rows/);
  assert.throws(() => many.table({ maxRows: -1 }), /maxRows/);
  assert.throws(() => many.table({ maxRows: 1.5 }), /maxRows/);
  assert.throws(() => many.table({ maxRows: 'all' }), /maxRows/);
});

test('default and named exports expose the same API', () => {
  assert.equal(typeof Numeriq.createDataset, 'function');
  assert.equal(typeof Numeriq.AnalysisResult, 'function');
  assert.equal(typeof Numeriq.AnalysisBuilder, 'function');
  assert.equal(typeof Numeriq.sum, 'function');
  assert.equal(typeof Numeriq.kurtosis, 'function');
  assert.equal(Numeriq.createDataset, createDataset);
  const viaDefault = Numeriq.createDataset(salesData()).analyze().groupBy('month').sum('amount', { as: 't' }).execute();
  assert.equal(viaDefault instanceof AnalysisResult, true);
});

test('analysis documents serialize and replay', () => {
  const sales = createDataset(salesData());
  const original = sales.analyze()
    .where({ op: 'gte', column: 'amount', value: 50 })
    .groupBy('month')
    .sum('amount', { as: 'total' })
    .having({ op: 'gte', column: 'total', value: 300 })
    .orderBy('total', 'desc')
    .execute();
  const document = sales.analyze()
    .where({ op: 'gte', column: 'amount', value: 50 })
    .groupBy('month')
    .sum('amount', { as: 'total' })
    .having({ op: 'gte', column: 'total', value: 300 })
    .orderBy('total', 'desc')
    .toJSON();
  const rebuilt = AnalysisBuilder.fromJSON(document, sales.rows, sales.columns).execute();
  assert.deepEqual(rebuilt.rows, original.rows);
  assert.throws(() => sales.analyze().where(() => true).toJSON(), /cannot serialize function predicates/);
});

test('lineage tracks operations without copying the original dataset', () => {
  const sales = createDataset(salesData(), { name: 'Sales 2026' });
  const result = sales.analyze().groupBy('region').sum('amount', { as: 't' }).execute();
  const lineage = result.lineage();
  assert.equal(lineage.source, 'Sales 2026');
  assert.equal(lineage.operation, 'analyze');
  assert.deepEqual(lineage.steps.map(s => s.kind), ['group', 'aggregation']);
  const derived = result.filter({ op: 'gte', column: 't', value: 0 });
  assert.equal(derived.lineage().source, 'Sales 2026');
  assert.equal(result.history().operation, 'analyze');
});

test('groupBy errors are consistent between Dataset and AnalysisBuilder', () => {
  const sales = createDataset(salesData());
  assert.throws(() => sales.analyze().groupBy('missing'), /Unknown column/);
  assert.throws(() => sales.analyze().groupBy('month', 'month'), /unique/);
  assert.throws(() => sales.analyze().sum('missing'), /Unknown aggregation column/);
  assert.throws(() => sales.analyze().sum('amount').groupBy('month'), /can only be called once/);
  assert.throws(() => sales.analyze().where({ op: 'eq', column: 'missing', value: 1 }), /Unknown column/);
  assert.throws(() => sales.analyze().having({ op: 'eq', column: 'nope', value: 1 }).sum('amount').execute(), /unknown column/i);
});

test('GroupedDataset preserves legacy op names and default column naming', () => {
  const d = createDataset([{ k: 'x', n: 2 }, { k: 'x', n: 3 }]);
  const legacy = d.groupBy('k').agg([{ op: 'countRows' }, { op: 'sum', column: 'n' }, { op: 'mean', column: 'n' }]);
  assert.deepEqual(legacy.columns, ['k', 'count of rows', 'sum of n', 'mean of n']);
  assert.deepEqual(legacy.rows, [{ k: 'x', 'count of rows': 2, 'sum of n': 5, 'mean of n': 2.5 }]);
  const globalLegacy = d.groupBy().agg([{ op: 'countRows' }]);
  assert.deepEqual(globalLegacy.rows, [{ 'count of rows': 2 }]);
});
