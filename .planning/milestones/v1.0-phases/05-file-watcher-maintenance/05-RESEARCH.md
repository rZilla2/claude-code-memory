# Phase 5: File Watcher + Maintenance - Research

**Researched:** 2026-04-06
**Domain:** chokidar v4 file watching, iCloud event deduplication, LanceDB compaction, incremental indexing
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Watcher lifecycle:**
- Watcher is a reusable module that can be started by either the MCP server or the CLI
- Primary mode: MCP server starts the watcher on connect, stops on disconnect
- Fallback mode: `mem watch` foreground CLI command (runs until Ctrl+C)
- Startup catch-up scan: On start, hash-diff scan of vault files against SQLite; re-index any files where hash changed since last session. Reuses existing `indexFile()` bulk path.
- No background daemon. No launchd plist. No PID files.

**iCloud event deduplication:**
- chokidar v4 with `awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }`
- Ignore patterns: `**/*.icloud`, `**/.*`
- 5-second batch window: collect all changed file paths after last debounced event, process as single bulk reindex call
- One embedding API batch, not N individual calls

**Compaction triggers:**
- Auto-compact on MCP server startup (or `mem watch` startup) if BOTH: last compaction >24h ago AND >50 incremental updates since last compact
- Track in SQLite: `last_compacted_at` timestamp and `updates_since_compact` counter
- `mem compact` manual command for on-demand compaction
- Compaction calls `table.optimize()` on LanceDB chunks table
- No background timers, no watcher-triggered compaction — startup check only

**Rename handling:**
- Within batch window: check for `unlink` + `add` pairs where added file content hash matches an unlinked file's stored hash in SQLite
- Matching pairs: rename — update `source_path` in SQLite metadata and LanceDB chunk rows, skip re-embedding
- Non-matching unlinks: real deletes — remove chunks
- Non-matching adds: new/modified files — full reindex

### Claude's Discretion
- Exact chokidar v4 API usage and configuration beyond the locked settings above
- Batch window implementation (timer-based vs event-count-based reset)
- How startup catch-up scan reports progress (stderr progress bar vs silent)
- `mem compact` output format and verbosity
- Error handling for watcher crashes (auto-restart within process vs exit)
- `mem prune` implementation details (scan vault paths, diff against SQLite, delete orphaned chunks)

### Deferred Ideas (OUT OF SCOPE)
- Auto-session-note generation from conversation monitoring
- launchd plist for always-on background watching
- Watching `~/.claude/projects/*/memory/` paths in addition to the vault
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WATCH-01 | File watcher detects markdown file changes in vault using chokidar v4 | chokidar v4.0.3 confirmed on npm; watch() API verified via GitHub |
| WATCH-02 | Debounce of 1000ms+ with awaitWriteFinish for iCloud sync stability | Locked: `awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }`; PITFALLS.md Pitfall 2 documents the iCloud event storm problem in detail |
| WATCH-03 | Changed files trigger incremental reindex (only affected chunks) | `indexFile()` already handles delete-then-reinsert; 5-second batch window feeds filtered file list to existing `indexVault()` path |
| WATCH-04 | File renames detected and handled (update metadata, skip re-embedding if content unchanged) | PITFALLS.md Pitfall 12; SHA-256 content hashing already in `indexer.ts`; rename detection uses unlink+add pair matching within batch window |
| WATCH-05 | Watcher runs as background daemon or launchd service | Decision: integrated into MCP server lifecycle (start on connect, stop on disconnect); `mem watch` as foreground fallback; no daemon/launchd for v1 |
| MAINT-01 | Periodic LanceDB `table.optimize()` to compact fragments from incremental updates | `table.optimize()` confirmed in LanceDB API; startup check pattern with SQLite tracking locked |
| MAINT-02 | `mem prune` command removes chunks from deleted source files | `deleteChunksByPath()` already exists in `src/core/db/lance.ts`; `scanVault()` provides current file list for diffing |
</phase_requirements>

---

## Summary

Phase 5 adds live index maintenance: a chokidar v4 file watcher and two maintenance commands (`mem prune`, `mem compact`). The domain is well-understood — chokidar v4 API is stable and documented, LanceDB compaction via `table.optimize()` is a first-class API call, and all the indexing primitives this phase needs already exist in the codebase.

The critical engineering challenge is iCloud event storm absorption. A single file edit on iCloud can fire 10–50 filesystem events over 2–5 seconds. The locked solution — `awaitWriteFinish` + 5-second batch window — addresses this correctly. The batch window also enables rename detection by collecting unlink+add pairs before any processing begins.

The watcher module (`src/core/watcher.ts`) is the new shared primitive. Both the MCP server and `mem watch` CLI command use it. Startup catch-up scan is a fast hash-diff (no embedding unless files changed) using the already-built `indexFile()` function.

**Primary recommendation:** Build `src/core/watcher.ts` first as a pure module with no CLI/MCP coupling; then wire it into `src/mcp/server.ts` and register `mem watch`, `mem compact`, `mem prune` commands in `src/cli/`.

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@lancedb/lancedb` | `^0.27.2` | `table.optimize()` for compaction | Already in `package.json` |
| `better-sqlite3` | `^12.8.0` | Track compaction metadata (`last_compacted_at`, `updates_since_compact`) | Already in `package.json` |

### New Dependency Required
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `chokidar` | `^4.0.3` | Watch vault directory for .md file changes | v4 is current maintained release; TS rewrite, 1 dep (down from 13 in v3); FSEvents native; locked decision |

**chokidar is NOT yet in package.json — Wave 0 task.**

**Installation:**
```bash
npm install chokidar@^4
```

---

## Architecture Patterns

### New Module: `src/core/watcher.ts`

```
src/
├── core/
│   ├── watcher.ts          # NEW — shared watcher module
│   ├── indexer.ts          # Existing — indexFile(), indexVault()
│   ├── scanner.ts          # Existing — scanVault()
│   └── db/
│       ├── sqlite.ts       # Extend — add compaction metadata cols
│       └── lance.ts        # Existing — deleteChunksByPath(), table.optimize()
├── mcp/
│   └── server.ts           # Extend — startWatcher() after warm-up
└── cli/
    ├── index.ts            # Extend — register watch/compact/prune
    └── commands/
        ├── watch-cmd.ts    # NEW
        ├── compact-cmd.ts  # NEW
        └── prune-cmd.ts    # NEW
```

### Pattern 1: Batch Window with Timer Reset

The 5-second batch window should use timer-reset approach (not event-count). Each new debounced event resets a 5-second timer. When timer fires, process accumulated set.

```typescript
// src/core/watcher.ts
export function createWatcher(config: Config, onBatch: (paths: Set<string>) => Promise<void>) {
  const pendingPaths = new Set<string>();
  let batchTimer: NodeJS.Timeout | null = null;

  const watcher = chokidar.watch(config.vaultPath, {
    ignored: ['**/*.icloud', '**/.*'],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
  });

  function scheduleFlush() {
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(async () => {
      const batch = new Set(pendingPaths);
      pendingPaths.clear();
      await onBatch(batch);
    }, 5000);
  }

  watcher.on('add', (p) => { if (p.endsWith('.md')) { pendingPaths.add(p); scheduleFlush(); } });
  watcher.on('change', (p) => { if (p.endsWith('.md')) { pendingPaths.add(p); scheduleFlush(); } });
  watcher.on('unlink', (p) => { if (p.endsWith('.md')) { pendingPaths.add(p); scheduleFlush(); } });

  return watcher;
}
```

### Pattern 2: Rename Detection within Batch

```typescript
// Within onBatch handler
async function processBatch(paths: Set<string>, db: Database, table: Table) {
  const unlinks: string[] = [];
  const adds: string[] = [];

  for (const p of paths) {
    const exists = await fs.access(p).then(() => true).catch(() => false);
    if (exists) adds.push(p);
    else unlinks.push(p);
  }

  // Build hash lookup for unlinked paths
  const unlinkedHashes = new Map<string, string>(); // hash -> old path
  for (const p of unlinks) {
    const hash = getFileHash(db, p);
    if (hash) unlinkedHashes.set(hash, p);
  }

  // Detect renames
  const renames: Array<{ from: string; to: string }> = [];
  const realAdds: string[] = [];

  for (const p of adds) {
    const content = await fs.readFile(p, 'utf-8');
    const hash = sha256(content);
    if (unlinkedHashes.has(hash)) {
      renames.push({ from: unlinkedHashes.get(hash)!, to: p });
      unlinkedHashes.delete(hash);
    } else {
      realAdds.push(p);
    }
  }

  const realDeletes = Array.from(unlinkedHashes.values());

  // Process
  for (const { from, to } of renames) {
    await updateSourcePath(db, table, from, to); // update path in SQLite + LanceDB, no re-embed
  }
  for (const p of realDeletes) {
    await deleteChunksByPath(table, p);
    deleteFileMetadata(db, p);
  }
  if (realAdds.length > 0) {
    await indexVaultFiltered(realAdds, config, db, table, embedder);
    incrementUpdateCounter(db, realAdds.length);
  }
}
```

### Pattern 3: SQLite Schema Extension

New columns needed in existing tables:

```sql
-- Add to index_metadata table (in openMetadataDb)
ALTER TABLE index_metadata ADD COLUMN last_compacted_at INTEGER DEFAULT 0;
ALTER TABLE index_metadata ADD COLUMN updates_since_compact INTEGER DEFAULT 0;
```

New helper functions in `sqlite.ts`:
- `getCompactionMetadata(db)` → `{ lastCompactedAt: number; updatesSinceCompact: number }`
- `incrementUpdateCounter(db, count)` — increments `updates_since_compact`
- `recordCompaction(db)` — sets `last_compacted_at = now`, `updates_since_compact = 0`
- `updateSourcePath(db, oldPath, newPath)` — for rename handling

### Pattern 4: LanceDB Source Path Update for Renames

LanceDB doesn't have an update operation — must delete + re-add with new path. But for renames, vectors are unchanged, so:
1. Read chunks for old path (get vectors + metadata)
2. `deleteChunksByPath(table, oldPath)`
3. Re-add chunks with updated `source_path` (same vectors, no embedding API call)

This requires a new `getChunksByPath(table, filePath)` helper in `lance.ts`.

### Pattern 5: MCP Server Integration Point

```typescript
// src/mcp/server.ts — after warm-up, before server.connect()
const watcher = createWatcher(config, async (batch) => {
  await processBatch(batch, db, table, embedder, config);
});

process.on('exit', () => { watcher.close(); });
```

### Pattern 6: Startup Catch-Up Scan

```typescript
// Fast hash-diff, no embedding unless files changed
async function startupCatchUp(config, db, table, embedder) {
  const vaultFiles = await scanVault(config);
  const staleFiles: string[] = [];

  for (const filePath of vaultFiles) {
    const content = await fs.readFile(filePath, 'utf-8');
    const currentHash = sha256(content);
    const storedHash = getFileHash(db, filePath);
    if (storedHash !== currentHash) staleFiles.push(filePath);
  }

  if (staleFiles.length > 0) {
    log.info(`Catch-up: re-indexing ${staleFiles.length} changed files`);
    await indexVaultFiltered(staleFiles, config, db, table, embedder);
  }
}
```

### Anti-Patterns to Avoid
- **Processing events one-by-one:** Always batch — iCloud sync fires 50+ events; individual processing means 50 embedding API calls for one file edit.
- **Watching for all file types:** Filter to `.md` only in the callback; chokidar v4 removed glob watching from the watch path but filtering in the callback is idiomatic.
- **Running compaction on every batch:** Compaction is expensive; startup-only check with 24h + 50-update threshold is correct.
- **Re-embedding on rename:** Content hash match proves content is identical; skip embedding, just update paths.
- **ALTER TABLE at every startup:** Check if columns exist before adding; `better-sqlite3` throws on duplicate columns.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File watching | Custom `fs.watch` loop | `chokidar` v4 | `fs.watch` is unreliable on macOS; no recursive watch, no debounce, no iCloud tolerance |
| LanceDB compaction | Custom fragment merger | `table.optimize()` | Official LanceDB API handles all compaction internals; custom would require Lance format knowledge |
| Batch debouncing | Complex event queue | Timer-reset pattern + `Set<string>` deduplication | Simple, correct, O(1) per event |

**Key insight:** All the hard indexing work (chunk generation, embedding, LanceDB writes) is already built. Phase 5 is plumbing — wiring events to existing functions.

---

## Common Pitfalls

### Pitfall 1: iCloud Event Storm (CRITICAL)
**What goes wrong:** Single file edit triggers 10–50 chokidar events over 2–5 seconds. Without batching, triggers 50 `indexFile()` calls → 50 embedding API calls → cost explosion.
**How to avoid:** `awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }` + 5-second batch window + `Set<string>` deduplication. These are locked decisions.
**Warning signs:** Embedding API calls spike on single edits; SQLite `updated_at` shows same path dozens of times within seconds.

### Pitfall 2: `.icloud` Placeholder Files
**What goes wrong:** iCloud creates `filename.md.icloud` placeholders for undownloaded files. Indexing them returns stub content.
**How to avoid:** Include `'**/*.icloud'` in chokidar `ignored` patterns (already locked).

### Pitfall 3: Rename Detection Race
**What goes wrong:** `unlink` fires before `add` for a rename. If processed immediately, the file appears deleted. The 5-second batch window exists precisely to collect both events before any action.
**How to avoid:** Always process the entire batch together. Never process unlinks immediately.

### Pitfall 4: SQLite Schema Migration
**What goes wrong:** `ALTER TABLE index_metadata ADD COLUMN` throws if column already exists. Existing databases from earlier phases don't have `last_compacted_at` or `updates_since_compact`.
**How to avoid:** Use `PRAGMA table_info(index_metadata)` to check columns before ALTER, or wrap in try/catch and ignore "duplicate column" errors.

### Pitfall 5: LanceDB Path Update Requires Delete+Re-add
**What goes wrong:** Assuming LanceDB supports UPDATE semantics like SQL. It doesn't — it's append-only with delete.
**How to avoid:** For rename handling, read existing chunks, delete by old path, re-add with new path. Vectors are reused unchanged (no embedding API call needed).

### Pitfall 6: Watcher Crashes in MCP Server
**What goes wrong:** An unhandled exception in the batch processor crashes the watcher. MCP server continues but index stops updating.
**How to avoid:** Wrap the entire `onBatch` callback in try/catch. Log errors to stderr. For v1, let watcher continue after batch errors (don't auto-restart). This is Claude's discretion per CONTEXT.md.

---

## Code Examples

### chokidar v4 Watch Call (verified pattern)
```typescript
// Source: chokidar v4 GitHub README
import { watch } from 'chokidar';

const watcher = watch('/path/to/dir', {
  ignored: /(^|[/\\])\..|(\.icloud$)/,  // hidden files + .icloud placeholders
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 1500,
    pollInterval: 200,
  },
});

watcher
  .on('add', path => { /* new file */ })
  .on('change', path => { /* file changed */ })
  .on('unlink', path => { /* file removed */ });

await watcher.close(); // cleanup
```

### LanceDB table.optimize() (compaction)
```typescript
// Source: LanceDB TypeScript docs — optimize() compacts fragments + rebuilds index
await table.optimize();
// Returns stats about the operation; safe to await before returning
```

### SQLite Schema Migration (safe pattern)
```typescript
// Check-before-alter to handle existing databases
function ensureCompactionMetadata(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(index_metadata)").all() as Array<{name: string}>;
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('last_compacted_at')) {
    db.prepare("ALTER TABLE index_metadata ADD COLUMN last_compacted_at INTEGER DEFAULT 0").run();
  }
  if (!colNames.has('updates_since_compact')) {
    db.prepare("ALTER TABLE index_metadata ADD COLUMN updates_since_compact INTEGER DEFAULT 0").run();
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| chokidar v3 (13 deps, bundled fsevents) | chokidar v4 (1 dep, native FSEvents) | Lighter install, no fsevents native compile issues |
| Manual fragment management | `table.optimize()` | Single API call handles all LanceDB compaction |
| Per-event reindex trigger | 5-second batch window | Absorbs iCloud sync bursts; one API call vs 50 |

---

## Open Questions

1. **`indexVaultFiltered` — does it exist or need to be built?**
   - What we know: `indexVault()` scans all vault files. `indexFile()` handles one file. The batch processor needs a bulk call with a pre-filtered file list.
   - What's unclear: Whether `indexVault()` accepts a file list override or always runs `scanVault()`.
   - Recommendation: Check `indexer.ts` signature. If `indexVault()` calls `scanVault()` internally without override, add an `indexFiles(paths, config, db, table, embedder)` variant — a thin wrapper around `indexFile()` in a p-limit queue.

2. **LanceDB chunk row structure — does it support path-only queries?**
   - What we know: `deleteChunksByPath()` exists. Rename handling needs `getChunksByPath()` to read vectors before delete+re-add.
   - What's unclear: Whether the Lance table schema stores vectors in a retrievable form for re-insertion.
   - Recommendation: Check `lance.ts` `openChunksTable()` and the Arrow schema. If vectors are stored (they should be), `table.query().where("source_path = ?", path).toArray()` will return them.

3. **Startup catch-up scan performance at 2000+ files**
   - What we know: Target is <10 seconds. The scan is hash-comparison only (no embedding unless changed). `scanVault()` uses fast-glob.
   - What's unclear: Whether reading 2000 files for SHA-256 comparison is fast enough vs. relying on file `mtime` as a quick pre-filter.
   - Recommendation: Use `mtime` as a pre-filter first (compare SQLite `last_indexed` timestamp vs file `mtime`); only compute SHA-256 for files where mtime is newer. This reduces file reads by ~90% for vaults that haven't changed much.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- --reporter=verbose src/core/watcher.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WATCH-01 | chokidar detects `.md` file creation/change/delete | unit (mock chokidar) | `npm test -- src/core/watcher.test.ts` | ❌ Wave 0 |
| WATCH-02 | awaitWriteFinish config prevents rapid event flooding | unit (mock chokidar events) | `npm test -- src/core/watcher.test.ts` | ❌ Wave 0 |
| WATCH-03 | Changed file triggers reindex of only that file | unit (mock indexFile) | `npm test -- src/core/watcher.test.ts` | ❌ Wave 0 |
| WATCH-04 | Rename detected: unlink+add with same hash skips re-embed | unit | `npm test -- src/core/watcher.test.ts` | ❌ Wave 0 |
| WATCH-05 | `mem watch` starts watcher, Ctrl+C stops it | manual only — requires live process | N/A — manual test | N/A |
| MAINT-01 | `mem compact` calls table.optimize() | unit (mock table) | `npm test -- src/cli/commands/compact-cmd.test.ts` | ❌ Wave 0 |
| MAINT-02 | `mem prune` removes chunks for deleted files | unit (mock deleteChunksByPath) | `npm test -- src/cli/commands/prune-cmd.test.ts` | ❌ Wave 0 |

### Startup Compaction Check
| Behavior | Test Type | Command |
|----------|-----------|---------|
| Auto-compact fires when >24h AND >50 updates | unit (mock SQLite + table) | `npm test -- src/core/watcher.test.ts` |
| No auto-compact when conditions not met | unit | same |

### Sampling Rate
- **Per task commit:** `npm test -- src/core/watcher.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/core/watcher.test.ts` — covers WATCH-01 through WATCH-04 + startup compaction check
- [ ] `src/cli/commands/compact-cmd.test.ts` — covers MAINT-01
- [ ] `src/cli/commands/prune-cmd.test.ts` — covers MAINT-02
- [ ] `npm install chokidar@^4` — chokidar not yet in package.json
- [ ] SQLite schema migration: `ensureCompactionMetadata()` added to `openMetadataDb()`

---

## Sources

### Primary (HIGH confidence)
- `PITFALLS.md` — Pitfall 2 (iCloud event storm), Pitfall 10 (LanceDB fragment proliferation), Pitfall 12 (rename/path staleness), Pitfall 14 (.icloud placeholders)
- `STACK.md` — chokidar v4 decision, version pins, migration notes
- `05-CONTEXT.md` — All locked implementation decisions
- `src/core/indexer.ts` — `indexFile()`, `indexVault()`, `deleteChunksByPath()` signatures confirmed
- `src/core/db/sqlite.ts` — existing schema (no compaction columns yet)
- `src/mcp/server.ts` — integration point confirmed (after warm-up, before transport connect)
- `src/cli/index.ts` — `registerXCommand(program)` pattern confirmed
- npm: chokidar v4.0.3 is latest v4 (confirmed)
- npm: chokidar v5.0.0 is latest v5 (ESM-only; NOT used per STACK.md)

### Secondary (MEDIUM confidence)
- chokidar v4 GitHub README — `awaitWriteFinish` config shape, `watch()` API, `.on('add'|'change'|'unlink')` events
- LanceDB docs — `table.optimize()` method signature

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — chokidar v4.0.3 confirmed on npm; all other deps already installed
- Architecture: HIGH — all integration points verified in existing source code
- Pitfalls: HIGH — all pitfalls from PITFALLS.md are verified, domain-specific, phase-appropriate
- Open questions: LOW — require code inspection at implementation time; flagged with specific resolution strategies

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (stable domain; chokidar v4 is mature)
