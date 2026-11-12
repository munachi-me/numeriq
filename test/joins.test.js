import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, AnalysisResult } from '../src/index.js';

function sales() {
  return createDataset([
    { customerId: 1, region: 'north', amount: 100 },
    { customerId: 2, region: 'south', amount: 200 },
    { customerId: 3, region: 'north', amount: 300 }
  ], { name: 'Sales' });
}
function customers() {
  return createDataset([
    { customerId: 1, region: 'north', name: 'Ada', tier: 'gold' },
    { customerId: 2, region: 'south', name: 'Bo', tier: 'silver' },
    { customerId: 9, region: 'west', name: 'Zed', tier: 'bronze' }
  ], { name: 'Customers' });
}

test('innerJoin matches only rows present on both sides', () => {
  const result = sales().innerJoin(customers(), { on: 'customerId' });
  assert.equal(result instanceof AnalysisResult, true);
  assert.equal(result.length, 2);
  assert.deepEqual(result.columns, ['customerId', 'region_left', 'amount', 'region_right', 'name', 'tier']);
  assert.deepEqual(result.rows.map(row => row.name), ['Ada', 'Bo']);
});

test('unified join() with how option matches dedicated methods', () => {
  const right = customers();
  assert.deepEqual(sales().join(right, { on: 'customerId', how: 'inner' }).rows, sales().innerJoin(right, { on: 'customerId' }).rows);
  assert.deepEqual(sales().join(right, { on: 'customerId', how: 'left' }).rows, sales().leftJoin(right, { on: 'customerId' }).rows);
  assert.deepEqual(sales().join(right, { on: 'customerId', how: 'right' }).rows, sales().rightJoin(right, { on: 'customerId' }).rows);
  assert.deepEqual(sales().join(right, { on: 'customerId', how: 'full' }).rows, sales().fullJoin(right, { on: 'customerId' }).rows);
});

test('leftJoin preserves unmatched left rows with null right columns', () => {
  const extra = createDataset([
    { customerId: 1, name: 'Ada' },
    { customerId: 7, name: 'Unmatched' }
  ]);
  const result = sales().leftJoin(extra, { on: 'customerId' });
  assert.equal(result.length, 3);
  // No collision (region exists only on the left), so no suffixes are applied.
  assert.deepEqual(result.columns, ['customerId', 'region', 'amount', 'name']);
  assert.deepEqual(result.rows[1], { customerId: 2, region: 'south', amount: 200, name: null });
});

test('rightJoin preserves unmatched right rows with null left columns', () => {
  const result = sales().rightJoin(customers(), { on: 'customerId' });
  assert.equal(result.length, 3);
  assert.deepEqual(result.rows[2], { customerId: 9, region_left: null, amount: null, region_right: 'west', name: 'Zed', tier: 'bronze' });
});

test('fullJoin keeps both sides: matched rows, unmatched left, unmatched right', () => {
  const result = sales().fullJoin(customers(), { on: 'customerId' });
  assert.equal(result.length, 4);
  assert.equal(result.rows[0].name, 'Ada');
  assert.equal(result.rows[2].name, null);
  assert.deepEqual(result.rows[3], { customerId: 9, region_left: null, amount: null, region_right: 'west', name: 'Zed', tier: 'bronze' });
});

test('crossJoin produces the cartesian product without keys', () => {
  const left = createDataset([{ x: 1 }, { x: 2 }]);
  const right = createDataset([{ y: 'a' }, { y: 'b' }, { y: 'c' }]);
  const result = left.crossJoin(right);
  assert.equal(result.length, 6);
  assert.deepEqual(result.columns, ['x', 'y']);
  assert.deepEqual(result.rows[0], { x: 1, y: 'a' });
  assert.deepEqual(result.rows[5], { x: 2, y: 'c' });
});

test('multiple join keys match on every key', () => {
  const result = sales().join(customers(), { on: ['customerId', 'region'], how: 'inner' });
  assert.equal(result.length, 2);
  assert.deepEqual(result.rows.map(row => row.name), ['Ada', 'Bo']);
});

test('leftOn/rightOn supports differently named keys, multiple per side', () => {
  const orders = createDataset([{ cid: 1, area: 'north', total: 10 }, { cid: 2, area: 'south', total: 20 }]);
  const people = createDataset([{ id: 1, zone: 'north', name: 'Ada' }, { id: 3, zone: 'west', name: 'Cy' }]);
  const result = orders.join(people, { leftOn: ['cid', 'area'], rightOn: ['id', 'zone'], how: 'inner' });
  assert.deepEqual(result.columns, ['cid', 'area', 'total', 'name']);
  assert.deepEqual(result.rows, [{ cid: 1, area: 'north', total: 10, name: 'Ada' }]);

  const left = orders.join(people, { leftOn: 'cid', rightOn: 'id', how: 'left' });
  // zone is a regular right column here (only id is the join key), so it is kept.
  assert.deepEqual(left.rows, [
    { cid: 1, area: 'north', total: 10, zone: 'north', name: 'Ada' },
    { cid: 2, area: 'south', total: 20, zone: null, name: null }
  ]);
});

test('column collisions get configurable suffixes and never silently overwrite', () => {
  const result = sales().join(customers(), { on: 'customerId', suffixes: ['_sales', '_customers'] });
  assert.deepEqual(result.columns, ['customerId', 'region_sales', 'amount', 'region_customers', 'name', 'tier']);
  assert.deepEqual(result.rows[0], { customerId: 1, region_sales: 'north', amount: 100, region_customers: 'north', name: 'Ada', tier: 'gold' });
});

test('shared join key columns appear once and right-only key columns are dropped', () => {
  const result = sales().join(customers(), { on: ['customerId', 'region'] });
  assert.equal(result.columns.filter(column => column === 'customerId').length, 1);
  assert.equal(result.columns.filter(column => column === 'region').length, 1);
  const renamed = sales().join(customers(), { leftOn: 'customerId', rightOn: 'customerId' });
  assert.equal(renamed.columns.includes('customerId'), true);
});

test('one-to-one validation rejects duplicated keys on either side', () => {
  const right = createDataset([{ id: 1, label: 'one' }, { id: 1, label: 'one again' }]);
  assert.throws(() => createDataset([{ id: 1 }]).innerJoin(right, { leftOn: 'id', rightOn: 'id', validate: 'one-to-one' }), /one-to-one validation failed/);
  const leftDup = createDataset([{ id: 1, v: 'a' }, { id: 1, v: 'b' }]);
  assert.throws(() => leftDup.innerJoin(createDataset([{ id: 1 }]), { on: 'id', validate: 'one-to-one' }), /one-to-one validation failed/);
});

test('one-to-many validation rejects duplicate left keys but allows duplicate right keys', () => {
  const leftDup = createDataset([{ id: 1, v: 'a' }, { id: 1, v: 'b' }]);
  const rightDup = createDataset([{ id: 1, tag: 'x' }, { id: 1, tag: 'y' }]);
  assert.throws(() => leftDup.innerJoin(rightDup, { on: 'id', validate: 'one-to-many' }), /one-to-many validation failed/);
  const ok = createDataset([{ id: 1, v: 'a' }]).innerJoin(rightDup, { on: 'id', validate: 'one-to-many' });
  assert.equal(ok.length, 2);
});

test('many-to-one validation rejects duplicate right keys but allows duplicate left keys', () => {
  const leftDup = createDataset([{ id: 1, v: 'a' }, { id: 1, v: 'b' }]);
  const rightDup = createDataset([{ id: 1, tag: 'x' }, { id: 1, tag: 'y' }]);
  assert.throws(() => leftDup.innerJoin(rightDup, { on: 'id', validate: 'many-to-one' }), /many-to-one validation failed/);
  const ok = leftDup.innerJoin(createDataset([{ id: 1 }]), { on: 'id', validate: 'many-to-one' });
  assert.equal(ok.length, 2);
});

test('many-to-many validation accepts any key distribution', () => {
  const leftDup = createDataset([{ id: 1, v: 'a' }, { id: 1, v: 'b' }]);
  const rightDup = createDataset([{ id: 1, tag: 'x' }, { id: 1, tag: 'y' }]);
  const ok = leftDup.innerJoin(rightDup, { on: 'id', validate: 'many-to-many' });
  assert.equal(ok.length, 4);
});

test('null join keys never match but are preserved on outer joins', () => {
  const left = createDataset([{ id: 1, v: 'match' }, { id: null, v: 'null-key' }, { id: 2, v: 'lonely' }]);
  const right = createDataset([{ id: 1, tag: 'one' }, { id: null, tag: 'null-should-not-match' }, { id: 3, tag: 'three' }]);
  const inner = left.innerJoin(right, { on: 'id' });
  assert.equal(inner.length, 1);
  assert.deepEqual(inner.rows, [{ id: 1, v: 'match', tag: 'one' }]);
  const full = left.fullJoin(right, { on: 'id' });
  assert.equal(full.length, 5);
  const nullLeftRow = full.rows.find(row => row.v === 'null-key');
  assert.equal(nullLeftRow.tag, null);
  const nullRightRow = full.rows.find(row => row.tag === 'null-should-not-match');
  assert.equal(nullRightRow.v, null);
});

test('empty datasets produce correct join results', () => {
  const empty = createDataset([], { columns: ['customerId', 'amount'] });
  assert.deepEqual(sales().innerJoin(empty, { on: 'customerId' }).rows, []);
  assert.equal(sales().leftJoin(empty, { on: 'customerId' }).length, 3);
  assert.deepEqual(sales().rightJoin(empty, { on: 'customerId' }).rows, []);
  assert.equal(sales().fullJoin(empty, { on: 'customerId' }).length, 3);
  assert.equal(empty.crossJoin(customers()).length, 0);
  const matchedWithEmpty = empty.innerJoin(sales(), { on: 'customerId' });
  assert.deepEqual(matchedWithEmpty.rows, []);
});

test('duplicate keys multiply matched rows', () => {
  const left = createDataset([{ id: 1, v: 'l1' }, { id: 1, v: 'l2' }]);
  const right = createDataset([{ id: 1, tag: 'x' }, { id: 1, tag: 'y' }]);
  const result = left.innerJoin(right, { on: 'id' });
  assert.equal(result.length, 4);
  const combos = result.rows.map(row => `${row.v}-${row.tag}`).sort();
  assert.deepEqual(combos, ['l1-x', 'l1-y', 'l2-x', 'l2-y']);
});

test('join results compose with v0.11.0 analysis operations', () => {
  const joined = sales().join(customers(), { on: 'customerId' });
  const chained = joined.analyze().groupBy('tier').sum('amount', { as: 'revenue' }).orderBy('revenue', 'desc').execute();
  assert.deepEqual(chained.rows, [
    { tier: 'silver', revenue: 200 },
    { tier: 'gold', revenue: 100 }
  ]);
  const filtered = joined.filter({ op: 'eq', column: 'tier', value: 'gold' }).select('name', 'amount');
  assert.deepEqual(filtered.rows, [{ name: 'Ada', amount: 100 }]);
  assert.equal(chained instanceof AnalysisResult, true);
});

test('joins accept AnalysisResult and plain arrays as inputs', () => {
  const derived = sales().analyze().where({ op: 'gte', column: 'amount', value: 150 }).execute();
  const joined = derived.innerJoin(customers(), { on: 'customerId' });
  assert.equal(joined instanceof AnalysisResult, true);
  assert.deepEqual(joined.rows.map(row => row.name), ['Bo']);

  const fromArray = sales().innerJoin([{ customerId: 1, name: 'Ada' }], { on: 'customerId' });
  assert.deepEqual(fromArray.rows.map(row => row.name), ['Ada']);
});

test('joins never mutate their inputs', () => {
  const left = sales();
  const right = customers();
  const beforeLeft = JSON.stringify(left.rows);
  const beforeRight = JSON.stringify(right.rows);
  left.fullJoin(right, { on: 'customerId', suffixes: ['_a', '_b'] });
  left.rightJoin(right, { on: 'customerId' });
  assert.equal(JSON.stringify(left.rows), beforeLeft);
  assert.equal(JSON.stringify(right.rows), beforeRight);
});

test('join lineage records the operation', () => {
  const joined = sales().leftJoin(customers(), { on: 'customerId' });
  const lineage = joined.lineage();
  assert.equal(lineage.operation, 'join:left');
  assert.equal(lineage.source, 'Sales');
});

test('join option and key validation errors are explicit', () => {
  const left = sales();
  const right = customers();
  assert.throws(() => left.join(right, { how: 'outer' }), /Unsupported join type/);
  assert.throws(() => left.join(right, { on: 'missing' }), /Unknown join column in left input/);
  assert.throws(() => left.join(right, { leftOn: 'customerId', rightOn: 'missing' }), /Unknown join column in right input/);
  assert.throws(() => left.join(right, { on: ['customerId'], leftOn: 'customerId', rightOn: 'customerId' }), /not both/);
  assert.throws(() => left.join(right, { leftOn: 'customerId' }), /leftOn and rightOn must be provided together/);
  assert.throws(() => left.join(right, { leftOn: ['customerId', 'region'], rightOn: ['id'] }), /same number of keys/);
  assert.throws(() => left.join(right, { on: ['customerId', 'customerId'] }), /unique within a side/);
  assert.throws(() => left.join(right, { on: 'customerId', suffixes: ['_x'] }), /two non-empty strings/);
  assert.throws(() => left.join(right, { on: 'customerId', validate: 'one-to-none' }), /Unsupported relationship validation/);
  assert.throws(() => left.join(right, { on: 'customerId', extra: true }), /does not support option/);
  assert.throws(() => left.crossJoin(right, { on: 'customerId' }), /cross join does not use join keys/);
  assert.throws(() => left.join(null, { on: 'customerId' }), /Right join input/);
});

test('suffixed-name collisions in the output are rejected with a clear error', () => {
  const left = createDataset([{ id: 1, name: 'left name', 'name_x': 'conflict' }]);
  const right = createDataset([{ id: 1, name: 'Ada' }]);
  // Left "name" collides and would be suffixed to "name_x", which already exists on the left.
  assert.throws(() => left.innerJoin(right, { on: 'id', suffixes: ['_x', '_y'] }), /already exists: name_x/);
});

test('AnalysisResult.analyze() works (v0.11.0 regression coverage)', () => {
  const derived = sales().analyze().groupBy('region').sum('amount', { as: 'total' }).execute();
  const result = derived.analyze().orderBy('total', 'desc').execute();
  assert.equal(result instanceof AnalysisResult, true);
  assert.deepEqual(result.rows, [
    { region: 'north', total: 400 },
    { region: 'south', total: 200 }
  ]);
});
