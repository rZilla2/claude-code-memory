---
phase: 05-file-watcher-maintenance
plan: "01"
subsystem: file-watcher
tags: [chokidar, watcher, sqlite, lancedb, tdd, batch-processing, rename-detection]
dependency_graph:
  requires: [04-consumer-surfaces]
  provides: [watcher-module, compaction-metadata, indexFiles-batch-helper]
  affects: [mcp-server, cli-watch-command]
tech_stack:
  added: [chokidar@4.0.3]
  patterns: [batch-window-timer, content-hash-rename-detection, mtime-prefilter-catch-up]
key_files:
  created:
    - src/core/watcher.ts
    - src/core/watcher.test.ts
  modified:
    - src/core/db/sqlite.ts
    - src/core/db/lance.ts
    - src/core/indexer.ts
    - package.json
decisions:
  - "chokidar v4 watch() named export (not default) — v4 is full TypeScript rewrite"
  - "processBatch exported for unit testing — enables mock-based test isolation"
  - "startupCatchUp uses db.prepare() directly for indexed_at lookup (not getFileHash) — needs both fields in one query"
  - "incrementUpdateCounter called only for filesIndexed count (not filesFailed) — accurate update tracking"
metrics:
  duration: ~20 minutes
  completed: "2026-04-06"
  tasks_completed: 2
  files_modified: 6
---

# Phase 05 Plan 01: File Watcher + DB Helpers Summary

Core file watcher module with chokidar v4, 5-second batch window, content-hash rename detection, startup catch-up scan, and all supporting SQLite/LanceDB helpers.

## What Was Built

### Task 1: Install chokidar, extend DB helpers, add indexFiles batch helper

Installed `chokidar@4.0.3`. Extended `src/core/db/sqlite.ts` with 6 new exports:
- `getCompactionMetadata` / `incrementUpdateCounter` / `recordCompaction` — tracks `last_compacted_at` + `updates_since_compact` as key-value rows in `index_metadata`
- `updateSourcePath` — renames a file path in SQLite without re-embedding
- `getAllFilePaths` — lists all indexed paths (for prune/catch-up)
- `deleteFileMetadata` — removes a file row from SQLite

Extended `src/core/db/lance.ts` with 2 new exports:
- `getChunksByPath` — queries chunks by `source_path`
- `updateChunksSourcePath` — renames chunks without re-embedding (delete old + re-add with new path)

Added `indexFiles()` to `src/core/indexer.ts` — a batch helper that retries each file once before marking failed.

### Task 2: Watcher module (TDD)

`src/core/watcher.ts` exports `createWatcher`, `processBatch`, `startupCatchUp`.

**createWatcher:** chokidar v4 with `awaitWriteFinish` (stabilityThreshold 1500ms, pollInterval 200ms), `ignored: ['**/*.icloud', '**/.*']`, `ignoreInitial: true`. Collects `.md` events into a Set, batches with a 5-second debounce timer.

**processBatch:** Classifies paths as existing (add/change) or missing (unlink) via `fs.access`. Computes SHA-256 for add candidates, fetches stored hashes for unlinks, matches pairs for rename detection. Dispatches: rename → `updateChunksSourcePath` + `updateSourcePath`; delete → `deleteChunksByPath` + `deleteFileMetadata`; add/change → `indexFiles`. Calls `incrementUpdateCounter` with reindexed count.

**startupCatchUp:** Scans vault, pre-filters by `mtime <= indexed_at` (fast skip), then hash-diffs remaining files. Calls `indexFiles` on stale files only.

## Commits

| Hash | Message |
|------|---------|
| 3f714bf | feat(05-01): install chokidar v4, extend DB helpers, add indexFiles batch helper |
| af22a2d | test(05-01): add failing tests for watcher module (RED) |
| 740eec0 | feat(05-01): implement watcher module with batch window, rename detection, catch-up scan |

## Test Results

- `src/core/watcher.test.ts`: 14 tests, all passing
- Full suite: 142 tests across 19 files, all passing, no regressions

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/core/watcher.ts` exists with all required exports
- `src/core/watcher.test.ts` exists with 14 tests
- All commits verified in git log
- TypeScript compiles with no new errors
