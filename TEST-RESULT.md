# Verification Record — v0.4.0

- `npm test`: PASS on source and a fresh extraction of the ZIP — 43 tests passed, 0 failed in each copy.
- `node --check` for every JavaScript file under `src/`: PASS on source and extracted ZIP.
- `npm start`: PASS on source and extracted ZIP — the example imports sample sales data, extracts short weekday names, executes a query inside a serializable transformation pipeline, and prints query results and summaries.
- `npm run dev`: PASS for startup on source and extracted ZIP — Node watch mode reached its completed/ready state. A save-triggered rerun was not independently observed.
- Public imports: PASS for `numeriq` and `numeriq/query`, including `createQuery`, `Query.fromJSON`, and query replay.
- Query tests cover nested boolean filters; comparisons, set membership, explicit null, and literal string operators; stable multi-key sorting with nulls last; projection and pagination; JSON round-trips; invalid operators/columns/options; ISO date/datetime comparison and timezone-aware ordering; and query pipeline replay.
- Temporal names: PASS — `weekday` returns English weekday names, and weekday/month names support `nameLength: 'short' | 'long'` (long by default).
- Sample parity: PASS — local CSV/JSON and bundled CSV/TSV/JSON continue to load the same 25 transaction rows.
- `npm pack --dry-run`: PASS — 23 package files include the query module/subpath and no runtime dependencies.
- ZIP validation: PASS — archive extracts to `numeriq-v0.4.0/`, contains the query module, excludes `.git/` and `node_modules/`, and passes the full test, syntax, example, export, and watch-startup checks from extraction.
- Grouping and aggregation remain planned for v0.5.0; no third-party runtime dependencies were added.
