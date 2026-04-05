# Domain Pitfalls: Vector DB Semantic Memory for Markdown Vaults

**Domain:** Embedded vector database + RAG + file watcher + MCP server
**Researched:** 2026-04-05
**Confidence:** HIGH (multiple sources verified per pitfall)

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or silent retrieval failure.

---

### Pitfall 1: LanceDB Index Stored Inside iCloud

**What goes wrong:** Storing the LanceDB index anywhere under `~/Library/Mobile Documents/` causes iCloud to sync `.lance` files. Lance format is a multi-file columnar store — iCloud interleaves partial sync of fragment files, manifest files, and version files. Reads during a sync window return corrupt or missing data. Writes collide with in-progress cloud sync operations.

**Why it happens:** Developers co-locate the index with the vault for convenience. iCloud syncs everything under its directories aggressively and out-of-order relative to Lance's transactional write sequence.

**Consequences:** Corrupt vector table, silent wrong results, crashes on index open, partial fragments that fail compaction.

**Prevention:** Store index at `~/.claude-code-memory/` — completely outside iCloud. This is already decided in PROJECT.md. Enforce it by asserting the index path at startup: if it resolves to a path containing `Mobile Documents`, abort with a clear error.

**Detection:** Unexpected `TABLE_NOT_FOUND` errors, Lance open failures, or `compaction` errors on a freshly built index.

**Phase:** Phase 1 (foundation) — bake the path enforcement into the very first indexer code.

---

### Pitfall 2: iCloud File Watcher Event Storm

**What goes wrong:** chokidar watches the vault directory. iCloud sync generates cascading `change` + `add` + `unlink` + `add` sequences for each syncing file. A single remote edit to one file can fire 10–50 events over 2–5 seconds. Without aggressive debouncing, this triggers 50 re-embed jobs for one actual change.

**Why it happens:** iCloud's sync protocol writes a `.icloud` placeholder, deletes it, writes the real file, updates metadata — all as separate filesystem events. FSEvents on macOS coalesces some events but not all.

**Consequences:** Embedding API cost explosion, SQLite write contention, LanceDB fragment proliferation requiring emergency compaction, CPU spike that makes the system feel broken.

**Prevention:**
- Debounce at minimum 1000ms (not 500ms) for iCloud-backed paths. 2000ms is safer.
- Deduplicate by file path across debounce window — only re-index the file once per settled state.
- Track a `pending_reindex` set; discard duplicate paths before dispatching.
- Use `awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }` in chokidar config.

**Detection:** Embedding API calls spike on a single file edit; SQLite shows the same path written dozens of times within seconds.

**Phase:** Phase 3 (file watcher) — test explicitly against iCloud with a controlled remote edit.

---

### Pitfall 3: Chunking Strategy Destroys Retrieval Quality

**What goes wrong:** Using fixed-size token chunks (e.g., 512 tokens with no structure awareness) splits markdown across heading boundaries. A chunk starting mid-section has no heading context — the retrieval result is an orphaned fragment with no indication of what topic it belongs to.

**Why it happens:** Fixed-size chunking is the "hello world" of RAG. It's fast to implement and looks fine in unit tests. Quality problems only appear at retrieval time with real queries.

**Consequences:** Queries return semantically correct chunks that are useless without surrounding context. Recall appears to work; precision silently degrades. Users lose trust in results.

**Prevention:**
- Split by heading hierarchy (H1 → H2 → H3) using remark/unified AST. This is the biggest single quality lever.
- Include the parent heading breadcrumb in every chunk's text: `"# Parent Heading > ## Section Heading\n\n[content]"`. This preserves context even when the chunk is retrieved in isolation.
- Add 10–15% token overlap at chunk boundaries for prose sections that cross headings.
- Target chunk size of 300–500 tokens. Avoid going below 100 tokens (semantic fragments score poorly) or above 1000 tokens (too vague for precise retrieval).

**Detection:** Retrieval returns results that are clearly relevant but missing their heading context; users can't tell what note the result came from without checking the file.

**Phase:** Phase 2 (chunking) — prototype with real vault content and manually evaluate 20+ queries before locking the strategy.

---

### Pitfall 4: Embedding Model Drift (Silent Incompatibility)

**What goes wrong:** An existing index was built with `text-embedding-3-small`. The user switches to Ollama or a future OpenAI model. New chunks are embedded in the new model's vector space. Queries now compare vectors from two incompatible spaces — results are silently wrong or completely random.

**Why it happens:** There is no runtime enforcement preventing mixed embeddings in LanceDB. The dimension size may even match (both 1536-dim), so the mismatch goes undetected.

**Consequences:** Catastrophic retrieval failure with no error messages. The index appears healthy.

**Prevention:**
- Store `embedding_model_id` + `embedding_model_version` in the SQLite metadata table at index-build time.
- On every query and every index operation, assert the configured model matches stored metadata.
- On model change, require explicit `--reindex-all` flag and nuke the old LanceDB table.
- Version the index schema: store a `schema_version` integer and refuse to open an index from an incompatible version.

**Detection:** Retrieval quality drops suddenly after any config change involving embeddings; cosine similarity scores are uniformly low or erratic.

**Phase:** Phase 1 (foundation) — bake schema versioning and model fingerprinting before first write.

---

### Pitfall 5: Stale and Contradictory Memories Polluting Results

**What goes wrong:** Rod updates a note ("changed from Postgres to SQLite"). Both the old chunk ("using Postgres") and the new chunk ("switched to SQLite") coexist in the index. Retrieval returns both. Claude Code receives contradictory context and either picks the wrong one or hedges unhelpfully.

**Why it happens:** File updates generate new embeddings but old chunks from the previous version of the file are not purged. Content hashing detects that the file changed, but the old chunks remain.

**Consequences:** Decisions made on stale context. Retrieval appears complete but is factually inconsistent.

**Prevention:**
- Treat the file as the unit of truth. On any file change, delete ALL existing chunks for that `source_path` before inserting new chunks.
- Never append-only for file updates — always delete-then-reinsert.
- Add `indexed_at` timestamp to every chunk. Implement staleness scoring that deprioritizes chunks older than a configurable threshold.
- For the delete step: LanceDB supports `delete(where_clause)` — use `source_path = '{path}'` before inserting updated chunks.

**Detection:** Two chunks from the same file with contradictory content appear in results; `indexed_at` timestamps differ for the same source file.

**Phase:** Phase 2 (indexer) — test the delete-then-reinsert cycle explicitly with a file that has changed content.

---

### Pitfall 6: Bulk Indexing Token Limit Exhaustion and Cost Explosion

**What goes wrong:** Rod's vault has thousands of .md files. Naive bulk indexing sends all files to the embedding API in rapid parallel batches. OpenAI rate limits trigger 429 errors; unhandled, the indexer crashes mid-way through and leaves a partial index.

**Why it happens:** Over-parallelization during initial indexing. The OpenAI `text-embedding-3-small` limit is 1M tokens/min on tier 1. A vault of 10K files at ~500 tokens each = 5M tokens. At max concurrency, this exhausts the rate limit in seconds.

**Consequences:** Partial index, silent gaps in coverage, $$ wasted on retried requests, crash with no resumption capability.

**Prevention:**
- Implement exponential backoff with jitter on 429 responses.
- Use a concurrency limiter (e.g., `p-limit`) with a small queue size (5–10 concurrent embedding requests max during initial index).
- Persist progress to SQLite: mark files as `indexed` atomically. On restart, skip already-indexed files (idempotent indexing).
- Log estimated cost before starting bulk index and confirm with the user.

**Detection:** HTTP 429 errors in logs; SQLite shows last indexed file timestamp is hours old; vault coverage < 100%.

**Phase:** Phase 2 (bulk indexer) + Phase 1 (SQLite progress tracking) — progress tracking must exist before bulk indexing runs.

---

### Pitfall 7: MCP Server stdio Transport Corruption

**What goes wrong:** The MCP server uses stdio transport. Any `console.log()` anywhere in server code writes to stdout. MCP clients parse stdout as JSON-RPC — a stray log line corrupts the stream and causes the client to disconnect or hang.

**Why it happens:** `console.log` is the default debugging instinct. In a stdio MCP server, stdout is a protocol wire, not a terminal.

**Consequences:** Claude Code loses the MCP tool entirely. Error manifests as a generic "server disconnected" with no indication of the real cause. Extremely difficult to debug.

**Prevention:**
- Enforce a global rule: all logging goes to `stderr` only. Use `console.error()` for debug output, or a file-based logger (pino with `destination: 2`).
- Add a pre-commit hook that greps for `console.log` in MCP server files.
- Write a startup self-test that sends a known tool call and validates the round-trip.

**Detection:** `server disconnected without any error` in Claude Code logs; MCP tool disappears from available tools intermittently.

**Phase:** Phase 4 (MCP server) — establish stdout discipline before writing any server code.

---

### Pitfall 8: MCP Server Timeout During Slow Queries

**What goes wrong:** The TypeScript MCP SDK has a 60-second client timeout. LanceDB queries on large uncompacted tables, or initial cold-start with a large index loaded from disk, can exceed this threshold. The client times out, marks the tool as failed, and Claude Code receives no result.

**Why it happens:** LanceDB's HNSW index must be loaded into memory on first query (cold start). On a vault of 10K+ chunks, this can take 5–30 seconds. The MCP SDK timeout is not extended by progress notifications in the TS SDK (unlike Python SDK).

**Consequences:** First query after server start always fails. User assumes the tool is broken.

**Prevention:**
- Implement an explicit warm-up step: query a dummy vector at server startup to preload the index.
- Add a `status` MCP tool that returns index stats — clients can call this to trigger warm-up.
- Target query response under 2 seconds on warmed index. If benchmarks show otherwise, investigate LanceDB compaction state (fragmented tables are slower).
- Run compaction periodically (after N inserts) to keep fragment count low.

**Detection:** First query fails with timeout; subsequent queries succeed; LanceDB query latency logs show >5s on first call.

**Phase:** Phase 4 (MCP server) — include a warm-up sequence in the server initialization.

---

### Pitfall 9: Node.js Path Handling with iCloud Spaces

**What goes wrong:** The vault path is `/Users/rod/Library/Mobile Documents/iCloud~md~obsidian/Documents/`. The space in `Mobile Documents` causes failures when paths are passed to shell commands (Bash, glob patterns, or CLI tools) without proper quoting. Node.js `fs` module handles spaces correctly with string paths, but shell interpolation, `child_process.exec` with template strings, and some glob patterns break.

**Why it happens:** The iCloud path looks unusual. Developers test with `~/Documents/` paths, not iCloud paths, so the space is never exercised.

**Consequences:** ENOENT errors that only appear on the real vault path; works in local tests, fails in production.

**Prevention:**
- Always use `path.join()` and `path.resolve()` — never string concatenation for paths.
- Never pass the vault path to `child_process.exec` — use `execFile` or Node.js `fs` APIs directly.
- Store the vault path as-is in config; validate it at startup with `fs.access()` before any indexing begins.
- Add an integration test that uses the literal iCloud path format.

**Detection:** ENOENT on vault path only; works with `~/Documents/test-vault/` but fails with real vault.

**Phase:** Phase 1 (foundation) — add path validation and a real-path integration test before any vault scanning.

---

### Pitfall 10: LanceDB Fragment Proliferation (No Compaction)

**What goes wrong:** Every insert, update, or delete creates new fragment files in LanceDB. The file watcher triggers incremental updates — one chunk re-indexed per file change. Over weeks, the table accumulates thousands of tiny fragments. Query performance degrades, and even `openTable()` slows down due to manifest reads across hundreds of fragment files.

**Why it happens:** LanceDB's copy-on-write model is immutable by design. Without explicit compaction, every small write adds a fragment. Developers only notice during scale testing, not during development.

**Consequences:** Query latency creeps up from 50ms to 500ms+ over time; `optimize()` call on a fragmented table takes minutes.

**Prevention:**
- Track insert/delete count in SQLite. After every 500 operations (configurable), trigger `table.optimize()` (compaction + index optimization) in a background worker.
- Run compaction during off-hours if possible, or at server startup if last compaction was >24h ago.
- Monitor fragment count: `table.countRows()` vs. number of fragment files — expose this in `status` MCP tool.

**Detection:** Query latency increases over time; `ls -la ~/.claude-code-memory/*.lance/` shows hundreds of small fragment files.

**Phase:** Phase 3 (maintenance/watcher) — implement compaction trigger alongside the incremental update logic.

---

## Moderate Pitfalls

---

### Pitfall 11: Hybrid Search Score Normalization Failure

**What goes wrong:** Reciprocal Rank Fusion (RRF) merges vector similarity scores and FTS BM25 scores. If the two score distributions are not normalized, the FTS results dominate (BM25 scores are unbounded) and the hybrid search behaves like FTS with a vector tiebreaker — defeating the purpose.

**Prevention:** Use RRF formula `1 / (k + rank)` rather than raw score merging. LanceDB's built-in hybrid search handles this if configured correctly — use it rather than hand-rolling the merge.

**Phase:** Phase 2 (retrieval).

---

### Pitfall 12: Content Hash Collisions on File Rename/Move

**What goes wrong:** A file is moved from `notes/old.md` to `notes/archive/old.md`. Content hash is identical. The indexer sees no change and skips re-indexing. But the old `source_path` in SQLite still points to `notes/old.md`. Retrieval returns results with a stale path that no longer exists.

**Prevention:** Track both content hash AND file path in SQLite. On path change with same hash, update `source_path` without re-embedding. On `unlink` events, mark chunks for the deleted path as orphaned or delete them.

**Phase:** Phase 3 (file watcher).

---

### Pitfall 13: Cold Start Memory Pressure on Large Vaults

**What goes wrong:** LanceDB HNSW index is loaded entirely into RAM on first query. A vault of 100K chunks at 1536 dimensions = ~600MB of raw vector data. On a MacBook with other apps running, this causes memory pressure and swapping.

**Prevention:** Use IVF_PQ index type instead of pure HNSW for large tables — it significantly reduces memory footprint at a small recall cost (~2-5%). Benchmark before committing to an index type. Document memory requirements in README.

**Phase:** Phase 2/4 (indexer and MCP server) — index type decision must be made before bulk indexing.

---

## Minor Pitfalls

---

### Pitfall 14: `.icloud` Placeholder Files in Watcher

**What goes wrong:** When iCloud hasn't downloaded a file yet, it creates `filename.md.icloud` placeholder files. chokidar sees these as new `.md.icloud` files and may try to index them. Reading them returns a small stub, not the actual content.

**Prevention:** Add `'**/*.icloud'` to chokidar's `ignored` patterns. Also ignore hidden files (`**/.*`).

**Phase:** Phase 3 (file watcher).

---

### Pitfall 15: SQLite WAL Mode and Multiple Processes

**What goes wrong:** If the CLI (`mem search`) and the MCP server (Claude Code) both have `better-sqlite3` connections open simultaneously, WAL mode handles concurrent reads fine — but concurrent writes from two processes will throw SQLITE_BUSY.

**Prevention:** Use WAL mode (`PRAGMA journal_mode=WAL`). Make the MCP server the sole writer; the CLI reads via a separate connection. If the indexer must write during a search, use `PRAGMA busy_timeout = 5000` to queue writes rather than throwing immediately.

**Phase:** Phase 4 (MCP + CLI integration).

---

## Phase-Specific Warning Map

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|---------------|------------|
| 1 — Foundation | Index path setup | Pitfall 1 (iCloud corruption) | Assert path is outside iCloud at startup |
| 1 — Foundation | Schema versioning | Pitfall 4 (embedding drift) | Store model ID + schema version in SQLite on first write |
| 1 — Foundation | Vault path handling | Pitfall 9 (spaces) | Use `fs.access()` validation at startup |
| 2 — Chunking/Indexer | Chunk strategy | Pitfall 3 (context loss) | Heading-aware AST splitting + breadcrumb injection |
| 2 — Indexer | Bulk indexing | Pitfall 6 (rate limits/cost) | p-limit concurrency + idempotent progress tracking |
| 2 — Indexer | Stale chunks | Pitfall 5 (contradictory results) | Delete-then-reinsert per source file |
| 2 — Retrieval | Hybrid search | Pitfall 11 (score normalization) | Use LanceDB built-in RRF |
| 3 — File Watcher | iCloud events | Pitfall 2 (event storm) | 1000ms+ debounce + awaitWriteFinish |
| 3 — File Watcher | File rename | Pitfall 12 (path staleness) | Track path changes separately from content changes |
| 3 — File Watcher | .icloud placeholders | Pitfall 14 | Ignore `**/*.icloud` pattern |
| 3 — Maintenance | Fragment growth | Pitfall 10 (compaction) | Auto-compact after 500 operations |
| 4 — MCP Server | stdio transport | Pitfall 7 (console.log) | stderr-only logging rule enforced by hook |
| 4 — MCP Server | Cold start | Pitfall 8 (timeout) | Warm-up query at server init |
| 4 — MCP Server | Memory | Pitfall 13 (RAM pressure) | Benchmark IVF_PQ vs HNSW before committing |
| 4 — MCP + CLI | SQLite concurrency | Pitfall 15 | WAL mode + busy_timeout |

---

## Sources

- LanceDB versioning and compaction: https://lancedb.com/documentation/concepts/data.html
- LanceDB TypeScript migration: https://lancedb.github.io/lancedb/migration/
- LanceDB macOS performance: https://github.com/lancedb/lancedb/issues/1489
- MCP stdio transport issues: https://github.com/modelcontextprotocol/typescript-sdk/issues/256
- MCP timeout (60s TS SDK bug): https://github.com/modelcontextprotocol/typescript-sdk/issues/245
- MCP reconnect race: https://github.com/continuedev/continue/issues/11886
- MCP operational sins: https://dev.to/riferrei/the-seven-deadly-sins-of-mcp-operational-sins-1892
- RAG chunking benchmarks 2025: https://langcopilot.com/posts/2025-10-11-document-chunking-for-rag-practical-guide
- RAG chunking strategies 2026: https://blog.premai.io/rag-chunking-strategies-the-2026-benchmark-guide/
- Embedding drift: https://decompressed.io/learn/embedding-drift
- Vector drift in production: https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/vector-drift-in-azure-ai-search-three-hidden-reasons-your-rag-accuracy-degrades-/4493031
- HNSW degradation at scale: https://towardsdatascience.com/hnsw-at-scale-why-your-rag-system-gets-worse-as-the-vector-database-grows/
- iCloud path spaces Node.js: https://isaiahtaylor.medium.com/how-to-maintain-node-projects-with-icloud-drive-4c6549f7c806
- chokidar: https://github.com/paulmillr/chokidar/tree/3.6.0
