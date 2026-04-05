# Phase 2: Index Pipeline - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Scanner discovers all .md files in the configured vault, AST chunker splits by heading into embeddable chunks, bulk indexer embeds and stores with two-tier hash-gating for incremental reindex. CLI commands `mem index` and `mem status` are the user-facing surface.

Requirements: IDX-01, IDX-02, IDX-03, IDX-04, IDX-05, IDX-06, IDX-07

</domain>

<decisions>
## Implementation Decisions

### Chunking strategy
- Split at H1/H2/H3 headings using remark AST parser. H4+ stays inside parent H3 chunk.
- Files with no headings: treat whole file as one chunk if under ~500 tokens; split at paragraph breaks (double newline) if over ~500 tokens
- Default max chunk size: ~500 tokens (configurable via config param). Sweet spot for text-embedding-3-small.
- Prepend heading breadcrumb to chunk text before embedding (e.g., "Projects > Claude Lab > Memory System: actual content"). Critical for Rod's vault where the same words mean different things in different hubs.

### Hashing & change detection
- Two-tier detection: file-level content hash as fast gate (skip unchanged files entirely), then chunk-level hash for changed files (only re-embed modified chunks)
- Heading rename triggers re-embed — breadcrumb is part of embedded text, so chunk hash changes, vector must update
- Chunk IDs: `{file_path}::{heading_path}` with collision suffix (`-2`, `-3`) for duplicate headings in same file. Stable across reordering, easy to query "all chunks from file X"

### Progress & error reporting
- Default: single-line progress bar with count (`[████████░░] 847/1247 files (67 changed)`)
- `--verbose` flag for per-file output (debugging)
- Error handling: retry failed files once (transient API errors), then skip. Log failure and continue.
- Final summary always printed: files indexed, chunks created, skipped unchanged, re-embedded, failures with file paths

### Ignore patterns
- Hardcoded defaults: `.obsidian/`, `node_modules/` always excluded
- Configurable `ignorePaths: string[]` in config for user-specific exclusions (e.g., `90 - Attachments/`, `91 - Excalidraw/`)
- File extension filter: `.md` only by default, configurable `includeExtensions: string[]` (ships with `[".md"]`)

### Claude's Discretion
- Exact remark plugin chain configuration
- Progress bar library choice (or hand-rolled)
- Internal queue/batching implementation for embedding API calls
- Chunk ID encoding/escaping for special characters in file paths and headings
- Exact retry logic (delay, backoff)
- SQLite transaction strategy for bulk inserts

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — Project vision, constraints, key decisions (LanceDB, better-sqlite3, remark/unified)
- `.planning/REQUIREMENTS.md` — Full v1 requirements; IDX-01 through IDX-07 are this phase
- `.planning/research/STACK.md` — Validated stack with specific versions
- `.planning/research/ARCHITECTURE.md` — Component boundaries and data flow
- `.planning/research/PITFALLS.md` — Critical pitfalls, especially iCloud path handling

### Phase 1 foundation (existing code to build on)
- `src/config.ts` — Config loading with `loadConfig()`, path safety assertion
- `src/types.ts` — `Config` interface with `vaultPath`, `indexPath`, `batchSize`, `concurrency`
- `src/core/db/sqlite.ts` — `openMetadataDb()` with `files` table schema, `assertModelMatch()`
- `src/core/db/lance.ts` — `connectLanceDb()`, `openChunksTable()` with full Arrow schema
- `src/core/embedder/types.ts` — `EmbeddingProvider` interface
- `src/core/embedder/openai.ts` — OpenAI adapter implementation
- `src/core/embedder/factory.ts` — `createEmbeddingProvider()` factory
- `src/cli/index.ts` — CLI entry point (commander)
- `src/logger.ts` — stderr-only logger

### Phase 1 context
- `.planning/phases/01-foundation/01-CONTEXT.md` — Foundation decisions (config format, index structure, embedding interface, tooling)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `loadConfig()` — provides `vaultPath`, `indexPath`, `batchSize`, `concurrency`
- `openMetadataDb()` — SQLite with `files` table (`path`, `content_hash`, `indexed_at`, `chunk_count`, `staleness_score`)
- `openChunksTable()` — LanceDB with Arrow schema (`id`, `vector`, `text`, `source_path`, `heading_path`, `chunk_hash`, `indexed_at`, `embedding_model_id`)
- `assertModelMatch()` — checks embedding model fingerprint before writes
- `EmbeddingProvider.embed()` + `modelId()` — batch embedding with p-limit concurrency
- `logger` — stderr-only, ready to use

### Established Patterns
- Zod for config validation with defaults
- better-sqlite3 with WAL mode and busy_timeout
- LanceDB with Apache Arrow schema (not dummy-row pattern)
- All logging via stderr (MCP safety)
- Config merge: file → vault override → env vars → code overrides

### Integration Points
- Scanner writes to SQLite `files` table (content hash, chunk count)
- Chunker outputs go to LanceDB `chunks` table via bulk insert
- CLI `mem index` and `mem status` commands register in `src/cli/index.ts` (commander)
- Config `batchSize` and `concurrency` control embedding API throughput

</code_context>

<specifics>
## Specific Ideas

- Heading breadcrumb prepend is critical — Rod's vault has same words meaning different things across hubs (e.g., "Budget" in Financial/ vs CCyber/Clients/)
- ~500 token default aligns with OpenAI text-embedding-3-small training range (256–512 tokens)
- Two-tier hashing matches success criteria: "editing one file only re-embeds the changed file's chunks"
- Progress bar prevents "is it broken?" anxiety on first full index of 1000+ files

</specifics>

<deferred>
## Deferred Ideas

- Non-markdown file parsers (.pdf, .docx, .png/OCR) — future phase. `includeExtensions` config param is the plumbing for when parsers land.

</deferred>

---

*Phase: 02-index-pipeline*
*Context gathered: 2026-04-05*
