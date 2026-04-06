# Roadmap: claude-code-memory

**Project:** claude-code-memory
**Milestone:** v1
**Granularity:** Standard
**Created:** 2026-04-05
**Coverage:** 37/37 v1 requirements mapped

## Phases

- [x] **Phase 1: Foundation** - Config, DB clients, embedding interface, path safety (completed 2026-04-05)
- [x] **Phase 2: Index Pipeline** - Scanner, AST chunker, bulk indexer with hash-gating (completed 2026-04-05)
- [x] **Phase 3: Query Pipeline** - Hybrid search (vector + BM25), RRF merge, metadata filtering (completed 2026-04-05)
- [x] **Phase 4: Consumer Surfaces** - MCP server + CLI thin wrappers over core (completed 2026-04-06)
- [x] **Phase 5: File Watcher + Maintenance** - Incremental reindex, auto-compaction, pruning (completed 2026-04-06)
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
- [x] 01-PLAN-01.md — Project scaffold, config loading, path safety, stderr logger
- [x] 01-PLAN-02.md — SQLite and LanceDB client initialization with schema versioning
- [x] 01-PLAN-03.md — Embedding provider interface, OpenAI adapter, factory

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
**Plans:** 4/4 plans complete
Plans:
- [x] 02-01-PLAN.md — Install deps, extend Config, build vault scanner (IDX-01)
- [x] 02-02-PLAN.md — Remark AST heading chunker with breadcrumbs (IDX-02, IDX-03)
- [x] 02-03-PLAN.md — Indexer orchestrator with hash-gating and DB helpers (IDX-04, IDX-05)
- [x] 02-04-PLAN.md — CLI commands: mem index + mem status (IDX-06, IDX-07)

### Phase 3: Query Pipeline
**Goal**: Hybrid search pipeline returns relevant results via vector similarity, keyword matching, and RRF merge with metadata filtering
**Depends on**: Phase 2
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-05, SRCH-06, SRCH-07
**Note**: SRCH-06 (recency weighting) and SRCH-07 (staleness decay) are deferred to Phase 6 per REQUIREMENTS.md traceability. Phase 3 implements SRCH-01 through SRCH-05.
**Success Criteria** (what must be TRUE):
  1. `mem search "calendar setup"` returns chunks semantically related to calendar configuration even if the words "calendar" or "setup" don't appear
  2. An exact-phrase query returns the exact-match chunk in the top 3 results (BM25 contribution)
  3. Search results include source file path, heading breadcrumb, relevance score, and chunk date for every result
  4. Filtering by `--after 2025-01-01` excludes chunks from files modified before that date
  5. A chunk from a file last modified 2 years ago ranks lower than an equivalent chunk from last month (recency weighting observable)
**Plans:** 2/2 plans complete
Plans:
- [ ] 03-01-PLAN.md — Search types, FTS index helper, searcher module (vector/FTS/hybrid + filtering)
- [ ] 03-02-PLAN.md — Integration tests with real LanceDB, runtime fix-up

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
**Plans:** 3/3 plans complete
Plans:
- [ ] 04-01-PLAN.md — MCP server with search_memory tool, warm-up, stdio transport (MCP-01, MCP-03, MCP-04)
- [ ] 04-02-PLAN.md — CLI search + config commands + first-run auto-detect (CLI-01, CLI-02, CLI-03, CLI-04, CLI-05)
- [ ] 04-03-PLAN.md — MCP get_context tool with neighbor finding (MCP-02)

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
**Plans:** 2/2 plans complete
Plans:
- [ ] 05-01-PLAN.md — Core watcher module with batch window, rename detection, catch-up scan (WATCH-01, WATCH-02, WATCH-03, WATCH-04)
- [ ] 05-02-PLAN.md — CLI commands (watch/compact/prune) + MCP server watcher integration (WATCH-05, MAINT-01, MAINT-02)

### Phase 6: Ollama Adapter + Staleness Scoring
**Goal**: Local/offline users can index without OpenAI, and old content is automatically deprioritized
**Depends on**: Phase 1 (interface), Phase 3 (scoring hooks)
**Requirements**: EMB-03, SRCH-06, SRCH-07
**Success Criteria** (what must be TRUE):
  1. Setting `embedding_provider: "ollama"` in config and running `mem index` completes with no OpenAI API calls made
  2. Switching from OpenAI to Ollama triggers a clear warning that a full reindex is required before proceeding
  3. A chunk from a note last modified 18 months ago scores measurably lower than an identical chunk from last week (staleness decay observable in score field)
**Plans:** 1/2 plans executed
Plans:
- [ ] 06-01-PLAN.md — Ollama embedding adapter with TDD, factory wiring, Config extension (EMB-03)
- [ ] 06-02-PLAN.md — Staleness decay scoring in searcher, Config extension (SRCH-06, SRCH-07)

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-04-05 |
| 2. Index Pipeline | 4/4 | Complete | 2026-04-05 |
| 3. Query Pipeline | 2/2 | Complete   | 2026-04-05 |
| 4. Consumer Surfaces | 3/3 | Complete   | 2026-04-06 |
| 5. File Watcher + Maintenance | 2/2 | Complete   | 2026-04-06 |
| 6. Ollama Adapter + Staleness Scoring | 1/2 | In Progress|  |

---
*Created: 2026-04-05*
