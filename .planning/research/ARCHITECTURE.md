# Architecture Patterns

**Domain:** TypeScript vector memory system (embedded DB + MCP server)
**Researched:** 2026-04-05
**Confidence:** HIGH (LanceDB hybrid search docs confirmed; MCP SDK patterns confirmed; remark/unified patterns confirmed)

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     External Consumers                   │
│   MCP Client (Claude Code)    CLI (terminal user)        │
└──────────────┬────────────────────────┬──────────────────┘
               │ MCP protocol           │ process.argv
               ▼                        ▼
┌─────────────────────┐    ┌─────────────────────┐
│    src/mcp/         │    │    src/cli/          │
│  MCP Server         │    │  CLI Commands        │
│  (tool handlers)    │    │  search, index,      │
│                     │    │  status, watch       │
└──────────┬──────────┘    └──────────┬──────────┘
           │                          │
           └──────────┬───────────────┘
                      │ calls Core API
                      ▼
┌─────────────────────────────────────────────────────────┐
│                    src/core/                             │
│                                                          │
│  ┌──────────────┐   ┌──────────────┐  ┌──────────────┐  │
│  │  Indexer     │   │  Retriever   │  │  Embedder    │  │
│  │  scanner +   │   │  hybrid      │  │  provider    │  │
│  │  chunker +   │   │  search +    │  │  abstraction │  │
│  │  hash check  │   │  reranking   │  │  (interface) │  │
│  └──────┬───────┘   └──────┬───────┘  └──────┬───────┘  │
│         │                  │                  │           │
│         └──────────────────┴──────────────────┘           │
│                            │ reads/writes                 │
│                ┌───────────┴───────────┐                  │
│                ▼                       ▼                  │
│         ┌────────────┐        ┌─────────────────┐         │
│         │  LanceDB   │        │  better-sqlite3 │         │
│         │  (vectors  │        │  (metadata:     │         │
│         │  + FTS)    │        │  hashes, dates, │         │
│         └────────────┘        │  staleness)     │         │
│                               └─────────────────┘         │
└─────────────────────────────────────────────────────────┘
               ▲
               │ file change events
┌─────────────────────┐
│    src/watcher/     │
│  chokidar FSEvents  │
│  debounce 500ms     │
│  → triggers Indexer │
└─────────────────────┘
```

## Component Boundaries

| Component | Responsibility | Communicates With | Does NOT do |
|-----------|---------------|-------------------|-------------|
| `src/mcp/server.ts` | MCP protocol, tool registration, request routing | Core Retriever, Core Indexer | Business logic, DB access |
| `src/cli/index.ts` | CLI argument parsing, output formatting | Core Retriever, Core Indexer | Protocol handling |
| `src/core/indexer.ts` | Orchestrate full index pipeline | Scanner, Chunker, Embedder, LanceDB, SQLite | Query handling |
| `src/core/retriever.ts` | Hybrid search orchestration, RRF merge | LanceDB (vector + FTS), Embedder | Indexing, file I/O |
| `src/core/scanner.ts` | Glob vault for .md files, skip list | fs, SQLite (hash lookup) | Embedding, storage |
| `src/core/chunker.ts` | remark/unified AST → heading-scoped chunks | remark (pure transform) | Embedding, I/O |
| `src/core/embedder/` | Interface + adapters (OpenAI, Ollama) | External HTTP APIs | Storage, chunking |
| `src/watcher/index.ts` | chokidar FSEvents, debounce, queue | Core Indexer | Any direct DB access |

## Data Flow: Indexing Path

```
Vault files on disk
  → scanner: glob *.md, filter by SQLite hash (skip unchanged)
    → chunker: parse remark AST, split at heading boundaries
      → embedder: batch POST to OpenAI text-embedding-3-small (1536-dim)
        → LanceDB: upsert chunks with vector + text content
        → SQLite: upsert file record (path, content_hash, indexed_at, chunk_count)
```

Key invariants:
- Hash check happens BEFORE chunking/embedding (cost gate)
- Chunks carry back-reference to source file path + heading path
- All writes are to `~/.claude-code-memory/` — never inside iCloud vault

## Data Flow: Query Path

```
Query string (from MCP tool call or CLI)
  → embedder: embed query → vector (same provider as index)
    → LanceDB: vector search (ANN, top-K)    ─┐ parallel
    → LanceDB: FTS search (BM25, top-K)       ─┘ if hybrid
      → RRFReranker: merge ranked lists
        → metadata enrichment: pull timestamps/staleness from SQLite
          → return top-N chunks with source file + heading context
```

The retriever returns structured `SearchResult[]` — the MCP server and CLI format these differently for their consumers.

## Embedding Provider Abstraction

```typescript
// src/core/embedder/types.ts
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly modelId: string;
}

// src/core/embedder/factory.ts
function createEmbeddingProvider(config: EmbedConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai': return new OpenAIEmbeddingProvider(config);
    case 'ollama': return new OllamaEmbeddingProvider(config);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

The factory pattern (as validated by AnythingLLM's approach with 30+ providers) is the correct pattern here. Dimensions are declared on the provider because LanceDB schema is dimension-specific — switching providers requires reindexing.

## Project File Structure

```
src/
├── core/
│   ├── indexer.ts         # Index orchestration
│   ├── retriever.ts       # Query orchestration
│   ├── scanner.ts         # File discovery + hash gating
│   ├── chunker.ts         # remark AST → chunks
│   ├── db/
│   │   ├── lance.ts       # LanceDB client + schema
│   │   └── sqlite.ts      # better-sqlite3 metadata store
│   └── embedder/
│       ├── types.ts        # EmbeddingProvider interface
│       ├── factory.ts      # createEmbeddingProvider()
│       ├── openai.ts       # OpenAI adapter
│       └── ollama.ts       # Ollama adapter
├── mcp/
│   ├── server.ts          # MCP server bootstrap
│   ├── tools/
│   │   ├── search.ts      # mem_search tool handler
│   │   └── index.ts       # mem_index_status tool handler
│   └── types.ts           # MCP request/response types
├── cli/
│   ├── index.ts           # CLI entrypoint (commander or yargs)
│   ├── commands/
│   │   ├── search.ts
│   │   ├── index.ts
│   │   └── status.ts
│   └── format.ts          # Terminal output formatting
├── watcher/
│   └── index.ts           # chokidar setup, debounce, queue
├── config.ts              # Config loading + validation
└── types.ts               # Shared domain types (Chunk, SearchResult, etc.)
```

## LanceDB Schema Design

```typescript
// src/core/db/lance.ts
const chunkSchema = {
  id: 'string',             // uuid
  file_path: 'string',      // absolute path to source .md
  heading_path: 'string',   // e.g. "## Setup > ### macOS"
  content: 'string',        // chunk text (for FTS index)
  vector: 'fixed_size_list<float32>[1536]',  // OpenAI dims
  indexed_at: 'timestamp[ms]',
  char_count: 'int32',
};
```

FTS index created on `content` field after table creation. LanceDB's native `RRFReranker` merges vector + BM25 results without custom code.

## SQLite Metadata Schema

```sql
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,   -- SHA-256
  indexed_at INTEGER NOT NULL,  -- unix ms
  chunk_count INTEGER NOT NULL,
  staleness_score REAL DEFAULT 0.0
);
```

SQLite handles the hash-gating logic (skip unchanged files) and staleness tracking. LanceDB handles vectors. The split avoids bloating the vector store with non-vector metadata.

## Suggested Build Order (Phase Dependencies)

```
Phase 1: Core Foundation
  config.ts + types.ts → db/lance.ts + db/sqlite.ts → embedder/interface + openai adapter
  (Unblocks everything — all other components depend on these)

Phase 2: Index Pipeline
  scanner → chunker → indexer
  (Requires Phase 1 complete. Validates embedding + storage work end-to-end)

Phase 3: Query Pipeline
  retriever (hybrid search, RRF, metadata enrichment)
  (Requires Phase 2 — needs indexed data to validate queries)

Phase 4: Consumer Surfaces
  MCP server + CLI
  (Both require Phase 3. Can be built in parallel once retriever is stable)

Phase 5: Watcher + Incremental Indexing
  chokidar watcher → calls indexer with single-file scope
  (Requires Phase 2 indexer. Build last — it's an optimization layer)

Phase 6: Ollama adapter + staleness scoring
  (Requires Phase 1 embedder interface. Low risk, deferred to last)
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: MCP/CLI importing DB directly
**What:** Tool handlers calling `lancedb.connect()` themselves.
**Why bad:** Tight coupling, can't test without real DB, duplicates connection management.
**Instead:** All DB access goes through `core/retriever.ts` or `core/indexer.ts`.

### Anti-Pattern 2: Storing embeddings inside iCloud vault
**What:** Writing `.lance/` or `*.db` next to the markdown files.
**Why bad:** iCloud sync corrupts Lance format files (binary WAL files).
**Instead:** All derived data at `~/.claude-code-memory/` only.

### Anti-Pattern 3: Fixed-size text chunking
**What:** Splitting markdown every N characters or tokens.
**Why bad:** Breaks semantic context at heading boundaries; fragments structured notes.
**Instead:** remark AST → split at `heading` nodes → one chunk per section.

### Anti-Pattern 4: Embedding on every file scan
**What:** Re-embedding files even when content hasn't changed.
**Why bad:** Wastes OpenAI API cost (full vault ~$0.30 first time, should be ~$0.00 incrementally).
**Instead:** SHA-256 hash gate in SQLite; skip embedding if hash matches.

### Anti-Pattern 5: Single EmbeddingProvider instance shared across processes
**What:** Watcher, CLI, and MCP server each own a provider.
**Why bad:** For OpenAI adapter, rate limiting and connection reuse matter.
**Instead:** Provider instantiated once per process via factory; watcher delegates to indexer.

## Scalability Considerations

| Concern | Vault (~5K files) | 50K files | Notes |
|---------|-------------------|-----------|-------|
| Initial index time | ~2-5 min | ~20-30 min | Batch embeddings (100/req), hash gating on re-index |
| LanceDB query latency | <50ms | <100ms | HNSW index needed at >100K vectors |
| SQLite hash lookup | <1ms | <5ms | Indexed on `path`, trivial |
| Memory (indexer process) | ~200MB | ~500MB | LanceDB loads tables lazily |
| Watcher event flood (iCloud) | debounce 500ms | debounce 500ms | iCloud generates cascade events on sync |

## Sources

- [LanceDB Hybrid Search docs](https://docs.lancedb.com/search/hybrid-search) — HIGH confidence, official docs
- [LanceDB RRF Reranker docs](https://lancedb.com/documentation/reranking/rrf/) — HIGH confidence, official docs
- [remark/unified GitHub](https://github.com/remarkjs/remark) — HIGH confidence, official repo, fully TypeScript-typed
- [Vector Memory MCP Server (Glama)](https://glama.ai/mcp/servers/@AerionDyseti/vector-memory-mcp) — MEDIUM confidence, reference implementation
- [AnythingLLM provider abstraction pattern (DeepWiki)](https://deepwiki.com/Mintplex-Labs/anything-llm/5-vector-database-system) — MEDIUM confidence, validated factory pattern approach
- [fremem: LanceDB + MCP reference implementation](https://github.com/iamjpsharma/fremem) — MEDIUM confidence, community reference
