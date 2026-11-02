# Numeriq

**JavaScript Data Science Engine** — a lightweight, framework-independent foundation for working with tabular data in JavaScript.

> Version 0.2.0 builds on the v0.1.x foundation with dependency-free data import and preparation. Numeriq remains an early development build, not yet a production-stability promise.

## Requirements

- Node.js 20 or newer
- npm (no mandatory runtime dependencies)

## Install / run locally

From this extracted project folder:

```bash
npm test
npm run dev
```

`npm run dev` watches `examples/basic/index.js` and reruns it whenever you save changes. Edit that file to write your own analysis.

## Quick start

```js
import { createDataset } from './src/index.js';

const sales = createDataset([
  { product: 'Laptop', price: 1200, quantity: 3 },
  { product: 'Phone', price: 800, quantity: 5 },
  { product: 'Tablet', price: 400, quantity: 2 }
], { name: 'Sales' });

console.log(sales);           // SQL-style table in Node.js
console.log(sales.shape);     // [3, 3]
console.log(sales.dtypes);    // inferred column types
console.log(sales.describe());

const expensive = sales
  .filter(row => row.price > 500)
  .sortBy('price', 'desc')
  .select('product', 'price');

console.log(expensive);
```

When consuming the package after publishing, use `import { createDataset } from 'numeriq'`.

## Dataset properties

| Property | Meaning |
|---|---|
| `shape` | `[rowCount, columnCount]` |
| `ndim` | Always `2` for a tabular dataset |
| `size` | Number of cells (`rows * columns`) |
| `empty` | True if either dimension is zero |
| `length` | Number of rows |
| `columns` | Ordered column-name array |
| `dtypes` | Inferred type per column (`integer`, `number`, `string`, `boolean`, `date`, `mixed`, `unknown`) |
| `schema` | Column metadata including inferred type and nullability |
| `index` | Zero-based row indices |
| `rows` | Defensive copy of records |
| `metadata` | User-supplied metadata |

## API in v0.2.0

### Create and inspect

- `createDataset(records, options?)`
- `dataset.head(n?)`, `tail(n?)`, `preview(n?)`
- `dataset.info()`, `dataset.describe(column?)`, `dataset.profile(options?)`
- `dataset.column(name)` returns a `Series`

Creation also accepts arrays of arrays when `options.columns` is supplied, and column-oriented objects whose values are equal-length arrays.
`dataset.describe()` returns a table-like Dataset with a summary row for every column. It includes count, missing values, distinct values, and numeric statistics; numeric statistics are `null` for nonnumeric or mixed columns. `dataset.describe('column')` returns that column's summary as a plain object.
Imported datasets expose a frozen `dataset.importReport` describing source format, imported rows, columns, missing counts, and any lenient-mode warnings. Manually created or transformed datasets have `importReport === null`.

### Transform

- `select(...columns)`, `dropColumns(...columns)`, `renameColumn(oldName, newName)`
- `filter(predicate)`, `sortBy(column, 'asc' | 'desc')`, `limit(count)`
- `addColumn(name, valueOrFunction)`, `mapRows(mapper)`
- `dropDuplicates(...columns)`, `unique(column)`, `nunique(column)`, `clone()`
- `dropMissing({ columns?, how? })`, `fillMissing(column, valueOrFunction)`, `castColumn(column, type, options?)`

Transformations return new datasets; the original is not mutated.
`dropMissing()` removes rows with any missing value by default; use `how: 'all'` to remove rows missing all selected columns. `fillMissing` changes only `null`/`undefined` cells in the named column. `castColumn` supports `string`, `number`, `integer`, `boolean`, and ISO `date`; invalid casts throw by default, or become `null` with `{ errors: 'coerce' }`.

`profile({ topValues? })` returns a plain report with row/column counts, duplicate-row totals, per-column inferred type, missing counts and percentages, distinct counts, frequent categorical values, and constant-column names. Profiling does not modify data.

### Statistics

`count`, `sum`, `mean`, `median`, `min`, `max`, `range`, `variance`, and `std` are available on datasets by column name. A column `Series` also exposes these methods and `describe()`.

Statistics include finite numeric values only. Variance and standard deviation default to population calculations (`ddof = 0`); pass `ddof = 1` for sample calculations. Empty numeric inputs return `null` for statistics that require values; `sum` returns `0`. Describe summaries also include distinct non-missing values for categorical columns.

### Import helpers

- `parseCSV(text, options?)`, `parseJSON(textOrValue, options?)`
- `loadCSV(filenameOrURL, options?)`, `loadJSON(filenameOrURL, options?)`, `loadData(filenameOrURL, options?)`
- `loadMany(sources, options?)` for combining several CSV/TSV/JSON sources
- `useSampleDataset(format?)` for the bundled CSV, TSV, or JSON sales sample (`csv` is the default)

Importers return Numeriq Datasets through the same normalization pipeline. Supported formats are CSV, TSV, and JSON; delimiter detection supports comma, tab, semicolon, and pipe. CSV options include `header: false`, `columns`, `skipRows`, `delimiter`, `strict`, `schema`, `nullValues`, `trimStrings`, and `onInvalid: 'null'`. JSON accepts arrays of records, column-oriented objects, and arrays of arrays when `columns` is provided. Structural row-width/array-length errors throw by default; set `strict: false` to pad missing cells with `null` or omit extra cells and inspect warnings in `importReport`.

Local filenames are resolved only from a `dataset/` folder beside the consuming project's `package.json`; path traversal and symlinks escaping that folder are rejected. To load from a different working directory, pass an explicit `projectRoot` pointing at the project directory; local files remain confined to its `dataset/` folder. Example: `await loadCSV('sales.csv', { projectRoot: '/path/to/project', schema: { revenue: 'number' }, nullValues: ['-', 'missing'] })`.

HTTP(S) URLs support GET by default and API requests with `method`, `headers`, and `body`. Object/array request bodies are sent as JSON. `loadData` chooses a parser from the filename extension or the response `Content-Type`; for extensionless endpoints without a recognized content type, set `format: 'csv' | 'tsv' | 'json'`.

`loadMany(['north.csv', { source: 'south.json' }], { columnStrategy: 'union', deduplicateBy: ['id'] })` combines rows in source order, fills absent columns with `null`, and reports per-source imports. Set `columnStrategy: 'strict'` to require identical ordered columns. Existing `dropDuplicates()` remains available for later cleaning.

No Excel importer or third-party runtime dependency is included in v0.2.0; Excel remains deferred until a dependency-free or optional integration approach is chosen.

### Display

In Node.js, `console.log(dataset)` uses Node's custom inspection hook to display a table whose row-index heading is `idx`. Also available: `dataset.toTable(options?)`, `dataset.display(options?)`, and `dataset.print(options?)`. Wide tables show up to 20 columns by default and indicate omitted columns; configure `maxColumns` to change the limit. Browser developer consoles do not necessarily honor Node's inspection hook; use `toTable()` or `display()` there.

## Scripts

| Command | Purpose |
|---|---|
| `npm test` | Run tests with Node's built-in test runner |
| `npm run test:watch` | Rerun tests on changes |
| `npm run dev` | Watch and rerun the editable basic example |
| `npm start` | Run the example once |

## Development roadmap

- `0.1.0` Foundation: dataset model, inspection, transformations, descriptive statistics, display, basic CSV/JSON.
- `0.2.0` Data import and preparation: sample CSV/TSV/JSON data, robust CSV/JSON/TSV imports, URL/API and multi-source loading, validation/reports, missing values, type conversion, duplicate handling, profiling, and cleaning. Excel is deferred; no mandatory runtime dependencies are added.
- `0.3.0` Advanced transformations: calculated columns, split/combine, date/time and text operations.
- `0.4.0` Query and filtering engine.
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
