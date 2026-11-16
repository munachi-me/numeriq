import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, AnalysisResult, WindowBuilder } from '../src/index.js';

function trend() {
  return createDataset([
    { region: 'north', date: '2026-01-01', amount: 100 },
    { region: 'north', date: '2026-02-01', amount: 200 },
    { region: 'north', date: '2026-03-01', amount: 150 },
    { region: 'south', date: '2026-01-01', amount: 50 },
    { region: 'south', date: '2026-02-01', amount: 75 }
  ]);
}

test('ranking functions with global ties (stable order)', () => {
  const d = createDataset([{ s: 10 }, { s: 20 }, { s: 20 }, { s: 30 }]);
  const result = d.window().orderBy('s')
    .rank({ as: 'r' })
    .denseRank({ as: 'dr' })
    .rowNumber({ as: 'rn' })
    .percentRank({ as: 'pr' })
    .cumeDist({ as: 'cd' })
    .ntile(2, { as: 'nt' })
    .execute();
  assert.deepEqual(result.rows.map(row => row.r), [1, 2, 2, 4]);
  assert.deepEqual(result.rows.map(row => row.dr), [1, 2, 2, 3]);
  assert.deepEqual(result.rows.map(row => row.rn), [1, 2, 3, 4]);
  assert.deepEqual(result.rows.map(row => row.pr), [0, 1 / 3, 1 / 3, 1]);
  assert.deepEqual(result.rows.map(row => row.cd), [0.25, 0.75, 0.75, 1]);
  assert.deepEqual(result.rows.map(row => row.nt), [1, 1, 2, 2]);
});

test('calculations respect partitions; output stays in source order', () => {
  const result = trend().window()
    .partitionBy('region')
    .orderBy('date')
    .rowNumber({ as: 'rn' })
    .rank({ as: 'r' })
    .percentRank({ as: 'pr' })
    .cumeDist({ as: 'cd' })
    .execute();
  assert.equal(result instanceof AnalysisResult, true);
  assert.deepEqual(result.rows.map(row => [row.region, row.date, row.rn]), [
    ['north', '2026-01-01', 1], ['north', '2026-02-01', 2], ['north', '2026-03-01', 3],
    ['south', '2026-01-01', 1], ['south', '2026-02-01', 2]
  ]);
  assert.deepEqual(result.rows.map(row => row.pr), [0, 1, 0, 0.5, 1].slice(0, 5).map((v, i) => i < 3 ? [0, 0.5, 1][i] : [0, 1][i - 3]));
  assert.deepEqual(result.rows.map(row => row.cd), [1 / 3, 2 / 3, 1, 0.5, 1]);
});

test('offset functions: lag/lead with offsets and defaults, first/last/nth values', () => {
  const result = trend().window()
    .partitionBy('region').orderBy('date')
    .lag('amount', { as: 'prev' })
    .lag('amount', { offset: 2, default: 0, as: 'prev2' })
    .lead('amount', { as: 'next' })
    .lead('amount', { offset: 5, default: -1, as: 'far' })
    .firstValue('amount', { as: 'first' })
    .lastValue('amount', { as: 'last' })
    .nthValue('amount', { n: 2, as: 'second' })
    .execute();
  const north = result.rows.slice(0, 3), south = result.rows.slice(3);
  assert.deepEqual(north.map(row => row.prev), [null, 100, 200]);
  assert.deepEqual(north.map(row => row.prev2), [0, 0, 100]);
  assert.deepEqual(north.map(row => row.next), [200, 150, null]);
  assert.deepEqual(north.map(row => row.far), [-1, -1, -1]);
  assert.deepEqual(north.map(row => row.first), [100, 100, 100]);
  assert.deepEqual(north.map(row => row.last), [150, 150, 150]);
  assert.deepEqual(north.map(row => row.second), [null, 200, 200]);
  assert.deepEqual(south.map(row => row.prev), [null, 50, null].slice(0, 2));
});

test('cumulative functions including null handling', () => {
  const d = createDataset([{ v: 1 }, { v: null }, { v: 2 }, { v: 3 }]);
  const result = d.window()
    .cumulativeSum('v', { as: 'cs' })
    .cumulativeCount('v', { as: 'cc' })
    .cumulativeMean('v', { as: 'cm' })
    .cumulativeMin('v', { as: 'cmin' })
    .cumulativeMax('v', { as: 'cmax' })
    .execute();
  assert.deepEqual(result.rows.map(row => row.cs), [1, 1, 3, 6]);
  assert.deepEqual(result.rows.map(row => row.cc), [1, 1, 2, 3]);
  assert.deepEqual(result.rows.map(row => row.cm), [1, 1, 1.5, 2]);
  assert.deepEqual(result.rows.map(row => row.cmin), [1, 1, 1, 1]);
  assert.deepEqual(result.rows.map(row => row.cmax), [1, 1, 2, 3]);
});

test('rolling calculations with window and minPeriods options', () => {
  const d = createDataset([{ v: 100 }, { v: 200 }, { v: 150 }]);
  const strict = d.window()
    .rollingMean('v', { window: 3, as: 'm3' })
    .rollingSum('v', { window: 2, as: 's2' })
    .rollingMin('v', { window: 2, as: 'min2' })
    .rollingMax('v', { window: 2, as: 'max2' })
    .rollingStd('v', { window: 3, minPeriods: 3, as: 'sd3' })
    .execute();
  assert.deepEqual(strict.rows.map(row => row.m3), [null, null, 150]);
  assert.deepEqual(strict.rows.map(row => row.s2), [null, 300, 350]);
  assert.deepEqual(strict.rows.map(row => row.min2), [null, 100, 150]);
  assert.deepEqual(strict.rows.map(row => row.max2), [null, 200, 200]);
  assert.ok(Math.abs(strict.rows[2].sd3 - Math.sqrt((50 ** 2 + 50 ** 2) / 3)) < 1e-12);
  const loose = d.window().rollingMean('v', { window: 2, minPeriods: 1, as: 'm2' }).execute();
  assert.deepEqual(loose.rows.map(row => row.m2), [100, 150, 175]);
});

test('time-based analytics: pctChange/growthRate with zero and null protection', () => {
  const d = createDataset([{ v: 100 }, { v: 200 }, { v: 150 }, { v: 0 }, { v: 30 }]);
  const result = d.window().pctChange('v', { as: 'chg' }).execute();
  // A drop to zero is a defined -100% change; only a zero previous value is undefined.
  assert.deepEqual(result.rows.map(row => row.chg), [null, 1, -0.25, -1, null]);
  const two = d.window().pctChange('v', { periods: 2, as: 'chg2' }).execute();
  assert.deepEqual(two.rows.map(row => row.chg2), [null, null, 0.5, -1, -0.8]);
  const growth = d.window().growthRate('v', { as: 'g' }).execute();
  assert.deepEqual(growth.rows.map(row => row.g), result.rows.map(row => row.chg));
});

test('multiple partition and order columns with desc and null ordering', () => {
  const d = createDataset([
    { g: 'a', s: 2, v: 'a2' },
    { g: 'a', s: 1, v: 'a1' },
    { g: 'b', s: null, v: 'b-null' },
    { g: 'b', s: 5, v: 'b5' }
  ]);
  const result = d.window()
    .partitionBy('g')
    .orderBy('s', 'desc')
    .rowNumber({ as: 'rn' })
    .execute();
  // Nulls sort last within each partition; output order unchanged.
  assert.deepEqual(result.rows.map(row => row.v), ['a2', 'a1', 'b-null', 'b5']);
  assert.deepEqual(result.rows.map(row => row.rn), [1, 2, 2, 1]);
});

test('ISO date strings order chronologically', () => {
  const d = createDataset([
    { date: '2026-03-01', v: 'mar' },
    { date: '2026-01-01', v: 'jan' },
    { date: '2026-02-01', v: 'feb' }
  ]);
  const result = d.window().orderBy('date').lag('v', { as: 'prev' }).execute();
  // Output order is unchanged (mar, jan, feb); lag follows chronological order.
  assert.deepEqual(result.rows.map(row => row.prev), ['feb', null, 'jan']);
});

test('partitioning without ordering keeps partition rows in source order', () => {
  const d = createDataset([{ g: 'a', v: 1 }, { g: 'b', v: 2 }, { g: 'a', v: 3 }]);
  const result = d.window().partitionBy('g').firstValue('v', { as: 'first' }).execute();
  assert.deepEqual(result.rows.map(row => row.first), [1, 2, 1]);
});

test('window functions never remove rows and never mutate the source', () => {
  const source = trend();
  const before = JSON.stringify(source.rows);
  const result = source.window().partitionBy('region').orderBy('date')
    .rowNumber().cumulativeSum('amount').execute();
  assert.equal(result.length, 5);
  assert.equal(result.columns.length, 5);
  assert.equal(JSON.stringify(source.rows), before);
  assert.deepEqual(source.columns, ['region', 'date', 'amount']);
});

test('window results compose with the analysis and join APIs', () => {
  const windowed = trend().window().partitionBy('region').orderBy('date')
    .cumulativeSum('amount', { as: 'running' }).execute();
  const chained = windowed.analyze()
    .where({ op: 'gte', column: 'running', value: 100 })
    .groupBy('region')
    .max('running', { as: 'peak' })
    .execute();
  assert.deepEqual(chained.rows, [
    { region: 'north', peak: 450 },
    { region: 'south', peak: 125 }
  ]);
  const joined = windowed.innerJoin(createDataset([{ region: 'north', label: 'N' }]), { on: 'region' });
  assert.equal(joined.length, 3);
  assert.equal(joined.rows[0].label, 'N');
});

test('declarative configuration: seed, toJSON, and fromJSON round-trip', () => {
  const source = trend();
  const doc = source.window().partitionBy('region').orderBy('date')
    .rowNumber({ as: 'rn' })
    .lag('amount', { as: 'prev' })
    .toJSON();
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.partitionBy, ['region']);
  assert.deepEqual(doc.functions.map(f => f.kind), ['rowNumber', 'lag']);
  const seeded = source.window(doc).execute();
  const rebuilt = WindowBuilder.fromJSON(doc, source.rows, source.columns).execute();
  assert.deepEqual(seeded.rows, rebuilt.rows);
  assert.deepEqual(seeded.rows.map(row => row.rn), [1, 2, 3, 1, 2]);
  assert.throws(() => WindowBuilder.fromJSON({ version: 99 }, [], []), /Unsupported window document version/);
});

test('empty datasets and validation errors behave correctly', () => {
  const empty = createDataset([], { columns: ['a'] });
  const result = empty.window().rowNumber().cumulativeSum('a').execute();
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.shape, [0, 3]); // 'a' + row_number + cumulative sum of a

  const d = trend();
  assert.throws(() => d.window().rowNumber({ as: 'amount' }).execute(), /must be unique/);
  assert.throws(() => d.window().partitionBy('missing'), /Unknown column/);
  assert.throws(() => d.window().orderBy('missing'), /Unknown column/);
  assert.throws(() => d.window().lag('missing'), /Unknown column/);
  assert.throws(() => d.window().rowNumber({ as: '' }), /non-empty string/);
  assert.throws(() => d.window().lag('amount', { offset: 0 }), /positive integer/);
  assert.throws(() => d.window().lead('amount', { offset: 1.5 }), /positive integer/);
  assert.throws(() => d.window().ntile(0), /positive integer/);
  assert.throws(() => d.window().nthValue('amount', { n: 0 }), /positive integer/);
  assert.throws(() => d.window().rollingMean('amount', { window: 0 }), /positive integer/);
  assert.throws(() => d.window().rollingMean('amount', { window: 2, minPeriods: 0 }), /positive integer/);
  assert.throws(() => d.window().orderBy('date', 'sideways'), /'asc' or 'desc'/);
  assert.throws(() => d.window({ unknown: true }), /does not support option/);
  assert.throws(() => d.window({ partitionBy: ['missing'] }), /Unknown column/);
  assert.throws(() => d.window({ functions: [{ kind: 'wat' }] }), /Unsupported window function/);
  assert.throws(() => d.window({ orderBy: [42] }), /column names or/);
});
