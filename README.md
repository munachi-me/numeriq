# Numeriq

**JavaScript Data Science Engine** — a lightweight, framework-independent foundation for working with tabular data in JavaScript.

> Version 0.4.0 adds a dependency-free declarative query engine on top of the v0.3.0 transformation and temporal APIs. Numeriq remains an early development build, not yet a production-stability promise.

## Requirements

- Node.js 20 or newer
- npm; no mandatory runtime dependencies

## Install and run locally

From this extracted project folder:

```bash
npm test
npm run dev
```

`npm run dev` watches `examples/basic/index.js` and reruns it whenever you save changes. Edit that file to experiment with Numeriq.

## Quick start

```js
import { loadCSV, createPipeline } from './src/index.js';

const sales = await loadCSV('sales.csv'); // local files are read from dataset/
const pipeline = createPipeline([
  { op: 'extractDatePart', column: 'Date', part: 'monthName', options: { as: 'Month' } },
  { op: 'roundColumn', column: 'Total_Amount', precision: 2 },
  { op: 'flagOutliers', column: 'Total_Amount', options: { as: 'Amount_Outlier' } }
]);

const { dataset, summary } = pipeline.run(sales);
console.log(dataset.head(8));
console.log(summary);
```

When consuming the package after publishing, use `import { createDataset, createPipeline } from 'numeriq'`.

## Dataset properties

| Property | Meaning |
|---|---|
| `shape` | `[rowCount, columnCount]` |
| `ndim` | Always `2` for a tabular dataset |
| `size` | Number of cells (`rows * columns`) |
| `empty` | True if either dimension is zero |
| `length` | Number of rows |
| `columns` | Ordered column-name array |
| `dtypes` | Inferred types: `integer`, `number`, `string`, `boolean`, `date`, `datetime`, `time`, `mixed`, `unknown` |
| `schema` | Column metadata including inferred type and nullability |
| `index` | Zero-based row indices |
| `rows` | Defensive copy of records |
| `metadata` | User-supplied metadata |

## Create and inspect

- `createDataset(records, options?)`
- `dataset.head(n?)`, `tail(n?)`, `preview(n?)`
- `dataset.info()`, `dataset.describe(column?)`, `dataset.profile(options?)`
- `dataset.column(name)` returns a `Series`

Creation also accepts arrays of arrays when `options.columns` is supplied, and column-oriented objects whose values are equal-length arrays. `describe()` returns a table-like Dataset with a summary row for every column; `describe('column')` returns a keyed summary object. `profile()` reports missingness, distinct values, frequent categories, constants, and duplicate rows.

## Transformations

All Dataset transformations are immutable: they return a new Dataset and leave the original unchanged.

### Columns and text

- `select(...columns)`, `reorderColumns(...columns)`, `dropColumns(...columns)`
- `renameColumn(oldName, newName)`, `renameColumns({ oldName: newName })`
- `splitColumn(column, { delimiter, into, dropOriginal?, trim? })`
- `combineColumns(name, columns, { separator?, skipMissing?, dropSource? })`
- `replaceText(column, search, replacement, { caseSensitive?, all? })`
- `trimColumn(column, { side: 'both' | 'start' | 'end' })`
- `changeCase(column, 'lower' | 'upper' | 'title')`
- `updateColumnWhere(column, predicate, valueOrFunction)`
- `addColumn(name, valueOrFunction)`, `mapRows(mapper)`

`splitColumn` replaces the source column by default, puts any remaining split pieces into the last output column, and trims each piece. Set `dropOriginal: false` to retain the source. `combineColumns` keeps its sources by default, skips missing values, and appends the new column; set `dropSource: true` to replace the source columns. Text search is a literal string, not a regular expression. Replacement is global and case-sensitive by default. Non-string values are left unchanged by text operations.

### Numeric and conditional operations

- `roundColumn(column, precision = 0)` rounds finite numeric cells to 0–15 decimal places.
- `flagOutliers(column, { method: 'iqr', factor?, as? })` adds a boolean flag using interpolated quartiles and the IQR fences. Missing values receive `null`; with fewer than four observed values, all observed values receive `false`.
- Existing helpers include `filter(predicate)`, `sortBy(column, direction?)`, `limit(count)`, `dropDuplicates(...columns)`, `unique(column)`, `nunique(column)`, `dropMissing({ columns?, how? })`, and `fillMissing(column, valueOrFunction)`.

`addColumn` accepts either a literal or a callback `(row, index) => value`. `updateColumnWhere` takes a predicate `(row, index) => boolean` and a literal or replacement callback.

### Date, datetime, and time

ISO date strings (`YYYY-MM-DD`), ISO datetime strings, and ISO clock strings can be inferred as `date`, `datetime`, and `time`. Use `castColumn` when input text uses another format:

```js
const typed = data
  .castColumn('day', 'date', { format: 'DD/MM/YYYY' })
  .castColumn('started_at', 'datetime', { format: 'MM/DD/YYYY hh:mm A' })
  .castColumn('clock', 'time', { format: 'hh:mm:ss A' });
```

Supported format tokens are `YYYY`, `MM`/`M`, `MMM`/`MMMM`, `DD`/`D`, `HH`/`H`, `hh`/`h` with `A` for AM/PM, `mm`/`m`, `ss`/`s`, `SSS`, and `Z` for a datetime timezone offset. For datetime formats without `Z`, input is interpreted as UTC. Cast date values are JavaScript `Date` objects at UTC midnight; datetime values are canonical ISO strings in UTC; time values are canonical `HH:mm:ss.SSS` strings. Import schemas can use the same per-column descriptor, for example `{ schema: { day: { type: 'date', format: 'DD/MM/YYYY' } } }`.

`extractDatePart(column, part, { as?, nameLength? })` accepts a `date` or `datetime` column and appends a new column. Parts are `day`, `weekday`, `week`, `month`, `monthName`, `quarter`, and `year`. `weekday` now returns an English name such as `Monday` (not an ISO weekday number); `monthName` returns a name such as `January`. Set `nameLength: 'short'` for `Mon` / `Jan`, or `'long'` (the default) for `Monday` / `January`. Week number uses ISO-8601 rules, where week 1 contains the year's first Thursday. Extraction uses UTC consistently; missing values remain `null`. The default output name is `${column}_${part}`.

### Replayable pipelines and transformation summaries

Create a declarative pipeline from JSON-safe operation descriptors. `run(dataset)` returns `{ dataset, summary }`; each summary step includes shapes, rows added/removed, and columns added/removed. Pipelines can be serialized with `JSON.stringify(pipeline)` and restored with `TransformationPipeline.fromJSON()` or `createPipeline(document)`. v0.4.0 pipelines can include a `query` step; queries and pipelines use the same JSON-safe condition format.

```js
const pipeline = createPipeline([
  { op: 'roundColumn', column: 'price', precision: 2 },
  { op: 'addColumn', name: 'total', expression: {
      op: 'multiply', args: [{ column: 'price' }, { column: 'quantity' }]
  }},
  { op: 'updateColumnWhere', column: 'tier',
    where: { op: 'gt', args: [{ column: 'total' }, { literal: 1000 }] },
    value: 'high' }
]);
const { dataset: result, summary } = pipeline.run(data);
```

Pipeline steps do not accept callbacks, so a serialized pipeline is replayable. `addColumn` and `updateColumnWhere` support JSON-safe expression trees. Expression operations include arithmetic (`add`, `subtract`, `multiply`, `divide`), comparisons (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`), boolean operations (`and`, `or`, `not`), `if`, `coalesce`, and `concat`. Column references use `{ column: 'name' }`; constants use `{ literal: value }`.

## Query and filtering (v0.4.0)

Build a reusable declarative query with `createQuery(document)` or `new Query(document)`. `query.run(dataset)` returns a new Dataset; serialize it with `JSON.stringify(query)` and restore it with `Query.fromJSON(document)`.

```js
const query = createQuery({
  where: { op: 'and', args: [
    { op: 'eq', column: 'Category', value: 'Electronics' },
    { op: 'gte', column: 'Total_Amount', value: 100 }
  ] },
  orderBy: [{ column: 'Total_Amount', direction: 'desc' }],
  select: ['Date', 'Product', 'Total_Amount'],
  offset: 0,
  limit: 10
});
const result = query.run(sales);
```

Comparison operators are `eq`, `ne`, `gt`, `gte`, `lt`, and `lte`; set membership uses `in` / `notIn`; literal string matching uses `contains`, `startsWith`, and `endsWith` with optional `caseSensitive: false`. Explicit missing-value tests use `isNull` / `isNotNull`; comparisons against missing values never match, and use of `eq`/`ne` with `null` is rejected. `and`, `or`, and `not` compose nested conditions. Incompatible comparison types do not match. ISO date/datetime values compare as instants.

`orderBy` accepts multiple `{ column, direction }` keys, defaults to ascending, preserves input order for ties, and places missing values last in either direction. `offset`, `limit`, and `select` provide pagination and projection. Query descriptors validate operators, options, and column references; they accept no callbacks, regex execution, or query-string evaluation. This release does not include grouping or aggregation; those remain planned for v0.5.0.

## Statistics

`count`, `sum`, `mean`, `median`, `min`, `max`, `range`, `variance`, and `std` are available on datasets by column name. A column `Series` also exposes these methods and `describe()`. Statistics include finite numeric values only. Variance and standard deviation default to population calculations (`ddof = 0`); pass `ddof = 1` for sample calculations. Empty numeric inputs return `null` for statistics that require values; `sum` returns `0`.

## Import helpers and sample files

- `parseCSV(text, options?)`, `parseJSON(textOrValue, options?)`
- `loadCSV(filenameOrURL, options?)`, `loadJSON(filenameOrURL, options?)`, `loadData(filenameOrURL, options?)`
- `loadMany(sources, options?)` for combining CSV/TSV/JSON sources
- `useSampleDataset(format?)` for the bundled sample (`csv` by default)

The v0.3.0 sample is the supplied 25-transaction dataset in `dataset/samples/sales.csv`, `sales.tsv`, and `sales.json`. Equivalent local files are available at `dataset/sales.csv`, `sales.tsv`, and `sales.json`.

Importers support delimiter detection, headerless CSV, skipped rows, strict/lenient shape validation, schemas, custom missing markers, whitespace controls, and frozen import reports. Schema values may be simple type names or `{ type, format }` descriptors. Local filenames are resolved only from the consuming project's `dataset/` folder; path traversal and symlinks escaping that folder are rejected. Pass an explicit `projectRoot` when the process is started elsewhere. HTTP(S) requests support `method`, `headers`, and `body`; `loadData` detects formats by filename or response content type. `loadMany` supports union or strict column strategies and optional deduplication.

No Excel importer or third-party runtime dependency is included; Excel remains deferred.

## Display

In Node.js, `console.log(dataset)` uses Node's custom inspection hook to display an `idx` column. `dataset.toTable(options?)`, `display(options?)`, and `print(options?)` are also available. Tables display up to **100 rows by default**; configure `maxRows` to change this. Wide tables show up to 20 columns by default; configure `maxColumns` to change that limit. Browser developer consoles may not honor Node's inspection hook, so use `toTable()` or `display()` there.

## Scripts

| Command | Purpose |
|---|---|
| `npm test` | Run tests with Node's built-in test runner |
| `npm run test:watch` | Rerun tests on changes |
| `npm run dev` | Watch and rerun the editable basic example |
| `npm start` | Run the example once |

## Development roadmap

- `0.1.0` Foundation: dataset model, inspection, transformations, descriptive statistics, display, basic CSV/JSON.
- `0.2.0` Data import and preparation: sample CSV/TSV/JSON data, robust imports, URL/API and multi-source loading, validation/reports, missing values, conversion, duplicate handling, profiling, and cleaning. Excel deferred.
- `0.3.0` Advanced transformations: calculated columns, split/combine, date/time and text operations, numeric rounding/outlier flags, and replayable pipelines.
- `0.4.0` Query and filtering engine: nested declarative filters, null/membership/string predicates, multi-key stable sorting, projection, pagination, JSON serialization/replay, and pipeline query steps. Weekday/month extraction supports short and long English names.
- `0.5.0` Grouping and aggregation.
- `0.6.0` Advanced statistics.
- `0.7.0` Metrics and KPIs.
- `0.8.0` Data intelligence and explainable insights.
- `0.9.0` Visualization data and chart specifications.
- `0.10.0` Dashboard and reporting foundations.
- `1.0.0` Stable integrated API.

The roadmap is directional; features are not considered implemented until present in the corresponding release.

## JSA reference

Numeriq's long-term analytical scope is informed by the separate JSA JavaScript Analytics Platform. JSA's DOM-free core includes parsing, data modelling, transforms, analytics, insights, visualization data, dashboards, and exports. Numeriq is an independent library: it does not import JSA or include JSA's React UI.

Reference: https://github.com/munachi-me/JSA

## License

MIT. See [LICENSE](./LICENSE).
