# Numeriq

**JavaScript Data Science Engine** — a lightweight, framework-independent foundation for working with tabular data in JavaScript.

> Version 0.1.0 is the foundational release. It is an early development build, not yet a production-stability promise.

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

## API in v0.1.0

### Create and inspect

- `createDataset(records, options?)`
- `dataset.head(n?)`, `tail(n?)`, `preview(n?)`
- `dataset.info()`, `dataset.describe(column?)`
- `dataset.column(name)` returns a `Series`

Creation also accepts arrays of arrays when `options.columns` is supplied, and column-oriented objects whose values are equal-length arrays.

### Transform

- `select(...columns)`, `dropColumns(...columns)`, `renameColumn(oldName, newName)`
- `filter(predicate)`, `sortBy(column, 'asc' | 'desc')`, `limit(count)`
- `addColumn(name, valueOrFunction)`, `mapRows(mapper)`
- `dropDuplicates(...columns)`, `unique(column)`, `nunique(column)`, `clone()`

Transformations return new datasets; the original is not mutated.

### Statistics

`count`, `sum`, `mean`, `median`, `min`, `max`, `range`, `variance`, and `std` are available on datasets by column name. A column `Series` also exposes these methods and `describe()`.

Statistics include finite numeric values only. Variance and standard deviation default to population calculations (`ddof = 0`); pass `ddof = 1` for sample calculations. Empty numeric inputs return `null` for statistics that require values; `sum` returns `0`.

### Import helpers

- `parseCSV(text, options?)` — basic quoted-cell parsing and delimiter detection for comma, tab, semicolon, and pipe.
- `parseJSON(textOrValue, options?)` — JSON arrays of records or column-oriented objects.

These are foundational parsers. Advanced malformed-file recovery, streaming, Excel support, remote URL loading, and richer import reports are planned for later versions.

### Display

In Node.js, `console.log(dataset)` uses Node's custom inspection hook to display a table. Also available: `dataset.toTable(options?)`, `dataset.display(options?)`, and `dataset.print(options?)`. Browser developer consoles do not necessarily honor Node's inspection hook; use `toTable()` or `display()` there.

## Scripts

| Command | Purpose |
|---|---|
| `npm test` | Run tests with Node's built-in test runner |
| `npm run test:watch` | Rerun tests on changes |
| `npm run dev` | Watch and rerun the editable basic example |
| `npm start` | Run the example once |

## Development roadmap

- `0.1.0` Foundation: dataset model, inspection, transformations, descriptive statistics, display, basic CSV/JSON.
- `0.2.0` Data import and preparation: Excel/TSV/URL, robust parsing, profiling, missing values and cleaning.
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
