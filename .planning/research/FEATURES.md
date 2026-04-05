# Feature Landscape

**Domain:** Vector DB semantic memory / RAG system for AI coding assistants and knowledge bases
**Researched:** 2026-04-05
**Confidence:** HIGH (multiple corroborating sources: mem0, Khoj, Smart Connections, claude-mem, RAG literature)

## Reference Projects Surveyed

- **mem0** — Most-adopted standalone AI memory layer (~48k GitHub stars), conversation-oriented
- **Khoj** — Self-hostable personal AI with document indexing + bi-encoder/cross-encoder pipeline
- **Obsidian Smart Connections** — Vault-first semantic search, block-level chunking, local embeddings
- **claude-mem** — Claude Code plugin with session compression, ChromaDB, 3-layer token-efficient retrieval
- **claude-code-vector-memory** — Semantic memory for Claude Code via session summary vectors
- **Claude-CursorMemoryMCP** — LanceDB-backed MCP server for Cursor and Claude Code

---

## Table Stakes

Features users expect. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Semantic vector search | Core value prop — "find by meaning, not keyword" | Med | Must return ranked results with scores |
| Markdown-aware chunking | Flat splits destroy context; all mature tools use structure-aware chunking | Med | Split by heading/section, not fixed tokens |
| Content hash deduplication | Nobody wants to pay $0.30 every cold start | Low | SHA-256 of file content, skip unchanged |
| Pluggable embedding provider | Open-source users won't pay OpenAI; local-first is table stakes for privacy tools | Med | Interface + at least 2 impls (OpenAI, Ollama) |
| MCP server interface | Claude Code integration requires MCP; without it the tool is useless to this audience | Med | `mem_search`, `mem_get` tools at minimum |
| CLI search command | Developers expect `mem search "..."` before they trust an embedded tool | Low | Single command, human-readable output |
| File watcher / auto-reindex | Stale index breaks trust immediately — users stop relying on it | Med | chokidar, debounced, incremental |
| Metadata filtering | "Show me only things from this year / this project" — basic usefulness | Med | SQL-style WHERE on date, tags, path |
| Relevance scoring in results | Required for debugging and trust calibration; all reference tools expose this | Low | Cosine similarity + recency weight combined |
| Index stored outside source tree | iCloud/Dropbox sync corrupts embedded DB files — this is a known failure mode | Low | `~/.claude-code-memory/` convention |

---

## Differentiators

Features that set this product apart. Not universally expected, but high-value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hybrid search (vector + BM25/FTS) | +9.3pp MRR improvement over vector-only; catches exact-match queries vector misses | High | Reciprocal Rank Fusion (k≈60) to merge rankings; LanceDB supports FTS natively |
| Staleness/confidence decay | Context from 3 years ago deserves less weight than last week — no other local tool does this | Med | Exponential decay on recency_score; configurable half-life |
| Heading-path chunk IDs | Store `file.md > H2 > H3` path with each chunk — enables "show me the section" not just "show me a snippet" | Low | Included free with remark AST parsing |
| Cross-encoder reranking | Khoj uses bi-encoder + cross-encoder; improves result ordering on longer queries | High | Optional / v2 candidate — adds latency, needs evaluation |
| Multi-source indexing | Beyond Obsidian: index `~/.claude/` project memories, session notes, arbitrary dirs | Med | Configurable source roots with per-source metadata |
| Token-efficient 3-layer retrieval | claude-mem pattern: search returns compact index → timeline context → get full details on demand | Med | Reduces MCP response token cost ~10x on large vaults |
| Obsidian Copilot-style source attribution | Return source file path + heading breadcrumb with every result | Low | Built from chunk metadata, not extra work |
| Index health CLI commands | `mem status`, `mem reindex`, `mem doctor` — builds trust, aids debugging | Low | Operational tooling often skipped by research projects |
| Configurable chunk overlap | Adjacent-section overlap catches cross-heading concepts | Low | 50–100 word overlap option at heading boundaries |
| Result explanation mode | "Why was this returned?" — shows top terms + similarity score breakdown | High | v2 candidate — useful for power users |

---

## Anti-Features

Features to explicitly NOT build (at least for v1).

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Obsidian plugin UI | Requires Obsidian plugin API, separate build pipeline, review process, different audience | CLI + MCP server first; Obsidian plugin is a separate future project |
| Cloud-hosted vector DB | Breaks local-first constraint, adds cost, privacy concerns, complexity | LanceDB on disk at `~/.claude-code-memory/` |
| Multi-user / access control | Auth layer triples complexity; nobody asked for it | Single-user, single-vault design |
| Real-time conversation monitoring | Auto-capturing Claude conversations requires deep hooks, raises privacy questions | Use existing `/save-session-notes` workflow; index the resulting files |
| Graph memory / entity extraction | mem0-style graph adds significant complexity; marginal value for a vault of Markdown files | Pure vector + FTS hybrid is sufficient; revisit in v2 |
| LLM-generated query expansion | RAG-Fusion (generate query variants via LLM) adds latency and API cost at search time | RRF over two search strategies achieves similar breadth without extra inference |
| Web search grounding | Khoj does this; it's a different product entirely | Out of scope — this is vault search, not general search |
| Mobile app | Different platform, different build target | Not in scope |
| npm library with programmatic API as primary surface | Fine to expose, but don't design for it at the expense of the CLI/MCP surfaces | CLI + MCP are primary; programmatic API is a byproduct |

---

## Feature Dependencies

```
Content hash deduplication → File watcher / auto-reindex
  (hash check is how the watcher decides what to re-embed)

Markdown-aware chunking → Heading-path chunk IDs
  (IDs are derived from the AST parse that chunking requires)

Markdown-aware chunking → Token-efficient 3-layer retrieval
  (clean chunks are required for compact index to be meaningful)

Pluggable embedding provider → All indexing features
  (must exist before any indexing can happen)

MCP server interface → Claude Code integration
  (MCP is the only integration surface Claude Code supports)

Hybrid search (vector + BM25) → Staleness/confidence decay
  (recency score feeds into the merged ranking; decay is a scoring input)

Metadata filtering → Staleness/confidence decay
  (staleness score is a metadata field used in WHERE clauses)

CLI search command → Index health CLI commands
  (same CLI binary; health commands are additional subcommands)
```

---

## MVP Recommendation

Prioritize for v1.0:

1. **Markdown-aware chunking with heading-path IDs** — biggest quality lever; all retrieval quality flows from this
2. **Content hash deduplication + file watcher** — without this, trust erodes after first cold-start cost
3. **Pluggable embedding provider (OpenAI default + Ollama stub)** — required before any indexing
4. **Hybrid search with RRF** — table stakes quality; pure vector is visibly worse on exact-match queries
5. **Metadata filtering (date, source, tags)** — staleness weighting depends on this
6. **MCP server with `mem_search` + `mem_get`** — primary integration surface
7. **CLI: `mem search`, `mem index`, `mem status`** — operational trust and user-facing utility
8. **Staleness/recency weighting** — low implementation cost once metadata exists; high perceived quality

Defer to v2:
- **Cross-encoder reranking** — adds latency; evaluate whether base hybrid search is already good enough
- **Token-efficient 3-layer retrieval** — optimize after measuring real MCP response sizes
- **Multi-source indexing beyond Obsidian** — expand source roots after core vault indexing is solid
- **Result explanation mode** — power user feature; validate demand first

---

## Sources

- [mem0 GitHub](https://github.com/mem0ai/mem0) — architecture, reranker support, LOCOMO benchmark
- [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) — ecosystem comparison
- [Smart Connections Obsidian](https://smartconnections.app/smart-connections/) — chunking and embedding design
- [Khoj search docs](https://docs.khoj.dev/features/search/) — bi-encoder + cross-encoder pipeline
- [claude-mem GitHub](https://github.com/thedotmack/claude-mem) — 3-layer token-efficient retrieval pattern
- [claude-code-vector-memory](https://github.com/christian-byrne/claude-code-vector-memory) — session summary vector approach
- [Advanced RAG: Reciprocal Rank Fusion](https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search/) — RRF mechanics, k≈60 constant
- [Why Your RAG Sucks: Chunking and Hybrid Search](https://medium.com/beyond-bits/why-your-rag-sucks-the-art-and-science-of-chunking-and-hybrid-search-5d2165b21be9) — +9.3pp MRR improvement data
- [LanceDB Metadata Filtering](https://docs.lancedb.com/search/filtering) — SQL-style pre/post filtering capabilities
- [LanceDB MCP Server](https://github.com/RyanLisse/lancedb_mcp) — existing LanceDB MCP implementations
