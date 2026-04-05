---
phase: 02
slug: index-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-05
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test -- --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test -- --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | IDX-01 | unit | `npm test -- src/core/scanner.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | IDX-02 | unit | `npm test -- src/core/chunker.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | IDX-04 | unit | `npm test -- src/core/indexer.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 0 | IDX-06 | integration | `npm test -- src/cli/commands/index.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 0 | IDX-07 | integration | `npm test -- src/cli/commands/status.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | IDX-01 | unit | `npm test -- src/core/scanner.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 1 | IDX-02, IDX-03 | unit | `npm test -- src/core/chunker.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 2 | IDX-04, IDX-05 | unit | `npm test -- src/core/indexer.test.ts` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 3 | IDX-06, IDX-07 | integration | `npm test -- src/cli/commands/*.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/core/scanner.test.ts` — stubs for IDX-01
- [ ] `src/core/chunker.test.ts` — stubs for IDX-02, IDX-03
- [ ] `src/core/indexer.test.ts` — stubs for IDX-04, IDX-05
- [ ] `src/cli/commands/index.test.ts` — stubs for IDX-06
- [ ] `src/cli/commands/status.test.ts` — stubs for IDX-07
- [ ] Install remark packages: `npm install unified remark-parse remark-frontmatter remark-gfm mdast-util-to-string`
- [ ] Install `commander` as prod dep: `npm install commander`
- [ ] Optionally add `fast-glob`: `npm install fast-glob`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `mem index` on 1000+ file vault completes without timeout | IDX-06 | Real vault size needed | Run `mem index --vault ~/Library/Mobile\ Documents/iCloud~md~obsidian/Documents/Second\ Brain` and verify exit 0, runtime < 5min |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
