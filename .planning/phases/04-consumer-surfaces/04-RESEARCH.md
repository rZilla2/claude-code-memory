# Phase 4: Consumer Surfaces - Research

**Researched:** 2026-04-06
**Domain:** MCP server (stdio transport) + CLI search/config commands + npm global install UX
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**MCP tool interface:**
- `search_memory`: `query` (string, required), `limit` (number), `mode` (vector/fts/hybrid), `afterDate` (string), `beforeDate` (string), `sourceGlob` (string)
- `get_context`: takes a chunk ID, returns the target chunk plus prev/next neighboring chunks from the same source file
- Tool results are rich objects: `{sourcePath, headingPath, text, score, indexedAt}` — Claude formats as needed
- Eager warm-up: open LanceDB + SQLite connections on MCP server startup, before any tool call arrives
- stdio transport with strict stderr-only logging

**CLI search output:**
- Snippet (first ~150 chars) per result by default; `--full` flag shows complete chunk text
- Plain text by default, one result per block (source path, heading, score, snippet); `--json` flag for structured output
- Colored output with TTY auto-detect; respects `NO_COLOR` env var and `--no-color` flag

**`mem config` command:**
- `mem config` (no args): shows all current config values
- `mem config set <key> <value>`: sets individual config values
- `mem config init`: interactive wizard for first-time setup
- All config fields settable via CLI: vaultPath, indexPath, embeddingProvider, openaiModel, batchSize, concurrency, ignorePaths, includeExtensions

**npm global install UX:**
- Auto-detect on first run: check `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/`
- If found: create `~/.claude-code-memory/config.json` with defaults, print what was created
- If not found: fall back to `mem config init` wizard
- Goal: `npm install -g claude-code-memory && mem index` works from zero

### Claude's Discretion
- MCP server internal architecture (handler registration, request routing)
- Exact neighbor-finding logic for `get_context`
- Color library choice (chalk, picocolors, etc.)
- Config wizard prompt library (inquirer, prompts, etc.)
- Error message wording

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | MCP server exposes `search_memory` tool for Claude Code to query semantically | MCP SDK Server + tool registration patterns; search() in searcher.ts is the call target |
| MCP-02 | MCP server exposes `get_context` tool for retrieving full chunk details by ID | Requires SQLite or LanceDB lookup by chunk ID; heading-adjacency neighbor logic |
| MCP-03 | MCP server uses stdio transport with strict stderr-only logging | StdioServerTransport from MCP SDK; logger.ts already enforces stderr-only |
| MCP-04 | MCP server handles cold start gracefully (warm-up completes before first response) | connectLanceDb + openChunksTable + dummy embed on startup |
| CLI-01 | `mem search "<query>"` returns top-N results with source, heading, and relevance score | search() in searcher.ts; registerSearchCommand pattern |
| CLI-02 | `mem index` runs full or incremental reindex | Already complete from Phase 2 |
| CLI-03 | `mem status` shows index health | Already complete from Phase 2 |
| CLI-04 | `mem config` shows or sets configuration values | New registerConfigCommand; reads/writes ~/.claude-code-memory/config.json |
| CLI-05 | CLI is installed globally via `npm install -g claude-code-memory` | package.json bin already points to ./dist/cli/index.cjs; auto-detect first-run logic needed |
</phase_requirements>

---

## Summary

Phase 4 is thin-wrapper work. The hard parts — hybrid search with RRF, LanceDB + SQLite integration, embedding provider abstraction — are all done in Phases 1–3. This phase wires those capabilities to two new consumer surfaces: an MCP server (for Claude Code) and two CLI commands (`mem search`, `mem config`).

The MCP SDK is not yet installed. It needs to be added to `package.json` dependencies alongside `commander` (which is currently in devDependencies — it needs to move to dependencies for the global install to work). The tsup config needs a new entry point for the MCP server binary.

The most complex new logic is: (1) the `get_context` neighbor-finding — determining which chunks are adjacent in the same source file requires a positional query against SQLite or LanceDB; (2) the warm-up sequence — must complete before the first tool call or the 60s SDK timeout will fire on a cold large index; (3) the auto-detect first-run flow for the npm global install.

**Primary recommendation:** Build in this order — MCP server core (search_memory + get_context + warm-up) → CLI search command → CLI config command → first-run auto-detect. Each step is independently testable.

---

## Standard Stack

### Core (all already in package.json except MCP SDK)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server and stdio transport | Official Anthropic TS SDK; NOT v2 (pre-alpha) |
| `commander` | `^14.0.3` | CLI argument parsing | Already in devDeps; must move to deps for global install |
| `zod` | `^4.3.6` | MCP tool input validation | Already installed; SDK peer dep |

### Supporting (Claude's discretion items)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `picocolors` | `^1.1.x` | TTY-detected color output | Preferred over chalk — 14x smaller, no ESM/CJS issues, same API surface needed |
| `@inquirer/prompts` | `^7.x` | Interactive config wizard | Modern replacement for inquirer v8; ESM-native; use for `mem config init` |

**Color library rationale:** `picocolors` is 14x smaller than chalk, has no transitive dependencies, works in both CJS and ESM contexts, and provides the same API (`pc.green(str)`, `pc.bold(str)`). For a simple two-color output (path in cyan, score in yellow), picocolors is the correct choice.

**Prompt library rationale:** `@inquirer/prompts` is the official successor to the `inquirer` package, maintained by the same author. It's ESM-native and works cleanly with tsup CJS output via interop. Used only for `mem config init` interactive wizard.

**Installation:**
```bash
npm install @modelcontextprotocol/sdk picocolors @inquirer/prompts
# commander must move from devDependencies to dependencies:
npm install commander
```

**Version verification required before writing tasks:**
```bash
npm view @modelcontextprotocol/sdk version
npm view picocolors version
npm view @inquirer/prompts version
npm view commander version
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── mcp/
│   ├── server.ts          # McpServer setup, tool registration, warm-up, start()
│   ├── tools/
│   │   ├── search-memory.ts   # search_memory handler
│   │   └── get-context.ts     # get_context handler
│   └── index.ts           # Entry point: loadConfig + start server
├── cli/
│   ├── index.ts           # Register all commands including search + config
│   ├── commands/
│   │   ├── search-cmd.ts  # registerSearchCommand(program)
│   │   ├── config-cmd.ts  # registerConfigCommand(program)
│   │   ├── index-cmd.ts   # (existing)
│   │   └── status-cmd.ts  # (existing)
│   └── first-run.ts       # Auto-detect vault, write initial config.json
```

### Pattern 1: MCP Server with Eager Warm-up

```typescript
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export async function startMcpServer(config: Config) {
  // Eager warm-up — must happen BEFORE connecting transport
  const connection = await connectLanceDb(config.indexPath);
  const table = await openChunksTable(connection);
  const db = openMetadataDb(config.indexPath);
  const embedder = createEmbeddingProvider(config);

  // Dummy embed to warm HNSW index into RAM
  try {
    await embedder.embed(['warmup']);
    await table.search((await embedder.embed(['warmup']))[0] as IntoVector).limit(1).toArray();
  } catch { /* warm-up failure is non-fatal */ }

  const server = new McpServer({
    name: 'claude-code-memory',
    version: '0.1.0',
  });

  server.tool('search_memory', {
    query: z.string(),
    limit: z.number().optional(),
    mode: z.enum(['vector', 'fts', 'hybrid']).optional(),
    afterDate: z.string().optional(),
    beforeDate: z.string().optional(),
    sourceGlob: z.string().optional(),
  }, async (args) => {
    const results = await search(args.query, table, embedder, {
      topK: args.limit,
      mode: args.mode,
      afterDate: args.afterDate ? new Date(args.afterDate) : undefined,
      beforeDate: args.beforeDate ? new Date(args.beforeDate) : undefined,
      sourceGlob: args.sourceGlob,
    });
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

**Key:** Warm-up (connectLanceDb + embed + search) happens synchronously before `server.connect(transport)`. The MCP client connection is not accepted until the index is loaded into RAM. This avoids the 60s cold-start timeout for the first real query.

**NEVER use `console.log` in any MCP server file.** Use `logger.error()` (stderr) exclusively. The MCP SDK writes JSON-RPC to stdout — any stray stdout write corrupts the protocol stream.

### Pattern 2: MCP Server Entry Point (separate tsup entry)

```typescript
// src/mcp/index.ts — standalone binary entry point
import { loadConfig } from '../config.js';
import { startMcpServer } from './server.js';
import { logger } from '../logger.js';

const config = loadConfig();
startMcpServer(config).catch((err) => {
  logger.error('MCP server failed to start', err);
  process.exit(1);
});
```

tsup entry addition:
```typescript
// tsup.config.ts
entry: ['src/index.ts', 'src/cli/index.ts', 'src/mcp/index.ts'],
```

package.json bin addition:
```json
"bin": {
  "mem": "./dist/cli/index.cjs",
  "mem-mcp": "./dist/mcp/index.cjs"
}
```

Claude Code `~/.claude.json` config:
```json
{
  "mcpServers": {
    "memory": {
      "command": "mem-mcp",
      "args": []
    }
  }
}
```

### Pattern 3: `get_context` Neighbor Finding

The `get_context` tool takes a chunk ID and returns the chunk plus its positional neighbors in the same source file. The cleanest approach uses SQLite metadata (which stores `source_path` and `indexed_at`) alongside LanceDB chunk IDs.

**Recommended approach:** Store chunk position (integer row index within a file's chunks, zero-based) in SQLite at index time. Then `get_context` queries SQLite for `(source_path, position-1)` and `(source_path, position+1)`. This is O(1) lookups.

**Alternative if position isn't already in SQLite:** Query LanceDB for all chunks with matching `source_path`, sort by `heading_path` lexicographically, find the target chunk by ID, return prev/next. This works but requires fetching all chunks for the file.

**Decision for planner:** Check if SQLite already stores chunk position. If not, recommend the heading-path adjacency approach (sort all chunks for the source file by `heading_path`, return neighbors by index in that sorted list).

### Pattern 4: CLI Search Command

```typescript
// src/cli/commands/search-cmd.ts
import pc from 'picocolors';

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('Search indexed vault memories')
    .option('-n, --limit <n>', 'Number of results', '5')
    .option('--mode <mode>', 'Search mode: vector, fts, hybrid', 'hybrid')
    .option('--full', 'Show full chunk text instead of snippet')
    .option('--json', 'Output as JSON')
    .option('--no-color', 'Disable colored output')
    .action(async (query, options) => {
      // ... loadConfig, search(), format results
      const useColor = process.stdout.isTTY && !process.env.NO_COLOR && options.color !== false;
      for (const result of results) {
        const snippet = options.full ? result.text : result.text.slice(0, 150) + '…';
        if (options.json) { /* accumulate */ continue; }
        console.log(useColor ? pc.cyan(result.sourcePath) : result.sourcePath);
        console.log(`  ${result.headingPath}`);
        console.log(`  score: ${result.score.toFixed(3)}`);
        console.log(`  ${snippet}`);
        console.log('');
      }
    });
}
```

### Pattern 5: Config Command

```typescript
// src/cli/commands/config-cmd.ts
export function registerConfigCommand(program: Command): void {
  const configCmd = program.command('config').description('View or set configuration');

  configCmd
    .command('set <key> <value>')
    .action((key, value) => { /* read config.json, set key, write back */ });

  configCmd
    .action(() => { /* show all config values */ });

  configCmd
    .command('init')
    .action(async () => { /* @inquirer/prompts wizard */ });
}
```

### Pattern 6: First-Run Auto-Detect

```typescript
// src/cli/first-run.ts
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const ICLOUD_OBSIDIAN = join(
  homedir(),
  'Library/Mobile Documents/iCloud~md~obsidian/Documents'
);
const CONFIG_DIR = join(homedir(), '.claude-code-memory');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function runFirstTimeSetup(): boolean {
  if (existsSync(CONFIG_PATH)) return false; // already configured
  if (existsSync(ICLOUD_OBSIDIAN)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const config = { vaultPath: ICLOUD_OBSIDIAN };
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`Auto-detected Obsidian vault at ${ICLOUD_OBSIDIAN}`);
    console.log(`Created config at ${CONFIG_PATH}`);
    return true;
  }
  return false; // needs manual init
}
```

Call `runFirstTimeSetup()` at the top of `mem index`, `mem search`, and `mem status` before `loadConfig()`. If it returns false and config is still missing, print a helpful message directing to `mem config init`.

### Anti-Patterns to Avoid

- **`console.log` in any file imported by the MCP server** — use `logger.error()` (stderr) only
- **Synchronous warm-up after transport connect** — warm-up must complete BEFORE `server.connect(transport)` to avoid cold-start timeout
- **Moving `commander` to remain in devDependencies** — global npm install won't have devDeps; commander must be in `dependencies`
- **Re-creating DB connections per tool call** — connections are expensive; hold them open at server level, pass to handlers

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP protocol | Custom JSON-RPC over stdio | `@modelcontextprotocol/sdk` | Handles reconnect, transport framing, tool schema validation |
| Terminal colors | `process.stdout.write('\x1b[36m...')` | `picocolors` | Cross-platform, TTY detection, NO_COLOR support |
| CLI prompts for config init | Custom readline loop | `@inquirer/prompts` | Validation, arrow keys, defaults, cancellation |
| Search logic | Any new code | `search()` from `src/core/searcher.ts` | Already tested, handles vector/FTS/hybrid |
| DB connections | New connection logic | Existing `connectLanceDb()`, `openMetadataDb()` | Already handle iCloud path safety assertions |

---

## Common Pitfalls

### Pitfall 1: stdio Corruption (console.log in MCP code)
**What goes wrong:** Any `console.log()` in files imported by the MCP server writes to stdout, corrupting the JSON-RPC stream. Claude Code disconnects with "server disconnected without any error."
**How to avoid:** Use `logger.error()` (stderr) exclusively. Search the entire `src/mcp/` directory for `console.log` before each commit.
**Warning signs:** MCP tool disappears from Claude Code intermittently; generic disconnect errors.

### Pitfall 2: Cold-Start Timeout (MCP SDK 60s limit)
**What goes wrong:** First query after server start triggers HNSW index load (5–30s for 10K+ chunks). MCP client times out.
**How to avoid:** Warm-up (connectLanceDb + embed + search dummy vector) BEFORE `server.connect(transport)`. Server doesn't accept connections until warm-up completes.
**Warning signs:** First tool call always fails; subsequent calls succeed; latency drops sharply after first call.

### Pitfall 3: commander in devDependencies
**What goes wrong:** `npm install -g claude-code-memory` succeeds, but running `mem` throws "Cannot find module 'commander'".
**How to avoid:** Move `commander` from `devDependencies` to `dependencies` in package.json.

### Pitfall 4: SQLite + LanceDB Concurrent Access
**What goes wrong:** `mem search` (CLI) and MCP server both open better-sqlite3 connections simultaneously. Writes from one throw `SQLITE_BUSY`.
**How to avoid:** WAL mode is already on. Add `PRAGMA busy_timeout = 5000` in `openMetadataDb()`. CLI is read-only for search; MCP server is also read-only for search — only indexer writes. This is safe as long as `mem index` is not running simultaneously.

### Pitfall 5: Missing MCP Server tsup Entry
**What goes wrong:** `src/mcp/index.ts` exists in source but is not bundled because it's not in `tsup.config.ts` entry array. `dist/mcp/index.cjs` is never created.
**How to avoid:** Add `'src/mcp/index.ts'` to `tsup.config.ts` entry array as part of the Wave 0 setup task.

---

## Code Examples

### MCP Tool Registration (SDK v1.x)
```typescript
// Source: @modelcontextprotocol/sdk README + STACK.md verified version ^1.29.0
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'claude-code-memory', version: '0.1.0' });

server.tool('search_memory', {
  query: z.string().describe('Natural language search query'),
  limit: z.number().optional().default(5).describe('Max results to return'),
}, async ({ query, limit }) => {
  const results = await search(query, table, embedder, { topK: limit });
  return {
    content: [{ type: 'text', text: JSON.stringify(results) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### TTY Color Detection
```typescript
// picocolors handles NO_COLOR and --no-color; manual TTY check for piped output
import pc from 'picocolors';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const line = useColor ? pc.cyan(result.sourcePath) : result.sourcePath;
```

### Config File Write (for `mem config set`)
```typescript
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

function setConfigValue(key: string, value: string): void {
  const dir = join(homedir(), '.claude-code-memory');
  const path = join(dir, 'config.json');
  mkdirSync(dir, { recursive: true });
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
  existing[key] = parseConfigValue(key, value);
  writeFileSync(path, JSON.stringify(existing, null, 2));
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| MCP SSE transport | stdio transport for local tools | stdio is correct for local CLI MCP servers; SSE/HTTP for remote |
| `inquirer` v8 (CommonJS) | `@inquirer/prompts` v7 (ESM) | Modern prompts, no CJS/ESM interop issues |
| `chalk` for terminal colors | `picocolors` | 14x smaller, no dependencies, same API |
| SDK v2 (pre-alpha on main branch) | SDK v1.29.x (stable) | Stay on v1; v2 has breaking changes in progress |

---

## Open Questions

1. **Does SQLite currently store chunk position?**
   - What we know: `openMetadataDb` stores file-level metadata (path, hash, indexed_at, chunk_count) in `files` table
   - What's unclear: Whether individual chunk rows are stored in SQLite with a position index, or only in LanceDB
   - Recommendation: Check `src/core/db/sqlite.ts` schema. If no chunk position in SQLite, use LanceDB `source_path` filter + heading_path sort for `get_context` neighbors.

2. **Warm-up on empty index**
   - What we know: New installs have no index yet
   - What's unclear: Whether `openChunksTable` throws or returns an empty table on first run
   - Recommendation: Wrap warm-up in try/catch; empty table is valid state, just skip the dummy search.

3. **MCP server invocation: `mem-mcp` binary vs `mem mcp` subcommand**
   - What we know: CONTEXT.md mentions `src/mcp/` as a new directory; package.json bin can have multiple entries
   - Recommendation: Separate binary `mem-mcp` is cleaner for MCP server config (no CLI parsing overhead at startup); CONTEXT.md mentions `mem mcp` as an option but a dedicated binary is simpler. Planner should choose `mem-mcp` as the default recommendation.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest v4.1.2 |
| Config file | vitest.config.ts (if exists) or package.json `"test"` script |
| Quick run command | `npm test -- --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | search_memory returns structured results | unit | `npm test -- src/mcp/tools/search-memory.test.ts` | Wave 0 |
| MCP-02 | get_context returns chunk + neighbors | unit | `npm test -- src/mcp/tools/get-context.test.ts` | Wave 0 |
| MCP-03 | No stdout written during MCP operation | unit | `npm test -- src/mcp/server.test.ts` | Wave 0 |
| MCP-04 | Warm-up completes before first tool call | unit | `npm test -- src/mcp/server.test.ts` | Wave 0 |
| CLI-01 | mem search prints results with source/heading/score | unit | `npm test -- src/cli/commands/search-cmd.test.ts` | Wave 0 |
| CLI-04 | mem config show/set/init | unit | `npm test -- src/cli/commands/config-cmd.test.ts` | Wave 0 |
| CLI-05 | First-run auto-detect creates config | unit | `npm test -- src/cli/first-run.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- src/mcp/ src/cli/commands/search-cmd.test.ts src/cli/commands/config-cmd.test.ts src/cli/first-run.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/mcp/tools/search-memory.test.ts` — covers MCP-01
- [ ] `src/mcp/tools/get-context.test.ts` — covers MCP-02
- [ ] `src/mcp/server.test.ts` — covers MCP-03, MCP-04
- [ ] `src/cli/commands/search-cmd.test.ts` — covers CLI-01
- [ ] `src/cli/commands/config-cmd.test.ts` — covers CLI-04
- [ ] `src/cli/first-run.test.ts` — covers CLI-05
- [ ] Install dependencies: `npm install @modelcontextprotocol/sdk picocolors @inquirer/prompts && npm install commander` (move commander to deps)

---

## Sources

### Primary (HIGH confidence)
- `src/core/searcher.ts` — confirmed search() signature and return type
- `src/types.ts` — confirmed SearchResult, SearchOptions, Config interfaces
- `src/config.ts` — confirmed loadConfig() contract and config file location
- `src/cli/commands/index-cmd.ts` — confirmed registerXCommand pattern
- `package.json` — confirmed bin entry, tsup entry points, installed deps
- `.planning/research/STACK.md` — @modelcontextprotocol/sdk v1.29.0, commander v14
- `.planning/research/PITFALLS.md` — Pitfalls 7, 8, 15 directly apply to this phase

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` — src/mcp/ directory structure and component boundaries
- CONTEXT.md decisions — all locked decisions verified as technically implementable against existing code

### Tertiary (LOW confidence)
- picocolors and @inquirer/prompts version recommendations — based on training knowledge, verify with `npm view` before pinning

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — core libraries confirmed in existing package.json; MCP SDK version from STACK.md; only color/prompt libs need version verification
- Architecture: HIGH — existing patterns (registerXCommand, loadConfig, connectLanceDb) are confirmed in source; MCP SDK patterns follow official README
- Pitfalls: HIGH — Pitfalls 7, 8, 15 are documented in PITFALLS.md with source citations; commander-in-devDeps is a classic packaging mistake

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (stable domain; MCP SDK v1.x is stable; only risk is SDK v2 going stable sooner than expected)
