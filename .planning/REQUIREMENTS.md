# Requirements: claude-code-memory

**Defined:** 2026-04-05
**Core Value:** Semantic recall across the entire vault — find what's relevant by meaning, not keywords

## v1 Requirements

### Foundation

- [ ] **FOUND-01**: System stores vector index at `~/.claude-code-memory/` (outside iCloud) to prevent sync corruption
- [ ] **FOUND-02**: Configuration file defines vault path, embedding provider, index location, and chunking params
- [ ] **FOUND-03**: Schema versioning tracks embedding model fingerprint to detect model mismatch
- [ ] **FOUND-04**: All logging uses stderr (never stdout) to prevent MCP JSON-RPC stream corruption

### Indexing

- [ ] **IDX-01**: Scanner discovers all .md files in configured vault directory recursively
- [ ] **IDX-02**: Markdown-aware chunking splits files by heading (H1/H2/H3) using remark AST parser, preserving heading path context
- [ ] **IDX-03**: Each chunk stores metadata: source file path, heading path, chunk hash, last-indexed timestamp, file modified date
- [ ] **IDX-04**: Content hashing (xxhash) skips re-embedding unchanged chunks on reindex
- [ ] **IDX-05**: Bulk indexing respects embedding API rate limits via queue with concurrency control
- [ ] **IDX-06**: CLI command `mem index` triggers full vault reindex
- [ ] **IDX-07**: CLI command `mem status` shows index stats (files indexed, chunks, last indexed, stale count)

### Search

- [ ] **SRCH-01**: Vector similarity search returns semantically relevant chunks for a natural language query
- [ ] **SRCH-02**: Full-text keyword search (BM25) returns exact-match results
- [ ] **SRCH-03**: Hybrid search merges vector + FTS results using reciprocal rank fusion (RRF)
- [ ] **SRCH-04**: Results include metadata: source file, heading path, relevance score, chunk date
- [ ] **SRCH-05**: Results support filtering by date range, source file glob, or hub/folder
- [ ] **SRCH-06**: Recency weighting boosts newer chunks over older ones
- [ ] **SRCH-07**: Configurable staleness decay reduces relevance score for old content

### MCP Server

- [ ] **MCP-01**: MCP server exposes `search_memory` tool for Claude Code to query semantically
- [ ] **MCP-02**: MCP server exposes `get_context` tool for retrieving full chunk details by ID
- [ ] **MCP-03**: MCP server uses stdio transport with strict stderr-only logging
- [ ] **MCP-04**: MCP server handles cold start gracefully (warm-up on first query if needed)

### CLI

- [ ] **CLI-01**: `mem search "<query>"` returns top-N results with source, heading, and relevance score
- [ ] **CLI-02**: `mem index` runs full or incremental reindex
- [ ] **CLI-03**: `mem status` shows index health (file count, chunk count, last indexed, embedding model)
- [ ] **CLI-04**: `mem config` shows or sets configuration values
- [ ] **CLI-05**: CLI is installed globally via `npm install -g claude-code-memory`

### Embedding Providers

- [ ] **EMB-01**: Pluggable embedding interface: `embed(texts: string[]): Promise<number[][]>`
- [ ] **EMB-02**: OpenAI text-embedding-3-small adapter ships as default
- [ ] **EMB-03**: Ollama/nomic-embed-text adapter ships as local alternative
- [ ] **EMB-04**: Switching embedding provider triggers full reindex warning (model fingerprint mismatch)

### File Watcher

- [ ] **WATCH-01**: File watcher detects markdown file changes in vault using chokidar v4
- [ ] **WATCH-02**: Debounce of 1000ms+ with awaitWriteFinish for iCloud sync stability
- [ ] **WATCH-03**: Changed files trigger incremental reindex (only affected chunks)
- [ ] **WATCH-04**: File renames detected and handled (update metadata, skip re-embedding if content unchanged)
- [ ] **WATCH-05**: Watcher runs as background daemon or launchd service

### Maintenance

- [ ] **MAINT-01**: Periodic LanceDB `table.optimize()` to compact fragments from incremental updates
- [ ] **MAINT-02**: `mem prune` command removes chunks from deleted source files

## v2 Requirements

### Enhanced Retrieval

- **RET-01**: Token-efficient 3-layer retrieval (compact index → timeline → full details on demand)
- **RET-02**: Cross-encoder reranking for improved result quality
- **RET-03**: Graph-based memory linking related chunks across files

### User Interfaces

- **UI-01**: Obsidian plugin for in-vault semantic search
- **UI-02**: Lightweight web/Electron app for Mac search
- **UI-03**: iOS app or Shortcut for mobile search

### Automation

- **AUTO-01**: Auto-generate session notes from Claude Code conversation monitoring
- **AUTO-02**: Auto-tag chunks based on content analysis

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud-hosted vector DB | Local-first constraint — no server dependency |
| Multi-user / multi-tenant | Single user system for personal vault |
| Non-markdown file indexing (PDF, images) | Markdown-first for v1; add file type adapters later |
| Real-time streaming search | Batch query is sufficient for v1 use cases |
| Obsidian plugin UI | CLI-first, plugin deferred to v2 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| FOUND-04 | Phase 1 | Pending |
| IDX-01 | Phase 2 | Pending |
| IDX-02 | Phase 2 | Pending |
| IDX-03 | Phase 2 | Pending |
| IDX-04 | Phase 2 | Pending |
| IDX-05 | Phase 2 | Pending |
| IDX-06 | Phase 2 | Pending |
| IDX-07 | Phase 2 | Pending |
| SRCH-01 | Phase 3 | Pending |
| SRCH-02 | Phase 3 | Pending |
| SRCH-03 | Phase 3 | Pending |
| SRCH-04 | Phase 3 | Pending |
| SRCH-05 | Phase 3 | Pending |
| SRCH-06 | Phase 6 | Pending |
| SRCH-07 | Phase 6 | Pending |
| MCP-01 | Phase 4 | Pending |
| MCP-02 | Phase 4 | Pending |
| MCP-03 | Phase 4 | Pending |
| MCP-04 | Phase 4 | Pending |
| CLI-01 | Phase 4 | Pending |
| CLI-02 | Phase 4 | Pending |
| CLI-03 | Phase 4 | Pending |
| CLI-04 | Phase 4 | Pending |
| CLI-05 | Phase 4 | Pending |
| EMB-01 | Phase 1 | Pending |
| EMB-02 | Phase 1 | Pending |
| EMB-03 | Phase 6 | Pending |
| EMB-04 | Phase 1 | Pending |
| WATCH-01 | Phase 5 | Pending |
| WATCH-02 | Phase 5 | Pending |
| WATCH-03 | Phase 5 | Pending |
| WATCH-04 | Phase 5 | Pending |
| WATCH-05 | Phase 5 | Pending |
| MAINT-01 | Phase 5 | Pending |
| MAINT-02 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-05*
*Last updated: 2026-04-05 after roadmap creation (SRCH-06, SRCH-07, EMB-03 moved to Phase 6)*
