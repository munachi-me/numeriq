# Changelog

## 0.5.0 — Grouping, aggregation, and column creation

- Added stable multi-key and global grouping with count, distinct count, sum, mean, median, min/max, range, variance, and standard deviation aggregations.
- Added descriptive default aggregate labels (for example, `sum of prices`) and caller-selected output names through `name`, `as`, `alias`, or object-key mapping.
- Added immutable expression-based calculated columns, query-predicate conditional columns, and ordered multi-case columns.
- Added replayable pipeline steps for calculated, conditional, case, and grouped aggregate operations.
- Retained null grouping keys and explicit numeric/missing semantics; no runtime dependencies were added.

## 0.4.0 — Query and filtering engine

- Added a JSON-serializable query API with nested `and`/`or`/`not`, comparisons, membership, explicit null checks, and literal string predicates.
- Added multi-column stable ordering, null-last sorting, projection, offset, and limit; query conditions are validated and replayable.
- Added query operations to transformation pipelines without callbacks or dynamic evaluation.
- Changed date-part `weekday` extraction to return English day names and added short/long name selection for weekdays and months.
- Kept grouping and aggregation for v0.5.0; no third-party runtime dependencies were added.

## 0.3.0 — Advanced transformations

- Added immutable column reordering, multi-column renaming, splitting/combining, text replacement, trimming, case conversion, and conditional updates.
- Added decimal rounding, IQR outlier flags, and date-part extraction for day, ISO weekday/week, month, English month name, quarter, and year.
- Added `date`, `datetime`, and `time` inference/casting, including configurable per-column input formats in casts and CSV/JSON schemas.
- Added serializable, replayable transformation pipelines with JSON-safe expressions and per-step shape/row/column summaries.
- Changed table rendering's default row limit to 100 and replaced the bundled sales sample with the supplied 25 transactions in CSV, TSV, and JSON.
- Kept the core dependency-free; Excel remains deferred.

## 0.2.0 — Data import and preparation

- Added bundled CSV, TSV, and JSON sample datasets via `useSampleDataset()`.
- Added headerless imports, skipped-row controls, strict/lenient shape validation, schemas, custom missing markers, whitespace controls, and immutable import reports.
- Added explicit project-root loading, HTTP API request options, response content-type detection, and multi-source imports with optional deduplication.
- Added `Dataset.profile()`, `dropMissing()`, `fillMissing()`, and `castColumn()` with explicit conversion-error behavior.
- Kept the core dependency-free; Excel import remains deferred.

## 0.1.0 — Initial foundation

- Added immutable tabular Dataset model and `createDataset`.
- Added shape, dimensions, schema, type inference, and row inspection.
- Added foundational transformations and descriptive statistics.
- Added Node SQL-style table inspection and explicit display methods.
- Added basic CSV and JSON parsing helpers.
- Added editable example and Node test/watch scripts.

## 0.1.1 — Local imports and complete summaries

- Added local CSV, TSV, and JSON loaders restricted to the consuming project's `dataset/` folder, plus HTTP(S) URL loading.
- Expanded `describe()` to summarize all columns, include distinct counts, and return tabular summaries or a single-column object.
- Changed the table row-index heading from `Index` to `idx` and added wide-table column limits.
