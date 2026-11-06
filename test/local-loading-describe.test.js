import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { loadCSV, loadJSON, loadData, createDataset, ValidationError } from '../src/index.js';

test('loads local CSV and JSON files from the project dataset directory', async () => {
  const sales = await loadCSV('sales.csv');
  assert.deepEqual(sales.shape, [25, 6]);
  assert.deepEqual(sales.rows[0], { Transaction_ID: 1001, Date: '2026-01-05', Product: 'Wireless Mouse', Category: 'Electronics', Quantity: 3, Total_Amount: 74.97 });
  assert.equal(sales.dtypes.Date, 'date');
  assert.deepEqual((await loadCSV('sales.tsv')).rows, sales.rows);
  assert.deepEqual((await loadJSON('sales.json')).rows, sales.rows);
  assert.deepEqual((await loadCSV('sales.json')).rows, sales.rows);
  assert.deepEqual((await loadJSON('people.json')).rows, [
    { name: 'Ada', active: true },
    { name: 'Lin', active: false }
  ]);
  assert.deepEqual((await loadCSV('people.json')).rows[0], { name: 'Ada', active: true });
  assert.deepEqual((await loadData('sales.csv')).shape, [25, 6]);
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
  assert.deepEqual(summary.columns, ['column', 'count', 'missing', 'distinct', 'mean', 'median', 'min', 'max', 'range', 'variance', 'std', 'q1', 'q3', 'iqr', 'mad', 'skewness', 'kurtosis']);
  assert.deepEqual(summary.rows.map((row) => row.column), ['amount', 'category', 'active']);
  assert.equal(summary.rows[0].mean, 15);
  assert.equal(summary.rows[0].distinct, 2);
  assert.equal(summary.rows[0].variance, 25);
  assert.equal(summary.rows[0].std, 5);
  assert.equal(summary.rows[0].q1, 12.5);
  assert.equal(summary.rows[0].q3, 17.5);
  assert.equal(summary.rows[0].iqr, 5);
  assert.equal(summary.rows[0].mad, 5);
  assert.equal(summary.rows[0].skewness, null);
  assert.equal(summary.rows[0].kurtosis, null);
  for (const row of summary.rows.slice(1)) {
    assert.equal(row.mean, null);
    assert.equal(row.median, null);
    assert.equal(row.min, null);
    assert.equal(row.max, null);
    assert.equal(row.variance, null);
    assert.equal(row.std, null);
    assert.equal(row.q1, null);
    assert.equal(row.q3, null);
    assert.equal(row.iqr, null);
    assert.equal(row.mad, null);
    assert.equal(row.skewness, null);
    assert.equal(row.kurtosis, null);
  }
  assert.equal(summary.rows[1].count, 2);
  assert.equal(summary.rows[1].missing, 1);
  assert.equal(summary.rows[1].distinct, 1);
});

test('describe(column) returns a keyed object and tables use idx', () => {
  const dataset = createDataset([{ score: 1 }, { score: 3 }, { score: 3 }]);
  const summary = dataset.describe('score');
  assert.deepEqual({ ...summary, skewness: null }, {
    column: 'score', count: 3, missing: 0, distinct: 2,
    mean: 7 / 3, median: 3, min: 1, max: 3, range: 2,
    variance: 8 / 9, std: Math.sqrt(8 / 9), q1: 2, q3: 3, iqr: 1, mad: 0, skewness: null, kurtosis: null
  });
  assert.ok(Math.abs(summary.skewness + Math.SQRT1_2) < 1e-12);
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

test('table display defaults to 100 rows and validates explicit maxRows', () => {
  const dataset = createDataset(Array.from({ length: 101 }, (_, index) => ({ value: index })));
  assert.match(dataset.toTable(), /… 1 more rows/);
  assert.match(dataset.toTable({ maxRows: 10 }), /… 91 more rows/);
  assert.throws(() => dataset.toTable({ maxRows: -1 }), /maxRows/);
});
