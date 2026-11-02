import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { loadCSV, loadJSON, loadData, createDataset, ValidationError } from '../src/index.js';

test('loads local CSV and JSON files from the project dataset directory', async () => {
  const sales = await loadCSV('sales.csv');
  assert.deepEqual(sales.shape, [3, 3]);
  assert.deepEqual(sales.rows[0], { product: 'Laptop', price: 1200, quantity: 3 });
  assert.deepEqual((await loadJSON('people.json')).rows, [
    { name: 'Ada', active: true },
    { name: 'Lin', active: false }
  ]);
  assert.deepEqual((await loadCSV('people.json')).rows[0], { name: 'Ada', active: true });
  assert.deepEqual((await loadData('sales.csv')).shape, [3, 3]);
});

test('supports quoted CSV fields, escaped quotes, and embedded newlines', async () => {
  const dataset = await loadCSV('quoted.csv');
  assert.equal(dataset.rows[0].note, 'She said "hello"');
  assert.equal(dataset.rows[1].note, 'line one\nline two');
});

test('rejects local paths and symlinks that escape dataset/', async () => {
  await assert.rejects(loadCSV('../package.json'), (error) => error instanceof ValidationError && /must stay inside/.test(error.message));
  const linkPath = path.resolve('dataset/escape-link.json');
  try {
    await symlink(path.resolve('package.json'), linkPath);
    await assert.rejects(loadJSON('escape-link.json'), (error) => error instanceof ValidationError && /must stay inside/.test(error.message));
  } finally {
    await unlink(linkPath).catch(() => {});
  }
});

test('loads supported HTTP URLs', async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/csv' });
    response.end('name,amount\nA,10\nB,20\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const { port } = server.address();
  const dataset = await loadCSV(`http://127.0.0.1:${port}/data.csv`);
  assert.deepEqual(dataset.shape, [2, 2]);
  assert.equal(dataset.rows[1].amount, 20);
});

test('describe summarizes every column, includes distinct, and nulls nonnumeric statistics', () => {
  const dataset = createDataset([
    { amount: 10, category: 'x', active: true },
    { amount: 20, category: 'x', active: false },
    { amount: null, category: null, active: true }
  ]);
  const summary = dataset.describe();
  assert.deepEqual(summary.columns, ['column', 'count', 'missing', 'distinct', 'mean', 'median', 'min', 'max', 'range', 'variance', 'std']);
  assert.deepEqual(summary.rows.map((row) => row.column), ['amount', 'category', 'active']);
  assert.equal(summary.rows[0].mean, 15);
  assert.equal(summary.rows[0].distinct, 2);
  assert.equal(summary.rows[0].variance, 25);
  assert.equal(summary.rows[0].std, 5);
  for (const row of summary.rows.slice(1)) {
    assert.equal(row.mean, null);
    assert.equal(row.median, null);
    assert.equal(row.min, null);
    assert.equal(row.max, null);
    assert.equal(row.variance, null);
    assert.equal(row.std, null);
  }
  assert.equal(summary.rows[1].count, 2);
  assert.equal(summary.rows[1].missing, 1);
  assert.equal(summary.rows[1].distinct, 1);
});

test('describe(column) returns a keyed object and tables use idx', () => {
  const dataset = createDataset([{ score: 1 }, { score: 3 }, { score: 3 }]);
  assert.deepEqual(dataset.describe('score'), {
    column: 'score', count: 3, missing: 0, distinct: 2,
    mean: 7 / 3, median: 3, min: 1, max: 3, range: 2,
    variance: 8 / 9, std: Math.sqrt(8 / 9)
  });
  assert.match(dataset.toTable(), /│ idx/);
  assert.match(dataset.describe().toTable(), /distinct/);
  assert.throws(() => dataset.describe('absent'), ValidationError);
});

test('wide table display bounds the visible columns while retaining dimensions', () => {
  const columns = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`c${index}`, [index]]));
  const table = createDataset(columns).toTable({ maxColumns: 5 });
  assert.match(table, /… 20 more/);
  assert.match(table, /1 rows × 25 columns/);
});
