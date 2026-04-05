# Project Research Summary

**Project:** claude-code-memory
**Domain:** Embedded vector memory / RAG system for Markdown vaults via MCP
**Researched:** 2026-04-05
**Confidence:** HIGH

## Executive Summary

This is an embedded semantic memory system that indexes an Obsidian vault into a local vector database and exposes it to Claude Code via an MCP server. Experts build this class of tool with a strict separation between the vector store (for semantic search), a lightweight metadata store (for hash-gating and staleness), and clean abstraction over embedding providers. The primary value of this tool over keyword search is hybrid retrieval — combining vector similarity with BM25 full-text search via Reciprocal Rank Fusion, which provides +9.3pp MRR improvement over vector-only search. Reference projects (Smart Connections, claude-mem, Khoj) consistently converge on heading-aware chunking as the single biggest quality lever.

The recommended approach is LanceDB (`@lancedb/lancedb`) as the embedded vector store (zero-ops, native FTS + RRF, TypeScript-first), `better-sqlite3` for metadata and hash-gating, and a pluggable `EmbeddingProvider` interface with OpenAI `text-embedding-3-small` as default and Ollama `nomic-embed-text` for offline users. The architecture separates consumers (MCP server, CLI) from core logic (Indexer, Retriever) with a strict rule: no direct DB access from consumer layers. All derived index data lives at `~/.claude-code-memory/` — never inside the iCloud vault path.

The top risks are operational: iCloud sync corrupts LanceDB files if stored in the wrong location (critical, must be enforced at startup), file watcher event storms caused by iCloud's sync protocol require debounce tuning beyond the default recommendations, and MCP stdio transport is destroyed by any stray `console.log()` statement. These risks are well-understood and preventable if addressed in the right phases. The core retrieval and chunking patterns are mature and well-documented; the iCloud-specific edge cases are where most production issues will originate.

## Key Findings

### Recommended Stack

The full stack is TypeScript with Node.js >=18. LanceDB is the only embedded vector database with native TypeScript bindings, native FTS, and built-in RRF hybrid search — alternatives require running server processes, making them unsuitable for a local CLI tool. Metadata concerns (content hashes, staleness scores, timestamps) are cleanly separated into `better-sqlite3`, which is synchronous and faster for hash-gating lookups. Markdown processing uses the `remark/unified` AST pipeline to split on heading boundaries — semantically superior to token-based chunking for structured Obsidian notes. The MCP SDK is `@modelcontextprotocol/sdk@^1.29.0` using stdio transport.

**Core technologies:**
- `@lancedb/lancedb ^0.27.2`: embedded vector DB — only embedded option with native TS + FTS + RRF, zero-ops
- `better-sqlite3 ^12.4.1`: metadata store — synchronous API, fast hash lookups, clean separation from vector data
- OpenAI `text-embedding-3-small`: default embeddings — best cost/quality ratio ($0.02/1M tokens, 75.8% MTEB)
- Ollama `nomic-embed-text`: local fallback — zero cost, privacy-preserving, strong on long-context
- `remark/unified ^11`: Markdown parsing — heading-aware AST chunking, frontmatter extraction
- `chokidar ^4.0.3`: file watching — TS rewrite, 1 dependency, FSEvents resolved
- `@modelcontextprotocol/sdk ^1.29.0`: MCP server — official SDK, stdio transport for local tool

### Expected Features

**Must have (table stakes):**
- Semantic vector search — core value prop; returns ranked results with scores
- Markdown-aware chunking — structure-aware splitting is required for coherent retrieval
- Content hash deduplication — prevents re-embedding unchanged files on every startup
- Pluggable embedding provider — OpenAI default + Ollama fallback; interface required
- MCP server with `mem_search` + `mem_get` — the primary integration surface for Claude Code
- CLI: `mem search`, `mem index`, `mem status` — developer trust and operational utility
- File watcher / auto-reindex — stale index destroys trust
- Metadata filtering (date, tags, path) — "show me only this year / this project"
- Index stored at `~/.claude-code-memory/` — outside iCloud, enforced at startup

**Should have (differentiators):**
- Hybrid search (vector + BM25/FTS) via RRF — +9.3pp MRR; catches exact-match queries vector misses
- Staleness/recency decay scoring — deprioritizes old context automatically
- Heading-path chunk IDs — `file.md > H2 > H3` provenance in every result
- Index health CLI: `mem doctor`, `mem reindex` — operational trust tooling
- Source attribution (file path + heading breadcrumb) in every result

**Defer to v2+:**
- Cross-encoder reranking — adds latency; evaluate if hybrid search is sufficient
- Token-efficient 3-layer retrieval — optimize after measuring real MCP response sizes
- Multi-source indexing beyond Obsidian vault
- Result explanation mode ("why was this returned?")

### Architecture Approach

The architecture is a layered hub-and-spoke: two consumer surfaces (MCP server, CLI) call into a shared core layer (Indexer, Retriever, Scanner, Chunker, Embedder). All DB access is gated through the core — consumer layers never touch LanceDB or SQLite directly. The watcher is a thin event dispatcher that triggers the Indexer with single-file scope. LanceDB handles vectors + FTS; SQLite handles hashes + metadata. The embedding provider is abstracted behind an interface with a factory function, following the AnythingLLM pattern validated against 30+ provider implementations.

**Major components:**
1. `src/core/indexer.ts` — orchestrates full pipeline: scan → chunk → embed → store
2. `src/core/retriever.ts` — hybrid search: vector ANN + FTS BM25 → RRF merge → metadata enrichment
3. `src/core/scanner.ts` — file discovery with hash-gating (SQLite lookup before embed)
4. `src/core/chunker.ts` — remark AST → heading-scoped chunks with breadcrumb injection
5. `src/core/embedder/` — `EmbeddingProvider` interface + OpenAI and Ollama adapters
6. `src/mcp/server.ts` — MCP tool registration and routing (stderr-only logging)
7. `src/cli/` — CLI commands sharing core API with MCP surface
8. `src/watcher/` — chokidar with debounce queue, triggers Indexer incrementally

### Critical Pitfalls

1. **LanceDB index inside iCloud path** — corrupt index, silent wrong results, crashes. Enforce `~/.claude-code-memory/` path at startup with an assertion; abort if path contains `Mobile Documents`.
2. **iCloud file watcher event storm** — one file edit fires 50+ events. Use 1000–2000ms debounce + `awaitWriteFinish: { stabilityThreshold: 1500 }` + dedup pending set.
3. **Stale chunks polluting results** — old and new versions of a file coexist after update. Always delete-then-reinsert all chunks for a `source_path` on any file change.
4. **Embedding model drift** — switching provider poisons index with mismatched vector spaces, silently. Store `embedding_model_id` + `schema_version` in SQLite; assert match on every operation.
5. **MCP stdio transport corruption** — any `console.log()` corrupts the JSON-RPC stream. Enforce stderr-only logging; add pre-commit hook to grep for `console.log` in MCP files.

## Implications for Roadmap

Based on research, the architecture defines a clear dependency chain. Foundation must precede everything; query pipeline must follow index pipeline; consumer surfaces can be built once retrieval is validated.

### Phase 1: Foundation
**Rationale:** Every other component depends on config, types, DB clients, and the embedding interface. Schema versioning and path enforcement must be baked in before first write — retrofitting these is expensive.
**Delivers:** Config loading, shared types, LanceDB client + schema, SQLite client + schema (with `embedding_model_id`, `schema_version`, `content_hash`), `EmbeddingProvider` interface + OpenAI adapter, path validation at startup.
**Addresses:** Table stakes — pluggable embedding provider prerequisite.
**Avoids:** Pitfalls 1 (iCloud path), 4 (embedding drift), 9 (path spaces) — all require Phase 1 mitigations baked in.
**Research flag:** Standard patterns — no additional research needed.

### Phase 2: Index Pipeline
**Rationale:** Chunking quality is the single biggest retrieval quality lever. Must validate end-to-end with real vault content before building the query layer on top.
**Delivers:** Scanner (glob + hash gate), Chunker (remark AST → heading chunks with breadcrumbs), Indexer (orchestration), bulk indexing with `p-limit` concurrency control and idempotent progress tracking.
**Uses:** All Phase 1 components.
**Implements:** `src/core/scanner.ts`, `src/core/chunker.ts`, `src/core/indexer.ts`.
**Avoids:** Pitfalls 3 (fixed-size chunking), 5 (stale chunks — delete-then-reinsert), 6 (rate limit explosion).
**Research flag:** Manual evaluation milestone — test 20+ real queries against chunked vault before finalizing strategy.

### Phase 3: Query Pipeline
**Rationale:** Can only be validated against indexed data. Hybrid search (RRF) is a differentiator but depends on FTS index existing alongside vector index.
**Delivers:** Retriever with vector ANN + BM25 FTS, RRF merge (using LanceDB built-in), metadata enrichment from SQLite, staleness/recency scoring, metadata filtering.
**Implements:** `src/core/retriever.ts`.
**Avoids:** Pitfall 11 (score normalization — use LanceDB RRF, not hand-rolled merge).
**Research flag:** Standard patterns — LanceDB docs cover RRF configuration; no additional research needed.

### Phase 4: Consumer Surfaces (MCP + CLI)
**Rationale:** Both surfaces share the same core API; build in parallel once Retriever is stable.
**Delivers:** MCP server (`mem_search`, `mem_get`, `mem_index_status`) with stderr-only logging and startup warm-up query. CLI commands (`search`, `index`, `status`). SQLite WAL mode + `busy_timeout` for concurrent access.
**Avoids:** Pitfalls 7 (stdio corruption), 8 (cold-start timeout), 13 (memory pressure — evaluate IVF_PQ vs HNSW), 15 (SQLite concurrency).
**Research flag:** MCP SDK timeout behavior — verify whether warm-up query pattern fully resolves Pitfall 8 before shipping.

### Phase 5: File Watcher + Incremental Indexing
**Rationale:** An optimization layer on top of the Phase 2 indexer. Build last because it requires the full pipeline to be stable and adds the iCloud-specific complexity.
**Delivers:** chokidar watcher with 1000ms+ debounce, `awaitWriteFinish` config, path dedup queue, `.icloud` placeholder filtering, file rename/move detection (path change + same hash), LanceDB auto-compaction trigger (every 500 operations).
**Avoids:** Pitfalls 2 (event storm), 10 (fragment proliferation), 12 (path staleness), 14 (placeholder files).
**Research flag:** Needs integration testing against live iCloud vault with controlled remote edits — cannot be validated with unit tests alone.

### Phase 6: Ollama Adapter + Staleness Scoring
**Rationale:** Low-risk, deferred — the interface exists from Phase 1; adding the adapter is straightforward. Staleness scoring is a differentiator, not table stakes.
**Delivers:** Ollama `EmbeddingProvider` adapter, configurable staleness half-life scoring surfaced in retrieval ranking.
**Research flag:** Standard patterns — no additional research needed.

### Phase Ordering Rationale

- Phase 1 before everything: schema versioning and path enforcement cannot be retrofitted
- Phase 2 before Phase 3: can't validate queries without indexed data
- Phase 4 after Phase 3: consumer surfaces are thin wrappers on core; build once retrieval is proven
- Phase 5 last: file watching adds iCloud complexity; the core pipeline must be solid first
- Phases 4 and 6 can overlap; they are independent after Phase 3 completes

### Research Flags

Phases needing deeper research during planning:
- **Phase 2:** Chunking strategy validation — prototype and manually evaluate 20+ real vault queries before locking heading-split parameters (overlap %, min/max chunk size)
- **Phase 4:** MCP cold-start warm-up — verify Pitfall 8 mitigation works on a 10K+ chunk vault before shipping

Phases with standard patterns (skip research-phase):
- **Phase 1:** Config, types, DB clients — well-documented, established patterns
- **Phase 3:** LanceDB RRF hybrid search — official docs cover this precisely
- **Phase 5:** chokidar debounce + `awaitWriteFinish` — documented configuration, just needs integration testing
- **Phase 6:** Ollama adapter — interface is defined in Phase 1; implementation is mechanical

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified on npm with current versions; official docs reviewed |
| Features | HIGH | Six reference projects surveyed; strong convergence on table stakes |
| Architecture | HIGH | LanceDB hybrid search + RRF confirmed in official docs; component boundaries validated against AnythingLLM pattern |
| Pitfalls | HIGH | Most critical pitfalls sourced from official SDK issue trackers and production post-mortems |

**Overall confidence:** HIGH

### Gaps to Address

- **Chunk size tuning (300–500 tokens):** Research gives a range but optimal parameters for Rod's specific vault (long-form project notes vs. daily journal vs. resource pages) need empirical validation in Phase 2.
- **IVF_PQ vs HNSW trade-off:** Memory footprint at 100K+ chunks favors IVF_PQ, but recall cost is ~2-5%. Benchmark before committing to index type in Phase 4.
- **MCP SDK 60-second timeout (Pitfall 8):** The warm-up pattern is the recommended mitigation but the timeout is a known TS SDK limitation (issue #245). Monitor for SDK fix in v1.x releases.
- **Ollama local model dimension mismatch:** `nomic-embed-text` is 768-dim vs OpenAI's 1536-dim. Switching providers requires full reindex — this must be clearly documented for users.

## Sources

### Primary (HIGH confidence)
- [@lancedb/lancedb npm](https://www.npmjs.com/package/@lancedb/lancedb) — v0.27.2, Feb 2026
- [LanceDB Hybrid Search docs](https://docs.lancedb.com/search/hybrid-search) — FTS + RRF configuration
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) — v12.4.1
- [OpenAI text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small) — pricing, dimensions
- [remark-parse npm](https://www.npmjs.com/package/remark-parse) — v11
- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.29.0, Apr 2026
- [MCP TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk) — transport, timeout issues
- [chokidar migration guide v3→v4](https://dev.to/43081j/migrating-from-chokidar-3x-to-4x-5ab5)

### Secondary (MEDIUM confidence)
- [mem0 GitHub](https://github.com/mem0ai/mem0) — memory layer patterns, reranker architecture
- [Smart Connections Obsidian](https://smartconnections.app/smart-connections/) — chunk + embedding design
- [Khoj search docs](https://docs.khoj.dev/features/search/) — bi-encoder + cross-encoder pipeline
- [claude-mem GitHub](https://github.com/thedotmack/claude-mem) — 3-layer token-efficient retrieval
- [Advanced RAG: RRF](https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search/) — RRF mechanics
- [Why Your RAG Sucks](https://medium.com/beyond-bits/why-your-rag-sucks-the-art-and-science-of-chunking-and-hybrid-search-5d2165b21be9) — +9.3pp MRR data
- [AnythingLLM provider abstraction](https://deepwiki.com/Mintplex-Labs/anything-llm/5-vector-database-system) — factory pattern validation
- [MCP operational sins](https://dev.to/riferrei/the-seven-deadly-sins-of-mcp-operational-sins-1892) — stdio pitfalls
- [Vector drift post-mortem](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/vector-drift-in-azure-ai-search-three-hidden-reasons-your-rag-accuracy-degrades-/4493031) — embedding drift mitigation

### Tertiary (LOW confidence)
- [Embedding model comparison — elephas.app](https://elephas.app/blog/best-embedding-models) — nomic benchmark numbers (cross-reference with other sources)
- [iCloud path spaces Node.js](https://isaiahtaylor.medium.com/how-to-maintain-node-projects-with-icloud-drive-4c6549f7c806) — single source, but path behavior is deterministic

---
*Research completed: 2026-04-05*
*Ready for roadmap: yes*
