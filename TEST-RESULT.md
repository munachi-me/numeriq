# Verification Record — v0.2.0

Environment: Node.js 22.16.0, npm 10.9.2.

- `npm test`: PASS on the working source and an extracted ZIP copy — 28 tests, 28 passed, 0 failed.
- `node --check` for every JavaScript module under `src/`: PASS.
- `npm start`: PASS — the editable example ran with local CSV import, a bundled TSV sample, profiling, multi-source loading, and cleaning.
- `npm run dev`: PASS for startup — Node watch mode reached its waiting-for-file-changes state. A save-triggered second run was not independently observed.
- Public package-name exports: PASS — Dataset creation, CSV/JSON/generic/multi-source loading, and `useSampleDataset()` were exercised, including from the extracted ZIP.
- `npm pack --dry-run`: PASS — CSV, TSV, and JSON bundled sample files are included.
- ZIP validation: PASS — extraction produces `numeriq-v0.2.0/`; archive excludes `.git/` and `node_modules/`.
- Coverage includes headerless and delimiter-detected CSV, skipped rows, schemas, custom missing markers, strict/lenient validation, JSON record/column inputs, API POST headers/body and content-type dispatch, explicit project roots, local path confinement, multi-source union/strict/deduplication, import reports, profiling, and immutable cleaning/type conversion.
- No third-party runtime dependencies were added; Excel support is deferred.
