# Changelog

## 0.12.0 — Dataset joins and relationships

- Added inner, left, right, full, and cross joins via `join(right, options)` plus dedicated `innerJoin()`, `leftJoin()`, `rightJoin()`, `fullJoin()`, and `crossJoin()` methods, available on both `Dataset` and `AnalysisResult` and accepting Dataset, AnalysisResult, or plain row-array inputs.
- Added multiple shared join keys via `on: ['customerId', 'region']` and differently named keys via `leftOn`/`rightOn` (one or more per side, equal count enforced); the two forms cannot be mixed, and cross joins reject key options.
- Added collision handling that never silently overwrites: colliding non-key columns get configurable `suffixes` (default `['_left', '_right']`), shared key columns appear once with left values, right-only key columns are dropped in favor of their left partners, and suffixes that would duplicate existing output names are rejected with explicit errors.
- Added relationship validation with `validate: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'`, checking key uniqueness on the appropriate side before joining with descriptive duplicate-key errors.
- Defined consistent null, unmatched, duplicate-key, and empty-input behavior: null/missing keys never match (including other nulls) but are preserved on outer joins with null-filled opposite-side columns; unmatched rows keep their own side's values; duplicate keys multiply matched rows; empty inputs produce empty or one-sided results per join type.
- Implemented hash-based join execution without nested loops, preserving left row order for inner/left/full joins, right row order for right joins, and appending unmatched rows in source order after the matched section.
- Join results are always composable `AnalysisResult` objects with join-aware lineage (`join:<how>`), chaining directly into the v0.11.0 analysis API; added a regression test and fix for `AnalysisResult.analyze()` (missing import in the v0.11.0 release).
- Updated README, examples, TypeScript declarations, and TEST-RESULT.md; preserved v0.1–v0.11 behavior with 138 passing tests (114 pre-existing plus 24 new join tests).

## 0.11.0 — Analysis engine

## 0.11.0 — Analysis engine

- Added the lightweight `AnalysisResult` for analytical output: `rows`, `columns`, `shape`, `ndim`, `length`, `size`, `empty`, `index`, `dtypes`, `schema`, `head()`, `tail()`, `select()`, `filter()`, `sort()`/`sortBy()`, `limit()`, `distinct()`, `count()`, `groupBy()`, `agg()`, `table()`, `toJSON()`, `toArray()`, and lightweight `lineage()`/`history()` provenance. It deliberately does not expose `profile()`, `importReport`, or original dataset identity, and every operation returns a new immutable result.
- Added the fluent `dataset.analyze()` builder with SQL-inspired operations: `select()`, `where()`/`filter()`, `groupBy()`, `having()`, `orderBy()`/`sort()`, `limit()`, `offset()`, and `distinct()`, accepting both predicate functions and v0.4.0 declarative condition objects, with pre- and post-aggregation step semantics and serializable/replayable analysis documents via `toJSON()`/`fromJSON()`.
- Added the full aggregation catalog to the shared engine: `sum`, `mean`/`average`, `median`, `min`, `max`, `count`, `countRows`, `nunique`, `variance`, `std`/`stddev`, `range`, `quantile`, `percentile`, `quartiles`, `iqr`, `mad`, `skewness`, `kurtosis` — with `as` aliases, `ddof`/`q`/`p`/`method` options, multiple aggregations per operation, global aggregation without `groupBy()`, and conditional aggregations via a `where` condition per aggregation.
- Added aggregation helper functions (`sum('amount')`, `mean('amount')`, `count()`, …) for readable direct chaining that preserves the existing `GroupedDataset`/`agg()` contracts; Dataset-level `agg()` still returns a `Dataset` while aggregating an `AnalysisResult` returns an `AnalysisResult`.
- Improved table output: default `maxRows` is now 1000 with support for custom values and `Infinity`, a `Showing X of Y rows.` footer (including `Showing 0 of 0 rows.` for empty data), validation of invalid `maxRows` values, and consistent behavior across `Dataset` and `AnalysisResult` `table()`/`display()`/`print()` and Node inspection, keeping the SQL-style `idx` identifier.
- Added a default export mirroring the named exports (`import Numeriq from 'numeriq'` alongside `import { createDataset } from 'numeriq'`) and new subpaths `numeriq/analysis`, `numeriq/analysis-result`, and `numeriq/aggregation-helpers`.
- Added `index.d.ts` TypeScript declarations for the public API — `Dataset`, `AnalysisResult`, `AnalysisBuilder`, `GroupedDataset`, `Series`, aggregation helpers, and analysis methods — without migrating the runtime to TypeScript.
- Improved data integrity: internal lineage propagation for derived results, lineage-aware Dataset creation options, and preserved scalar method return types (`sales.sum('amount')` still returns a number).
- Documented the v0.12.0 join deferral; the result-factory architecture is prepared for it. Preserved v0.1–v0.10 behavior with 114 passing tests (97 pre-existing plus 17 new analysis-engine tests).

## 0.10.0 — Dashboard and reporting foundations
