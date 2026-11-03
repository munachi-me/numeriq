import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDataset, createPipeline, TransformationPipeline, parseCSV, parseJSON, ValidationError
} from '../src/index.js';

test('column operations split, combine, rename, reorder, and drop immutably', () => {
  const source = createDataset([
    { person: 'Ada Byron Lovelace', city: 'London', code: 'A-1' },
    { person: 'Grace Hopper', city: 'New York', code: 'G-2' }
  ]);
  const split = source.splitColumn('person', { delimiter: ' ', into: ['first', 'last'] });
  assert.deepEqual(split.columns, ['first', 'last', 'city', 'code']);
  assert.equal(split.rows[0].last, 'Byron Lovelace');
  assert.equal(source.columns.includes('person'), true);
  const combined = split.combineColumns('person', ['first', 'last'], { separator: ' ', dropSource: true });
  assert.deepEqual(combined.columns, ['person', 'city', 'code']);
  assert.equal(combined.rows[1].person, 'Grace Hopper');
  const transformed = combined.renameColumns({ city: 'location', code: 'id' }).reorderColumns('id', 'person', 'location').dropColumns('location');
  assert.deepEqual(transformed.columns, ['id', 'person']);
  assert.throws(() => source.reorderColumns('city'), ValidationError);
  assert.throws(() => source.splitColumn('person', { delimiter: '', into: ['x'] }), ValidationError);
  assert.throws(() => source.renameColumns({ city: 'code' }), /unique/);
  assert.equal(createDataset([{ a: 'left', b: null }]).combineColumns('joined', ['a', 'b'], { separator: '-', skipMissing: false }).rows[0].joined, 'left-');
});

test('text and conditional updates preserve missing values and source datasets', () => {
  const source = createDataset([
    { label: '  Wireless MOUSE  ', quantity: 5, status: 'standard' },
    { label: null, quantity: 2, status: 'standard' }
  ]);
  const changed = source
    .trimColumn('label')
    .replaceText('label', 'mouse', 'device', { caseSensitive: false })
    .changeCase('label', 'title')
    .updateColumnWhere('status', row => row.quantity >= 5, 'featured');
  assert.equal(changed.rows[0].label, 'Wireless Device');
  assert.equal(changed.rows[1].label, null);
  assert.equal(changed.rows[0].status, 'featured');
  assert.equal(changed.rows[1].status, 'standard');
  assert.equal(source.rows[0].label, 'Wireless MOUSE');
  assert.throws(() => source.replaceText('label', '', 'x'), ValidationError);
});

test('rounding and IQR outlier flags are immutable and null-safe', () => {
  const source = createDataset([
    { score: 1.236, amount: 1 }, { score: 2.344, amount: 2 }, { score: 2.001, amount: 2 },
    { score: 3.444, amount: 3 }, { score: 100.2, amount: 100 }, { score: null, amount: null }
  ]);
  const rounded = source.roundColumn('score', 2);
  assert.equal(rounded.rows[0].score, 1.24);
  assert.equal(rounded.rows[1].score, 2.34);
  assert.equal(rounded.rows[5].score, null);
  const flagged = source.flagOutliers('amount', { as: 'is_outlier' });
  assert.deepEqual(flagged.rows.map(row => row.is_outlier), [false, false, false, false, true, null]);
  assert.equal(source.columns.includes('is_outlier'), false);
  assert.throws(() => source.roundColumn('amount', 16), ValidationError);
});

test('date, datetime, and time support explicit formats and deterministic part extraction', () => {
  const source = createDataset([
    { Day: '31/12/2024', Started: '12/31/2024 11:05 PM', Clock: '11:05:07 PM' },
    { Day: '01/01/2025', Started: '01/01/2025 12:15 AM', Clock: '12:15:00 AM' }
  ]);
  const typed = source
    .castColumn('Day', 'date', { format: 'DD/MM/YYYY' })
    .castColumn('Started', 'datetime', { format: 'MM/DD/YYYY hh:mm A' })
    .castColumn('Clock', 'time', { format: 'hh:mm:ss A' });
  assert.deepEqual(typed.dtypes, { Day: 'date', Started: 'datetime', Clock: 'time' });
  assert.equal(typed.rows[0].Day.toISOString(), '2024-12-31T00:00:00.000Z');
  assert.equal(typed.rows[0].Started, '2024-12-31T23:05:00.000Z');
  assert.equal(typed.rows[0].Clock, '23:05:07.000');
  const parts = typed
    .extractDatePart('Day', 'day')
    .extractDatePart('Day', 'weekday', { as: 'weekday' })
    .extractDatePart('Day', 'weekday', { as: 'weekday_short', nameLength: 'short' })
    .extractDatePart('Day', 'week', { as: 'week' })
    .extractDatePart('Day', 'month')
    .extractDatePart('Day', 'monthName', { as: 'month_name' })
    .extractDatePart('Day', 'monthName', { as: 'month_short', nameLength: 'short' })
    .extractDatePart('Day', 'quarter', { as: 'quarter' })
    .extractDatePart('Started', 'year', { as: 'started_year' });
  assert.equal(parts.rows[0].weekday, 'Tuesday');
  assert.equal(parts.rows[0].weekday_short, 'Tue');
  assert.equal(parts.rows[0].Day_day, 31);
  assert.equal(parts.rows[0].week, 1);
  assert.equal(parts.rows[0].Day_month, 12);
  assert.equal(parts.rows[0].month_name, 'December');
  assert.equal(parts.rows[0].month_short, 'Dec');
  assert.equal(parts.rows[0].quarter, 4);
  assert.equal(parts.rows[0].started_year, 2024);
  assert.throws(() => typed.extractDatePart('Clock', 'hour'), ValidationError);
  assert.throws(() => typed.extractDatePart('Day', 'weekday', { nameLength: 'tiny' }), /nameLength/);
  assert.throws(() => source.castColumn('Day', 'date', { format: 'HH:mm' }), /date format/);
});

test('CSV schema descriptors support per-column date, datetime, and time formats', () => {
  const csv = parseCSV('date,when,clock\n31/12/2024,12/31/2024 11:05 PM,11:05 PM\n', {
    schema: {
      date: { type: 'date', format: 'DD/MM/YYYY' },
      when: { type: 'datetime', format: 'MM/DD/YYYY hh:mm A' },
      clock: { type: 'time', format: 'hh:mm A' }
    }
  });
  assert.deepEqual(csv.dtypes, { date: 'date', when: 'datetime', clock: 'time' });
  assert.equal(csv.rows[0].when, '2024-12-31T23:05:00.000Z');
  const json = parseJSON([{ day: '31/12/2024' }], { schema: { day: { type: 'date', format: 'DD/MM/YYYY' } } });
  assert.equal(json.rows[0].day.toISOString(), '2024-12-31T00:00:00.000Z');
  assert.throws(() => parseCSV('value\n', { schema: { value: { type: 'date', format: 'HH:mm' } } }), /date format/);
});

test('declarative pipelines serialize, replay, and summarize transformation effects', () => {
  const source = createDataset([
    { first: 'Ada', last: 'Lovelace', day: '2024-02-29', amount: 1.236, quantity: 3, status: 'standard' },
    { first: 'Grace', last: 'Hopper', day: '2025-01-01', amount: 2.999, quantity: 2, status: 'standard' }
  ]);
  const pipeline = createPipeline([
    { op: 'combineColumns', name: 'full_name', columns: ['first', 'last'], options: { separator: ' ', dropSource: true } },
    { op: 'castColumn', column: 'day', type: 'date' },
    { op: 'extractDatePart', column: 'day', part: 'monthName', options: { as: 'month' } },
    { op: 'roundColumn', column: 'amount', precision: 2 },
    { op: 'addColumn', name: 'gross', expression: { op: 'multiply', args: [{ column: 'amount' }, { column: 'quantity' }] } },
    { op: 'updateColumnWhere', column: 'status', where: { op: 'gt', args: [{ column: 'gross' }, { literal: 4 }] }, value: 'premium' }
  ]);
  const result = pipeline.run(source);
  assert.deepEqual(result.dataset.shape, [2, 7]);
  assert.ok(Math.abs(result.dataset.rows[0].gross - 3.72) < 1e-12);
  assert.equal(result.dataset.rows[1].status, 'premium');
  assert.deepEqual(result.summary.initialShape, [2, 6]);
  assert.deepEqual(result.summary.finalShape, [2, 7]);
  assert.deepEqual(result.summary.steps[0].columnsRemoved, ['first', 'last']);
  assert.deepEqual(result.summary.steps[2].columnsAdded, ['month']);
  const replayed = TransformationPipeline.fromJSON(JSON.parse(JSON.stringify(pipeline))).run(source);
  assert.deepEqual(replayed.dataset.rows, result.dataset.rows);
  assert.deepEqual(replayed.summary, result.summary);
  assert.throws(() => createPipeline([{ op: 'addColumn', name: 'bad', value: () => 1 }]), /JSON-serializable/);
  assert.throws(() => createPipeline([{ op: 'notAnOperation' }]), /Unsupported pipeline operation/);
});

test('pipeline summaries report rows removed by cleaning operations', () => {
  const source = createDataset([{ id: 1, value: 'x' }, { id: 2, value: null }]);
  const { dataset, summary } = createPipeline([{ op: 'dropMissing' }]).run(source);
  assert.equal(dataset.length, 1);
  assert.equal(summary.steps[0].rowsRemoved, 1);
  assert.deepEqual(summary.finalShape, [1, 2]);
});
