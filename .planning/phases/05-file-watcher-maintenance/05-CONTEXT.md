# Phase 5: File Watcher + Maintenance - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Keep the vector index automatically current as vault files change, and maintain index health under incremental update load. Watcher detects file changes in the Obsidian vault via chokidar v4, debounces iCloud sync noise, and triggers incremental reindexing. Maintenance covers LanceDB compaction and pruning of orphaned chunks.

Session notes continue to be saved manually (`/save-session-notes-rw2`) — the watcher picks them up like any other markdown file. Auto-session-note generation is out of scope (deferred to future).

Requirements: WATCH-01, WATCH-02, WATCH-03, WATCH-04, WATCH-05, MAINT-01, MAINT-02

</domain>

<decisions>
## Implementation Decisions

### Watcher lifecycle
- Watcher is a reusable module that can be started by either the MCP server or the CLI
- **Primary mode:** MCP server starts the watcher on connect, stops on disconnect. Index stays fresh during active Claude Code sessions automatically. Zero user setup.
- **Fallback mode:** `mem watch` foreground CLI command for when Rod wants the index fresh without Claude Code running. Runs until Ctrl+C.
- **Startup catch-up scan:** On MCP server start (or `mem watch` start), run a quick hash-diff scan of vault files against SQLite metadata. Re-index any files where hash changed since last session. Covers the gap when vault was edited while watcher wasn't running. Reuses existing `indexFile()` bulk path.
- No background daemon. No launchd plist. No PID files. Keep it simple for v1.

### iCloud event deduplication
- chokidar v4 with `awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }` (from PITFALLS.md)
- Ignore patterns: `**/*.icloud`, `**/.*` (hidden files)
- **5-second batch window:** Collect all changed file paths over a 5-second window after the last debounced event. Process the entire batch as a single bulk reindex call via the existing indexer. One embedding API batch, not N individual calls.
- This naturally absorbs iCloud bulk sync bursts (50-200 files when Mac syncs from iPhone edits)

### Compaction triggers
- **Hybrid approach:** Auto-compact on MCP server startup (or `mem watch` startup) if BOTH conditions are met: last compaction was >24 hours ago AND >50 incremental updates since last compact
- Track compaction metadata in SQLite: `last_compacted_at` timestamp and `updates_since_compact` counter
- `mem compact` manual command for on-demand compaction
- Compaction calls `table.optimize()` on LanceDB chunks table
- No background timers, no watcher-triggered compaction — startup check only

### Rename handling
- **Content hash match within batch window:** When processing a batch, check for `unlink` + `add` pairs where the added file's content hash matches an unlinked file's stored hash in SQLite
- Matching pairs are treated as renames: update `source_path` in SQLite metadata and LanceDB chunk rows, skip re-embedding entirely
- Non-matching unlinks (no corresponding add with same hash) are real deletes: remove chunks
- Non-matching adds (no corresponding unlink with same hash) are new/modified files: full reindex
- Fits naturally into the 5-second batch window — all events collected before any processing begins

### Claude's Discretion
- Exact chokidar v4 API usage and configuration beyond the locked settings above
- Batch window implementation (timer-based vs event-count-based reset)
- How startup catch-up scan reports progress (stderr progress bar vs silent)
- `mem compact` output format and verbosity
- Error handling for watcher crashes (auto-restart within process vs exit)
- `mem prune` implementation details (scan vault paths, diff against SQLite, delete orphaned chunks)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — Project vision, constraints, key decisions
- `.planning/REQUIREMENTS.md` — Full v1 requirements; WATCH-01 through WATCH-05 and MAINT-01, MAINT-02 are this phase
- `.planning/research/STACK.md` — Validated stack with specific versions (chokidar v4 decision)
- `.planning/research/ARCHITECTURE.md` — Component boundaries and data flow
- `.planning/research/PITFALLS.md` — Critical pitfalls: iCloud event storms (#7), `.icloud` placeholders (#8), chokidar v3→v4 migration (#15)

### Prior phase context
- `.planning/phases/01-foundation/01-CONTEXT.md` — Config format, index structure, path safety
- `.planning/phases/02-index-pipeline/02-CONTEXT.md` — Chunking strategy, hashing, indexer patterns
- `.planning/phases/04-consumer-surfaces/04-CONTEXT.md` — MCP server architecture, warm-up pattern

### Existing code to build on
- `src/core/indexer.ts` — `indexFile()` for single-file reindex, `indexVault()` for bulk, `deleteChunksByPath()` for cleanup
- `src/core/scanner.ts` — `scanVault()` returns file paths with ignore patterns
- `src/core/db/sqlite.ts` — `openMetadataDb()`, file hash storage, metadata queries
- `src/core/db/lance.ts` — `connectLanceDb()`, `openChunksTable()`, chunk operations
- `src/mcp/server.ts` — `startMcpServer()` where watcher integration point lives
- `src/cli/index.ts` — Commander CLI entry point with `registerXCommand()` pattern
- `src/config.ts` — `loadConfig()` with Zod validation

### Key version pins
- `chokidar` v4.x (NOT v3 — v4 rewrites in TypeScript, drops fsevents bundle)
- LanceDB `table.optimize()` for compaction

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `indexFile(filePath, config, db, table, embedder)` — Already handles delete-then-reinsert for a single file. Watcher calls this per-file or uses `indexVault()` with a file filter for batch mode.
- `deleteChunksByPath(table, filePath)` — Removes all chunks for a source path. Used for real deletes and rename cleanup.
- `scanVault(config)` — Returns all vault file paths respecting ignore patterns. Startup catch-up scan can diff this against SQLite.
- SHA-256 content hashing (Phase 2) — Already in `indexer.ts` for hash-gating. Reusable for rename detection.
- `registerXCommand(program)` pattern — `mem watch`, `mem compact`, `mem prune` follow the same CLI pattern.
- stderr-only logger — All output via `src/logger.ts`, critical for MCP server integration.

### Established Patterns
- SQLite WAL mode for concurrent reads during indexing
- LanceDB Apache Arrow schema for chunk storage
- Commander subcommand registration via `registerXCommand()`
- Config loading with Zod validation and typed defaults

### Integration Points
- `src/mcp/server.ts` — Watcher starts after warm-up, before `server.connect(transport)`. Stops on process exit.
- `src/cli/index.ts` — New commands: `mem watch`, `mem compact`, `mem prune`
- `src/core/db/sqlite.ts` — New metadata: `last_compacted_at`, `updates_since_compact`
- New module: `src/core/watcher.ts` — Shared watcher logic used by both MCP and CLI

</code_context>

<specifics>
## Specific Ideas

- Startup catch-up scan should be fast (<10 seconds for a 2000-file vault) — it's just hash comparisons against SQLite, no embedding unless files actually changed
- The 5-second batch window reuses the same `indexVault()` bulk path from Phase 2, just with a filtered file list instead of the full vault scan
- `mem prune` is the maintenance counterpart to `mem index` — scan vault for what exists, diff against SQLite, delete orphaned chunks

</specifics>

<deferred>
## Deferred Ideas

- Auto-session-note generation from conversation monitoring — future feature, continue using `/save-session-notes-rw2` for now
- launchd plist for always-on background watching — add if Rod finds the MCP-integrated approach insufficient
- Watching `~/.claude/projects/*/memory/` paths in addition to the vault — would require multi-root watcher config

</deferred>

---

*Phase: 05-file-watcher-maintenance*
*Context gathered: 2026-04-06*
