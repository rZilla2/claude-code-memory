---
phase: 06-ollama-adapter-staleness-scoring
plan: 01
subsystem: embedder
tags: [ollama, embeddings, local-inference, nomic-embed-text, tdd, vitest]

requires:
  - phase: 01-foundation
    provides: EmbeddingProvider interface, Config type, ConfigSchema

provides:
  - OllamaEmbeddingProvider class implementing EmbeddingProvider
  - Factory creates Ollama provider when config.embeddingProvider is 'ollama'
  - Config extended with ollamaModel (default: nomic-embed-text) and ollamaBaseUrl fields

affects: [query-pipeline, consumer-surfaces, file-watcher-maintenance]

tech-stack:
  added: []
  patterns:
    - TDD red-green-refactor for adapter implementation
    - Same chunk+batch pattern as OpenAIEmbeddingProvider
    - ECONNREFUSED detection for user-friendly error messaging

key-files:
  created:
    - src/core/embedder/ollama.ts
    - src/core/embedder/ollama.test.ts
  modified:
    - src/core/embedder/factory.ts
    - src/core/embedder/factory.test.ts
    - src/types.ts
    - src/config.ts

key-decisions:
  - "OllamaEmbeddingProvider uses its own batchSize default (20) — local GPU has different throughput than OpenAI API"
  - "ECONNREFUSED error mapped to user-friendly message mentioning 'ollama serve' and ollama.ai URL"
  - "ollamaModel and ollamaBaseUrl are optional in Config type (?) but required by ConfigSchema with defaults"

patterns-established:
  - "Adapter error wrapping: catch fetch errors, check cause.code === ECONNREFUSED, throw human-readable message"
  - "Factory mock pattern: vi.mock('./ollama.js') with constructor spy for factory unit tests"

requirements-completed: [EMB-03]

duration: 15min
completed: 2026-04-06
---

# Phase 06 Plan 01: Ollama Embedding Adapter Summary

**OllamaEmbeddingProvider for nomic-embed-text local inference with ECONNREFUSED detection, batching, and factory wiring**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-06T18:50:00Z
- **Completed:** 2026-04-06T18:51:35Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Implemented OllamaEmbeddingProvider with TDD (7 tests: modelId, empty input, batching, ECONNREFUSED, HTTP errors)
- Extended Config type and ConfigSchema with ollamaModel/ollamaBaseUrl fields with sensible defaults
- Wired factory to create OllamaEmbeddingProvider (removed 'not yet implemented' throw)
- Updated factory tests to mock ollama module and verify constructor call args
- All 173 tests pass across 23 test files

## Task Commits

1. **Task 1: Ollama embedding adapter with TDD** - `2415164` (feat)
2. **Task 2: Wire factory, extend Config, update factory tests** - `c7814e4` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/core/embedder/ollama.ts` - OllamaEmbeddingProvider implementing EmbeddingProvider
- `src/core/embedder/ollama.test.ts` - 7 unit tests for all adapter behaviors
- `src/core/embedder/factory.ts` - Import and instantiate OllamaEmbeddingProvider for 'ollama' branch
- `src/core/embedder/factory.test.ts` - Mock ollama module, replace throw test with constructor spy assertions
- `src/types.ts` - Added ollamaModel? and ollamaBaseUrl? to Config interface
- `src/config.ts` - Added ollamaModel/ollamaBaseUrl to ConfigSchema with defaults

## Decisions Made

- OllamaEmbeddingProvider uses its own batchSize default (20) — local GPU throughput differs from OpenAI API; passing the global `batchSize` from config would be wrong
- ECONNREFUSED maps to "Start it with `ollama serve`" — most actionable error message for local-first users
- Optional fields in Config type but required by ConfigSchema ensures type safety while providing defaults

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required (Ollama is optional local setup by the end user).

## Next Phase Readiness

- OllamaEmbeddingProvider ready for use in Phase 06 Plan 02 (staleness scoring)
- Local users can now index vault content without an OpenAI API key by setting `embeddingProvider: 'ollama'` in config

---
*Phase: 06-ollama-adapter-staleness-scoring*
*Completed: 2026-04-06*
