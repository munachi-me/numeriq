# Changelog

## 0.8.0 — Data intelligence and explainable insights

- Added versioned, JSON-serializable `InsightSet` rules and exported `InsightSet` / `createInsightSet` from the package root and `numeriq/insights` subpath.
- Added KPI target-miss detection and user-defined value, absolute-change, percentage-change, and outlier-score thresholds with `info`, `warning`, and `critical` severity bands.
- Added grouped IQR, Z-score, and modified-Z-score outlier findings with original row indexes and deterministic explanations.
- Added evidence-bearing insight Datasets, serialization/validation coverage, and a runnable scorecard-plus-insights example.
- Kept the engine dependency-free and preserved v0.1–v0.7 behavior.

## 0.7.0 — Metrics and KPI engine

- Added reusable, versioned, JSON-serializable `MetricSet` definitions and exported `MetricSet` / `createMetricSet` from the package root and `numeriq/metrics` subpath.
- Added aggregation metrics, safe expression-based derived KPIs, dependency resolution, and optional declarative filters.
- Added value, absolute-change, and percentage-change targets with `gt`, `gte`, `lt`, `lte`, `eq`, and inclusive range rules.
- Added baseline comparisons and grouped scorecards matched by segment keys; evaluation returns a regular Dataset with target status and comparison fields.
- Kept the engine dependency-free and preserved the v0.1–v0.6 functionality.

## 0.6.0 — Advanced statistics

- Added linear/interpolated quantiles and percentiles, quartiles, IQR, and median absolute deviation to Dataset and Series; added quantile/IQR/MAD grouped aggregates.
- Added population-moment skewness, Fisher excess kurtosis, and their describe/grouped-summary fields with documented sample-size rules.
- Added pairwise-complete covariance, Pearson correlation, and tie-aware Spearman rank correlation.
- Added immutable Z-score and modified-Z-score columns/Series, replayable score pipeline steps, and opt-in Z-score outlier flags while retaining IQR as the default.
- Extended `describe()` to summarize finite numeric values in mixed columns; modified-Z outlier flags fall back to 1.5-IQR fences when MAD is zero but observations vary.
- Kept the runtime dependency-free; no Excel support or later KPI/insight/visualization features were pulled into this release.

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
