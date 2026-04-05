---
phase: 02-index-pipeline
plan: "03"
subsystem: index-pipeline
tags: [indexer, sqlite, lancedb, orchestrator, tdd]
dependency_graph:
  requires: ["02-01", "02-02"]
  provides: ["indexVault", "indexFile", "IndexResult", "IndexFileResult", "getFileHash", "upsertFile", "getStatus", "deleteChunksByPath"]
  affects: ["03-mcp-server"]
tech_stack:
  added: []
  patterns: ["delete-before-insert", "file-level hash gating", "retry-once on transient error", "TDD red-green"]
key_files:
  created:
    - src/core/indexer.ts
    - src/core/indexer.test.ts
  modified:
    - src/core/db/sqlite.ts
    - src/core/db/lance.ts
decisions:
  - "Retry logic: one retry attempt per file before marking as failed and continuing — balances resilience vs throughput"
  - "Hash gate uses SHA-256 of full file content (not mtime) — mtime unreliable across iCloud sync"
  - "deleteChunksByPath called before embed+add: prevents stale chunk contradictions even if add fails mid-flight"
metrics:
  duration: "~12 minutes"
  completed: "2026-04-05"
  tasks_completed: 2
  files_changed: 4
---

# Phase 02 Plan 03: Indexer Orchestrator Summary

**One-liner:** Hash-gated index pipeline with delete-before-insert, retry logic, and SQLite/LanceDB helper extensions.

## Tasks Completed

| Task | Commit | Description |
|------|--------|-------------|
| 1: Extend DB helpers | 7bd7605 | Added getFileHash, upsertFile, getStatus to SQLite; deleteChunksByPath to LanceDB |
| 2: Indexer orchestrator (TDD) | a128ef8 | indexVault + indexFile with all behaviors; 7 unit tests green |

## What Was Built

**`src/core/db/sqlite.ts` additions:**
- `getFileHash(db, filePath)` — returns stored SHA-256 or null for new files
- `upsertFile(db, file)` — INSERT ON CONFLICT(path) DO UPDATE for file metadata
- `getStatus(db)` — aggregate counts and last indexed timestamp
- `StatusResult` interface

**`src/core/db/lance.ts` additions:**
- `deleteChunksByPath(table, sourcePath)` — SQL predicate delete with `''`-escaped single quotes

**`src/core/indexer.ts`:**
- `indexFile` — per-file pipeline: read -> SHA-256 hash gate -> delete stale -> chunk -> embed -> add to LanceDB -> upsertFile
- `indexVault` — scans vault, processes each file, accumulates IndexResult, progress callback
- Retry once on any error before marking file as failed
- Returns `IndexResult` with `filesIndexed / filesSkipped / filesFailed / chunksCreated / failedPaths`

**`src/core/indexer.test.ts`:**
- 7 tests covering: new file embedding, unchanged file skip, delete-before-insert ordering, result count accumulation, read error resilience, embedder error resilience, IndexFileResult shape

## Verification

- `npm test` — 70/70 tests pass (9 test files)
- `npx tsc --noEmit` — 0 type errors
- delete-before-insert order verified in Test 3 via `callOrder` array
- Hash-gate skip verified in Test 2 (embedder.embed not called)
- chunksCreated accumulation verified in Test 4 (2+0+1=3)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- src/core/indexer.ts — FOUND
- src/core/indexer.test.ts — FOUND
- src/core/db/sqlite.ts (getFileHash, upsertFile, getStatus) — FOUND
- src/core/db/lance.ts (deleteChunksByPath) — FOUND
- Commits 7bd7605, a128ef8 — FOUND
