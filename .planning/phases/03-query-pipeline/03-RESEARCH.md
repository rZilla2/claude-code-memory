# Phase 3: Query Pipeline - Research

**Researched:** 2026-04-05
**Domain:** Hybrid search (vector + BM25/FTS), RRF merge, metadata filtering, recency weighting
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | Vector similarity search returns semantically relevant chunks | LanceDB `table.search(vector).nearestTo()` — flat scan or IVF index |
| SRCH-02 | Full-text BM25 search returns exact-match results | LanceDB `Index.fts()` + `table.search(query, 'fts')` built-in |
| SRCH-03 | Hybrid search merges vector + FTS using RRF | LanceDB `RRFReranker.create()` + `rerankHybrid()` — built-in, no hand-roll |
| SRCH-04 | Results include source path, heading path, relevance score, chunk date | Select from LanceDB row fields; `indexed_at` is Int64 BigInt |
| SRCH-05 | Filter by date range, source file glob, or hub/folder | LanceDB `.where()` SQL predicate on `indexed_at` and `source_path` |

Note: SRCH-06 (recency weighting) and SRCH-07 (staleness decay) are confirmed Phase 6 per REQUIREMENTS.md traceability table (moved after roadmap creation). The Phase 3 ROADMAP success criterion #5 references recency weighting — that criterion belongs to Phase 6. Phase 3 success criteria 1-4 map cleanly to SRCH-01 through SRCH-05.
</phase_requirements>

---

## Summary

Phase 3 implements the query pipeline that consumers (Phase 4 CLI and MCP) will call. The core work is three search modes: vector-only (SRCH-01), FTS/BM25-only (SRCH-02), and hybrid RRF merge (SRCH-03), plus result metadata formatting (SRCH-04) and date/path filtering (SRCH-05).

LanceDB 0.27.2 (already installed) ships everything needed: built-in FTS index via `Index.fts()`, native `RRFReranker` with `rerankHybrid()`, and SQL-predicate `.where()` filtering. No additional libraries are required. The LanceDB table schema from Phase 2 already stores `text`, `source_path`, `heading_path`, `indexed_at`, and `embedding_model_id` — all fields needed for SRCH-04.

The only schema gap: `indexed_at` tracks when a chunk was embedded, not when the source file was last modified. For date filtering (SRCH-05 `--after`), filtering by `indexed_at` is a reasonable proxy. If file modification date is needed precisely, a `file_modified_at` field must be added to the LanceDB schema and populated from `fs.stat().mtimeMs` during indexing. This is a decision point for the planner.

**Primary recommendation:** Build `src/core/searcher.ts` as a single module exposing `search(query, options)` that runs vector + FTS in parallel, then pipes through `RRFReranker`, then applies `where()` filters and result shaping. Keep it pure (no CLI/MCP concerns) so Phase 4 can wrap it trivially.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @lancedb/lancedb | 0.27.2 (installed) | Vector search, FTS index, RRF reranker | Already in project; has all three features built-in |
| apache-arrow | (transitive) | RecordBatch types for RRF API | Required by LanceDB RRF reranker interface |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.2 (installed) | Unit tests for searcher | All test files |
| better-sqlite3 | 12.8.0 (installed) | Read SQLite files metadata for filtering context | Already in project |

### No New Dependencies Required
All search functionality is covered by the existing `@lancedb/lancedb` package. No additional packages needed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── core/
│   ├── searcher.ts        # NEW — hybrid search orchestrator (this phase)
│   ├── db/
│   │   ├── lance.ts       # EXISTS — add search helpers here
│   │   └── sqlite.ts      # EXISTS — no changes needed
│   ├── chunker.ts         # EXISTS
│   ├── indexer.ts         # EXISTS
│   └── embedder/          # EXISTS
├── types.ts               # EXISTS — add SearchOptions, SearchResult types
└── cli/                   # Phase 4
```

### Pattern 1: Parallel Vector + FTS, then RRF Merge

**What:** Run vector query and FTS query concurrently using `Promise.all`, then merge with built-in `RRFReranker`.

**When to use:** Default hybrid mode (SRCH-03). This is the primary search path.

**Example:**
```typescript
// Source: @lancedb/lancedb 0.27.2 dist/rerankers/rrf.d.ts, dist/query.d.ts
import { RRFReranker } from '@lancedb/lancedb/rerankers';

const reranker = await RRFReranker.create(); // k=60 default

// Run both searches in parallel
const [vecResults, ftsResults] = await Promise.all([
  table
    .search(queryVector)
    .select(['id', 'text', 'source_path', 'heading_path', 'indexed_at'])
    .withRowId()
    .limit(topK * 2)  // over-fetch for RRF quality
    .toArrow(),
  table
    .search(queryText, 'fts')
    .select(['id', 'text', 'source_path', 'heading_path', 'indexed_at'])
    .withRowId()
    .limit(topK * 2)
    .toArrow(),
]);

// RRFReranker.rerankHybrid expects RecordBatch, not ArrowTable
// Convert via table.get(0) or iterate ArrowTable.batches[0]
const merged = await reranker.rerankHybrid(
  queryText,
  vecResults.batches[0],
  ftsResults.batches[0],
);
```

**Critical detail:** `RRFReranker.rerankHybrid` takes `RecordBatch` not `ArrowTable`. Call `.toArrow()` then access `.batches[0]`, or use the `RecordBatchIterator` approach.

### Pattern 2: FTS Index Creation (One-Time, Wave 0)

**What:** Create the FTS index on the `text` column after table is opened. Must be done before any FTS query.

**When to use:** During `mem index` command after indexing completes, or lazily on first search.

```typescript
// Source: @lancedb/lancedb 0.27.2 dist/indices.d.ts
import { Index } from '@lancedb/lancedb';

await table.createIndex('text', {
  config: Index.fts({
    withPosition: true,   // enables phrase queries
    baseTokenizer: 'simple',
    lowercase: true,
    stem: false,          // stemming can hurt precision for notes
    removeStopWords: false, // keep stop words for note content
  }),
  replace: true,          // idempotent re-creation
});
```

**Note:** `replace: true` makes this safe to call on every `mem index` run. FTS index is stored alongside the LanceDB table data at `~/.claude-code-memory/`.

### Pattern 3: Date Filtering (SRCH-05)

**What:** SQL predicate on `indexed_at` (Int64 BigInt milliseconds since epoch).

```typescript
// Source: @lancedb/lancedb 0.27.2 dist/query.d.ts — where() method
const afterMs = new Date('2025-01-01').getTime();

table
  .search(queryVector)
  .where(`indexed_at >= ${afterMs}`)
  .limit(topK)
  .toArray();
```

**Source path filtering:**
```typescript
// Glob-style matching requires SQL LIKE or starts-with
table
  .search(queryVector)
  .where(`source_path LIKE '%/Claude Lab/%'`)
  .limit(topK)
  .toArray();
```

**Warning:** `indexed_at` is a BigInt column. SQL comparisons with plain JS numbers may need `CAST` or explicit BigInt literals depending on LanceDB version. Verify in tests.

### Pattern 4: SearchResult Type (SRCH-04)

```typescript
// In src/types.ts
export interface SearchResult {
  id: string;
  sourcePath: string;
  headingPath: string;
  text: string;
  score: number;         // RRF score or vector distance
  indexedAt: Date;       // from indexed_at BigInt field
}

export interface SearchOptions {
  topK?: number;         // default 10
  mode?: 'vector' | 'fts' | 'hybrid';  // default 'hybrid'
  afterDate?: Date;      // SRCH-05 --after filter
  beforeDate?: Date;     // SRCH-05 optional
  sourceGlob?: string;   // SRCH-05 path filter (LIKE pattern)
}
```

### Anti-Patterns to Avoid

- **Hand-rolling RRF:** LanceDB ships `RRFReranker` natively. Do not implement reciprocal rank fusion manually.
- **Using `filter()` instead of `where()`:** `filter()` is deprecated in LanceDB 0.27.x. Use `where()`.
- **Creating FTS index on every search:** Index creation is slow (rebuilds on every call). Create once during indexing, not on search.
- **Querying without `withRowId()`:** RRF reranker needs row IDs to match results across vector and FTS result sets. Always call `withRowId()` on both queries when using RRF.
- **Not over-fetching for RRF:** Ask for `topK * 2` or `topK * 3` from each search before merging; RRF deduplicates and reranks, so under-fetching reduces quality.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reciprocal Rank Fusion | Custom RRF scorer | `RRFReranker.create()` | Built into @lancedb/lancedb 0.27.2 |
| BM25 scoring | SQLite FTS5 table | `Index.fts()` on LanceDB text column | Same store, no sync overhead |
| Vector ANN index | FAISS/hnswlib wrapper | LanceDB flat scan (vault-scale is fine) | Personal vault <100K chunks — flat scan is fast enough |

**Key insight:** At personal vault scale (1K-10K chunks), a flat vector scan without an IVF index is fast enough (<100ms) and simpler. Defer `Index.ivfPq()` to Phase 6 if benchmarks reveal a problem.

## Common Pitfalls

### Pitfall 1: FTS Index Not Created Before First Search

**What goes wrong:** `table.search(text, 'fts')` throws if no FTS index exists on the column.

**Why it happens:** FTS is opt-in. The table from Phase 2 has no FTS index yet.

**How to avoid:** Create FTS index at end of `mem index` command (Phase 4), or add a lazy-create guard in `openChunksTable()` in `src/core/db/lance.ts`.

**Warning signs:** Error message containing "no FTS index" or "column not indexed."

### Pitfall 2: RRF RecordBatch vs ArrowTable Mismatch

**What goes wrong:** Passing `ArrowTable` to `rerankHybrid()` instead of `RecordBatch` causes a type error at runtime.

**Why it happens:** `toArrow()` returns `ArrowTable`, but `rerankHybrid` expects `RecordBatch`.

**How to avoid:** Access `.batches[0]` on the ArrowTable result, or use async iteration and collect the first batch.

**Warning signs:** Runtime type error inside `rerankHybrid`.

### Pitfall 3: BigInt indexed_at Comparison in WHERE

**What goes wrong:** SQL predicate `indexed_at >= 1735689600000` may fail or return wrong results if the column is Int64 BigInt and the literal is treated as a smaller type.

**Why it happens:** LanceDB uses Apache Arrow Int64 which maps to BigInt in JS. SQL literal handling depends on the underlying DataFusion dialect.

**How to avoid:** Test date filtering with an explicit assertion in unit tests. Use `Number(indexedAt)` coercion if needed, or store `indexed_at` as a regular integer (SQLite files table already stores it as INTEGER).

**Warning signs:** No results returned when filter should match, or filter silently ignored.

### Pitfall 4: file_modified_at Gap for --after Filtering

**What goes wrong:** SRCH-05 says "filter by date range" which naturally means file modification date. But the LanceDB schema only has `indexed_at` (embed time), not file mtime.

**Why it happens:** Phase 2 indexer only wrote `indexed_at: BigInt(Date.now())` — no `file_modified_at` field.

**How to avoid (planner decision):** Option A — accept `indexed_at` as proxy (simpler, ships now). Option B — add `file_modified_at` column to LanceDB schema and populate from `fs.stat().mtimeMs` in `indexFile()`. Option B requires a schema migration (delete + recreate table).

**Recommendation:** Go with Option A for Phase 3. Document the limitation. Phase 6 can add proper mtime tracking if needed.

## Code Examples

### Full Hybrid Search Function Skeleton

```typescript
// src/core/searcher.ts
// Source: @lancedb/lancedb 0.27.2 type definitions
import * as lancedb from '@lancedb/lancedb';
import { RRFReranker } from '@lancedb/lancedb/rerankers';
import type { EmbeddingProvider } from './embedder/types.js';
import type { SearchOptions, SearchResult } from '../types.js';

export async function search(
  query: string,
  table: lancedb.Table,
  embedder: EmbeddingProvider,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { topK = 10, mode = 'hybrid', afterDate, beforeDate, sourceGlob } = options;

  // Build WHERE predicate
  const conditions: string[] = [];
  if (afterDate) conditions.push(`indexed_at >= ${afterDate.getTime()}`);
  if (beforeDate) conditions.push(`indexed_at <= ${beforeDate.getTime()}`);
  if (sourceGlob) conditions.push(`source_path LIKE '${sourceGlob.replace(/'/g, "''")}'`);
  const predicate = conditions.length > 0 ? conditions.join(' AND ') : undefined;

  const cols = ['id', 'text', 'source_path', 'heading_path', 'indexed_at'];

  if (mode === 'fts') {
    const q = table.search(query, 'fts').select(cols).limit(topK);
    if (predicate) q.where(predicate);
    const rows = await q.toArray();
    return rows.map(rowToResult);
  }

  const queryVector = (await embedder.embed([query]))[0];

  if (mode === 'vector') {
    const q = table.search(queryVector).select(cols).limit(topK);
    if (predicate) q.where(predicate);
    const rows = await q.toArray();
    return rows.map(rowToResult);
  }

  // Hybrid: run both, merge with RRF
  const fetchK = topK * 3;
  const [vecArrow, ftsArrow] = await Promise.all([
    table.search(queryVector).select(cols).withRowId().limit(fetchK).toArrow(),
    table.search(query, 'fts').select(cols).withRowId().limit(fetchK).toArrow(),
  ]);

  const reranker = await RRFReranker.create();
  const merged = await reranker.rerankHybrid(
    query,
    vecArrow.batches[0],
    ftsArrow.batches[0],
  );

  // merged is a RecordBatch — convert to plain objects
  const results: SearchResult[] = [];
  for (let i = 0; i < Math.min(merged.numRows, topK); i++) {
    results.push({
      id: merged.getChildAt(merged.schema.fieldIndex('id'))?.get(i) ?? '',
      sourcePath: merged.getChildAt(merged.schema.fieldIndex('source_path'))?.get(i) ?? '',
      headingPath: merged.getChildAt(merged.schema.fieldIndex('heading_path'))?.get(i) ?? '',
      text: merged.getChildAt(merged.schema.fieldIndex('text'))?.get(i) ?? '',
      score: merged.getChildAt(merged.schema.fieldIndex('_score'))?.get(i) ?? 0,
      indexedAt: new Date(Number(merged.getChildAt(merged.schema.fieldIndex('indexed_at'))?.get(i) ?? 0)),
    });
  }
  return results;
}

function rowToResult(row: Record<string, unknown>): SearchResult {
  return {
    id: row.id as string,
    sourcePath: row.source_path as string,
    headingPath: row.heading_path as string,
    text: row.text as string,
    score: (row._distance as number) ?? 0,
    indexedAt: new Date(Number(row.indexed_at)),
  };
}
```

**Note:** The exact RecordBatch field-access API and the `_score` field name from RRF need verification in integration tests. The skeleton above is directionally correct but may need adjustment based on actual LanceDB runtime behavior.

### FTS Index Creation

```typescript
// Add to src/core/db/lance.ts
import { Index } from '@lancedb/lancedb';

export async function ensureFtsIndex(table: lancedb.Table): Promise<void> {
  await table.createIndex('text', {
    config: Index.fts({
      withPosition: true,
      baseTokenizer: 'simple',
      lowercase: true,
    }),
    replace: true,
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate FTS library (Lunr, Flexsearch) | LanceDB built-in FTS | LanceDB 0.12+ | Eliminates sync between vector + text stores |
| Manual RRF implementation | `RRFReranker.create()` | LanceDB ~0.15+ | No hand-rolling required |
| `filter()` method | `where()` method | LanceDB ~0.20+ | `filter()` deprecated, use `where()` |

**Deprecated/outdated:**
- `table.search().filter()`: Deprecated. Use `.where()` instead.
- Separate FTS libraries (lunr, flexsearch): Unnecessary — LanceDB FTS handles it.

## Open Questions

1. **RecordBatch field access after `rerankHybrid`**
   - What we know: `rerankHybrid` returns `Promise<RecordBatch>`; field names from the merged batch should match input column names plus `_score`
   - What's unclear: Whether `_score` is the actual RRF score field name, or if it's `_relevance_score`, or something else
   - Recommendation: Write an integration test with a real (small) LanceDB table to confirm field names before building the result shaper

2. **BigInt WHERE predicate behavior**
   - What we know: `indexed_at` is `Int64` (BigInt) in Arrow schema; SQL literal `1735689600000` is parsed by DataFusion inside LanceDB
   - What's unclear: Whether DataFusion coerces JS number literals to Int64 correctly in all cases
   - Recommendation: Add explicit integration test asserting `--after` filtering excludes/includes the right chunks

3. **FTS index persistence across `mem index` runs**
   - What we know: `replace: true` on `createIndex` rebuilds the index; this is safe but slow on large vaults
   - What's unclear: Whether an incremental FTS index update is possible (partial re-indexing only changed rows)
   - Recommendation: For Phase 3, always rebuild FTS index after `mem index` completes. Optimize in Phase 5 if benchmark shows it's slow.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run src/core/searcher.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-01 | Vector search returns semantically relevant rows | unit (mock embedder + real LanceDB) | `npx vitest run src/core/searcher.test.ts -t "vector"` | ❌ Wave 0 |
| SRCH-02 | FTS search returns exact-match row in top 3 | unit (real LanceDB FTS index) | `npx vitest run src/core/searcher.test.ts -t "fts"` | ❌ Wave 0 |
| SRCH-03 | Hybrid RRF merges both result sets | unit (mock vectors + real FTS) | `npx vitest run src/core/searcher.test.ts -t "hybrid"` | ❌ Wave 0 |
| SRCH-04 | Result shape includes all required fields | unit | `npx vitest run src/core/searcher.test.ts -t "result shape"` | ❌ Wave 0 |
| SRCH-05 | `--after` filter excludes old chunks | unit (two chunks with different indexed_at) | `npx vitest run src/core/searcher.test.ts -t "date filter"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/core/searcher.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/core/searcher.test.ts` — covers SRCH-01 through SRCH-05
- [ ] `src/core/db/lance.test.ts` — covers FTS index creation (ensureFtsIndex)

Test strategy note: Tests for SRCH-01/02/03 should use a real (in-memory or tmp-dir) LanceDB instance with synthetic chunks, not mocked LanceDB. LanceDB is a local file store with no network dependency — real integration tests are fast and reliable.

## Sources

### Primary (HIGH confidence)
- `node_modules/@lancedb/lancedb/dist/query.d.ts` — `VectorQuery`, `Query.fullTextSearch()`, `where()`, `withRowId()`, `toArrow()`
- `node_modules/@lancedb/lancedb/dist/rerankers/rrf.d.ts` — `RRFReranker.create()`, `rerankHybrid()` signature
- `node_modules/@lancedb/lancedb/dist/rerankers/index.d.ts` — `Reranker` interface
- `node_modules/@lancedb/lancedb/dist/indices.d.ts` — `Index.fts()`, `FtsOptions`
- `node_modules/@lancedb/lancedb/dist/table.d.ts` — `createIndex()`, `search()` signatures
- `src/core/db/lance.ts` — existing schema (source of truth for field names)
- `src/core/indexer.ts` — confirms fields written: `id`, `vector`, `text`, `source_path`, `heading_path`, `chunk_hash`, `indexed_at`, `embedding_model_id`
- `.planning/REQUIREMENTS.md` — SRCH-01/02/03/04/05 in Phase 3; SRCH-06/07 confirmed Phase 6

### Secondary (MEDIUM confidence)
- LanceDB 0.27.2 package.json — version confirmed

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against installed package type definitions
- Architecture: HIGH — patterns derived from actual type signatures in installed package
- Pitfalls: MEDIUM — BigInt WHERE predicate behavior and RecordBatch field names need integration test verification
- Open questions: flagged for Wave 0 integration tests

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (LanceDB is active; check for API changes if upgrading beyond 0.27.x)
