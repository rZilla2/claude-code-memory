---
phase: 01-foundation
plan: "02"
subsystem: database
tags: [sqlite, lancedb, better-sqlite3, apache-arrow, vector-store, schema-versioning]

requires:
  - phase: 01-01
    provides: types.ts Config interface, logger.ts, project scaffold with dependencies

provides:
  - SQLite metadata DB client (openMetadataDb, assertModelMatch)
  - LanceDB vector store client (connectLanceDb, openChunksTable)
  - Model fingerprint check preventing cross-model vector contamination
  - Arrow-schema-based chunks table with full vector + metadata fields

affects: [02-chunking, 03-indexer, 04-mcp, 05-cli]

tech-stack:
  added: [apache-arrow (Arrow schema for LanceDB table creation)]
  patterns:
    - "WAL mode + busy_timeout 5000 for concurrent-safe SQLite"
    - "createEmptyTable with Arrow Schema (no dummy-row workaround)"
    - "Model fingerprint stored in index_metadata on first open, validated on every subsequent open"

key-files:
  created:
    - src/core/db/sqlite.ts
    - src/core/db/sqlite.test.ts
    - src/core/db/lance.ts
    - src/core/db/lance.test.ts
  modified: []

key-decisions:
  - "Arrow Schema approach for LanceDB createEmptyTable — cleaner than dummy-row-then-delete"
  - "busy_timeout PRAGMA returns key 'timeout' not 'busy_timeout' — test fixed to match actual API"
  - "Int64 for indexed_at field (unix ms timestamps) to match LanceDB Arrow type system"

patterns-established:
  - "TDD: write tests first, confirm RED, implement, confirm GREEN"
  - "Use logger (stderr) not console.log for all DB operation logging"
  - "openMetadataDb returns raw Database handle — caller responsible for close()"

requirements-completed: [FOUND-01, FOUND-03]

duration: 18min
completed: 2026-04-05
---

# Phase 01 Plan 02: DB Clients Summary

**SQLite metadata store with model fingerprint guard and LanceDB vector store with Arrow-typed chunks table — both TDD green, zero type errors**

## Performance

- **Duration:** 18 min
- **Started:** 2026-04-05T13:43:22Z
- **Completed:** 2026-04-05T14:01:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- SQLite client with WAL mode, schema init (index_metadata + files tables), and embedding model mismatch detection
- LanceDB client using Apache Arrow schema to create typed chunks table (id, vector, text, source_path, heading_path, chunk_hash, indexed_at, embedding_model_id)
- 15 tests total — 10 SQLite + 5 LanceDB — all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: SQLite metadata DB with schema versioning** - `ae86647` (feat)
2. **Task 2: LanceDB vector store client** - `d8ada78` (feat)

**Plan metadata:** (see final docs commit)

_Note: TDD tasks — tests written first (RED), implementation second (GREEN)_

## Files Created/Modified
- `src/core/db/sqlite.ts` - openMetadataDb and assertModelMatch exports
- `src/core/db/sqlite.test.ts` - 10 tests for schema init and model fingerprint
- `src/core/db/lance.ts` - connectLanceDb and openChunksTable exports
- `src/core/db/lance.test.ts` - 5 tests for connection and table schema

## Decisions Made
- Used `createEmptyTable` with Arrow Schema instead of dummy-row pattern — cleaner and avoids data mutation on init
- Int64 for `indexed_at` — LanceDB Arrow type system requires explicit integer types
- `apache-arrow` already in devDependencies (transitive from @lancedb/lancedb), no extra install needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PRAGMA busy_timeout returns key 'timeout' not 'busy_timeout'**
- **Found during:** Task 1 (SQLite tests)
- **Issue:** Test asserted `row.busy_timeout` but SQLite PRAGMA returns object `{ timeout: 5000 }`
- **Fix:** Updated test assertion to use `row.timeout`
- **Files modified:** src/core/db/sqlite.test.ts
- **Verification:** Test now passes correctly
- **Committed in:** ae86647 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test assertion)
**Impact on plan:** Minor — test expected wrong property key from SQLite PRAGMA. Fix required, no scope change.

## Issues Encountered
None beyond the PRAGMA key deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both DB layers are initialized and ready for use by chunking (02) and indexer (03) phases
- assertModelMatch should be called at indexer startup before any writes
- openChunksTable vectorDimension must match the embedding provider's output dimension (1536 for OpenAI text-embedding-3-small)

---
*Phase: 01-foundation*
*Completed: 2026-04-05*
