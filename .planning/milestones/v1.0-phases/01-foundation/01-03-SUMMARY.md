---
phase: 01-foundation
plan: "03"
subsystem: embeddings
tags: [openai, embeddings, p-limit, batching, concurrency, typescript, vitest]

requires:
  - phase: 01-foundation plan 01
    provides: Config interface, types.ts, project scaffold with vitest

provides:
  - EmbeddingProvider interface (embed + modelId contract)
  - OpenAIEmbeddingProvider with 100-item batching and p-limit concurrency
  - createEmbeddingProvider factory reading OPENAI_API_KEY from env
  - Ollama placeholder with clear Phase 6 message

affects: [02-indexer, 06-ollama, phase-04-mcp]

tech-stack:
  added: [openai SDK (already in deps), p-limit (already in deps)]
  patterns:
    - "Pluggable provider pattern: EmbeddingProvider interface with implementations behind factory"
    - "Internal batching: adapter chunks inputs, caller passes flat array"
    - "Concurrency via p-limit wrapping Promise.all over batches"

key-files:
  created:
    - src/core/embedder/types.ts
    - src/core/embedder/openai.ts
    - src/core/embedder/factory.ts
    - src/core/embedder/openai.test.ts
    - src/core/embedder/factory.test.ts
  modified: []

key-decisions:
  - "EmbeddingProvider interface has embed() and modelId() only — minimal surface for maximum replaceability"
  - "modelId() format is 'provider:model-name' (e.g., openai:text-embedding-3-small) for SQLite mismatch detection"
  - "Batching is internal to the adapter — callers pass flat text arrays, never worry about batch size"
  - "Vitest class-based mock pattern required for OpenAI constructor (arrow fn mock causes 'is not a constructor' error)"

patterns-established:
  - "Provider pattern: interface + factory + implementations in src/core/{subsystem}/"
  - "TDD test mocking: use class-based vi.mock for ES module classes used with new keyword"

requirements-completed: [EMB-01, EMB-02, EMB-04]

duration: 18min
completed: 2026-04-05
---

# Phase 01 Plan 03: Embedding Provider Summary

**Pluggable EmbeddingProvider interface with OpenAI adapter (100-item batching, p-limit concurrency) and factory that reads OPENAI_API_KEY from env**

## Performance

- **Duration:** 18 min
- **Started:** 2026-04-05T13:44:00Z
- **Completed:** 2026-04-05T14:02:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- EmbeddingProvider interface established as the contract for all embedding implementations
- OpenAIEmbeddingProvider handles batching (100 texts/batch), concurrency (p-limit), and empty input guard
- createEmbeddingProvider factory validates OPENAI_API_KEY at construction time, not at call time
- Ollama provider throws a clear "not yet implemented (planned for Phase 6)" error
- 11 tests passing across openai.test.ts (7) and factory.test.ts (4)

## Task Commits

1. **Task 1: EmbeddingProvider interface contract** — `d2b8de5` (feat)
2. **Task 2: OpenAI adapter + factory with tests** — `4f891bb` (feat, TDD)

## Files Created/Modified

- `src/core/embedder/types.ts` — EmbeddingProvider interface (embed + modelId)
- `src/core/embedder/openai.ts` — OpenAIEmbeddingProvider with chunk helper, batching, p-limit
- `src/core/embedder/factory.ts` — createEmbeddingProvider reading env var, Ollama placeholder
- `src/core/embedder/openai.test.ts` — 7 tests: interface shape, modelId variants, batching, empty input, concurrency
- `src/core/embedder/factory.test.ts` — 4 tests: correct type returned, modelId format, missing key, ollama throws

## Decisions Made

- modelId() returns `openai:text-embedding-3-small` stable format — will be stored in SQLite to detect model changes across sessions
- Batching is encapsulated inside the adapter — indexer passes flat arrays, no batch awareness needed upstream
- Factory throws on missing OPENAI_API_KEY at construction, not at embed() call — fail fast before any indexing begins

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Vitest arrow-function mock incompatible with ES module constructor**
- **Found during:** Task 2 (GREEN phase test run)
- **Issue:** `vi.mock('openai', () => ({ default: vi.fn().mockImplementation(() => {...}) }))` caused "is not a constructor" error because vitest arrow-fn mocks can't be called with `new`
- **Fix:** Rewrote mock using an inline class (`class MockOpenAI { ... }`) which vitest hoists and uses as a real constructor
- **Files modified:** src/core/embedder/openai.test.ts, src/core/embedder/factory.test.ts
- **Verification:** All 11 tests pass after fix
- **Committed in:** 4f891bb (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Mock pattern fix, no scope change. Established the correct vitest class-mock pattern for future ES module constructors.

## Issues Encountered

- Pre-existing TSC error from Plan 01-02 (`sqlite.test.ts` importing not-yet-built `sqlite.js`). Out of scope — logged but not fixed. TSC shows clean for embedder files.

## Next Phase Readiness

- EmbeddingProvider interface is the stable contract Phase 2 (indexer) can build against
- OpenAI adapter ready for real use — just needs OPENAI_API_KEY in env
- Ollama slot reserved with clear error; Phase 6 implements it against the same interface with no breaking changes

---
*Phase: 01-foundation*
*Completed: 2026-04-05*
