# claude-code-memory

## What This Is

A vector database-based semantic memory system for Claude Code that indexes an entire Obsidian vault. Enables Claude Code to find relevant context by meaning (not keyword) via MCP, and gives the user fuzzy semantic search over their knowledge base via CLI. Ships as a single npm package.

## Core Value

Semantic recall across the entire vault — when Claude Code or Rod searches for context, the system returns what's relevant by meaning, regardless of where it's filed or what words were used.

## Requirements

### Validated

- ✓ Index entire Obsidian vault (thousands of .md files) into vector embeddings — v1.0
- ✓ Intelligent markdown-aware chunking (by heading/section, not fixed token windows) — v1.0
- ✓ Content hashing to skip re-embedding unchanged files — v1.0
- ✓ Hybrid search: vector similarity + full-text keyword search with RRF — v1.0
- ✓ MCP server so Claude Code can query memories semantically — v1.0
- ✓ CLI for user to search from terminal (`mem search "calendar setup"`) — v1.0
- ✓ Auto-reindex when vault files change (file watcher) — v1.0
- ✓ Recency weighting and metadata filtering (date, source file) — v1.0
- ✓ Staleness controls (confidence decay over time) — v1.0
- ✓ Pluggable embedding provider (OpenAI + Ollama) — v1.0
- ✓ Index stored outside iCloud to prevent sync corruption — v1.0

### Active

_(None yet — define in next milestone)_

### Out of Scope

- Obsidian plugin UI — deferred, CLI-first
- Mobile app — future consideration
- Auto-session-note generation from conversation monitoring — future
- Multi-user / multi-tenant — single user only
- Cloud-hosted vector DB — local-first, no cloud dependency
- Non-markdown file indexing (PDF, images) — markdown-first

## Context

Shipped v1.0 with 2,169 LOC TypeScript + 4,048 LOC tests (1.9x test-to-code ratio).
Tech stack: TypeScript, LanceDB, better-sqlite3, remark/unified, chokidar v4, OpenAI/Ollama embeddings.
Vault indexed: 1,079 files → 4,334 chunks with OpenAI text-embedding-3-small.
MCP tools (`search_memory`, `get_context`) live in Claude Code.

## Constraints

- **Local-first**: No cloud DB dependency. Vector index at `~/.claude-code-memory/`
- **macOS**: Primary platform, must handle iCloud paths with spaces
- **Open-source**: Clean GitHub repo, shareable as npm package
- **Single package**: One `npm install`, not monorepo
- **Embedding cost**: Full vault indexing under $0.30 with OpenAI

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| LanceDB for vectors | Embedded, zero-ops, file-on-disk, Rust-based | ✓ Good — 4,334 chunks, fast queries |
| better-sqlite3 for metadata | File hashes, timestamps, lighter than LanceDB for metadata | ✓ Good |
| OpenAI text-embedding-3-small default | Best quality-to-cost ratio, $0.25 for full vault | ✓ Good |
| TypeScript | MCP SDK is TS-native, npm distribution natural | ✓ Good |
| Index outside iCloud | Prevents sync corruption of Lance format files | ✓ Good |
| Hybrid retrieval (vector + FTS + RRF) | Pure vector misses exact-match queries | ✓ Good — validated in live testing |
| remark/unified for chunking | Markdown AST parsing splits by heading section | ✓ Good — biggest quality lever |
| chokidar v4 for file watching | v4 ESM-native, batch window handles iCloud cascade | ✓ Good |
| Pluggable embedding provider | OpenAI + Ollama, prevents vendor lock-in | ✓ Good |

---
*Last updated: 2026-04-06 after v1.0 milestone*
