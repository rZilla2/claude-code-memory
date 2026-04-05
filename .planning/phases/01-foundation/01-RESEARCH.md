# Phase 1: Foundation - Research

**Researched:** 2026-04-05
**Domain:** TypeScript project scaffolding, LanceDB initialization, SQLite schema, pluggable embedding interface, path safety enforcement
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Config format:** JSON at `~/.claude-code-memory/config.json` with vault-level override `.claude-code-memory.json` in vault root
- **Config loading order:** defaults → file → env vars (env vars highest priority)
- **Config required fields:** `vaultPath`, `indexPath` (default `~/.claude-code-memory/`), `embeddingProvider` (default `openai`)
- **Index storage layout:** `~/.claude-code-memory/lancedb/`, `~/.claude-code-memory/metadata.db`, `~/.claude-code-memory/config.json`
- **Startup check:** if `indexPath` resolves to a path containing `Mobile Documents`, abort with clear error before writing any data
- **Embedding interface:** `EmbeddingProvider` with `embed(texts: string[]): Promise<number[][]>` and `modelId(): string`
- **Factory function:** `createEmbeddingProvider(config): EmbeddingProvider`
- **Batch size:** 100 texts per API call
- **Concurrency:** `p-limit` with default of 2 concurrent batches
- **`modelId()` format:** stable string e.g. `openai:text-embedding-3-small`, stored in SQLite for mismatch detection
- **Model mismatch behavior:** log warning + halt before any write, prompt user to run full reindex
- **Build:** `tsup` (CJS + ESM dual output)
- **Test:** `vitest`
- **Dev runner:** `tsx`
- **CLI framework:** `commander`
- **Linting:** `eslint` with flat config + `prettier`

### Claude's Discretion

- Exact TypeScript project structure within `src/` (suggested: `src/core/`, `src/mcp/`, `src/cli/`, `src/watcher/`)
- Error message wording
- Logger implementation details (as long as it uses stderr)
- SQLite schema column naming conventions
- Test file organization

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | System stores vector index at `~/.claude-code-memory/` (outside iCloud) to prevent sync corruption | PITFALLS.md Pitfall 1 (iCloud corruption); startup path assertion pattern documented |
| FOUND-02 | Configuration file defines vault path, embedding provider, index location, and chunking params | Config loading pattern (defaults → file → env); vault-level override pattern |
| FOUND-03 | Schema versioning tracks embedding model fingerprint to detect model mismatch | SQLite schema includes `embedding_model_id` + `schema_version`; mismatch detection on startup |
| FOUND-04 | All logging uses stderr (never stdout) to prevent MCP JSON-RPC stream corruption | PITFALLS.md Pitfall 7; enforced via pino or console.error; no console.log anywhere |
| EMB-01 | Pluggable embedding interface: `embed(texts: string[]): Promise<number[][]>` | ARCHITECTURE.md embedder abstraction; factory pattern confirmed |
| EMB-02 | OpenAI text-embedding-3-small adapter ships as default | STACK.md embeddings; openai@6.33.0 confirmed |
| EMB-04 | Switching embedding provider triggers full reindex warning (model fingerprint mismatch) | PITFALLS.md Pitfall 4; `modelId()` + SQLite fingerprint check on every init |
</phase_requirements>

---

## Summary

Phase 1 establishes the non-negotiable foundation: project scaffolding, config loading, database clients, and the embedding provider abstraction. Every subsequent phase imports from this layer. Getting it wrong here means retrofitting later — especially schema versioning and the path safety check, which cannot be added incrementally without data migration.

The research phase (STACK.md, ARCHITECTURE.md, PITFALLS.md) covered all relevant technical domains. No further investigation is needed — the locked decisions are well-supported by the research findings and all package versions have been verified against the live npm registry.

The two highest-risk items for Phase 1 are (1) the iCloud path assertion — must abort cleanly if `indexPath` is inside `Mobile Documents` — and (2) the `embedding_model_id` fingerprint stored in SQLite from the very first write. Both are baked-in requirements; if either is skipped, later phases will require schema migration.

**Primary recommendation:** Follow the build order `config → logger → db clients → embedder interface → OpenAI adapter`, with tests verifying each layer before moving to the next.

---

## Standard Stack

### Core (Phase 1 only)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@lancedb/lancedb` | `^0.27.2` | Vector DB client — open table, create schema | Only embedded vector DB with native TS bindings; correct package name (not `vectordb`) |
| `better-sqlite3` | `^12.8.0` | Metadata store — schema init, model fingerprint | Synchronous API fits sequential init; version 12.8.0 confirmed on npm |
| `openai` | `^6.33.0` | OpenAI embedding adapter | Official TS client; version 6.33.0 confirmed |
| `p-limit` | `^7.3.0` | Batch concurrency control | Lightweight, ESM-native; controls concurrent embedding API calls |
| `zod` | `^3.25.x` | Config schema validation | Required peer of MCP SDK; validates config at load time |

### Tooling (all devDependencies)

| Library | Version | Purpose |
|---------|---------|---------|
| `typescript` | `^6.0.2` | Language |
| `tsup` | `^8.5.1` | Build — CJS + ESM dual output |
| `vitest` | `^4.1.2` | Test runner |
| `tsx` | `^4.21.0` | Dev-time TS execution |
| `commander` | `^14.0.3` | CLI framework (wired up in Phase 4; scaffold in Phase 1) |
| `eslint` | `^10.2.0` | Linting (flat config) |
| `prettier` | `^3.8.1` | Formatting |
| `@types/better-sqlite3` | `^7.x` | SQLite types |
| `@types/node` | `^22.x` | Node.js types |

### Installation

```bash
# Runtime
npm install @lancedb/lancedb better-sqlite3 openai p-limit zod

# Dev tooling
npm install -D typescript tsup vitest tsx commander eslint prettier \
  @types/better-sqlite3 @types/node
```

**Version verification (confirmed 2026-04-05 against npm registry):**
- `@lancedb/lancedb@0.27.2` — published Feb 2026
- `better-sqlite3@12.8.0` — latest on npm 2026-04-05
- `openai@6.33.0` — latest official TS client
- `p-limit@7.3.0` — ESM-native, current
- `vitest@4.1.2` — current
- `tsup@8.5.1` — current
- `tsx@4.21.0` — current
- `typescript@6.0.2` — current
- `commander@14.0.3` — current

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── config.ts              # Config loading + validation (zod schema)
├── logger.ts              # Stderr-only logger
├── types.ts               # Shared domain types (Chunk, SearchResult, Config, etc.)
├── core/
│   ├── db/
│   │   ├── lance.ts       # LanceDB client — connect, schema, table init
│   │   └── sqlite.ts      # better-sqlite3 init — schema, model fingerprint
│   └── embedder/
│       ├── types.ts       # EmbeddingProvider interface
│       ├── factory.ts     # createEmbeddingProvider()
│       └── openai.ts      # OpenAI adapter
├── mcp/                   # Placeholder dir (Phase 4)
├── cli/                   # Placeholder dir (Phase 4)
└── watcher/               # Placeholder dir (Phase 5)
```

### Pattern 1: Config Loading

**What:** Load defaults, merge file config, merge env vars. Validate with zod. Expand `~` in paths.
**When to use:** On every process startup before any DB connection is opened.

```typescript
// src/config.ts
import { z } from 'zod';
import { homedir } from 'os';
import { join } from 'path';

const ConfigSchema = z.object({
  vaultPath: z.string(),
  indexPath: z.string().default(join(homedir(), '.claude-code-memory')),
  embeddingProvider: z.enum(['openai', 'ollama']).default('openai'),
  openaiModel: z.string().default('text-embedding-3-small'),
  batchSize: z.number().default(100),
  concurrency: z.number().default(2),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(overrides?: Partial<Config>): Config {
  // 1. defaults (from zod schema)
  // 2. merge ~/.claude-code-memory/config.json if exists
  // 3. merge vault-level .claude-code-memory.json if exists
  // 4. merge env vars (OPENAI_API_KEY etc.)
  // 5. merge overrides
  // 6. assertPathSafety(result.indexPath)
}
```

### Pattern 2: iCloud Path Assertion

**What:** Before opening any DB connection, check that `indexPath` does not resolve inside `~/Library/Mobile Documents/`. Abort with a clear error if it does.
**When to use:** Called from `loadConfig()` as the last step before returning.

```typescript
// src/config.ts
export function assertPathSafety(indexPath: string): void {
  const resolved = path.resolve(indexPath);
  if (resolved.includes('Mobile Documents')) {
    throw new Error(
      `Index path "${resolved}" is inside iCloud sync. ` +
      `This causes data corruption. Set indexPath to a location ` +
      `outside ~/Library/Mobile Documents/ (e.g., ~/.claude-code-memory/).`
    );
  }
}
```

### Pattern 3: Stderr-Only Logger

**What:** A thin wrapper that always writes to `process.stderr`. Never uses `console.log`.
**When to use:** Import this instead of `console` everywhere.

```typescript
// src/logger.ts
export const logger = {
  info:  (msg: string, ...args: unknown[]) => process.stderr.write(`[INFO] ${msg}\n`),
  warn:  (msg: string, ...args: unknown[]) => process.stderr.write(`[WARN] ${msg}\n`),
  error: (msg: string, ...args: unknown[]) => process.stderr.write(`[ERROR] ${msg}\n`),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG) process.stderr.write(`[DEBUG] ${msg}\n`);
  },
};
```

Alternative: `pino` with `destination: 2` (fd 2 = stderr). Either works; inline logger avoids an extra dependency.

### Pattern 4: SQLite Schema with Model Fingerprint

**What:** Initialize metadata.db with files table + index_metadata table. The `index_metadata` table holds the stored `embedding_model_id` and `schema_version` for mismatch detection.
**When to use:** On first DB open; use `CREATE TABLE IF NOT EXISTS` for idempotency.

```sql
-- Schema version and model fingerprint
CREATE TABLE IF NOT EXISTS index_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Per-file tracking
CREATE TABLE IF NOT EXISTS files (
  path           TEXT PRIMARY KEY,
  content_hash   TEXT NOT NULL,
  indexed_at     INTEGER NOT NULL,  -- unix ms
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  staleness_score REAL DEFAULT 0.0
);
```

On every startup after init, read `embedding_model_id` from `index_metadata`. If it differs from the configured provider's `modelId()`, log a warning and halt before any write. Prompt the user to run `mem reindex --all`.

### Pattern 5: Embedding Provider Interface + OpenAI Adapter

**What:** Interface with `embed()` and `modelId()`. Factory creates the correct adapter from config.
**When to use:** All embedding calls go through this interface — no direct OpenAI import outside `src/core/embedder/`.

```typescript
// src/core/embedder/types.ts
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  modelId(): string;
}

// src/core/embedder/openai.ts
import OpenAI from 'openai';
import pLimit from 'p-limit';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  private limit = pLimit(2); // concurrency from config

  constructor(apiKey: string, model = 'text-embedding-3-small', concurrency = 2) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.limit = pLimit(concurrency);
  }

  modelId(): string {
    return `openai:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Chunk into batches of 100, respect concurrency via p-limit
    const batches = chunk(texts, 100);
    const results = await Promise.all(
      batches.map(batch =>
        this.limit(() =>
          this.client.embeddings.create({ model: this.model, input: batch })
            .then(res => res.data.map(d => d.embedding))
        )
      )
    );
    return results.flat();
  }
}
```

### Pattern 6: LanceDB Table Init with Schema Version

**What:** Open (or create) the LanceDB table with the correct schema. Store `embedding_model_id` in the schema and in SQLite.
**When to use:** First action after DB clients are ready.

```typescript
// src/core/db/lance.ts
import { connect } from '@lancedb/lancedb';

export async function openChunksTable(dbPath: string) {
  const db = await connect(dbPath);
  // createTable with schema if not exists; otherwise openTable
  // Vector dimension is provider-specific — OpenAI 3-small = 1536
}
```

**Critical:** Never call `connect()` with a path inside `~/Library/Mobile Documents/`. The path assertion must run before this function is ever called.

### Anti-Patterns to Avoid

- **Storing index inside iCloud:** Write `~/.claude-code-memory/` path — never `~/Library/Mobile Documents/...`
- **`console.log` anywhere:** Always use `logger.info()` or `process.stderr.write()` — stdout corrupts MCP JSON-RPC
- **Skipping schema versioning on first write:** Adding `embedding_model_id` later requires migration; do it in the initial schema
- **String concatenation for iCloud paths:** Use `path.join()` and `path.resolve()` — the space in `Mobile Documents` breaks shell interpolation
- **Mixing concerns in config loading:** Keep path expansion, validation, and safety check inside `loadConfig()` — callers get a validated Config or an error

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config schema validation | Custom type-narrowing functions | `zod` | Already a dep; handles defaults, transforms, error messages |
| Embedding batching | Custom batch splitter | `chunk()` utility + `p-limit` | p-limit handles concurrency; array chunking is 5 lines |
| Logger with levels | Full logging framework | Inline `process.stderr.write` wrapper or `pino` | Avoid adding `winston`/`bunyan` — they add stdout risk and deps |
| Path safety | OS-specific regex | `path.resolve()` + `String.includes()` | Resolve first to normalize `~` and symlinks |

**Key insight:** Phase 1 infrastructure should be minimal — no framework magic. The simpler each primitive, the easier later phases can test against it.

---

## Common Pitfalls

### Pitfall 1: iCloud Path Corruption
**What goes wrong:** LanceDB stored inside `~/Library/Mobile Documents/` gets corrupted by iCloud sync (partial fragment sync during write operations).
**Why it happens:** Convenience — co-locating index with vault.
**How to avoid:** `assertPathSafety()` called in `loadConfig()` before any DB connection. Test with the literal path string `Mobile Documents`.
**Warning signs:** `TABLE_NOT_FOUND` or Lance compaction errors on a fresh index.

### Pitfall 2: stdout Leaks via console.log
**What goes wrong:** Any `console.log()` in Phase 1 code writes to stdout. When the MCP server (Phase 4) starts, stray log lines corrupt the JSON-RPC stream and silently disconnect the tool.
**Why it happens:** Default debugging habit.
**How to avoid:** Create `logger.ts` in Phase 1; establish the rule before a single log statement is written. Add ESLint rule `no-console` for non-test files.
**Warning signs:** MCP tool disappears from Claude Code; no obvious error.

### Pitfall 3: Embedding Model Drift
**What goes wrong:** Index built with `text-embedding-3-small`. Config changed to a future model. Mixed vector spaces cause silently wrong retrieval.
**Why it happens:** No runtime enforcement — LanceDB accepts any float array.
**How to avoid:** `index_metadata` table stores `embedding_model_id` on first write. Every startup reads and asserts match before opening any table for writes.
**Warning signs:** Retrieval quality drops after config change; cosine similarity scores erratic.

### Pitfall 4: iCloud Path Spaces in Node.js
**What goes wrong:** `path.join(vaultPath, 'subdir')` works; `exec(\`ls ${vaultPath}\`)` breaks due to space in `Mobile Documents`.
**Why it happens:** Tests use `~/Documents/test-vault`; production uses iCloud path with space.
**How to avoid:** Never use `child_process.exec` with vault paths. Always use `fs` APIs and `path.join()`.
**Warning signs:** ENOENT errors only on real vault; local tests pass.

### Pitfall 5: Missing schema_version on Greenfield
**What goes wrong:** Schema evolves in Phase 2–6. Without a version number from day 1, detecting old index formats requires heuristics.
**Why it happens:** "We'll add it later."
**How to avoid:** `index_metadata` table includes `schema_version = '1'` in the Phase 1 init. Increment when schema changes.

---

## Code Examples

### tsup config (dual CJS + ESM output)
```typescript
// tsup.config.ts
// Source: tsup documentation
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  clean: true,
});
```

### vitest config (ESM-compatible)
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

### package.json essentials for dual-output npm package
```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "require": "./dist/index.cjs",
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "bin": {
    "mem": "./dist/cli/index.cjs"
  },
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src"
  }
}
```

### SQLite init (better-sqlite3, synchronous)
```typescript
// src/core/db/sqlite.ts
import Database from 'better-sqlite3';
import { join } from 'path';

export function openMetadataDb(indexPath: string): Database.Database {
  const db = new Database(join(indexPath, 'metadata.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      path            TEXT PRIMARY KEY,
      content_hash    TEXT NOT NULL,
      indexed_at      INTEGER NOT NULL,
      chunk_count     INTEGER NOT NULL DEFAULT 0,
      staleness_score REAL DEFAULT 0.0
    );
  `);
  return db;
}

export function assertModelMatch(db: Database.Database, providerModelId: string): void {
  const row = db.prepare('SELECT value FROM index_metadata WHERE key = ?')
    .get('embedding_model_id') as { value: string } | undefined;

  if (!row) {
    // First write — store the model ID
    db.prepare('INSERT INTO index_metadata (key, value) VALUES (?, ?)')
      .run('embedding_model_id', providerModelId);
    db.prepare('INSERT OR IGNORE INTO index_metadata (key, value) VALUES (?, ?)')
      .run('schema_version', '1');
    return;
  }

  if (row.value !== providerModelId) {
    throw new Error(
      `Embedding model mismatch: index was built with "${row.value}" ` +
      `but current config uses "${providerModelId}". ` +
      `Run "mem reindex --all" to rebuild the index with the new model.`
    );
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vectordb` npm package | `@lancedb/lancedb` | 2024 | Old package is deprecated; same API, new name |
| LanceDB v0.4.x JS bindings | v0.27.x with TS rewrite | 2025 | Significantly improved TS types; Arrow schema API updated |
| MCP SDK v1.x SSE transport | stdio transport for local servers | Mar 2025 MCP spec | Streamable HTTP replaces SSE; stdio remains correct for local CLI tools |
| `tsconfig.json` `"module": "commonjs"` | dual CJS+ESM via tsup | 2024+ | Consumers can use either format; `exports` map required |

---

## Open Questions

1. **Node.js native bindings for `better-sqlite3` and `@lancedb/lancedb`**
   - What we know: Both packages ship prebuilt binaries for macOS arm64; `npm install` fetches them automatically.
   - What's unclear: Whether the versions pinned here have arm64 binaries for the exact Node.js version in the project's `.nvmrc` (if any).
   - Recommendation: Add a `postinstall` script or README note; verify `node --version` >= 18 at startup.

2. **ESLint flat config vs legacy config**
   - What we know: ESLint v10 uses flat config by default; `eslint.config.js` (not `.eslintrc`).
   - What's unclear: Whether the team is familiar with flat config syntax.
   - Recommendation: Use flat config since we're starting greenfield; include `no-console` rule for `src/**` (excluding `*.test.*`).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | `vitest.config.ts` — Wave 0 creates this |
| Quick run command | `vitest run` |
| Full suite command | `vitest run --coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | `assertPathSafety()` throws on iCloud path | unit | `vitest run src/config.test.ts` | Wave 0 |
| FOUND-01 | `assertPathSafety()` passes on `~/.claude-code-memory/` | unit | `vitest run src/config.test.ts` | Wave 0 |
| FOUND-02 | Config loads defaults when no file exists | unit | `vitest run src/config.test.ts` | Wave 0 |
| FOUND-02 | Config merges file values over defaults | unit | `vitest run src/config.test.ts` | Wave 0 |
| FOUND-02 | Config merges env vars over file values | unit | `vitest run src/config.test.ts` | Wave 0 |
| FOUND-03 | First DB open stores `embedding_model_id` in SQLite | unit | `vitest run src/core/db/sqlite.test.ts` | Wave 0 |
| FOUND-03 | Matching model ID on subsequent open passes silently | unit | `vitest run src/core/db/sqlite.test.ts` | Wave 0 |
| FOUND-03 | Mismatched model ID throws with clear message | unit | `vitest run src/core/db/sqlite.test.ts` | Wave 0 |
| FOUND-04 | No `console.log` calls exist in `src/` (ESLint) | lint | `eslint src` | Wave 0 |
| EMB-01 | OpenAI adapter satisfies `EmbeddingProvider` interface | unit | `vitest run src/core/embedder/openai.test.ts` | Wave 0 |
| EMB-02 | `embed(['hello'])` returns `number[][]` with 1536-dim vectors | integration | `vitest run src/core/embedder/openai.test.ts` (mocked) | Wave 0 |
| EMB-04 | Factory passes matching modelId to `assertModelMatch()` | unit | `vitest run src/core/embedder/factory.test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `vitest run`
- **Per wave merge:** `vitest run --coverage`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` — vitest configuration file
- [ ] `tsconfig.json` — TypeScript project config
- [ ] `tsup.config.ts` — build config
- [ ] `eslint.config.js` — flat config with `no-console` rule for `src/**`
- [ ] `src/config.test.ts` — covers FOUND-01, FOUND-02
- [ ] `src/core/db/sqlite.test.ts` — covers FOUND-03
- [ ] `src/core/embedder/openai.test.ts` — covers EMB-01, EMB-02 (mocked OpenAI client)
- [ ] `src/core/embedder/factory.test.ts` — covers EMB-04
- [ ] Framework install: `npm install -D vitest @vitest/coverage-v8` — not yet in package.json

---

## Sources

### Primary (HIGH confidence)
- npm registry — `@lancedb/lancedb@0.27.2`, `better-sqlite3@12.8.0`, `openai@6.33.0`, `vitest@4.1.2`, `tsup@8.5.1`, `tsx@4.21.0`, `p-limit@7.3.0`, `typescript@6.0.2`, `commander@14.0.3` — all confirmed 2026-04-05
- `.planning/research/STACK.md` — full stack rationale with sources
- `.planning/research/ARCHITECTURE.md` — component boundaries and data flow
- `.planning/research/PITFALLS.md` — critical pitfalls 1, 4, 7, 9 directly relevant to Phase 1

### Secondary (MEDIUM confidence)
- better-sqlite3 WAL + busy_timeout pattern — standard SQLite concurrency pattern, widely documented
- tsup dual-output config — official tsup docs
- p-limit concurrency pattern — official p-limit README

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions confirmed against npm registry 2026-04-05
- Architecture: HIGH — patterns from ARCHITECTURE.md, confirmed via official sources
- Pitfalls: HIGH — from PITFALLS.md, cross-referenced with official LanceDB and MCP SDK docs

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable stack; re-verify if `@lancedb/lancedb` ships breaking changes in v0.28+)
