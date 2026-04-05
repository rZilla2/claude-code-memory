# Roadmap: claude-code-memory

**Project:** claude-code-memory
**Milestone:** v1
**Granularity:** Standard
**Created:** 2026-04-05
**Coverage:** 37/37 v1 requirements mapped

## Phases

- [x] **Phase 1: Foundation** - Config, DB clients, embedding interface, path safety (completed 2026-04-05)
- [ ] **Phase 2: Index Pipeline** - Scanner, AST chunker, bulk indexer with hash-gating
- [ ] **Phase 3: Query Pipeline** - Hybrid search (vector + BM25), RRF merge, metadata filtering
- [ ] **Phase 4: Consumer Surfaces** - MCP server + CLI thin wrappers over core
- [ ] **Phase 5: File Watcher + Maintenance** - Incremental reindex, auto-compaction, pruning
- [ ] **Phase 6: Ollama Adapter + Staleness Scoring** - Local embedding provider + recency decay

## Phase Details

### Phase 1: Foundation
**Goal**: Core infrastructure is in place — any other component can be built without revisiting fundamentals
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, EMB-01, EMB-02, EMB-04
**Success Criteria** (what must be TRUE):
  1. Running `mem` with a vault path inside `~/Library/Mobile Documents/` aborts with a clear error before writing any data
  2. Config file loads from disk and provides vault path, index location, embedding provider, and chunking params with typed defaults
  3. LanceDB and SQLite clients initialize at `~/.claude-code-memory/` with correct schema including `embedding_model_id` and `schema_version` columns
  4. Calling `embed(["test"])` via the OpenAI adapter returns a vector array without error
  5. A schema version mismatch (different `embedding_model_id`) logs a warning and halts before any write
**Plans:** 3/3 plans complete
Plans:
- [ ] 01-PLAN-01.md — Project scaffold, config loading, path safety, stderr logger
- [ ] 01-PLAN-02.md — SQLite and LanceDB client initialization with schema versioning
- [ ] 01-PLAN-03.md — Embedding provider interface, OpenAI adapter, factory

### Phase 2: Index Pipeline
**Goal**: Real vault content is indexed end-to-end and can be queried for spot-check validation
**Depends on**: Phase 1
**Requirements**: IDX-01, IDX-02, IDX-03, IDX-04, IDX-05, IDX-06, IDX-07
**Success Criteria** (what must be TRUE):
  1. `mem index` completes on a vault with 1000+ markdown files without error or timeout
  2. A file with unchanged content is skipped (hash match) on a second run of `mem index`
  3. `mem status` reports file count, chunk count, last indexed timestamp, and embedding model name
  4. Each chunk stored includes source file path, heading breadcrumb, chunk hash, and last-indexed timestamp
  5. Running `mem index` a second time after editing one file only re-embeds the changed file's chunks
**Plans**: TBD

### Phase 3: Query Pipeline
**Goal**: Semantic search returns relevant results ranked by meaning, recency, and staleness controls
**Depends on**: Phase 2
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-05, SRCH-06, SRCH-07
**Success Criteria** (what must be TRUE):
  1. `mem search "calendar setup"` returns chunks semantically related to calendar configuration even if the words "calendar" or "setup" don't appear
  2. An exact-phrase query returns the exact-match chunk in the top 3 results (BM25 contribution)
  3. Search results include source file path, heading breadcrumb, relevance score, and chunk date for every result
  4. Filtering by `--after 2025-01-01` excludes chunks from files modified before that date
  5. A chunk from a file last modified 2 years ago ranks lower than an equivalent chunk from last month (recency weighting observable)
**Plans**: TBD

### Phase 4: Consumer Surfaces
**Goal**: Claude Code can query memories via MCP and Rod can search from the terminal via CLI
**Depends on**: Phase 3
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, CLI-01, CLI-02, CLI-03, CLI-04, CLI-05
**Success Criteria** (what must be TRUE):
  1. Adding the MCP server config to `~/.claude.json` and restarting Claude Code exposes `search_memory` as an available tool
  2. A `search_memory` call from Claude Code returns structured results with source, heading, and score — no stdout noise corrupts the response
  3. `mem search "query"` from the terminal prints top-N results with source file, heading path, and relevance score
  4. `npm install -g claude-code-memory` installs the `mem` binary and it runs without additional setup beyond config
  5. MCP server handles first query after cold start without timing out (warm-up completes before response is required)
**Plans**: TBD

### Phase 5: File Watcher + Maintenance
**Goal**: Index stays current automatically and stays healthy under incremental update load
**Depends on**: Phase 4
**Requirements**: WATCH-01, WATCH-02, WATCH-03, WATCH-04, WATCH-05, MAINT-01, MAINT-02
**Success Criteria** (what must be TRUE):
  1. Editing a vault file triggers reindex of that file's chunks within 3 seconds without manual intervention
  2. Editing a file in an iCloud-synced vault (which fires 50+ raw events) triggers exactly one reindex, not 50
  3. Renaming a file updates its metadata in the index without re-embedding if content is unchanged
  4. `mem prune` removes all chunks whose source files no longer exist on disk
  5. After 500+ incremental updates, `mem status` reports no excessive fragment count (auto-compaction ran)
**Plans**: TBD

### Phase 6: Ollama Adapter + Staleness Scoring
**Goal**: Local/offline users can index without OpenAI, and old content is automatically deprioritized
**Depends on**: Phase 1 (interface), Phase 3 (scoring hooks)
**Requirements**: EMB-03, SRCH-06, SRCH-07
**Success Criteria** (what must be TRUE):
  1. Setting `embedding_provider: "ollama"` in config and running `mem index` completes with no OpenAI API calls made
  2. Switching from OpenAI to Ollama triggers a clear warning that a full reindex is required before proceeding
  3. A chunk from a note last modified 18 months ago scores measurably lower than an identical chunk from last week (staleness decay observable in score field)
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-04-05 |
| 2. Index Pipeline | 0/0 | Not started | - |
| 3. Query Pipeline | 0/0 | Not started | - |
| 4. Consumer Surfaces | 0/0 | Not started | - |
| 5. File Watcher + Maintenance | 0/0 | Not started | - |
| 6. Ollama Adapter + Staleness Scoring | 0/0 | Not started | - |

---
*Created: 2026-04-05*
