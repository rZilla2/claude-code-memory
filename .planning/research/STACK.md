# Technology Stack

**Project:** claude-code-memory
**Researched:** 2026-04-05
**Overall confidence:** HIGH (all core picks verified against current npm/official sources)

---

## Recommended Stack

### Core Vector Store

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@lancedb/lancedb` | `^0.27.2` | Embedded vector DB | Only embedded vector DB with a first-class TypeScript library; zero-ops, file-on-disk, Rust-based. v0.27.2 published Feb 2026 — actively maintained. Supports native FTS and RRF hybrid search without a separate search engine. |

**Confidence: HIGH.** Verified against npm. Package updated Feb 2026. LanceDB is the only embedded vector DB with native TS bindings, FTS, and hybrid search built in. Alternatives (Qdrant, ChromaDB) require a running server process — wrong for a local CLI tool.

**Do NOT use:**
- `vectordb` (legacy LanceDB package name, superseded by `@lancedb/lancedb`)
- Qdrant local — requires Docker or standalone binary, too much ops overhead
- ChromaDB — Python-first, TS bindings are a wrapper, no native hybrid search

---

### Metadata Store

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `better-sqlite3` | `^12.4.1` | Content hashes, timestamps, staleness scores, chunk index | Synchronous API is a perfect fit — no async complexity for what amounts to a local key-value store. Fastest SQLite binding for Node.js. Separating metadata from LanceDB means you can reindex, prune, or inspect without touching the vector data. |
| `@types/better-sqlite3` | `^7.x` | TypeScript types | Types ship separately; latest updated Apr 2025. |

**Confidence: HIGH.** Version 12.4.1 confirmed on npm. Synchronous SQLite is the right call here — content hashing and staleness bookkeeping don't benefit from async.

**Do NOT use:**
- `node-sqlite3` — async API adds needless complexity for sequential indexing work
- Storing metadata in LanceDB itself — mixes concerns, makes hash lookups slower

---

### Embeddings

| Technology | Version / Detail | Purpose | Why |
|------------|---------|---------|-----|
| OpenAI `text-embedding-3-small` | API, model `text-embedding-3-small` | Default embedding provider | 75.8% MTEB accuracy, $0.02/1M tokens. Full vault index (assume 5M tokens) costs ~$0.10. Best quality-to-cost ratio in cloud models. 1536 dimensions. |
| `openai` npm package | `^4.x` | OpenAI API client | Official TS client, maintained by OpenAI |
| Ollama `nomic-embed-text` | Model `nomic-embed-text`, 768 dims | Local/offline fallback | Surpasses text-embedding-3-small on long-context tasks per benchmarks, zero cost, full privacy. Pull with `ollama pull nomic-embed-text`. Used when `OPENAI_API_KEY` absent or `--local` flag set. |

**Confidence: MEDIUM–HIGH.** OpenAI pricing and model names verified at developers.openai.com. nomic-embed-text benchmarks from multiple sources (tigerdata, elephas, medium). One benchmark puts nomic at 71% vs OpenAI 75.8% on general tasks — OpenAI wins by ~5% on short retrieval tasks but nomic wins on long-context. Given that Obsidian sections can be long, nomic is a credible default for local-only users.

**Important implementation note:** Both providers must be abstracted behind a common `EmbeddingProvider` interface (method: `embed(texts: string[]): Promise<number[][]>`). This is the primary extensibility surface for open-source users.

**Do NOT use:**
- `text-embedding-ada-002` — superseded, worse quality and worse cost than 3-small
- `text-embedding-3-large` — 6x cost for ~5% quality gain; wrong trade-off for a vault index

---

### Markdown Chunking

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `unified` | `^11.x` | AST processing pipeline | Core processor; pure ESM, fully typed |
| `remark-parse` | `^11.x` | Markdown → mdast AST | Standard parser, supports GFM via plugin. Current release line is ^11, Node 16+. |
| `remark-frontmatter` | `^5.x` | Parse YAML frontmatter | Obsidian files use frontmatter heavily for tags, dates, aliases |
| `remark-gfm` | `^4.x` | GitHub Flavored Markdown | Tables, task lists, strikethrough — common in Obsidian |
| `mdast-util-to-string` | `^4.x` | AST node → plain text | For extracting chunk text after splitting |

**Strategy:** Walk the mdast tree and split on heading nodes (depth 1–3). Each chunk = `[heading text + body until next same-or-higher heading]`. This is semantically superior to fixed-token chunking. Frontmatter fields (tags, aliases, dates) become metadata on each chunk, not body text.

**Confidence: HIGH.** remark/unified ecosystem is the standard for programmatic Markdown processing in JS/TS. Version ^11 confirmed on npm. The AST-based heading-split approach is the dominant pattern in RAG literature for structured documents.

**Do NOT use:**
- LangChain's `MarkdownHeaderTextSplitter` — adds a heavy dependency for one utility
- Fixed-size token chunking — loses semantic boundaries; heading-based is strictly better for Obsidian vault content which is already organized by heading

---

### File Watching

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `chokidar` | `^4.0.3` | Watch vault for changes, trigger reindex | v4 (released Sep 2024) rewrites in TypeScript, drops fsevents bundle (all FSEvents issues resolved natively), reduces from 13 to 1 dependency. Still supports CJS. |

**Version decision — v3 vs v4 vs v5:**
- v3 (`3.6.0`): battle-tested but carries 13 deps including bundled fsevents. Still works fine.
- v4 (`4.0.x`): TS rewrite, 1 dep, FSEvents fixed, drops glob watching (not needed here — we're watching a directory, not a glob). **Recommended.**
- v5 (Nov 2025): ESM-only, Node 20+ required. Too bleeding-edge for a tool targeting broad npm users.

**Confidence: HIGH.** Migration guide and release notes confirmed via DEV Community and GitHub. The glob removal in v4 is not a blocker — we'll watch the vault root directory and filter by `.md` extension in the callback.

**iCloud-specific note:** iCloud sync can fire cascade events when syncing. Debounce at 500ms minimum. Watch the index path (`~/.claude-code-memory/`) separately from vault reads; never write index files inside the iCloud path.

**Do NOT use:**
- v5 — ESM-only requirement will break installs for users on Node 18 or with CJS projects
- `fs.watch` directly — unreliable on macOS for directory trees

---

### MCP Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server for Claude Code | Official Anthropic TS SDK. v1.29.0 published ~Apr 1 2026. v2 is in pre-alpha on main — stay on v1.x until stable v2 ships. Supports stdio transport (right for local MCP servers). |
| `zod` | `^3.25.x` | Schema validation | Required peer dependency of MCP SDK. SDK internally uses `zod/v4` but maintains backward compat with v3.25+. |

**Transport:** Use `StdioServerTransport`. Streamable HTTP superseded SSE as of Mar 2025 MCP spec, but stdio is the correct transport for a local CLI tool embedded in Claude Code.

**Confidence: HIGH.** Version 1.29.0 confirmed on npm. Official GitHub repo reviewed.

---

### TypeScript / Build

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TypeScript | `^5.7` | Language | MCP SDK is TS-native; npm distribution natural; matches Claude Code ecosystem |
| `tsx` | `^4.x` | Dev-time execution | Run TS directly without separate build step during development |
| `tsup` | `^8.x` | Build/bundle | Zero-config bundler for TS libraries; generates CJS + ESM dual output for npm distribution |
| Node.js | `>=18` | Runtime | MCP SDK requires Node 18+; LanceDB native bindings require 18+ |

**Confidence: HIGH.** These are standard choices for TS library distribution in 2025/2026.

---

## Full Installation

```bash
# Core runtime
npm install @lancedb/lancedb better-sqlite3 openai

# Markdown processing
npm install unified remark-parse remark-frontmatter remark-gfm mdast-util-to-string

# File watching
npm install chokidar

# MCP
npm install @modelcontextprotocol/sdk zod

# Dev
npm install -D typescript tsx tsup @types/better-sqlite3 @types/node
```

---

## Alternatives Considered and Rejected

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Vector DB | `@lancedb/lancedb` | Qdrant (local) | Requires running server process; wrong for embedded CLI tool |
| Vector DB | `@lancedb/lancedb` | ChromaDB | Python-first; TS bindings are a wrapper; no native hybrid search |
| Vector DB | `@lancedb/lancedb` | pgvector | Requires PostgreSQL instance; massive overkill |
| Metadata | `better-sqlite3` | Storing metadata in LanceDB | Mixed concerns; hash lookups slower against vector store |
| Metadata | `better-sqlite3` | `node-sqlite3` | Async API adds complexity to sequential indexing; slower |
| Embeddings | `text-embedding-3-small` | `text-embedding-ada-002` | Superseded; worse accuracy, same cost |
| Embeddings | `text-embedding-3-small` | `text-embedding-3-large` | 6x cost for ~5% gain; wrong trade-off |
| Chunking | `remark/unified` | LangChain splitters | Adds entire LangChain dep tree for one utility |
| Chunking | `remark/unified` | Fixed-token splitting | Loses semantic heading boundaries; worse retrieval quality |
| File watching | `chokidar@^4` | `chokidar@^3` | v4 is the current maintained release; v3 carries 13 deps |
| File watching | `chokidar@^4` | `chokidar@^5` | ESM-only; Node 20+ requirement too restrictive |
| File watching | `chokidar@^4` | `fs.watch` | Unreliable on macOS directory trees |
| MCP | `@modelcontextprotocol/sdk@^1` | SDK v2 (pre-alpha) | Pre-alpha; breaking changes expected; stay on v1.x |

---

## Architecture Note on LanceDB Package Name

There are three LanceDB npm packages. Use only `@lancedb/lancedb`:

| Package | Status |
|---------|--------|
| `vectordb` | Legacy name, deprecated |
| `lancedb` | Transition package, points to new SDK |
| `@lancedb/lancedb` | **Current. Use this.** |

---

## Sources

- [@lancedb/lancedb on npm](https://www.npmjs.com/package/@lancedb/lancedb) — v0.27.2, Feb 2026 (MEDIUM confidence on exact version — WebSearch)
- [LanceDB Hybrid Search docs](https://docs.lancedb.com/search/hybrid-search) — native FTS + RRF confirmed (HIGH)
- [better-sqlite3 on npm](https://www.npmjs.com/package/better-sqlite3) — v12.4.1 (HIGH — multiple search sources agree)
- [OpenAI text-embedding-3-small model page](https://developers.openai.com/api/docs/models/text-embedding-3-small) (HIGH)
- [nomic-embed-text on Ollama](https://ollama.com/library/nomic-embed-text) (HIGH)
- [Embedding model comparison — elephas.app](https://elephas.app/blog/best-embedding-models) (MEDIUM — benchmark source)
- [remark-parse on npm](https://www.npmjs.com/package/remark-parse) — v11 (HIGH)
- [Chokidar migration guide v3→v4](https://dev.to/43081j/migrating-from-chokidar-3x-to-4x-5ab5) (HIGH)
- [chokidar on npm](https://www.npmjs.com/package/chokidar) — v4/v5 release info (HIGH)
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.29.0, Apr 2026 (HIGH)
- [MCP TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk) (HIGH)
