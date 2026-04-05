# claude-code-memory

## What This Is

A vector database-based semantic memory system for Claude Code that indexes an entire Obsidian vault. Replaces grep-based flat-file memory with meaning-based recall — enabling Claude Code to find relevant context by concept (not keyword), and giving the user fuzzy semantic search over their entire knowledge base via CLI. Designed to be shared as a clean open-source npm package.

## Core Value

Semantic recall across the entire vault — when Claude Code or Rod searches for context, the system returns what's relevant by meaning, regardless of where it's filed or what words were used.

## Requirements

### Validated

- [x] Index entire Obsidian vault (thousands of .md files) into vector embeddings — Validated in Phase 2: index-pipeline
- [x] Intelligent markdown-aware chunking (by heading/section, not fixed token windows) — Validated in Phase 2: index-pipeline
- [x] Content hashing to skip re-embedding unchanged files — Validated in Phase 2: index-pipeline

### Active

- [ ] MCP server so Claude Code can query memories semantically
- [ ] CLI for user to search from terminal (`mem search "calendar setup"`)
- [ ] Auto-reindex when vault files change (file watcher)
- [ ] Hybrid search: vector similarity + full-text keyword search
- [ ] Recency weighting and metadata filtering (date, source file, tags)
- [ ] Staleness controls (confidence decay over time)
- [ ] Pluggable embedding provider (OpenAI default + Ollama adapter)
- [ ] Index stored outside iCloud to prevent sync corruption

### Out of Scope

- Obsidian plugin UI — deferred to future, CLI-first for v1
- Mobile app — future consideration after core is solid
- Auto-session-note generation from conversation monitoring — future feature, continue using /save-session-notes-rw2 for now
- Multi-user / multi-tenant — single user only
- Cloud-hosted vector DB — local-first, no cloud dependency

## Context

- Rod's Obsidian vault lives at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Second Brain/` (iCloud-synced, path has spaces)
- Current memory system: flat .md files in `~/.claude/projects/*/memory/` and session notes per project, searched via grep
- Pain points: grep is keyword-exact (misses semantic matches), session notes tied to specific projects (cross-cutting context lost), files scattered everywhere
- Inspired by Claude-Mem GitHub project approach
- Second opinions from Codex and Gemini both validated the core stack with refinements

## Constraints

- **Local-first**: No cloud DB dependency. Vector index stored locally at `~/.claude-code-memory/`
- **macOS**: Primary platform, must handle iCloud paths with spaces
- **Open-source**: Clean GitHub repo with README, good organization, shareable as npm package
- **Single package**: Ship as one `npm install`, not a multi-package monorepo
- **Embedding cost**: OpenAI text-embedding-3-small keeps full vault indexing under $0.30

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| LanceDB for vectors | Embedded, zero-ops, file-on-disk, Rust-based, good TS bindings. Both Codex and Gemini validated. | — Pending |
| better-sqlite3 for metadata | File hashes, timestamps, staleness scores. Lighter than putting metadata in LanceDB. | — Pending |
| OpenAI text-embedding-3-small as default | Best quality-to-cost ratio. Abstract behind interface for swappability. | — Pending |
| TypeScript | MCP SDK is TS-native, matches Claude Code ecosystem, npm distribution natural. | — Pending |
| Store index outside iCloud | iCloud sync can corrupt Lance format files. Vault is read-only input; index is derived data at ~/.claude-code-memory/ | — Pending |
| Hybrid retrieval (vector + FTS) | Pure vector misses exact-match queries. LanceDB supports FTS natively. Merge with reciprocal rank fusion. | — Pending |
| remark/unified for chunking | Markdown AST parsing splits by heading section. Biggest quality lever for retrieval. | ✓ Validated Phase 2 |
| chokidar v3 for file watching | v3.6.0 battle-tested on macOS FSEvents. v4 dropped platforms. Debounce 500ms+ for iCloud cascade events. | — Pending |
| Pluggable embedding provider | Abstract with interface. Ship OpenAI + Ollama adapters. Prevents vendor lock-in for open-source users. | — Pending |

---
*Last updated: 2026-04-05 — Phase 2 (index-pipeline) complete*
