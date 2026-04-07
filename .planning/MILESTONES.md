# Milestones

## v1.0 MVP (Shipped: 2026-04-06)

**Phases:** 6 | **Plans:** 16 | **Commits:** 97 | **Source LOC:** 2,169 | **Test LOC:** 4,048
**Timeline:** 2 days (2026-04-05 → 2026-04-06)
**Git range:** d8d8b17..7be1c8f

**Key accomplishments:**

1. Vector + FTS hybrid search with RRF merge over Obsidian vault (4,334 chunks indexed)
2. MCP server with `search_memory` and `get_context` tools for Claude Code integration
3. CLI (`mem search/index/status/config/watch/compact/prune`) with colored terminal output
4. Chokidar v4 file watcher with batch dedup, rename detection, and startup catch-up scan
5. Pluggable embedding providers — OpenAI text-embedding-3-small (default) + Ollama/nomic-embed-text (local)
6. Staleness decay scoring with configurable exponential decay (`exp(-rate * ageDays)`)

**Key decisions:**
- LanceDB for vectors (embedded, zero-ops, Rust-based)
- better-sqlite3 for metadata (content hashes, timestamps)
- remark/unified AST for markdown-aware chunking by heading
- Hybrid retrieval with reciprocal rank fusion (RRF)
- Index stored at `~/.claude-code-memory/` (outside iCloud to prevent sync corruption)

**Known issues at ship:**
- YouTube transcript files exceed 8192 token embedding limit (chunker needs large-file handling)
- Ollama full reindex not yet tested end-to-end (adapter built and unit tested)

---

## v1.1 Baseline Fixes (Shipped: 2026-04-06)

**Phases:** 2 | **Plans:** 6 | **Tests:** 178 | **Coverage:** 81.69%
**Git range:** c75a804..5c75387

**Key accomplishments:**

1. Large section sub-chunking — heading sections exceeding maxTokens now split by paragraph
2. LanceDB deprecation warnings eliminated (`_distance`, `_score` in select columns)
3. Ollama integration tests and model mismatch verification
4. `search_memory` returns chunk IDs for `get_context` lookup (was missing)
5. DTS build fix (`ignoreDeprecations: "6.0"`)
6. Open-source release — MIT license, npm package fields, README, GitHub repo

**Repo:** https://github.com/rZilla2/claude-code-memory

---
