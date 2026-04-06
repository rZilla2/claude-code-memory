---
phase: 06
slug: ollama-adapter-staleness-scoring
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-06
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --reporter=verbose src/core/embedder/ollama.test.ts src/core/searcher.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/core/embedder/ollama.test.ts src/core/searcher.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Wave 0 Satisfaction

Wave 0 test stubs are satisfied by inline TDD ordering in the plans:

- TDD tasks create `src/core/embedder/ollama.test.ts` as first action (tests before implementation). Covers EMB-03.
- Staleness tests added to existing `src/core/searcher.test.ts` as first action. Covers SRCH-06, SRCH-07.
- Existing `src/core/embedder/factory.test.ts` updated to replace "not yet implemented" assertion with real provider test.

No separate Wave 0 plan needed — TDD tasks write test stubs before implementation.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 06-01-01 | 01 | 1 | EMB-03 | unit | `npm test -- src/core/embedder/ollama.test.ts` | pending |
| 06-01-02 | 01 | 1 | EMB-03 | unit | `npm test -- src/core/embedder/factory.test.ts` | pending |
| 06-02-01 | 02 | 1 | SRCH-06 | unit | `npm test -- src/core/searcher.test.ts` | pending |
| 06-02-02 | 02 | 1 | SRCH-07 | unit | `npm test -- src/core/searcher.test.ts` | pending |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `mem index` with ollama config makes no OpenAI calls | EMB-03 | Requires live Ollama server | Set `embedding_provider: "ollama"` in config, unset OPENAI_API_KEY, run `mem index` on small test vault |
| Staleness decay observable in real search results | SRCH-06 | Requires indexed vault with old+new content | Run `mem search` on vault with old and recent notes, verify scores differ |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or TDD-inline test creation
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered by TDD task ordering
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
