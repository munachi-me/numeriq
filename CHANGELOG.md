# Changelog

## 0.1.0 — Initial foundation

- Added immutable tabular Dataset model and `createDataset`.
- Added shape, dimensions, schema, type inference, and row inspection.
- Added foundational transformations and descriptive statistics.
- Added Node SQL-style table inspection and explicit display methods.
- Added basic CSV and JSON parsing helpers.
- Added editable example and Node test/watch scripts.

## Unreleased

- Added local CSV, TSV, and JSON loaders restricted to the consuming project's `dataset/` folder, plus HTTP(S) URL loading.
- Expanded `describe()` to summarize all columns, include distinct counts, and return tabular summaries or a single-column object.
- Changed the table row-index heading from `Index` to `idx` and added wide-table column limits.
