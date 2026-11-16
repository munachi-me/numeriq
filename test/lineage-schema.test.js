import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, AnalysisResult, SchemaDefinition, createSchema, DatasetCollection, createCollection } from '../src/index.js';

function orders() {
  return createDataset([
    { orderId: 1, customerId: 1, amount: 100, status: 'paid' },
    { orderId: 2, customerId: 1, amount: 200, status: 'paid' },
    { orderId: 3, customerId: 2, amount: null, status: 'pending' }
  ], { name: 'Orders' });
}
function customers() {
  return createDataset([
    { customerId: 1, name: 'Ada', tier: 'gold' },
    { customerId: 2, name: 'Bo', tier: 'silver' }
  ], { name: 'Customers' });
}

test('roadmap validateSchema example shape works verbatim', () => {
  const d = createDataset([
    { customerId: 'C1', amount: 100, date: '2026-01-01' },
    { customerId: 'C2', amount: 200, date: '2026-02-01' }
  ]);
  const report = d.validateSchema({
    columns: {
      customerId: { type: 'string', required: true },
      amount: { type: 'number', nullable: false },
      date: { type: 'date' }
    }
  });
  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
});

test('schema validation reports missing columns, type mismatches, nulls, and constraint violations', () => {
  const d = createDataset([
    { id: 1, amount: 50, tier: 'gold' },
    { id: 1, amount: null, tier: 'platinum' },
    { id: 2, amount: 'oops', tier: 'gold' }
  ]);
  const report = d.validateSchema({
    name: 'Orders',
    columns: {
      id: { type: 'integer', unique: true },
      amount: { type: 'number', nullable: false, min: 0 },
      tier: { type: 'string', enum: ['gold', 'silver'] },
      ghost: { type: 'string', required: true }
    }
  });
  assert.equal(report.valid, false);
  assert.equal(report.schema, 'Orders');
  const codes = report.errors.map(e => e.code);
  assert.ok(codes.includes('MISSING_COLUMN'), 'missing required column reported');
  assert.ok(codes.includes('NOT_UNIQUE'), 'duplicate unique value reported');
  assert.ok(codes.includes('NULL_NOT_ALLOWED'), 'null in non-nullable reported');
  assert.ok(codes.includes('TYPE_MISMATCH'), 'type mismatch reported');
  assert.ok(codes.includes('CONSTRAINT_VIOLATION'), 'enum violation reported');
  assert.equal(report.errors.filter(e => e.code === 'NOT_UNIQUE').length, 1);
  assert.equal(report.errors.filter(e => e.code === 'NULL_NOT_ALLOWED').length, 1);
  assert.equal(report.errors.filter(e => e.code === 'TYPE_MISMATCH').length, 1);
});

test('constraints: min/max/minLength/maxLength/pattern/enum/custom/nullable/required defaults', () => {
  const d = createDataset([
    { v: 5, s: 'abcd', n: null },
    { v: 15, s: 'ab', n: null }
  ]);
  const report = d.validateSchema({
    columns: {
      v: { type: 'number', min: 0, max: 10 },
      s: { minLength: 3, maxLength: 5, pattern: '^[a-z]+$' },
      n: { type: 'string', nullable: true }
    }
  });
  const messages = report.errors.map(e => e.message);
  assert.ok(messages.some(m => m.includes('above max 10')), 'max violation');
  assert.ok(messages.some(m => m.includes('shorter than minLength 3')), 'minLength violation');
  // Optional columns allow missing values even with type set.
  assert.equal(report.errors.filter(e => e.column === 'n').length, 0);

  const custom = createDataset([{ v: 1 }, { v: 3 }]).validateSchema({
    columns: { v: { custom: value => value % 2 === 1 } }
  });
  assert.equal(custom.valid, true);
  const customFail = createDataset([{ v: 2 }]).validateSchema({
    columns: { v: { custom: value => value % 2 === 1 } }
  });
  assert.equal(customFail.valid, false);
  assert.match(customFail.errors[0].message, /custom constraint/);

  // required:true means the column must exist; missing it is an error even when nullable.
  const missingButNullable = createDataset([{ other: 1 }]).validateSchema({
    columns: { ghost: { required: true, nullable: true } }
  });
  assert.equal(missingButNullable.valid, false);
  assert.equal(missingButNullable.errors[0].code, 'MISSING_COLUMN');
  // Non-required missing columns only warn.
  const optionalMissing = createDataset([{ other: 1 }]).validateSchema({
    columns: { ghost: { required: false, nullable: true } }
  });
  assert.equal(optionalMissing.valid, true);
  assert.equal(optionalMissing.warnings.length, 1);
  assert.equal(optionalMissing.warnings[0].code, 'MISSING_COLUMN');
});

test('schema definition validation errors are explicit', () => {
  assert.throws(() => createSchema(null), /must be an object/);
  assert.throws(() => createSchema({}), /requires a columns object/);
  assert.throws(() => createSchema({ columns: { a: { type: 'float64' } } }), /Unsupported schema type/);
  assert.throws(() => createSchema({ columns: { a: { nullable: 'yes' } } }), /must be a boolean/);
  assert.throws(() => createSchema({ columns: { a: { min: 'x' } } }), /finite number/);
  assert.throws(() => createSchema({ columns: { a: { minLength: -1 } } }), /non-negative integer/);
  assert.throws(() => createSchema({ columns: { a: { pattern: 42 } } }), /RegExp or a string/);
  assert.throws(() => createSchema({ columns: { a: { enum: [] } } }), /non-empty array/);
  assert.throws(() => createSchema({ columns: { a: { custom: 'x' } } }), /must be a function/);
  assert.throws(() => createSchema({ columns: { a: { extra: true } } }), /does not support property/);
  assert.throws(() => createSchema({ columns: { a: {} }, extra: 1 }), /does not support property/);
});

test('schema round-trips through toJSON and accepts shorthand type strings', () => {
  const schema = createSchema({ name: 'S', columns: { a: 'number', b: { type: 'string' } } });
  assert.deepEqual(schema.toJSON(), { name: 'S', columns: { a: { type: 'number', nullable: true, required: false }, b: { type: 'string', nullable: true, required: false } } });
  const report = schema.validate([{ a: 1, b: 'x' }], ['a', 'b']);
  assert.equal(report.valid, true);
  const rebuilt = createSchema(schema.toJSON());
  assert.deepEqual(rebutedSchemaCheck(rebuilt), true);
  function rebutedSchemaCheck(s) { return s.validate([{ a: 2, b: 'y' }], ['a', 'b']).valid; }
});

test('validate/isValid/validationReport/assertSchema on Dataset and AnalysisResult', () => {
  const d = orders();
  const derived = d.analyze().groupBy('status').countRows({ as: 'n' }).execute();
  const schemaForDerived = {
    columns: { status: { type: 'string', required: true }, n: { type: 'integer', min: 1 } }
  };
  assert.equal(derived.isValid(schemaForDerived), true);
  assert.equal(derived instanceof AnalysisResult, true);

  assert.equal(d.isValid({ columns: { orderId: { type: 'integer', unique: true } } }), true);
  assert.equal(d.isValid({ columns: { ghost: { required: true } } }), false);

  const report = d.validationReport({ columns: { amount: { type: 'number' } } });
  assert.equal(report.rowCount, 3);
  assert.equal(report.valid, true);
  assert.deepEqual(report.columns.map(c => c.name), ['orderId', 'customerId', 'amount', 'status']);
  const amountColumn = report.columns.find(c => c.name === 'amount');
  assert.equal(amountColumn.expectedType, 'number');
  assert.equal(amountColumn.nullCount, 1);

  const plain = d.validationReport();
  assert.equal(plain.valid, true);
  assert.equal(plain.columns.every(c => typeof c.inferredType === 'string'), true);

  assert.doesNotThrow(() => d.assertSchema({ columns: { orderId: { type: 'integer' } } }));
  assert.throws(() => d.assertSchema({ columns: { ghost: { required: true } } }), /Schema validation failed/);
});

test('lineage(): source, operations, parameters, parent-child chain; immutable and copy-free', () => {
  const source = orders();
  const first = source.analyze()
    .where({ op: 'gte', column: 'amount', value: 0 })
    .groupBy('status')
    .countRows({ as: 'n' })
    .execute();
  const lineage = first.lineage();
  assert.equal(lineage.source, 'Orders');
  assert.equal(lineage.operation, 'analyze');
  assert.ok(Array.isArray(lineage.steps));
  assert.ok(lineage.steps.length >= 3, 'records where, group, aggregation steps');
  // Operation parameters recorded where safe (JSON-safe steps serialize).
  assert.ok(JSON.stringify(lineage).includes('gte'), 'where condition recorded');
  const second = first.filter(row => row.n > 0);
  assert.equal(second.lineage().source, 'Orders', 'lineage propagates to derived results');
  // Immutable: mutating the returned object does not corrupt the result.
  const snapshot = JSON.stringify(first.lineage());
  const touched = first.lineage();
  if (touched && typeof touched === 'object') { try { touched.operation = 'tampered'; } catch {} }
  assert.equal(JSON.stringify(first.lineage()), snapshot, 'lineage is immutable');
  assert.equal(first.history().operation, 'analyze');
  // No full dataset copies inside lineage.
  assert.equal(JSON.stringify(lineage).includes('"orderId"'), false, 'lineage does not embed dataset rows');
});

test('Dataset lineage records creation info without copying data', () => {
  const d = orders();
  const derived = d.limit(2).toAnalysisResult();
  const lineage = derived.lineage();
  assert.equal(lineage.source, 'Orders');
  assert.ok(lineage.sourceId || lineage.createdAt, 'records creation information');
  assert.equal(JSON.stringify(lineage).includes('"amount"'), false);
});

test('relationships: define, inspect, validate all cardinalities', () => {
  const collection = createCollection({
    name: 'Shop',
    datasets: { Customers: customers(), Orders: orders() },
    relationships: [
      { name: 'customer-orders', parent: 'Customers', child: 'Orders', parentKey: 'customerId', childKey: 'customerId', cardinality: 'one-to-many' }
    ]
  });
  assert.deepEqual(collection.names, ['Customers', 'Orders']);
  assert.equal(collection.size, 2);
  assert.equal(collection.has('Customers'), true);
  assert.deepEqual(collection.relationships[0], {
    name: 'customer-orders', parent: 'Customers', child: 'Orders',
    parentKey: 'customerId', childKey: 'customerId', cardinality: 'one-to-many'
  });

  const ok = collection.validateRelationship('customer-orders');
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.violations, []);

  // one-to-one fails when the child has duplicate foreign keys.
  collection.defineRelationship({ name: 'one-one', parent: 'Customers', child: 'Orders', parentKey: 'customerId', childKey: 'customerId', cardinality: 'one-to-one' });
  const broken = collection.validateRelationship('one-one');
  assert.equal(broken.valid, false);
  assert.ok(broken.violations.some(v => v.code === 'DUPLICATE_CHILD_KEY'));

  // Orphaned foreign keys are detected.
  const orphaned = createCollection({
    datasets: { Customers: customers(), Orders: createDataset([{ customerId: 99 }]) }
  });
  orphaned.defineRelationship({ parent: 'Customers', child: 'Orders', parentKey: 'customerId', childKey: 'customerId', cardinality: 'many-to-one' });
  const orphanReport = orphaned.validateRelationships();
  assert.equal(orphanReport.length, 1);
  assert.ok(orphanReport[0].violations.some(v => v.code === 'ORPHAN_CHILD_KEY'));

  // Joins never require relationships.
  const joined = collection.get('Orders').innerJoin(collection.get('Customers'), { on: 'customerId' });
  assert.equal(joined instanceof AnalysisResult, true);
  assert.equal(joined.length, 3); // orders 1,1,2 × customers 1,2 → three matches
});

test('relationship validation errors and missing-column reports', () => {
  assert.throws(() => createCollection({ datasets: { A: customers() } }).defineRelationship({ parent: 'A', child: 'Nope', parentKey: 'customerId', childKey: 'customerId' }), /unknown dataset/i);
  assert.throws(() => createCollection({ datasets: { A: customers() } }).defineRelationship({ parent: 'A', child: 'A', parentKey: 'customerId', childKey: 'customerId', cardinality: 'one-to-none' }), /Unsupported relationship cardinality/);
  assert.throws(() => createCollection({ datasets: { A: customers() } }).defineRelationship({ parent: 'A', parentKey: 'customerId', childKey: 'customerId' }), /must be a non-empty dataset name/);
  assert.throws(() => createCollection({ datasets: { A: customers() } }).defineRelationship({ parent: 'A', child: 'A', parentKey: 'customerId', childKey: 'customerId' }).validateRelationship('nope'), /not defined/);
  assert.throws(() => createCollection({ datasets: { A: customers() } }).add('A', customers()), /already has a dataset/);
  assert.throws(() => createCollection({ datasets: { A: customers() } }).get('Nope'), /no dataset named/);
  assert.throws(() => createCollection({ datasets: { A: customers() }, extra: 1 }), /does not support option/);
  assert.throws(() => createCollection({ datasets: { A: customers() }, relationships: 'x' }), /must be an array/);
  const missingCol = createCollection({
    datasets: { A: customers(), B: createDataset([{ other: 1 }]) }
  });
  missingCol.defineRelationship({ parent: 'A', child: 'B', parentKey: 'customerId', childKey: 'customerId' });
  const report = missingCol.validateRelationships()[0];
  assert.equal(report.valid, false);
  assert.ok(report.violations.some(v => v.code === 'MISSING_COLUMN' && v.side === 'child'));
});

test('collections stay lightweight: no persistence, datasets keep full behavior', () => {
  const collection = createCollection({ name: 'Shop', datasets: { Orders: orders() } });
  const d = collection.get('Orders');
  assert.equal(typeof d.groupBy, 'function', 'full Dataset behavior preserved');
  assert.equal(typeof d.profile, 'function');
  const derived = d.analyze().groupBy('status').countRows().execute();
  assert.equal(derived instanceof AnalysisResult, true);
  collection.add('Derived', derived);
  assert.equal(collection.size, 2);
  assert.equal(collection.name, 'Shop');
  assert.throws(() => createCollection({ datasets: { A: { rows: 'nope' } } }), /Dataset or AnalysisResult/);
  assert.throws(() => createCollection(null), /must be an object/);
});

test('Dataset vs AnalysisResult distinction preserved through v0.15.0 surface', () => {
  const d = orders();
  const derived = d.toAnalysisResult();
  assert.equal(derived.profile, undefined);
  assert.equal(derived.importReport, undefined);
  assert.equal(typeof derived.validateSchema, 'function', 'validation available on results');
  assert.equal(typeof d.validateSchema, 'function', 'validation available on datasets');
});
