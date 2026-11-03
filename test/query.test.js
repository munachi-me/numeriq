import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, createPipeline, createQuery, Query } from '../src/index.js';

const sales = () => createDataset([
  { id: 1, category: 'Electronics', product: 'Wireless Mouse', amount: 74.97, date: '2026-01-05', active: true },
  { id: 2, category: 'Electronics', product: 'Mechanical Keyboard', amount: 120, date: '2026-01-06', active: true },
  { id: 3, category: 'Furniture', product: 'Ergonomic Chair', amount: 450, date: '2026-01-08', active: false },
  { id: 4, category: 'Electronics', product: 'Wireless Earbuds', amount: 389.97, date: '2026-02-28', active: true },
  { id: 5, category: 'Furniture', product: 'Desk Lamp', amount: 70, date: '2026-02-25', active: null },
  { id: 6, category: null, product: null, amount: null, date: null, active: false }
]);

test('declarative queries filter with nested boolean conditions and comparison/membership operators', () => {
  const query = createQuery({
    where: { op: 'and', args: [
      { op: 'in', column: 'category', value: ['Electronics', 'Furniture'] },
      { op: 'or', args: [
        { op: 'gte', column: 'amount', value: 300 },
        { op: 'and', args: [
          { op: 'eq', column: 'category', value: 'Electronics' },
          { op: 'lt', column: 'amount', value: 100 }
        ] }
      ] },
      { op: 'not', args: [{ op: 'eq', column: 'id', value: 3 }] }
    ] }
  });
  assert.deepEqual(query.run(sales()).rows.map(row => row.id), [1, 4]);
  assert.equal(query instanceof Query, true);
});

test('null predicates are explicit and comparisons do not match missing values', () => {
  const data = sales();
  assert.deepEqual(createQuery({ where: { op: 'isNull', column: 'category' } }).run(data).rows.map(row => row.id), [6]);
  assert.deepEqual(createQuery({ where: { op: 'isNotNull', column: 'active' } }).run(data).rows.map(row => row.id), [1, 2, 3, 4, 6]);
  assert.deepEqual(createQuery({ where: { op: 'ne', column: 'active', value: true } }).run(data).rows.map(row => row.id), [3, 6]);
  assert.throws(() => createQuery({ where: { op: 'eq', column: 'category', value: null } }), /use isNull/);
});

test('literal string operations support case sensitivity options without regular expressions', () => {
  const data = sales();
  assert.deepEqual(createQuery({ where: { op: 'contains', column: 'product', value: 'wireless', caseSensitive: false } }).run(data).rows.map(row => row.id), [1, 4]);
  assert.deepEqual(createQuery({ where: { op: 'startsWith', column: 'product', value: 'Wireless' } }).run(data).rows.map(row => row.id), [1, 4]);
  assert.deepEqual(createQuery({ where: { op: 'endsWith', column: 'product', value: 'Mouse' } }).run(data).rows.map(row => row.id), [1]);
  assert.deepEqual(createQuery({ where: { op: 'contains', column: 'product', value: '.' } }).run(data).rows, []);
  assert.throws(() => createQuery({ where: { op: 'contains', column: 'product', value: 'x', regex: true } }), /unknown property/);
});

test('queries sort by multiple keys stably, put nulls last, then offset, limit and project', () => {
  const data = createDataset([
    { id: 1, group: 'b', score: 10, extra: 'x' },
    { id: 2, group: 'a', score: 4, extra: 'y' },
    { id: 3, group: 'a', score: 4, extra: 'z' },
    { id: 4, group: 'a', score: null, extra: 'w' },
    { id: 5, group: null, score: 100, extra: 'n' },
    { id: 6, group: 'b', score: 10, extra: 'q' }
  ]);
  const query = createQuery({
    orderBy: [{ column: 'group', direction: 'asc' }, { column: 'score', direction: 'desc' }],
    offset: 1,
    limit: 3,
    select: ['id', 'group', 'score']
  });
  const result = query.run(data);
  assert.deepEqual(result.columns, ['id', 'group', 'score']);
  assert.deepEqual(result.rows.map(row => row.id), [3, 4, 1]);
  assert.deepEqual(data.columns, ['id', 'group', 'score', 'extra']);
  assert.deepEqual(createQuery({ orderBy: [{ column: 'id' }], offset: 99 }).run(data).shape, [0, 4]);
  assert.deepEqual(createQuery({ limit: 0 }).run(data).shape, [0, 4]);
});

test('query JSON serialization round-trips and temporal comparisons use instants', () => {
  const query = createQuery({
    where: { op: 'gte', column: 'day', value: '2026-02-01' },
    orderBy: [{ column: 'day', direction: 'asc' }],
    select: ['day', 'id']
  });
  const restored = Query.fromJSON(JSON.parse(JSON.stringify(query)));
  assert.deepEqual(restored.run(createDataset([
    { id: 1, day: '2026-01-01' },
    { id: 2, day: '2026-02-01' },
    { id: 3, day: '2026-03-01' }
  ])).rows, [{ day: '2026-02-01', id: 2 }, { day: '2026-03-01', id: 3 }]);
  const timezone = createQuery({ where: { op: 'eq', column: 'when', value: '2026-01-01T00:00:00Z' } });
  assert.deepEqual(timezone.run(createDataset([{ when: '2025-12-31T19:00:00-05:00' }])).length, 1);
  const ordered = createQuery({ orderBy: [{ column: 'when', direction: 'asc' }] }).run(createDataset([
    { id: 1, when: '2026-01-01T00:00:00Z' },
    { id: 2, when: '2025-12-31T19:00:00-05:00' },
    { id: 3, when: '2025-12-31T18:59:59-05:00' }
  ]));
  assert.deepEqual(ordered.rows.map(row => row.id), [3, 1, 2]);
});

test('query and conditions validate shape, operators, types, columns and options', () => {
  assert.throws(() => createQuery({ where: { op: 'regex', column: 'x', value: 'a' } }), /unsupported operator/);
  assert.throws(() => createQuery({ where: { op: 'not', args: [] } }), /exactly one/);
  assert.throws(() => createQuery({ where: { op: 'and', args: [] } }), /non-empty/);
  assert.throws(() => createQuery({ limit: -1 }), /limit/);
  assert.throws(() => createQuery({ offset: 1.5 }), /offset/);
  assert.throws(() => createQuery({ select: ['x', 'x'] }), /unique/);
  assert.throws(() => createQuery({ orderBy: [{ column: 'x', direction: 'up' }] }), /direction/);
  assert.throws(() => createQuery({ surprise: true }), /unknown property/);
  assert.throws(() => createQuery({ where: { op: 'gt', column: 'missing', value: 1 } }).run(createDataset([])), /Unknown column/);
  assert.throws(() => createQuery({ select: ['missing'] }).run(createDataset([{ x: 1 }])), /Unknown column/);
  assert.equal(createQuery({ where: { op: 'gt', column: 'x', value: 0 } }).run(createDataset([{ x: 'text' }])).length, 0);
});

test('queries can run as replayable transformation pipeline steps', () => {
  const data = sales();
  const pipeline = createPipeline([
    { op: 'roundColumn', column: 'amount', precision: 0 },
    { op: 'query', query: {
      where: { op: 'gte', column: 'amount', value: 100 },
      orderBy: [{ column: 'amount', direction: 'desc' }],
      select: ['id', 'amount']
    } }
  ]);
  const result = pipeline.run(data);
  assert.deepEqual(result.dataset.rows.map(row => row.id), [3, 4, 2]);
  const replayed = createPipeline(JSON.parse(JSON.stringify(pipeline))).run(data);
  assert.deepEqual(replayed.dataset.rows, result.dataset.rows);
  assert.deepEqual(replayed.summary.steps[1].shapeAfter, [3, 2]);
});
