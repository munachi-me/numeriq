# Verification Record — v0.3.0

- `npm test`: PASS on source and extracted ZIP — 36 tests passed, 0 failed in each copy.
- `node --check` for every JavaScript file under `src/`: PASS on source and extracted ZIP.
- `npm start`: PASS on source and extracted ZIP — the example loaded the 25-row transaction data, ran a transformation pipeline, and printed its summary.
- `npm run dev`: PASS for startup on source and extracted ZIP — Node watch mode reached its completed/ready state. A save-triggered rerun was not independently observed.
- Public package imports: PASS for `numeriq` and `numeriq/pipeline`, including `createPipeline` and `TransformationPipeline`.
- Sample parity: PASS — local and bundled CSV, TSV, and JSON sources each load the same 25 rows and six columns; the Date column infers as `date`.
- `npm pack --dry-run`: PASS — 22 package files, including pipeline/temporal modules and bundled CSV/TSV/JSON samples; no runtime dependencies.
- ZIP validation: PASS — `numeriq-v0.3.0.zip` extracts to `numeriq-v0.3.0/`, includes root and bundled sales files, and excludes `.git/` and `node_modules/`.
- Regression coverage includes column restructuring, text and conditional transforms, rounding, IQR flags, all requested date parts, custom date/datetime/time formats in casts and CSV/JSON schemas, pipeline serialization/replay/summaries, and the 100-row default table limit.
- Excel support remains deferred; no third-party runtime dependencies were added.
