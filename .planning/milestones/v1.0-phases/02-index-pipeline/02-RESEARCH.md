# Phase 2: Index Pipeline - Research

**Researched:** 2026-04-05
**Domain:** Markdown vault scanning, AST-based chunking, incremental embedding, CLI commands
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Chunking strategy**
- Split at H1/H2/H3 headings using remark AST parser. H4+ stays inside parent H3 chunk.
- Files with no headings: treat whole file as one chunk if under ~500 tokens; split at paragraph breaks (double newline) if over ~500 tokens.
- Default max chunk size: ~500 tokens (configurable via config param). Sweet spot for text-embedding-3-small.
- Prepend heading breadcrumb to chunk text before embedding (e.g., "Projects > Claude Lab > Memory System: actual content"). Critical for Rod's vault where the same words mean different things in different hubs.

**Hashing & change detection**
- Two-tier detection: file-level content hash as fast gate (skip unchanged files entirely), then chunk-level hash for changed files (only re-embed modified chunks).
- Heading rename triggers re-embed — breadcrumb is part of embedded text, so chunk hash changes, vector must update.
- Chunk IDs: `{file_path}::{heading_path}` with collision suffix (`-2`, `-3`) for duplicate headings in same file. Stable across reordering, easy to query "all chunks from file X".

**Progress & error reporting**
- Default: single-line progress bar with count (`[████████░░] 847/1247 files (67 changed)`).
- `--verbose` flag for per-file output (debugging).
- Error handling: retry failed files once (transient API errors), then skip. Log failure and continue.
- Final summary always printed: files indexed, chunks created, skipped unchanged, re-embedded, failures with file paths.

**Ignore patterns**
- Hardcoded defaults: `.obsidian/`, `node_modules/` always excluded.
- Configurable `ignorePaths: string[]` in config for user-specific exclusions (e.g., `90 - Attachments/`, `91 - Excalidraw/`).
- File extension filter: `.md` only by default, configurable `includeExtensions: string[]` (ships with `[".md"]`).

### Claude's Discretion
- Exact remark plugin chain configuration
- Progress bar library choice (or hand-rolled)
- Internal queue/batching implementation for embedding API calls
- Chunk ID encoding/escaping for special characters in file paths and headings
- Exact retry logic (delay, backoff)
- SQLite transaction strategy for bulk inserts

### Deferred Ideas (OUT OF SCOPE)
- Non-markdown file parsers (.pdf, .docx, .png/OCR) — future phase. `includeExtensions` config param is the plumbing for when parsers land.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IDX-01 | Scanner discovers all .md files in configured vault directory recursively | `fs.glob` / `fast-glob` recursive scan; ignore patterns; iCloud space handling via `path.join` |
| IDX-02 | Markdown-aware chunking splits files by heading (H1/H2/H3) using remark AST parser, preserving heading path context | remark/unified pipeline; `remark-parse` + `remark-frontmatter` + `remark-gfm`; heading breadcrumb injection |
| IDX-03 | Each chunk stores metadata: source file path, heading path, chunk hash, last-indexed timestamp, file modified date | LanceDB `chunks` table schema already has all fields; SQLite `files` table already exists |
| IDX-04 | Content hashing (xxhash) skips re-embedding unchanged chunks on reindex | Two-tier: file-level hash in SQLite fast gate; chunk-level hash in LanceDB for partial update |
| IDX-05 | Bulk indexing respects embedding API rate limits via queue with concurrency control | `p-limit` already in use; `batchSize` and `concurrency` already in `Config` |
| IDX-06 | CLI command `mem index` triggers full vault reindex | `commander` already in `devDependencies`; register subcommand in `src/cli/index.ts` |
| IDX-07 | CLI command `mem status` shows index stats (files indexed, chunks, last indexed, stale count) | SQLite aggregates; LanceDB `countRows()`; `index_metadata` table for embedding model name |
</phase_requirements>

---

## Summary

Phase 1 delivered the full infrastructure layer: LanceDB connection and `chunks` table schema, SQLite metadata DB with `files` table, `EmbeddingProvider` interface with OpenAI adapter, config loading, and logger. Phase 2 builds the first user-visible pipeline on top — scan vault, chunk by heading, embed, store, repeat incrementally.

The key insight is that all storage primitives already exist. This phase's work is the **pipeline logic** connecting them: scanner (walks vault, does hash-gating), chunker (remark AST → heading-scoped chunks with breadcrumb), indexer (orchestrates the three stages), and two CLI commands (`mem index`, `mem status`). No new dependencies except the remark ecosystem for chunking.

The most important correctness concern is Pitfall 5 (stale chunks): every file update must delete-then-reinsert all chunks for that `source_path` — never append-only. The most important performance concern is Pitfall 6 (rate limits): p-limit concurrency control is already wired into `OpenAIEmbeddingProvider`, just needs the indexer to respect `config.concurrency`.

**Primary recommendation:** Build in order — scanner → chunker → indexer → CLI commands. Each module is independently testable with no external API needed (chunker is pure; scanner uses real fs but tmpdir fixtures work; indexer tests can stub the embedder).

---

## Standard Stack

### Core (all already installed in package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@lancedb/lancedb` | `^0.27.2` | Vector storage for chunks | Already in use; `openChunksTable()` exists |
| `better-sqlite3` | `^12.8.0` | File hash registry, status aggregates | Already in use; `openMetadataDb()` exists |
| `openai` | `^6.33.0` | Embedding API calls | Already in use via `OpenAIEmbeddingProvider` |
| `p-limit` | `^7.3.0` | Concurrency cap on embedding batches | Already in use inside `OpenAIEmbeddingProvider` |
| `zod` | `^4.3.6` | Config schema + validation | Already in use in `config.ts` |

### New Dependencies Required for Phase 2
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `unified` | `^11.x` | AST processing pipeline | Core processor for remark; pure ESM, fully typed |
| `remark-parse` | `^11.x` | Markdown → mdast AST | Standard parser; required for heading-aware chunking |
| `remark-frontmatter` | `^5.x` | Parse YAML frontmatter | Obsidian files use frontmatter for tags, dates, aliases |
| `remark-gfm` | `^4.x` | GitHub Flavored Markdown | Tables, task lists — common in Obsidian |
| `mdast-util-to-string` | `^4.x` | AST node → plain text | Extract chunk text after heading-split |
| `commander` | `^14.0.3` | CLI argument parsing | Already in devDeps; move to deps for CLI distribution |

### Progress Bar (Claude's Discretion)
Recommend **hand-rolled** for minimal deps: track `completed/total` counters, write `\r` to stderr (never stdout). A progress bar library like `cli-progress` adds ~30KB and a dep — not worth it for a single command. Example pattern:

```typescript
// Inline progress to stderr — safe for MCP, visible in terminal
process.stderr.write(`\r[${filled}${empty}] ${done}/${total} files (${changed} changed)`);
```

**Installation:**
```bash
npm install unified remark-parse remark-frontmatter remark-gfm mdast-util-to-string
# commander is already in devDependencies — move to dependencies:
npm install commander
```

**Version verification:**
```bash
npm view unified version          # 11.0.5
npm view remark-parse version     # 11.0.0
npm view remark-frontmatter version # 5.0.0
npm view remark-gfm version       # 4.0.1
npm view mdast-util-to-string version # 4.0.0
npm view commander version        # 14.0.0
```

---

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)
```
src/
├── core/
│   ├── scanner.ts         # NEW: glob vault, filter .md, hash-gate via SQLite
│   ├── chunker.ts         # NEW: remark AST → Chunk[], breadcrumb injection
│   ├── indexer.ts         # NEW: orchestrate scanner → chunker → embedder → stores
│   ├── db/
│   │   ├── sqlite.ts      # EXISTING: add upsertFile(), getFileHash(), getStatus()
│   │   └── lance.ts       # EXISTING: add upsertChunks(), deleteChunksByPath()
│   └── embedder/          # EXISTING (Phase 1)
├── cli/
│   └── index.ts           # EXTEND: register `index` and `status` subcommands
├── config.ts              # EXTEND: add ignorePaths, includeExtensions fields
└── types.ts               # EXTEND: add Chunk, IndexResult, StatusResult types
```

### Pattern 1: Two-Tier Hash Gating

**What:** File-level hash (SQLite) as a fast gate; chunk-level hash (LanceDB `chunk_hash` field) for partial updates within a changed file.

**When to use:** Every `mem index` run.

**Logic:**
1. For each discovered `.md` file, compute `sha256(fileContent)`.
2. Look up `content_hash` for this path in SQLite `files` table.
3. If hashes match → skip entirely (no chunking, no embedding, no writes).
4. If hash differs (or file is new):
   a. Delete ALL existing LanceDB chunks where `source_path = '{path}'` (prevents stale contradictions — Pitfall 5).
   b. Chunk the file → compute `sha256(chunkText)` per chunk.
   c. Embed all chunks.
   d. Insert new chunks into LanceDB.
   e. Upsert SQLite `files` record with new hash + `chunk_count` + `indexed_at`.

```typescript
// src/core/indexer.ts — conceptual flow
async function indexFile(filePath: string, db: Database, table: lancedb.Table, embedder: EmbeddingProvider) {
  const content = await fs.readFile(filePath, 'utf-8');
  const newHash = sha256(content);
  const storedHash = getFileHash(db, filePath);

  if (storedHash === newHash) return { status: 'skipped' };

  // Delete stale chunks BEFORE inserting new ones
  await table.delete(`source_path = '${escapePath(filePath)}'`);

  const chunks = chunkMarkdown(content, filePath);
  const texts = chunks.map(c => c.embeddableText); // breadcrumb + content
  const vectors = await embedder.embed(texts);

  const rows = chunks.map((c, i) => ({
    id: c.id,
    vector: vectors[i],
    text: c.embeddableText,
    source_path: filePath,
    heading_path: c.headingPath,
    chunk_hash: sha256(c.embeddableText),
    indexed_at: BigInt(Date.now()),
    embedding_model_id: embedder.modelId(),
  }));

  await table.add(rows);
  upsertFile(db, { path: filePath, content_hash: newHash, indexed_at: Date.now(), chunk_count: chunks.length });
  return { status: 'indexed', chunks: chunks.length };
}
```

### Pattern 2: Remark AST Heading Chunker

**What:** Parse markdown with remark, walk mdast tree, split at heading nodes depth 1–3, prepend heading breadcrumb to chunk text.

**When to use:** Every time a file needs re-embedding.

```typescript
// Source: remark/unified official docs + mdast spec
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { Root, Heading, Content } from 'mdast';

interface Chunk {
  id: string;
  headingPath: string;   // e.g. "## Projects > ### Claude Lab"
  embeddableText: string; // breadcrumb + "\n\n" + body
  chunkHash: string;
}

function chunkMarkdown(content: string, sourcePath: string): Chunk[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .parse(content) as Root;

  // Walk tree, split at headings depth 1-3
  // Accumulate body nodes between heading nodes
  // Build breadcrumb from heading stack [h1text, h2text, h3text]
  // If no headings: whole file is one chunk (or split at double-newline if >500 tokens)
  // Prepend: `${breadcrumb}: ${bodyText}`
}
```

**Breadcrumb format:** `"# H1 > ## H2 > ### H3"` — prepended to chunk text before embedding. The `>` separator distinguishes hierarchy from prose content.

**Chunk ID format:** `"{relativePath}::{headingPath}"` where `relativePath` is relative to vault root. Collision suffix `"-2"`, `"-3"` for duplicate heading text in same file.

### Pattern 3: LanceDB Delete-Then-Reinsert

**What:** Before inserting updated chunks for a file, delete all existing chunks for that `source_path`.

```typescript
// Source: LanceDB TypeScript docs — table.delete() accepts SQL WHERE clause
await table.delete(`source_path = '${filePath.replace(/'/g, "''")}'`);
```

Note: Single-quote escaping is required. LanceDB `delete()` accepts a SQL predicate string.

### Pattern 4: SQLite Status Aggregates for `mem status`

```typescript
// src/core/db/sqlite.ts additions
function getStatus(db: Database.Database): StatusResult {
  const counts = db.prepare(`
    SELECT COUNT(*) as file_count, SUM(chunk_count) as total_chunks,
           MAX(indexed_at) as last_indexed_at
    FROM files
  `).get() as { file_count: number; total_chunks: number; last_indexed_at: number };

  const model = db.prepare(
    "SELECT value FROM index_metadata WHERE key = 'embedding_model_id'"
  ).get() as { value: string } | undefined;

  return {
    fileCount: counts.file_count,
    chunkCount: counts.total_chunks ?? 0,
    lastIndexedAt: counts.last_indexed_at ? new Date(counts.last_indexed_at) : null,
    embeddingModel: model?.value ?? 'unknown',
  };
}
```

### Anti-Patterns to Avoid

- **Append-only chunk updates:** Never add new chunks without first deleting old ones for the same `source_path`. Causes contradictory memories (Pitfall 5).
- **Embedding before hash check:** Hash-gate fires before any chunking or API calls. Compute hash from raw file content, check SQLite — only proceed if changed.
- **Progress bar on stdout:** Must write to `stderr`. stdout is reserved for CLI output that may be piped; it is also the MCP JSON-RPC wire.
- **String concatenation for vault path:** Always `path.join()`. The vault path contains a space (`Mobile Documents`) — shell-style concatenation breaks (Pitfall 9).
- **Frontmatter as chunk body:** Extract frontmatter with `remark-frontmatter` and exclude it from embeddable text body (it's metadata, not content).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown AST parsing | Custom regex heading splitter | `unified` + `remark-parse` | Handles nested headings, fenced code blocks, tables, lists; regex fails on edge cases like headings inside code blocks |
| GFM table/task-list parsing | Custom table parser | `remark-gfm` | 15+ edge cases in GFM table spec |
| Embedding batching / concurrency | Custom queue | `p-limit` (already installed) | Already proven in OpenAIEmbeddingProvider; just pass `texts[]` to `embedder.embed()` |
| AST → plain text | Custom node walker | `mdast-util-to-string` | Handles inline code, emphasis, links, images correctly |

**Key insight:** The remark ecosystem has solved every edge case in programmatic Markdown handling. The only custom logic needed is the heading-split traversal and breadcrumb builder — the parsing, text extraction, and GFM support are off-the-shelf.

---

## Common Pitfalls

### Pitfall 1: Stale Chunks After File Edit (CRITICAL)
**What goes wrong:** Updating a file embeds new chunks but leaves old chunks in LanceDB. Retrieval returns contradictory results.
**Why it happens:** Append-only insert on file change.
**How to avoid:** Always `table.delete(source_path = '...')` BEFORE `table.add(newChunks)`. Atomic from SQLite's perspective (SQLite upsert only committed after successful LanceDB delete+add).
**Warning signs:** Two chunks from same file with different `indexed_at` values appearing in the same result set.

### Pitfall 2: Rate Limit Crash During Bulk Index (CRITICAL)
**What goes wrong:** First-time index of 1000+ files sends too many embedding API requests, hits 429, crashes.
**Why it happens:** Over-parallelization.
**How to avoid:** `config.concurrency` (default 2) is already wired into `OpenAIEmbeddingProvider` via `p-limit`. The indexer must process files serially or with bounded parallelism — do NOT `Promise.all()` all files at once.
**Warning signs:** HTTP 429 errors; SQLite shows last indexed file timestamp hours old.

### Pitfall 3: Headings Inside Code Blocks
**What goes wrong:** A markdown file contains \`\`\` bash followed by `# comment` — naive regex splits on this false heading.
**Why it happens:** Regex-based heading detection doesn't understand code fences.
**How to avoid:** Use remark AST — the parser correctly identifies `heading` nodes vs `code` nodes. Never use regex to find headings in markdown.

### Pitfall 4: iCloud Path with Spaces in File Operations
**What goes wrong:** `ENOENT` errors when vault path is `/Users/rod/Library/Mobile Documents/...`.
**Why it happens:** String concatenation or shell-style path handling.
**How to avoid:** Use `path.join()` and `path.resolve()` exclusively. Validate vault path with `fs.access()` at CLI startup before scanning.

### Pitfall 5: Chunk ID Collisions for Duplicate Headings
**What goes wrong:** A file has two `## Usage` sections. Both get the same chunk ID → second insert overwrites first.
**Why it happens:** Naive ID = `filePath::headingPath` without collision handling.
**How to avoid:** Track seen headingPaths per file during chunking; append `-2`, `-3` suffix for duplicates.

---

## Code Examples

### File Scanner (IDX-01)
```typescript
// src/core/scanner.ts
// Source: Node.js fs.glob (Node 22+) or fast-glob pattern
import { glob } from 'fast-glob'; // or use fs.glob in Node 22+

async function scanVault(config: Config): Promise<string[]> {
  const ignore = [
    '**/.obsidian/**',
    '**/node_modules/**',
    '**/*.icloud',   // iCloud placeholder files
    ...config.ignorePaths.map(p => `**/${p}/**`),
  ];

  return glob('**/*.md', {
    cwd: config.vaultPath,
    absolute: true,
    ignore,
    followSymbolicLinks: false,
  });
}
```

Note: `fast-glob` is not yet installed. Alternative: Node.js built-in `fs.glob` (Node 22+). Check Node version — project requires `>=18`. `fast-glob` adds one dep but works on Node 18+.

### Chunk Hashing (IDX-04)
```typescript
import { createHash } from 'crypto';

// Node.js built-in — no extra dependency
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}
```

Note: REQUIREMENTS.md mentions `xxhash` for content hashing. Node.js `crypto.createHash('sha256')` is built-in with zero deps. xxhash is faster but requires a native module. For vault sizes under 100K files, SHA-256 is fast enough. Recommend SHA-256 (built-in) unless benchmarks show a bottleneck.

### `mem status` Output Format (IDX-07)
```
Index Status
  Files indexed:    1,247
  Chunks stored:    4,891
  Last indexed:     2026-04-05 14:32:11
  Embedding model:  openai:text-embedding-3-small
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed-size token chunking | Heading-aware AST chunking | 2024-2025 RAG benchmarks | Better retrieval precision for structured docs |
| `vectordb` npm package | `@lancedb/lancedb` | 2024 | Only current package; `vectordb` is deprecated |
| xxhash for content hashing | SHA-256 (built-in crypto) | Timeless | No native dep needed for vault-scale workloads |

**Deprecated/outdated:**
- `remark` v10 and below: use `^11` (unified/remark v11 is the current release line)
- `vectordb` package: replaced by `@lancedb/lancedb`

---

## Open Questions

1. **File globbing: `fast-glob` vs Node.js built-in `fs.glob`**
   - What we know: `fast-glob` works on Node 18+. `fs.glob` requires Node 22+. Project requires `>=18`.
   - What's unclear: Whether Rod's environment has Node 22.
   - Recommendation: Add `fast-glob` as a dep to ensure Node 18 compatibility. One lightweight dep, zero native bindings.

2. **SHA-256 vs xxhash for content hashing**
   - What we know: REQUIREMENTS.md specifies xxhash. SHA-256 is built-in, no native dep needed. For 1K files at ~50KB each, SHA-256 takes ~50ms total.
   - What's unclear: Whether REQUIREMENTS.md's xxhash spec is a hard requirement or a suggestion.
   - Recommendation: Use SHA-256 unless Rod explicitly prefers xxhash. Avoid a native module for marginal speed gains.

3. **Chunk token counting for the ~500 token ceiling**
   - What we know: The 500 token limit is configurable. OpenAI tokenizer is not trivial to run client-side.
   - What's unclear: Whether to use a rough character-based estimate (1 token ≈ 4 chars) or an actual tokenizer.
   - Recommendation: Use character count heuristic (`charCount / 4`) for the ceiling check. Accurate enough for splitting decisions; avoids `tiktoken` or `gpt-tokenizer` dependency.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (exists; `globals: true`, `environment: 'node'`) |
| Quick run command | `npm test` |
| Full suite command | `npm test -- --coverage` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IDX-01 | Scanner discovers .md files, respects ignore patterns | unit | `npm test -- src/core/scanner.test.ts` | Wave 0 |
| IDX-01 | Scanner skips `.obsidian/`, `node_modules/`, `*.icloud` | unit | `npm test -- src/core/scanner.test.ts` | Wave 0 |
| IDX-02 | Chunker splits at H1/H2/H3, preserves breadcrumb | unit | `npm test -- src/core/chunker.test.ts` | Wave 0 |
| IDX-02 | Chunker handles files with no headings | unit | `npm test -- src/core/chunker.test.ts` | Wave 0 |
| IDX-02 | Chunker handles headings inside code blocks (no false splits) | unit | `npm test -- src/core/chunker.test.ts` | Wave 0 |
| IDX-03 | Chunks include source_path, heading_path, chunk_hash, indexed_at | unit | `npm test -- src/core/chunker.test.ts` | Wave 0 |
| IDX-04 | Unchanged file is skipped on second index run | unit | `npm test -- src/core/indexer.test.ts` | Wave 0 |
| IDX-04 | Changed file: old chunks deleted, new chunks inserted | unit | `npm test -- src/core/indexer.test.ts` | Wave 0 |
| IDX-05 | Embedding concurrency respects config.concurrency | unit | `npm test -- src/core/indexer.test.ts` | Wave 0 |
| IDX-06 | `mem index` exits 0 on success, prints summary | integration | `npm test -- src/cli/commands/index.test.ts` | Wave 0 |
| IDX-07 | `mem status` prints file count, chunk count, timestamp, model | integration | `npm test -- src/cli/commands/status.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test -- --coverage`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
All test files need creation before implementation:
- [ ] `src/core/scanner.test.ts` — covers IDX-01
- [ ] `src/core/chunker.test.ts` — covers IDX-02, IDX-03
- [ ] `src/core/indexer.test.ts` — covers IDX-04, IDX-05
- [ ] `src/cli/commands/index.test.ts` — covers IDX-06
- [ ] `src/cli/commands/status.test.ts` — covers IDX-07
- [ ] Install remark packages: `npm install unified remark-parse remark-frontmatter remark-gfm mdast-util-to-string`
- [ ] Install `commander` as prod dep: `npm install commander`
- [ ] Optionally add `fast-glob` for Node 18 compatibility: `npm install fast-glob`

---

## Sources

### Primary (HIGH confidence)
- `~/Projects/claude-code-memory/src/` — Phase 1 source code (read directly; ground truth for existing APIs)
- `~/Projects/claude-code-memory/.planning/research/STACK.md` — validated stack with versions
- `~/Projects/claude-code-memory/.planning/research/ARCHITECTURE.md` — component boundaries and data flow
- `~/Projects/claude-code-memory/.planning/research/PITFALLS.md` — verified pitfall catalog
- `~/Projects/claude-code-memory/.planning/phases/02-index-pipeline/02-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- npm registry — unified v11, remark-parse v11, remark-gfm v4, remark-frontmatter v5 (verified in STACK.md)
- LanceDB `table.delete()` SQL predicate — documented in ARCHITECTURE.md source list

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in STACK.md against npm; Phase 1 packages already installed
- Architecture: HIGH — ARCHITECTURE.md documents data flow; Phase 1 code confirms all integration points
- Pitfalls: HIGH — PITFALLS.md cross-references official sources; Phase 1 already addressed iCloud path safety

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable ecosystem; LanceDB/remark/unified APIs change slowly)
