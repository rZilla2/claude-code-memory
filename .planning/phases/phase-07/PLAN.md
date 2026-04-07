# Phase 7: Code Fixes — Chunking, LanceDB, Ollama

## Goal
Fix the three code-level issues: oversized heading-based chunks, LanceDB deprecation warnings, and Ollama E2E validation.

## Plans

### Plan 7.1: Large Section Sub-Chunking (CHUNK-01, CHUNK-02, CHUNK-03)

**What:** When a heading section exceeds maxTokens, sub-chunk it by paragraph (reuse splitByParagraphs logic).

**Changes:**
- `src/core/chunker.ts`: After `flushChunk` creates a chunk, check if `estimateTokens(embeddableText) > maxTokens`. If so, split by paragraph while preserving the heading breadcrumb.
- `src/core/chunker.test.ts`: Add test for large section under H1 that exceeds 500 tokens — should produce multiple chunks with heading path preserved.

**Approach:**
1. Write failing test (large section under heading → multiple chunks)
2. Modify `flushChunk` or add post-processing in `chunkMarkdown` to sub-split oversized chunks
3. Pass maxTokens through to the sub-splitting logic
4. Verify all existing tests still pass

### Plan 7.2: LanceDB Deprecation Fix (LANCE-01, LANCE-02)

**What:** Add `_distance` to RESULT_COLUMNS in searcher.ts vector queries.

**Changes:**
- `src/core/searcher.ts`: Add `_distance` to `RESULT_COLUMNS` array
- Verify no warnings in test output

**Approach:**
1. Add `_distance` to the select columns
2. Run tests, confirm deprecation warning is gone
3. Verify `rowToResult` still reads `_distance` correctly

### Plan 7.3: Ollama Validation (OLLAMA-01, OLLAMA-02, OLLAMA-03)

**What:** Add integration-level test for Ollama embed → index → search cycle, verify model mismatch, update README.

**Changes:**
- `src/core/embedder/ollama.test.ts`: Add mock integration test covering full cycle
- `README.md`: Add Ollama setup section
- Verify existing model mismatch test covers OpenAI↔Ollama switch

**Approach:**
1. Check existing mismatch tests
2. Add Ollama integration test with mocked HTTP
3. Update README with Ollama instructions
