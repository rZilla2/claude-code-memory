---
phase: 05-file-watcher-maintenance
plan: 02
subsystem: file-watcher-maintenance
tags: [watcher, cli, maintenance, mcp]
dependency_graph:
  requires: [05-01]
  provides: [mem-watch-cmd, mem-compact-cmd, mem-prune-cmd, mcp-watcher-integration]
  affects: [src/mcp/server.ts, src/cli/index.ts]
tech_stack:
  added: []
  patterns: [tdd, vitest-mocking, commander-commands]
key_files:
  created:
    - src/cli/commands/compact-cmd.ts
    - src/cli/commands/compact-cmd.test.ts
    - src/cli/commands/prune-cmd.ts
    - src/cli/commands/prune-cmd.test.ts
    - src/cli/commands/watch-cmd.ts
    - src/cli/commands/watch-cmd.test.ts
  modified:
    - src/mcp/server.ts
    - src/cli/index.ts
decisions:
  - "maybeAutoCompact is a standalone export shared by MCP server and mem watch"
  - "MCP server watcher starts after warm-up, before server.connect(transport)"
  - "SIGINT handlers use async close() for clean watcher shutdown"
metrics:
  duration: 25m
  completed: "2026-04-06"
  tasks_completed: 2
  files_modified: 8
---

# Phase 05 Plan 02: File Watcher CLI & MCP Integration Summary

**One-liner:** MCP server auto-watches vault with startup catch-up and auto-compact; `mem watch`, `mem compact`, and `mem prune` commands added with full test coverage.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add compact, prune commands and auto-compact logic | 2d662e4 | compact-cmd.ts, compact-cmd.test.ts, prune-cmd.ts, prune-cmd.test.ts |
| 2 | Wire watcher into MCP server, add mem watch CLI, register all commands | 3a16b64 | watch-cmd.ts, watch-cmd.test.ts, server.ts, cli/index.ts |

## What Was Built

### `maybeAutoCompact(db, table)`
Exported from `compact-cmd.ts`. Fires `table.optimize()` only when `lastCompactedAt > 24h` AND `updatesSinceCompact > 50`. Returns `true` if compaction ran. Used by both MCP server and `mem watch` on startup.

### `mem compact`
Always runs `table.optimize()` + `recordCompaction()` regardless of thresholds. For manual optimization.

### `mem prune [--dry-run]`
Compares SQLite file paths against disk scan. For each orphan: calls `deleteChunksByPath()` then `deleteFileMetadata()`. Dry-run mode lists orphans without deleting.

### `mem watch`
Foreground watcher: calls `maybeAutoCompact` → `startupCatchUp` → `createWatcher`. Handles SIGINT with `watcher.close()` + `db.close()`.

### MCP Server Integration
After warm-up: `assertModelMatch` → `maybeAutoCompact` (non-fatal) → `startupCatchUp` (non-fatal) → `createWatcher`. Process exit handlers call `watcher.close()`.

## Test Coverage

- 12 tests: compact-cmd (5 maybeAutoCompact threshold tests, 2 manual compact tests) + prune-cmd (5 tests)
- 5 tests: watch-cmd startup orchestration and SIGINT cleanup
- Full suite: 22 test files, 159 tests, all passing

## Deviations from Plan

None — plan executed exactly as written.

## Checkpoint Pending

Task 3 (`checkpoint:human-verify`) is awaiting human end-to-end verification of the complete watcher system.

## Self-Check

- [x] compact-cmd.ts created and exports `registerCompactCommand` and `maybeAutoCompact`
- [x] prune-cmd.ts created and exports `registerPruneCommand`
- [x] watch-cmd.ts created and exports `registerWatchCommand`
- [x] server.ts contains `createWatcher(`, `startupCatchUp(`, `maybeAutoCompact(`
- [x] cli/index.ts registers all three new commands
- [x] Commits 2d662e4 and 3a16b64 exist
- [x] 159 tests passing
