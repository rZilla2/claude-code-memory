# Phase 1: Foundation - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Core infrastructure: config system, LanceDB + SQLite clients, embedding provider interface with OpenAI adapter, path safety enforcement. After this phase, any other component can build on top without revisiting fundamentals.

Requirements: FOUND-01, FOUND-02, FOUND-03, FOUND-04, EMB-01, EMB-02, EMB-04

</domain>

<decisions>
## Implementation Decisions

### Config format & location
- JSON format (`config.json`) — matches TypeScript ecosystem, no extra dependencies
- Primary location: `~/.claude-code-memory/config.json`
- Vault-level override: `.claude-code-memory.json` in vault root (allows per-vault settings)
- Config loaded with defaults → merged with file → merged with env vars (highest priority)
- Required fields: `vaultPath`, `indexPath` (defaults to `~/.claude-code-memory/`), `embeddingProvider` (defaults to `openai`)

### Index storage structure
- All derived data lives at `~/.claude-code-memory/` (outside iCloud)
- Internal layout:
  - `lancedb/` — LanceDB vector tables
  - `metadata.db` — SQLite database (file hashes, timestamps, staleness scores)
  - `config.json` — user configuration
- Startup check: if `indexPath` is inside `~/Library/Mobile Documents/`, abort with clear error before writing any data

### Embedding interface contract
- Interface: `EmbeddingProvider` with `embed(texts: string[]): Promise<number[][]>` and `modelId(): string`
- Factory function: `createEmbeddingProvider(config): EmbeddingProvider`
- Batch size: 100 texts per API call, controlled by `p-limit` concurrency (2 concurrent batches default)
- `modelId()` returns a stable string (e.g., `openai:text-embedding-3-small`) stored in SQLite for mismatch detection
- On model mismatch: log warning + halt before any write, prompt user to run full reindex

### Project tooling
- Build: `tsup` (fast, minimal config, outputs CJS + ESM)
- Test: `vitest` (fast, native TypeScript, compatible with ESM)
- Dev: `tsx` for running TypeScript directly during development
- CLI framework: `commander` (lightweight, good TypeScript support, widely known)
- Linting: `eslint` with flat config + `prettier`

### Claude's Discretion
- Exact TypeScript project structure within `src/` (suggested: `src/core/`, `src/mcp/`, `src/cli/`, `src/watcher/`)
- Error message wording
- Logger implementation details (as long as it uses stderr)
- SQLite schema column naming conventions
- Test file organization

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — Project vision, constraints, key decisions
- `.planning/REQUIREMENTS.md` — Full v1 requirements with traceability
- `.planning/research/STACK.md` — Validated stack with specific versions
- `.planning/research/ARCHITECTURE.md` — Component boundaries and data flow
- `.planning/research/PITFALLS.md` — Critical pitfalls, especially iCloud corruption and MCP stdio issues

### Key version pins (from research)
- `@lancedb/lancedb` v0.27.x — correct package name (not `vectordb` or `lancedb`)
- `better-sqlite3` v12.x
- `openai` (for embeddings API)
- `@modelcontextprotocol/sdk` v1.29.x (NOT v2 — pre-alpha)
- `commander` for CLI
- `tsup` for build, `vitest` for test

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, empty repo

### Established Patterns
- None yet — this phase establishes the foundational patterns

### Integration Points
- Config system will be imported by every subsequent component
- Embedding interface will be used by indexer (Phase 2) and potentially query pipeline (Phase 3)
- SQLite metadata schema must accommodate future staleness scoring fields (Phase 6)
- LanceDB schema must include `embedding_model_id` for model mismatch detection

</code_context>

<specifics>
## Specific Ideas

- Index path at `~/.claude-code-memory/` is non-negotiable — iCloud sync corruption is the #1 risk
- stderr-only logging is enforced from day one — any stdout leaks break MCP JSON-RPC later
- Schema versioning must be in the initial SQLite schema — retrofitting is painful
- Open-source ready: clean package.json with proper fields, MIT license, .gitignore

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-05*
