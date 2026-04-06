---
phase: 03-query-pipeline
plan: "02"
subsystem: search
tags: [integration-tests, lancedb, fts, hybrid, rrf, tdd]
dependency_graph:
  requires: ["03-01"]
  provides: ["verified-searcher"]
  affects: ["04-mcp-server", "05-cli-commands"]
tech_stack:
  added: []
  patterns: ["LCG deterministic mock embedder", "beforeAll/afterAll tmp-dir isolation"]
key_files:
  created:
    - src/core/searcher.integration.test.ts
  modified: []
decisions:
  - "Task 2 no-op: searcher.ts field names (_relevance_score, BigInt predicates) confirmed correct by real LanceDB runtime — no changes needed"
  - "LCG (linear congruential generator) used for deterministic 1536-dim mock vectors — avoids BigInt mixing errors"
  - "LanceDB deprecation warnings (score auto-projection) are benign — tests pass, future LanceDB version will require explicit score column inclusion"
metrics:
  duration: "~2 minutes"
  completed_date: "2026-04-05"
  tasks_completed: 2
  files_created: 1
  files_modified: 0
---

# Phase 03 Plan 02: Searcher Integration Tests Summary

Real LanceDB integration tests verifying all SRCH-01 through SRCH-05 requirements — vector search, FTS, hybrid RRF, result shape, date filtering, and sourceGlob filtering all confirmed working against actual runtime.

## What Was Built

`src/core/searcher.integration.test.ts` — 6 integration tests using a real tmp-dir LanceDB instance with a deterministic LCG mock embedder (no mocking of LanceDB APIs).

## Tasks Completed

| Task | Description | Commit | Result |
|------|-------------|--------|--------|
| 1 | Integration tests with real LanceDB | d264ea2 | 6/6 pass |
| 2 | Fix searcher based on findings | (no-op) | No changes needed |

## Key Findings (Open Questions Resolved)

From the 03-RESEARCH.md open questions:

1. **RRF score field name**: `_relevance_score` confirmed correct — the existing fallback chain in searcher.ts (`_relevance_score` ?? `_score` ?? 0) works against real runtime.

2. **BigInt WHERE predicate**: `indexed_at >= {number}` format (plain JavaScript number from `Date.getTime()`) works correctly with LanceDB SQL predicates. No CAST needed.

3. **FTS index creation**: `ensureFtsIndex` with `withPosition: true, baseTokenizer: 'simple', lowercase: true` works correctly. FTS search returns exact keyword matches.

4. **RecordBatch field access**: `schema.fields.findIndex` + `getChildAt(idx)?.get(row)` pattern confirmed correct for RRF hybrid results.

## Test Coverage

| Test | Requirement | Status |
|------|-------------|--------|
| vector search returns semantically similar chunks | SRCH-01 | PASS |
| fts search returns exact keyword match in top results | SRCH-02 | PASS |
| hybrid merges vector + FTS without error | SRCH-03 | PASS |
| result shape has all required fields | SRCH-04 | PASS |
| afterDate filter excludes old chunks | SRCH-05 | PASS |
| sourceGlob filter restricts results to matching paths | SRCH-05 | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed BigInt mixing error in textToVector mock helper**
- **Found during:** Task 1 RED phase
- **Issue:** Initial `textToVector` used `2n ** 32n` (BigInt literal) in an expression with a regular number (`hash >>> 0`), causing "Cannot mix BigInt and other types" at runtime
- **Fix:** Replaced BigInt-based LCG with a pure integer LCG: `seed = ((1664525 * seed + 1013904223) >>> 0)`
- **Files modified:** `src/core/searcher.integration.test.ts` (same file, during initial write)
- **Commit:** d264ea2

## Full Suite Results

- `npx vitest run`: **107 tests, 13 test files — all pass**
- `npx tsc --noEmit`: **clean (no errors)**

## Deprecation Warnings (Non-blocking)

LanceDB emits deprecation warnings when queries include `select()` without explicitly including `_distance` or `_score`:
> "This search specified output columns but did not include `_distance`. Currently the `_distance` column will be included. In the future it will not."

These warnings are benign — current behavior is exactly what searcher.ts expects. A future fix would call `.disable_scoring_autoprojection()` and explicitly add score columns to `RESULT_COLUMNS`. Deferred to a future plan.

## Self-Check: PASSED

- `src/core/searcher.integration.test.ts` exists: FOUND
- Commit d264ea2 exists in git log: FOUND
- Full test suite: 107/107 PASS
- TypeScript: 0 errors
