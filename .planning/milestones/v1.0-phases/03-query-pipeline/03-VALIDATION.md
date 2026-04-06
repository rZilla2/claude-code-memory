---
phase: 3
slug: query-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-05
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/core/searcher.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/core/searcher.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | SRCH-01 | unit+integration | `npx vitest run src/core/searcher.test.ts -t "vector"` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | SRCH-02 | unit+integration | `npx vitest run src/core/searcher.test.ts -t "fts"` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | SRCH-03 | unit+integration | `npx vitest run src/core/searcher.test.ts -t "hybrid"` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | SRCH-04 | unit | `npx vitest run src/core/searcher.test.ts -t "result shape"` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | SRCH-05 | unit | `npx vitest run src/core/searcher.test.ts -t "date filter"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/core/searcher.test.ts` — stubs for SRCH-01 through SRCH-05
- [ ] `src/core/db/lance.test.ts` — FTS index creation tests (ensureFtsIndex)

*Test strategy: Use real (tmp-dir) LanceDB with synthetic chunks — no mocking needed since LanceDB is a local file store.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Semantic relevance quality | SRCH-01 | Requires human judgment on result relevance | Run `mem search "calendar setup"` against indexed vault, verify top results are contextually relevant |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
