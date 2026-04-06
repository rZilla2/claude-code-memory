---
phase: 06-ollama-adapter-staleness-scoring
verified: 2026-04-06T14:55:00Z
status: passed
score: 8/8 must-haves verified
re_verification: false
---

# Phase 6: Ollama Adapter & Staleness Scoring Verification Report

**Phase Goal:** Local/offline users can index without OpenAI, and old content is automatically deprioritized
**Verified:** 2026-04-06T14:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Setting embeddingProvider to 'ollama' returns an OllamaEmbeddingProvider | VERIFIED | factory.ts line 16: `return new OllamaEmbeddingProvider(config.ollamaModel, config.ollamaBaseUrl)` |
| 2  | OllamaEmbeddingProvider.embed() calls POST to /api/embed and returns vectors | VERIFIED | ollama.ts line 42: `fetch(\`${this.baseUrl}/api/embed\`, ...)`; factory.test passes |
| 3  | OllamaEmbeddingProvider.modelId() returns 'ollama:nomic-embed-text' | VERIFIED | All 7 Ollama unit tests pass |
| 4  | embed([]) returns [] without an HTTP call | VERIFIED | Test passes: "embed([]) returns [] without making any fetch call" |
| 5  | Connection refused throws user-friendly error mentioning 'ollama serve' | VERIFIED | ollama.ts line 51: message contains "ollama serve"; test passes |
| 6  | 18-month-old chunk scores measurably lower than 1-week-old chunk | VERIFIED | searcher.test.ts: decay tests confirm ~0.193 vs ~0.979 scores; all pass |
| 7  | stalenessDecayRate=0 disables decay entirely | VERIFIED | applyDecay returns early when rate=0; test "rate=0 returns scores unchanged" passes |
| 8  | Decay applied after RRF merge in all three search modes | VERIFIED | searcher.ts lines 59, 68, 112: applyDecay called at all 3 return points (fts, vector, hybrid) |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/embedder/ollama.ts` | OllamaEmbeddingProvider class | VERIFIED | 67 lines; implements EmbeddingProvider; fetch to /api/embed; ECONNREFUSED handling |
| `src/core/embedder/ollama.test.ts` | Unit tests (min 40 lines) | VERIFIED | 91 lines; 7 tests all passing |
| `src/core/embedder/factory.ts` | Updated factory with ollama branch | VERIFIED | Imports OllamaEmbeddingProvider; instantiates with ollamaModel/ollamaBaseUrl |
| `src/types.ts` | Config with ollamaModel, ollamaBaseUrl, stalenessDecayRate | VERIFIED | All three fields present; stalenessDecayRate in both Config and SearchOptions |
| `src/config.ts` | ConfigSchema with defaults for new fields | VERIFIED | ollamaModel='nomic-embed-text', ollamaBaseUrl='http://localhost:11434', stalenessDecayRate=0.003 |
| `src/core/searcher.ts` | applyDecay function wired into search() | VERIFIED | applyDecay exported at line 7; called at 3 search return points |
| `src/core/searcher.test.ts` | Staleness decay tests | VERIFIED | describe('applyDecay') block at line 362; 6 tests all passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/core/embedder/factory.ts` | `src/core/embedder/ollama.ts` | import OllamaEmbeddingProvider | WIRED | Line 4: `import { OllamaEmbeddingProvider } from './ollama.js'` |
| `src/core/embedder/ollama.ts` | `http://localhost:11434/api/embed` | fetch call | WIRED | Line 42: fetch to `${this.baseUrl}/api/embed` |
| `src/core/searcher.ts` | `SearchResult.indexedAt` | age calculation in applyDecay | WIRED | Line 12: `(now - r.indexedAt.getTime()) / 86_400_000`; line 13: `Math.exp(-decayRate * ageInDays)` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EMB-03 | 06-01-PLAN.md | Ollama/nomic-embed-text adapter as local alternative | SATISFIED | OllamaEmbeddingProvider ships; factory wired; 7 unit tests green |
| SRCH-06 | 06-02-PLAN.md | Recency weighting boosts newer chunks over older ones | SATISFIED | applyDecay with exp decay; 18-month chunk ~0.193, 1-week chunk ~0.979 |
| SRCH-07 | 06-02-PLAN.md | Configurable staleness decay reduces relevance score | SATISFIED | stalenessDecayRate in Config schema with default 0.003; rate=0 disables |

### Anti-Patterns Found

None detected. No TODOs, placeholders, empty handlers, or stub returns found in phase files.

### Human Verification Required

None — all behaviors are verifiable programmatically via unit tests.

### Test Suite Result

173 tests across 23 test files: all passed. Duration: 653ms.

Specific phase tests confirmed passing:
- 7 OllamaEmbeddingProvider tests (ollama.test.ts)
- 2 factory tests for ollama provider (factory.test.ts)
- 6 applyDecay tests (searcher.test.ts)

---

_Verified: 2026-04-06T14:55:00Z_
_Verifier: Claude (gsd-verifier)_
