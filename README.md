# Numeriq

**JavaScript Data Science Engine** — a lightweight, framework-independent foundation for working with tabular data in JavaScript.

> Version 0.6.0 adds dependency-free advanced statistics for robust summaries, distribution shape, pairwise relationships, standard scores, and outlier flags. Numeriq remains an early development build, not yet a production-stability promise.

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
  { op: 'addCalculatedColumn', name: 'Unit_Price', expression: {
      op: 'divide', args: [{ column: 'Total_Amount' }, { column: 'Quantity' }]
  } },
  { op: 'addConditionalColumn', name: 'Order_Size',
    condition: { op: 'gte', column: 'Total_Amount', value: 300 },
    then: { literal: 'large' }, else: { literal: 'standard' } },
  { op: 'groupBy', columns: ['Category', 'Month'], aggregations: [
    { op: 'countRows' },
    { op: 'sum', column: 'Total_Amount', as: 'revenue' },
    { op: 'mean', column: 'Total_Amount', name: 'average order value' }
  ] }
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
- `addCalculatedColumn(name, expression)` for safe JSON-based formulas
- `addConditionalColumn(name, condition, thenValue, elseValue)` and `addCaseColumn(name, cases, defaultValue?)`

`splitColumn` replaces the source column by default, puts any remaining split pieces into the last output column, and trims each piece. Set `dropOriginal: false` to retain the source. `combineColumns` keeps its sources by default, skips missing values, and appends the new column; set `dropSource: true` to replace the source columns. Text search is a literal string, not a regular expression. Replacement is global and case-sensitive by default. Non-string values are left unchanged by text operations.

### Numeric and conditional operations

- `roundColumn(column, precision = 0)` rounds finite numeric cells to 0–15 decimal places.
- `flagOutliers(column, options?)` adds a boolean flag using IQR fences by default; v0.6 also offers `method: 'zscore'` and `method: 'modifiedZScore'` with configurable thresholds. Missing values receive `null`; the IQR method returns `false` for observed values when fewer than four are available.
- Existing helpers include `filter(predicate)`, `sortBy(column, direction?)`, `limit(count)`, `dropDuplicates(...columns)`, `unique(column)`, `nunique(column)`, `dropMissing({ columns?, how? })`, and `fillMissing(column, valueOrFunction)`.

`addColumn` accepts either a literal or a callback `(row, index) => value`. `updateColumnWhere` takes a predicate `(row, index) => boolean` and a literal or replacement callback.

`addCalculatedColumn` creates a column from the replayable expression language (for example, multiply `{ column: 'price' }` by `{ column: 'quantity' }`). `addConditionalColumn` uses the same JSON condition descriptors as v0.4 queries and chooses between literal values or expressions. `addCaseColumn` evaluates ordered `{ when, then }` rules and uses a fallback value/expression; the first matching rule wins. These methods return new datasets and do not change the source.

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

Pipeline steps do not accept callbacks, so a serialized pipeline is replayable. `addColumn`, `addCalculatedColumn`, `addConditionalColumn`, and `addCaseColumn` support JSON-safe expressions; `groupBy` materializes grouped aggregates. Expression operations include arithmetic (`add`, `subtract`, `multiply`, `divide`), comparisons (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`), boolean operations (`and`, `or`, `not`), null checks, membership and literal string predicates, `if`, `coalesce`, and `concat`. Column references use `{ column: 'name' }`; constants use `{ literal: value }`.

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

`orderBy` accepts multiple `{ column, direction }` keys, defaults to ascending, preserves input order for ties, and places missing values last in either direction. `offset`, `limit`, and `select` provide pagination and projection. Query descriptors validate operators, options, and column references; they accept no callbacks, regex execution, or query-string evaluation.

## Grouping and aggregation (v0.5.0)

`groupBy(...columns)` (or `groupBy(['year', 'month'])`) returns a grouped view. Call `.agg(descriptors)` or `.aggregate(descriptors)` to create a regular Dataset of summary rows. Group keys appear first in the output; groups retain the order in which each key combination first appeared.

```js
const byCategory = sales
  .groupBy('Category')
  .agg([
    { op: 'countRows' },
    { op: 'sum', column: 'Total_Amount', as: 'revenue' },
    { op: 'mean', column: 'Total_Amount', name: 'average order value' },
    { op: 'nunique', column: 'Product' }
  ]);
```

Supported operations are `countRows`, `count`, `nunique`, `sum`, `mean`, `median`, `min`, `max`, `range`, `variance`, `std`, `quantile`, `iqr`, `mad`, `skewness`, and `kurtosis`. `quantile` requires `q` between 0 and 1 and optionally accepts the interpolation `method`. Aggregations that use a column ignore missing values; numeric statistics use finite numeric values, and `count` counts non-missing values. Variance and standard deviation default to population calculations (`ddof: 0`); pass `ddof: 1` for sample calculations. `countRows` counts all rows in a group.

If an aggregation has no explicit output label, Numeriq creates a readable default such as `sum of prices`, `count of rows`, or `distinct count of product`. In array descriptors, set `name`, `as`, or `alias` to choose the displayed result column. An object form also maps output names to descriptors: `agg({ revenue: { op: 'sum', column: 'price' } })`. Output names must be unique and cannot collide with grouping keys.

Missing group-key values are retained as a single null-key group. Grouping is multi-key and type-aware. Calling `groupBy()` with no keys requests a global aggregate; an empty source yields zero for `countRows` and `sum`, and `null` for statistics that need observations. Empty keyed results retain the requested output schema. Filter with `createQuery()` before grouping and query the resulting summary Dataset afterward. Grouping does not yet include pivot tables, joins, rollups, or aggregate-result `HAVING` filters.

## Statistics

`count`, `sum`, `mean`, `median`, `min`, `max`, `range`, `variance`, and `std` remain available on datasets and `Series`. v0.6.0 adds `quantile(column, q)`, `percentile(column, p)`, `quartiles(column)`, `iqr(column)`, `mad(column)`, `skewness(column)`, and `kurtosis(column)`; `Series` exposes the same methods without the column argument. Statistics use finite numeric values and ignore missing or nonnumeric cells. Quantiles use linear interpolation by default; `method` may be `linear`, `lower`, `higher`, `midpoint`, or `nearest`. `quartiles()` returns `{ q1, median, q3 }`; MAD is the unscaled median absolute deviation.

Skewness is the population third central moment divided by the population standard deviation cubed; it requires at least three numeric values and nonzero variance. Kurtosis is **Fisher excess kurtosis** (normal distribution = 0), calculated from population moments; it requires at least four numeric values and nonzero variance. Both return `null` when those conditions are not met. `describe()` includes `q1`, `q3`, `iqr`, `mad`, `skewness`, and `kurtosis`; for mixed columns these numeric fields summarize the finite numeric values, while entirely nonnumeric columns receive `null` numeric fields.

`Dataset.covariance(x, y, { ddof = 0 })` and `Dataset.correlation(x, y, { method: 'pearson' | 'spearman' })` calculate paired relationships; `Series` provides `covariance(other)` and `correlation(other, options)`. Paired statistics use pairwise-complete finite numeric observations and require equal-length value arrays. Covariance defaults to population calculation; Pearson and Spearman correlation return `null` when there are fewer than two pairs or a column is constant. Spearman uses average ranks for ties.

`dataset.zScore(column, { as?, ddof? })` and `dataset.modifiedZScore(column, { as? })` append score columns; `Series.zScores()` and `Series.modifiedZScores()` return new Series. Missing/nonnumeric cells, zero-spread inputs, and otherwise undefined scores become `null`, never infinity. `flagOutliers()` preserves IQR as its default (`factor: 1.5`) and now supports `method: 'zscore'` (`threshold: 3`) and `method: 'modifiedZScore'` (`threshold: 3.5`); missing flags remain `null`, while constant numeric inputs are not flagged. If MAD is zero but values vary, modified-Z outlier flags fall back to the standard 1.5-IQR fences; modified Z-score values themselves remain `null` because the scale is undefined. The IQR flag keeps the prior minimum-four-observations behavior.

Grouped `agg()` now also supports `quantile` (requires `q`, optionally accepts an interpolation `method`), `iqr`, `mad`, `skewness`, and `kurtosis`. Quantile output names default to `quantile <q> of <column>` and remain customizable with `name`, `as`, or `alias`. The core has no third-party runtime dependencies.

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
- `0.5.0` Grouping and aggregation: stable multi-key grouping, descriptive aggregates with configurable output labels, global summaries, calculated columns, conditional/case columns, and replayable pipeline steps.
- `0.6.0` Advanced statistics: quantiles/percentiles and robust spread, skewness and excess kurtosis, pairwise covariance/Pearson and Spearman correlation, Z-scores, extended outlier flags, and grouped advanced aggregates.
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
