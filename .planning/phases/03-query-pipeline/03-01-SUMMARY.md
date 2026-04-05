---
phase: 03-query-pipeline
plan: "01"
subsystem: search
tags: [lancedb, search, vector, fts, hybrid, rrf, typescript]
dependency_graph:
  requires: [02-index-pipeline]
  provides: [search-function, search-types, fts-index-helper]
  affects: [04-cli-mcp]
tech_stack:
  added: []
  patterns: [chainable-query-builder-mock, vi-hoisted-mock-factory, arrow-schema-fields-array]
key_files:
  created:
    - src/core/searcher.ts
    - src/core/searcher.test.ts
  modified:
    - src/types.ts
    - src/core/db/lance.ts
    - src/core/db/lance.test.ts
decisions:
  - "RRFReranker imported via lancedb.rerankers.RRFReranker (not subpath @lancedb/lancedb/rerankers — not in exports map)"
  - "Arrow RecordBatch field lookup via schema.fields.findIndex (not schema.fieldIndex — does not exist in apache-arrow typings)"
  - "vi.hoisted() required for vi.mock() factories referencing outer variables (hoisting prevents initialization access)"
metrics:
  duration_minutes: 5
  completed_date: "2026-04-05"
  tasks_completed: 2
  files_modified: 5
---

# Phase 03 Plan 01: Query Pipeline — Search Types, FTS Helper, and Searcher Module Summary

**One-liner:** Hybrid search engine with vector, FTS, and RRF reranking using LanceDB's native query API.

## Tasks Completed

| Task | Commit | Files |
|------|--------|-------|
| 1: Add SearchResult/SearchOptions types and ensureFtsIndex | e15531b | src/types.ts, src/core/db/lance.ts, src/core/db/lance.test.ts |
| 2: Build searcher module (vector, FTS, hybrid) | 1b99299 | src/core/searcher.ts, src/core/searcher.test.ts |

## What Was Built

### src/types.ts
Appended two interfaces:
- `SearchResult` — id, sourcePath, headingPath, text, score, indexedAt
- `SearchOptions` — topK, mode (vector/fts/hybrid), afterDate, beforeDate, sourceGlob

### src/core/db/lance.ts
Added `ensureFtsIndex(table)` — calls `table.createIndex('text', { config: Index.fts({...}), replace: true })`. The `replace: true` flag makes it idempotent so callers can call it unconditionally on startup.

### src/core/searcher.ts
`search(query, table, embedder, options)` dispatches across three modes:
- **vector**: embed query → `table.search(vector).select().limit().where?().toArray()`
- **fts**: `table.search(query, 'fts').select().limit().where?().toArray()`
- **hybrid**: parallel vector + FTS with `withRowId().toArrow()`, merged via `RRFReranker.rerankHybrid`, RecordBatch converted to `SearchResult[]`

`buildWherePredicate` constructs SQL predicates for afterDate, beforeDate, sourceGlob filters. Results are camelCase-mapped from snake_case DB columns.

### Tests
21 unit tests in searcher.test.ts covering all modes, defaults, date filters, source glob filter, result shape, and camelCase field mapping. 6 integration tests in lance.test.ts including `ensureFtsIndex` round-trip.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @lancedb/lancedb/rerankers subpath not in exports map**
- **Found during:** Task 2 implementation
- **Issue:** `import { RRFReranker } from '@lancedb/lancedb/rerankers'` throws `ERR_PKG_PATH_NOT_EXPORTED` — the subpath is not in the package's `exports` field
- **Fix:** Import via `import * as lancedb from '@lancedb/lancedb'` and access `lancedb.rerankers.RRFReranker`
- **Files modified:** src/core/searcher.ts
- **Commit:** 1b99299

**2. [Rule 1 - Bug] Arrow Schema.fieldIndex() does not exist**
- **Found during:** Task 2 TypeScript compile check
- **Issue:** `merged.schema.fieldIndex(name)` — Apache Arrow's `Schema` type has no `fieldIndex` method
- **Fix:** Use `schema.fields.map(f => f.name).indexOf(name)` pattern instead
- **Files modified:** src/core/searcher.ts
- **Commit:** 1b99299

**3. [Rule 3 - Blocking] vi.mock() factory closure hoisting error**
- **Found during:** Task 2 test execution
- **Issue:** `Cannot access 'mockRRFRerankerInstance' before initialization` — `vi.mock()` is hoisted to top of file, so closures over local variables fail
- **Fix:** Used `vi.hoisted()` to declare shared mock variables accessible in the factory
- **Files modified:** src/core/searcher.test.ts
- **Commit:** 1b99299

## Self-Check: PASSED

All files exist. Both commits verified in git log.
