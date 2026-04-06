# Phase 4: Consumer Surfaces - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

MCP server so Claude Code can query memories semantically, plus CLI `mem search` and `mem config` commands. Thin wrappers over the existing `searcher.ts` core. `mem index` and `mem status` already exist from Phase 2 — this phase adds the remaining CLI surface and the MCP server.

Requirements: MCP-01, MCP-02, MCP-03, MCP-04, CLI-01, CLI-04, CLI-05
(CLI-02 `mem index` and CLI-03 `mem status` already complete from Phase 2)

</domain>

<decisions>
## Implementation Decisions

### MCP tool interface
- `search_memory` exposes full control: `query` (string, required), `limit` (number), `mode` (vector/fts/hybrid), `afterDate` (string), `beforeDate` (string), `sourceGlob` (string)
- `get_context` takes a chunk ID, returns the target chunk plus prev/next neighboring chunks from the same source file — gives Claude surrounding context when a search hit needs more
- Tool results are rich objects: `{sourcePath, headingPath, text, score, indexedAt}` — Claude formats as needed
- Eager warm-up: open LanceDB + SQLite connections on MCP server startup, before any tool call arrives. No surprise latency on first search.
- stdio transport with strict stderr-only logging (carried forward from Phase 1)

### CLI search output
- `mem search "query"` shows snippet (first ~150 chars) per result by default. `--full` flag shows complete chunk text.
- Plain text output by default, one result per block (source path, heading, score, snippet). `--json` flag for structured output (piping to jq, scripts).
- Colored output with TTY auto-detect: color when stdout is a TTY, plain when piped. Respects `NO_COLOR` env var and `--no-color` flag.

### `mem config` command
- `mem config` (no args): shows all current configuration values
- `mem config set <key> <value>`: sets individual config values
- `mem config init`: interactive wizard for first-time setup
- All config fields are settable via CLI: vaultPath, indexPath, embeddingProvider, openaiModel, batchSize, concurrency, ignorePaths, includeExtensions

### npm global install experience
- Auto-detect on first run: check for Obsidian vault at standard iCloud path (`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/`)
- If found: create config at `~/.claude-code-memory/config.json` with detected vault path and sensible defaults, print what was created
- If not found: fall back to `mem config init` wizard
- Goal: `npm install -g claude-code-memory && mem index` gets you from zero to working

### Claude's Discretion
- MCP server internal architecture (handler registration, request routing)
- Exact neighbor-finding logic for `get_context` (heading-path adjacency vs positional)
- Color library choice (chalk, picocolors, etc.)
- Config wizard prompt library (inquirer, prompts, etc.)
- Error message wording for missing config, empty index, no results

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — Project vision, constraints, key decisions
- `.planning/REQUIREMENTS.md` — Full v1 requirements; MCP-01 through MCP-04 and CLI-01 through CLI-05 are this phase
- `.planning/research/STACK.md` — Validated stack with specific versions
- `.planning/research/ARCHITECTURE.md` — Component boundaries and data flow
- `.planning/research/PITFALLS.md` — Critical pitfalls, especially MCP stdio corruption and iCloud path handling

### Prior phase context
- `.planning/phases/01-foundation/01-CONTEXT.md` — Config format, index structure, embedding interface, tooling decisions
- `.planning/phases/02-index-pipeline/02-CONTEXT.md` — Chunking strategy, hashing, CLI command patterns

### Existing code to build on
- `src/core/searcher.ts` — `search()` function: vector, FTS, and hybrid search with RRF merge and filtering
- `src/types.ts` — `SearchResult`, `SearchOptions`, `Config` interfaces
- `src/cli/index.ts` — Commander CLI entry point with `registerXCommand()` pattern
- `src/cli/commands/index-cmd.ts` — Example of existing CLI command registration
- `src/cli/commands/status-cmd.ts` — Example of existing CLI command registration
- `src/config.ts` — `loadConfig()` with Zod validation and path safety
- `src/core/db/lance.ts` — `connectLanceDb()`, `openChunksTable()`
- `src/core/db/sqlite.ts` — `openMetadataDb()`, `assertModelMatch()`
- `src/logger.ts` — stderr-only logger

### Key version pins
- `@modelcontextprotocol/sdk` v1.29.x (NOT v2 — pre-alpha)
- `commander` for CLI (already installed)
- `package.json` already has `bin: {"mem": "./dist/cli/index.cjs"}`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `search()` in `src/core/searcher.ts` — accepts `(query, table, embedder, options)`, returns `SearchResult[]`. MCP server and CLI both call this directly.
- `loadConfig()` — provides all config values, already validated with Zod
- `openMetadataDb()` + `connectLanceDb()` + `openChunksTable()` — DB initialization, reuse for eager warm-up
- `registerXCommand(program)` pattern — `mem search` and `mem config` follow the same pattern as existing commands

### Established Patterns
- Commander CLI with subcommands registered via `registerXCommand(program)` in `src/cli/index.ts`
- All logging via `src/logger.ts` (stderr-only) — MCP server MUST use this, never console.log
- Zod for config validation with typed defaults
- better-sqlite3 with WAL mode
- LanceDB with Apache Arrow schema

### Integration Points
- MCP server: new `src/mcp/` directory, registered as stdio server in package.json or run via `mem mcp` command
- CLI search: new `src/cli/commands/search-cmd.ts` following existing command pattern
- CLI config: new `src/cli/commands/config-cmd.ts`
- `package.json` bin entry already points to `./dist/cli/index.cjs`
- MCP server config for Claude Code goes in `~/.claude.json` mcpServers section

</code_context>

<specifics>
## Specific Ideas

- Auto-detect vault at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/` on first run — Rod's standard location
- Rich objects in MCP responses let Claude Code format results contextually rather than receiving pre-formatted text
- `get_context` with neighbors solves the "chunk is too small to understand" problem without returning entire files
- Colored CLI output follows the `rg`/`git` convention Rod is used to

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-consumer-surfaces*
*Context gathered: 2026-04-06*
