# Changelog

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
