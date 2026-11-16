import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, AnalysisResult } from '../src/index.js';

function longSales() {
  return createDataset([
    { month: 'Jan', product: 'A', revenue: 10 },
    { month: 'Jan', product: 'B', revenue: 20 },
    { month: 'Feb', product: 'A', revenue: 30 },
    { month: 'Feb', product: 'B', revenue: 40 },
    { month: 'Feb', product: 'A', revenue: 5 }
  ]);
}

test('pivot long-form to wide-form with duplicate-cell aggregation', () => {
  const result = longSales().pivot({ index: 'month', columns: 'product', values: 'revenue', agg: 'sum' });
  assert.equal(result instanceof AnalysisResult, true);
  assert.deepEqual(result.columns, ['month', 'A', 'B']);
  assert.deepEqual(result.rows, [
    { month: 'Jan', A: 10, B: 20 },
    { month: 'Feb', A: 35, B: 40 }
  ]);
});

test('pivot supports the full aggregation catalog and fill values', () => {
  const sparse = createDataset([
    { m: 'Jan', p: 'A', v: 10 },
    { m: 'Jan', p: 'B', v: 20 },
    { m: 'Feb', p: 'A', v: 30 }
  ]);
  const meanFill = sparse.pivot({ index: 'm', columns: 'p', values: 'v', agg: 'mean', fillValue: 0 });
  assert.deepEqual(meanFill.rows, [{ m: 'Jan', A: 10, B: 20 }, { m: 'Feb', A: 30, B: 0 }]);
  const counted = sparse.pivot({ index: 'm', columns: 'p', values: 'v', agg: 'count' });
  assert.deepEqual(counted.rows.map(r => r.A), [1, 1]);
  const q = sparse.pivot({ index: 'm', columns: 'p', values: 'v', agg: 'quantile', q: 0.5 });
  assert.deepEqual(q.rows.map(r => r.A), [10, 30]);
});

test('pivot validation and null handling', () => {
  assert.throws(() => longSales().pivot({ columns: 'product', values: 'revenue' }), /index/);
  assert.throws(() => longSales().pivot({ index: 'month', values: 'revenue' }), /columns field/);
  assert.throws(() => longSales().pivot({ index: 'month', columns: 'product' }), /values field/);
  assert.throws(() => longSales().pivot({ index: 'missing', columns: 'product', values: 'revenue' }), /Unknown index column/);
  assert.throws(() => longSales().pivot({ index: 'month', columns: 'missing', values: 'revenue' }), /Unknown pivot column/);
  assert.throws(() => longSales().pivot({ index: 'month', columns: 'product', values: 'revenue', agg: 'wat' }), /Unsupported pivot aggregation/);
  assert.throws(() => longSales().pivot({ index: 'month', columns: 'month', values: 'revenue' }), /must differ/);
  assert.throws(() => longSales().pivot({ index: 'month', columns: 'product', values: 'revenue', extra: 1 }), /does not support option/);
  // Null pivot values become their own column; null values aggregate as missing.
  const withNulls = createDataset([
    { m: 'Jan', p: null, v: 5 },
    { m: 'Jan', p: 'A', v: null }
  ]);
  const pivoted = withNulls.pivot({ index: 'm', columns: 'p', values: 'v' });
  assert.deepEqual(pivoted.columns, ['m', 'null', 'A']);
  assert.deepEqual(pivoted.rows, [{ m: 'Jan', null: 5, A: 0 }]);
});

test('melt wide-form to long-form (roadmap example shape)', () => {
  const wide = createDataset([
    { region: 'north', January: 10, February: 20, March: 30 },
    { region: 'south', January: 5, February: null, March: 15 }
  ]);
  const result = wide.melt({ idVars: ['region'], valueVars: ['January', 'February', 'March'], varName: 'month', valueName: 'sales' });
  assert.equal(result instanceof AnalysisResult, true);
  assert.deepEqual(result.columns, ['region', 'month', 'sales']);
  assert.deepEqual(result.rows, [
    { region: 'north', month: 'January', sales: 10 },
    { region: 'north', month: 'February', sales: 20 },
    { region: 'north', month: 'March', sales: 30 },
    { region: 'south', month: 'January', sales: 5 },
    { region: 'south', month: 'February', sales: null },
    { region: 'south', month: 'March', sales: 15 }
  ]);
  // Pivot of a melt round-trips the totals.
  const rePivoted = result.pivot({ index: 'region', columns: 'month', values: 'sales', agg: 'sum' });
  assert.deepEqual(rePivoted.rows.map(r => ({ ...r })), [
    { region: 'north', January: 10, February: 20, March: 30 },
    { region: 'south', January: 5, February: 0, March: 15 }
  ]);
});

test('melt defaults valueVars to complement of idVars', () => {
  const wide = createDataset([{ id: 1, a: 10, b: 20 }]);
  const result = wide.melt({ idVars: ['id'] });
  assert.deepEqual(result.rows, [
    { id: 1, variable: 'a', value: 10 },
    { id: 1, variable: 'b', value: 20 }
  ]);
  assert.throws(() => wide.melt({ idVars: ['missing'] }), /Unknown idVars column/);
  assert.throws(() => wide.melt({ idVars: ['id', 'a'], valueVars: ['a'] }), /must not overlap/);
  assert.throws(() => wide.melt({ idVars: ['id'], valueVars: [] }), /at least one value variable/);
  assert.throws(() => wide.melt({ idVars: ['id'], valueVars: ['a'], varName: 'id' }), /must be unique/);
  assert.throws(() => wide.melt({ idVars: ['id'], valueVars: ['a'], extra: 1 }), /does not support option/);
});

test('crosstab counts, percentages, and totals', () => {
  const d = createDataset([
    { region: 'north', product: 'A' },
    { region: 'north', product: 'A' },
    { region: 'north', product: 'B' },
    { region: 'south', product: 'B' }
  ]);
  const counts = d.crosstab('region', 'product');
  assert.equal(counts instanceof AnalysisResult, true);
  assert.deepEqual(counts.columns, ['region', 'A', 'B', 'All']);
  assert.deepEqual(counts.rows, [
    { region: 'north', A: 2, B: 1, All: 3 },
    { region: 'south', A: 0, B: 1, All: 1 },
    { region: 'All', A: 2, B: 2, All: 4 }
  ]);
  const rowPct = d.crosstab('region', 'product', { percentBy: 'row', totals: false });
  assert.deepEqual(rowPct.rows, [
    { region: 'north', A: 2 / 3, B: 1 / 3 },
    { region: 'south', A: 0, B: 1 }
  ]);
  const colPct = d.crosstab('region', 'product', { percentBy: 'column', totals: false });
  assert.deepEqual(colPct.rows, [
    { region: 'north', A: 1, B: 0.5 },
    { region: 'south', A: 0, B: 0.5 }
  ]);
  const totalPct = d.crosstab('region', 'product', { percentBy: 'total', totals: true });
  assert.deepEqual(totalPct.rows, [
    { region: 'north', A: 0.5, B: 0.25, All: 0.75 },
    { region: 'south', A: 0, B: 0.25, All: 0.25 },
    { region: 'All', A: 0.5, B: 0.5, All: 1 }
  ]);});

test('crosstab with a values column aggregates instead of counting', () => {
  const d = createDataset([
    { region: 'north', product: 'A', amount: 10 },
    { region: 'north', product: 'A', amount: 15 },
    { region: 'south', product: 'B', amount: 30 }
  ]);
  const summed = d.crosstab('region', 'product', { values: 'amount', agg: 'sum' });
  assert.deepEqual(summed.rows[0], { region: 'north', A: 25, B: 0, All: 25 });
  assert.throws(() => d.crosstab('region', 'product', { values: 'amount', agg: 'mean', percentBy: 'row' }), /percentages require/);
  assert.throws(() => d.crosstab('missing', 'product'), /Unknown crosstab/);
  assert.throws(() => d.crosstab('region', 'product', { percentBy: 'diagonal' }), /percentBy/);
  assert.throws(() => d.crosstab('region', 'product', { extra: true }), /does not support option/);
});

test('transpose exchanges rows and columns with a label column', () => {
  const d = createDataset([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
  const result = d.transpose();
  assert.equal(result instanceof AnalysisResult, true);
  assert.deepEqual(result.columns, ['field', '0', '1']);
  assert.deepEqual(result.rows, [
    { field: 'a', 0: 1, 1: 2 },
    { field: 'b', 0: 'x', 1: 'y' }
  ]);
  assert.throws(() => d.transpose({ labelColumn: '' }), /non-empty string/);
  assert.throws(() => d.transpose({ extra: 1 }), /does not support option/);
});

test('explode fans out arrays and preserves everything else', () => {
  const d = createDataset([
    { id: 1, tags: ['a', 'b'] },
    { id: 2, tags: [] },
    { id: 3, tags: null },
    { id: 4, tags: 'scalar' }
  ]);
  const result = d.explode('tags');
  assert.equal(result.length, 5);
  assert.deepEqual(result.rows.map(row => row.tags), ['a', 'b', null, null, 'scalar']);
  assert.deepEqual(result.rows.map(row => row.id), [1, 1, 2, 3, 4]);
  assert.throws(() => d.explode('missing'), /Unknown explode column/);
  assert.throws(() => d.explode(), /requires a column name/);
});

test('reshaping composes with the analysis, join, and window APIs', () => {
  const pivoted = longSales().pivot({ index: 'month', columns: 'product', values: 'revenue', agg: 'sum' });
  const chained = pivoted.analyze().orderBy('month', 'desc').limit(1).execute();
  // Descending lexical order puts 'Jan' after 'Feb'.
  assert.deepEqual(chained.rows, [{ month: 'Jan', A: 10, B: 20 }]);
  const joined = pivoted.innerJoin(createDataset([{ month: 'Jan', label: 'start' }]), { on: 'month' });
  assert.equal(joined.rows[0].label, 'start');
  const windowed = pivoted.window().cumulativeSum('A', { as: 'runningA' }).execute();
  assert.deepEqual(windowed.rows.map(row => row.runningA), [10, 45]);
  const meltedBack = pivoted.melt({ idVars: ['month'] });
  assert.deepEqual(meltedBack.columns, ['month', 'variable', 'value']);
  const lineage = pivoted.lineage();
  assert.equal(lineage.operation, 'pivot');
});

test('reshaping never mutates sources and handles empty datasets', () => {
  const source = longSales();
  const before = JSON.stringify(source.rows);
  source.pivot({ index: 'month', columns: 'product', values: 'revenue' });
  source.melt({ idVars: ['month'] });
  source.crosstab('month', 'product');
  source.transpose();
  assert.equal(JSON.stringify(source.rows), before);

  const empty = createDataset([], { columns: ['m', 'p', 'v'] });
  assert.deepEqual(empty.pivot({ index: 'm', columns: 'p', values: 'v' }).rows, []);
  assert.deepEqual(empty.melt({ idVars: ['m'] }).rows, []);
  assert.deepEqual(empty.crosstab('m', 'p').rows, [{ m: 'All', All: 0 }]);
  assert.deepEqual(empty.transpose().rows.map(r => r.field), ['m', 'p', 'v']);
  assert.deepEqual(empty.explode('p').rows, []);
});
