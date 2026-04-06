# Phase 6: Ollama Adapter + Staleness Scoring - Research

**Researched:** 2026-04-06
**Domain:** Ollama HTTP API, staleness/recency scoring, LanceDB schema, TypeScript embedding adapter pattern
**Confidence:** HIGH

## Summary

Phase 6 adds two independent capabilities: (1) an Ollama embedding adapter for local/offline indexing, and (2) a staleness decay function that reduces relevance scores for old content. Both build on the pluggable `EmbeddingProvider` interface and SQLite/LanceDB stack already in place.

The Ollama adapter is structurally straightforward — it mirrors `OpenAIEmbeddingProvider` but calls `POST http://localhost:11434/api/embed` with `{"model":"nomic-embed-text","input":[...]}`. The only non-trivial issue is a dimension mismatch: `nomic-embed-text` produces 768-dimensional vectors vs OpenAI's 1536. `openChunksTable()` defaults to `vectorDimension=1536` and `assertModelMatch()` already guards against cross-provider switching — so switching providers throws a clear reindex error without new logic. The `openChunksTable` call in the indexer just needs to pass the correct dimension for the configured provider.

Staleness decay is post-retrieval score multiplication: `finalScore = rawScore * exp(-k * ageInDays)`. The `files` table already has a `staleness_score REAL` column and each chunk's `indexed_at` is stored in LanceDB. The `SearchResult` type has a `score` field that the searcher populates — the decay can be applied inside `searcher.ts` after results are returned, using each result's `indexedAt` date. No schema changes required.

**Primary recommendation:** Implement Ollama adapter first (clear interface contract), then add staleness decay as a post-processing step in `searcher.ts` with a configurable decay constant in `Config`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EMB-03 | Ollama/nomic-embed-text adapter ships as local alternative | Ollama runs locally at port 11434; API verified responsive; 768-dim vectors confirmed |
| SRCH-06 | Recency weighting boosts newer chunks over older ones | `indexedAt` field in every `SearchResult`; exp decay formula applies post-RRF |
| SRCH-07 | Configurable staleness decay reduces relevance score for old content | Config already accepts `embeddingProvider`; same pattern for `stalenessDecayRate` field |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fetch` (Node 18 built-in) | built-in | Ollama HTTP calls | No new dep; Node 18 ships native fetch |
| `better-sqlite3` | ^12.8.0 (already installed) | `staleness_score` already in `files` schema | Already in use |
| `@lancedb/lancedb` | ^0.27.2 (already installed) | Vector table with `indexed_at` per chunk | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `p-limit` | ^7.3.0 (already installed) | Concurrency for batched Ollama calls | Same pattern as OpenAI adapter |

**No new dependencies required.**

## Architecture Patterns

### Recommended Project Structure
```
src/core/embedder/
├── types.ts          # EmbeddingProvider interface (unchanged)
├── openai.ts         # OpenAI adapter (unchanged)
├── ollama.ts         # NEW: Ollama adapter
└── factory.ts        # Add 'ollama' branch (replace throw with real impl)
```

### Pattern 1: Ollama Adapter (mirrors OpenAI)
**What:** HTTP fetch to Ollama's `/api/embed` endpoint, same batching pattern as OpenAI adapter
**When to use:** `config.embeddingProvider === 'ollama'`
**Key details:**
- `modelId()` returns `'ollama:nomic-embed-text'` (stable format matches `provider:model-name` convention)
- Batch size default: 20 (Ollama is local CPU/GPU, smaller batches prevent OOM)
- No API key required
- Response shape: `{ model, embeddings: number[][] }` (note: plural `embeddings`, not `data[].embedding`)
- Dimension: 768 (confirmed via live API)

```typescript
// Source: verified against live Ollama at localhost:11434
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly model: string = 'nomic-embed-text',
    private readonly baseUrl: string = 'http://localhost:11434',
    private readonly batchSize: number = 20,
  ) {}

  modelId(): string {
    return `ollama:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // batch into groups of batchSize, fetch sequentially or with p-limit
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: batch }),
      });
      if (!res.ok) throw new Error(`Ollama embed error: ${res.status} ${res.statusText}`);
      const json = await res.json() as { embeddings: number[][] };
      results.push(...json.embeddings);
    }
    return results;
  }
}
```

### Pattern 2: Vector Dimension Wiring
**What:** `openChunksTable()` accepts `vectorDimension` — must match the provider's output
**When to use:** Everywhere `openChunksTable` is called (indexer, MCP server, CLI commands)
**Key detail:** If a table already exists, `openTable()` is called and the schema is fixed — the dimension arg is only used on first creation. This means: switching providers on an existing index hits `assertModelMatch()` and throws before any dimension mismatch can corrupt the table.

```typescript
// In factory.ts or wherever openChunksTable is called:
const dimension = config.embeddingProvider === 'ollama' ? 768 : 1536;
const table = await openChunksTable(connection, dimension);
```

### Pattern 3: Staleness Decay (post-retrieval)
**What:** Multiply `_relevance_score` by exponential decay based on age of the chunk
**When to use:** Applied in `searcher.ts` after `rowToResult()` mapping, before returning results
**Formula:** `finalScore = rawScore * exp(-k * ageInDays)` where `k` is the decay constant

| k value | Half-life | Effect |
|---------|-----------|--------|
| 0.001 | ~693 days | Very gentle — 2-year-old content scores ~50% of new |
| 0.003 | ~231 days | Moderate — 6-month-old content scores ~63% of new |
| 0.01 | ~69 days | Aggressive — 3-month-old content scores ~74% of new |

**Recommended default:** `stalenessDecayRate: 0.003` (half-life ~8 months — appropriate for knowledge base content)

```typescript
// In searcher.ts, after results are collected:
function applyStalenessDacy(results: SearchResult[], decayRate: number): SearchResult[] {
  if (decayRate === 0) return results;
  const now = Date.now();
  return results.map(r => {
    const ageInDays = (now - r.indexedAt.getTime()) / 86_400_000;
    const multiplier = Math.exp(-decayRate * ageInDays);
    return { ...r, score: r.score * multiplier };
  });
}
```

**Note:** The `staleness_score` column in SQLite `files` table is unused by the search path — staleness is computed on-the-fly in the searcher using `indexed_at` from LanceDB. The SQLite column can be ignored for v1 or populated during indexing for future use.

### Pattern 4: Provider Switch Warning
**What:** `assertModelMatch()` already throws when switching providers — EMB-04 is already implemented
**What Phase 6 adds:** The factory should emit a user-visible warning message explaining *why* the error occurred and what to do (run `mem index` to reindex)

The current error message is already clear: `"Embedding model mismatch: stored="...", current="...". Re-index required."` — Phase 6 just needs to ensure the CLI catches this and formats it as a user warning rather than an unhandled exception crash.

### Anti-Patterns to Avoid
- **Don't add `ollamaModel` as a top-level Config field** — use the Ollama adapter constructor default; config already has `openaiModel` precedent. Add `ollamaModel` to Config only if needed, mirroring `openaiModel`.
- **Don't call `openChunksTable` with hardcoded 1536** — any call site that creates the table must derive dimension from the configured provider.
- **Don't apply staleness decay before RRF merge** — decay must come after RRF scoring to avoid distorting the merge weights.
- **Don't re-sort after staleness** — results are already ranked; multiply scores in-place to preserve RRF ordering intent while penalizing old content.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for Ollama | Custom axios/got wrapper | `fetch` (Node 18 built-in) | No dep needed; Ollama API is simple REST |
| Dimension detection | Auto-probe Ollama on startup | Hardcode 768 for nomic-embed-text | Stable model; probing adds cold-start latency |
| Staleness DB storage | Pre-compute scores in SQLite | Compute on-the-fly from `indexedAt` | `indexed_at` already in LanceDB per chunk; simpler |

## Common Pitfalls

### Pitfall 1: Ollama Response Shape Differs from OpenAI
**What goes wrong:** OpenAI returns `{ data: [{ embedding: [...] }] }` but Ollama returns `{ embeddings: [[...]] }` — direct copy-paste from OpenAI adapter silently returns empty arrays.
**Why it happens:** Different API design conventions.
**How to avoid:** The Ollama response uses `embeddings` (plural, top-level array of arrays), not `data[i].embedding`.
**Warning signs:** `embed()` returns correct count but all vectors are zeroes/empty.

### Pitfall 2: Vector Dimension Mismatch on Table Creation
**What goes wrong:** If `openChunksTable(connection)` is called without passing the dimension, it defaults to 1536. An Ollama-indexed table has 768-dim vectors. Switching back to OpenAI with an existing 768-dim table causes a schema mismatch in LanceDB at insert time.
**Why it happens:** `openChunksTable` default is `1536` — left over from the OpenAI default.
**How to avoid:** Always pass `dimension` derived from `config.embeddingProvider` at all call sites.
**Warning signs:** LanceDB throws Arrow schema error on `table.add()`.

### Pitfall 3: Ollama Not Running
**What goes wrong:** `fetch` to `localhost:11434` throws `ECONNREFUSED`.
**Why it happens:** Ollama daemon not started, or different port.
**How to avoid:** Catch the connection error and throw a user-friendly message: "Ollama is not running. Start it with `ollama serve` or install from https://ollama.ai".
**Warning signs:** `TypeError: fetch failed` with ECONNREFUSED cause.

### Pitfall 4: Staleness Kills Recall for Old Notes
**What goes wrong:** High decay rate makes valuable old content invisible — a note from 2 years ago about a critical project pattern scores near-zero.
**Why it happens:** Aggressive `k` value combined with large age.
**How to avoid:** Default to a gentle rate (0.003), document the `stalenessDecayRate: 0` option to disable, expose it in `mem config`.
**Warning signs:** User searches for something they know exists and gets no results.

### Pitfall 5: `indexed_at` reflects index time, not file modification time
**What goes wrong:** A note written 3 years ago but reindexed last week scores as "new" — defeating the purpose of staleness scoring.
**Why it happens:** `indexed_at` is set at index time, not file mtime.
**How to avoid:** The LanceDB schema does not currently store `file_modified_at`. For v1, using `indexed_at` is acceptable since incremental reindex updates this timestamp when files change. Document this limitation.
**Better v2 approach:** Add `file_modified_at` to LanceDB schema and use that for decay calculation.

## Code Examples

### Ollama API Response Shape (verified live)
```typescript
// POST http://localhost:11434/api/embed
// Body: { model: "nomic-embed-text", input: ["text1", "text2"] }
// Response:
{
  model: "nomic-embed-text",
  embeddings: [
    [/* 768 floats */],
    [/* 768 floats */],
  ]
}
```

### Factory Update
```typescript
// src/core/embedder/factory.ts
import { OllamaEmbeddingProvider } from './ollama.js';

export function createEmbeddingProvider(config: Config): EmbeddingProvider {
  if (config.embeddingProvider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required');
    return new OpenAIEmbeddingProvider(apiKey, config.openaiModel, config.batchSize, config.concurrency);
  }
  if (config.embeddingProvider === 'ollama') {
    return new OllamaEmbeddingProvider(config.ollamaModel ?? 'nomic-embed-text');
  }
  throw new Error(`Unknown embedding provider: ${config.embeddingProvider}`);
}
```

### Config Extension
```typescript
// Add to Config in types.ts:
ollamaModel?: string;          // default: 'nomic-embed-text'
ollamaBaseUrl?: string;        // default: 'http://localhost:11434'
stalenessDecayRate?: number;   // default: 0.003; set 0 to disable
```

### Dimension Constant Pattern
```typescript
// In any file that calls openChunksTable:
const PROVIDER_DIMENSIONS: Record<string, number> = {
  openai: 1536,
  ollama: 768,
};
const dimension = PROVIDER_DIMENSIONS[config.embeddingProvider] ?? 1536;
const table = await openChunksTable(connection, dimension);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ollama `/api/embeddings` (single) | `/api/embed` (batch, plural) | Ollama 0.1.24+ | Old endpoint still works but deprecated; use `/api/embed` |
| Fixed staleness scores stored in DB | On-the-fly decay via `indexedAt` | Phase 6 | Simpler, no extra write path |

## Open Questions

1. **Should `file_modified_at` be added to LanceDB schema?**
   - What we know: `indexed_at` is set at index time; incremental reindex updates it when files change
   - What's unclear: For files that haven't changed content but user wants to score by actual write date
   - Recommendation: Defer to v2; `indexed_at` is good enough for v1 and avoids schema migration

2. **Should staleness decay affect FTS-only results?**
   - What we know: FTS mode returns `_score` not `_relevance_score`; `indexedAt` is always available
   - What's unclear: Whether recency matters for exact-keyword matches
   - Recommendation: Apply decay to all modes consistently — simpler code, user can set `stalenessDecayRate: 0` to disable

3. **Should `ollamaModel` be configurable via `mem config`?**
   - What we know: `config.ts` already handles `config set` for known fields
   - Recommendation: Yes, add `ollamaModel` to config schema like `openaiModel`

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 |
| Config file | `vitest.config.ts` (or package.json `test` script) |
| Quick run command | `npm test -- --reporter=verbose src/core/embedder/ollama.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EMB-03 | `OllamaEmbeddingProvider.embed()` returns correct vectors | unit | `npm test -- src/core/embedder/ollama.test.ts` | ❌ Wave 0 |
| EMB-03 | `modelId()` returns `'ollama:nomic-embed-text'` | unit | `npm test -- src/core/embedder/ollama.test.ts` | ❌ Wave 0 |
| EMB-03 | factory creates `OllamaEmbeddingProvider` when config says ollama | unit | `npm test -- src/core/embedder/factory.test.ts` | ✅ (update existing) |
| EMB-03 | `embed([])` returns `[]` without HTTP call | unit | `npm test -- src/core/embedder/ollama.test.ts` | ❌ Wave 0 |
| SRCH-06/07 | chunk from 18-month-old note scores lower than identical chunk from last week | unit | `npm test -- src/core/searcher.test.ts` | ✅ (add test) |
| SRCH-07 | `stalenessDecayRate: 0` disables decay (scores unchanged) | unit | `npm test -- src/core/searcher.test.ts` | ✅ (add test) |
| EMB-03 | switching provider throws mismatch error (already covered by assertModelMatch) | unit | `npm test -- src/core/db/sqlite.test.ts` | ✅ existing |

### Sampling Rate
- **Per task commit:** `npm test -- src/core/embedder/ollama.test.ts src/core/searcher.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/core/embedder/ollama.test.ts` — covers EMB-03 (new file needed)
- [ ] Update `src/core/embedder/factory.test.ts` — replace `throws "not yet implemented"` test with `returns OllamaEmbeddingProvider` test

*(Existing sqlite.test.ts covers assertModelMatch; existing searcher.test.ts needs staleness decay tests added)*

## Sources

### Primary (HIGH confidence)
- Live Ollama API at `localhost:11434` — verified `/api/embed` response shape and 768-dim output for `nomic-embed-text`
- `src/core/embedder/openai.ts` — implementation pattern to mirror
- `src/core/embedder/types.ts` — interface contract
- `src/core/db/sqlite.ts` — `assertModelMatch()` already handles provider switch detection
- `src/core/db/lance.ts` — `openChunksTable(connection, vectorDimension)` accepts dimension param
- `src/types.ts` — `Config` and `SearchResult` types
- `src/core/searcher.ts` — RRF merge; `rowToResult()` populates `indexedAt`

### Secondary (MEDIUM confidence)
- Ollama API docs pattern (from knowledge + live verification): `/api/embed` with `input` array field

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all verified against live code and running Ollama
- Architecture: HIGH — interface pattern already established; Ollama API verified live
- Pitfalls: HIGH — dimension issue confirmed by reading lance.ts defaults; response shape confirmed by live test

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (Ollama API is stable; LanceDB schema is frozen by existing index)
