import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, createPipeline, GroupedDataset } from '../src/index.js';

const data = () => createDataset([
  { category: 'A', product: 'pen', price: 2, quantity: 3, active: true },
  { category: 'B', product: 'book', price: 10, quantity: 1, active: true },
  { category: 'A', product: 'pen', price: 4, quantity: 2, active: false },
  { category: 'A', product: 'pad', price: null, quantity: 4, active: null },
  { category: null, product: null, price: 8, quantity: null, active: false },
  { category: 'B', product: 'book', price: 12, quantity: 1, active: true }
]);

test('groupBy aggregates in first-seen order with default human-readable names', () => {
  const source = data();
  const grouped = source.groupBy('category');
  assert.equal(grouped instanceof GroupedDataset, true);
  assert.deepEqual(grouped.keys, ['category']);
  const result = grouped.agg([
    { op: 'countRows' },
    { op: 'count', column: 'price' },
    { op: 'nunique', column: 'product' },
    { op: 'sum', column: 'price' },
    { op: 'mean', column: 'price' }
  ]);
  assert.deepEqual(result.columns, ['category', 'count of rows', 'count of price', 'distinct count of product', 'sum of price', 'mean of price']);
  assert.deepEqual(result.rows, [
    { category: 'A', 'count of rows': 3, 'count of price': 2, 'distinct count of product': 2, 'sum of price': 6, 'mean of price': 3 },
    { category: 'B', 'count of rows': 2, 'count of price': 2, 'distinct count of product': 1, 'sum of price': 22, 'mean of price': 11 },
    { category: null, 'count of rows': 1, 'count of price': 1, 'distinct count of product': 0, 'sum of price': 8, 'mean of price': 8 }
  ]);
  assert.deepEqual(source.shape, [6, 5]);
});

test('aggregation aliases can be selected by name/as/alias or output-name mapping', () => {
  const listForm = data().groupBy('category').agg([
    { op: 'sum', column: 'price', name: 'Revenue' },
    { op: 'mean', column: 'quantity', as: 'Average units' },
    { op: 'nunique', column: 'product', alias: 'Products' }
  ]);
  assert.deepEqual(listForm.columns, ['category', 'Revenue', 'Average units', 'Products']);
  const objectForm = data().groupBy('category').aggregate({
    Revenue: { op: 'sum', column: 'price' },
    Orders: { op: 'countRows' }
  });
  assert.deepEqual(objectForm.columns, ['category', 'Revenue', 'Orders']);
  assert.equal(objectForm.rows[0].Revenue, 6);
  assert.deepEqual(createDataset([{ category: 'x', prices: 5 }]).groupBy('category').agg([{ op: 'sum', column: 'prices' }]).columns, ['category', 'sum of prices']);
});

test('all requested statistical aggregations reuse finite-numeric and null conventions', () => {
  const summary = data().groupBy('category').agg([
    { op: 'sum', column: 'price', as: 'sum' },
    { op: 'mean', column: 'price', as: 'mean' },
    { op: 'median', column: 'price', as: 'median' },
    { op: 'min', column: 'price', as: 'min' },
    { op: 'max', column: 'price', as: 'max' },
    { op: 'range', column: 'price', as: 'range' },
    { op: 'variance', column: 'price', as: 'variance' },
    { op: 'std', column: 'price', as: 'std' }
  ]);
  assert.deepEqual(summary.rows[0], {
    category: 'A', sum: 6, mean: 3, median: 3, min: 2, max: 4, range: 2, variance: 1, std: 1
  });
  const sampleVariance = data().groupBy('category').agg([{ op: 'variance', column: 'price', ddof: 1, as: 'sample variance' }]);
  assert.equal(sampleVariance.rows[0]['sample variance'], 2);
  const textOnly = createDataset([{ group: 'x', value: 'a' }, { group: 'x', value: null }]).groupBy('group').agg([
    { op: 'sum', column: 'value', as: 'sum' }, { op: 'mean', column: 'value', as: 'mean' },
    { op: 'count', column: 'value', as: 'count' }, { op: 'nunique', column: 'value', as: 'distinct' }
  ]);
  assert.deepEqual(textOnly.rows, [{ group: 'x', sum: 0, mean: null, count: 1, distinct: 1 }]);
});

test('multi-key grouping uses typed keys, preserves first-seen group order, and supports global/empty aggregation', () => {
  const multi = createDataset([
    { year: 2025, month: 1, n: 2 }, { year: 2025, month: 2, n: 3 },
    { year: 2025, month: 1, n: 4 }, { year: 2026, month: 1, n: 5 }
  ]).groupBy(['year', 'month']).agg({ total: { op: 'sum', column: 'n' } });
  assert.deepEqual(multi.rows, [
    { year: 2025, month: 1, total: 6 },
    { year: 2025, month: 2, total: 3 },
    { year: 2026, month: 1, total: 5 }
  ]);
  const global = createDataset([{ n: 2 }, { n: 3 }]).groupBy().agg([{ op: 'countRows' }, { op: 'sum', column: 'n', as: 'sum' }]);
  assert.deepEqual(global.rows, [{ 'count of rows': 2, sum: 5 }]);
  const emptyGrouped = createDataset([{ k: 'x', n: 1 }]).filter(() => false).groupBy('k').agg([{ op: 'countRows' }, { op: 'mean', column: 'n' }]);
  assert.deepEqual(emptyGrouped.columns, ['k', 'count of rows', 'mean of n']);
  assert.deepEqual(emptyGrouped.rows, []);
  const emptyGlobal = createDataset([{ n: 1 }]).filter(() => false).groupBy().agg([{ op: 'countRows' }, { op: 'sum', column: 'n' }, { op: 'mean', column: 'n' }]);
  assert.deepEqual(emptyGlobal.rows, [{ 'count of rows': 0, 'sum of n': 0, 'mean of n': null }]);
});

test('complex group keys are canonical and do not collide across nested arrays or objects', () => {
  const result = createDataset([
    { key: ['a,string:b'], value: 1 },
    { key: ['a', 'b'], value: 2 },
    { key: { x: 1, y: 2 }, value: 3 },
    { key: { y: 2, x: 1 }, value: 4 }
  ]).groupBy('key').agg([{ op: 'sum', column: 'value' }]);
  assert.equal(result.length, 3);
  assert.deepEqual(result.rows.map(row => row['sum of value']), [1, 2, 7]);
});

test('grouping and aggregation reject invalid columns, operations, and output collisions', () => {
  const source = data();
  assert.throws(() => source.groupBy('missing'), /Unknown column/);
  assert.throws(() => source.groupBy('category', 'category'), /unique/);
  assert.throws(() => source.groupBy('category').agg([]), /at least one/);
  assert.throws(() => source.groupBy('category').agg([{ op: 'medianish', column: 'price' }]), /unsupported operation/);
  assert.throws(() => source.groupBy('category').agg([{ op: 'sum' }]), /requires a source column/);
  assert.throws(() => source.groupBy('category').agg([{ op: 'sum', column: 'missing' }]), /Unknown aggregation column/);
  assert.throws(() => source.groupBy('category').agg([{ op: 'countRows', column: 'price' }]), /does not take/);
  assert.throws(() => source.groupBy('category').agg([{ op: 'sum', column: 'price', as: 'category' }]), /unique/);
});

test('calculated columns evaluate safe JSON expressions and leave the source unchanged', () => {
  const source = createDataset([
    { unitPrice: 12.5, quantity: 4, product: 'book' },
    { unitPrice: 10, quantity: 2, product: 'pen' },
    { unitPrice: null, quantity: 3, product: 'pad' }
  ]);
  const calculated = source.addCalculatedColumn('total', {
    op: 'multiply', args: [{ column: 'unitPrice' }, { column: 'quantity' }]
  }).addCalculatedColumn('description', {
    op: 'concat', args: [{ column: 'product' }, { literal: ' item' }], separator: ''
  });
  assert.deepEqual(calculated.rows.map(row => [row.total, row.description]), [[50, 'book item'], [20, 'pen item'], [null, 'pad item']]);
  assert.deepEqual(source.columns, ['unitPrice', 'quantity', 'product']);
  assert.throws(() => source.addCalculatedColumn('bad', { op: 'wat', args: [] }), /Unsupported expression/);
  assert.throws(() => createDataset([] , { columns: ['x'] }).addCalculatedColumn('y', { column: 'missing' }), /Unknown column/);
});

test('conditional columns use query predicates and support literal or calculated branches', () => {
  const source = createDataset([
    { customer: 'Ada', total: 500 }, { customer: 'Lin', total: 50 }, { customer: 'Sam', total: null }
  ]);
  const tiered = source.addConditionalColumn('tier',
    { op: 'gte', column: 'total', value: 100 },
    { literal: 'high' },
    { op: 'if', args: [{ op: 'isNull', args: [{ column: 'total' }] }, { literal: 'unknown' }, { literal: 'low' }] }
  );
  assert.deepEqual(tiered.rows.map(row => row.tier), ['high', 'low', 'unknown']);
  const cases = source.addCaseColumn('class', [
    { when: { op: 'gte', column: 'total', value: 400 }, then: { literal: 'premium' } },
    { when: { op: 'gte', column: 'total', value: 100 }, then: { literal: 'standard' } }
  ], { literal: 'entry' });
  assert.deepEqual(cases.rows.map(row => row.class), ['premium', 'entry', 'entry']);
  assert.deepEqual(source.columns, ['customer', 'total']);
  assert.throws(() => source.addConditionalColumn('x', { op: 'eq', column: 'missing', value: 1 }, 'yes', 'no'), /Unknown column/);
  assert.throws(() => source.addConditionalColumn('x', { op: 'eq', column: 'total', value: null }, 'yes', 'no'), /use isNull/);
});

test('pipeline calculated/conditional columns and grouping serialize and replay', () => {
  const pipeline = createPipeline([
    { op: 'addCalculatedColumn', name: 'lineTotal', expression: { op: 'multiply', args: [{ column: 'price' }, { column: 'quantity' }] } },
    { op: 'addConditionalColumn', name: 'band', condition: { op: 'gte', column: 'lineTotal', value: 20 }, then: { literal: 'large' }, else: { literal: 'small' } },
    { op: 'addCaseColumn', name: 'premium', cases: [
      { when: { op: 'gte', column: 'lineTotal', value: 30 }, then: { literal: true } }
    ], default: { literal: false } },
    { op: 'groupBy', columns: ['band'], aggregations: [
      { op: 'countRows' }, { op: 'sum', column: 'lineTotal', as: 'revenue' }
    ] }
  ]);
  const source = createDataset([
    { price: 5, quantity: 5 }, { price: 2, quantity: 3 }, { price: 4, quantity: 6 }
  ]);
  const first = pipeline.run(source);
  const restored = createPipeline(JSON.parse(JSON.stringify(pipeline))).run(source);
  assert.deepEqual(first.dataset.rows, [
    { band: 'large', 'count of rows': 2, revenue: 49 },
    { band: 'small', 'count of rows': 1, revenue: 6 }
  ]);
  assert.deepEqual(restored.dataset.rows, first.dataset.rows);
  assert.deepEqual(first.summary.steps.map(step => step.operation), ['addCalculatedColumn', 'addConditionalColumn', 'addCaseColumn', 'groupBy']);
  assert.deepEqual(first.summary.finalShape, [2, 3]);
  const filtered = createPipeline([
    { op: 'query', query: { where: { op: 'gte', column: 'price', value: 4 } } },
    { op: 'groupBy', columns: [], aggregations: [{ op: 'countRows' }, { op: 'sum', column: 'price', as: 'revenue' }] }
  ]).run(source);
  assert.deepEqual(filtered.dataset.rows, [{ 'count of rows': 2, revenue: 9 }]);
});
