---
phase: 05
slug: file-watcher-maintenance
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-06
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --reporter=verbose src/core/watcher.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/core/watcher.test.ts src/cli/commands/compact-cmd.test.ts src/cli/commands/prune-cmd.test.ts src/cli/commands/watch-cmd.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Wave 0 Satisfaction

Wave 0 test stubs are satisfied by inline TDD ordering in the plans:

- **Plan 01 Task 2** (`tdd="true"`): Creates `src/core/watcher.test.ts` as its first action (tests before implementation). Covers WATCH-01 through WATCH-04.
- **Plan 02 Task 1** (`tdd="true"`): Creates `src/cli/commands/compact-cmd.test.ts` and `src/cli/commands/prune-cmd.test.ts` as first action. Covers MAINT-01, MAINT-02.
- **Plan 02 Task 2** (`tdd="true"`): Creates `src/cli/commands/watch-cmd.test.ts` as first action. Covers WATCH-05 startup logic.

No separate Wave 0 plan is needed -- TDD tasks write test stubs before implementation within each task.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 05-01-01 | 01 | 1 | WATCH-01 | unit | `npm test -- src/core/watcher.test.ts` | pending |
| 05-01-02 | 01 | 1 | WATCH-02 | unit | `npm test -- src/core/watcher.test.ts` | pending |
| 05-01-03 | 01 | 1 | WATCH-03 | unit | `npm test -- src/core/watcher.test.ts` | pending |
| 05-01-04 | 01 | 1 | WATCH-04 | unit | `npm test -- src/core/watcher.test.ts` | pending |
| 05-02-01 | 02 | 2 | WATCH-05 | unit+manual | `npm test -- src/cli/commands/watch-cmd.test.ts` | pending |
| 05-02-02 | 02 | 2 | MAINT-01 | unit | `npm test -- src/cli/commands/compact-cmd.test.ts` | pending |
| 05-02-03 | 02 | 2 | MAINT-02 | unit | `npm test -- src/cli/commands/prune-cmd.test.ts` | pending |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `mem watch` starts watcher, Ctrl+C stops | WATCH-05 | Requires live process and signal handling | Run `mem watch`, edit a vault file, verify reindex log output, Ctrl+C to stop |
| iCloud bulk sync triggers single reindex per file | WATCH-02 | Requires real iCloud sync event storm | Edit file on iPhone, observe Mac watcher logs, verify one reindex per file |
| 500+ incremental updates don't fragment excessively | MAINT-01 | Requires sustained load over time | Run indexer in loop, check `mem status` fragment count |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or TDD-inline test creation
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered by TDD task ordering (tests written first in each tdd="true" task)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
